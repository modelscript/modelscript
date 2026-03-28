## 0.0.10 (2026-03-28)

### 🚀 Features

- **cli:** add --compile flag and cmake build system to fmu export ([3858cb7](https://github.com/modelscript/modelscript/commit/3858cb7))

### 🩹 Fixes

- **build:** add grammar.js to eslint allowDefaultProject to fix tree-sitter-modelica lint ([1506045](https://github.com/modelscript/modelscript/commit/1506045))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.9 (2026-03-28)

### 🚀 Features

- **core:** full fmu 2.0 archive export with model exchange, co-simulation c codegen, and zip packaging ([8bf83b8](https://github.com/modelscript/modelscript/commit/8bf83b8))
- **ide:** add webllm model download script, dockerfile stage, ci caching, and readme docs ([2248988](https://github.com/modelscript/modelscript/commit/2248988))
- **vscode:** browser-local llm chat with self-hosted model files ([e5ae5e8](https://github.com/modelscript/modelscript/commit/e5ae5e8))

### 🩹 Fixes

- **ci:** add tensor-cache.json to webllm model download, bump cache key ([d8f1ecb](https://github.com/modelscript/modelscript/commit/d8f1ecb))
- **core:** extract start values from dae attributes, pass experiment annotations to fmu xml ([2dba007](https://github.com/modelscript/modelscript/commit/2dba007))
- **ci:** restructure model deployment to match webllm resolve/main url convention ([94319ea](https://github.com/modelscript/modelscript/commit/94319ea))
- **ci:** create api directory before copying model files to static output ([565d3bb](https://github.com/modelscript/modelscript/commit/565d3bb))
- **ide:** commit wasm to git, fix docker model download paths and gitignore negation ([4942397](https://github.com/modelscript/modelscript/commit/4942397))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

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

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.6 (2026-03-27)

### 🚀 Features

- **core:** variable-order BDF solver for stiff systems with auto-detection ([5833021](https://github.com/modelscript/modelscript/commit/5833021))
- **core:** add semiLinear, array ops, nested connector flattening, dopri5 adaptive solver with dense output, integrate into simulator ([f3dc5fe](https://github.com/modelscript/modelscript/commit/f3dc5fe))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.5 (2026-03-27)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.4 (2026-03-27)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.3 (2026-03-27)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.2 (2026-03-27)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.1 (2026-03-27)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.
