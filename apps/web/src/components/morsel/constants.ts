// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import { getLanguageFlagKey, isLanguageEnabledInFlags, useFeatureFlags } from "../../FeatureFlagContext";

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
  tier?: "stable" | "beta" | "preview" | undefined;
  ext: string;
  extensions: string[];
  family: MorselSyntaxFamily;
  defaultCode: string;
  supportsDiagram: boolean;
  supportsSimulation: boolean;
  supports3d: boolean;
  diagramTypes?: MorselDiagramTypeOption[];
  featureFlag?: string | undefined;
  hiddenByDefault?: boolean | undefined;
}

export function isLanguageFlagEnabled(langIdOrFlagKey?: string, defaultEnabled = true): boolean {
  if (!langIdOrFlagKey) return defaultEnabled;
  const flagKey = langIdOrFlagKey.startsWith("lang_") ? langIdOrFlagKey : getLanguageFlagKey(langIdOrFlagKey);
  const candidateKeys =
    flagKey === "lang_modelscript" || flagKey === "lang_modelscript_msx"
      ? ["lang_modelscript", "lang_modelscript_msx"]
      : [flagKey];
  if (typeof window !== "undefined") {
    try {
      const params = new URLSearchParams(window.location.search);
      for (const k of candidateKeys) {
        const urlVal = params.get(`ff_${k}`);
        if (urlVal !== null) return urlVal === "1" || urlVal.toLowerCase() === "true";
      }
      for (const k of candidateKeys) {
        const stored = window.localStorage?.getItem(`ff_${k}`);
        if (stored !== null) return stored === "1" || stored.toLowerCase() === "true";
      }
    } catch {
      // ignore storage errors
    }
  }
  return defaultEnabled;
}

