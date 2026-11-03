# Contributing to ModelScript

Thank you for your interest in contributing to **ModelScript**! This document covers local development setup, architectural guidelines, testing workflows, adding linter rules and domain languages, and release procedures.

---

## 1. Development Setup

### Prerequisites

- **Node.js** $\ge 24$ (see `.nvmrc`)
- **Git**
- _(Optional)_ **OpenModelica (`omc`)** — only required when regenerating ground-truth `.mo` baselines (`--update --omc`) or refreshing cached Modelica Standard Library (MSL) verification trajectories.
- _(Optional)_ **Docker** — only required for container builds (`npm run docker:build`) or local GitHub Actions execution via `act` (`npm run ci:act`).

### Quick Start

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
npm run build
```

### Common Commands

| Command                   | Description                                                                 |
| :------------------------ | :-------------------------------------------------------------------------- |
| `npm run doctor:dev`      | Inspect local toolchains, memory, and database readiness across all tracks  |
| `npm run dev:ansatz`      | Start Ansatz full-stack platform (API backend + Web frontend)               |
| `npm run dev:compiler`    | Watch and recompile core compiler & language packages                       |
| `npm run dev:cli`         | Start interactive ModelScript CLI (`msx`) development sandbox               |
| `npm run dev:docs`        | Start VitePress documentation portal on `localhost:5173`                    |
| `npm run build`           | Build all workspace packages in topological dependency order via Nx         |
| `npm run build:affected`  | Build only packages affected by current branch changes                      |
| `npm test`                | Run tests for affected packages via the RAM/CPU-aware `test-coordinator.js` |
| `npm run test:fast`       | Fast unit-test runner across affected packages                              |
| `npm run test:all`        | Run all unit and integration test suites across the monorepo                |
| `npm run lint`            | Run ESLint and repository policy linters on affected packages               |
| `npm run lint:all`        | Run ESLint, manifest, header, cycle, and type-safety ratchet checks         |
| `npm run typecheck`       | Run TypeScript `tsc --noEmit` across affected packages                      |
| `npm run verify:dist`     | Verify `package.json#exports` and `.wasm` asset parity in `dist/`           |
| `npm run verify:pack`     | Verify `npm pack` tarball completeness and isolated ESM consumer imports    |
| `npm run version:bump`    | Bump and synchronize all 73+ workspace manifests, Tauri, and source pins    |
| `npm run release:dry-run` | Preview the Smart Hybrid release version, changelog, and tag plan locally   |
| `npm run clean:scratch`   | Remove untracked `scratch*` directories and ephemeral debug logs            |
| `npm run format`          | Format code, JSON, and Markdown files with Prettier                         |

### Choose Your Development Track

The repository unifies compiler engineering with cloud and web platforms. Choose the track matching your focus:

- **Track A: Compiler & Domain Languages** (`languages/*`, `packages/dsl`, `packages/runtime`, `packages/simulate`)
  - Run `npm run dev:compiler` for incremental TypeScript watching.
  - Test individual models: `npm run test:single -- OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo`.
  - Conformance verification: `npm run test:modelica` or `npm run test:msl`.
- **Track B: Ansatz Platform & Web Applications** (`apps/web`, `apps/api`, `packages/embed`, `packages/react`)
  - Run `npm run dev:ansatz` (or `npm run dev`) to boot the API (port 3000) and Web App (port 3001).
  - Local database is automatically provisioned under `data/`.
  - Test platform services: `npm run test:platform`.
- **Track C: Documentation & Engineering Models** (`apps/docs`, `packages/examples/*`)
  - Run `npm run dev:docs` to preview the VitePress portal and interactive reference manual.
  - Validate documentation links: `npm run check --workspace=@modelscript/docs`.

---

## 2. Architecture & Engineering Principles

### Compilation Pipeline

ModelScript uses a single canonical, arena-native compilation and flattening pipeline:

