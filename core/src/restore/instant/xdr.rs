//! XDR (RFC 4506) encoding/decoding helpers used by the NFSv3 instant
//! recovery server.

use anyhow::{anyhow, Result};

/// Incremental XDR encoder.
#[derive(Debug, Default, Clone)]
pub struct Xdr {
    pub buf: Vec<u8>,
}

impl Xdr {
    pub fn new() -> Self {
        Self {
            buf: Vec::with_capacity(64),
        }
    }

    pub fn into_vec(self) -> Vec<u8> {
        self.buf
    }

    pub fn uint(&mut self, v: u32) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn int(&mut self, v: i32) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn uhyper(&mut self, v: u64) {
        self.buf.extend_from_slice(&v.to_be_bytes());
    }

    pub fn bool_(&mut self, v: bool) {
        self.uint(v as u32);
    }

    /// XDR void: encodes as zero bytes.
    pub fn void(&mut self) {}

    pub fn opaque(&mut self, data: &[u8]) {
        self.uint(data.len() as u32);
        self.buf.extend_from_slice(data);
        let pad = (4 - (data.len() % 4)) % 4;
        self.buf.extend(std::iter::repeat(0).take(pad));
    }

    pub fn string(&mut self, s: &str) {
        self.opaque(s.as_bytes());
    }
}

/// Incremental XDR decoder over a byte slice.
#[derive(Debug)]
pub struct XdrReader<'a> {
    data: &'a [u8],
    pos: usize,
}

impl<'a> XdrReader<'a> {
    pub fn new(data: &'a [u8]) -> Self {
        Self { data, pos: 0 }
    }

    fn need(&self, n: usize) -> Result<()> {
        if self.data.len().saturating_sub(self.pos) >= n {
            Ok(())
        } else {
            Err(anyhow!("xdr: unexpected end of data"))
        }
    }

    pub fn uint(&mut self) -> Result<u32> {
        self.need(4)?;
        let v = u32::from_be_bytes([
            self.data[self.pos],
            self.data[self.pos + 1],
            self.data[self.pos + 2],
            self.data[self.pos + 3],
        ]);
        self.pos += 4;
        Ok(v)
    }

    pub fn uhyper(&mut self) -> Result<u64> {
        self.need(8)?;
        let mut b = [0u8; 8];
        b.copy_from_slice(&self.data[self.pos..self.pos + 8]);
        self.pos += 8;
        Ok(u64::from_be_bytes(b))
    }

    pub fn opaque(&mut self) -> Result<Vec<u8>> {
        let len = self.uint()? as usize;
        self.need(len)?;
        let out = self.data[self.pos..self.pos + len].to_vec();
        self.pos += len;
        let pad = (4 - (len % 4)) % 4;
        if pad > 0 {
            self.need(pad)?;
            self.pos += pad;
        }
        Ok(out)
    }

    pub fn string(&mut self) -> Result<String> {
        let raw = self.opaque()?;
        String::from_utf8(raw).map_err(|_| anyhow!("xdr: invalid utf8 string"))
    }
}

/// Write a complete RPC record (record marking + payload) for an ONC-RPC/NFS
/// reply stream.
pub fn write_rpc_record(out: &mut Vec<u8>, payload: &[u8]) -> Result<()> {
    let len = payload.len();
    if len > 0x7FFF_FFFF {
        return Err(anyhow!("xdr: RPC record too large"));
    }
    out.extend_from_slice(&((len as u32) | 0x8000_0000).to_be_bytes());
    out.extend_from_slice(payload);
    Ok(())
}

/// Build an ONC-RPC reply header (MSG_ACCEPTED). `accept_status` is the
/// accept_stat field (0 = SUCCESS).
pub fn rpc_reply_header(xid: u32, accept_status: u32) -> Xdr {
    let mut x = Xdr::new();
    x.uint(xid);           // xid
    x.uint(1);             // msg_type = REPLY
    x.uint(0);             // reply_stat = MSG_ACCEPTED
    x.uint(0);             // verf flavor = AUTH_NONE
    x.uint(0);             // verf length
    x.uint(accept_status); // accept_stat
    x
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn xdr_uint_roundtrip() {
        let mut x = Xdr::new();
        x.uint(0xDEADBEEF);
        let buf = x.into_vec();
        let mut r = XdrReader::new(&buf);
        assert_eq!(r.uint().unwrap(), 0xDEADBEEF);
        assert!(r.uint().is_err());
    }

    #[test]
    fn xdr_uhyper_roundtrip() {
        let mut x = Xdr::new();
        x.uhyper(1 << 40);
        let buf = x.into_vec();
        let mut r = XdrReader::new(&buf);
        assert_eq!(r.uhyper().unwrap(), 1 << 40);
    }

    #[test]
    fn xdr_string_opaque_roundtrip() {
        let mut x = Xdr::new();
        x.string("hello");
        x.opaque(&[0x42, 0x43, 0x4B]);
        let buf = x.into_vec();
        let mut r = XdrReader::new(&buf);
        assert_eq!(r.string().unwrap(), "hello");
        assert_eq!(r.opaque().unwrap(), vec![0x42, 0x43, 0x4B]);
        assert!(r.string().is_err());
    }

    #[test]
    fn rpc_reply_header_format() {
        let hdr = rpc_reply_header(0x1234, 0).into_vec();
        assert_eq!(hdr.len(), 24);
        let buf = hdr;
        let mut r = XdrReader::new(&buf);
        assert_eq!(r.uint().unwrap(), 0x1234); // xid
        assert_eq!(r.uint().unwrap(), 1); // REPLY
        assert_eq!(r.uint().unwrap(), 0); // MSG_ACCEPTED
        assert_eq!(r.uint().unwrap(), 0); // AUTH_NONE
        assert_eq!(r.uint().unwrap(), 0); // verf length
        assert_eq!(r.uint().unwrap(), 0); // accept_stat
    }

    #[test]
    fn write_rpc_record_marks_last_fragment() {
        let mut out = Vec::new();
        write_rpc_record(&mut out, &[1, 2, 3]).unwrap();
        assert_eq!(out.len(), 7);
        assert_eq!(&out[..4], &[0x80, 0x00, 0x00, 0x03]);
        assert_eq!(&out[4..], &[1, 2, 3]);
    }
}
