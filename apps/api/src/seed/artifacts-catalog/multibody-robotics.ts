// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const MULTIBODY_ROBOTICS_POSTS: SeedPostSpec[] = [
  // 23. GENSYS (.calc)
  {
    id: "seed-post-gensys",
    language: "gensys",
    viewType: "gensys",
    title: "High-Speed 320 km/h Articulated Rail Vehicle Bogie — EN 14363 Stability & FASTSIM Creepage",
    filename: "HighSpeed_320kmh_Bogie_EN14363.calc",
    authorUsername: "henrik_lindqvist",
    createdHoursAgo: 84,
    postContent:
      "Published our GENSYS railway vehicle dynamics deck (`.calc`) for a 320 km/h high-speed passenger coach on UIC60 1:40 rail with S1002 wheel profiles. Includes Kalker FASTSIM non-linear wheel-rail creepage, primary flexicoil springs, secondary airsprings, and hydraulic anti-yaw dampers verified against EN 14363 Prud'homme & Nadine derailment $(Y/Q < 0.80)$ limits.",
    code: `# =====================================================================
# GENSYS HIGH-SPEED 320 KM/H RAIL VEHICLE BOGIE & EN 14363 ACCEPTANCE
# =====================================================================
set v_kmh = 320.0
set v_ms  = v_kmh / 3.6
set k_prim_x = 18.5e6
set k_prim_y = 6.2e6
set k_prim_z = 1.15e6
set k_sec_xy = 0.18e6
set k_sec_z  = 0.42e6
set c_yaw    = 1.25e6

speed v_ms
tstart 0.0
tstop  12.0
dt     0.0005

sub primary_suspension
sub secondary_airspring
sub anti_yaw_damper
sub fastsim_s1002_uic60

# Structural mass bodies: body <name> <mass> <jx> <jy> <jz> <x> <y> <z>
body carbody_coach  38500.0  64200.0  1840000.0  1810000.0   0.00  0.0  1.85
body bogie_front     2650.0   1820.0     3150.0     4280.0   9.50  0.0  0.62
body bogie_rear      2650.0   1820.0     3150.0     4280.0  -9.50  0.0  0.62

# Wheelsets: wheelset <name> <mass> <jx> <jy> <jz> <gauge> <wheelRadius> <conicity> <profile>
wheelset axle_11  1580.0  860.0  115.0  860.0  1.435  0.460  0.15  "S1002_UIC60_1in40.whe"
wheelset axle_12  1580.0  860.0  115.0  860.0  1.435  0.460  0.15  "S1002_UIC60_1in40.whe"
wheelset axle_21  1580.0  860.0  115.0  860.0  1.435  0.460  0.15  "S1002_UIC60_1in40.whe"
wheelset axle_22  1580.0  860.0  115.0  860.0  1.435  0.460  0.15  "S1002_UIC60_1in40.whe"

# Primary & Secondary Couplings: spring <name> <b1> <b2> <kx> <ky> <kz> <cx> <cy> <cz>
spring k_prim_11  bogie_front    axle_11      k_prim_x  k_prim_y  k_prim_z   12000.0  8000.0  18500.0
spring k_prim_12  bogie_front    axle_12      k_prim_x  k_prim_y  k_prim_z   12000.0  8000.0  18500.0
spring k_prim_21  bogie_rear     axle_21      k_prim_x  k_prim_y  k_prim_z   12000.0  8000.0  18500.0
spring k_prim_22  bogie_rear     axle_22      k_prim_x  k_prim_y  k_prim_z   12000.0  8000.0  18500.0
spring k_sec_f    carbody_coach  bogie_front  k_sec_xy  k_sec_xy  k_sec_z    c_yaw    28000.0 34000.0
spring k_sec_r    carbody_coach  bogie_rear   k_sec_xy  k_sec_xy  k_sec_z    c_yaw    28000.0 34000.0
`,
    likedBy: ["omar", "kenji_takahashi", "lukas_weber", "elena_vance", "david_kowalski"],
    repostedBy: ["kenji_takahashi", "lukas_weber"],
    bookmarkedBy: ["omar", "kenji_takahashi"],
    comments: [
      {
        authorUsername: "lukas_weber",
        createdHoursAgo: 81,
        content:
          "With `k_prim_x = 18.5 MN/m` and `c_yaw = 1.25 MNs/m`, what is the nonlinear hunting critical speed on worn S1002 profiles ($\\lambda_{\\text{eq}} = 0.28$)?",
        likedBy: ["henrik_lindqvist", "omar"],
        replies: [
          {
            authorUsername: "henrik_lindqvist",
            createdHoursAgo: 79,
            content:
              "Nonlinear Hopf bifurcation limit cycle onset stays above 386 km/h even at $\\lambda_{\\text{eq}} = 0.28$, giving a 20.6% margin above the 320 km/h operating speed and max Sum-Y track shift force of 34.2 kN (EN 14363 limit: 68.5 kN).",
            likedBy: ["lukas_weber", "kenji_takahashi", "omar"],
          },
        ],
      },
    ],
  },

  // 24. SIMPACK (.spck)
  {
    id: "seed-post-simpack",
    language: "simpack",
    viewType: "simpack",
    title: "15 MW Offshore Wind Turbine Planetary Gearbox & Main Bearing Drivetrain — SIMPACK MBS",
    filename: "Offshore_15MW_Wind_Drivetrain.spck",
    authorUsername: "kenji_takahashi",
    createdHoursAgo: 78,
    postContent:
      "Shared our SIMPACK multibody dynamics model (`.spck`) of an IEA-15-240-RWT class offshore wind turbine drivetrain. Captures the 240 m rotor hub, main spherical roller bearing 6-DOF compliance bushing, 2-stage planetary gearbox carrier/sun/planet mesh stiffness, elastomer torque-arm mounts, and permanent-magnet generator air-gap rotor dynamics.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<SimpackModel name="IEA_15MW_Offshore_Wind_Planetary_Drivetrain_MBS" version="2026.1">
  <Body id="nacelle_bedplate" name="Nacelle_CastIron_Bedplate" mass="142000.0" ixx="680000.0" iyy="820000.0" izz="910000.0">
    <Marker id="m_bed_main_brg" name="Bedplate_MainBearing_Seat" x="0.0" y="0.0" z="1.8" />
    <Marker id="m_bed_trq_arm" name="Bedplate_TorqueArm_Mount" x="-3.4" y="0.0" z="1.8" />
    <Marker id="m_bed_gen_stator" name="Bedplate_Generator_Stator" x="-7.2" y="0.0" z="1.8" />
  </Body>

  <Body id="rotor_hub_shaft" name="Rotor_Hub_And_LowSpeed_Shaft" mass="188000.0" ixx="42500000.0" iyy="24100000.0" izz="24100000.0">
    <Marker id="m_lss_brg" name="LSS_MainBearing_Journal" x="0.0" y="0.0" z="1.8" />
    <Marker id="m_lss_carrier" name="LSS_PlanetCarrier_Spline" x="-3.1" y="0.0" z="1.8" />
  </Body>

  <Body id="planet_carrier_st1" name="Stage1_Planet_Carrier" mass="24500.0" ixx="68500.0" iyy="41200.0" izz="41200.0">
    <Marker id="m_car1_center" name="Carrier1_Center" x="-3.4" y="0.0" z="1.8" />
    <Marker id="m_car1_pin1" name="Carrier1_PlanetPin_A" x="-3.4" y="0.92" z="1.8" />
  </Body>

  <Body id="sun_gear_st1" name="Stage1_Helical_Sun_Gear" mass="4850.0" ixx="3420.0" iyy="2180.0" izz="2180.0">
    <Marker id="m_sun1_mesh" name="Sun1_HelicalMesh" x="-3.4" y="0.0" z="1.8" />
    <Marker id="m_sun1_out" name="Sun1_IntermediateCoupling" x="-4.8" y="0.0" z="1.8" />
  </Body>

  <Body id="pmg_rotor" name="MediumSpeed_PM_Generator_Rotor" mass="36200.0" ixx="148000.0" iyy="96000.0" izz="96000.0">
    <Marker id="m_gen_in" name="GenRotor_CouplingFlange" x="-6.5" y="0.0" z="1.8" />
    <Marker id="m_gen_airgap" name="GenRotor_AirGapCenter" x="-7.2" y="0.0" z="1.8" />
  </Body>

  <Joint id="j_lss_revolute" name="Main_LSS_Azimuth_Revolute" type="revolute" from="m_bed_main_brg" to="m_lss_brg" />
  <Joint id="j_carrier_revolute" name="Stage1_Carrier_Revolute" type="revolute" from="m_lss_carrier" to="m_car1_center" />
  <Joint id="j_sun_revolute" name="Stage1_Sun_Revolute" type="revolute" from="m_car1_center" to="m_sun1_mesh" />
  <Joint id="j_pmg_revolute" name="Generator_Rotor_Revolute" type="revolute" from="m_sun1_out" to="m_gen_in" />

  <Bushing id="f_main_srb_bushing" name="Main_SRB_6DOF_Bearing_Compliance" from="m_bed_main_brg" to="m_lss_brg" kx="2.4e9" ky="3.8e9" kz="3.8e9" cx="1.2e6" cy="1.8e6" cz="1.8e6" />
  <Force id="f_torque_arm_elastomer" name="Gearbox_Elastomer_TorqueArm" from="m_bed_trq_arm" to="m_car1_center" kx="4.5e8" ky="6.2e8" kz="8.4e8" cx="4.8e5" cy="6.5e5" cz="8.2e5" />
  <Force id="f_helical_gear_mesh" name="Stage1_Helical_Tooth_Mesh_Stiffness" from="m_car1_pin1" to="m_sun1_mesh" kx="1.15e9" ky="1.85e9" kz="9.4e8" cx="3.2e5" cy="4.5e5" cz="2.8e5" />
  <Force id="f_pmg_electromagnetic" name="PMG_Unbalanced_Magnetic_Pull_Stiffness" from="m_bed_gen_stator" to="m_gen_airgap" kx="1.2e7" ky="-8.5e7" kz="-8.5e7" cx="9.5e4" cy="1.4e5" cz="1.4e5" />
</SimpackModel>
`,
    likedBy: ["omar", "henrik_lindqvist", "astrid_solberg", "lukas_weber", "marcus_chen"],
    repostedBy: ["henrik_lindqvist", "astrid_solberg"],
    bookmarkedBy: ["omar", "henrik_lindqvist", "astrid_solberg"],
    comments: [
      {
        authorUsername: "astrid_solberg",
        createdHoursAgo: 75,
        content:
          "Including the negative radial stiffness (`ky = -85 MN/m`) from `f_pmg_electromagnetic` unbalanced magnetic pull is critical—we saw that shift the 1st drivetrain bending mode down by 1.4 Hz on our floating semi-submersible.",
        likedBy: ["kenji_takahashi", "henrik_lindqvist"],
        replies: [
          {
            authorUsername: "kenji_takahashi",
            createdHoursAgo: 73,
            content:
              "100%! Coupling this SIMPACK drivetrain FMU with your SIMA mooring model also confirmed that the 3P blade-passing excitation stays 18% below the Campbell diagram torsional resonance across the 5.0–7.56 rpm operational band.",
            likedBy: ["astrid_solberg", "omar"],
          },
        ],
      },
    ],
  },

  // 25. ADAMS (.adm)
  {
    id: "seed-post-adams",
    language: "adams",
    viewType: "adams",
    title: "Formula Motorsport Pushrod Double-Wishbone Front Suspension & Anti-Roll Kinematics — MSC Adams",
    filename: "Formula_Pushrod_DoubleWishbone.adm",
    authorUsername: "lukas_weber",
    createdHoursAgo: 72,
    postContent:
      "Uploaded our MSC Adams dataset deck (`.adm`) for a carbon-fiber Formula motorsport front corner double-wishbone pushrod suspension. Models the carbon monocoque ground reference, upper/lower A-arms, upright/knuckle, pushrod tube, bellcrank rocker, and coilover spring-damper unit to evaluate camber gain, roll center migration, and wheel-rate progression.",
    code: `! =====================================================================
! FORMULA MOTORSPORT PUSHROD DOUBLE-WISHBONE FRONT SUSPENSION (.ADM)
! =====================================================================
ADAMS/View model name: Formula_Front_Pushrod_DoubleWishbone_Suspension

UNITS / SYSTEM = MKS, FORCE = NEWTON, MASS = KILOGRAM, LENGTH = METER, TIME = SECOND

! --- 1. CHASSIS MONOCOQUE (GROUND PART) ---
PART / 1, GROUND
MARKER / 101, PART = 1, QP = 0.0, 0.280, 0.165, REULER = 0.0D, 0.0D, 0.0D
MARKER / 102, PART = 1, QP = 0.0, 0.310, 0.345, REULER = 0.0D, 0.0D, 0.0D
MARKER / 103, PART = 1, QP = 0.0, 0.220, 0.440, REULER = 0.0D, 0.0D, 0.0D
MARKER / 104, PART = 1, QP = 0.0, 0.085, 0.460, REULER = 0.0D, 0.0D, 0.0D

! --- 2. LOWER WISHBONE A-ARM ---
PART / 2, MASS = 1.45, CM = 201, IP = 0.042, 0.068, 0.095
MARKER / 201, PART = 2, QP = 0.0, 0.455, 0.160, REULER = 0.0D, 0.0D, 0.0D
MARKER / 202, PART = 2, QP = 0.0, 0.280, 0.165, REULER = 0.0D, 0.0D, 0.0D
MARKER / 203, PART = 2, QP = 0.0, 0.630, 0.155, REULER = 0.0D, 0.0D, 0.0D
MARKER / 204, PART = 2, QP = 0.0, 0.585, 0.168, REULER = 0.0D, 0.0D, 0.0D

! --- 3. UPPER WISHBONE A-ARM ---
PART / 3, MASS = 1.18, CM = 301, IP = 0.031, 0.052, 0.074
MARKER / 301, PART = 3, QP = 0.0, 0.460, 0.355, REULER = 0.0D, 0.0D, 0.0D
MARKER / 302, PART = 3, QP = 0.0, 0.310, 0.345, REULER = 0.0D, 0.0D, 0.0D
MARKER / 303, PART = 3, QP = 0.0, 0.610, 0.365, REULER = 0.0D, 0.0D, 0.0D

! --- 4. TITANIUM UPRIGHT & WHEEL HUB ASSEMBLY ---
PART / 4, MASS = 11.80, CM = 401, IP = 0.480, 0.720, 0.480
MARKER / 401, PART = 4, QP = 0.0, 0.650, 0.260, REULER = 0.0D, 0.0D, 0.0D
MARKER / 402, PART = 4, QP = 0.0, 0.630, 0.155, REULER = 0.0D, 0.0D, 0.0D
MARKER / 403, PART = 4, QP = 0.0, 0.610, 0.365, REULER = 0.0D, 0.0D, 0.0D

! --- 5. CARBON PUSHROD LINK ---
PART / 5, MASS = 0.62, CM = 501, IP = 0.018, 0.018, 0.002
MARKER / 501, PART = 5, QP = 0.0, 0.415, 0.310, REULER = 0.0D, 0.0D, 0.0D
MARKER / 502, PART = 5, QP = 0.0, 0.585, 0.168, REULER = 0.0D, 0.0D, 0.0D
MARKER / 503, PART = 5, QP = 0.0, 0.245, 0.452, REULER = 0.0D, 0.0D, 0.0D

! --- 6. BILLET BELLCRANK ROCKER ---
PART / 6, MASS = 0.94, CM = 601, IP = 0.012, 0.015, 0.022
MARKER / 601, PART = 6, QP = 0.0, 0.220, 0.440, REULER = 0.0D, 0.0D, 0.0D
MARKER / 602, PART = 6, QP = 0.0, 0.245, 0.452, REULER = 0.0D, 0.0D, 0.0D
MARKER / 603, PART = 6, QP = 0.0, 0.195, 0.485, REULER = 0.0D, 0.0D, 0.0D

! --- KINEMATIC JOINTS ---
JOINT / 1, REVOLUTE, I = 202, J = 101
JOINT / 2, REVOLUTE, I = 302, J = 102
JOINT / 3, SPHERICAL, I = 402, J = 203
JOINT / 4, SPHERICAL, I = 403, J = 303
JOINT / 5, SPHERICAL, I = 502, J = 204
JOINT / 6, UNIVERSAL, I = 503, J = 602
JOINT / 7, REVOLUTE, I = 601, J = 103

! --- COILOVER SPRING-DAMPER & TIRE VERTICAL STIFFNESS ---
SFORCE / 1, TRANSLATIONAL, I = 603, J = 104, K = 165000.0, C = 4800.0, LENGTH = 0.115
SFORCE / 2, TRANSLATIONAL, I = 401, J = 101, K = 240000.0, C = 350.0, LENGTH = 0.260

ACCGRAV / JGRAV = 0.0, KGRAV = -9.80665
SIMULATE / DYNAMIC, END = 2.0, DTOUT = 0.002
END
`,
    likedBy: ["omar", "henrik_lindqvist", "kenji_takahashi", "david_kowalski", "elena_vance"],
    repostedBy: ["david_kowalski"],
    bookmarkedBy: ["omar", "henrik_lindqvist", "david_kowalski"],
    comments: [
      {
        authorUsername: "david_kowalski",
        createdHoursAgo: 69,
        content:
          "Nice progressive motion ratio on `PART / 6` bellcrank (`MARKER 602` to `603`) — rising from 0.78 at ride height to 0.94 at 35 mm heave compression to support high-downforce aero load without bottoming the plank.",
        likedBy: ["lukas_weber", "omar"],
        replies: [
          {
            authorUsername: "lukas_weber",
            createdHoursAgo: 67,
            content:
              "Exactly! And the shortened upper wishbone (`PART / 3`) yields `-0.042 deg/mm` camber gain in bump, keeping the outer contact patch flat at 2.4g lateral cornering.",
            likedBy: ["david_kowalski", "henrik_lindqvist"],
          },
        ],
      },
    ],
  },

  // 26. URDF (.urdf)
  {
    id: "seed-post-urdf",
    language: "urdf",
    viewType: "urdf",
    title: "7-DOF Torque-Controlled Dexterous Cobot Manipulator & Parallel Gripper — ROS 2 URDF",
    filename: "Dexterous_7DOF_Torque_Cobot.urdf",
    authorUsername: "kenji_takahashi",
    createdHoursAgo: 66,
    postContent:
      "Published our ROS 2 URDF kinematic & inertial tree (`.urdf`) for a 7-DOF redundant torque-controlled collaborative manipulator with an integrated parallel-jaw force-sensing gripper. All link inertia tensors are positive-definite and triangle-inequality verified via `@modelscript/urdf` for Pinocchio / MuJoCo / Modelica multibody lowering.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<robot name="AetherArm_7DOF_TorqueCobot">
  <material name="titanium_matte">
    <color rgba="0.22 0.26 0.32 1.0" />
  </material>
  <material name="accent_cyan">
    <color rgba="0.06 0.72 0.84 1.0" />
  </material>

  <link name="base_link">
    <inertial>
      <origin xyz="0 0 0.05" rpy="0 0 0" />
      <mass value="4.20" />
      <inertia ixx="0.028" ixy="0" ixz="0" iyy="0.028" iyz="0" izz="0.036" />
    </inertial>
    <visual>
      <origin xyz="0 0 0.05" rpy="0 0 0" />
      <geometry><cylinder radius="0.085" length="0.10" /></geometry>
      <material name="titanium_matte" />
    </visual>
  </link>

  <link name="shoulder_link">
    <inertial>
      <origin xyz="0 0 0.11" rpy="0 0 0" />
      <mass value="3.45" />
      <inertia ixx="0.024" ixy="0" ixz="0" iyy="0.022" iyz="0" izz="0.015" />
    </inertial>
  </link>

  <link name="upper_arm_link">
    <inertial>
      <origin xyz="0 0 0.18" rpy="0 0 0" />
      <mass value="3.10" />
      <inertia ixx="0.032" ixy="0" ixz="0" iyy="0.031" iyz="0" izz="0.009" />
    </inertial>
  </link>

  <link name="elbow_link">
    <inertial>
      <origin xyz="0 0 0.09" rpy="0 0 0" />
      <mass value="2.40" />
      <inertia ixx="0.014" ixy="0" ixz="0" iyy="0.014" iyz="0" izz="0.007" />
    </inertial>
  </link>

  <link name="forearm_link">
    <inertial>
      <origin xyz="0 0 0.16" rpy="0 0 0" />
      <mass value="2.05" />
      <inertia ixx="0.019" ixy="0" ixz="0" iyy="0.018" iyz="0" izz="0.005" />
    </inertial>
  </link>

  <link name="wrist_pitch_link">
    <inertial>
      <origin xyz="0 0 0.06" rpy="0 0 0" />
      <mass value="1.25" />
      <inertia ixx="0.0045" ixy="0" ixz="0" iyy="0.0042" iyz="0" izz="0.0032" />
    </inertial>
  </link>

  <link name="wrist_flange_link">
    <inertial>
      <origin xyz="0 0 0.04" rpy="0 0 0" />
      <mass value="0.68" />
      <inertia ixx="0.0018" ixy="0" ixz="0" iyy="0.0018" iyz="0" izz="0.0022" />
    </inertial>
  </link>

  <link name="ee_gripper_body">
    <inertial>
      <origin xyz="0 0 0.05" rpy="0 0 0" />
      <mass value="0.82" />
      <inertia ixx="0.0024" ixy="0" ixz="0" iyy="0.0021" iyz="0" izz="0.0019" />
    </inertial>
  </link>

  <joint name="j1_shoulder_pan" type="revolute">
    <parent link="base_link" />
    <child link="shoulder_link" />
    <origin xyz="0 0 0.10" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-2.8973" upper="2.8973" effort="87.0" velocity="2.175" />
    <dynamics damping="0.15" friction="0.08" />
  </joint>

  <joint name="j2_shoulder_lift" type="revolute">
    <parent link="shoulder_link" />
    <child link="upper_arm_link" />
    <origin xyz="0 0 0.22" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-1.7628" upper="1.7628" effort="87.0" velocity="2.175" />
    <dynamics damping="0.15" friction="0.08" />
  </joint>

  <joint name="j3_upper_arm_roll" type="revolute">
    <parent link="upper_arm_link" />
    <child link="elbow_link" />
    <origin xyz="0 0 0.36" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-2.8973" upper="2.8973" effort="87.0" velocity="2.175" />
    <dynamics damping="0.12" friction="0.06" />
  </joint>

  <joint name="j4_elbow_flex" type="revolute">
    <parent link="elbow_link" />
    <child link="forearm_link" />
    <origin xyz="0.0825 0 0.18" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-3.0718" upper="-0.0698" effort="87.0" velocity="2.175" />
    <dynamics damping="0.12" friction="0.06" />
  </joint>

  <joint name="j5_forearm_roll" type="revolute">
    <parent link="forearm_link" />
    <child link="wrist_pitch_link" />
    <origin xyz="-0.0825 0 0.32" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-2.8973" upper="2.8973" effort="12.0" velocity="2.610" />
    <dynamics damping="0.05" friction="0.03" />
  </joint>

  <joint name="j6_wrist_pitch" type="revolute">
    <parent link="wrist_pitch_link" />
    <child link="wrist_flange_link" />
    <origin xyz="0 0 0.12" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-0.0175" upper="3.7525" effort="12.0" velocity="2.610" />
    <dynamics damping="0.05" friction="0.03" />
  </joint>

  <joint name="j7_wrist_roll" type="revolute">
    <parent link="wrist_flange_link" />
    <child link="ee_gripper_body" />
    <origin xyz="0 0 0.088" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-2.8973" upper="2.8973" effort="12.0" velocity="2.610" />
    <dynamics damping="0.04" friction="0.02" />
  </joint>
</robot>
`,
    likedBy: ["omar", "alex_rivera", "elena_vance", "henrik_lindqvist", "lukas_weber"],
    repostedBy: ["alex_rivera", "omar"],
    bookmarkedBy: ["omar", "alex_rivera"],
    comments: [
      {
        authorUsername: "alex_rivera",
        createdHoursAgo: 63,
        content:
          "Zero inertial triangle-inequality violations across all 8 links! We lowered this URDF directly into our 1 kHz operational-space impedance controller and null-space posture optimizer.",
        likedBy: ["kenji_takahashi", "omar"],
      },
    ],
  },

  // 27. OPENDRIVE (.xodr)
  {
    id: "seed-post-opendrive",
    language: "opendrive",
    viewType: "opendrive",
    title: "ASAM OpenDRIVE v1.7 Highway Cloverleaf Merge &Clothoid Transition Corridor",
    filename: "Highway_Cloverleaf_Merge_Corridor.xodr",
    authorUsername: "kenji_takahashi",
    createdHoursAgo: 60,
    postContent:
      'Uploaded our ASAM OpenDRIVE v1.7 high-definition road network (`.xodr`) for autonomous driving L4 highway merge validation. Features clothoid (`spiral`) and constant-radius arc planView geometries, multi-lane highway cross-sections with superelevation banking, and an on-ramp junction (`junction id="100"`) with lane-level successor/predecessor topology.',
    code: `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="7" name="Autobahn_A9_Cloverleaf_Merge_Corridor" version="1.7" date="2026-03-15" north="450.0" south="-150.0" east="1200.0" west="-100.0" vendor="ModelScript Autonomous Map Engine" />

  <road name="A9_Mainline_West" length="450.0" id="1" junction="-1">
    <link>
      <successor elementType="junction" elementId="100" />
    </link>
    <planView>
      <geometry s="0.0" x="0.0" y="0.0" hdg="0.0" length="300.0">
        <line />
      </geometry>
      <geometry s="300.0" x="300.0" y="0.0" hdg="0.0" length="150.0">
        <arc curvature="0.0008" />
      </geometry>
    </planView>
    <elevationProfile>
      <elevation s="0.0" a="320.0" b="0.005" c="0.0" d="0.0" />
    </elevationProfile>
    <lanes>
      <laneSection s="0.0">
        <center>
          <lane id="0" type="none" level="false" />
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
          <lane id="-2" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
          <lane id="-3" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>

  <road name="Cloverleaf_OnRamp_North" length="280.0" id="2" junction="-1">
    <link>
      <successor elementType="junction" elementId="100" />
    </link>
    <planView>
      <geometry s="0.0" x="180.0" y="-120.0" hdg="0.62" length="160.0">
        <arc curvature="-0.0032" />
      </geometry>
      <geometry s="160.0" x="315.0" y="-32.0" hdg="0.11" length="120.0">
        <spiral curvStart="-0.0032" curvEnd="0.0008" />
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0.0">
        <center>
          <lane id="0" type="none" level="false" />
        </center>
        <right>
          <lane id="-1" type="entry" level="false">
            <width sOffset="0.0" a="4.00" b="0.0" c="0.0" d="0.0" />
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>

  <road name="A9_Mainline_East_Merged" length="520.0" id="3" junction="-1">
    <link>
      <predecessor elementType="junction" elementId="100" />
    </link>
    <planView>
      <geometry s="0.0" x="449.2" y="9.0" hdg="0.12" length="520.0">
        <line />
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0.0">
        <center>
          <lane id="0" type="none" level="false" />
        </center>
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
          <lane id="-2" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
          <lane id="-3" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
          <lane id="-4" type="entry" level="false">
            <width sOffset="0.0" a="3.75" b="-0.007" c="0.0" d="0.0" />
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>

  <junction name="A9_OnRamp_Merge_Junction" id="100">
    <connection id="1" incomingRoad="1" connectingRoad="3" contactPoint="start">
      <laneLink from="-1" to="-1" />
      <laneLink from="-2" to="-2" />
      <laneLink from="-3" to="-3" />
    </connection>
    <connection id="2" incomingRoad="2" connectingRoad="3" contactPoint="start">
      <laneLink from="-1" to="-4" />
    </connection>
  </junction>
</OpenDRIVE>
`,
    likedBy: ["omar", "lukas_weber", "claire_dubois", "alex_rivera"],
    repostedBy: ["lukas_weber"],
    bookmarkedBy: ["omar", "lukas_weber"],
    comments: [
      {
        authorUsername: "claire_dubois",
        createdHoursAgo: 57,
        content:
          'Having exact Euler spiral (`curvStart="-0.0032" curvEnd="0.0008"`) continuity on `Cloverleaf_OnRamp_North` eliminates the lateral jerk spike at `s = 160 m` that used to trip false-positive lane-keeping interventions.',
        likedBy: ["kenji_takahashi", "omar"],
      },
    ],
  },

  // 28. OPENSCENARIO (.xosc)
  {
    id: "seed-post-openscenario",
    language: "openscenario",
    viewType: "openscenario",
    title: "ASAM OpenSCENARIO v1.2 Adversarial Highway Cut-In & Emergency Braking — ISO 21448 SOTIF",
    filename: "Highway_Adversarial_CutIn_SOTIF.xosc",
    authorUsername: "kenji_takahashi",
    createdHoursAgo: 54,
    postContent:
      "Paired with the `A9_Cloverleaf_Merge_Corridor.xodr` HD map: here is our ASAM OpenSCENARIO v1.2 maneuver scenario (`.xosc`) testing ISO 21448 (SOTIF) and UNECE R157 ALKS compliance during an aggressive 130 km/h cut-in combined with sudden lead-vehicle deceleration (`-7.5 m/s²`) and occluded radar track handoff.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" date="2026-03-15T14:30:00Z" description="ISO 21448 SOTIF Adversarial Highway Cut-In &amp; AEB Verification" author="Kenji Takahashi" />
  <ParameterDeclarations>
    <ParameterDeclaration name="EgoInitSpeedMpS" parameterType="double" value="36.11" />
    <ParameterDeclaration name="CutInLongitudinalGapM" parameterType="double" value="18.5" />
    <ParameterDeclaration name="LeadDecelRateMpS2" parameterType="double" value="7.5" />
  </ParameterDeclarations>
  <RoadNetwork>
    <LogicFile filepath="Highway_Cloverleaf_Merge_Corridor.xodr" />
  </RoadNetwork>
  <Entities>
    <ScenarioObject name="Ego_L4_Autonomous_Sedan">
      <Vehicle name="Ego_Sedan_DualSoC" vehicleCategory="car">
        <Performance maxSpeed="65.0" maxAcceleration="4.8" maxDeceleration="10.5" />
        <BoundingBox>
          <Center x="1.42" y="0.0" z="0.75" />
          <Dimensions width="1.92" length="4.88" height="1.46" />
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="Adversary_CutIn_SUV">
      <Vehicle name="CutIn_Fast_SUV" vehicleCategory="car">
        <Performance maxSpeed="60.0" maxAcceleration="4.2" maxDeceleration="9.8" />
        <BoundingBox>
          <Center x="1.38" y="0.0" z="0.88" />
          <Dimensions width="2.04" length="4.95" height="1.72" />
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
    <ScenarioObject name="Occluded_Heavy_Freight_Truck">
      <Vehicle name="Slow_Heavy_SemiTruck" vehicleCategory="truck">
        <Performance maxSpeed="27.8" maxAcceleration="1.8" maxDeceleration="7.2" />
        <BoundingBox>
          <Center x="4.20" y="0.0" z="1.95" />
          <Dimensions width="2.55" length="16.50" height="3.95" />
        </BoundingBox>
      </Vehicle>
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego_L4_Autonomous_Sedan">
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionDynamics dynamicsShape="step" value="0.0" dynamicsDimension="time" />
                <SpeedActionTarget>
                  <AbsoluteTargetSpeed value="36.11" />
                </SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
    <Story name="Adversarial_CutIn_And_HardBrake_Story">
      <Act name="CutIn_Maneuver_Act">
        <ManeuverGroup name="Adversary_Maneuver_Group" maximumExecutionCount="1">
          <Actors selectTriggeringEntities="false">
            <EntityRef entityRef="Adversary_CutIn_SUV" />
          </Actors>
          <Maneuver name="Aggressive_LaneChange_And_Decel">
            <Event name="Execute_LaneChange_Left" priority="overwrite">
              <Action name="Sinusoidal_CutIn_Action">
                <PrivateAction>
                  <LateralAction>
                    <LaneChangeAction>
                      <LaneChangeActionDynamics dynamicsShape="sinusoidal" value="2.1" dynamicsDimension="time" />
                      <LaneChangeTarget>
                        <RelativeTargetLane entityRef="Ego_L4_Autonomous_Sedan" value="0" />
                      </LaneChangeTarget>
                    </LaneChangeAction>
                  </LateralAction>
                </PrivateAction>
              </Action>
            </Event>
          </Maneuver>
        </ManeuverGroup>
      </Act>
    </Story>
  </Storyboard>
</OpenSCENARIO>
`,
    likedBy: ["omar", "claire_dubois", "lukas_weber", "alex_rivera", "elena_vance"],
    repostedBy: ["claire_dubois"],
    bookmarkedBy: ["omar", "claire_dubois", "alex_rivera"],
    comments: [
      {
        authorUsername: "alex_rivera",
        createdHoursAgo: 51,
        content:
          "With a 2.1 s sinusoidal lateral cut-in at 18.5 m longitudinal gap, the Time-To-Collision (TTC) drops to 1.42 s right as `Occluded_Heavy_Freight_Truck` unmasks on the LiDAR/radar fusion tracker.",
        likedBy: ["kenji_takahashi", "claire_dubois", "omar"],
        replies: [
          {
            authorUsername: "kenji_takahashi",
            createdHoursAgo: 49,
            content:
              "Yes, and our Responsibility-Sensitive Safety (RSS) longitudinal envelope triggers `-8.4 m/s²` AEB within 65 ms of the lane boundary crossing, maintaining a 4.6 m minimum stopping clearance.",
            likedBy: ["alex_rivera", "claire_dubois", "omar"],
          },
        ],
      },
    ],
  },
];
