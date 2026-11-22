<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/web

**Ansatz (`ansatz.social`) Web Platform** powered by **ModelScript** (`@modelscript/web`) — unified React 19 & Vite frontend for the Ansatz federated scientific & engineering network (Models & ActivityPub), polyglot package registry, interactive Ansatz (`/editor`) and Studio (`/studio`), embeddable viewer (`/embed`), Cloud HPC & multi-physics simulation studio, Digital Thread Explorer, and white-label enterprise instance governance.

---

## Architecture & Capabilities

### 1. Package Registry & Class Explorer (`src/pages/libraries/`, `src/pages/package/`, `src/pages/class-detail/`)

- **Polyglot Package Registry (`LibraryListPage`, `LibraryVersionPage`, `PackageDetailPage`)**: Browse, search, publish (`PublishPackageModal`), and inspect versioned ModelScript, Modelica, SysML v2, STEP, and domain libraries with dependency trees, SPDX license metadata, and one-click AASX / OKH export.
- **Hierarchical Class & Symbol Navigation (`ClassDetailPage`, `ClassTree`)**: Navigate nested package hierarchies, inspect instantiated components and equations, and view rendered component icons and diagrams with perceptual dark-mode SVG color adaptation (`InvertedSvg`).

### 2. Interactive Polyglot Ansatz, Studio, IDE & Workspaces (`src/pages/playground/`, `src/pages/ide/`, `src/pages/workspace/`, `packages/editor/src/workbench/`)

- **Browser-Native Polyglot Editor — Ansatz (`PlaygroundPage`)**: Dual-pane Monaco code editor and visual canvas powered by shared workbench components in `packages/editor/src/workbench/`, supporting in-browser WebAssembly parsing, DAE flattening, ODE/DAE numerical simulation, Vega/Recharts trajectory plotting, AntV X6 schematic editing, and Three.js / WebXR 3D CAD visualization.
- **Embedded VS Code Web & Multi-File Workspaces (`IdeWorkspacePage`, `WorkspacePage`)**: Integrated VS Code Web engineering workbench (`/ide`) and multi-file polyglot workspace management with Git repository browsing (`RepositoryListPage`).
- **Embeddable Artifact Viewer (`EmbedPlaygroundPage`, `RenderArtifactPage`)**: Powers `<modelscript-morsel>` and `<modelscript-viewer>` (`@modelscript/embed`) with `#m=...` DEFLATE permalink hydration, deep-linked element anchor highlighting, and `postMessage` RPC control.

### 3. Federated Engineering Social Hub, Spaces & Scholarly Citations (`src/pages/HomeFeedPage.tsx`, `src/pages/space/`, `src/pages/references/`, `src/components/post/`)

- **Engineering Feeds & Models (`HomeFeedPage`, `FeedsPage`, `ExplorePage`, `PostDetailPage`)**: Share reproducible models and simulation runs, 3D CAD/FEA/CFD snapshots, schematic diffs (`PolyglotVersionDiffView`), executable scripts (`ScriptsListPage`, `ScriptDetailPage`), curated solutions (`SolutionPage`), and engineering templates (`TemplateDetailPage`).
- **Collaborative Engineering Spaces (`SpacesExplorePage`, `SpacePage`, `SpaceChatPage`)**: Topic- and project-scoped engineering communities with real-time chat, shared SysML v2 / Modelica workspaces, and supply-chain RFQ workflows.
- **Scholarly Citations & References (`ReferencesPage`, `SourceDetailPage`)**: Browse OpenAlex bibliographic references, model-to-paper citation graphs, and reproducible verification evidence.
- **ActivityPub Federation (`FederatedDomainPill`, `src/util/federation.ts`)**: Cross-instance federated following, post activity tracking (`PostActivityPage`), and real-time notifications (`RealtimeNotificationListener`).

### 4. Digital Thread, Cloud HPC & Specialized Viewers (`src/components/`)

- **Digital Thread Explorer (`DigitalThreadExplorer`, `CreateSemanticLinkModal`)**: Interactive cross-domain hypergraph visualizing `@satisfies`, `@verifies`, and TGG correspondence links across SysML v2, Modelica, STEP CAD, FEA, and CFD artifacts.
- **Cloud Simulation & Slurm HPC Launcher (`CloudSimulationModal`, `HpcArtifactPickerModal`, `TerminalLogViewer`)**: Configure and dispatch cloud simulation and continuum CAE sweeps, stream live worker logs, and inspect 3D VTK Unstructured Grid (`.vtu`) stress/velocity fields (`src/util/vtu-parser.ts`).
- **Domain Viewers**: `FmuSimulatorViewer` (interactive in-browser FMU execution), `SysmlViewer` (SysML v2 structural/behavioral view), and `DatasetTableViewer` (virtualized CSV/telemetry grid via `@tanstack/react-virtual`).

### 5. Authentication, Provisioning, Enterprise Governance & Offline Support (`src/pages/settings/`, `src/pages/admin/`, `src/pages/SetupWizardPage.tsx`)

- **Authentication & Security (`LoginPage`, `SignupPage`, `OAuthCallbackPage`, `AuthContext`)**: OAuth / OIDC SSO, TOTP 2FA, client-side cryptographic keystore (`src/util/keystore.ts`), and automated bot token management (`src/api/bots.ts`).
- **Instance Provisioning (`SetupWizardPage`)**: First-boot guided setup wizard for self-hosted CE/EE instances (initial admin account, branding, and federation configuration).
- **Admin, Billing & Feature Flags (`AdminPage`, `SettingsPage`, `DevFlagsModal`)**: Organization role governance (`src/api/governance.ts`), Stripe compute credit wallet management (`src/api/billing.ts`), and offline storage caching (`OfflineBanner`, `src/util/offline-storage.ts`).

---

## Scripts

| Command                 | Description                                              |
| :---------------------- | :------------------------------------------------------- |
| `pnpm run dev`          | Start Vite development server on port **3001**           |
| `pnpm run dev:flagship` | Start Vite development server for flagship local testing |
| `pnpm run build`        | Build production bundle with Vite (`dist/`)              |
| `pnpm run preview`      | Preview production build locally                         |
| `pnpm run test`         | Run component, utility, and integration test suites      |
| `pnpm run typecheck`    | Run TypeScript type checking (`tsc --noEmit`)            |
| `pnpm run lint`         | Run ESLint across `src/`, `tests/`, and `vite.config.ts` |
| `pnpm run clean`        | Remove `dist/` build output                              |

---

## Running

```bash
pnpm --filter @modelscript/web run dev
```

The web application starts on `http://localhost:3001` (with `/editor`, `/studio`, `/ide`, and `/embed/editor` routes enabled).

## Docker

```bash
docker compose up web
```

Exposes port **3001**.
