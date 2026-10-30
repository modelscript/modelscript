# Platform Administration & Enterprise Hub Guide

The **ModelScript Enterprise Hub** (`@modelscript/api`, `@modelscript/web`, and `@modelscript/ee`) provides a self-hostable or cloud-managed control plane for polyglot package management, Git Smart HTTP hosting, OMG SysML v2 / Semantic Web APIs, Slurm HPC simulation offload, operational digital twins, and cryptographically verifiable regulatory compliance.

> [!IMPORTANT]
> **Community (`MSX_EDITION=ce`) vs. Enterprise Edition (`MSX_EDITION=ee`)**:
> The core package registry, Git server, GraphQL/SPARQL endpoints, and local simulation runtime are licensed under **AGPL-3.0-or-later**. Enterprise subsystems located in `ee/` (`@modelscript/ee`) — including Corporate SAML/OIDC SSO & Org RBAC (`saml_oidc_sso`), Air-Gap NERC CIP / FERC CEII & ITAR/EAR Compliance (`airgap_compliance`), FDA 21 CFR Part 11 DHF Attestations (`dhf_attestation`), Slurm HPC & Compute Billing (`slurm_hpc`), Operational Digital Twins & Historian (`digital_twins`), Digital Thread Governance (`digital_thread_governance`), OMG SysML v2 REST (`sysml2_omg_api`), Hosted MCP SSE Gateway (`mcp_sse_gateway`), Real-Time HIL Codegen (`hil_codegen`), and Enterprise PLM/CAE Connectors (`plm_connectors`) — are licensed under `LicenseRef-ModelScript-Enterprise` and verified offline via an Ed25519-signed `MSX_LICENSE_KEY`.

---

## 1. First-Run Install Wizard (`/setup`), Console & Staff RBAC

### First-Run Install Wizard (`/setup`) & Headless Bootstrap

When a new ModelScript instance is deployed without an existing administrator account (`needsSetup: true` on `GET /api/v1/instance/banner` and `GET /api/v1/setup/status`), the web UI displays a `[FIRST-BOOT SETUP]` banner and provides a guided 4-step **First-Run Install Wizard** at `/setup`:

1. **Deployment Architecture Profile & Migration Restore**:
   - **Tier 1: Independent Federated Node** (`invite_only` registration, `open` ActivityPub S2S federation, `3` report auto-quarantine threshold).
   - **Tier 2: Corporate Intranet / Air-Gapped Appliance** (`domain_allowlist` registration, `disabled` outbound federation, `14` hot backup retention).
   - **Tier 3: Public Flagship Hub** (`open` registration with anti-Sybil verification, `open` federation, `30` hot backup retention).
   - **Optional Migration Restore**: Upload a Portable Instance Migration Bundle (`.json`) directly in Step 1 to clone settings, federation policies, feature flags, and quarantines from a prior instance.
2. **Founding Administrator Account**: Creates the initial `admin` user (`1,000` initial compute credits) and provisions Ed25519 instance keys plus RSA-2048 ActivityPub actor keys.
3. **Instance Identity, Registration & Federation Policy**: Configures NodeInfo 2.0/2.1 metadata, email domain allowlists, and moderation auto-quarantine thresholds.
4. **Starter Invites & Baseline Snapshot**: Generates initial invitation codes, records a `first-boot-baseline` SQLite hot backup (`VACUUM INTO` + SHA-256), signs the founding admin in, and **permanently locks** `POST /api/v1/setup/complete` (`403 Forbidden` on any subsequent calls).

For automated GitOps / Helm / Ansible deployments, setting `ADMIN_INIT_USERNAME` and `ADMIN_INIT_PASSWORD` (or `AUTO_SEED_ADMIN=true`) bootstraps the founding administrator headlessly on boot.

### Role-Based Access Control (RBAC)

Access to the Platform Administration Console (`/admin`) and `/api/v1/admin/*` endpoints is enforced via JWT authentication and tiered staff RBAC (`requireStaffRole`):

