<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/editor`

Host-agnostic visual modeling, diagramming, simulation, and code editor core for ModelScript.

Provides the shared **LSP Transport** (`EditorLspTransport`, `createHttpLspTransport`), **Host Context** (`EditorHostProvider`, `useEditorHost`), and reusable **Ansatz Workbench** (`Ansatz`, Monaco code editor, AntV X6 schematic canvas, 3D CAD viewer, and simulation plotters) so the same editor workbench runs seamlessly across:

- Production web (`apps/web`) over a WebWorker LSP connection
- Single-language dev ansatz (`scripts/tools/language-ansatz.ts`) over `/__ansatz/lsp` (`@modelscript/lsp/core`)
- Docs embeds (`apps/docs`, `@modelscript/embed`) and deterministic in-memory tests

---

## Architecture & Module Layout

### 1. Host & LSP Transport Abstractions (`src/host.tsx`, `src/transport.ts`)

- **`EditorLspTransport` (`src/transport.ts`)**: Transport-agnostic JSON-RPC interface decoupling editor UI from WebWorker, HTTP (`createHttpLspTransport`), and in-memory LSP hosts.
- **`EditorHostProvider` & `useEditorHost` (`src/host.tsx`)**: React context injecting transport, theme, file operations, and feature flags into the workbench tree.

### 2. Shared Workbench UI (`src/workbench/`)

- **Core Workbench Shell**: `Ansatz.tsx`, `AnsatzEditorHostContext.tsx`, `AnsatzEditorLoadingScreen.tsx`, `Preview.tsx`, `ansatz-editor.css`.
- **Code, Schematic & 3D Views**: `Code.tsx` (Monaco editor), `Diagram.tsx` (AntV X6 interactive schematic canvas), `cad-viewer/` (Three.js 3D CAD/CAE viewport), `markdown/` (Markdown + KaTeX rendering).
- **Simulation, Co-Simulation & Inspection**: `SimulationParameters.tsx`, `SimulationResults.tsx`, `simulation-results/`, `ParameterSliderRibbon.tsx`, `CosimPanel.tsx`, `CloudDispatchModal.tsx`, `Properties.tsx`, `Tree.tsx`, `VariablesTree.tsx`, `ComponentList.tsx`, `panels/`.
- **Library & Model Ingestion**: `AddLibraryModal.tsx`, `OpenModelModal.tsx`, `OpenFileDropzone.tsx`, `componentGalleryCatalog.ts`, `openModelCatalog.ts`.

### 3. Internal Utilities (`src/internal/`)

- High-performance canvas plotting (`IndexedCanvasPlot.tsx`, `csv-telemetry-chart.ts`, `CsvViewer.tsx`, `tabular-data-parser.ts`), Monaco/SVG theming (`monaco-theme.ts`, `svg-theme.ts`), Modelica parameter parsing (`modelica-params.ts`), binary export helpers (`binary-export.ts`), and local AI runtime glue (`local-ai-runtime.ts`).

---

## Subpath Exports

| Subpath                          | Module             | Description                                            |
| :------------------------------- | :----------------- | :----------------------------------------------------- |
| `@modelscript/editor`            | `src/index.ts`     | Root barrel re-exporting `host` and `transport`        |
| `@modelscript/editor/transport`  | `src/transport.ts` | `EditorLspTransport` and `createHttpLspTransport`      |
| `@modelscript/editor/host`       | `src/host.tsx`     | `EditorHostProvider` and `useEditorHost` React context |
| `@modelscript/editor/workbench`  | `src/workbench/`   | Shared `Ansatz` workbench components (`./workbench/*`) |
| `@modelscript/editor/internal/*` | `src/internal/*`   | Internal plotting, telemetry, and theme utilities      |

---

## Scripts

```bash
pnpm --filter @modelscript/editor run build      # Compile TypeScript (tsc)
pnpm --filter @modelscript/editor run typecheck  # Typecheck (tsc --noEmit)
pnpm --filter @modelscript/editor run lint       # Run ESLint across src/
pnpm --filter @modelscript/editor run clean      # Remove dist/ & tsbuildinfo
```
