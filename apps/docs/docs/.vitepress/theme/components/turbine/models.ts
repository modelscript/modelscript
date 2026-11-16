// SPDX-License-Identifier: AGPL-3.0-or-later

import { extractModelicaTelemetryParams } from "@modelscript/cad/step-provenance";

export type TurbineArtifactId = "modelica" | "scad" | "step" | "qif";

export interface TurbineArtifactSpec {
  id: TurbineArtifactId;
  fileName: string;
  label: string;
  shortTag: string;
  langSlug: string;
  uri: string;
  readOnly?: boolean;
  code: string;
  faultLabel: string;
  injectFault: (code: string) => { code: string; label: string };
}

export interface TurbineLiveParams {
  n1Rpm: number;
  n2Rpm: number;
  t04K: number;
  cutX: number | null;
}

const MODELICA_CODE = `model Turbofan2Spool "2-Spool High-Bypass Turbofan Digital Twin"
  // Live telemetry parameters synchronized with WebGL2 3D assembly
  parameter Real n1_rpm = 3850.0 "LP Fan & LPT spool speed (rpm)";
  parameter Real n2_rpm = 14200.0 "HP Core compressor & HPT spool speed (rpm)";
  parameter Real T_04 = 1650.0 "Combustor turbine inlet temperature (K)";
  parameter Real OPR = 38.4 "Overall pressure ratio";
  parameter Real BPR = 9.2 "Bypass ratio";
  parameter Real cut_x = 0.0 "Section plane axial station (m)";

  // Thermomechanical rotor & tip-clearance states
  Real omega_lp(start = 403.17, fixed = false) "LP angular speed (rad/s)";
  Real omega_hp(start = 1487.02, fixed = false) "HP angular speed (rad/s)";
  Real tip_clearance(start = 0.00042) "Fan blade tip radial clearance (m)";
  Real thrust_kN "Net installed thrust (kN)";
  Real tau_lp "LP turbine drive torque (N*m)";
  Real tau_hp "HP turbine drive torque (N*m)";
equation
  omega_lp = n1_rpm * 0.104719755;
  omega_hp = n2_rpm * 0.104719755;
  tau_lp = 42500.0 * (T_04 / 1650.0);
  tau_hp = 19800.0 * (OPR / 38.4);
  tip_clearance = 0.00042 + 1.5e-7 * (T_04 - 1650.0) - 8.0e-12 * homotopy(n1_rpm^2, 3850.0 * n1_rpm);
  thrust_kN = 112.4 * (n1_rpm / 3850.0)^2 * (1.0 + 0.18 * BPR);
  annotation(experiment(StartTime = 0.0, StopTime = 4.0, Interval = 0.02));
end Turbofan2Spool;
`;

