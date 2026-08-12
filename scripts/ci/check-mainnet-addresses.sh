#!/usr/bin/env bash
# Fail if known mainnet-only or wrong-chain addresses appear in contracts/ or scripts/deploy/

set -euo pipefail

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SCAN_DIRS=("$ROOT/contracts/src" "$ROOT/scripts/deploy")

# Mainnet-only addresses (chain ID 14) — do NOT use on Coston2
BLOCKED=(
  "0x8a1E35F5c98C4E85B36B7B253222eE17773b2781"  # SparkDEX SwapRouter mainnet
  "0x8A2578d23d4C532cC9A98FaD91C0523f5efDE652"  # SparkDEX V3Factory mainnet
  "0x88d46717b16619b37fa2dfd2f038defb4459f1f7"  # SparkDEX FXRP/USDT0 pool mainnet
  "0xe7cd86e13AC4309349F30B3435a9d337750fC82D"  # Mainnet USDT0
  "0xAd552A648C74D49E10027AB8a618A3ad4901c5bE"  # Mainnet FXRP
)

FOUND=0

for dir in "${SCAN_DIRS[@]}"; do
  if [[ ! -d "$dir" ]]; then
    continue
  fi
  for addr in "${BLOCKED[@]}"; do
    # Case-insensitive search
    if grep -ri "$addr" "$dir" 2>/dev/null; then
      echo "ERROR: Mainnet-only address found in $dir: $addr"
      FOUND=1
    fi
  done
done

if [[ $FOUND -ne 0 ]]; then
  echo "Address guard FAILED"
  exit 1
fi

echo "Address guard PASSED — no blocked mainnet addresses in contracts/ or scripts/deploy/"
