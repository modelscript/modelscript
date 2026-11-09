<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/fiber

Optical Fiber Outside Plant (OSP), ANSI/TIA-598-D color code registry, and cable cadastre GIS package for ModelScript. Features TIA-598-D 12-color strand/tube lookup, high-count cable hierarchies, fiber splice closure mapping, GeoJSON outside plant cadastre parsing, and end-to-end strand tracing.

---

## Core Capabilities

- **ANSI/TIA-598-D Color Code Engine (`getTia598Color`, `resolveStrandColor`)**: Standard 12-color lookup (Blue, Orange, Green, Brown, Slate, White, Red, Black, Yellow, Violet, Rose, Aqua) for strands, buffer tubes, and ribbon groups up to 864+ fibers.
- **Outside Plant (OSP) GIS Cadastre Parser (`parseFiberGis`)**: Ingests GeoJSON/KML infrastructure datasets containing Central Offices, manholes, utility poles, fiber splice closures (FST), and cable spans with helix slack factors.
- **Multi-File Workspace Indexing (`FiberWorkspaceIndex`)**: Indexes fiber cables, splice enclosures, and strand paths across the workspace.

---

## Package Structure

| Path                             | Description                                                 |
| :------------------------------- | :---------------------------------------------------------- |
| `src/index.ts`                   | Public package exports                                      |
| `src/types.ts`                   | Core fiber cable and outside plant interfaces               |
| `src/catalog/tia-598.ts`         | `TIA_598_COLORS` and strand-to-tube color resolution engine |
| `src/parser/fiber-gis-parser.ts` | `parseFiberGis` GeoJSON outside plant cadastre reader       |
| `src/workspace-index.ts`         | `FiberWorkspaceIndex` multi-file symbol indexer             |

---

## Scripts

| Command             | Description                           |
| :------------------ | :------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`         |
| `npm test`          | Run test suite via `test-runner.js`   |
| `npm run lint`      | Run ESLint across `src/` and `tests/` |
| `npm run typecheck` | Run `tsc --noEmit` type verification  |
| `npm run clean`     | Remove `dist/` build artifacts        |
