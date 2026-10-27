<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/eclipse

Schlumberger ECLIPSE black-oil reservoir simulation and multiphase porous-media engineering package (`.data`, `.dat`, `.inc`) for ModelScript. Features a zero-regex character-scanning ECLIPSE deck parser (`parseEclipse`), multi-file workspace indexing (`EclipseWorkspaceIndex`), a multiphase Darcy flow & Peaceman well inflow performance (IPR) depletion solver (`solveReservoirDepletion`), direct linear-memory `DAEBuilder` lowering (`lowerEclipseToDae`), 10 pre-flight reservoir & PVT lint rules (`M8701`–`M8710`), Modelica 3.x porous-media projections (`eclipseToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Schlumberger ECLIPSE Deck Parser (`parseEclipse`)**: Zero-regex parser for ECLIPSE 100/300 `.data`, `.dat`, and `.inc` files with native `N*val` repeat-count expansion (`300*0.22`), slash-terminated records (`/`), and `--` comment stripping across all 8 canonical sections:
  - **`RUNSPEC`**: `TITLE`, unit conventions (`FIELD`, `METRIC`, `LAB`), active fluid phases (`OIL`, `WATER`, `GAS`, `DISGAS`, `VAPOIL`), and `DIMENS` ($N_x \times N_y \times N_z$).
  - **`GRID`**: Cell dimensions (`DX`, `DY`, `DZ`), top depth (`TOPS`), porosity (`PORO`), and directional permeability tensors (`PERMX`, `PERMY`, `PERMZ` in mD).
  - **`PROPS`**: Dead-oil & live-oil PVT tables (`PVDO`, `PVTW`, `PVDG`), rock compressibility (`ROCK`), fluid surface densities (`DENSITY`), and two-phase relative permeability & capillary pressure tables (`SWOF`, `SGOF`).
  - **`SOLUTION` & `SCHEDULE`**: Initial hydrostatic equilibration (`EQUIL`), well specifications (`WELSPECS`), grid-block perforation completions (`COMPDAT`), production controls (`WCONPROD`: `ORAT`, `WRAT`, `GRAT`, `LRAT`, `RESV`, `BHP`), injection controls (`WCONINJE`), and time stepping (`TSTEP`, `DATES`).
- **Multiphase Darcy Flow & Peaceman Well Inflow Solver (`solveReservoirDepletion`)**: Computes pore volume, Stock Tank Oil Initially In Place (`STOIIP`), Gas Initially In Place (`GIIP`), Peaceman equivalent wellbore radius $r_o = 0.28 \frac{[(k_y/k_x)^{1/2}\Delta x^2 + (k_x/k_y)^{1/2}\Delta y^2]^{1/2}}{(k_y/k_x)^{1/4} + (k_x/k_y)^{1/4}}$, multiphase relative permeability interpolation ($k_{ro}(S_w), k_{rw}(S_w)$), and material-balance pressure depletion trajectories.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerEclipseToDae`)**: Lowers reservoir tank material-balance ODEs ($V_p c_t \frac{dP}{dt} = \sum Q_{\text{inj}} - \sum Q_{\text{prod}}$), Peaceman well inflow equations, and water-cut dynamics directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Reservoir & Petrophysical Lint Rules (`M8701`–`M8710`, `lintEclipse`)**: Static verification of active reservoir phases, grid dimensions, porosity bounds ($0 < \phi < 1$), permeability positivity, `PVDO` pressure monotonicity, `SWOF`/`SGOF` saturation monotonicity, 3D grid completion bounds (`COMPDAT` vs. `DIMENS`), and `WELSPECS` well reference integrity.
- **Modelica 3.x Porous-Media Projection (`eclipseToModelica`)**: Synthesizes standalone Modelica 3.x reservoir depletion and well inflow models for coupled subsurface-to-surface production system co-simulation.
- **Multi-File Workspace Indexing & LSP (`EclipseWorkspaceIndex`, `provideEclipseHover`, `provideEclipseCompletions`)**: Implements `IWorkspaceIndex` across `.data` and `.inc` include files with keyword documentation hovers, completion items, and AST writeback.

---

## Package Structure