const SCAD_CODE = `// @qif_source: ./TurbofanMBD.qif
// @step_output: ./TurbofanAP242.step
// @modelica_source: ./Turbofan2Spool.mo
// 2-Spool High-Bypass Turbofan CSG Assembly (axes in meters, coaxial on +X)
// Single geometry + kinematic + symbolic datum source of truth → compiles to TurbofanAP242.step
// @spool(part = "spinner_nose", spool = "n1", axis = [1, 0, 0])
// @spool(part = "fan_lp_stage", spool = "n1", axis = [1, 0, 0])
// @spool(part = "hpc_core_drum", spool = "n2", axis = [1, 0, 0])
// @spool(part = "lpt_nozzle_stage", spool = "n1", axis = [1, 0, 0])

$fn = 20;
fan_r_tip = 1.48;
fan_r_hub = 0.40;
n1_rpm = 3850;
n2_rpm = 14200;

module coax_ring(x0, len, r_out, r_in) {
  translate([x0 + len / 2, 0, 0])
    rotate([0, 90, 0])
      rotate_extrude(angle = 360, $fn = 16)
        translate([r_in, 0, 0])
          scale([r_out - r_in, len, 1])
            polygon(points = [[0, -0.5], [1, -0.5], [1, 0.5], [0, 0.5]]);
}

function blade_pt(x_ax, r, c, ang, ux, uy) = [
  x_ax + (ux * c * cos(ang) - uy * c * sin(ang)),
  r,
  ux * c * sin(ang) + uy * c * cos(ang)
];

function blade_ring(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip, u) = [
  blade_pt(x_ax, hub_r + u * span, chord_hub + (chord_tip - chord_hub) * u, stagger_hub + (stagger_tip - stagger_hub) * u, -0.50,  0.000),
  blade_pt(x_ax, hub_r + u * span, chord_hub + (chord_tip - chord_hub) * u, stagger_hub + (stagger_tip - stagger_hub) * u, -0.18,  0.055),
  blade_pt(x_ax, hub_r + u * span, chord_hub + (chord_tip - chord_hub) * u, stagger_hub + (stagger_tip - stagger_hub) * u,  0.18,  0.062),
  blade_pt(x_ax, hub_r + u * span, chord_hub + (chord_tip - chord_hub) * u, stagger_hub + (stagger_tip - stagger_hub) * u,  0.50,  0.000),
  blade_pt(x_ax, hub_r + u * span, chord_hub + (chord_tip - chord_hub) * u, stagger_hub + (stagger_tip - stagger_hub) * u,  0.18, -0.024),
  blade_pt(x_ax, hub_r + u * span, chord_hub + (chord_tip - chord_hub) * u, stagger_hub + (stagger_tip - stagger_hub) * u, -0.18, -0.020)
];

module cambered_blade(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip) {
  // 4-span x 6-point lofted cambered airfoil with independent hub-to-tip chord and stagger
  pts = concat(
    blade_ring(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip, 0.00),
    blade_ring(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip, 0.25),
    blade_ring(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip, 0.50),
    blade_ring(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip, 0.75),
    blade_ring(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip, 1.00)
  );
  faces = [
    [0, 6, 7, 1], [1, 7, 8, 2], [2, 8, 9, 3], [3, 9, 10, 4], [4, 10, 11, 5], [5, 11, 6, 0],
    [6, 12, 13, 7], [7, 13, 14, 8], [8, 14, 15, 9], [9, 15, 16, 10], [10, 16, 17, 11], [11, 17, 12, 6],
    [12, 18, 19, 13], [13, 19, 20, 14], [14, 20, 21, 15], [15, 21, 22, 16], [16, 22, 23, 17], [17, 23, 18, 12],
    [18, 24, 25, 19], [19, 25, 26, 20], [20, 26, 27, 21], [21, 27, 28, 22], [22, 28, 29, 23], [23, 29, 24, 18],
    [5, 4, 3, 2, 1, 0],
    [24, 25, 26, 27, 28, 29]
  ];
  polyhedron(points = pts, faces = faces);
}

module core_blade(x_ax, hub_r, span, chord_hub, taper, stagger_deg, twist_deg) {
  translate([x_ax, hub_r, 0])
    rotate([-90, 0, 0])
      linear_extrude(height = span, twist = twist_deg, scale = taper)
        scale([chord_hub, chord_hub, 1])
          rotate([0, 0, -stagger_deg])
            polygon(points = [
              [-0.50, 0.00],
              [0.00, -0.020],
              [0.50, 0.00],
              [0.00, 0.120]
            ]);
}

module blade_stage(x_ax, count, hub_r, tip_r, chord_hub, chord_tip, stagger_hub, stagger_tip) {
  span = tip_r - hub_r;
  step_deg = 360 / count;
  for (i = [0 : count - 1]) {
    rotate([i * step_deg, 0, 0])
      cambered_blade(x_ax, hub_r, span, chord_hub, chord_tip, stagger_hub, stagger_tip);
  }
}

module core_stage(x_ax, count, hub_r, tip_r, chord_hub, taper, stagger_deg, twist_deg) {
  span = tip_r - hub_r;
  step_deg = 360 / count;
  for (i = [0 : count - 1]) {
    rotate([i * step_deg, 0, 0])
      core_blade(x_ax, hub_r, span, chord_hub, taper, stagger_deg, twist_deg);
  }
}

module intake_nacelle() {
  rotate([0, 90, 0])
    rotate_extrude(angle = 360, $fn = 32)
      polygon(points = [
        [1.450, -2.960], [1.500, -2.925], [1.560, -2.820], [1.602, -2.580],
        [1.610, -2.050], [1.595, -1.200], [1.540, -0.250], [1.475, 0.250],
        [1.410, 0.550],  [1.385, 0.550],  [1.375, 0.160],  [1.388, -1.000],
        [1.390, -2.400], [1.382, -2.780], [1.412, -2.920]
      ]);

  tag_port("FanTipAcousticLiner", "aerodynamic_surface", [0, 0.98, 0.135])
    coax_ring(-2.06, 0.28, fan_r_tip + 0.03, fan_r_tip + 0.005);
  tag_port("FanFrame_MountFace", "mechanical_flange", [0, 1, 0])
    coax_ring(-1.35, 0.40, 0.44, 0.26);
  tag_port("ClockingKeyway", "alignment_key", [0, -1, 0])
    translate([-1.15, -0.42, 0.24])
      cube([0.16, 0.08, 0.08], center = true);

  // Bypass outlet guide vanes (OGV - 32 static vanes)
  blade_stage(-0.95, 32, 0.76, 1.39, 0.20, 0.22, -8, -6);
}

module core_cowl() {
  rotate([0, 90, 0])
    rotate_extrude(angle = 360, $fn = 28)
      polygon(points = [
        [0.615, -1.40], [0.725, -1.10], [0.815, -0.50], [0.860, 0.45],
        [0.830, 1.45],  [0.755, 2.12],  [0.690, 2.60],  [0.675, 2.60],
        [0.665, 2.12],  [0.570, 1.42],  [0.565, 1.08],  [0.600, 0.42],
        [0.495, 0.36],  [0.575, -0.60], [0.605, -1.28]
      ]);

  tag_port("HPC_Stage1_7_Shroud", "cylindrical_shroud", [0, 0.96, -0.24])
    coax_ring(-0.62, 0.08, 0.605, 0.54);
  tag_port("LPT_Stage1_MountFace", "mounting_plane", [0.35, 0.94, 0])
    coax_ring(1.45, 0.95, 0.64, 0.52);

  // LPC (2 stages: 48 stator), HPC (7 stages: 56 stator), HPT (2 stages: 36 nozzle), LPT (4 stages: 60 nozzle)
  for (s = [0 : 1]) {
    core_stage(-1.05 + s * 0.28, 48, 0.41, 0.60, 0.09, 0.89, -28, -4);
  }
  for (s = [0 : 6]) {
    core_stage(-0.42 + s * 0.12, 56, 0.35 + s * 0.005, 0.565 - s * 0.008, 0.052, 0.90, -30, -4);
  }
  for (s = [0 : 1]) {
    core_stage(1.13 + s * 0.16, 36, 0.38, 0.565, 0.060, 1.00, 48, 2);
  }
  for (s = [0 : 3]) {
    core_stage(1.55 + s * 0.15, 60, 0.38, 0.58 + s * 0.025, 0.070, 1.00, 42, 4);
  }
}

module spinner_nose() {
  rotate([0, 90, 0])
    rotate_extrude(angle = 360, $fn = 24)
      polygon(points = [
        [0.000, -2.620], [0.105, -2.565], [0.210, -2.460], [0.310, -2.280],
        [0.378, -2.070], [0.414, -1.860], [0.425, -1.600], [0.000, -1.600]
      ]);
}

module fan_lp_stage() {
  coax_ring(-2.12, 0.40, fan_r_hub, 0.12);
  // 22 Wide-Chord Lofted Cambered & Twisted Ti-6Al-4V Fan Blades
  blade_stage(-1.92, 22, fan_r_hub - 0.005, fan_r_tip - 0.115, 0.36, 0.50, 18, 64);
  // 2-Stage LP Booster Rotors on N1 (40 blades/stage)
  for (s = [0 : 1]) {
    core_stage(-1.18 + s * 0.28, 40, fan_r_hub, 0.60, 0.11, 0.82, 38, -14);
  }
}

module hpc_core_drum() {
  tag_port("MainShaft_Centerline", "datum_axis", [0, 0, 0])
    coax_ring(-1.90, 3.64, 0.11, 0.04);

  rotate([0, 90, 0])
    rotate_extrude(angle = 360, $fn = 24)
      polygon(points = [
        [0.000, -1.60], [0.415, -1.60], [0.405, -1.25], [0.400, -0.75],
        [0.325, -0.55], [0.400, 0.36],  [0.380, 0.44],  [0.380, 1.06],
        [0.400, 1.12],  [0.395, 1.50],  [0.375, 2.15],  [0.300, 2.65],
        [0.145, 3.04],  [0.045, 3.18],  [0.000, 3.20]
      ]);

  // 7-Stage High-Pressure Compressor Rotors on N2 (44 blades/stage)
  for (s = [0 : 6]) {
    core_stage(-0.48 + s * 0.12, 44, 0.34 + s * 0.005, 0.56 - s * 0.008, 0.055, 0.83, 40, -14);
  }

  // 2-Stage High-Pressure Turbine Rotors on N2 (48 blades/stage)
  for (s = [0 : 1]) {
    core_stage(1.20 + s * 0.16, 48, 0.38, 0.56 + s * 0.01, 0.055, 0.91, -50, 8);
  }
}

module combustor_liner() {
  tag_port("Combustor_AnnularLiner", "thermal_liner", [0, 1, 0])
    rotate([0, 90, 0])
      rotate_extrude(angle = 360, $fn = 24)
        polygon(points = [
          [0.470, 0.46], [0.430, 0.54], [0.415, 0.94], [0.450, 1.04],
          [0.540, 1.04], [0.575, 0.94], [0.575, 0.54], [0.530, 0.46]
        ]);
}

module lpt_nozzle_stage() {
  // 4-Stage Low-Pressure Turbine Rotors on N1 (52 blades/stage)
  for (s = [0 : 3]) {
    core_stage(1.62 + s * 0.15, 52, 0.375, 0.58 + s * 0.025, 0.075, 0.93, -46, 10);
  }
}

intake_nacelle();
core_cowl();
spinner_nose();
fan_lp_stage();
hpc_core_drum();
combustor_liner();
lpt_nozzle_stage();
`;

