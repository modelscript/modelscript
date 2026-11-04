<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/phreeqc

USGS PHREEQC Aqueous Geochemistry, Speciation & Reactive Transport modeling package (`.pqi`, `.dat`) for ModelScript. Features a zero-regex character-by-character `.pqi`/`.dat` parser and serializer (`parsePhreeqc`, `serializePhreeqc`), multi-file workspace indexing (`PhreeqcWorkspaceIndex`), an aqueous speciation, Davies / Extended Debye-Hückel activity coefficient, carbonate equilibrium, and mineral Saturation Index solver (`solvePhreeqcSpeciation`), direct linear-memory `DAEBuilder` lowering (`lowerPhreeqcToDae`), 10 pre-flight geochemical & thermodynamic lint rules (`M9551`–`M9560`, `lintPhreeqc`), Modelica 3.x aqueous chemistry projections (`phreeqcToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex PHREEQC `.pqi` & `.dat` Parser (`parsePhreeqc`, `serializePhreeqc`)**: Character-by-character scanner and parser supporting:
  - **`TITLE` & `SOLUTION`**: Temperature (`temp`), `pH` (with optional `charge` balance modifier), redox potential (`pe`), concentration `units` (`mmol/kgw`, `mol/kgw`, `mg/L`, `ppm`, `umol/kgw`, `meq/L`), `-water` mass, `density`, and dissolved master species (`Ca`, `Mg`, `Na`, `K`, `Cl`, `C(4)`, `S(6)`, `F`, `Fe(2)`, `Fe(3)`, `Al`, `Si`, `N(5)`, `Alkalinity`, etc.).
  - **`EQUILIBRIUM_PHASES`, `REACTION`, `KINETICS` & `MIX`**: Target Saturation Indices ($\text{SI}$) and initial mineral moles, irreversible stoichiometric reaction steps, kinetic mineral dissolution/precipitation rate parameters (`-m0`, `-m`, `-parms`, `-steps`), and multi-solution mixing fractions.
  - **Thermodynamic Database Blocks (`.dat`)**: `SOLUTION_MASTER_SPECIES` and `PHASES` (`-log_k`, `-delta_h`).
- **Aqueous Speciation, Davies Activity & Mineral Saturation Solver (`solvePhreeqcSpeciation`)**:
  - **Ionic Strength & Davies / Extended Debye-Hückel Activity Coefficients**:
    $$I = \frac{1}{2} \sum_i m_i z_i^2, \qquad \log_{10}\gamma_i = -A(T) z_i^2 \left(\frac{\sqrt{I}}{1 + \sqrt{I}} - 0.3 I\right)$$
  - **Carbonate Speciation & Charge Balance**: Solves temperature-corrected Van 't Hoff equilibria for $\text{H}_2\text{CO}_3^*$, $\text{HCO}_3^-$, $\text{CO}_3^{2-}$, and $\text{H}_2\text{O} \rightleftharpoons \text{H}^+ + \text{OH}^-$, with optional bisection pH charge-balance adjustment ($\sum_i z_i m_i = 0$).
  - **Mineral Saturation Indices ($\text{SI} = \log_{10}(\text{IAP} / K_{sp})$)**: Evaluates Ion Activity Products and temperature-dependent solubility products for `Calcite`, `Aragonite`, `Gypsum`, `Anhydrite`, `Halite`, `Dolomite`, and `Fluorite`.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerPhreeqcToDae`)**: Compiles aqueous species molalities, ionic strength, Davies activity coefficients ($\gamma_1, \gamma_2$), carbonate mass-action equations, mineral Saturation Indices, and kinetic mineral dissolution/precipitation ODEs ($\frac{dM_k}{dt} = -k A_{\text{surf}}(1 - \text{IAP}_k / K_{sp,k})$) into a structurally square `DAEBuilder`.
- **10 Pre-Flight Geochemical & Thermodynamic Lint Rules (`M9551`–`M9560`, `lintPhreeqc`)**: Static verification of physical pH bounds, water redox stability (`pe`), liquid water temperature range, non-negative solute concentrations, electrical charge balance, master species names, mineral phase names, initial mineral moles, `MIX` solution references, and non-empty decks.
- **Modelica 3.x Aqueous Chemistry Projection (`phreeqcToModelica`)**: Generates standalone Modelica 3.x aqueous geochemistry and reactive transport models.
- **Multi-File Workspace Indexing & LSP (`PhreeqcWorkspaceIndex`, `validatePhreeqc`, `getPhreeqcHover`, `getPhreeqcDocumentSymbols`)**: Full IDE integration for `.pqi` and `.dat` files.

---

## Package Structure

