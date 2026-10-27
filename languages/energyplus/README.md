<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/energyplus

US DOE EnergyPlus building energy performance, envelope heat transfer, and HVAC thermal simulation package (`.idf`, `.epjson`) for ModelScript. Features dual IDF and epJSON parsers (`parseEnergyPlus`, `parseIdf`, `parseEpJson`), multi-file workspace indexing (`EnergyPlusWorkspaceIndex`), direct linear-memory `DAEBuilder` multi-zone thermal RC lowering (`lowerEnergyPlusToDae`), 8 pre-flight building physics & 3D surface geometry lint rules (`M7901`–`M7908`), bidirectional Modelica `Modelica.Thermal.HeatTransfer` projection & synchronization (`energyPlusToModelica`, `synchronizeModelicaToEnergyPlus`), and Language Server Protocol (LSP) services.

---

## Core Capabilities

- **Dual EnergyPlus IDF & epJSON Parser (`parseEnergyPlus`, `parseIdf`, `parseEpJson`)**: Parses `.idf` (comma/semicolon-delimited Input Data Files with `!` comments) and `.epjson` JSON schemas into a unified `EnergyPlusDocument`, extracting `Version`, `Building`, `Zone` (volume, ceiling height, multipliers), `Material` & `Material:NoMass`, `Construction` layer stacks, `BuildingSurface:Detailed` & `FenestrationSurface:Detailed` with 3D polygon vertices and Newells normal/area computation, internal gains (`People`, `Lights`, `ElectricEquipment`), infiltration (`ZoneInfiltration:DesignFlowRate`), and `ZoneHVAC:IdealLoadsAirSystem` / thermostat setpoints.
- **Direct Linear-Memory `DAEBuilder` Multi-Zone Thermal Lowering (`lowerEnergyPlusToDae`)**: Compiles multi-zone building thermal networks directly into ModelScript's zero-GC WebAssembly `DAEBuilder` struct-of-arrays arena:
  - Computes composite construction thermal transmittances ($U = \left(R_{si} + \sum_k \frac{d_k}{\lambda_k} + R_{se}\right)^{-1}$).
  - Formulates zone air & thermal mass capacitance differential equations ($C_{\text{zone}} \frac{dT_z}{dt} = \sum UA_{\text{ext}}(T_{\text{amb}} - T_z) + \sum UA_{\text{gnd}}(T_{\text{gnd}} - T_z) + \sum UA_{ij}(T_j - T_z) + Q_{\text{inf}} + Q_{\text{internal}} + Q_{\text{solar}} + Q_{\text{HVAC}}$).
- **8 Pre-Flight Building Physics & 3D Geometry Lint Rules (`M7901`–`M7908`, `lintEnergyPlus`)**: Static thermodynamic and geometric verification checking reciprocal interzone boundary surfaces, 3D planar polygon convexity (cross-product edge normal verification for solar raytracing and view-factor validity), material conductivity/density/specific-heat positivity, solar absorptance bounds ($\alpha \in [0, 1]$), duplicate zone identifiers, undefined constructions, and HVAC zone connectivity.
- **Bidirectional Modelica Projection & Reconciliation (`energyPlusToModelica`, `synchronizeModelicaToEnergyPlus`)**: Translates EnergyPlus thermal zones, constructions, and internal loads into `Modelica.Thermal.HeatTransfer` models and supports reverse parameter reconciliation (`target-wins`, `source-wins`, `physics-simplex`) back into `.idf` / `.epjson` sources.
- **Multi-File Workspace Indexing & LSP (`EnergyPlusWorkspaceIndex`, `getEnergyPlusHover`, `getEnergyPlusCompletions`)**: Implements `IWorkspaceIndex` for cross-file building element lookups with rich thermal resistance ($R$-value / $U$-value) hover cards and completion providers.

---

## Package Structure