- **`admin`**: Full platform superuser privileges across all 9 Admin Console tabs (Moderation, Users & Credits, Analytics, Federation, DMCA & Quarantine, Audit Logs, Database & Backups, Feature Flags, Instance Settings & Invites, and System & License Posture).
- **`moderator`**: Trust & Safety access to the **Moderation Queue** (`/api/v1/admin/moderation/*`) and **Users & Governance** (`/api/v1/admin/users`, including User Forensic Dossiers). Cannot promote accounts to `admin`/`auditor` or mutate database/system settings.
- **`auditor`**: Read-only compliance inspector access to **Security & Audit Logs** (`/api/v1/admin/audit-logs`, hash-chain verification), **Analytics & Traffic** (`/api/v1/admin/analytics`), **System Health** (`/api/v1/admin/system`), and **Enterprise Compliance Posture** (`/api/v1/admin/ee/posture`).
- **`user` / Organization Roles (`owner`, `admin`, `member`, `billing`, `viewer`)**: Scoped access within `/api/v1/organizations/:org` namespaces.

### Instance Admin Console Tabs (`/admin`)

1. **Moderation Queue**: Enriched forensic snapshots, keyboard-driven triage (`j`/`k` navigate, `x` select, `r` resolve, `d` dismiss), bulk resolution, content warnings (`mark_sensitive`), ActivityPub `Delete` tombstone broadcast, outbound `Flag` forwarding, and automated report-threshold quarantine (`autoQuarantineReportThreshold`).
2. **Users & Governance**: Global status breakdown (`active`, `frozen`, `suspended`, `admins`, `moderators`, `auditors`), role promotion (`user` | `moderator` | `auditor` | `admin`), session token revocation, HPC compute credit grants/deductions (`POST /api/v1/admin/users/:id/credits`), and slide-over **User Forensic Dossiers** (`GET /api/v1/admin/users/:id/forensics`).
3. **Analytics & Traffic**: First-party privacy-preserving pageview rollups across `web` and `docs` surfaces, bot filtering, geographic heatmaps, and retention pruning.
4. **Federation Domains & S2S Queue**: Domain policy tiers (`allow`, `silence`, `suspend`), consortium `allowlist` mode, Mastodon/Oliphant CSV & JSON blocklist import/export, live WebFinger + NodeInfo peer connectivity tester, S2S JSON payload inspector, and ActivityPub `Move` (`alsoKnownAs`) migration broadcast.
5. **DMCA & Universal Resource Quarantine**: Public statutory takedown intake (`POST /api/v1/admin/dmca/notices`), universal resource quarantine across `post`, `package`, `repository`, and `artifact` targets, 17 U.S.C. § 512(g) counter-notice filing (14-day statutory window), and one-click restoration.
6. **Security & Audit Logs**: Cryptographic SHA-256 hash-chained audit ledger (`GET /api/v1/admin/audit-logs/verify`) with hash-preserving GDPR IP redaction (`POST /api/v1/admin/audit-logs/redact-expired`, replacing expired raw IPs with `REDACTED:<ipToken>` without breaking chain verification).
7. **Database, Backups & Migration**: Live schema migration dry-run/upgrade, `PRAGMA` relational & physical integrity checks, online SQLite WAL `VACUUM INTO` snapshots with SHA-256 checksums, `.db` snapshot download, point-in-time online restore (with automatic `pre-restore` safety snapshot), retention pruning, and portable instance migration bundles (`/api/v1/admin/bundle/export` & `/import`).
8. **Instance Settings & Registration Invites**: Dynamic NodeInfo 2.0/2.1 branding (`instanceName`, `instanceDescription`, `contactEmail`), registration policy (`open`, `invite_only`, `domain_allowlist`, `closed`), multi-use registration invite codes with initial compute credit and role grants, and a live global announcement / maintenance mode banner (`/api/v1/instance/banner`).
9. **System Health & Enterprise Posture**: Live storage & SQLite WAL telemetry, HPC job queue counters, GeoIP/Mailer readiness, and (in Enterprise Edition) Air-Gap / FERC CEII / ITAR compliance posture.

### Headless CLI Database & Backup Management (`msx db`)

