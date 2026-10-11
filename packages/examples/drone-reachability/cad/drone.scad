// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Parametric Drone Airframe with Winglets & Aerodynamic Rotor Shrouds
 *
 * OpenSCAD geometric definition linked to:
 *  - CAE / CalculiX FEA: fixed support & motor thrust flanges
 *  - CAE / SU2 CFD: boundary patch tagging for surface drag polar evaluation
 *  - Modelica DAE: frontal area projection A_front = 0.03 m²
 */

// ── Design Parameters ──────────────────────────────────────────────────
arm_length = 180.0;       // Arm span [mm]
arm_width = 24.0;         // Arm lateral beam width [mm]
arm_thickness = 4.2;      // Arm thickness [mm] (evaluated by FEA for sigma <= 180 MPa)
rotor_radius = 65.0;      // Propeller radius [mm]
winglet_chord = 25.0;     // Aerodynamic rotor duct / winglet chord [mm]
hub_radius = 35.0;        // Central electronics hub radius [mm]
hub_height = 28.0;        // Central electronics hub height [mm]

// ── Central Avionics & Battery Hub ─────────────────────────────────────
tag_port("fixed_hub", "fixed_support", [0, 0, 1]) {
  difference() {
    cylinder(r = hub_radius, h = hub_height, center = true);
    // Hollow interior bay for flight controller & LiPo battery pack
    cylinder(r = hub_radius - 3.5, h = hub_height + 2.0, center = true);
  }
}

// ── Aerodynamic Motor Shroud & Winglet Module ──────────────────────────
module rotor_shroud(r = rotor_radius, chord = winglet_chord) {
  difference() {
    cylinder(r = r + 4.0, h = chord, center = true);
    cylinder(r = r, h = chord + 1.0, center = true);
  }
}

// ── Quadcopter Structural Arm & Motor Flange Module ───────────────────
module arm_assembly(angle = 0) {
  rotate([0, 0, angle]) {
    // Structural carbon-fiber beam
    translate([arm_length / 2 + 15, 0, 0])
      cube([arm_length, arm_width, arm_thickness], center = true);

    // Motor mount flange with boundary tagging for FEA thrust load
    translate([arm_length + 15, 0, 0]) {
      tag_port("motor_mount", "mechanical_flange", [0, 0, 1]) {
        difference() {
          cylinder(r = 16.0, h = 6.0, center = true);
          cylinder(r = 4.0, h = 8.0, center = true);
        }
      }

      // Aerodynamic rotor winglet shroud with CFD boundary patch tagging
      tag_port("rotor_stream", "fluid_inlet", [0, 0, -1]) {
        translate([0, 0, 10.0])
          rotor_shroud(rotor_radius, winglet_chord);
      }
    }
  }
}

// ── 4-Rotor Cross Airframe ─────────────────────────────────────────────
tag_port("chassis_wall", "wall", [0, 0, 1]) {
  arm_assembly(45);
  arm_assembly(135);
  arm_assembly(225);
  arm_assembly(315);
}
