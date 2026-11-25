// SPDX-License-Identifier: AGPL-3.0-or-later

import { droneStepContent } from "../assets/drone-step-content.js";
import { STANDARD_CAPABILITIES, type ExampleWorkspaceDescriptor } from "./types.js";

export const CORE_SYSTEMS_TEMPLATES: ExampleWorkspaceDescriptor[] = [
  // 1. ModelScript (.msx)
  {
    id: "modelscript-control",
    languageId: "modelscript",
    title: "Thermal Flight Actuator Kernel",
    summary: "Typed ModelScript struct, physical constants, and closed-loop actuator thermal control law.",
    badge: "MSX",
    tone: "teal",
    ext: ".msx",
    primaryFile: "control_loop.msx",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "control_loop.msx": [
        "struct ActuatorState {",
        "  position: f64;",
        "  velocity: f64;",
        "  temperature: f64;",
        "}",
        "",
        "const MAX_THRUST: f64 = 120.0;",
        "const AMBIENT_TEMP: f64 = 293.15;",
        "const GAIN_KP: f64 = 18.5;",
        "const GAIN_KD: f64 = 4.2;",
        "",
        "function computeCommand(target: f64, pos: f64, vel: f64): f64 {",
        "  let err: f64 = target - pos;",
        "  let cmd: f64 = GAIN_KP * err - GAIN_KD * vel;",
        "  return cmd;",
        "}",
        "",
        "function thermalStep(temp: f64, power: f64, dt: f64): f64 {",
        "  let cooling: f64 = 0.15 * (temp - AMBIENT_TEMP);",
        "  let nextTemp: f64 = temp + dt * (0.08 * power - cooling);",
        "  return nextTemp;",
        "}",
        "",
      ].join("\n"),
      "README.md":
        "# Thermal Flight Actuator Kernel (`.msx`)\n\nVerified native ModelScript workspace with struct declarations, typed constants, and control functions.\n",
    },
  },

  // 2. Modelica (.mo) — 3 Verified Examples
  {
    id: "bouncing-ball",
    languageId: "modelica",
    title: "Hybrid Bouncing Ball Dynamics",
    summary:
      "Classic hybrid continuous/discrete contact model with event detection (`when h <= 0`) and state reinitialization (`reinit`).",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "BouncingBall.mo",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "BouncingBall.mo": [
        'model BouncingBall "Hybrid bouncing ball with restitution coefficient"',
        '  parameter Real e = 0.8 "Coefficient of restitution";',
        '  parameter Real g = 9.81 "Gravitational acceleration [m/s2]";',
        '  Real h(start = 10.0, fixed = true) "Altitude above ground [m]";',
        '  Real v(start = 0.0, fixed = true) "Vertical velocity [m/s]";',
        "equation",
        "  der(h) = v;",
        "  der(v) = -g;",
        "  when h <= 0.0 then",
        "    reinit(v, -e * pre(v));",
        "  end when;",
        "end BouncingBall;",
        "",
      ].join("\n"),
      "README.md":
        "# Hybrid Bouncing Ball (`.mo`)\n\nDemonstrates Modelica hybrid DAE simulation, zero-crossing event detection, and interactive diagram inspection.\n",
    },
  },
  {
    id: "rlc",
    languageId: "modelica",
    title: "RLC Resonant Electrical Circuit",
    summary:
      "Acausal electrical schematic using `Modelica.Electrical.Analog` components with full `Placement` and `Line` diagram annotations.",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "RLC.mo",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "RLC.mo": [
        'model RLC "RLC circuit with MSL components"',
        "  Modelica.Electrical.Analog.Sources.SineVoltage Vb(V = 10, f = 50)",
        "    annotation(Placement(transformation(origin = {-70, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Inductor L(L = 0.5)",
        "    annotation(Placement(transformation(origin = {0, 40}, extent = {{-10, -10}, {10, 10}})));",
        "  Modelica.Electrical.Analog.Basic.Capacitor C(C = 1e-4)",
        "    annotation(Placement(transformation(origin = {20, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Resistor R(R = 100)",
        "    annotation(Placement(transformation(origin = {60, 0}, extent = {{-10, -10}, {10, 10}}, rotation = 270)));",
        "  Modelica.Electrical.Analog.Basic.Ground ground",
        "    annotation(Placement(transformation(origin = {-70, -40}, extent = {{-10, -10}, {10, 10}})));",
        "equation",
        "  connect(Vb.p, L.p)",
        "    annotation(Line(points = {{-70, 10}, {-70, 40}, {-10, 40}}, color = {0, 0, 255}));",
        "  connect(L.n, C.p)",
        "    annotation(Line(points = {{10, 40}, {20, 40}, {20, 10}}, color = {0, 0, 255}));",
        "  connect(L.n, R.p)",
        "    annotation(Line(points = {{10, 40}, {60, 40}, {60, 10}}, color = {0, 0, 255}));",
        "  connect(R.n, Vb.n)",
        "    annotation(Line(points = {{60, -10}, {60, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(C.n, Vb.n)",
        "    annotation(Line(points = {{20, -10}, {20, -30}, {-70, -30}, {-70, -10}}, color = {0, 0, 255}));",
        "  connect(Vb.n, ground.p)",
        "    annotation(Line(points = {{-70, -10}, {-70, -30}}, color = {0, 0, 255}));",
        "end RLC;",
        "",
      ].join("\n"),
      "modelscript.json": JSON.stringify(
        {
          name: "@modelscript/example-rlc",
          version: "1.0.0",
          title: "RLC Circuit",
          description: "RLC circuit with Modelica Standard Library components",
          dependencies: { Modelica: "4.1.0" },
        },
        null,
        2,
      ),
    },
  },
  {
    id: "drone-reachability",
    languageId: "modelica",
    title: "Polyglot Drone Reachability Verification",
    summary:
      "End-to-end cyber-physical workspace coupling Modelica DAE, SysML v2 requirements, OpenSCAD CAD, CalculiX FEA, and SU2 CFD.",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "modelica/DroneSimulation.mo",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "cad/drone.step": droneStepContent,
      "cad/drone.scad": [
        "// Parametric Quadcopter Airframe (OpenSCAD)",
        "// Synchronized with DronePackage.mo and drone_package.sysml",
        "",
        "arm_length = 180.0;",
        "arm_width = 24.0;",
        "arm_thickness = 4.2;",
        "rotor_radius = 65.0;",
        "winglet_chord = 25.0;",
        "hub_radius = 35.0;",
        "hub_height = 28.0;",
        "",
        "// Central Carbon-Fiber Hub with Tagged Mounting Port",
        'tag_port("hub_mount", "fixed")',
        "difference() {",
        "  cylinder(r = hub_radius, h = hub_height, center = true);",
        "  cylinder(r = hub_radius - 3.5, h = hub_height + 2.0, center = true);",
        "}",
        "",
        "// Parametric Rotor Shroud / Duct",
        "module rotor_shroud(r = rotor_radius, chord = winglet_chord) {",
        '  tag_port("rotor_inlet", "inlet")',
        "  difference() {",
        "    cylinder(r = r + 4.0, h = chord, center = true);",
        "    cylinder(r = r, h = chord + 1.0, center = true);",
        "  }",
        "}",
        "",
        "// Single Arm + Motor Mount + Shroud Assembly",
        "module arm_assembly(angle) {",
        "  rotate([0, 0, angle]) {",
        "    translate([0, -arm_width / 2, -arm_thickness / 2])",
        "      cube([arm_length, arm_width, arm_thickness]);",
        "    translate([arm_length, 0, 0]) {",
        "      cylinder(h = arm_thickness * 2.5, r = arm_width * 0.9, center = true);",
        "      rotor_shroud();",
        "    }",
        "  }",
        "}",
        "",
        "// 4-Rotor Quadcopter X-Configuration",
        "arm_assembly(45);",
        "arm_assembly(135);",
        "arm_assembly(225);",
        "arm_assembly(315);",
        "",
      ].join("\n"),
      "cae/drone_chassis.inp": [
        "*HEADING",
        "ModelScript Drone Chassis Carbon-Composite Arm Stress",
        "*NODE, NSET=NALL",
        "1,  0.000,  0.000,  0.000",
        "2,  0.035,  0.000,  0.000",
        "3,  0.180,  0.012,  0.002",
        "4,  0.180, -0.012,  0.002",
        "5,  0.195,  0.000,  0.003",
        "101, -0.035, 0.000, 0.000",
        "102, -0.180, 0.012, 0.002",
        "103, -0.195, 0.000, 0.003",
        "*ELEMENT, TYPE=C3D8R, ELSET=ECHASSIS",
        "1, 1, 2, 3, 4, 101, 102, 103, 5",
        "*MATERIAL, NAME=CARBON_EPOXY",
        "*ELASTIC",
        " 7.000000e+10, 0.330",
        "*DENSITY",
        " 2.700000e+03",
        "*BOUNDARY",
        "1, 1, 6, 0.0",
        "*SOLID SECTION, ELSET=ECHASSIS, MATERIAL=CARBON_EPOXY",
        "*STEP",
        "*STATIC",
        "*CLOAD",
        "5, 3, 8.500",
        "*END STEP",
        "",
      ].join("\n"),
      "cae/drone_aero.cfg": [
        "SOLVER= INC_RANS",
        "KIND_TURB_MODEL= SST",
        "MATH_PROBLEM= DIRECT",
        "RESTART_SOL= NO",
        "INC_DENSITY_MODEL= CONSTANT",
        "INC_DENSITY_INIT= 1.225",
        "INC_VELOCITY_INIT= ( 0.0, 0.0, 10.0 )",
        "INC_TEMPERATURE_INIT= 288.15",
        "VISCOSITY_MODEL= CONSTANT_VISCOSITY",
        "MU_CONSTANT= 1.81e-5",
        "REF_LENGTH= 0.360",
        "REF_AREA= 0.030",
        "ITER= 250",
        "",
      ].join("\n"),
      "sysml/drone_specs.sysml": [
        "package DroneReachabilitySystem {",
        "  import ScalarValues::*;",
        "  port def MechanicalFlange;",
        "  part def AvionicsHub {",
        "    attribute mass : Real = 37.0;",
        "    port hubMount : MechanicalFlange;",
        "  }",
        "  part def QuadArm {",
        "    attribute length : Real = 750.0;",
        "    attribute thickness : Real = 12.0;",
        "    attribute mass : Real = 2.0;",
        "    port baseFlange : MechanicalFlange;",
        "    port motorMount : MechanicalFlange;",
        "  }",
        "  part def DroneAssembly {",
        "    attribute totalMass : Real = 45.0;",
        "    attribute totalFrontalArea : Real = 0.600;",
        "    attribute aeroDragCoeff : Real = 0.80;",
        "    part hub : AvionicsHub;",
        "    part arms : QuadArm[4];",
        "  }",
        "  requirement def FlightCeilingRequirement {",
        "    attribute v_climb : Real;",
        "    attribute v_climb_max : Real = 4.0;",
        "    attribute z_target : Real = 11.0;",
        "    subject drone : DroneAssembly;",
        "    require constraint {",
        "      v_climb <= v_climb_max",
        "    }",
        "  }",
        "}",
        "",
      ].join("\n"),
      "modelica/DroneSimulation.mo": [
        'model DroneSimulation "Drone flight dynamics linked to SysML v2, CAD, FEA, and CFD"',
        '  parameter Real m = 1.2 "Total mass [kg]";',
        '  parameter Real A = 0.60 "Frontal area [m2]";',
        '  parameter Real Cd = 0.80 "Drag coefficient";',
        '  parameter Real rho = 1.225 "Air density [kg/m3]";',
        '  parameter Real z_target = 10.0 "Ceiling altitude setpoint [m]";',
        '  parameter Real kz = 24.0 "Altitude feedback gain [N/m]";',
        '  parameter Real kv = 44.0 "Velocity damping gain [N/(m/s)]";',
        '  Real z(start = 0.0, fixed = true) "Altitude [m]";',
        '  Real v(start = 0.0, fixed = true) "Vertical climb velocity [m/s]";',
        '  input Real w(min = -0.50, max = 0.50, start = 0.0) "Wind gust disturbance [N]";',
        "equation",
        "  der(z) = v;",
        "  der(v) = (kz * (z_target - z) - kv * v - 0.5 * Cd * rho * A * v * abs(v) + w) / m;",
        "end DroneSimulation;",
        "",
      ].join("\n"),
      "modelscript.json": JSON.stringify(
        {
          name: "@modelscript/example-drone-reachability",
          version: "1.0.0",
          title: "Polyglot Drone Reachability Verification",
          workspace: {
            cad: "cad/drone.scad",
            fea: "cae/drone_chassis.inp",
            cfd: "cae/drone_aero.cfg",
            sysml: "sysml/drone_specs.sysml",
            modelica: "modelica/DroneSimulation.mo",
          },
        },
        null,
        2,
      ),
    },
  },
  {
    id: "pelagos-octopus",
    languageId: "modelica",
    title: "Pelagos OC-8 Robotic Octopus (Multi-Body + Fluid Siphon)",
    summary:
      "Coupled acausal multi-body + fluid siphon starter workspace for the 8-arm Pelagos OC-8 subsea octopus (202 segments, 489 wheels, 7-piston axial swashplate pump, 2.68 m/s siphon water-jet, and autonomous Arm 3 magnetic detach/reconnect).",
    badge: "MO",
    tone: "teal",
    ext: ".mo",
    primaryFile: "PelagosOC8Octopus.mo",
    capabilities: [...STANDARD_CAPABILITIES, "3D CAD & VR Rotunda"],
    files: {
      "PelagosOC8Octopus.mo": `// SPDX-License-Identifier: AGPL-3.0-or-later

model PelagosOC8SubseaOctopus "Pelagos OC-8 8-arm subsea robotic octopus — coupled multi-body + 7-piston swashplate fluid siphon starter template"

  // ── Acausal Physical Connectors ──────────────────────────────────────────

  connector FluidPort "Acausal incompressible seawater hydraulic port"
    Real p "Static seawater pressure [Pa]";
    flow Real m_flow "Seawater mass flow rate into component [kg/s]";
  end FluidPort;

  connector RotationalShaft "Acausal 1D rotational drive flange for the 7-piston swashplate shaft"
    Real phi "Shaft rotation angle [rad]";
    flow Real tau "Shaft torque into component [N*m]";
  end RotationalShaft;

  connector SurgeFlange "Acausal 1D multi-body hydrodynamic surge coupling (swim axis)"
    Real s "Forward surge displacement [m]";
    flow Real f "Axial propulsion / reaction force [N]";
  end SurgeFlange;

  connector HeaveFlange "Acausal 1D multi-body hydrodynamic heave coupling (depth axis)"
    Real z "Subsea operating depth below surface [m]";
    flow Real f_z "Vertical ballast / heave force [N]";
  end HeaveFlange;

  connector ArmMountFlange "Acausal multi-body arm-to-mantle roll torque coupling (supports Arm 3 magnetic detach)"
    Real roll "Mantle roll attitude angle [rad]";
    flow Real tau_roll "Net arm-chain roll reaction torque on mantle [N*m]";
  end ArmMountFlange;

  // ── Subsystem Models ─────────────────────────────────────────────────────

  model SeawaterIntake "Ambient hydrostatic seawater intake boundary"
    FluidPort port_out "Suction outlet to 7-piston swashplate pump";
    input Real depthM "Instantaneous vehicle depth [m]";
    parameter Real p_atm = 101325.0 "Sea-level atmospheric pressure [Pa]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
  equation
    port_out.p = p_atm + rhoSea * g * max(0.0, depthM);
  end SeawaterIntake;

  model BrushlessPumpDrive "Servo-regulated brushless swashplate pump motor drive"
    RotationalShaft flange "Mechanical shaft output flange";
    input Real omegaCmd "Target swashplate angular speed [rad/s]";
    parameter Real J_motor = 0.004 "Motor rotor inertia [kg*m2]";
    parameter Real Kp_speed = 0.28 "Proportional shaft speed controller gain [N*m*s/rad]";
    parameter Real tau_max = 18.0 "Peak brushless motor torque limit [N*m]";
    Real omega(start = 47.12, fixed = true) "Motor shaft angular speed [rad/s]";
    Real tau_em "Electromagnetic drive torque [N*m]";
    Real elecPowerW "Electrical drive power [W]";
  equation
    omega = der(flange.phi);
    tau_em = max(-tau_max, min(tau_max, Kp_speed * (omegaCmd - omega)));
    J_motor * der(omega) = tau_em + flange.tau;
    elecPowerW = abs(tau_em * omega);
  end BrushlessPumpDrive;

  model SwashplatePump7Piston "Internal 7-piston axial swashplate seawater pump with core thermal balance"
    FluidPort port_in "Ambient seawater suction port";
    FluidPort port_out "Pressurized discharge manifold to siphon nozzle";
    RotationalShaft shaft "Mechanical drive input from brushless motor";

    parameter Integer nPistons = 7 "Axial piston cylinder count";
    parameter Real swashplateTiltRad = 0.28 "Swashplate tilt angle [rad]";
    parameter Real pitchRadius = 0.042 "Piston pitch-circle radius [m]";
    parameter Real pistonArea = 5.5e-4 "Individual piston bore area [m2]";
    parameter Real etaVol = 0.94 "Volumetric efficiency";
    parameter Real rhoSea = 1025.0 "Seawater density [kg/m3]";
    parameter Real J_barrel = 0.004 "Cylinder barrel inertia [kg*m2]";
    parameter Real b_viscous = 0.0022 "Rotary viscous friction [N*m*s/rad]";
    parameter Real T_seaC = 18.0 "Ambient seawater temperature [degC]";
    parameter Real C_pump = 28.0 "Pump core thermal capacitance [J/K]";
    parameter Real G_hull = 12.0 "Mantle-to-seawater thermal conductance [W/K]";

    Real theta(start = 0.0, fixed = true) "Swashplate barrel rotation angle [rad]";
    Real omega(start = 47.12, fixed = true) "Swashplate angular speed [rad/s]";
    Real tempC(start = 23.0, fixed = true) "7-piston pump core temperature [degC]";
    Real strokeAmp "Single-piston axial stroke amplitude [m]";
    Real piston1Disp "Piston 1 axial stroke displacement [m]";
    Real piston2Disp "Piston 2 axial stroke displacement [m]";
    Real piston3Disp "Piston 3 axial stroke displacement [m]";
    Real piston4Disp "Piston 4 axial stroke displacement [m]";
    Real piston5Disp "Piston 5 axial stroke displacement [m]";
    Real piston6Disp "Piston 6 axial stroke displacement [m]";
    Real piston7Disp "Piston 7 axial stroke displacement [m]";
    Real flowRate "Volumetric seawater discharge rate [m3/s]";
    Real flowLpm "Volumetric seawater discharge rate [L/min]";
    Real deltaP "Discharge pressure rise across pump [Pa]";
    Real hydraulicPowerW "Delivered fluid hydraulic power [W]";
    Real heatLossW "Viscous & motor Joule heat dissipation [W]";
  equation
    shaft.phi = theta;
    der(theta) = omega;

    // 7-piston axial swashplate kinematics (2*pi/7 = 0.8975979 rad spacing)
    strokeAmp = pitchRadius * tan(swashplateTiltRad);
    piston1Disp = strokeAmp * sin(theta + 0.0000000);
    piston2Disp = strokeAmp * sin(theta + 0.8975979);
    piston3Disp = strokeAmp * sin(theta + 1.7951958);
    piston4Disp = strokeAmp * sin(theta + 2.6927937);
    piston5Disp = strokeAmp * sin(theta + 3.5903916);
    piston6Disp = strokeAmp * sin(theta + 4.4879895);
    piston7Disp = strokeAmp * sin(theta + 5.3855874);

    // Positive-displacement mass conservation
    flowRate = max(0.0, etaVol * nPistons * pistonArea * (2.0 * strokeAmp) * (omega / (2.0 * 3.14159265)));
    flowLpm = flowRate * 60000.0;
    port_in.m_flow = rhoSea * flowRate;
    port_in.m_flow + port_out.m_flow = 0.0;

    // Hydraulic load torque & thermal core balance
    deltaP = max(0.0, port_out.p - port_in.p);
    hydraulicPowerW = flowRate * deltaP;
    J_barrel * der(omega) = shaft.tau - b_viscous * omega - hydraulicPowerW / max(1.0, omega);

    heatLossW = 42.0 + 0.35 * hydraulicPowerW + 0.0018 * omega * omega;
    C_pump * der(tempC) = heatLossW - G_hull * (tempC - T_seaC);
  end SwashplatePump7Piston;

  model SiphonJetNozzle "Vectored siphon water-jet thruster nozzle (2.68 m/s peak, 6.0 N burst)"
    FluidPort port_in "Pressurized seawater supply from 7-piston pump";
    SurgeFlange flange_hull "Mechanical reaction thrust transmitted to mantle hull";
    input Real depthM "Vehicle operating depth for ambient back-pressure [m]";

    parameter Real nozzleArea = 8.15e-4 "Convergent siphon nozzle exit area [m2]";
    parameter Real Cd_nozzle = 0.96 "Nozzle discharge coefficient";
    parameter Real p_atm = 101325.0 "Sea-level atmospheric pressure [Pa]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real g = 9.81 "Gravitational acceleration [m/s2]";
    parameter Real maxJetVelocity = 2.68 "Peak rated siphon exit velocity [m/s]";
    parameter Real maxThrust = 6.0 "Peak rated siphon burst thrust [N]";

    Real p_amb "Ambient seawater static pressure at nozzle exit [Pa]";
    Real Q_jet "Nozzle volumetric jet discharge [m3/s]";
    Real jetVelocity "Siphon nozzle exit jet velocity [m/s]";
    Real thrust "Water-jet momentum thrust [N]";
    Real jetLoad "Normalized propulsion load [%]";
    Real jetLoadFrac "Normalized propulsion load fraction [0..1]";
  equation
    p_amb = p_atm + rhoSea * g * max(0.0, depthM);
    Q_jet = max(0.0, port_in.m_flow / rhoSea);
    jetVelocity = min(maxJetVelocity, Q_jet / nozzleArea);

    // Bernoulli convergent nozzle pressure drop
    port_in.p - p_amb = 0.5 * rhoSea * (jetVelocity / Cd_nozzle) * (jetVelocity / Cd_nozzle);

    // Momentum jet reaction force applied acausally to hull surge flange
    thrust = min(maxThrust, port_in.m_flow * jetVelocity);
    flange_hull.f = -thrust;
    jetLoadFrac = thrust / maxThrust;
    jetLoad = 100.0 * jetLoadFrac;
  end SiphonJetNozzle;

  model BallastDepthActuator "Hydrostatic variable-buoyancy ballast trim actuator"
    HeaveFlange flange_heave "Vertical ballast force applied to mantle hull";
    input Real depthTarget "Commanded dive depth setpoint [m]";
    parameter Real k_depth = 38.0 "Ballast depth-hold proportional gain [N/m]";
  equation
    flange_heave.f_z = -k_depth * (depthTarget - flange_heave.z);
  end BallastDepthActuator;

  model MantleRigidBody "Coupled 4-DOF ceramic mantle multi-body hull (surge, heave, pitch, roll)"
    SurgeFlange flange_surge "Siphon water-jet axial propulsion flange";
    HeaveFlange flange_heave "Variable-buoyancy ballast vertical flange";
    ArmMountFlange flange_arms "8-arm multi-body reaction coupling flange";

    parameter Real m_hull = 6.2 "Dry + flooded ceramic mantle structural mass [kg]";
    parameter Real m_added_x = 1.6 "Hydrodynamic surge added mass [kg]";
    parameter Real m_added_z = 8.3 "Hydrodynamic heave added mass [kg]";
    parameter Real CdA_surge = 0.00163 "Streamlined surge drag area (6.0 N at 2.68 m/s) [m2]";
    parameter Real rhoSea = 1025.0 "Ambient seawater density [kg/m3]";
    parameter Real c_heave = 36.0 "Vertical hydrodynamic heave damping [N*s/m]";
    parameter Real I_pitch = 0.42 "Mantle pitch inertia [kg*m2]";
    parameter Real k_pitch = 3.2 "Hydrostatic righting pitch stiffness [N*m/rad]";
    parameter Real d_pitch = 1.8 "Hydrodynamic pitch damping [N*m*s/rad]";
    parameter Real I_roll = 0.36 "Mantle roll inertia [kg*m2]";
    parameter Real k_roll = 2.8 "Hydrostatic righting roll stiffness [N*m/rad]";
    parameter Real d_roll = 1.5 "Hydrodynamic roll damping [N*m*s/rad]";

    Real x(start = 0.0, fixed = true) "Surge travel distance [m]";
    Real vx(start = 0.25, fixed = true) "Forward swim velocity [m/s]";
    Real z(start = 4.0, fixed = true) "Subsea operating depth [m]";
    Real vz(start = 0.0, fixed = true) "Vertical dive/ascent velocity [m/s]";
    Real pitch(start = 0.0, fixed = true) "Pitch attitude angle [rad]";
    Real q_pitch(start = 0.0, fixed = true) "Pitch angular rate [rad/s]";
    Real roll(start = 0.0, fixed = true) "Roll attitude angle [rad]";
    Real p_roll(start = 0.0, fixed = true) "Roll angular rate [rad/s]";
    Real pitchDeg "Pitch attitude angle [deg]";
    Real rollDeg "Roll attitude angle [deg]";
  equation
    flange_surge.s = x;
    flange_heave.z = z;
    flange_arms.roll = roll;

    // Coupled surge propulsion vs quadratic hydrodynamic drag
    der(x) = vx;
    (m_hull + m_added_x) * der(vx) = flange_surge.f - 0.5 * rhoSea * CdA_surge * vx * abs(vx);

    // Coupled heave ballast dynamics
    der(z) = vz;
    (m_hull + m_added_z) * der(vz) = flange_heave.f_z - c_heave * vz;

    // Coupled pitch & roll rigid-body dynamics (with siphon pitch moment & arm roll reaction)
    der(pitch) = q_pitch;
    I_pitch * der(q_pitch) = 0.095 * flange_surge.f - 0.14 * vz - k_pitch * pitch - d_pitch * q_pitch;

    der(roll) = p_roll;
    I_roll * der(p_roll) = flange_arms.tau_roll - k_roll * roll - d_roll * p_roll;

    pitchDeg = pitch * 57.2957795;
    rollDeg = roll * 57.2957795;
  end MantleRigidBody;

  model ArticulatedArmBank "8 independent robotic arm chains (202 links, 489 wheels) with autonomous Arm 3 magnetic detach"
    ArmMountFlange flange_mantle "Mechanical roll reaction flange attached to ceramic mantle";
    input Real jetLoadFrac "Normalized siphon burst load fraction [0..1]";
    input Real arm3DetachCmd "Autonomous Arm 3 collar release command (1=detach, 0=dock)";

    parameter Integer nArms = 8 "Independently articulated robotic arm count";
    parameter Integer nSegments = 202 "Total linked arm segments (2*26 + 6*25)";
    parameter Integer nWheels = 489 "Total traction rollers (404 ventral + 85 dorsal)";
    parameter Real tau_arm = 0.32 "Tendon curl actuation lag [s]";
    parameter Real tau_collar = 0.40 "Magnetic collar separation/docking time constant [s]";
    parameter Real detachSpanM = 0.24 "Free-floating Arm 3 sampling separation distance [m]";

    Real arm1Curl(start = 70.0, fixed = true) "Arm 1 curl actuation [%]";
    Real arm2Curl(start = 84.0, fixed = true) "Arm 2 curl actuation [%]";
    Real arm3Curl(start = 87.0, fixed = true) "Arm 3 curl actuation (autonomous specimen arm) [%]";
    Real arm4Curl(start = 76.0, fixed = true) "Arm 4 curl actuation [%]";
    Real arm5Curl(start = 60.0, fixed = true) "Arm 5 curl actuation [%]";
    Real arm6Curl(start = 52.0, fixed = true) "Arm 6 curl actuation [%]";
    Real arm7Curl(start = 57.0, fixed = true) "Arm 7 curl actuation [%]";
    Real arm8Curl(start = 73.0, fixed = true) "Arm 8 curl actuation [%]";
    Real arm3DetachOffset(start = 0.0, fixed = true) "Arm 3 collar separation distance [m]";
    Real arm3Attached "Arm 3 magnetic collar status (1=docked, 0=detached)";
  equation
    arm3Attached = if arm3DetachCmd > 0.5 then 0.0 else 1.0;
    tau_collar * der(arm3DetachOffset) = arm3DetachCmd * detachSpanM - arm3DetachOffset;

    // 8 independent biomimetic arm curl trajectories with jet-burst hydrodynamic tuck
    tau_arm * der(arm1Curl) = (70.0 + 18.0 * sin(1.35 * time + 0.00) - 28.0 * jetLoadFrac) - arm1Curl;
    tau_arm * der(arm2Curl) = (70.0 + 18.0 * sin(1.35 * time + 0.92) - 28.0 * jetLoadFrac) - arm2Curl;
    tau_arm * der(arm3Curl) = (if arm3Attached < 0.5 then 88.0 + 8.0 * sin(2.40 * time)
                               else 70.0 + 18.0 * sin(1.35 * time + 1.84) - 28.0 * jetLoadFrac) - arm3Curl;
    tau_arm * der(arm4Curl) = (70.0 + 18.0 * sin(1.35 * time + 2.76) - 28.0 * jetLoadFrac) - arm4Curl;
    tau_arm * der(arm5Curl) = (70.0 + 18.0 * sin(1.35 * time + 3.68) - 28.0 * jetLoadFrac) - arm5Curl;
    tau_arm * der(arm6Curl) = (70.0 + 18.0 * sin(1.35 * time + 4.60) - 28.0 * jetLoadFrac) - arm6Curl;
    tau_arm * der(arm7Curl) = (70.0 + 18.0 * sin(1.35 * time + 5.52) - 28.0 * jetLoadFrac) - arm7Curl;
    tau_arm * der(arm8Curl) = (70.0 + 18.0 * sin(1.35 * time + 6.44) - 28.0 * jetLoadFrac) - arm8Curl;

    // Asymmetric roll reaction torque when Arm 3 detaches from the port-side collar
    flange_mantle.tau_roll = -(0.22 * sin(0.95 * time) - 0.34 * (1.0 - arm3Attached));
  end ArticulatedArmBank;

  model MissionAutonomyController "25-second 4-phase subsea mission sequencer (Dive, Arm 3 Detach, Jet Burst, Surface)"
    output Real omegaPumpCmd "Commanded 7-piston swashplate speed [rad/s]";
    output Real depthTarget "Commanded mission operating depth [m]";
    output Real arm3DetachCmd "Arm 3 magnetic collar detach trigger (1=detach, 0=dock)";
    output Real missionPhase "Active phase index (0=DIVE, 1=DETACH, 2=JET, 3=SURFACE)";

    parameter Real detachStartTime = 6.0 "Arm 3 magnetic collar release time [s]";
    parameter Real reconnectTime = 12.8 "Arm 3 inductive dock reconnect time [s]";
    parameter Real burstStartTime = 13.0 "Siphon jet-assist burst start time [s]";
    parameter Real burstEndTime = 20.0 "Siphon jet-assist burst end time [s]";
    parameter Real omegaPumpCruise = 47.12 "Cruise pump speed (450 RPM) [rad/s]";
    parameter Real omegaPumpBurst = 164.0 "Burst pump speed (1566 RPM) [rad/s]";
  equation
    omegaPumpCmd = if (time >= burstStartTime) and (time <= burstEndTime)
                   then omegaPumpBurst * (0.96 + 0.04 * sin(6.0 * time))
                   else (if time > burstEndTime then 24.0 else omegaPumpCruise);

    arm3DetachCmd = if (time >= detachStartTime) and (time <= reconnectTime) then 1.0 else 0.0;

    depthTarget = if time < detachStartTime then 4.0 + 34.0 * (time / detachStartTime)
                  else (if time < burstStartTime then 38.0
                  else (if time < burstEndTime then 38.0 - 14.0 * ((time - burstStartTime) / (burstEndTime - burstStartTime))
                  else 24.0 - 20.0 * ((time - burstEndTime) / 5.0)));

    missionPhase = if time < detachStartTime then 0.0
                   else (if time < burstStartTime then 1.0
                   else (if time < burstEndTime then 2.0 else 3.0));
  end MissionAutonomyController;

  // ── System-Level Mechanical Inventory Parameters ─────────────────────────

  parameter Integer nArms = 8 "Independently articulated robotic arms";
  parameter Integer nSegments = 202 "Total linked arm segments (2*26 + 6*25)";
  parameter Integer nWheels = 489 "Ventral (404) + dorsal (85) traction rollers";
  parameter Integer nPistons = 7 "Internal axial swashplate pump cylinders";
  parameter Real maxJetVelocity = 2.68 "Peak siphon water-jet velocity [m/s]";
  parameter Real maxThrust = 6.0 "Peak siphon burst thrust [N]";

  // ── Connected Multi-Body + Fluid Siphon Subsystem Instances ──────────────

  MissionAutonomyController mission
    annotation(Placement(transformation(extent = {{-96, 36}, {-64, 68}})));

  SeawaterIntake intake
    annotation(Placement(transformation(extent = {{-96, -18}, {-68, 10}})));

  BrushlessPumpDrive motor
    annotation(Placement(transformation(extent = {{-44, 36}, {-16, 64}})));

  SwashplatePump7Piston pump
    annotation(
      Placement(transformation(extent = {{-44, -20}, {-12, 12}})),
      CAD(uri = "procedural://pelagos-oc8/pump-core", position = {0, 0.07, 0}, scale = {0.11, 0.12, 0.11})
    );

  SiphonJetNozzle siphon
    annotation(
      Placement(transformation(extent = {{10, -20}, {42, 12}})),
      CAD(uri = "procedural://pelagos-oc8/siphon", position = {0, 0.015, -0.17}, scale = {0.07, 0.07, 0.14})
    );

  BallastDepthActuator ballast
    annotation(Placement(transformation(extent = {{12, 36}, {42, 64}})));

  MantleRigidBody hull
    annotation(
      Placement(transformation(extent = {{64, 4}, {96, 40}})),
      CAD(uri = "procedural://pelagos-oc8/mantle", position = {0, 0.21, 0}, scale = {0.22, 0.28, 0.22})
    );

  ArticulatedArmBank arms
    annotation(
      Placement(transformation(extent = {{64, -58}, {96, -24}})),
      CAD(uri = "procedural://pelagos-oc8/arm-chains", position = {0.33, -0.02, 0.14}, scale = {0.42, 0.08, 0.42})
    );

  // ── Top-Level Telemetry & 3D Field-Simulator Channels ────────────────────

  Real pumpOmega "7-piston swashplate angular speed [rad/s]";
  Real pumpFlowLpm "7-piston seawater flow rate [L/min]";
  Real pumpTempC "7-piston pump core temperature [degC]";
  Real jetVelocity "Siphon exit jet velocity [m/s]";
  Real siphonThrust "Siphon water-jet thrust [N]";
  Real jetLoad "Normalized siphon propulsion load [%]";
  Real surgeVelocity "Pelagos OC-8 forward swim velocity [m/s]";
  Real depthM "Operating depth below sea surface [m]";
  Real pitchDeg "Mantle pitch attitude [deg]";
  Real rollDeg "Mantle roll attitude [deg]";
  Real arm3Attached "Arm 3 magnetic collar state (1=docked, 0=detached)"
    annotation(CAD(uri = "procedural://pelagos-oc8/arm3-collar", position = {0.18, -0.02, 0.18}, scale = {0.06, 0.06, 0.06}));
  Real arm3DetachOffset "Arm 3 free-floating separation distance [m]";

equation
  // Acausal hydraulic seawater loop: SeawaterIntake -> 7-Piston Pump -> Siphon Jet Nozzle
  connect(intake.port_out, pump.port_in)
    annotation(Line(points = {{-68, -4}, {-44, -4}}, color = {6, 182, 212}));
  connect(pump.port_out, siphon.port_in)
    annotation(Line(points = {{-12, -4}, {10, -4}}, color = {2, 132, 199}));

  // Acausal mechanical shaft & multi-body force/torque couplings
  connect(motor.flange, pump.shaft)
    annotation(Line(points = {{-30, 36}, {-30, 12}}, color = {16, 185, 129}));
  connect(siphon.flange_hull, hull.flange_surge)
    annotation(Line(points = {{42, -4}, {54, -4}, {54, 16}, {64, 16}}, color = {249, 115, 22}));
  connect(ballast.flange_heave, hull.flange_heave)
    annotation(Line(points = {{42, 50}, {54, 50}, {54, 30}, {64, 30}}, color = {16, 185, 129}));
  connect(arms.flange_mantle, hull.flange_arms)
    annotation(Line(points = {{80, -24}, {80, 4}}, color = {168, 85, 247}));

  // Closed-loop mission control & ambient depth coupling
  motor.omegaCmd = mission.omegaPumpCmd;
  ballast.depthTarget = mission.depthTarget;
  arms.arm3DetachCmd = mission.arm3DetachCmd;
  arms.jetLoadFrac = siphon.jetLoadFrac;
  intake.depthM = hull.z;
  siphon.depthM = hull.z;

  // Top-level telemetry aliases matching Pelagos OC-8 Field HUD & VR Rotunda channels
  pumpOmega = pump.omega;
  pumpFlowLpm = pump.flowLpm;
  pumpTempC = pump.tempC;
  jetVelocity = siphon.jetVelocity;
  siphonThrust = siphon.thrust;
  jetLoad = siphon.jetLoad;
  surgeVelocity = hull.vx;
  depthM = hull.z;
  pitchDeg = hull.pitchDeg;
  rollDeg = hull.rollDeg;
  arm3Attached = arms.arm3Attached;
  arm3DetachOffset = arms.arm3DetachOffset;

  annotation(experiment(StartTime = 0, StopTime = 25, Interval = 0.1));
end PelagosOC8SubseaOctopus;
`,
      "modelscript.json": JSON.stringify(
        {
          name: "@modelscript/example-pelagos-octopus",
          version: "1.0.0",
          title: "Pelagos OC-8 Robotic Octopus (Multi-Body + Fluid Siphon)",
          description:
            "Coupled acausal Modelica multi-body + 7-piston swashplate fluid siphon starter template for Pelagos OC-8.",
          workspace: {
            modelica: "PelagosOC8Octopus.mo",
            vrScenario: "subsea-octopus",
          },
        },
        null,
        2,
      ),
      "README.md": [
        "# Pelagos OC-8 Subsea Robotic Octopus (`.mo`)",
        "",
        "Acausal **Modelica multi-body + fluid siphon** starter template modeling the Pelagos OC-8 bio-inspired subsea ROV:",
        "",
        "- **Hydraulic Siphon Loop (`FluidPort`)**: `SeawaterIntake` → `SwashplatePump7Piston` (7 axial pistons, $0.28\\,\\text{rad}$ tilt, $42\\,\\text{mm}$ pitch radius) → `SiphonJetNozzle` ($2.68\\,\\text{m/s}$ exit jet, $6.0\\,\\text{N}$ burst thrust).",
        "- **Mechanical & Multi-Body Couplings (`RotationalShaft`, `SurgeFlange`, `HeaveFlange`, `ArmMountFlange`)**: `BrushlessPumpDrive`, `BallastDepthActuator`, 4-DOF `MantleRigidBody`, and 8-arm `ArticulatedArmBank` (202 links, 489 wheels) with autonomous Arm 3 magnetic detach (`6.0s → 12.8s`).",
        "- **3D & VR Rotunda Twin**: Includes `annotation(CAD(...))` links and `Placement`/`Line` diagram annotations for live schematic, 3D CAD, and VR Engineering Rotunda (`subsea-octopus`) inspection.",
        "",
      ].join("\n"),
    },
  },

  // 3. SysML v2 (.sysml)
  {
    id: "sysml2",
    languageId: "sysml2",
    title: "Hybrid Electric Vehicle Architecture",
    summary:
      "Complete SysML v2 vehicle architecture with port definitions, part decomposition, state machines, and requirement satisfaction.",
    badge: "SYS",
    tone: "indigo",
    ext: ".sysml",
    primaryFile: "VehicleSystem.sysml",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "VehicleSystem.sysml": [
        "package VehicleSystem {",
        "  port def TorquePort {",
        "    attribute torqueValue : Real;",
        "  }",
        "  port def ElectricalPort {",
        "    attribute voltage : Real;",
        "    attribute current : Real;",
        "  }",
        "  port def FuelPort {",
        "    attribute flowRate : Real;",
        "  }",
        "  part def Engine {",
        "    attribute horsePower : Real = 220.0;",
        "    attribute displacement : Real = 2.0;",
        "    port torqueOut : TorquePort;",
        "    port fuelIn : FuelPort;",
        "  }",
        "  part def Transmission {",
        "    attribute gearRatio : Real = 3.42;",
        "    attribute numberOfGears : Integer = 8;",
        "    port torqueIn : TorquePort;",
        "    port torqueOut : TorquePort;",
        "  }",
        "  part def Battery {",
        "    attribute capacity : Real = 75.0;",
        "    attribute voltage : Real = 400.0;",
        "    port electricalOut : ElectricalPort;",
        "  }",
        "  part def FuelTank {",
        "    attribute capacity : Real = 55.0;",
        "    port fuelOut : FuelPort;",
        "  }",
        "  part def Vehicle {",
        "    attribute mass : Real = 1680.0;",
        "    attribute topSpeed : Real = 210.0;",
        "    part engine : Engine;",
        "    part transmission : Transmission;",
        "    part battery : Battery;",
        "    part fuelTank : FuelTank;",
        "    connect engine.torqueOut to transmission.torqueIn;",
        "    connect fuelTank.fuelOut to engine.fuelIn;",
        "  }",
        "}",
        "",
      ].join("\n"),
    },
  },

  // 4. ReqIF (.reqif)
  {
    id: "reqif-avionics",
    languageId: "reqif",
    title: "DO-178C Flight Control Requirements",
    summary:
      "OMG ReqIF 1.2 specification with requirement objects, verification status attributes, and traceability relations.",
    badge: "REQ",
    tone: "sky",
    ext: ".reqif",
    primaryFile: "avionics_safety.reqif",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "avionics_safety.reqif": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">',
        "  <THE-HEADER>",
        '    <REQ-IF-HEADER IDENTIFIER="HDR-FCS-001">',
        "      <CREATION-TIME>2026-10-26T00:00:00Z</CREATION-TIME>",
        "      <REQ-IF-TOOL-ID>ModelScript ReqIF Studio</REQ-IF-TOOL-ID>",
        "      <REQ-IF-VERSION>1.2</REQ-IF-VERSION>",
        "      <SOURCE-TOOL-ID>ModelScript</SOURCE-TOOL-ID>",
        "      <TITLE>Primary Flight Control System Safety Requirements</TITLE>",
        "    </REQ-IF-HEADER>",
        "  </THE-HEADER>",
        "  <CORE-CONTENT>",
        "    <REQ-IF-CONTENT>",
        "      <DATATYPES>",
        '        <DATATYPE-DEFINITION-STRING IDENTIFIER="DT-STR" LONG-NAME="String" MAX-LENGTH="4096"/>',
        "      </DATATYPES>",
        "      <SPEC-TYPES>",
        '        <SPEC-OBJECT-TYPE IDENTIFIER="SOT-REQ" LONG-NAME="SafetyRequirement">',
        "          <SPEC-ATTRIBUTES>",
        '            <ATTRIBUTE-DEFINITION-STRING IDENTIFIER="AD-TEXT" LONG-NAME="ReqIF.Text">',
        "              <TYPE><DATATYPE-DEFINITION-STRING-REF>DT-STR</DATATYPE-DEFINITION-STRING-REF></TYPE>",
        "            </ATTRIBUTE-DEFINITION-STRING>",
        "          </SPEC-ATTRIBUTES>",
        "        </SPEC-OBJECT-TYPE>",
        '        <SPEC-RELATION-TYPE IDENTIFIER="SRT-DERIVES" LONG-NAME="DerivesFrom"/>',
        '        <SPECIFICATION-TYPE IDENTIFIER="ST-DOC" LONG-NAME="RequirementSpecification"/>',
        "      </SPEC-TYPES>",
        "      <SPEC-OBJECTS>",
        '        <SPEC-OBJECT IDENTIFIER="REQ-FCS-101" LONG-NAME="PitchRateDampingLimit">',
        "          <VALUES>",
        '            <ATTRIBUTE-VALUE-STRING THE-VALUE="The flight control system shall maintain pitch rate damping ratio >= 0.65 across the flight envelope.">',
        "              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>",
        "            </ATTRIBUTE-VALUE-STRING>",
        "          </VALUES>",
        "          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQ</SPEC-OBJECT-TYPE-REF></TYPE>",
        "        </SPEC-OBJECT>",
        '        <SPEC-OBJECT IDENTIFIER="REQ-FCS-102" LONG-NAME="ActuatorSlewRateLimit">',
        "          <VALUES>",
        '            <ATTRIBUTE-VALUE-STRING THE-VALUE="The elevator actuator command rate shall not exceed 45.0 deg/s under gust recovery.">',
        "              <DEFINITION><ATTRIBUTE-DEFINITION-STRING-REF>AD-TEXT</ATTRIBUTE-DEFINITION-STRING-REF></DEFINITION>",
        "            </ATTRIBUTE-VALUE-STRING>",
        "          </VALUES>",
        "          <TYPE><SPEC-OBJECT-TYPE-REF>SOT-REQ</SPEC-OBJECT-TYPE-REF></TYPE>",
        "        </SPEC-OBJECT>",
        "      </SPEC-OBJECTS>",
        "      <SPEC-RELATIONS>",
        '        <SPEC-RELATION IDENTIFIER="REL-001" LONG-NAME="ActuatorDerivesFromPitch">',
        "          <SOURCE><SPEC-OBJECT-REF>REQ-FCS-102</SPEC-OBJECT-REF></SOURCE>",
        "          <TARGET><SPEC-OBJECT-REF>REQ-FCS-101</SPEC-OBJECT-REF></TARGET>",
        "          <TYPE><SPEC-RELATION-TYPE-REF>SRT-DERIVES</SPEC-RELATION-TYPE-REF></TYPE>",
        "        </SPEC-RELATION>",
        "      </SPEC-RELATIONS>",
        "      <SPECIFICATIONS>",
        '        <SPECIFICATION IDENTIFIER="SPEC-FCS" LONG-NAME="Flight Control SRS">',
        "          <TYPE><SPECIFICATION-TYPE-REF>ST-DOC</SPECIFICATION-TYPE-REF></TYPE>",
        "          <CHILDREN>",
        '            <SPEC-HIERARCHY IDENTIFIER="SH-101"><OBJECT><SPEC-OBJECT-REF>REQ-FCS-101</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>',
        '            <SPEC-HIERARCHY IDENTIFIER="SH-102"><OBJECT><SPEC-OBJECT-REF>REQ-FCS-102</SPEC-OBJECT-REF></OBJECT></SPEC-HIERARCHY>',
        "          </CHILDREN>",
        "        </SPECIFICATION>",
        "      </SPECIFICATIONS>",
        "    </REQ-IF-CONTENT>",
        "  </CORE-CONTENT>",
        "</REQ-IF>",
        "",
      ].join("\n"),
    },
  },

  // 5. SSP (.ssd)
  {
    id: "ssp-microgrid",
    languageId: "ssp",
    title: "Multi-FMU Grid & Inverter Co-Simulation",
    summary:
      "SSP 1.0 SystemStructureDescription coupling a passive AC transmission network FMU with a solar IBR inverter FMU.",
    badge: "SSP",
    tone: "emerald",
    ext: ".ssd",
    primaryFile: "SystemStructure.ssd",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "SystemStructure.ssd": [
        '<?xml version="1.0" encoding="UTF-8"?>',
        '<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"',
        '                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"',
        '                                name="Microgrid_IBR"',
        '                                version="1.0">',
        '  <ssd:System name="Microgrid_IBR">',
        "    <ssd:Elements>",
        '      <ssd:Component name="GridPassiveNetwork" source="resources/GridNetwork.fmu">',
        "        <ssd:Connectors>",
        '          <ssd:Connector name="B3_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>',
        '          <ssd:Connector name="B3_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>',
        "        </ssd:Connectors>",
        "      </ssd:Component>",
        '      <ssd:Component name="Solar_BESS_IBR_100MVA" source="resources/SolarInverter.fmu">',
        "        <ssd:Connectors>",
        '          <ssd:Connector name="v_poi" kind="input"><ssc:Real unit="kV" /></ssd:Connector>',
        '          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>',
        '          <ssd:Connector name="p_mw" kind="parameter"><ssc:Real value="90" /></ssd:Connector>',
        "        </ssd:Connectors>",
        "      </ssd:Component>",
        "    </ssd:Elements>",
        "    <ssd:Connections>",
        '      <ssd:Connection startElement="GridPassiveNetwork" startConnector="B3_v" endElement="Solar_BESS_IBR_100MVA" endConnector="v_poi" />',
        '      <ssd:Connection startElement="Solar_BESS_IBR_100MVA" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="B3_i" />',
        "    </ssd:Connections>",
        "  </ssd:System>",
        "</ssd:SystemStructureDescription>",
        "",
      ].join("\n"),
    },
  },

  // 6. OWL 2 (.owl)
  {
    id: "owl2-units",
    languageId: "owl2",
    title: "SI Dimensional Ontology & Unit Reasoning",
    summary:
      "W3C OWL 2 Functional-Style ontology encoding disjoint SI physical quantities and automated tableau consistency checking.",
    badge: "OWL",
    tone: "rose",
    ext: ".owl",
    primaryFile: "unit_ontology.owl",
    capabilities: STANDARD_CAPABILITIES,
    files: {
      "unit_ontology.owl": [
        "Prefix(mo: = <http://modelscript.org/modelica#>)",
        "Prefix(unit: = <http://modelscript.org/units#>)",
        "Ontology(<http://modelscript.org/examples/units>",
        "  Declaration(Class(unit:SIUnit))",
        "  Declaration(Class(unit:PressureUnit))",
        "  Declaration(Class(unit:TemperatureUnit))",
        "  Declaration(Class(unit:ForceUnit))",
        "  SubClassOf(unit:PressureUnit unit:SIUnit)",
        "  SubClassOf(unit:TemperatureUnit unit:SIUnit)",
        "  SubClassOf(unit:ForceUnit unit:SIUnit)",
        "  DisjointClasses(unit:PressureUnit unit:TemperatureUnit)",
        "  DisjointClasses(unit:PressureUnit unit:ForceUnit)",
        "  Declaration(NamedIndividual(unit:Pascal))",
        "  Declaration(NamedIndividual(unit:Kelvin))",
        "  Declaration(NamedIndividual(unit:Newton))",
        "  ClassAssertion(unit:PressureUnit unit:Pascal)",
        "  ClassAssertion(unit:TemperatureUnit unit:Kelvin)",
        "  ClassAssertion(unit:ForceUnit unit:Newton)",
        ")",
        "",
      ].join("\n"),
    },
  },
];