```text
Source (.mo / domain file)
  → Native WASM GLR Parser (parser.wasm)
  → Linear Memory CST
  → SymbolIndexer → SymbolIndex (flat symbol table)
  → WorkspaceIndex → Unified Multi-File SymbolIndex
  → QueryEngine (Salsa incremental memoization: fetch → deep_verify → execute → backdate)
  → Static Linting (CompilerLint CST passes & Salsa lint__* query hooks)
  → Flattener (AssemblyScript WASM Kernel / TS Bridge) → DAEBuilder
  → Constant Folding → Alias Elimination → Tarjan BLT / Pantelides → Solvers / FMU / WebGPU
```

### Data-Oriented & Linear-Memory Rules

1. **Zero Intermediate AST Wrappers:** The compiler operates on a Struct-of-Arrays (SoA) architecture in WebAssembly linear memory (`DAEBuilder`, linear CST pointers). Do not allocate heavy intermediate TypeScript AST wrapper classes for expressions, equations, or flattening logic.
2. **Direct Lowering to DAE Arena:** Equations, expressions, and statements are lowered directly from linear memory parser nodes (`db.cstNode(symbolId)`) into `DAEBuilder` integer handles (`ExprId`, `EqId`, `StmtId`).
3. **Native WASM GLR Parsers:** All 44 domain languages use native WebAssembly GLR parsers (`parser.wasm`) compiled by `@modelscript/dsl` (`buildParser`). Never introduce external C/C++ parser bindings such as `tree-sitter`.
4. **Linter and Flattener Synchronization:** Keep frontend semantic diagnostics in the linter (`languages/*/src/lints/` or `queries.ts`) rather than moving checks into the flattener as a workaround.

### 4-Layer Architectural Taxonomy

The monorepo is organized into four distinct architectural layers to ensure clean separation of concerns:

| Layer                                | Workspaces & Directories                                                                                                               | Primary Responsibility                                                                                    |
| :----------------------------------- | :------------------------------------------------------------------------------------------------------------------------------------- | :-------------------------------------------------------------------------------------------------------- |
| **Layer 4: Enterprise**              | [`ee/`](./ee/)                                                                                                                         | Commercial enterprise edition, offline Ed25519 licensing, NERC CIP / isolated air-gap, FDA 21 CFR Part 11 |
| **Layer 3: Ansatz Platform**         | [`apps/web/`](./apps/web/), [`apps/api/`](./apps/api/), [`packages/embed/`](./packages/embed/), [`packages/react/`](./packages/react/) | Flagship web platform (`ansatz.social`), ActivityPub federation, package registry, Slurm HPC, billing     |
| **Layer 2: Developer Tooling**       | [`apps/cli/`](./apps/cli/), [`apps/ide/`](./apps/ide/), [`apps/desktop/`](./apps/desktop/), [`apps/docs/`](./apps/docs/)               | Unified CLI (`msx`), VS Code Web extension, Tauri desktop app, VitePress documentation portal             |
| **Layer 1: Core Engine & Languages** | [`languages/*`](./languages/), [`packages/{dsl,runtime,simulate,cad,diagram,exchange,lsp,mcp}`](./packages/)                           | 44 domain languages, WASM GLR parsers, linear DAE arena, numerical solvers, TGG graph rewriting, FMI/SSP  |

### Core Engine Workspaces