```bash
msx db status                                  # View current schema version and pending migrations
msx db upgrade [--dry-run]                     # Apply pending migrations with automatic pre-flight snapshot
msx db verify                                  # Run PRAGMA foreign_key_check & integrity_check
msx db backup [--label pre-release]            # Create online SQLite WAL snapshot with SHA-256 digest
msx db backups                                 # List available snapshots, sizes, and SHA-256 digests
msx db restore --file modelscript-backup-..db  # Verify integrity & perform online point-in-time restore
msx db prune [--keep 7]                        # Prune older snapshots while retaining latest N
msx db export-bundle --file bundle.json        # Export portable instance migration bundle + snapshot
msx db import-bundle --file bundle.json        # Import settings, federation rules, flags & quarantines
```

---

## 2. Runtime Feature Flags & Progressive Rollouts

ModelScript includes an in-memory and database-backed **Feature Flag Engine** (`apps/api/src/services/feature-flag-service.ts`) that allows operators to toggle experimental compilers, cloud solvers, or UI capabilities at runtime without redeploying containers.

### Flag Evaluation Precedence

1. **Environment Variable Override**: Setting `FEATURE_FLAG_<UPPER_SNAKE_KEY>=true|false` (for example, `FEATURE_FLAG_WEBGPU_CLOUD_SOLVER=true`) overrides database state for deterministic staging/CI configuration.
2. **Role Gate (`allowedRoles`)**: If a flag specifies `allowedRoles` (e.g., `["admin", "moderator"]`), only authenticated users holding one of those roles receive `true`.
3. **Deterministic Percentage Rollout (`rolloutPercentage`)**: When `0 < rolloutPercentage < 100`, the service computes a deterministic hash over `(flagKey, userId)` so a given user receives a consistent cohort experience across sessions.

### Administrative Flag Endpoints

| Method & Endpoint                | Access        | Description                                                                                                                                                          |
| :------------------------------- | :------------ | :------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `GET /api/v1/flags`              | Public / User | Evaluate all feature flags for the current caller's `userId` and `role`.                                                                                             |
| `GET /api/v1/admin/flags`        | `admin`       | List all registered feature flags with full rollout metadata, role gates, and environment override states.                                                           |
| `PATCH /api/v1/admin/flags/:key` | `admin`       | Dynamically update `enabled` (`boolean`), `rolloutPercentage` (`0`–`100`), `allowedRoles` (`string[]`), or `description`, and record an immutable admin audit event. |

---

## 3. Enterprise Authentication, SSO, 2FA & Bot Accounts

The authentication subsystem (`/api/v1/auth`, `/api/v1/auth/sso`, `/api/v1/auth/2fa`, `/api/v1/bots`) supports defense-in-depth enterprise identity requirements:

- **OpenID Connect (OIDC) & SAML Enterprise SSO (`/api/v1/auth/sso`)**: Connect Okta, Azure AD / Entra ID, Keycloak, or Google Workspace identity providers with automatic Just-in-Time (JIT) organization provisioning and group-to-role mapping.
- **TOTP Two-Factor Authentication (`/api/v1/auth/2fa`)**: RFC 6238 Time-Based One-Time Password enrollment (QR code provisioning, backup recovery codes, and mandatory 2FA enforcement policies per organization).
- **Machine & CI/CD Bot Accounts (`/api/v1/bots`)**: Provision scoped, non-interactive service accounts bearing `ms_bot_*` API tokens with granular permissions (`package:read`, `package:publish`, `cloud:dispatch`, `mcp:invoke`, `dhf:export`) and automatic token rotation schedules.
- **Signed Outbound Webhooks (`/api/v1/webhooks`)**: Subscribe external CI/CD pipelines to workspace events (`package.published`, `simulation.completed`, `verification.failed`, `twin.anomaly_detected`) signed with HMAC-SHA256 (`X-ModelScript-Signature-256`).

---

## 4. Native Git Smart HTTP Server & Content-Addressable Registry

The Hub integrates both a **Git Smart HTTP Backend** and a **Signed Content-Addressable Package Registry**:

