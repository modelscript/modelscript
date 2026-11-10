<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/fiber

Optical Fiber Outside Plant (OSP), ANSI/TIA-598-D color code registry, NESC C2 structural pole loading & catenary sag-tension, and cable cadastre GIS package for ModelScript. Features TIA-598-D 12-color strand/tube lookup, high-count cable hierarchies, fiber splice closure mapping, GeoJSON outside plant cadastre parsing, NESC C2 Light/Medium/Heavy ice & wind sag-tension and pole make-ready verification (`src/structural/nesc-sag-tension.ts`), OTDR distance-to-GIS coordinate fault localization (`src/spatial/otdr-fault-localizer.ts`), direct `DAEBuilder` lowering (`src/dae/lowering.ts`), and 3 dedicated MCP tools (`fiber_trace_strand`, `fiber_pole_loading`, `fiber_otdr_fault_locate`).

---

## Core Capabilities

- **ANSI/TIA-598-D Color Code Engine (`getTia598Color`, `resolveStrandColor`)**: Standard 12-color lookup (Blue, Orange, Green, Brown, Slate, White, Red, Black, Yellow, Violet, Rose, Aqua) for strands, buffer tubes, and ribbon groups up to 864+ fibers.
- **Outside Plant (OSP) GIS Cadastre Parser (`parseFiberGis`)**: Ingests GeoJSON/KML infrastructure datasets containing Central Offices, manholes, utility poles, fiber splice closures (FST), and cable spans with helix slack factors.
- **NESC C2 Catenary Sag-Tension & Utility Pole Make-Ready (`src/structural/nesc-sag-tension.ts`)**: Solves the parabolic/hyperbolic state change equation for aerial ADSS/lashed fiber spans under NESC Heavy, Medium, Light, and Extreme Wind loading districts, verifying wood/composite pole ground-line bending moment utilization and NESC Rule 235/238 supply-to-communication vertical clearances.
- **Spatial OTDR Fault Localization (`src/spatial/otdr-fault-localizer.ts`)**: Converts optical time-domain reflectometry (OTDR) optical distance measurements into exact WGS84 `(lat, lon)` field coordinates by accounting for refractive index group delay, splice closure maintenance coils, and cable helical stranding/sag slack factors.
- **Direct Linear-Memory `DAEBuilder` Lowering (`src/dae/lowering.ts`)**: Lowers span optical attenuation and thermo-mechanical catenary tension equations into `DAEBuilder` linear memory.
- **Multi-File Workspace Indexing (`FiberWorkspaceIndex`)**: Indexes fiber cables, splice enclosures, and strand paths across the workspace.

---

## Package Structure

| Path                                  | Description                                                                   |
| :------------------------------------ | :---------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                        |
| `src/language.ts`                     | `fiberLanguage` declarative specification, lint rules, and LSP actions        |
| `src/types.ts`                        | Core fiber cable and outside plant interfaces                                 |
| `src/catalog/tia-598.ts`              | `TIA_598_COLORS` and strand-to-tube color resolution engine                   |
| `src/parser/fiber-gis-parser.ts`      | `parseFiberGis` GeoJSON outside plant cadastre reader                         |
| `src/structural/nesc-sag-tension.ts`  | NESC C2 aerial catenary sag-tension, pole bending moment, and make-ready      |
| `src/spatial/otdr-fault-localizer.ts` | Optical distance-to-WGS84 GIS fault coordinate localizer with slack correction |
| `src/dae/lowering.ts`                 | Direct lowering of OSP attenuation and mechanical spans into `DAEBuilder`     |
| `src/workspace-index.ts`              | `FiberWorkspaceIndex` multi-file symbol indexer                               |

---

## Scripts

| Command             | Description                           |
| :------------------ | :------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`         |
| `npm test`          | Run test suite via `test-runner.js`   |
| `npm run lint`      | Run ESLint across `src/` and `tests/` |
| `npm run typecheck` | Run `tsc --noEmit` type verification  |
| `npm run clean`     | Remove `dist/` build artifacts        |
