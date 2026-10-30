<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/api

Backend REST, GraphQL, SPARQL, Git Smart HTTP, ActivityPub federation, and MCP SSE gateway server for **Ansatz** (`ansatz.social`) and **ModelScript** (`modelscript.org`). Provides endpoints for polyglot package management, simulation, co-simulation orchestration, OMG SysML v2 REST interoperability, Digital Thread governance, Operational Digital Twins, Slurm HPC & CAE compute dispatch, billing, and white-label enterprise authentication.

---

## Scripts

| Command             | Description                                                 |
| ------------------- | ----------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                               |
| `npm run clean`     | Remove `dist/` output                                       |
| `npm run dev`       | Start development server on port **3000** with auto-seeding |
| `npm run lint`      | Run ESLint across `src/`, `tests/`, and `scripts/`          |
| `npm run test`      | Run API unit and integration test suites                    |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`)               |
| `npm run watch`     | Compile TypeScript in watch mode                            |

---

## Running

```bash
npm run dev
```

The API server starts on `http://localhost:3000` (with WebSocket co-simulation streaming at `/api/v1/cosim/stream`).

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
| `/git/:namespace/:project`                     | Built-in Git Smart HTTP server (`info/refs`, `git-upload-pack`, `git-receive-pack`)              |

### 2. AI Agent Gateway & Systems Engineering Standards

| Endpoint         | Description                                                                                                     |
| ---------------- | --------------------------------------------------------------------------------------------------------------- |
| `/api/v1/mcp`    | Model Context Protocol (MCP) Server-Sent Events (SSE) gateway exposing compiler, simulation, and V&V tools      |
| `/api/v1/sysml2` | OMG Systems Modeling API and Services (SysML v2 REST API, `ptc/2024-02-03`) for projects, commits, and elements |

### 3. Simulation, Co-Simulation, CAE & Cloud HPC

| Endpoint                    | Description                                                                                     |
| --------------------------- | ----------------------------------------------------------------------------------------------- |
| `/api/v1/simulate`          | Execute DAE simulations, parameter sweeps, and return trajectory series                         |
| `/api/v1/fmus`              | FMI 2.0/3.0 FMU extraction, inspection, and Surrogate Reduced Order Model (ROM) synthesis       |
| `/api/v1/cosim`             | Distributed FMI / MQTT co-simulation session orchestration and `/api/v1/cosim/stream` WebSocket |
| `/api/v1/mqtt/participants` | Live MQTT Unified Namespace (UNS) participant discovery and status                              |
| `/api/v1/historian`         | TimescaleDB time-series telemetry historian queries and replay                                  |
| `/api/v1/cloud`             | Slurm HPC cluster job dispatch, compute profiles, live job telemetry, and artifact retrieval    |
| `/api/v1/cae`               | Continuum FEA (CalculiX) and CFD (SU2) cloud solver sweeps and mesh discretization jobs         |
| `/api/v1/physics`           | Multi-physics coupled study execution and 3D field result streaming                             |
| `/api/v1/jobs`              | Asynchronous background job queue status and script execution                                   |

### 4. Digital Thread & Operational Digital Twins

| Endpoint            | Description                                                                                            |
| ------------------- | ------------------------------------------------------------------------------------------------------ |
| `/api/v1/threads`   | Digital Thread hypergraph explorer, cross-domain traceability links, and hash-chained audit governance |
| `/api/v1/twins`     | Operational Digital Twin definitions, virtual sensor bindings, and anomaly detection rules             |
| `/api/v1/instances` | Live serialized asset instances, real-time state estimation, and TimescaleDB telemetry synchronization |

### 5. Authentication, Organizations, Billing & Platform Governance

| Endpoint                | Description                                                                                          |
| ----------------------- | ---------------------------------------------------------------------------------------------------- |
| `/api/v1/auth`          | Registration, login, session management, email verification, and password reset                      |
| `/api/v1/auth/2fa`      | Time-based One-Time Password (TOTP) two-factor authentication setup, verification, and backup codes  |
| `/api/v1/auth/oidc`     | Enterprise OpenID Connect (OIDC) / SSO authentication flows                                          |
| `/api/v1/users/me/bots` | Automated service / CI bot account provisioning and scoped API token management                      |
| `/api/v1/organizations` | Multi-tenant organization management, teams, member roles, and namespace access control              |
| `/api/v1/billing`       | Stripe subscription checkout, invoicing, and HPC compute credit wallet management                    |
| `/api/v1/webhooks`      | Outbound & inbound repository/registry webhooks with HMAC signature verification                     |
| `/api/v1/flags`         | User-scoped feature flag evaluation (`mcp_gateway_sse`, `cae_cloud_solver`, `sysml2_omg_api`, etc.)  |
| `/api/v1/social`        | Federated engineering social feed, interactive artifact views, and ActivityPub federation            |
| `/api/v1/compliance/*`  | Export compliance readiness probe (`/api/v1/compliance/readiness`), AGPLv3 § 13 disclosure, and GDPR |

---

## Docker

The API is available as a Docker service:

```bash
docker compose up api
```

Exposes port **3000**.
