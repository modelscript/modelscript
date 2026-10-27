<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/diagram

ModelScript polyglot diagramming and visual schematic engine — AntV X6 interactive graph canvas, headless SVG schematic and icon renderer, declarative `PolyglotDiagramBuilder`, Sugiyama layered auto-layout, Topology-Shape-Metrics (TSM) and Manhattan A\* port routing, specialized domain layouts, perceptual dark-mode color inversion, semantic visual diffing, and real-time multi-user collaboration.

---

## Architecture & Capabilities

### 1. `PolyglotDiagramBuilder` (`@modelscript/diagram/builder`)

- **Language-Agnostic Graph Construction (`src/polyglot-diagram-builder.ts`)**: Reads any language's `SymbolIndex` and declarative `GraphicsConfig` (`node`, `edge`, `group`, `port-owner`, `compartment`, `port`) to produce AntV X6 cells or standalone SVG diagrams without language-specific glue code.
- **Modelica Graphical Annotations (`src/svg-renderer.ts`, `src/glyphs.ts`)**: Full coordinate-system interpreter for Modelica `Placement` (`transformation`, `iconTransformation`, `origin`, `extent`, `rotation`) and `Icon`/`Diagram` graphical primitives (`Line`, `Polygon`, `Rectangle`, `Ellipse`, `Text`, `Bitmap`, linear/radial gradients, and arrow markers).
- **Solder Dots & Junction Synthesis (`src/solder-dots.ts`)**: Automatically detects multi-branch wire T-junctions across orthogonal edge segments and synthesizes schematic junction nodes (`computeSolderDots`).

### 2. Auto-Layout & Obstacle-Avoiding Connector Routing

- **Sugiyama Layered & Incremental Layout (`@antv/layout`, `src/incremental-layout.ts`)**: Hierarchical Dagre/Sugiyama node placement that preserves existing user-authored `Placement` coordinates while automatically positioning newly added or unplaced components.
- **Topology-Shape-Metrics (TSM) Orthogonal Layout (`src/tsm-layout.ts`)**: Planarization, orthogonalization (Tamassia bend minimization), and compaction for dense physical schematics.
- **Manhattan A\* Port Router & ILP Port Assignment (`src/port-router.ts`, `src/port-ilp-solver.ts`)**:
  - `portOrthogonalRouter` (`port-orthogonal-astar`): Obstacle-avoiding orthogonal Manhattan A\* pathfinder with bend penalties, port normal exit stubs, collinear simplification (`simplifyCollinearPoints`), and edge-drag segment regularization (`regularizeOrthogonalPolyline`).
  - Connectors: `jumpover` (arc bridges at wire crossings), `fillet` (rounded orthogonal corners), and `smooth` / `bezier`.
  - `port-ilp-solver.ts`: Integer Linear Programming (ILP) port ordering and side assignment to minimize wire crossings before routing.

### 3. Specialized Multi-Domain Layouts

- **SysML v2 Diagrams**: Block Definition Diagrams (**BDD**), Internal Block Diagrams (**IBD**) with nested directional flow ports and conjugated port badges, **State Machine** diagrams, **Activity** diagrams, **Sequence** lifelines (`src/sequence-layout.ts`, `applySequenceLayout`), and **Swimlane** partition layouts (`src/swimlane-layout.ts`, `applySwimlaneLayout`).
- **Fault Tree Analysis (`src/fault-tree.ts`, `@modelscript/diagram/fault-tree`)**: IEC 61025 Fault Tree gate symbols (`AND`, `OR`, `XOR`, `VOTING k-out-of-n`, `INHIBIT`, `PRIORITY_AND`, basic/undeveloped/conditioning events), minimal cut-set highlighting, and top-event probability propagation.
- **OWL 2 Ontology Graphs**: Class hierarchy (`SubClassOf`), object property domain/range edges, and inferred axiom dashed overlays.
- **SSP 1.0 System Topology**: Multi-FMU architecture block diagrams with typed causal connectors and parameter mapping badges.
- **PSCAD & PSS/E Power Grid Diagrams (`src/pscad-diagram-builder.ts`, `src/psse-diagram-builder.ts`)**: Electrical power system Single-Line Diagrams (SLD), busbars, multi-winding transformers, transmission lines, breakers, generator capability limits, and Inverter-Based Resource (IBR) schematics.
- **Pipeline & Multiphase Fluid Networks (`src/olga-diagram-builder.ts`, `src/lps-diagram-builder.ts`)**: OLGA subsea flowline elevation bathymetry, topside risers, chokes, wells, and PipelineStudio continental compressor/regulator network graphs.
- **SIMA Offshore Marine Schematics (`src/sima-diagram-builder.ts`)**: Multi-body floater geometry, fairlead attachments, catenary mooring line touchdown profiles, and anchor polar spread layouts.

