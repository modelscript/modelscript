<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/core

Central compiler engine for ModelScript. Provides Modelica parsing, semantic analysis, model instantiation, DAE flattening, simulation, optimization, SVG diagram rendering, linting, and i18n support.

## Features

- **Parsing** — incremental Tree-sitter-based parsing with full Modelica grammar coverage
- **Semantic Analysis** — scope resolution, type checking, and name lookup across class hierarchies
- **Flattening** — transforms hierarchical Modelica models into flat DAE (Differential Algebraic Equations)
- **Simulation** — ODE/DAE numerical solver with Pantelides index reduction, BLT ordering, and alias elimination
- **Optimization** — direct collocation solver for Modelica optimal control problems
- **Interpreter** — evaluates Modelica expressions, functions, and algorithms at compile time
- **Diagram Rendering** — generates interactive SVG diagrams from Modelica annotation data
- **Linting** — 15+ lint rules covering parser errors, unresolved references, type mismatches, and structural checks
- **i18n** — extracts translatable strings from Modelica model descriptions and annotations

## Scripts

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `npm run build` | Clean, lint, and compile TypeScript |
| `npm run clean` | Remove `dist/` output               |
| `npm run lint`  | Run ESLint on `src/`                |
| `npm test`      | Run the Modelica test suite         |
| `npm run watch` | Compile in watch mode               |

## Testing

```bash
npm test
```

Runs the Modelica test suite via `tsx tests/testsuite-runner.ts` with increased heap size (8 GB). Tests can be filtered by subdirectory or individual `.mo` file path.

```bash
# Run a specific test directory
npx tsx tests/testsuite-runner.ts OpenModelica/flattening/modelica/types

# Run a single test file
npx tsx tests/testsuite-runner.ts OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo

# Update expected output to match actual output
npx tsx tests/testsuite-runner.ts --update path/to/test.mo
```
