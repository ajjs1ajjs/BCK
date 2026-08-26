# ---- Build Stage ----
FROM ubuntu:24.04 AS builder

RUN apt-get update && apt-get install -y \
    build-essential cmake pkg-config libssl-dev libzstd-dev protobuf-compiler curl \
    && rm -rf /var/lib/apt/lists/*

ENV RUSTUP_HOME=/usr/local/rustup \
    CARGO_HOME=/usr/local/cargo \
    PATH=/usr/local/cargo/bin:${PATH}

# Pinned toolchain (matches rust-toolchain.toml) for reproducible builds.
RUN curl --proto '=https' --tlsv1.2 -sSf https://sh.rustup.rs \
    | sh -s -- -y --profile minimal --default-toolchain 1.98.0

WORKDIR /app
COPY . .

# BuildKit cache mounts keep the registry and target dir between builds,
# so only changed crates are recompiled.
RUN --mount=type=cache,target=/usr/local/cargo/registry \
    --mount=type=cache,target=/app/target \
    cargo build --release --workspace --bins \
    && mkdir -p /out \
    && cp target/release/bckd target/release/bck target/release/bck-agent target/release/bck-proxy /out/

# ---- Runtime ----
FROM ubuntu:24.04 AS bckd
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin bck \
    && mkdir -p /data && chown -R bck:bck /data
COPY --from=builder /out/bckd /usr/local/bin/bckd
COPY --from=builder /out/bck /usr/local/bin/bck
COPY --from=builder /out/bck-agent /usr/local/bin/bck-agent
COPY --from=builder /out/bck-proxy /usr/local/bin/bck-proxy
COPY config.toml /etc/bck/config.toml
# Run as an unprivileged user; secrets/keys are written to /data which is chowned above.
USER bck
EXPOSE 9440 9441
CMD ["bckd"]

FROM ubuntu:24.04 AS agent
COPY --from=builder /app/target/release/bck-agent /usr/local/bin/bck-agent
CMD ["bck-agent"]

FROM ubuntu:24.04 AS cli
COPY --from=builder /app/target/release/bck /usr/local/bin/bck
ENTRYPOINT ["bck"]