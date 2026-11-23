<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/iges`

**IGES 5.3 (Initial Graphics Exchange Specification, ANSI Y14.26M / USPRO 1980–1996)** language package for ModelScript (**Beta** tier).

## Capabilities

- **Native WebAssembly GLR Parser (`@modelscript/dsl`)**: Declarative IGES 80-column section grammar (`S` Start, `G` Global with Hollerith strings `nH...`, `D` Directory Entry 2-line records, `P` Parameter Data, `T` Terminate) compiled to `dist/parser.wasm`.
- **Full IGES 5.3 Fixed-Column Parser & Serializer**: Supports entity types `100` (Circular Arc), `102` (Composite Curve), `104` (Conic Arc), `106` (Copious Data), `108` (Plane), `110` (Line), `116` (Point), `120` (Surface of Revolution), `122` (Tabulated Cylinder), `124` (Transformation Matrix), `126` (Rational B-Spline Curve / NURBS), `128` (Rational B-Spline Surface), `142` (Curve on Parametric Surface), `144` (Trimmed Parametric Surface), and `186` (Manifold Solid B-Rep Object).
- **Lints & Diagnostics (`IGES1001`–`IGES5006`)**: Column-width validation, Hollerith string length checks, section completeness & Terminate count parity, DE pointer integrity, odd-line DE record checks, degenerate line/arc detection, NURBS knot monotonicity & weight checks, and unit flag validation.
- **CAD / NURBS / B-Rep Evaluator & Lowering**: Exact Cox-de Boor rational B-spline curve (`126`) and surface (`128`) evaluation, 3×4 transformation (`124`), bounding box and arc-length computation, and lowering to `@modelscript/cad` solids and assemblies.
- **Projections**: Export IGES models directly to **STEP AP214** (`ISO 10303-21`) and **SVG** technical projections (`xy`, `xz`, `yz`, `iso`).
- **Cleanroom Standard Library (`@modelscript/iges-std-lib`)**: Zero-I/O registered entity schemas (`100`–`186`), unit conversion presets, SVG block icons, and AssemblyScript WASM geometry kernel.
- **Workspace Indexing & LSP**: UnifiedWorkspace symbol indexing, validation diagnostics, document symbols, hover documentation, and completions.

## Quick Start

```ts
import { parseIges, lintIges, evaluateIgesDocument, lowerIgesToCad, igesToStep, igesToSvg } from "@modelscript/iges";

const doc = parseIges(igesText);
const diagnostics = lintIges(doc);
const evaluation = evaluateIgesDocument(doc);
const cad = lowerIgesToCad(doc);
const stepText = igesToStep(doc);
const svgText = igesToSvg(doc, { view: "xy" });
```

## License

AGPL-3.0-or-later
