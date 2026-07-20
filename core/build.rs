fn main() -> Result<(), Box<dyn std::error::Error>> {
    // PROTOC env var should be set during installation
    tonic_build::compile_protos("proto/bck.proto")?;
    println!("cargo:rerun-if-changed=proto/bck.proto");
    Ok(())
}
