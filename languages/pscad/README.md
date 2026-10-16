<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/pscad

PSCAD v4/v5 electromagnetic transients (EMT) and power systems engineering package (`.pscx`, `.pslx`, `.pswx`, `.psmx`, `.cfg`, `.dat`) for ModelScript. Features multi-file workspace indexing (`PscadWorkspaceIndex`), Dommel companion-circuit & Bergeron traveling-wave EMT netlist extraction, IEEE 2800-2022 & NERC PRC-029-1 grid-code compliance verification, IEEE C37.111 COMTRADE waveform I/O, 11 pre-flight electrical lint rules (`M6001`–`M6011`), Single-Line Diagram (SLD) synthesis, and Modelica/SSP co-simulation projections.

---

## Core Capabilities

- **PSCAD Schematic & Library XML Parser (`parsePscx`)**: Parses PSCAD cases (`.pscx`), user component libraries (`.pslx`), workspaces (`.pswx`), and master definitions (`.psmx`), preserving schematic coordinates, multi-module hierarchies (`<Definition classid="UserCmpDefn">`), Master Library port layouts, wire nets, virtual wireless adapters (`datalabel`, `xnode`, `radio_link`), and source line/column locations.
- **Multi-File Workspace Indexing (`PscadWorkspaceIndex`)**: Implements `IWorkspaceIndex` to index `.pslx` libraries and `.pscx` project cases into the unified polyglot `SymbolIndex`, resolving cross-file user component definitions and hierarchical sub-modules.
- **Dommel Companion-Circuit & Bergeron Traveling-Wave EMT Netlist (`extractEmtNetlist`, `netlistToEmtCircuit`, `EmtSolver`)**: Lowers schematic graphs into a structured `EmtNetlist` and companion-circuit model for `@modelscript/simulate`'s `EmtSolver`, supporting:
  - 3-phase Thévenin AC voltage sources, RLC branches, timed circuit breakers, and multi-winding transformers
  - Distributed-parameter Bergeron traveling-wave and lumped $\pi$-section transmission lines / cables
  - 6th-order synchronous machines (`sync_machine`), 5th-order induction / DFIG wind machines (`dfig`), and non-linear MOV surge arresters (`mov`)
  - Power electronics & HVDC/FACTS converter bridges (2/3-level VSC PWM, 6-pulse thyristor LCC, and Thévenin-equivalent MMC)
  - Black-box vendor Inverter-Based Resource (IBR) Functional Mock-up Units (`EmtFmuInstance`) and CSMF transfer-function control blocks (`const`, `gain`, `pi_ctlr`, `realpole`, `leadlag`, `limit`, `sum`)
- **IEEE 2800-2022 & NERC PRC-029-1 Ride-Through Verifier (`verifyIeee2800Compliance` / `verifyIeee2800RideThrough`, `extractSequencePhasors`)**: Sliding 1-cycle fundamental DFT and Fortescue symmetrical component analyzer ($V_0, V_1, V_2, I_0, I_1, I_2$, synchronous $dq$ active/reactive currents $I_{1d}, I_{1q}, I_{2d}, I_{2q}$, frequency, RoCoF, and phase-angle jump) evaluating 7 mandatory grid-code clauses:
  - **Clause 5.3.2 / 7.2.2.3**: Low/High Voltage Ride-Through (LVRT/HVRT) & Prohibition of Momentary Cessation
  - **Clause 5.4.1 / 7.2.2.3.5**: Fast Dynamic Reactive Current Step Response ($T_{90\%} \le 50\text{ ms}$)
  - **Clause 5.4.2 / 7.2.2.1**: Post-Fault Transient Overvoltage Ceiling ($V_{\text{peak}} \le 1.20\text{ pu}$)
  - **Clause 7.2.2.1 / NERC PRC-029-1**: Piecewise Time-Voltage Ride-Through (VRT) Envelope
  - **Clause 7.2.2.3.4**: Incremental Positive & Negative-Sequence Reactive Current Droop Gains ($k_1 = \Delta I_{1q} / \Delta V_1$, $k_2 = \Delta I_{2q} / \Delta V_2$)
  - **Clause 7.2.2.3.5**: Post-Fault Active Power Recovery ($I_{\text{post}} \ge 90\% I_{\text{pre}}$ within $1.0\text{ s}$)
  - **Clause 7.3.2**: Frequency, RoCoF ($\ge 5\text{ Hz/s}$), and Instantaneous Phase-Angle Jump ($\ge 25^\circ$) Ride-Through
