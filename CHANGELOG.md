## 0.1.0 (2026-11-02)

### 🚀 Features

- **compiler:** native WebAssembly GLR parser compiler (`buildParser`), arena-native compilation pipeline (`DAEBuilder`), Salsa incremental `QueryEngine`, Triple Graph Grammars (TGG), Critical Pair Analysis (CPA), and E-graph equality saturation (`@modelscript/dsl`, `@modelscript/runtime`)
- **languages:** polyglot engineering compiler supporting 44 domain languages including Modelica 3.x, SysML v2, STEP (ISO 10303), OWL2 (SROIQ(D) tableau reasoner), PSCAD, PSSE, OpenDSS, GENSYS, SIMPACK, OLGA, SPICE, SBML, SWMM, OpenDRIVE, OpenSCENARIO, ReqIF, SSP, and native ModelScript (`.msx`)
- **simulate:** numerical DAE/ODE simulation engine with SUNDIALS CVODE/IDA, variable-order BDF, DOPRI5, WASM Pantelides index reduction, Kron tearing, interval arithmetic, McCormick relaxations, homotopy continuation, WebGPU batched solvers, surrogate ROMs, and Monte Carlo analysis (`@modelscript/simulate`)
- **exchange:** FMI 2.0 and FMI 3.0 FMU export/import (Model Exchange, Co-Simulation, Scheduled Execution), directional derivatives, terminals and icons XML, SSP 1.0 container toolkit, and distributed MQTT/WASM co-simulation orchestrator (`@modelscript/exchange`)
- **cad:** Constructive Solid Geometry (CSG), OpenCascade/Manifold B-Rep kernel, STEP AP242 tessellation and assembly extraction, web-native ECAD PCB layout, netlist extraction, and Gerber DRC (`@modelscript/cad`, `@modelscript/diagram`)
- **tooling:** polyglot Language Server Protocol (`@modelscript/lsp`), Model Context Protocol server with formal verification tools (`@modelscript/mcp`), unified `msx` CLI (`@modelscript/cli`), VS Code Web IDE (`@modelscript/ide`), and Tauri v2 desktop application (`@modelscript/desktop`)
- **platform:** Ansatz federated engineering platform (`@modelscript/api`, `@modelscript/web`, `@modelscript/react`, `@modelscript/embed`) with ActivityPub federation, Personal Activity Git Vault (Git Smart HTTP), SED-ML/SSP/DAKOTA simulation studies, and polyglot package registry
- **ee:** Enterprise Edition (`@modelscript/ee`) with offline Ed25519 license verification, NERC CIP / FERC CEII / FDA 21 CFR Part 11 compliance, SSO/SAML, RBAC, Slurm HPC dispatch, and Digital Twin historian

### 🩹 Fixes

- **ci:** add Smart Hybrid version resolution, idempotent registry publishing, and `minimatch` v11 compatibility shim for Nx release workflows
- **compiler:** enforce strict real/integer coercion rules, nested record field constant folding, and balanced DAE verification across Modelica and polyglot flatteners
- **web:** include synthesized fallback files for non-activity repositories and harden SSR component typing

### 🔥 Performance

- **compiler:** linear-memory Struct-of-Arrays (SoA) DAE lowering, WASM annotation evaluation kernel, pre-baked MSL 4.1.0 icon hydration, and $O(1)$ symbol table lookups
- **ci:** dynamic RAM/CPU-aware test factorization (`test-coordinator.js`), 8-shard parallel test matrix, and pre-built multi-target Docker Bake caching
