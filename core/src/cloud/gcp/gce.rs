use anyhow::Result;
use tracing::info;

/// GCE instance backup using machine images and snapshots
pub struct GceBackup;

impl GceBackup {
    pub fn new() -> Self {
        Self
    }

    /// Create machine image from instance
    pub async fn create_machine_image(&self, _instance: &str, _name: &str) -> Result<()> {
        info!("Creating GCE machine image: {} -> {}", _instance, _name);
        // compute.machineImages.insert
        Ok(())
    }

    /// Restore instance from machine image
    pub async fn restore_from_image(&self, _image: &str, _name: &str) -> Result<()> {
        info!("Restoring GCE instance from image: {}", _image);
        // compute.instances.insert from machine image
        Ok(())
    }

    /// List machine images
    pub async fn list_images(&self) -> Result<Vec<String>> {
        Ok(Vec::new())
    }
}
