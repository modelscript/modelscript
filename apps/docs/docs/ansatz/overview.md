# Ansatz Platform Overview

**Ansatz** (`ansatz.social`) is a federated engineering network and cloud computational platform powered by **ModelScript**. It extends the local ModelScript compiler and numerical solvers into a collaborative, web-native environment for systems engineers, dynamicists, and CAE practitioners.

---

## What is Ansatz?

While **ModelScript** provides the core command-line toolchain (`msx`), WebAssembly GLR parsers, and linear-memory DAE simulation engine, **Ansatz** serves as the collaborative platform layer. It provides:

1. **A Polyglot Package Registry:** A centralized and federated index for publishing and versioning Modelica, SysML v2, STEP, and ModelScript libraries with SPDX license auditing.
2. **Federated Engineering Feeds ("Morsels"):** W3C ActivityPub-powered social collaboration where engineers share executable simulation runs, 3D CAD/FEA/CFD snapshots, and schematic diffs across independent nodes.
3. **Cloud HPC Simulation Dispatcher:** An orchestration gateway bridging browser-based design with remote Slurm HPC clusters and continuum CAE solvers.
4. **Interactive Browser Runtime:** Monaco-powered code editing, WebAssembly client-side simulation, SVG schematic layout, and Three.js 3D CAD visualization.
5. **Digital Thread Explorer:** Cross-domain hypergraph navigation connecting requirements (`@satisfies`), tests (`@verifies`), and multi-physics artifacts.

---

## Architectural Separation: ModelScript vs. Ansatz

The monorepo maintains a clear boundary between the engine and the platform:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Ansatz Platform (apps/)                         │
│   • apps/web: React 19 SPA (ansatz.social, /playground, /embed)       │
│   • apps/api: Express, GraphQL, SPARQL, Git Smart HTTP, ActivityPub   │
├────────────────────────────────────────────────────────────────────────┤
│                       ModelScript Engine (packages/)                    │
│   • packages/runtime: SoA DAE arena, BLT, Salsa query engine           │
│   • packages/simulate: SUNDIALS CVODE/IDA, WebGPU solver               │
│   • packages/dsl: WASM GLR parser compiler, TGG graph rewriting        │
│   • languages/*: 44 engineering domain language parsers                │
└────────────────────────────────────────────────────────────────────────┘
```

The ModelScript engine is designed to be completely headless and can run inside the CLI (`msx`), inside local Node.js environments, or embedded directly inside the browser using WebAssembly. Ansatz is the cloud platform that hosts, shares, and coordinates these computations.

---

## Platform Surfaces

| Surface              | Route               | Description                                                                               |
| :------------------- | :------------------ | :---------------------------------------------------------------------------------------- |
| **Home & Feeds**     | `/home`, `/explore` | ActivityPub engineering posts, simulation morsels, and discussion threads.                |
| **Playground**       | `/playground`       | Dual-pane Monaco editor and live simulation canvas powered by client-side WebAssembly.    |
| **Package Registry** | `/packages`         | Search, publish, and inspect versioned engineering libraries with dependency trees.       |
| **Digital Thread**   | `/thread`           | Visual hypergraph explorer tracing requirements and Triple Graph Grammar correspondences. |
| **Administration**   | `/admin`            | Instance governance, moderation queues, S2S federation policies, and database backups.    |
| **Setup Wizard**     | `/setup`            | First-boot guided configuration for initializing standalone or enterprise nodes.          |