| Path                                     | Description                                                                                                                                                        |
| ---------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                           | Public package exports                                                                                                                                             |
| `src/language.ts`                        | `phreeqcLanguage` definition and LSP actions (`lint_phreeqc`, `phreeqc_speciate`, `phreeqc_to_dae`, `phreeqc_to_modelica`)                                         |
| `src/types.ts`                           | `PhreeqcDocument`, `PhreeqcSolution`, `PhreeqcEquilibriumPhase`, `PhreeqcReaction`, `PhreeqcKinetics`, `PhreeqcMix`, `SpeciationResult`, `MineralSaturationResult` |
| `src/errors.ts`                          | `PhreeqcErrorCode` diagnostic registry (`M9551`–`M9560`)                                                                                                           |
| `src/parser/phreeqc-parser.ts`           | `parsePhreeqc` and `serializePhreeqc` zero-regex character-by-character `.pqi`/`.dat` parser and serializer                                                        |
| `src/parser/index.ts`                    | Parser barrel exports                                                                                                                                              |
| `src/lints/phreeqc-linter.ts`            | `lintPhreeqc` geochemical and thermodynamic pre-flight linter (`M9551`–`M9560`)                                                                                    |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                                                              |
| `src/solvers/speciation-solver.ts`       | `solvePhreeqcSpeciation` Davies activity, carbonate equilibrium, charge balance, and mineral SI solver                                                             |
| `src/solvers/index.ts`                   | Solver barrel exports                                                                                                                                              |
| `src/dae/phreeqc-to-dae.ts`              | `lowerPhreeqcToDae` direct lowering of aqueous speciation and mineral kinetics into `DAEBuilder` linear memory                                                     |
| `src/dae/index.ts`                       | DAE lowering barrel exports                                                                                                                                        |
| `src/projections/phreeqc-to-modelica.ts` | `phreeqcToModelica` translator to Modelica 3.x aqueous chemistry models                                                                                            |
| `src/projections/index.ts`               | Projections barrel exports                                                                                                                                         |
| `src/workspace-index.ts`                 | `PhreeqcWorkspaceIndex` implementing `IWorkspaceIndex` across `.pqi` and `.dat` files                                                                              |
| `src/lsp.ts`                             | LSP diagnostics, document symbols, hover, and action execution providers                                                                                           |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                                | Severity  | Description                                                                                                                               |
| ------- | ----------------------------------- | --------- | ----------------------------------------------------------------------------------------------------------------------------------------- |
| `M9551` | `ph-out-of-physical-bounds`         | `error`   | `SOLUTION` specifies `pH` outside standard aqueous physical bounds $[0, 14]$.                                                             |
| `M9552` | `pe-out-of-redox-stability-bounds`  | `warning` | `SOLUTION` specifies redox potential `pe` outside water stability bounds $[-15, 25]$.                                                     |
| `M9553` | `non-physical-temperature`          | `error`   | `SOLUTION` specifies non-physical aqueous temperature outside $[0, 350]\ ^\circ\text{C}$.                                                 |
| `M9554` | `negative-solute-concentration`     | `error`   | Solute in `SOLUTION` specifies a negative concentration ($< 0$).                                                                          |
| `M9555` | `charge-imbalance-exceeded`         | `warning` | `SOLUTION` exhibits relative electrical charge imbalance $\|\sum z_i m_i\| / \sum \|z_i\| m_i > 0.05$ without a `charge` balance element. |
| `M9556` | `unknown-aqueous-master-species`    | `error`   | `SOLUTION` references an unrecognized aqueous master species.                                                                             |
| `M9557` | `unknown-equilibrium-mineral-phase` | `error`   | `EQUILIBRIUM_PHASES` references an unrecognized mineral phase.                                                                            |
| `M9558` | `negative-mineral-moles`            | `error`   | Mineral phase in `EQUILIBRIUM_PHASES` specifies negative initial moles ($< 0$).                                                           |
| `M9559` | `unresolved-mix-solution`           | `error`   | `MIX` block references an undefined `SOLUTION` number.                                                                                    |
| `M9560` | `empty-phreeqc-deck`                | `error`   | PHREEQC deck contains no `SOLUTION`, `EQUILIBRIUM_PHASES`, `REACTION`, `KINETICS`, `MIX`, or database definitions.                        |

---

## Programmatic Usage

```typescript
import {
  lintPhreeqc,
  lowerPhreeqcToDae,
  parsePhreeqc,
  phreeqcToModelica,
  solvePhreeqcSpeciation,
} from "@modelscript/phreeqc";

const pqiDeck = `
TITLE Limestone Karst Aquifer Speciation & Calcite Dissolution
SOLUTION 1 Karst Groundwater
    temp      25.0
    pH        7.4
    pe        4.0
    units     mmol/kgw
    Ca        2.0
    Mg        0.5
    Na        1.0
    Cl        1.0
    C(4)      3.0
    S(6)      1.0
EQUILIBRIUM_PHASES 1
    Calcite   0.0 10.0
    Gypsum    0.0 5.0
KINETICS 1
    Calcite
        -m0     2.5
        -parms  1.67e-6 5.0
    -steps 3600 in 10 steps
END
`;

// 1. Parse PHREEQC deck and run M9551-M9560 pre-flight diagnostics
const doc = parsePhreeqc(pqiDeck, "karst.pqi");
const diagnostics = lintPhreeqc(doc);

// 2. Solve aqueous speciation, Davies activity coefficients, and mineral Saturation Indices
const spec = solvePhreeqcSpeciation(doc);
console.log("Ionic strength:", spec.ionicStrength);
console.log("Calcite SI:", spec.saturationIndices.Calcite?.si);

// 3. Lower to a square DAEBuilder or project to Modelica 3.x
const dae = lowerPhreeqcToDae(doc);
const modelicaCode = phreeqcToModelica(doc, "KarstAquiferChemistry");
```
