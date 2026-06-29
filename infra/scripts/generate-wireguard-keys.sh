#!/usr/bin/env bash
# Generate all WireGuard keypairs needed for the 4-node mesh (backend + 3 relays).
# Writes to ./wg-keys/ and prints a ready-to-paste summary.
set -euo pipefail

OUT="$(cd "$(dirname "$0")" && pwd)/wg-keys"
mkdir -p "$OUT"
umask 077

gen() {
  local name="$1"
  if [[ ! -f "$OUT/$name.key" ]]; then
    wg genkey | tee "$OUT/$name.key" | wg pubkey > "$OUT/$name.pub"
    chmod 600 "$OUT/$name.key"
  fi
}

for node in backend relay-ru relay-ge relay-fi; do gen "$node"; done

echo ""
echo "========================================"
echo "  WireGuard keypairs generated in: $OUT"
echo "========================================"
for node in backend relay-ru relay-ge relay-fi; do
  echo ""
  echo "-- $node --"
  echo "  private: $(cat "$OUT/$node.key")"
  echo "  public : $(cat "$OUT/$node.pub")"
done
echo ""
echo "Substitute __*_PRIVATE_KEY__ and __*_PUBLIC_KEY__ in:"
echo "  infra/wireguard/wg-backend.conf.template"
echo "  infra/wireguard/wg-relay-{ru,ge,fi}.conf.template"
echo "Then deploy each rendered config to /etc/wireguard/wg0.conf on its node."
