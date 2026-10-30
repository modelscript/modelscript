# Self-Hosting Ansatz

Ansatz can be deployed as an independent federated instance or as a private corporate intranet appliance using **Docker Compose** and **Caddy** for automated TLS certificate provisioning.

---

## Prerequisites

- **Docker Engine** $\ge 24$ and **Docker Compose** v2
- A publicly accessible domain with DNS records (`A` / `CNAME`) pointed to the host server
- Ports `80` and `443` open for web traffic and automatic ACME certificates

---

## Quick Start Deployment

### 1. Clone Configuration & Environment Template

Create a production directory and configure your `.env.production` file:

```bash
mkdir ansatz && cd ansatz
curl -O https://raw.githubusercontent.com/modelscript/modelscript/main/docker-compose.yml
curl -O https://raw.githubusercontent.com/modelscript/modelscript/main/docker-compose.prod.yml
```

### 2. Environment Variables

Create `.env` with your deployment settings:

```dotenv
PUBLIC_DOMAIN=ansatz.mycompany.com
PUBLIC_URL=https://ansatz.mycompany.com
NODE_ENV=production
MSX_INSTANCE_NAME="Company Engineering Hub"
MSX_CONTACT_EMAIL=admin@mycompany.com
JWT_SECRET=generate-a-cryptographically-secure-random-key-here
PORT=3000
DATA_DIR=/app/data
```

### 3. Launch Services

Start the production stack:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The stack provisions:

- **`web`**: The React 19 frontend container serving the web UI.
- **`api`**: The backend server handling REST, GraphQL, SPARQL, Git Smart HTTP, and ActivityPub federation.
- **`caddy`**: Reverse proxy with automatic HTTPS certificate management.

---

## First-Run Setup Wizard (`/setup`)

When launching an uninitialized node:

1. Open `https://ansatz.mycompany.com/setup` in your browser.
2. Select your **Deployment Profile**:
   - _Independent Federated Node:_ Open ActivityPub federation with peer nodes.
   - _Corporate Intranet Appliance:_ Outbound federation disabled, restricted to corporate email domains.
   - _Public Flagship Hub:_ Open registration with anti-Sybil controls.
3. Create the founding **Administrator Account** and generate the initial cryptographic keys.
4. Complete configuration and download your initial backup snapshot. The setup wizard locks permanently upon completion.

---

## Backups & Maintenance

To perform an online hot backup of the SQLite database:

```bash
docker compose exec api npx tsx apps/cli/src/main.ts db backup --label nightly
```

Backups are created in `data/backups/` and verified with SHA-256 checksums.
