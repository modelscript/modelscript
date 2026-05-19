<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-red?logo=github)](https://github.com/sponsors/nachawati)
[![CI/CD](https://github.com/modelscript/modelscript/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/modelscript/modelscript/actions/workflows/ci.yml)
[![npm @modelscript/core](https://img.shields.io/npm/v/@modelscript/core?label=core)](https://www.npmjs.com/package/@modelscript/core)
[![npm @modelscript/cli](https://img.shields.io/npm/v/@modelscript/cli?label=cli)](https://www.npmjs.com/package/@modelscript/cli)
[![npm @modelscript/tree-sitter-modelica](https://img.shields.io/npm/v/@modelscript/tree-sitter-modelica?label=tree-sitter-modelica)](https://www.npmjs.com/package/@modelscript/tree-sitter-modelica)
[![Docker API](https://img.shields.io/badge/ghcr.io-api-blue?logo=docker)](https://ghcr.io/modelscript/api)
[![Docker Morsel](https://img.shields.io/badge/ghcr.io-morsel-blue?logo=docker)](https://ghcr.io/modelscript/morsel)
[![Docker Web](https://img.shields.io/badge/ghcr.io-web-blue?logo=docker)](https://ghcr.io/modelscript/web)
[![Docker IDE](https://img.shields.io/badge/ghcr.io-ide-blue?logo=docker)](https://ghcr.io/modelscript/ide)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/modelscript.modelscript?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript)
[![Open VSX](https://img.shields.io/open-vsx/v/modelscript/modelscript?label=Open%20VSX&logo=eclipseide)](https://open-vsx.org/extension/modelscript/modelscript)

ModelScript is a completely web-native, polyglot incremental compiler supporting multiple engineering domains — from requirements and system architecture to simulation, CAD, CAE, and manufacturing. By natively supporting **Modelica**, **SysML v2**, and **STEP**, ModelScript enables seamless cross-domain simulation-based requirements verification.

Designed for modern workflows, it features a robust engine for incremental compilation and flattening, seamless FMU import/export and integration, surrogate ROM generation from FMUs, as well as advanced model optimization and parameter calibration. All of this is accessible directly in the browser or via the command line.

## Architecture Highlights

- **Salsa-Based Incremental Compiler**: Powered by a query-based incremental compilation architecture (inspired by Rust's Salsa). ModelScript caches intermediate representations and only recompiles what has changed, enabling instantaneous feedback in the IDE.
- **Arena Data-Oriented Simulator**: The simulator utilizes a zero-garbage, Data-Oriented Design (DoD) architecture (`ArenaDAEBuilder`). By moving from legacy recursive AST visitors to direct flat-buffer indexing, it provides high-performance equation sorting, Pantelides index reduction, and bipartite matching with zero allocation overhead.
- **Polyglot & Cross-Domain**: Unified AST querying and cross-language interoperability between Modelica (Simulation), SysML v2 (Architecture/Requirements), and STEP (CAD/Manufacturing).

## Monorepo Structure

This project is a monorepo managed with **Lerna**, **Nx**, and **npm workspaces**. The structure reflects our transition to a fully modular, high-performance compiler and simulator architecture.

### Packages (`packages/`)

| Package                                           | Description                                                                         |
| ------------------------------------------------- | ----------------------------------------------------------------------------------- |
| [`@modelscript/compiler`](./packages/compiler/)   | Salsa-based query engine for incremental compilation, type checking, and flattening |
| [`@modelscript/simulator`](./packages/simulator/) | DoD Arena-based simulator — zero-garbage Pantelides index reduction & BLT ordering  |
| [`@modelscript/symbolics`](./packages/symbolics/) | Symbolic manipulation engine (differentiation, simplification) native to the Arena  |
| [`@modelscript/optimizer`](./packages/optimizer/) | Direct collocation optimizer for optimal control problems                           |
| [`@modelscript/fmi`](./packages/fmi/)             | Functional Mock-up Interface (FMI) support and Surrogate ROM generation             |
| [`@modelscript/cosim`](./packages/cosim/)         | Co-simulation orchestration and SSP archive generation                              |
| [`@modelscript/ecad`](./packages/ecad/)           | ECAD integration utilities for ModelScript                                          |
| [`@modelscript/interop`](./packages/interop/)     | Interoperability utilities connecting Modelica, SysML v2, and STEP models           |
| [`@modelscript/diagram`](./packages/diagram/)     | Diagram rendering, interactive SVG generation, and X6-based visual layouts          |
| [`@modelscript/lsp`](./packages/lsp/)             | Language Server Protocol — completions, hover, diagnostics, formatting, colors      |
| [`@modelscript/mcp`](./packages/mcp/)             | Model Context Protocol implementation for AI/LLM integration                        |
| [`@modelscript/utils`](./packages/utils/)         | Common utility functions across the monorepo                                        |

### Languages (`languages/`)

| Package                                          | Description                                                                 |
| ------------------------------------------------ | --------------------------------------------------------------------------- |
| [`@modelscript/modelica`](./languages/modelica/) | Tree-sitter grammar (native + WASM) and language configuration for Modelica |
| [`@modelscript/sysml2`](./languages/sysml2/)     | SysML v2 tree-sitter AST querying, handling, and verification               |
| [`@modelscript/step`](./languages/step/)         | STEP (ISO 10303) grammar and querying for CAD/CAE interoperability          |
| [`@modelscript/example`](./languages/example/)   | Example language configuration illustrating how to add new languages        |

### Applications (`apps/` & `extensions/`)

| Package                                       | Description                                                                        |
| --------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@modelscript/cli`](./apps/cli/)             | `msc` command-line interface — flatten, simulate, optimize, lint, render, and more |
| [`@modelscript/api`](./apps/api/)             | REST API server — simulation, publishing, GraphQL, SPARQL, and RDF                 |
| [`@modelscript/morsel`](./apps/morsel/)       | Visual editor — code editing, diagram viewer, simulation, and plotting             |
| [`@modelscript/web`](./apps/web/)             | Web frontend for browsing and exploring libraries (NPM-style registry)             |
| [`@modelscript/ide`](./apps/ide/)             | VS Code Web IDE — fully browser-based multi-language development environment       |
| [`@modelscript/site`](./apps/site/)           | Main modelscript.org website                                                       |
| [`@modelscript/vscode`](./extensions/vscode/) | VS Code extension — syntax highlighting, LSP client, diagram view                  |

## Core Features

- **Polyglot Incremental Compiler** — completely web-native, query-based (Salsa) architecture supporting Modelica, SysML v2, and STEP for cross-domain engineering.
- **Data-Oriented Simulation Engine** — arena-native ODE/DAE solver featuring zero-garbage buffer allocation, Pantelides index reduction, and BLT ordering.
- **Cross-Domain Verification** — continuous simulation-based requirements verification spanning architecture, simulation, CAD, CAE, and manufacturing.
- **Incremental Flattening** — state-of-the-art incremental compilation and unrolling of hierarchical models into flat Differential Algebraic Equations (DAE).
- **FMU & ROM** — seamless FMU import/export, integration, and high-performance surrogate ROM generation from FMUs.
- **Optimization & Calibration** — direct collocation solvers for optimal control problems, model optimization, and parameter calibration.
- **Accurate Parsing** — custom Tree-sitter grammars for efficient, incremental parsing of all supported domains.
- **Semantic Analysis** — full scope and name resolution for complex multi-domain hierarchies.
- **Diagram Rendering** — interactive SVG diagrams and X6-based visual layouts with auto-placement.
- **Language Server** — rich completions, hover, diagnostics, formatting, and color provider.
- **Linting & i18n** — comprehensive lint rules and string extraction support.

## Getting Started

### Prerequisites

- **Node.js** ≥ 24 (see `.nvmrc`)
- **emsdk** (required for building the Tree-sitter WASM parser):
  ```bash
  git clone https://github.com/emscripten-core/emsdk.git
  cd emsdk
  ./emsdk install latest
  ./emsdk activate latest
  source ./emsdk_env.sh
  ```

### Installation

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
```

### Building

Build all packages (in dependency order via Nx):

```bash
npm run build
```

### Running (Development)

Start all services concurrently:

```bash
npm run dev
```

This launches:

| Service               | URL                   | Description                                  |
| --------------------- | --------------------- | -------------------------------------------- |
| Morsel (editor)       | http://localhost:3002 | Visual editor with diagrams and simulation   |
| Web (library browser) | http://localhost:3001 | Browse and explore libraries                 |
| API                   | http://localhost:3000 | REST API for simulation, publishing, queries |
| IDE (VS Code Web)     | http://localhost:3003 | Browser-based VS Code environment            |

#### AI Chat (Optional)

The IDE includes a browser-local AI assistant powered by WebLLM (Qwen3-0.6B). To enable it, download the model weights (~350 MB, one-time):

```bash
npm run download-model --workspace=@modelscript/ide
```

Once downloaded, restart `npm run dev` and open the **ModelScript AI** panel in the IDE sidebar.

### CLI Usage

After building, the CLI is available as `msc`:

```bash
# Flatten a model to DAE incrementally
npx msc flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL

# Simulate a model (outputs CSV by default)
npx msc simulate BouncingBall model.mo --stop-time 5

# Simulate with JSON output
npx msc simulate BouncingBall model.mo --format json

# Solve an optimal control problem
npx msc optimize MyModel model.mo \
  --objective "u^2" --controls "u" --control-bounds "u:-1:1" --stop-time 10

# Lint Modelica files
npx msc lint model.mo

# Render a diagram to SVG (outputs to stdout)
npx msc render MyModel model.mo > diagram.svg
```

### Testing

Run the test suite across all packages (including the new compiler tests):

```bash
npm test
```

### Linting & Formatting

```bash
npm run lint
npm run format
```

### Docker

Pre-built images are published to the GitHub Container Registry on every push to `main`.

Run the latest images without building:

```bash
docker compose pull    # Pull latest images from ghcr.io/modelscript/*
docker compose up -d   # Start containers
docker compose down    # Stop containers
docker compose logs -f # Tail logs
```

To build from source instead:

```bash
npm run docker:build   # Build images locally
npm run docker:up      # Start containers
```

| Service | Port | URL                   |
| ------- | ---- | --------------------- |
| API     | 3000 | http://localhost:3000 |
| Morsel  | 3002 | http://localhost:3002 |
| Web     | 3001 | http://localhost:3001 |
| IDE     | 3003 | http://localhost:3003 |

## License

ModelScript is licensed under the **AGPL-3.0-or-later**. See [COPYING](./COPYING) for more details.
