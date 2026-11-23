// SPDX-License-Identifier: AGPL-3.0-or-later

import { useMemo } from "react";
import { getLanguageFlagKey, isLanguageEnabledInFlags, useEditorFeatureFlags as useFeatureFlags } from "../host";

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

export interface MorselIconShapeTool {
  id: string;
  label: string;
  title: string;
  shortcut?: string | undefined;
  /** Inline 16x16 SVG inner markup for the toolbar icon */
  iconSvg: string;
  primitive: Record<string, unknown>;
}

export interface MorselDiagramTypeOption {
  id: string;
  label: string;
  iconTools?: readonly MorselIconShapeTool[] | undefined;
}

export const MODELICA_ICON_SHAPE_TOOLS: readonly MorselIconShapeTool[] = [
  {
    id: "rect",
    label: "Rect",
    title: "Add Rectangle",
    shortcut: "R",
    iconSvg:
      '<rect x="2.25" y="3.5" width="11.5" height="9" rx="1.4" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.35"/>',
    primitive: {
      "@type": "Rectangle",
      extent: [
        [-60, -40],
        [60, 40],
      ],
      lineColor: [8, 145, 178],
      fillColor: [224, 242, 254],
      fillPattern: "FillPattern.Solid",
    },
  },
  {
    id: "ellipse",
    label: "Ellipse",
    title: "Add Ellipse",
    shortcut: "O",
    iconSvg:
      '<ellipse cx="8" cy="8" rx="5.75" ry="4.75" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.35"/>',
    primitive: {
      "@type": "Ellipse",
      extent: [
        [-40, -40],
        [40, 40],
      ],
      lineColor: [8, 145, 178],
      fillColor: [255, 255, 255],
      fillPattern: "FillPattern.Solid",
    },
  },
  {
    id: "line",
    label: "Line",
    title: "Add Line",
    shortcut: "L",
    iconSvg:
      '<line x1="3" y1="13" x2="13" y2="3" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/><circle cx="3" cy="13" r="1.4" fill="currentColor"/><circle cx="13" cy="3" r="1.4" fill="currentColor"/>',
    primitive: {
      "@type": "Line",
      points: [
        [-60, 0],
        [60, 0],
      ],
      color: [15, 23, 42],
    },
  },
  {
    id: "polygon",
    label: "Polygon",
    title: "Add Polygon",
    shortcut: "P",
    iconSvg:
      '<polygon points="8,2.4 13.5,12.6 2.5,12.6" fill="currentColor" fill-opacity="0.14" stroke="currentColor" stroke-width="1.35" stroke-linejoin="round"/><circle cx="8" cy="2.4" r="1.15" fill="currentColor"/><circle cx="13.5" cy="12.6" r="1.15" fill="currentColor"/><circle cx="2.5" cy="12.6" r="1.15" fill="currentColor"/>',
    primitive: {
      "@type": "Polygon",
      points: [
        [0, 50],
        [-45, -35],
        [45, -35],
        [0, 50],
      ],
      lineColor: [8, 145, 178],
      fillColor: [224, 242, 254],
      fillPattern: "FillPattern.Solid",
    },
  },
  {
    id: "text",
    label: "Text",
    title: "Add Text (%name)",
    shortcut: "T",
    iconSvg:
      '<path d="M3.2 4V3h9.6v1M8 3v10M5.8 13h4.4" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>',
    primitive: {
      "@type": "Text",
      extent: [
        [-70, -18],
        [70, 18],
      ],
      textString: "%name",
      textColor: [15, 23, 42],
    },
  },
];

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

export type MorselDefaultView = "diagram" | "3d" | "simulation" | "inspector" | "code";