### Native Git Smart HTTP Server (`/git/:namespace/:project` & `/api/v1/git-server`)

Engineers can clone, fetch, branch, and push polyglot model repositories using standard `git` clients over HTTPS:

```bash
git clone https://hub.example.com/git/aerospace/flight-control.git
```

- Supports `git-upload-pack` (`GET /info/refs?service=git-upload-pack`) and `git-receive-pack` (`POST /git-receive-pack`) authenticated via Basic Auth (`username` + PAT or `ms_bot_*` token).
- Pre-receive hooks optionally enforce zero-error `msx lint` checks and Digital Thread correspondence verification before accepting pushes to protected branches.

### Cryptographic Package Signing & Multi-Lens Manifests (`/api/v1/packages`)

Every package published via `msx publish` is stored in a SHA-256 Content-Addressable Storage (CAS) blob store and signed with the publisher's **Ed25519** private key:

- **Integrity & Provenance**: `msx install --verify-signatures` validates both the SHA-256 tarball digest against `modelscript.lock` and the Ed25519 signature against the registry's public keyring.
- **Multi-Lens Manifest Projection (`GET /api/v1/packages/:name/:version?lens=<lens>`)**: The registry dynamically projects any `modelscript.json` package manifest into three industry interoperability schemas on the fly:
  - `?lens=npm`: Standard Node/NPM-compatible package metadata for JavaScript/TypeScript tooling.
  - `?lens=aas`: **IDTA Asset Administration Shell (AAS v3.0)** JSON submodel descriptor containing `TechnicalData` and `SimulationModels` (FMU) references.
  - `?lens=okh`: **DIN SPEC 3105 / OSHWA Open Know-How (OKH v1.0)** hardware manifest exposing CAD/ECAD bill-of-materials, manufacturing files, and SPDX license metadata.

---

## 5. Standards-Compliant Systems & Semantic Web APIs

The Hub natively implements open MBSE and Semantic Web specifications so external enterprise tools can query models without proprietary adapters:

| API Surface                 | Base Path                             | Standard / Capabilities                                                                                                                                                                                                              |
| :-------------------------- | :------------------------------------ | :----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **OMG SysML v2 REST API**   | `/api/v1/sysml2` (and root `/` alias) | Implements the **OMG Systems Modeling API and Services v2.0** specification: `/projects`, `/projects/{id}/commits`, `/projects/{id}/branches`, `/projects/{id}/tags`, `/projects/{id}/commits/{cid}/elements`, and `/relationships`. |
| **GraphQL Library API**     | `/api/v1/libraries/graphql`           | Strongly typed GraphQL schema for querying packages, Modelica classes, ports, equations, physical units, and dependency graphs in a single round-trip.                                                                               |
| **W3C RDF Serialization**   | `/api/v1/libraries/rdf`               | Exports package and workspace ontologies as `text/turtle`, `application/ld+json`, or `application/n-triples`.                                                                                                                        |
| **W3C SPARQL 1.1 Endpoint** | `/api/v1/libraries/sparql`            | Executes SPARQL 1.1 `SELECT`, `CONSTRUCT`, and `ASK` queries with optional OWL 2 RL entailment reasoning over indexed engineering libraries.                                                                                         |
| **OSLC 3.0 & TRS 3.0**      | `msx oslc serve` / `/api/v1/threads`  | Exposes OASIS OSLC Requirements (`oslc_rm`) and Architecture (`oslc_am`) catalogs with Tracked Resource Set (TRS 3.0) incremental change logs for IBM DOORS Next and Polarion synchronization.                                       |

---

## 6. Cloud Slurm HPC Offload, CAE Sweeps & Compute Credit Billing

When engineers run `msx simulate --cloud` or `msx cloud dispatch`, the Hub orchestrates containerized batch execution across Slurm HPC clusters or Kubernetes GPU pools:

