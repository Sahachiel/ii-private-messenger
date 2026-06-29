#!/usr/bin/env bash
# Deploy a regional relay + Coturn. Usage: deploy-relay.sh <region> <relay-domain> <turn-domain>
set -euo pipefail

REGION="${1:?region required (ru|ge|fi)}"
RELAY_DOMAIN="${2:?relay domain required, e.g. relay-ge.iiprivatemessenger.app}"
TURN_DOMAIN="${3:?turn domain required, e.g. turn-ge.iiprivatemessenger.app}"

if [[ ! "$REGION" =~ ^(ru|ge|fi)$ ]]; then echo "Invalid region: $REGION" >&2; exit 1; fi

ROOT="/opt/ii-private-messenger/current"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
SERVER_IP="$(curl -4 -s ifconfig.me)"

echo "[1/6] Sync code"
mkdir -p "$ROOT"
rsync -a --delete --exclude node_modules --exclude .git "$REPO_ROOT/" "$ROOT/"

echo "[2/6] TLS certificates"
certbot certonly --nginx --non-interactive --agree-tos -m ops@iiprivatemessenger.app \
  -d "$RELAY_DOMAIN" -d "$TURN_DOMAIN"

echo "[3/6] nginx (WSS)"
sed -e "s|__DOMAIN__|$RELAY_DOMAIN|g" -e "s|__UPSTREAM__|127.0.0.1:8080|g" \
    "$REPO_ROOT/infra/nginx/nginx.conf.template" > /etc/nginx/sites-available/iimsg-relay.conf
ln -sf /etc/nginx/sites-available/iimsg-relay.conf /etc/nginx/sites-enabled/iimsg-relay.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t && systemctl reload nginx

echo "[4/6] Coturn config"
TURN_SECRET="${TURN_SECRET:-$(openssl rand -hex 32)}"
sed -e "s|__SERVER_IP__|$SERVER_IP|g" \
    -e "s|__DOMAIN__|$TURN_DOMAIN|g" \
    -e "s|__TURN_SECRET__|$TURN_SECRET|g" \
    "$REPO_ROOT/infra/coturn/turnserver.conf.template" > "$ROOT/infra/docker/relay-$REGION/turnserver.conf"

echo "[5/6] docker compose"
cd "$ROOT/infra/docker/relay-$REGION"
[[ -f .env ]] || { echo "Create .env from .env.example first" >&2; exit 1; }
[[ -f "$ROOT/relay/.env" ]] || { echo "Create $ROOT/relay/.env first" >&2; exit 1; }
docker compose up -d --build

echo "[6/6] WireGuard"
if [[ -f /etc/wireguard/wg0.conf ]]; then systemctl enable --now wg-quick@wg0 || true; fi

echo "✅ Relay-$REGION live at https://$RELAY_DOMAIN (turn: $TURN_DOMAIN)"
echo "TURN shared secret (store in backend .env as TURN_${REGION^^}_SECRET): $TURN_SECRET"
