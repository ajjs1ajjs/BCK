use anyhow::{Result, bail};
use std::net::SocketAddr;
use std::sync::Arc;
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::{TcpListener, TcpStream};
use tracing::{info, warn};

/// iSCSI target (RFC 3720) that presents a backup VM disk as a block device.
///
/// Implements: Login (SecurityNegotiation -> FullFeaturePhase), Text
/// negotiation, NOP-Out, Logout, and a minimal SCSI command set (INQUIRY,
/// TEST UNIT READY, READ CAPACITY (10/16), READ (10/16), MODE SENSE).
/// Reads are serviced lazily from the backup block store.
///
/// The target is read-only — suitable for booting a restored VM via Instant
/// Recovery while migration runs in the background.

// PDU opcodes
const OP_NOP_OUT: u8 = 0x00;
const OP_SCSI_CMD: u8 = 0x01;
const OP_LOGIN_REQ: u8 = 0x03;
const OP_TEXT_REQ: u8 = 0x04;
const OP_LOGOUT_REQ: u8 = 0x06;
const OP_NOP_IN: u8 = 0x20;
const OP_SCSI_RESP: u8 = 0x21;
const OP_LOGIN_RESP: u8 = 0x23;
const OP_TEXT_RESP: u8 = 0x24;
const OP_DATA_IN: u8 = 0x25;
const OP_LOGOUT_RESP: u8 = 0x26;

const SCSI_INQUIRY: u8 = 0x12;
const SCSI_READ_CAP10: u8 = 0x25;
const SCSI_READ_10: u8 = 0x28;
const SCSI_TEST_UNIT_READY: u8 = 0x00;
const SCSI_MODE_SENSE6: u8 = 0x1A;
const SCSI_READ_CAP16: u8 = 0x9E;
const SCSI_READ_16: u8 = 0x88;

/// An iSCSI target exposing a single LUN backed by a callable block reader.
pub struct IscsiTarget {
    /// Full target IQN, e.g. "iqn.2026-01.bck:recovery-session".
    pub target_iqn: String,
    /// Vendor/Product strings returned by INQUIRY.
    pub vendor_id: String,
    pub product_id: String,
    /// Block size in bytes (usually 512).
    pub block_size: u32,
    /// Number of logical blocks.
    pub num_blocks: u64,
    /// Reads a block range [offset, offset+len) from the backup disk.
    read_fn: Arc<dyn Fn(u64, u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>>> + Send>> + Send + Sync>,
}

impl IscsiTarget {
    pub fn new(target_iqn: &str, vendor_id: &str, product_id: &str, total_bytes: u64, block_size: u32) -> Self {
        Self {
            target_iqn: target_iqn.to_string(),
            vendor_id: vendor_id.to_string(),
            product_id: product_id.to_string(),
            block_size: block_size.max(1),
            num_blocks: total_bytes.div_ceil(block_size.max(1) as u64),
            read_fn: Arc::new(|_, _| Box::pin(async { Ok(vec![]) })),
        }
    }

    /// Attach a reader used to fetch disk bytes from the backup store.
    pub fn with_reader<F>(mut self, f: F) -> Self
    where
        F: Fn(u64, u32) -> std::pin::Pin<Box<dyn std::future::Future<Output = Result<Vec<u8>>> + Send>>
            + Send
            + Sync
            + 'static,
    {
        self.read_fn = Arc::new(f);
        self
    }

    /// Start serving on the given TCP address.
    pub async fn serve(self: Arc<Self>, addr: SocketAddr) -> Result<()> {
        let listener = TcpListener::bind(addr).await?;
        info!("iSCSI target {} listening on {}", self.target_iqn, addr);
        loop {
            let (stream, peer) = listener.accept().await?;
            let this = self.clone();
            tokio::spawn(async move {
                if let Err(e) = this.handle_conn(stream).await {
                    warn!("iSCSI conn {} ended: {}", peer, e);
                }
            });
        }
    }

