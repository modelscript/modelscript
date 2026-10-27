<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/epanet

US EPA EPANET 2.2 municipal water distribution network and pressurized pipe hydraulic simulation package (`.inp`) for ModelScript. Features an EPANET `.inp` section parser (`parseInp`), multi-file workspace indexing (`EpanetWorkspaceIndex`), a Todini & Pilati (1988) Global Gradient Method (`solveHydraulics`) hydraulic solver with optional native WebAssembly Cholesky acceleration, direct linear-memory `DAEBuilder` lowering (`lowerEpanetToDae`), 8 pre-flight hydraulic network lint rules (`M8101`–`M8108`), `Modelica.Fluid` projections (`epanetToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **EPANET `.inp` Network Parser (`parseInp`)**: Parses US EPA EPANET 2.x section-based `.inp` files across `[TITLE]`, `[JUNCTIONS]`, `[RESERVOIRS]`, `[TANKS]`, `[PIPES]`, `[PUMPS]`, `[VALVES]` (`PRV`, `PSV`, `PBV`, `FCV`, `TCV`, `GPV`), `[CURVES]`, `[PATTERNS]`, `[TIMES]`, `[OPTIONS]` (`UNITS`, `HEADLOSS`: `H-W`, `D-W`, `C-M`), and `[COORDINATES]` with exact source line/column range tracking.
- **Todini & Pilati Global Gradient Method (GGM) Solver (`solveHydraulics`)**: Solves coupled nodal continuity ($\sum Q_{ij} - D_i = 0$) and Hazen-Williams / Darcy-Weisbach head-loss equations ($H_i - H_j = r |Q_{ij}|^{n-1} Q_{ij}$) via the Todini GGM Schur-complement formulation ($\mathbf{A}_{21} \mathbf{D}^{-1} \mathbf{A}_{12} \mathbf{H}^{k+1} = \mathbf{b}$), computing converged nodal total heads ($H$), gauge pressure heads ($P = H - z$), link volumetric flow rates ($Q$), flow velocities ($v$), and friction head losses ($\Delta H$), with optional WebAssembly linear-algebra kernel execution (`useWasm: true`).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerEpanetToDae`)**: Compiles water distribution networks directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena—emitting cylindrical storage tank level differential equations ($A_{\text{tank}} \frac{dh}{dt} = \sum Q_{\text{in}} - \sum Q_{\text{out}}$), Hazen-Williams pipe friction equations, and nodal mass conservation equations.
- **8 Pre-Flight Hydraulic Network Lint Rules (`M8101`–`M8108`, `lintEpanet`)**: Static topology and hydraulic verification detecting isolated junction nodes, negative-pressure cavitation risk ($z_{\text{junction}} > H_{\max,\text{source}}$), non-monotonic pump head-flow curves ($dH/dQ > 0$), non-positive pipe lengths/diameters, duplicate node/link identifiers, and dangling link endpoint references.
- **`Modelica.Fluid` Projection (`epanetToModelica`)**: Translates EPANET reservoirs, tanks, junctions, demands, and pipes into standardized `Modelica.Fluid` hydraulic network models.
- **Multi-File Workspace Indexing & LSP (`EpanetWorkspaceIndex`, `getEpanetHover`, `getEpanetCompletions`)**: Implements `IWorkspaceIndex` for hydraulic node/link symbol lookup, hover inspection, and `.inp` section/keyword auto-completion.

---

## Package Structure

