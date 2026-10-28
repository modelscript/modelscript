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

| Command                  | Description                                                                 |
| :----------------------- | :-------------------------------------------------------------------------- |
| `npm run dev`            | Start all development services concurrently (API, Web, IDE, Docs)           |
| `npm run build`          | Build all workspace packages in topological dependency order via Nx         |
| `npm run build:affected` | Build only packages affected by current branch changes                      |
| `npm test`               | Run tests for affected packages via the RAM/CPU-aware `test-coordinator.js` |
| `npm run test:all`       | Run all unit and integration test suites across the monorepo                |
| `npm run lint`           | Run ESLint and repository policy linters on affected packages               |
| `npm run lint:all`       | Run ESLint, manifest, header, cycle, and type-safety ratchet checks         |
| `npm run typecheck`      | Run TypeScript `tsc --noEmit` across affected packages                      |
| `npm run verify:dist`    | Verify `package.json#exports` and `.wasm` asset parity in `dist/`           |
| `npm run verify:pack`    | Verify `npm pack` tarball completeness and isolated ESM consumer imports    |
| `npm run clean:scratch`  | Remove untracked `scratch*` directories and ephemeral debug logs            |
| `npm run format`         | Format code, JSON, and Markdown files with Prettier                         |

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

### Key Monorepo Workspaces

| Directory            | Purpose                                                                                                                                                                                         |
| :------------------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `packages/dsl/`      | Grammar DSL combinators, WASM GLR parser compiler (`buildParser`), Triple Graph Grammars (TGG), Critical Pair Analysis (CPA), E-graph rewriting                                                 |
| `packages/runtime/`  | Linear-memory WebAssembly DAE arena (`DAEBuilder`), Salsa `QueryEngine`, `WorkspaceIndex`, BLT solver, Nelson-Oppen `TheoryCoordinator`                                                         |
| `packages/simulate/` | Numerical integrators (SUNDIALS CVODE/IDA, BDF, DOPRI5), WebGPU batched solver, 3D FEA/CFD, surrogate ROMs, Monte Carlo                                                                         |
| `packages/lsp/`      | Polyglot Language Server Protocol engine across all 44 languages and background worker pool                                                                                                     |
| `packages/exchange/` | FMI 2.0/3.0 FMU export/import, SSP 1.0 container toolkit, `CoSimMaster`, AASX/DDP/OKH packaging                                                                                                 |
| `packages/diagram/`  | Polyglot schematic layout (Sugiyama/TSM), Manhattan port routing, dark-mode SVG rendering                                                                                                       |
| `packages/cad/`      | Constructive Solid Geometry (CSG), OpenCascade/Manifold B-Rep, STEP AP242 I/O, Gerber ECAD DRC                                                                                                  |
| `languages/*`        | 44 engineering domain languages (Modelica, SysML v2, STEP, PSCAD, GENSYS, OLGA, SPICE, etc.)                                                                                                    |
| `apps/*`             | CLI (`@modelscript/cli`), API server (`@modelscript/api`), Web IDE (`@modelscript/ide`), Web platform (`@modelscript/web`), Desktop Studio (`@modelscript/desktop`), Docs (`@modelscript/docs`) |

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

## 6. Making a Release

Releases are triggered manually via GitHub Actions ([`.github/workflows/release.yml`](./.github/workflows/release.yml)), which versions all publishable packages, generates changelogs, signs git tags with GPG, and publishes with npm provenance.

### Required Repository Secrets

| Secret                               | Source                                                    | Purpose                                                |
| :----------------------------------- | :-------------------------------------------------------- | :----------------------------------------------------- |
| `NPM_TOKEN`                          | [npmjs.com](https://www.npmjs.com/settings/~/tokens)      | Publish `@modelscript/*` packages with provenance      |
| `VSCE_PAT`                           | [Azure DevOps](https://dev.azure.com/)                    | Publish VS Code extension to Visual Studio Marketplace |
| `OVSX_PAT`                           | [open-vsx.org](https://open-vsx.org/user-settings/tokens) | Publish VS Code extension to Open VSX                  |
| `DEPLOY_PAT`                         | GitHub Personal Access Token                              | Push version commits and signed release tags to `main` |
| `PROD_SSH_HOST` / `PROD_SSH_KEY`     | Production Host SSH Credentials                           | Roll out Docker Compose stack to `modelscript.org`     |
| `GPG_PRIVATE_KEY` & `GPG_PASSPHRASE` | Maintainer GPG key                                        | Sign release commits and git tags                      |

### Triggering a Release

1. Preview locally if desired: `npm run release:dry-run`
2. Navigate to **Actions → Release → Run workflow** on GitHub and choose the semver bump (`patch`, `minor`, `major`, `prepatch`, `preminor`, `premajor`).