export interface MorselLanguageInfo {
  id: string;
  name: string;
  label?: string | undefined;
  tier?: "beta" | "alpha" | "pre-alpha" | undefined;
  ext: string;
  extensions: string[];
  family: MorselSyntaxFamily;
  defaultCode: string;
  defaultFiles?: Record<string, string> | undefined;
  defaultActiveFile?: string | undefined;
  supportsDiagram: boolean;
  supportsSimulation: boolean;
  supports3d: boolean;
  /** Preferred default visualizer/editor view for this language (defaults to diagram, or 3d when 2D diagram is unsupported). */
  defaultView?: MorselDefaultView | undefined;
  /** Whether to open in split code+visualizer mode by default (defaults to true unless defaultView is "code"). */
  defaultSplit?: boolean | undefined;
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
    tier: "beta",
    ext: "mo",
    extensions: [".mo", ".mos", ".msim"],
    family: "modelica",
    defaultCode,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: true,
    diagramTypes: [
      { id: "diagram", label: "Diagram" },
      { id: "icon", label: "Icon", iconTools: MODELICA_ICON_SHAPE_TOOLS },
    ],
  },
  {
    id: "modelscript",
    name: "ModelScript",
    tier: "beta",
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
    id: "ampl",
    name: "AMPL",
    tier: "beta",
    ext: "ampl",
    extensions: [".ampl", ".mod", ".dat"],
    family: "modelica",
    defaultCode: `# Production Planning Linear Program (AMPL)
var x1 >= 0;
var x2 >= 0;

maximize Profit:
  3 * x1 + 5 * x2;

s.t. Labor:
  x1 <= 4;

s.t. Machine:
  2 * x2 <= 12;

s.t. Resource:
  3 * x1 + 2 * x2 <= 18;
`,
    supportsDiagram: false,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "sysml2",
    name: "SysML v2",
    tier: "beta",
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
      { id: "BDD", label: "BDD" },
      { id: "IBD", label: "IBD" },
      { id: "StateMachine", label: "State" },
      { id: "Requirement", label: "Requirements" },
    ],
  },
  {
    id: "step",
    name: "STEP (ISO 10303-21)",
    tier: "beta",
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
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: true,
    defaultView: "3d",
  },
  {
    id: "owl2",
    name: "OWL 2 Functional",
    tier: "beta",
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
    tier: "beta",
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
    defaultView: "3d",
  },
  {
    id: "csv",
    name: "CSV",
    tier: "beta",
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
    tier: "alpha",
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
    tier: "pre-alpha",
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
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "spice",
    name: "SPICE",
    tier: "beta",
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
    tier: "alpha",
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
    tier: "beta",
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
    tier: "alpha",
    ext: "raw",
    extensions: [".raw", ".dyr", ".seq", ".sav", ".sld", ".drw"],
    family: "spice",
    defaultCode: `0, 100.0, 33, 0, 1, 60.0 / PSS/E 3-Bus Sample
1, 'BUS_1   ', 230.0, 3, 1, 1, 1, 1.02, 0.0
2, 'BUS_2   ', 230.0, 2, 1, 1, 1, 1.01, -1.0
3, 'BUS_3   ', 230.0, 1, 1, 1, 1, 1.00, -2.5
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 120.0, 40.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 70.0, 20.0, 100.0, -50.0, 1.02, 0, 100.0, 0.0, 0.2, 0.0, 0.0, 1.0, 1, 100.0, 150.0, 0.0
2, '1 ', 50.0, 15.0, 100.0, -50.0, 1.01, 0, 100.0, 0.0, 0.25, 0.0, 0.0, 1.0, 1, 100.0, 100.0, 0.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2, '1 ', 0.01, 0.05, 0.02, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
1, 3, '1 ', 0.015, 0.08, 0.03, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
2, 3, '1 ', 0.01, 0.06, 0.02, 200.0, 200.0, 200.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 1.0
0 / END OF BRANCH DATA
`,
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "opendss",
    name: "OpenDSS",
    tier: "pre-alpha",
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
    id: "powerfactory",
    name: "DIgSILENT PowerFactory",
    tier: "beta",
    ext: "dgs",
    extensions: [".dgs", ".pfd", ".dz", ".dsl", ".xml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<PowerFactory version="2024">
  <DataObject class="ElmSubstat" loc_name="Substation_1"></DataObject>
  <DataObject class="ElmSubstat" loc_name="Substation_2"></DataObject>
  <DataObject class="ElmSubstat" loc_name="Substation_3"></DataObject>

  <DataObject class="ElmTerm" loc_name="Bus_1"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_2"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>
  <DataObject class="ElmTerm" loc_name="Bus_3"><uknom>110.0</uknom><fnom>50.0</fnom></DataObject>

  <DataObject class="ElmLne" loc_name="Line_1_2">
    <bus1>Bus_1</bus1>
    <bus2>Bus_2</bus2>
    <dline>20.0</dline>
    <r1>2.42</r1>
    <x1>7.26</x1>
    <b1>15.0</b1>
  </DataObject>

  <DataObject class="ElmLne" loc_name="Line_2_3">
    <bus1>Bus_2</bus1>
    <bus2>Bus_3</bus2>
    <dline>15.0</dline>
    <r1>1.81</r1>
    <x1>5.44</x1>
    <b1>12.0</b1>
  </DataObject>

  <DataObject class="ElmLne" loc_name="Line_1_3">
    <bus1>Bus_1</bus1>
    <bus2>Bus_3</bus2>
    <dline>25.0</dline>
    <r1>3.02</r1>
    <x1>9.07</x1>
    <b1>18.0</b1>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_1">
    <bus1>Bus_1</bus1>
    <pgini>70.0</pgini>
    <qgini>15.0</qgini>
    <usetp>1.02</usetp>
  </DataObject>

  <DataObject class="ElmSym" loc_name="Gen_3">
    <bus1>Bus_3</bus1>
    <pgini>30.0</pgini>
    <qgini>10.0</qgini>
    <usetp>1.00</usetp>
  </DataObject>

  <DataObject class="ElmLod" loc_name="Load_2">
    <bus1>Bus_2</bus1>
    <plini>80.0</plini>
    <qlini>25.0</qlini>
  </DataObject>
</PowerFactory>
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "comtrade",
    name: "COMTRADE / Oscillography",
    tier: "alpha",
    ext: "cfg",
    extensions: [".cfg", ".dat", ".cff", ".c37"],
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "beta",
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
    defaultActiveFile: "SystemStructure.ssd",
    defaultFiles: {
      "SystemStructure.ssd": `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="DriveSystem" version="1.0">
  <ssd:System name="Root">
    <ssd:Elements>
      <ssd:Component name="Controller" source="resources/Controller.fmu" />
      <ssd:Component name="Plant" source="resources/Plant.fmu" />
    </ssd:Elements>
  </ssd:System>
</ssd:SystemStructureDescription>
`,
      "resources/Controller.fmu/modelDescription.xml": `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="Controller" guid="{00000000-0000-0000-0000-000000000001}">
  <ModelVariables>
    <ScalarVariable name="u" valueReference="0" causality="input"><Real start="0.0" /></ScalarVariable>
    <ScalarVariable name="y" valueReference="1" causality="output"><Real /></ScalarVariable>
  </ModelVariables>
</fmiModelDescription>
`,
      "resources/Plant.fmu/modelDescription.xml": `<?xml version="1.0" encoding="UTF-8"?>
<fmiModelDescription fmiVersion="2.0" modelName="Plant" guid="{00000000-0000-0000-0000-000000000002}">
  <ModelVariables>
    <ScalarVariable name="u" valueReference="0" causality="input"><Real start="0.0" /></ScalarVariable>
    <ScalarVariable name="y" valueReference="1" causality="output"><Real /></ScalarVariable>
  </ModelVariables>
</fmiModelDescription>
`,
    },
    supportsDiagram: true,
    supportsSimulation: true,
    supports3d: false,
  },
  {
    id: "urdf",
    name: "ROS URDF / SDFormat",
    tier: "alpha",
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
    tier: "pre-alpha",
    ext: "usda",
    extensions: [".usd", ".usda", ".usdz"],
    family: "c",
    defaultCode: `#usda 1.0
(
    defaultPrim = "DigitalTwinCell"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "DigitalTwinCell" (
    kind = "assembly"
)
{
    def Xform "BasePedestal" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 24.0
        float3 physics:diagonalInertia = (1.8, 1.8, 0.9)

        def Cylinder "Plinth"
        {
            double radius = 0.45
            double height = 0.25
            uniform token axis = "Z"
            double3 xformOp:translate = (0.0, 0.0, 0.125)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f[] primvars:displayColor = [(0.18, 0.22, 0.28)]
        }

        def Cylinder "Column"
        {
            double radius = 0.16
            double height = 0.70
            uniform token axis = "Z"
            double3 xformOp:translate = (0.0, 0.0, 0.60)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f[] primvars:displayColor = [(0.24, 0.56, 0.88)]
        }
    }

    def Xform "ShoulderLink" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 8.5
        float3 physics:diagonalInertia = (0.6, 0.6, 0.25)
        double3 xformOp:translate = (0.0, 0.0, 1.0)
        float3 xformOp:rotateXYZ = (0.0, 28.0, 0.0)
        uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:rotateXYZ"]

        def Sphere "ShoulderJoint"
        {
            double radius = 0.19
            color3f[] primvars:displayColor = [(0.92, 0.58, 0.16)]
        }

        def Cube "UpperArm"
        {
            double size = 1.0
            double3 xformOp:translate = (0.45, 0.0, 0.0)
            double3 xformOp:scale = (0.90, 0.16, 0.16)
            uniform token[] xformOpOrder = ["xformOp:translate", "xformOp:scale"]
            color3f[] primvars:displayColor = [(0.24, 0.56, 0.88)]
        }

        def Sphere "WristEndEffector"
        {
            double radius = 0.13
            double3 xformOp:translate = (0.95, 0.0, 0.0)
            uniform token[] xformOpOrder = ["xformOp:translate"]
            color3f[] primvars:displayColor = [(0.22, 0.78, 0.52)]
        }
    }

    def PhysicsRevoluteJoint "ShoulderRevolute"
    {
        rel physics:body0 = </DigitalTwinCell/BasePedestal>
        rel physics:body1 = </DigitalTwinCell/ShoulderLink>
        uniform token physics:axis = "Y"
        float physics:lowerLimit = -2.35619
        float physics:upperLimit = 2.35619
    }
}
`,
    supportsDiagram: false,
    supportsSimulation: true,
    supports3d: true,
    defaultView: "3d",
  },
  {
    id: "adams",
    name: "MSC Adams",
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "beta",
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
    tier: "pre-alpha",
    ext: "su2",
    extensions: [".su2", ".cfd", ".cfg", ".cfgt"],
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
    defaultView: "3d",
  },
  {
    id: "fea",
    name: "FEA (Abaqus / Nastran)",
    tier: "pre-alpha",
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
    defaultView: "3d",
  },
  {
    id: "easy5",
    name: "EASY5",
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "beta",
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
    tier: "pre-alpha",
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
    tier: "alpha",
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
    tier: "beta",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "beta",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "pre-alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
    tier: "alpha",
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
  {
    id: "gtfs",
    name: "GTFS Transit",
    tier: "alpha",
    ext: "gtfs",
    extensions: [".gtfs", ".txt"],
    family: "csv",
    defaultCode: `route_id,agency_id,route_short_name,route_long_name,route_type
R1,METRO,1,Red Line Express,1
R2,METRO,2,Blue Line Crosstown,3
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "pslf",
    name: "GE Vernova PSLF",
    tier: "alpha",
    ext: "epc",
    extensions: [".epc", ".dyd"],
    family: "spice",
    defaultCode: `title
PSLF 3-Bus Sample System
bus data
1 "BUS_1" 230.0 "Area1" 1 1.02 0.0
2 "BUS_2" 230.0 "Area1" 2 1.01 -1.2
3 "BUS_3" 230.0 "Area1" 0 1.00 -2.5
branch data
1 2 "1" 1 0.01 0.05 0.02 200.0
1 3 "1" 1 0.015 0.08 0.03 200.0
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "cgmes",
    name: "CIM / CGMES",
    tier: "alpha",
    ext: "cgmes",
    extensions: [".cgmes", ".xml", ".rdf"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#" xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:BaseVoltage rdf:ID="_BV_110">
    <cim:BaseVoltage.nominalVoltage>110</cim:BaseVoltage.nominalVoltage>
  </cim:BaseVoltage>
  <cim:Substation rdf:ID="_SUB_1">
    <cim:IdentifiedObject.name>Substation_Alpha</cim:IdentifiedObject.name>
  </cim:Substation>
</rdf:RDF>
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "ocpp",
    name: "OCPP EV Charging",
    tier: "alpha",
    ext: "ocpp",
    extensions: [".ocpp", ".ocpp.json"],
    family: "xml",
    defaultCode: `{
  "protocol": "OCPP 2.0.1",
  "stationId": "EVSE_001",
  "messageType": "BootNotificationRequest",
  "chargingStation": {
    "model": "FastCharger-350kW",
    "vendorName": "GridCharge"
  },
  "reason": "PowerUp"
}
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "openadr",
    name: "OpenADR Demand Response",
    tier: "alpha",
    ext: "oadr",
    extensions: [".oadr", ".openadr.xml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<oadrPayload xmlns="http://openadr.org/oadr-2.0b/2012/07">
  <oadrSignedObject>
    <oadrDistributeEvent>
      <vtnID>VTN_GRID_01</vtnID>
      <oadrEvent>
        <eiEvent>
          <eventDescriptor>
            <eventID>DR_PEAK_SHAVE_01</eventID>
            <eventStatus>active</eventStatus>
          </eventDescriptor>
        </eiEvent>
      </oadrEvent>
    </oadrDistributeEvent>
  </oadrSignedObject>
</oadrPayload>
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "tough",
    name: "LBNL TOUGH Subsurface",
    tier: "alpha",
    ext: "tgh",
    extensions: [".tgh", ".tough"],
    family: "ini",
    defaultCode: `TOUGH2 1D Geothermal Reservoir Simulation
ROCKS----1----*----2----*----3----*----4----*----5----*----6----*----7----*----8
SAND1    2      2600.     0.20  1.0e-13  1.0e-13  1.0e-13     2.51     1000.
PARAM----1----*----2----*----3----*----4----*----5----*----6----*----7----*----8
    2 1000   1000000 0000000000000000000000000
ENDCY
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "matpower",
    name: "MATPOWER OPF",
    tier: "alpha",
    ext: "m",
    extensions: [".m"],
    family: "c",
    defaultCode: `function mpc = case3_sample
mpc.version = '2';
mpc.baseMVA = 100;
mpc.bus = [
  1 3 0   0  0 0 1 1.02 0  230 1 1.05 0.95;
  2 2 0   0  0 0 1 1.01 0  230 1 1.05 0.95;
  3 1 80  25 0 0 1 1.00 0  230 1 1.05 0.95;
];
mpc.gen = [
  1 70 0 50 -50 1.02 100 1 150 10;
  2 30 0 40 -40 1.01 100 1 100 10;
];
mpc.branch = [
  1 2 0.01 0.05 0.02 200 200 200 0 0 1 -360 360;
  2 3 0.01 0.06 0.02 200 200 200 0 0 1 -360 360;
];
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "scl",
    name: "IEC 61850 SCL",
    tier: "alpha",
    ext: "scd",
    extensions: [".scd", ".icd", ".cid"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<SCL xmlns="http://www.iec.ch/61850/2003/SCL" version="2007" revision="B">
  <Header id="Substation_Alpha_SCD" version="1" revision="0"/>
  <Substation name="Substation_1">
    <VoltageLevel name="110kV">
      <Bay name="Feeder_Bay_1"/>
    </VoltageLevel>
  </Substation>
  <IED name="Relay_PROT_1"/>
</SCL>
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "atp",
    name: "ATP-EMTP",
    tier: "alpha",
    ext: "atp",
    extensions: [".atp"],
    family: "spice",
    defaultCode: `BEGIN NEW DATA CASE
C ATP-EMTP Switching Transient Sample
   1.0E-6   0.05
/BRANCH
  BUS1  BUS2            0.5    15.0    0.01
/SWITCH
  BUS2  LOAD            0.01   0.05
/SOURCE
14BUS1                  169.7E3  60.0
BLANK CARD ENDING CASE
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "dnp3",
    name: "IEEE 1815 / DNP3",
    tier: "alpha",
    ext: "dnp3",
    extensions: [".dnp3"],
    family: "ini",
    defaultCode: `[DNP3_OUTSTATION]
masterAddress = 1
outstationAddress = 10
port = 20000

[POINTS]
BI_0 = "Breaker_1_Closed", class=1
AI_0 = "Bus_1_Voltage_kV", class=2, deadband=0.5
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "oneliner",
    name: "ASPEN OneLiner / CAPE",
    tier: "alpha",
    ext: "olx",
    extensions: [".olx", ".dxt"],
    family: "ini",
    defaultCode: `[ASPEN_ONELINER]
SystemMVA = 100.0
FrequencyHz = 60.0

[BUS]
1, "BUS_HV_230", 230.0
2, "BUS_LV_69", 69.0

[TRANSFORMER]
"T1", 1, 2, 100.0, X1=0.08, X0=0.07
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "sel",
    name: "SEL Relay Settings",
    tier: "alpha",
    ext: "rdb",
    extensions: [".rdb", ".txt"],
    family: "ini",
    defaultCode: `[SEL-421 PROTECTION SETTINGS]
RID = "FEEDER_1_LINE_PROT"
CTR = 240
PTR = 2000
E21P = 2
Z1MAG = 4.50
Z1ANG = 82.5
50P1P = 12.0
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "optical",
    name: "OpenROADM & Telcordia .sor",
    tier: "alpha",
    ext: "sor",
    extensions: [".sor", ".opt"],
    family: "ini",
    defaultCode: `[OTDR_TRACE]
wavelength_nm = 1550
pulse_width_ns = 100
fiber_length_km = 42.5
attenuation_db_per_km = 0.19
events = [
  { distance_km: 12.4, splice_loss_db: 0.08 },
  { distance_km: 28.1, splice_loss_db: 0.11 }
]
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "ran",
    name: "NSMA WG16 & Planet Antenna",
    tier: "alpha",
    ext: "adf",
    extensions: [".adf", ".pat", ".msi"],
    family: "ini",
    defaultCode: `REVNUM:,NSMA WG16.99.050
ANTMAN:,ModelScript RF
MODNUM:,NR_3500_64T64R
LOWFRQ:,3300
HGHFRQ:,3800
GAIN:,18.5 dBi
HWIDTH:,65
VWIDTH:,12
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "fiber",
    name: "TIA-598-D Outside Plant",
    tier: "beta",
    ext: "geojson",
    extensions: [".geojson", ".kml"],
    family: "xml",
    defaultCode: `{
  "type": "FeatureCollection",
  "features": [
    {
      "type": "Feature",
      "properties": { "id": "DUCT_01", "fiberCount": 144, "standard": "TIA-598-D" },
      "geometry": { "type": "LineString", "coordinates": [[-73.985, 40.748], [-73.978, 40.754]] }
    }
  ]
}
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "hec-ras",
    name: "USACE HEC-RAS",
    tier: "alpha",
    ext: "g01",
    extensions: [".g01", ".prj"],
    family: "ini",
    defaultCode: `Geom Title=River_Reach_1D
Program Version=6.41
River Reach=ClearCreek      ,UpperReach
XS GIS Cut Line=2
  0.0  100.0
  50.0 95.0
  100.0 100.0
Manning's n=0.035,0.030,0.035
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "modflow",
    name: "USGS MODFLOW",
    tier: "alpha",
    ext: "dis",
    extensions: [".dis", ".nam"],
    family: "ini",
    defaultCode: `# MODFLOW 6 Discretization (DIS)
BEGIN OPTIONS
  LENGTH_UNITS METERS
END OPTIONS

BEGIN DIMENSIONS
  NLAY 1
  NROW 10
  NCOL 10
END DIMENSIONS

BEGIN GRIDDATA
  DELR CONSTANT 100.0
  DELC CONSTANT 100.0
  TOP CONSTANT 50.0
  BOTM CONSTANT 0.0
END GRIDDATA
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "landgem",
    name: "EPA LandGEM",
    tier: "alpha",
    ext: "landgem",
    extensions: [".landgem"],
    family: "ini",
    defaultCode: `[LANDGEM_MODEL]
LandfillName = Regional_MSW_Cell_1
OpenYear = 2005
ClosureYear = 2025
MethaneGenerationRate_k = 0.05
PotentialMethaneCapacity_L0 = 170
NMOC_Concentration_ppmv = 4000
MethaneContent_pct = 50
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "hec-hms",
    name: "USACE HEC-HMS",
    tier: "alpha",
    ext: "basin",
    extensions: [".basin"],
    family: "ini",
    defaultCode: `Basin: Watershed_North
     Last Modified Date: 16 November 2026
End:

Subbasin: Upper_Basin
     Area: 42.5
     LossRate: SCS
     Curve Number: 72
     Transform: SCS
     Lag: 120
End:
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "waterml",
    name: "OGC WaterML 2.0",
    tier: "alpha",
    ext: "waterml",
    extensions: [".waterml", ".xml"],
    family: "xml",
    defaultCode: `<?xml version="1.0" encoding="UTF-8"?>
<wml2:Collection xmlns:wml2="http://www.opengis.net/waterml/2.0">
  <wml2:observationMember>
    <wml2:MeasurementTimeseries>
      <wml2:point>
        <wml2:MeasurementTVP>
          <wml2:time>2026-11-16T12:00:00Z</wml2:time>
          <wml2:value>14.2</wml2:value>
        </wml2:MeasurementTVP>
      </wml2:point>
    </wml2:MeasurementTimeseries>
  </wml2:observationMember>
</wml2:Collection>
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "asm",
    name: "IWA Activated Sludge Models",
    tier: "alpha",
    ext: "asm",
    extensions: [".asm"],
    family: "ini",
    defaultCode: `model ASM1_Aeration_Basin
# State variables (g COD/m3, g N/m3)
S_I = 30.0
S_S = 69.5
X_BH = 28.2
S_O = 2.0
S_NH = 31.6
mu_H = 6.0
K_S = 20.0
Y_H = 0.67
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "mlxtran",
    name: "MLXTRAN (Monolix)",
    tier: "alpha",
    ext: "mlxtran",
    extensions: [".mlxtran"],
    family: "ini",
    defaultCode: `[LONGITUDINAL]
input = {ka, V, Cl}

EQUATION:
Cc = pkmodel(ka, V, Cl)

OUTPUT:
output = Cc
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "nmodl",
    name: "NMODL (NEURON)",
    tier: "alpha",
    ext: "mod",
    extensions: [".mod", ".nmodl"],
    family: "c",
    defaultCode: `TITLE Hodgkin-Huxley Sodium Channel
NEURON {
  SUFFIX hh_na
  USEION na READ ena WRITE ina
  RANGE gnabar, ina
}
PARAMETER {
  gnabar = 0.12 (S/cm2)
}
STATE { m h }
BREAKPOINT {
  SOLVE states METHOD cnexp
  ina = gnabar * m*m*m*h * (v - ena)
}
`,
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "acsl",
    name: "ACSL",
    tier: "beta",
    ext: "csl",
    extensions: [".csl"],
    family: "plaintext",
    defaultCode:
      "PROGRAM SPRING_MASS\n  ! Classic damped harmonic oscillator in ACSL\n  INITIAL\n    CONSTANT k = 4.0, c = 0.2, m = 1.0\n    CONSTANT x0 = 1.0, v0 = 0.0\n    INTEGER npts = 100\n    LOGICAL active = .TRUE.\n    ARRAY gains(3) = 1.0, 2.0, 3.0\n    TABLE ftab, 1, 3 / 0.0, 1.0, 2.0, 0.0, 1.0, 4.0 /\n    CINTERVAL cint = 0.05\n    MAXTERVAL maxt = 0.01\n    ALGORITHM ialg = 5\n  END\n\n  DYNAMIC\n    DERIVATIVE\n      DERIVT = a\n      a = (-k * x - c * v) / m\n      v = INTEG(a, v0)\n      x = INTEG(v, x0)\n      PROCEDURAL(energy = x, v)\n        energy = 0.5 * m * v**2 + 0.5 * k * x**2\n      END\n      SCHEDULE sample_ev .AT. 1.0\n    END\n\n    DISCRETE sample_ev\n      INTERVAL dt = 0.5\n      sampled_x = x\n    END\n\n    TERMT(t .GE. 5.0, 'Simulation complete')\n  END\n\n  TERMINAL\n    final_e = 0.5 * k * x**2\n  END\nEND",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "apdl",
    name: "ANSYS APDL",
    tier: "beta",
    ext: "apdl",
    extensions: [".apdl"],
    family: "plaintext",
    defaultCode:
      "! Cantilever beam model\n/TITLE, Cantilever Beam Test\n/UNITS, SI\n/PREP7\nET, 1, BEAM188 ! 3D beam element\nMP, EX, 1, 210e9 $ MP, PRXY, 1, 0.3\nSECTYPE, 1, BEAM, RECT\nSECDATA, 0.05, 0.10\nK, 1, 0, 0, 0\nK, 2, 2.0, 0, 0\nL, 1, 2\nESIZE, , 4\nLMESH, ALL\nFINISH\n/SOLU\nANTYPE, STATIC\nD, 1, ALL, 0\nF, 5, FY, -1000\nSOLVE\nFINISH\n/POST1\nPRNSOL, U, COMP\nFINISH",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "apt",
    name: "APT",
    tier: "beta",
    ext: "apt",
    extensions: [".apt"],
    family: "plaintext",
    defaultCode:
      "PARTNO / POCKET_MILL_01\nMACHIN / MILL, 1\nUNITS / MM\nCUTTER / 10.0\nSPINDL / 3500, CLW\nFEDRAT / 400.0\nFROM / 0.0, 0.0, 50.0\nGOTO / 20.0, 20.0, 5.0\nGOTO / 20.0, 20.0, -5.0\nGOTO / 80.0, 20.0, -5.0\nGOTO / 80.0, 60.0, -5.0\nGOTO / 20.0, 60.0, -5.0\nGOTO / 20.0, 20.0, -5.0\nRAPID\nGOTO / 0.0, 0.0, 50.0\nFINI",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "arinc429",
    name: "ARINC 429",
    tier: "beta",
    ext: "a429",
    extensions: [".a429"],
    family: "plaintext",
    defaultCode: "BUS BAD_BUS\nRATE TURBO\nFRAME 0.1 WORD NOTHEX\nUNKNOWN_DIRECTIVE 123",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "asn1",
    name: "ASN.1",
    tier: "beta",
    ext: "asn",
    extensions: [".asn"],
    family: "plaintext",
    defaultCode:
      "-- RFC 1157 inspired SNMPv1 subset\nSNMPv1-Demo { iso(1) org(3) dod(6) internet(1) mgmt(2) }\nDEFINITIONS IMPLICIT TAGS ::= BEGIN\n\nEXPORTS Message, PDUs;\nIMPORTS ObjectName FROM RFC1155-SMI;\n\nMessage ::= SEQUENCE {\n  version INTEGER { version-1(0) },\n  community OCTET STRING (SIZE (1..64)),\n  data PDUs\n}\n\nPDUs ::= CHOICE {\n  get-request [0] GetRequest-PDU,\n  get-response [2] GetResponse-PDU\n}\n\nGetRequest-PDU ::= SEQUENCE {\n  request-id INTEGER (-2147483648..2147483647),\n  error-status ENUMERATED { noError(0), tooBig(1), noSuchName(2) },\n  error-index INTEGER (0..255) DEFAULT 0,\n  variable-bindings SEQUENCE (SIZE (0..16)) OF VarBind OPTIONAL\n}\n\nGetResponse-PDU ::= GetRequest-PDU\n\nVarBind ::= SEQUENCE {\n  name OBJECT IDENTIFIER,\n  value UTF8String\n}\n\nrsaEncryption OBJECT IDENTIFIER ::= { 1 2 840 113549 1 1 1 }\n\nEND",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "atopile",
    name: "ATOPILE",
    tier: "beta",
    ext: "ato",
    extensions: [".ato"],
    family: "plaintext",
    defaultCode:
      'from "generics/resistors.ato" import Resistor\n\nmodule VoltageDivider:\n    signal v_in\n    signal v_out\n    signal gnd\n\n    r_top = new Resistor\n    r_bot = new Resistor\n    r_top.resistance = 10kohm +/- 1%\n    r_bot.resistance = 10kohm +/- 1%\n\n    v_in ~> r_top ~> v_out\n    v_out ~> r_bot ~> gnd\n\n    assert r_top.resistance within 9.5kohm to 10.5kohm',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "bufr",
    name: "WMO BUFR",
    tier: "beta",
    ext: "bufr",
    extensions: [".bufr"],
    family: "plaintext",
    defaultCode:
      "# WMO BUFR Edition 4 SYNOP Surface Report\nBUFR EDITION 4 NAME OAKLAND_SYNOP\nSECTION 0\n  LENGTH = 0\nSECTION 1\n  MASTER_TABLE = 0\n  CENTRE = 7\n  SUBCENTRE = 0\n  CATEGORY = 0\n  VERSION = 38\n  YEAR = 2026\n  MONTH = 6\n  DAY = 15\n  HOUR = 12\n  MINUTE = 0\n  SECOND = 0\nSECTION 3\n  SUBSETS = 1\n  OBSERVED = true\n  COMPRESSED = false\n  DESCRIPTORS:\n    3-07-080\nSECTION 4\n  SUBSET 1:\n    0-01-001 = 72\n    0-01-002 = 493\n    0-04-001 = 2026\n    0-04-002 = 6\n    0-04-003 = 15\n    0-04-004 = 12\n    0-04-005 = 0\n    0-05-001 = 37.75000\n    0-06-001 = -122.22000\n    0-07-001 = 3\n    0-10-004 = 101320\n    0-10-051 = 101350\n    0-12-101 = 291.15\n    0-12-103 = 285.15\n    0-13-003 = 68\n    0-11-001 = 270\n    0-11-002 = 6.5\n    0-13-011 = 0.0\nSECTION 5\n7777",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "c37118",
    name: "C37118",
    tier: "alpha",
    ext: "c37118",
    extensions: [".c37118"],
    family: "plaintext",
    defaultCode:
      "pmu Sub_East_PMU idcode=101 fnom=60 rate=30\nphasor VA_1 V format=polar scale=1.0 mag=138000 ang=0.0\nphasor IA_1 I format=polar scale=1.0 mag=420 ang=-12.5\nanalog P_MW units=MW scale=1.0 init=100.4\ndigital BRK_52A\nframe 2026-11-17T20:00:00.000Z 60.002 -0.01",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "cea",
    name: "NASA CEA",
    tier: "beta",
    ext: "cea",
    extensions: [".cea"],
    family: "plaintext",
    defaultCode:
      "# SSME-class LOX/LH2 rocket deck\n! NASA RP-1311 reference example\nproblem case=SSME_LOX_LH2 rocket equilibrium\n  p,bar=200 o/f=6.0 supar=77.5\nreactants\n  fuel=H2(L) wt%=100 t(k)=20.27\n  oxid=O2(L) wt%=100 t(k)=90.17\noutput siunits short trace=1e-5\nend",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "chemkin",
    name: "CHEMKIN",
    tier: "beta",
    ext: "inp",
    extensions: [".inp"],
    family: "plaintext",
    defaultCode:
      "! Sandia CHEMKIN H2/O2 sample mechanism\nELEMENTS\n  H O N AR/39.948/\nEND\n\nSPECIES\n  H2 O2 H2O OH H O HO2 N2\nEND\n\nTHERMO ALL\n   300.000  1000.000  5000.000\nH2O               L 8/89H   2O   1    0    0G   200.000  3500.000  1000.000    1\n 3.03399249E+00 2.17691804E-03-1.64072518E-07-9.70419870E-11 1.68200992E-14    2\n-3.00042971E+04 4.96677010E+00 4.19864056E+00-2.03643410E-03 6.52040211E-06    3\n-5.48797062E-09 1.77197817E-12-3.02937267E+04-8.49032208E-01                   4\nEND\n\nREACTIONS KCAL/MOLE MOLES\n  ! Chain branching\n  H + O2 <=> O + OH                 1.915E+14   0.00   16.44\n  O + H2 = H + OH                   5.080E+04   2.67    6.29\n  H2 + O2 => 2 OH                   1.700E+13   0.00   47.78\n  ! Three-body recombination\n  H + OH + M <=> H2O + M            2.200E+22  -2.00    0.00\n    H2/2.5/ H2O/12.0/ N2/1.0/\n  ! Falloff reaction with LOW + TROE\n  H + O2 (+M) <=> HO2 (+M)          1.475E+12   0.60    0.00\n    LOW / 6.366E+20 -1.72 0.525 /\n    TROE / 0.5 1.0E-30 1.0E+30 1.0E+100 /\n    H2/2.0/ H2O/11.0/\n  ! Duplicate reaction pair\n  HO2 + HO2 <=> H2O + O2            1.300E+11   0.00   -1.63\n    DUPLICATE\n  HO2 + HO2 <=> H2O + O2            4.200E+14   0.00   11.98\n    DUP\n  ! Explicit REV and PLOG + SRI\n  O + O + M <=> O2 + M              1.890E+13   0.00   -1.788\n    REV / 1.800E+18 -1.00 118.0 /\n  H + O2 <=> HO2                    1.000E+12   0.00    0.00\n    PLOG / 0.1 1.0E+11 0.0 0.0 /\n    PLOG / 1.0 1.0E+12 0.0 0.0 /\n    PLOG / 10.0 5.0E+12 0.0 0.0 /\nEND",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "cif",
    name: "CIF",
    tier: "beta",
    ext: "cif",
    extensions: [".cif"],
    family: "plaintext",
    defaultCode:
      "( Top-level comment (with nested parens) );\n      DS 1 100/2;\n        9 INV_CELL;\n        L CAA;\n        B 4 6 2 3;\n      DF;\n      DD 1;\n      C 1 T 500 200;\n      E",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "cplex-lp",
    name: "CPLEX LP",
    tier: "beta",
    ext: "lp",
    extensions: [".lp"],
    family: "plaintext",
    defaultCode:
      "\\\\ Standard CPLEX LP full-feature test\nMaximize\n  obj: 3 x1 + 2.5 x2 - 4 x3 + 1.5e1 x4 + 10\nSubject To\n  c1: x1 + 2 x2 <= 10\n  c2: 3 x1 - x3 >= 4\n  c3: x2 + x4 = 6\nBounds\n  0 <= x1 <= 8\n  x2 >= 1\n  x3 free\n  -inf <= x4 <= +infinity\nGenerals\n  x1\nBinaries\n  y1 y2\nSemi-Continuous\n  s1\nSOS\n  sos1: S1:: y1:1 y2:2\nEnd",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "csmp",
    name: "CSMP",
    tier: "beta",
    ext: "csmp",
    extensions: [".csmp"],
    family: "plaintext",
    defaultCode:
      "* IBM System/360 CSMP Damped Spring-Mass Example\nTITLE DAMPED SPRING-MASS SYSTEM\nINITIAL\n  CONST PI2 = 6.2831853\n  PARAM M = 1.0, C = 0.4, K = 4.0\n  INCON X0 = 1.0, V0 = 0.0\n  FIXED NSTEP\n  WN = SQRT(K / M)\nDYNAMIC\nSORT\n  XDD = (-C * XD - K * X) / M\n  XD = INTGRL(V0, XDD)\n  X = INTGRL(X0, XD)\nNOSORT\n  ENERGY = 0.5 * M * XD**2 + ...\n           0.5 * K * X**2\nTERMINAL\n  FINAL_E = ENERGY\nTIMER FINTIM = 10.0, DELT = 0.01, PRDEL = 0.5, OUTDEL = 0.5\nMETHOD RKSFX\nPRINT X, XD, ENERGY\nPRTPLT X(XD)\nEND\nSTOP",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "cyme",
    name: "CYME",
    tier: "alpha",
    ext: "sxst",
    extensions: [".sxst"],
    family: "plaintext",
    defaultCode:
      "<CymeStudy>\n  <NetworkID>Feeder_12_47</NetworkID>\n  <Frequency>60</Frequency>\n  <Node><NodeID>SUB_1</NodeID><NominalKV>12.47</NominalKV></Node>\n  <Node><NodeID>N_2</NodeID><NominalKV>12.47</NominalKV></Node>\n  <Source><SourceID>SRC_1</SourceID><NodeID>SUB_1</NodeID><NominalKV>12.47</NominalKV><OperatingKV>12.72</OperatingKV></Source>\n  <Section>\n    <SectionID>SEC_1_2</SectionID>\n    <FromNodeID>SUB_1</FromNodeID>\n    <ToNodeID>N_2</ToNodeID>\n    <Phase>ABC</Phase>\n    <Length>500</Length>\n    <DeviceType>OverheadLine</DeviceType>\n    <R1>0.2</R1>\n    <X1>0.4</X1>\n  </Section>\n  <SpotLoad><LoadID>L_2</LoadID><NodeID>N_2</NodeID><Phase>ABC</Phase><KW>350</KW><KVAR>120</KVAR></SpotLoad>\n</CymeStudy>",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "datcom",
    name: "DATCOM",
    tier: "beta",
    ext: "dcm",
    extensions: [".dcm"],
    family: "plaintext",
    defaultCode:
      '@modelscript/datcom`.\n *\n * Verifies:\n * 1. High-aspect-ratio unswept NACA 0012 wing CL_alpha vs Prandtl lifting-line 2*pi / (1 + 2/AR)\n * 2. Prandtl-Glauert subsonic Mach scaling CL_alpha(M) / CL_alpha(0)\n * 3. Induced drag polar CD_i = CL^2 / (pi * e * AR)\n * 4. Phugoid & short-period linearized longitudinal modal parity\n */\n\nimport assert from "node:assert/strict";\nimport { describe, it } from "node:test";\nimport { DATCOM_AIRCRAFT_TEMPLATES } from "../src/catalog/datcom-std-schemas.js";\nimport { parseDatcomDeck } from "../src/parser/deck-parser.js";\nimport { solveDatcomCase } from "../src/solver/aero-solver.js";\n\nfunction relErr(actual: number, expected: number): number {\n  return Math.abs(actual - expected) / Math.max(1e-12, Math.abs(expected));\n}\n\ndescribe("DATCOM Semi-Empirical Aerodynamic Benchmarks", () => {\n  it("matches Prandtl lifting-line CL_alpha = 2*pi/(1 + 2/AR) for high-AR unswept NACA 0012 wing", () => {\n    const deck = parseDatcomDeck(\n      [\n        "CASEID HIGH AR NACA 0012 WING",\n        "DIM M",\n        "DERIV DEG",\n        " $FLTCON NMACH=1.0, MACH(1)=0.05, NALPHA=5.0, ALSCHD(1)=-2.0,0.0,2.0,4.0,6.0, NALT=1.0, ALT(1)=0.0$",\n        " $WGPLNF CHRDR=1.0, CHRDTP=1.0, SSPN=6.0, SAVSI=0.0, CHSTAT=0.25, TYPE=1.0$",\n        "NACA-W-4-0012",\n      ].join("\\n"),\n    );\n\n    const res = solveDatcomCase(deck.cases[0]!);\n    const AR = 12.0; // b = 12 m, c = 1 m -> AR = 12\n    assert.ok(relErr(res.aspectRatio, AR) < 1e-6);\n\n    const liftingLineCLalpha = (2 * Math.PI) / (1 + 2 / AR);\n    const err = relErr(res.CLalphaPerRad, liftingLineCLalpha);\n    const tolerance = 0.025; // Helmbold/Polhamus vs Prandtl lifting-line within 2.5% at AR=12\n    assert.ok(\n      err < tolerance,',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "doe2",
    name: "DOE-2 BDL",
    tier: "beta",
    ext: "inp",
    extensions: [".inp"],
    family: "plaintext",
    defaultCode:
      'INPUT LOADS UNITS = SI ..\n"M1" = MATERIAL TYPE = PROPERTIES THICKNESS = 0.2 CONDUCTIVITY = 1.4 ..\nSTOP ..',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "dxf",
    name: "DXF",
    tier: "beta",
    ext: "dxf",
    extensions: [".dxf"],
    family: "plaintext",
    defaultCode:
      ');\n\n      // Verify stadium (2 straight edges + 2 semicircular caps) via computeLwPolylineLength & Area\n      const stadium = {\n        type: "LWPOLYLINE" as const,\n        layer: "0",\n        line: 1,\n        startOffset: 0,\n        endOffset: 1,\n        closed: true,\n        elevation: 0,\n        vertices: [\n          { x: 0, y: 0, bulge: 0 },\n          { x: 30, y: 0, bulge: 1 },\n          { x: 30, y: 10, bulge: 0 },\n          { x: 0, y: 10, bulge: 1 },\n        ],\n      };\n      const expectedStadiumPerim = 2 * 30 + 2 * Math.PI * 5;\n      const expectedStadiumArea = 30 * 10 + Math.PI * 25;\n      assertRelErr(computeLwPolylineLength(stadium), expectedStadiumPerim, tolerance, "stadium.perimeter");\n      assertRelErr(computeLwPolylineArea(stadium), expectedStadiumArea, tolerance, "stadium.area");\n    }\n  });\n\n  it("matches analytical hierarchical nested INSERT transforms (base point, scale, rotation, translation)", () => {\n    const tolerance = 1e-9;\n    // Leaf block',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "dynamo",
    name: "DYNAMO",
    tier: "beta",
    ext: "dyn",
    extensions: [".dyn"],
    family: "plaintext",
    defaultCode:
      "NOTE POPULATION GROWTH MODEL\n* CLASSIC MIT DYNAMO DECK\nL POP.K=POP.J+(DT)*(BIRTH.JK-DEATH.JK)\nN POP=1000\nR BIRTH.KL=POP.K*BR.K\nR DEATH.KL=POP.K*DR\nA BR.K=TABHL(BRTAB,CROWD.K,0,4,1)\nA CROWD.K=POP.K/CAP\nS NETGR.K=BIRTH.JK-DEATH.JK\nC DR=0.02, CAP=5000\nT BRTAB=0.05/0.04/0.03/0.02/0.01\nSPEC DT=0.25/LENGTH=50/PRTPER=5/PLTPER=2\nPRINT POP,BIRTH,DEATH\nPLOT POP=P(0,6000)/BIRTH=B\nRUN BASE",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "edif",
    name: "EDIF",
    tier: "beta",
    ext: "edf",
    extensions: [".edf"],
    family: "plaintext",
    defaultCode:
      '(edif rc_divider\n  (edifVersion 2 0 0)\n  (edifLevel 0)\n  (keywordMap (keywordLevel 0))\n  (status\n    (written\n      (timeStamp 2026 11 22 12 0 0)\n      (author "ModelScript")\n      (program "msx" (version "0.1.0"))\n      (comment "Sample EDIF 2.0.0 netlist")))\n  (external PRIMITIVES\n    (edifLevel 0)\n    (technology (numberDefinition))\n    (cell RES\n      (cellType GENERIC)\n      (view netlist\n        (viewType NETLIST)\n        (interface\n          (port P (direction INOUT))\n          (port N (direction INOUT)))))\n    (cell CAP\n      (cellType GENERIC)\n      (view netlist\n        (viewType NETLIST)\n        (interface\n          (port P (direction INOUT))\n          (port N (direction INOUT))))))\n  (library WORK\n    (edifLevel 0)\n    (technology (numberDefinition))\n    (cell (rename TopDiv "Top-Divider")\n      (cellType GENERIC)\n      (view netlist\n        (viewType NETLIST)\n        (interface\n          (port VIN (direction INPUT))\n          (port VOUT (direction OUTPUT))\n          (port GND (direction INOUT)))\n        (contents\n          (instance R1\n            (viewRef netlist (cellRef RES (libraryRef PRIMITIVES)))\n            (property R (number (e 10 3)))\n            (designator "R1"))\n          (instance C1\n            (viewRef netlist (cellRef CAP (libraryRef PRIMITIVES)))\n            (property C (string "100nF")))\n          (net N_IN (joined (portRef VIN) (portRef P (instanceRef R1))))\n          (net N_OUT (joined (portRef VOUT) (portRef N (instanceRef R1)) (portRef P (instanceRef C1))))\n          (net N_GND (joined (portRef GND) (portRef N (instanceRef C1))))))))\n  (design TopDesign (cellRef TopDiv (libraryRef WORK))))',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "endf6",
    name: "ENDF-6",
    tier: "beta",
    ext: "endf",
    extensions: [".endf"],
    family: "plaintext",
    defaultCode:
      " 9228 1451 1234567890   0  0  0  0  0  0  0  0  0 92235 1451    1\n 9.223500+4 2.330250+2         -1          0          0          0 9228 1451    2\n 0.000000+0 0.000000+0          0          0          0          6 9228 1451    3\n 1.000000+0 2.000000+7          3          0         10          2 9228 1451    4\n 92-U-235   BNL        EVAL-JUL20  ENDF/B-VIII.0                 9228 1451    5",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "esl",
    name: "ESL",
    tier: "beta",
    ext: "esl",
    extensions: [".esl"],
    family: "plaintext",
    defaultCode:
      "-- ESA ESL Orbital & Attitude Study\nSTUDY OrbitStudy\n  PACKAGE Constants\n    CONSTANT REAL: MU = 3.986004418e14;\n    CONSTANT REAL: G0 = 9.80665;\n  END PACKAGE Constants\n\n  SUBMODEL AttCtrl(IN REAL: err; OUT REAL: u)\n    CONSTANT REAL: KP = 2.5;\n  DYNAMIC\n    u = -KP * err;\n  END SUBMODEL AttCtrl\n\n  MODEL Spacecraft\n    REAL: theta, omega, u;\n    INTEGER: mode = 0;\n    LOGICAL: active = TRUE;\n  INITIAL\n    theta = 0.5;\n    omega = 0.0;\n  DYNAMIC\n    AttCtrl(theta, u);\n    theta' = omega;\n    omega' = u;\n    IF theta > 0.1 THEN\n      mode = 1;\n    ELSE\n      mode = 0;\n    END_IF\n    WHEN theta <= 0.0 THEN\n      active := FALSE;\n    END_WHEN\n  STEP\n    mode = mode + 1;\n  TERMINAL\n    active = FALSE;\n  END MODEL Spacecraft\n\n  SEGMENT PostFlight\n    REAL: metric = 0.0;\n  DYNAMIC\n    metric = 1.0;\n  END SEGMENT PostFlight\nEND STUDY OrbitStudy",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "esterel",
    name: "Esterel",
    tier: "beta",
    ext: "strl",
    extensions: [".strl"],
    family: "plaintext",
    defaultCode:
      "% Classic Berry ABRO module\n      %{ Multi-line Esterel comment }%\n      module ABRO:\n      input A, B, R;\n      output O;\n      loop\n        [ await A || await B ];\n        emit O\n      each R\n      end module",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "fits",
    name: "FITS",
    tier: "beta",
    ext: "fits",
    extensions: [".fits"],
    family: "plaintext",
    defaultCode:
      ",\n        projection,\n        crpix1: 512.5,\n        crpix2: 512.5,\n        crval1: 210.8023,\n        crval2: 54.3489,\n        cd1_1: -scale * Math.cos(theta),\n        cd1_2: scale * Math.sin(theta),\n        cd2_1: scale * Math.sin(theta),\n        cd2_2: scale * Math.cos(theta),\n        lonpole: 180.0,\n      };\n\n      for (const px of testPixels) {\n        const sky = pixelToWorld(wcs, px);\n        const recovered = worldToPixel(wcs, sky);\n        const relErrX = Math.abs(recovered.x - px.x) / Math.max(1.0, Math.abs(px.x));\n        const relErrY = Math.abs(recovered.y - px.y) / Math.max(1.0, Math.abs(px.y));\n\n        assert.ok(\n          relErrX < 1e-10 && relErrY < 1e-10,",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gams",
    name: "GAMS",
    tier: "beta",
    ext: "gms",
    extensions: [".gms"],
    family: "plaintext",
    defaultCode:
      "$title A Transportation Problem (TRNSPORT, SEQ=1)\n* Classic Dantzig (1963) transportation problem\n$ontext\n  Multi-line block comment ignored by the lexer.\n$offtext\n\nSets\n  i   canning plants   / seattle, san-diego /\n  j   markets          / new-york, chicago, topeka / ;\n\nParameters\n  a(i)  capacity of plant i in cases\n    / seattle    350\n      san-diego  600 /\n  b(j)  demand at market j in cases\n    / new-york   325\n      chicago    300\n      topeka     275 / ;\n\nTable d(i,j)  distance in thousands of miles\n                  new-york  chicago  topeka\n  seattle            2.5      1.7     1.8\n  san-diego          2.5      1.8     1.4 ;\n\nScalar f  freight in dollars per case per thousand miles / 90 / ;\nParameter c(i,j)  transport cost in thousands of dollars per case ;\nc(i,j) = f * d(i,j) / 1000 ;\n\nVariables\n  x(i,j)  shipment quantities in cases\n  z       total transportation costs in thousands of dollars ;\nPositive Variable x ;\n\nEquations\n  cost        define objective function\n  supply(i)   observe supply limit at plant i\n  demand(j)   satisfy demand at market j ;\n\ncost..        z  =e=  sum((i,j), c(i,j)*x(i,j)) ;\nsupply(i)..   sum(j, x(i,j))  =l=  a(i) ;\ndemand(j)..   sum(i, x(i,j))  =g=  b(j) ;\n\nModel transport / all / ;\nSolve transport using lp minimizing z ;\nDisplay x.l, x.m, z.l ;",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gaussian",
    name: "Gaussian",
    tier: "beta",
    ext: "gjf",
    extensions: [".gjf"],
    family: "plaintext",
    defaultCode:
      "! Water optimization and frequency calculation\n%chk=water.chk\n%mem=4GB\n%nprocshared=8\n%rwf=water.rwf\n#p B3LYP/6-31G(d) opt=(tight,calcfc) freq scrf=(pcm,solvent=water) pop=full scf=tight\n\nWater B3LYP/6-31G(d) Opt+Freq\n\n0 1\nO   0.000000   0.000000   0.117300\nH   0.000000   0.757200  -0.469200\nH   0.000000  -0.757200  -0.469200",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gcode",
    name: "G-code",
    tier: "beta",
    ext: "nc",
    extensions: [".nc"],
    family: "plaintext",
    defaultCode:
      "%\nO1001 (RECTANGULAR PROFILE)\nG21 G90 G17\nT01 M06\nS3000 M03\nG00 X0.0 Y0.0 Z10.0\nG01 Z-2.0 F120.0\nG01 X60.0 Y0.0 F300.0\nG01 X60.0 Y40.0\nG01 X0.0 Y40.0\nG01 X0.0 Y0.0\nG00 Z10.0\nM05\nM30\n%",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gdsii",
    name: "GDSII",
    tier: "beta",
    ext: "gds",
    extensions: [".gds"],
    family: "plaintext",
    defaultCode:
      '# Cleanroom CMOS sample layout\nHEADER 600\nBGNLIB\nLIBNAME CMOS_TEST_LIB\nUNITS 1e-3 1e-9\n\nBGNSTR\nSTRNAME VIA_CELL\n  BOUNDARY\n  LAYER 4\n  DATATYPE 0\n  XY 0: 0  220: 0  220: 220  0: 220  0: 0\n  ENDEL\nENDSTR\n\nBGNSTR\nSTRNAME TOP_CELL\n  BOUNDARY\n  LAYER 1\n  DATATYPE 0\n  XY 0: 0  2000: 0  2000: 2000  0: 2000  0: 0\n  ENDEL\n  PATH\n  LAYER 5\n  DATATYPE 0\n  PATHTYPE 2\n  WIDTH 240\n  XY 100: 500  1900: 500\n  ENDEL\n  SREF\n  SNAME VIA_CELL\n  STRANS 1000000000000000\n  MAG 1.0\n  ANGLE 90.0\n  XY 500: 500\n  ENDEL\n  AREF\n  SNAME VIA_CELL\n  COLROW 2 3\n  XY 0: 0  1000: 0  0: 1500\n  ENDEL\n  TEXT\n  LAYER 5\n  TEXTTYPE 0\n  XY 100: 500\n  STRING "VDD"\n  ENDEL\nENDSTR\nENDLIB',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gerber",
    name: "Gerber",
    tier: "beta",
    ext: "gbr",
    extensions: [".gbr"],
    family: "plaintext",
    defaultCode:
      "@modelscript/gerber`:\n * 1. 2-Layer PCB (Top Copper + Bottom Ground Plane) trace, pad, arc, and region copper area\n *    and trace-length analytical parity.\n * 2. Inch (",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gpss",
    name: "GPSS",
    tier: "beta",
    ext: "gps",
    extensions: [".gps"],
    family: "plaintext",
    defaultCode:
      "* MODEL: GordonBarbershop\n* Geoffrey Gordon (1961) Classic Single-Barber Queueing Model\n      GENERATE 18,6         ; Customers arrive every 18 +/- 6 minutes\n      QUEUE    LINE         ; Enter waiting line\n      SEIZE    JOE          ; Capture barber Joe\n      DEPART   LINE         ; Leave waiting line\n      ADVANCE  16,4         ; Haircut takes 16 +/- 4 minutes\n      RELEASE  JOE          ; Free barber Joe\n      TERMINATE 1           ; Customer exits\n      START    100          ; Simulate 100 customers\n      END",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "grib",
    name: "WMO GRIB",
    tier: "beta",
    ext: "grb",
    extensions: [".grb"],
    family: "plaintext",
    defaultCode:
      '# Synoptic 500 hPa Temperature & Geopotential Height\nGRIB edition=1\n  IS {\n    edition = 1\n  }\n  PDS {\n    tableVersion = 2\n    center = 7\n    parameter = TMP\n    levelType = ISBL\n    level = 500\n    date = "2026-01-15T12:00"\n    decimalScale = 1\n  }\n  GDS {\n    gridType = 0\n    ni = 3\n    nj = 2\n    la1 = 60.0\n    lo1 = -100.0\n    la2 = 40.0\n    lo2 = -60.0\n    di = 20.0\n    dj = 20.0\n  }\n  BDS {\n    bitsPerValue = 16\n    binaryScale = 0\n    referenceValue = 240.0\n    values = [245.2, 246.8, 248.1, 252.0, 253.5, 255.4]\n  }\n7777',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "gridlabd",
    name: "GRIDLABD",
    tier: "alpha",
    ext: "glm",
    extensions: [".glm"],
    family: "plaintext",
    defaultCode:
      "// IEEE 4-node test feeder excerpt\n#set profiler=1\n#define VSOURCE=7200\n\nclock {\n  timezone EST+5EDT;\n  starttime '2000-01-01 00:00:00';\n  stoptime '2000-01-01 01:00:00';\n}\n\nmodule powerflow {\n  solver_method NR;\n}\n\nschedule load_shape {\n  * 0-5 * * * 0.5;\n  * 6-17 * * * 1.0;\n  * 18-23 * * * 0.8;\n}\n\nobject overhead_line_conductor:100 {\n  name cond_336;\n  resistance 0.306;\n}\n\nobject line_configuration:300 {\n  name lc_300;\n  conductor_A cond_336;\n  z11 0.4576+1.0780j;\n}\n\nobject transformer_configuration:400 {\n  name xfmr_cfg_400;\n  connect_type WYE_WYE;\n  power_rating 6000 kVA;\n  primary_voltage 12470 V;\n  secondary_voltage 4160 V;\n  resistance 0.01;\n  reactance 0.06;\n}\n\nobject node {\n  name node_1;\n  phases ABCN;\n  bustype SWING;\n  nominal_voltage 7.2 kV;\n}\n\nobject node {\n  name node_2;\n  phases ABCN;\n  nominal_voltage 7200 V;\n}\n\nobject overhead_line {\n  name line_1_2;\n  phases ABCN;\n  from node_1;\n  to node_2;\n  length 2000 ft;\n  configuration lc_300;\n}\n\nobject transformer {\n  name xfmr_2_3;\n  phases ABCN;\n  from node_2;\n  to node_3;\n  configuration xfmr_cfg_400;\n}\n\nobject load {\n  name node_3;\n  phases ABCN;\n  nominal_voltage 2400 V;\n  constant_power_A 1800+871.78j kVA;\n  constant_power_B 1800+871.78j kVA;\n  constant_power_C 1800+871.78j kVA;\n\n  object inverter {\n    name inv_3;\n    rated_power 50 kW;\n    object solar {\n      name pv_3;\n      area 250;\n      efficiency 0.2;\n    }\n  }\n}",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "hdf4",
    name: "NCSA HDF4",
    tier: "beta",
    ext: "hdf",
    extensions: [".hdf"],
    family: "plaintext",
    defaultCode:
      '# NASA EOS-HDF MODIS Radiance Granule\nHDF4 MODIS_Granule VERSION="4.2"\n  ATTR Mission = "Terra"\n  ATTR Instrument = "MODIS"\n\n  SDS Radiance TYPE=FLOAT32 REF=10 UNIT="W/(m2.sr.um)"\n    DIM lines = 2\n    DIM pixels = 3\n    ATTR scale_factor = 0.01\n    ATTR add_offset = 0.5\n    ATTR _FillValue = -999\n    DATA [10.0, 20.5, 30.0, 40.5, 50.0, 60.5]\n  END\n\n  VDATA Telemetry CLASS="OrbitMeta" REF=20\n    FIELD timestamp : FLOAT64\n    FIELD mode : INT16\n    DATA [1000.25, 1]\n    DATA [1001.50, 2]\n  END\n\n  RASTER8 Quicklook WIDTH=2 HEIGHT=2 REF=30\n    DATA [0, 85, 170, 255]\n  END\n\n  VGROUP SwathRoot CLASS="SWATH" REF=40\n    MEMBER SDS Radiance\n    MEMBER VDATA Telemetry\n    MEMBER RASTER8 Quicklook\n  END\nEND',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "hec1",
    name: "HEC-1",
    tier: "beta",
    ext: "hec1",
    extensions: [".hec1"],
    family: "plaintext",
    defaultCode:
      "ID   WATERSHED MODEL 1 - URBAN BASIN\nIT   15   01JAN2025   0000   48\nIO   5\nKK   SUB1\nKM   RUNOFF FROM SUBBASIN 1\nBA   2.45\nPB   4.20\nLS   0   78\nUD   0.85\nKK   OUTLET\nKM   COMBINE HYDROGRAPHS\nHC   1\nZZ",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "hec2",
    name: "HEC-2",
    tier: "beta",
    ext: "hc2",
    extensions: [".hc2"],
    family: "plaintext",
    defaultCode:
      "T1   HEC-2 WATER SURFACE PROFILE EXAMPLE\nT2   TRAPEZOIDAL CHANNEL REACH\nJ1   0   2   0   0   0   0   0   0   0   1250\nNC   0.04   0.04   0.03   0.1   0.3\nX1   100   4   100   140   0   0   0\nGR   10.0   90   2.0   100   2.0   140   10.0   150\nX1   200   4   100   140   500   500   500\nGR   10.5   90   2.5   100   2.5   140   10.5   150\nEJ",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "iec104",
    name: "IEC104",
    tier: "alpha",
    ext: "iec104",
    extensions: [".iec104"],
    family: "plaintext",
    defaultCode:
      "station North_RTU ca=101 oa=1 port=2404 k=12 w=8 t1=15 t2=10\npoint 1001 M_SP_TB_1 Breaker_52A init=1\npoint 2001 M_ME_TF_1 Bus_kV units=kV scale=1.0 offset=0.0 deadband=0.2 init=138.0",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "ieee-cdf",
    name: "IEEE CDF",
    tier: "beta",
    ext: "cdf",
    extensions: [".cdf"],
    family: "plaintext",
    defaultCode:
      '01/01/73 TEST 100.0 1973 S FREE_FORMAT_CASE\nBUS DATA FOLLOWS\n1 "Slack Bus" 1 1 3 1.05 0.0 0.0 0.0 100.0 0.0 230.0 1.05 0.0 0.0 0.0 0.0 0\n2 "Load Bus" 1 1 0 1.00 0.0 80.0 20.0 0.0 0.0 230.0 0.0 0.0 0.0 0.0 0.0 0\n-999\nBRANCH DATA FOLLOWS\n1 2 1 1 1 0 0.01 0.05 0.02 150 150 150 0 0 0.0 0.0\n-999\nTIE LINES FOLLOWS\n1 1 2 2 1\n-999\nEND OF DATA',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "iges",
    name: "IGES",
    tier: "beta",
    ext: "igs",
    extensions: [".igs"],
    family: "plaintext",
    defaultCode: 'D1`"));\n    assert.ok(dHover.contents.value.includes("Type',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "ihex",
    name: "Intel HEX",
    tier: "beta",
    ext: "hex",
    extensions: [".hex"],
    family: "plaintext",
    defaultCode:
      ":100000000C9434000C943E000C943E000C943E007C\n:100010000C943E000C943E000C943E000C943E0068\n:1000200011241FBECFEFD8E0DEBFCDBF11E0A0E09A\n:040030000C9400003A\n:00000001FF",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "irig106",
    name: "IRIG 106",
    tier: "beta",
    ext: "tmats",
    extensions: [".tmats"],
    family: "plaintext",
    defaultCode:
      "COMMENT:Flight Test Telemetry Configuration;\nG\\\\PN:X_15_FLIGHT_042;\nG\\\\TA:X15_SHIP_3;\nG\\\\106:04;\nG\\\\DSI-1:PCM_SOURCE_1;\nG\\\\DST-1:RF;\nT-1\\\\ID:TX_SBAND;\nT-1\\\\RF1:2250.5;\nT-1\\\\RF2:1000;\nT-1\\\\RF4:PCM/FM;\nM-1\\\\ID:MUX_1;\nM-1\\\\BB1:PCM;\nM-1\\\\BB2:FM;\nM-1\\\\BB\\\\DLN:PCM_LINK_1;\nP-1\\\\DLN:PCM_LINK_1;\nP-1\\\\D1:128000;\nP-1\\\\D2:NRZ-L;\nP-1\\\\F1:16;\nP-1\\\\F2:M;\nP-1\\\\F3:NO;\nP-1\\\\MF\\\\N:4;\nP-1\\\\MF1:6;\nP-1\\\\MF2:128;\nP-1\\\\MF3:FPT;\nP-1\\\\MF4:FE6B2840;\nD-1\\\\DLN:PCM_LINK_1;\nD-1\\\\MLN-1:PRIMARY_LIST;\nD-1\\\\MN-1-1:PITCH_RATE;\nD-1\\\\WP-1-1:1;\nD-1\\\\WI-1-1:2;\nD-1\\\\MN-1-2:CHAMBER_P;\nD-1\\\\WP-1-2:2;\nD-1\\\\FP-1-2:1;\nD-1\\\\FI-1-2:2;\nC-1\\\\DCN:PITCH_RATE;\nC-1\\\\MN1:Pitch Angular Rate;\nC-1\\\\MN3:DEG/S;\nC-1\\\\BFM:UNS;\nC-1\\\\DCT:COE;\nC-1\\\\CO-0:-100.0;\nC-1\\\\CO-1:0.0030517578125;\nC-2\\\\DCN:CHAMBER_P;\nC-2\\\\MN3:PSI;\nC-2\\\\DCT:PRS;\nC-2\\\\PS1-1:0;\nC-2\\\\PS2-1:0;\nC-2\\\\PS1-2:4095;\nC-2\\\\PS2-2:1000;",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "iucr-cif",
    name: "IUCr CIF",
    tier: "beta",
    ext: "cif",
    extensions: [".cif"],
    family: "plaintext",
    defaultCode:
      "# Header comment\ndata_test_block\n_publ_author_name 'O'Brien, J.'\n_publ_section_title \"Crystal Structure of SiO2\"\n_audit_creation_method\n;\nGenerated by ModelScript\nMulti-line semicolon text field\n;\n_cell_length_a 5.4310(2)\n_cell_length_b 5.4310(2)\n_cell_length_c 5.4310(2)\n_cell_angle_alpha 90\n_cell_angle_beta ?\n_cell_angle_gamma .\n\nloop_\n_atom_site_label\n_atom_site_type_symbol\n_atom_site_fract_x\n_atom_site_fract_y\n_atom_site_fract_z\nSi1 Si 0.0 0.0 0.0",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "jcamp-dx",
    name: "JCAMP-DX",
    tier: "beta",
    ext: "jdx",
    extensions: [".jdx"],
    family: "plaintext",
    defaultCode:
      "##TITLE=Acetone FTIR Spectrum\n##JCAMP-DX=4.24\n##DATA TYPE=INFRARED SPECTRUM\n##ORIGIN=ModelScript Cleanroom Lab\n##OWNER=PUBLIC DOMAIN\n##XUNITS=1/CM\n##YUNITS=ABSORBANCE\n##FIRSTX=1750\n##LASTX=1700\n##NPOINTS=6\n##XFACTOR=1\n##YFACTOR=0.01\n$ Carbonyl C=O stretch region\n##XYDATA=(X++(Y..Y))\n1750 10 25 85 110 40 12\n##END=",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "jedec",
    name: "JEDEC JESD3",
    tier: "beta",
    ext: "jed",
    extensions: [".jed"],
    family: "plaintext",
    defaultCode: "JEDEC PAL22V10 FUSE MAP*\nQF0020*\nF0*\nL0000 1010101010*\nL0010 0101010101*\nC05A5*",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "kicad",
    name: "KICAD",
    tier: "beta",
    ext: "kicad_pcb",
    extensions: [".kicad_pcb"],
    family: "plaintext",
    defaultCode:
      '(kicad_sch\n  (version 20231120)\n  (lib_symbols\n    (symbol "Device:R"\n      (symbol "R_1_1"\n        (pin passive line (at 0 3.81 270) (length 1.27) (name "~") (number "1"))\n        (pin passive line (at 0 -3.81 90) (length 1.27) (name "~") (number "2"))\n      )\n    )\n  )\n  (symbol (lib_id "Device:R") (at 50 50 0)\n    (property "Reference" "R1")\n    (property "Value" "10k")\n    (property "Footprint" "Resistor_SMD:R_0603")\n  )\n  (symbol (lib_id "Device:R") (at 70 50 0)\n    (property "Reference" "R2")\n    (property "Value" "4.7k")\n    (property "Footprint" "Resistor_SMD:R_0603")\n  )\n  (label "VCC" (at 50 46.19 0))\n  (label "GND" (at 50 53.81 0))\n)',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "las",
    name: "LAS",
    tier: "pre-alpha",
    ext: "las",
    extensions: [".las"],
    family: "plaintext",
    defaultCode:
      "~VERSION INFORMATION\n VERS.                          2.0 : CWLS LOG ASCII STANDARD - VERSION 2.0\n WRAP.                          NO  : ONE LINE PER DEPTH STEP\n~WELL INFORMATION\n STRT.M                       1000.0 : START DEPTH\n STOP.M                       1001.5 : STOP DEPTH\n STEP.M                          0.5 : STEP\n NULL.                       -999.25 : NULL VALUE\n WELL.                      TEST-01  : WELL NAME\n~CURVE INFORMATION\n DEPT.M                              : DEPTH\n GR  .GAPI                           : GAMMA RAY\n RHOB.G/C3                           : BULK DENSITY\n NPHI.V/V                            : NEUTRON POROSITY\n~PARAMETER INFORMATION\n BHT .DEGC                      78.5 : BOTTOM HOLE TEMP\n~OTHER\n Sample synthetic carbonate interval\n~ASCII\n 1000.0  45.0  2.40  0.18\n 1000.5  55.0 -999.25 0.21\n 1001.0  65.0  2.55  0.14\n 1001.5  75.0  2.60  0.12",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "lsdyna",
    name: "LS-DYNA",
    tier: "beta",
    ext: "k",
    extensions: [".k"],
    family: "plaintext",
    defaultCode:
      "*KEYWORD\n$ Comment line before title\n*TITLE\n1D Steel Bar Explicit Dynamics\n*NODE\n$# nid, x, y, z, tc, rc\n1, 0.0, 0.0, 0.0, 7, 7\n2, 0.5, 0.0, 0.0, 0, 0\n3, 1.0, 0.0, 0.0, 0, 0\n*ELEMENT_BEAM\n1, 1, 1, 2, 0\n2, 1, 2, 3, 0\n*PART\nSteel Bar\n1, 1, 1, 0, 0, 0, 0, 0\n*SECTION_BEAM\n1, 3, 1.0\n0.001, 0.0, 0.0, 0.0\n*MAT_ELASTIC\n1, 7850.0, 2.1e11, 0.3\n*SET_NODE_LIST\n10\n1\n*BOUNDARY_SPC_SET\n10, 0, 1, 1, 1, 1, 1, 1\n*BOUNDARY_SPC_NODE\n2, 0, 0, 1, 1, 0, 0, 0\n*INITIAL_VELOCITY\n0, 0, 0\n5.0, 0.0, 0.0, 0.0, 0.0, 0.0\n*DEFINE_CURVE\n1, 0, 1.0, 1.0, 0.0, 0.0\n0.0, 1.0\n0.01, 0.0\n*LOAD_NODE_POINT\n3, 1, 1, 1000.0\n*CONTROL_TERMINATION\n0.005, 0, 0.0, 0.0, 0.0\n*CONTROL_TIMESTEP\n0.0, 0.9, 0, 0.0, 0.0\n*DATABASE_GLSTAT\n1.0e-5, 0, 0, 1\n*END",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "lustre",
    name: "Lustre",
    tier: "beta",
    ext: "lus",
    extensions: [".lus"],
    family: "plaintext",
    defaultCode:
      "-- Global constants and type aliases\nconst\n  DT: real = 0.01;\n  LIMIT: int = 10;\n\ntype\n  Signal = real;\n\n/* Stateless helper function */\nfunction Clamp(x, lo, hi: real) returns (y: real);\nlet\n  y = if x < lo then lo else if x > hi then hi else x;\ntel\n\n(* Stateful synchronous node *)\nnode Counter(reset: bool) returns (n: int);\nvar\n  next_n: int;\nlet\n  next_n = 0 -> pre(n) + 1;\n  n = if reset then 0 else next_n;\n  assert n >= 0;\ntel",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "magicdraw",
    name: "MAGICDRAW",
    tier: "beta",
    ext: "mdzip",
    extensions: [".mdzip"],
    family: "plaintext",
    defaultCode:
      '<?xml version="1.0" encoding="UTF-8"?>\n      <xmi:XMI xmi:version="2.5"\n        xmlns:xmi="http://www.omg.org/spec/XMI/20131001"\n        xmlns:uml="http://www.omg.org/spec/UML/20131001"\n        xmlns:uaf="http://www.omg.org/spec/UAF/1.2">\n        <uml:Model xmi:id="m_uaf" name="EnterpriseArch">\n          <packagedElement xmi:type="uml:Class" xmi:id="res_1" name="GroundStation"/>\n        </uml:Model>\n        <uaf:ResourcePerformer xmi:id="st_uaf_1" base_Class="res_1" criticality="DAL-A"/>\n      </xmi:XMI>',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "mcnp",
    name: "MCNP",
    tier: "beta",
    ext: "mcnp",
    extensions: [".mcnp"],
    family: "plaintext",
    defaultCode:
      "Godiva Bare U-235 Criticality Sphere\nC Block 1: Cell Cards\n1 1 -18.74 -1 IMP:N=1 VOL=2797.5 $ U-235 core\n2 0         1 IMP:N=0            $ Graveyard\n\nC Block 2: Surface Cards\n1 SO 8.741 $ Outer sphere radius (cm)\n\nC Block 3: Data Cards\nMODE N\nM1 92235.80c 0.9473 &\n     92238.80c 0.0527\nMT1 lwtr.01t\nKCODE 2000 1.0 10 50\nKSRC 0.0 0.0 0.0\nF4:N 1\nE4 0.1 1.0 14.0\nPHYS:N 20.0 0.0",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "melcor",
    name: "MELCOR",
    tier: "beta",
    ext: "mel",
    extensions: [".mel"],
    family: "plaintext",
    defaultCode:
      "! Sandia MELCOR 2.x PWR Severe Accident Deck\nMELGEN_INPUT\nTITLE 'PWR Station Blackout Benchmark'\n\nEXEC_INPUT\n  EXEC_TSTART 0.0\n  EXEC_TEND 100.0\n  EXEC_DT 0.05 1.0 1.0e-5\n\nCVH_INPUT\n  CV_ID 'RCS_Vessel' 100 NORMAL\n  CV_THR 1.55e7 580.0 0.4 0.6\n  CV_PAS 85.0 0.0 12.0\n  CV_NCG 'N2' 0.02\n\n  CV_ID 'Containment' 200 NORMAL\n  CV_THR 1.01325e5 310.0 0.0 0.1\n  CV_PAS 50000.0 0.0 40.0\n\nFL_INPUT\n  FL_ID 'LOCA_Break' 10\n  FL_FT 100 200 4.0 4.0\n  FL_GEO 0.08 1.5 1.0\n  FL_USL 1.8 2.2\n  FL_IC 0.0\n\nHS_INPUT\n  HS_ID 'Vessel_Wall' 1001 CYLINDRICAL\n  HS_GD 0.2 120.0 190320.0 21.5 530.0 7930.0\n  HS_LB 100 1500.0\n  HS_RB 200 50.0\n  HS_TEMP 570.0\n  HS_SRC 0.0\n\nCOR_INPUT\n  COR_RP 5 10 3.0e9\n  COR_ZDF 95000.0 340.0 600.0 4800.0 22000.0 100\n  COR_PWR 3.2e7 3.0e9\n  COR_OX ON URBANIC_HEIDRICK 4800.0 22000.0\n\nRN1_INPUT\n  RN1_CLS 1 'XE' 150.0 0.05\n  RN1_CLS 2 'CS' 120.0 0.02\n\nCF_INPUT\n  CF_ID 'Vessel_DP' 1 SUBTRACT\n  CF_SAI 1.0 0.0 0.0\n  CF_ARG CVH 100 P 1.0\n  CF_ARG CVH 200 P -1.0\n\nTF_INPUT\n  TF_ID 'Decay_Curve' 10 1.0 0.0\n  TF_TAB 0.0 1.0 100.0 0.5 1000.0 0.2\n\nMP_INPUT\n  MP_ID 'Fuel_Cp' 1 UO2 CP 310.0\n\nNCG_INPUT\n  NCG_ID 'H2' 1 2.01588 14307.0\n\nEND",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "molfile",
    name: "MDL Molfile",
    tier: "beta",
    ext: "mol",
    extensions: [".mol"],
    family: "plaintext",
    defaultCode:
      "Benzene\n  ModelScript\n\n  6  6  0  0  0  0  0  0  0  0999 V2000\n    1.2124    0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    1.2124   -0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    0.0000   -1.4000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n   -1.2124   -0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n   -1.2124    0.7000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n    0.0000    1.4000    0.0000 C   0  0  0  0  0  0  0  0  0  0  0  0\n  1  2  2  0  0  0  0\n  2  3  1  0  0  0  0\n  3  4  2  0  0  0  0\n  4  5  1  0  0  0  0\n  5  6  2  0  0  0  0\n  6  1  1  0  0  0  0\nM  END",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "mps",
    name: "IBM MPS",
    tier: "beta",
    ext: "mps",
    extensions: [".mps"],
    family: "plaintext",
    defaultCode:
      "* Free-format MPS with all bound types\nNAME          ALLBOUNDS\nOBJSENSE\n  MAX\nROWS\n N  OBJ\n L  R1\n G  R2\n E  R3\nCOLUMNS\n    X_FREE    OBJ       2.5          R1        1.0\n    X_FIXED   OBJ       1.0          R1        1.0\n    X_MI      OBJ       -0.5         R2        1.0\n    X_PL      OBJ       3.0          R3        1.0\n    MARK0001  'MARKER'               'INTORG'\n    Y_BIN     OBJ       5.0          R1        2.0\n    Y_INT     OBJ       4.0          R2        1.5\n    MARK0002  'MARKER'               'INTEND'\nRHS\n    RHS1      R1        20.0         R2        5.0\n    RHS1      R3        10.0\nRANGES\n    RNG1      R1        6.0          R3        2.0\nBOUNDS\n FR BND1      X_FREE\n FX BND1      X_FIXED   3.5\n MI BND1      X_MI\n PL BND1      X_PL\n BV BND1      Y_BIN\n LI BND1      Y_INT     1\n UI BND1      Y_INT     8\nENDATA",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "nasa-cdf",
    name: "NASA CDF",
    tier: "beta",
    ext: "skt",
    extensions: [".skt"],
    family: "plaintext",
    defaultCode:
      '! THEMIS-A Fluxgate Magnetometer L2 Skeleton Table\n#header\n  CDF NAME: tha_l2_fgm_20250315.cdf\n  DATA ENCODING: NETWORK\n  MAJORITY: ROW_MAJOR\n  FORMAT: SINGLE\n  VERSION: 3.8.0\n\n#GLOBALattributes\n  "Project" 0: CDF_CHAR { "THEMIS" }\n  "Source_name" 0: CDF_CHAR { "THA>Themis Probe A" }\n  "Discipline" 0: CDF_CHAR { "Space Physics>Magnetospheric Science" }\n  "Data_type" 0: CDF_CHAR { "L2>Level 2 Science Data" }\n  "Descriptor" 0: CDF_CHAR { "FGM>Fluxgate Magnetometer" }\n\n#VARIABLEattributes\n  "DEPEND_0"\n  "UNITS"\n  "VALIDMIN"\n  "VALIDMAX"\n  "FILLVAL"\n  "VAR_TYPE"\n\n#variables\n  "EPOCH" CDF_EPOCH 1 0:[] T\n    "VAR_TYPE" CDF_CHAR { "support_data" }\n    "UNITS" CDF_CHAR { "ms" }\n    [0] = "2025-03-15T12:00:00.000Z"\n    [1] = "2025-03-15T12:00:01.000Z"\n    [2] = "2025-03-15T12:00:02.000Z"\n  .\n  "B_GSE" CDF_REAL4 1 1:[3] T T\n    "DEPEND_0" CDF_CHAR { "EPOCH" }\n    "UNITS" CDF_CHAR { "nT" }\n    "VALIDMIN" CDF_REAL4 { -65536.0, -65536.0, -65536.0 }\n    "VALIDMAX" CDF_REAL4 { 65536.0, 65536.0, 65536.0 }\n    "FILLVAL" CDF_REAL4 { -1.0e31 }\n    "VAR_TYPE" CDF_CHAR { "data" }\n    [0] = { 3.0, 4.0, 0.0 }\n    [1] = { 6.0, 8.0, 0.0 }\n    [2] = { 0.0, 0.0, 5.0 }\n  .\n#end',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "nec2",
    name: "NEC-2",
    tier: "beta",
    ext: "nec",
    extensions: [".nec"],
    family: "plaintext",
    defaultCode:
      "CM Half-Wave Dipole at 300 MHz\nCE\nGW 1 21 0 0 -0.25 0 0 0.25 0.001\nGE 0\nFR 0 1 0 0 300.0 0\nEX 0 1 11 0 1.0 0.0\nRP 0 37 1 1000 0 0 5 0\nEN",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "netcdf",
    name: "NetCDF",
    tier: "beta",
    ext: "cdl",
    extensions: [".cdl"],
    family: "plaintext",
    defaultCode:
      '// Unidata NetCDF Classic CF-1.8 Atmospheric Grid Example\nnetcdf atmos_grid {\ndimensions:\n  time = UNLIMITED ; // (2 currently)\n  lat = 2 ;\n  lon = 3 ;\nvariables:\n  double time(time) ;\n    time:units = "hours since 2026-01-01 00:00:00" ;\n    time:long_name = "forecast time" ;\n  float lat(lat) ;\n    lat:units = "degrees_north" ;\n    lat:long_name = "latitude" ;\n  float lon(lon) ;\n    lon:units = "degrees_east" ;\n    lon:long_name = "longitude" ;\n  float temperature(time, lat, lon) ;\n    temperature:units = "K" ;\n    temperature:long_name = "Air Temperature" ;\n    temperature:standard_name = "air_temperature" ;\n    temperature:_FillValue = -9999.f ;\n  short flag(lat) ;\n    flag:units = "1" ;\n    flag:long_name = "quality flag" ;\n  byte mask(lon) ;\n    mask:units = "1" ;\n    mask:long_name = "land sea mask" ;\n  int station_id ;\n    station_id:units = "1" ;\n    station_id:long_name = "WMO station identifier" ;\n  char station_name(lon) ;\n\n// global attributes:\n  :Conventions = "CF-1.8" ;\n  :title = "Atmospheric Forecast Slice" ;\n  :version = 1, 2 ;\ndata:\n  time = 0, 6 ;\n  lat = -10.0, 10.0 ;\n  lon = 0.0, 15.0, 30.0 ;\n  temperature =\n    280.5, 281.0, 282.5,\n    285.0, _, 287.0,\n    281.5, 282.0, 283.5,\n    286.0, 287.0, 288.0 ;\n  flag = 1s, 2s ;\n  mask = 0b, 1b, 1b ;\n  station_id = 72469 ;\n  station_name = "DEN" ;\n}',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "nmea0183",
    name: "NMEA 0183",
    tier: "beta",
    ext: "nmea",
    extensions: [".nmea"],
    family: "plaintext",
    defaultCode: ");\n      assert.ok(schema.parameters.length >= 2,",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "obj",
    name: "Wavefront OBJ",
    tier: "beta",
    ext: "obj",
    extensions: [".obj"],
    family: "plaintext",
    defaultCode:
      ");\n    assert.equal(metrics.eulerCharacteristic, 2);\n    assert.equal(metrics.isWatertight, true);\n    assert.equal(metrics.boundaryEdgeCount, 0);\n    assert.equal(metrics.nonManifoldEdgeCount, 0);\n\n    const bbox = computeBoundingBox(doc);\n    assert.deepEqual(bbox.min, [0, 0, 0]);\n    assert.deepEqual(bbox.max, [1, 1, 1]);\n    assert.deepEqual(bbox.center, [0.5, 0.5, 0.5]);\n    assert.ok(Math.abs(bbox.diagonal - Math.sqrt(3)) < 1e-12);\n\n    // Smooth vertex normals on cube corners should be unit length and point along (±1, ±1, ±1)/√3\n    const normals = computeSmoothVertexNormals(doc, tris);\n    assert.equal(normals.length, 8);\n    for (const [nx, ny, nz] of normals) {\n      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);\n      assert.ok(Math.abs(len - 1.0) < 1e-12,",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "plot3d",
    name: "PLOT3D",
    tier: "beta",
    ext: "xyz",
    extensions: [".xyz"],
    family: "plaintext",
    defaultCode: "# Comment line\n      1.5D-2  -2.0d+1  3*0.25\n      ! Another comment\n      4.0E0, 5",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "plscadd",
    name: "PLSCADD",
    tier: "alpha",
    ext: "pol",
    extensions: [".pol"],
    family: "plaintext",
    defaultCode:
      "LINE Line_230kV voltage_kv=230 freq=60\nCONDUCTOR Drake_795 weight_n_per_m=16.0 r_ohm_per_km=0.072 gmr_m=0.0114 rated_tension_n=140000\nSTRUCTURE T101 station_m=0 x=0 y=0 z_base=100 height_m=30 phase_spacing_m=6.0\nSTRUCTURE T102 station_m=300 x=300 y=0 z_base=100 height_m=30 phase_spacing_m=6.0\nSPAN S1 from=T101 to=T102 conductor=Drake_795 tension_n=30000 min_clearance_m=8.0\nTERRAIN 150 0 102.5",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "powerworld",
    name: "POWERWORLD",
    tier: "alpha",
    ext: "aux",
    extensions: [".aux"],
    family: "plaintext",
    defaultCode:
      '// 3-Bus IEEE Test Case in PowerWorld AUX format\nDATA (Bus, [BusNum, BusName, BusNomVolt, BusPUVolt, BusAngle, BusSlack])\n{\n  1 "Slack_138" 138.0 1.02 0.0 YES\n  2 "Gen_138"   138.0 1.01 2.5 NO\n  3 "Load_138"  138.0 0.98 -3.1 NO\n}\n\nDATA (Gen, [BusNum, GenID, GenStatus, GenMW, GenMVR, GenMWMax, GenMWMin, GenVoltSet])\n{\n  1 "1" Closed 150.0 25.0 300.0 10.0 1.02\n  2 "1" Closed 100.0 15.0 200.0  0.0 1.01\n}\n\nDATA (Load, [BusNum, LoadID, LoadStatus, LoadMW, LoadMVR])\n{\n  3 "1" Closed 245.0 40.0\n}\n\nDATA (Branch, [BusNumFrom, BusNumTo, LineCircuit, LineStatus, LineR, LineX, LineC, LineAMVA, LineXfmr])\n{\n  1 2 "1" Closed 0.01 0.05 0.02 250.0 NO\n  2 3 "1" Closed 0.02 0.08 0.03 250.0 NO\n  1 3 "1" Closed 0.015 0.06 0.01 200.0 YES\n}\n\nDATA (Contingency, [CTGName, CTGSkip])\n{\n  "L_1_3_OUT" NO\n}\n\nSCRIPT\n{\n  EnterMode(RUN);\n  SolvePowerFlow(RECTNEWT);\n}',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "pypsa",
    name: "PYPSA",
    tier: "alpha",
    ext: "pypsa",
    extensions: [".pypsa"],
    family: "plaintext",
    defaultCode:
      "network EU_Grid baseMva=100\nbus North v_nom=380 carrier=AC\nbus South v_nom=380 carrier=AC\ngenerator Wind_North bus=North carrier=wind p_nom=500 marginal_cost=0 capital_cost=1200\ngenerator Gas_South bus=South carrier=gas p_nom=400 marginal_cost=45 capital_cost=600\nload Load_South bus=South p_set=600\nline L_NS bus0=North bus1=South r=2.5 x=25.0 s_nom=800\nlink HVDC_NS bus0=North bus1=South p_nom=200 efficiency=0.97\nstorage_unit BESS_South bus=South p_nom=100 max_hours=4 efficiency_store=0.92 efficiency_dispatch=0.92 standing_loss=0.001",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "rinex",
    name: "RINEX v2",
    tier: "beta",
    ext: "obs",
    extensions: [".obs"],
    family: "plaintext",
    defaultCode:
      "     3.04           OBSERVATION DATA    M (MIXED)           RINEX VERSION / TYPE\nModelScript GNSS    20250101 000000 UTC                     PGM / RUN BY / DATE\nSTATION_01                                                  MARKER NAME\n  4000000.0000  1000000.0000  4800000.0000                  APPROX POSITION XYZ\nG    4 C1C L1C D1C S1C                                      SYS / # / OBS TYPES\n  2025     1     1     0     0    0.0000000     GPS         TIME OF FIRST OBS\n                                                            END OF HEADER\n> 2025 01 01 00 00  0.0000000  0  2\nG01  21456789.123   112754321.456       -1234.567          45.000\nG05  22123456.789   116258901.234        2345.678          42.500",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "rtds",
    name: "RTDS",
    tier: "alpha",
    ext: "dft",
    extensions: [".dft"],
    family: "plaintext",
    defaultCode:
      "CASE HVDC_HIL_Test\nTIME_STEP 50e-6\nFINISH_TIME 0.2\nFREQUENCY 60\nSUBSYSTEM 1\nCOMPONENT SOURCE SRC1 nodes=BUS1,0 V=138000\nCOMPONENT R R_LINE nodes=BUS1,BUS2 R=0.5\nCOMPONENT L L_LINE nodes=BUS2,BUS3 L=0.01\nCOMPONENT C C_SHUNT nodes=BUS3,0 C=1e-5",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "scale",
    name: "SCALE",
    tier: "beta",
    ext: "scale",
    extensions: [".scale"],
    family: "plaintext",
    defaultCode:
      "' PWR UO2 Pin Cell Benchmark\n=csas6\nPWR 3.5 wt% UO2 Pin Cell\nv7.1-252\nread comp\n  uo2 1 den=10.41 1.0 900.0 92235 3.5 92238 96.5 end\n  zirc4 3 den=6.56 1.0 600.0 end\n  h2o 2 den=0.72 1.0 580.0 end\nend comp\nread celldata\n  latticecell squarepitch pitch=1.26 2 fuelr=0.4096 1 cladr=0.475 3 end\nend celldata\nread param\n  npg=2000 gen=250 nsk=50\nend param\nread geom\n  global unit 1\n  cylinder 1 0.4096 182.88 -182.88\n  cylinder 2 0.4750 182.88 -182.88\n  cuboid 3 0.63 -0.63 0.63 -0.63 182.88 -182.88\n  media 1 1 1\n  media 3 1 2 -1\n  media 2 1 3 -2\n  boundary 3\nend geom\nread bounds\n  all=mirror\nend bounds\nend",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "sdl",
    name: "SDL-88",
    tier: "beta",
    ext: "sdl",
    extensions: [".sdl"],
    family: "plaintext",
    defaultCode:
      "/* Header comment */\n      SYSTEM OneShot;\n        SIGNAL Halt;\n        BLOCK B;\n          PROCESS P;\n            START;\n              NEXTSTATE Running;\n            STATE Running;\n              INPUT Halt;\n                /* Stop process */\n                STOP;\n            ENDSTATE Running;\n          ENDPROCESS P;\n        ENDBLOCK B;\n      ENDSYSTEM OneShot;",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "segy",
    name: "SEG-Y",
    tier: "beta",
    ext: "sgy",
    extensions: [".sgy"],
    family: "plaintext",
    defaultCode:
      "C 1 CLIENT: MODELSCRIPT GEOPHYSICS   COMPANY: ANSATZ SEISMIC\nC 2 LINE: LINE-2025-01               AREA: OFFSHORE BASIN\nC 3 SURVEY: 2D MARINE REFLECTION     SAMPLE INTERVAL: 2000 US\nC 4 SAMPLES PER TRACE: 1500          DATA FORMAT: IEEE 32-BIT FLOAT\nC 5 TRACE SORT: CDP ENSEMBLE         POLARITY: SEG NORMAL\nC40 END TEXTUAL HEADER",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "simscript",
    name: "SIMSCRIPT",
    tier: "beta",
    ext: "sim",
    extensions: [".sim"],
    family: "plaintext",
    defaultCode:
      "'' MODEL: PortHarborBerths\nPREAMBLE\n  TEMPORARY ENTITIES\n    EVERY SHIP HAS A TONNAGE AND BELONGS TO THE HARBOR.QUEUE\n  PERMANENT ENTITIES\n    EVERY PORT OWNS A HARBOR.QUEUE\n  PROCESSES\n    INCLUDE GENERATOR\n    INCLUDE SHIP\n  RESOURCES\n    EVERY BERTH\n  EVENT NOTICES\n    INCLUDE TIDE.SHIFT\n  DEFINE HARBOR.QUEUE AS A FIFO SET\n  DEFINE TOTAL.SHIPS AS AN INTEGER VARIABLE\n  TALLY MEAN.WAIT AS THE MEAN OF WAIT.TIME\n  ACCUMULATE AVG.BUSY.BERTHS AS THE MEAN OF N.X.BERTH\n  ACCUMULATE AVG.QUEUE.LEN AS THE MEAN OF N.Q.BERTH\nEND\n\nMAIN\n  CREATE EVERY BERTH(1)\n  LET U.BERTH = 3\n  ACTIVATE A GENERATOR NOW\n  SCHEDULE A TIDE.SHIFT IN 12.0 HOURS\n  START SIMULATION\nEND\n\nPROCESS GENERATOR\n  ACTIVATE A SHIP NOW\n  ACTIVATE A GENERATOR IN EXPONENTIAL.F(2.0, 1) HOURS\nEND\n\nPROCESS SHIP\n  FILE THIS SHIP IN HARBOR.QUEUE\n  REQUEST 1 BERTH\n  REMOVE FIRST SHIP FROM HARBOR.QUEUE\n  WORK EXPONENTIAL.F(4.0, 2) HOURS\n  RELINQUISH 1 BERTH\n  DESTROY THIS SHIP\nEND\n\nEVENT TIDE.SHIFT\n  PRINT TIDE SHIFTED\nEND",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "sinda",
    name: "SINDA",
    tier: "beta",
    ext: "sin",
    extensions: [".sin"],
    family: "plaintext",
    defaultCode:
      'C  Spacecraft Thermal Panel Model\n$  Generated for SINDA parser verification\nHEADER OPTIONS DATA\n  TITLE = "Spacecraft Radiator Panel"\n  ABSZRO = 0.0\n  SIGMA = 5.670374419D-8\nHEADER NODE DATA, PANEL\n  1, 300.0, 500.0   $ diffusion node\n  2, 295.0, 0.0     $ arithmetic node\n  0, 290.0, 0.0     $ explicit zero arithmetic node\n  -100, 4.0, 0.0    $ deep space boundary node\nHEADER CONDUCTOR DATA, PANEL\n  10, 1, 2, 2.5     $ linear conduction W/K\n  -20, 2, 100, 0.85 $ radiation conductor (eps*A*F)\nHEADER SOURCE DATA, PANEL\n  1, 120.0          $ internal avionics dissipation (W)\nHEADER CONSTANTS DATA\n  TIMEO = 0.0, TIMEND = 1000.0, DTIMEI = 1.0\n  DRLXCA = 1.0E-6, NLOOP = 100\nHEADER ARRAY DATA\n  101, 0.0, 100.0, 200.0\n       300.0, 400.0\nHEADER EXECUTION\n  CALL STDSTL\n  CALL CRANKN\nHEADER VARIABLES 1\n  Q1 = 120.0\nHEADER VARIABLES 2\n  TAVG = 300.0\nHEADER OUTPUT CALLS\n  CALL TPRINT\nEND OF DATA',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "slam",
    name: "SLAM II",
    tier: "beta",
    ext: "slam",
    extensions: [".slam"],
    family: "plaintext",
    defaultCode:
      "; Pritsker Tanker-Refinery Combined Discrete-Continuous Model\nGEN, PRITSKER, TANKER_REFINERY, 1/1/1979, 1;\nLIMITS, 4, 3, 100;\nCONTINUOUS, 2, 1, 0.01, 0.1, 0.1;\nINTLC, SS(1)=0.0, SS(2)=150.0, XX(1)=1.0, XX(2)=1.0;\nINITIALIZE, 0.0, 20.0;\n\n; Continuous tank & refinery equations\nDD(1) = 300.0 * XX(1) - 150.0 * XX(2);\nDD(2) = 150.0 * XX(2) - 100.0;\nSS(3) = SS(1) + SS(2);\n\nNETWORK;\n  RESOURCE/BERTH(1), 1;\n  GATE/PORT, OPEN, 2;\n  CREATE, EXPON(5.0), 0.0, 1, 10, 1; arrive every ~5 days\n  ARR   AWAIT(1), BERTH/1, , 1;\n        ASSIGN, XX(1)=1.0, 1;\n        ACTIVITY/1, 2.0, 1.0, DONE;\n  DONE  FREE, BERTH/1, 1;\n        CLOSE, PORT, 1;\n        OPEN, PORT, 1;\n        COLCT, INT(1), TIME IN SYSTEM, 1;\n        TERMINATE, 10;\n  DET1  DETECT, SS(1), XP, 150.0, 0.01, 1;\n        ASSIGN, XX(1)=0.0, 1;\n        TERMINATE;\nENDNETWORK;\nFIN;",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "sparql",
    name: "SPARQL",
    tier: "beta",
    ext: "rq",
    extensions: [".rq"],
    family: "plaintext",
    defaultCode:
      '},\n    object: { termType: "Literal", value: "A" },\n  },\n  {\n    subject: { termType: "NamedNode", value:',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "srec",
    name: "Motorola SREC",
    tier: "beta",
    ext: "srec",
    extensions: [".srec"],
    family: "plaintext",
    defaultCode:
      "S00B00006D73782E737265637A\nS1130000204E7565766F204D5358204669726D7733\nS113001061726520496D6167652076312E30000081\nS9030000FC",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "stl",
    name: "STL",
    tier: "beta",
    ext: "stl",
    extensions: [".stl"],
    family: "plaintext",
    defaultCode:
      "solid tetrahedron\n  facet normal 0.0 0.0 -1.0\n    outer loop\n      vertex 0.0 0.0 0.0\n      vertex 1.0 0.0 0.0\n      vertex 0.0 1.0 0.0\n    endloop\n  endfacet\n  facet normal 0.577 0.577 0.577\n    outer loop\n      vertex 1.0 0.0 0.0\n      vertex 0.0 1.0 0.0\n      vertex 0.0 0.0 1.0\n    endloop\n  endfacet\nendsolid tetrahedron",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "trasys",
    name: "TRASYS",
    tier: "beta",
    ext: "tra",
    extensions: [".tra"],
    family: "plaintext",
    defaultCode:
      "C Classic NASA TRASYS Thermal Radiation Deck\nHEADER OPTIONS DATA\n  TITLE = Spacecraft Radiator Panel Test\n  MODEL = LEO_TEST_SAT\n  UNITS = SI\n  RAYS = 5000 $ Monte Carlo ray count\n\nHEADER SURFACE DATA\nC Primary radiator rectangle with White Paint Z-93\n  S RAD1 RECTANGLE W=2.0 H=1.5 NODE=101 PROP=WHITE_PAINT_Z93 ACTIVE=TOP SHADE=YES\n    TX=0.0 TY=0.0 TZ=0.5 ROTX=0 ROTY=0 ROTZ=90\nC Circular baffle disk\n  S BAF1 DISK R=0.8 NODE=102 PROP=0.96, 0.90 ACTIVE=BOTH SHADE=YES TZ=1.5\nC Cylindrical bus\n  BUS1 CYLINDER R=0.6 L=1.8 NODE=103 PROP=SILVER_TEFLON ACTIVE=TOP SHADE=YES\nC Conical adapter\n  ADAPT1 CONE R1=0.6 R2=0.3 L=0.5 NODE=104 PROP=0.25, 0.03 ACTIVE=TOP\nC Spherical sensor head\n  SPH1 SPHERE R=0.25 NODE=105 PROP=BLACK_PAINT ACTIVE=TOP TZ=2.2\nC Paraboloid high-gain antenna\n  HGA1 PARABOLOID R=1.2 F=0.6 NODE=106 PROP=0.20, 0.80 ACTIVE=TOP TX=2.0\nC Triangular solar baffle polygon\n  POLY1 POLYGON (0, 0, 0) (1, 0, 0) (0.5, 1, 0) NODE=107 PROP=GOLD_KAPTON ACTIVE=TOP\n\nHEADER ORBIT DATA\n  PLANET = EARTH\n  ALTITUDE = 400.0 $ ISS-like LEO altitude (km)\n  BETA = 23.5\n  SOLAR = 1361.0\n  ALBEDO = 0.30\n  PLANETIR = 237.0\n\nHEADER OPERATIONS DATA\n  FFCAL\n  CALL RKCAL(EPS=0.001)\n  QCAL\n\nEND OF DATA",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "trnsys",
    name: "TRNSYS",
    tier: "beta",
    ext: "dck",
    extensions: [".dck"],
    family: "plaintext",
    defaultCode:
      '* TRNSYS Solar Domestic Hot Water System\nVERSION 18\nCONSTANTS 3\n  START = 0\n  STOP = 24\n  STEP = 0.25\n\nSIMULATION START STOP STEP ! 24-hour transient run\nTOLERANCES 0.001 0.001\nLIMITS 30 30 30\nDFQ 1\nWIDTH 80\nNOLIST\nMAP\n\nEQUATIONS 2\n  AREA_COL = 4.0\n  FLOW_COL = AREA_COL * 50.0\n\nUNIT 1 TYPE 15 Weather\nPARAMETERS 5\n  20.0 5.0 2880.0 6.0 18.0\n\nUNIT 2 TYPE 1 Collector\nPARAMETERS 5\n  AREA_COL 4.19 0.75 15.0 0.0\nINPUTS 4\n  3,1  0,0  1,1  1,2\n  20.0 FLOW_COL 20.0 0.0\n\nUNIT 3 TYPE 4 StorageTank\nPARAMETERS 6\n  0.30 4.19 1000.0 1.5 1.5 3\nINPUTS 5\n  2,1  2,2  0,0  0,0  1,1\n  20.0 0.0 15.0 0.0 20.0\nDERIVATIVES 3\n  20.0 20.0 20.0\n\nUNIT 4 TYPE 25 Printer\nPARAMETERS 4\n  1.0 0.0 24.0 30\nINPUTS 2\n  2,1  3,6\n  0.0 0.0\n\nASSIGN "solar_dhw.out" 30\nEND',
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "usgs-dem",
    name: "USGS DEM",
    tier: "beta",
    ext: "dem",
    extensions: [".dem"],
    family: "plaintext",
    defaultCode:
      "MT RAINIER EAST, WA                     1   1 0  10  10  4 0.300000000000000D+02 0.300000000000000D+02 0.000000000000000D+00\n    1   1   1   1   1   2   0   2   1440.000000   4392.000000",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "verilog",
    name: "Verilog",
    tier: "beta",
    ext: "v",
    extensions: [".v"],
    family: "plaintext",
    defaultCode:
      "// 4-bit ALU module\n      /* Multi-line\n         block comment */\n      module alu4 #(parameter WIDTH = 4) (\n        input [3:0] a,\n        input [3:0] b,\n        input [2:0] op,\n        output reg [3:0] y,\n        output wire zero\n      );\n        localparam ADD = 3'b000;\n        assign zero = (y == 4'h0);\n        always @(*) begin\n          case (op)\n            3'b000: y = a + b;\n            3'b001: y = a - b;\n            default: y = 4'b0000;\n          endcase\n        end\n      endmodule",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
  },
  {
    id: "vhdl",
    name: "VHDL",
    tier: "beta",
    ext: "vhd",
    extensions: [".vhd"],
    family: "plaintext",
    defaultCode:
      "-- VHDL header comment\nlibrary ieee;\nuse ieee.std_logic_1164.all;\n-- edge check: clk'event and clk = '1'\nsignal bus_a : std_logic_vector(7 downto 0) := X\"A5\";",
    supportsDiagram: false,
    supportsSimulation: false,
    supports3d: false,
    defaultView: "inspector",
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

/**
 * Resolves the default view and split mode for a language from its per-language
 * configuration (`defaultView` / `defaultSplit`), falling back based on
 * capabilities (2D diagram -> 3D canvas -> simulation -> inspector) with split enabled.
 */
export function getDefaultLanguageView(langInfo: MorselLanguageInfo): {
  view: MorselDefaultView;
  isSplit: boolean;
} {
  const isViewSupported = (candidate: MorselDefaultView): boolean => {
    if (candidate === "diagram") return langInfo.supportsDiagram;
    if (candidate === "3d") return langInfo.supports3d;
    if (candidate === "simulation") return langInfo.supportsSimulation;
    return true;
  };

  let view: MorselDefaultView;
  if (langInfo.defaultView && isViewSupported(langInfo.defaultView)) {
    view = langInfo.defaultView;
  } else if (langInfo.supportsDiagram) {
    view = "diagram";
  } else if (langInfo.supports3d) {
    view = "3d";
  } else if (langInfo.supportsSimulation) {
    view = "simulation";
  } else {
    view = "inspector";
  }

  const isSplit = view === "code" ? false : (langInfo.defaultSplit ?? true);
  return { view, isSplit };
}

export function detectLanguageFromFilename(filename: string): string {
  const lower = filename.trim().toLowerCase();
  for (const lang of ALL_MORSEL_LANGUAGES) {
    if (lower.endsWith(`.${lang.ext}`)) return lang.id;
  }
  for (const lang of ALL_MORSEL_LANGUAGES) {
    for (const ext of lang.extensions) {
      if (lower.endsWith(ext.toLowerCase())) return lang.id;
    }
  }
  return "modelica";
}