### 4. Perceptual Dark-Mode Color Inversion

- **Helmlab Perceptual Color Adaptation (`src/color-inversion.ts`)**: Converts hardcoded light-theme Modelica RGB colors into perceptually uniform CIE Lab / Helmlab space, inverting lightness ($L^*$) while preserving hue and chroma so MSL component icons remain high-contrast and legible on dark IDE canvases (`#1e1e1e`) and blueprint themes.

### 5. Semantic Visual Diff Bundles (`@modelscript/diagram/visual-diff`)

- **Structural Graph Diffing (`src/visual-diff-graph.ts`, `src/visual-diff-renderer.ts`)**: Computes semantic additions, deletions, parameter modifications, and re-routed connections between two model revisions (`added` in green, `removed` in red, `modified` in amber).
- **Standalone HTML Diff Bundles (`src/html-diff-bundle.ts`, `@modelscript/diagram/html-diff-bundle`)**: Generates self-contained, interactive dark-mode HTML visual pull-request review bundles with synchronized pan/zoom, side-by-side or overlay modes, and property inspection tables.

### 6. Real-Time Collaboration & Live Telemetry Animation

- **`CollabManager` & Presence Overlay (`src/collab-manager.ts`, `src/collab-overlay.ts`)**: Synchronizes multi-user remote cursors, viewport bounding boxes, component selection locks, and CRDT/OT diagram actions in real time.
- **Live Simulation Telemetry (`src/telemetry.ts`, `src/interactive.ts`)**: `animateCells` binds live simulation streams to schematic nodes and edges—animating wire flow particles, thermal/voltage colormaps, gauge needles, and interactive slider/toggle writeback controls (`defaultInteractiveStateManager`).

---

## Subpath Exports

| Subpath                                 | Module                            | Description                                                                                     |
| :-------------------------------------- | :-------------------------------- | :---------------------------------------------------------------------------------------------- |
| `@modelscript/diagram`                  | `src/index.ts`                    | Interactive AntV X6 graph controller, drag-and-drop placement, and bidirectional code writeback |
| `@modelscript/diagram/builder`          | `src/polyglot-diagram-builder.ts` | Language-agnostic `PolyglotDiagramBuilder` and `GraphicsConfig` types                           |
| `@modelscript/diagram/svg`              | `src/svg-renderer.ts`             | Headless SVG schematic and Modelica icon renderer                                               |
| `@modelscript/diagram/port-router`      | `src/port-router.ts`              | Obstacle-avoiding Manhattan A\* router, jumpovers, and fillets                                  |
| `@modelscript/diagram/fault-tree`       | `src/fault-tree.ts`               | IEC 61025 Fault Tree layout and gate renderers                                                  |
| `@modelscript/diagram/sequence-layout`  | `src/sequence-layout.ts`          | Lifeline and message ordering layout for sequence diagrams                                      |
| `@modelscript/diagram/swimlane-layout`  | `src/swimlane-layout.ts`          | Partitioned swimlane layout for activity workflows                                              |
| `@modelscript/diagram/visual-diff`      | `src/visual-diff-graph.ts`        | Semantic diagram diff engine (`VisualDiffGraph`)                                                |
| `@modelscript/diagram/html-diff-bundle` | `src/html-diff-bundle.ts`         | Self-contained interactive HTML visual diff generator                                           |
| `@modelscript/diagram/protocol`         | `src/protocol.ts`                 | Typed RPC message protocol between IDE host and diagram webviews                                |

---

## Scripts

```bash
# Compile TypeScript and bundle browser webview script (dist/diagram.browser.js)
npm run build --workspace=@modelscript/diagram

# Run unit tests (layout, port routing, SVG rendering, visual diff, color inversion)
npm run test --workspace=@modelscript/diagram

# Typecheck and lint
npm run typecheck --workspace=@modelscript/diagram
npm run lint --workspace=@modelscript/diagram
```
