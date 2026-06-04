<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/core

Core orchestration package for ModelScript. Provides the `Context` orchestrator, the legacy `ModelicaFlattener`, linter rules, and the test runner.

> **Note:** The modern incremental query engine, symbol indexer, and arena-based simulators are now located in `@modelscript/compiler`.

## Features

- **Orchestration** — `Context` acts as the primary entry point for managing workspaces and polyglot compilation
- **Legacy Flattening** — legacy AST-based `ModelicaFlattener` for DAE generation
- **Linting** — 15+ lint rules covering parser errors, unresolved references, type mismatches, and structural checks
- **Test Runner** — comprehensive Modelica testsuite runner comparing OpenModelica golden outputs
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
