#!/usr/bin/env bash
# Fresh Ubuntu 24.04 VPS bootstrap — role-agnostic (backend OR relay).
set -euo pipefail

echo "[1/8] apt update + base packages"
export DEBIAN_FRONTEND=noninteractive
apt-get update -qq
apt-get -y -qq upgrade
apt-get -y -qq install \
  docker.io docker-compose-plugin \
  wireguard nginx certbot python3-certbot-nginx \
  ufw fail2ban unattended-upgrades \
  curl jq git

echo "[2/8] UFW firewall"
ufw --force reset
ufw default deny incoming
ufw default allow outgoing
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw allow 3478/udp
ufw allow 3478/tcp
ufw allow 5349/tcp
ufw allow 5349/udp
ufw allow 51820/udp
ufw allow 49152:65535/udp
ufw allow 8080/tcp
ufw --force enable

echo "[3/8] unattended-upgrades"
dpkg-reconfigure -f noninteractive unattended-upgrades

echo "[4/8] WireGuard keypair"
mkdir -p /etc/wireguard
cd /etc/wireguard
if [[ ! -f server.key ]]; then
  umask 077
  wg genkey | tee server.key | wg pubkey > server.pub
  echo "WG private key saved to /etc/wireguard/server.key"
  echo "WG public key: $(cat server.pub)"
fi

echo "[5/8] Project directory"
mkdir -p /opt/ii-private-messenger
chown -R root:root /opt/ii-private-messenger

echo "[6/8] Docker enable + group"
systemctl enable docker
systemctl start docker

echo "[7/8] systemd auto-restart unit"
cat > /etc/systemd/system/iimsg-stack.service <<'UNIT'
[Unit]
Description=II Private Messenger Docker Stack
After=docker.service wg-quick@wg0.service
Requires=docker.service

[Service]
Type=oneshot
RemainAfterExit=yes
WorkingDirectory=/opt/ii-private-messenger/current
ExecStart=/usr/bin/docker compose up -d
ExecStop=/usr/bin/docker compose down

[Install]
WantedBy=multi-user.target
UNIT
systemctl daemon-reload
systemctl enable iimsg-stack.service || true

echo "[8/8] fail2ban"
systemctl enable fail2ban
systemctl restart fail2ban

echo "✅ VPS base setup complete."
echo "Next: deploy-backend.sh or deploy-relay.sh <region> <domain>"