| Directory            | Purpose                                                                                                                                         |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dsl/`      | Grammar DSL combinators, WASM GLR parser compiler (`buildParser`), Triple Graph Grammars (TGG), Critical Pair Analysis (CPA), E-graph rewriting |
| `packages/runtime/`  | Linear-memory WebAssembly DAE arena (`DAEBuilder`), Salsa `QueryEngine`, `WorkspaceIndex`, BLT solver, Nelson-Oppen `TheoryCoordinator`         |
| `packages/simulate/` | Numerical integrators (SUNDIALS CVODE/IDA, BDF, DOPRI5), WebGPU batched solver, 3D FEA/CFD, surrogate ROMs, Monte Carlo                         |
| `packages/lsp/`      | Polyglot Language Server Protocol engine across all 44 languages and background worker pool                                                     |
| `packages/exchange/` | FMI 2.0/3.0 FMU export/import, SSP 1.0 container toolkit, `CoSimMaster`, AASX/DDP/OKH packaging                                                 |
| `packages/diagram/`  | Polyglot schematic layout (Sugiyama/TSM), Manhattan port routing, dark-mode SVG rendering                                                       |
| `packages/cad/`      | Constructive Solid Geometry (CSG), OpenCascade/Manifold B-Rep, STEP AP242 I/O, Gerber ECAD DRC                                                  |
| `languages/*`        | 44 engineering domain languages (Modelica, SysML v2, STEP, PSCAD, GENSYS, OLGA, SPICE, etc.)                                                    |

---

## 3. Testing & Conformance Workflows

### Monorepo Unit & Integration Tests (`test-coordinator.js`)

`npm test` invokes [`scripts/test-coordinator.js`](./scripts/test-coordinator.js), which inspects available CPU cores and free RAM to dynamically factorize task parallelism ($P$ concurrent Nx package targets $\times$ $W$ `node:test` workers per package) so WASM/V8 workers never exhaust system memory:

```bash
# Run tests for affected packages
npm test

# Run tests across all packages
npm run test:all

# Preview resource allocation and shard partitioning
node scripts/test-coordinator.js run-many --dry-run
```

### Modelica & OpenModelica (OMC) Conformance Suite

The Modelica test runner ([`languages/modelica/tests/testsuite-runner.ts`](./languages/modelica/tests/testsuite-runner.ts)) executes 2,600+ `.mo` conformance tests across TypeScript and WebAssembly flattening kernels. Note that arguments are directory or `.mo` file paths (there is no `--filter` flag):

```bash
# Run a single .mo conformance test
npm run test:single -- OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo

# Run an entire conformance subdirectory
npm run test:modelica -- OpenModelica/flattening/modelica/types

# Run dual differential verification (WASM vs JS flattener)
npm run test:modelica:both:allow-wasm

# Update expected output against local OpenModelica (omc) ground truth
npm run test:modelica:update -- OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo
```

### Modelica Standard Library (MSL 4.1.0) Benchmark Runner

The on-the-fly MSL verification suite ([`languages/modelica/tests/msl-comparison-runner.ts`](./languages/modelica/tests/msl-comparison-runner.ts)) validates DAE variable/equation parity, numerical trajectory RMSE, schematic layout, and icon rendering against `omc`:

```bash
npm run test:msl:flatten
npm run test:msl:sim -- --model=Modelica.Electrical.Analog.Examples.ChuaCircuit
npm run test:msl:diagram
npm run test:msl:icon -- --package=Modelica.Electrical.Analog.Basic
```

---

## 4. Adding Linter Rules & Domain Languages

### Adding a Modelica Linter Rule

1. **Define the Error Code** in [`languages/modelica/src/errors.ts`](./languages/modelica/src/errors.ts) using the standard numbering scheme (`1xxx` syntax, `2xxx` name resolution, `3xxx` type checking, `4xxx` structural/inheritance, `5xxx` equations/algorithms, `6xxx` clocks/state machines/EMT):
   - Mirror OpenModelica's diagnostic text, wrap identifiers in single quotes (`'${name}'`), and end with a period (`.`).
2. **Implement the Check:**
   - **CST Lints (`CompilerLint`):** Place syntax and local checks in `languages/modelica/src/lints/` and export in `languages/modelica/src/lints/index.ts`.
   - **Semantic / Salsa Lints:** Implement inter-procedural or hierarchy-dependent checks as `lint__<ruleName>` query hooks in `languages/modelica/src/queries.ts`.
3. **Add a `.mo` Regression Test** under `languages/modelica/testsuite/OpenModelica/flattening/`.

### Package Manifest & Hygiene Standards

Every workspace package under `apps/`, `packages/`, `languages/`, and `ee/` is verified in CI by [`scripts/lint-package-manifests.ts`](./scripts/lint-package-manifests.ts) and [`scripts/normalize-headers.ts`](./scripts/normalize-headers.ts):

- **SPDX License Header:** Open-core source files (`apps/`, `packages/`, `languages/`, `scripts/`) must begin with `// SPDX-License-Identifier: AGPL-3.0-or-later`. Enterprise Edition files (`ee/**`) must begin with `// SPDX-License-Identifier: LicenseRef-ModelScript-Enterprise`.
- **One-Way Open-Core Boundary:** Open-core libraries (`packages/*`, `languages/*`) must never import from `@modelscript/ee` or `ee/*` (enforced via ESLint `no-restricted-imports`).
- **Manifest Metadata:** Publishable open-core packages must declare `"license": "AGPL-3.0-or-later"`, a non-empty `"files"` whitelist, `"exports"` (or `"bin"` / `"main"`), and a `"modelscript"` maturity descriptor (`"tier": "stable" | "beta" | "preview"`). The private `@modelscript/ee` workspace declares `"license": "LicenseRef-ModelScript-Enterprise"` and `"private": true`.
- **No Private Dependencies:** Publishable packages must never depend on `"private": true` workspace packages in `"dependencies"`.
- **Dockerfile & README Parity:** Every workspace `package.json` must have a matching `COPY` entry in the root [`Dockerfile`](./Dockerfile), a non-empty workspace `README.md` with the standard 2-line UTF-8 header, and a link in the root [`README.md`](./README.md).
- **Type-Safety Ratchet:** Explicit `any` and `@ts-expect-error` counts in `src/` are governed by `npm run lint:types-ratchet` ([`config/type-safety-baseline.json`](./config/type-safety-baseline.json)) and must never increase.

---

## 5. Commit Messages & Pull Requests

Follow [Conventional Commits](https://www.conventionalcommits.org/) (enforced via Husky and Commitlint):

```text
feat: add simulation CSV export
fix: correct array dimension mismatch in flattener
docs: update CLI usage examples
refactor: simplify DAE printer ordering
```

Before opening a pull request, sign off your commits (`git commit -s`) in accordance with the [Contributor License Agreement (`CLA.md`)](./CLA.md) and run the local pre-flight checks:

```bash
npm run lint:all
npm run verify:dist
npm run verify:pack
npm test
```

---

## 6. Versioning & Making a Release

ModelScript uses a **fixed-version monorepo** strategy where all workspace packages (`packages/*`, `languages/*`, `apps/*`, `ee/`), the VS Code extension, Tauri desktop bundles (`tauri.conf.json`, `Cargo.toml`), VitePress documentation metadata, and runtime version constants share a single canonical `major.minor.patch` version synchronized by [`scripts/sync-versions.ts`](./scripts/sync-versions.ts) (enforced in CI via `npm run lint:versions` / `npm run lint:repo`).

> **Strict `X.Y.Z` Numeric SemVer Requirement:** Always use clean numeric `major.minor.patch` versions (e.g., `0.1.0`, `0.2.0`, `1.0.0`) without pre-release suffixes (`-alpha`, `-beta`, `-rc`). Both the Visual Studio Marketplace (`@vscode/vsce`) and native desktop bundlers (Windows MSI/NSIS and macOS `CFBundleShortVersionString` in Tauri) strictly reject hyphenated version strings.

### Two Supported Versioning Workflows (Smart Hybrid Pipeline)

The release orchestrator ([`scripts/ci-release-version.ts`](./scripts/ci-release-version.ts)) compares the version on disk (`packages/runtime/package.json`) against the latest Git release tag (`v*`), allowing you to use either workflow seamlessly:

#### Workflow A: Pre-Bump During Development (Milestone Cycle)

If you want `main` to reflect the upcoming version (`0.1.0`) while you land commits toward that milestone:

1. **Bump all workspace manifests early on `main`:**
   ```bash
   # Pass an explicit X.Y.Z version or a relative bump (patch | minor | major):
   npm run version:bump -- 0.1.0
   ```
   This updates all 73+ `package.json` manifests, `package-lock.json`, `Cargo.toml`, `tauri.conf.json`, VitePress language metadata, and embedded version constants (`ANSATZ_VERSION`, `SERVER_VERSION`, `workspaceVersion`).
2. **Commit and continue landing PRs/commits on `main`:**
   You can make as many additional commits as needed before tagging the release.
3. **Cut the release when ready:**
   Navigate to **Actions → Release → Run workflow** on GitHub and run with the default **`auto`** (or **`current`**) strategy. Because `diskVersion > latestGitTag`, the orchestrator detects the pre-bumped version and tags/publishes `v0.1.0` directly **without** double-bumping to `0.1.1` or `0.2.0`.

#### Workflow B: Release-Time Bump (Continuous Trunk)

If you prefer not to touch version numbers during development:

1. Leave `main` at the last released version (`vX.Y.Z`).
2. When ready to release, navigate to **Actions → Release → Run workflow** and select:
   - **`auto`** _(default)_: Computes the next SemVer version automatically from [Conventional Commits](https://www.conventionalcommits.org/) (`feat:` $\rightarrow$ `minor`, `fix:`/`perf:` $\rightarrow$ `patch`).
   - **`patch` / `minor` / `major`**: Applies an explicit relative SemVer bump from the latest `v*` Git tag.

### Idempotent Publishing & Retry Safety

If a release workflow run fails mid-flight (for example, due to a transient registry timeout), re-running the workflow with `auto` or `current` is **100% idempotent**:

- **No Empty Version Bumps:** [`scripts/ci-release-version.ts`](./scripts/ci-release-version.ts) detects when `CHANGELOG.md` and `package.json` already contain the target version and skips duplicate version increments.
- **Registry Deduplication:** `npm publish` checks `npm view @modelscript/runtime@<version>` before publishing, and both `@vscode/vsce publish --skip-duplicate` and `ovsx publish --skip-duplicate` gracefully skip if the extension version is already live.
- **Zero Duplicate CI Runs:** Pushing the `chore(release): publish <version>` commit to `main` automatically skips redundant test/build jobs in [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) since [`.github/workflows/release.yml`](./.github/workflows/release.yml) has already verified the tree.

### Required Repository Secrets

| Secret                               | Source                                                    | Purpose                                                |
| :----------------------------------- | :-------------------------------------------------------- | :----------------------------------------------------- |
| `NPM_TOKEN`                          | [npmjs.com](https://www.npmjs.com/settings/~/tokens)      | Publish `@modelscript/*` packages with provenance      |
| `VSCE_PAT`                           | [Azure DevOps](https://dev.azure.com/)                    | Publish VS Code extension to Visual Studio Marketplace |
| `OVSX_PAT`                           | [open-vsx.org](https://open-vsx.org/user-settings/tokens) | Publish VS Code extension to Open VSX                  |
| `DEPLOY_PAT`                         | GitHub Personal Access Token                              | Push version commits and signed release tags to `main` |
| `PROD_SSH_HOST` / `PROD_SSH_KEY`     | Production Host SSH Credentials                           | Roll out Docker Compose stack to production            |
| `PROD_ENV_FILE` _(optional)_         | Production Environment File Contents                      | Automatically provisions `.env.production` on host     |
| `GPG_PRIVATE_KEY` & `GPG_PASSPHRASE` | Maintainer GPG key                                        | Sign release commits and git tags                      |

### Triggering a Release

1. Preview the version resolution and changelog locally if desired:
   ```bash
   npm run release:dry-run
   ```
2. Navigate to **Actions → Release → Run workflow** on GitHub and choose the version strategy (`auto`, `current`, `patch`, `minor`, `major`).

---

## 7. Production Deployment & Cloud Node Bootstrapping

Production deployments (serving `modelscript.org` and the `ansatz.social` flagship network) are fully automated via [`.github/workflows/ci.yml`](./.github/workflows/ci.yml) (on push to `main`) and [`.github/workflows/release.yml`](./.github/workflows/release.yml).

### One-Time Prerequisites

1. **DNS (Namecheap or Domain Registrar):** Point an **A Record** (`@` and `www`) to your DigitalOcean Droplet's public IPv4 address for `ansatz.social` (and `modelscript.org`).
2. **Droplet Access & Firewall:** Ensure your SSH public key is added to `~/.ssh/authorized_keys` on the Droplet, and ensure ports `22`, `80` (HTTP), and `443` (HTTPS / HTTP/3) are open in the DigitalOcean firewall.
3. **Repository Secrets:** Configure the following in **GitHub → Settings → Secrets and variables → Actions**:
   - `PROD_SSH_HOST`: Droplet public IP
   - `PROD_SSH_USER`: SSH user (`root` or deployment user with Docker privileges)
   - `PROD_SSH_KEY`: Matching private SSH key
   - `PROD_DEPLOY_PATH`: Target directory (defaults to `/opt/modelscript`)
   - `PROD_ENV_FILE`: Complete `.env.production` file content (see template below)

### Production Environment Template (`PROD_ENV_FILE`)

```dotenv
# Domains & Public Routing (Caddy automatically provisions TLS for all comma-separated domains)
PUBLIC_DOMAIN=ansatz.social, www.ansatz.social, modelscript.org, www.modelscript.org
PUBLIC_URL=https://ansatz.social

# Node & Security
NODE_ENV=production
JWT_SECRET=replace_with_openssl_rand_hex_32

# Editions & Licensing
MSX_EDITION=ee
MSX_LICENSE_ENFORCE=false
# MSX_LICENSE_KEY=...

# ActivityPub Social Federation
FEDERATION_MODE=open

# Mailer & Notifications
EMAIL_FROM=noreply@ansatz.social
# SENDGRID_API_KEY=...

# AI Model Keys (optional)
# OPENAI_API_KEY=...
# GEMINI_API_KEY=...
```

### Automated CI/CD Execution

When code merges into `main` or a new release workflow is triggered, the GitHub Actions deployment runner automatically:

1. Connects to the host and ensures Docker and Docker Compose are installed (`which docker || curl -fsSL https://get.docker.com | sh`).
2. Creates the target directory and subdirectories (`mkdir -p ${TARGET_DIR}/config ${TARGET_DIR}/scripts ${TARGET_DIR}/backups`).
3. Securely writes `.env.production` from `PROD_ENV_FILE` (plus `OAUTH_*`, `RESEND_API_KEY`, and `ADMIN_INIT_PASSWORD` secrets) with `chmod 600`.
4. Copies `docker-compose.yml`, `docker-compose.prod.yml`, `config/*`, and operational scripts (`scripts/ops/*.sh`).
5. Executes [`scripts/ops/deploy.sh`](./scripts/ops/deploy.sh), which takes an atomic pre-deploy SQLite hot backup (`scripts/ops/backup.sh`), pulls pre-built images from `ghcr.io/modelscript/*`, launches the stack, verifies health probes across `api`, `modelscript.org`, and `ansatz.social`, and automatically rolls back if any health check fails.

---

## 8. Self-Hosting a Node via Cloudflare Tunnels (Zero Open Ports)

If you are hosting a federated node from a home lab, university workstation, cloud VPS, or behind corporate firewalls/CGNAT where opening inbound ports `80` and `443` is not possible or desirable:

### 1. Deployment Profile Sizing Matrix

Choose the profile that matches your resource constraints and use case:

| Profile                   | Active Services                                             | Target Environment                                                 | Database Engine                     | RAM Footprint |
| :------------------------ | :---------------------------------------------------------- | :----------------------------------------------------------------- | :---------------------------------- | :------------ |
| **`flagship`**            | `caddy`, `web`, `api` (EE), `tunnel`                        | `modelscript.org` + `ansatz.social` standard cloud cluster         | **SQLite WAL only**                 | **~1.5–2 GB** |
| **`flagship-historian`**  | `caddy`, `web`, `api` (EE), `timescaledb`, `mqtt`, `tunnel` | Flagship cluster with experimental co-sim & telemetry historian    | SQLite WAL + TimescaleDB            | ~4–8 GB       |
| **`federated`**           | `caddy`, `web`, `api`, `tunnel`                             | Standard federated node (lightweight, zero telemetry dependencies) | **SQLite WAL only**                 | **~1–2 GB**   |
| **`federated-historian`** | `caddy`, `web`, `api`, `timescaledb`, `mqtt`, `tunnel`      | Research lab with live simulation telemetry streaming              | SQLite WAL + TimescaleDB            | ~4 GB         |
| **`corporate`**           | `caddy`, `web`, `api` (EE), `timescaledb` (optional)        | Enterprise intranet, air-gapped enclave, SSO allowlist             | SQLite WAL (+ optional TimescaleDB) | ~2–4 GB       |
| **`quick-tunnel`**        | `caddy`, `web`, `api`, `quick-tunnel`                       | Instant zero-config demo with ephemeral `trycloudflare.com` URL    | SQLite WAL only                     | ~1.5 GB       |

### 2. Production Token-Driven Tunnel (Zero Open Inbound Ports)

1. Create a free tunnel in the [Cloudflare Zero Trust Dashboard](https://one.dash.cloudflare.com/) (**Networks → Tunnels → Create Tunnel**).
2. Route your domain (e.g., `node.yourdomain.com`) to `http://caddy:80`.
3. Add your tunnel token to `.env` (or `.env.production`):
   ```bash
   CLOUDFLARE_TUNNEL_TOKEN="eyJh..."
   ```
4. Boot the node with your chosen profile:

   ```bash
   # Standard lightweight flagship node (1.5–2 GB RAM, embedded SQLite only):
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
     --env-file .env.production --profile flagship up -d

   # Full research lab node with experimental co-simulation telemetry historian:
   docker compose --profile federated-historian up -d

   # Flagship production cluster with co-simulation & telemetry historian:
   docker compose -f docker-compose.yml -f docker-compose.prod.yml \
     --env-file .env.production --profile flagship-historian up -d
   ```

   _Note:_ To enable Cloudflare Zero Trust Tunnel ingress, pass `--profile tunnel` (or use `--profile federated-tunnel` / `--profile flagship-tunnel`) alongside your primary profile when booting the stack.

### 3. Ephemeral Quick Tunnels (Local Dev & 1-Click ActivityPub Testing)

For local development or testing ActivityPub federation between machines without a custom domain or Cloudflare account:

```bash
docker compose --profile quick-tunnel up
```

`cloudflared` will automatically provision a public `https://<random>.trycloudflare.com` URL that forwards external ActivityPub inbox requests directly to your local Caddy router.

### 4. Headless Preinstallation vs. First-Run Install Wizard

- **Federated Nodes (`tier1_federated`):** If no database exists, opening your domain in a browser automatically launches the guided **First-Run Install Wizard (`/setup`)**. Follow the 4-step wizard to create the founding admin and configure federation policies.
- **Flagship & Headless Corporate (`tier3_flagship` / `tier2_corporate`):** Provide `ADMIN_INIT_USERNAME`, `ADMIN_INIT_PASSWORD`, and `DEPLOYMENT_PRESET=tier3_flagship` (or `tier2_corporate`) in your `.env`. The instance bootstraps and locks the setup wizard on first boot with zero human interaction required.
