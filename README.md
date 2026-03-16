<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

[![CI/CD](https://github.com/modelscript/modelscript/actions/workflows/ci.yml/badge.svg)](https://github.com/modelscript/modelscript/actions/workflows/ci.yml)

ModelScript is a comprehensive Modelica compilation, analysis, and visualization framework. It provides a robust engine for parsing Modelica code, performing semantic analysis, flattening models, and rendering interactive diagrams.

## Monorepo Structure

This project is a monorepo managed with **Lerna**, **Nx**, and **npm workspaces**.

| Package                                                                 | Description                                                                   |
| ----------------------------------------------------------------------- | ----------------------------------------------------------------------------- |
| [`@modelscript/core`](./packages/core/)                                 | Central compiler engine — parsing, semantic analysis, DAE generation, linting |
| [`@modelscript/cli`](./packages/cli/)                                   | `msc` command-line interface for compilation tasks                            |
| [`@modelscript/api`](./packages/api/)                                   | REST API server for ModelScript services                                      |
| [`@modelscript/morsel`](./packages/morsel/)                             | Visual Modelica editor and diagram viewer (React)                             |
| [`@modelscript/web`](./packages/web/)                                   | Web frontend for browsing Modelica libraries                                  |
| [`@modelscript/lsp`](./packages/lsp/)                                   | Language Server Protocol implementation for Modelica                          |
| [`@modelscript/vscode`](./packages/vscode/)                             | VS Code extension with syntax highlighting and language support               |
| [`@modelscript/tree-sitter-modelica`](./packages/tree-sitter-modelica/) | Tree-sitter grammar for Modelica                                              |

## Core Features

- **Accurate Parsing**: Leveraging a custom Tree-sitter grammar for efficient and precise parsing.
- **Semantic Analysis**: Full scope and name resolution for complex Modelica hierarchies.
- **Flattening**: Transforming hierarchical Modelica models into flat Differential Algebraic Equations (DAE).
- **Diagram Rendering**: Generating interactive SVG diagrams and X6-based visual representations.
- **Language Server**: Modelica language support with semantic highlighting, completions, and hover.
- **i18n Support**: Extracting translatable strings from Modelica models for internationalization.

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

Start the API server, Morsel editor, and Web frontend concurrently:

```bash
npm run dev
```

This launches:

| Service               | URL                   |
| --------------------- | --------------------- |
| Morsel (editor)       | http://localhost:5173 |
| Web (library browser) | http://localhost:5174 |
| API                   | http://localhost:3000 |

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

```bash
npm run docker:build   # Build images
npm run docker:up      # Start containers
npm run docker:down    # Stop containers
npm run docker:logs    # Tail logs
```

## License

ModelScript is licensed under the **AGPL-3.0-or-later**. See [COPYING](./COPYING) for more details.
