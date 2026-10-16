# STEP (ISO 10303-21)

`@modelscript/step` (`languages/step`) provides a native WebAssembly GLR parser, assembly hierarchy extractor, AP242 Geometric Dimensioning & Tolerancing (GD&T / PMI) analyzer, and Modelica MultiBody kinematic synthesizer for ISO 10303-21 Clear Text Encoding of the Exchange Structure (`.step`, `.stp`, `.p21`).

---

## Supported Extensions & Standards

| Extension               | Standard                           | Scope                                                                                                                      |
| :---------------------- | :--------------------------------- | :------------------------------------------------------------------------------------------------------------------------- |
| `.step`, `.stp`, `.p21` | ISO 10303-21 (AP203, AP214, AP242) | B-Rep solid geometry, product assembly trees (`NEXT_ASSEMBLY_USAGE_OCCURRENCE`), kinematic joints, and PMI/GD&T tolerances |

---

## Capabilities

1. **Zero-Dependency STEP Part 21 Parser**: Parses `HEADER;` and `DATA;` sections, `#id = ENTITY_NAME(...)` instances, nested typed parameters, and enumeration tokens into linear memory.
2. **Assembly Hierarchy & Mass Properties (`extractStepAssembly`)**: Extracts `PRODUCT_DEFINITION` parts, `NEXT_ASSEMBLY_USAGE_OCCURRENCE` parent–child assembly trees, `AXIS2_PLACEMENT_3D` rigid-body frames, bounding boxes, and mass/inertia properties.
3. **AP242 PMI & GD&T Extraction (`extractStepAssembly`)**: Extracts datum features (`DATUM`, `DATUM_FEATURE`, `DATUM_SYSTEM`) and **10 geometric tolerance categories** (`StepGeometricTolerance` in `languages/step/src/extractor.ts`) for 3D tolerance stack-up analysis (`ToleranceStackOracle`):

| GD&T Tolerance Kind | STEP AP242 Entity Name                                                      |
| :------------------ | :-------------------------------------------------------------------------- |
| `flatness`          | `FLATNESS_TOLERANCE`                                                        |
| `roundness`         | `ROUNDNESS_TOLERANCE` / `CIRCULARITY_TOLERANCE`                             |
| `cylindricity`      | `CYLINDRICITY_TOLERANCE`                                                    |
| `perpendicularity`  | `PERPENDICULARITY_TOLERANCE`                                                |
| `parallelism`       | `PARALLELISM_TOLERANCE`                                                     |
| `position`          | `POSITION_TOLERANCE`                                                        |
| `surface_profile`   | `SURFACE_PROFILE_TOLERANCE`                                                 |
| `concentricity`     | `CONCENTRICITY_TOLERANCE` / `COAXIALITY_TOLERANCE`                          |
| `runout`            | `CIRCULAR_RUNOUT_TOLERANCE` / `TOTAL_RUNOUT_TOLERANCE`                      |
| `general`           | `GEOMETRIC_TOLERANCE` (with `TOLERANCE_VALUE` / `LENGTH_MEASURE_WITH_UNIT`) |

4. **Modelica MultiBody Kinematic Synthesis (`mapStepToMultiBody`)**: `languages/step/src/multibody-mapper.ts` translates STEP kinematic joints and `AXIS2_PLACEMENT_3D` transforms directly into `Modelica.Mechanics.MultiBody` components:
   - **Kinematic Joints**: Maps `REVOLUTE_PAIR` $\rightarrow$ `Modelica.Mechanics.MultiBody.Joints.Revolute`, `PRISMATIC_PAIR` $\rightarrow$ `Joints.Prismatic`, `CYLINDRICAL_PAIR` $\rightarrow$ `Joints.Cylindrical`, `SPHERICAL_PAIR` $\rightarrow$ `Joints.Spherical`, and `PLANAR_PAIR` $\rightarrow$ `Joints.Planar` with axis vectors `n` and `connect(...)` equations.
   - **Static Frame Placements (`MultiBodyFixedTranslation`)**: Computes exact translation vectors `r = {x, y, z}` (converting `MILLI` to meters) and $3 \times 3$ orthonormal orientation matrices from `AXIS2_PLACEMENT_3D` `axis` ($\hat{z}$) and `ref_direction` ($\hat{x}$) vectors to emit `Modelica.Mechanics.MultiBody.Parts.FixedTranslation` and `Parts.BodyBox` / `Parts.BodyCylinder` components.

---

## IDE & CAE Mesh Generation Actions

`stepLanguage.actions` (`languages/step/src/language.ts`) provides 6 built-in CAD/CAE workflows:

| Action ID            | Description                                                                                   |
| :------------------- | :-------------------------------------------------------------------------------------------- |
| `open_cad_viewer`    | Opens the interactive 3D B-Rep & assembly viewer for the `.step` model                        |
| `generate_multibody` | Synthesizes a `Modelica.Mechanics.MultiBody` `.mo` model from STEP assembly frames and joints |
| `generate_fea_mesh`  | Tessellates the STEP B-Rep solid into a 3D tetrahedral CalculiX `.inp` finite element mesh    |
| `generate_cfd_mesh`  | Generates an unstructured `.su2` surface/volume fluid mesh from the STEP geometry             |
| `create_fea_setup`   | Scaffolds a parametric `.inpt` CalculiX structural study linked to the STEP part              |
| `create_cfd_setup`   | Scaffolds a parametric `.cfgt` SU2 aerodynamic study linked to the STEP part                  |

---

## Dedicated `step-mcp` Server Tools

The `@modelscript/step` MCP server (`languages/step/src/mcp/server.ts`) exposes two specialized tools for AI engineering agents:

- **`step_extract_entities`**: Parses a `.step` / `.stp` file and returns the structured assembly tree, `AXIS2_PLACEMENT_3D` coordinate frames, kinematic joints, and AP242 GD&T geometric tolerances.
- **`step_to_multibody`**: Generates complete `Modelica.Mechanics.MultiBody` code (including `World`, `Parts.Body`, `Parts.FixedTranslation`, `Joints.*`, and `connect(...)` equations) from a STEP assembly.

---

## Polyglot TGG Rules

`@modelscript/step` registers 5 bidirectional Triple Graph Grammar (TGG) rules in `languages/step/src/language.ts`:

| Rule Name                               | Source (`step`)                      | Target Language | Target Construct                                                    |
| :-------------------------------------- | :----------------------------------- | :-------------- | :------------------------------------------------------------------ |
| `StepProductToSysML2Part`               | `DataEntity` (`PRODUCT`)             | `sysml2`        | `PartDef`                                                           |
| `StepPropertyToSysML2Attribute`         | `DataEntity` (`PROPERTY_DEFINITION`) | `sysml2`        | `AttributeUsage`                                                    |
| `StepPlacementToSysML2Port`             | `DataEntity` (`AXIS2_PLACEMENT_3D`)  | `sysml2`        | `PortUsage`                                                         |
| `StepRevoluteJointToModelicaRevolute`   | `DataEntity` (`REVOLUTE_PAIR`)       | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Joints.Revolute`)  |
| `StepPrismaticJointToModelicaPrismatic` | `DataEntity` (`PRISMATIC_PAIR`)      | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Joints.Prismatic`) |

---

## CLI Usage

```bash
# Parse and inspect the CST of an ISO 10303-21 STEP file
npx msx parse chassis.step

# Project a STEP assembly into a Modelica MultiBody model via TGG rules
npx msx polyglot project chassis.step --target modelica --out chassis.mo

# Verify cross-domain alignment between STEP CAD geometry and SysML v2 architecture
npx msx align chassis.step architecture.sysml
```