- **IEEE C37.111-1999/2013 & IEC 60255-24 COMTRADE Reader/Writer (`readComtrade`, `writeComtrade`, `emtResultToComtrade`)**: Full parser and serializer for `.cfg`, ASCII/Binary `.dat` (`ASCII`, `BINARY`, `BINARY32`, `FLOAT32`), and single-file `.cff` transient fault records.
- **11 Pre-Flight Electrical Lint Rules (`M6001`–`M6011`, `lintPscx`)**: Static electrical topology, impedance hierarchy, Bergeron travel-time, and weak-grid Short-Circuit Ratio (SCR) diagnostics with 1-click LSP Quick-Fix code actions.
- **Single-Line Diagram (SLD) Layout & Master Library Catalog (`MASTER_LIBRARY_SCHEMAS`)**: Rich multi-tab component schemas, interactive SLD visualization (`inspect_pscad_schematic`), engineering hover cards with computed ohmic/per-unit impedances, and XML component synthesis.
- **Modelica & SSP Co-Simulation Projections (`pscadToModelica`, `pscadToSsd`) & 15 TGG Rules**: Translates PSCAD networks into native `Modelica.Electrical.Analog` models or standardized `SystemStructure.ssd` multi-FMU co-simulation architectures, backed by 15 bidirectional Triple Graph Grammar (TGG) rules bridging PSCAD components, buses, transformers, transmission lines, machines, converters, and CSMF blocks with Modelica and SSP.

---

## Package Structure

| Path                                    | Description                                                                                                                                        |
| --------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                          | Public package exports                                                                                                                             |
| `src/language.ts`                       | `pscadLanguage` definition, `runPscadSimulationPipeline`, and LSP actions (`lint_pscad_project`, `inspect_pscad_schematic`, `simulate_hybrid_emt`) |
| `src/parser/pscx-parser.ts`             | `parsePscx` XML parser for `.pscx`, `.pslx`, `.pswx`, and `.psmx` files                                                                            |
| `src/workspace-index.ts`                | `PscadWorkspaceIndex` multi-file symbol indexer for PSCAD libraries and cases                                                                      |
| `src/netlist/emt-netlist.ts`            | `extractEmtNetlist` and `netlistToEmtCircuit` lowering schematics to Dommel/Bergeron EMT circuits                                                  |
| `src/lints/index.ts`                    | `lintPscx` and `PscadErrorCode` (`M6001`–`M6011`) pre-flight electrical diagnostic engine                                                          |
| `src/verification/ieee2800.ts`          | `verifyIeee2800Compliance` and `extractSequencePhasors` grid-code verification engine                                                              |
| `src/comtrade/comtrade-reader.ts`       | `readComtrade` IEEE C37.111 `.cfg` / `.dat` / `.cff` parser                                                                                        |
| `src/comtrade/comtrade-writer.ts`       | `writeComtrade` and `emtResultToComtrade` waveform exporters                                                                                       |
| `src/projections/modelica.ts`           | `pscadToModelica` translator to `Modelica.Electrical.Analog` & `Modelica.Blocks`                                                                   |
| `src/projections/ssp.ts`                | `pscadToSsd` translator to `SystemStructure.ssd` multi-FMU co-simulation manifests                                                                 |
| `src/catalog/master-library-schemas.ts` | `MASTER_LIBRARY_SCHEMAS`, SLD layout helpers, LSP completions, hovers, and quick-fix actions                                                       |

