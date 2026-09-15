#!/usr/bin/env bash
# BCK simulation: load + chaos + restore-drill without 10TB.
# Usage: bash scripts/simulate.sh [--big]
#   --big: heavier load (8 writers x 50 x 64KiB, 20 files x 256KiB)
set -euo pipefail
cd "$(dirname "$0")/.."

echo "[BCK sim] 1/3 unit sims (fast)..."
cargo test -p bck-core --lib -- sim:: 2>&1 | tail -8

if [ "${1:-}" = "--big" ]; then
  W="--writers 8 --blocks 50 --bytes 65536"
  R="--files 20 --kb 256"
else
  W="--writers 8 --blocks 20 --bytes 65536"
  R="--files 10 --kb 64"
fi

echo "[BCK sim] 2/3 CLI load sim..."
cargo run -q -p bck -- drill load $W
echo "[BCK sim] 3/3 chaos + restore..."
cargo run -q -p bck -- drill chaos
cargo run -q -p bck -- drill restore $R
echo "[BCK sim] ALL PASS — data plane holds under contention, corruption fails closed, restores byte-identical."
