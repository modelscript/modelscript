<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/ee` — ModelScript Enterprise Edition

`@modelscript/ee` contains the proprietary enterprise control-plane, air-gapped compliance appliance, and commercial licensing modules for ModelScript, licensed under `LicenseRef-ModelScript-Enterprise` (see [LICENSE](./LICENSE)).

All 44 engineering language compilers, WebAssembly GLR parsers, the `DAEBuilder` simulation arena, the Nelson-Oppen semantic theory coordinator, and the Community Edition server/CLI/IDE outside `ee/` remain 100% open source under **AGPL-3.0-or-later**.

---

## Architecture & Module Layout

| Batch / Subsystem                                             | Path                                                                                                                                                                         | License Feature Gate                                     | Description                                                                                                                                                                                                                                                                                               |
| :------------------------------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | :------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **License Core**                                              | [`src/license/verifier.ts`](./src/license/verifier.ts)<br>[`src/license/middleware.ts`](./src/license/middleware.ts)                                                         | `MSX_LICENSE_KEY`                                        | Zero-network Ed25519 cryptographic license token signing, verification, and Express middleware (`/api/v1/ee/license/status`)                                                                                                                                                                              |
| **Batch A: Air-Gap & Regulatory Compliance**                  | [`src/compliance/airgap.ts`](./src/compliance/airgap.ts)<br>[`src/compliance/dhf-attestation.ts`](./src/compliance/dhf-attestation.ts)                                       | `airgap_compliance`<br>`dhf_attestation`                 | Strict FERC CEII (`18 CFR § 388.113`) & NERC CIP CSP headers, `/api/v1/compliance/*` probes, and Ed25519-signed FDA 21 CFR Part 11 / IEEE 2800 / EN 14363 compliance attestations (`/api/v1/ee/compliance/attest`)                                                                                        |
| **Batch B: Corporate SSO & Organization RBAC**                | [`src/auth/oidc.ts`](./src/auth/oidc.ts)<br>[`src/auth/sso-governance.ts`](./src/auth/sso-governance.ts)                                                                     | `saml_oidc_sso`                                          | Enterprise OpenID Connect (OIDC) & SAML 2.0 federation (`OidcService`), JWKS verification, JIT Active Directory group-to-role provisioning, and `/api/v1/organizations` RBAC                                                                                                                              |
| **Batch C: Slurm HPC & Cloud Billing**                        | [`src/hpc-billing/hpc-governance.ts`](./src/hpc-billing/hpc-governance.ts)                                                                                                   | `slurm_hpc`                                              | Slurm `sbatch` HPC offload, Cloud CAE sweeps (`/api/v1/cae`, `/api/v1/cloud`), and Stripe Compute Credit Wallet (`/api/v1/billing`)                                                                                                                                                                       |
| **Batch D: Digital Twins & Enterprise Gateways**              | [`src/twins/twins-governance.ts`](./src/twins/twins-governance.ts)<br>[`src/interop/interop-governance.ts`](./src/interop/interop-governance.ts)                             | `digital_twins`<br>`sysml2_omg_api`<br>`mcp_sse_gateway` | Operational Digital Twins (`/api/v1/twins`), Hardware Birth Certificates (`/api/v1/instances`), TimescaleDB Historian (`/api/v1/historian`), OMG SysML v2 REST (`/api/v1/sysml2`), and Hosted MCP SSE Gateway (`/api/v1/mcp`)                                                                             |
| **Batch E: Digital Thread & Export Compliance**               | [`src/thread/thread-governance.ts`](./src/thread/thread-governance.ts)<br>[`src/compliance/export-control.ts`](./src/compliance/export-control.ts)                           | `digital_thread_governance`<br>`airgap_compliance`       | Cross-domain Digital Thread Hypergraph & OSLC Conflict Registry (`/api/v1/threads`) and ITAR / EAR / OFAC export-control enforcement                                                                                                                                                                      |
| **Batch F: Distributed Co-Simulation Master**                 | [`src/twins/twins-governance.ts`](./src/twins/twins-governance.ts)                                                                                                           | `digital_twins`                                          | Distributed MQTT / FMI 2.0 & 3.0 Co-Simulation Master Orchestrator (`/api/v1/cosim`, `/api/v1/mqtt/participants`)                                                                                                                                                                                         |
| **Batch G: Real-Time HIL & PLM Connectors**                   | [`src/hil-plm/hil-plm-governance.ts`](./src/hil-plm/hil-plm-governance.ts)                                                                                                   | `hil_codegen`<br>`plm_connectors`                        | Deterministic C99 / AUTOSAR / IEC 61131-3 / FMI binary codegen & OSLC / ReqIF / Simulink / ADAMS / GT-SUITE / PSS®E CLI & API gates (`/api/v1/ee/capabilities`, `/api/v1/ee/hil/*`, `/api/v1/ee/plm/*`)                                                                                                   |
| **Batch H: Admin Console, DevSecOps & Desktop**               | [`src/admin-devops/admin-devops-governance.ts`](./src/admin-devops/admin-devops-governance.ts)<br>[`src/desktop/desktop-compliance.ts`](./src/desktop/desktop-compliance.ts) | `airgap_compliance`<br>`plm_connectors`<br>`hil_codegen` | Enterprise Admin Console & SIEM audit exports (`/api/v1/admin/*`), signed CI/CD webhooks (`/api/v1/webhooks`), GitLab bridge (`/api/v1/git`, `/api/v1/gitlab`), W3C SPARQL 1.1 Knowledge Graph (`/api/v1/libraries/sparql`), and Air-Gapped Desktop & Black-Box Binary FMU gates (`/api/v1/ee/desktop/*`) |
| **Batch I: Multi-User Co-Editing, AI PR Reviews & AASX/KPAR** | [`src/collab-reviews/collab-reviews-governance.ts`](./src/collab-reviews/collab-reviews-governance.ts)                                                                       | `saml_oidc_sso`<br>`plm_connectors`<br>`sysml2_omg_api`  | Real-Time WebSocket Co-Editing & Symbol Collision Detection (`/api/v1/collab/stream`, `/api/v1/ee/collab/status`), Private Repository Visibility, Automated AI PR Reviews (`/api/v1/repos/:id/reviews`), and Industry 4.0 `.aasx` / OMG `.kpar` Digital Twin Archive Export                               |
| **Offline License Minting CLI**                               | [`src/cli/license-cli.ts`](./src/cli/license-cli.ts)                                                                                                                         | Ed25519 Private Key                                      | CLI tool (`npm run ee:keygen`, `npm run ee:sign-license`, `npm run ee:verify-license`) for generating Ed25519 keypairs and issuing offline `msx_lic_...` customer tokens                                                                                                                                  |
| **Appliance Deployment Manifests**                            | [`deploy/`](./deploy/)                                                                                                                                                       | `MSX_EDITION=ee`                                         | Hardened Docker Compose and Kubernetes manifests for zero-internet utility and defense deployments                                                                                                                                                                                                        |

---

## Edition Modes (`MSX_EDITION`)

| Environment Variable                               | Behavior                                                                                                                                                          |
| :------------------------------------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `MSX_EDITION=ee` _(default when `ee/` is present)_ | Mounts all `@modelscript/ee` subsystems (Batches A–I) into the API server, CLI, and Desktop Studio                                                                |
| `MSX_EDITION=ce`                                   | Pure AGPL-3.0 Community Edition mode; skips loading `@modelscript/ee` and returns HTTP `501 Not Implemented` on enterprise-only endpoints                         |
| `MSX_LICENSE_ENFORCE=true`                         | Enforces cryptographic Ed25519 validation of `MSX_LICENSE_KEY` and per-feature entitlements (`402 Payment Required` / `403 Forbidden` when unlicensed or expired) |

---

## Issuing & Verifying Customer Licenses

```bash
# 1. Generate a production Ed25519 license signing keypair (saved to gitignored .keys/)
npm run ee:keygen -- --out-dir=.keys

# 2. Mint an offline 1-year Enterprise Appliance license for 50 seats
npm run ee:sign-license -- --private-key=.keys/msx-license-private.pem --org="ERCOT Grid Operations" --tier=appliance --seats=50 --days=365

# 3. Verify a license token offline against the embedded production public key
npm run ee:verify-license -- msx_lic_...
```

---

## Container Images & Deployment Scenarios

CI ([`.github/workflows/ci.yml`](../.github/workflows/ci.yml)) and Release ([`.github/workflows/release.yml`](../.github/workflows/release.yml)) build and publish both **Community Edition (`-ce`)** and **Enterprise Edition** Docker images from the root [`Dockerfile`](../Dockerfile):

| Image                           | Target           |      `/app/ee` Included?       | Default Environment                                                                               | Use Case                                                            |
| :------------------------------ | :--------------- | :----------------------------: | :------------------------------------------------------------------------------------------------ | :------------------------------------------------------------------ |
| `ghcr.io/modelscript/api-ce`    | `api-ce`         | **No** _(physically stripped)_ | `MSX_EDITION=ce`                                                                                  | Self-hosted AGPL-3.0 Community Edition API                          |
| `ghcr.io/modelscript/cli-ce`    | `cli-ce`         | **No** _(physically stripped)_ | `MSX_EDITION=ce`                                                                                  | Open-core AGPL-3.0 CI/CD CLI runner                                 |
| `ghcr.io/modelscript/api`       | `api` (`api-ee`) |            **Yes**             | `MSX_EDITION=ee`, `MSX_LICENSE_ENFORCE=true`                                                      | `modelscript.org` Cloud & Corporate EE multi-container self-hosting |
| `ghcr.io/modelscript/cli`       | `cli` (`cli-ee`) |            **Yes**             | `MSX_EDITION=ee`, `MSX_LICENSE_ENFORCE=true`                                                      | Licensed Enterprise CI/CD & HIL codegen runner                      |
| `ghcr.io/modelscript/appliance` | `appliance`      |            **Yes**             | `MSX_EDITION=ee`, `MSX_LICENSE_ENFORCE=true`, `ENTERPRISE_APPLIANCE=true`, `AIRGAP_ENFORCED=true` | Single-container air-gapped Enterprise Intranet Appliance (`:8080`) |
| `ghcr.io/modelscript/web`       | `web`            |              N/A               | Nginx SPA (`/`) + VitePress Docs (`/docs`)                                                        | Unified Web UI & Documentation Portal                               |
| `ghcr.io/modelscript/ide`       | `ide`            |              N/A               | `PORT=3003` + local WebLLM weights                                                                | Browser WebAssembly & WebGPU IDE Workbench                          |

### 1. Self-Hosted Community Edition (`MSX_EDITION=ce`)

```bash
# Single container (physically excludes /app/ee)
docker run -d -p 3000:3000 -e JWT_SECRET="$(openssl rand -hex 32)" ghcr.io/modelscript/api-ce:latest

# Or full local stack via Docker Compose
MSX_EDITION=ce JWT_SECRET="$(openssl rand -hex 32)" docker compose --profile standalone up -d
```

### 2. Corporate Self-Hosted Enterprise Edition (`MSX_EDITION=ee`)

```bash
# Single-container Air-Gapped Intranet Appliance (port 8080)
MSX_LICENSE_KEY="msx_lic_<PAYLOAD>.<SIGNATURE>" JWT_SECRET="$(openssl rand -hex 32)" \
  docker compose --profile appliance up -d

# Or Kubernetes StatefulSet (with zero-egress NetworkPolicy)
kubectl apply -f ee/deploy/kubernetes-appliance.yaml
```

### 3. Official `modelscript.org` Cloud Production Stack

```bash
cp .env.production.example .env.production
# Populate JWT_SECRET, STRIPE_SECRET_KEY, STRIPE_WEBHOOK_SECRET in .env.production
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production --profile federated pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml --env-file .env.production --profile federated up -d --remove-orphans
```
