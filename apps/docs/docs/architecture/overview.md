---
title: "Architecture Overview"
description: "ModelScript is built on a data-oriented, WebAssembly-first compiler architecture. Rather than allocating deep hierarchies of garbage-collected JavaScript AST wrapper objects, every stage of the com..."
---

# Architecture Overview

ModelScript is built on a **data-oriented, WebAssembly-first compiler architecture**. Rather than allocating deep hierarchies of garbage-collected JavaScript AST wrapper objects, every stage of the compiler—from GLR parsing to DAE flattening, sparse linear algebra, and formal verification—operates on contiguous **Struct-of-Arrays (SoA)** arenas in WebAssembly linear memory.

---

## End-to-End Compilation Pipeline

```mermaid
flowchart TB
    subgraph Languages["Polyglot Source Languages (81 Formats — 24 Stable & 57 Beta)"]
        direction TB
        MO[".mo (Modelica 3.x) / .mod (AMPL)"]
        SYS[".sysml / .kerml / .reqif / .oscal.json"]
        STEP[".step / .usd / .qif / .scad / .3mf"]
        OWL[".owl / .ofn / .ttl (OWL2)"]
        SSP[".ssp / .ssd / .ssv (SSP 1.0/2.0)"]
        PSCAD[".pscx / .raw / .dsl / .epc / .dss / .cir / .va"]
        TELECOM[".optical / .ran / .fiber / .ocpp / .openadr"]
        CAE[".cfd / .su2 / .fea / .inp / .feb"]
        MBD[".spck / .calc / .adm / .urdf / .osim / .gtfs"]
        FLOW[".opi / .lps / .bkp / .gproms / .yaml / .pqi / .tough / .prj / .nam"]
        AUTO[".arxml / .st / .aml / .slx / .ez5"]
        SPACE[".oem / .opm / .xtce / .roc"]
        BIO[".sbml / .ant / .bngl / .sbol / .ctl / .cellml"]
        MED[".rtplan / .topas / .nii / .igtl"]
        MSX[".msx / .modelscript (ModelScript)"]
    end

    subgraph Frontend["1. Linear-Memory Parsing & Indexing (@modelscript/dsl)"]
        GLR["Native WASM GLR Parser (parser.wasm)"]
        CST["Linear Memory CST Arena"]
        IDX["SymbolIndexer & Unified WorkspaceIndex"]
    end

    subgraph Semantics["2. Incremental Semantic Engine (@modelscript/runtime)"]
        SALSA["Salsa QueryEngine (Memoized Dependency Graph)"]
        TGG["Triple Graph Grammar (TGG) & DPO Rewriting Engine"]
        LINT["CompilerLint & Multi-Domain Semantic Lints"]
    end

    subgraph Lowering["3. Arena DAE Lowering & Formal Verification"]
        FLAT["ModelicaFlattener (AssemblyScript WASM Kernel + TS Bridge)"]
        DAE["DAEBuilder (SoA Linear Memory: varData, exprData, eqData)"]
        THEORY["Multi-Domain Theory Coordinator (13 Domain Oracles)"]
    end

    subgraph Backend["4. Causalization, Codegen & Execution (@modelscript/simulate)"]
        BLT["Hopcroft-Karp Matching + Tarjan BLT + Pantelides Index Reduction"]
        SOLVE["SUNDIALS IDA / CVODE / Radau IIA / Rodas4P / TR-BDF2 / Tsit5 / Dommel EMT / WebGPU"]
        FMU["FMI 2.0 / 3.0 C99 & WASM FMU Exporter (@modelscript/exchange)"]
    end

    Languages --> GLR --> CST --> IDX --> SALSA
    SALSA --> LINT
    SALSA --> TGG
    SALSA --> FLAT --> DAE
    DAE --> THEORY
    DAE --> BLT --> SOLVE
    DAE --> FMU
```

---

## Core Architectural Pillars

### 1. Zero-Wrapper Linear Memory CST & DAE Arena

Equations, expressions, and statements are lowered directly from 32-bit linear-memory CST node pointers (`u32`) into `DAEBuilder` integer IDs (`VarId`, `ExprId`, `EqId`, `StmtId`). This eliminates garbage-collection pauses even when flattening multi-thousand-equation Modelica Standard Library (MSL) models.

### 2. Demand-Driven Incremental Compilation (Salsa)

Inspired by the Rust compiler (`rust-analyzer`), `QueryEngine` implements the **Salsa** incremental recomputation algorithm (`fetch → deep_verify → execute → backdate`). When a user edits a parameter in the IDE, only queries whose transitive input hashes actually changed are recomputed.

### 3. Polyglot Synchronization via Triple Graph Grammars (TGG)

