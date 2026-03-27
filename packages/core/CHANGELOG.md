## 0.0.8 (2026-03-27)

### 🚀 Features

- **mcp:** add modelica mcp server with parse, flatten, lint, simulate, query tools ([15bc120](https://github.com/modelscript/modelscript/commit/15bc120))

### 🩹 Fixes

- **vscode:** add @mlc-ai/web-llm dependency, fix registerChatParticipant call arity ([3b233b3](https://github.com/modelscript/modelscript/commit/3b233b3))
- **morsel:** migrate web-tree-sitter 0.26.7 imports, add fs/promises vite alias, add lint target, fix eslint errors, sync with husky pre-commit ([33580f9](https://github.com/modelscript/modelscript/commit/33580f9))
- rebuild tree-sitter with c++20 for node v24 abi compatibility ([a6515ea](https://github.com/modelscript/modelscript/commit/a6515ea))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.7 (2026-03-27)

### 🚀 Features

- **cli:** add export-fmu command, wire bdf/dopri5/fmi/units exports ([066378c](https://github.com/modelscript/modelscript/commit/066378c))
- **core:** fmi 2.0 co-simulation fmu generator, si unit checking with 7-tuple representation, overconstrained connection graph operators, homotopy continuation initialization ([7bd311a](https://github.com/modelscript/modelscript/commit/7bd311a))
- **core:** synchronous clocked operators and state machine execution ([d71eca2](https://github.com/modelscript/modelscript/commit/d71eca2))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.6 (2026-03-27)

### 🚀 Features

- **core:** algebraic loop tearing to reduce Newton block sizes ([8cb6b47](https://github.com/modelscript/modelscript/commit/8cb6b47))
- **core:** variable-order BDF solver for stiff systems with auto-detection ([5833021](https://github.com/modelscript/modelscript/commit/5833021))
- **core:** implement stream connector support with inStream/actualStream, finite-difference AD for algorithm sections in Jacobian computation ([8e7a11d](https://github.com/modelscript/modelscript/commit/8e7a11d))
- **core:** add semiLinear, array ops, nested connector flattening, dopri5 adaptive solver with dense output, integrate into simulator ([f3dc5fe](https://github.com/modelscript/modelscript/commit/f3dc5fe))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.5 (2026-03-27)

### 🚀 Features

- **core:** reinit for algebraic vars, string/enum/integer support in evaluator ([53ab230](https://github.com/modelscript/modelscript/commit/53ab230))
- **core:** add delay() operator with circular history buffer and linear interpolation ([9945612](https://github.com/modelscript/modelscript/commit/9945612))
- **core:** consistent initialization solver with 6-phase init, der(x)=0, fixed attributes ([a49d0ec](https://github.com/modelscript/modelscript/commit/a49d0ec))
- **core:** add array support to expression evaluator — subscripts, constructors, reductions ([698fe92](https://github.com/modelscript/modelscript/commit/698fe92))
- **core:** add initial algorithm execution, assert/terminate handling, external function stubs ([6665955](https://github.com/modelscript/modelscript/commit/6665955))
- **core:** add for-equation unrolling with parameter-evaluated ranges in simulator ([1fda74c](https://github.com/modelscript/modelscript/commit/1fda74c))
- **core:** integrate algorithm sections and user-defined functions into simulator ([29e33e2](https://github.com/modelscript/modelscript/commit/29e33e2))
- **core:** add user-defined function execution via evaluator function lookup ([cbb67f5](https://github.com/modelscript/modelscript/commit/cbb67f5))
- **core:** add statement executor for modelica algorithm sections ([2b7018e](https://github.com/modelscript/modelscript/commit/2b7018e))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.4 (2026-03-27)

This was a version bump only for @modelscript/core to align it with other projects, there were no code changes.

## 0.0.3 (2026-03-27)

This was a version bump only for @modelscript/core to align it with other projects, there were no code changes.

## 0.0.2 (2026-03-27)

This was a version bump only for @modelscript/core to align it with other projects, there were no code changes.

## 0.0.1 (2026-03-27)

This was a version bump only for @modelscript/core to align it with other projects, there were no code changes.
