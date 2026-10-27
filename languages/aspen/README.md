<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/aspen

Aspen Plus chemical process flowsheet simulation and vapor-liquid equilibrium (VLE) engineering package (`.in`, `.inp`, `.bkp`) for ModelScript. Features a zero-regex character scanner and deck parser (`parseAspen`), multi-file workspace indexing (`AspenWorkspaceIndex`), Rachford-Rice isothermal/isobaric VLE flash solver (`solveFlashRachfordRice`), direct linear-memory `DAEBuilder` lowering (`lowerAspenToDae`), 15 pre-flight chemical process and thermodynamic lint rules (`M8101`–`M8115`), Modelica 3.x fluid process projections (`aspenToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Zero-Regex Aspen Plus Deck Parser (`AspenLexer`, `parseAspen`)**: High-performance character scanner and parser for `.in`, `.inp`, and `.bkp` input decks. Extracts `TITLE`, `IN-UNITS`, `DEF-STREAMS`, `COMPONENTS`, `PROPERTIES` (`NRTL`, `PENG-ROB`, `SRK`, `UNIFAC`, `UNIQUAC`, `WILSON`, `IDEAL`), `FLOWSHEET` block connectivity (`IN=`, `OUT=`), `STREAM` state & molar composition tables, and unit operation `BLOCK` definitions (`RadFrac`, `Flash2`, `Heater`, `Pump`, `Compr`, `MHeatX`, `Mixer`, `FSplit`, `RStoic`, `RCSTR`, `RPlug`) with exact 1-indexed line, column, and byte offset tracking.
- **Rachford-Rice VLE Flash Solver (`solveFlashRachfordRice`)**: Rigorous Newton-Raphson / bisection solver for the Rachford-Rice equation $\sum_i \frac{z_i (K_i - 1)}{1 + \psi (K_i - 1)} = 0$, equipped with a built-in physical property bank (`KNOWN_COMPONENTS` with critical temperature $T_c$, critical pressure $P_c$, acentric factor $\omega$, and Antoine vapor-pressure coefficients), Wilson / Raoult / Antoine $K$-value correlations, bubble-point and dew-point subcooled/superheated phase detection, and equilibrium liquid/vapor molar split calculation.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerAspenToDae`)**: Compiles chemical process flowsheets directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena without intermediate AST wrappers—emitting stream molar flow ($F$), temperature ($T$), pressure ($P$), component species molar balance equations ($F_{s,c} = F_s \cdot z_c$), flash VLE splits, column stage balances, and pump/compressor pressure-head equations.
- **15 Pre-Flight Chemical Process Lint Rules (`M8101`–`M8115`, `lintAspen`)**: Static topological and thermodynamic verification detecting unconnected inlet streams, unconverged recycle tear-stream loops (Tarjan/DFS cycle detection), missing EOS critical properties, negative or unnormalized mole fractions, distillation stage out-of-bounds errors, and non-physical stream states.
- **Modelica 3.x Fluid Process Projection (`aspenToModelica`)**: Synthesizes standardized Modelica fluid and mass-balance process models from parsed `AspenDeck` hierarchies for polyglot multi-domain co-simulation.
- **Multi-File Workspace Indexing & LSP (`AspenWorkspaceIndex`, `provideAspenHover`, `provideAspenCompletion`)**: Implements `IWorkspaceIndex` for cross-file symbol resolution of components, streams, and unit operation blocks, alongside rich hover cards, keyword/component auto-completion, and bidirectional AST writeback.

---

## Package Structure

