<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cantera

Gas-phase chemical kinetics, combustion, catalysis, and NASA-7 polynomial thermochemistry modeling package (`.yaml`, `.cti`) for ModelScript. Features a zero-regex Cantera YAML and legacy CTI mechanism parser (`parseCantera`), multi-file workspace indexing (`CanteraWorkspaceIndex`), NASA-7 thermodynamic property evaluation (`evaluateNasa7Thermo`), modified Arrhenius & Lindemann/Troe falloff rate evaluation (`evaluateArrheniusRate`), an isothermal/adiabatic batch reactor solver with thermodynamic equilibrium reverse rates (`solveCanteraReactor`), direct linear-memory `DAEBuilder` chemical kinetics lowering (`lowerCanteraToDae`), 10 pre-flight thermochemical & stoichiometric lint rules (`M9201`–`M9210`), Modelica 3.x chemical kinetics projections (`canteraToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex Cantera YAML & CTI Parser (`parseCantera`, `serializeCantera`)**: Indentation-aware YAML and legacy CTI character scanner extracting:
  - **`phases`**: Ideal-gas phases (`thermo`, `kinetics`, `elements`, `species`, initial `state` with `T`, `P`, `X`).
  - **`species`**: Elemental `composition` maps (e.g., `{H: 2, O: 1, E: -1}`), `charge`, and `NASA7` `thermo` polynomial blocks (`temperature-ranges: [Tmin, Tmid, Tmax]`, 7 low-temperature and 7 high-temperature coefficients).
  - **`reactions`**: Stoichiometric reaction equations (`<=>`, `=`, `=>`), third-body (`+ M`) and falloff (`(+M)`) reactions, modified Arrhenius `rate-constant: {A, b, Ea}`, `low-P-rate-constant`, `Troe: {A, T3, T1, T2}` falloff blending parameters, third-body `efficiencies`, and `duplicate: true` flags.
- **NASA-7 Thermochemistry & Batch Reactor Kinetics Solver (`evaluateNasa7Thermo`, `evaluateArrheniusRate`, `solveCanteraReactor`)**:
  - Evaluates dimensionless and SI molar heat capacity $C_p^\circ(T)$, enthalpy $H^\circ(T)$, entropy $S^\circ(T)$, and Gibbs free energy $G^\circ(T) = H^\circ(T) - T S^\circ(T)$.
  - Computes equilibrium constants $K_p(T) = \exp(-\Delta G^\circ(T) / RT)$ and $K_c(T) = K_p(T) (P^\circ / RT)^{\sum \nu_k}$ for thermodynamic reversibility, third-body effective concentrations $[M]_{\text{eff}} = \sum_k \alpha_k [X_k]$, and Lindemann/Troe pressure-falloff blending $F_{\text{cent}}(T)$.
  - Integrates constant-volume or constant-pressure isothermal and adiabatic gas-phase batch reactors with automatic element conservation verification.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerCanteraToDae`)**: Compiles species molar concentrations, temperature $T$, pressure $P$, modified Arrhenius forward rate expressions $k_f(T) = A T^b \exp(-E_a / RT)$, reaction rates of progress, and molar production rate ODEs ($\frac{d[X_k]}{dt} = \dot{\omega}_k$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **10 Pre-Flight Thermochemical & Stoichiometric Lint Rules (`M9201`–`M9210`, `lintCantera`)**: Static verification of atomic element balance across reactions, electrical charge conservation, undeclared phase/reaction species, NASA-7 $C_p^\circ/R$, $H^\circ/RT$, and $S^\circ/R$ midpoint continuity at $T_{\text{mid}}$, NASA-7 temperature bound ordering ($T_{\text{min}} < T_{\text{mid}} < T_{\text{max}}$), positive pre-exponential factors ($A > 0$), falloff `low-P-rate-constant` presence, unflagged duplicate reactions, non-negative third-body efficiencies, and species thermo completeness.
- **Modelica 3.x Chemical Kinetics Projection (`canteraToModelica`)**: Synthesizes standalone Modelica 3.x gas-phase chemical kinetics and combustion reactor models.
- **Multi-File Workspace Indexing & LSP (`CanteraWorkspaceIndex`, `getCanteraHover`, `provideCanteraCompletions`)**: Implements `IWorkspaceIndex` across `.yaml` and `.cti` mechanism files with NASA-7 thermodynamic hover cards, completions, and AST writeback.

---

## Package Structure

| Path                                     | Description                                                                                                                |
| ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                                                     |
| `src/language.ts`                        | `canteraLanguage` definition and LSP actions (`lint_cantera`, `cantera_simulate`, `cantera_to_dae`, `cantera_to_modelica`) |
| `src/types.ts`                           | `CanteraDocument`, `CanteraMechanism`, `CanteraPhase`, `CanteraSpecies`, `Nasa7Polynomial`, `CanteraReaction` types        |
| `src/errors.ts`                          | `CanteraErrorCode` diagnostic registry (`M9201`–`M9210`)                                                                   |
| `src/parser/cantera-parser.ts`           | `parseCantera` and `serializeCantera` zero-regex Cantera YAML and CTI parser                                               |
| `src/parser/index.ts`                    | Parser barrel exports                                                                                                      |
| `src/lints/cantera-linter.ts`            | `lintCantera` atomic element balance, charge conservation, NASA-7 continuity, and reaction rate diagnostic engine          |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                      |
| `src/solvers/kinetics-solver.ts`         | `evaluateNasa7Thermo`, `evaluateArrheniusRate`, and `solveCanteraReactor` gas-phase kinetics & batch reactor solver        |
| `src/solvers/index.ts`                   | Solver barrel exports                                                                                                      |
| `src/dae/cantera-to-dae.ts`              | `lowerCanteraToDae` direct lowering of species concentrations and Arrhenius kinetics into `DAEBuilder` linear memory       |
| `src/dae/index.ts`                       | DAE lowering barrel exports                                                                                                |
| `src/projections/cantera-to-modelica.ts` | `canteraToModelica` translator to Modelica 3.x gas-phase chemical kinetics models                                          |
| `src/projections/index.ts`               | Projections barrel exports                                                                                                 |
| `src/workspace-index.ts`                 | `CanteraWorkspaceIndex` implementing `IWorkspaceIndex` across `.yaml` and `.cti` mechanism files                           |
| `src/lsp.ts`                             | LSP validation, document symbols, hover, completion, and action providers                                                  |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                 | Severity  | Description                                                                                                                                       |
| ------- | ------------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M9201` | `element-balance-violation`          | `error`   | Reaction `'equation'` is not elementally balanced across reactants and products.                                                                  |
| `M9202` | `charge-balance-violation`           | `error`   | Reaction `'equation'` violates net electrical charge conservation.                                                                                |
| `M9203` | `undeclared-phase-species`           | `error`   | Reaction `'equation'` references species `'speciesName'` not declared in the mechanism `species` list.                                            |
| `M9204` | `nasa7-temperature-discontinuity`    | `warning` | Species `'speciesName'` NASA-7 polynomial has a $C_p^\circ(T)$, $H^\circ(T)$, or $S^\circ(T)$ discontinuity at $T_{\text{mid}}$.                  |
| `M9205` | `invalid-nasa7-temperature-bounds`   | `error`   | Species `'speciesName'` specifies invalid NASA-7 temperature bounds ($T_{\text{min}} \ge T_{\text{mid}}$ or $T_{\text{mid}} \ge T_{\text{max}}$). |
| `M9206` | `negative-pre-exponential-factor`    | `error`   | Reaction `'equation'` specifies a non-positive pre-exponential factor $A \le 0$.                                                                  |
| `M9207` | `missing-falloff-low-pressure-limit` | `error`   | Falloff reaction `'equation'` is missing `low-P-rate-constant`.                                                                                   |
| `M9208` | `duplicate-reaction-declaration`     | `warning` | Identical non-duplicate reaction `'equation'` declared without `duplicate: true`.                                                                 |
| `M9209` | `negative-third-body-efficiency`     | `error`   | Third-body efficiency for `'speciesName'` in reaction `'equation'` is negative.                                                                   |
| `M9210` | `missing-species-thermo`             | `warning` | Species `'speciesName'` is missing a `thermo` polynomial definition.                                                                              |

---

## Programmatic Usage

```typescript
import {
  canteraToModelica,
  evaluateNasa7Thermo,
  lintCantera,
  lowerCanteraToDae,
  parseCantera,
  solveCanteraReactor,
} from "@modelscript/cantera";

const doc = parseCantera(yamlText, "h2o2.yaml");
const diagnostics = lintCantera(doc);
const sim = solveCanteraReactor(doc, { temperature: 1200, pressure: 101325, duration: 1e-3 });
const dae = lowerCanteraToDae(doc);
const mo = canteraToModelica(doc, "H2O2Combustion");
```

---

## Scripts

| Command             | Description                                                                            |
| ------------------- | -------------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                          |
| `npm test`          | Run Cantera YAML/CTI parser, NASA-7 thermo, linter, reactor solver, DAE, and LSP tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                                  |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                   |
| `npm run clean`     | Remove `dist/` build artifacts                                                         |