- **Cloud Simulation & CAE Endpoints (`/api/v1/cloud` & `/api/v1/cae`)**:
  - Dispatches single-run stiff DAE simulations, multi-thousand-run Monte Carlo ensembles, SU2 CFD runs, and CalculiX FEA jobs to isolated worker nodes.
  - Streams live progress events and solver logs via WebSockets (`/ws`) and persists output trajectories (`CSV`, `Parquet`, `VTK`, `FRD`) to S3-compatible object storage.
- **Compute Credit Wallet & Stripe Billing (`/api/v1/billing`)**:
  - Each user or organization maintains an ACID transactional **Compute Credit Wallet**.
  - Job submission places a pre-authorization hold (`reserveCredits`) based on the requested hardware profile (`standard`, `high-cpu`, `gpu-a100`, `slurm-mpi`); upon completion or cancellation (`msx cloud cancel`), exact wall-clock consumption is settled and unused credits are refunded.
  - Supports self-service credit top-ups via Stripe Checkout webhooks (`/api/v1/billing/webhook`) or manual enterprise quota allocation by platform admins.

---

## 7. Digital Thread Hash-Chained Audit Ledger & Operational Digital Twins

For safety-critical industries (aerospace DO-178C, automotive ISO 26262, medical FDA 21 CFR Part 11 / 820, and nuclear IEC 61513), the Hub maintains a tamper-evident digital thread and live twin telemetry pipeline:

### Cryptographic Hash-Chained Audit Ledger (`/api/v1/threads/audit-log`)

Every mutation to a requirement, model equation, TGG alignment link, verification proof, or administrative setting is appended to a PostgreSQL audit ledger where each record $k$ stores:

$$H_k = \text{SHA256}\bigl(H_{k-1} \;\|\; \text{timestamp}_k \;\|\; \text{actorId}_k \;\|\; \text{action}_k \;\|\; \text{payloadHash}_k\bigr)$$

Operators and external auditors can verify the unbroken integrity of the entire historical chain at any time via the CLI or REST API:

```bash
# Verify cryptographic hash-chain integrity across the PostgreSQL audit ledger
msx db verify

# Export and verify a signed Design History File (DHF) compliance archive
msx dhf export ./workspace -o release_v1.dhf.md
msx dhf audit release_v1.dhf.md
```

### Operational Digital Twins (`/api/v1/twins` & `/api/v1/instances`)

- **Asset Instance Registry (`/api/v1/instances`)**: Tracks serialized physical assets in the field (e.g., tail numbers, inverter serial IDs, or battery packs) bound to specific immutable commits of their ModelScript digital twin.
- **Live Telemetry & Drift Detection (`/api/v1/twins`)**: Ingests time-series sensor telemetry via REST/WebSockets, executes an online Extended Kalman Filter (EKF) / moving-horizon observer against the compiled WASM DAE arena, and triggers automated alerts when physical parameter drift or residual anomalies exceed safety thresholds.

---

## 8. Hosted MCP SSE Gateway (`/api/v1/mcp`)

Enterprise teams can connect cloud AI agents and internal copilot orchestrators directly to the Hub's **Hosted Model Context Protocol (MCP) Gateway**:

- **`GET /api/v1/mcp/sse`**: Authenticates via Bearer token (`JWT` or `ms_bot_*`) and opens a server-sent events transport session.
- **`POST /api/v1/mcp/messages`**: Dispatches any of the [31 MCP engineering tools](../reference/mcp-and-ide.md) inside sandboxed worker isolates with automatic compute credit metering and full audit-ledger logging of every AI tool invocation.

---

## 9. Deployment & Self-Hosting Runbook

ModelScript publishes distinct **Community Edition (`-ce`)** and **Enterprise Edition (`ee`)** container images to GitHub Container Registry (`ghcr.io/modelscript/*`). Choose the deployment scenario below that matches your environment.