---

## Pre-Flight Electrical Lint Rules (`M6001`–`M6011`)

| Code    | Rule                           | Severity  | Description                                                                                                  |
| ------- | ------------------------------ | --------- | ------------------------------------------------------------------------------------------------------------ |
| `M6001` | `floating-electrical-node`     | `error`   | Electrical bus or node is floating with no closed branch connections                                         |
| `M6002` | `transformer-winding-mismatch` | `warning` | Transformer primary or secondary kV rating differs from connected bus base voltage by $> 5\%$                |
| `M6003` | `invalid-parameter-bounds`     | `error`   | Non-physical component parameter ($R < 0$, $L \le 0$, $C \le 0$, or $\text{MVA} \le 0$)                      |
| `M6004` | `weak-grid-warning`            | `warning` | Point of Interconnection (POI) has low Short-Circuit Ratio ($\text{SCR} < 1.5$), risking IBR PLL instability |
| `M6005` | `csmf-unresolved-input`        | `error`   | CSMF control block references an unresolved upstream signal block ID                                         |
| `M6006` | `line-travel-time-underflow`   | `error`   | Bergeron/FDPM transmission line wave propagation delay ($\tau = \ell\sqrt{LC}$) is smaller than $\Delta t$   |
| `M6007` | `sync-machine-reactance-order` | `error`   | Synchronous machine violates physical $d$-axis reactance hierarchy ($X_d \ge X_d' \ge X_d'' > 0$)            |
| `M6008` | `mov-arrester-under-rated`     | `warning` | MOV surge arrester reference voltage $V_{\text{ref}}$ is below connected bus phase-to-ground peak voltage    |
| `M6009` | `duplicate-component-id`       | `error`   | Duplicate component or bus ID declared within the same schematic module                                      |
| `M6010` | `bus-voltage-conflict`         | `error`   | Conductive wire net directly shorts two buses with conflicting nominal base voltages without a transformer   |
| `M6011` | `port-domain-mismatch`         | `error`   | Wire connects a CSMF control signal port directly to a 3-phase electrical port or bus                        |

---

## Scripts

| Command             | Description                                                                         |
| ------------------- | ----------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                       |
| `npm test`          | Run PSCX, PSLX, netlist, linter, IEEE 2800, and COMTRADE tests via `test-runner.js` |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                               |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                                |
| `npm run clean`     | Remove `dist/` build artifacts                                                      |

---

## Programmatic Usage

```typescript
import {
  extractEmtNetlist,
  lintPscx,
  parsePscx,
  pscadToModelica,
  pscadToSsd,
  readComtrade,
  runPscadSimulationPipeline,
} from "@modelscript/pscad";

// 1. Parse PSCAD project (.pscx), extract EMT netlist, and run M6001-M6011 linter
const project = parsePscx(pscxXmlText);
const netlist = extractEmtNetlist(project);
const diagnostics = lintPscx(project);

// 2. Run turnkey EMT simulation, COMTRADE export, and IEEE 2800-2022 verification
const result = runPscadSimulationPipeline({
  documentText: pscxXmlText,
  runSimulation: true,
  exportComtrade: true,
  verifyIeee2800: true,
  faultSpec: { evaluateExtendedClauses: true },
});
console.log(result.complianceReport?.summary);

// 3. Project PSCAD schematic to Modelica or SSP SystemStructure.ssd
const modelicaSource = pscadToModelica(project);
const ssdXml = pscadToSsd(project);

// 4. Parse exported IEEE C37.111 COMTRADE (.cfg + .dat) waveforms
if (result.comtrade) {
  const record = readComtrade(result.comtrade.cfg, result.comtrade.dat);
  console.log(record.config.analogChannels.length, record.timeSec.length);
}
```
