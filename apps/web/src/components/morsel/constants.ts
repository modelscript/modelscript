// SPDX-License-Identifier: AGPL-3.0-or-later

export const defaultCode = `model Untitled
  Modelica.Blocks.Sources.Sine sine(f = 1)
    annotation(Placement(transformation(origin = {-46, 22}, extent = {{-10, -10}, {10, 10}})));
  Modelica.Blocks.Continuous.Integrator integrator
    annotation(Placement(transformation(origin = {10, 22}, extent = {{-10, -10}, {10, 10}})));
equation
  connect(sine.y, integrator.u)
    annotation(Line(points = {{-35, 22}, {-2, 22}}, color = {0, 0, 127}));
  annotation(
    Icon(coordinateSystem(preserveAspectRatio = false)),
    Diagram(coordinateSystem(preserveAspectRatio = false))
  );
end Untitled;
`;

export const SIMULATION_COLORS: string[] = [
  "#58a6ff",
  "#3fb950",
  "#f0883e",
  "#a371f7",
  "#f778ba",
  "#79c0ff",
  "#d29922",
  "#ff7b72",
  "#56d364",
  "#bc8cff",
];

export interface MorselDiagramTypeOption {
  id: string;
  label: string;
}

export type MorselSyntaxFamily =
  | "modelica"
  | "sysml2"
  | "step"
  | "owl2"
  | "scad"
  | "c"
  | "fortran"
  | "spice"
  | "xml"
  | "ini"
  | "csv"
  | "verilog-a"
  | "plcopen"
  | "simulink";

export interface MorselLanguageInfo {
  id: string;
  name: string;
  label?: string | undefined;
  ext: string;
  extensions: string[];
  family: MorselSyntaxFamily;
  defaultCode: string;
  supportsDiagram: boolean;
  supportsSimulation: boolean;
  supports3d: boolean;
  diagramTypes?: MorselDiagramTypeOption[];
}

