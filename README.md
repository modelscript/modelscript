<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript

[![CI/CD](https://github.com/modelscript/modelscript/actions/workflows/ci.yml/badge.svg?branch=main)](https://github.com/modelscript/modelscript/actions/workflows/ci.yml)
[![npm @modelscript/cli](https://img.shields.io/npm/v/@modelscript/cli?label=cli)](https://www.npmjs.com/package/@modelscript/cli)
[![Docker API](https://img.shields.io/badge/ghcr.io-api-blue?logo=docker)](https://ghcr.io/modelscript/api)
[![Docker Web](https://img.shields.io/badge/ghcr.io-web-blue?logo=docker)](https://ghcr.io/modelscript/web)
[![Docker IDE](https://img.shields.io/badge/ghcr.io-ide-blue?logo=docker)](https://ghcr.io/modelscript/ide)
[![VS Marketplace](https://img.shields.io/visual-studio-marketplace/v/modelscript.modelscript?label=VS%20Marketplace&logo=visualstudiocode)](https://marketplace.visualstudio.com/items?itemName=modelscript.modelscript)
[![Open VSX](https://img.shields.io/open-vsx/v/modelscript/modelscript?label=Open%20VSX&logo=eclipseide)](https://open-vsx.org/extension/modelscript/modelscript)

ModelScript is a Web-native, polyglot compiler & engineering intelligence platform that unifies modern open standards (SysML v2, Modelica, STEP, etc) and legacy/proprietary formats (.pscx, .gtm, .sima, .opi, .ez5, etc) into a continuous digital thread for end-to-end design, simulation, and analysis.

---

## Architecture Highlights

```
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                                 ModelScript Digital Thread                               │
├──────────────────┬─────────────────┬─────────────────┬─────────────────┬─────────────────┤
│  SysML v2 / OSLC │  Modelica / SSP │ STEP / CAD / CAE│ Power & Fluids  │ Legacy & SOTA   │
│  (Requirements)  │  (1D Dynamics)  │  (3D Continuum) │ (PSCAD/OLGA/LPS)│(GT-SUITE/SIMA/+)│
└────────┬─────────┴────────┬────────┴────────┬────────┴────────┬────────┴────────┬────────┘
         │                  │                 │                 │                 │
         ▼                  ▼                 ▼                 ▼                 ▼
┌──────────────────────────────────────────────────────────────────────────────────────────┐
│                 Native WebAssembly GLR Incremental Parsers & CST Arenas                  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                  Polyglot Triple Graph Grammars (TGG) & AOT Rewriting                    │
│           (Bidirectional forward/backward propagation & Critical Pair Analysis)          │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                      Salsa Query Engine & Workspace Symbol Index                         │
│                    (Incremental memoization, dependency invalidation)                    │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                       Semantic Theory Coordinator (Nelson-Oppen)                         │
│   Ontology ─── Constraint/Arithmetic ─── Abstract Domains ─── Continuous Safety ─── CAD  │
├──────────────────────────────────────────────────────────────────────────────────────────┤
│                        Data-Oriented DAE Arena & Solvers                                 │
│   DAEBuilder ── BLT ── SUNDIALS CVODE/IDA ── WebGPU Batched ── Direct Collocation Opt    │
└──────────────────────────────────────────────────────────────────────────────────────────┘
```

### 1. Polyglot Triple Graph Grammars (TGG)

ModelScript features a declarative, AOT-compiled **Triple Graph Grammar (TGG)** and Double-Pushout (DPO) graph rewriting engine (`@modelscript/dsl/tgg`). Rather than relying on fragile manual point-to-point synchronizers, TGG rules declaratively define correspondences between source, target, and correspondence graphs. The engine compiles these rules into high-performance AssemblyScript dispatch tables in WebAssembly (`tgg_forward_dispatch`, `tgg_backward_dispatch`, `tgg_propagate_all_stale`), verified for confluence and termination via integrated **Critical Pair Analysis (CPA)**.

### 2. Semantic Theory Coordinator (Nelson-Oppen Multi-Solver)

Cross-domain verification is orchestrated by a generalized **Nelson-Oppen Semantic Theory Coordinator** (`@modelscript/runtime/formal/theory_coordinator`), exchanging equality facts, tight numeric intervals, and conflict clauses across **12 domain theory oracles** with CDCL(T) case splitting:

- **Ontology Domain (`OntologyTheoryOracle`)**: Tableau Description Logic (DL) reasoner, OWL2 bundle closure, concept subsumption, and scoped disjointness.
- **Constraint Domain (`ConstraintTheoryOracle`)**: Non-linear interval contraction via HC4 contractor, DPLL(T) arithmetic solver, and variable domain bounding.
- **Abstract Domain (`AbstractDomainOracle`)**: Octagon Difference Bound Matrices (DBM), 4D spatio-temporal intervals, and relational numerical bounds.
- **Continuous Safety & Reliability Domain (`ContinuousSafetyOracle` / `SafetyTheoryOracle`)**: Reachability analysis via zonotopes, constrained zonotopes, star sets, Sum-of-Squares (SOS) barrier certificates, Fault Tree Analysis (FTA), Minimal Cut Sets (MCS), and ISO 26262 / DO-178C safety metrics.
- **Dynamic Simulation Domain (`DynamicSimulationOracle`)**: DAE numerical trajectory integration, Signal Temporal Logic (STL) quantitative robustness monitoring, and tolerance propagation.
- **Spatial Physics Domain (`SpatialPhysicsOracle`)**: Watertight B-Rep CAD solid query, collision/clearance checks, geometric mass properties, and 3D FEA/CFD field coupling.
- **CAE Contract Domain (`CaeContractOracle`)**: FEA structural stress/deflection and CFD aerodynamic performance contract verification synchronized with the Digital Thread hypergraph.
- **Causalization Domain (`CausalizationOracle`)**: Pantelides Index-1 structural non-singularity, algebraic loop solvability, and Nyquist-Shannon sampling stability verification.
- **Dimensional Domain (`DimensionalOracle`)**: ISO 80000 7-element rational exponent vector (`[L, M, T, I, Θ, N, J]`) dimensional homogeneity and unit consistency checking.
- **Entailment Domain (`EntailmentOracle`)**: V-Model requirements decomposition completeness proving ($\bigwedge R_{\text{child},i} \models R_{\text{parent}}$) with signed proof manifest generation.
- **Flow Algebra Domain (`FlowAlgebraOracle`)**: SysML v2 / KerML conjugated port involution (`~Port`), Kirchhoff conservative flow balancing, and 1D–3D CFD boundary flux coupling.
- **Tolerance Stack & UQ Domains (`ToleranceStackOracle`, `UqOracle`)**: STEP AP242 GD&T 1D/3D tolerance chain evaluation (Worst-Case, RSS, Six-Sigma $C_{pk}$) and stochastic Uncertainty Quantification via analytical CDFs and Monte Carlo sampling.

### 3. Data-Oriented Linear Memory Simulation (DAE Arena)

The simulation runtime employs a zero-allocation Struct-of-Arrays (SoA) layout (`DAEBuilder`) in linear WebAssembly memory. Equations, variables, and expressions are lowered directly from linear parser CST nodes into integer arena handles, enabling microsecond Pantelides index reduction, Tarjan BLT partition sorting, alias elimination, and SIMD/WebGPU batched numerical solving without garbage collection overhead.

### 4. Salsa-Based Incremental Computation

Inspired by Rust's Salsa, compilation, name resolution, and specialized class instances are fully memoized on a demand-driven dependency graph. When an engineer modifies a single equation or parameter, only transitively affected queries and DAE blocks are re-flattened.

---

## Supported Languages & Domain Capabilities

ModelScript provides first-class support for 19 engineering languages and simulation formats under `languages/`, each powered by native WebAssembly parsers, linear-memory CST arenas, and direct `DAEBuilder` lowering:

| Language & Directory                                                    | Domain & Role                                | Core Capabilities                                                                                                                                                                                                                                                     |
| :---------------------------------------------------------------------- | :------------------------------------------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **ModelScript**<br>[`languages/modelscript/`](./languages/modelscript/) | **Native Unified Multi-Domain Modeling**     | Native `.msx` declarative syntax combining acausal physical modeling, discrete state machines, spatial constraints, and high-performance compilation to WebAssembly DAE arena.                                                                                        |
| **Modelica**<br>[`languages/modelica/`](./languages/modelica/)          | **1D Multi-Domain Physical Simulation**      | Complete Modelica 3.x equation-based modeling; native AssemblyScript flattening kernel (`ModelicaFlattener`) supporting `hybrid`, `wasm`, `ts`, and `diff` modes; connector balancing; unit checking; BLT partition; and rigorous OpenModelica testsuite conformance. |
| **SysML v2 / KerML**<br>[`languages/sysml2/`](./languages/sysml2/)      | **Systems Architecture & Requirements**      | Systems Modeling Language v2 and Kernel Modeling Language (KerML) parsing, AST queries, KerML standard library snapshot, structural breakdown (part/item defs), state machine semantics, activity flows, and requirements verification.                               |
| **STEP (ISO 10303)**<br>[`languages/step/`](./languages/step/)          | **CAD Product Data & B-Rep Geometry**        | ISO 10303-21/203/214/242 parsing, geometric topological entity traversal, assembly hierarchy extraction, Geometric Dimensioning and Tolerancing (GD&T) annotations, and solid volume integration.                                                                     |
| **OWL2**<br>[`languages/owl2/`](./languages/owl2/)                      | **Ontological Knowledge & Taxonomy**         | OWL 2 Functional-Style Syntax parsing, ontology taxonomy indexing, axiom extraction, concept classification, subsumption checking, and knowledge graph mapping.                                                                                                       |
| **CSV**<br>[`languages/csv/`](./languages/csv/)                         | **Tabular Data & Telemetry Validation**      | High-throughput tabular parsing, schema validation, experimental sensor measurement loading, trajectory regression baselines, and parameter calibration datasets.                                                                                                     |
| **CFD**<br>[`languages/cfd/`](./languages/cfd/)                         | **Computational Fluid Dynamics**             | Mesh boundary condition parsing, flow domain specifications, aerodynamic coefficient extraction, and dialects for SU2 and OpenFOAM configurations.                                                                                                                    |
| **FEA**<br>[`languages/fea/`](./languages/fea/)                         | **Finite Element Analysis**                  | Structural mesh setup, material property assignments, load case definitions, displacement/stress field extraction, and CAE boundary contract verification.                                                                                                            |
| **OpenSCAD**<br>[`languages/scad/`](./languages/scad/)                  | **Programmatic Constructive Solid Geometry** | Constructive Solid Geometry (CSG) AST evaluation, 3D boolean transformations (union, difference, intersection), parametric dimension extraction, and AST patching.                                                                                                    |
| **SSP**<br>[`languages/ssp/`](./languages/ssp/)                         | **System Structure & Parameterization**      | System Structure and Parameterization standard packaging, multi-FMU co-simulation topologies, parameter set bindings, signal dictionary connections, and unit mappings.                                                                                               |
| **PSCAD**<br>[`languages/pscad/`](./languages/pscad/)                   | **EMT & Power Systems Modeling**             | `.pscx`/`.pslx` parsing, Dommel companion-circuit EMT & Bergeron traveling-wave line simulation, IEEE 2800-2022 ride-through verification, COMTRADE `.cfg`/`.dat` I/O, and Modelica/SSP/SLD projection.                                                               |
| **OLGA**<br>[`languages/olga/`](./languages/olga/)                      | **Multiphase Dynamic Flow Assurance**        | `.opi`/`.key` parsing, drift-flux hydrodynamic simulation, severe slugging envelope checks, hydrate/wax risk envelopes, and SysML v2/Modelica pipeline projection.                                                                                                    |
| **PipelineStudio**<br>[`languages/lps/`](./languages/lps/)              | **Pipeline Hydraulics & Transmission**       | `.lps`/`.tgx`/`.tlx` pipeline network parsing, steady-state Colebrook-White pressure drop, line pack inventory analysis, dynamic Gas Euler solver, and MAOP limit verification.                                                                                       |
| **PSS/E**<br>[`languages/psse/`](./languages/psse/)                     | **Transmission Grid Power Flow**             | `.raw`/`.dyr` network parsing, Newton-Raphson & Fast Decoupled power flow solving, bus branch thermal utilization, generator active/reactive capability limits, and SLD generation.                                                                                   |
| **EASY5**<br>[`languages/easy5/`](./languages/easy5/)                   | **Dynamic Simulation & Linear Analysis**     | `.ez5`/`.ezm` model parsing, continuous block diagram topology extraction, state-space Jacobians ($A, B, C, D$), frequency response (Bode/Nyquist), and Modelica/SSP export.                                                                                          |
| **ROCETS**<br>[`languages/rocets/`](./languages/rocets/)                | **Propulsion & Turbomachinery**              | NASA `.roc`/`.deck` liquid rocket engine parsing, power balance cycle solving, turbopump/combustion chamber operating lines, and transient blowdown simulation.                                                                                                       |
| **SIMA**<br>[`languages/sima/`](./languages/sima/)                      | **Offshore Marine & Slender Dynamics**       | SINTEF SIMO/RIFLEX card deck and `.sima` XML archive parsing, Cummins 6-DOF floater dynamics, DNV-OS-E301 line safety factors, catenary profile solving, and polar spread diagrams.                                                                                   |
| **GT-SUITE**<br>[`languages/gtsuite/`](./languages/gtsuite/)            | **1D Powertrain & Engine Simulation**        | `.gtm`/`.gtd` engine deck parsing, Wiebe combustion, Woschni heat transfer, crank-slider kinematics, turbocharger compressor maps, and DNV/emissions gate verification.                                                                                               |
| **Fortran**<br>[`languages/fortran/`](./languages/fortran/)             | **Legacy Scientific & Engineering Solvers**  | Fixed/free form Fortran (`.f`, `.f90`) parsing, variable declaration extraction, expression conversion, and direct lowering to linear WebAssembly DAE arena.                                                                                                          |

---

## Key Use Cases Enabled by this Architecture

1. **Continuous Multi-Domain Requirements Verification**:
   Automatically evaluate system requirements across disparate engineering domains. For example, verify that an electric vehicle battery pack's thermal dissipation (computed in 1D Modelica), structural stress limits (derived from 3D FEA), and spatial enclosure envelope (enforced by STEP CAD) simultaneously satisfy high-level SysML v2 safety requirements under uncertainty.
2. **Bidirectional Architecture ↔ Simulation Co-Evolution (TGG)**:
   Keep architecture and physics in permanent sync. Modifications to component hierarchies, ports, or ratings in SysML v2 are translated via forward TGG rewriting directly into Modelica physics models; reciprocally, parameter sizing optimizations discovered during simulation propagate backwards into architectural specifications.
3. **Surrogate Reduced Order Modeling (ROM)**:
   Extract high-fidelity 3D CFD or FEA simulation snapshots and construct ultra-fast, real-time surrogate models (polynomial chaos, Gaussian processes, neural ODEs). Embed these ROMs directly into real-time Modelica plant loops or web dashboards for sub-millisecond execution.
4. **Coordinated Multi-Theory Safety Certification**:
   Use the Nelson-Oppen Semantic Theory Coordinator to prove complex invariants that single solvers cannot resolve—combining symbolic ontology axioms (e.g. subsystem redundancy rules) with non-linear arithmetic constraints and dynamical reachability flowpipes (e.g. collision-free trajectories).
5. **Cross-Enterprise Interoperability & Audit Trails**:
   Ingest industry-standard requirements (ReqIF), architectural definitions (SysML v2), and CAD geometry (STEP), trace them via an immutable digital thread hypergraph, and export production-ready verification manifests and compliance artifacts.

---

## Monorepo Structure

ModelScript is managed with **Nx** and **npm workspaces**:

### Packages (`packages/`)

| Package                                         | Responsibility                                                                                                                    |
| ----------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| [`@modelscript/dsl`](./packages/dsl/)           | Grammar DSL syntax combinators, WASM GLR parser compiler (`buildParser`), TGG rewriting compiler, CPA engine, term-rewriting      |
| [`@modelscript/runtime`](./packages/runtime/)   | Linear-memory DAE arena, `DAEBuilder`, `ArenaDAEPrinter`, Salsa `QueryEngine`, `WorkspaceIndex`, Nelson-Oppen theory coordinator  |
| [`@modelscript/simulate`](./packages/simulate/) | Numerical simulation runner, SUNDIALS CVODE/IDA integration, WebGPU batched solver, surrogate ROM modeling, Monte Carlo           |
| [`@modelscript/lsp`](./packages/lsp/)           | Multi-language Language Server Protocol server, semantic analysis services, multi-file workspace indexing, background worker pool |
| [`@modelscript/diagram`](./packages/diagram/)   | Polyglot diagram builder, auto-layout engine, diagram protocol, dark-mode SVG rendering                                           |
| [`@modelscript/exchange`](./packages/exchange/) | FMI 2.0/3.0 FMU export/import, SSP container toolkit, Co-Simulation master orchestrator                                           |
| [`@modelscript/cad`](./packages/cad/)           | CAD and ECAD engine — CSG primitives, OpenCascade operations, STEP serialization/deserialization, Gerber parser                   |
| [`@modelscript/mcp`](./packages/mcp/)           | Model Context Protocol (MCP) server exposing ModelScript compilation, simulation, and query tools to AI agents                    |
| [`@modelscript/ide-client`](./packages/ide/)    | VS Code Web Extension client, custom editors, and webview panels                                                                  |
| [`@modelscript/examples`](./packages/examples/) | Cross-domain verification examples and reference models (`drone-chassis` and `drone-reachability` under `./packages/examples/`)   |

### Applications (`apps/`)

| Package                             | Responsibility                                                                                                            |
| ----------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| [`@modelscript/cli`](./apps/cli/)   | `modelscript` (`msx`) unified command-line toolchain — compile, simulate, optimize, lint, render, fmu, csg, surrogate, mc |
| [`@modelscript/api`](./apps/api/)   | REST, GraphQL, SPARQL, and simulation backend API server                                                                  |
| [`@modelscript/ide`](./apps/ide/)   | ModelScript VS Code Web IDE with GitHub repository integration                                                            |
| [`@modelscript/web`](./apps/web/)   | Web frontend — library registry, social explorer, and visual modeling playground (`/playground`)                          |
| [`@modelscript/docs`](./apps/docs/) | Unified modelscript.org website and documentation portal (VitePress)                                                      |

---

## Interoperability, Reporting & Export Formats

ModelScript bridges modern engineering workflows with extensive export and auditing formats:

- **FMI 2.0 & 3.0 FMU Export/Import**: Export standalone Modelica models as Functional Mock-up Units (Model Exchange and Co-Simulation) or import external FMUs into composite systems.
- **SSP Container Packaging**: Package complex multi-model simulation architectures according to the Modelica Association System Structure and Parameterization standard.
- **Standard Interop Gateways**: OSLC (Open Services for Lifecycle Collaboration) REST endpoints and ReqIF (Requirements Interchange Format) synchronization.
- **Auditing & Compliance Reports**:
  - **CTRF**: Common Test Report Format output for CI/CD test tracking.
  - **SARIF**: Static Analysis Results Interchange Format for deep linter and static verification diagnostics in GitHub Code Scanning.
  - **LaTeX**: High-precision formal verification certificates and mathematical proofs ready for academic or regulatory publication.
  - **Interactive HTML**: Self-contained graphical reports with embedded simulation trajectories and SVG diagrams.

---

## Getting Started

### Prerequisites

- **Node.js** ≥ 24 (see `.nvmrc`)
- **Git**

> [!NOTE]
> All language parsers are generated and executed in WebAssembly using Node.js devDependencies (`asc`). The Emscripten SDK (`emsdk`) is **not** required for standard development or parser compilation; it is only needed if rebuilding native C/C++ third-party solver libraries (`sundials`, `coin-or`) from source in `packages/simulate/scripts/`.

### Installation

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
npm install
```

### Building

Build all packages in dependency order via Nx:

```bash
npm run build
```

#### Building the VS Code Extension (.vsix)

```bash
# Build the complete standalone IDE extension into apps/ide/dist/extension/
npm run build:ide:extension

# Package the complete IDE extension into a deployable .vsix bundle (~121 MB)
npm run package:ide:extension

# Or generate a lightweight syntax-only extension into dist/extension/
npm run build:extension
```

### Running (Development)

Start development services concurrently:

```bash
npm run dev
```

This launches the primary development stack:

| Service  | Port / URL              | Description                                       |
| -------- | ----------------------- | ------------------------------------------------- |
| **API**  | `http://localhost:3000` | REST / GraphQL / SPARQL API server                |
| **Web**  | `http://localhost:3001` | Package registry, hub, and interactive playground |
| **IDE**  | `http://localhost:3003` | Browser-based VS Code Web IDE                     |
| **Docs** | `http://localhost:5173` | VitePress documentation portal                    |

#### Browser-Local AI Assistant (Optional)

The IDE includes a browser-local AI assistant powered by WebLLM (Qwen3-0.6B). To enable it, download the model weights (~350 MB, one-time):

```bash
npm run download-model --workspace=@modelscript/ide
```

---

## CLI Usage (`modelscript` / `msx`)

After building, the unified CLI is available as `modelscript` (alias `msx`):

```bash
# Compile / flatten a Modelica model to flat DAE
npx msx compile BouncingBall model.mo
npx msx flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL

# Simulate a model (CSV or JSON output)
npx msx simulate BouncingBall model.mo --stop-time 5
npx msx simulate BouncingBall model.mo --format json

# Export a model as an FMI 2.0/3.0 FMU
npx msx fmu MyModel model.mo --fmi-version 3 --output MyModel.fmu

# Solve an optimal control problem via direct collocation
npx msx optimize MyModel model.mo \
  --objective "u^2" --controls "u" --control-bounds "u:-1:1" --stop-time 10

# Continuous requirements verification
npx msx verify SystemRequirement model.mo architecture.sysml

# Evaluate CSG geometry in Modelica or project OpenSCAD to STEP
npx msx csg MyPart model.mo
npx msx polyglot project chassis.scad --target step --out chassis.step

# Train a parametric surrogate Reduced Order Model
npx msx surrogate MyPlant model.mo --inputs "R,C" --input-bounds "R:1:100,C:0.001:0.1" --outputs "v" --num-samples 100 --out-file surrogate.onnx

# Lint Modelica and polyglot files (supports 19 languages & legacy formats)
npx msx lint model.mo
npx msx lint network.pscx
npx msx lint flowline.opi

# Inspect, simulate, and verify legacy/SOTA industrial models
npx msx pscad simulate microgrid.pscx
npx msx olga simulate subsea_flowline.opi
npx msx gtsuite simulate engine.gtm

# Render a model diagram to SVG
npx msx render MyModel model.mo > diagram.svg
```

---

## Testing, Linting & Formatting

```bash
# Run tests for git-affected packages
npm test

# Run the complete test suite across all monorepo packages
npm run test:all

# Run OpenModelica testsuite runner
npm run test:modelica -- OpenModelica/flattening/modelica/types
npm run test:single -- OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo

# Update expected output against OpenModelica ground truth
npm run test:modelica:update -- OpenModelica/flattening/modelica/types/IntegerToEnumeration.mo

# Code quality checks
npm run lint
npm run format
```

---

## Docker Deployment

Pre-built multi-arch images are published to the GitHub Container Registry on pushes to `main`.

Run the complete multi-service stack with a single command:

```bash
docker compose pull    # Pull latest images from ghcr.io/modelscript/*
docker compose up -d   # Start all services
docker compose down    # Stop containers
docker compose logs -f # Tail logs
```

To build and run locally from source:

```bash
npm run docker:build
npm run docker:up
```

### Deployed Services & Ports

| Service         | Port           | Protocol | Description                                                            |
| --------------- | -------------- | -------- | ---------------------------------------------------------------------- |
| **API**         | `3000`         | HTTP     | Backend simulation, GraphQL, SPARQL, and verification API              |
| **Web**         | `3001`         | HTTP     | Library registry, hub, and visual playground (`/playground`)           |
| **IDE**         | `3003`         | HTTP     | Browser-based VS Code IDE with language server integration             |
| **MQTT**        | `1883`, `9001` | TCP, WS  | Eclipse Mosquitto broker for event bus & telemetry streaming           |
| **TimescaleDB** | `5432`         | TCP      | Time-series database for telemetry historian & simulation trajectories |

---

## License

ModelScript is licensed under the **AGPL-3.0-or-later**. See [COPYING](./COPYING) for more details.
