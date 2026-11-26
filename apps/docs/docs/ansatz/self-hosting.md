---
title: "Self-Hosting Ansatz & ModelScript"
description: "Deploy Ansatz as a federated instance, public cluster, or private intranet appliance using Docker Compose, Cloudflare Tunnels, or Caddy with automated TLS."
---

# Self-Hosting Ansatz & ModelScript

Ansatz can be deployed as an independent federated instance, a public flagship cluster, or a private corporate intranet appliance using **Docker Compose**, **Cloudflare Tunnels (Zero Open Ports)**, or **Caddy** for automated TLS certificate provisioning.

---

## Deployment Architecture Profiles

Ansatz offers targeted deployment profiles to match your infrastructure sizing and operational goals:

| Deployment File / Profile                        | Active Containers                                      | Target Use Case                                                                | Database Engine                     | Min. RAM   |
| :----------------------------------------------- | :----------------------------------------------------- | :----------------------------------------------------------------------------- | :---------------------------------- | :--------- |
| **`docker-compose.federated.yml`** _(default)_   | `caddy`, `web`, `api` (`api-ce`)                       | **Recommended** self-hosted federated node (homelab, university, lab VPS)      | **SQLite WAL only**                 | **1–2 GB** |
| **`docker-compose.federated.yml` + `historian`** | `caddy`, `web`, `api`, `timescaledb`, `mqtt`           | Federated research lab with live IoT simulation telemetry streaming            | SQLite WAL + TimescaleDB            | 4 GB       |
| **`ee/deploy/docker-compose.yml`**               | `modelscript-appliance` (EE)                           | Hardened air-gapped Enterprise Intranet Appliance (NERC CIP / FERC CEII / SSO) | SQLite WAL (embedded)               | 2–4 GB     |
| **`docker-compose.yml` + `flagship`**            | `caddy`, `web`, `api` (`api-ee`) (+ optional `tunnel`) | `modelscript.org` + `ansatz.social` flagship cluster with dual-domain routing  | SQLite WAL (+ optional TimescaleDB) | 4–8 GB     |
| **`docker-compose.yml` + `quick-tunnel`**        | `caddy`, `web`, `api`, `quick-tunnel`                  | Zero-config demo with ephemeral `trycloudflare.com` URL                        | SQLite WAL only                     | 1.5 GB     |

_(Add `--profile tunnel` to either `docker-compose.federated.yml` or `docker-compose.yml` to enable Cloudflare Zero Trust Tunnel ingress; add `--profile historian` and set `ENABLE_TIMESCALE=true ENABLE_MQTT=true` to enable TimescaleDB + Mosquitto.)_

---

## Zero-Open-Port Ingress via Cloudflare Tunnel

If you are hosting behind residential CGNAT, corporate firewalls, or on a developer workstation where opening ports `80` and `443` is impossible or undesirable:

1. Create a free tunnel in the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) (**Networks → Tunnels → Create Tunnel**).
2. Route your public hostname (e.g., `hub.mydomain.org`) to `http://caddy:80`.
3. Add the tunnel token to your `.env`:
   ```dotenv
   CLOUDFLARE_TUNNEL_TOKEN="eyJh..."
   ```
4. Start the stack:
   ```bash
   docker compose -f docker-compose.federated.yml --profile tunnel up -d
   ```
5. You can now close all inbound firewall ports (`sudo ufw default deny incoming`). The tunnel connects outbound to Cloudflare Edge over encrypted QUIC/HTTP2.

---

## Quick Start Deployment (Federated Node)

### 1. Download Standalone Federated Node Configuration

```bash
mkdir -p ansatz/config && cd ansatz
curl -fsSLO https://raw.githubusercontent.com/modelscript/modelscript/main/docker-compose.federated.yml
curl -fsSLO https://raw.githubusercontent.com/modelscript/modelscript/main/.env.example
curl -fsSL https://raw.githubusercontent.com/modelscript/modelscript/main/config/Caddyfile.federated -o config/Caddyfile.federated
curl -fsSL https://raw.githubusercontent.com/modelscript/modelscript/main/config/mosquitto.conf -o config/mosquitto.conf
curl -fsSL https://raw.githubusercontent.com/modelscript/modelscript/main/config/init-timescaledb.sql -o config/init-timescaledb.sql
cp .env.example .env
```

### 2. Configure Environment (`.env`)

```dotenv
PUBLIC_DOMAIN=hub.mycompany.org
PUBLIC_URL=https://hub.mycompany.org
NODE_ENV=production
JWT_SECRET=generate-with-openssl-rand-hex-32

# Cloudflare Tunnel (optional for zero-port ingress; leave blank for direct Caddy ACME)
CLOUDFLARE_TUNNEL_TOKEN=

# Headless Preinstallation (Optional: skip setup wizard automatically on first boot)
AUTO_SEED_ADMIN=true
ADMIN_INIT_USERNAME=admin
ADMIN_INIT_PASSWORD=StrongSecurePassword123!
DEPLOYMENT_PRESET=federated
```

### 3. Launch Services

#### Option A: Standalone Federated Node (Embedded SQLite only, ~1–2 GB RAM)

```bash
docker compose -f docker-compose.federated.yml up -d
```

#### Option B: Federated Node + Telemetry Historian (TimescaleDB & MQTT)

Set `ENABLE_TIMESCALE=true`, `ENABLE_MQTT=true`, and `TIMESCALE_PASSWORD=<strong-password>` in `.env`, then run:

```bash
docker compose -f docker-compose.federated.yml --profile historian up -d
```

#### Option C: Hardened Enterprise Intranet Appliance (Air-Gapped EE)

