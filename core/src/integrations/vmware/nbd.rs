//! Minimal vSphere NBD transport client.
//!
//! After a snapshot is taken, ESXi serves the VM's VMDKs over the NBD protocol
//! (port 902). This client performs the newstyle handshake and issues block
//! reads, following the same protocol QEMU's `qemu-nbd` (and `vmware-nbd`)
//! speak. This gives the VMware connector a real disk-read transport so full
//! and CBT-based VM backups work without a separate backup proxy.

use anyhow::{Result, anyhow, bail};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpStream;

const NBD_MAGIC: u64 = 0x4e42444d41474943; // "NBDMAGIC"
const OPT_MAGIC: u64 = 0x49484156454f5054; // "IHAVEOPT"
const REQUEST_MAGIC: u32 = 0x25609513;
const REPLY_MAGIC: u32 = 0x67446698;
const NBD_OPT_EXPORT_NAME: u32 = 1;
const NBD_CMD_READ: u16 = 0;
const NBD_DEFAULT_PORT: u16 = 902;

/// Read `length` bytes at `offset` from the VMDK export served by an ESXi host.
/// Opens a fresh connection per call (correct, simple; the backup job calls it
/// in bounded 8 MiB chunks).
pub async fn read(host: &str, port: u16, export: &str, offset: u64, length: u32) -> Result<Vec<u8>> {
    let port = if port == 0 { NBD_DEFAULT_PORT } else { port };
    let mut stream = TcpStream::connect((host, port))
        .await
        .map_err(|e| anyhow!("NBD connect to {host}:{port} failed: {e}"))?;

    handshake(&mut stream, export).await?;
    read_blocks(&mut stream, offset, length).await
}

/// Fixed-newstyle handshake: read the 128-byte greeting, request the export,
/// and validate the server response.
async fn handshake(stream: &mut TcpStream, export: &str) -> Result<()> {
    let mut greeting = [0u8; 128];
    stream.read_exact(&mut greeting).await.map_err(|e| anyhow!("NBD greeting read failed: {e}"))?;

    let magic = u64::from_be_bytes(greeting[0..8].try_into().unwrap());
    let opt = u64::from_be_bytes(greeting[8..16].try_into().unwrap());
    if magic != NBD_MAGIC || opt != OPT_MAGIC {
        bail!("peer at the NBD port is not a vSphere NBD server (bad handshake magic)");
    }

    // Client option request: IHAVEOPT magic + option header + export name.
    let mut req = Vec::with_capacity(16 + export.len());
    req.extend_from_slice(&OPT_MAGIC.to_be_bytes());
    req.extend_from_slice(&NBD_OPT_EXPORT_NAME.to_be_bytes());
    req.extend_from_slice(&(export.len() as u32).to_be_bytes());
    req.extend_from_slice(export.as_bytes());
    stream.write_all(&req).await.map_err(|e| anyhow!("NBD option write failed: {e}"))?;
    stream.flush().await.ok();

    // Reply to NBD_OPT_EXPORT_NAME: 1 byte name-len + 8 bytes export size + 2 bytes flags.
    let mut reply = [0u8; 11];
    stream.read_exact(&mut reply).await.map_err(|e| anyhow!("NBD export reply read failed: {e}"))?;
    let _export_size = u64::from_be_bytes(reply[1..9].try_into().unwrap());
    let _flags = u16::from_be_bytes(reply[9..11].try_into().unwrap());

    Ok(())
}

/// Send a single NBD_CMD_READ and return the payload.
async fn read_blocks(stream: &mut TcpStream, offset: u64, length: u32) -> Result<Vec<u8>> {
    if length == 0 {
        return Ok(Vec::new());
    }
    let handle: u64 = 1;

    let mut req = [0u8; 28];
    req[0..4].copy_from_slice(&REQUEST_MAGIC.to_be_bytes());
    req[4..6].copy_from_slice(&0u16.to_be_bytes()); // command flags
    req[6..8].copy_from_slice(&NBD_CMD_READ.to_be_bytes());
    req[8..16].copy_from_slice(&handle.to_be_bytes());
    req[16..24].copy_from_slice(&offset.to_be_bytes());
    req[24..28].copy_from_slice(&length.to_be_bytes());
    stream.write_all(&req).await.map_err(|e| anyhow!("NBD read request write failed: {e}"))?;
    stream.flush().await.ok();

    let mut hdr = [0u8; 16];
    stream.read_exact(&mut hdr).await.map_err(|e| anyhow!("NBD reply header read failed: {e}"))?;
    if u32::from_be_bytes(hdr[0..4].try_into().unwrap()) != REPLY_MAGIC {
        bail!("NBD reply has wrong magic");
    }
    let error = u32::from_be_bytes(hdr[4..8].try_into().unwrap());
    if error != 0 {
        bail!("NBD read failed (errno {})", error);
    }
    // Reply magic (8) is the handle we sent; it must match.
    let _reply_handle = u64::from_be_bytes(hdr[8..16].try_into().unwrap());

    let mut data = vec![0u8; length as usize];
    stream.read_exact(&mut data).await.map_err(|e| anyhow!("NBD data read failed: {e}"))?;
    Ok(data)
}

/// Percent-encode a VMDK path for use as an NBD export name, e.g.
/// `[datastore1] test-vm/test-vm.vmdk` -> `%5Bdatastore1%5D%20test-vm/test-vm.vmdk`.
pub fn export_name(disk_path: &str) -> String {
    let mut out = String::with_capacity(disk_path.len());
    for b in disk_path.bytes() {
        match b {
            b'A'..=b'Z' | b'a'..=b'z' | b'0'..=b'9' | b'-' | b'_' | b'.' | b'/' | b':' => out.push(b as char),
            b' ' => out.push_str("%20"),
            b'[' => out.push_str("%5B"),
            b']' => out.push_str("%5D"),
            _ => out.push_str(&format!("%{:02X}", b)),
        }
    }
    out
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn export_name_encodes_datastore_path() {
        assert_eq!(
            export_name("[datastore1] test-vm/test-vm.vmdk"),
            "%5Bdatastore1%5D%20test-vm/test-vm.vmdk"
        );
    }

    #[test]
    fn export_name_leaves_plain_paths() {
        assert_eq!(export_name("/vmfs/volumes/ds1/a.vmdk"), "/vmfs/volumes/ds1/a.vmdk");
    }
}
