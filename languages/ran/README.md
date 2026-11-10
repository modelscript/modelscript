<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ran

Radio Access Networks (RAN), antenna radiation patterns (`.adf`, `.pat`, `.msi`), RF electromagnetic safety, FAA airspace obstruction analysis, and microwave line-of-sight propagation package for ModelScript. Features NSMA WG16 and Planet antenna pattern parsing, 3D radiation gain envelope synthesis with electrical downtilt adjustments, FCC OET Bulletin 65 & ICNIRP 2020 MPE RF exposure evaluation (`src/em-safety/mpe-calculator.ts`), 14 CFR Part 77 FAA obstruction surface verification (`src/siting/faa-obstruction.ts`), direct `DAEBuilder` lowering (`src/dae/lowering.ts`), and 3 dedicated MCP tools (`ran_coverage_sinr`, `ran_mpe_safety`, `ran_microwave_link`).

---

## Core Capabilities

- **Antenna Radiation Pattern Parsers (`parseNsmaAdf`, `parsePlanetPat`)**: Parses NSMA WG16 (`.adf` / `.nsma`) and Planet/TIA-329 (`.pat`, `.msi`) antenna pattern files, extracting horizontal (azimuth) and vertical (elevation) cuts, peak gain (dBi), polarization, and beamwidths.
- **3D Gain Envelope Interpolator (`interpolateAntennaGain`)**: Synthesizes full 3D radiation envelopes from orthogonal horizontal/vertical slices with continuous angle wrapping, electrical downtilt offsets, and front-to-back ratio calculations.
- **FCC OET Bulletin 65 & ICNIRP 2020 MPE RF Exposure Safety (`src/em-safety/mpe-calculator.ts`)**: Computes near-field cylindrical and far-field spherical RF power density ($S = \frac{\text{EIRP}}{4\pi R^2}$ with ground reflection) and evaluates occupational and general-public Maximum Permissible Exposure (MPE) exclusion zones.
- **FAA 14 CFR Part 77 Airspace Obstruction & Notice Criteria (`src/siting/faa-obstruction.ts`)**: Evaluates telecom tower siting against FAA Part 77 imaginary surfaces (primary, approach, transitional, horizontal, conical) and 200-ft AGL / runway proximity notice criteria.
- **Direct Linear-Memory `DAEBuilder` Lowering & MCP Tools (`src/dae/lowering.ts`)**: Lowers RAN link budget and thermal noise/power balance equations into `DAEBuilder` linear memory and integrates with `ran_coverage_sinr`, `ran_mpe_safety`, and `ran_microwave_link`.
- **Multi-File Workspace Indexing (`RanWorkspaceIndex`)**: Indexes antenna libraries and wireless link specifications across the workspace.

---

## Package Structure

| Path                                  | Description                                                                 |
| :------------------------------------ | :-------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                      |
| `src/language.ts`                     | `ranLanguage` declarative specification, lint rules, and LSP actions        |
| `src/types.ts`                        | Core antenna pattern and wireless link interfaces                           |
| `src/parser/nsma-parser.ts`           | `parseNsmaAdf` NSMA WG16 antenna pattern reader                             |
| `src/parser/planet-parser.ts`         | `parsePlanetPat` Planet / TIA-329 antenna pattern reader                    |
| `src/solvers/pattern-interpolator.ts` | 3D antenna radiation gain envelope synthesizer                              |
| `src/em-safety/mpe-calculator.ts`     | FCC OET Bulletin 65 & ICNIRP 2020 RF MPE power density and exclusion zones  |
| `src/siting/faa-obstruction.ts`       | FAA 14 CFR Part 77 imaginary surface and tower obstruction analyzer         |
| `src/dae/lowering.ts`                 | Direct lowering of RAN link budget and thermal dynamics into `DAEBuilder`   |
| `src/workspace-index.ts`              | `RanWorkspaceIndex` multi-file symbol indexer                               |

---

## Scripts

| Command             | Description                           |
| :------------------ | :------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`         |
| `npm test`          | Run test suite via `test-runner.js`   |
| `npm run lint`      | Run ESLint across `src/` and `tests/` |
| `npm run typecheck` | Run `tsc --noEmit` type verification  |
| `npm run clean`     | Remove `dist/` build artifacts        |