const STEP_CODE = `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ModelScript Compiled AP242 Turbofan Assembly with Symbolic MBD PMI'),'2;1');
FILE_NAME('TurbofanAP242.step','2026-11-15T12:00:00Z',('AeroPropulsion Team'),('ModelScript Systems'),'ModelScript CAD','AP242 Kernel','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#10=APPLICATION_CONTEXT('managed model based 3d engineering');
#11=PRODUCT_CONTEXT('',#10,'mechanical');
#12=PRODUCT('TF2S-001','Turbofan2Spool','Compiled from TurbofanCSG.scad + TurbofanMBD.qif',(#11));
#13=PRODUCT_DEFINITION_FORMATION('A','',#12);
#14=PRODUCT_DEFINITION_CONTEXT('part definition',#10,'design');
#15=PRODUCT_DEFINITION('def_1','',#13,#14);
#16=PRODUCT_DEFINITION_SHAPE('','',#15);
#20=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT($,.METRE.));
#21=(NAMED_UNIT(*)PLANE_ANGLE_UNIT()SI_UNIT($,.RADIAN.));
#22=(NAMED_UNIT(*)SI_UNIT($,.STERADIAN.)SOLID_ANGLE_UNIT());
#23=UNCERTAINTY_MEASURE_WITH_UNIT(LENGTH_MEASURE(1.E-06),#20,'tol','global precision');
#24=(GEOMETRIC_REPRESENTATION_CONTEXT(3)GLOBAL_UNCERTAINTY_ASSIGNED_CONTEXT((#23))GLOBAL_UNIT_ASSIGNED_CONTEXT((#20,#21,#22))REPRESENTATION_CONTEXT('3D',''));
#25=(LENGTH_UNIT()NAMED_UNIT(*)SI_UNIT(.MILLI.,.METRE.));
#30=CARTESIAN_POINT('Origin',(0.0,0.0,0.0));
#31=DIRECTION('AxisZ',(0.0,0.0,1.0));
#32=DIRECTION('RefX',(1.0,0.0,0.0));
#33=AXIS2_PLACEMENT_3D('MainAxis',#30,#31,#32);
#61=DIRECTION('PX',(1.0,0.0,0.0));
#63=DIRECTION('PY',(0.0,1.0,0.0));
#70=CARTESIAN_POINT('FanFrame_MountFace',(-1.15,0.44,0.0));
#71=CARTESIAN_POINT('MainShaft_Centerline',(-0.08,0.0,0.0));
#72=CARTESIAN_POINT('ClockingKeyway',(-1.15,-0.46,0.24));
#73=CARTESIAN_POINT('FanTipAcousticLiner',(-1.92,1.50,0.20));
#74=CARTESIAN_POINT('HPC_Stage1_7_Shroud',(-0.58,0.59,-0.15));
#75=CARTESIAN_POINT('Combustor_AnnularLiner',(0.79,0.60,0.0));
#76=CARTESIAN_POINT('LPT_Stage1_MountFace',(1.96,0.62,0.0));
#80=AXIS2_PLACEMENT_3D('FanFrame_MountFace',#70,#61,#63);
#81=AXIS2_PLACEMENT_3D('MainShaft_Centerline',#71,#61,#63);
#82=AXIS2_PLACEMENT_3D('ClockingKeyway',#72,#61,#63);
#83=AXIS2_PLACEMENT_3D('FanTipAcousticLiner',#73,#61,#63);
#84=AXIS2_PLACEMENT_3D('HPC_Stage1_7_Shroud',#74,#61,#63);
#85=AXIS2_PLACEMENT_3D('Combustor_AnnularLiner',#75,#61,#63);
#86=AXIS2_PLACEMENT_3D('LPT_Stage1_MountFace',#76,#61,#63);
#90=DATUM_FEATURE('A',#80);
#91=DATUM_FEATURE('B',#81);
#92=DATUM_FEATURE('C',#82);
#95=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.035),#25);
#96=TOTAL_RUNOUT_TOLERANCE('C_FAN_RUNOUT','Fan Tip Shroud Runout',#95,#16,(#91,#90,#83));
#97=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.025),#25);
#98=POSITION_TOLERANCE('C_SHAFT_POS','HP/LP Journal Coaxiality',#97,#16,(#90,#91,#92,#81));
#99=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.018),#25);
#100=CYLINDRICITY_TOLERANCE('C_HPC_CYL','HPC Shroud Cylindricity',#99,#16,#84);
#101=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.08),#25);
#102=SURFACE_PROFILE_TOLERANCE('C_COMB_PROF','Combustor Thermal Liner',#101,#16,(#90,#91,#85));
#103=LENGTH_MEASURE_WITH_UNIT(LENGTH_MEASURE(0.015),#25);
#104=PERPENDICULARITY_TOLERANCE('C_LPT_PERP','LPT Hub Squareness',#103,#16,(#91,#90,#86));
#110=SHAPE_DEFINITION_REPRESENTATION(#16,#33);
ENDSEC;
END-ISO-10303-21;
`;