export const MORSEL_LANGUAGES: readonly MorselLanguageInfo[] = [
  {
    id: "modelica",
    name: "Modelica",
    ext: "mo",
    extensions: [".mo", ".mos", ".msim"],
    family: "modelica",
    defaultCode,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
    diagramTypes: [
      { id: "diagram", label: "Diagram" },
      { id: "icon", label: "Icon" },
    ],
  },
  {
    id: "modelscript",
    name: "ModelScript",
    ext: "msx",
    extensions: [".msx", ".modelscript"],
    family: "modelica",
    defaultCode: `model Oscillator
  parameter Real omega = 6.2831853;
  Real x(start = 1.0);
  Real v(start = 0.0);
equation
  der(x) = v;
  der(v) = -omega ^ 2 * x;
end Oscillator;
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
    diagramTypes: [
      { id: "diagram", label: "Diagram" },
      { id: "icon", label: "Icon" },
    ],
  },
  {
    id: "sysml2",
    name: "SysML v2",
    ext: "sysml",
    extensions: [".sysml", ".sysml2", ".kerml"],
    family: "sysml2",
    defaultCode: `package VehicleSystem {
  part def Vehicle {
    attribute mass : Real = 1500.0;
    part engine : Engine;
    part transmission : Transmission;
  }
  part def Engine {
    attribute maxPower : Real = 180.0;
  }
  part def Transmission {
    attribute gearRatio : Real = 3.42;
  }
}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
    diagramTypes: [
      { id: "bdd", label: "BDD" },
      { id: "ibd", label: "IBD" },
      { id: "stateMachine", label: "State" },
      { id: "requirement", label: "Requirements" },
    ],
  },
  {
    id: "step",
    name: "STEP (ISO 10303-21)",
    ext: "step",
    extensions: [".step", ".stp", ".p21"],
    family: "step",
    defaultCode: `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ModelScript STEP Example'),'2;1');
FILE_NAME('document.step','2026-01-01T00:00:00',('ModelScript'),(''), '','','');
FILE_SCHEMA(('AUTOMOTIVE_DESIGN'));
ENDSEC;
DATA;
#10 = CARTESIAN_POINT('Origin',(0.0,0.0,0.0));
#20 = DIRECTION('Z_Axis',(0.0,0.0,1.0));
#30 = DIRECTION('X_Axis',(1.0,0.0,0.0));
#40 = AXIS2_PLACEMENT_3D('Placement',#10,#20,#30);
ENDSEC;
END-ISO-10303-21;
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: true,
  },
  {
    id: "owl2",
    name: "OWL 2 Functional",
    ext: "owl",
    extensions: [".owl", ".ofn", ".fss", ".owl2"],
    family: "owl2",
    defaultCode: `Prefix(:=<http://example.org/engineering#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)

Ontology(<http://example.org/engineering>
  Declaration(Class(:Component))
  Declaration(Class(:Sensor))
  Declaration(Class(:Actuator))
  SubClassOf(:Sensor :Component)
  SubClassOf(:Actuator :Component)
)
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "scad",
    name: "OpenSCAD",
    ext: "scad",
    extensions: [".scad"],
    family: "scad",
    defaultCode: `// Parametric mounting bracket
$fn = 48;
difference() {
  cube([40, 30, 8], center = true);
  cylinder(h = 12, r = 6, center = true);
}
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: true,
  },
  {
    id: "csv",
    name: "CSV",
    ext: "csv",
    extensions: [".csv", ".tsv"],
    family: "csv",
    defaultCode: `time,voltage,current
0.0,0.0,0.0
0.1,3.3,0.12
0.2,4.8,0.24
0.3,5.0,0.25
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "c",
    name: "C",
    ext: "c",
    extensions: [".c", ".h"],
    family: "c",
    defaultCode: `// Embedded PI controller step
double pi_step(double setpoint, double measurement, double *integral, double dt) {
  const double kp = 1.5;
  const double ki = 0.4;
  double error = setpoint - measurement;
  *integral += error * dt;
  return kp * error + ki * (*integral);
}
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "fortran",
    name: "Fortran",
    ext: "f90",
    extensions: [".f90", ".f95", ".f03", ".f08", ".f", ".for"],
    family: "fortran",
    defaultCode: `program harmonic_oscillator
  implicit none
  real(8) :: x = 1.0d0, v = 0.0d0, dt = 0.01d0, omega = 6.2831853d0
  integer :: i
  do i = 1, 100
    v = v - (omega ** 2) * x * dt
    x = x + v * dt
  end do
end program harmonic_oscillator
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "spice",
    name: "SPICE",
    ext: "cir",
    extensions: [".cir", ".sp", ".net", ".lib", ".sub"],
    family: "spice",
    defaultCode: `* RC Low-Pass Filter
V1 in 0 SIN(0 5 1k)
R1 in out 1k
C1 out 0 100n
.tran 10u 5m
.end
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "verilog-a",
    name: "Verilog-A",
    ext: "va",
    extensions: [".va", ".vams"],
    family: "verilog-a",
    defaultCode: `\`include "disciplines.vams"

module resistor(p, n);
  inout p, n;
  electrical p, n;
  parameter real R = 1000.0 from (0:inf);

  analog begin
    V(p, n) <+ R * I(p, n);
  end
endmodule
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "pscad",
    name: "PSCAD",
    ext: "pscx",
    extensions: [".pscx", ".pslx", ".pswx", ".psmx"],
    family: "xml",
    defaultCode: `<project name="SimpleGrid" version="5.0">
  <definitions>
    <definition name="Main">
      <schematic>
        <component id="Vsrc" type="Source3Ph" Vbase="230.0" freq="60.0" />
        <component id="Load1" type="RLCLoad" P="50.0" Q="15.0" />
      </schematic>
    </definition>
  </definitions>
</project>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "psse",
    name: "PSS/E",
    ext: "raw",
    extensions: [".raw", ".dyr", ".seq"],
    family: "spice",
    defaultCode: `0, 100.0, 33, 0, 1, 60.0 / PSS/E 3-Bus Sample
1, 'BUS_1   ', 230.0, 3, 1, 1, 1, 1.02, 0.0
2, 'BUS_2   ', 230.0, 1, 1, 1, 1, 1.00, -2.5
0 / END OF BUS DATA, BEGIN LOAD DATA
2, '1 ', 1, 1, 1, 120.0, 40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "opendss",
    name: "OpenDSS",
    ext: "dss",
    extensions: [".dss"],
    family: "spice",
    defaultCode: `Clear
New Circuit.Feeder1 basekv=12.47 pu=1.02 phases=3 bus1=SourceBus
New Line.Line1 Phases=3 Bus1=SourceBus Bus2=LoadBus R1=0.19 X1=0.38 Length=1.5 units=km
New Load.Load1 Phases=3 Bus1=LoadBus kV=12.47 kW=1200 kvar=400
Solve
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "plcopen",
    name: "PLCopen / IEC 61131-3",
    ext: "st",
    extensions: [".st", ".plcopen", ".iec"],
    family: "plcopen",
    defaultCode: `PROGRAM PumpControl
VAR
  TankLevel : REAL := 45.0;
  SetPoint : REAL := 60.0;
  PumpActive : BOOL := FALSE;
END_VAR

IF TankLevel < SetPoint - 5.0 THEN
  PumpActive := TRUE;
ELSIF TankLevel > SetPoint + 5.0 THEN
  PumpActive := FALSE;
END_IF;
END_PROGRAM
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "simulink",
    name: "MATLAB Simulink",
    ext: "mdl",
    extensions: [".mdl", ".slx"],
    family: "simulink",
    defaultCode: `Model {
  Name "FirstOrderPlant"
  System {
    Name "FirstOrderPlant"
    Block {
      BlockType Step
      Name "StepInput"
    }
    Block {
      BlockType TransferFcn
      Name "Plant"
      Numerator "[1]"
      Denominator "[1 2]"
    }
    Line {
      SrcBlock "StepInput"
      SrcPort 1
      DstBlock "Plant"
      DstPort 1
    }
  }
}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "ssp",
    name: "SSP",
    ext: "ssd",
    extensions: [".ssd", ".ssv", ".ssm", ".ssp"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="DriveSystem" version="1.0">
  <ssd:System name="Root">
    <ssd:Elements>
      <ssd:Component name="Controller" source="resources/Controller.fmu" />
      <ssd:Component name="Plant" source="resources/Plant.fmu" />
    </ssd:Elements>
  </ssd:System>
</ssd:SystemStructureDescription>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "urdf",
    name: "ROS URDF / SDFormat",
    ext: "urdf",
    extensions: [".urdf", ".sdf", ".xacro"],
    family: "xml",
    defaultCode: `<?xml version="1.0"?>
<robot name="two_link_arm">
  <link name="base_link" />
  <link name="arm_link" />
  <joint name="shoulder_joint" type="revolute">
    <parent link="base_link" />
    <child link="arm_link" />
    <origin xyz="0 0 0.25" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-1.57" upper="1.57" effort="50" velocity="2.0" />
  </joint>
</robot>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "adams",
    name: "MSC Adams",
    ext: "adm",
    extensions: [".adm", ".cmd", ".acf"],
    family: "ini",
    defaultCode: `ADAMS/View Pendulum Dataset
PART/1, GROUND
PART/2, MASS = 2.5, CM = 20, IP = 0.1, 0.1, 0.1
MARKER/10, PART = 1, QP = 0, 0, 0
MARKER/20, PART = 2, QP = 0, -0.5, 0
JOINT/1, REVOLUTE, I = 10, J = 20
ACCGRAV/JGRAV = -9.80665
END
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "simpack",
    name: "SIMPACK",
    ext: "spck",
    extensions: [".spck", ".sim", ".sub"],
    family: "ini",
    defaultCode: `! SIMPACK Multibody Model
header.title = 'QuarterCar'
body.chassis.mass = 350.0
body.wheel.mass = 40.0
joint.suspension.type = 'prismatic'
force.spring.k = 28000.0
force.damper.c = 1800.0
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "gensys",
    name: "GENSYS",
    ext: "tsimf",
    extensions: [".tsimf", ".gen", ".runf", ".mplotf", ".optif", ".fresf"],
    family: "ini",
    defaultCode: `## GENSYS Railway Vehicle Dynamics
func const v_kmh = 160.0
mass m_car c_body 0.0 0.0 -1.8  32000.0 32000.0 32000.0  50000.0 800000.0 800000.0
coupl k_primary k_z  c_body c_bogie  1.2e6
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "cfd",
    name: "CFD (SU2)",
    ext: "cfg",
    extensions: [".cfg", ".su2", ".cfd", ".cfgt"],
    family: "ini",
    defaultCode: `% SU2 Compressible Flow Configuration
SOLVER= EULER
MATH_PROBLEM= DIRECT
MACH_NUMBER= 0.8
AOA= 1.25
FREESTREAM_PRESSURE= 101325.0
FREESTREAM_TEMPERATURE= 288.15
MESH_FILENAME= mesh_naca0012.su2
`,
    supportsDiagram: false,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "fea",
    name: "FEA (Abaqus / Nastran)",
    ext: "inp",
    extensions: [".inp", ".fea", ".inpt", ".bdf", ".fem", ".k"],
    family: "ini",
    defaultCode: `*HEADING
Cantilever Beam Linear Static Analysis
*NODE
1, 0.0, 0.0, 0.0
2, 1.0, 0.0, 0.0
*MATERIAL, NAME=STEEL
*ELASTIC
210.0E9, 0.3
*STEP
*STATIC
*END STEP
`,
    supportsDiagram: false,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "easy5",
    name: "EASY5",
    ext: "ez5",
    extensions: [".ez5", ".ezmf", ".easy5", ".ezm", ".ezd", ".eas"],
    family: "ini",
    defaultCode: `TITLE = Electro-Hydraulic Servo Actuator
COMPONENT TF01 TYPE = TF
  PARAMETER K = 12.0, TAU = 0.025
COMPONENT INT1 TYPE = IN
  PARAMETER IC = 0.0
CONNECT TF01.S_OUT TO INT1.S_IN
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "rocets",
    name: "ROCETS",
    ext: "roc",
    extensions: [".roc", ".rocets", ".deck"],
    family: "ini",
    defaultCode: `TITLE Rocket Engine Cycle Balance
MODULE TURBOPUMP TP_LOX
  EFFICIENCY = 0.76
  PRESSURE_RATIO = 18.5
MODULE CHAMBER MAIN_CC
  PC = 115.0
  MR = 5.8
CONNECT TP_LOX.OUT -> MAIN_CC.LOX_IN
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "olga",
    name: "OLGA",
    ext: "opi",
    extensions: [".opi", ".olga", ".genkey", ".key"],
    family: "ini",
    defaultCode: `! OLGA Multiphase Flow Assurance Case
CASE TITLE = "Subsea Tieback Pipeline"
OPTIONS DTSTART = 0.05, TEND = 600.0
BRANCH LABEL = "FLOWLINE", DIAMETER = 0.254, ROUGHNESS = 4.5E-5
GEOMETRY X = (0.0, 2500.0, 5000.0), Y = (-450.0, -420.0, -100.0)
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "sima",
    name: "SIMA",
    ext: "sima",
    extensions: [".sima", ".stask"],
    family: "ini",
    defaultCode: `# SIMA Coupled Marine Operations Task
Task FloatingWindTurbine {
  Environment {
    Hs = 4.5
    Tp = 10.2
    WindSpeed = 11.4
  }
  Body SparFloater {
    Mass = 7.46e6
    Draft = 120.0
  }
}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "gtsuite",
    name: "GT-SUITE",
    ext: "gtm",
    extensions: [".gtm", ".gtp"],
    family: "ini",
    defaultCode: `# GT-SUITE 1D Thermo-Fluid Engine Model
Object FlowSplit "IntakeManifold" {
  Volume = 2.4
  InitialPressure = 1.013
  InitialTemperature = 300.0
}
Object OrificeConn "Throttle" {
  Diameter = 52.0
  DischargeCoeff = 0.88
}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "lps",
    name: "LPS",
    ext: "lps",
    extensions: [".lps", ".lpsx"],
    family: "ini",
    defaultCode: `maxFluents([pump_on, tank_low]).
events([level_drop]).
actions([start_pump]).

if level_drop from T1 to T2 then
  initiate tank_low from T2.

if tank_low at T1 then
  start_pump from T1 to T2,
  initiate pump_on from T2.
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "aspen",
    name: "Aspen Plus",
    ext: "bkp",
    extensions: [".bkp", ".apw"],
    family: "ini",
    defaultCode: `TITLE "Flash Separation Process"
COMPONENTS
  METHANOL CH4O /
  WATER H2O
FLOWSHEET
  BLOCK FLASH1 IN=FEED OUT=VAPOR LIQUID
BLOCK FLASH1 FLASH2
  PARAM TEMP=78.5 PRES=1.013
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "swmm",
    name: "EPA SWMM",
    ext: "swmm",
    extensions: [".swmm"],
    family: "ini",
    defaultCode: `[TITLE]
Urban Stormwater Drainage Basin

[JUNCTIONS]
;;Name           Elevation  MaxDepth
J1               105.0      3.0
J2               101.5      3.0

[CONDUITS]
;;Name           FromNode   ToNode     Length     Roughness
C1               J1         J2         180.0      0.013
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "epanet",
    name: "EPA EPANET",
    ext: "net",
    extensions: [".net"],
    family: "ini",
    defaultCode: `[TITLE]
Municipal Water Distribution Network

[JUNCTIONS]
;ID      Elev    Demand
J1       120.0   15.0
J2       112.0   25.0

[RESERVOIRS]
;ID      Head
R1       165.0

[PIPES]
;ID      Node1   Node2   Length  Diameter Roughness
P1       R1      J1      800.0   300.0    110.0
P2       J1      J2      600.0   250.0    110.0
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "energyplus",
    name: "EnergyPlus",
    ext: "idf",
    extensions: [".idf", ".epjson"],
    family: "ini",
    defaultCode: `Version, 24.1;

Building,
  OfficeZoneModel,
  0.0,
  City,
  0.04,
  0.4,
  FullExterior,
  25,
  6;

Zone,
  ThermalZone1,
  0.0,
  0.0, 0.0, 0.0,
  1,
  1,
  3.2,
  240.0;
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "touchstone",
    name: "Touchstone (S-parameter)",
    ext: "s2p",
    extensions: [".s1p", ".s2p", ".s3p", ".s4p", ".snp"],
    family: "csv",
    defaultCode: `! 2-Port Bandpass Filter S-Parameters
# GHz S MA R 50
1.00  0.88 -35.0  0.45  55.0  0.45  55.0  0.88 -35.0
2.40  0.12 -85.0  0.96 -12.0  0.96 -12.0  0.12 -85.0
3.50  0.82 -140.0 0.52 -95.0  0.52 -95.0  0.82 -140.0
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "ibis",
    name: "IBIS",
    ext: "ibs",
    extensions: [".ibs", ".ebd", ".pkg"],
    family: "ini",
    defaultCode: `[IBIS Ver] 7.0
[File Name] transceiver.ibs
[File Rev] 1.0
[Component] SerDes_IO
[Manufacturer] ModelScript Semiconductor
[Package]
R_pkg 120m 80m 160m
L_pkg 1.8n 1.2n 2.4n
C_pkg 0.6p 0.4p 0.8p
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "opendrive",
    name: "ASAM OpenDRIVE",
    ext: "xodr",
    extensions: [".xodr"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="7" name="HighwaySegment" />
  <road name="MainRoad" length="500.0" id="1" junction="-1">
    <planView>
      <geometry s="0.0" x="0.0" y="0.0" hdg="0.0" length="500.0">
        <line />
      </geometry>
    </planView>
  </road>
</OpenDRIVE>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "openscenario",
    name: "ASAM OpenSCENARIO",
    ext: "xosc",
    extensions: [".xosc", ".osc"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" description="Cut-In Scenario" />
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="EgoVehicle" vehicleCategory="car" />
    </ScenarioObject>
  </Entities>
</OpenSCENARIO>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "relap5",
    name: "RELAP5",
    ext: "r5",
    extensions: [".r5", ".relap", ".i"],
    family: "ini",
    defaultCode: `= RELAP5 Point Kinetics & Primary Loop Deck
0000100 new transnt
0000105 5.0 10.0
0000201 10.0 0.001 0.05 3 10 100
3000000 point-kinetics
3000001 0 100.0e6 0.0065
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "eclipse",
    name: "ECLIPSE",
    ext: "data",
    extensions: [".data", ".grdecl", ".inc"],
    family: "ini",
    defaultCode: `-- ECLIPSE Black-Oil Reservoir Deck
RUNSPEC
TITLE
  Five-Spot Waterflood Model
DIMENS
  10 10 3 /
OIL
WATER
END
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "sbml",
    name: "SBML",
    ext: "sbml",
    extensions: [".sbml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">
  <model id="MichaelisMenten" name="Enzyme Kinetics">
    <listOfCompartments>
      <compartment id="cell" size="1.0" constant="true" />
    </listOfCompartments>
    <listOfSpecies>
      <species id="S" compartment="cell" initialConcentration="10.0" />
      <species id="P" compartment="cell" initialConcentration="0.0" />
    </listOfSpecies>
  </model>
</sbml>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "jsbsim",
    name: "JSBSim",
    ext: "xml",
    extensions: [".xml"],
    family: "xml",
    defaultCode: `<?xml version="1.0"?>
<fdm_config name="UAV_6DOF" version="2.0">
  <metrics>
    <wingarea unit="M2"> 1.85 </wingarea>
    <wingspan unit="M"> 3.20 </wingspan>
    <chord unit="M"> 0.58 </chord>
  </metrics>
  <mass_balance>
    <emptywt unit="KG"> 14.5 </emptywt>
  </mass_balance>
</fdm_config>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "reqif",
    name: "OMG ReqIF",
    ext: "reqif",
    extensions: [".reqif", ".reqifz"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-1">
      <TITLE>System Safety Requirements</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-001" LONG-NAME="Brake Response Time" />
      </SPEC-OBJECTS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "ccsds",
    name: "CCSDS",
    ext: "oem",
    extensions: [".oem", ".opm", ".omm", ".ocm", ".tdm", ".ndm", ".xtce"],
    family: "ini",
    defaultCode: `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-01-01T00:00:00
ORIGINATOR = MODELSCRIPT

META_START
OBJECT_NAME = LEO_SAT_1
OBJECT_ID = 2026-001A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
META_STOP

2026-01-01T00:00:00.000 6878.137 0.0 0.0 0.0 5.385 5.385
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "autosar",
    name: "AUTOSAR",
    ext: "arxml",
    extensions: [".arxml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>Powertrain</SHORT-NAME>
      <ELEMENTS>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>TorqueController</SHORT-NAME>
        </APPLICATION-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
];

export const MORSEL_LANGUAGE_MAP: ReadonlyMap<string, MorselLanguageInfo> = new Map(
  MORSEL_LANGUAGES.flatMap((lang) => {
    const entries: [string, MorselLanguageInfo][] = [[lang.id, lang]];
    if (lang.id === "sysml2") {
      entries.push(["sysml", lang]);
    }
    return entries;
  }),
);

export function getLanguageInfo(idOrAlias?: string | null): MorselLanguageInfo {
  if (!idOrAlias) return MORSEL_LANGUAGES[0]!;
  const norm = idOrAlias.trim().toLowerCase();
  return MORSEL_LANGUAGE_MAP.get(norm) ?? MORSEL_LANGUAGES[0]!;
}

export function getLanguageExtension(idOrAlias?: string | null): string {
  return getLanguageInfo(idOrAlias).ext;
}

export function detectLanguageFromFilename(filename: string): string {
  const lower = filename.trim().toLowerCase();
  for (const lang of MORSEL_LANGUAGES) {
    if (lower.endsWith(`.${lang.ext}`)) return lang.id;
    for (const ext of lang.extensions) {
      if (lower.endsWith(ext.toLowerCase())) return lang.id;
    }
  }
  return "modelica";
}
