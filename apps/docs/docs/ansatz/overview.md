# Ansatz Platform Overview

**Ansatz** (`ansatz.social`) is a federated engineering network and cloud computational platform powered by **ModelScript**. It extends the local ModelScript compiler and numerical solvers into a collaborative, web-native environment for systems engineers, dynamicists, researchers, and CAE practitioners.

---

## What is Ansatz?

While **ModelScript** provides the core command-line toolchain (`msx`), WebAssembly GLR parsers, and linear-memory DAE simulation engine, **Ansatz** serves as the collaborative platform layer. It provides:

1. **A Polyglot Package Registry:** A centralized and federated index for publishing and versioning Modelica, SysML v2, STEP, SBML, and ModelScript libraries with SPDX license auditing and polyglot standard library discovery (`msx stdlib`).
2. **Federated Engineering Feeds ("Morsels"):** W3C ActivityPub-powered social collaboration where engineers share executable simulation runs across 65+ languages, 3D CAD/FEA/CFD snapshots, and schematic diffs across independent nodes.
3. **Scholarly Citations & Literature Graph (`/references`):** Integrated OpenAlex, Crossref, BibTeX, and RIS bibliographic hub linking peer-reviewed literature (`[@cite_key]`) directly to executable models, parameters, and verification morsels.
4. **Personal Activity Git Vault:** Every user account is backed by a cryptographically signed, user-owned Git repository vault that versions posts, model snapshots, citations, and annotations for complete data sovereignty and offline Git portability.
5. **Cloud HPC Simulation Dispatcher:** An orchestration gateway bridging browser-based design with remote Slurm HPC clusters and continuum CAE solvers.
6. **Interactive Browser Runtime:** Monaco-powered code editing, WebAssembly client-side simulation, equation-level DAP debugging, SVG schematic layout, and Three.js 3D CAD visualization.
7. **Digital Thread Explorer:** Cross-domain hypergraph navigation connecting requirements (`@satisfies`), tests (`@verifies`), scholarly references, and multi-physics artifacts.

---

## Architectural Separation: ModelScript vs. Ansatz

The monorepo maintains a clear boundary between the engine and the platform:

```
┌────────────────────────────────────────────────────────────────────────┐
│                        Ansatz Platform (apps/)                         │
│   • apps/web: React 19 SPA (ansatz.social, /morsel, /references)       │
│   • apps/api: Express, GraphQL, SPARQL, Git Smart HTTP, ActivityPub   │
├────────────────────────────────────────────────────────────────────────┤
│             Enterprise Edition (ee/ — LicenseRef-Enterprise)           │
│   • @modelscript/ee: SSO/SAML, RBAC, Slurm HPC, NERC CIP, Historian   │
├────────────────────────────────────────────────────────────────────────┤
│            ModelScript Open-Core Engine (packages/, languages/)        │
│   • packages/runtime: SoA DAE arena, BLT, Salsa query engine           │
│   • packages/simulate: SUNDIALS CVODE/IDA, WebGPU solver               │
│   • packages/dsl: WASM GLR parser compiler, TGG graph rewriting        │
│   • languages/*: 66 engineering & scientific domain language parsers   │
└────────────────────────────────────────────────────────────────────────┘
```

The ModelScript engine is designed to be completely headless and can run inside the CLI (`msx`), inside local Node.js environments, or embedded directly inside the browser using WebAssembly. Ansatz is the cloud platform that hosts, shares, and coordinates these computations.

---

## Platform Surfaces

| Surface                  | Route               | Description                                                                                   |
| :----------------------- | :------------------ | :-------------------------------------------------------------------------------------------- |
| **Home & Feeds**         | `/home`, `/explore` | ActivityPub engineering posts, executable simulation morsels, and discussion threads.         |
| **Ansatz Morsel**        | `/morsel`           | Dual-pane Monaco editor and live simulation canvas powered by client-side WebAssembly.        |
| **Ansatz Studio**        | `/studio`           | Web-native engineering IDE workbench with LSP intelligence and DAP simulation debugger.       |
| **Scholarly References** | `/references`       | OpenAlex / DOI / BibTeX citation manager and literature-to-model traceability graph.          |
| **Package Registry**     | `/packages`         | Search, publish, and inspect versioned engineering libraries with dependency trees.           |
| **Digital Thread**       | `/thread`           | Visual hypergraph explorer tracing requirements and Triple Graph Grammar correspondences.     |
| **Personal Git Vault**   | `/settings`         | Cloneable, signed Git repository backing all personal morsels, models, and scholarly records. |
| **Administration**       | `/admin`            | Instance governance, moderation queues, S2S federation policies, and database backups.        |
| **Setup Wizard**         | `/setup`            | First-boot guided configuration for initializing standalone or enterprise nodes.              |

---

## Replacing Legacy Desktop Workflows

Ansatz serves as the collaborative platform layer designed to systematically displace the file silos, seat-tax barriers, and isolated environments of legacy first-party engineering tools (Dassault Systèmes Dymola and Cameo, MathWorks Simulink, Manitoba Hydro PSCAD, and SLB OLGA).

For a detailed analysis of the 5-stage adoption wedge (Zero-Install Review, Cross-Domain Digital Thread, Git-Native CI/CD, Executable Decision Records, and Cloud HPC Offload) and tool-specific displacement playbooks, see the [Workflow Replacement Guide](/ansatz/workflow-replacement).