const QIF_CODE = `// @scad_source: ./TurbofanCSG.scad
// @step_output: ./TurbofanAP242.step
// @modelica_source: ./Turbofan2Spool.mo
// ISO 23952 QIF 3.0 Model-Based Definition & Inspection Plan — Turbofan2Spool
// Bound by symbolic feature names matching tag_port(...) in TurbofanCSG.scad
QIF 3.0.0 qpId="a4e91c10-6b44-4d8a-9c21-100000000001"
RULE minTur=4.0 Cylinder=6 Plane=4 Circle=4
DEVICE CMM_LASER CMM "LaserTracker+CMM" uncertainty=0.0015

// Primary Datum Features bound symbolically to TurbofanCSG.scad tag_port anchors
FEATURE F_DATUM_A Plane "FanFrame_MountFace" points=6
FEATURE F_DATUM_B Cylinder "MainShaft_Centerline" size=0.24 points=8
FEATURE F_DATUM_C Circle "ClockingKeyway" size=0.04 points=4

DATUM A id=D1 feature=F_DATUM_A
DATUM B id=D2 feature=F_DATUM_B
DATUM C id=D3 feature=F_DATUM_C

// Controlled Turbofan Features & ASME Y14.5 Tolerances
FEATURE F_FAN_SHROUD Cylinder "FanTipAcousticLiner" size=2.96 points=12
FEATURE F_HPC_DRUM Cylinder "HPC_Stage1_7_Shroud" size=1.12 points=10
FEATURE F_COMB_LINER Cylinder "Combustor_AnnularLiner" size=1.15 points=8
FEATURE F_LPT_HUB Plane "LPT_Stage1_MountFace" points=6

CHARACTERISTIC C_FAN_RUNOUT TotalRunout "Fan Tip Shroud Runout" zone=0.035 material=RFS datums=[B, A] features=[F_FAN_SHROUD] device=CMM_LASER
CHARACTERISTIC C_SHAFT_POS Position "HP/LP Journal Coaxiality" zone=0.025 material=MMC datums=[A, B, C] features=[F_DATUM_B] device=CMM_LASER
CHARACTERISTIC C_HPC_CYL Cylindricity "HPC Shroud Cylindricity" zone=0.018 material=RFS features=[F_HPC_DRUM] device=CMM_LASER
CHARACTERISTIC C_COMB_PROF ProfileOfSurface "Combustor Thermal Liner" zone=0.080 material=RFS datums=[A, B] features=[F_COMB_LINER] device=CMM_LASER
CHARACTERISTIC C_LPT_PERP Perpendicularity "LPT Hub Squareness" zone=0.015 material=RFS datums=[B, A] features=[F_LPT_HUB] device=CMM_LASER

STEP S1 step=1 feature=F_FAN_SHROUD characteristic=C_FAN_RUNOUT device=CMM_LASER points=12
STEP S2 step=2 feature=F_DATUM_B characteristic=C_SHAFT_POS device=CMM_LASER points=8
STEP S3 step=3 feature=F_LPT_HUB characteristic=C_LPT_PERP device=CMM_LASER points=6

ACTUAL ACT1 characteristic=C_FAN_RUNOUT serial="TF2S-001" value=0.019 status=PASS
ACTUAL ACT2 characteristic=C_SHAFT_POS serial="TF2S-001" value=0.012 status=PASS
ACTUAL ACT3 characteristic=C_HPC_CYL serial="TF2S-001" value=0.011 status=PASS
ACTUAL ACT4 characteristic=C_COMB_PROF serial="TF2S-001" value=0.068 status=PASS
ACTUAL ACT5 characteristic=C_LPT_PERP serial="TF2S-001" value=0.008 status=PASS
`;

