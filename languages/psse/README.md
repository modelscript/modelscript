<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/psse

Siemens PTI PSS/E transmission grid power flow and dynamic network simulation package (`.raw`, `.dyr`) for ModelScript. Features multi-file workspace indexing (`PsseWorkspaceIndex`), RAW format parsing (v30, v32, v33), high-performance Newton-Raphson & Fast Decoupled AC power flow solver (`solveAcPowerFlow` / `solvePowerFlow`), 15 pre-flight transmission grid lint rules (`P1001`–`P4001`), DAE lowering (`lowerPsseToDae`), and turnkey projections to Modelica and PSCAD (`.pscx`).

---

## Core Capabilities

- **PSS/E RAW Base Case Parser (`parsePsseRaw`, `parseRaw`)**: High-performance parser extracting transmission grid network elements:
  - Substation buses (Type 1 PQ, Type 2 PV, Type 3 Swing/Slack, Type 4 Isolated)
  - Synchronous & renewable generators ($P_{gen}, Q_{gen}, Q_{max}, Q_{min}, V_{sched}$)
  - Static & constant-power/current/admittance loads ($P_{load}, Q_{load}$)
  - Fixed & switched shunt capacitor/reactor banks ($B_{init}, B_{steps}$)
  - AC transmission lines (resistance $R$, reactance $X$, charging susceptance $B$, thermal MVA ratings)
  - Two-winding and three-winding transformers with complex tap ratios ($a \angle \phi$) and magnetizing admittance
- **AC Power Flow Solver (`solveAcPowerFlow`, `solvePowerFlow`, `extractPowerFlowNetlist`)**:
  - Full Newton-Raphson and Fast Decoupled power flow solvers with sparse Jacobian formulation
  - Exact calculation of bus voltage phasors ($V_i \angle \theta_i$), active and reactive branch flows ($P_{ij}, Q_{ij}$), and system active/reactive losses
  - Automatic PV-to-PQ bus switching upon reactive capability ($Q_{min} / Q_{max}$) limit exhaustion
- **15 Pre-Flight Transmission Grid Lint Rules (`lintPsse`, `P1001`–`P4001`)**: Comprehensive static validation across generators, buses, slack topology, AC transmission branches, transformers, and loads.
- **Turnkey Projections to Modelica, PSCAD & DAE**:
  - `psseToModelica`: Synthesizes standardized `Modelica.Electrical.Analog` AC network circuits for transient and dynamic co-simulation.
  - `psseToPscad`: Lowers PSS/E base cases into PSCAD XML projects (`.pscx`) with automated single-line busbar layout and transformer parameters.
  - `lowerPsseToDae`: Lowers power flow equations directly into linear-memory `DAEBuilder`.
- **Multi-File Workspace Indexing (`PsseWorkspaceIndex`)**: Global indexing for cross-file model resolution and VS Code Library tree navigation.

---

## Package Structure

| Path                                  | Description                                                                                         |
| :------------------------------------ | :-------------------------------------------------------------------------------------------------- |
| `src/index.ts`                        | Public package exports                                                                              |
| `src/language.ts`                     | `psseLanguage` grammar definition, LSP actions, and polyglot TGG rules                              |
| `src/types.ts`                        | Core TypeScript interfaces (`PsseCase`, `PsseBus`, `PsseGenerator`, `PsseBranch`, `PsseLoad`, etc.) |
| `src/errors.ts`                       | `PsseErrorCode` diagnostic registry (`P1001`–`P4001`)                                               |
| `src/parser/raw-parser.ts`            | `parsePsseRaw` / `parseRaw` parser for PSS/E `.raw` v30/v32/v33 base cases                          |
| `src/parser/wasm-loader.ts`           | WebAssembly GLR parser loader (`parser.wasm`)                                                       |
| `src/netlist/powerflow-netlist.ts`    | `extractPowerFlowNetlist` and admittance matrix ($Y_{\text{bus}}$) builder                          |
| `src/solver/ac-powerflow.ts`          | `solveAcPowerFlow` / `solvePowerFlow` Newton-Raphson and Fast Decoupled AC power flow solver        |
| `src/lints/index.ts`                  | `lintPsse` pre-flight transmission grid diagnostic engine (`P1001`–`P4001`)                         |
| `src/dae/index.ts`                    | `lowerPsseToDae` DAE arena lowering                                                                 |
| `src/projections/psse-to-modelica.ts` | `psseToModelica` translator to `Modelica.Electrical.Analog`                                         |
| `src/projections/psse-to-pscad.ts`    | `psseToPscad` translator to PSCAD `.pscx` XML schematics                                            |
| `src/projections/fmu-to-psse.ts`      | `fmuToPsse` bridge for FMU co-simulation integration                                                |
| `src/workspace-index.ts`              | `PsseWorkspaceIndex` multi-file symbol indexer                                                      |
| `src/lsp.ts`                          | LSP diagnostics, hover, and document symbols                                                        |
| `build.js`                            | Compiles `src/language.ts` into `dist/parser.wasm` and `src-gen/bindings.js`                        |

