<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

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

ModelScript is a comprehensive Modelica compilation, simulation, optimization, and visualization framework. It provides a robust engine for parsing Modelica code, performing semantic analysis, flattening models, simulating dynamic systems, solving optimal control problems, and rendering interactive diagrams — all from the browser or the command line.

## Monorepo Structure

This project is a monorepo managed with **Lerna**, **Nx**, and **npm workspaces**.

| Package                                                                 | Description                                                                        |
| ----------------------------------------------------------------------- | ---------------------------------------------------------------------------------- |
| [`@modelscript/core`](./packages/core/)                                 | Compiler engine — parsing, semantic analysis, flattening, simulation, linting      |
| [`@modelscript/cli`](./packages/cli/)                                   | `msc` command-line interface — flatten, simulate, optimize, lint, render, and more |
| [`@modelscript/api`](./packages/api/)                                   | REST API server — simulation, publishing, GraphQL, SPARQL, and RDF                 |
| [`@modelscript/morsel`](./packages/morsel/)                             | Visual Modelica editor — code editing, diagram viewer, simulation, and plotting    |
| [`@modelscript/web`](./packages/web/)                                   | Web frontend for browsing and exploring Modelica libraries                         |
| [`@modelscript/ide`](./packages/ide/)                                   | VS Code Web IDE — browser-based Modelica development environment                   |
| [`@modelscript/lsp`](./packages/lsp/)                                   | Language Server Protocol — completions, hover, diagnostics, formatting, colors     |
| [`@modelscript/vscode`](./packages/vscode/)                             | VS Code extension — syntax highlighting, LSP client, diagram view                  |
| [`@modelscript/tree-sitter-modelica`](./packages/tree-sitter-modelica/) | Tree-sitter grammar for Modelica (native + WASM)                                   |

## Core Features

- **Accurate Parsing** — custom Tree-sitter grammar for efficient, incremental parsing
- **Semantic Analysis** — full scope and name resolution for complex Modelica hierarchies
- **Flattening** — transforms hierarchical models into flat Differential Algebraic Equations (DAE)
- **Simulation** — ODE/DAE solver with Pantelides index reduction and BLT ordering
- **Optimization** — optimal control problem solver using direct collocation
- **Diagram Rendering** — interactive SVG diagrams and X6-based visual layouts with auto-placement
- **Language Server** — completions, hover, diagnostics, formatting, and color provider
- **Linting** — 15+ lint rules covering syntax, types, semantics, and equations
- **Modelica Scripting** — interpreter for evaluating Modelica expressions and algorithms
- **i18n Support** — extracting translatable strings from Modelica models

## Getting Started

### Prerequisites

- **Node.js** ≥ 22 (see `.nvmrc`)
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
| Morsel (editor)       | http://localhost:5173 | Visual editor with diagrams and simulation   |
| Web (library browser) | http://localhost:5174 | Browse and explore Modelica libraries        |
| API                   | http://localhost:3000 | REST API for simulation, publishing, queries |
| IDE (VS Code Web)     | http://localhost:3200 | Browser-based VS Code with Modelica support  |

#### AI Chat (Optional)

The IDE includes a browser-local AI assistant powered by WebLLM (Qwen3-0.6B). To enable it, download the model weights (~350 MB, one-time):

```bash
npm run download-model --workspace=@modelscript/ide
```

Once downloaded, restart `npm run dev` and open the **ModelScript AI** panel in the IDE sidebar.

### CLI Usage

After building, the CLI is available as `msc`:

```bash
# Flatten a model to DAE
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

Run the test suite across all packages:

```bash
npm test
```

### Linting

```bash
npm run lint
```

### Formatting

```bash
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
| Morsel  | 5173 | http://localhost:5173 |
| Web     | 5174 | http://localhost:5174 |
| IDE     | 3200 | http://localhost:3200 |

## License

ModelScript is licensed under the **AGPL-3.0-or-later**. See [COPYING](./COPYING) for more details.
