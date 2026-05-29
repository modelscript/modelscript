// SPDX-License-Identifier: AGPL-3.0-or-later

export const MODELSCRIPT_GEOMETRY_PACKAGE = `
package Geometry "Built-in parametric solid primitives for procedural CAD"

  shape Box "Axis-aligned box centered at origin"
    parameter Real width = 1 "Full extent along X [mm]";
    parameter Real height = 1 "Full extent along Y [mm]";
    parameter Real depth = 1 "Full extent along Z [mm]";
  end Box;

  shape Cylinder "Circular cylinder with axis along Y"
    parameter Real radius = 0.5 "Cross-section radius [mm]";
    parameter Real height = 1 "Full height along Y [mm]";
  end Cylinder;

  shape Sphere "Sphere centered at origin"
    parameter Real radius = 0.5 "Sphere radius [mm]";
  end Sphere;

  shape Cone "Truncated cone with axis along Y"
    parameter Real radiusBottom = 0.5 "Bottom cross-section radius [mm]";
    parameter Real radiusTop = 0.25 "Top cross-section radius [mm]";
    parameter Real height = 1 "Full height along Y [mm]";
  end Cone;

  shape Torus "Torus centered at origin in the XZ plane"
    parameter Real major = 1 "Ring (major) radius [mm]";
    parameter Real minor = 0.2 "Tube (minor) radius [mm]";
  end Torus;

  shape Prism "Extruded regular polygon along Y"
    parameter Integer sides = 6 "Number of polygon sides";
    parameter Real radius = 0.5 "Circumscribed radius [mm]";
    parameter Real height = 1 "Extrusion height [mm]";
  end Prism;

  record Material "Surface material properties for rendering and simulation"
    parameter String name = "Default" "Material name";
    parameter Real color[3] = {0.8, 0.8, 0.8} "RGB color [0..1]";
    parameter Real density = 1000 "Density [kg/m³]";
    parameter Real youngsModulus = 200e9 "Young's modulus [Pa]";
    parameter Real poissonsRatio = 0.3 "Poisson's ratio";
  end Material;

  // Commonly used materials
  constant Material CarbonFiber = Material(
    name = "CarbonFiber",
    color = {0.15, 0.15, 0.18},
    density = 1600,
    youngsModulus = 230e9,
    poissonsRatio = 0.27
  );

  constant Material Aluminum = Material(
    name = "Aluminum",
    color = {0.7, 0.72, 0.78},
    density = 2700,
    youngsModulus = 70e9,
    poissonsRatio = 0.33
  );

  constant Material ABS = Material(
    name = "ABS",
    color = {0.1, 0.1, 0.12},
    density = 1050,
    youngsModulus = 2.3e9,
    poissonsRatio = 0.35
  );

  constant Material LiPo = Material(
    name = "LiPo",
    color = {0.05, 0.2, 0.6},
    density = 1500,
    youngsModulus = 1e9,
    poissonsRatio = 0.4
  );

end Geometry;
`;