| Path                                   | Description                                                                                                                   |
| -------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                         | Public package exports                                                                                                        |
| `src/language.ts`                      | `aspenLanguage` definition and LSP actions (`lint_aspen_flowsheet`, `aspen_to_dae`, `aspen_to_modelica`, `aspen_solve_flash`) |
| `src/types.ts`                         | `AspenDeck`, `AspenComponent`, `AspenStream`, `AspenBlock`, `AspenFlowsheetEntry`, and `AspenDiagnostic` interfaces           |
| `src/errors.ts`                        | `AspenErrorCode` diagnostic registry (`M8101`–`M8115`)                                                                        |
| `src/parser/aspen-parser.ts`           | `AspenLexer` and `parseAspen` zero-regex scanner and parser for `.in`, `.inp`, and `.bkp` decks                               |
| `src/lints/aspen-linter.ts`            | `lintAspen` chemical process topology, recycle loop, and thermodynamic parameter linter                                       |
| `src/lints/index.ts`                   | Linter module barrel exports                                                                                                  |
| `src/solvers/flash-solver.ts`          | `solveFlashRachfordRice` isothermal/isobaric VLE solver and `KNOWN_COMPONENTS` physical constants                             |
| `src/dae/aspen-to-dae.ts`              | `lowerAspenToDae` direct lowering of streams and unit operations into `DAEBuilder` linear memory                              |
| `src/projections/aspen-to-modelica.ts` | `aspenToModelica` translator to Modelica 3.x fluid process models                                                             |
| `src/workspace-index.ts`               | `AspenWorkspaceIndex` implementing `IWorkspaceIndex` across multi-file flowsheets                                             |
| `src/lsp.ts`                           | LSP hover, completion, document symbols, and diagnostic providers                                                             |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                    |
| ------- | ------------------------------ | --------- | ---------------------------------------------------------------------------------------------- |
| `M8101` | `unconnected-stream-port`      | `error`   | Stream `'streamName'` connected to block `'blockName'` inlet has no producing source outlet.   |
| `M8102` | `tear-stream-unconverged`      | `error`   | Circular flowsheet loop detected involving block `'blockName'` without designated tear stream. |
| `M8103` | `invalid-eos-parameter`        | `error`   | Component `'compName'` lacks critical properties for property method `'propertyMethod'`.       |
| `M8104` | `negative-component-fraction`  | `error`   | Stream `'streamName'` specifies negative component molar fraction for `'compName'`.            |
| `M8105` | `column-reboiler-heat-deficit` | `warning` | Column `'blockName'` duty results in non-positive reboiler boil-up.                            |
| `M8106` | `duplicate-block-id`           | `error`   | Duplicate block ID `'blockId'` declared in flowsheet.                                          |
| `M8107` | `duplicate-component-id`       | `error`   | Duplicate component ID `'compId'` declared in `COMPONENTS`.                                    |
| `M8108` | `fractions-sum-invalid`        | `warning` | Component mole fractions in stream `'streamName'` do not sum to `1.0`.                         |
| `M8109` | `feed-stage-out-of-range`      | `error`   | Column `'blockName'` feed stage is out of bounds (`1..nStages`).                               |
| `M8110` | `product-stage-out-of-range`   | `error`   | Column `'blockName'` product stage is out of bounds (`1..nStages`).                            |
| `M8111` | `missing-flowsheet-entry`      | `warning` | Block `'blockName'` has parameter declarations but is not connected in `FLOWSHEET`.            |
| `M8112` | `stream-temperature-negative`  | `error`   | Stream `'streamName'` specifies non-physical absolute temperature ($\le 0\text{ K}$).          |
| `M8113` | `stream-pressure-negative`     | `error`   | Stream `'streamName'` specifies non-positive pressure ($\le 0\text{ bar}$).                    |
| `M8114` | `radfrac-stages-too-few`       | `error`   | `RadFrac` column `'blockName'` has fewer than 2 stages.                                        |
| `M8115` | `reflux-ratio-negative`        | `error`   | Column `'blockName'` reflux ratio must be non-negative.                                        |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect components, streams, and unit operations in an Aspen Plus deck
npx msx aspen inspect plant.inp

# Run pre-flight chemical process and thermodynamic lint rules (M8101-M8115)
npx msx aspen lint plant.inp

# Solve Rachford-Rice VLE flash equilibrium for a specific feed stream
npx msx aspen solve-flash plant.inp --stream FEED

# Lower chemical process flowsheet to the linear-memory DAE arena
npx msx aspen to-dae plant.inp

# Project Aspen flowsheet to a Modelica 3.x process model
npx msx aspen to-modelica plant.inp -o PlantProcess.mo
```

### Programmatic Usage

```typescript
import { aspenToModelica, lintAspen, lowerAspenToDae, parseAspen, solveFlashRachfordRice } from "@modelscript/aspen";

const deckText = `
TITLE 'Methanol-Water Flash Separation'
IN-UNITS MET
COMPONENTS
  METHANOL CH4O /
  WATER H2O
PROPERTIES NRTL
FLOWSHEET
  BLOCK FLASH1 IN=FEED OUT=VAP LIQ
STREAM FEED
  SUBSTREAM MIXED TEMP=78.0 PRES=1.01325 MOLE-FLOW=100.0
  MOLE-FRAC METHANOL 0.6 / WATER 0.4
BLOCK FLASH1 FLASH2
  PARAM TEMP=78.0 PRES=1.01325
`;

// 1. Parse Aspen deck and run M8101-M8115 pre-flight diagnostics
const deck = parseAspen(deckText);
const diagnostics = lintAspen(deck);

// 2. Solve Rachford-Rice isothermal VLE flash for the feed stream
const flash = solveFlashRachfordRice({
  temperature: 78.0,
  pressure: 1.01325,
  components: ["METHANOL", "WATER"],
  moleFractions: [0.6, 0.4],
  totalFlow: 100.0,
});
console.log(flash.state, flash.vaporFraction, flash.vaporFractions, flash.liquidFractions);

// 3. Lower directly to DAEBuilder linear memory or project to Modelica
const dae = lowerAspenToDae(deck);
const modelicaCode = aspenToModelica(deck);
```

---

## Scripts

| Command             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                       |
| `npm test`          | Run parser, linter, Rachford-Rice VLE, DAE, and projection tests (`test-runner.js`) |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                |
| `npm run clean`     | Remove `dist/` build artifacts                                                      |
