<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/api

Backend REST, GraphQL, SPARQL, Git Smart HTTP, ActivityPub federation, and MCP SSE gateway server for **Ansatz** (`ansatz.social`) and **ModelScript** (`modelscript.org`). Provides endpoints for polyglot package management, simulation, co-simulation orchestration, OMG SysML v2 REST interoperability, Digital Thread governance, Operational Digital Twins, Slurm HPC & CAE compute dispatch, billing, and white-label enterprise authentication.

---

## Scripts

| Command                 | Description                                                                            |
| ----------------------- | -------------------------------------------------------------------------------------- |
| `pnpm run build`        | Compile TypeScript to `dist/`                                                          |
| `pnpm run clean`        | Remove `dist/` output                                                                  |
| `pnpm run dev`          | Start development server on port **3000** with auto-seeding                            |
| `pnpm run dev:flagship` | Start Tier-3 flagship dev server with admin auto-seeding, stdlib, and OpenAlex seeding |
| `pnpm run lint`         | Run ESLint across `src/`, `tests/`, and `scripts/`                                     |
| `pnpm run test`         | Run API unit and integration test suites                                               |
| `pnpm run typecheck`    | Run TypeScript type checking (`tsc --noEmit`)                                          |
| `pnpm run watch`        | Compile TypeScript in watch mode                                                       |

---

## Running

```bash
pnpm --filter @modelscript/api run dev
# Or with flagship tier seeding:
pnpm --filter @modelscript/api run dev:flagship
```

The API server starts on `http://localhost:3000` (with WebSocket co-simulation streaming at `/api/v1/cosim/stream` and collaborative editing at `/api/v1/collab/stream`).

---

## API Routes & Endpoints

### 1. Package Registry, Semantic Lenses & Industrial Exports

| Endpoint                                       | Description                                                                                      |
| ---------------------------------------------- | ------------------------------------------------------------------------------------------------ |
| `/api/v1/libraries`                            | List, search, publish, and manage versioned ModelScript / Modelica / SysML libraries             |
| `/api/v1/libraries/:name/:version/graphql`     | Per-package GraphQL schema and query endpoint for classes, components, and equations             |
| `/api/v1/libraries/:name/:version/rdf`         | RDF (Turtle / N-Triples / JSON-LD) ontology and linked-data export for a library version         |
| `/api/v1/libraries/:name/:version/sparql`      | Comunica-powered SPARQL query endpoint over library RDF graphs (also `/api/v1/libraries/sparql`) |
| `/api/v1/libraries/:name/:version/manifest`    | Canonical workspace manifest (`modelscript.json` / variant lens resolution)                      |
| `/api/v1/libraries/:name/:version/export/aasx` | Industrial Digital Twin Asset Administration Shell (IDTA OPC/AASX) package export                |
| `/api/v1/libraries/:name/:version/export/okh`  | Open Know-How (OKH / DIN SPEC 3105) hardware manifest export                                     |
| `/api/v1/npm` & `/registry`                    | npm-compatible package registry & authentication endpoints (`npm-registry.ts`, `npm-auth.ts`)    |
| `/git/:namespace/:project`                     | Built-in Git Smart HTTP server (`info/refs`, `git-upload-pack`, `git-receive-pack`)              |

### 2. AI Agent Gateway & Systems Engineering Standards

| Endpoint         | Description                                                                                                  |
| ---------------- | ------------------------------------------------------------------------------------------------------------ |
| `/api/v1/mcp`    | Model Context Protocol (MCP) Server-Sent Events (SSE) gateway exposing compiler, simulation, and V&V tools   |
| `/api/v1/ai`     | AI assistant completions, model diagnostics assistance, and code generation (`ai.ts`)                        |
| `/api/v1/sysml2` | OMG Systems Modeling API and Services (SysML v2 REST API, `ptc/2024-02-03`) & GraphQL (`sysml2-graphql.ts`)  |
| `/api/v1/alm`    | Application Lifecycle Management (ALM) remote synchronization (DOORS Next, Jama, Codebeamer, Polarion, Jira) |

### 3. Simulation, Co-Simulation, CAE & Cloud HPC

