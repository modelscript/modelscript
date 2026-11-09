<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ran

Radio Access Networks (RAN), antenna radiation patterns (`.adf`, `.pat`, `.msi`), and microwave line-of-sight propagation package for ModelScript. Features NSMA WG16 and Planet antenna pattern parsing, 3D radiation gain envelope synthesis with electrical downtilt adjustments, and microwave link budget modeling.

---

## Core Capabilities

- **Antenna Radiation Pattern Parsers (`parseNsmaAdf`, `parsePlanetPat`)**: Parses NSMA WG16 (`.adf` / `.nsma`) and Planet/TIA-329 (`.pat`, `.msi`) antenna pattern files, extracting horizontal (azimuth) and vertical (elevation) cuts, peak gain (dBi), polarization, and beamwidths.
- **3D Gain Envelope Interpolator (`interpolateAntennaGain`)**: Synthesizes full 3D radiation envelopes from orthogonal horizontal/vertical slices with continuous angle wrapping, electrical downtilt offsets, and front-to-back ratio calculations.
- **Multi-File Workspace Indexing (`RanWorkspaceIndex`)**: Indexes antenna libraries and wireless link specifications across the workspace.

---

## Package Structure

| Path                                  | Description                                              |
| :------------------------------------ | :------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                   |
| `src/types.ts`                        | Core antenna pattern and wireless link interfaces        |
| `src/parser/nsma-parser.ts`           | `parseNsmaAdf` NSMA WG16 antenna pattern reader          |
| `src/parser/planet-parser.ts`         | `parsePlanetPat` Planet / TIA-329 antenna pattern reader |
| `src/solvers/pattern-interpolator.ts` | 3D antenna radiation gain envelope synthesizer           |
| `src/workspace-index.ts`              | `RanWorkspaceIndex` multi-file symbol indexer            |

---

## Scripts

| Command             | Description                           |
| :------------------ | :------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`         |
| `npm test`          | Run test suite via `test-runner.js`   |
| `npm run lint`      | Run ESLint across `src/` and `tests/` |
| `npm run typecheck` | Run `tsc --noEmit` type verification  |
| `npm run clean`     | Remove `dist/` build artifacts        |
