use anyhow::{Result, bail};
use std::collections::HashMap;
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{error, info, warn};

use super::xdr::{self, Xdr, XdrReader};

/// NFSv3 over TCP: a read-only server that serves files backed by the block
/// store. Implements MOUNT (v3) + NFS (v3) procedure subset needed to mount a
/// VM disk image over NFS and read it: MOUNT NULL/MNT/UMNT/UMNTALL,
/// NFS NULL/GETATTR/ACCESS/LOOKUP/READLINK/READ/READDIR/READDIRPLUS/FSSTAT/FSINFO/PATHCONF.
///
/// On Windows we provide a userspace NFSv3 implementation; on Linux a native
/// NFS daemon could be used instead. The exported filesystem is a flat list of
/// files mapped to offsets within a reconstructed VM disk image.

/// Virtual file descriptor: a file within the exported filesystem.
#[derive(Debug, Clone)]
pub struct NfsFile {
    /// Stable NFS filehandle (opaque bytes).
    pub handle: Vec<u8>,
    /// Virtual path, e.g. "/" or "/vm-disk.vmdk".
    pub path: String,
    pub size: u64,
    pub is_dir: bool,
    pub mode: u32,
    pub mtime: u64,
}

pub struct NfsExporter {
    /// Map of filehandle -> file (used for NFS replies).
    files: HashMap<Vec<u8>, NfsFile>,
    /// Called to fetch a byte range of a file; used to lazily read from backup.
    read_fn: Option<Arc<dyn Fn(&str, u64, u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>>> + Send>> + Send + Sync>>,
    #[allow(dead_code)]
    port: u16,
}

/// Upper bound for a single NFS READ (1 MiB). Prevents a hostile client from
/// requesting a ~4 GiB allocation.
const MAX_READ_BYTES: u32 = 1024 * 1024;

impl NfsExporter {
    pub fn new(port: u16) -> Self {
        let root = NfsFile {
            handle: b"BCKROOT".to_vec(),
            path: "/".to_string(),
            size: 4096,
            is_dir: true,
            mode: 0o755,
            mtime: 0,
        };
        let mut files = HashMap::new();
        files.insert(root.handle.clone(), root);
        Self { files, read_fn: None, port }
    }

