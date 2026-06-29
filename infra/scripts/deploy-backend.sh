#!/usr/bin/env bash
# Deploy the II Private Messenger backend core on this VPS.
# Usage: deploy-backend.sh <domain>
set -euo pipefail

DOMAIN="${1:?domain required, e.g. api.iiprivatemessenger.app}"
ROOT="/opt/ii-private-messenger/current"
REPO_ROOT="$(cd "$(dirname "$0")/../.." && pwd)"

echo "[1/5] Sync code to $ROOT"
mkdir -p "$ROOT"
rsync -a --delete --exclude node_modules --exclude .git "$REPO_ROOT/" "$ROOT/"

echo "[2/5] nginx config"
sed -e "s|__DOMAIN__|$DOMAIN|g" -e "s|__UPSTREAM__|127.0.0.1:3000|g" \
    "$REPO_ROOT/infra/nginx/nginx.conf.template" > /etc/nginx/sites-available/iimsg-api.conf
ln -sf /etc/nginx/sites-available/iimsg-api.conf /etc/nginx/sites-enabled/iimsg-api.conf
rm -f /etc/nginx/sites-enabled/default
nginx -t
certbot --nginx -d "$DOMAIN" --non-interactive --agree-tos -m ops@iiprivatemessenger.app
systemctl reload nginx

echo "[3/5] docker compose"
cd "$ROOT/infra/docker/backend"
[[ -f .env ]] || { echo "Create $ROOT/infra/docker/backend/.env from .env.example first" >&2; exit 1; }
[[ -f "$ROOT/backend/.env" ]] || { echo "Create $ROOT/backend/.env with JWT_SECRET etc." >&2; exit 1; }
docker compose up -d --build

echo "[4/5] WireGuard"
if [[ -f /etc/wireguard/wg0.conf ]]; then
  systemctl enable --now wg-quick@wg0 || true
fi

echo "[5/5] Healthcheck"
sleep 6
curl -fsS "https://$DOMAIN/api/health" || echo "⚠ health endpoint not responding yet"

echo "✅ Backend deployed at https://$DOMAIN"