| Path                                    | Description                                                                                                        |
| --------------------------------------- | ------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                          | Public package exports                                                                                             |
| `src/language.ts`                       | `epanetLanguage` definition and LSP actions (`epanet_lint`, `epanet_solve`, `epanet_to_dae`, `epanet_to_modelica`) |
| `src/types.ts`                          | `EpanetNetwork`, `EpanetJunction`, `EpanetReservoir`, `EpanetTank`, `EpanetPipe`, `EpanetPump`, and `EpanetValve`  |
| `src/parser/inp-parser.ts`              | `parseInp` section parser for US EPA EPANET `.inp` files                                                           |
| `src/parser/index.ts`                   | Parser barrel exports                                                                                              |
| `src/lints/rules.ts`                    | `lintEpanet` and `EpanetErrorCode` (`M8101`–`M8108`) hydraulic topology and pump curve linter                      |
| `src/lints/index.ts`                    | Linter barrel exports                                                                                              |
| `src/solver/todini-ggm.ts`              | `solveHydraulics` Todini & Pilati (1988) Global Gradient Method steady-state solver                                |
| `src/solver/index.ts`                   | Solver barrel exports                                                                                              |
| `src/dae/epanet-to-dae.ts`              | `lowerEpanetToDae` direct lowering of tanks, pipes, and junctions into `DAEBuilder` linear memory                  |
| `src/dae/index.ts`                      | DAE lowering barrel exports                                                                                        |
| `src/projections/epanet-to-modelica.ts` | `epanetToModelica` translator to `Modelica.Fluid` hydraulic network models                                         |
| `src/projections/index.ts`              | Projections barrel exports                                                                                         |
| `src/workspace-index.ts`                | `EpanetWorkspaceIndex` implementing `IWorkspaceIndex` across `.inp` files                                          |
| `src/lsp.ts`                            | LSP hover, completion, and diagnostic providers                                                                    |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                        | Severity  | Description                                                                                                        |
| ------- | --------------------------- | --------- | ------------------------------------------------------------------------------------------------------------------ |
| `M8101` | `isolated-hydraulic-node`   | `error`   | Hydraulic node `'nodeId'` is isolated with no connecting pipes, pumps, or valves.                                  |
| `M8102` | `negative-pressure-risk`    | `warning` | Junction `'nodeId'` elevation exceeds maximum network source head, risking sub-atmospheric cavitation and dry-out. |
| `M8103` | `non-monotonic-pump-curve`  | `error`   | Pump head curve `'curveId'` violates decreasing monotonicity ($H(Q_2) > H(Q_1)$ for $Q_2 > Q_1$).                  |
| `M8104` | `zero-length-pipe`          | `error`   | Pipe link `'pipeId'` has non-positive physical length ($\le 0\text{ m}$).                                          |
| `M8105` | `zero-diameter-pipe`        | `error`   | Pipe link `'pipeId'` has non-positive internal diameter ($\le 0\text{ mm}$).                                       |
| `M8106` | `duplicate-node-id`         | `error`   | Duplicate node identifier `'nodeId'` detected in water network topology.                                           |
| `M8107` | `duplicate-link-id`         | `error`   | Duplicate link identifier `'linkId'` detected in water network topology.                                           |
| `M8108` | `unreferenced-node-in-link` | `error`   | Link `'linkId'` references undefined endpoint node `'nodeId'`.                                                     |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect junctions, reservoirs, tanks, pipes, pumps, and valves in an EPANET .inp file
npx msx epanet inspect Net1.inp

# Run pre-flight hydraulic topology and pump curve checks (M8101-M8108)
npx msx epanet lint Net1.inp

# Solve steady-state network hydraulics via the Todini Global Gradient Method
npx msx epanet solve Net1.inp --max-iter 40 --tolerance 0.0001

# Lower hydraulic network equations to the linear-memory DAE arena
npx msx epanet to-dae Net1.inp

# Export EPANET water network to a Modelica.Fluid model
npx msx epanet to-modelica Net1.inp --out WaterNetwork.mo
```

### Programmatic Usage

```typescript
import { epanetToModelica, lintEpanet, lowerEpanetToDae, parseInp, solveHydraulics } from "@modelscript/epanet";

const inpText = `
[TITLE]
Two-Loop Municipal Water Distribution Network

[JUNCTIONS]
J1  150.0  25.0
J2  145.0  40.0

[RESERVOIRS]
R1  210.0

[PIPES]
P1  R1  J1  1000.0  400.0  130.0  0.0  Open
P2  J1  J2  800.0   300.0  120.0  0.0  Open

[OPTIONS]
UNITS     LPS
HEADLOSS  H-W
`;

// 1. Parse EPANET .inp file and run M8101-M8108 pre-flight linter
const network = parseInp(inpText);
const diagnostics = lintEpanet(network);

// 2. Solve steady-state nodal pressures and pipe flows via Todini GGM
const result = solveHydraulics(network, { maxIterations: 50, tolerance: 1e-5 });
console.log(result.converged, result.nodePressures, result.linkFlows);

// 3. Lower to DAEBuilder linear memory or export to Modelica.Fluid
const dae = lowerEpanetToDae(network);
const modelicaCode = epanetToModelica(network);
```

---

## Scripts

| Command             | Description                                                             |
| ------------------- | ----------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                           |
| `npm test`          | Run `.inp` parser, Todini GGM solver, linter, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                   |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                    |
| `npm run clean`     | Remove `dist/` build artifacts                                          |
