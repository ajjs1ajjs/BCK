use anyhow::{Result, anyhow};
use async_trait::async_trait;
use base64::Engine;
use reqwest::Client;
use serde::{Deserialize, Serialize};
use std::sync::Mutex;

use crate::integrations::{
    ChangedBlock, HypervisorConnector, PowerState,
    VmDiskInfo, VmInfo, VmNetworkInfo, VmSnapshot,
};

pub struct VSphereConnector {
    host: String,
    port: u16,
    username: String,
    password: String,
    client: Client,
    session_id: Mutex<Option<String>>,
    ignore_ssl: bool,
}

impl VSphereConnector {
    pub fn new(host: &str, port: u16, username: &str, password: &str, ignore_ssl: bool) -> Self {
        let client = Client::builder()
            .danger_accept_invalid_certs(ignore_ssl)
            .build()
            .unwrap_or_default();

        Self {
            host: host.to_string(),
            port,
            username: username.to_string(),
            password: password.to_string(),
            client,
            session_id: Mutex::new(None),
            ignore_ssl,
        }
    }

    fn base_url(&self) -> String {
        format!("https://{}:{}", self.host, self.port)
    }

    fn api_url(&self, path: &str) -> String {
        format!("{}/api{}", self.base_url(), path)
    }

    async fn ensure_session(&self) -> Result<()> {
        {
            let sid = self.session_id.lock().unwrap();
            if sid.is_some() {
                return Ok(());
            }
        }

        let auth = base64::engine::general_purpose::STANDARD
            .encode(format!("{}:{}", self.username, self.password));

        let resp = self.client
            .post(self.api_url("/session"))
            .header("Authorization", format!("Basic {}", auth))
            .header("Content-Type", "application/json")
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(anyhow!("vSphere login failed: {}", resp.status()));
        }

        let session: String = resp.json().await?;
        *self.session_id.lock().unwrap() = Some(session);
        Ok(())
    }

    fn auth_header(&self) -> Result<(String, String)> {
        let sid = self.session_id.lock().unwrap();
        match sid.as_ref() {
            Some(s) => Ok(("vmware-api-session-id".into(), s.clone())),
            None => Err(anyhow!("Not authenticated. Call ensure_session first.")),
        }
    }

    async fn get_json<T: serde::de::DeserializeOwned>(&self, path: &str) -> Result<T> {
        let (header, value) = self.auth_header()?;
            let resp = self.client
            .get(self.api_url(path))
            .header(&header, &value)
            .send()
            .await?;

        let status = resp.status();
        if !status.is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("GET {} failed ({}): {}", path, status, text));
        }

        Ok(resp.json().await?)
    }

    async fn post_json<T: serde::de::DeserializeOwned>(
        &self, path: &str, body: &impl Serialize,
    ) -> Result<T> {
        let (header, value) = self.auth_header()?;
        let resp = self.client
            .post(self.api_url(path))
            .header(&header, &value)
            .header("Content-Type", "application/json")
            .json(body)
            .send()
            .await?;

        if !resp.status().is_success() {
            let text = resp.text().await.unwrap_or_default();
            return Err(anyhow!("POST {} failed: {}", path, text));
        }

        Ok(resp.json().await?)
    }

    async fn delete(&self, path: &str) -> Result<()> {
        let (header, value) = self.auth_header()?;
        let resp = self.client
            .delete(self.api_url(path))
            .header(&header, &value)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(anyhow!("DELETE {} failed: {}", path, resp.status()));
        }
        Ok(())
    }
}

#[async_trait]
impl HypervisorConnector for VSphereConnector {
    async fn connect(&self) -> Result<()> {
        self.ensure_session().await
    }

    async fn test_connection(&self) -> Result<()> {
        // Try connecting, then immediately list VMs as a connectivity test
        self.ensure_session().await?;
        let _ = self.get_json::<serde_json::Value>("/vcenter/vm?limit=1").await?;
        Ok(())
    }

    async fn list_vms(&self) -> Result<Vec<VmInfo>> {
        self.ensure_session().await?;

        #[derive(Deserialize)]
        struct VmSummary {
            vm: String,
            name: String,
            power_state: String,
            cpu_count: Option<i32>,
            memory_size_mib: Option<i64>,
            guest_os: Option<String>,
        }

        let vms: Vec<VmSummary> = self.get_json("/vcenter/vm").await?;
        let mut result = Vec::new();

        for vm in vms {
            let power_state = match vm.power_state.as_str() {
                "POWERED_ON" => PowerState::PoweredOn,
                "POWERED_OFF" => PowerState::PoweredOff,
                "SUSPENDED" => PowerState::Suspended,
                _ => PowerState::PoweredOff,
            };

            let disks = self.get_vm_disks(&vm.vm).await.unwrap_or_default();
            let networks = self.get_vm_networks(&vm.vm).await.unwrap_or_default();

            result.push(VmInfo {
                id: vm.vm.clone(),
                name: vm.name,
                hypervisor_id: String::new(),
                mo_ref: vm.vm,
                power_state,
                os: vm.guest_os,
                cpu_count: vm.cpu_count.unwrap_or(0),
                ram_mb: vm.memory_size_mib.unwrap_or(0),
                disks,
                networks,
            });
        }

        Ok(result)
    }

