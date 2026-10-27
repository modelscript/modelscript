# CFD (SU2 & OpenFOAM)

`@modelscript/cfd` (`languages/cfd`) provides native WebAssembly GLR parsing, parametric configuration materialization, 3D CAD boundary marker synthesis, aerodynamic flow regime analysis, and cross-domain TGG synchronization for Computational Fluid Dynamics solver configurations.

---

## Supported Extensions & Dialects

| Extension      | Dialect                 | Description                                                                                                |
| :------------- | :---------------------- | :--------------------------------------------------------------------------------------------------------- |
| `.cfg`, `.su2` | SU2 Configuration       | Native Stanford University Unstructured (`SU2_CFD`) key-value & marker configuration                       |
| `.cfgt`        | Parametric CFD Template | SU2 or OpenFOAM template supporting <code v-pre>{{ expr }}</code> parameter expressions                    |
| `.cfd`         | OpenFOAM / Native CFD   | OpenFOAM dictionary syntax (`FoamFile`, `dimensions`, `internalField`, `boundaryField`) and SU2 directives |

---

## Parametric Template Materialization (<code v-pre>{{ expr }}</code>)

CFD templates (`.cfgt`, `.cfg`, `.cfd`) can embed mathematical expressions in <code v-pre>{{ ... }}</code> blocks bound to SysML v2 or Modelica workspace parameters:

```ini
SOLVER= RANS
KIND_TURB_MODEL= SST
MACH_NUMBER= {{ cruise_speed / sqrt(1.4 * 287.05 * ambient_temp) }}
AOA= {{ angle_of_attack_deg }}
REYNOLDS_NUMBER= {{ rho_air * cruise_speed * chord_length / mu_air }}
MARKER_HEATFLUX= ( battery_plate, {{ heat_dissipation_watts / plate_area }} )
```