| Endpoint                    | Description                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `/api/v1/simulate`          | Execute DAE simulations, parameter sweeps, and return trajectory series                         |
| `/api/v1/pscad`             | PSCAD EMT simulation, IEEE 2800-2022 screening, and waveform analysis (`pscad.ts`)              |
| `/api/v1/fmus`              | FMI 2.0/3.0 FMU extraction, inspection, and Surrogate Reduced Order Model (ROM) synthesis       |
| `/api/v1/cosim`             | Distributed FMI / MQTT co-simulation session orchestration and `/api/v1/cosim/stream` WebSocket |
| `/api/v1/mqtt/participants` | Live MQTT Unified Namespace (UNS) participant discovery and status                              |
| `/api/v1/historian`         | TimescaleDB time-series telemetry historian queries and replay                                  |
| `/api/v1/cloud`             | Slurm HPC cluster job dispatch, compute profiles, live job telemetry, and artifact retrieval    |
| `/api/v1/cae`               | Continuum FEA (CalculiX) and CFD (SU2) cloud solver sweeps and mesh discretization jobs         |
| `/api/v1/physics`           | Multi-physics coupled study execution and 3D field result streaming                             |
| `/api/v1/jobs` & `/studies` | Asynchronous background job queue, executable scripts, and parametric study orchestration       |

### 4. Digital Thread, Workspaces, Supply Chain & Collaboration

| Endpoint                          | Description                                                                                              |
| --------------------------------- | -------------------------------------------------------------------------------------------------------- |
| `/api/v1/threads`                 | Digital Thread hypergraph explorer, cross-domain traceability links, and hash-chained audit governance   |
| `/api/v1/twins`                   | Operational Digital Twin definitions, virtual sensor bindings, and anomaly detection rules               |
| `/api/v1/instances`               | Live serialized asset instances, real-time state estimation, and TimescaleDB telemetry synchronization   |
| `/api/v1/spaces`                  | Collaborative engineering Spaces, SysML v2 space bindings (`spaces-sysml2.ts`), and RFQ workflows        |
| `/api/v1/solutions`               | Curated multi-domain engineering solutions and verification packs (`solutions.ts`)                       |
| `/api/v1/repos`                   | Hosted Git repositories, branch inspection, and pull-request review endpoints (`repos.ts`, `git.ts`)     |
| `/api/v1/supply-chain`            | Component sourcing, BOM supply-chain tracking, and RFQ procurement (`supply-chain.ts`, `rfq.ts`)         |
| `/api/v1/references` & `/sources` | Scholarly citations, OpenAlex bibliographic sources, and verification evidence (`references.ts`)         |
| `/api/v1/search` & `/storage`     | Full-text cross-entity search (`search.ts`) and object/artifact blob storage (`storage.ts`)              |
| `/vscode/workbench`               | Integrated VS Code Web IDE workbench host (`ide-workbench.ts`) and real-time co-editing (`collab-ws.ts`) |

### 5. Authentication, Organizations, Billing, Discovery & Platform Governance

| Endpoint                     | Description                                                                                           |
| ---------------------------- | ----------------------------------------------------------------------------------------------------- |
| `/api/v1/auth`               | Registration, login, session management, email verification, and password reset                       |
| `/api/v1/auth/2fa`           | Time-based One-Time Password (TOTP) two-factor authentication setup, verification, and backup codes   |
| `/api/v1/auth/oidc`          | Enterprise OpenID Connect (OIDC) / SSO authentication flows                                           |
| `/api/v1/users`              | User profiles, automated CI bot tokens (`/users/me/bots`), and cryptographic signing keys             |
| `/api/v1/organizations`      | Multi-tenant organization management, teams, member roles, and namespace access control               |
| `/api/v1/billing`            | Stripe subscription checkout, invoicing, and HPC compute credit wallet management                     |
| `/api/v1/provisioning`       | Self-hosted / tenant instance setup wizard and waitlist onboarding (`provisioning.ts`, `waitlist.ts`) |
| `/api/v1/webhooks` & `/push` | Outbound & inbound webhooks with HMAC verification (`webhooks.ts`) and Web Push notifications         |
| `/api/v1/flags`              | User-scoped feature flag evaluation (`mcp_gateway_sse`, `cae_cloud_solver`, `sysml2_omg_api`, etc.)   |
| `/api/v1/social`             | Federated engineering social feed, interactive artifact views, and ActivityPub federation             |
| `/api/v1/og` & `/oembed`     | OpenGraph social preview cards, oEmbed discovery, XML sitemaps, and LLM markdown mirrors              |
| `/api/v1/admin/*`            | Enterprise admin console, SIEM audit logs, and instance governance (`admin.ts`)                       |
| `/api/v1/compliance/*`       | Export compliance readiness probe (`/api/v1/compliance/readiness`), AGPLv3 § 13 disclosure, and GDPR  |

---

## Docker

The API is available as a Docker service:

```bash
docker compose up api
```

Exposes port **3000**.
