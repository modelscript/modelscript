<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/opendss

EPRI OpenDSS unbalanced multi-phase electric power distribution system and Distributed Energy Resource (DER) hosting capacity package (`.dss`) for ModelScript. Features an OpenDSS command script parser (`parseOpenDss`), multi-file workspace indexing (`OpenDssWorkspaceIndex`), a radial/meshed forward-backward sweep distribution power flow solver (`solveDistributionPowerFlow`), direct linear-memory `DAEBuilder` lowering (`lowerOpenDssToDae`), 8 pre-flight distribution grid & DER hosting capacity lint rules (`M8401`–`M8408`), Modelica 3.x electrical circuit projections (`openDssToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **EPRI OpenDSS Command Script Parser (`parseOpenDss`)**: Parses `.dss` scripts (`New`, `Edit`, `Set`, `CalcVoltageBases`, `Solve`, `Redirect`, `Compile`, and `~` continuation lines), extracting:
  - **Substation Source & Sequence Impedances**: `Circuit.<name>` (`basekv`, `pu`, `angle`, `phases`, `bus1`, `mvasc3`, `mvasc1`, `r1`, `x1`).
  - **Power Delivery Elements**: `LineCode.<name>` ($R_1, X_1, R_0, X_0, C_1, C_0$), `Line.<name>` (`bus1`, `bus2`, `linecode`, `length`, `units`, `phases`), `Transformer.<name>` (multi-winding `buses=[...]`, `kvs=[...]`, `kvas=[...]`, `conns=[...]`, `%r`, `xhl`), and `Capacitor.<name>`.
  - **Power Conversion & DER Elements**: `Load.<name>` (`kW`, `kvar`, `PF`, `model`), `Generator.<name>`, `PVSystem.<name>` (`kVA`, `Pmpp`, `irradiance`), and `Storage.<name>` (`kWrated`, `kWhrated`, `%stored`).
- **Radial & Meshed Forward-Backward Sweep Power Flow Solver (`solveDistributionPowerFlow`)**: Iterative DistFlow / forward-backward sweep solver computing per-bus voltage magnitudes ($V_{\text{kV}}, V_{\text{pu}}$), voltage phase angles ($\delta^\circ$), active/reactive feeder load and DER generation totals, and $I^2 R$ distribution line and transformer copper losses.
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerOpenDssToDae`)**: Compiles substation Thévenin sources, multi-winding transformers, distribution line $R + j\omega L$ branches, shunt capacitors, constant-power/impedance loads, PV inverters, and battery storage state-of-charge ODEs ($\frac{dE_{\text{BESS}}}{dt} = -P_{\text{BESS}}$) directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **8 Pre-Flight Distribution Grid & DER Hosting Lint Rules (`M8401`–`M8408`, `lintOpenDss`)**: Static electrical verification detecting isolated/undefined bus nodes, phase-count mismatches, transformer winding kV vs. bus base kV mismatches, reverse-power DER hosting capacity thermal overloads ($\sum P_{\text{PV+Gen}} > S_{\text{xfmr}}$), missing `New Circuit` sources, negative load kW declarations, non-positive line lengths, and undefined `LineCode` references.
- **Modelica 3.x Distribution Grid Projection (`openDssToModelica`)**: Synthesizes standardized Modelica 3.x electrical distribution feeder models for transient and DER control co-simulation.
- **Multi-File Workspace Indexing & LSP (`OpenDssWorkspaceIndex`, `provideOpenDssHover`, `provideOpenDssCompletions`)**: Implements `IWorkspaceIndex` across master and redirected `.dss` feeder scripts with bus/element hover inspection, command completions, and AST writeback.

---

## Package Structure

