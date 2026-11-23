<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# `@modelscript/apt`

ModelScript **Beta** language package for **APT** (_Automatically Programmed Tools_, MIT Servomechanisms Laboratory 1957–1960s / ISO 4342 CNC part programming language).

## Features

- **Native WASM GLR Parser (`@modelscript/dsl`)**: Declarative grammar for APT part programs (`.apt`, `.aptsource`, `.cls`) covering header directives (`PARTNO`, `MACHIN`, `UNITS`, `INTOL`, `OUTTOL`), machining setup (`CUTTER`, `SPINDL`, `FEDRAT`, `COOLNT`, `RAPID`), analytic geometry definitions (`POINT`, `LINE`, `CIRCLE`, `PLANE`, `PATERN`), continuous-path and point-to-point motion statements (`FROM`, `GOTO`, `GODLTA`, `GO`, `GOLFT`, `GORGT`, `GOFWD`, `GOBACK`, `GOUP`, `GODOWN` with `TO`/`ON`/`PAST`/`TANTO` modifiers), `FINI`, and `$$` comments.
- **CLDATA Analytic Geometry Solver & CAD Lowering**: Evaluates 2D/3D analytic geometry intersections (line-line, line-circle tangency/intersection, fillet circles) with exact cutter radius offset (`TO`/`ON`/`PAST`/`TANTO`), generating CLDATA toolpaths and `@modelscript/cad` swept CSG assemblies.
- **DAE Machining Physics Lowering**: Lowers cutting power, material removal rate (MRR), spindle torque, feed progress ODE, and cycle time into `@modelscript/runtime` `DAEBuilder`.
- **Projections**: Compiles CLDATA toolpaths to **RS-274 G-code** (`G00`/`G01`/`G02`/`G03`, `M03`/`M05`/`M08`/`M30`) and standalone **SVG** toolpath diagrams.
- **Static Analysis & Linting (`APT1001`–`APT5006`)**: Validates syntax, duplicate labels, undefined geometry references, cutter/feed/spindle bounds, motion ordering, geometric non-intersection, and program termination.
- **Cleanroom Standard Library (`@modelscript/apt-std-lib`)**: Zero-I/O bundle of APT geometric and motion schemas with cleanroom SVG icons and AssemblyScript WASM runtime.
- **Indexing & LSP**: UnifiedWorkspace indexing, diagnostics, document symbols, hover, and completions.

## Scripts

```bash
npm run build        # Build WASM parser, cleanroom stdlib, and TypeScript
npm run typecheck    # TypeScript typecheck
npm run lint         # ESLint check
npm test             # Run unit, grammar, benchmark, CAD, projection, and LSP tests
```