| Path                                     | Description                                                                                                                       |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                                                            |
| `src/language.ts`                        | `eclipseLanguage` definition and LSP actions (`lint_eclipse`, `eclipse_reservoir_solve`, `eclipse_to_dae`, `eclipse_to_modelica`) |
| `src/types.ts`                           | `EclipseDeck`, `EclipseGrid`, `EclipseProps`, `EclipseWell`, `EclipseCompletion`, and PVT/saturation table types                  |
| `src/errors.ts`                          | `EclipseErrorCode` diagnostic registry (`M8701`–`M8710`)                                                                          |
| `src/parser/eclipse-parser.ts`           | `parseEclipse` zero-regex parser with `N*val` repeat-token expansion                                                              |
| `src/parser/index.ts`                    | Parser barrel exports                                                                                                             |
| `src/lints/eclipse-linter.ts`            | `lintEclipse` petrophysical, PVT table, and well completion diagnostic engine                                                     |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                             |
| `src/solvers/reservoir-solver.ts`        | `solveReservoirDepletion` multiphase Darcy flow, Peaceman IPR, and STOIIP/GIIP material balance solver                            |
| `src/solvers/index.ts`                   | Solver barrel exports                                                                                                             |
| `src/dae/eclipse-to-dae.ts`              | `lowerEclipseToDae` direct lowering of reservoir and well inflow equations into `DAEBuilder` linear memory                        |
| `src/dae/index.ts`                       | DAE lowering barrel exports                                                                                                       |
| `src/projections/eclipse-to-modelica.ts` | `eclipseToModelica` translator to Modelica 3.x porous media and well models                                                       |
| `src/projections/index.ts`               | Projections barrel exports                                                                                                        |
| `src/workspace-index.ts`                 | `EclipseWorkspaceIndex` implementing `IWorkspaceIndex` across `.data`, `.dat`, and `.inc` decks                                   |
| `src/lsp.ts`                             | LSP hover, completion, and symbol providers                                                                                       |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                               | Severity | Description                                                                                                |
| ------- | ---------------------------------- | -------- | ---------------------------------------------------------------------------------------------------------- |
| `M8701` | `missing-reservoir-phases`         | `error`  | `RUNSPEC` section does not specify any active fluid phases (`'OIL'`, `'WATER'`, or `'GAS'`).               |
| `M8702` | `invalid-grid-dimensions`          | `error`  | Reservoir grid dimensions (`DIMENS`) must be strictly positive integers ($N_x, N_y, N_z > 0$).             |
| `M8703` | `porosity-out-of-range`            | `error`  | Reservoir porosity (`PORO`) must be strictly positive and less than `1.0` ($0 < \phi < 1$).                |
| `M8704` | `negative-permeability`            | `error`  | Reservoir permeability `'PERMX'`/`'PERMY'`/`'PERMZ'` ($\text{mD}$) must be strictly positive.              |
| `M8705` | `non-monotonic-pvt-table`          | `error`  | PVT table `'PVDO'`/`'PVDG'` has non-monotonic pressure progression.                                        |
| `M8706` | `dangling-well-completion`         | `error`  | Well completion (`COMPDAT`) for `'wellName'` at $(I, J, K)$ exceeds grid boundary $(N_x, N_y, N_z)$.       |
| `M8707` | `non-monotonic-saturation-table`   | `error`  | Relative permeability table (`'SWOF'`/`'SGOF'`) has non-monotonic saturation progression.                  |
| `M8708` | `undefined-well-reference`         | `error`  | Schedule keyword (`COMPDAT`/`WCONPROD`/`WCONINJE`) references well `'wellName'` not defined in `WELSPECS`. |
| `M8709` | `invalid-well-control-target`      | `error`  | Well `'wellName'` specifies a non-positive control rate or bottom-hole pressure target.                    |
| `M8710` | `negative-formation-volume-factor` | `error`  | PVT property specifies a non-positive formation volume factor $B_o / B_w / B_g \le 0$.                     |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect grid dimensions, petrophysics, PVT tables, and wells in an ECLIPSE deck
npx msx eclipse inspect SPE1.DATA

# Run pre-flight reservoir, PVT, and completion diagnostics (M8701-M8710)
npx msx eclipse lint SPE1.DATA

# Run multiphase Darcy depletion & Peaceman well IPR simulation for 365 days
npx msx eclipse solve SPE1.DATA --days 365

# Lower reservoir material balance and well inflow equations to DAEBuilder linear memory
npx msx eclipse to-dae SPE1.DATA

# Project ECLIPSE deck to a Modelica 3.x reservoir model
npx msx eclipse to-modelica SPE1.DATA -o Spe1Reservoir.mo
```

### Programmatic Usage

```typescript
import {
  eclipseToModelica,
  lintEclipse,
  lowerEclipseToDae,
  parseEclipse,
  solveReservoirDepletion,
} from "@modelscript/eclipse";

const eclipseSource = `
RUNSPEC
TITLE
  North Sea Black-Oil Sector Model
DIMENS
  10 10 3 /
OIL
WATER
FIELD
GRID
DX
  300*500.0 /
DY
  300*500.0 /
DZ
  300*50.0 /
PORO
  300*0.22 /
PERMX
  300*150.0 /
PERMY
  300*150.0 /
PERMZ
  300*15.0 /
PROPS
PVDO
  2000.0 1.25 1.10
  4000.0 1.20 1.25 /
SOLUTION
EQUIL
  8000.0 3800.0 8500.0 0.0 /
SCHEDULE
WELSPECS
  'PROD-1' 'G1' 5 5 8050.0 'OIL' /
/
COMPDAT
  'PROD-1' 5 5 1 3 'OPEN' 1* 1* 0.5 /
/
WCONPROD
  'PROD-1' 'OPEN' 'ORAT' 2500.0 4* 1800.0 /
/
`;

// 1. Parse ECLIPSE deck and run M8701-M8710 pre-flight linter
const deck = parseEclipse(eclipseSource);
const diagnostics = lintEclipse(deck);

// 2. Solve multiphase reservoir depletion & Peaceman well inflow performance
const result = solveReservoirDepletion(deck, { totalDays: 365, stepDays: 30 });
console.log(result.stoiip, result.finalPressure, result.recoveryFactor);

// 3. Lower directly to DAEBuilder linear memory or export to Modelica
const dae = lowerEclipseToDae(deck);
const modelicaCode = eclipseToModelica(deck);
```

---

## Scripts

| Command             | Description                                                                |
| ------------------- | -------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                              |
| `npm test`          | Run ECLIPSE parser, linter, Peaceman IPR solver, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                      |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                       |
| `npm run clean`     | Remove `dist/` build artifacts                                             |