---

## Pre-Flight Transmission Grid Lint Rules (`P1001`–`P4001`)

| Code    | Rule                                 | Severity  | Description                                                                                                |
| :------ | :----------------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------- |
| `P1001` | `generator-bus-not-found`            | `error`   | Generator references a bus number that does not exist in the bus data section.                             |
| `P1002` | `generator-negative-power`           | `warning` | Generator has negative scheduled active power output ($P_g < 0\text{ MW}$).                                |
| `P1003` | `duplicate-generator-id`             | `error`   | Duplicate generator machine ID declared at the same bus.                                                   |
| `P1004` | `generator-reactive-limits-inverted` | `error`   | Generator has inverted reactive power capability limits ($Q_{\min} > Q_{\max}$).                           |
| `P1005` | `generator-power-limits-inverted`    | `error`   | Generator has inverted active power capability limits ($P_{\min} > P_{\max}$).                             |
| `P2001` | `isolated-bus`                       | `warning` | Bus has no connected in-service AC branches or transformers (isolated bus).                                |
| `P2002` | `missing-slack-bus`                  | `error`   | Power network base case contains 0 slack/swing buses (Bus Type 3); power flow solution cannot be anchored. |
| `P2003` | `multiple-slack-buses`               | `warning` | Power network base case contains multiple swing buses without explicit multi-island partitioning.          |
| `P2004` | `voltage-out-of-bounds`              | `warning` | Initial bus voltage magnitude $V_m$ is outside standard operational limits $[0.80, 1.20]\text{ pu}$.       |
| `P3001` | `branch-from-bus-not-found`          | `error`   | AC transmission branch or transformer references a non-existent `FROM` bus.                                |
| `P3002` | `branch-to-bus-not-found`            | `error`   | AC transmission branch or transformer references a non-existent `TO` bus.                                  |
| `P3003` | `branch-zero-impedance`              | `error`   | Branch between two buses has zero series impedance ($R = 0$ and $X = 0$).                                  |
| `P3004` | `branch-negative-resistance`         | `warning` | Branch defines negative series resistance ($R < 0\text{ pu}$).                                             |
| `P3005` | `transformer-invalid-ratio`          | `error`   | Transformer between two buses has a non-positive off-nominal turns ratio ($\le 0$).                        |
| `P4001` | `load-bus-not-found`                 | `error`   | Load record references a bus number that does not exist in the bus data section.                           |

---

## Scripts

| Command                | Description                                                           |
| :--------------------- | :-------------------------------------------------------------------- |
| `npm run build`        | Build WASM parser (`node build.js`) and compile TypeScript to `dist/` |
| `npm run build:parser` | Force-rebuild `parser.wasm` and generated bindings                    |
| `npm test`             | Run RAW parser, AC power flow, linter, and projection tests           |
| `npm run lint`         | Run ESLint across `src/` and `tests/`                                 |
| `npm run typecheck`    | Run `tsc --noEmit` type verification                                  |
| `npm run clean`        | Remove `dist/`, `src-gen/`, `as-gen/`, and `.wasm` build artifacts    |

---

## CLI Usage (`msx psse`)

```bash
# Inspect PSS/E RAW base case summary and bus/branch counts
msx psse inspect IEEE14.raw

# Run pre-flight transmission grid lint checks (P1001–P4001)
msx psse lint IEEE14.raw

# Solve AC power flow (Newton-Raphson or Fast Decoupled)
msx psse solve IEEE14.raw --algorithm=nr --tol=1e-4

# Render single-line transmission grid diagram to SVG
msx psse diagram IEEE14.raw --out=ieee14-sld.svg

# Project PSS/E network to Modelica or DAE JSON
msx psse to-modelica IEEE14.raw --out=IEEE14.mo
msx psse to-dae IEEE14.raw --out=ieee14-dae.json
```

---

## Programmatic Usage

```typescript
import { parsePsseRaw, solveAcPowerFlow, lintPsse, psseToModelica, psseToPscad } from "@modelscript/psse";

// Parse a PSS/E RAW base case
const rawContent = `...`;
const psseCase = parsePsseRaw(rawContent);

// Run pre-flight lint checks (P1001-P4001)
const diagnostics = lintPsse(psseCase);

// Solve AC power flow
const powerFlowResult = solveAcPowerFlow(psseCase);
console.log(
  `Converged in ${powerFlowResult.iterations} iterations. Active losses: ${powerFlowResult.totalLossesMw} MW`,
);

// Export to Modelica or PSCAD
const modelicaSource = psseToModelica(psseCase);
const pscadXml = psseToPscad(psseCase);
```
