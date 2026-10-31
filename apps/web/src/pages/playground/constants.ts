// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import { getLanguageFlagKey, isLanguageEnabledInFlags, useFeatureFlags } from "../../FeatureFlagContext";
import { isLanguageFlagEnabled } from "../../components/morsel/constants";

export interface HeroExample {
  id: string;
  title: string;
  category: string;
  lang: string;
  code: string;
}

export interface PlaygroundLanguageOption {
  id: string;
  label: string;
  ext: string;
  featureFlag?: string | undefined;
  hiddenByDefault?: boolean | undefined;
}

export const ALL_PLAYGROUND_LANGUAGES: PlaygroundLanguageOption[] = [
  { id: "modelica", label: "Modelica 3.x", ext: ".mo" },
  { id: "sysml2", label: "SysML v2 / KerML", ext: ".sysml" },
  { id: "scad", label: "OpenSCAD (CSG)", ext: ".scad" },
  { id: "owl2", label: "OWL2 Ontology", ext: ".owl" },
  { id: "pscad", label: "PSCAD (EMT)", ext: ".pscx" },
  { id: "spice", label: "SPICE Circuit", ext: ".sp" },
  { id: "fea", label: "FEA Deck (CalculiX/Abaqus)", ext: ".inp" },
  { id: "cfd", label: "CFD Config (SU2)", ext: ".cfg" },
  { id: "step", label: "STEP (ISO 10303)", ext: ".step" },
  { id: "ssp", label: "SSP Architecture", ext: ".ssd" },
  { id: "psse", label: "PSS/E Power Flow", ext: ".raw" },
  { id: "gensys", label: "GENSYS Railway", ext: ".tsimf" },
  { id: "simpack", label: "SIMPACK Multibody", ext: ".spck" },
  {
    id: "modelscript",
    label: "ModelScript (.msx)",
    ext: ".msx",
    featureFlag: "lang_modelscript",
    hiddenByDefault: true,
  },
  { id: "verilog-a", label: "Verilog-A", ext: ".va" },
  { id: "c", label: "C (Embedded)", ext: ".c" },
  { id: "fortran", label: "Fortran 90", ext: ".f90" },
  { id: "plcopen", label: "PLCopen ST (IEC 61131-3)", ext: ".st" },
  { id: "autosar", label: "AUTOSAR ARXML", ext: ".arxml" },
  { id: "simulink", label: "Simulink Model", ext: ".mdl" },
  { id: "reqif", label: "ReqIF Requirements", ext: ".reqif" },
  { id: "ccsds", label: "CCSDS Orbit Ephemeris", ext: ".oem" },
  { id: "opendrive", label: "OpenDRIVE Road Network", ext: ".xodr" },
  { id: "openscenario", label: "OpenSCENARIO", ext: ".xosc" },
  { id: "urdf", label: "URDF Robotics", ext: ".urdf" },
  { id: "adams", label: "ADAMS Multibody", ext: ".adm" },
  { id: "sima", label: "SIMA Offshore Mooring", ext: ".sima" },
  { id: "olga", label: "OLGA Multiphase Flow", ext: ".opi" },
  { id: "lps", label: "LPS Pipeline", ext: ".lps" },
  { id: "epanet", label: "EPANET Hydraulic", ext: ".inp" },
  { id: "swmm", label: "SWMM Stormwater", ext: ".swmm" },
  { id: "gtsuite", label: "GT-SUITE Powertrain", ext: ".gtm" },
  { id: "easy5", label: "Easy5 Controls", ext: ".ez5" },
  { id: "rocets", label: "ROCETS Rocket Propulsion", ext: ".roc" },
  { id: "relap5", label: "RELAP5 Thermal-Hydraulics", ext: ".r5" },
  { id: "energyplus", label: "EnergyPlus Building HVAC", ext: ".idf" },
  { id: "aspen", label: "Aspen Process Flowsheet", ext: ".aspen" },
  { id: "eclipse", label: "ECLIPSE Reservoir", ext: ".data" },
  { id: "sbml", label: "SBML Systems Biology", ext: ".sbml" },
  { id: "jsbsim", label: "JSBSim Flight Dynamics", ext: ".jsbsim" },
  { id: "touchstone", label: "Touchstone RF S-Params", ext: ".s2p" },
  { id: "ibis", label: "IBIS Signal Integrity", ext: ".ibs" },
  { id: "opendss", label: "OpenDSS Distribution Grid", ext: ".dss" },
  { id: "csv", label: "CSV Tabular Dataset", ext: ".csv" },
];