    async fn handle_conn(self: Arc<Self>, mut stream: TcpStream) -> Result<()> {
        let mut buf = Vec::with_capacity(64 * 1024);
        loop {
            let mut header = [0u8; 48];
            if stream.read_exact(&mut header).await.is_err() {
                return Ok(());
            }
            let opcode = header[0] & 0x3F;
            let dsl = (header[4] as usize) << 16 | (header[5] as usize) << 8 | header[6] as usize;
            if dsl > 16 * 1024 * 1024 {
                bail!("iSCSI data segment too large: {}", dsl);
            }
            buf.resize(dsl, 0);
            if dsl > 0 {
                stream.read_exact(&mut buf).await?;
            }

            let pdu = Pdu { header, data: buf.clone() };
            match opcode {
                OP_LOGIN_REQ => {
                    let resp = self.handle_login(&pdu);
                    stream.write_all(&resp.to_bytes()).await?;
                }
                OP_TEXT_REQ => {
                    let resp = self.handle_text(&pdu);
                    stream.write_all(&resp.to_bytes()).await?;
                }
                OP_NOP_OUT => {
                    let resp = self.handle_nop(&pdu);
                    stream.write_all(&resp.to_bytes()).await?;
                }
                OP_LOGOUT_REQ => {
                    let resp = self.handle_logout(&pdu);
                    stream.write_all(&resp.to_bytes()).await?;
                }
                OP_SCSI_CMD => {
                    let responses = self.handle_scsi(&pdu).await;
                    for r in responses {
                        stream.write_all(&r.to_bytes()).await?;
                    }
                }
                other => {
                    warn!("iSCSI unsupported opcode 0x{:02x}", other);
                    return Ok(());
                }
            }
        }
    }

    fn handle_login(&self, pdu: &Pdu) -> Pdu {
        // Parse initiator name from text params.
        let itt = pdu.itt();
        let cid = pdu.bytes(10, 12);
        let (_csg, _nsg) = ((pdu.header[1] >> 2) & 0x3, (pdu.header[1] >> 6) & 0x3);
        let text = String::from_utf8_lossy(&pdu.data).to_string();

        let mut resp = Pdu::new(OP_LOGIN_RESP);
        resp.header[1] = 0x80 | (1 << 2) | (1 << 6); // T=1, CSG=1 (FullFeature), NSG=0
        resp.set_itt(itt);
        resp.set_cid(cid);
        resp.header[2] = 0; // Status-Class: Success
        resp.header[3] = 0; // Status-Detail

        // Build response text: TargetName, TargetPortalGroupTag, MaxRecvDataSegmentLength, DataPDUInOrder etc.
        let mut params = String::new();
        params.push_str("TargetName=");
        params.push_str(&self.target_iqn);
        params.push_str("\x00");
        params.push_str("TargetPortalGroupTag=1\x00");
        params.push_str("MaxRecvDataSegmentLength=262144\x00");
        params.push_str("MaxBurstLength=262144\x00");
        params.push_str("FirstBurstLength=65536\x00");
        params.push_str("ImmediateData=Yes\x00");
        params.push_str("InitialR2T=No\x00");
        params.push_str("DataPDUInOrder=Yes\x00");
        params.push_str("DataSequenceInOrder=Yes\x00");
        params.push_str("ErrorRecoveryLevel=0\x00");
        resp.data = params.into_bytes();
        resp.set_dsl(resp.data.len() as u32);
        // The trailing null terminator is required by the spec; append if missing.
        if !resp.data.ends_with(&[0]) {
            resp.data.push(0);
            resp.set_dsl(resp.data.len() as u32);
        }
        info!("iSCSI login: cid={} text_len={}", cid, text.len());
        resp
    }

    fn handle_text(&self, pdu: &Pdu) -> Pdu {
        let mut resp = Pdu::new(OP_TEXT_RESP);
        resp.header[1] = 0x80; // Final = 1
        resp.set_itt(pdu.itt());
        resp.data = "TargetPortalGroupTag=1\x00MaxRecvDataSegmentLength=262144\x00".as_bytes().to_vec();
        resp.set_dsl(resp.data.len() as u32);
        resp
    }

    fn handle_nop(&self, pdu: &Pdu) -> Pdu {
        let mut resp = Pdu::new(OP_NOP_IN);
        resp.header[1] = 0x80;
        resp.set_itt(pdu.itt());
        resp.data = pdu.data.clone();
        resp.set_dsl(resp.data.len() as u32);
        resp
    }

