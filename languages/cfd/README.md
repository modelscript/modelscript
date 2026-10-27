<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cfd

Computational Fluid Dynamics (CFD) and SU2 / OpenFOAM aerodynamic configuration DSL (`.cfd`, `.cfg`, `.cfgt`, `.su2`, `.foam`), parametric template materializer, 3D CAD boundary condition synthesizer, Reynolds/Mach theory slicer, pre-flight aerodynamic linter (`C1001`–`C1008` / `M7301`–`M7308`), and WebGPU D3Q19 Lattice Boltzmann integration package for ModelScript.

---

## Core Capabilities

- **SU2 & Multi-Dialect CFD Configuration DSL (`.cfd`, `.cfg`, `.cfgt`, `.su2`, `.foam`)**: Declarative grammar specification (`cfdLanguage`) supporting key-value solver directives, tuple vectors, boundary marker definitions (`MARKER_INLET`, `MARKER_OUTLET`, `MARKER_HEATFLUX`, `MARKER_ISOTHERMAL`, `MARKER_EULER`, `MARKER_FARFIELD`, `MARKER_SYM`), and pluggable solver dialects (`Su2Dialect`, `OpenFoamDialect`).
- **WASM GLR Incremental Parser**: Built on `@modelscript/dsl` (`language()`), compiling into a native WebAssembly GLR parser for syntax validation, symbol indexing (`CfdConfig`, `Directive`, `EmbeddedExpression`), and Salsa query resolution (`instantiate`, `resolveSimpleName`).
- **`{{ expr }}` Parametric Config Materializer (`materializeCfdConfig`)**: Evaluates embedded mathematical and parametric expressions inside `.cfgt` templates (`{{ ... }}`) against a safe math environment (`sin`, `cos`, `sind`, `cosd`, `sqrt`, `pow`, `log`, `PI`, etc.) and workspace parameter bindings, emitting concrete `.cfg` solver decks with exact line/column diagnostic reporting (`evaluateCfdExpression`, `materializeSu2Config`).
- **3D CAD Boundary Condition Synthesizer (`synthesizeCfdBoundary`)**: Translates interactive 3D CAD surface selections (`BoundaryActionPayload` for `inlet`, `outlet`, `wall`, `heatflux`, and `isothermal` markers) directly into syntactic SU2 `MARKER_*` directives or OpenFOAM `boundaryField` dictionary blocks, with in-place configuration patching via `applyBoundaryActionToConfig`.
- **Pre-Flight Aerodynamic Linter (`lintCfdModel`, `CfdErrorCode`)**: Validates CFL numerical stability, grid mesh file resolution, inlet/outlet boundary completeness, freestream Mach/Reynolds bounds, reference surface area, and turbulent viscosity ratios with Quick-Fix actions.
- **Reynolds/Mach Aerodynamic Theory Slicing (`extractCfdSlicingProperties`)**: Extracts reduced-order aerodynamic scalars—drag coefficient ($C_d$), reference frontal area ($A_{\text{ref}}$), freestream density ($\rho$), and freestream velocity ($v_\infty$)—from CFD configurations for continuous 1D DAE flight dynamics slicing and SMT verification.
- **WebGPU D3Q19 Lattice Boltzmann Integration**: Couples parsed boundary markers, inlet velocity vectors, Reynolds/Mach numbers (`CfdModelData`), and discretized surface meshes with `@modelscript/simulate`'s GPU-accelerated D3Q19 Lattice Boltzmann Method (LBM) fluid solver and interactive 3D aerodynamics viewer (`open_cfd_viewer`).
- **Bidirectional Polyglot TGG Rules**: 6 Triple Graph Grammar (TGG) rules synchronizing CFD aerodynamic directives and boundary markers with Modelica fluid/thermal ports and SysML v2 system attributes/constraints.

---

## Package Structure

| Path                       | Description                                                                                                                                                                                             |
| -------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `src/index.ts`             | Public package exports (`cfdLanguage`, `materializeCfdConfig`, `synthesizeCfdBoundary`, `parseSu2Config`, `lintCfdModel`, dialects)                                                                     |
| `src/language.ts`          | Grammar definition, LSP actions (`open_cfd_viewer`, `materialize_config`), Salsa queries, and 6 polyglot TGG rules                                                                                      |
| `src/materializer.ts`      | `{{ expr }}` evaluator (`evaluateCfdExpression`), template materializer (`materializeCfdConfig`), CAD boundary synthesizer (`synthesizeCfdBoundary`), and theory slicer (`extractCfdSlicingProperties`) |
| `src/types.ts`             | Core data structures (`CfdModelData`, `CfdMarker`, `BoundaryActionPayload`, `CfdDialect`, `MaterializeOptions`)                                                                                         |
| `src/errors.ts`            | `CfdErrorCode` diagnostic registry (`C1001`–`C1008` / `M7301`–`M7308`)                                                                                                                                  |
| `src/lints/cfd-linter.ts`  | `lintCfdModel` pre-flight aerodynamic diagnostic engine with Quick-Fix actions                                                                                                                          |
| `src/lsp.ts`               | LSP diagnostic validation, hover tooltips, and document symbol providers                                                                                                                                |
| `src/dialects/index.ts`    | Dialect registry (`registerCfdDialect`, `getCfdDialect`)                                                                                                                                                |
| `src/dialects/su2.ts`      | `Su2Dialect` parser and materializer (`parseSu2Config`, `materializeSu2Config`)                                                                                                                         |
| `src/dialects/openfoam.ts` | `OpenFoamDialect` dictionary parser and boundary condition generator                                                                                                                                    |

---

## Semantic / Pre-Flight Lint Rules (`CfdErrorCode`)

