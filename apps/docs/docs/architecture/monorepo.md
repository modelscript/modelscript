# Monorepo Architecture: ModelScript & Ansatz

ModelScript and Ansatz are developed together within a single unified monorepo. This document details the architectural rationale, the four-layer taxonomy, and the boundary enforcement mechanisms that keep the computational engine decoupled from web and cloud platforms.

---

## The 4-Layer Architectural Taxonomy

To maintain modularity and avoid circular dependencies, the codebase is structured into four explicit layers:

```
┌────────────────────────────────────────────────────────────────────────┐
│ Layer 4: Enterprise Edition (ee/)                                     │
│   • Air-gapped Ed25519 licensing, ITAR / NERC CIP, FDA 21 CFR Part 11  │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 3: The Ansatz Platform (apps/web, apps/api, packages/embed)      │
│   • ansatz.social, package registry, ActivityPub, Cloud HPC, billing   │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 2: Developer Tooling & Surfaces (apps/cli, desktop, ide, docs)   │
│   • msx CLI, VS Code Web extension, Tauri studio, VitePress portal     │
├────────────────────────────────────────────────────────────────────────┤
│ Layer 1: Core Engine & Languages (languages/*, packages/{dsl,runtime…})│
│   • WASM GLR parsers, CST arena, DAEBuilder, solvers, TGG, CAD, FMI    │
└────────────────────────────────────────────────────────────────────────┘
```

### Layer 1: Core Engine & Languages

- **Directories:** `languages/*` (44 domain languages) and `packages/{dsl,runtime,simulate,cad,diagram,exchange,lsp,mcp}`.
- **Rule:** Pure computation, formal theory, parsers, and solvers. Zero UI dependencies, zero database dependencies, and zero Express/HTTP servers.
- **Independence:** Can be compiled and embedded in any JavaScript, Node.js, WebAssembly, or desktop runtime.

### Layer 2: Developer Tooling & Surfaces

- **Directories:** `apps/cli`, `apps/ide`, `apps/desktop`, `apps/docs`.
- **Rule:** User-facing toolchains and documentation. Imports from Layer 1 to expose commands (`msx`), IDE extensions, and the reference manual.

### Layer 3: The Ansatz Platform

- **Directories:** `apps/web`, `apps/api`, `packages/embed`, `packages/react`, `packages/design-tokens`.
- **Rule:** The flagship web platform (`ansatz.social`), polyglot package registry, ActivityPub federation, Slurm HPC cluster execution, and enterprise team governance.
- **Relationship:** Consumes Layer 1 and Layer 2 packages via workspace dependencies, providing the visual modeling and collaborative cloud surface for the compiler.

### Layer 4: Enterprise Edition

- **Directories:** `ee/`.
- **Rule:** Commercial features subject to the Enterprise License. Open-core libraries in Layer 1 and Layer 2 never import from `ee/`.

---

## Architectural Rationale: Why a Unified Monorepo?

### 1. Atomic Co-Evolution

Ansatz is a scientific and engineering platform, not a simple CRUD service. When changes occur in the WebAssembly DAE arena, the CST parser nodes, or the solver output formats, the API dispatch layer and the browser-native WebAssembly UI are updated in the same commit.

### 2. Elimination of Publishing Bottlenecks

`@modelscript/api` and `@modelscript/web` consume over 20 internal workspace packages. Developing across separate repositories would require continuous version bumps, registry publishing, and downstream synchronization, introducing operational delay.

### 3. End-to-End Type Safety

TypeScript interfaces, AST node structures, and simulation results share exact definitions across the compiler, backend services, and web client. Breaking API changes are caught at compile time across all packages.

---

## Boundary Enforcement Mechanisms

Architectural separation is enforced automatically in CI:

1. **Nx Project Graph Verification (`npm run lint:repo`):**
   - The dependency graph is inspected by `scripts/check-nx-cycles.js`.
   - Core engine packages (`packages/*`) and languages (`languages/*`) are verified to have zero imports from `apps/*` or `ee/`.
2. **One-Way Open-Core Boundary:**
   - ESLint and `scripts/lint-package-manifests.ts` verify that open-core packages never declare dependencies on `@modelscript/ee`.
3. **Hardware-Aware Testing:**
   - Dynamic resource management in `scripts/test-coordinator.js` partitions tests based on CPU and memory availability.
