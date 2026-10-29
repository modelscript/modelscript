// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SeedPostSpec } from "../types.js";

export const AEROSPACE_PROPULSION_POSTS: SeedPostSpec[] = [
  // 29. ROCETS (.roc)
  {
    id: "seed-post-rocets",
    language: "rocets",
    viewType: "rocets",
    title: "2.2 MN Full-Flow Staged-Combustion LOX/CH4 Reusable Rocket Engine Powerhead — NASA ROCETS",
    filename: "FFSC_LOX_Methane_2200kN_Engine.roc",
    authorUsername: "vikram_patel",
    createdHoursAgo: 48,
    postContent:
      "Published our NASA ROCETS thermodynamic & turbomachinery cycle deck (`.roc`) for a 2.2 MN vacuum-rated Full-Flow Staged-Combustion (`FFSC`) $\\text{LOX}/\\text{LCH}_4$ rocket engine. Balances fuel-rich and oxidizer-rich preburners, regenerative nozzle cooling jacket Bartz heat transfer, and hydrostatic turbopump shaft power across 40%–105% deep throttling.",
    code: `# =====================================================================
# 2.2 MN FULL-FLOW STAGED-COMBUSTION LOX/CH4 ENGINE CYCLE DECK (.ROC)
# =====================================================================
ENGINE FFSC_LOX_LCH4_2200KN
TITLE "2.2 MN Full-Flow Staged-Combustion LOX/CH4 Reusable Rocket Engine"

DESIGN:
  PC=28.5e6 THRUST=2200000.0 MR=3.60 CYCLE="FFSC"

COMPONENTS:
  TK_LOX     TYPE=TANK       FLUID=LOX  TITLE="LOX Run Tank Boundary"
    PARAMS: P=0.45e6 T=90.5 MDOT=505.5
  TK_CH4     TYPE=TANK       FLUID=CH4  TITLE="LCH4 Run Tank Boundary"
    PARAMS: P=0.42e6 T=111.6 MDOT=140.4
  PMP_LOX    TYPE=PUMP       FLUID=LOX  TITLE="Main LOX Centrifugal Turbopump"
    PARAMS: PR=125.0 EFF=0.79 RPM=26500.0
  PMP_CH4    TYPE=PUMP       FLUID=CH4  TITLE="Two-Stage LCH4 Impeller Pump"
    PARAMS: PR=148.0 EFF=0.76 RPM=38200.0
  REGEN_JKT  TYPE=HEX        FLUID=CH4  TITLE="Milled-Channel CuCrZr Regen Cooling Jacket"
    PARAMS: DP=4.8e6 QDOT=42.5e6
  VLV_MOV    TYPE=VALVE      FLUID=LOX  TITLE="Main Oxidizer Preburner Valve"
    PARAMS: CV=48.0 OPENING=0.88
  VLV_MFV    TYPE=VALVE      FLUID=CH4  TITLE="Main Fuel Preburner Valve"
    PARAMS: CV=36.0 OPENING=0.85
  PB_OX      TYPE=PREBURNER  FLUID=LOX  TITLE="Oxidizer-Rich Preburner (ORPB)"
    PARAMS: PC=48.2e6 MR=42.0 T_OUT=815.0
  PB_FU      TYPE=PREBURNER  FLUID=CH4  TITLE="Fuel-Rich Preburner (FRPB)"
    PARAMS: PC=49.5e6 MR=0.34 T_OUT=860.0
  TRB_LOX    TYPE=TURBINE    FLUID=LOX  TITLE="ORPB Axial Drive Turbine"
    PARAMS: PR=1.52 EFF=0.84 RPM=26500.0
  TRB_CH4    TYPE=TURBINE    FLUID=CH4  TITLE="FRPB Axial Drive Turbine"
    PARAMS: PR=1.58 EFF=0.83 RPM=38200.0
  MCC_MAIN   TYPE=CHAMBER    FLUID=GAS  TITLE="Main Combustion Chamber (285 bar)"
    PARAMS: PC=28.5e6 MR=3.60 CSTAR=1865.0 AT=0.0725 EPS=45.0
  NOZ_BELL   TYPE=NOZZLE     FLUID=GAS  TITLE="80% Rao Parabolic Bell Nozzle (eps=45)"
    PARAMS: EPS=45.0 CF=1.895 ISP_VAC=368.4

CONNECTIONS:
  TK_LOX.OUT    -> PMP_LOX.IN    FLUID=LOX
  TK_CH4.OUT    -> PMP_CH4.IN    FLUID=CH4
  PMP_LOX.OUT   -> VLV_MOV.IN    FLUID=LOX
  PMP_CH4.OUT   -> REGEN_JKT.IN  FLUID=CH4
  REGEN_JKT.OUT -> VLV_MFV.IN    FLUID=CH4
  VLV_MOV.OUT   -> PB_OX.IN_OX   FLUID=LOX
  VLV_MFV.OUT   -> PB_FU.IN_FU   FLUID=CH4
  PB_OX.OUT     -> TRB_LOX.IN    FLUID=LOX
  PB_FU.OUT     -> TRB_CH4.IN    FLUID=CH4
  TRB_LOX.OUT   -> MCC_MAIN.IN_OX FLUID=LOX
  TRB_CH4.OUT   -> MCC_MAIN.IN_FU FLUID=CH4
  MCC_MAIN.OUT  -> NOZ_BELL.IN   FLUID=GAS
`,
    likedBy: ["omar", "sofia_rossi", "elena_vance", "david_kowalski", "priya_nair", "henrik_lindqvist"],
    repostedBy: ["sofia_rossi", "omar"],
    bookmarkedBy: ["omar", "sofia_rossi", "david_kowalski"],
    comments: [
      {
        authorUsername: "sofia_rossi",
        createdHoursAgo: 46,
        content:
          "Keeping `PB_OX` turbine inlet temperature at 815 K (`MR = 42.0`) gives plenty of oxidation margin on the Monel/Inconel 718 stator vanes while hitting 285 bar main chamber pressure.",
        likedBy: ["vikram_patel", "omar"],
        replies: [
          {
            authorUsername: "vikram_patel",
            createdHoursAgo: 44,
            content:
              "Yes, and because both propellants enter `MCC_MAIN` as warm supercritical gases from `TRB_LOX` and `TRB_CH4`, gas-gas injector mixing reaches 99.1% $c^*$ efficiency with zero acoustic chug during the 40% landing throttle down-ramp.",
            likedBy: ["sofia_rossi", "david_kowalski", "omar"],
          },
        ],
      },
    ],
  },

  // 30. EASY5 (.ez5)
  {
    id: "seed-post-easy5",
    language: "easy5",
    viewType: "easy5",
    title: "More-Electric Aircraft (MEA) Dual-Stage Air Cycle Machine & Cabin Pressurization ECS — EASY5",
    filename: "Aircraft_MEA_Cabin_ECS_Pack.ez5",
    authorUsername: "vikram_patel",
    createdHoursAgo: 42,
    postContent:
      "Uploaded our EASY5 dynamic schematic & linearization model (`.ez5`) for a More-Electric Aircraft bleedless Environmental Control System (`ECS`) pack. Models the high-speed electric cabin air compressor (`CAC`), primary/secondary ram-air heat exchangers, air cycle machine (`ACM`) bootstrap turbine, and cabin outflow valve surge/pressurization control loop.",
    code: `! =====================================================================
! MORE-ELECTRIC AIRCRAFT BLEEDLESS CABIN ECS & ACM PACK (.EZ5)
! =====================================================================
MODEL: MEA_CABIN_ECS_PACK
TITLE: "More-Electric Aircraft Bleedless Cabin ECS & Air Cycle Machine Control"

COMPONENTS:
  CMD_ALT  TYPE=GP/TF  TITLE="Cabin Altitude Schedule Setpoint" X=60 Y=120
    XP: K=1.0, TAU=0.25
    S0: S1=80.0, S2=0.0
  SJ_PRESS TYPE=GP/SJ  TITLE="Cabin Pressure Error Summing Junction" X=220 Y=120
    XP: G1=1.0, G2=-1.0
  PI_CAC   TYPE=GP/LA  TITLE="Electric CAC Speed Lead-Lag Compensator" X=380 Y=120
    XP: K=14.5, TAU1=0.18, TAU2=0.04
    S0: S1=0.0
  IN_CAC   TYPE=GP/IN  TITLE="High-Speed Foil-Bearing CAC Rotor Inertia" X=540 Y=120
    XP: K=1.25
    S0: S1=42000.0
  TF_HX    TYPE=GP/TF  TITLE="Dual Ram-Air Heat Exchanger & Bootstrap ACM" X=700 Y=120
    XP: K=0.88, ZETA=0.72, WN=18.5
    S0: S1=292.15, S2=0.0
  IN_CABIN TYPE=GP/IN  TITLE="Fuselage Cabin Pressurized Volume Dynamics" X=860 Y=120
    XP: K=0.065
    S0: S1=79.5
  LA_OFV   TYPE=GP/LA  TITLE="Electro-Mechanical Outflow Valve Actuator" X=700 Y=280
    XP: K=0.92, TAU1=0.08, TAU2=0.02
    S0: S1=0.45
  GN_SENS  TYPE=GP/GN  TITLE="Triple-Voting Cabin Barometric Sensor" X=460 Y=280
    XP: K=1.0

CONNECTIONS:
  CMD_ALT.OUT  -> SJ_PRESS.IN1
  SJ_PRESS.OUT -> PI_CAC.IN
  PI_CAC.OUT   -> IN_CAC.IN
  IN_CAC.OUT   -> TF_HX.IN
  TF_HX.OUT    -> IN_CABIN.IN
  IN_CABIN.OUT -> LA_OFV.IN
  LA_OFV.OUT   -> GN_SENS.IN
  GN_SENS.OUT  -> SJ_PRESS.IN2
`,
    likedBy: ["omar", "elena_vance", "sofia_rossi", "claire_dubois", "alex_rivera"],
    repostedBy: ["elena_vance"],
    bookmarkedBy: ["omar", "elena_vance"],
    comments: [
      {
        authorUsername: "elena_vance",
        createdHoursAgo: 39,
        content:
          "Linearizing around the FL410 cruise trim point shows 58 deg phase margin and 11.4 dB gain margin on the coupled `PI_CAC` + `LA_OFV` cabin pressure loop, with cabin rate-of-climb bounded below 150 ft/min during emergency descent.",
        likedBy: ["vikram_patel", "omar"],
      },
    ],
  },

  // 31. GTSUITE (.gtm)
  {
    id: "seed-post-gtsuite",
    language: "gtsuite",
    viewType: "gtsuite",
    title: "2.0L 4-Cylinder Miller-Cycle Turbocharged Direct-Injection H2-ICE — GT-SUITE 1D Gas Dynamics",
    filename: "MillerCycle_2L_Turbo_H2_ICE.gtm",
    authorUsername: "lukas_weber",
    createdHoursAgo: 36,
    postContent:
      "Shared our 1D wave-action GT-SUITE engine model (`.gtm`) for a heavy-duty 2.0L 4-cylinder hydrogen direct-injection ($\\text{H}_2$-DI) internal combustion engine running ultra-lean ($\\lambda = 2.25$) Miller cycle with variable-geometry turbocharging (`VGT`). Achieves 46.8% brake thermal efficiency with $< 0.02\\text{ g/kWh}$ $\\text{NO}_x$ via Zeldovich thermal kinetics.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<GTModel name="H2_DI_2000cc_MillerCycle_VGT_Engine" duration="2.5" timeStep="0.00005" engineSpeed="3200" ambientPressure="101325" ambientTemperature="295.15" lambda="2.25">
  <Component id="amb_inlet" kind="environment" pressure="101325" temperature="295.15" />
  <Component id="vgt_comp" kind="compressor" pressureRatio="2.85" efficiency="0.78" speedRpm="118000" />
  <Component id="charge_cooler" kind="intercooler" effectiveness="0.88" coolantTemp="308.15" pressureDrop="3200" />
  <Component id="intake_plenum" kind="plenum" volume="0.0038" temperature="314.15" />

  <Component id="runner_in_1" kind="intake_runner" diameter="0.042" length="0.28" wallTemperature="335.0" />
  <Component id="runner_in_2" kind="intake_runner" diameter="0.042" length="0.28" wallTemperature="335.0" />
  <Component id="runner_in_3" kind="intake_runner" diameter="0.042" length="0.28" wallTemperature="335.0" />
  <Component id="runner_in_4" kind="intake_runner" diameter="0.042" length="0.28" wallTemperature="335.0" />

  <Component id="cyl_1" kind="cylinder" bore="0.086" stroke="0.086" rodLength="0.148" compressionRatio="13.2">
    <Combustion anchorAngle="8.5" duration="28.0" exponent="1.85" wallTemperature="435.0" />
  </Component>
  <Component id="cyl_2" kind="cylinder" bore="0.086" stroke="0.086" rodLength="0.148" compressionRatio="13.2">
    <Combustion anchorAngle="8.5" duration="28.0" exponent="1.85" wallTemperature="435.0" />
  </Component>
  <Component id="cyl_3" kind="cylinder" bore="0.086" stroke="0.086" rodLength="0.148" compressionRatio="13.2">
    <Combustion anchorAngle="8.5" duration="28.0" exponent="1.85" wallTemperature="435.0" />
  </Component>
  <Component id="cyl_4" kind="cylinder" bore="0.086" stroke="0.086" rodLength="0.148" compressionRatio="13.2">
    <Combustion anchorAngle="8.5" duration="28.0" exponent="1.85" wallTemperature="435.0" />
  </Component>

  <Component id="exh_manifold" kind="plenum" volume="0.0029" temperature="815.0" />
  <Component id="vgt_turbine" kind="turbine" expansionRatio="2.45" efficiency="0.76" speedRpm="118000" />
  <Component id="amb_tailpipe" kind="environment" pressure="102500" temperature="295.15" />

  <Connection from="amb_inlet" to="vgt_comp" />
  <Connection from="vgt_comp" to="charge_cooler" />
  <Connection from="charge_cooler" to="intake_plenum" />
  <Connection from="intake_plenum" to="runner_in_1" />
  <Connection from="intake_plenum" to="runner_in_2" />
  <Connection from="intake_plenum" to="runner_in_3" />
  <Connection from="intake_plenum" to="runner_in_4" />
  <Connection from="runner_in_1" to="cyl_1" />
  <Connection from="runner_in_2" to="cyl_2" />
  <Connection from="runner_in_3" to="cyl_3" />
  <Connection from="runner_in_4" to="cyl_4" />
  <Connection from="cyl_1" to="exh_manifold" />
  <Connection from="cyl_2" to="exh_manifold" />
  <Connection from="cyl_3" to="exh_manifold" />
  <Connection from="cyl_4" to="exh_manifold" />
  <Connection from="exh_manifold" to="vgt_turbine" />
  <Connection from="vgt_turbine" to="amb_tailpipe" />
</GTModel>
`,
    likedBy: ["omar", "vikram_patel", "henrik_lindqvist", "priya_nair", "david_kowalski"],
    repostedBy: ["vikram_patel"],
    bookmarkedBy: ["omar", "vikram_patel"],
    comments: [
      {
        authorUsername: "vikram_patel",
        createdHoursAgo: 33,
        content:
          "Running $\\lambda = 2.25$ with early intake valve closing (`EIVC` Miller cycle) keeps peak in-cylinder burned-gas temperature below 1820 K, which completely suppresses the exponential Zeldovich thermal $\\text{NO}_x$ formation cliff.",
        likedBy: ["lukas_weber", "priya_nair", "omar"],
        replies: [
          {
            authorUsername: "lukas_weber",
            createdHoursAgo: 31,
            content:
              "Exactly, and the Livengood-Wu auto-ignition knock integral stays at 0.64 even at 2.85 bar boost pressure Ratio (`22.4 bar` BMEP).",
            likedBy: ["vikram_patel", "omar"],
          },
        ],
      },
    ],
  },

  // 32. JSBSIM (.xml)
  {
    id: "seed-post-jsbsim",
    language: "jsbsim",
    viewType: "jsbsim",
    title: "Supersonic Tailless Delta-Wing Demonstrator — 6-DOF Nonlinear Flight Dynamics & FCS (JSBSim 2.0)",
    filename: "Supersonic_DeltaWing_6DOF_FDM.xml",
    authorUsername: "sofia_rossi",
    createdHoursAgo: 30,
    postContent:
      "Uploaded our JSBSim 2.0 6-DOF nonlinear Flight Dynamics Model (`.xml`) for a Mach 1.8 relaxed-static-stability tailless delta-wing flight demonstrator. Includes full inertia tensor, retractable tricycle landing gear oleo-pneumatic struts, afterburning low-bypass turbofan thrust tables, pitch-rate Command Augmentation System (`CAS`), and transonic wave-drag/lift-curve buildup.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<fdm_config name="Valkyrie_Mach18_DeltaWing_Demonstrator" version="2.0" release="PRODUCTION">
  <fileheader>
    <author>Dr. Sofia Rossi</author>
    <description>Supersonic Relaxed-Static-Stability Tailless Delta-Wing 6-DOF Flight Dynamics Model</description>
  </fileheader>

  <metrics>
    <wingarea unit="M2">48.50</wingarea>
    <wingspan unit="M">11.40</wingspan>
    <chord unit="M">5.25</chord>
    <htailarea unit="M2">0.00</htailarea>
    <vtailarea unit="M2">6.80</vtailarea>
    <location name="AERORP" unit="M">
      <x>7.42</x>
      <y>0.00</y>
      <z>0.12</z>
    </location>
  </metrics>

  <mass_balance>
    <ixx unit="KG*M2">24800.0</ixx>
    <iyy unit="KG*M2">92400.0</iyy>
    <izz unit="KG*M2">112500.0</izz>
    <ixz unit="KG*M2">1850.0</ixz>
    <emptywt unit="KG">9450.0</emptywt>
    <location name="CG" unit="M">
      <x>7.28</x>
      <y>0.00</y>
      <z>-0.08</z>
    </location>
  </mass_balance>

  <ground_reactions>
    <contact type="BOGEY" name="NOSE_GEAR">
      <location unit="M"><x>2.45</x><y>0.00</y><z>-1.82</z></location>
      <spring_coeff unit="N/M">185000.0</spring_coeff>
      <damping_coeff unit="N/M/SEC">24000.0</damping_coeff>
    </contact>
    <contact type="BOGEY" name="LEFT_MAIN_GEAR">
      <location unit="M"><x>8.15</x><y>-1.95</y><z>-1.78</z></location>
      <spring_coeff unit="N/M">420000.0</spring_coeff>
      <damping_coeff unit="N/M/SEC">48000.0</damping_coeff>
    </contact>
    <contact type="BOGEY" name="RIGHT_MAIN_GEAR">
      <location unit="M"><x>8.15</x><y>1.95</y><z>-1.78</z></location>
      <spring_coeff unit="N/M">420000.0</spring_coeff>
      <damping_coeff unit="N/M/SEC">48000.0</damping_coeff>
    </contact>
  </ground_reactions>

  <propulsion>
    <engine file="F414_Afterburning_Turbofan">
      <location unit="M"><x>11.20</x><y>0.00</y><z>0.00</z></location>
    </engine>
  </propulsion>

  <flight_control name="Digital_FlyByWire_Pitch_Roll_Yaw_CAS">
    <channel name="Pitch_Rate_CAS_Elevon">
      <summer name="fcs/pitch-error-sum">
        <input>fcs/elevator-cmd-norm</input>
        <input>-velocities/q-aero-rad_sec</input>
      </summer>
    </channel>
    <channel name="Roll_Rate_Damper_Aileron">
      <summer name="fcs/roll-rate-sum">
        <input>fcs/aileron-cmd-norm</input>
        <input>-velocities/p-aero-rad_sec</input>
      </summer>
    </channel>
  </flight_control>

  <aerodynamics>
    <axis name="LIFT">
      <function name="aero/force/Lift_alpha">
        <description>Lift_due_to_alpha_delta_wing</description>
      </function>
    </axis>
    <axis name="DRAG">
      <function name="aero/force/Drag_mach_wave">
        <description>Zero_lift_and_transonic_wave_drag</description>
      </function>
    </axis>
    <axis name="PITCH">
      <function name="aero/moment/Pitch_alpha_elevon">
        <description>Pitch_moment_static_margin_and_elevon_control</description>
      </function>
    </axis>
  </aerodynamics>
</fdm_config>
`,
    likedBy: ["omar", "vikram_patel", "elena_vance", "claire_dubois", "david_kowalski"],
    repostedBy: ["vikram_patel", "elena_vance"],
    bookmarkedBy: ["omar", "vikram_patel"],
    comments: [
      {
        authorUsername: "david_kowalski",
        createdHoursAgo: 27,
        content:
          "Notice `CG.x = 7.28 m` vs `AERORP.x = 7.42 m` at subsonic Mach (`+2.67% MAC` static margin), shifting aft to `7.78 m` (`+9.5% MAC`) above Mach 1.2 as the aerodynamic center migrates rearward!",
        likedBy: ["sofia_rossi", "vikram_patel", "omar"],
      },
    ],
  },

  // 33. CCSDS (.oem)
  {
    id: "seed-post-ccsds",
    language: "ccsds",
    viewType: "ccsds",
    title: "Lunar Gateway 9:2 NRHO Southern L2 Halo Orbit Ephemeris & Perilune Stationkeeping — CCSDS OEM 2.0",
    filename: "LunarGateway_NRHO_9to2_Ephemeris.oem",
    authorUsername: "sofia_rossi",
    createdHoursAgo: 24,
    postContent:
      "Published our CCSDS 502.0-B-2 Orbit Ephemeris Message (`.oem`) and polyglot astrodynamics architecture for the Lunar Gateway 9:2 synodic Near-Rectilinear Halo Orbit (`NRHO`, $r_p = 3{,}196\\text{ km}$, $r_a = 70{,}000\\text{ km}$). Includes EME2000 state vectors, $6 \\times 6$ RTN position-velocity covariance matrices, and apoapsis desaturation / perilune orbit maintenance $\\Delta v$ burns.",
    code: `CCSDS_OEM_VERS = 2.0
CREATION_DATE  = 2026-03-18T00:00:00Z
ORIGINATOR     = ESOC_FD_ASTRODYNAMICS

META_START
OBJECT_NAME          = LUNAR_GATEWAY_PPE_HALO
OBJECT_ID            = 2026-094A
CENTER_NAME          = MOON
REF_FRAME            = EME2000
REF_FRAME_EPOCH      = 2000-01-01T12:00:00.000
TIME_SYSTEM          = UTC
START_TIME           = 2026-03-18T00:00:00.000
USEABLE_START_TIME   = 2026-03-18T00:00:00.000
USEABLE_STOP_TIME    = 2026-03-18T06:00:00.000
STOP_TIME            = 2026-03-18T06:00:00.000
INTERPOLATION        = HERMITE
INTERPOLATION_DEGREE = 7
META_STOP

2026-03-18T00:00:00.000   124.850   -842.120   -3082.450   1.482100   0.312450  -0.084120
2026-03-18T01:00:00.000  5284.120    284.640   -4812.310   1.210450   0.298120  -0.642180
2026-03-18T02:00:00.000  9120.440   1318.920   -8145.620   0.945120   0.264810  -0.985410
2026-03-18T03:00:00.000 11985.760   2194.380  -12284.190   0.742180   0.221450  -1.148920
2026-03-18T04:00:00.000 14210.330   2918.540  -16742.880   0.589410   0.184210  -1.224150
2026-03-18T05:00:00.000 15984.620   3512.190  -21318.420   0.471250   0.151840  -1.258420
2026-03-18T06:00:00.000 17420.180   4002.840  -25940.150   0.378920   0.124610  -1.271890

COVARIANCE_START
EPOCH = 2026-03-18T06:00:00.000
COV_REF_FRAME = RTN
  1.450e-02
  2.100e-04  4.820e-02
 -1.800e-04  3.400e-04  2.910e-02
  1.150e-07  4.200e-07 -1.200e-07  2.150e-09
  3.800e-07  1.950e-07  2.100e-07  1.400e-10  5.420e-09
 -1.100e-07  2.800e-07  4.600e-07 -1.800e-10  2.200e-10  3.180e-09
COVARIANCE_STOP
`,
    likedBy: ["omar", "vikram_patel", "elena_vance", "claire_dubois", "sarah_lin"],
    repostedBy: ["vikram_patel", "claire_dubois"],
    bookmarkedBy: ["omar", "vikram_patel"],
    comments: [
      {
        authorUsername: "vikram_patel",
        createdHoursAgo: 22,
        content:
          "The 9:2 resonant NRHO completely avoids Earth-umbilical solar eclipses while keeping annual stationkeeping $\\Delta v$ below 18.5 m/s/yr on the 12 kW AEPS Hall thrusters.",
        likedBy: ["sofia_rossi", "omar"],
      },
    ],
  },

  // 34. SIMA (.sima)
  {
    id: "seed-post-sima",
    language: "sima",
    viewType: "sima",
    title: "12-Line Deepwater Semi-Submersible Floating Wind Platform — DNV-OS-E301 Mooring Spread (SIMA)",
    filename: "Deepwater_15MW_FOWT_Mooring_Spread.sima",
    authorUsername: "astrid_solberg",
    createdHoursAgo: 20,
    postContent:
      "Uploaded our SINTEF Ocean SIMA / SIMO-RIFLEX project deck (`.sima`) for a 15 MW 4-column semi-submersible Floating Offshore Wind Turbine (`FOWT`) in 320 m water depth under 100-year North Sea extreme sea state ($H_s = 14.2\\text{ m}$, $T_p = 15.8\\text{ s}$). Models a $3 \\times 4$ clustered chain-polyester-chain taut-catenary mooring spread verified against DNV-OS-E301 ULS and ALS line-break criteria.",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<simaProject version="4.4" name="NorthSea_15MW_SemiSub_Mooring_DNV_E301">
  <environment waterDepth="320.0" density="1025.0" seabedFriction="0.65" />
  <wave spectrum="jonswap" hs="14.2" tp="15.8" gamma="3.3" direction="15.0" />
  <wind speed="42.5" direction="15.0" />

  <vessel id="fowt_semisub_15mw" name="WindFloat_15MW_SemiSub" mass="21800000" displacement="21268.0" gmt="12.8" gml="12.8" cgx="0.0" cgy="0.0" cgz="-14.2" rxx="34.5" ryy="34.5" rzz="38.2">
    <fairlead id="fl_c1" name="Column1_North_Fairlead" x="48.5" y="0.0" z="-18.0" />
    <fairlead id="fl_c2" name="Column2_SW_Fairlead" x="-24.25" y="42.0" z="-18.0" />
    <fairlead id="fl_c3" name="Column3_SE_Fairlead" x="-24.25" y="-42.0" z="-18.0" />
  </vessel>

  <mooringLine id="line_1" name="Cluster1_Line1_NNE" type="catenary" fairleadId="fl_c1" anchorX="885.0" anchorY="120.0" anchorZ="-320.0">
    <segment id="l1_s1" name="Bottom_R4_Studless_Chain" length="220.0" diameter="0.147" dryMass="432.0" subWeight="3680.0" ea="1.68e9" mbl="2.12e7" />
    <segment id="l1_s2" name="Mid_Polyester_Rope" length="580.0" diameter="0.220" dryMass="38.5" subWeight="95.0" ea="3.45e8" mbl="2.25e7" />
    <segment id="l1_s3" name="Top_Fairlead_Chain" length="95.0" diameter="0.147" dryMass="432.0" subWeight="3680.0" ea="1.68e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_2" name="Cluster1_Line2_N" type="catenary" fairleadId="fl_c1" anchorX="895.0" anchorY="0.0" anchorZ="-320.0">
    <segment id="l2_s1" name="Composite_Catenary_Line2" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_3" name="Cluster1_Line3_NNW" type="catenary" fairleadId="fl_c1" anchorX="885.0" anchorY="-120.0" anchorZ="-320.0">
    <segment id="l3_s1" name="Composite_Catenary_Line3" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_4" name="Cluster1_Line4_NW" type="catenary" fairleadId="fl_c1" anchorX="840.0" anchorY="-235.0" anchorZ="-320.0">
    <segment id="l4_s1" name="Composite_Catenary_Line4" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_5" name="Cluster2_Line5_WSW" type="catenary" fairleadId="fl_c2" anchorX="-340.0" anchorY="810.0" anchorZ="-320.0">
    <segment id="l5_s1" name="Composite_Catenary_Line5" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_6" name="Cluster2_Line6_SW" type="catenary" fairleadId="fl_c2" anchorX="-445.0" anchorY="775.0" anchorZ="-320.0">
    <segment id="l6_s1" name="Composite_Catenary_Line6" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_7" name="Cluster2_Line7_SSW" type="catenary" fairleadId="fl_c2" anchorX="-540.0" anchorY="710.0" anchorZ="-320.0">
    <segment id="l7_s1" name="Composite_Catenary_Line7" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_8" name="Cluster2_Line8_S" type="catenary" fairleadId="fl_c2" anchorX="-620.0" anchorY="635.0" anchorZ="-320.0">
    <segment id="l8_s1" name="Composite_Catenary_Line8" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_9" name="Cluster3_Line9_SSE" type="catenary" fairleadId="fl_c3" anchorX="-340.0" anchorY="-810.0" anchorZ="-320.0">
    <segment id="l9_s1" name="Composite_Catenary_Line9" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_10" name="Cluster3_Line10_SE" type="catenary" fairleadId="fl_c3" anchorX="-445.0" anchorY="-775.0" anchorZ="-320.0">
    <segment id="l10_s1" name="Composite_Catenary_Line10" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_11" name="Cluster3_Line11_ESE" type="catenary" fairleadId="fl_c3" anchorX="-540.0" anchorY="-710.0" anchorZ="-320.0">
    <segment id="l11_s1" name="Composite_Catenary_Line11" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>

  <mooringLine id="line_12" name="Cluster3_Line12_E" type="catenary" fairleadId="fl_c3" anchorX="-620.0" anchorY="-635.0" anchorZ="-320.0">
    <segment id="l12_s1" name="Composite_Catenary_Line12" length="895.0" diameter="0.147" dryMass="290.0" subWeight="2450.0" ea="1.15e9" mbl="2.12e7" />
  </mooringLine>
</simaProject>
`,
    likedBy: ["omar", "kenji_takahashi", "henrik_lindqvist", "nadia_almansoor", "mateo_silva"],
    repostedBy: ["kenji_takahashi"],
    bookmarkedBy: ["omar", "kenji_takahashi"],
    comments: [
      {
        authorUsername: "kenji_takahashi",
        createdHoursAgo: 18,
        content:
          "How does the 66 kV dynamic inter-array umbilical cable curvature hold up when `line_2` (`Cluster1_Line2_N`) is severed in the DNV-OS-E301 ALS single-line failure case?",
        likedBy: ["astrid_solberg", "omar"],
        replies: [
          {
            authorUsername: "astrid_solberg",
            createdHoursAgo: 16,
            content:
              "With 4 lines per column cluster (`3x4` spread), ALS transient excursion peaks at 24.8 m (within our 28.0 m watch circle limit for the lazy-wave dynamic cable bend stiffener) and adjacent `line_1` peak tension reaches 13.4 MN vs 21.2 MN MBL (`SF = 1.58`).",
            likedBy: ["kenji_takahashi", "omar"],
          },
        ],
      },
    ],
  },
];