`materializeCfdConfig(templateText, parameters)` (`languages/cfd/src/materializer.ts`) evaluates each expression via `evaluateCfdExpression`, supporting arithmetic operators (`+`, `-`, `*`, `/`, `^`), built-in math functions (`sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `log`, `exp`), and constants (`PI`, `E`).

---

## 3D CAD Boundary Condition Synthesis

When a user assigns a fluid or thermal boundary condition to a 3D CAD face in the viewport, `synthesizeCfdBoundary` and `applyBoundaryActionToConfig` (`languages/cfd/src/boundary-synthesizer.ts`) synthesize and merge the appropriate directives for either **SU2** or **OpenFOAM**:

| Boundary Condition                      | SU2 Directive (`.cfg` / `.su2`)                                    | OpenFOAM `boundaryField` Entry (`.cfd`)                      |
| :-------------------------------------- | :----------------------------------------------------------------- | :----------------------------------------------------------- |
| **Velocity / Total Inlet (`inlet`)**    | `MARKER_INLET= ( <face>, <T_total>, <P_total>, <nx>, <ny>, <nz> )` | `type fixedValue; value uniform (<vx> <vy> <vz>);`           |
| **Pressure Outlet (`outlet`)**          | `MARKER_OUTLET= ( <face>, <back_pressure_Pa> )`                    | `type fixedValue; value uniform <pressure>;`                 |
| **Adiabatic / Heat-Flux Wall (`wall`)** | `MARKER_HEATFLUX= ( <face>, <heat_flux_W_m2> )`                    | `type noSlip;` / `type fixedGradient; gradient uniform <q>;` |
| **Isothermal Wall (`isothermal`)**      | `MARKER_ISOTHERMAL= ( <face>, <temp_K> )`                          | `type fixedValue; value uniform <temp_K>;`                   |
| **Far-Field (`farfield`)**              | `MARKER_FAR= ( <face> )`                                           | `type freestream;`                                           |
| **Symmetry Plane (`symmetry`)**         | `MARKER_SYM= ( <face> )`                                           | `type symmetryPlane;`                                        |

---

## Aerodynamic Theory Slicing & Flow Regime Analysis

`extractCfdSlicingProperties(text)` (`languages/cfd/src/language.ts`) extracts aerodynamic coefficients directly from the CST:

- **`cd`**: Drag coefficient (`DRAG_COEFF`, `CD`, or `C_D`, default `0.3`)
- **`refArea`**: Reference wetted/frontal area (`REF_AREA`, default `1.0` $\text{m}^2$)
- **`density`**: Freestream fluid density (`FREESTREAM_DENSITY` or `RHO`, default `1.225` $\text{kg/m}^3$)
- **`freeStreamVelocity`**: Freestream velocity (`FREESTREAM_VELOCITY`, default `30.0` $\text{m/s}$)

These properties feed directly into Modelica 1D aerodynamic drag models ($F_d = \tfrac{1}{2} \rho v^2 C_d A_{\text{ref}}$), SysML v2 performance requirements, and the Multi-Domain Theory Coordinator (`CaeContractOracle`).

---

## Polyglot TGG Rules

`@modelscript/cfd` registers 6 bidirectional Triple Graph Grammar (TGG) rules in `languages/cfd/src/language.ts`:

| Rule Name                       | Source (`cfd`)                                 | Target Language | Target Construct                                                          |
| :------------------------------ | :--------------------------------------------- | :-------------- | :------------------------------------------------------------------------ |
| `CfdDragPolarToModelicaParam`   | `CfdConfig` (`cd`, `refArea`)                  | `modelica`      | `ComponentClause` (`parameter Real Cd`, `A_ref`)                          |
| `CfdDragPolarToSysmlAttribute`  | `CfdConfig` (`cd`, `refArea`)                  | `sysml2`        | `AttributeUsage`                                                          |
| `CfdInletToModelicaFluidPort`   | `Directive` (`MARKER_INLET`)                   | `modelica`      | `ComponentClause` (`Modelica.Fluid.Interfaces.FluidPort_a`)               |
| `CfdHeatFluxToModelicaHeatPort` | `Directive` (`MARKER_HEATFLUX`)                | `modelica`      | `ComponentClause` (`Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a`) |
| `CfdMarkerToSysmlPort`          | `Directive` (`MARKER_*`)                       | `sysml2`        | `PortUsage`                                                               |
| `CfdDirectiveToSysmlConstraint` | `Directive` (`MACH_NUMBER`, `REYNOLDS_NUMBER`) | `sysml2`        | `ConstraintUsage`                                                         |

## Command Line Interface (`msx cfd`)

```bash
msx cfd <action> [files...] [options]
```

| Action            | Description                                                                                       | Key Options         |
| :---------------- | :------------------------------------------------------------------------------------------------ | :------------------ |
| **`lint`**        | Validates SU2 and OpenFOAM configuration syntax, boundary markers, and thermodynamic consistency. | —                   |
| **`summary`**     | Prints turbulence model, freestream conditions, reference areas, and configured markers.          | —                   |
| **`inspect`**     | Dumps parsed marker tree, solver settings, and evaluated parametric expressions.                  | —                   |
| **`to-modelica`** | Generates Modelica 1D aerodynamic drag models (`Modelica.Mechanics.Translational`) and ports.     | `--out=<file.mo>`   |
| **`to-dae`**      | Lowers boundary conditions and drag polar into ModelScript linear-memory DAE arena.               | `--out=<file.json>` |
| **`solve`**       | Invokes external or embedded SU2 flow solver iteration for steady/unsteady aerodynamic fields.    | —                   |

### Examples

```bash
# Validate boundary markers and turbulence settings in an SU2 configuration
msx cfd lint transonic_wing.cfg

# Display mesh markers, Mach number, and reference area
msx cfd summary wing_template.cfgt

# Project aerodynamic drag polar to standard Modelica component
msx cfd to-modelica transonic_wing.cfg --out=AeroDrag.mo
```

---

## Diagnostic Rules

<LintRules lang="cfd" />
