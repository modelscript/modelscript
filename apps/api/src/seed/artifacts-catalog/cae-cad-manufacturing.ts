// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const CAE_CAD_MANUFACTURING_POSTS: SeedPostSpec[] = [
  // 35. STEP (.step)
  {
    id: "seed-post-step",
    language: "step",
    viewType: "cad-step",
    title: "Aerospace Ti-6Al-4V Gimbal Thrust-Vectoring Actuator Housing — ISO 10303-21 AP242 B-Rep",
    filename: "Gimbal_TVC_Actuator_Assembly.step",
    authorUsername: "david_kowalski",
    createdHoursAgo: 18,
    postContent:
      "Uploaded the ISO 10303-21 AP242 boundary-representation (`B-Rep`) STEP assembly (`.step`) for our dual-axis titanium gimbal thrust-vectoring actuator housing. Manifold topological shells (`CLOSED_SHELL`, `ADVANCED_FACE`, `EDGE_LOOP`, `ORIENTED_EDGE`) verified for direct hex-dominant conformal meshing and 5-axis CNC toolpath generation.",
    code: `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Aerospace Ti-6Al-4V Gimbal Thrust-Vectoring Actuator Assembly','AP242 Manifold B-Rep'),'2;1');
FILE_NAME('Gimbal_TVC_Actuator_Assembly.step','2026-03-19T10:15:00',('David Kowalski'),('Aerospace Structures & CAE Group'),'ModelScript CAD Kernel','ModelScript AP242 Exporter','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF { 1 0 10303 442 1 1 4 }'));
ENDSEC;
DATA;
#1 = APPLICATION_CONTEXT('managed model based 3d engineering');
#2 = PRODUCT_DEFINITION_CONTEXT('part definition',#1,'design');
#3 = PRODUCT('GIMBAL_TVC_ACTUATOR','Ti-6Al-4V Gimbal TVC Actuator','',(#4));
#4 = PRODUCT_CONTEXT('',#1,'mechanical');
#5 = PRODUCT_DEFINITION_FORMATION_WITH_SPECIFIED_SOURCE('REV_C','',#3,.NOT_KNOWN.);
#6 = PRODUCT_DEFINITION('design','',#5,#2);

/* --- Flange Base & Octagonal Actuator Barrel Vertices --- */
#101 = CARTESIAN_POINT('P1',(-60.0,-60.0,0.0));
#102 = CARTESIAN_POINT('P2',( 60.0,-60.0,0.0));
#103 = CARTESIAN_POINT('P3',( 60.0, 60.0,0.0));
#104 = CARTESIAN_POINT('P4',(-60.0, 60.0,0.0));
#105 = CARTESIAN_POINT('P5',(-60.0,-60.0,22.0));
#106 = CARTESIAN_POINT('P6',( 60.0,-60.0,22.0));
#107 = CARTESIAN_POINT('P7',( 60.0, 60.0,22.0));
#108 = CARTESIAN_POINT('P8',(-60.0, 60.0,22.0));
#109 = CARTESIAN_POINT('P9',(-34.0,-34.0,22.0));
#110 = CARTESIAN_POINT('P10',( 34.0,-34.0,22.0));
#111 = CARTESIAN_POINT('P11',( 34.0, 34.0,22.0));
#112 = CARTESIAN_POINT('P12',(-34.0, 34.0,22.0));
#113 = CARTESIAN_POINT('P13',(-28.0,-28.0,115.0));
#114 = CARTESIAN_POINT('P14',( 28.0,-28.0,115.0));
#115 = CARTESIAN_POINT('P15',( 28.0, 28.0,115.0));
#116 = CARTESIAN_POINT('P16',(-28.0, 28.0,115.0));
#117 = CARTESIAN_POINT('P17',(-16.0,-16.0,165.0));
#118 = CARTESIAN_POINT('P18',( 16.0,-16.0,165.0));
#119 = CARTESIAN_POINT('P19',( 16.0, 16.0,165.0));
#120 = CARTESIAN_POINT('P20',(-16.0, 16.0,165.0));

#201 = VERTEX_POINT('V1',#101);
#202 = VERTEX_POINT('V2',#102);
#203 = VERTEX_POINT('V3',#103);
#204 = VERTEX_POINT('V4',#104);
#205 = VERTEX_POINT('V5',#105);
#206 = VERTEX_POINT('V6',#106);
#207 = VERTEX_POINT('V7',#107);
#208 = VERTEX_POINT('V8',#108);
#209 = VERTEX_POINT('V9',#109);
#210 = VERTEX_POINT('V10',#110);
#211 = VERTEX_POINT('V11',#111);
#212 = VERTEX_POINT('V12',#112);
#213 = VERTEX_POINT('V13',#113);
#214 = VERTEX_POINT('V14',#114);
#215 = VERTEX_POINT('V15',#115);
#216 = VERTEX_POINT('V16',#116);
#217 = VERTEX_POINT('V17',#117);
#218 = VERTEX_POINT('V18',#118);
#219 = VERTEX_POINT('V19',#119);
#220 = VERTEX_POINT('V20',#120);

#301 = EDGE_CURVE('E1',#201,#202,#101,.T.);
#302 = EDGE_CURVE('E2',#202,#203,#102,.T.);
#303 = EDGE_CURVE('E3',#203,#204,#103,.T.);
#304 = EDGE_CURVE('E4',#204,#201,#104,.T.);
#305 = EDGE_CURVE('E5',#205,#206,#105,.T.);
#306 = EDGE_CURVE('E6',#206,#207,#106,.T.);
#307 = EDGE_CURVE('E7',#207,#208,#107,.T.);
#308 = EDGE_CURVE('E8',#208,#205,#108,.T.);
#309 = EDGE_CURVE('E9',#201,#205,#101,.T.);
#310 = EDGE_CURVE('E10',#202,#206,#102,.T.);
#311 = EDGE_CURVE('E11',#203,#207,#103,.T.);
#312 = EDGE_CURVE('E12',#204,#208,#104,.T.);
#313 = EDGE_CURVE('E13',#209,#210,#109,.T.);
#314 = EDGE_CURVE('E14',#210,#211,#110,.T.);
#315 = EDGE_CURVE('E15',#211,#212,#111,.T.);
#316 = EDGE_CURVE('E16',#212,#209,#112,.T.);
#317 = EDGE_CURVE('E17',#213,#214,#113,.T.);
#318 = EDGE_CURVE('E18',#214,#215,#114,.T.);
#319 = EDGE_CURVE('E19',#215,#216,#115,.T.);
#320 = EDGE_CURVE('E20',#216,#213,#116,.T.);
#321 = EDGE_CURVE('E21',#209,#213,#109,.T.);
#322 = EDGE_CURVE('E22',#210,#214,#110,.T.);
#323 = EDGE_CURVE('E23',#211,#215,#111,.T.);
#324 = EDGE_CURVE('E24',#212,#216,#112,.T.);
#325 = EDGE_CURVE('E25',#217,#218,#117,.T.);
#326 = EDGE_CURVE('E26',#218,#219,#118,.T.);
#327 = EDGE_CURVE('E27',#219,#220,#119,.T.);
#328 = EDGE_CURVE('E28',#220,#217,#120,.T.);
#329 = EDGE_CURVE('E29',#213,#217,#113,.T.);
#330 = EDGE_CURVE('E30',#214,#218,#114,.T.);
#331 = EDGE_CURVE('E31',#215,#219,#115,.T.);
#332 = EDGE_CURVE('E32',#216,#220,#116,.T.);

#401 = ORIENTED_EDGE('',*,*,#301,.T.);
#402 = ORIENTED_EDGE('',*,*,#302,.T.);
#403 = ORIENTED_EDGE('',*,*,#303,.T.);
#404 = ORIENTED_EDGE('',*,*,#304,.T.);
#405 = ORIENTED_EDGE('',*,*,#305,.T.);
#406 = ORIENTED_EDGE('',*,*,#306,.T.);
#407 = ORIENTED_EDGE('',*,*,#307,.T.);
#408 = ORIENTED_EDGE('',*,*,#308,.T.);
#409 = ORIENTED_EDGE('',*,*,#309,.T.);
#410 = ORIENTED_EDGE('',*,*,#310,.T.);
#411 = ORIENTED_EDGE('',*,*,#311,.T.);
#412 = ORIENTED_EDGE('',*,*,#312,.T.);
#413 = ORIENTED_EDGE('',*,*,#313,.T.);
#414 = ORIENTED_EDGE('',*,*,#314,.T.);
#415 = ORIENTED_EDGE('',*,*,#315,.T.);
#416 = ORIENTED_EDGE('',*,*,#316,.T.);
#417 = ORIENTED_EDGE('',*,*,#317,.T.);
#418 = ORIENTED_EDGE('',*,*,#318,.T.);
#419 = ORIENTED_EDGE('',*,*,#319,.T.);
#420 = ORIENTED_EDGE('',*,*,#320,.T.);
#421 = ORIENTED_EDGE('',*,*,#321,.T.);
#422 = ORIENTED_EDGE('',*,*,#322,.T.);
#423 = ORIENTED_EDGE('',*,*,#323,.T.);
#424 = ORIENTED_EDGE('',*,*,#324,.T.);
#425 = ORIENTED_EDGE('',*,*,#325,.T.);
#426 = ORIENTED_EDGE('',*,*,#326,.T.);
#427 = ORIENTED_EDGE('',*,*,#327,.T.);
#428 = ORIENTED_EDGE('',*,*,#328,.T.);
#429 = ORIENTED_EDGE('',*,*,#329,.T.);
#430 = ORIENTED_EDGE('',*,*,#330,.T.);
#431 = ORIENTED_EDGE('',*,*,#331,.T.);
#432 = ORIENTED_EDGE('',*,*,#332,.T.);

#501 = EDGE_LOOP('FLANGE_BOT',(#401,#402,#403,#404));
#502 = EDGE_LOOP('FLANGE_TOP',(#405,#406,#407,#408));
#503 = EDGE_LOOP('FLANGE_FRONT',(#401,#410,#405,#409));
#504 = EDGE_LOOP('FLANGE_RIGHT',(#402,#411,#406,#410));
#505 = EDGE_LOOP('FLANGE_BACK',(#403,#412,#407,#411));
#506 = EDGE_LOOP('FLANGE_LEFT',(#404,#409,#408,#412));
#507 = EDGE_LOOP('BARREL_FRONT',(#413,#422,#417,#421));
#508 = EDGE_LOOP('BARREL_RIGHT',(#414,#423,#418,#422));
#509 = EDGE_LOOP('BARREL_BACK',(#415,#424,#419,#423));
#510 = EDGE_LOOP('BARREL_LEFT',(#416,#421,#420,#424));
#511 = EDGE_LOOP('CLEVIS_FRONT',(#417,#430,#425,#429));
#512 = EDGE_LOOP('CLEVIS_RIGHT',(#418,#431,#426,#430));
#513 = EDGE_LOOP('CLEVIS_TOP',(#425,#426,#427,#428));
#514 = EDGE_LOOP('CLEVIS_BACK',(#419,#432,#427,#431));
#515 = EDGE_LOOP('CLEVIS_LEFT',(#420,#429,#428,#432));
#516 = EDGE_LOOP('BARREL_BOT',(#413,#414,#415,#416));
#517 = EDGE_LOOP('BARREL_TOP',(#417,#418,#419,#420));

#601 = ADVANCED_FACE('FLANGE_BOT_FACE',(#501),#101,.T.);
#602 = ADVANCED_FACE('FLANGE_TOP_FACE',(#502),#105,.T.);
#603 = ADVANCED_FACE('BARREL_FRONT_FACE',(#507),#109,.T.);
#604 = ADVANCED_FACE('CLEVIS_TOP_FACE',(#513),#117,.T.);
#701 = CLOSED_SHELL('FLANGE_SHELL',(#601,#602));
#702 = CLOSED_SHELL('BARREL_SHELL',(#603));
#703 = CLOSED_SHELL('CLEVIS_SHELL',(#604));
#801 = MANIFOLD_SOLID_BREP('Flange_Base_Housing',#701);
#802 = MANIFOLD_SOLID_BREP('Actuator_Cylinder_Barrel',#702);
#803 = MANIFOLD_SOLID_BREP('Gimbal_Clevis_Mount',#703);
#901 = AXIS2_PLACEMENT_3D('Flange_CSYS',#101);
#902 = AXIS2_PLACEMENT_3D('Barrel_CSYS',#109);
#903 = AXIS2_PLACEMENT_3D('Clevis_CSYS',#117);
#910 = ADVANCED_BREP_SHAPE_REPRESENTATION('Gimbal_TVC_BRep',(#801,#802,#803,#901,#902,#903),#1);
#920 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_BARREL','Barrel_To_Flange','Actuator Barrel Mount',#3,#802,$);
#921 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_CLEVIS','Clevis_To_Barrel','Gimbal Clevis Mount',#802,#803,$);
ENDSEC;
END-ISO-10303-21;
`,
    likedBy: ["omar", "vikram_patel", "lukas_weber", "kenji_takahashi", "henrik_lindqvist"],
    repostedBy: ["vikram_patel", "lukas_weber"],
    bookmarkedBy: ["omar", "vikram_patel", "kenji_takahashi"],
    comments: [
      {
        authorUsername: "vikram_patel",
        createdHoursAgo: 16,
        content:
          "Clean AP242 B-Rep topology! Zero degenerate sliver edges on the clevis-to-barrel transition fillets, and it imported straight into our CalculiX C3D10 tetrahedral mesher.",
        likedBy: ["david_kowalski", "omar"],
      },
    ],
  },

  // 36. SCAD (.scad)
  {
    id: "seed-post-scad",
    language: "scad",
    viewType: "scad",
    title: "Parametric Zero-Backlash Cycloidal Speed Reducer (29:1 Ratio) — OpenSCAD CSG",
    filename: "Cycloidal_Speed_Reducer_29to1.scad",
    authorUsername: "david_kowalski",
    createdHoursAgo: 15,
    postContent:
      "Shared our parametric OpenSCAD CSG model (`.scad`) of a 29:1 zero-backlash dual-disc cycloidal harmonic drive reducer for robotic shoulder/elbow actuators. Parameterizes epitrochoidal lobe profiles, eccentric input camshaft, needle-bearing ring pins, and output roller pins.",
    code: `// =====================================================================
// PARAMETRIC 29:1 ZERO-BACKLASH CYCLOIDAL ROBOTIC SPEED REDUCER (.SCAD)
// =====================================================================
$fn = 96;

// Primary kinematic parameters
num_lobes         = 29;
num_ring_pins     = 30;
rotor_pitch_rad   = 44.0;
eccentricity      = 1.25;
pin_roller_rad    = 2.50;
disc_thickness    = 8.00;
housing_outer_rad = 54.0;
output_bolt_rad   = 26.0;
num_output_pins   = 8;

// Polyglot CSG & mechanical module declarations
module RingGearHousing_Stator() {
  difference() {
    cylinder(h = disc_thickness * 2 + 6, r = housing_outer_rad, center = true);
    cylinder(h = disc_thickness * 2 + 8, r = rotor_pitch_rad + pin_roller_rad, center = true);
    for (i = [0 : 5]) {
      rotate([0, 0, i * 60])
        translate([housing_outer_rad - 4.5, 0, 0])
          cylinder(h = disc_thickness * 2 + 10, r = 2.6, center = true);
    }
  }
  for (i = [0 : num_ring_pins - 1]) {
    rotate([0, 0, i * (360 / num_ring_pins)])
      translate([rotor_pitch_rad, 0, 0])
        cylinder(h = disc_thickness * 2 + 4, r = pin_roller_rad, center = true);
  }
}

module EpitrochoidCycloidalDisc(phase_deg = 0) {
  rotate([0, 0, phase_deg])
  translate([eccentricity, 0, 0])
  difference() {
    cylinder(h = disc_thickness, r = rotor_pitch_rad - eccentricity, center = true);
    cylinder(h = disc_thickness + 2, r = 14.0, center = true);
    for (j = [0 : num_output_pins - 1]) {
      rotate([0, 0, j * (360 / num_output_pins)])
        translate([output_bolt_rad, 0, 0])
          cylinder(h = disc_thickness + 2, r = 3.5 + eccentricity, center = true);
    }
  }
}

module DualEccentricInputShaft() {
  cylinder(h = disc_thickness * 3, r = 9.0, center = true);
  translate([eccentricity, 0, -(disc_thickness * 0.55)])
    cylinder(h = disc_thickness * 0.95, r = 13.8, center = true);
  translate([-eccentricity, 0, (disc_thickness * 0.55)])
    cylinder(h = disc_thickness * 0.95, r = 13.8, center = true);
}

module OutputPinCarrierFlange() {
  for (j = [0 : num_output_pins - 1]) {
    rotate([0, 0, j * (360 / num_output_pins)])
      translate([output_bolt_rad, 0, 0])
        cylinder(h = disc_thickness * 2 + 4, r = 3.45, center = true);
  }
}

// Assembly Composition & Kinematic Chain
RingGearHousing_Stator();
translate([0, 0, -4.5]) EpitrochoidCycloidalDisc(phase_deg = 0);
translate([0, 0,  4.5]) EpitrochoidCycloidalDisc(phase_deg = 180);
DualEccentricInputShaft();
OutputPinCarrierFlange();
`,
    likedBy: ["omar", "kenji_takahashi", "lukas_weber", "alex_rivera"],
    repostedBy: ["kenji_takahashi"],
    bookmarkedBy: ["omar", "kenji_takahashi"],
    comments: [
      {
        authorUsername: "kenji_takahashi",
        createdHoursAgo: 13,
        content:
          "Opposing the two cycloidal discs by `phase_deg = 180` cancels 100% of the first-order radial dynamic unbalance at 3,000 rpm input speed. We are printing a PEEK + hardened dowel prototype of this for `j4_elbow_flex`!",
        likedBy: ["david_kowalski", "omar"],
      },
    ],
  },

  // 37. FEA (.inp)
  {
    id: "seed-post-fea",
    language: "fea",
    viewType: "fea-deck",
    title: "Topology-Optimized Aerospace Ti-6Al-4V Gimbal Bracket — CalculiX Static & Modal FEA Deck",
    filename: "Aerospace_Ti6Al4V_Bracket_FEA.inp",
    authorUsername: "david_kowalski",
    createdHoursAgo: 12,
    postContent:
      "Published our CalculiX / Abaqus finite element input deck (`.inp`) for the topology-optimized Ti-6Al-4V gimbal actuator mounting bracket under 48 kN peak thrust-vectoring clevis load. Peak von Mises stress is 512 MPa against the 880 MPa yield limit (`SF = 1.72`), with 1st structural eigenmode at 418 Hz.",
    code: `*HEADING
Aerospace Ti-6Al-4V Topology-Optimized Gimbal Actuator Bracket (48 kN TVC Load)
*NODE, NSET=NALL
1,   0.0,   0.0,  0.0
2,  40.0,   0.0,  0.0
3,  80.0,   0.0,  0.0
4, 120.0,  10.0,  0.0
5, 160.0,  25.0,  0.0
6,   0.0,  35.0,  0.0
7,  40.0,  32.0,  0.0
8,  80.0,  30.0,  0.0
9, 120.0,  34.0,  0.0
10, 160.0,  45.0,  0.0
11,   0.0,  70.0,  0.0
12,  40.0,  64.0,  0.0
13,  80.0,  58.0,  0.0
14, 120.0,  54.0,  0.0
15, 160.0,  62.0,  0.0
16,   0.0,   0.0, 18.0
17,  40.0,   0.0, 18.0
18,  80.0,   0.0, 18.0
19, 120.0,  10.0, 18.0
20, 160.0,  25.0, 18.0
21,   0.0,  35.0, 18.0
22,  40.0,  32.0, 18.0
23,  80.0,  30.0, 18.0
24, 120.0,  34.0, 18.0
25, 160.0,  45.0, 18.0
26,   0.0,  70.0, 18.0
27,  40.0,  64.0, 18.0
28,  80.0,  58.0, 18.0
29, 120.0,  54.0, 18.0
30, 160.0,  62.0, 18.0
*ELEMENT, TYPE=C3D8, ELSET=E_BRACKET_TI64
1,  1,  2,  7,  6, 16, 17, 22, 21
2,  2,  3,  8,  7, 17, 18, 23, 22
3,  3,  4,  9,  8, 18, 19, 24, 23
4,  4,  5, 10,  9, 19, 20, 25, 24
5,  6,  7, 12, 11, 21, 22, 27, 26
6,  7,  8, 13, 12, 22, 23, 28, 27
7,  8,  9, 14, 13, 23, 24, 29, 28
8,  9, 10, 15, 14, 24, 25, 30, 29
*NSET, NSET=BOLT_FLANGE_ROOT
1, 6, 11, 16, 21, 26
*NSET, NSET=CLEVIS_LUG_PIN
5, 10, 15, 20, 25, 30
*MATERIAL, NAME=TI_6AL_4V_GRADE5
*ELASTIC
113800.0, 0.342
*DENSITY
4.43e-9
*SOLID SECTION, ELSET=E_BRACKET_TI64, MATERIAL=TI_6AL_4V_GRADE5
*BOUNDARY
BOLT_FLANGE_ROOT, ENCASTRE
*STEP, NLGEOM=NO
*STATIC
*CLOAD
5,  2, -8000.0
10, 2, -8000.0
15, 2, -8000.0
20, 2, -8000.0
25, 2, -8000.0
30, 2, -8000.0
*NODE PRINT, NSET=NALL
U, RF
*EL PRINT, ELSET=E_BRACKET_TI64
S, E
*END STEP
`,
    likedBy: ["omar", "vikram_patel", "lukas_weber", "henrik_lindqvist", "elena_vance"],
    repostedBy: ["lukas_weber"],
    bookmarkedBy: ["omar", "vikram_patel"],
    comments: [
      {
        authorUsername: "lukas_weber",
        createdHoursAgo: 10,
        content:
          "Tapered upper and lower truss chords (`elements 3, 4, 7, 8`) align the principal stress trajectories straight into the `BOLT_FLANGE_ROOT` nodes with minimal bending shear.",
        likedBy: ["david_kowalski", "omar"],
      },
    ],
  },

  // 38. CFD (.cfg)
  {
    id: "seed-post-cfd",
    language: "cfd",
    viewType: "cfd-config",
    title: "Transonic Supercritical Wing (CRM Mach 0.82, Re 5M) — SU2 Compressible RANS k-omega SST",
    filename: "Transonic_CRM_Wing_Mach082_RANS.cfg",
    authorUsername: "david_kowalski",
    createdHoursAgo: 9,
    postContent:
      "Uploaded our SU2 v8.0 compressible RANS configuration deck (`.cfg`) for the NASA Common Research Model (`CRM`) supercritical transonic transport wing at $\\text{Mach } 0.82$, $\\alpha = 2.75^\\circ$, and $Re_c = 5.0 \\times 10^6$ using Menter's $k\\text{-}\\omega$ SST turbulence closure and Roe upwind shock-capturing with Venkatakrishnan limiter.",
    code: `% =====================================================================
% TRANSONIC SUPERCRITICAL CRM WING (MACH 0.82) — SU2 RANS k-omega SST
% =====================================================================
SOLVER = RANS
KIND_TURB_MODEL = SST
MATH_PROBLEM = DIRECT
RESTART_SOL = NO

% --- Freestream Compressible Flow Conditions (FL370 Cruise) ---
MACH_NUMBER = 0.82
AOA = 2.75
SIDESLIP_ANGLE = 0.0
REYNOLDS_NUMBER = 5000000.0
REYNOLDS_LENGTH = 1.0
FREESTREAM_TEMPERATURE = 216.65
FREESTREAM_PRESSURE = 21662.0
FREESTREAM_DENSITY = 0.348
FREESTREAM_VISCOSITY = 1.422e-5
FREESTREAM_VELOCITY = ( 241.9, 11.61, 0.0 )

% --- Reference Geometry ---
REF_ORIGIN_MOMENT_X = 0.25
REF_ORIGIN_MOMENT_Y = 0.00
REF_ORIGIN_MOMENT_Z = 0.00
REF_LENGTH = 1.0
REF_AREA = 3.84

% --- Boundary Condition Markers ---
MARKER_HEATFLUX = ( wing_upper_surface, 0.0, wing_lower_surface, 0.0, winglet_tip, 0.0 )
MARKER_EULER = ( fuselage_fairing )
MARKER_FARFIELD = ( farfield_hemisphere )
MARKER_SYM = ( symmetry_midplane )
MARKER_PLOTTING = ( wing_upper_surface, wing_lower_surface )
MARKER_MONITORING = ( wing_upper_surface, wing_lower_surface )

% --- Convective Discretization & Multigrid Convergence ---
NUM_METHOD_GRAD = WEIGHTED_LEAST_SQUARES
CONV_NUM_METHOD_FLOW = ROE
MUSCL_FLOW = YES
SLOPE_LIMITER_FLOW = VENKATAKRISHNAN
VENKAT_LIMITER_COEFF = 0.05
TIME_DISCRE_FLOW = EULER_IMPLICIT
CFL_NUMBER = 15.0
MGLEVEL = 3
MGCYCLE = W_CYCLE
ITER = 2500

MESH_FILENAME = crm_supercritical_wing_3d_hybrid.su2
MESH_FORMAT = SU2
OUTPUT_WRT_FREQ = 250
`,
    likedBy: ["omar", "sofia_rossi", "vikram_patel", "lukas_weber", "elena_vance"],
    repostedBy: ["sofia_rossi"],
    bookmarkedBy: ["omar", "sofia_rossi"],
    comments: [
      {
        authorUsername: "sofia_rossi",
        createdHoursAgo: 7,
        content:
          "How clean is the $\\lambda$-shock foot capture at $y/b = 0.65$ with `ROE` + `VENKATAKRISHNAN` (`0.05`) on the hybrid prism-tet boundary layer mesh ($y^+ < 0.8$)?",
        likedBy: ["david_kowalski", "omar"],
        replies: [
          {
            authorUsername: "david_kowalski",
            createdHoursAgo: 6,
            content:
              "Shock position at $x/c = 0.58$ matches the NASA Ames 11-ft transonic wind tunnel pressure taps within $\\Delta C_p < 0.018$, yielding $C_L = 0.502$ and $C_D = 0.0254$ ($L/D = 19.76$).",
            likedBy: ["sofia_rossi", "vikram_patel", "omar"],
          },
        ],
      },
    ],
  },
];
