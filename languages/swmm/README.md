<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/swmm

US EPA SWMM 5.x (Storm Water Management Model) urban drainage, open-channel hydrology, and sewer hydraulic routing package (`.inp`) for ModelScript. Features a zero-regex SWMM `.inp` section parser (`parseSwmm`), multi-file workspace indexing (`SwmmWorkspaceIndex`), a 1D Manning open-channel & circular-conduit hydraulic routing solver (`routeNetworkFlow`, `computeCircularSection`), direct linear-memory `DAEBuilder` Saint-Venant storage/routing lowering (`lowerSwmmToDae`), 13 pre-flight stormwater & sewer topology lint rules (`M8201`–`M8213`), Modelica 3.x hydraulic network projections (`swmmToModelica`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **US EPA SWMM 5.x `.inp` Parser (`parseSwmm`)**: Zero-regex section parser extracting `[TITLE]`, `[OPTIONS]` (`FLOW_UNITS`: `CFS`/`GPM`/`MGD`/`CMS`/`LPS`/`MLD`, `INFILTRATION`, `FLOW_ROUTING`: `STEADY`/`KINWAVE`/`DYNWAVE`), `[RAINGAGES]`, `[SUBCATCHMENTS]`, `[JUNCTIONS]` (invert elevation, max depth, ponded area), `[OUTFALLS]` (`FREE`, `NORMAL`, `FIXED`, `TIDAL`, `TIMESERIES`), `[STORAGE]`, `[CONDUITS]` (length, Manning's $n$, inlet/outlet offsets), `[PUMPS]`, `[ORIFICES]`, `[WEIRS]`, `[XSECTIONS]` (`CIRCULAR`, `RECT_CLOSED`, `RECT_OPEN`, `TRapezoidal`), and `[INFLOWS]`.
- **1D Open-Channel & Circular Conduit Hydraulic Routing Solver (`routeNetworkFlow`, `computeCircularSection`)**: Computes exact circular and rectangular partially-full wetted cross-section geometry ($\theta = 2 \arccos(1 - 2d/D)$, area $A$, wetted perimeter $P_w$, hydraulic radius $R_h = A / P_w$), Manning open-channel discharge ($Q = \frac{k_u}{n} A R_h^{2/3} S_0^{1/2}$), full-pipe capacity ratio ($Q / Q_{\text{full}}$), nodal hydraulic head balance, and surcharge/overflow detection (`NORMAL`, `SURCHARGED`, `DRY`).
- **Direct Linear-Memory `DAEBuilder` Lowering (`lowerSwmmToDae`)**: Lowers junction/storage nodal continuity ODEs ($A_{\text{node}} \frac{dH_i}{dt} = Q_{\text{inflow},i} + \sum Q_{\text{in}} - \sum Q_{\text{out}}$), Manning open-channel conduit momentum equations, and weir/orifice discharge equations directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena.
- **13 Pre-Flight Urban Drainage & Sewer Lint Rules (`M8201`–`M8213`, `lintSwmm`)**: Static verification of conduit/pump/weir/orifice endpoint nodes, adverse conduit bed slopes ($z_{\text{in}} < z_{\text{out}}$), missing `[XSECTIONS]` declarations, unsupported outfall boundary types, manhole surcharge overflow risks ($z_{\text{rim}} < z_{\text{crown}}$), duplicate node/link identifiers, non-positive Manning's roughness $n$ or conduit length, isolated junctions, dangling subcatchment outlets, negative weir crest offsets, and invalid discharge coefficients $C_d$.
- **Modelica 3.x Stormwater Network Projection (`swmmToModelica`)**: Synthesizes standalone Modelica 3.x open-channel and storage hydraulic network models.
- **Multi-File Workspace Indexing & LSP (`SwmmWorkspaceIndex`, `provideSwmmHover`, `provideSwmmCompletions`)**: Implements `IWorkspaceIndex` across SWMM `.inp` drainage models with node/conduit hover cards, section/keyword completions, and AST writeback.

---

## Package Structure

| Path                                  | Description                                                                                                              |
| ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------ |
| `src/index.ts`                        | Public package exports                                                                                                   |
| `src/language.ts`                     | `swmmLanguage` definition and LSP actions (`lint_swmm_network`, `swmm_to_dae`, `swmm_to_modelica`, `swmm_route_flow`)    |
| `src/types.ts`                        | `SwmmDeck`, `SwmmJunction`, `SwmmOutfall`, `SwmmConduit`, `SwmmCrossSection`, `SwmmSubcatchment`, and weir/orifice types |
| `src/errors.ts`                       | `SwmmErrorCode` diagnostic registry (`M8201`–`M8213`)                                                                    |
| `src/parser/swmm-parser.ts`           | `parseSwmm` zero-regex parser for US EPA SWMM 5.x `.inp` files                                                           |
| `src/lints/swmm-linter.ts`            | `lintSwmm` sewer topology, adverse slope, surcharge risk, and Manning roughness linter                                   |
| `src/lints/index.ts`                  | Linter barrel exports                                                                                                    |
| `src/solver/hydraulic-solver.ts`      | `routeNetworkFlow` and `computeCircularSection` 1D Manning open-channel hydraulic routing solver                         |
| `src/dae/swmm-to-dae.ts`              | `lowerSwmmToDae` direct lowering of junctions, storage units, and conduits into `DAEBuilder` linear memory               |
| `src/projections/swmm-to-modelica.ts` | `swmmToModelica` translator to Modelica 3.x open-channel hydraulic models                                                |
| `src/workspace-index.ts`              | `SwmmWorkspaceIndex` implementing `IWorkspaceIndex` across `.inp` files                                                  |
| `src/lsp.ts`                          | LSP hover, completion, and symbol providers                                                                              |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                            | Severity  | Description                                                                                                                        |
| ------- | ------------------------------- | --------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| `M8201` | `dangling-node-reference`       | `error`   | Link `'linkId'` references undefined `inlet` or `outlet` node `'nodeId'`.                                                          |
| `M8202` | `adverse-conduit-slope`         | `warning` | Conduit `'conduitId'` has an adverse bed slope: inlet elevation is lower than outlet elevation ($z_{\text{in}} < z_{\text{out}}$). |
| `M8203` | `missing-cross-section`         | `error`   | Conduit `'conduitId'` has no hydraulic cross-section definition in `'[XSECTIONS]'`.                                                |
| `M8204` | `unsupported-outfall-type`      | `error`   | Outfall `'outfallId'` specifies an unsupported boundary condition type `'type'`.                                                   |
| `M8205` | `surcharge-overflow-risk`       | `warning` | Junction `'junctionId'` rim elevation is lower than connected conduit crown elevation, creating a surcharge overflow risk.         |
| `M8206` | `duplicate-node-id`             | `error`   | Duplicate node identifier `'nodeId'` declared in the drainage network.                                                             |
| `M8207` | `duplicate-link-id`             | `error`   | Duplicate link identifier `'linkId'` declared in the drainage network.                                                             |
| `M8208` | `negative-roughness`            | `error`   | Conduit `'conduitId'` specifies a non-positive Manning's roughness coefficient ($n \le 0$).                                        |
| `M8209` | `zero-length-conduit`           | `error`   | Conduit `'conduitId'` specifies a non-positive conduit length ($\le 0$).                                                           |
| `M8210` | `isolated-network-node`         | `warning` | Junction `'nodeId'` has no connected conduits or hydraulic links (isolated node).                                                  |
| `M8211` | `subcatchment-outlet-not-found` | `error`   | Subcatchment `'subId'` references a non-existent discharge outlet `'outletId'`.                                                    |
| `M8212` | `weir-offset-negative`          | `error`   | Weir `'weirId'` specifies a negative crest height offset ($< 0$).                                                                  |
| `M8213` | `invalid-discharge-coefficient` | `error`   | Weir or orifice link `'linkId'` specifies a non-positive discharge coefficient ($C_d \le 0$).                                      |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect junctions, outfalls, conduits, cross-sections, and subcatchments
npx msx swmm inspect urban_drainage.inp

# Run pre-flight sewer topology, adverse slope, and surcharge checks (M8201-M8213)
npx msx swmm lint urban_drainage.inp

# Solve 1D Manning open-channel flow routing and surcharge status
npx msx swmm route-flow urban_drainage.inp

# Lower stormwater network equations to the linear-memory DAE arena
npx msx swmm to-dae urban_drainage.inp

# Project SWMM drainage network to a Modelica 3.x hydraulic model
npx msx swmm to-modelica urban_drainage.inp -o UrbanDrainage.mo
```

### Programmatic Usage

```typescript
import {
  computeCircularSection,
  lintSwmm,
  lowerSwmmToDae,
  parseSwmm,
  routeNetworkFlow,
  swmmToModelica,
} from "@modelscript/swmm";

const swmmInp = `
[TITLE]
Urban Stormwater Trunk Sewer

[OPTIONS]
FLOW_UNITS    CMS
FLOW_ROUTING  DYNWAVE

[JUNCTIONS]
J1  100.0  3.0  0.0  0.0  0.0
J2  98.5   3.0  0.0  0.0  0.0

[OUTFALLS]
OUT1  97.0  FREE  NO

[CONDUITS]
C1  J1  J2    250.0  0.013  0.0  0.0  0.0  0.0
C2  J2  OUT1  200.0  0.013  0.0  0.0  0.0  0.0

[XSECTIONS]
C1  CIRCULAR  1.2  0  0  0  1
C2  CIRCULAR  1.5  0  0  0  1

[INFLOWS]
J1  FLOW  ""  FLOW  1.0  1.0  1.85
`;

// 1. Parse SWMM .inp deck and run M8201-M8213 pre-flight diagnostics
const deck = parseSwmm(swmmInp);
const diagnostics = lintSwmm(deck);

// 2. Solve 1D Manning open-channel routing and circular wetted geometry
const routing = routeNetworkFlow(deck);
const geom = computeCircularSection(1.2, 0.8);
console.log(routing.totalOutflow, routing.isFlooding, geom.hydRadius);

// 3. Lower to DAEBuilder linear memory or export to Modelica
const dae = lowerSwmmToDae(deck);
const modelicaCode = swmmToModelica(deck);
```

---

## Scripts

| Command             | Description                                                                    |
| ------------------- | ------------------------------------------------------------------------------ |
| `npm run build`     | Compile TypeScript to `dist/`                                                  |
| `npm test`          | Run SWMM `.inp` parser, linter, Manning flow router, DAE, and projection tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                          |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                           |
| `npm run clean`     | Remove `dist/` build artifacts                                                 |
