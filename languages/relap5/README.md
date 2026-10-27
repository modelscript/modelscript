<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/relap5

US NRC RELAP5-3D nuclear reactor transient thermal-hydraulics, two-phase hydrodynamic volume/junction networks, and 6-group point reactor kinetics engineering package (`.i`, `.inp`, `.r5`) for ModelScript. Features a zero-regex RELAP5 card deck parser (`parseRelap5`), multi-file workspace indexing (`Relap5WorkspaceIndex`), an AssemblyScript WebAssembly 6-group delayed neutron point kinetics & Doppler/moderator thermal feedback kernel (`assembly/point_kinetics.ts` → `dist/point_kinetics.wasm`, `solvePointKinetics`), direct linear-memory `DAEBuilder` lowering (`lowerRelap5ToDae`), 10 pre-flight nuclear safety & thermal-hydraulic lint rules (`M8601`–`M8610`), Modelica 3.x nuclear system projections (`relap5ToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **US NRC RELAP5-3D Card Deck Parser (`parseRelap5`)**: Zero-regex parser for `.i`, `.inp`, and `.r5` input decks (`*` and `$` comments, `.` card terminators) extracting:
  - **Problem Control & Time Step Cards (`100`–`299`)**: Title (`=`), problem type (`NEW`, `RESTART`), execution mode (`TRANSNT`, `STDY-ST`), and `201` time-step control cards (`endTime`, `minDt`, `maxDt`).
  - **Hydrodynamic Components (`CCCXXNN`)**: Control volumes (`snglvol`, `pipe`, `annulus`, `branch`, `tmdpvol`, `acum`) with flow area, length, volume, elevation change $\Delta z$, initial thermodynamic pressure ($P$), temperature ($T$), and static quality ($x$), plus junctions (`sngljun`, `tmdpjun`, `valve`, `pump`) with forward/reverse form loss coefficients ($K_f, K_r$) and Henry-Fauske / Ransom-Trapp sonic choked-flow flags.
  - **Trips (`400`–`799`), Heat Structures (`1CCCGNNN`), & Point Kinetics (`30000000`–`30000999`)**: Variable and logical trip cutsets (`AND`, `OR`, `XOR`), cylindrical fuel-pin and steam-generator tube heat structures, and `POINT` reactor kinetics cards ($\Lambda$, $\beta_{\text{eff}}$, 6 delayed neutron precursor groups $\beta_i, \lambda_i$, Doppler reactivity coefficient $\alpha_D$, and moderator temperature coefficient $\alpha_M$).
- **In-WASM 6-Group Reactor Point Kinetics & Thermal Feedback Solver (`solvePointKinetics`, `assembly/point_kinetics.ts` → `dist/point_kinetics.wasm`)**: Solves the coupled stiff 6-group delayed neutron precursor ODEs and two-temperature fuel/moderator core thermal hydraulics in linear WebAssembly memory:
  $$\frac{dn}{dt} = \frac{\rho(t) - \beta_{\text{eff}}}{\Lambda} n(t) + \sum_{i=1}^{6} \lambda_i C_i(t), \qquad \frac{dC_i}{dt} = \frac{\beta_i}{\Lambda} n(t) - \lambda_i C_i(t)$$
  $$\rho(t) = \rho_{\text{ext}}(t) + \rho_{\text{scram}}(t) + \alpha_D (T_{\text{fuel}} - T_{\text{fuel},0}) + \alpha_M (T_{\text{mod}} - T_{\text{mod},0})$$
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerRelap5ToDae`)**: Compiles hydrodynamic control volume mass/energy balances, junction momentum equations, fuel-cladding heat structure conduction, and 6-group point kinetics ODEs directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Nuclear Safety & Thermal-Hydraulic Lint Rules (`M8601`–`M8610`, `lintRelap5`)**: Static verification of junction `from`/`to` hydrodynamic volume connectivity, logical trip cutset references, heat structure thermal conductivity and volumetric heat capacity positivity, sonic choked-flow singularities, 6-group delayed neutron completeness, prompt neutron generation time $\Lambda > 0$, geometric elevation consistency ($|\Delta z| \le L$), non-negative junction loss coefficients ($K_f, K_r \ge 0$), time-step bounds ($\Delta t_{\min} \le \Delta t_{\max}$), and positive initial thermodynamic pressures.
- **Modelica 3.x Nuclear Plant Projection (`relap5ToModelica`)**: Synthesizes standalone Modelica 3.x reactor core kinetics and primary coolant loop thermal-hydraulic models.
- **Multi-File Workspace Indexing & LSP (`Relap5WorkspaceIndex`, `provideRelap5Hover`, `provideRelap5Completions`)**: Implements `IWorkspaceIndex` across RELAP5 input decks with card-range hover documentation, component completions, and AST writeback.

