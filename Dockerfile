# ---- Build Stage ----
FROM rust:1.85-slim-bookworm AS builder

RUN apt-get update && apt-get install -y pkg-config libssl-dev protobuf-compiler && rm -rf /var/lib/apt/lists/*

WORKDIR /app
COPY . .

RUN cargo build --release --workspace

# ---- Runtime ----
FROM debian:bookworm-slim AS bckd
RUN apt-get update && apt-get install -y ca-certificates && rm -rf /var/lib/apt/lists/* \
    && useradd --system --create-home --shell /usr/sbin/nologin bck \
    && mkdir -p /data && chown -R bck:bck /data
COPY --from=builder /app/target/release/bckd /usr/local/bin/bckd
COPY --from=builder /app/target/release/bck /usr/local/bin/bck
COPY --from=builder /app/target/release/bck-agent /usr/local/bin/bck-agent
COPY --from=builder /app/target/release/bck-proxy /usr/local/bin/bck-proxy
COPY config.toml /etc/bck/config.toml
# Run as an unprivileged user; secrets/keys are written to /data which is chowned above.
USER bck
EXPOSE 9440 9441
CMD ["bckd"]

FROM debian:bookworm-slim AS agent
COPY --from=builder /app/target/release/bck-agent /usr/local/bin/bck-agent
CMD ["bck-agent"]

FROM debian:bookworm-slim AS cli
COPY --from=builder /app/target/release/bck /usr/local/bin/bck
ENTRYPOINT ["bck"]