    fn handle_logout(&self, pdu: &Pdu) -> Pdu {
        let mut resp = Pdu::new(OP_LOGOUT_RESP);
        resp.header[1] = 0x80; // Final
        resp.set_itt(pdu.itt());
        resp.header[2] = 0; // Response: Closed successfully
        resp.data = [0u8; 4].to_vec(); // Time2Wait, Time2Retain (2 bytes each)
        resp.set_dsl(4);
        resp
    }

    /// Handle a SCSI command. Returns one or more PDUs (Data-In + Response).
    async fn handle_scsi(&self, pdu: &Pdu) -> Vec<Pdu> {
        let itt = pdu.itt();
        // CDB length = 16 for standard commands; read bytes 20..23 as expected
        // transfer length is not needed for our read-only subset.
        let cdb_len = 16usize;
        let cdb: &[u8] = &pdu.data[..cdb_len.min(pdu.data.len())];
        if cdb.is_empty() {
            return vec![self.scsi_response(itt, 0x02, 0x05)]; // CHECK CONDITION, ILLEGAL REQUEST
        }

        let opcode = cdb[0];
        let mut out = Vec::new();
        match opcode {
            SCSI_INQUIRY => {
                let allocation = u16::from_be_bytes([cdb[3], cdb[4]]) as usize;
                let mut data = vec![0u8; 96];
                data[0] = 0x00; // Direct-access block device
                data[1] = 0x00; // not removable
                data[2] = 0x05; // SPC-3
                data[3] = 0x02; // response data format
                data[4] = 31; // additional length
                let vendor: Vec<u8> = self.vendor_id.as_bytes().iter().take(8).cloned().collect();
                let product: Vec<u8> = self.product_id.as_bytes().iter().take(16).cloned().collect();
                let rev: Vec<u8> = b"0001".to_vec();
                for (i, b) in vendor.into_iter().enumerate() {
                    data[8 + i] = b;
                }
                for (i, b) in product.into_iter().enumerate() {
                    data[16 + i] = b;
                }
                for (i, b) in rev.iter().take(4).enumerate() {
                    data[32 + i] = *b;
                }
                data.truncate(allocation.max(96));
                out.push(self.data_in(itt, &data, 0, true));
                out.push(self.scsi_response(itt, 0x00, 0x00));
            }
            SCSI_TEST_UNIT_READY => {
                out.push(self.scsi_response(itt, 0x00, 0x00));
            }
            SCSI_MODE_SENSE6 => {
                // Return mode parameter header (block descriptor for 512-byte blocks)
                let mut data = vec![0u8; 8];
                data[0] = 0; // mode data length
                data[2] = 0; // medium type
                data[3] = 0; // device-specific
                data[4] = 0; // block descriptor length
                out.push(self.data_in(itt, &data, 0, true));
                out.push(self.scsi_response(itt, 0x00, 0x00));
            }
            SCSI_READ_CAP10 => {
                let last = (self.num_blocks - 1).min(0xFFFF_FFFF) as u32;
                let mut data = Vec::with_capacity(8);
                data.extend_from_slice(&last.to_be_bytes());
                data.extend_from_slice(&self.block_size.to_be_bytes());
                out.push(self.data_in(itt, &data, 0, true));
                out.push(self.scsi_response(itt, 0x00, 0x00));
            }
            SCSI_READ_CAP16 => {
                let mut data = Vec::with_capacity(32);
                data.extend_from_slice(&(self.num_blocks - 1).to_be_bytes());
                data.extend_from_slice(&self.block_size.to_be_bytes());
                data.extend_from_slice(&[0u8; 20]);
                out.push(self.data_in(itt, &data, 0, true));
                out.push(self.scsi_response(itt, 0x00, 0x00));
            }
            SCSI_READ_10 => {
                let lba = u32::from_be_bytes([cdb[2], cdb[3], cdb[4], cdb[5]]);
                let blocks = u16::from_be_bytes([cdb[7], cdb[8]]) as u32;
                out.extend(self.read_blocks(itt, lba as u64, blocks).await);
            }
            SCSI_READ_16 => {
                let lba = u64::from_be_bytes([
                    cdb[2], cdb[3], cdb[4], cdb[5], cdb[6], cdb[7], cdb[8], cdb[9],
                ]);
                let blocks = u32::from_be_bytes([cdb[10], cdb[11], cdb[12], cdb[13]]);
                out.extend(self.read_blocks(itt, lba, blocks).await);
            }
            _ => {
                warn!("iSCSI unsupported CDB opcode 0x{:02x}", opcode);
                out.push(self.scsi_response(itt, 0x02, 0x05)); // CHECK CONDITION / ILLEGAL REQUEST
            }
        }
        out
    }