---

## Package Structure

| Path                                    | Description                                                                                                                 |
| --------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                                      |
| `src/language.ts`                       | `relap5Language` definition and LSP actions (`lint_relap5`, `relap5_kinetics_solve`, `relap5_to_dae`, `relap5_to_modelica`) |
| `src/types.ts`                          | `Relap5Deck`, `HydroVolume`, `HydroJunction`, `HeatStructure`, `TripCard`, `ReactorKinetics`, and range types               |
| `src/errors.ts`                         | `Relap5ErrorCode` diagnostic registry (`M8601`–`M8610`)                                                                     |
| `src/parser/relap5-parser.ts`           | `parseRelap5` zero-regex parser for US NRC RELAP5-3D `.i`, `.inp`, and `.r5` card decks                                     |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                                       |
| `src/lints/relap5-linter.ts`            | `lintRelap5` hydrodynamic topology, trip logic, heat structure, and point kinetics linter                                   |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                                       |
| `assembly/point_kinetics.ts`            | AssemblyScript WebAssembly kernel (`point_kinetics.wasm`) for 6-group reactor point kinetics integration                    |
| `src/solvers/point-kinetics-solver.ts`  | `solvePointKinetics` reactor point kinetics and Doppler/moderator feedback solver                                           |
| `src/solvers/wasm-bridge.ts`            | `WasmPointKineticsBridge` zero-copy linear memory WebAssembly bridge                                                        |
| `src/solvers/wasm-binary.ts`            | Embedded WebAssembly binary loader for zero-I/O execution                                                                   |
| `src/solvers/index.ts`                  | Solver barrel exports                                                                                                       |
| `src/dae/relap5-to-dae.ts`              | `lowerRelap5ToDae` direct lowering of volumes, junctions, heat structures, and PKE into `DAEBuilder` linear memory          |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                                 |
| `src/projections/relap5-to-modelica.ts` | `relap5ToModelica` translator to Modelica 3.x nuclear thermal-hydraulic and kinetics models                                 |
| `src/projections/index.ts`              | Projections barrel exports                                                                                                  |
| `src/workspace-index.ts`                | `Relap5WorkspaceIndex` implementing `IWorkspaceIndex` across `.i`, `.inp`, and `.r5` decks                                  |
| `src/lsp.ts`                            | LSP hover, completion, and symbol providers                                                                                 |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                 | Severity  | Description                                                                                                                                     |
| ------- | ------------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `M8601` | `dangling-volume-connection`         | `error`   | Junction `'junctionId'` specifies an undefined `from`-volume or `to`-volume `'volId'`.                                                          |
| `M8602` | `unclosed-trip-logic-cutset`         | `error`   | Logical trip `'parentTripId'` references an undefined child trip ID `'childTripId'`.                                                            |
| `M8603` | `negative-heat-capacity`             | `error`   | Heat structure `'hsId'` specifies non-positive thermal conductivity ($\text{W/m}\cdot\text{K}$) or heat capacity ($\text{J/m}^3\cdot\text{K}$). |
| `M8604` | `sonic-choked-flow-singularity`      | `warning` | Junction `'junctionId'` is flagged for critical sonic choked-flow transition.                                                                   |
| `M8605` | `missing-kinetics-delayed-groups`    | `error`   | Point kinetics model specifies fewer than 6 delayed neutron precursor groups.                                                                   |
| `M8606` | `negative-prompt-neutron-lifetime`   | `error`   | Prompt neutron generation time $\Lambda$ ($\text{s}$) must be strictly positive.                                                                |
| `M8607` | `adverse-volume-elevation`           | `warning` | Volume `'volId'` elevation change $\lvert\Delta z\rvert$ exceeds physical volume length $L$ ($\text{m}$).                                       |
| `M8608` | `negative-junction-loss-coefficient` | `error`   | Junction `'junctionId'` specifies a negative forward or reverse form loss coefficient ($K_{\text{forw}}, K_{\text{rev}} < 0$).                  |
| `M8609` | `invalid-time-step-bounds`           | `error`   | Minimum time step $\Delta t_{\min}$ exceeds maximum time step $\Delta t_{\max}$ on card `201`.                                                  |
| `M8610` | `negative-pressure-state`            | `error`   | Volume `'volId'` specifies non-positive initial thermodynamic pressure ($\le 0\text{ Pa}$).                                                     |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect hydrodynamic volumes, junctions, heat structures, trips, and reactor kinetics
npx msx relap5 inspect pwr_loop.i

