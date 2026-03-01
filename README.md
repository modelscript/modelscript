<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

ModelScript is a comprehensive Modelica compilation, analysis, and visualization framework. It provides a robust engine for parsing Modelica code, performing semantic analysis, flattening models, and rendering interactive diagrams.

## Monorepo Structure

This project is a monorepo managed with **Lerna** and **npm workspaces**.

- **[Core](./src/)**: The central compiler engine (`@modelscript/modelscript`), providing Modelica parsing, DAE generation, and semantic analysis.
- **[CLI](./packages/cli/)**: The `msc` command-line interface (`@modelscript/cli`) for running compilation tasks from the terminal.
- **[Morsel](./packages/morsel/)**: A visual Modelica editor and diagram viewer (`@modelscript/morsel`) built with React and React Router.
- **[Grammar](./packages/tree-sitter-modelica/)**: A high-performance tree-sitter grammar for Modelica.

## Core Features

- **Accurate Parsing**: Leveraging a custom Tree-sitter grammar for efficient and precise parsing.
- **Semantic Analysis**: Full scope and name resolution for complex Modelica hierarchies.
- **Flattening**: Transforming hierarchical Modelica models into flat Differential Algebraic Equations (DAE).
- **Diagram Rendering**: Generating interactive SVG diagrams and X6-based visual representations.
- **i18n Support**: Extracting translatable strings from Modelica models for internationalization.

## Getting Started

### Prerequisites

- **Node.js**: Version 22 or later.
- **emsdk**: Required for building the Tree-sitter parser to WebAssembly.
  ```bash
  git clone https://github.com/emscripten-core/emsdk.git
  cd emsdk
  ./emsdk install latest
  ./emsdk activate latest
  source ./emsdk_env.sh
  ```

### Installation

Clone the repository and install dependencies:

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
```

### Building the Project

Build all packages from the root:

```bash
npm run build
```

This runs the build scripts for all packages in the correct dependency order.

### Testing

Run the test suite across all modules:

```bash
npm test
```

## License

ModelScript is licensed under the **AGPL-3.0-or-later**. See [COPYING](./COPYING) for more details.
