# OpenSCAD (`.scad`)

`@modelscript/scad` (`languages/scad`) parses parametric OpenSCAD scripts and evaluates Constructive Solid Geometry (CSG) trees via `@modelscript/cad` into exact OpenCascade B-Rep solids, watertight triangle meshes, STEP AP214/AP242 exports, and Modelica MultiBody parameters.

---

## Supported Syntax & Fluent Method Chaining

In addition to standard OpenSCAD primitives (`cube`, `sphere`, `cylinder`, `polyhedron`, `circle`, `square`, `polygon`), boolean operations (`union`, `difference`, `intersection`, `hull`, `minkowski`), extrusions (`linear_extrude`, `rotate_extrude`), and control flow (`module`, `function`, `for`, `if`/`else`), `@modelscript/scad` supports **fluent method chaining** (`ChainedSolid` in `languages/scad/src/evaluator.ts`) and **boundary port tagging**:

```c
wall_thickness = 4.0;
mount_radius = 12.0;

// Fluent method chaining with .fillet(), .chamfer(), .translate(), .rotate()
bracket = cube([60, 40, wall_thickness], center=true)
  .fillet(1.5)
  .translate([0, 0, wall_thickness / 2]);

// Explicit physical port tagging for SysML v2 / Modelica MultiBody & CFD/FEA binding
tag_port("base_mount", "frame", [0, 0, -1])
  difference() {
    bracket;
    cylinder(h=10, r=mount_radius, center=true).chamfer(0.5);
  }
```

### Supported Chained Methods (`ChainedSolid`)

| Method              | Signature                                     | Description                                        |
| :------------------ | :-------------------------------------------- | :------------------------------------------------- |
| `.translate(v)`     | `translate([dx, dy, dz])`                     | Translates the solid by vector `[dx, dy, dz]`      |
| `.rotate(a, v?)`    | `rotate([rx, ry, rz])` or `rotate(deg, axis)` | Rotates the solid by Euler angles or axis-angle    |
| `.scale(v)`         | `scale([sx, sy, sz])`                         | Scales the solid non-uniformly or uniformly        |
| `.mirror(v)`        | `mirror([nx, ny, nz])`                        | Mirrors the solid across the plane with normal `v` |
| `.color(c, alpha?)` | `color("steelblue", 0.9)`                     | Assigns RGBA display metadata                      |
| `.fillet(r)`        | `fillet(radius)`                              | Applies a 3D edge fillet of radius $r > 0$         |
| `.chamfer(d)`       | `chamfer(distance)`                           | Applies a 3D edge chamfer of distance $d > 0$      |

---

## Semantic Linter & Diagnostic Codes

`lintScadCst(sourceText)` (`languages/scad/src/linter.ts`) performs static scope resolution, constant folding, and geometric validity checking across 9 diagnostic rules:

| Code                         | Severity  | Condition Checked                                                                                                                                                 |
| :--------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCAD_DUPLICATE_DECLARATION` | `warning` | Variable, `module`, `function`, or parameter is declared multiple times in the same scope                                                                         |
| `SCAD_INVALID_DIMENSION`     | `error`   | Primitive dimension (`size`, `r`, `r1`, `r2`, `d`, `d1`, `d2`, `h`, `height`), `.fillet(r)`, or `.chamfer(d)` is $\le 0$, or a vector argument has invalid length |
| `SCAD_UNDEFINED_VARIABLE`    | `error`   | Reference to an undeclared variable identifier (excluding `$fn`, `$fa`, `$fs`, `$t`, `$vpr`, `$vpt`, `$vpd`, `$vpf`, `$children`, `$preview`, `PI`, `undef`)      |
| `SCAD_UNDEFINED_FUNCTION`    | `error`   | Call to an undeclared function not in the OpenSCAD built-in math/vector library                                                                                   |
| `SCAD_UNDEFINED_MODULE`      | `error`   | Instantiation of an undeclared module not in the OpenSCAD built-in primitive/transform library                                                                    |
| `SCAD_UNKNOWN_METHOD`        | `error`   | Chained method call outside `{ translate, rotate, scale, mirror, color, fillet, chamfer }`                                                                        |
| `SCAD_DIVISION_BY_ZERO`      | `error`   | Binary `/` or `%` expression where the divisor constant-folds to `0`                                                                                              |
| `SCAD_ARGUMENT_COUNT`        | `error`   | Function or module call provides more positional arguments than parameters or omits a required parameter                                                          |
| `SCAD_UNKNOWN_PARAMETER`     | `warning` | Named argument (`name=val`) does not match any parameter of the target user-defined module or function                                                            |

---

## 3D Viewport Gizmo Writeback (`ScadPatcher`) & STEP Export

- **Surgical AST Writeback (`ScadPatcher` in `languages/scad/src/patcher.ts`)**: When a user drags a 3D translation/rotation/scale gizmo in the CAD viewport, `ScadPatcher` (`patchNode`, `patchVariable`, `patchTransformArgument`, `patchVectorComponent`, `wrapPrimitiveWithTransform`, `patchOrInsertTransform`) updates the exact CST byte spans in the `.scad` source without reformatting surrounding code or comments.
- **STEP AP214/AP242 Export (`compileScadToStep`)**: Evaluates the `.scad` CSG tree and serializes exact B-Rep analytical surfaces (`PLANE`, `CYLINDRICAL_SURFACE`, `SPHERICAL_SURFACE`, `MANIFOLD_SOLID_BREP`) to ISO 10303-21 `.step`.

```bash
# Project a parametric OpenSCAD file to an ISO 10303-21 STEP CAD file
npx msx polyglot project bracket.scad --target step --out bracket.step

