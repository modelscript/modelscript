// SPDX-License-Identifier: AGPL-3.0-or-later

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
}

export const PLAYGROUND_LANGUAGES: PlaygroundLanguageOption[] = [
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
  { id: "modelscript", label: "ModelScript (.msx)", ext: ".msx" },
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
    code: `<project name="IEEE2800_IBR_Benchmark" version="5.0">
  <definitions>
    <definition name="Main">
      <schematic>
        <comp id="src1" name="VSC_Inverter" type="source" bus1="1" kv="34.5" mva="100.0" />
        <comp id="xfmr1" name="GSU_Transformer" type="transformer" bus1="1" bus2="2" mva="120.0" xpu="0.08" />
        <comp id="line1" name="Collector_Line" type="branch" bus1="2" bus2="3" r="0.005" x="0.045" b="0.02" />
        <comp id="grid1" name="Infinite_Bus" type="source" bus1="3" kv="230.0" mva="2500.0" />
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
];