    async fn get_vm(&self, mo_ref: &str) -> Result<VmInfo> {
        self.ensure_session().await?;

        #[derive(Deserialize)]
        struct VmDetail {
            name: String,
            power_state: String,
            cpu_count: Option<i32>,
            memory_size_mib: Option<i64>,
            guest_os: Option<String>,
        }

        let vm: VmDetail = self.get_json(&format!("/vcenter/vm/{}", mo_ref)).await?;

        let power_state = match vm.power_state.as_str() {
            "POWERED_ON" => PowerState::PoweredOn,
            "POWERED_OFF" => PowerState::PoweredOff,
            _ => PowerState::PoweredOff,
        };

        let disks = self.get_vm_disks(mo_ref).await?;
        let networks = self.get_vm_networks(mo_ref).await?;

        Ok(VmInfo {
            id: mo_ref.to_string(),
            name: vm.name,
            hypervisor_id: String::new(),
            mo_ref: mo_ref.to_string(),
            power_state,
            os: vm.guest_os,
            cpu_count: vm.cpu_count.unwrap_or(0),
            ram_mb: vm.memory_size_mib.unwrap_or(0),
            disks,
            networks,
        })
    }

    async fn create_snapshot(
        &self,
        vm_ref: &str,
        name: &str,
        description: &str,
        quiesce: bool,
        memory: bool,
    ) -> Result<VmSnapshot> {
        self.ensure_session().await?;

        #[derive(Serialize)]
        struct SnapshotReq {
            name: String,
            description: String,
            quiesce: bool,
            memory: bool,
        }

        #[derive(Deserialize)]
        struct SnapshotResp {
            snapshot: String,
        }

        let req = SnapshotReq {
            name: name.to_string(),
            description: description.to_string(),
            quiesce,
            memory,
        };

        let resp: SnapshotResp = self.post_json(
            &format!("/vcenter/vm/{}/snapshot", vm_ref),
            &req,
        ).await?;

        Ok(VmSnapshot {
            id: resp.snapshot,
            name: Some(name.to_string()),
            description: Some(description.to_string()),
            created_at: chrono::Utc::now().timestamp(),
            state: PowerState::PoweredOn,
            quiesced: quiesce,
        })
    }

    async fn remove_snapshot(&self, vm_ref: &str, snapshot_id: &str) -> Result<()> {
        self.ensure_session().await?;
        self.delete(&format!(
            "/vcenter/vm/{}/snapshot/{}", vm_ref, snapshot_id
        )).await
    }

    async fn get_changed_blocks(
        &self,
        vm_ref: &str,
        disk_id: &str,
        change_id: &str,
    ) -> Result<Vec<ChangedBlock>> {
        self.ensure_session().await?;
        self.query_changed_disk_areas_soap(vm_ref, disk_id, change_id).await
    }

    async fn get_change_id(&self, vm_ref: &str, disk_id: &str) -> Result<Option<String>> {
        self.ensure_session().await?;

        #[derive(Deserialize)]
        struct DiskDetail {
            backing: Option<DiskBacking>,
        }

        #[derive(Deserialize)]
        struct DiskBacking {
            #[serde(rename = "type")]
            backing_type: Option<String>,
            vmdk_file: Option<String>,
            change_id: Option<String>,
        }

        let disk: DiskDetail = self.get_json(&format!(
            "/vcenter/vm/{}/hardware/disk/{}", vm_ref, disk_id
        )).await?;

        Ok(disk.backing.and_then(|b| b.change_id))
    }

    async fn read_disk_blocks(
        &self,
        _vm_ref: &str,
        disk_path: &str,
        offset: i64,
        length: i64,
    ) -> Result<Vec<u8>> {
        Err(anyhow!(
            "Direct disk block read not supported. Use backup proxy. Disk: {} offset: {} len: {}",
            disk_path, offset, length
        ))
    }
}

// === Private helper methods ===

impl VSphereConnector {
    async fn get_vm_disks(&self, vm_ref: &str) -> Result<Vec<VmDiskInfo>> {
        #[derive(Deserialize)]
        struct DiskEntry {
            disk: String,
            label: String,
            capacity: Option<i64>,
            backing: Option<DiskBacking>,
        }

        #[derive(Deserialize)]
        struct DiskBacking {
            #[serde(rename = "type")]
            backing_type: Option<String>,
            vmdk_file: Option<String>,
            datastore: Option<String>,
            change_id: Option<String>,
        }

        let disks: Vec<DiskEntry> = self.get_json(&format!(
            "/vcenter/vm/{}/hardware/disk", vm_ref
        )).await?;

        let mut result = Vec::new();
        for disk in disks {
            let backing = disk.backing.unwrap_or(DiskBacking {
                backing_type: None,
                vmdk_file: None,
                datastore: None,
                change_id: None,
            });

            result.push(VmDiskInfo {
                disk_id: disk.disk,
                label: disk.label,
                capacity_bytes: disk.capacity.unwrap_or(0),
                disk_path: backing.vmdk_file.unwrap_or_default(),
                datastore: backing.datastore.unwrap_or_default(),
                change_id: backing.change_id,
            });
        }

        Ok(result)
    }

