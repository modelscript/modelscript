## 0.0.18 (2026-04-03)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.17 (2026-04-03)

### 🩹 Fixes

- **ci:** restore registry-url for npm trusted publisher oidc ([a73a22f](https://github.com/modelscript/modelscript/commit/a73a22f))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.16 (2026-04-03)

### 🩹 Fixes

- **ci:** correct npm provenance auth for trusted publishers ([95e1341](https://github.com/modelscript/modelscript/commit/95e1341))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.15 (2026-04-03)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.14 (2026-04-03)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.13 (2026-04-03)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.12 (2026-04-03)

This was a version bump only for @modelscript/cli to align it with other projects, there were no code changes.

## 0.0.11 (2026-04-03)

### 🚀 Features

- **ide:** add real-time digital twin co-simulation workspace template ([e993b10](https://github.com/modelscript/modelscript/commit/e993b10))
- **core:** implement real-time simulation pacing ([7464f33](https://github.com/modelscript/modelscript/commit/7464f33))
- web-native ECAD architecture with PCB annotations, netlist extraction, gerber export, ecad-canvas package ([c9aa709](https://github.com/modelscript/modelscript/commit/c9aa709))
- cad integration - annotation extraction, 3d viewer, vr support ([91b31e9](https://github.com/modelscript/modelscript/commit/91b31e9))
- **core:** add bonmin and couenne minlp solver support, optimize coinor build script ([2e0eb57](https://github.com/modelscript/modelscript/commit/2e0eb57))
- **morsel,api:** integrate cosim panel into simulation view, add pg dependency ([458c1e6](https://github.com/modelscript/modelscript/commit/458c1e6))
- **morsel,cli:** add cosim data source panel, cli status command ([10a201a](https://github.com/modelscript/modelscript/commit/10a201a))
- **cosim:** add timescaledb init schema, session cleanup, docker health checks ([373e4ff](https://github.com/modelscript/modelscript/commit/373e4ff))
- **cosim:** add browser mqtt client, react simulation hook, cli cosim commands ([46d22dc](https://github.com/modelscript/modelscript/commit/46d22dc))
- **cosim:** add fmu upload/storage/parsing api, websocket variable streaming ([55f96b7](https://github.com/modelscript/modelscript/commit/55f96b7))
- **cosim:** add api routes, mqtt model tree, and historian replayer ([d4071ec](https://github.com/modelscript/modelscript/commit/d4071ec))
- **cosim:** scaffold @modelscript/cosim package with mqtt co-simulation engine, uns topic hierarchy, gauss-seidel orchestrator, historian recorder, docker mosquitto + timescaledb ([7744ad4](https://github.com/modelscript/modelscript/commit/7744ad4))

### 🩹 Fixes

- **vscode:** resolve simulation breakpoints, DAP continuations, and array variables ([dd61de0](https://github.com/modelscript/modelscript/commit/dd61de0))
- **vscode:** resolve WebGL context loss and 3D visualizer asset loading, refactor React Suspense boundaries ([6b99eef](https://github.com/modelscript/modelscript/commit/6b99eef))
- **core,cli:** rename optimizer.optimize to optimizer.solve to match new api ([40e7a2c](https://github.com/modelscript/modelscript/commit/40e7a2c))
- **core:** extract optimization objective from LongClassSpecifier classModification ([03f8ec6](https://github.com/modelscript/modelscript/commit/03f8ec6))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

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
