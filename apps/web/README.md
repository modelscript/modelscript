<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/web

**Ansatz (`ansatz.social`) Web Platform** powered by **ModelScript** (`@modelscript/web`) — unified React 19 & Vite frontend for the Ansatz federated scientific & engineering network (Morsels & ActivityPub), polyglot package registry, interactive playground (`/playground`), embeddable viewer (`/embed`), Cloud HPC & multi-physics simulation studio, Digital Thread Explorer, and white-label enterprise instance governance.

---

## Architecture & Capabilities

### 1. Package Registry & Class Explorer (`src/pages/libraries/`, `src/pages/package/`, `src/pages/class-detail/`)

- **Polyglot Package Registry (`LibraryListPage`, `LibraryVersionPage`, `PackageDetailPage`)**: Browse, search, publish (`PublishPackageModal`), and inspect versioned ModelScript, Modelica, SysML v2, STEP, and domain libraries with dependency trees, SPDX license metadata, and one-click AASX / OKH export.
- **Hierarchical Class & Symbol Navigation (`ClassDetailPage`, `ClassTree`)**: Navigate nested package hierarchies, inspect instantiated components and equations, and view rendered component icons and diagrams with perceptual dark-mode SVG color adaptation (`InvertedSvg`).

### 2. Interactive Polyglot Playground & Embed Runtime (`src/pages/playground/`, `src/pages/EmbedPlaygroundPage.tsx`)

- **Browser-Native Polyglot Playground (`PlaygroundPage`)**: Dual-pane Monaco code editor and visual canvas supporting in-browser WebAssembly parsing, DAE flattening, ODE/DAE numerical simulation, Vega/Recharts trajectory plotting, AntV X6 schematic editing, and Three.js / WebXR 3D CAD visualization.
- **Embeddable Artifact Viewer (`EmbedPlaygroundPage`, `RenderArtifactPage`)**: Powers `<modelscript-viewer>` (`@modelscript/embed`) with `#m=...` DEFLATE permalink hydration, deep-linked element anchor highlighting, and `postMessage` RPC control.

### 3. Federated Engineering Social Hub & Morsels (`src/pages/HomeFeedPage.tsx`, `src/components/morsel/`, `src/components/post/`)

- **Engineering Feeds & Morsels (`HomeFeedPage`, `FeedsPage`, `ExplorePage`, `PostDetailPage`, `MorselComposeModal`)**: Share interactive simulation runs, 3D CAD/FEA/CFD snapshots, schematic diffs (`PolyglotVersionDiffView`), executable scripts (`ScriptsListPage`, `ScriptDetailPage`), and engineering templates (`TemplateDetailPage`).
- **ActivityPub Federation (`FederatedDomainPill`, `src/util/federation.ts`)**: Cross-instance federated following, post activity tracking (`PostActivityPage`), and real-time notifications (`RealtimeNotificationListener`).

### 4. Digital Thread, Cloud HPC & Specialized Viewers (`src/components/`)

- **Digital Thread Explorer (`DigitalThreadExplorer`, `CreateSemanticLinkModal`)**: Interactive cross-domain hypergraph visualizing `@satisfies`, `@verifies`, and TGG correspondence links across SysML v2, Modelica, STEP CAD, FEA, and CFD artifacts.
- **Cloud Simulation & Slurm HPC Launcher (`CloudSimulationModal`, `HpcArtifactPickerModal`, `TerminalLogViewer`)**: Configure and dispatch cloud simulation and continuum CAE sweeps, stream live worker logs, and inspect 3D VTK Unstructured Grid (`.vtu`) stress/velocity fields (`src/util/vtu-parser.ts`).
- **Domain Viewers**: `FmuSimulatorViewer` (interactive in-browser FMU execution), `SysmlViewer` (SysML v2 structural/behavioral view), and `DatasetTableViewer` (virtualized CSV/telemetry grid via `@tanstack/react-virtual`).

### 5. Authentication, Enterprise Governance & Offline Support (`src/pages/settings/`, `src/pages/admin/`)

- **Authentication & Security (`LoginPage`, `SignupPage`, `OAuthCallbackPage`, `AuthContext`)**: OAuth / OIDC SSO, TOTP 2FA, client-side cryptographic keystore (`src/util/keystore.ts`), and automated bot token management (`src/api/bots.ts`).
- **Admin, Billing & Feature Flags (`AdminPage`, `SettingsPage`, `DevFlagsModal`)**: Organization role governance (`src/api/governance.ts`), Stripe compute credit wallet management (`src/api/billing.ts`), and offline storage caching (`OfflineBanner`, `src/util/offline-storage.ts`).

---

## Scripts

| Command             | Description                                              |
| :------------------ | :------------------------------------------------------- |
| `npm run dev`       | Start Vite development server on port **3001**           |
| `npm run build`     | Build production bundle with Vite (`dist/`)              |
| `npm run preview`   | Preview production build locally                         |
| `npm run test`      | Run component, utility, and integration test suites      |
| `npm run typecheck` | Run TypeScript type checking (`tsc --noEmit`)            |
| `npm run lint`      | Run ESLint across `src/`, `tests/`, and `vite.config.ts` |
| `npm run clean`     | Remove `dist/` build output                              |

---

## Running

```bash
npm run dev --workspace=@modelscript/web
```

The web application starts on `http://localhost:3001` (with `/playground` and `/embed/playground` routes enabled).

## Docker

```bash
docker compose up web
```

Exposes port **3001**.