export const PLAYGROUND_LANGUAGES: PlaygroundLanguageOption[] = ALL_PLAYGROUND_LANGUAGES.filter((lang) =>
  isLanguageFlagEnabled(lang.featureFlag ?? getLanguageFlagKey(lang.id), !lang.hiddenByDefault),
);

export function getVisiblePlaygroundLanguages(isFlagEnabled?: (key: string) => boolean): PlaygroundLanguageOption[] {
  return ALL_PLAYGROUND_LANGUAGES.filter((lang) => {
    if (isFlagEnabled) {
      return isLanguageEnabledInFlags(lang.id, isFlagEnabled);
    }
    return isLanguageFlagEnabled(lang.featureFlag ?? getLanguageFlagKey(lang.id), !lang.hiddenByDefault);
  });
}

export function useVisiblePlaygroundLanguages(): PlaygroundLanguageOption[] {
  const { isEnabled } = useFeatureFlags();
  return useMemo(() => getVisiblePlaygroundLanguages(isEnabled), [isEnabled]);
}

export const HERO_EXAMPLES: HeroExample[] = [
  {
    id: "rlc-circuit",
    title: "RLC Resonant Circuit",
    category: "Electrical",
    lang: "modelica",
    code: `model RLCCircuit "Second-order series RLC resonant circuit"
  parameter Real R = 0.5 "Resistance (Ohm)";
  parameter Real L = 0.1 "Inductance (H)";
  parameter Real C = 0.01 "Capacitance (F)";
  parameter Real V0 = 12.0 "Step Input Voltage (V)";

  Real i(start = 0.0) "Inductor current (A)";
  Real v_c(start = 0.0) "Capacitor voltage (V)";
equation
  L * der(i) + R * i + v_c = V0;
  C * der(v_c) = i;
end RLCCircuit;`,
  },
  {
    id: "bouncing-ball",
    title: "Hybrid Bouncing Ball",
    category: "Mechanics",
    lang: "modelica",
    code: `model BouncingBall "Gravitational free-fall with restitution damping"
  parameter Real g = 9.81 "Gravity (m/s2)";
  parameter Real e = 0.8 "Coefficient of restitution";
  parameter Real k_ground = 5000.0 "Contact stiffness";
  parameter Real c_ground = 45.0 "Contact damping";

  Real h(start = 5.0) "Altitude (m)";
  Real v(start = 0.0) "Vertical velocity (m/s)";
equation
  der(h) = v;
  der(v) = -g + (if h < 0 then -k_ground * h - c_ground * v else 0.0);
end BouncingBall;`,
  },
  {
    id: "lorenz-attractor",
    title: "Lorenz Chaotic Attractor",
    category: "Nonlinear Dynamics",
    lang: "modelica",
    code: `model LorenzAttractor "Three-dimensional chaotic convection system"
  parameter Real sigma = 10.0 "Prandtl number";
  parameter Real rho = 28.0 "Rayleigh number";
  parameter Real beta = 2.6667 "Geometric factor";

  Real x(start = 1.0);
  Real y(start = 0.0);
  Real z(start = 0.0);
equation
  der(x) = sigma * (y - x);
  der(y) = x * (rho - z) - y;
  der(z) = x * y - beta * z;
end LorenzAttractor;`,
  },
  {
    id: "sysml-satellite",
    title: "CubeSat Power Architecture",
    category: "SysML v2",
    lang: "sysml2",
    code: `package CubeSatPowerSystem {
  part def SolarArray {
    attribute peakPower : Real = 48.0;
    port dcOut;
  }
  part def BatteryPack {
    attribute capacityWh : Real = 120.0;
    port powerBus;
  }
  part def AvionicsPayload {
    attribute nominalDrawW : Real = 18.5;
    port powerIn;
  }
  part cubeSat {
    part solar : SolarArray;
    part battery : BatteryPack;
    part payload : AvionicsPayload;
    connect solar.dcOut to battery.powerBus;
    connect battery.powerBus to payload.powerIn;
  }
}`,
  },
  {
    id: "scad-flanged-hub",
    title: "Parametric Flanged Drive Hub",
    category: "OpenSCAD CSG",
    lang: "scad",
    code: `// Parametric Aerospace Flanged Drive Hub
$fn = 48;
flange_radius = 42;
flange_thickness = 8;
hub_radius = 22;
hub_height = 32;
bore_radius = 10;

difference() {
  union() {
    cylinder(h = flange_thickness, r = flange_radius, center = false);
    cylinder(h = hub_height, r = hub_radius, center = false);
  }
  translate([0, 0, -1])
    cylinder(h = hub_height + 2, r = bore_radius, center = false);
  for (i = [0 : 5]) {
    rotate([0, 0, i * 60])
      translate([31, 0, -1])
        cylinder(h = flange_thickness + 2, r = 4, center = false);
  }
}`,
  },
  {
    id: "owl2-propulsion-ontology",
    title: "Aerospace Propulsion Ontology",
    category: "OWL2 Ontology",
    lang: "owl2",
    code: `Prefix(:=<http://modelscript.org/ontologies/propulsion#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)
Prefix(rdfs:=<http://www.w3.org/2000/01/rdf-schema#>)

Ontology(<http://modelscript.org/ontologies/propulsion>
  Declaration(Class(:PropulsionSystem))
  Declaration(Class(:LiquidRocketEngine))
  Declaration(Class(:TurbopumpAssembly))
  Declaration(Class(:ThrustChamber))
  Declaration(ObjectProperty(:hasSubsystem))

  SubClassOf(:LiquidRocketEngine :PropulsionSystem)
  SubClassOf(:LiquidRocketEngine ObjectSomeValuesFrom(:hasSubsystem :TurbopumpAssembly))
  SubClassOf(:LiquidRocketEngine ObjectSomeValuesFrom(:hasSubsystem :ThrustChamber))
  DisjointClasses(:TurbopumpAssembly :ThrustChamber)
)`,
  },
  {
    id: "pscad-ieee2800-inverter",
    title: "IEEE 2800 Grid-Forming Inverter",
    category: "PSCAD EMT",
    lang: "pscad",
    code: `<project name="IEEE2800_IBR_Benchmark" version="5.0.1">
  <definitions>
    <definition name="Main">
      <schematic>
        <User classid="UserCmp" id="u1" name="master:source_3" x="126" y="180">
          <paramlist>
            <param name="Name" value="Grid230kV_Thevenin" />
            <param name="Vm" value="230.0 [kV]" />
            <param name="F0" value="60.0 [Hz]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u2" name="master:tline" x="252" y="180">
          <paramlist>
            <param name="Name" value="Collector_Line" />
            <param name="Length" value="42.0 [km]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u3" name="master:xfmr-3p2w" x="396" y="180">
          <paramlist>
            <param name="Name" value="GSU_Transformer" />
            <param name="Tmva" value="120.0 [MVA]" />
            <param name="Xl" value="0.08 [pu]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u4" name="master:inverter_fmu" x="540" y="180">
          <paramlist>
            <param name="Name" value="VSC_Inverter" />
            <param name="H_virt" value="4.5 [s]" />
          </paramlist>
        </User>
        <Wire classid="WireOrthogonal" id="w1" x="162" y="180">
          <vertex x="0" y="0" />
          <vertex x="54" y="0" />
        </Wire>
        <Wire classid="WireOrthogonal" id="w2" x="288" y="180">
          <vertex x="0" y="0" />
          <vertex x="54" y="0" />
        </Wire>
        <Wire classid="WireOrthogonal" id="w3" x="432" y="180">
          <vertex x="0" y="0" />
          <vertex x="88" y="0" />
        </Wire>
      </schematic>
    </definition>
  </definitions>
</project>`,
  },
  {
    id: "spice-lowpass-filter",
    title: "Active Sallen-Key Filter",
    category: "SPICE Circuit",
    lang: "spice",
    code: `* Second-Order Sallen-Key Low-Pass Filter
V1 in 0 SIN(0 1.0 1000) AC 1.0
R1 in n1 10k
R2 n1 out 10k
C1 n1 out 15.9n
C2 out 0 15.9n
Rload out 0 100k
.tran 10u 5m
.ac dec 20 10 100k
.end`,
  },
  {
    id: "fea-bracket-deck",
    title: "Titanium Actuator Bracket FEA",
    category: "CalculiX FEA",
    lang: "fea",
    code: `*HEADING
Ti-6Al-4V Aerospace Actuator Bracket Static Stress Analysis
*NODE
1, 0.0, 0.0, 0.0
2, 100.0, 0.0, 0.0
3, 100.0, 50.0, 0.0
4, 0.0, 50.0, 0.0
5, 0.0, 0.0, 12.0
6, 100.0, 0.0, 12.0
7, 100.0, 50.0, 12.0
8, 0.0, 50.0, 12.0
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 4, 5, 6, 7, 8
*MATERIAL, NAME=TI6AL4V
*ELASTIC
114000.0, 0.34
*SOLID SECTION, ELSET=EALL, MATERIAL=TI6AL4V
*BOUNDARY
1, 1, 3
4, 1, 3
5, 1, 3
8, 1, 3
*STEP
*STATIC
*CLOAD
2, 3, -4500.0
3, 3, -4500.0
*END STEP`,
  },
  {
    id: "cfd-rae2822-su2",
    title: "RAE 2822 Transonic Airfoil CFD",
    category: "SU2 CFD",
    lang: "cfd",
    code: `% SU2 Configuration: RAE 2822 Transonic Airfoil
SOLVER= RANS
KIND_TURB_MODEL= SA
MATH_PROBLEM= DIRECT
MACH_NUMBER= 0.729
AOA= 2.31
FREESTREAM_TEMPERATURE= 288.15
REYNOLDS_NUMBER= 6.5E6
REYNOLDS_LENGTH= 1.0
NUM_METHOD_GRAD= GREEN_GAUSS
CFL_NUMBER= 10.0
ITER= 250
MESH_FILENAME= mesh_RAE2822_turb.su2
CONV_FILENAME= history`,
  },
  {
    id: "step-aerospace-bracket",
    title: "Aerospace Actuator Housing STEP",
    category: "STEP ISO 10303",
    lang: "step",
    code: `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('Aerospace Ti-6Al-4V Bracket','AP242 Manifold B-Rep'),'2;1');
FILE_NAME('Aerospace_Bracket.step','2026-01-01T00:00:00',('ModelScript'),(''),'','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#1 = PRODUCT('AEROSPACE_BRACKET','Aerospace Actuator Bracket','',());
#101 = CARTESIAN_POINT('P1',(-50.0,-30.0,0.0));
#102 = CARTESIAN_POINT('P2',( 50.0,-30.0,0.0));
#103 = CARTESIAN_POINT('P3',( 50.0, 30.0,0.0));
#104 = CARTESIAN_POINT('P4',(-50.0, 30.0,0.0));
#105 = CARTESIAN_POINT('P5',(-50.0,-30.0,15.0));
#106 = CARTESIAN_POINT('P6',( 50.0,-30.0,15.0));
#107 = CARTESIAN_POINT('P7',( 50.0, 30.0,15.0));
#108 = CARTESIAN_POINT('P8',(-50.0, 30.0,15.0));
#201 = POLY_LOOP('BOT',(#101,#104,#103,#102));
#202 = POLY_LOOP('TOP',(#105,#106,#107,#108));
#203 = POLY_LOOP('FRONT',(#101,#102,#106,#105));
#204 = POLY_LOOP('RIGHT',(#102,#103,#107,#106));
#205 = POLY_LOOP('BACK',(#103,#104,#108,#107));
#206 = POLY_LOOP('LEFT',(#104,#101,#105,#108));
#301 = FACE_OUTER_BOUND('',#201,.T.);
#302 = FACE_OUTER_BOUND('',#202,.T.);
#303 = FACE_OUTER_BOUND('',#203,.T.);
#304 = FACE_OUTER_BOUND('',#204,.T.);
#305 = FACE_OUTER_BOUND('',#205,.T.);
#306 = FACE_OUTER_BOUND('',#206,.T.);
#401 = ADVANCED_FACE('Bottom',(#301),#1,.T.);
#402 = ADVANCED_FACE('Top',(#302),#1,.T.);
#403 = ADVANCED_FACE('Front',(#303),#1,.T.);
#404 = ADVANCED_FACE('Right',(#304),#1,.T.);
#405 = ADVANCED_FACE('Back',(#305),#1,.T.);
#406 = ADVANCED_FACE('Left',(#306),#1,.T.);
#501 = CLOSED_SHELL('Shell',(#401,#402,#403,#404,#405,#406));
#601 = MANIFOLD_SOLID_BREP('AerospaceBracket',#501);
ENDSEC;
END-ISO-10303-21;`,
  },
  {
    id: "simpack-pendulum",
    title: "Wind Turbine Planetary Drivetrain",
    category: "SIMPACK MBS",
    lang: "simpack",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<SimpackModel name="Planetary_Drivetrain_MBS" version="2026.1">
  <Body id="bedplate" name="Nacelle_Bedplate" mass="42000.0" ixx="180000.0" iyy="220000.0" izz="250000.0">
    <Marker id="m_bed_brg" name="MainBearing_Seat" x="0.0" y="0.0" z="1.5" />
  </Body>
  <Body id="rotor_shaft" name="Rotor_LowSpeed_Shaft" mass="68000.0" ixx="8500000.0" iyy="4200000.0" izz="4200000.0">
    <Marker id="m_lss_brg" name="LSS_Journal" x="0.0" y="0.0" z="1.5" />
    <Marker id="m_lss_end" name="LSS_Carrier_Spline" x="-2.4" y="0.0" z="1.5" />
  </Body>
  <Body id="sun_gear" name="Helical_Sun_Gear" mass="2400.0" ixx="1420.0" iyy="980.0" izz="980.0">
    <Marker id="m_sun_center" name="Sun_Center" x="-2.4" y="0.0" z="1.5" />
  </Body>
  <Joint id="j_lss_rev" name="Main_LSS_Revolute" type="revolute" from="m_bed_brg" to="m_lss_brg" />
  <Joint id="j_sun_rev" name="Sun_Gear_Revolute" type="revolute" from="m_lss_end" to="m_sun_center" />
  <Force id="f_mesh" name="Tooth_Mesh_Stiffness" from="m_lss_end" to="m_sun_center" kx="8.5e8" ky="1.2e9" kz="6.4e8" cx="2.5e5" cy="3.2e5" cz="1.8e5" />
</SimpackModel>`,
  },
  {
    id: "gensys-bogie",
    title: "High-Speed Rail Vehicle Bogie",
    category: "GENSYS Railway",
    lang: "gensys",
    code: `# GENSYS High-Speed Rail Bogie & EN 14363 Stability Model
set v_kmh = 250.0
set v_ms  = v_kmh / 3.6
speed v_ms
tstart 0.0
tstop  8.0
dt     0.001

body carbody  36000.0  58000.0  1650000.0  1620000.0   0.0  0.0  1.80
body bogie_f   2600.0   1750.0     3100.0     4100.0   9.0  0.0  0.60
wheelset axle_1  1550.0  840.0  110.0  840.0  1.435  0.460  0.15  "S1002_UIC60.whe"
wheelset axle_2  1550.0  840.0  110.0  840.0  1.435  0.460  0.15  "S1002_UIC60.whe"

spring k_prim_1  bogie_f  axle_1   15.0e6  5.5e6  1.1e6  10000.0  8000.0  16000.0
spring k_prim_2  bogie_f  axle_2   15.0e6  5.5e6  1.1e6  10000.0  8000.0  16000.0
spring k_sec_f   carbody  bogie_f   0.16e6  0.16e6 0.40e6 900000.0 25000.0 30000.0`,
  },
];
