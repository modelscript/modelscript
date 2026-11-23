<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/canvas`

Polyglot Infinite Spatial Canvas (_Figma / Miro for Systems Engineering_) — a zoomable, multiplayer spatial whiteboard where live artifacts from all **106 ModelScript languages** coexist on a single infinite plane.

## Key Capabilities

- **Canonical `.mscanvas` Format & SSP Export** (`src/schema/`): Deterministic Git-friendly JSON schema, referential validator, canonical 6-artifact demo board factory (`Modelica` + `Simulink` + `KiCad` + `STEP` + `ReqIF` + `Monte Carlo UQ`), and SSP 1.0 XML export.
- **Infinite Spatial Engine** (`src/core/`): Double-precision `CameraController`, $O(K_{\text{visible}})$ uniform-grid `CanvasSpatialIndex`, 4-tier semantic LOD (`macro` / `thumbnail` / `interactive` / `focus`) with hysteresis, LRU `WebGlContextBudget` for 3D CAD tiles, and transactional `CanvasCommandBus` undo/redo.
- **106-Language Tile Registry** (`src/tiles/`): Routes all 106 ModelScript languages across 8 domain clusters onto 7 canonical tile archetypes (`schematic`, `ecad`, `cad3d`, `table`, `analytics`, `code`, `fmu`).
- **Live Visual Threads & FMI Wiring** (`src/threads/`): Sub-tile anchor projection (including 3D-to-2D STEP feature pins and scroll-clamped ReqIF rows), FMI causality/type/unit validation with conversion hints, `ThreadHypergraph` wire synthesis, and causal Blast-Radius spotlighting.
- **Multiplayer CRDT State & Presence** (`src/collab/`): Conflict-free LWW-Element-Map `CanvasCrdtStore` with Lamport clocks, delta convergence, peer cursors, and soft selection locks.
- **3-Layer Hybrid React Compositor** (`src/ui/SpatialCanvas.tsx`): Interactive host component shared by `@modelscript/web` and `@modelscript/ide`.

## Development

```bash
npm run build --workspace=@modelscript/canvas
npm run lint --workspace=@modelscript/canvas
npm run test --workspace=@modelscript/canvas
```
