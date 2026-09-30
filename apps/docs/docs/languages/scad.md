# OpenSCAD Constructive Solid Geometry (CSG)

ModelScript provides programmatic 3D CAD modeling through OpenSCAD language support under `languages/scad/`.

---

## Core Capabilities

- **CSG AST Parsing & Evaluation**: Parses OpenSCAD scripts (`.scad`) and evaluates Constructive Solid Geometry trees into geometric primitives and boolean operations.
- **Boolean Transformations**: Supports 3D `union()`, `difference()`, and `intersection()` operations.
- **Parametric Extraction**: Automatically extracts parametric dimensions, wall thicknesses, and hole diameters for sensitivity analysis and optimization.
- **Direct Export**: Evaluates OpenSCAD models into STEP B-Rep solids, STL triangle meshes, or SVG cross-sections.

---

## Example OpenSCAD Model

```scad
// Parametric mounting bracket
width = 50;
length = 80;
thickness = 6;
hole_radius = 4;

difference() {
  cube([length, width, thickness], center = true);
  translate([length/3, 0, 0])
    cylinder(r = hole_radius, h = thickness + 2, center = true);
  translate([-length/3, 0, 0])
    cylinder(r = hole_radius, h = thickness + 2, center = true);
}
```

---

## Evaluating with `msc`

```bash
# Evaluate OpenSCAD and generate a watertight STEP solid
npx msc csg evaluate bracket.scad --output bracket.step
```