```bash
MSX_LICENSE_KEY=msx_lic_... JWT_SECRET=$(openssl rand -hex 32) \
  docker compose -f ee/deploy/docker-compose.yml up -d
```

#### Option D: 1-Click Ephemeral Demo (No Account or Domain Needed)

```bash
docker compose --profile quick-tunnel up
```

---

## First-Run Setup Wizard (`/setup`) vs. Headless Preinstall

### Interactive Setup Wizard

When launching a fresh federated node without pre-seeded admin variables:

1. Open `https://hub.mycompany.org/setup` in your browser.
2. Select your **Deployment Profile**:
   - **Tier 1: Independent Federated Node:** Open ActivityPub S2S federation with peer nodes.
   - **Tier 2: Corporate Intranet Appliance:** Outbound federation disabled, restricted to corporate email domains.
   - **Tier 3: Public Flagship Hub:** Open registration with anti-Sybil verification.
3. Create the founding **Administrator Account** and initial cryptographic keys.
4. Complete configuration and download your initial baseline snapshot. The wizard locks permanently upon completion.

### Headless Preinstallation

For automated CI/CD, Terraform, or Ansible deployments, setting `ADMIN_INIT_USERNAME`, `ADMIN_INIT_PASSWORD`, and `DEPLOYMENT_PRESET` automatically provisions the administrator, applies tier settings, generates cryptographic keys, and permanently locks the setup wizard on first boot.

---

## Database Operations, Diagnostics & Hot Backups

- **Primary Application Database (Always Embedded SQLite WAL):** Users, social graph, ActivityPub outbox/inbox, packages, permissions, and audit logs run on high-performance `better-sqlite3` on the persistent `api-data` volume. Schema migrations run automatically on container startup.
- **Telemetry Historian (Optional PostgreSQL / TimescaleDB):** Enabled via `--profile historian` with `ENABLE_TIMESCALE=true`.

### Hot SQLite Backups & Diagnostics

For local workspaces with `@modelscript/cli` installed, `msx db` provides offline backup, integrity check, and migration bundle commands:

```bash
# Create an online SQLite WAL snapshot with SHA-256 verification
msx db backup --label nightly

# Run deep operational health checks (SQLite integrity, audit hash-chain, disk headroom)
msx db doctor

# Generate a redacted diagnostic support bundle (zero secrets or password hashes)
msx db support-bundle --file support-diagnostic.json
```

For containerized deployments, use the **Admin Console → Database & Backups** panel (`POST /api/v1/admin/backups`) or run an atomic SQLite `VACUUM INTO` backup via `scripts/ops/upgrade-consumer.sh` (below).

---

## Maintenance Mode, Step-Up Sudo & Prometheus Metrics

### Multi-Tiered Maintenance Mode

Operators can transition a node between four operational states via the **Admin Console → Settings** tab (`PATCH /api/v1/admin/settings`) or environment variables (`MSX_MAINTENANCE_MODE`, `MSX_MAINTENANCE_ETA`):

- **`off`**: Normal read/write operation.
- **`scheduled`**: Displays an upcoming maintenance window banner and `maintenanceEta` countdown across Web and Docs without blocking traffic.
- **`read_only`**: Allows `GET`/`HEAD`/`OPTIONS` browsing and package downloads while returning `503 Service Unavailable` (with `Retry-After`) on user mutations.
- **`lockdown`**: Blocks all non-admin requests while allowing staff administrators to perform upgrades or forensic recovery.

### Step-Up Sudo Mode (`REQUIRE_ADMIN_SUDO=true`)

Destructive administrative mutations (role promotions, database restores, migration bundle imports, and DMCA counter-notice restorations) support **Step-Up Sudo** verification (`POST /api/v1/admin/sudo`), issuing a short-lived 15-minute `admin_sudo` elevation token after re-verifying the administrator's password or TOTP code.

### Prometheus & OpenMetrics Endpoint

Scrape `GET /api/v1/admin/metrics` (authenticated with an admin Bearer token or `ms_bot_*` monitoring token) to collect OpenMetrics gauges and counters for Node.js heap/RSS memory, SQLite WAL & backup footprint, user/package/post totals, ActivityPub S2S delivery states, and HPC job queue depth.

---

## Upgrading & Rollback Runbook

### Automated Zero-Data-Loss Upgrade (Federated Node & EE Appliance)

Use the consumer upgrade script, which takes an atomic SQLite `VACUUM INTO` snapshot into `./backups/`, pulls the pinned release tag, waits for healthchecks, and rolls back automatically from local cache if healthchecks fail:

```bash
# Upgrade a Federated Node to release v0.2.0
./scripts/ops/upgrade-consumer.sh 0.2.0 docker-compose.federated.yml

# Upgrade a Hardened Enterprise Appliance to release v0.2.0
./scripts/ops/upgrade-consumer.sh 0.2.0 ee/deploy/docker-compose.yml modelscript-appliance
```

### Manual Upgrade & Point-in-Time Rollback

1. **Pull and roll out a pinned release tag:**
   ```bash
   IMAGE_TAG=0.2.0 docker compose -f docker-compose.federated.yml pull
   IMAGE_TAG=0.2.0 docker compose -f docker-compose.federated.yml up -d --wait --remove-orphans
   ```
2. **Roll back to a previous tag** (using cached images with `--pull never`):
   ```bash
   IMAGE_TAG=0.1.0 docker compose -f docker-compose.federated.yml up -d --pull never --wait
   ```
3. **Restore a pre-upgrade SQLite snapshot** (if needed): stop `api`, copy `./backups/modelscript-<timestamp>.db` over `/app/apps/api/data/modelscript.db` in the `api-data` volume (removing any stale `-wal`/`-shm` files), and restart `api`.
