# Platform Administration & Enterprise Hub Guide

The **ModelScript Enterprise Hub** (`@modelscript/api` and `@modelscript/web`) provides a self-hostable or cloud-managed control plane for polyglot package management, Git Smart HTTP hosting, OMG SysML v2 / Semantic Web APIs, Slurm HPC simulation offload, operational digital twins, and cryptographically verifiable regulatory compliance.

---

## 1. Administrative Console & Role-Based Access Control (RBAC)

Access to the Platform Administration Console (`/admin`) and `/api/v1/admin/*` endpoints is strictly enforced via JWT authentication and role-based middleware (`requireAdmin`):

- **`admin`**: Full platform superuser privileges (user moderation, runtime feature flag mutation, system maintenance windows, compute wallet minting, and audit log verification).
- **`moderator`**: Read/moderation access to public registry packages, flagged comments, and community discussions.
- **`user` / Organization Roles (`owner`, `admin`, `member`, `billing`, `viewer`)**: Scoped access within `/api/v1/organizations/:org` namespaces.

### User & Account Governance (`/api/v1/admin/users`)

Platform administrators can search, filter, and manage user accounts via the Admin Console or REST API:

- **Role Assignment (`PATCH /api/v1/admin/users/:id/role`)**: Promote or demote accounts between `user`, `moderator`, and `admin`. Self-demotion by the active administrator is blocked to prevent accidental lockout.
- **Account Suspension (`POST /api/v1/admin/users/:id/suspend` & `/unsuspend`)**: Immediately revokes active JWT refresh tokens, blocks package publishing, and halts running cloud HPC jobs while preserving historical audit trails.
- **Platform Telemetry (`GET /api/v1/admin/stats`)**: Real-time metrics covering total registered users, published package versions, active Co-Simulation sessions, cloud HPC queue depth, and object storage consumption.

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
- **`POST /api/v1/mcp/messages`**: Dispatches any of the [29 MCP engineering tools](../reference/mcp-and-ide.md) inside sandboxed worker isolates with automatic compute credit metering and full audit-ledger logging of every AI tool invocation.