Cross-language traceability is enforced algebraically via **Double-Pushout (DPO)** graph rewriting (`packages/dsl/src/tgg.ts`) with **Critical Pair Analysis (CPA)** confluence verification (`packages/dsl/src/cpa.ts`). Changes in SysML v2 requirements, Modelica parameters, STEP CAD assemblies, or ModelScript `@unmanaged` structs propagate bidirectionally without losing comments or formatting.

### 4. Multi-Domain Theory Coordinator ($\text{CDCL}(\mathcal{T})$)

Thirteen specialized **Domain Theory Oracles**—spanning OWL2 Description Logic (`OntologyTheoryOracle`), SysML v2 intervals (`ConstraintTheoryOracle`), Zones/Octagons (`AbstractDomainOracle`), Barrier Certificates & Taylor Flowpipes (`ContinuousSafetyOracle`), DAE trajectories (`DynamicSimulationOracle`), 3D B-Rep clearance (`SpatialPhysicsOracle`), FEA/CFD contracts (`CaeContractOracle`), DAE structural matching (`CausalizationOracle`), SI dimensional analysis (`DimensionalOracle`), Assume-Guarantee refinement (`EntailmentOracle`), Kirchhoff/stream conservation (`FlowAlgebraOracle`), AP242 GD&T stack-up (`ToleranceStackOracle`), and Conformal UQ (`UqOracle`)—exchange variable bounds and Nelson-Oppen equalities until a global fixpoint or minimal unsatisfiable core (`UnsatCore`) is reached.

---

## Monorepo Package Matrix

| Package                   | Path                | Primary Responsibility                                                                                                                                                       |
| :------------------------ | :------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@modelscript/dsl`        | `packages/dsl`      | Grammar combinators, Ahead-of-Time WASM GLR parser compiler (`buildParser`), TGG/DPO engine, Critical Pair Analysis, E-graphs, CST semantic diff/merge                       |
| `@modelscript/runtime`    | `packages/runtime`  | Linear-memory `DAEBuilder`, `ArenaDAEPrinter`, Salsa `QueryEngine`, `WorkspaceIndex`, BLT/Pantelides solver, Sparse Arnoldi eigensolver, 13 Formal Theory Oracles            |
| `@modelscript/simulate`   | `packages/simulate` | Numerical integrators (SUNDIALS CVODE/IDA, Radau IIA, Rodas4P, TR-BDF2, Tsit5, DOPRI5, Dommel EMT), WebGPU contingency screener, PALC bifurcation, FNO surrogates            |
| `@modelscript/cad`        | `packages/cad`      | OpenCascade (OCCT) B-Rep kernel, CSG evaluator, STEP AP214/AP242 serializer, 3D tetrahedral FEA solver, 3D formal verification overlays, Gerber ECAD parser                  |
| `@modelscript/diagram`    | `packages/diagram`  | Polyglot schematic layout engine, orthogonal Manhattan router, TCC / R-X / P-Q / Water Diff specialized builders, SVG/Canvas renderer                                        |
| `@modelscript/exchange`   | `packages/exchange` | FMI 2.0/3.0 FMU import/export, SSP 1.0/2.0 container toolkit, Co-Simulation Master Orchestrator, MISRA-C / Q8.24 fixed-point firmware synthesizer, WebSerial HIL             |
| `@modelscript/lsp`        | `packages/lsp`      | Multi-language LSP server across all 81 languages, semantic tokens, hover, go-to-definition, code actions, background worker pool                                            |
| `@modelscript/mcp`        | `packages/mcp`      | Unified Model Context Protocol server exposing 92 core and 70+ domain-specific ModelScript compilation, simulation, verification, grid/water/telecom, and KG tools           |
| `@modelscript/ide-client` | `packages/ide`      | Reusable WebAssembly IDE client components, Monaco/CodeMirror language bindings, and dockable engineering viewports with 3D verification overlays                            |
| `@modelscript/examples`   | `packages/examples` | Curated multi-domain reference workspaces (CubeSat, EV Battery Pack, IEEE 39-Bus Grid, Robotic Arm, Aero-Structural Wing)                                                    |
| `modelscript` (`msx`)     | `apps/cli`          | Unified command-line interface (157 commands across `flatten`, `simulate`, `verify`, `dossier`, `gatekeeper`, `ampl`, `powerfactory`, `pslf`, `fmu`, `csg`, `surrogate`, etc.) |
| `@modelscript/api`        | `apps/api`          | REST, GraphQL, SPARQL, Regulatory Dossier, Grid Gatekeeper, and WebSocket simulation backend server                                                                          |
| `@modelscript/web`        | `apps/web`          | Ansatz Web application (Morsel, Studio, Package Registry, and social modeling platform)                                                                                      |
| `@modelscript/ee`         | `ee`                | Enterprise Edition (`LicenseRef-ModelScript-Enterprise`) — Ed25519 license verification, SSO/SAML, RBAC, Slurm HPC dispatcher, Digital Twin Historian, HIL                   |
