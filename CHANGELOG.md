## 0.0.9 (2026-03-28)

### 🚀 Features

- **core:** full fmu 2.0 archive export with model exchange, co-simulation c codegen, and zip packaging ([8bf83b8](https://github.com/modelscript/modelscript/commit/8bf83b8))
- **ide:** enable proposed chat and language model APIs for vs code web ([7bc7719](https://github.com/modelscript/modelscript/commit/7bc7719))
- **ide:** add webllm model download script, dockerfile stage, ci caching, and readme docs ([2248988](https://github.com/modelscript/modelscript/commit/2248988))
- **vscode:** browser-local llm chat with self-hosted model files ([e5ae5e8](https://github.com/modelscript/modelscript/commit/e5ae5e8))
- **vscode:** inject workspace context into chat, add latex math rendering, listClasses lsp endpoint ([20ab6ad](https://github.com/modelscript/modelscript/commit/20ab6ad))
- **vscode:** move chat to activitybar sidebar, add empty state layout, use favicon icon ([d6fe9df](https://github.com/modelscript/modelscript/commit/d6fe9df))

### 🩹 Fixes

- **ci:** create api directory before copying model files to static output ([565d3bb](https://github.com/modelscript/modelscript/commit/565d3bb))
- **ci:** restructure model deployment to match webllm resolve/main url convention ([94319ea](https://github.com/modelscript/modelscript/commit/94319ea))
- **ci:** add tensor-cache.json to webllm model download, bump cache key ([d8f1ecb](https://github.com/modelscript/modelscript/commit/d8f1ecb))
- **core:** extract start values from dae attributes, pass experiment annotations to fmu xml ([2dba007](https://github.com/modelscript/modelscript/commit/2dba007))
- **ide:** use open-vsx registry for extension gallery in both server and static builds ([cca6e2e](https://github.com/modelscript/modelscript/commit/cca6e2e))
- **ide:** use uuid subdomains on localhost only, same-origin on production ([c407187](https://github.com/modelscript/modelscript/commit/c407187))
- **ide:** commit wasm to git, fix docker model download paths and gitignore negation ([4942397](https://github.com/modelscript/modelscript/commit/4942397))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.8 (2026-03-27)

### 🚀 Features

- **mcp:** add modelica mcp server with parse, flatten, lint, simulate, query tools ([15bc120](https://github.com/modelscript/modelscript/commit/15bc120))
- **vscode:** add browser-local llm integration with webllm, @modelscript chat participant, and mcp tool bridge ([1534935](https://github.com/modelscript/modelscript/commit/1534935))

### 🩹 Fixes

- rebuild tree-sitter with c++20 for node v24 abi compatibility ([a6515ea](https://github.com/modelscript/modelscript/commit/a6515ea))
- **lsp:** migrate to web-tree-sitter 0.26.7 named exports ([bc4a9ef](https://github.com/modelscript/modelscript/commit/bc4a9ef))
- **lsp:** remove duplicate simulate handler causing undefined.split() crash ([e0fca28](https://github.com/modelscript/modelscript/commit/e0fca28))
- **mcp:** build fixes ([11d1da0](https://github.com/modelscript/modelscript/commit/11d1da0))
- **morsel:** migrate web-tree-sitter 0.26.7 imports, add fs/promises vite alias, add lint target, fix eslint errors, sync with husky pre-commit ([33580f9](https://github.com/modelscript/modelscript/commit/33580f9))
- **morsel:** wasm loading for web-tree-sitter v0.26, add process.versions shim for web-tree-sitter v0.26 env detection ([ae8bd13](https://github.com/modelscript/modelscript/commit/ae8bd13))
- **vscode:** update wasm filename for web-tree-sitter v0.26 ([f38a223](https://github.com/modelscript/modelscript/commit/f38a223))
- **vscode:** add @mlc-ai/web-llm dependency, fix registerChatParticipant call arity ([3b233b3](https://github.com/modelscript/modelscript/commit/3b233b3))

### 🔥 Performance

- **lsp:** implement incremental tree-sitter parsing with per-document tree cache ([2db91ba](https://github.com/modelscript/modelscript/commit/2db91ba))
- **lsp:** incremental AST rebuild using tree-sitter hasChanges, skip unchanged class instantiation ([90ee8a2](https://github.com/modelscript/modelscript/commit/90ee8a2))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.7 (2026-03-27)

### 🚀 Features

- **cli:** add export-fmu command, wire bdf/dopri5/fmi/units exports ([066378c](https://github.com/modelscript/modelscript/commit/066378c))
- **core:** synchronous clocked operators and state machine execution ([d71eca2](https://github.com/modelscript/modelscript/commit/d71eca2))
- **core:** fmi 2.0 co-simulation fmu generator, si unit checking with 7-tuple representation, overconstrained connection graph operators, homotopy continuation initialization ([7bd311a](https://github.com/modelscript/modelscript/commit/7bd311a))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.6 (2026-03-27)

### 🚀 Features

- **core:** add semiLinear, array ops, nested connector flattening, dopri5 adaptive solver with dense output, integrate into simulator ([f3dc5fe](https://github.com/modelscript/modelscript/commit/f3dc5fe))
- **core:** implement stream connector support with inStream/actualStream, finite-difference AD for algorithm sections in Jacobian computation ([8e7a11d](https://github.com/modelscript/modelscript/commit/8e7a11d))
- **core:** variable-order BDF solver for stiff systems with auto-detection ([5833021](https://github.com/modelscript/modelscript/commit/5833021))
- **core:** algebraic loop tearing to reduce Newton block sizes ([8cb6b47](https://github.com/modelscript/modelscript/commit/8cb6b47))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.5 (2026-03-27)

### 🚀 Features

- **core:** add statement executor for modelica algorithm sections ([2b7018e](https://github.com/modelscript/modelscript/commit/2b7018e))
- **core:** add user-defined function execution via evaluator function lookup ([cbb67f5](https://github.com/modelscript/modelscript/commit/cbb67f5))
- **core:** integrate algorithm sections and user-defined functions into simulator ([29e33e2](https://github.com/modelscript/modelscript/commit/29e33e2))
- **core:** add for-equation unrolling with parameter-evaluated ranges in simulator ([1fda74c](https://github.com/modelscript/modelscript/commit/1fda74c))
- **core:** add initial algorithm execution, assert/terminate handling, external function stubs ([6665955](https://github.com/modelscript/modelscript/commit/6665955))
- **core:** add array support to expression evaluator — subscripts, constructors, reductions ([698fe92](https://github.com/modelscript/modelscript/commit/698fe92))
- **core:** consistent initialization solver with 6-phase init, der(x)=0, fixed attributes ([a49d0ec](https://github.com/modelscript/modelscript/commit/a49d0ec))
- **core:** add delay() operator with circular history buffer and linear interpolation ([9945612](https://github.com/modelscript/modelscript/commit/9945612))
- **core:** reinit for algebraic vars, string/enum/integer support in evaluator ([53ab230](https://github.com/modelscript/modelscript/commit/53ab230))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.4 (2026-03-27)

This was a version bump only, there were no code changes.

## 0.0.3 (2026-03-27)

This was a version bump only, there were no code changes.

## 0.0.2 (2026-03-27)

This was a version bump only, there were no code changes.

## 0.0.1 (2026-03-27)

This was a version bump only, there were no code changes.