| Path                                     | Description                                                                                                                 |
| ---------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                           | Public package exports                                                                                                      |
| `src/language.ts`                        | `openDssLanguage` definition and LSP actions (`lint_opendss`, `opendss_powerflow`, `opendss_to_dae`, `opendss_to_modelica`) |
| `src/types.ts`                           | `DssDeck`, `DssCircuit`, `DssLineCode`, `DssLine`, `DssTransformer`, `DssLoad`, `DssPvSystem`, and `DssStorage`             |
| `src/errors.ts`                          | `OpenDssErrorCode` diagnostic registry (`M8401`–`M8408`)                                                                    |
| `src/parser/opendss-parser.ts`           | `parseOpenDss` parser for EPRI OpenDSS `.dss` distribution scripts                                                          |
| `src/lints/opendss-linter.ts`            | `lintOpenDss` distribution topology, phase consistency, and DER hosting capacity linter                                     |
| `src/lints/index.ts`                     | Linter barrel exports                                                                                                       |
| `src/solvers/power-flow-solver.ts`       | `solveDistributionPowerFlow` forward-backward sweep distribution power flow solver                                          |
| `src/dae/opendss-to-dae.ts`              | `lowerOpenDssToDae` direct lowering of feeders, transformers, and DERs into `DAEBuilder` linear memory                      |
| `src/projections/opendss-to-modelica.ts` | `openDssToModelica` translator to Modelica 3.x distribution grid models                                                     |
| `src/workspace-index.ts`                 | `OpenDssWorkspaceIndex` implementing `IWorkspaceIndex` across `.dss` scripts                                                |
| `src/lsp.ts`                             | LSP hover, completion, and symbol providers                                                                                 |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                                                      |
| ------- | ------------------------------ | --------- | -------------------------------------------------------------------------------------------------------------------------------- |
| `M8401` | `unconnected-bus-node`         | `error`   | Element `'elemName'` references undefined or isolated bus node `'busName'`.                                                      |
| `M8402` | `phase-count-mismatch`         | `error`   | Element `'elemName'` (`elemPhases` phases) is connected to bus `'busName'` with a conflicting phase count (`busPhases`).         |
| `M8403` | `transformer-voltage-mismatch` | `warning` | Transformer `'xfmrName'` winding rated voltage ($\text{kV}$) differs from nominal connected bus voltage ($\text{kV}$).           |
| `M8404` | `reverse-power-hosting-risk`   | `warning` | Total DER generation capacity ($\text{kW}$) on feeder `'feederName'` exceeds upstream transformer thermal rating ($\text{kVA}$). |
| `M8405` | `missing-circuit-definition`   | `error`   | OpenDSS script defines circuit elements without declaring a `'New Circuit'` substation voltage source.                           |
| `M8406` | `negative-load-power`          | `error`   | Load `'loadName'` specifies negative active power ($\text{kW}$); use `Generator` or `Storage` for net generation.                |
| `M8407` | `zero-or-negative-line-length` | `error`   | Line `'lineName'` specifies an invalid non-positive physical length ($\le 0$).                                                   |
| `M8408` | `missing-line-code`            | `error`   | Line `'lineName'` references undefined `LineCode` `'codeName'`.                                                                  |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect substation source, transformers, lines, loads, PV systems, and BESS
npx msx opendss inspect IEEE13Nodeckt.dss

# Run pre-flight distribution topology and DER hosting capacity checks (M8401-M8408)
npx msx opendss lint IEEE13Nodeckt.dss

# Solve distribution feeder power flow and bus per-unit voltages
npx msx opendss powerflow IEEE13Nodeckt.dss

# Lower distribution circuit and BESS dynamics to the linear-memory DAE arena
npx msx opendss to-dae IEEE13Nodeckt.dss

# Export OpenDSS feeder to a Modelica 3.x distribution grid model
npx msx opendss to-modelica IEEE13Nodeckt.dss -o IEEE13Feeder.mo
```

### Programmatic Usage

```typescript
import {
  lintOpenDss,
  lowerOpenDssToDae,
  openDssToModelica,
  parseOpenDss,
  solveDistributionPowerFlow,
} from "@modelscript/opendss";

const dssScript = `
Clear
New Circuit.IEEE13 basekv=115 pu=1.0001 phases=3 bus1=SourceBus
New Transformer.Sub phases=3 windings=2 buses=[SourceBus 650] conns=[delta wye] kvs=[115 4.16] kvas=[5000 5000] %r=0.5 xhl=8
New LineCode.601 nphases=3 r1=0.3465 x1=1.0179 r0=1.3238 x0=3.1244 units=mi
New Line.650632 phases=3 bus1=650 bus2=632 linecode=601 length=2000 units=ft
New Load.632 bus1=632 phases=3 conn=wye model=1 kV=4.16 kW=1155 kvar=660
New PVSystem.Solar632 phases=3 bus1=632 kV=4.16 kVA=500 Pmpp=450 irradiance=1.0
Solve
`;

// 1. Parse OpenDSS script and run M8401-M8408 pre-flight diagnostics
const deck = parseOpenDss(dssScript, "IEEE13Nodeckt.dss");
const diagnostics = lintOpenDss(deck);

// 2. Solve forward-backward sweep distribution power flow
const pfResult = solveDistributionPowerFlow(deck);
console.log(pfResult.converged, pfResult.lossesKw, pfResult.buses.get("632")?.voltagePu);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerOpenDssToDae(deck);
const modelicaCode = openDssToModelica(deck);
```

---

## Scripts

| Command             | Description                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`                                                  |
| `npm test`          | Run OpenDSS parser, linter, distribution power flow, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                          |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                           |
| `npm run clean`     | Remove `dist/` build artifacts                                                 |