export const TURBINE_ARTIFACTS: readonly TurbineArtifactSpec[] = [
  {
    id: "modelica",
    fileName: "Turbofan2Spool.mo",
    label: "Turbofan2Spool.mo",
    shortTag: "Modelica",
    langSlug: "modelica",
    uri: "file:///sandbox/Turbofan2Spool.mo",
    code: MODELICA_CODE,
    faultLabel: "Inject undeclared clearance variable (M2002)",
    injectFault: (code: string) => ({
      label: "Injected undeclared variable 'unknown_clearance_margin' (M2002)",
      code: code.includes("unknown_clearance_margin")
        ? code
        : code.replace("equation\n", "equation\n  unknown_clearance_margin = tip_clearance - 0.0001;\n"),
    }),
  },
  {
    id: "scad",
    fileName: "TurbofanCSG.scad",
    label: "TurbofanCSG.scad",
    shortTag: "OpenSCAD",
    langSlug: "scad",
    uri: "file:///sandbox/TurbofanCSG.scad",
    code: SCAD_CODE,
    faultLabel: "Inject zero-radius shroud fault (K1004)",
    injectFault: (code: string) => ({
      label: "Injected zero-radius cylinder fault in TurbofanCSG.scad (SCAD_INVALID_DIMENSION)",
      code: code.includes("broken_shroud_ring")
        ? code
        : `${code.trimEnd()}\nmodule broken_shroud_ring() { cylinder(h = 0.2, r = 0, center = true); }\nbroken_shroud_ring();\n`,
    }),
  },
  {
    id: "qif",
    fileName: "TurbofanMBD.qif",
    label: "TurbofanMBD.qif",
    shortTag: "QIF 3.0 GD&T",
    langSlug: "qif",
    uri: "file:///sandbox/TurbofanMBD.qif",
    code: QIF_CODE,
    faultLabel: "Inject illegal MMC modifier on Plane (M8104)",
    injectFault: (code: string) => ({
      label: "Injected prohibited MMC modifier on non-size Plane feature (M8104)",
      code: code.includes("C_FAULT_PERP")
        ? code
        : `${code.trimEnd()}\nCHARACTERISTIC C_FAULT_PERP Perpendicularity "LPT Flange MMC Fault" zone=0.020 material=MMC datums=[B] features=[F_LPT_HUB] device=CMM_LASER\n`,
    }),
  },
  {
    id: "step",
    fileName: "TurbofanAP242.step",
    label: "TurbofanAP242.step",
    shortTag: "Compiled AP242",
    langSlug: "step",
    uri: "file:///sandbox/TurbofanAP242.step",
    readOnly: true,
    code: STEP_CODE,
    faultLabel: "Inject dangling entity ref #999 (T1005)",
    injectFault: (code: string) => ({
      label: "Injected unresolved STEP entity reference #999 (T1005)",
      code: code.includes("#999")
        ? code
        : code.replace(
            "ENDSEC;\nEND-ISO-10303-21;",
            "#9999=DEFINITIONAL_REPRESENTATION('FaultRef',(#999),#24);\nENDSEC;\nEND-ISO-10303-21;",
          ),
    }),
  },
];