# Run pre-flight hydrodynamic topology, trip logic, and point kinetics checks (M8601-M8610)
npx msx relap5 lint pwr_loop.i

# Solve 6-group delayed neutron reactor point kinetics with Doppler/moderator feedback
npx msx relap5 kinetics pwr_loop.i --duration 10.0

# Lower two-phase thermal-hydraulics and point kinetics to DAEBuilder linear memory
npx msx relap5 to-dae pwr_loop.i

# Project RELAP5 deck to a Modelica 3.x nuclear thermal-hydraulics model
npx msx relap5 to-modelica pwr_loop.i -o PwrPrimaryLoop.mo
```

### Programmatic Usage

```typescript
import { lintRelap5, lowerRelap5ToDae, parseRelap5, relap5ToModelica, solvePointKinetics } from "@modelscript/relap5";

const relap5Deck = `
= PWR Primary Coolant Loop & Point Kinetics
100 new transnt
201 10.0  1.0e-5  0.05  3
* Core Volume 100 and Upper Plenum 110
1000000 "core"     snglvol
1000101 4.5  4.0  18.0  0.0  90.0  4.0  0.0001  00
1000200 3  15.5e6  585.0
1100000 "plenum"   snglvol
1100101 5.0  3.0  15.0  0.0  90.0  3.0  0.0001  00
1100200 3  15.4e6  600.0
* Core Exit Junction 105
1050000 "core-junc" sngljun
1050101 100010000  110000000  4.5  0.5  0.8  000
* Reactor Point Kinetics
30000000 point
30000001 3000.0e6  0.0  2.0e-5  0.0065
30000101 0.000215  0.0124
30000102 0.001424  0.0305
30000103 0.001274  0.1110
30000104 0.002568  0.3010
30000105 0.000748  1.1400
30000106 0.000271  3.0100
`;

// 1. Parse RELAP5 card deck and run M8601-M8610 pre-flight diagnostics
const deck = parseRelap5(relap5Deck, "pwr_loop.i");
const diagnostics = lintRelap5(deck);

// 2. Simulate 6-group point kinetics transient (via in-WASM kernel)
const pkeResult = solvePointKinetics(deck, {
  duration: 5.0,
  stepSize: 0.001,
  externalReactivity: 0.0015,
  tripScramTime: 2.0,
});
console.log(pkeResult.peakPowerMW, pkeResult.peakFuelTempK);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerRelap5ToDae(deck);
const modelicaCode = relap5ToModelica(deck);
```

---

## Scripts

| Command              | Description                                                                         |
| -------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`      | Build `point_kinetics.wasm` (`npm run build:wasm`) and compile TypeScript           |
| `npm run build:wasm` | Compile AssemblyScript 6-group point kinetics kernel (`assembly/point_kinetics.ts`) |
| `npm test`           | Run RELAP5 parser, linter, WASM point kinetics, DAE, and projection tests           |
| `npm run lint`       | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck`  | Run `tsc --noEmit` type verification                                                |
| `npm run clean`      | Remove `dist/` build artifacts                                                      |
