## 0.0.18 (2026-04-03)

This was a version bump only, there were no code changes.

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

This was a version bump only, there were no code changes.

## 0.0.14 (2026-04-03)

This was a version bump only, there were no code changes.

## 0.0.13 (2026-04-03)

This was a version bump only, there were no code changes.

## 0.0.12 (2026-04-03)

This was a version bump only, there were no code changes.

## 0.0.11 (2026-04-03)

### 🚀 Features

- add fmi 3.0 terminals and icons xml generation and extraction, fix fmi config typings ([92f261e](https://github.com/modelscript/modelscript/commit/92f261e))
- cad integration - annotation extraction, 3d viewer, vr support ([91b31e9](https://github.com/modelscript/modelscript/commit/91b31e9))
- web-native ECAD architecture with PCB annotations, netlist extraction, gerber export, ecad-canvas package ([c9aa709](https://github.com/modelscript/modelscript/commit/c9aa709))
- **api:** wire mqtt client, timescaledb pool, historian recorder, participant enrollment ([1daa6e0](https://github.com/modelscript/modelscript/commit/1daa6e0))
- **api:** wire historian replay routes with real replayer, pass mqtt client to historian ([23f4bc1](https://github.com/modelscript/modelscript/commit/23f4bc1))
- **core:** add ModelicaFmuEntity for first-class FMU support, auto-resolve FMU XML as Modelica blocks ([770c9fb](https://github.com/modelscript/modelscript/commit/770c9fb))
- **core:** fmu diagram synthesis with connector ports, triangle icons, and port labels ([7799a3a](https://github.com/modelscript/modelscript/commit/7799a3a))
- **core:** fmu synthetic connectors support integer, boolean, and string variables ([b95b336](https://github.com/modelscript/modelscript/commit/b95b336))
- **core:** implement fmu state save/restore (fmi2GetFMUstate, fmi2SetFMUstate, serialization) ([acd0f22](https://github.com/modelscript/modelscript/commit/acd0f22))
- **core:** symbolic differentiation engine, fmi2GetDirectionalDerivative jacobian codegen ([87ffd7c](https://github.com/modelscript/modelscript/commit/87ffd7c))
- **core:** modelstructure dependencies, unit/type definitions, initial attribute, log categories, derivative interpolation, resource packaging ([a632a87](https://github.com/modelscript/modelscript/commit/a632a87))
- **core:** add optional compatibility flags to fmi 2.0 xml headers ([60fa8f1](https://github.com/modelscript/modelscript/commit/60fa8f1))
- **core:** add fmi 3.0 model description and c code generator ([c8b40da](https://github.com/modelscript/modelscript/commit/c8b40da))
- **core:** add fmi 3.0 native arrays, clocks, terminals, intermediate update proxy ([6dd589e](https://github.com/modelscript/modelscript/commit/6dd589e))
- **core:** fmi 3.0 array batching, precision types, structural parameters, directional derivatives ([1071f0c](https://github.com/modelscript/modelscript/commit/1071f0c))
- **core:** fmi 3.0 extended precision getters, clock APIs, and scheduled execution ([daf9d9d](https://github.com/modelscript/modelscript/commit/daf9d9d))
- **core:** sparse dependency kinds, cs event mode state machine, fmu build metadata ([a0bfa4a](https://github.com/modelscript/modelscript/commit/a0bfa4a))
- **core:** dynamic arrays, async co-simulation, precise array deps, terminalsAndIcons.xml ([7fde070](https://github.com/modelscript/modelscript/commit/7fde070))
- **core:** synchronous clock partitioning, state machine C codegen, delay ring-buffers, spatialDistribution evaluator ([43bedf3](https://github.com/modelscript/modelscript/commit/43bedf3))
- **core:** synchronous clocks, state machine codegen, delay buffers, spatialDistribution, operator record dispatch, ExternalObject lifecycle ([6d377c5](https://github.com/modelscript/modelscript/commit/6d377c5))
- **core:** implement FMI string state deep-copy and analytical jacobians ([4e4c318](https://github.com/modelscript/modelscript/commit/4e4c318))
- **core:** implement FMI 3.0 dual-standard API, Native Clocks, and XML Dimension grouping ([b9f95ae](https://github.com/modelscript/modelscript/commit/b9f95ae))
- **core:** improve zero-crossing bisection to 40 iterations, add chattering guard and time-event scheduling ([f259145](https://github.com/modelscript/modelscript/commit/f259145))
- **core:** delay() c codegen with ring-buffer helpers, state machine transition evaluation, fmi3 function signature fix ([70272af](https://github.com/modelscript/modelscript/commit/70272af))
- **core:** implement FMI 3.0 multi-dimensional array vectorization and slicing ([05dead9](https://github.com/modelscript/modelscript/commit/05dead9))
- **core:** implement external object lifecycles, wire assertion and logging callbacks, map enumeration xml exports, add child_process cmake compilation route ([70f6407](https://github.com/modelscript/modelscript/commit/70f6407))
- **core:** exact AD jacobians in FMU algebraic loop solver and BDF integrator ([373048c](https://github.com/modelscript/modelscript/commit/373048c))
- **core:** AD-based initial equation solver, exact AD jacobians in FMU algebraic loops and BDF ([dae7a94](https://github.com/modelscript/modelscript/commit/dae7a94))
- **core:** interval arithmetic, mccormick relaxations, homotopy continuation, spatial branch-and-bound ([48e3c7b](https://github.com/modelscript/modelscript/commit/48e3c7b))
- **core:** extend AD/IA/McCormick tape to handle preserved array mode via element-wise unrolling ([1c807e9](https://github.com/modelscript/modelscript/commit/1c807e9))
- **core:** vectorized SIMD-style tape operations for efficient array AD/IA/McCormick evaluation ([649e68a](https://github.com/modelscript/modelscript/commit/649e68a))
- **core:** vectorize SIMD-style tape operations for AD, IA, and McCormick Array evaluate speedup ([980eabc](https://github.com/modelscript/modelscript/commit/980eabc))
- **core:** extend AD, IA, and McCormick to support preserved array mode ([7fb4ba4](https://github.com/modelscript/modelscript/commit/7fb4ba4))
- **core:** add sundials and coin-or solver interfaces with c wrappers, ts codegen, cmake integration ([be84fe3](https://github.com/modelscript/modelscript/commit/be84fe3))
- **core:** implement unified solver options, integrate kinsol wasm fallback for algebraic loops, wire solver configuration across fmu codegen and scripting api ([e9e8117](https://github.com/modelscript/modelscript/commit/e9e8117))
- **core:** add bonmin and couenne minlp solver support, optimize coinor build script ([2e0eb57](https://github.com/modelscript/modelscript/commit/2e0eb57))
- **core:** add symbolic equation isolation engine for algebraic loop reduction ([3e661eb](https://github.com/modelscript/modelscript/commit/3e661eb))
- **core:** add symbolic equation isolation engine for algebraic loop reduction ([1204286](https://github.com/modelscript/modelscript/commit/1204286))
- **core:** add symbolic equation isolation engine and alias elimination ([d1bd6e4](https://github.com/modelscript/modelscript/commit/d1bd6e4))
- **core:** integrate native SSP archive support and ModelicaSspEntity instantiation ([570a85c](https://github.com/modelscript/modelscript/commit/570a85c))
- **core:** add groebner basis algorithm, implement symbolic isolation for quadratic, trigonometric and lambert w patterns, add fixed-point heuristic ([839e68e](https://github.com/modelscript/modelscript/commit/839e68e))
- **core:** native javascript interoperability parsing and fmu bundling ([a687dbd](https://github.com/modelscript/modelscript/commit/a687dbd))
- **core:** add e-graph equality saturation engine for symbolic expression optimization ([910841a](https://github.com/modelscript/modelscript/commit/910841a))
- **core:** integrate e-graph equality saturation into blt symbolic isolation ([519f1d1](https://github.com/modelscript/modelscript/commit/519f1d1))
- **core:** add associativity, distributivity, power, negation, division, pythagorean, double-angle rewrite rules to e-graph engine ([9f6ff3f](https://github.com/modelscript/modelscript/commit/9f6ff3f))
- **core:** e-graph pattern language, analysis, runner, proofs, graphviz ([fe24eaa](https://github.com/modelscript/modelscript/commit/fe24eaa))
- **core:** cas engine with polynomial algebra, equation solver, linalg, symbolic integration, egraph integration ([19040a5](https://github.com/modelscript/modelscript/commit/19040a5))
- **core:** modelica cas bindings with 14 ModelScript.CAS.\* functions, package declaration, compile-time dispatch ([9162552](https://github.com/modelscript/modelscript/commit/9162552))
- **core:** tensor ad graphs, optimizer extensions, e-graph fusion, nlp codegen, gpu codegen ([056f956](https://github.com/modelscript/modelscript/commit/056f956))
- **core:** implement robust and stochastic optimization framework with Monte Carlo sampling ([bc5e117](https://github.com/modelscript/modelscript/commit/bc5e117))
- **core:** extract CAD/CADPort annotations into flattened DAE variables ([2bf9089](https://github.com/modelscript/modelscript/commit/2bf9089))
- **core:** advanced initialization solver with init BLT, sBB preconditioner, MINLP heuristics, multi-strategy homotopy ([85bca13](https://github.com/modelscript/modelscript/commit/85bca13))
- **core:** implement real-time simulation pacing ([7464f33](https://github.com/modelscript/modelscript/commit/7464f33))
- **core,cosim:** string variable support in fmu codegen, typed cosim coupling ([f52621b](https://github.com/modelscript/modelscript/commit/f52621b))
- **core,cosim:** fmi 2.0 state save/restore, event handling, string variable support ([37e04d6](https://github.com/modelscript/modelscript/commit/37e04d6))
- **core,cosim:** externalobject lifecycle, fmi2reset, assert/terminate/initial/terminal c codegen, dopri5 integrator, spatialdistribution c helper, pantelides index reduction, fmi3 scheduled execution participant, fmi2setrealinputderivatives, msvc/mingw cmake cross-compilation ([027c905](https://github.com/modelscript/modelscript/commit/027c905))
- **core,lsp,vscode:** multi-fmu wrapper model generation, createCosimWrapper lsp request, cosim panel wrapper button ([8542f0a](https://github.com/modelscript/modelscript/commit/8542f0a))
- **cosim:** scaffold @modelscript/cosim package with mqtt co-simulation engine, uns topic hierarchy, gauss-seidel orchestrator, historian recorder, docker mosquitto + timescaledb ([7744ad4](https://github.com/modelscript/modelscript/commit/7744ad4))
- **cosim:** add api routes, mqtt model tree, and historian replayer ([d4071ec](https://github.com/modelscript/modelscript/commit/d4071ec))
- **cosim:** add api routes, mqtt model tree, historian replayer and rest endpoints ([4634267](https://github.com/modelscript/modelscript/commit/4634267))
- **cosim:** add fmu upload/storage/parsing api, websocket variable streaming ([55f96b7](https://github.com/modelscript/modelscript/commit/55f96b7))
- **cosim:** add browser mqtt client, react simulation hook, cli cosim commands ([46d22dc](https://github.com/modelscript/modelscript/commit/46d22dc))
- **cosim:** add timescaledb init schema, session cleanup, docker health checks ([373e4ff](https://github.com/modelscript/modelscript/commit/373e4ff))
- **cosim:** implement fmu-js and fmu-native participants, wire mqtt and websocket into api server ([9d30f91](https://github.com/modelscript/modelscript/commit/9d30f91))
- **cosim:** real FMU execution via embedded model.json DAE with Euler integration ([5b34eb1](https://github.com/modelscript/modelscript/commit/5b34eb1))
- **cosim:** wasm fmu execution via fmi 2.0 c api through webassembly exports ([9155027](https://github.com/modelscript/modelscript/commit/9155027))
- **cosim:** wasm fmu execution with embedded sinewave example, three-tier participant (wasm/dae/passthrough) ([29ed3a5](https://github.com/modelscript/modelscript/commit/29ed3a5))
- **cosim:** unit compatibility validation for coupling graph, orchestrator integration ([d732ea8](https://github.com/modelscript/modelscript/commit/d732ea8))
- **cosim:** jacobi parallel stepping, richardson extrapolation, master algorithm selection ([5fea06d](https://github.com/modelscript/modelscript/commit/5fea06d))
- **cosim:** fmu harness codegen, native participant state management, cosimvalue type widening ([a1582cf](https://github.com/modelscript/modelscript/commit/a1582cf))
- **cosim:** implicit newton master, auto unit conversion, fmi 3.0 me event handling, directional derivatives interface ([561f480](https://github.com/modelscript/modelscript/commit/561f480))
- **cosim:** wire fmi2/3 directional derivatives, async polling, cancel step, and ME event mode RPCs in native harness ([b9da512](https://github.com/modelscript/modelscript/commit/b9da512))
- **cosim:** add ssp standard import/export support ([a23abc7](https://github.com/modelscript/modelscript/commit/a23abc7))
- **cosim,core:** me import with rk4 ode solver, async fmi2pending, variable aliasing, tunable parameter api ([ec95ddd](https://github.com/modelscript/modelscript/commit/ec95ddd))
- **ide:** add real-time digital twin co-simulation workspace template ([e993b10](https://github.com/modelscript/modelscript/commit/e993b10))
- **lsp:** add code lens, inlay hints, class hierarchy and blt analysis rpcs ([e651390](https://github.com/modelscript/modelscript/commit/e651390))
- **lsp:** implement advanced analytical RPCs for interval optimization and system identification ([f49af47](https://github.com/modelscript/modelscript/commit/f49af47))
- **lsp,vscode:** add code lens, inlay hints, blt matrix and class hierarchy webviews ([bc0ac1f](https://github.com/modelscript/modelscript/commit/bc0ac1f))
- **lsp,vscode:** add code lens, inlay hints, blt/hierarchy/component-tree webviews ([02cfbfa](https://github.com/modelscript/modelscript/commit/02cfbfa))
- **morsel:** add drag-and-drop support for SSP and FMU binary archives ([3ddc91c](https://github.com/modelscript/modelscript/commit/3ddc91c))
- **morsel:** integrate 3d cad viewer with three.js, vr support, diagram split-pane ([653b5fc](https://github.com/modelscript/modelscript/commit/653b5fc))
- **morsel:** extract CAD metadata from AST for responsive 3d rendering ([5175e12](https://github.com/modelscript/modelscript/commit/5175e12))
- **morsel,api:** integrate cosim panel into simulation view, add pg dependency ([458c1e6](https://github.com/modelscript/modelscript/commit/458c1e6))
- **morsel,cli:** add cosim data source panel, cli status command ([10a201a](https://github.com/modelscript/modelscript/commit/10a201a))
- **solvers:** add wasm-compiled sundials/coin-or with emscripten build, ts loaders, simulator integration ([119ea2b](https://github.com/modelscript/modelscript/commit/119ea2b))
- **vscode:** add co-simulation panel with mqtt live plotting, session management, infrastructure controls ([a7959ad](https://github.com/modelscript/modelscript/commit/a7959ad))
- **vscode:** add browser-local mqtt broker and historian for offline cosim, fix esm import in cosim/ws, add cors middleware to api ([8e025ca](https://github.com/modelscript/modelscript/commit/8e025ca))
- **vscode:** add local participant enrollment via lsp simulation for browser-local cosim mode ([8aba0fb](https://github.com/modelscript/modelscript/commit/8aba0fb))
- **vscode:** port cosim orchestrator to browser with step-by-step lsp simulation and coupling support ([e9aeb50](https://github.com/modelscript/modelscript/commit/e9aeb50))
- **vscode:** add fmu 2.0 browser co-simulation support and cosim example workspace template ([65b117a](https://github.com/modelscript/modelscript/commit/65b117a))
- **vscode:** modelica-wired co-simulation with connect equations, fmu browser participant, cosim example template ([13f1d07](https://github.com/modelscript/modelscript/commit/13f1d07))
- **vscode:** add virtual document provider for fmu files as modelica block view ([87c2abf](https://github.com/modelscript/modelscript/commit/87c2abf))
- **vscode:** add custom readonly editor for fmu files as modelica block view, use pako-based zip reader for fmu extraction, matching core package ([0dca382](https://github.com/modelscript/modelscript/commit/0dca382))
- **vscode:** fmu xml discovery in project tree, drag-to-diagram support, xml file watcher ([896f7fb](https://github.com/modelscript/modelscript/commit/896f7fb))
- **vscode:** cosim sidebar ux overhaul — mode dropdown, unified add-participant picker, coupling visualization, wrapper auto-detection, simulation progress bar, quick start ([27c7d6f](https://github.com/modelscript/modelscript/commit/27c7d6f))
- **vscode:** integrate native SSP file rendering and co-simulation UI enrollment ([d7fbf2b](https://github.com/modelscript/modelscript/commit/d7fbf2b))
- **vscode:** overhaul AI chat UI layout and fix tool execution parameters ([7e71fce](https://github.com/modelscript/modelscript/commit/7e71fce))
- **vscode:** add variable tree to simulation panel, implement canvas pan and zoom ([6d1c65a](https://github.com/modelscript/modelscript/commit/6d1c65a))

### 🩹 Fixes

- remove flow pair fallback in flattener, exclude function call equations from dof counts, invoke flow balance generation in lsp ([9df10b1](https://github.com/modelscript/modelscript/commit/9df10b1))
- **core:** synthetic fmu connectors bypass plug-compatibility check for cross-domain wiring ([89c39e8](https://github.com/modelscript/modelscript/commit/89c39e8))
- **core:** fmu synthetic connectors clone predefined real type for proper plug-compatibility ([b93d127](https://github.com/modelscript/modelscript/commit/b93d127))
- **core:** gate mutable dimension codegen behind compile-time flag for zero static model overhead ([7577570](https://github.com/modelscript/modelscript/commit/7577570))
- **core:** algebraic loop detection and strict AST flattening coercion rules ([ff79649](https://github.com/modelscript/modelscript/commit/ff79649))
- **core:** resolve false positive algebraic loops in BLT solver ([b6cbd97](https://github.com/modelscript/modelscript/commit/b6cbd97))
- **core:** extract optimization objective from LongClassSpecifier classModification ([03f8ec6](https://github.com/modelscript/modelscript/commit/03f8ec6))
- **core:** enable CAS script evaluation and fix recursive AST structural resolution ([c11c334](https://github.com/modelscript/modelscript/commit/c11c334))
- **core:** enable CAS script evaluation and add solver constant-folding ([a2d3c16](https://github.com/modelscript/modelscript/commit/a2d3c16))
- **core:** preserve param-to-variable alias equations as algebraic assignments in simulator ([5c68bb5](https://github.com/modelscript/modelscript/commit/5c68bb5))
- **core:** correct parameter propagation prefixing and structural AST cloning equality ([a7d4673](https://github.com/modelscript/modelscript/commit/a7d4673))
- **core:** separate when-equations from continuous DAE and solve dopri5 zero-crossing misses ([366c706](https://github.com/modelscript/modelscript/commit/366c706))
- **core:** fix syntax linter's UNBALANCED_MODEL rule to correctly ignore reinit nodes ([e20f59d](https://github.com/modelscript/modelscript/commit/e20f59d))
- **core:** reorder dense output interpolation to correctly represent instantaneous event transitions, pass directionality to dopri5 and bdf solvers to filter out reverse zero crossings ([96fe4ab](https://github.com/modelscript/modelscript/commit/96fe4ab))
- **core:** use cubic hermite interpolation for bdf solver dense output and event bisection ([1f47423](https://github.com/modelscript/modelscript/commit/1f47423))
- **core:** ensure exact zero-crossing output in dopri5 continuous integration ([b8fb07a](https://github.com/modelscript/modelscript/commit/b8fb07a))
- **core,cli:** rename optimizer.optimize to optimizer.solve to match new api ([40e7a2c](https://github.com/modelscript/modelscript/commit/40e7a2c))
- **lsp:** add xml to document selector so FMU model descriptions reach the LSP ([1e370a4](https://github.com/modelscript/modelscript/commit/1e370a4))
- **lsp:** enable javascript sidecar parsing and mcp compiler caching ([9611e6e](https://github.com/modelscript/modelscript/commit/9611e6e))
- **lsp:** resolve hover and definition resolution for fully-qualified class paths, fix diagramEdits build ([9923bd2](https://github.com/modelscript/modelscript/commit/9923bd2))
- **morsel, core, vscode:** align simulation intervals, prevent infinite rerender loops, streamline frontend UI, exclude assertions and other function forms from BLT, unify simulation parameters parsing and workflow across Morsel and VS Code ([4815cd9](https://github.com/modelscript/modelscript/commit/4815cd9))
- **morsel, vscode:** correct tree hierarchy parsing for nested derivative variables ([cc3549e](https://github.com/modelscript/modelscript/commit/cc3549e))
- **vscode:** make Modelica text editor the default for .mo files ([af3f16b](https://github.com/modelscript/modelscript/commit/af3f16b))
- **vscode:** resolve WebGL context loss and 3D visualizer asset loading, refactor React Suspense boundaries ([6b99eef](https://github.com/modelscript/modelscript/commit/6b99eef))
- **vscode:** resolve simulation breakpoints, DAP continuations, and array variables ([dd61de0](https://github.com/modelscript/modelscript/commit/dd61de0))
- **vscode:** replace naive bezier with catmull-rom spline, refine plot ui and lsp logs ([ffbf561](https://github.com/modelscript/modelscript/commit/ffbf561))

### 🔥 Performance

- **core:** O(1) SymbolTable for ModelicaDAE variable lookups, replace ~40 linear scans across flattener pipeline ([e0852df](https://github.com/modelscript/modelscript/commit/e0852df))
- **core:** replace sequential variable lookup in flattener with O(1) symbol table maps, add flat performance benchmark, update test diagnostics ([64aed7e](https://github.com/modelscript/modelscript/commit/64aed7e))
- **core:** optimize scope name resolution with O(1) caching ([32fb46b](https://github.com/modelscript/modelscript/commit/32fb46b))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

## 0.0.10 (2026-03-28)

### 🚀 Features

- **cli:** add --compile flag and cmake build system to fmu export ([3858cb7](https://github.com/modelscript/modelscript/commit/3858cb7))

### 🩹 Fixes

- **build:** add grammar.js to eslint allowDefaultProject to fix tree-sitter-modelica lint ([1506045](https://github.com/modelscript/modelscript/commit/1506045))
- **core:** extract start values from dae attributes, emit only referenced variable aliases in c codegen ([1ec8b6b](https://github.com/modelscript/modelscript/commit/1ec8b6b))
- **vscode:** fix readme screenshot url for marketplace ([a27c6a6](https://github.com/modelscript/modelscript/commit/a27c6a6))

### ❤️ Thank You

- Mohamad Omar Nachawati @nachawati

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
