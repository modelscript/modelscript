// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CoordinatorScenario } from "./polyglot_coordinator_factory.js";
import { ThreadDomain } from "./thread_hypergraph.js";

export interface CoordinatorScenarioMutationHelpers {
  updateScadVar: (code: string, varName: string, nextVal: string) => string;
  updateModelicaBindingViaCst: (code: string, paramName: string, nextVal: string) => string;
  updateStepEntityArg: (code: string, entityId: string, argIndex: number, nextVal: string) => string;
}

export function createCoordinatorScenarios(helpers: CoordinatorScenarioMutationHelpers): CoordinatorScenario[] {
  const { updateScadVar, updateModelicaBindingViaCst, updateStepEntityArg } = helpers;
  return [
    // ============================================================================
    // SCENARIO 1: Aerospace Actuator Bracket (SysML v2 + Modelica + OpenSCAD + FEA)
    // ============================================================================
    {
      id: "aerospace-actuator",
      shortTitle: "Aerospace Actuator + FEA",
      title: "Flight Control Actuator & Structural Mounting Bracket",
      domain: "Aerospace & Structural CAE",
      accent: "#38bdf8",
      icon: "shield",
      description:
        'Continuously validate a 4-language flight control actuator digital thread. Variables and B-Rep boundary ports are explicitly linked across each language\'s native FQN hierarchy via SysML v2 `subject` bindings (`ActuatorArchitecture::ClevisBracket`), Modelica `annotation(twin = "...")` attributes, OpenSCAD `tag_port("fixed_root" | "clevis_lug")` CSG geometry, and CalculiX `*INCLUDE`, `*BOUNDARY`, and `*CLOAD` directives.',
      command:
        "msx verify --coordinator ActuatorContract.sysml ElectroMechanicalActuator.mo MountingBracket.scad BracketStress.inp",
      panes: [
        {
          index: 0,
          id: "sysml-contract",
          formatLabel: "SysML v2",
          roleLabel: "Architecture & Safety Contract",
          fileName: "ActuatorContract.sysml",
          namespaceFqn: "SysML2::ActuatorArchitecture",
          fqnSyntaxNote: "package :: PartDef . attribute + subject binding",
          lang: "sysml",
          threadDomain: ThreadDomain.SysML2,
          threadDomainName: "SysML2",
          oracleName: "ConstraintTheoryOracle",
          accent: "#818cf8",
          docLink: "/languages/sysml2",
          defaultCode: `package ActuatorArchitecture {
  part def ClevisBracket {
    attribute mass : Real = 0.88;              // [kg] <- CAD::MountingBracket
    attribute peak_thrust : Real = 44.9;       // [kN] <- Modelica::FlightControl
    attribute von_mises_stress : Real = 216.4; // [MPa] <- FEA::BracketStress
    attribute tip_deflection : Real = 0.29;    // [mm] <- FEA::BracketStress
  }
  requirement def REQ_ACTUATOR_01 {
    subject bracket : ClevisBracket;
    attribute max_mass : Real = 1.25;          // [kg] mass budget
    attribute max_von_mises : Real = 280.0;    // [MPa] Al-7075-T6 limit (SF=1.8)
    attribute max_deflection : Real = 0.45;    // [mm] stiffness envelope
    require constraint {
      bracket.mass <= max_mass and
      bracket.von_mises_stress <= max_von_mises and
      bracket.tip_deflection <= max_deflection
    }
  }
}`,
        },
        {
          index: 1,
          id: "modelica-dynamics",
          formatLabel: "Modelica",
          roleLabel: "1D Multi-Physics Load Dynamics",
          fileName: "ElectroMechanicalActuator.mo",
          namespaceFqn: "Modelica::FlightControl.ElectroMechanicalActuator",
          fqnSyntaxNote: 'within Pkg; Model.var + annotation(twin = "...")',
          lang: "modelica",
          threadDomain: ThreadDomain.Modelica,
          threadDomainName: "Modelica",
          oracleName: "DynamicSimulationOracle",
          accent: "#38bdf8",
          docLink: "/languages/modelica",
          defaultCode: `within FlightControl;
model ElectroMechanicalActuator
  parameter Real stall_torque = 42.0 "Peak motor stall torque (N.m)";
  parameter Real lead_pitch = 0.005 "Ball-screw lead (m/rev)";
  parameter Real efficiency = 0.85 "Screw mechanical efficiency";
  parameter Real bracket_mass = 0.88
    annotation(twin = "SysML2::ActuatorArchitecture::ClevisBracket.mass");
  output Real peak_thrust_kN = 44.9
    annotation(twin = "SysML2::ActuatorArchitecture::ClevisBracket.peak_thrust");
equation
  peak_thrust_kN = (2 * 3.14159 * efficiency * stall_torque) / (lead_pitch * 1000);
end ElectroMechanicalActuator;`,
        },
        {
          index: 2,
          id: "scad-geometry",
          formatLabel: "OpenSCAD CAD",
          roleLabel: "3D Parametric B-Rep Geometry",
          fileName: "MountingBracket.scad",
          namespaceFqn: "CAD::MountingBracket",
          fqnSyntaxNote: 'tag_port("fixed_root" | "clevis_lug") + @twin FQN',
          lang: "scad",
          threadDomain: ThreadDomain.CAD,
          threadDomainName: "CAD",
          oracleName: "SpatialPhysicsOracle",
          accent: "#f59e0b",
          docLink: "/languages/scad",
          defaultCode: `// Module FQN: CAD::MountingBracket
// @twin: computed_mass_kg -> SysML2::ActuatorArchitecture::ClevisBracket.mass
// @port_map: fixed_root -> FEA::BracketStress::NSET(fixed_root)
// @port_map: clevis_lug -> FEA::BracketStress::NSET(clevis_lug)
flange_thickness = 8.5;   // [mm] @bounds: [5.0, 14.0]
web_width = 42.0;         // [mm] clevis web width
lug_span = 110.0;         // [mm] moment arm span
pin_bore_d = 18.0;        // [mm] clevis pin bore diameter
density_kg_m3 = 2810;     // [kg/m^3] Al-7075-T6
computed_mass_kg = (lug_span * web_width * flange_thickness * 8.0e-9) * density_kg_m3;

module ActuatorBracket() {
  union() {
    tag_port("fixed_root", "encastre", [-1, 0, 0])
      cube([18, web_width, flange_thickness * 2.2]);
    difference() {
      tag_port("clevis_lug", "bearing_load", [0, 0, -1])
        translate([18, 0, 0])
          cube([lug_span - 18, web_width, flange_thickness]);
      translate([lug_span - 22, web_width / 2, -1])
        cylinder(h = flange_thickness + 2, d = pin_bore_d);
    }
  }
}
ActuatorBracket();`,
        },
        {
          index: 3,
          id: "fea-stress",
          formatLabel: "CalculiX FEA",
          roleLabel: "3D Structural Stress & Deflection",
          fileName: "BracketStress.inp",
          namespaceFqn: "FEA::BracketStress",
          fqnSyntaxNote: "*INCLUDE MountingBracket.scad + *BOUNDARY/*CLOAD NSET",
          lang: "fea",
          threadDomain: ThreadDomain.FEA,
          threadDomainName: "FEA",
          oracleName: "CaeContractOracle",
          accent: "#ec4899",
          docLink: "/languages/fea",
          defaultCode: `** Deck FQN: FEA::BracketStress (CalculiX C3D4/C3D10 Mesh)
** @mesh_source: MountingBracket.scad (CAD::MountingBracket::ActuatorBracket)
** @port_map: NSET(fixed_root) <- CAD::MountingBracket::port.fixed_root
** @port_map: NSET(clevis_lug) <- CAD::MountingBracket::port.clevis_lug
** @twin: CLOAD(clevis_lug,3) <- Modelica::FlightControl.ElectroMechanicalActuator.peak_thrust_kN
** @twin: ELSET(EBRACKET).S_MISES -> SysML2::ActuatorArchitecture::ClevisBracket.von_mises_stress
** @twin: NSET(clevis_lug).U3 -> SysML2::ActuatorArchitecture::ClevisBracket.tip_deflection
*INCLUDE, INPUT=MountingBracket.scad
*MATERIAL, NAME=AL7075_T6
*ELASTIC
  71700.0, 0.33
*DENSITY
  2810.0
*SOLID SECTION, ELSET=EBRACKET, MATERIAL=AL7075_T6
*STEP, NLGEOM
*STATIC
*BOUNDARY
  fixed_root, 1, 6, 0.0
*CLOAD
  clevis_lug, 3, 44900.0
*EL PRINT, ELSET=EBRACKET
  S_MISES_MAX = 216.4, U3_MAX = 0.29
*END STEP`,
        },
      ],
      presets: [
        {
          id: "nominal",
          label: "Nominal Baseline (All 4 SAT)",
          description: "8.5 mm Al-7075 flange under 42 N·m stall torque satisfies mass, stress, and deflection.",
          isFault: false,
          apply: (defaults) => ({ codes: [...defaults] as [string, string, string, string], editedPaneIndex: 0 }),
        },
        {
          id: "thin-flange",
          label: "Thin CAD Flange (8.5 → 5.2 mm)",
          description:
            "Thinning OpenSCAD flange reduces mass to 0.54 kg but spikes FEA von Mises stress to 441.8 MPa (> 280 MPa).",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[2] = updateScadVar(next[2], "flange_thickness", "5.2");
            return { codes: next, editedPaneIndex: 2 };
          },
        },
        {
          id: "high-torque",
          label: "Boost Motor Torque (42 → 68 N·m)",
          description:
            "Increasing Modelica stall torque raises peak thrust to 72.6 kN, violating FEA stress and deflection limits.",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[1] = updateModelicaBindingViaCst(next[1], "stall_torque", "68.0");
            return { codes: next, editedPaneIndex: 1 };
          },
        },
        {
          id: "steel-material",
          label: "Switch CAD to 316L Steel (7990 kg/m³)",
          description:
            "Switching CAD density from Al-7075 (2810) to Steel (7990) increases bracket mass to 2.51 kg (> 1.25 kg budget).",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[2] = updateScadVar(next[2], "density_kg_m3", "7990");
            return { codes: next, editedPaneIndex: 2 };
          },
        },
      ],
      badges: [
        "SysML v2 :: & subject FQN",
        "Modelica annotation(twin=...)",
        "OpenSCAD tag_port(...) B-Rep",
        "CalculiX *INCLUDE & *CLOAD",
      ],
    },

    // ============================================================================
    // SCENARIO 2: EV Battery Cold-Plate (SysML v2 + Modelica + OpenSCAD + CFD)
    // ============================================================================
    {
      id: "ev-battery-coldplate",
      shortTitle: "EV Battery Thermal + CFD",
      title: "800V Battery Pack Fast-Charge Thermal & Cold-Plate CFD",
      domain: "EV Thermal & Fluid CFD",
      accent: "#10b981",
      icon: "zap",
      description:
        'Coordinate an 800V battery pack fast-charge digital thread across SysML v2 (`BatteryThermal::ColdPlateManifold`), Modelica electro-thermal equations (`Powertrain.BatteryPackLoop`), OpenSCAD micro-channel CSG geometry (`CAD::ColdPlateChannels` with `tag_port("coolant_inlet" | "fluid_core" | "coolant_outlet")`), and OpenFOAM `geometry` + `boundaryField` patches (`CFD::CoolantManifold`).',
      command:
        "msx verify --coordinator ThermalSafety.sysml BatteryPackLoop.mo ColdPlateChannels.scad CoolantManifold.cfd",
      panes: [
        {
          index: 0,
          id: "sysml-thermal",
          formatLabel: "SysML v2",
          roleLabel: "Thermal & Hydraulic Contracts",
          fileName: "ThermalSafety.sysml",
          namespaceFqn: "SysML2::BatteryThermal",
          fqnSyntaxNote: "package :: PartDef . attribute + subject manifold",
          lang: "sysml",
          threadDomain: ThreadDomain.SysML2,
          threadDomainName: "SysML2",
          oracleName: "ConstraintTheoryOracle",
          accent: "#818cf8",
          docLink: "/languages/sysml2",
          defaultCode: `package BatteryThermal {
  part def ColdPlateManifold {
    attribute max_surface_temp : Real = 312.4; // [K] <- CFD::CoolantManifold
    attribute pressure_drop : Real = 11.6;     // [kPa] <- CFD::CoolantManifold
    attribute coolant_flow : Real = 14.0;      // [L/min] <- Modelica::Powertrain
    attribute heat_load : Real = 1433.6;       // [W] <- Modelica::Powertrain
  }
  requirement def REQ_THERMAL_02 {
    subject manifold : ColdPlateManifold;
    attribute max_cell_temp_K : Real = 318.15;      // [K] 45.0 C runaway limit
    attribute max_pressure_drop_kPa : Real = 18.0;  // [kPa] pump head limit
    attribute min_flow_rate_lpm : Real = 8.0;       // [L/min] min glycol flow
    require constraint {
      manifold.max_surface_temp <= max_cell_temp_K and
      manifold.pressure_drop <= max_pressure_drop_kPa and
      manifold.coolant_flow >= min_flow_rate_lpm
    }
  }
}`,
        },
        {
          index: 1,
          id: "modelica-battery",
          formatLabel: "Modelica",
          roleLabel: "1D Electro-Thermal Cell Loop",
          fileName: "BatteryPackLoop.mo",
          namespaceFqn: "Modelica::Powertrain.BatteryPackLoop",
          fqnSyntaxNote: 'within Powertrain; + annotation(twin = "...")',
          lang: "modelica",
          threadDomain: ThreadDomain.Modelica,
          threadDomainName: "Modelica",
          oracleName: "DynamicSimulationOracle",
          accent: "#38bdf8",
          docLink: "/languages/modelica",
          defaultCode: `within Powertrain;
model BatteryPackLoop
  parameter Real pack_current = 320.0 "Fast-charge DC current (A)";
  parameter Real internal_res = 0.014 "Pack DC internal resistance (Ohm)";
  parameter Real coolant_flow_lpm = 14.0
    annotation(twin = "SysML2::BatteryThermal::ColdPlateManifold.coolant_flow");
  output Real heat_rejection_W = 1433.6
    annotation(twin = "SysML2::BatteryThermal::ColdPlateManifold.heat_load");
equation
  heat_rejection_W = pack_current * pack_current * internal_res;
end BatteryPackLoop;`,
        },
        {
          index: 2,
          id: "scad-coldplate",
          formatLabel: "OpenSCAD CAD",
          roleLabel: "Micro-Channel Extrusion CAD",
          fileName: "ColdPlateChannels.scad",
          namespaceFqn: "CAD::ColdPlateChannels",
          fqnSyntaxNote: 'tag_port("coolant_inlet"|"fluid_core"|"coolant_outlet")',
          lang: "scad",
          threadDomain: ThreadDomain.CAD,
          threadDomainName: "CAD",
          oracleName: "SpatialPhysicsOracle",
          accent: "#f59e0b",
          docLink: "/languages/scad",
          defaultCode: `// Module FQN: CAD::ColdPlateChannels
// @twin: hydraulic_dia_mm -> CFD::CoolantManifold::thermoFluidProperties.hydraulicDiameter
// @port_map: coolant_inlet -> CFD::CoolantManifold::boundaryField.coolant_inlet
// @port_map: fluid_core -> CFD::CoolantManifold::boundaryField.fluid_core
// @port_map: coolant_outlet -> CFD::CoolantManifold::boundaryField.coolant_outlet
channel_width_mm = 4.2;    // [mm] @bounds: [2.0, 8.0]
channel_depth_mm = 3.0;    // [mm] milled fin depth
channel_count = 12;        // [#] parallel serpentine passes
hydraulic_dia_mm = (2 * channel_width_mm * channel_depth_mm) / (channel_width_mm + channel_depth_mm);
flow_area_mm2 = channel_count * channel_width_mm * channel_depth_mm;

module SerpentineColdPlate() {
  union() {
    tag_port("coolant_inlet", "inlet", [1, 0, 0])
      cube([14, channel_count * (channel_width_mm + 2.0), channel_depth_mm + 1.5]);
    tag_port("fluid_core", "conjugate_wall", [0, 0, 1])
      for (i = [0 : channel_count - 1])
        translate([14, i * (channel_width_mm + 2.0), 0])
          cube([120, channel_width_mm, channel_depth_mm]);
    tag_port("coolant_outlet", "outlet", [-1, 0, 0])
      translate([134, 0, 0])
        cube([14, channel_count * (channel_width_mm + 2.0), channel_depth_mm + 1.5]);
  }
}
SerpentineColdPlate();`,
        },
        {
          index: 3,
          id: "cfd-manifold",
          formatLabel: "OpenFOAM CFD",
          roleLabel: "3D Conjugate Heat Transfer CFD",
          fileName: "CoolantManifold.cfd",
          namespaceFqn: "CFD::CoolantManifold",
          fqnSyntaxNote: "geometry { ColdPlateChannels.scad } + boundaryField patches",
          lang: "cfd",
          threadDomain: ThreadDomain.CFD,
          threadDomainName: "CFD",
          oracleName: "CaeContractOracle",
          accent: "#10b981",
          docLink: "/languages/cfd",
          defaultCode: `// Deck FQN: CFD::CoolantManifold (chtMultiRegionSimpleFoam)
// @mesh_source: ColdPlateChannels.scad (CAD::ColdPlateChannels::SerpentineColdPlate)
// @port_map: boundaryField.coolant_inlet <- CAD::ColdPlateChannels::port.coolant_inlet
// @port_map: boundaryField.fluid_core <- CAD::ColdPlateChannels::port.fluid_core
// @port_map: boundaryField.coolant_outlet <- CAD::ColdPlateChannels::port.coolant_outlet
// @twin: thermoFluidProperties.inletFlowRate <- Modelica::Powertrain.BatteryPackLoop.coolant_flow_lpm
// @twin: thermoFluidProperties.wallHeatLoad <- Modelica::Powertrain.BatteryPackLoop.heat_rejection_W
// @twin: thermoFluidProperties.hydraulicDiameter <- CAD::ColdPlateChannels::hydraulic_dia_mm
// @twin: solverSummary.maxSurfaceTemp_K -> SysML2::BatteryThermal::ColdPlateManifold.max_surface_temp
// @twin: solverSummary.pressureDrop_kPa -> SysML2::BatteryThermal::ColdPlateManifold.pressure_drop
application     chtMultiRegionSimpleFoam;
geometry {
  ColdPlateChannels.scad {
    type    triSurfaceMesh;
    source  "CAD::ColdPlateChannels::SerpentineColdPlate";
    patches (coolant_inlet fluid_core coolant_outlet);
  }
}
boundaryField {
  coolant_inlet  { type flowRateInletVelocity; volumetricFlowRate 14.0; inletTemp_K 298.15; }
  fluid_core     { type turbulentTemperatureRadCoupledMixed; qWall 1433.6; Dh 3.50; }
  coolant_outlet { type fixedValue; value uniform 0; }
}
thermoFluidProperties {
  inletFlowRate      14.0;     // [L/min]
  wallHeatLoad       1433.6;   // [W]
  hydraulicDiameter  3.50;     // [mm]
  density_kg_m3      1060.0;   // [kg/m3] 50/50 water-glycol
  specificHeat_J_kgK 3450.0;   // [J/(kg.K)]
  viscosity_Pa_s     0.00297;  // [Pa.s]
  conductivity_W_mK  0.42;     // [W/(m.K)]
}
solverSummary {
  pressureDrop_kPa   11.6;     // [kPa] D3Q19 LBM + Darcy channel loss
  maxSurfaceTemp_K   312.4;    // [K] cell bottom plate peak
}`,
        },
      ],
      presets: [
        {
          id: "nominal",
          label: "Nominal 320A Fast-Charge (All 4 SAT)",
          description:
            "4.2 mm channels at 14 L/min keep peak cell temperature at 312.4 K (39.3 °C) and ΔP at 11.6 kPa.",
          isFault: false,
          apply: (defaults) => ({ codes: [...defaults] as [string, string, string, string], editedPaneIndex: 0 }),
        },
        {
          id: "narrow-channels",
          label: "Narrow CAD Channels (4.2 → 1.9 mm)",
          description:
            "Narrowing OpenSCAD micro-channels shrinks hydraulic diameter D_h to 2.33 mm, spiking CFD ΔP to 30.8 kPa (> 18 kPa).",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[2] = updateScadVar(next[2], "channel_width_mm", "1.9");
            return { codes: next, editedPaneIndex: 2 };
          },
        },
        {
          id: "overcurrent-charge",
          label: "Boost Fast-Charge (320 → 460 A)",
          description:
            "Increasing Modelica pack_current to 460 A raises I²R heat load to 2962.4 W, pushing CFD cell temp to 327.6 K (> 318.15 K).",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[1] = updateModelicaBindingViaCst(next[1], "pack_current", "460.0");
            return { codes: next, editedPaneIndex: 1 };
          },
        },
        {
          id: "pump-degradation",
          label: "Drop Coolant Flow (14.0 → 6.5 L/min)",
          description:
            "Reducing Modelica coolant_flow_lpm to 6.5 L/min violates both SysML min_flow_rate_lpm (8.0) and CFD max_cell_temp_K.",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[1] = updateModelicaBindingViaCst(next[1], "coolant_flow_lpm", "6.5");
            return { codes: next, editedPaneIndex: 1 };
          },
        },
      ],
      badges: [
        "SysML v2 :: & subject FQN",
        "Modelica annotation(twin=...)",
        "OpenSCAD tag_port <-> boundaryField",
        "UN ECE R100 Thermal Guard",
      ],
    },

    // ============================================================================
    // SCENARIO 3: Precision Robotics & GD&T (SysML v2 + URDF + Modelica + STEP AP242)
    // ============================================================================
    {
      id: "robotics-gdt-tolerance",
      shortTitle: "Robotics + STEP GD&T",
      title: "Surgical Robot Harmonic Drive & STEP AP242 GD&T Stack",
      domain: "Precision Robotics & Metrology",
      accent: "#f59e0b",
      icon: "bot",
      description:
        "Link surgical robot safety contracts in SysML v2 (`SurgicalRobotics::HarmonicJoint`) with ROS 2 URDF element paths (`URDF::SurgicalArm::upper_arm.inertial.mass`), Modelica RNEA inverse dynamics (`SurgicalControl.HarmonicDriveDynamics`), and ISO 10303-242 STEP `#entity` PMI tolerances (`STEP::BearingFit_AP242::#12`, `#22`, `#30`).",
      command:
        "msx verify --coordinator SurgicalArmSpec.sysml SurgicalArm.urdf HarmonicDriveDynamics.mo BearingFit_AP242.step",
      panes: [
        {
          index: 0,
          id: "sysml-robotics",
          formatLabel: "SysML v2",
          roleLabel: "Clearance & Torque Contracts",
          fileName: "SurgicalArmSpec.sysml",
          namespaceFqn: "SysML2::SurgicalRobotics",
          fqnSyntaxNote: "package :: PartDef . attribute + subject joint",
          lang: "sysml",
          threadDomain: ThreadDomain.SysML2,
          threadDomainName: "SysML2",
          oracleName: "ConstraintTheoryOracle",
          accent: "#818cf8",
          docLink: "/languages/sysml2",
          defaultCode: `package SurgicalRobotics {
  part def HarmonicJoint {
    attribute min_radial_clearance : Real = 0.021; // [mm] <- STEP::#30
    attribute max_radial_clearance : Real = 0.075; // [mm] <- STEP::#30
    attribute peak_torque : Real = 98.5;           // [N.m] <- Modelica
  }
  requirement def REQ_HARMONIC_03 {
    subject joint : HarmonicJoint;
    attribute min_clearance_mm : Real = 0.015;     // [mm] min oil film
    attribute max_clearance_mm : Real = 0.080;     // [mm] max backlash
    attribute max_joint_torque_Nm : Real = 140.0;  // [N.m] drive rating
    require constraint {
      joint.min_radial_clearance >= min_clearance_mm and
      joint.max_radial_clearance <= max_clearance_mm and
      joint.peak_torque <= max_joint_torque_Nm
    }
  }
}`,
        },
        {
          index: 1,
          id: "urdf-kinematics",
          formatLabel: "ROS 2 URDF",
          roleLabel: "Kinematic Tree & Joint Limits",
          fileName: "SurgicalArm.urdf",
          namespaceFqn: "URDF::SurgicalArm",
          fqnSyntaxNote: "robot :: link/joint . element @attribute",
          lang: "xml",
          threadDomain: ThreadDomain.CAD,
          threadDomainName: "CAD",
          oracleName: "SpatialPhysicsOracle",
          accent: "#f59e0b",
          docLink: "/languages/urdf",
          defaultCode: `<!-- Robot FQN: URDF::SurgicalArm -->
<!-- @twin: upper_arm.inertial.mass <-> Modelica::SurgicalControl.HarmonicDriveDynamics.arm_mass -->
<!-- @twin: shoulder_pitch.limit.effort <-> SysML2::SurgicalRobotics::REQ_HARMONIC_03.max_joint_torque_Nm -->
<robot name="SurgicalArm">
  <link name="base_column">
    <inertial><mass value="6.5"/></inertial>
  </link>
  <link name="upper_arm">
    <inertial><mass value="2.8"/></inertial>
  </link>
  <joint name="shoulder_pitch" type="revolute">
    <parent link="base_column"/>
    <child link="upper_arm"/>
    <limit lower="-1.57" upper="1.57" effort="140.0" velocity="2.6"/>
  </joint>
</robot>`,
        },
        {
          index: 2,
          id: "modelica-rnea",
          formatLabel: "Modelica",
          roleLabel: "MultiBody Inverse Dynamics",
          fileName: "HarmonicDriveDynamics.mo",
          namespaceFqn: "Modelica::SurgicalControl.HarmonicDriveDynamics",
          fqnSyntaxNote: 'within SurgicalControl; + annotation(twin = "...")',
          lang: "modelica",
          threadDomain: ThreadDomain.Modelica,
          threadDomainName: "Modelica",
          oracleName: "DynamicSimulationOracle",
          accent: "#38bdf8",
          docLink: "/languages/modelica",
          defaultCode: `within SurgicalControl;
model HarmonicDriveDynamics
  parameter Real arm_mass = 2.8
    annotation(twin = "URDF::SurgicalArm::upper_arm.inertial.mass");
  parameter Real payload_mass = 4.2 "End-effector instrument mass (kg)";
  parameter Real link_reach = 0.65 "Effective moment arm reach (m)";
  parameter Real peak_accel = 8.5 "Emergency stop angular accel (rad/s2)";
  output Real peak_torque_Nm = 98.5
    annotation(twin = "SysML2::SurgicalRobotics::HarmonicJoint.peak_torque");
equation
  peak_torque_Nm = (arm_mass * 0.5 + payload_mass) * 9.81 * link_reach + (arm_mass * 0.33 + payload_mass) * link_reach * link_reach * peak_accel * 3.42;
end HarmonicDriveDynamics;`,
        },
        {
          index: 3,
          id: "step-gdt",
          formatLabel: "STEP AP242 GD&T",
          roleLabel: "Bilateral PMI Tolerance Stack",
          fileName: "BearingFit_AP242.step",
          namespaceFqn: "STEP::BearingFit_AP242",
          fqnSyntaxNote: "ISO 10303-21 #entityId reference graph + @twin",
          lang: "step",
          threadDomain: ThreadDomain.GDT,
          threadDomainName: "GDT",
          oracleName: "ToleranceStackOracle",
          accent: "#a855f7",
          docLink: "/languages/step",
          defaultCode: `/* File FQN: STEP::BearingFit_AP242 (ISO 10303-242 PMI) */
/* @twin: #30.MIN_CLEARANCE -> SysML2::SurgicalRobotics::HarmonicJoint.min_radial_clearance */
/* @twin: #30.MAX_CLEARANCE -> SysML2::SurgicalRobotics::HarmonicJoint.max_radial_clearance */
#10 = PRODUCT_DEFINITION('HOUSING_BORE', 'H7 Inner Race');
#11 = LENGTH_MEASURE_WITH_UNIT(40.048, #100);
#12 = PLUS_MINUS_TOLERANCE(0.015, #11);
#20 = PRODUCT_DEFINITION('SHAFT_JOURNAL', 'g6 Outer Journal');
#21 = LENGTH_MEASURE_WITH_UNIT(40.000, #100);
#22 = PLUS_MINUS_TOLERANCE(0.012, #21);
#30 = EVALUATED_CLEARANCE_ENVELOPE(#12, #22, 0.021, 0.075);`,
        },
      ],
      presets: [
        {
          id: "nominal",
          label: "Nominal H7/g6 Precision Fit (All 4 SAT)",
          description: "Clearance interval [0.021, 0.075] mm and peak torque 98.5 N·m satisfy all 4 domain oracles.",
          isFault: false,
          apply: (defaults) => ({ codes: [...defaults] as [string, string, string, string], editedPaneIndex: 0 }),
        },
        {
          id: "loose-tolerance",
          label: "Loosen STEP Bore Tolerance (±0.015 → ±0.028 mm)",
          description:
            "Widening #12 PLUS_MINUS_TOLERANCE in STEP AP242 expands worst-case clearance to [0.008, 0.088] mm, violating both seizure and backlash limits.",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[3] = updateStepEntityArg(next[3], "#12", 0, "0.028");
            return { codes: next, editedPaneIndex: 3 };
          },
        },
        {
          id: "heavy-payload",
          label: "Overload Instrument Payload (4.2 → 7.6 kg)",
          description:
            "Increasing Modelica payload_mass to 7.6 kg drives RNEA peak torque to 161.9 N·m, exceeding URDF effort (140 N·m).",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[2] = updateModelicaBindingViaCst(next[2], "payload_mass", "7.6");
            return { codes: next, editedPaneIndex: 2 };
          },
        },
        {
          id: "shaft-interference",
          label: "Oversize Shaft Journal #21 (40.000 → 40.028 mm)",
          description:
            "Increasing #21 LENGTH_MEASURE_WITH_UNIT in STEP AP242 shrinks worst-case clearance to -0.007 mm (mechanical interference!).",
          isFault: true,
          apply: (defaults) => {
            const next = [...defaults] as [string, string, string, string];
            next[3] = updateStepEntityArg(next[3], "#21", 0, "40.028");
            return { codes: next, editedPaneIndex: 3 };
          },
        },
      ],
      badges: [
        "STEP #entity Graph (#11→#12→#30)",
        "SysML v2 :: & subject FQN",
        "URDF link/joint XPath FQN",
        "Modelica annotation(twin=...)",
      ],
    },
  ];
}