| Path                                        | Description                                                                                                          |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`                              | Public package exports                                                                                               |
| `src/language.ts`                           | `energyplusLanguage` definition and LSP actions (`energyplus_lint`, `energyplus_to_dae`, `energyplus_to_modelica`)   |
| `src/types.ts`                              | `EnergyPlusDocument`, `IdfZone`, `IdfMaterial`, `IdfConstruction`, `IdfSurface`, `IdfZoneHvac`, and diagnostic types |
| `src/parser/index.ts`                       | `parseEnergyPlus` unified dispatcher for `.idf` and `.epjson` files                                                  |
| `src/parser/idf-parser.ts`                  | `parseIdf` scanner and parser for EnergyPlus `.idf` files with 3D polygon area calculation                           |
| `src/parser/epjson-parser.ts`               | `parseEpJson` parser for EnergyPlus `.epjson` JSON files                                                             |
| `src/lints/rules.ts`                        | `lintEnergyPlus` and `EnergyPlusErrorCode` (`M7901`–`M7908`) building physics and geometry linter                    |
| `src/lints/index.ts`                        | Linter barrel exports                                                                                                |
| `src/dae/energyplus-to-dae.ts`              | `lowerEnergyPlusToDae` direct lowering of multi-zone thermal RC networks into `DAEBuilder` linear memory             |
| `src/dae/index.ts`                          | DAE lowering barrel exports                                                                                          |
| `src/projections/energyplus-to-modelica.ts` | `energyPlusToModelica` translator to `Modelica.Thermal.HeatTransfer` models                                          |
| `src/projections/energyplus-sync.ts`        | `synchronizeModelicaToEnergyPlus` bidirectional parameter reconciliation engine                                      |
| `src/projections/index.ts`                  | Projections barrel exports                                                                                           |
| `src/workspace-index.ts`                    | `EnergyPlusWorkspaceIndex` implementing `IWorkspaceIndex` across building models                                     |
| `src/lsp.ts`                                | LSP hover, completion, and diagnostic providers                                                                      |

---

## Semantic / Pre-Flight Lint Rules

| Code    | Rule                           | Severity  | Description                                                                                                                                     |
| ------- | ------------------------------ | --------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| `M7901` | `unmatched-interzone-surface`  | `error`   | Interzone surface `'surfName'` in zone `'zoneName'` specifies outside boundary object `'targetSurf'` which does not exist or is unreciprocated. |
| `M7902` | `non-convex-surface-polygon`   | `warning` | Surface polygon `'surfName'` in zone `'zoneName'` violates 3D planar convexity, impairing solar raytracing and view factor calculations.        |
| `M7903` | `missing-thermal-properties`   | `error`   | Material `'matName'` has non-positive thermal property (`conductivity`, `density`, `specificHeat`, or `thermalResistance`).                     |
| `M7904` | `unconnected-hvac-zone`        | `error`   | HVAC component `'hvacName'` references non-existent thermal zone `'zoneName'`.                                                                  |
| `M7905` | `excessive-surface-absorption` | `warning` | Material `'matName'` has solar absorptance coefficient outside physical bounds ($[0.0, 1.0]$).                                                  |
| `M7906` | `duplicate-zone-name`          | `error`   | Duplicate thermal zone identifier `'zoneName'` detected in building model.                                                                      |
| `M7907` | `unreferenced-construction`    | `error`   | Building surface `'surfName'` references undefined construction `'constName'`.                                                                  |
| `M7908` | `zero-thickness-material`      | `error`   | Opaque material `'matName'` has invalid non-positive thickness ($\le 0\text{ m}$).                                                              |

---

## CLI & Programmatic Usage

### CLI Commands

```bash
# Inspect thermal zones, envelope surfaces, materials, and constructions
npx msx energyplus inspect office.idf

# Run pre-flight building physics and 3D surface convexity checks (M7901-M7908)
npx msx energyplus lint office.idf

# Compute steady-state zone UA, internal gains, and free-floating temperatures
npx msx energyplus thermal-balance office.idf --tamb 10.0

# Lower multi-zone building thermal network to the linear-memory DAE arena
npx msx energyplus to-dae office.idf

# Project EnergyPlus model to Modelica.Thermal and synchronize changes back
npx msx energyplus to-modelica office.idf -o OfficeThermal.mo
npx msx energyplus sync office.idf --from-modelica OfficeThermal.mo --strategy target-wins
```

### Programmatic Usage

```typescript
import {
  energyPlusToModelica,
  lintEnergyPlus,
  lowerEnergyPlusToDae,
  parseEnergyPlus,
  synchronizeModelicaToEnergyPlus,
} from "@modelscript/energyplus";

const idfText = `
Version, 24.1;
Building, SmartOffice, 0.0, City, 0.04, 0.4, FullInteriorAndExterior, 25, 6;
Zone, CoreZone, 0.0, 0.0, 0.0, 0.0, 1, 1, 3.5, 350.0;
Material, Concrete200mm, MediumRough, 0.20, 1.75, 2300.0, 880.0, 0.9, 0.7, 0.7;
Construction, ExtWallConst, Concrete200mm;
BuildingSurface:Detailed, SouthWall, Wall, ExtWallConst, CoreZone, , Outdoors, , SunExposed, WindExposed, 0.5, 4,
  0.0, 0.0, 3.5,  0.0, 0.0, 0.0,  10.0, 0.0, 0.0,  10.0, 0.0, 3.5;
`;

// 1. Parse IDF or epJSON and run M7901-M7908 diagnostics
const doc = parseEnergyPlus(idfText, "office.idf");
const diagnostics = lintEnergyPlus(doc);

// 2. Lower multi-zone thermal capacitance & conduction network into DAEBuilder
const dae = lowerEnergyPlusToDae(doc);
console.log(dae.getVarCount(), dae.getEqCount());

// 3. Project to Modelica and synchronize modified Modelica parameters back to IDF
const modelicaCode = energyPlusToModelica(doc);
const syncResult = synchronizeModelicaToEnergyPlus(idfText, modelicaCode, {
  strategy: "target-wins",
});
```

---

## Scripts

| Command             | Description                                                                     |
| ------------------- | ------------------------------------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                                                   |
| `npm test`          | Run IDF/epJSON parser, linter, thermal DAE, Modelica projection, and sync tests |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                                           |
| `npm run typecheck` | Run `tsc --noEmit` type verification                                            |
| `npm run clean`     | Remove `dist/` build artifacts                                                  |