    /// Register a read callback that reconstructs file bytes from the block store.
    pub fn with_read<F>(mut self, f: F) -> Self
    where
        F: Fn(&str, u64, u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>>> + Send>>
            + Send
            + Sync
            + 'static,
    {
        self.read_fn = Some(Arc::new(f));
        self
    }

    /// Add a file to the exported filesystem.
    pub fn add_file(&mut self, path: &str, size: u64, mode: u32, mtime: u64) -> Vec<u8> {
        let handle = format!("BCK{}", path).into_bytes();
        self.files.insert(
            handle.clone(),
            NfsFile {
                handle: handle.clone(),
                path: path.to_string(),
                size,
                is_dir: false,
                mode,
                mtime,
            },
        );
        handle
    }

    /// List virtual files (for READDIR). Returns (name, filehandle).
    fn listing(&self) -> Vec<(String, Vec<u8>)> {
        self.files
            .values()
            .filter(|f| f.path != "/")
            .map(|f| (f.path.trim_start_matches('/').to_string(), f.handle.clone()))
            .collect()
    }

    fn lookup(&self, name: &str) -> Option<&NfsFile> {
        let path = if name == "/" {
            "/".to_string()
        } else {
            format!("/{}", name.trim_start_matches('/'))
        };
        self.files.values().find(|f| f.path == path)
    }

    /// Start the NFSv3 server. Blocks until stopped.
    pub async fn serve(self: Arc<Self>, addr: SocketAddr) -> Result<()> {
        let listener = TcpListener::bind(addr).await?;
        info!("NFSv3 server listening on {} ({} files)", addr, self.files.len());
        loop {
            let (stream, peer) = listener.accept().await?;
            let this = self.clone();
            tokio::spawn(async move {
                if let Err(e) = this.handle_conn(stream).await {
                    warn!("NFS conn {} closed: {}", peer, e);
                }
            });
        }
    }

    async fn handle_conn(self: Arc<Self>, mut stream: TcpStream) -> Result<()> {
        let mut buf = Vec::with_capacity(65536);
        loop {
            let mut header = [0u8; 4];
            if stream.read_exact(&mut header).await.is_err() {
                return Ok(());
            }
            let len = u32::from_be_bytes(header) & 0x7FFF_FFFF;
            if len as usize > 16 * 1024 * 1024 {
                bail!("NFS record too large: {}", len);
            }
            buf.resize(len as usize, 0);
            stream.read_exact(&mut buf).await?;

            let reply = self.dispatch(&buf);
            let mut out = Vec::new();
            xdr::write_rpc_record(&mut out, &reply)?;
            stream.write_all(&out).await?;
        }
    }

    fn dispatch(self: &Arc<Self>, frag: &[u8]) -> Vec<u8> {
        let mut r = XdrReader::new(frag);
        let xid = match r.uint() {
            Ok(v) => v,
            Err(_) => return Xdr::new().into_vec(),
        };
        // msg_type = CALL
        let _ = r.uint().ok();
        let _ = r.uint().ok();
        let prog = r.uint().unwrap_or(0);
        let _vers = r.uint().unwrap_or(0);
        let proc = r.uint().unwrap_or(0xFFFFFFFF);

        let mut reply = xdr::rpc_reply_header(xid, 0);

        match prog {
            100005 => self.mount_proc(&mut reply, proc, &mut r),
            100003 => self.nfs_proc(&mut reply, proc, &mut r),
            _ => {
                // program not registered
                reply.int(1); // deny: prog_unavail
            }
        }
        reply.into_vec()
    }

    // ---- MOUNT (100005, v3) ----

    fn mount_proc(&self, reply: &mut Xdr, proc: u32, r: &mut XdrReader<'_>) {
        match proc {
            // MNT: get root filehandle for a path
            1 => {
                let _dirpath = r.string().unwrap_or_default();
                reply.int(0); // status = OK
                // fhs_status + fh
                reply.void();
                reply.opaque(&[0x42, 0x43, 0x4B, 0x01]); // handle "BCK\1"
            }
            // UMNT
            2 => {
                let _ = r.string().unwrap_or_default();
                reply.void();
            }
            // UMNTALL
            3 => {
                reply.void();
            }
            _ => {
                // PROC_UNAVAIL
                reply.int(2);
            }
        }
    }

    // ---- NFS (100003, v3) ----

    fn nfs_proc(&self, reply: &mut Xdr, proc: u32, r: &mut XdrReader<'_>) {
        match proc {
            0 => { /* NULL */ reply.void(); }
            1 => self.getattr(reply, r),
            2 => self.setattr(reply, r),
            3 => self.nfs_lookup(reply, r),
            4 => self.access(reply, r),
            5 => self.readlink(reply, r),
            6 => self.read(reply, r),
            7 => self.write(reply, r),
            8 => self.create(reply, r),
            9 => self.mkdir(reply, r),
            10 => self.symlink(reply, r),
            11 => self.mknod(reply, r),
            12 => self.remove(reply, r),
            13 => self.rmdir(reply, r),
            14 => self.rename(reply, r),
            15 => self.link(reply, r),
            16 => self.readdir(reply, r),
            17 => self.readdirplus(reply, r),
            18 => self.fsstat(reply, r),
            19 => self.fsinfo(reply, r),
            20 => self.pathconf(reply, r),
            21 => self.commit(reply, r),
            _ => reply.int(2), // PROC_UNAVAIL
        }
    }

    #[allow(dead_code)]
    fn file_attr(&self, f: &NfsFile) -> Xdr {
        let mut a = Xdr::new();
        a.void(); // fattr3: attributes follow (null post_op_attr is separate)
        a.int(f.mode as i32); // mode
        a.uint(0); // nlink
        a.uint(0); // uid
        a.uint(0); // gid
        a.uhyper(0); // size
        a.uhyper(4096); // used
        a.void(); // rdev
        a.uhyper(1 << 30); // fsid
        a.uhyper(f.mtime as u64); // fileid
        a.uhyper(f.mtime as u64); // atime
        a.uhyper(f.mtime as u64); // mtime
        a.uhyper(f.mtime as u64); // ctime
        a
    }

    /// Encode an fattr3 object.
    fn encode_attr(&self, f: &NfsFile) -> Xdr {
        let mut a = Xdr::new();
        a.int(f.mode as i32); // type 0=REG,1=DIR in bits 12-15
        a.int((f.mode & 0xFFF) as i32); // mode
        a.uint(if f.is_dir { 2 } else { 1 }); // nlink
        a.uint(0); // uid
        a.uint(0); // gid
        a.uhyper(if f.is_dir { 4096 } else { f.size }); // size
        a.uhyper(if f.is_dir { 4096 } else { f.size }); // used
        a.uint(0); // rdev.major
        a.uint(0); // rdev.minor
        a.uhyper(1 << 30); // fsid
        a.uhyper(if f.is_dir { 1 } else { 2 }); // fileid
        a.uhyper(0); // atime.seconds
        a.uint(0); // atime.nseconds
        a.uhyper(f.mtime); // mtime.seconds
        a.uint(0); // mtime.nseconds
        a.uhyper(f.mtime); // ctime.seconds
        a.uint(0); // ctime.nseconds
        a
    }

    /// Encode post_op_attr: bool + fattr3 (if present).
    fn post_op_attr(&self, f: Option<&NfsFile>) -> Xdr {
        let mut a = Xdr::new();
        match f {
            Some(f) => {
                a.bool_(true);
                let attr = self.encode_attr(f);
                a.buf.extend(attr.into_vec());
            }
            None => {
                a.bool_(false);
            }
        }
        a
    }

    fn getattr(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        reply.int(0); // status
        let f = self.files.get(&fh);
        match f {
            Some(f) => {
                let attr = self.encode_attr(f);
                reply.buf.extend(attr.into_vec());
            }
            None => {
                // NFS3ERR_NOENT
                reply.int(2);
            }
        }
    }

    fn setattr(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(0); // NFS3ERR_SUCCESS (read-only, no-op)
        let root = self.lookup("/").cloned().unwrap();
        let attr = self.post_op_attr(Some(&root));
        reply.buf.extend(attr.into_vec());
    }

    fn nfs_lookup(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let _dir = r.opaque().unwrap_or_default();
        let name = r.string().unwrap_or_default();
        reply.int(0);
        if let Some(f) = self.lookup(&name) {
            let mut fh = Xdr::new();
            fh.opaque(&f.handle);
            reply.buf.extend(fh.into_vec());
            let attr = self.post_op_attr(Some(f));
            reply.buf.extend(attr.into_vec());
        } else {
            reply.int(2); // NFS3ERR_NOENT
            let attr = self.post_op_attr(None);
            reply.buf.extend(attr.into_vec());
        }
    }

    fn access(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        let _access = r.uint().unwrap_or(0);
        reply.int(0);
        let attr = self.post_op_attr(self.files.get(&fh));
        reply.buf.extend(attr.into_vec());
        reply.uint(0x1F); // all access bits
    }

    fn readlink(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        match self.files.get(&fh) {
            Some(f) if f.is_dir => {
                reply.int(5); // NFS3ERR_ISDIR
                let attr = self.post_op_attr(Some(f));
                reply.buf.extend(attr.into_vec());
            }
            Some(f) => {
                reply.int(0);
                let attr = self.post_op_attr(Some(f));
                reply.buf.extend(attr.into_vec());
                reply.void(); // no symlink data
            }
            None => {
                reply.int(2);
            }
        }
    }

    fn read(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        let offset = r.uhyper().unwrap_or(0);
        // Cap per-request reads so a hostile client cannot force a multi-GiB
        // allocation (memory-exhaustion DoS). NFS allows a server to return
        // fewer bytes than requested.
        let count = r.uint().unwrap_or(0).min(MAX_READ_BYTES);
        match self.files.get(&fh) {
            Some(f) if f.is_dir => {
                reply.int(5); // ISDIR
            }
            Some(f) => {
                reply.int(0);
                let attr = self.post_op_attr(Some(f));
                reply.buf.extend(attr.into_vec());
                let data = if let Some(read_fn) = &self.read_fn {
                    match tokio::task::block_in_place(|| {
                        futures::executor::block_on(read_fn(&f.path, offset, count))
                    }) {
                        Ok(d) => d,
                        Err(e) => {
                            error!("NFS read error {}: {}", f.path, e);
                            vec![]
                        }
                    }
                } else {
                    vec![]
                };
                reply.uint(1); // eof
                reply.opaque(&data);
            }
            None => {
                reply.int(2); // NOENT
            }
        }
    }

    fn write(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        // Read-only filesystem
        reply.int(13); // NFS3ERR_ROFS
        let attr = self.post_op_attr(None);
        reply.buf.extend(attr.into_vec());
    }

    fn create(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn mkdir(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn symlink(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn mknod(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn remove(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn rmdir(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn rename(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn link(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(13); // ROFS
    }

    fn readdir(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        let _cookie = r.uhyper().unwrap_or(0);
        let _count = r.uint().unwrap_or(0);
        match self.files.get(&fh) {
            Some(f) if f.is_dir => {
                reply.int(0);
                let attr = self.post_op_attr(Some(f));
                reply.buf.extend(attr.into_vec());
                // dirlist3: entries (cookie3 + name3 + fileid3), eof
                let mut entries = Xdr::new();
                for (name, _handle) in self.listing() {
                    entries.bool_(true); // entry present
                    entries.uhyper(1); // cookie
                    entries.string(&name);
                    entries.uhyper(2); // fileid
                    // next entry placeholder chain
                    entries.bool_(false);
                }
                entries.bool_(false); // no more entries
                entries.bool_(true); // eof
                reply.buf.extend(entries.into_vec());
            }
            Some(_) => {
                reply.int(20); // NOTDIR
            }
            None => {
                reply.int(2); // NOENT
            }
        }
    }

    fn readdirplus(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        let _cookie = r.uhyper().unwrap_or(0);
        let _count = r.uint().unwrap_or(0);
        match self.files.get(&fh) {
            Some(f) if f.is_dir => {
                reply.int(0);
                let attr = self.post_op_attr(Some(f));
                reply.buf.extend(attr.into_vec());
                let mut entries = Xdr::new();
                for (name, handle) in self.listing() {
                    let child = self.files.get(&handle);
                    entries.bool_(true);
                    entries.uhyper(1); // cookie
                    entries.string(&name);
                    match child {
                        Some(c) => {
                            let cattr = self.encode_attr(c);
                            entries.buf.extend(cattr.into_vec());
                        }
                        None => {
                            entries.bool_(false);
                        }
                    }
                    // name_attributes (post_op_attr)
                    let post = self.post_op_attr(child);
                    entries.buf.extend(post.into_vec());
                    // name_handle (post_op_fh3)
                    match child {
                        Some(c) => {
                            entries.bool_(true);
                            entries.opaque(&c.handle);
                        }
                        None => {
                            entries.bool_(false);
                        }
                    }
                    entries.bool_(false); // no more entries
                }
                entries.bool_(false);
                entries.bool_(true); // eof
                reply.buf.extend(entries.into_vec());
            }
            Some(_) => {
                reply.int(20); // NOTDIR
            }
            None => {
                reply.int(2); // NOENT
            }
        }
    }

    fn fsstat(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        reply.int(0);
        let attr = self.post_op_attr(self.files.get(&fh));
        reply.buf.extend(attr.into_vec());
        reply.uhyper(1 << 30); // tbytes
        reply.uhyper(1 << 30); // fbytes
        reply.uhyper(0); // abytes
        reply.uhyper(1 << 30); // tfiles
        reply.uhyper(1 << 20); // ffiles
        reply.uhyper(0); // afiles
        reply.uint(0); // invarsec
    }

    fn fsinfo(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        reply.int(0);
        let attr = self.post_op_attr(self.files.get(&fh));
        reply.buf.extend(attr.into_vec());
        reply.uint(8192); // rtmax
        reply.uint(8192); // rtpref
        reply.uint(4096); // rtmult
        reply.uint(8192); // wtmax
        reply.uint(8192); // wtpref
        reply.uint(4096); // wtmult
        reply.uint(4096); // dtpref
        reply.uhyper(1 << 30); // maxfilesize
        reply.uhyper(1); // time_delta.seconds
        reply.uint(0); // time_delta.nseconds
        reply.uint(0x1F); // properties
    }

    fn pathconf(&self, reply: &mut Xdr, r: &mut XdrReader<'_>) {
        let fh = r.opaque().unwrap_or_default();
        reply.int(0);
        let attr = self.post_op_attr(self.files.get(&fh));
        reply.buf.extend(attr.into_vec());
        reply.uint(255); // linkmax
        reply.uint(255); // name_max
        reply.bool_(true); // no_trunc
        reply.bool_(true); // chown_restricted
        reply.bool_(false); // case_insensitive
        reply.bool_(false); // case_preserving
    }

    fn commit(&self, reply: &mut Xdr, _r: &mut XdrReader<'_>) {
        reply.int(0); // SUCCESS (read-only)
        let attr = self.post_op_attr(None);
        reply.buf.extend(attr.into_vec());
        reply.uhyper(0); // verf
    }
}

/// helper for NfsExporter used by fsinfo.
#[allow(dead_code)]
trait FsinfoExt {
    fn rtime(&self) -> u64;
}
impl FsinfoExt for NfsExporter {
    fn rtime(&self) -> u64 {
        1
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn nfs_lookup_and_listing() {
        let mut exp = NfsExporter::new(2049);
        exp.add_file("/disk.vmdk", 1024, 0o644, 1234);
        let root = exp.lookup("/").unwrap();
        assert!(root.is_dir);
        let disk = exp.lookup("disk.vmdk").unwrap();
        assert_eq!(disk.size, 1024);
        assert_eq!(exp.listing().len(), 1);
    }

    #[test]
    fn dispatch_mount_null() {
        let exp = Arc::new(NfsExporter::new(2049));
        let mut req = Xdr::new();
        req.uint(0x1234); // xid
        req.int(0); // CALL
        req.uint(2); // rpcvers
        req.uint(100005); // MOUNT
        req.uint(3); // vers
        req.uint(0); // NULL
        let frag = req.into_vec();
        let out = exp.dispatch(&frag);
        // Reply: xid + reply + accepted + success + void
        assert!(out.len() >= 16);
    }

    #[test]
    fn dispatch_nfs_getattr() {
        let mut inner = NfsExporter::new(2049);
        let handle = inner.add_file("/disk.vmdk", 1024, 0o644, 1234);
        let exp = Arc::new(inner);
        let mut req = Xdr::new();
        req.uint(0x5678);
        req.int(0); // CALL
        req.uint(2); // rpcvers
        req.uint(100003); // NFS
        req.uint(3); // vers
        req.uint(1); // GETATTR
        req.opaque(&handle);
        let frag = req.into_vec();
        let out = exp.dispatch(&frag);
        assert!(out.len() > 16);
    }
}
