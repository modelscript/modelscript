# Self-Hosting Ansatz & ModelScript

Ansatz can be deployed as an independent federated instance, a public flagship cluster, or a private corporate intranet appliance using **Docker Compose**, **Cloudflare Tunnels (Zero Open Ports)**, or **Caddy** for automated TLS certificate provisioning.

---

## Deployment Architecture Profiles

Ansatz offers targeted deployment profiles to match your infrastructure sizing and operational goals:

| Profile              | Active Containers                                           | Target Use Case                                                                 | Database Engine                     | Min. RAM   |
| :------------------- | :---------------------------------------------------------- | :------------------------------------------------------------------------------ | :---------------------------------- | :--------- |
| **`flagship`**       | `caddy`, `web`, `api` (EE), `timescaledb`, `mqtt`, `tunnel` | `modelscript.org` + `ansatz.social` public cluster with dual-domain routing     | SQLite WAL + TimescaleDB            | 4–8 GB     |
| **`federated`**      | `caddy`, `web`, `api`, `timescaledb`, `mqtt`, `tunnel`      | Research lab with live IoT simulation telemetry streaming                       | SQLite WAL + TimescaleDB            | 4 GB       |
| **`federated-lite`** | `caddy`, `web`, `api`, `tunnel`                             | **Embedded DB only** (no Postgres/MQTT). Lightweight homelabs & VPS             | **SQLite WAL only**                 | **1–2 GB** |
| **`corporate`**      | `caddy`, `web`, `api` (EE), `timescaledb` (optional)        | Enterprise intranet, air-gapped enclave, SSO domain allowlist, internal `/docs` | SQLite WAL (+ optional TimescaleDB) | 2–4 GB     |
| **`quick-tunnel`**   | `caddy`, `web`, `api`, `quick-tunnel`                       | Zero-config demo with ephemeral `trycloudflare.com` URL                         | SQLite WAL only                     | 1.5 GB     |

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
   docker compose --profile federated-lite up -d
   ```
5. You can now close all inbound firewall ports (`sudo ufw default deny incoming`). The tunnel connects outbound to Cloudflare Edge over encrypted QUIC/HTTP2.

---

## Quick Start Deployment

### 1. Scaffold or Download Configuration Files

You can scaffold the deployment directory with the `msx hub init` CLI command:

```bash
msx hub init --profile federated --dir ansatz --domain hub.mycompany.org
cd ansatz
```

Or download the compose files and runtime configs (`config/Caddyfile`, `config/mosquitto.conf`, and `config/init-timescaledb.sql`) directly with `curl`:

```bash
mkdir -p ansatz/config && cd ansatz
curl -fsSLO https://raw.githubusercontent.com/modelscript/modelscript/main/docker-compose.yml
curl -fsSLO https://raw.githubusercontent.com/modelscript/modelscript/main/docker-compose.prod.yml
curl -fsSLO https://raw.githubusercontent.com/modelscript/modelscript/main/.env.production.example
curl -fsSL https://raw.githubusercontent.com/modelscript/modelscript/main/config/Caddyfile -o config/Caddyfile
curl -fsSL https://raw.githubusercontent.com/modelscript/modelscript/main/config/mosquitto.conf -o config/mosquitto.conf
curl -fsSL https://raw.githubusercontent.com/modelscript/modelscript/main/config/init-timescaledb.sql -o config/init-timescaledb.sql
cp .env.production.example .env
```

### 2. Configure Environment (`.env`)

```dotenv
PUBLIC_DOMAIN=hub.mycompany.org
PUBLIC_URL=https://hub.mycompany.org
NODE_ENV=production
JWT_SECRET=generate-with-openssl-rand-hex-32
TOTP_ENCRYPTION_KEY=generate-with-openssl-rand-hex-32

# Cloudflare Tunnel (optional for zero-port ingress; leave blank for direct Caddy ACME)
CLOUDFLARE_TUNNEL_TOKEN=

# Headless Preinstallation (Optional: skip setup wizard automatically on first boot)
AUTO_SEED_ADMIN=true
ADMIN_INIT_USERNAME=admin
ADMIN_INIT_EMAIL=admin@mycompany.org
ADMIN_INIT_PASSWORD=StrongSecurePassword123!
DEPLOYMENT_PRESET=tier1_federated
```

### 3. Launch Services

#### Option A: Lightweight Homelab / VPS (Embedded SQLite only, ~1-2 GB RAM)

```bash
docker compose --profile federated-lite up -d
```

#### Option B: Full Federated Node (with TimescaleDB Telemetry Historian)

```bash
docker compose --profile federated up -d
```

#### Option C: Flagship Cluster (`modelscript.org` + `ansatz.social`)

Both `--profile flagship` and `--profile federated` activate the full production stack (`caddy`, `web`, `api`, `timescaledb`, `mqtt`, `tunnel`):

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env --profile flagship up -d
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

- **Primary Application Database (Always Embedded SQLite WAL):** Users, social graph, ActivityPub outbox/inbox, packages, permissions, and audit logs run on high-performance `better-sqlite3` on the persistent `api-data` volume.
- **Telemetry Historian (Optional PostgreSQL / TimescaleDB):** Handled via TimescaleDB when the `federated` or `flagship` profile is active.

### Hot SQLite Backups & Diagnostics (`msx db`)

To create an online hot backup, run deep health checks, or export a redacted diagnostic bundle without stopping the service:

```bash
# Create an online SQLite WAL snapshot with SHA-256 verification
msx db backup --label nightly

# Or invoke inside the running production API container
docker compose exec api node apps/cli/dist/main.js db backup --label nightly

# Run deep operational health checks (SQLite integrity, audit hash-chain, disk headroom)
msx db doctor

# Generate a redacted diagnostic support bundle (zero secrets or password hashes)
msx db support-bundle --file support-diagnostic.json

# Export or import a portable instance migration bundle (settings, federation rules, flags)
msx db export-bundle --file migration-bundle.json
msx db import-bundle --file migration-bundle.json
```

Backups are recorded in `apps/api/data/backups/` and verified with SHA-256 checksums and SQLite `PRAGMA integrity_check`.

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

### Standard Zero-Data-Loss Upgrade

1. **Enable Read-Only Drain (Optional):** Set Maintenance Mode to `read_only` in `/admin` or run a pre-upgrade snapshot:
   ```bash
   docker compose exec api node apps/cli/dist/main.js db backup --label pre-upgrade
   ```
2. **Preview & Apply Schema Migrations:**
   ```bash
   docker compose exec api node apps/cli/dist/main.js db upgrade --dry-run
   ```
3. **Pull New Images & Recreate Containers:**
   ```bash
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env --profile flagship pull
   docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env --profile flagship up -d --wait --remove-orphans
   ```
4. **Verify Post-Upgrade Health:**
   ```bash
   docker compose exec api node apps/cli/dist/main.js db doctor
   ```

### Point-in-Time Rollback Procedure

If a deployment needs to be rolled back to a previous release:

1. **Restore the Pre-Upgrade SQLite Snapshot** (automatically creates a `pre-restore` safety backup before swapping the database file):
   ```bash
   docker compose exec api node apps/cli/dist/main.js db restore --file modelscript-backup-pre-upgrade.db
   ```
2. **Pin the Previous Container Image Tag** (`IMAGE_TAG=sha-<previous>` or `IMAGE_TAG=<previous-version>`) and restart:
   ```bash
   IMAGE_TAG=0.0.17 docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env --profile flagship up -d --wait
   ```