| Code (`stdCode` / `code`) | Rule                         | Severity  | Description                                                                                     |
| :------------------------ | :--------------------------- | :-------- | :---------------------------------------------------------------------------------------------- |
| `C1001` (`7301`)          | `cfl-stability-violation`    | `warning` | Courant-Friedrichs-Lewy stability number exceeds recommended maximum limit for explicit scheme. |
| `C1002` (`7302`)          | `unresolved-mesh-file`       | `error`   | Referenced grid mesh file (`MESH_FILENAME`) cannot be located or is invalid.                    |
| `C1003` (`7303`)          | `missing-inlet-boundary`     | `warning` | CFD domain lacks a declared inlet boundary condition (`MARKER_INLET` / `MARKER_FARFIELD`).      |
| `C1004` (`7304`)          | `missing-outlet-boundary`    | `warning` | CFD domain lacks a declared outlet boundary condition or pressure exit (`MARKER_OUTLET`).       |
| `C1005` (`7305`)          | `unphysical-freestream-mach` | `error`   | Freestream Mach number is non-physical or outside the valid range $[0, 25]$.                    |
| `C1006` (`7306`)          | `unphysical-reynolds-number` | `error`   | Freestream Reynolds number must be strictly positive ($\text{Re} > 0$).                         |
| `C1007` (`7307`)          | `negative-surface-area`      | `error`   | Aerodynamic reference area (`REF_AREA`) must be strictly positive ($A_{\text{ref}} > 0$).       |
| `C1008` (`7308`)          | `turbulent-viscosity-ratio`  | `warning` | Turbulent eddy viscosity ratio is non-physical ($\le 0$).                                       |

---

## Polyglot Triple Graph Grammar (TGG) Rules

`@modelscript/cfd` defines 6 bidirectional TGG rules in `cfdLanguage.polyglot.rules`:

| Rule Name                       | Source (`cfd`)                      | Target (`modelica` / `sysml2`)                                                                                        | Priority |
| ------------------------------- | ----------------------------------- | --------------------------------------------------------------------------------------------------------------------- | -------- |
| `CfdDragPolarToModelicaParam`   | `Directive(key: "REF_AREA")`        | `modelica`: `ComponentClause(name: "Cd", defaultValue: cd)`                                                           | 15       |
| `CfdDragPolarToSysmlAttribute`  | `Directive(key: "REF_AREA")`        | `sysml2`: `AttributeUsage(declaredName: "aeroDragCoeff", defaultValue: cd)`                                           | 15       |
| `CfdInletToModelicaFluidPort`   | `Directive(key: "MARKER_INLET")`    | `modelica`: `ComponentClause(name: "inlet", typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a")`                  | 10       |
| `CfdHeatFluxToModelicaHeatPort` | `Directive(key: "MARKER_HEATFLUX")` | `modelica`: `ComponentClause(name: "heatPort", typeSpecifier: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a")` | 10       |
| `CfdMarkerToSysmlPort`          | `Directive(key: "MARKER_SYM")`      | `sysml2`: `PortUsage(declaredName: "marker_sym", declaredType: markerVal)`                                            | 5        |
| `CfdDirectiveToSysmlConstraint` | `Directive(key: dirKey)`            | `sysml2`: `ConstraintUsage(declaredName: dirKey)`                                                                     | 0        |

---

## Scripts

| Command             | Description                                           |
| ------------------- | ----------------------------------------------------- |
| `npm run build`     | Compile TypeScript to `dist/`                         |
| `npm test`          | Run unit and dialect test suites via `test-runner.js` |
| `npm run lint`      | Run ESLint across `src/` and `tests/`                 |
| `npm run typecheck` | Run `tsc --noEmit` type verification                  |
| `npm run clean`     | Remove `dist/` build artifacts                        |

---

## CLI Usage (`msx cfd`)

```bash
# Inspect CFD solver directives, freestream conditions, and boundary markers
msx cfd inspect airfoil.cfg

# Run pre-flight aerodynamic lint checks (C1001–C1008)
msx cfd lint airfoil.cfg

# Solve aerodynamic coefficients and boundary forces
msx cfd solve airfoil.cfg

# Project CFD aerodynamic deck to Modelica or DAE JSON
msx cfd to-modelica airfoil.cfg --out=AirfoilAero.mo
msx cfd to-dae airfoil.cfg --out=airfoil-dae.json
```

---

## Programmatic Usage

```typescript
import {
  applyBoundaryActionToConfig,
  extractCfdSlicingProperties,
  materializeCfdConfig,
  parseSu2Config,
  synthesizeCfdBoundary,
} from "@modelscript/cfd";

// 1. Materialize a parametric CFD template (.cfgt -> .cfg)
const template = `
SOLVER= INC_RANS
MACH_NUMBER= {{ mach }}
AOA= {{ aoa_deg }}
REF_AREA= {{ pi * (rotor_radius ^ 2) }}
MARKER_INLET= ( inlet_patch, {{ v_inlet }}, 1.0, 0.0, 0.0 )
`;

const cfgText = materializeCfdConfig(template, {
  evaluator: { mach: 0.15, aoa_deg: 4.5, rotor_radius: 0.12, v_inlet: 18.5 },
});

// 2. Synthesize & inject a 3D CAD boundary condition
const updatedCfg = applyBoundaryActionToConfig(
  cfgText,
  {
    kind: "heatflux",
    targetId: "motor_casing",
    magnitude: 450.0,
  },
  "su2",
);

// 3. Parse SU2 configuration and extract theory-slicing properties
const model = parseSu2Config(updatedCfg);
const slicing = extractCfdSlicingProperties(updatedCfg);
console.log(model.markers, slicing);
```
