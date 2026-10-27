# FEA (CalculiX, Abaqus & NASTRAN)

`@modelscript/fea` (`languages/fea`) provides native parsing, parametric template materialization, 3D CAD boundary condition synthesis, structural theory slicing, and cross-domain TGG synchronization for Finite Element Analysis input decks.

---

## Supported Dialects & Extensions

| Extension | Dialect                               | Key Directives                                                                                                                                                               |
| :-------- | :------------------------------------ | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `.inp`    | CalculiX / Abaqus input deck          | `*HEADING`, `*NODE`, `*ELEMENT`, `*NSET`, `*ELSET`, `*MATERIAL`, `*ELASTIC`, `*DENSITY`, `*SOLID SECTION`, `*STEP`, `*STATIC`, `*FREQUENCY`, `*BOUNDARY`, `*CLOAD`, `*DLOAD` |
| `.inpt`   | Parametric CalculiX / Abaqus template | Supports <code v-pre>{{ expression }}</code> mustache substitutions over workspace parameters                                                                                |
| `.bdf`    | NASTRAN Bulk Data Deck                | `SOL`, `CEND`, `BEGIN BULK`, `GRID`, `CTETRA`, `CHEXA`, `PSOLID`, `MAT1`, `SPC1`, `FORCE`, `MOMENT`, `LOAD`, `ENDDATA`                                                       |
| `.fea`    | ModelScript native FEA configuration  | Structured material, mesh, boundary, and load study definitions                                                                                                              |

---

## Parametric Template Materialization (<code v-pre>{{ expr }}</code>)

Input decks (`.inpt`, `.inp`, `.bdf`, `.fea`) can embed parametric expressions enclosed in <code v-pre>{{ ... }}</code> placeholders:

```ini
*MATERIAL, NAME=AL7075
*ELASTIC
{{ E_modulus }}, {{ poisson_ratio }}
*DENSITY
{{ rho_al }}
*CLOAD
LOAD_SET, 3, {{ -tip_mass * 9.81 }}
```

`materializeFeaDeck(templateText, parameters)` (`languages/fea/src/materializer.ts`) evaluates arithmetic expressions (`+`, `-`, `*`, `/`, `^`), functions (`sin`, `cos`, `tan`, `sqrt`, `abs`, `min`, `max`, `log`, `exp`), and built-in constants (`PI`, `E`) via `evaluateFeaExpression`, formatting values in engineering notation and recording any unresolved symbols or syntax errors.

---

## 3D CAD Face Boundary Condition & Load Synthesis

When a user selects a topological face in the 3D CAD viewer, `synthesizeFeaBoundary` and `applyBoundaryActionToDeck` (`languages/fea/src/boundary-synthesizer.ts`) automatically generate solver-native boundary and load cards for the target dialect:

| Boundary Kind                            | CalculiX / Abaqus (`.inp`)                                                          | NASTRAN Bulk Data (`.bdf`)                                           |
| :--------------------------------------- | :---------------------------------------------------------------------------------- | :------------------------------------------------------------------- |
| **Fixed Support (`fixed`)**              | `*BOUNDARY` constraining DOFs `1, 6` (or `1, 3`) on `NSET_<FACE>`                   | `SPC1` card locking DOFs `123456` (or `123`) on `SET_<FACE>`         |
| **Point / Concentrated Force (`force`)** | `*CLOAD` directional nodal force components $(F_x, F_y, F_z)$ along the face normal | `FORCE` card with magnitude and normal unit vector $(n_x, n_y, n_z)$ |
| **Distributed Pressure (`pressure`)**    | `*DLOAD` surface pressure (`P`) applied to `ELSET_<FACE>`                           | `PLOAD4` / `FORCE` cards distributed across face elements            |
| **Torque / Moment (`moment`)**           | `*CLOAD` rotational DOFs `4, 5, 6`                                                  | `MOMENT` card around face normal axis                                |

---

## Structural Theory Slicing & Safety Margin Extraction

`extractFeaSlicingProperties(text)` (`languages/fea/src/language.ts`) extracts structural parameters (`DENSITY`, `VOLUME`, `MAX_VON_MISES_STRESS`, `YIELD_STRENGTH`) directly from the CST and evaluates the structural safety margin:

$$
\text{Safety Factor (SF)} = \frac{\sigma_{\text{yield}}}{\sigma_{\text{von Mises, max}}}, \qquad \text{isSafe} \iff \sigma_{\text{von Mises, max}} \le \sigma_{\text{yield}}
$$

Returning `{ mass, maxVonMisesPa, yieldStrengthPa, safetyFactor, isSafe }` directly to the Multi-Domain Theory Coordinator (`CaeContractOracle`) and SysML v2 requirement verifiers.

---

## Built-In Solver & IDE Actions

`@modelscript/fea` registers three interactive actions in `feaLanguage.actions`:

- **`open_fea_viewer`**: Opens the 3D FEA mesh, boundary condition, and von Mises stress contour viewer.
- **`materialize_deck`**: Evaluates all <code v-pre>{{ expr }}</code> template placeholders against workspace parameters to produce a concrete `.inp` or `.bdf` deck.
- **`run_simulation` (`fea_run_simulation`)**: Parses `*MATERIAL`, `*ELASTIC`, `*BOUNDARY`, and `*CLOAD`/`*DLOAD` sections, solves the 3D tetrahedral finite element stiffness matrix, and returns nodal displacements and element von Mises stress contours.

---

## Polyglot TGG Rules

`@modelscript/fea` defines 6 bidirectional Triple Graph Grammar (TGG) rules in `languages/fea/src/language.ts`:

| Rule Name                       | Source (`fea`)                      | Target Language | Target Construct                                                         |
| :------------------------------ | :---------------------------------- | :-------------- | :----------------------------------------------------------------------- |
| `FeaStressMassToModelicaParam`  | `FeaDeck` (`mass`, `maxVonMisesPa`) | `modelica`      | `ComponentClause` (`parameter Real`)                                     |
| `FeaStressMassToSysmlAttribute` | `FeaDeck` (`safetyFactor`, `mass`)  | `sysml2`        | `AttributeUsage`                                                         |
| `FeaMaterialToSysmlAttribute`   | `Section` (`*MATERIAL` / `MAT1`)    | `sysml2`        | `AttributeUsage`                                                         |
| `FeaBoundaryFixToModelicaFixed` | `Section` (`*BOUNDARY` / `SPC1`)    | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Parts.Fixed`)           |
| `FeaSpringToModelicaSpring`     | `Section` (`*SPRING`)               | `modelica`      | `ComponentClause` (`Modelica.Mechanics.Translational.Components.Spring`) |
| `FeaLoadCaseToSysmlRequirement` | `Section` (`*STEP` / `SUBCASE`)     | `sysml2`        | `RequirementUsage`                                                       |

## Command Line Interface (`msx fea`)

```bash
msx fea <action> [files...] [options]
```

| Action            | Description                                                                                          | Key Options         |
| :---------------- | :--------------------------------------------------------------------------------------------------- | :------------------ |
| **`lint`**        | Validates CalculiX, Abaqus, and NASTRAN syntax, element topologies, material cards, and constraints. | —                   |
| **`summary`**     | Prints structural summary: element count by kind (C3D4, C3D10, CHEXA), materials, and load steps.    | —                   |
| **`inspect`**     | Dumps parsed boundary sets, node coordinates, material elastic moduli, and load cases.               | —                   |
| **`to-modelica`** | Generates Modelica equivalent structural stiffness models and translational boundary ports.          | `--out=<file.mo>`   |
| **`to-dae`**      | Lowers structural mass and stiffness matrices into ModelScript linear-memory DAE arena.              | `--out=<file.json>` |
| **`solve`**       | Solves linear elastostatic stiffness matrix for nodal displacements and von Mises stress contours.   | —                   |

### Examples

```bash
# Validate element connectivity and material properties in an Abaqus deck
msx fea lint BracketAssembly.inp

# Display mesh statistics, node count, and material properties
msx fea summary ChassisStructure.bdf

# Solve linear static displacement and print max von Mises stress
msx fea solve BracketAssembly.inp
```

---

## Diagnostic Rules

<LintRules lang="fea" />