export const ALL_MORSEL_LANGUAGES: readonly MorselLanguageInfo[] = [
  {
    id: "modelica",
    name: "Modelica",
    tier: "stable",
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
    tier: "stable",
    ext: "msx",
    extensions: [".msx", ".modelscript"],
    family: "modelica",
    featureFlag: "lang_modelscript_msx",
    hiddenByDefault: true,
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
    tier: "stable",
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
    tier: "stable",
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
    tier: "stable",
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
    diagramTypes: [
      { id: "All", label: "All Entities" },
      { id: "Taxonomy", label: "Class Taxonomy" },
      { id: "Properties", label: "Properties & Domains" },
    ],
  },
  {
    id: "scad",
    name: "OpenSCAD",
    tier: "stable",
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
    tier: "stable",
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
    tier: "beta",
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
    tier: "preview",
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
    tier: "stable",
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
    tier: "beta",
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
    tier: "stable",
    ext: "pscx",
    extensions: [".pscx", ".pslx", ".pswx", ".psmx"],
    family: "xml",
    defaultCode: `<project name="SimpleGrid" version="5.0.1">
  <definitions>
    <definition name="Main">
      <schematic>
        <User classid="UserCmp" id="u1" name="master:source_3" x="126" y="180">
          <paramlist>
            <param name="Name" value="Vsrc" />
            <param name="Vm" value="230.0 [kV]" />
            <param name="F0" value="60.0 [Hz]" />
          </paramlist>
        </User>
        <User classid="UserCmp" id="u2" name="master:rlc" x="288" y="180">
          <paramlist>
            <param name="Name" value="Load1" />
            <param name="R" value="50.0 [ohm]" />
            <param name="L" value="0.15 [H]" />
          </paramlist>
        </User>
        <Wire classid="WireOrthogonal" id="w1" x="162" y="180">
          <vertex x="0" y="0" />
          <vertex x="108" y="0" />
        </Wire>
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
    tier: "preview",
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
    tier: "preview",
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
    id: "comtrade",
    name: "COMTRADE / Oscillography",
    tier: "beta",
    ext: "cfg",
    extensions: [".cfg", ".dat", ".c37"],
    family: "ini",
    defaultCode: `Station,Device,2013
4,3A,1D
1,Ia,A,,A,0.001,0,0,-32768,32767,1,1,S
2,Ib,B,,A,0.001,0,0,-32768,32767,1,1,S
3,Ic,C,,A,0.001,0,0,-32768,32767,1,1,S
4,Trip,A,,0,0,0,0
60
1
4000,1000
01/01/2026,00:00:00.000000
01/01/2026,00:00:00.250000
ASCII
1
`,
    supportsDiagram: false,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "plcopen",
    name: "PLCopen / IEC 61131-3",
    tier: "beta",
    ext: "st",
    extensions: [".st", ".plcopen", ".iec"],
    family: "plcopen",
    defaultCode: `PROGRAM PumpControl
VAR_INPUT
  TankLevel : REAL := 45.0;
  SetPoint : REAL := 60.0;
  HighLevelTrip : BOOL := FALSE;
END_VAR
VAR_OUTPUT
  PumpActive : BOOL := FALSE;
  AlarmLatch : BOOL := FALSE;
END_VAR
VAR
  HysteresisBand : REAL := 5.0;
END_VAR

AlarmLatch := HighLevelTrip OR (TankLevel > 95.0);

IF AlarmLatch THEN
  PumpActive := FALSE;
ELSIF TankLevel < SetPoint - HysteresisBand THEN
  PumpActive := TRUE;
ELSIF TankLevel > SetPoint + HysteresisBand THEN
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
    tier: "beta",
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
    tier: "stable",
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
    tier: "beta",
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
    id: "usd",
    name: "OpenUSD (Universal Scene Description)",
    tier: "preview",
    ext: "usda",
    extensions: [".usd", ".usda", ".usdz"],
    family: "c",
    defaultCode: `#usda 1.0
(
    defaultPrim = "World"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "World"
{
    def Mesh "Box"
    {
        float3[] points = [(-0.5, -0.5, 0.0), (0.5, -0.5, 0.0), (0.5, 0.5, 0.0), (-0.5, 0.5, 0.0)]
        int[] faceVertexCounts = [4]
        int[] faceVertexIndices = [0, 1, 2, 3]
        color3f[] primvars:displayColor = [(0.2, 0.6, 1.0)]
    }
}
`,
    supportsDiagram: false,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "adams",
    name: "MSC Adams",
    tier: "beta",
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
    tier: "beta",
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
    tier: "stable",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "beta",
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
    tier: "beta",
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
    tier: "stable",
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
    tier: "preview",
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
    tier: "beta",
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
    tier: "stable",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "beta",
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
    tier: "beta",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "beta",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "preview",
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
    tier: "stable",
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
    tier: "beta",
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
    tier: "beta",
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
  {
    id: "qif",
    name: "QIF 3.0 (ISO 23952)",
    tier: "beta",
    ext: "qif",
    extensions: [".qif", ".qif.xml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument versionQIF="3.0.0" qpId="f47ac10b-58cc-4372-a567-0e02b2c3d479">
  <Header>
    <Author><Name>NIST MBE Metrology Lab</Name></Author>
    <Application><Name>ModelScript QIF 3.0 Suite</Name></Application>
    <FileUnits><PrimaryUnits><LinearUnit><UnitName>mm</UnitName></LinearUnit></PrimaryUnits></FileUnits>
  </Header>
  <DatumDefinitions>
    <DatumDefinition id="D_A" label="A" featureId="F_BASE"/>
    <DatumDefinition id="D_B" label="B" featureId="F_BORE"/>
  </DatumDefinitions>
  <FeatureNominals>
    <PlaneFeatureNominal id="F_BASE">
      <Name>PrimaryBasePlaneA</Name>
      <Location>0 0 0</Location>
      <Normal>0 0 1</Normal>
      <StepEntityId>#101</StepEntityId>
      <ProbingPoints>6</ProbingPoints>
    </PlaneFeatureNominal>
    <CylinderFeatureNominal id="F_BORE">
      <Name>CenterCoolingBoreB</Name>
      <Diameter>12.000</Diameter>
      <Location>24 0 15</Location>
      <AxisVector>0 0 1</AxisVector>
      <StepEntityId>#108</StepEntityId>
      <ProbingPoints>8</ProbingPoints>
    </CylinderFeatureNominal>
  </FeatureNominals>
  <CharacteristicNominals>
    <PositionCharacteristicNominal id="C_POS" balloonNumber="1">
      <Name>CoolingBore_TruePosition</Name>
      <ToleranceValue>0.050</ToleranceValue>
      <DiametricalZone>true</DiametricalZone>
      <MaterialCondition>MMC</MaterialCondition>
      <DatumReferenceFrame>
        <DatumReference precedence="1"><DatumLabel>A</DatumLabel></DatumReference>
        <DatumReference precedence="2"><DatumLabel>B</DatumLabel><MaterialCondition>MMC</MaterialCondition></DatumReference>
      </DatumReferenceFrame>
      <FeatureNominalIds><Id>F_BORE</Id></FeatureNominalIds>
      <MeasurementDeviceId>CMM_01</MeasurementDeviceId>
    </PositionCharacteristicNominal>
  </CharacteristicNominals>
  <MeasurementResources>
    <MeasurementDevice id="CMM_01" deviceType="CMM">
      <Name>Hexagon_Global_S</Name>
      <CalibrationUncertainty>0.0018</CalibrationUncertainty>
    </MeasurementDevice>
  </MeasurementResources>
  <Results>
    <GeometricCharacteristicActual id="ACT_1" characteristicNominalId="C_POS" partSerialNumber="SN-001">
      <MeasuredValue>0.038</MeasuredValue>
      <ActualFeatureSize>12.012</ActualFeatureSize>
      <Status>PASS</Status>
    </GeometricCharacteristicActual>
  </Results>
</QIFDocument>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "oscal",
    name: "NIST OSCAL 1.1",
    tier: "beta",
    ext: "oscal.json",
    extensions: [".oscal", ".oscal.json", ".oscal.yaml", ".oscal.yml", ".oscal.xml"],
    family: "xml",
    defaultCode: `{
  "system-security-plan": {
    "uuid": "770e8400-e29b-41d4-a716-446655440000",
    "metadata": {
      "title": "Smart Manufacturing Workcell OT SSP",
      "version": "1.0.0",
      "oscal-version": "1.1.2"
    },
    "import-profile": {
      "href": "builtin://nist-sp-800-82-r3-ot"
    },
    "system-characteristics": {
      "system-name": "SmartFactoryWorkcell_OT",
      "security-sensitivity-level": "high"
    },
    "system-implementation": {
      "components": [
        {
          "uuid": "11111111-e29b-41d4-a716-446655440001",
          "title": "SafetyCellControllerPLC",
          "type": "plc",
          "status": "operational"
        },
        {
          "uuid": "22222222-e29b-41d4-a716-446655440002",
          "title": "IndustrialDmzFirewall",
          "type": "interconnection",
          "status": "operational"
        }
      ]
    },
    "control-implementation": {
      "implemented-requirements": [
        {
          "uuid": "55555555-e29b-41d4-a716-446655440011",
          "control-id": "sc-7",
          "by-components": [
            {
              "uuid": "66666666-e29b-41d4-a716-446655440101",
              "component-uuid": "11111111-e29b-41d4-a716-446655440001",
              "description": "Enforces Purdue Level 3.5 DMZ segmentation."
            }
          ]
        }
      ]
    }
  }
}
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "automationml",
    name: "AutomationML (IEC 62714)",
    tier: "beta",
    ext: "aml",
    extensions: [".aml", ".caex"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="utf-8"?>
<CAEXFile FileName="RoboticAssemblyWorkcell.aml" SchemaVersion="3.0">
  <InstanceHierarchy Name="SmartAssemblyWorkcell">
    <InternalElement Name="WeldRobot_6DOF" ID="rob-01" PPRCategory="Resource">
      <Attribute Name="Frame">
        <Attribute Name="x"><Value>1.2</Value></Attribute>
        <Attribute Name="y"><Value>0.8</Value></Attribute>
        <Attribute Name="z"><Value>0.0</Value></Attribute>
      </Attribute>
      <ExternalInterface Name="enableIn" ID="rob-en" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" Direction="In" DataType="BOOL" />
    </InternalElement>
    <InternalElement Name="CellSafetyPLC" ID="plc-01" PPRCategory="Resource">
      <ExternalInterface Name="enableOut" ID="plc-en" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/SignalInterface" Direction="Out" DataType="BOOL" />
      <InternalLink Name="EnableLink" RefPartnerSideA="plc-01:enableOut" RefPartnerSideB="rob-01:enableIn" />
    </InternalElement>
  </InstanceHierarchy>
</CAEXFile>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "three-mf",
    name: "3MF (ISO/IEC 25422)",
    tier: "beta",
    ext: "3mf",
    extensions: [".3mf", ".3mf.xml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <metadata name="Title">Titanium Craniotomy Surgical Guide</metadata>
  <resources>
    <object id="1" name="SurgicalGuide" type="model">
      <mesh>
        <vertices>
          <vertex x="0" y="0" z="0" />
          <vertex x="32" y="0" z="0" />
          <vertex x="0" y="32" z="0" />
          <vertex x="0" y="0" z="8" />
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1" />
          <triangle v1="0" v2="1" v3="3" />
          <triangle v1="1" v2="2" v3="3" />
          <triangle v1="2" v2="0" v3="3" />
        </triangles>
      </mesh>
    </object>
  </resources>
  <build>
    <item objectid="1" />
  </build>
</model>
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: true,
  },
  {
    id: "gproms",
    name: "gPROMS",
    tier: "preview",
    ext: "gproms",
    extensions: [".gproms", ".gPJ"],
    family: "modelica",
    defaultCode: `MODEL JacketedCSTR
  PARAMETER
    V_reactor AS REAL DEFAULT 2.5 ;
    k0        AS REAL DEFAULT 1200.0 ;
  VARIABLE
    C_A       AS Concentration ;
    T_react   AS Temperature ;
  EQUATION
    V_reactor * $C_A = 1.0 * (2.0 - C_A) - V_reactor * k0 * C_A ;
    $T_react = 0.05 * (310.0 - T_react) ;
END
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "cantera",
    name: "Cantera Kinetics",
    tier: "preview",
    ext: "cti.yaml",
    extensions: [".cti", ".cti.yaml", ".cantera.yaml"],
    family: "ini",
    defaultCode: `phases:
  - name: h2_air_mix
    thermo: ideal-gas
    elements: [H, O, N]
    species: [H2, O2, H2O, OH, H, O, N2]
    kinetics: gas
    state:
      T: 1100.0
      P: 101325.0
reactions:
  - equation: H + O2 <=> O + OH
    rate-constant: {A: 3.55e+15, b: -0.41, Ea: 16600.0}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "phreeqc",
    name: "USGS PHREEQC",
    tier: "preview",
    ext: "pqi",
    extensions: [".pqi", ".phrq", ".phreeqc"],
    family: "ini",
    defaultCode: `TITLE Calcite Dissolution & Acid Mine Drainage Neutralization
SOLUTION 1 Acidic Drainage Feed
  temp      25.0
  pH        3.8
  pe        8.5
  units     mmol/kgw
  Ca        0.5
  S(6)      12.0
EQUILIBRIUM_PHASES 1
  Calcite   0.0   10.0
END
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "smiles",
    name: "SMILES / OpenSMILES",
    tier: "preview",
    ext: "smi",
    extensions: [".smi", ".smiles", ".ism"],
    family: "csv",
    defaultCode: `# SMILES_STRING\tCOMPOUND_ID\tMW_G_MOL\tLOGP
CC(=O)Oc1ccccc1C(=O)O\tAspirin_ASA\t180.16\t1.19
CC(=O)Nc1ccc(O)cc1\tAcetaminophen_APAP\t151.16\t0.46
CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O\tS_Ibuprofen\t206.28\t3.97
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: true,
  },
  {
    id: "antimony",
    name: "Antimony",
    tier: "preview",
    ext: "ant",
    extensions: [".ant", ".antimony"],
    family: "modelica",
    defaultCode: `model Repressilator()
  compartment cell = 1.0;
  species m_lacI in cell, m_tetR in cell, m_cI in cell;
  J_tx1: -> m_lacI; alpha / (1 + (m_cI / K_d)^n);
  J_deg1: m_lacI -> ; k_dm * m_lacI;
  m_lacI = 2.0; m_tetR = 0.1; m_cI = 0.1;
  alpha = 216.0; K_d = 40.0; n = 2.0; k_dm = 0.2;
end
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "bngl",
    name: "BioNetGen (BNGL)",
    tier: "preview",
    ext: "bngl",
    extensions: [".bngl"],
    family: "ini",
    defaultCode: `begin model
begin parameters
  kp_bind  0.01
  km_bind  0.10
end parameters
begin molecule types
  EGF(r)
  EGFR(l,d,Y~U~P)
end molecule types
begin seed species
  EGF(r)             120.0
  EGFR(l,d,Y~U)      100.0
end seed species
begin reaction rules
  R1_LigandBind: EGF(r) + EGFR(l,d) <-> EGF(r!1).EGFR(l!1,d) kp_bind, km_bind
end reaction rules
end model
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "cellml",
    name: "CellML 2.0",
    tier: "beta",
    ext: "cellml",
    extensions: [".cellml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="HodgkinHuxleySquidAxon">
  <component name="membrane">
    <variable name="t" units="ms" interface="public" />
    <variable name="V" units="mV" initial_value="-65.0" interface="public" />
    <variable name="C_m" units="uF_per_cm2" initial_value="1.0" />
    <variable name="I_stim" units="uA_per_cm2" initial_value="10.0" />
  </component>
</model>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "sedml",
    name: "SED-ML (L1V4)",
    tier: "preview",
    ext: "sedml",
    extensions: [".sedml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfModels>
    <model id="model_glycolysis" language="urn:sedml:language:sbml" source="glycolysis_core.sbml" />
  </listOfModels>
  <listOfSimulations>
    <uniformTimeCourse id="sim_timecourse" initialTime="0.0" outputStartTime="0.0" outputEndTime="20.0" numberOfSteps="400">
      <algorithm kisaoID="KISAO:0000019" />
    </uniformTimeCourse>
  </listOfSimulations>
</sedML>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "sbol",
    name: "SBOL 3.1",
    tier: "preview",
    ext: "sbol",
    extensions: [".sbol", ".sbol3"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:sbol="http://sbols.org/v3#">
  <sbol:Component rdf:about="https://modelscript.org/sbol/ToggleSwitchCassette">
    <sbol:displayId>ToggleSwitchCassette</sbol:displayId>
    <sbol:type rdf:resource="https://identifiers.org/SBO:0000251" />
    <sbol:role rdf:resource="http://identifiers.org/so/SO:0000704" />
  </sbol:Component>
</rdf:RDF>
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "genbank",
    name: "GenBank / INSDC",
    tier: "preview",
    ext: "gb",
    extensions: [".gb", ".gbk", ".genbank"],
    family: "ini",
    defaultCode: `LOCUS       pUC19_Vector              180 bp ds-DNA     circular SYN 14-APR-2026
DEFINITION  Cloning vector pUC19 annotated origin and AmpR cassette.
ACCESSION   MSX_PUC19
FEATURES             Location/Qualifiers
     rep_origin      1..60
                     /label="pMB1_ori"
     CDS             61..180
                     /gene="bla"
ORIGIN
        1 tcgcgcgttt cggtgatgac ggtgaaaacc tctgacacat gcagctcccg gagacggtca
       61 cagcttgtct gtaagcggat gccgggagca gacaagcccg tcagggcgcg tcagcgggtg
      121 ttggcgggtg tcggggctgg cttaactatg cggcatcaga gcagattgta ctgagagtgc
//
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: false,
  },
  {
    id: "pdb",
    name: "PDB / mmCIF",
    tier: "preview",
    ext: "pdb",
    extensions: [".pdb", ".ent", ".cif", ".mmcif"],
    family: "csv",
    defaultCode: `HEADER    ANTIMICROBIAL PEPTIDE                   14-APR-26   1MSX
TITLE     ALPHA-HELICAL ANTIMICROBIAL PEPTIDE BACKBONE
HELIX    1  H1 ALA A    1  ALA A    3  1                                   3
ATOM      1  N   ALA A   1      11.104   6.134  -6.504  1.00 12.40           N
ATOM      2  CA  ALA A   1      11.639   6.071  -5.147  1.00 11.80           C
ATOM      3  C   ALA A   1      13.135   5.826  -5.161  1.00 11.50           C
ATOM      4  O   ALA A   1      13.663   5.024  -5.932  1.00 12.10           O
END
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: true,
  },
  {
    id: "nmtran",
    name: "NONMEM NM-TRAN",
    tier: "preview",
    ext: "ctl",
    extensions: [".ctl", ".mod", ".nmtran"],
    family: "ini",
    defaultCode: `$PROBLEM Two-Compartment Oral & IV Population PK Model
$INPUT ID TIME AMT DV CMT EVID MDV WT
$DATA oral_pk_study.csv IGNORE=@
$SUBROUTINES ADVAN4 TRANS4
$PK
  CL = THETA(1) * EXP(ETA(1))
  V2 = THETA(2) * EXP(ETA(2))
  Q  = THETA(3)
  V3 = THETA(4)
  KA = THETA(5)
$THETA
  (0.1, 4.5, 25.0) ; POP_CL [L/h]
  (1.0, 28.0, 120.0) ; POP_V2 [L]
$OMEGA 0.09 0.06
$SIGMA 0.04
$ESTIMATION METHOD=1 INTERACTION MAXEVAL=9999
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "opensim",
    name: "OpenSim 4.x",
    tier: "beta",
    ext: "osim",
    extensions: [".osim"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8" ?>
<OpenSimDocument Version="40000">
  <Model name="Arm26_ElbowFlexion">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <objects>
        <Body name="humerus"><mass>1.864</mass></Body>
        <Body name="radius_ulna"><mass>1.534</mass></Body>
      </objects>
    </BodySet>
  </Model>
</OpenSimDocument>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "febio",
    name: "FEBio 4.0",
    tier: "beta",
    ext: "feb",
    extensions: [".feb"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="ISO-8859-1"?>
<febio_spec version="4.0">
  <Module type="solid" />
  <Control>
    <analysis>STATIC</analysis>
    <time_steps>20</time_steps>
    <step_size>0.05</step_size>
  </Control>
  <Material>
    <material id="1" name="ArterialMedia" type="Mooney-Rivlin">
      <density>1060.0</density>
      <c1>32.0</c1>
      <c2>8.5</c2>
      <k>1500.0</k>
    </material>
  </Material>
</febio_spec>
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "dicom-rt",
    name: "DICOM-RT Plan",
    tier: "beta",
    ext: "dcm.json",
    extensions: [".dcm.json", ".rtplan", ".dicom-rt"],
    family: "xml",
    defaultCode: `{
  "Modality": "RTPLAN",
  "RTPlanLabel": "PROSTATE_7F_IMRT_78GY",
  "PrescriptionDescription": "78.0 Gy in 39 fractions to PTV_7800",
  "FractionGroupSequence": [
    {
      "FractionGroupNumber": 1,
      "NumberOfFractionsPlanned": 39,
      "TargetPrescriptionDoseGy": 78.0,
      "RadiobiologyAlphaBetaGy": 10.0
    }
  ]
}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "nifti",
    name: "NIfTI-1 / NIfTI-2",
    tier: "beta",
    ext: "nii.json",
    extensions: [".nii.json", ".nifti"],
    family: "xml",
    defaultCode: `{
  "nifti_version": 1,
  "magic": "n+1",
  "descrip": "MNI152 T1w 1mm Isotropic Structural Brain Volume",
  "dim": [3, 182, 218, 182, 1, 1, 1, 1],
  "pixdim": [1.0, 1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0],
  "datatype": "INT16",
  "qform_code": 4,
  "sform_code": 4,
  "srow_x": [-1.0, 0.0, 0.0, 90.0],
  "srow_y": [0.0, 1.0, 0.0, -126.0],
  "srow_z": [0.0, 0.0, 1.0, -72.0]
}
`,
    supportsDiagram: true,
    supportsSimulation: false,
    supports3d: true,
  },
  {
    id: "topas",
    name: "TOPAS / Geant4 MC",
    tier: "beta",
    ext: "topas",
    extensions: [".topas", ".tps"],
    family: "ini",
    defaultCode: `# TOPAS Clinical Proton Pencil-Beam Bragg Peak in Water Phantom
s:Ge/World/Material  = "Air"
d:Ge/World/HLX       = 50.0 cm
s:Ge/WaterPhantom/Type     = "TsBox"
s:Ge/WaterPhantom/Parent   = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLZ      = 15.0 cm
s:So/ProtonPencil/BeamParticle = "proton"
d:So/ProtonPencil/BeamEnergy   = 150.0 MeV
i:So/ProtonPencil/NumberOfHistoriesInRun = 50000
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
  {
    id: "igtl",
    name: "OpenIGTLink v3",
    tier: "beta",
    ext: "igtl.json",
    extensions: [".igtl", ".igtl.json"],
    family: "xml",
    defaultCode: `{
  "protocolVersion": "3.0",
  "sessionName": "Stereotactic_Cranial_Biopsy_Navigation",
  "coordinateFrames": [
    { "id": "World", "type": "RAS" },
    { "id": "OpticalTrackerBase", "parent": "World" },
    { "id": "BiopsyNeedleTip", "parent": "OpticalTrackerBase" }
  ],
  "safetyInterlocks": {
    "maxTrackingLatencyMs": 20.0,
    "maxAllowedFreMm": 1.5,
    "haltRobotOnLineOfSightLoss": true
  }
}
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
  },
];

export const MORSEL_LANGUAGES: readonly MorselLanguageInfo[] = ALL_MORSEL_LANGUAGES.filter((lang) =>
  isLanguageFlagEnabled(lang.featureFlag ?? getLanguageFlagKey(lang.id), !lang.hiddenByDefault),
);

export function getVisibleMorselLanguages(isFlagEnabled?: (key: string) => boolean): readonly MorselLanguageInfo[] {
  return ALL_MORSEL_LANGUAGES.filter((lang) => {
    if (isFlagEnabled) {
      return isLanguageEnabledInFlags(lang.id, isFlagEnabled);
    }
    return isLanguageFlagEnabled(lang.featureFlag ?? getLanguageFlagKey(lang.id), !lang.hiddenByDefault);
  });
}

export function useVisibleMorselLanguages(): readonly MorselLanguageInfo[] {
  const { isEnabled } = useFeatureFlags();
  return useMemo(() => getVisibleMorselLanguages(isEnabled), [isEnabled]);
}

export const MORSEL_LANGUAGE_MAP: ReadonlyMap<string, MorselLanguageInfo> = new Map(
  ALL_MORSEL_LANGUAGES.flatMap((lang) => {
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
  for (const lang of ALL_MORSEL_LANGUAGES) {
    if (lower.endsWith(`.${lang.ext}`)) return lang.id;
    for (const ext of lang.extensions) {
      if (lower.endsWith(ext.toLowerCase())) return lang.id;
    }
  }
  return "modelica";
}