# Or extract Embedded CSG from a Modelica model to OpenSCAD
npx msx csg SatelliteChassis satellite.mo > bracket.scad
```

---

## Polyglot TGG Rules

`@modelscript/scad` registers 13 bidirectional Triple Graph Grammar (TGG) rules in `languages/scad/src/language.ts`:

| Rule Name                           | Source (`scad`)                                                 | Target Language | Target Construct                                                                       |
| :---------------------------------- | :-------------------------------------------------------------- | :-------------- | :------------------------------------------------------------------------------------- |
| `ScadModuleToSysmlPart`             | `ModuleDeclaration`                                             | `sysml2`        | `PartDef`                                                                              |
| `ScadProjectedAreaToModelicaParam`  | `ScadScript` (`projectedArea`, `volume`)                        | `modelica`      | `ComponentClause` (`parameter Real`)                                                   |
| `ScadProjectedAreaToSysmlAttribute` | `ScadScript` (`projectedArea`, `volume`)                        | `sysml2`        | `AttributeUsage`                                                                       |
| `ScadTagPortToSysmlPort`            | `ModuleInstantiation` (`tag_port`)                              | `sysml2`        | `PortUsage`                                                                            |
| `ScadVariableToSysmlAttribute`      | `VariableAssignment`                                            | `sysml2`        | `AttributeUsage`                                                                       |
| `ScadSolidToStepProduct`            | `ModuleInstantiation` (`cube`)                                  | `step`          | `DataEntity` (`PRODUCT`)                                                               |
| `ScadCylinderToStepProduct`         | `ModuleInstantiation` (`cylinder`)                              | `step`          | `DataEntity` (`CYLINDRICAL_SURFACE`)                                                   |
| `ScadSphereToStepProduct`           | `ModuleInstantiation` (`sphere`)                                | `step`          | `DataEntity` (`SPHERICAL_SURFACE`)                                                     |
| `ScadBooleanOpToStepComposite`      | `ModuleInstantiation` (`union` / `difference` / `intersection`) | `step`          | `DataEntity` (`BOOLEAN_RESULT`)                                                        |
| `ScadTagPortToModelicaFrame`        | `ModuleInstantiation` (`tag_port`)                              | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Interfaces.Frame_a`)                  |
| `ScadCubeToMultiBodyShape`          | `ModuleInstantiation` (`cube`)                                  | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Visualizers.FixedShape` `"box"`)      |
| `ScadCylinderToMultiBodyShape`      | `ModuleInstantiation` (`cylinder`)                              | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Visualizers.FixedShape` `"cylinder"`) |
| `ScadSphereToMultiBodyShape`        | `ModuleInstantiation` (`sphere`)                                | `modelica`      | `ComponentClause` (`Modelica.Mechanics.MultiBody.Visualizers.FixedShape` `"sphere"`)   |
