# Deployment

## Prerequisites per VPS

- Debian 12 or Ubuntu 22.04+, ≥ 2 vCPU, ≥ 4 GB RAM, ≥ 40 GB SSD
- Public IPv4, DNS records pointing `<region>.iiprivatemessenger.app` and `turn.<region>...` to it
- SSH as root (or sudo user)

## VPS inventory (Oleven)

| Region | Provider | IP | Role |
|--------|----------|----|----|
| ru | Njalla Sweden | 80.78.28.244 | Relay + Coturn |
| ge | UFO Grande    | 185.235.242.216 | Relay + Coturn (Qatar HQ) |
| fi | TBD           | — | Relay + Coturn |
| core | TBD          | — | Backend + Postgres + Redis |

UFO Piccola (2.56.178.198) is already used by JLP license server — do **not** re-use.

## Bootstrap a regional node

```bash
ssh root@<vps-ip>
git clone <repo> /opt/iimsg && cd /opt/iimsg/infra/docker
cp .env.example .env && $EDITOR .env   # fill secrets
cd ../scripts && chmod +x deploy-region.sh
./deploy-region.sh ge ge.iiprivatemessenger.app
```

The script installs Docker, nginx, certbot, coturn, wireguard, ufw; issues
TLS certs; wires nginx config; starts the compose stack.

## Backend core

Same stack, but run only `postgres`, `redis`, `backend` services. Expose API
internally via WireGuard; no public 3000/tcp.

## Secrets

Generate:

```bash
openssl rand -hex 32   # JWT_SECRET
openssl rand -hex 32   # INTERNAL_SHARED_SECRET
openssl rand -hex 32   # COTURN static-auth-secret
openssl rand -base64 32  # PG_PASSWORD / REDIS_PASSWORD
```

Never commit `.env`. Keep a copy in the Oleven vault at
`~/.claude/projects/C--Users-Sahachiel/memory/credentials_vault.md`.

## Upgrade flow

```bash
cd /opt/iimsg && git pull
cd infra/docker && docker compose up -d --build
```

Relays can be rolling-updated one region at a time; backend core requires a
brief downtime window (announce in-app).

## Firebase / APNs

Not wired yet. Push will be added after FCM project creation. Until then,
delivery relies on the live WebSocket only.