    async fn read_blocks(&self, itt: u32, lba: u64, blocks: u32) -> Vec<Pdu> {
        if blocks == 0 {
            return vec![self.scsi_response(itt, 0x00, 0x00)];
        }
        let len = (blocks as u64) * (self.block_size as u64);
        if len > u32::MAX as u64 {
            warn!("iSCSI read too large: {} blocks", blocks);
            return vec![self.scsi_response(itt, 0x02, 0x05)];
        }
        let offset = lba * (self.block_size as u64);
        let result = (self.read_fn)(offset, len as u32).await;
        match result {
            Ok(data) => {
                let mut out = Vec::new();
                out.push(self.data_in(itt, &data, 0, true));
                out.push(self.scsi_response(itt, 0x00, 0x00));
                out
            }
            Err(e) => {
                warn!("iSCSI read error @{}: {}", offset, e);
                vec![self.scsi_response(itt, 0x02, 0x08)] // CHECK CONDITION / ABORTED COMMAND
            }
        }
    }

    fn data_in(&self, itt: u32, data: &[u8], _residual: u32, last: bool) -> Pdu {
        let mut p = Pdu::new(OP_DATA_IN);
        p.header[1] = 0x80 | if last { 0x02 } else { 0 }; // F=1, S=1
        p.set_itt(itt);
        p.data = data.to_vec();
        p.set_dsl(data.len() as u32);
        p
    }

    fn scsi_response(&self, itt: u32, status: u8, sense_key: u8) -> Pdu {
        let mut p = Pdu::new(OP_SCSI_RESP);
        p.header[1] = 0x80; // F=1
        p.set_itt(itt);
        p.header[2] = status; // SCSI status (0x00 Good, 0x02 Check Condition)
        let mut sense = vec![0u8; 18];
        if status == 0x02 {
            sense[0] = 0x70;
            sense[2] = sense_key;
            sense[7] = 0x0A; // additional sense length
            sense[12] = 0x00; // additional sense code
            sense[13] = 0x00; // additional sense code qualifier
        }
        p.set_sense(&sense);
        p
    }
}

/// Minimal iSCSI PDU builder.
struct Pdu {
    header: [u8; 48],
    data: Vec<u8>,
}

impl Pdu {
    fn new(opcode: u8) -> Self {
        let mut header = [0u8; 48];
        header[0] = opcode | 0x40; // I bit (initiator-to-target direction bit 1)
        Self { header, data: Vec::new() }
    }

    fn bytes(&self, start: usize, end: usize) -> u16 {
        let b = &self.header[start.min(48)..end.min(48)];
        let mut v = 0u16;
        for x in b {
            v = (v << 8) | (*x as u16);
        }
        v
    }

    fn itt(&self) -> u32 {
        u32::from_be_bytes([self.header[12], self.header[13], self.header[14], self.header[15]])
    }

    fn set_itt(&mut self, itt: u32) {
        self.header[12..16].copy_from_slice(&itt.to_be_bytes());
    }

    fn set_cid(&mut self, cid: u16) {
        self.header[10..12].copy_from_slice(&cid.to_be_bytes());
    }

    fn set_dsl(&mut self, len: u32) {
        self.header[4] = ((len >> 16) & 0xFF) as u8;
        self.header[5] = ((len >> 8) & 0xFF) as u8;
        self.header[6] = (len & 0xFF) as u8;
    }

    fn set_sense(&mut self, sense: &[u8]) {
        self.data = sense.to_vec();
        self.set_dsl(sense.len() as u32);
    }