| Container Image                 |                   Edition                    |      `/app/ee` Included?      | Default Environment                                                                               | Target Scenario                                          |
| :------------------------------ | :------------------------------------------: | :---------------------------: | :------------------------------------------------------------------------------------------------ | :------------------------------------------------------- |
| `ghcr.io/modelscript/api-ce`    |         **CE** (`AGPL-3.0-or-later`)         | **No** _(physically omitted)_ | `MSX_EDITION=ce`                                                                                  | Self-Hosted Community Edition                            |
| `ghcr.io/modelscript/cli-ce`    |         **CE** (`AGPL-3.0-or-later`)         | **No** _(physically omitted)_ | `MSX_EDITION=ce`                                                                                  | Open-core CI/CD runner                                   |
| `ghcr.io/modelscript/api`       | **EE** (`LicenseRef-ModelScript-Enterprise`) |            **Yes**            | `MSX_EDITION=ee`, `MSX_LICENSE_ENFORCE=true`                                                      | Corporate EE Cluster & `modelscript.org` Cloud           |
| `ghcr.io/modelscript/cli`       | **EE** (`LicenseRef-ModelScript-Enterprise`) |            **Yes**            | `MSX_EDITION=ee`, `MSX_LICENSE_ENFORCE=true`                                                      | Licensed Enterprise CI/CD & HIL codegen runner           |
| `ghcr.io/modelscript/appliance` | **EE** (`LicenseRef-ModelScript-Enterprise`) |            **Yes**            | `MSX_EDITION=ee`, `MSX_LICENSE_ENFORCE=true`, `ENTERPRISE_APPLIANCE=true`, `AIRGAP_ENFORCED=true` | Single-container Air-Gapped Intranet Appliance (`:8080`) |
| `ghcr.io/modelscript/web`       |                    Shared                    |              N/A              | Nginx SPA (`/`) + VitePress Docs (`/docs`) + IDE (`/ide`)                                         | Web UI, IDE Launcher & Unified Documentation Portal      |

---

### Scenario A: Self-Hosted Community Edition (`MSX_EDITION=ce`)

For individual engineers, universities, and open-source teams running under **GNU AGPLv3** without a commercial license key:

- Uses `ghcr.io/modelscript/api-ce:latest` (which physically excludes `/app/ee`) or sets `MSX_EDITION=ce`.
- Includes the full 44-language compiler, DAE simulation engine, local package registry, public repositories, GraphQL/RDF queries, Web IDE, and the core **Instance Admin Console** (`/admin` and `/api/v1/admin/*` for content moderation, federation domain governance, DMCA takedowns, audit logs, and online SQLite backups).
- Enterprise-only endpoints (`/api/v1/ee/*`, `/api/v1/admin/stats`, `/api/v1/admin/ee/*`, `/api/v1/organizations`, `/api/v1/cae`, `/api/v1/cloud`, `/api/v1/twins`, `/api/v1/cosim`, `/api/v1/threads`, `/api/v1/sysml2`, `/api/v1/mcp`, `/api/v1/webhooks`, etc.) return `501 Not Implemented`.

```bash
# Option 1: Run the physically isolated Community Edition API container directly
docker run -d \
  --name modelscript-api-ce \
  -p 3000:3000 \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -v modelscript-data:/app/apps/api/data \
  ghcr.io/modelscript/api-ce:latest

# Option 2: Run the full multi-container stack (Caddy + API + Web) in Community Edition mode
export MSX_EDITION=ce
export JWT_SECRET="$(openssl rand -hex 32)"
export PUBLIC_DOMAIN=localhost
docker compose --profile standalone up -d
```

---

### Scenario B: Corporate Self-Hosted Enterprise Edition (`MSX_EDITION=ee`)

For regulated utilities, defense primes, medical device manufacturers, and enterprise engineering organizations holding a signed `msx_lic_<payloadBase64Url>.<ed25519SigBase64Url>` license key.

#### B.1 Single-Container Air-Gapped Intranet Appliance (Recommended for SCIF / NERC CIP / ITAR)

Bundles the API server, `@modelscript/ee`, Web SPA, Unified Documentation Portal (`/docs`), and Web IDE into a single hardened container on port `8080` with zero outbound network dependencies:

```bash
# 1. On an internet-connected bastion, pull and export the appliance image for offline transfer
docker pull ghcr.io/modelscript/appliance:latest
docker save ghcr.io/modelscript/appliance:latest | gzip > modelscript-appliance.tar.gz

# 2. Inside the air-gapped enclave, load and start the appliance with your offline license token
docker load < modelscript-appliance.tar.gz

docker run -d \
  --name modelscript-appliance \
  --restart unless-stopped \
  -p 8080:8080 \
  -e MSX_EDITION=ee \
  -e MSX_LICENSE_ENFORCE=true \
  -e MSX_LICENSE_KEY="msx_lic_<PAYLOAD>.<SIGNATURE>" \
  -e JWT_SECRET="$(openssl rand -hex 32)" \
  -v modelscript-data:/app/apps/api/data \
  -v modelscript-uploads:/app/apps/api/uploads \
  ghcr.io/modelscript/appliance:latest
```

Or via Docker Compose using [`ee/deploy/docker-compose.yml`](https://github.com/modelscript/modelscript/blob/main/ee/deploy/docker-compose.yml) or the root `appliance` profile:

```bash
export MSX_LICENSE_KEY="msx_lic_<PAYLOAD>.<SIGNATURE>"
export JWT_SECRET="$(openssl rand -hex 32)"
docker compose --profile appliance up -d
```

#### B.2 Corporate Multi-Container Stack (with Caddy TLS, MQTT Unified Namespace & TimescaleDB Historian)

For corporate intranet clusters running live Operational Digital Twins, distributed FMI/MQTT co-simulation, and TimescaleDB telemetry historians:

```bash
cp .env.production.example .env.enterprise
# Edit .env.enterprise:
#   PUBLIC_DOMAIN=modelscript.corp.internal
#   PUBLIC_URL=https://modelscript.corp.internal
#   MSX_EDITION=ee
#   MSX_LICENSE_ENFORCE=true
#   MSX_LICENSE_KEY=msx_lic_<PAYLOAD>.<SIGNATURE>
#   JWT_SECRET=<64-hex-secret>

docker compose --env-file .env.enterprise --profile federated up -d
```

#### B.3 Kubernetes StatefulSet Deployment

Apply the hardened Kubernetes manifest at [`ee/deploy/kubernetes-appliance.yaml`](https://github.com/modelscript/modelscript/blob/main/ee/deploy/kubernetes-appliance.yaml) (pre-configured with `runAsNonRoot: true`, `readOnlyRootFilesystem: true`, `seccompProfile: RuntimeDefault`, and a strict zero-egress `NetworkPolicy`):

```bash
kubectl create namespace modelscript-system
kubectl -n modelscript-system create secret generic modelscript-ee-license \
  --from-literal=MSX_LICENSE_KEY="msx_lic_<PAYLOAD>.<SIGNATURE>" \
  --from-literal=JWT_SECRET="$(openssl rand -hex 32)"
kubectl apply -f ee/deploy/kubernetes-appliance.yaml
```

#### B.4 Verifying Enterprise License & Compliance Readiness

```bash
# Verify Ed25519 license status and enabled feature entitlements
curl -s http://localhost:8080/api/v1/ee/license/status | jq .

# Verify NERC CIP / FERC CEII air-gap compliance posture
curl -s http://localhost:8080/api/v1/compliance/airgap | jq .
```

---

### Scenario C: Official `modelscript.org` & `ansatz.social` Cloud Production Deployment

`modelscript.org` and `ansatz.social` run on a shared multi-container **Enterprise Edition** stack via [`docker-compose.yml`](https://github.com/modelscript/modelscript/blob/main/docker-compose.yml) + [`docker-compose.prod.yml`](https://github.com/modelscript/modelscript/blob/main/docker-compose.prod.yml) (`--profile federated`) behind Caddy automatic multi-domain TLS (`PUBLIC_DOMAIN=ansatz.social`, `DOCS_DOMAIN=modelscript.org`). Host-based routing in Nginx serves the **Unified VitePress Documentation & PDF Manual** (`/` and `/docs`, `/guide/*`, `/languages/*`, `/pricing`) on `modelscript.org` and the **Ansatz Federated Web SPA** (`/`, `/home`, `/explore`, `/packages`, `/repos`, `/playground`) on `ansatz.social`, alongside the WebGPU IDE (`/ide`, `/vscode`) and Enterprise API (`/api/*`, `/git/*`).

#### C.1 Initial Server Provisioning (`/opt/modelscript`)

```bash
sudo mkdir -p /opt/modelscript/config
cd /opt/modelscript

# Copy docker-compose.yml, docker-compose.prod.yml, config/Caddyfile, config/mosquitto.conf, config/init-timescaledb.sql
cp .env.production.example .env.production
chmod 600 .env.production

# Edit .env.production to set production secrets:
#   PUBLIC_DOMAIN=ansatz.social
#   DOCS_DOMAIN=modelscript.org
#   PUBLIC_URL=https://ansatz.social
#   CORS_ALLOWED_ORIGINS=https://ansatz.social,https://modelscript.org,https://ide.ansatz.social,https://ide.modelscript.org
#   MSX_EDITION=ee
#   MSX_LICENSE_ENFORCE=true
#   MSX_LICENSE_KEY=<pre-minted modelscript-cloud-prod Ed25519 token>
#   JWT_SECRET=<production-64-char-hex-secret>
#   STRIPE_SECRET_KEY=sk_live_...
#   STRIPE_WEBHOOK_SECRET=whsec_...

# Pull prebuilt GHCR images and launch the production stack
docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production --profile federated pull

docker compose -f docker-compose.yml -f docker-compose.prod.yml \
  --env-file .env.production --profile federated up -d --wait --remove-orphans
```

#### C.2 Automated CI/CD Rollouts (`.github/workflows/ci.yml` & `.github/workflows/release.yml`)

Every push to `main` and every tagged release in GitHub Actions builds and pushes all 6 Docker images (`api`, `api-ce`, `web`, `cli`, `cli-ce`, `appliance`) to `ghcr.io/modelscript/*` (tagged with both `:sha-<commit>` / `:<version>` and `:latest`) and triggers the `deploy_production` rollout job under a shared `production-deploy` concurrency lock. Configure either SSH or Webhook secrets in GitHub repository settings:

| GitHub Secret                          | Description                                                                                  |
| :------------------------------------- | :------------------------------------------------------------------------------------------- |
| `PROD_SSH_HOST`                        | Hostname or IP of the shared `modelscript.org` / `ansatz.social` production server           |
| `PROD_SSH_USER`                        | Deployment SSH user (with `docker` group permissions)                                        |
| `PROD_SSH_KEY`                         | Ed25519 private SSH key for `PROD_SSH_USER`                                                  |
| `PROD_SSH_KNOWN_HOSTS` _(optional)_    | Pinned SSH host key entry for `PROD_SSH_HOST` (falls back to `ssh-keyscan` if omitted)       |
| `PROD_DEPLOY_PATH`                     | Directory on the production host (defaults to `/opt/modelscript`)                            |
| `PROD_ENV_FILE` _(optional)_           | Complete content of `.env.production` to automatically write and secure on the host          |
| `PROD_DEPLOY_WEBHOOK_URL` _(optional)_ | Webhook URL if triggering rollouts via an external orchestrator (Portainer / Coolify / Argo) |
| `PROD_DEPLOY_TOKEN` _(optional)_       | Bearer token for `PROD_DEPLOY_WEBHOOK_URL`                                                   |

#### C.3 Issuing & Verifying Customer License Keys (Maintainer Runbook)

The offline Ed25519 license keypair generator and token signer lives in `ee/src/cli/license-cli.ts`:

```bash
# 1. Generate a new Ed25519 keypair (stored in .keys/, which is gitignored)
npm run ee:keygen -- --out-dir=.keys

# 2. Mint a signed offline customer license token
npm run ee:sign-license -- \
  --private-key=.keys/msx-license-private.pem \
  --org="Acme Aerospace Corp" \
  --tier=appliance \
  --seats=100 \
  --days=365 \
  --out=.keys/acme-aerospace.license.json

# 3. Verify any license token offline against the embedded production public key
npm run ee:verify-license -- msx_lic_<PAYLOAD>.<SIGNATURE>
```