function extractNumericAssign(code: string, name: string): number | null {
  const re = new RegExp(`\\b${name}\\s*=\\s*([+-]?\\d+(?:\\.\\d+)?(?:[eE][+-]?\\d+)?)`);
  const match = re.exec(code);
  if (!match?.[1]) return null;
  const v = parseFloat(match[1]);
  return Number.isFinite(v) ? v : null;
}

export function extractTurbineLiveParams(
  codeById: Partial<Record<TurbineArtifactId, string>>,
  preferredRpmSource?: "modelica" | "scad",
): TurbineLiveParams {
  const mo = codeById.modelica ?? "";
  const scad = codeById.scad ?? "";
  const moTelemetry = extractModelicaTelemetryParams(mo);

  const pickRpm = (moVal: number | null, scadVal: number | null, defVal: number): number => {
    if (moVal !== null && scadVal !== null) {
      if (preferredRpmSource === "scad") return scadVal;
      if (preferredRpmSource === "modelica") return moVal;
      if (moVal === defVal && scadVal !== defVal) return scadVal;
      return moVal;
    }
    return moVal ?? scadVal ?? defVal;
  };

  const n1Raw = pickRpm(
    moTelemetry.n1Rpm ?? extractNumericAssign(mo, "n1_rpm"),
    extractNumericAssign(scad, "n1_rpm"),
    3850,
  );
  const n2Raw = pickRpm(
    moTelemetry.n2Rpm ?? extractNumericAssign(mo, "n2_rpm"),
    extractNumericAssign(scad, "n2_rpm"),
    14200,
  );
  const t04Raw = moTelemetry.t04K ?? extractNumericAssign(mo, "T_04") ?? 1650;
  const cutRaw = moTelemetry.cutX ?? extractNumericAssign(mo, "cut_x");

  return {
    n1Rpm: Math.max(0, Math.min(12000, n1Raw)),
    n2Rpm: Math.max(0, Math.min(28000, n2Raw)),
    t04K: Math.max(300, Math.min(2600, t04Raw)),
    cutX: cutRaw !== null ? Math.max(-1.6, Math.min(2.2, cutRaw)) : null,
  };
}