    async fn get_vm_networks(&self, vm_ref: &str) -> Result<Vec<VmNetworkInfo>> {
        #[derive(Deserialize)]
        struct NicEntry {
            label: String,
            backing: Option<NicBacking>,
            mac_address: Option<String>,
        }

        #[derive(Deserialize)]
        struct NicBacking {
            network: Option<String>,
            network_name: Option<String>,
        }

        let nics: Vec<NicEntry> = self.get_json(&format!(
            "/vcenter/vm/{}/hardware/ethernet", vm_ref
        )).await?;

        let mut result = Vec::new();
        for nic in nics {
            let network_name = nic.backing
                .and_then(|b| b.network_name.or(b.network));

            result.push(VmNetworkInfo {
                label: nic.label,
                network_name,
                mac_address: nic.mac_address,
            });
        }

        Ok(result)
    }

    async fn query_changed_disk_areas_soap(
        &self,
        vm_ref: &str,
        disk_id: &str,
        change_id: &str,
    ) -> Result<Vec<ChangedBlock>> {
        let (header, value) = self.auth_header()?;

        let soap_body = format!(
            r#"<?xml version="1.0" encoding="UTF-8"?>
<soapenv:Envelope xmlns:soapenv="http://schemas.xmlsoap.org/soap/envelope/"
                  xmlns:urn="urn:internalvim25">
  <soapenv:Body>
    <urn:QueryChangedDiskAreas>
      <urn:_this type="VirtualMachine">{vm}</urn:_this>
      <urn:snapshot></urn:snapshot>
      <urn:diskId>{disk}</urn:diskId>
      <urn:startOffset>0</urn:startOffset>
      <urn:changeId>{change}</urn:changeId>
    </urn:QueryChangedDiskAreas>
  </soapenv:Body>
</soapenv:Envelope>"#,
            vm = vm_ref,
            disk = disk_id,
            change = change_id
        );

        let soap_url = format!("{}/sdk", self.base_url());
        let resp = self.client
            .post(&soap_url)
            .header(&header, &value)
            .header("Content-Type", "text/xml; charset=utf-8")
            .header("SOAPAction", "urn:internalvim25/QueryChangedDiskAreas")
            .body(soap_body)
            .send()
            .await?;

        if !resp.status().is_success() {
            return Err(anyhow!("SOAP QueryChangedDiskAreas failed: {}", resp.status()));
        }

        let text = resp.text().await?;
        let blocks = parse_changed_disk_areas_response(&text)?;
        Ok(blocks)
    }
}

fn parse_changed_disk_areas_response(xml: &str) -> Result<Vec<ChangedBlock>> {
    use quick_xml::events::Event;
    use quick_xml::Reader;

    let mut reader = Reader::from_str(xml);
    let mut buf = Vec::new();
    let mut blocks = Vec::new();
    let mut current_offset: i64 = 0;
    let mut current_length: i64 = 0;
    let mut in_offset = false;
    let mut in_length = false;
    let mut in_disk_area = false;

    loop {
        match reader.read_event_into(&mut buf) {
            Ok(Event::Start(ref e)) => {
                let name_bytes = e.name().as_ref().to_vec();
                let name_str = String::from_utf8_lossy(&name_bytes);
                match name_str.as_ref() {
                    "diskArea" => { in_disk_area = true; current_offset = 0; current_length = 0; }
                    "start" | "offset" if in_disk_area => { in_offset = true; }
                    "size" | "length" if in_disk_area => { in_length = true; }
                    _ => {}
                }
            }
            Ok(Event::Text(ref e)) => {
                if let Ok(text) = e.unescape() {
                    if in_offset { current_offset = text.parse().unwrap_or(0); }
                    if in_length { current_length = text.parse().unwrap_or(0); }
                }
            }
            Ok(Event::End(ref e)) => {
                let name_bytes = e.name().as_ref().to_vec();
                let name_str = String::from_utf8_lossy(&name_bytes);
                match name_str.as_ref() {
                    "diskArea" => {
                        if current_length > 0 {
                            blocks.push(ChangedBlock { offset: current_offset, length: current_length });
                        }
                        in_disk_area = false;
                    }
                    "start" | "offset" => { in_offset = false; }
                    "size" | "length" => { in_length = false; }
                    _ => {}
                }
            }
            Ok(Event::Eof) => break,
            Err(e) => return Err(anyhow!("XML parse error: {}", e)),
            _ => {}
        }
        buf.clear();
    }

    Ok(blocks)
}

pub fn create_connector(
    host: &str, port: u16, username: &str, password: &str, ignore_ssl: bool,
) -> Box<dyn HypervisorConnector> {
    Box::new(VSphereConnector::new(host, port, username, password, ignore_ssl))
}