    fn to_bytes(self) -> Vec<u8> {
        let mut out = Vec::with_capacity(48 + self.data.len());
        out.extend_from_slice(&self.header);
        out.extend_from_slice(&self.data);
        // pad data segment to 4 bytes
        let pad = (4 - (self.data.len() % 4)) % 4;
        out.extend_from_slice(&[0u8; 4][..pad]);
        out
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn login_response() {
        let tgt = IscsiTarget::new("iqn.2026-01.bck:test", "BCK", "InstantDisk", 1024 * 1024, 512);
        let mut req = Pdu::new(OP_LOGIN_REQ);
        req.set_itt(0xDEADBEEF);
        req.set_cid(1);
        req.header[1] = (1 << 2) | (0 << 6); // CSG=1, NSG=0, T bit in data
        req.data = b"InitiatorName=iqn.1993-08.org.debian:01:test\x00".to_vec();
        req.set_dsl(req.data.len() as u32);
        let resp = tgt.handle_login(&req);
        assert_eq!(resp.header[0] & 0x3F, OP_LOGIN_RESP);
        assert_eq!(resp.itt(), 0xDEADBEEF);
        assert_eq!(resp.header[2], 0); // success
        assert!(String::from_utf8_lossy(&resp.data).contains("TargetName=iqn.2026-01.bck:test"));
    }

    #[test]
    fn scsi_inquiry() {
        let tgt = Arc::new(IscsiTarget::new("iqn.2026-01.bck:test", "BCK", "InstantDisk", 1024 * 1024, 512));
        let mut req = Pdu::new(OP_SCSI_CMD);
        req.set_itt(1);
        let mut cdb = vec![0u8; 16];
        cdb[0] = SCSI_INQUIRY;
        cdb[3] = 0;
        cdb[4] = 96;
        req.data = cdb;
        req.set_dsl(16);
        let rt = tokio::runtime::Runtime::new().unwrap();
        let pdus = rt.block_on(tgt.handle_scsi(&req));
        assert_eq!(pdus.len(), 2);
        assert_eq!(pdus[0].header[0] & 0x3F, OP_DATA_IN);
        assert_eq!(pdus[0].data[0], 0x00); // direct-access
        assert_eq!(pdus[1].header[2], 0x00); // good status
    }

    #[test]
    fn scsi_read_capacity() {
        let tgt = Arc::new(IscsiTarget::new("iqn.2026-01.bck:test", "BCK", "InstantDisk", 2 * 1024 * 1024, 512));
        let mut req = Pdu::new(OP_SCSI_CMD);
        req.set_itt(2);
        let mut cdb = vec![0u8; 16];
        cdb[0] = SCSI_READ_CAP10;
        req.data = cdb;
        req.set_dsl(16);
        let rt = tokio::runtime::Runtime::new().unwrap();
        let pdus = rt.block_on(tgt.handle_scsi(&req));
        assert_eq!(pdus[0].data.len(), 8);
        let last_lba = u32::from_be_bytes(pdus[0].data[0..4].try_into().unwrap());
        assert_eq!(last_lba as u64, (2 * 1024 * 1024 / 512) - 1);
    }

    #[test]
    fn scsi_read_10_with_reader() {
        let block: Arc<Vec<u8>> = Arc::new(vec![0xAA; 512]);
        let block2 = block.clone();
        let tgt = Arc::new(
            IscsiTarget::new("iqn.2026-01.bck:test", "BCK", "InstantDisk", 512, 512)
                .with_reader(move |_off, _len| {
                    let b = block2.clone();
                    Box::pin(async move { Ok(b.to_vec()) })
                }),
        );
        let mut req = Pdu::new(OP_SCSI_CMD);
        req.set_itt(3);
        let mut cdb = vec![0u8; 16];
        cdb[0] = SCSI_READ_10;
        cdb[2] = 0; // LBA high
        cdb[3] = 0;
        cdb[4] = 0;
        cdb[5] = 0;
        cdb[7] = 0;
        cdb[8] = 1; // 1 block
        req.data = cdb;
        req.set_dsl(16);
        let rt = tokio::runtime::Runtime::new().unwrap();
        let pdus = rt.block_on(tgt.handle_scsi(&req));
        assert_eq!(pdus.len(), 2);
        assert_eq!(pdus[0].data.len(), 512);
        assert_eq!(pdus[0].data[0], 0xAA);
        assert_eq!(pdus[1].header[2], 0x00);
    }
}
