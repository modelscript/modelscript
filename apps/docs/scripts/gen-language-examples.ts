// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Generates live code & diagram examples for every documented language in `LANGUAGES`.
//
//   npx tsx scripts/gen-language-examples.ts           # write outputs
//   npx tsx scripts/gen-language-examples.ts --check   # fail if outputs are stale
//
// Output:
//   docs/.vitepress/theme/data/language-examples.generated.json

import * as fs from "node:fs";
import { createRequire } from "node:module";
import * as path from "node:path";
import { fileURLToPath } from "node:url";
import * as zlib from "node:zlib";

import type { DiagramData, DiagramEdge, DiagramNode } from "@modelscript/diagram/protocol";
import { renderPolyglotDiagramToSvg } from "@modelscript/diagram/svg";
import { LANGUAGES } from "../docs/.vitepress/theme/data/languages.js";

const require = createRequire(import.meta.url);
const __dirname = path.dirname(fileURLToPath(import.meta.url));
const outputPath = path.resolve(__dirname, "../docs/.vitepress/theme/data/language-examples.generated.json");

export interface LanguageExampleSpec {
  slug: string;
  filename: string;
  title: string;
  description: string;
  viewLabel: string;
  code: string;
}

export interface GeneratedLanguageExample extends LanguageExampleSpec {
  name: string;
  ext: string;
  lineCount: number;
  permalinkToken: string;
  svgDark: string;
  svgLight: string;
}

function encodePermalinkToken(slug: string, filename: string, code: string): string {
  const payload = {
    v: 1,
    lang: slug,
    dialect: slug,
    title: filename,
    code: code.trim(),
  };
  const compressed = zlib.deflateSync(Buffer.from(JSON.stringify(payload), "utf8"));
  return compressed.toString("base64").replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function escapeXml(str: unknown): string {
  if (str === null || str === undefined) return "";
  return String(str)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Converts a dark-themed SVG string into a clean light-themed SVG string
 * for domain renderers that do not accept an explicit `{ theme: "light" }` option.
 */
function adaptSvgToLightTheme(svgDark: string): string {
  const colorMap: Record<string, string> = {
    "#0a0e17": "#f8fafc",
    "#0a0f1c": "#f8fafc",
    "#0b1120": "#f8fafc",
    "#0d1117": "#ffffff",
    "#0f172a": "#f8fafc",
    "#111827": "#f8fafc",
    "#161b22": "#ffffff",
    "#172033": "#f1f5f9",
    "#1e293b": "#ffffff",
    "#21262d": "#f1f5f9",
    "#30363d": "#cbd5e1",
    "#334155": "#cbd5e1",
    "#475569": "#94a3b8",
    "#f8fafc": "#0f172a",
    "#f0f6fc": "#0f172a",
    "#f1f5f9": "#1e293b",
    "#e2e8f0": "#1e293b",
    "#cbd5e1": "#475569",
    "#94a3b8": "#64748b",
  };
  return svgDark.replace(
    /#(0a0e17|0a0f1c|0b1120|0d1117|0f172a|111827|161b22|172033|1e293b|21262d|30363d|334155|475569|f8fafc|f0f6fc|f1f5f9|e2e8f0|cbd5e1|94a3b8)\b/gi,
    (match) => colorMap[match.toLowerCase()] ?? match,
  );
}

/**
 * Namespaces internal `<defs>` IDs so multiple inline SVGs on the same page never collide.
 */
function namespaceSvgIds(svg: string, prefix: string): string {
  const ids = new Set<string>();
  for (const m of svg.matchAll(/\bid="([^"]+)"/g)) {
    const id = m[1]!;
    if (
      id.startsWith("marker") ||
      id.startsWith("grad") ||
      id.startsWith("shadow") ||
      id.startsWith("arrow") ||
      id.startsWith("glow") ||
      id.startsWith("grid") ||
      id.startsWith("clip") ||
      id.startsWith("filter")
    ) {
      ids.add(id);
    }
  }
  let out = svg;
  for (const id of ids) {
    const safeId = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    const nextId = `${prefix}-${id}`;
    out = out
      .replace(new RegExp(`\\bid="${safeId}"`, "g"), `id="${nextId}"`)
      .replace(new RegExp(`url\\(#${safeId}\\)`, "g"), `url(#${nextId})`);
  }
  return out;
}

function makeNode(opts: {
  id: string;
  label: string;
  stereotype?: string;
  x: number;
  y: number;
  width?: number;
  height?: number;
  stroke?: string;
  fill?: string;
  sections?: { header: string; entries: string[] }[];
  ports?: { id: string; x: number; y: number; direction?: "in" | "out" | "inout" }[];
}): DiagramNode {
  const w = opts.width ?? 180;
  const h = opts.height ?? 72;
  return {
    id: opts.id,
    shape: "rect",
    x: opts.x,
    y: opts.y,
    width: w,
    height: h,
    angle: 0,
    opacity: 1,
    zIndex: 2,
    markup: [{ tagName: "rect", selector: "body" }],
    attrs: {
      body: {
        ...(opts.fill ? { fill: opts.fill } : {}),
        stroke: opts.stroke ?? "#38bdf8",
        strokeWidth: 1.8,
        rx: 8,
        ry: 8,
      },
      label: {
        text: opts.label,
      },
      ...(opts.stereotype
        ? {
            header: {
              text: `«${opts.stereotype}»`,
            },
          }
        : {}),
    },
    ports: {
      groups: {},
      items: (opts.ports ?? []).map((p) => ({
        id: p.id,
        group: p.direction ?? "inout",
        direction: p.direction ?? "inout",
        args: { x: p.x, y: p.y, angle: 0 },
        markup: { tagName: "circle", selector: "portBody" },
      })),
    },
    data: {
      ...(opts.stereotype ? { ruleName: opts.stereotype } : {}),
      ...(opts.sections ? { sections: opts.sections } : {}),
    },
  };
}

function makeEdge(opts: {
  id: string;
  source: string;
  sourcePort?: string;
  target: string;
  targetPort?: string;
  label?: string;
  stroke?: string;
  dash?: string;
  marker?: "classic" | "hollow-triangle" | "diamond";
  vertices?: { x: number; y: number }[];
}): DiagramEdge {
  return {
    id: opts.id,
    source: {
      cell: opts.source,
      port: opts.sourcePort ?? "out",
      anchor: "center",
      connectionPoint: { name: "boundary" },
    },
    target: {
      cell: opts.target,
      port: opts.targetPort ?? "in",
      anchor: "center",
      connectionPoint: { name: "boundary" },
    },
    ...(opts.vertices ? { vertices: opts.vertices } : {}),
    router: opts.vertices ? undefined : "manhattan",
    zIndex: 1,
    attrs: {
      line: {
        stroke: opts.stroke ?? "#38bdf8",
        strokeWidth: 1.8,
        ...(opts.dash ? { strokeDasharray: opts.dash } : {}),
        targetMarker: { name: opts.marker ?? "classic" },
        "vector-effect": "non-scaling-stroke",
        "pointer-events": "stroke",
      },
    },
    ...(opts.label
      ? {
          labels: [
            {
              attrs: {
                text: { text: opts.label },
              },
            },
          ],
        }
      : {}),
  };
}

const DEFAULT_COORDINATE_SYSTEM = { x: 0, y: 0, width: 800, height: 480 };

function renderBothThemesFromDiagramData(data: {
  nodes: DiagramNode[];
  edges: DiagramEdge[];
  coordinateSystem?: DiagramData["coordinateSystem"] | null;
  diagramBackground?: DiagramData["diagramBackground"];
}): { svgDark: string; svgLight: string } {
  const fullData: DiagramData = {
    nodes: data.nodes,
    edges: data.edges,
    coordinateSystem: data.coordinateSystem ?? DEFAULT_COORDINATE_SYSTEM,
    diagramBackground: data.diagramBackground ?? null,
  };
  return {
    svgDark: renderPolyglotDiagramToSvg(fullData, { theme: "dark", padding: 36 }),
    svgLight: renderPolyglotDiagramToSvg(fullData, { theme: "light", padding: 36 }),
  };
}

// ── Language Example Catalog (44 Languages) ────────────────────────────────

export const EXAMPLE_SPECS: Record<string, Omit<LanguageExampleSpec, "slug">> = {
  modelscript: {
    filename: "ServoDriveThread.msx",
    title: "Closed-Loop Electromechanical Servo Drive",
    description:
      "Couples a permanent-magnet DC motor, harmonic gear reducer, and proportional-derivative position controller with safety invariants.",
    viewLabel: "Multi-Domain Block & Physical Schematic",
    code: `model ServoDriveThread
  parameter Real J_load = 0.045 "Load moment of inertia [kg.m2]";
  parameter Real K_t = 0.82 "Motor torque constant [N.m/A]";
  parameter Real R_a = 1.25 "Armature resistance [Ohm]";
  parameter Real K_p = 48.0 "Proportional gain [V/rad]";
  parameter Real K_d = 6.5 "Derivative damping gain [V.s/rad]";
  parameter Real theta_ref = 1.5708 "Target step angle [rad]";

  Real theta(start = 0.0) "Output shaft angle [rad]";
  Real omega(start = 0.0) "Angular velocity [rad/s]";
  Real i_a(start = 0.0) "Armature current [A]";
  Real v_cmd "Controller voltage command [V]";
equation
  v_cmd = K_p * (theta_ref - theta) - K_d * omega;
  R_a * i_a + K_t * omega = v_cmd;
  J_load * der(omega) = K_t * i_a - 0.12 * omega;
  der(theta) = omega;
end ServoDriveThread;`,
  },

  modelica: {
    filename: "ChuaNonlinearCircuit.mo",
    title: "Chua's Chaotic RLC & Piecewise-Linear Circuit",
    description:
      "Standard Modelica 3.x acausal electrical network with linear passives, gyrator inductance, and a piecewise-linear active Chua diode.",
    viewLabel: "Acausal Electrical Schematic",
    code: `model ChuaNonlinearCircuit "Chua's chaotic oscillator circuit"
  parameter Real C1 = 10.0 "Capacitor C1 [F]";
  parameter Real C2 = 100.0 "Capacitor C2 [F]";
  parameter Real L = 18.0 "Inductor L [H]";
  parameter Real G = 0.7 "Conductance R [S]";
  parameter Real Ga = -0.757576 "Inner diode slope [S]";
  parameter Real Gb = -0.409091 "Outer diode slope [S]";

  Real v1(start = 0.15) "Voltage across C1 [V]";
  Real v2(start = 0.0) "Voltage across C2 [V]";
  Real iL(start = 0.0) "Inductor current [A]";
  Real i_nl "Nonlinear Chua diode current [A]";
equation
  i_nl = Gb * v1 + 0.5 * (Ga - Gb) * (abs(v1 + 1.0) - abs(v1 - 1.0));
  C1 * der(v1) = G * (v2 - v1) - i_nl;
  C2 * der(v2) = G * (v1 - v2) + iL;
  L * der(iL) = -v2;
end ChuaNonlinearCircuit;`,
  },

  sysml2: {
    filename: "ElectricPowertrain.sysml",
    title: "EV High-Voltage Powertrain Architecture & Requirements",
    description:
      "SysML v2 package defining battery, SiC traction inverter, and e-axle motor blocks with typed power ports and safety requirements.",
    viewLabel: "SysML v2 Architecture Diagram (BDD)",
    code: `package ElectricPowertrain {
  port def DcBusPort {
    attribute voltage : Real;
    attribute current : Real;
  }

  part def BatteryPack {
    attribute capacityKwh : Real = 82.0;
    attribute nominalVoltage : Real = 800.0;
    port dcOut : DcBusPort;
  }

  part def TractionInverter {
    attribute efficiency : Real = 0.985;
    port dcIn : ~DcBusPort;
    port acOut : DcBusPort;
  }

  part def EAxleMotor {
    attribute peakTorqueNm : Real = 420.0;
    attribute maxRpm : Real = 18000.0;
    port acIn : ~DcBusPort;
  }

  part def ElectricVehicle {
    part pack : BatteryPack;
    part inverter : TractionInverter;
    part motor : EAxleMotor;
  }

  requirement def ThermalSafetyReq {
    doc /* Pack cell temperature shall remain below 333.15 K under peak load. */
  }
}`,
  },

  reqif: {
    filename: "BrakeByWireSafety.reqif",
    title: "ISO 26262 ASIL-D Brake-by-Wire Requirements Specification",
    description:
      "OMG ReqIF specification objects and traceability links connecting vehicle deceleration hazards to actuator response latency budgets.",
    viewLabel: "Requirement Traceability & Entailment Graph",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd">
  <THE-HEADER>
    <REQ-IF-HEADER IDENTIFIER="HDR-BBW-2026">
      <TITLE>ISO 26262 Brake-by-Wire Safety Specification</TITLE>
    </REQ-IF-HEADER>
  </THE-HEADER>
  <CORE-CONTENT>
    <REQ-IF-CONTENT>
      <SPEC-OBJECTS>
        <SPEC-OBJECT IDENTIFIER="REQ-SYS-001" LONG-NAME="Stopping Distance Limit">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Vehicle shall decelerate at >= 9.5 m/s2 from 100 km/h on dry asphalt." />
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-SW-002" LONG-NAME="Brake Command Latency">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="End-to-end pedal sensor to caliper force loop shall execute within 5.0 ms." />
          </VALUES>
        </SPEC-OBJECT>
        <SPEC-OBJECT IDENTIFIER="REQ-HW-003" LONG-NAME="Dual-Channel Power Redundancy">
          <VALUES>
            <ATTRIBUTE-VALUE-STRING THE-VALUE="Independent 48V buses shall supply front and rear electro-mechanical calipers." />
          </VALUES>
        </SPEC-OBJECT>
      </SPEC-OBJECTS>
      <SPEC-RELATIONS>
        <SPEC-RELATION IDENTIFIER="REL-01">
          <SOURCE><SPEC-OBJECT-REF>REQ-SW-002</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-SYS-001</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
        <SPEC-RELATION IDENTIFIER="REL-02">
          <SOURCE><SPEC-OBJECT-REF>REQ-HW-003</SPEC-OBJECT-REF></SOURCE>
          <TARGET><SPEC-OBJECT-REF>REQ-SYS-001</SPEC-OBJECT-REF></TARGET>
        </SPEC-RELATION>
      </SPEC-RELATIONS>
    </REQ-IF-CONTENT>
  </CORE-CONTENT>
</REQ-IF>`,
  },

  ssp: {
    filename: "SystemStructure.ssd",
    title: "Multi-FMU Co-Simulation System Structure (SSP 1.0)",
    description:
      "Connects a Controller FMU, Actuator Hydraulics FMU, and Vehicle Dynamics Plant FMU across typed causal Real connectors.",
    viewLabel: "SSP System Structure & FMU Connection Diagram",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription" name="ActiveSuspensionCoSim" version="1.0">
  <ssd:System name="ActiveSuspensionRoot">
    <ssd:Elements>
      <ssd:Component name="SkyhookController" source="resources/SkyhookController.fmu">
        <ssd:Connectors>
          <ssd:Connector name="z_err" kind="input" />
          <ssd:Connector name="u_valve" kind="output" />
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="HydraulicActuator" source="resources/HydraulicActuator.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u_valve" kind="input" />
          <ssd:Connector name="f_strut" kind="output" />
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="ChassisPlant" source="resources/ChassisPlant.fmu">
        <ssd:Connectors>
          <ssd:Connector name="f_strut" kind="input" />
          <ssd:Connector name="z_body" kind="output" />
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="SkyhookController" startConnector="u_valve" endElement="HydraulicActuator" endConnector="u_valve" />
      <ssd:Connection startElement="HydraulicActuator" startConnector="f_strut" endElement="ChassisPlant" endConnector="f_strut" />
      <ssd:Connection startElement="ChassisPlant" startConnector="z_body" endElement="SkyhookController" endConnector="z_err" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`,
  },

  owl2: {
    filename: "AvionicsSafetyOntology.owl",
    title: "Avionics Fault-Containment & Redundancy Ontology",
    description:
      "OWL 2 Functional-Style ontology defining flight-critical sensors, actuators, and object property assertions classified by the tableau reasoner.",
    viewLabel: "OWL 2 Classified Ontology & Axiom Graph",
    code: `Prefix(:=<http://modelscript.org/ontologies/avionics#>)
Prefix(owl:=<http://www.w3.org/2002/07/owl#>)

Ontology(<http://modelscript.org/ontologies/avionics>
  Declaration(Class(:AvionicsLRU))
  Declaration(Class(:FlightControlComputer))
  Declaration(Class(:InertialSensor))
  Declaration(Class(:ElectroHydrostaticActuator))
  Declaration(ObjectProperty(:commandsActuator))
  Declaration(ObjectProperty(:readsSensor))

  SubClassOf(:FlightControlComputer :AvionicsLRU)
  SubClassOf(:InertialSensor :AvionicsLRU)
  SubClassOf(:ElectroHydrostaticActuator :AvionicsLRU)

  Declaration(NamedIndividual(:FCC_Primary))
  Declaration(NamedIndividual(:IMU_A))
  Declaration(NamedIndividual(:EHA_AileronL))

  ClassAssertion(:FlightControlComputer :FCC_Primary)
  ClassAssertion(:InertialSensor :IMU_A)
  ClassAssertion(:ElectroHydrostaticActuator :EHA_AileronL)
  ObjectPropertyAssertion(:readsSensor :FCC_Primary :IMU_A)
  ObjectPropertyAssertion(:commandsActuator :FCC_Primary :EHA_AileronL)
)`,
  },

  step: {
    filename: "RoboticWristAssembly.step",
    title: "ISO 10303-21 AP242 Robotic Wrist Assembly & PMI",
    description:
      "STEP Part 21 assembly hierarchy defining rigid-body coordinate frames, a revolute kinematic pair, and AP242 flatness tolerances.",
    viewLabel: "3D Isometric B-Rep & Assembly Kinematic Tree",
    code: `ISO-10303-21;
HEADER;
FILE_DESCRIPTION(('ModelScript AP242 Robotic Wrist Assembly'),'2;1');
FILE_NAME('RoboticWristAssembly.step','2026-04-01T12:00:00',('ModelScript'),(''),'','','');
FILE_SCHEMA(('AP242_MANAGED_MODEL_BASED_3D_ENGINEERING_MIM_LF'));
ENDSEC;
DATA;
#10 = PRODUCT('BASE_FLANGE','Base Mounting Flange','',(#2));
#11 = PRODUCT_DEFINITION_FORMATION('1','Rev A',#10);
#12 = PRODUCT_DEFINITION('design','',#11,#3);
#20 = PRODUCT('WRIST_YOKE','Articulated Wrist Yoke','',(#2));
#21 = PRODUCT_DEFINITION_FORMATION('1','Rev A',#20);
#22 = PRODUCT_DEFINITION('design','',#21,#3);
#30 = PRODUCT('TOOL_ADAPTER','ISO 9409-1 Tool Adapter','',(#2));
#31 = PRODUCT_DEFINITION_FORMATION('1','Rev A',#30);
#32 = PRODUCT_DEFINITION('design','',#31,#3);
#40 = CARTESIAN_POINT('Origin',(0.0,0.0,0.0));
#41 = DIRECTION('Z_Axis',(0.0,0.0,1.0));
#42 = DIRECTION('X_Axis',(1.0,0.0,0.0));
#43 = AXIS2_PLACEMENT_3D('BaseFrame',#40,#41,#42);
#50 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_1','Base to Yoke','Pitch Joint',#12,#22,$);
#51 = NEXT_ASSEMBLY_USAGE_OCCURRENCE('NAUO_2','Yoke to Tool','Roll Joint',#22,#32,$);
#60 = FLATNESS_TOLERANCE('FT_01','Mounting Face Flatness',#61,#12);
ENDSEC;
END-ISO-10303-21;`,
  },

  scad: {
    filename: "FlangedBearingHousing.scad",
    title: "Parametric Flanged Bearing Pillow-Block CSG Solid",
    description:
      "Programmatic OpenSCAD constructive solid geometry combining a mounting base plate, cylindrical boss, center bore, and bolt pattern.",
    viewLabel: "3D Isometric CSG Mesh & Boolean Tree",
    code: `// Parametric Flanged Bearing Housing
$fn = 64;
base_w = 80;
base_d = 50;
base_h = 10;
boss_r = 22;
boss_h = 32;
bore_r = 12;

difference() {
  union() {
    // Base mounting flange
    translate([0, 0, base_h / 2])
      cube([base_w, base_d, base_h], center = true);
    // Cylindrical bearing boss
    cylinder(h = boss_h, r = boss_r, center = false);
  }
  // Precision shaft through-bore
  translate([0, 0, -1])
    cylinder(h = boss_h + 2, r = bore_r, center = false);
  // Four M8 mounting bolt holes
  for (sx = [-28, 28], sy = [-16, 16]) {
    translate([sx, sy, -1])
      cylinder(h = base_h + 2, r = 4.2, center = false);
  }
}`,
  },

  cfd: {
    filename: "TransonicNACA0012.su2",
    title: "SU2 Transonic Compressible Airfoil Euler/RANS Deck",
    description:
      "Compressible flow solver deck and boundary marker specification for a NACA 0012 airfoil at Mach 0.80 and 1.25 deg angle of attack.",
    viewLabel: "Unstructured Airfoil Mesh & Mach Number Field",
    code: `% SU2 Transonic Compressible Flow Configuration
SOLVER= EULER
MATH_PROBLEM= DIRECT
MACH_NUMBER= 0.80
AOA= 1.25
FREESTREAM_PRESSURE= 101325.0
FREESTREAM_TEMPERATURE= 288.15
REF_AREA= 1.0
REF_LENGTH= 1.0
MARKER_EULER= ( airfoil )
MARKER_FAR= ( farfield )
CONV_NUM_METHOD_FLOW= ROE
TIME_DISCRE_FLOW= EULER_IMPLICIT
ITER= 500
MESH_FILENAME= mesh_NACA0012_transonic.su2`,
  },

  fea: {
    filename: "TitaniumCantileverBracket.inp",
    title: "CalculiX / Abaqus 3D Structural Static Stress Deck",
    description:
      "Linear elastic finite-element deck in Ti-6Al-4V with fixed root boundary nodes and a 4.5 kN tip bending load.",
    viewLabel: "3D Finite-Element Mesh & Von Mises Stress Contour",
    code: `*HEADING
Ti-6Al-4V Aerospace Actuator Bracket Static Stress Study
*NODE
1, 0.0, 0.0, 0.0
2, 0.12, 0.0, 0.0
3, 0.12, 0.04, 0.0
4, 0.0, 0.04, 0.0
5, 0.0, 0.0, 0.025
6, 0.12, 0.0, 0.025
7, 0.12, 0.04, 0.025
8, 0.0, 0.04, 0.025
*ELEMENT, TYPE=C3D8, ELSET=EALL
1, 1, 2, 3, 4, 5, 6, 7, 8
*MATERIAL, NAME=TI6AL4V
*ELASTIC
114.0E9, 0.34
*SOLID SECTION, ELSET=EALL, MATERIAL=TI6AL4V
*BOUNDARY
1, 1, 3, 0.0
4, 1, 3, 0.0
5, 1, 3, 0.0
8, 1, 3, 0.0
*STEP
*STATIC
*CLOAD
2, 3, -2250.0
6, 3, -2250.0
*END STEP`,
  },

  csv: {
    filename: "BatteryPackDriveCycle.csv",
    title: "EV Battery Pack WLTP Telemetry Time-Series",
    description:
      "Synchronized multi-channel sensor log recording pack bus voltage, discharge current, state of charge, and peak cell temperature.",
    viewLabel: "Multi-Channel Telemetry Trajectory Plot",
    code: `time,voltage_v,current_a,soc_pct,temp_c
0.0,798.4,0.0,92.0,24.2
10.0,784.1,145.0,91.4,25.1
20.0,771.6,230.0,90.3,26.8
30.0,765.2,265.0,88.9,28.9
40.0,779.0,95.0,88.1,30.2
50.0,794.5,-85.0,88.7,30.8
60.0,788.2,60.0,88.3,31.1`,
  },

  c: {
    filename: "FocCurrentLoop.c",
    title: "Embedded C Field-Oriented Control (FOC) PI Regulator",
    description:
      "Deterministic C control law with integral anti-windup clamped to bus voltage limits, scraped and lowered into the DAE arena.",
    viewLabel: "C External Function & DAE Block Interface",
    code: `// Embedded C Discrete PI Current Controller with Anti-Windup
typedef struct {
  double kp;
  double ki;
  double v_max;
  double integral;
} PiController;

double pi_current_step(PiController *ctrl, double i_ref, double i_meas, double dt) {
  double err = i_ref - i_meas;
  double candidate = ctrl->integral + ctrl->ki * err * dt;
  if (candidate > ctrl->v_max) candidate = ctrl->v_max;
  if (candidate < -ctrl->v_max) candidate = -ctrl->v_max;
  ctrl->integral = candidate;

  double v_out = ctrl->kp * err + ctrl->integral;
  if (v_out > ctrl->v_max) return ctrl->v_max;
  if (v_out < -ctrl->v_max) return -ctrl->v_max;
  return v_out;
}`,
  },

  fortran: {
    filename: "TwoBodyRk4Integrator.f90",
    title: "Fortran 90 Orbital Mechanics & Thermal DAE Subroutine",
    description:
      "Legacy scientific Fortran subroutine lowered directly into ModelScript's linear-memory DAE arena for coupled co-simulation.",
    viewLabel: "Fortran Subroutine & State Lowering Flow",
    code: `subroutine thermal_node_step(t_wall, t_fluid, q_solar, c_th, h_conv, dt)
  implicit none
  real(8), intent(inout) :: t_wall
  real(8), intent(in)    :: t_fluid, q_solar, c_th, h_conv, dt
  real(8) :: q_conv, dt_wall_dt

  ! Convective heat transfer and radiative dissipation
  q_conv = h_conv * (t_wall - t_fluid)
  dt_wall_dt = (q_solar - q_conv) / c_th
  t_wall = t_wall + dt_wall_dt * dt
end subroutine thermal_node_step`,
  },

  jsbsim: {
    filename: "MediumAltitudeUav.xml",
    title: "JSBSim 6-DOF Fixed-Wing UAV Flight Dynamics Model",
    description:
      "Aerospace flight dynamics configuration specifying wing geometry, mass balance, turboprop thrust, pitch FCS channel, and lift/drag polars.",
    viewLabel: "JSBSim 6-DOF Flight Control & Aero Block Diagram",
    code: `<?xml version="1.0"?>
<fdm_config name="MediumAltitudeUAV" version="2.0">
  <metrics>
    <wingarea unit="M2"> 6.40 </wingarea>
    <wingspan unit="M"> 8.50 </wingspan>
    <chord unit="M"> 0.75 </chord>
  </metrics>
  <mass_balance>
    <emptywt unit="KG"> 185.0 </emptywt>
    <ixx unit="KG*M2"> 94.0 </ixx>
    <iyy unit="KG*M2"> 142.0 </iyy>
    <izz unit="KG*M2"> 218.0 </izz>
  </mass_balance>
  <flight_control name="PitchAutopilot">
    <channel name="Pitch">
      <summer name="PitchError">
        <input>ap/theta-cmd-rad</input>
        <input>-attitude/theta-rad</input>
      </summer>
      <pure_gain name="ElevatorGain">
        <input>fcs/pitch-error</input>
        <gain>2.4</gain>
        <output>fcs/elevator-cmd-norm</output>
      </pure_gain>
    </channel>
  </flight_control>
</fdm_config>`,
  },

  rocets: {
    filename: "LoxMethaneExpanderCycle.roc",
    title: "NASA ROCETS LOX/Methane Expander-Bleed Rocket Engine",
    description:
      "Cryogenic liquid rocket engine balance deck coupling LOX/CH4 turbopumps, regenerative cooling jacket, preburner, and main thrust chamber.",
    viewLabel: "ROCETS Propulsion Cycle P&ID Schematic",
    code: `TITLE LOX-Methane Staged Expander Engine Cycle
MODULE TURBOPUMP TP_LOX
  EFFICIENCY = 0.78
  PRESSURE_RATIO = 22.4
  FLOW_RATE = 84.5
MODULE TURBOPUMP TP_CH4
  EFFICIENCY = 0.75
  PRESSURE_RATIO = 26.0
  FLOW_RATE = 24.1
MODULE HEAT_EXCHANGER REGEN_JACKET
  HEAT_LOAD = 14.2E6
  DP_FRAC = 0.08
MODULE TURBINE DRIVE_TURB
  EFFICIENCY = 0.81
  POWER_MW = 6.8
MODULE CHAMBER MAIN_TCA
  PC = 135.0
  MR = 3.50
  ISP_VAC = 364.2
CONNECT TP_CH4.OUT -> REGEN_JACKET.IN
CONNECT REGEN_JACKET.OUT -> DRIVE_TURB.IN
CONNECT DRIVE_TURB.OUT -> MAIN_TCA.FUEL_IN
CONNECT TP_LOX.OUT -> MAIN_TCA.OX_IN`,
  },

  ccsds: {
    filename: "EarthObservationLeo.oem",
    title: "CCSDS OEM 2.0 Sun-Synchronous LEO Orbit Ephemeris",
    description:
      "Standard CCSDS Orbit Ephemeris Message with EME2000 inertial position/velocity state vectors and covariance matrix metadata.",
    viewLabel: "3D LEO Orbital Trajectory & Telemetry State Diagram",
    code: `CCSDS_OEM_VERS = 2.0
CREATION_DATE = 2026-06-15T00:00:00
ORIGINATOR = MODELSCRIPT_FLIGHT_DYNAMICS

META_START
OBJECT_NAME = SENTINEL_EO_1
OBJECT_ID = 2026-042A
CENTER_NAME = EARTH
REF_FRAME = EME2000
TIME_SYSTEM = UTC
START_TIME = 2026-06-15T00:00:00.000
STOP_TIME = 2026-06-15T00:15:00.000
META_STOP

2026-06-15T00:00:00.000  7016.000   0.000     0.000   0.000  1.312  7.428
2026-06-15T00:05:00.000  6642.180 388.420  2198.410  -2.468  1.241  7.032
2026-06-15T00:10:00.000  5560.940 735.110  4160.290  -4.672  1.039  5.887
2026-06-15T00:15:00.000  3886.410 998.640  5651.820  -6.351  0.726  4.115`,
  },

  easy5: {
    filename: "ElectroHydraulicFlightActuator.ez5",
    title: "EASY5 Electro-Hydraulic Flight Control Servo Loop",
    description:
      "Multi-rate block schematic coupling a command summing junction, servo valve transfer function, hydraulic cylinder integrator, and LVDT feedback.",
    viewLabel: "EASY5 Control Block Schematic",
    code: `TITLE = Primary Flight Control Electro-Hydraulic Servo Actuator
COMPONENT SUM1 TYPE = SJ
  PARAMETER G1 = 1.0, G2 = -1.0
COMPONENT GAIN1 TYPE = GN
  PARAMETER K = 18.5
COMPONENT VALVE1 TYPE = TF
  PARAMETER K = 1.25, TAU = 0.008
COMPONENT CYL1 TYPE = IN
  PARAMETER IC = 0.0, GAIN = 1.0
COMPONENT LVDT1 TYPE = LA
  PARAMETER K = 1.0, TAU = 0.002
CONNECT SUM1.S_OUT TO GAIN1.S_IN
CONNECT GAIN1.S_OUT TO VALVE1.S_IN
CONNECT VALVE1.S_OUT TO CYL1.S_IN
CONNECT CYL1.S_OUT TO LVDT1.S_IN
CONNECT LVDT1.S_OUT TO SUM1.S_IN2`,
  },

  autosar: {
    filename: "TorqueVectoringComposition.arxml",
    title: "AUTOSAR R4.x Torque Vectoring SWC & Virtual Function Bus",
    description:
      "AUTOSAR Classic XML defining Sensor, Controller, and Inverter Actuator Software Components connected across Sender-Receiver ports.",
    viewLabel: "AUTOSAR SWC Composition & Port Topology",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<AUTOSAR xmlns="http://autosar.org/schema/r4.0">
  <AR-PACKAGES>
    <AR-PACKAGE>
      <SHORT-NAME>ChassisControl</SHORT-NAME>
      <ELEMENTS>
        <SENSOR-ACTUATOR-SW-COMPONENT-TYPE>
          <SHORT-NAME>YawRateSensorSwc</SHORT-NAME>
          <PORTS>
            <P-PORT-PROTOTYPE><SHORT-NAME>YawRateOut</SHORT-NAME></P-PORT-PROTOTYPE>
          </PORTS>
        </SENSOR-ACTUATOR-SW-COMPONENT-TYPE>
        <APPLICATION-SW-COMPONENT-TYPE>
          <SHORT-NAME>TorqueVectoringSwc</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE><SHORT-NAME>YawRateIn</SHORT-NAME></R-PORT-PROTOTYPE>
            <P-PORT-PROTOTYPE><SHORT-NAME>RearTorqueSplitOut</SHORT-NAME></P-PORT-PROTOTYPE>
          </PORTS>
        </APPLICATION-SW-COMPONENT-TYPE>
        <SENSOR-ACTUATOR-SW-COMPONENT-TYPE>
          <SHORT-NAME>DualInverterActuatorSwc</SHORT-NAME>
          <PORTS>
            <R-PORT-PROTOTYPE><SHORT-NAME>RearTorqueSplitIn</SHORT-NAME></R-PORT-PROTOTYPE>
          </PORTS>
        </SENSOR-ACTUATOR-SW-COMPONENT-TYPE>
      </ELEMENTS>
    </AR-PACKAGE>
  </AR-PACKAGES>
</AUTOSAR>`,
  },

  simulink: {
    filename: "PitchHoldAutopilot.mdl",
    title: "MATLAB Simulink Pitch-Hold Autopilot Block Diagram",
    description:
      "Continuous-time feedback control loop with a step reference, summing junction, PID compensator, airframe short-period transfer function, and scope.",
    viewLabel: "Simulink Signal-Flow Block Diagram",
    code: `Model {
  Name "PitchHoldAutopilot"
  System {
    Name "PitchHoldAutopilot"
    Block {
      BlockType Step
      Name "ThetaRef"
      Position [40, 90, 80, 130]
    }
    Block {
      BlockType Sum
      Name "PitchError"
      Inputs "+-"
      Position [140, 90, 180, 130]
    }
    Block {
      BlockType Gain
      Name "KpGain"
      Gain "4.8"
      Position [240, 90, 290, 130]
    }
    Block {
      BlockType TransferFcn
      Name "AirframeDynamics"
      Numerator "[12.5]"
      Denominator "[1 3.2 14.0]"
      Position [360, 85, 460, 135]
    }
    Block {
      BlockType Scope
      Name "PitchScope"
      Position [530, 90, 570, 130]
    }
    Line {
      SrcBlock "ThetaRef"
      SrcPort 1
      DstBlock "PitchError"
      DstPort 1
    }
    Line {
      SrcBlock "PitchError"
      SrcPort 1
      DstBlock "KpGain"
      DstPort 1
    }
    Line {
      SrcBlock "KpGain"
      SrcPort 1
      DstBlock "AirframeDynamics"
      DstPort 1
    }
    Line {
      SrcBlock "AirframeDynamics"
      SrcPort 1
      DstBlock "PitchScope"
      DstPort 1
    }
    Line {
      SrcBlock "AirframeDynamics"
      SrcPort 1
      DstBlock "PitchError"
      DstPort 2
    }
  }
}`,
  },

  gtsuite: {
    filename: "TurboGdiEngine1D.gtm",
    title: "GT-SUITE 1D Turbocharged Direct-Injection Engine Flowpath",
    description:
      "1D gas-dynamics network coupling ambient intake, centrifugal compressor, charge-air intercooler, intake manifold, cylinder, and exhaust turbine.",
    viewLabel: "GT-SUITE 1D Thermo-Fluid Engine Network",
    code: `# GT-SUITE 1D Turbocharged Engine Gas-Dynamics Model
Object EndEnvironment "AmbientAir" {
  Pressure = 1.01325
  Temperature = 298.15
}
Object Compressor "TurboCompressor" {
  RPM = 115000.0
  PressureRatio = 2.15
  Efficiency = 0.76
}
Object PipeRound "ChargeAirCooler" {
  Diameter = 62.0
  Length = 420.0
  WallTemp = 315.0
}
Object FlowSplit "IntakeManifold" {
  Volume = 3.2
  InitialPressure = 2.10
  InitialTemperature = 322.0
}
Object EngCylinder "Cylinder1" {
  Bore = 82.5
  Stroke = 88.0
  CompressionRatio = 10.5
}
Object Turbine "ExhaustTurbine" {
  PressureRatio = 1.95
  Efficiency = 0.74
}
Link "AmbientAir" -> "TurboCompressor"
Link "TurboCompressor" -> "ChargeAirCooler"
Link "ChargeAirCooler" -> "IntakeManifold"
Link "IntakeManifold" -> "Cylinder1"
Link "Cylinder1" -> "ExhaustTurbine"`,
  },

  opendrive: {
    filename: "HighwayClothoidCurve.xodr",
    title: "ASAM OpenDRIVE 1.7 Highway Alignment & Clothoid Spiral",
    description:
      "Analytical road reference line combining a straight entry tangent, Euler clothoid transition spiral, and constant-radius circular arc.",
    viewLabel: "OpenDRIVE Plan-View Road Geometry & Lanes",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<OpenDRIVE>
  <header revMajor="1" revMinor="7" name="HighwayClothoidSegment" />
  <road name="PrimaryExpressway" length="380.0" id="1" junction="-1">
    <planView>
      <geometry s="0.0" x="0.0" y="0.0" hdg="0.0" length="140.0">
        <line />
      </geometry>
      <geometry s="140.0" x="140.0" y="0.0" hdg="0.0" length="100.0">
        <spiral curvStart="0.0" curvEnd="0.004" />
      </geometry>
      <geometry s="240.0" x="239.5" y="6.6" hdg="0.2" length="140.0">
        <arc curvature="0.004" />
      </geometry>
    </planView>
    <lanes>
      <laneSection s="0.0">
        <right>
          <lane id="-1" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
          <lane id="-2" type="driving" level="false">
            <width sOffset="0.0" a="3.75" b="0.0" c="0.0" d="0.0" />
          </lane>
        </right>
      </laneSection>
    </lanes>
  </road>
</OpenDRIVE>`,
  },

  openscenario: {
    filename: "HighwayCutInSafety.xosc",
    title: "ASAM OpenSCENARIO Highway Cut-In & RSS Safety Check",
    description:
      "Autonomous driving validation scenario where a challenger vehicle executes a lane-change cut-in ahead of the ego vehicle at 30 m/s.",
    viewLabel: "OpenSCENARIO Multi-Actor Maneuver & RSS Envelope",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<OpenSCENARIO>
  <FileHeader revMajor="1" revMinor="2" description="Highway Cut-In RSS Verification" author="ModelScript" />
  <Entities>
    <ScenarioObject name="Ego">
      <Vehicle name="EgoSedan" vehicleCategory="car" />
    </ScenarioObject>
    <ScenarioObject name="Challenger">
      <Vehicle name="CutInSuv" vehicleCategory="car" />
    </ScenarioObject>
    <ScenarioObject name="LeadTruck">
      <Vehicle name="FreightLiner" vehicleCategory="truck" />
    </ScenarioObject>
  </Entities>
  <Storyboard>
    <Init>
      <Actions>
        <Private entityRef="Ego">
          <PrivateAction>
            <LongitudinalAction>
              <SpeedAction>
                <SpeedActionTarget><AbsoluteTargetSpeed value="31.0" /></SpeedActionTarget>
              </SpeedAction>
            </LongitudinalAction>
          </PrivateAction>
        </Private>
      </Actions>
    </Init>
  </Storyboard>
</OpenSCENARIO>`,
  },

  gensys: {
    filename: "HighSpeedPassengerBogie.calc",
    title: "GENSYS High-Speed Railway Vehicle & Bogie Suspension",
    description:
      "Multi-body rail vehicle model with carbody, bolster, bogie frame, two wheelsets, primary/secondary air-spring couplings, and EN 14363 track.",
    viewLabel: "GENSYS Multibody Rail Vehicle Topology",
    code: `## GENSYS High-Speed Passenger Coach Bogie Deck
func const v_kmh = 250.0
mass m_carbody  0.0 0.0 -1.85   38000.0 38000.0 38000.0   58000.0 1250000.0 1250000.0
mass m_bogie1   9.5 0.0 -0.65    2600.0  2600.0  2600.0    1800.0    3200.0    4600.0
mass m_axle11  10.8 0.0 -0.46    1450.0  1450.0  1450.0     820.0     140.0     820.0
mass m_axle12   8.2 0.0 -0.46    1450.0  1450.0  1450.0     820.0     140.0     820.0

coupl k_sec_z   m_carbody m_bogie1  0.42e6
coupl c_sec_z   m_carbody m_bogie1  28.0e3
coupl k_prim_11 m_bogie1  m_axle11  1.15e6
coupl k_prim_12 m_bogie1  m_axle12  1.15e6`,
  },

  simpack: {
    filename: "DoubleWishboneAxle.spck",
    title: "SIMPACK Spatial Multibody Suspension & Wheel Kinematics",
    description:
      "Spatial multibody tree defining chassis, upper/lower control arms, steering knuckle, wheel hub, kinematic joints, and coilover force elements.",
    viewLabel: "SIMPACK Kinematic Tree & Force Element Graph",
    code: `! SIMPACK Multibody Suspension Deck
header.title = 'DoubleWishboneCorner'
body.chassis.mass = 420.0
body.upright.mass = 18.5
body.wheel_hub.mass = 24.0
joint.j_chassis.body1 = 'ground'
joint.j_chassis.body2 = 'chassis'
joint.j_chassis.type = 'prismatic'
joint.j_arm.body1 = 'chassis'
joint.j_arm.body2 = 'upright'
joint.j_arm.type = 'revolute'
joint.j_spindle.body1 = 'upright'
joint.j_spindle.body2 = 'wheel_hub'
joint.j_spindle.type = 'revolute'
force.coilover.body1 = 'chassis'
force.coilover.body2 = 'upright'
force.coilover.k = 36000.0
force.coilover.c = 2400.0`,
  },

  pscad: {
    filename: "IbrTransmissionFault.pscx",
    title: "PSCAD Grid-Following Inverter & 230 kV Transmission Fault",
    description:
      "EMT power system schematic with a 3-phase Thévenin grid source, step-up transformer, pi-section line, timed fault breaker, and RLC load.",
    viewLabel: "PSCAD Single-Line EMT Schematic",
    code: `<project name="IbrTransmissionFault" version="5.0">
  <definitions>
    <definition name="Main">
      <schematic>
        <Bus id="Bus_Grid" name="Grid_230kV" x="140" y="140" BaseKV="230.0" />
        <Bus id="Bus_PCC" name="PCC_34kV" x="380" y="140" BaseKV="34.5" />
        <component id="Src1" type="Source3Ph" name="GridThevenin" x="60" y="140" Vbase="230.0" freq="60.0" />
        <component id="Xfmr1" type="Transformer2W" name="MainStepUp" x="260" y="140" MVA="150.0" Xl="0.10" />
        <component id="Brk1" type="Breaker3Ph" name="FaultBreaker" x="500" y="140" tOpen="0.15" />
        <component id="Load1" type="RLCLoad" name="FeederLoad" x="620" y="140" P="85.0" Q="24.0" />
        <Wire id="W1" src="Src1" dst="Bus_Grid" />
        <Wire id="W2" src="Bus_Grid" dst="Xfmr1" />
        <Wire id="W3" src="Xfmr1" dst="Bus_PCC" />
        <Wire id="W4" src="Bus_PCC" dst="Brk1" />
        <Wire id="W5" src="Brk1" dst="Load1" />
      </schematic>
    </definition>
  </definitions>
</project>`,
  },

  psse: {
    filename: "RegionalGrid4Bus.raw",
    title: "PSS/E v33 High-Voltage AC Power Flow Network",
    description:
      "Transmission power-flow deck with a 500 kV slack bus, 230 kV PV generator station, step-up transformer, and industrial PQ load buses.",
    viewLabel: "PSS/E Single-Line Bus-Branch Diagram",
    code: `0, 100.0, 33, 0, 1, 60.0 / PSS/E 4-Bus Regional Transmission Grid
1, 'SLACK_500', 500.0, 3, 1, 1, 1, 1.030,  0.00
2, 'GEN_230  ', 230.0, 2, 1, 1, 1, 1.015, -2.40
3, 'SUB_230  ', 230.0, 1, 1, 1, 1, 0.992, -5.85
4, 'LOAD_115 ', 115.0, 1, 1, 1, 1, 0.978, -8.10
0 / END OF BUS DATA, BEGIN LOAD DATA
3, '1 ', 1, 1, 1, 160.0, 55.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
4, '1 ', 1, 1, 1, 110.0, 35.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
1, '1 ', 240.0, 80.0, 200.0, -100.0, 1.030, 0, 100.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1, 100.0, 400.0, 50.0, 1, 1.0
2, '1 ', 150.0, 45.0, 120.0,  -60.0, 1.015, 0, 100.0, 0.0, 1.0, 0.0, 0.0, 1.0, 1, 100.0, 220.0, 30.0, 1, 1.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
1, 2, '1 ', 0.004, 0.048, 0.085, 450.0, 450.0, 500.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
2, 3, '1 ', 0.008, 0.072, 0.042, 300.0, 300.0, 350.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
3, 4, '1 ', 0.011, 0.095, 0.020, 200.0, 200.0, 240.0, 0.0, 0.0, 0.0, 0.0, 1, 1, 0.0, 1, 1.0
0 / END OF BRANCH DATA`,
  },

  opendss: {
    filename: "SolarDistributionFeeder.dss",
    title: "OpenDSS 12.47 kV Unbalanced Distribution Feeder & PV DER",
    description:
      "Three-phase distribution circuit with substation step-down transformer, distribution lines, commercial load, and grid-tied PV inverter.",
    viewLabel: "OpenDSS Multi-Phase Feeder Topology",
    code: `Clear
New Circuit.Substation12kV basekv=115.0 pu=1.02 phases=3 bus1=SubHV
New Transformer.SubXfmr Phases=3 Windings=2 XHL=7.5
~ wdg=1 bus=SubHV conn=Delta kv=115.0 kva=10000
~ wdg=2 bus=FeederHead conn=Wye kv=12.47 kva=10000
New Line.Trunk1 Phases=3 Bus1=FeederHead Bus2=MidBus R1=0.18 X1=0.39 Length=2.2 units=km
New Line.Lateral1 Phases=3 Bus1=MidBus Bus2=SolarBus R1=0.24 X1=0.44 Length=1.4 units=km
New Load.IndustrialPark Phases=3 Bus1=MidBus kV=12.47 kW=2400 kvar=850 Model=1
New PVSystem.SolarFarm1 Phases=3 Bus1=SolarBus kV=12.47 kVA=1800 Pmpp=1650 irradiance=0.95
Solve`,
  },

  olga: {
    filename: "DeepwaterSubseaTieback.genkey",
    title: "OLGA Deepwater Multiphase Flowline & Steel Catenary Riser",
    description:
      "Transient gas-condensate-water flow assurance deck modeling seabed terrain slugging, riser base lift, topside choke, and separator.",
    viewLabel: "OLGA Multiphase Flowline & Riser Schematic",
    code: `! OLGA Deepwater Subsea Tieback & Riser Flow Assurance Case
CASE TITLE = "Deepwater Subsea Tieback & Catenary Riser"
OPTIONS DTSTART = 0.05, TEND = 3600.0
BRANCH LABEL = "SEABED_FLOWLINE", DIAMETER = 0.3048, ROUGHNESS = 4.5E-5
GEOMETRY X = (0.0, 3000.0, 6500.0, 8200.0), Y = (-1150.0, -1180.0, -1120.0, -45.0)
SOURCE LABEL = "WELLHEAD_A", BRANCH = "SEABED_FLOWLINE", MASSFLOW = 42.5, TEMPERATURE = 358.15, WATERCUT = 0.22
VALVE LABEL = "TOPSIDE_CHOKE", BRANCH = "SEABED_FLOWLINE", OPENING = 0.68, CD = 0.84
BOUNDARY NODE = "SEPARATOR_IN", TYPE = PRESSURE, PRESSURE = 35.0E5, TEMPERATURE = 308.15`,
  },

  lps: {
    filename: "TranscontinentalGasMainline.tgn",
    title: "PipelineStudio High-Pressure Gas Transmission & Compressor Station",
    description:
      "Steady-state and transient natural gas hydraulics deck with receipt supply, centrifugal compressor station, and city-gate delivery.",
    viewLabel: "PipelineStudio Hydraulics & Compressor Schematic",
    code: `# PipelineStudio (TGNET) Natural Gas Transmission Mainline
CASE TranscontinentalGasMainline TITLE "Transcontinental 36-Inch Gas Mainline"
SIMULATION TGNET
COMPOSITION CH4 0.925 C2H6 0.042 C3H8 0.013 CO2 0.012 N2 0.008

SUPPLY N_Inlet ELEVATION 120m PRESSURE 62bar MAOP 85bar
JUNCTION N_CompSuc ELEVATION 185m MAOP 85bar
JUNCTION N_CompDis ELEVATION 185m MAOP 85bar
DELIVERY N_CityGate ELEVATION 95m FLOW 105.0 MINP 48bar MAOP 85bar

PIPE Mainline_Seg1 FROM N_Inlet TO N_CompSuc LENGTH 68km DIAMETER 914.4mm ROUGHNESS 0.000018 MAOP 85bar
COMPRESSOR CS01_Boost FROM N_CompSuc TO N_CompDis POWER 14500000 RATIO 1.42 EFF 0.84 SETPOINT 82bar
PIPE Mainline_Seg2 FROM N_CompDis TO N_CityGate LENGTH 92km DIAMETER 914.4mm ROUGHNESS 0.000018 MAOP 85bar
INTEGRATION START 0 END 86400 DT 60 EOS AGA8`,
  },

  eclipse: {
    filename: "FiveSpotWaterflood.data",
    title: "ECLIPSE 100 Black-Oil Reservoir Stratigraphy & Waterflood",
    description:
      "Three-dimensional 5-layer sandstone reservoir model with Gas-Oil and Oil-Water contacts, water injector INJ-1, and producer PROD-1.",
    viewLabel: "ECLIPSE Subsurface X-Z Stratigraphy & Well Completions",
    code: `-- ECLIPSE 100 Black-Oil Reservoir Simulation Deck
RUNSPEC
TITLE
  North Sea Fault-Block Waterflood Model
DIMENS
  12 12 5 /
OIL
WATER
GAS
METRIC

GRID
DX
  720*100.0 /
DY
  720*100.0 /
DZ
  144*12.0 144*15.0 144*18.0 144*15.0 144*14.0 /
TOPS
  144*2150.0 /
PORO
  720*0.21 /
PERMX
  720*285.0 /

SOLUTION
EQUIL
  2180.0 265.0 2205.0 0.0 2168.0 0.0 1 1 0 /

SCHEDULE
WELSPECS
  'INJ-1'  'G1'  2  2  2210.0  'WATER' /
  'PROD-1' 'G1' 11 11  2175.0  'OIL'   /
/
COMPDAT
  'INJ-1'   2  2  4  5  'OPEN'  1  0.0  0.216 /
  'PROD-1' 11 11  2  3  'OPEN'  1  0.0  0.216 /
/
END`,
  },

  relap5: {
    filename: "PwrPrimaryCoolantLoop.inp",
    title: "RELAP5-3D Pressurized Water Reactor Primary Coolant Loop",
    description:
      "Coupled six-equation two-fluid thermal-hydraulics and point reactor kinetics deck for a PWR core, hot leg, U-tube steam generator, and RCP.",
    viewLabel: "RELAP5 Nuclear Reactor Nodalization Diagram",
    code: `= RELAP5-3D PWR Primary Loop & Point Kinetics Deck
0000100 new transnt
0000105 5.0 20.0
0000201 20.0 1.0e-4 0.02 3 10 100
* Hydrodynamic Components
1000000 reactor-core pipe
1000101 0.42 3.65 0.0 0.0 90.0 0.0 4.5e-5 0.0 00
1001201 003 15.5e6 582.0 0.0 0.0 0.0
1100000 hot-leg branch
1100101 0.74 6.20 0.0 0.0 0.0 0.0 4.5e-5 0.0 00
1101201 003 15.4e6 598.0 0.0 0.0 0.0
1200000 steam-gen pipe
1200101 1.15 9.80 0.0 0.0 -90.0 0.0 4.5e-5 0.0 00
1201201 003 15.2e6 566.0 0.0 0.0 0.0
1300000 coolant-pump pump
1300101 0.68 2.10 0.0 0.0 0.0 0.0 0.0 0.0 00
1301201 003 15.6e6 565.0 0.0 0.0 0.0
* Point Reactor Kinetics
3000000 point-kinetics
3000001 0 3411.0e6 0.0065 1.8e-5`,
  },

  sima: {
    filename: "SparFloatingWindTurbine.sima",
    title: "SIMA / RIFLEX 15 MW Floating Offshore Wind Catenary Mooring",
    description:
      "Coupled aero-hydro-servo-elastic marine task defining JONSWAP irregular waves, spar floater hydrodynamics, and a 3-line chain-polyester mooring spread.",
    viewLabel: "SIMA Catenary Riser & Mooring Profile",
    code: `# SIMA / RIFLEX Coupled Floating Offshore Wind Task
Task SparWindTurbine15MW {
  Environment {
    Hs = 6.2
    Tp = 11.8
    Gamma = 3.3
    CurrentSpeed = 0.85
    WindSpeed = 14.2
    WaterDepth = 320.0
  }
  Body SparFloater {
    Mass = 1.42e7
    Draft = 110.0
    COB = [0.0, 0.0, -52.0]
    COG = [0.0, 0.0, -78.5]
  }
  MooringLine Line1_Upwind {
    Fairlead = [-5.2, 0.0, -70.0]
    Anchor = [-820.0, 0.0, -320.0]
    Length = 885.0
    SubmergedWeight = 1180.0
    EA = 1.15e9
  }
}`,
  },

  spice: {
    filename: "SallenKeyActiveFilter.cir",
    title: "SPICE Second-Order Low-Pass Filter & Clamping Stage",
    description:
      "Analog circuit netlist combining an AC sinusoidal source, two-stage RC filter network, PN junction clamping diode, and transient directive.",
    viewLabel: "SPICE Analog Circuit Schematic",
    code: `* Second-Order RC Low-Pass Filter with Clamping Diode
V1 in 0 SIN(0 5.0 1k)
R1 in n1 1.5k
C1 n1 0 47n
R2 n1 out 2.2k
C2 out 0 22n
D1 out 0 DMOD
.model DMOD D(Is=2.52n Rs=0.568 N=1.752)
.tran 5u 2m
.end`,
  },

  "verilog-a": {
    filename: "NonlinearMemristor.va",
    title: "Verilog-A Compact Semiconductor & Memristive Device Model",
    description:
      "Behavioral analog compact model formulating KCL branch current contributions and internal state charge derivatives across electrical terminals.",
    viewLabel: "Verilog-A Terminal & Analog Branch Schematic",
    code: `\`include "disciplines.vams"

module nonlinear_diode_rc(anode, cathode);
  inout anode, cathode;
  electrical anode, cathode;

  parameter real Is = 1.0e-14 from (0:inf);
  parameter real Vt = 0.02585 from (0:inf);
  parameter real Rs = 12.5    from (0:inf);
  parameter real Cj = 2.4e-12 from [0:inf);

  analog begin
    I(anode, cathode) <+ Is * (limexp(V(anode, cathode) / Vt) - 1.0);
    I(anode, cathode) <+ V(anode, cathode) / Rs;
    I(anode, cathode) <+ Cj * ddt(V(anode, cathode));
  end
endmodule`,
  },

  ibis: {
    filename: "PciExpressGen5Tx.ibs",
    title: "IBIS 7.0 High-Speed SerDes Transceiver I/O Buffer",
    description:
      "Behavioral I/O buffer specification with RLC package parasitics, pull-up/pull-down I-V tables, and rising/falling V-T switching waveforms.",
    viewLabel: "IBIS I/O Buffer & Package Equivalent Circuit",
    code: `[IBIS Ver] 7.0
[File Name] pcie_gen5_tx.ibs
[File Rev] 1.2
[Component] PCIe5_SerDes_TX
[Manufacturer] ModelScript Silicon

[Package]
| variable   typ       min       max
R_pkg        95.0m     70.0m     125.0m
L_pkg        1.15n     0.85n     1.55n
C_pkg        0.42p     0.30p     0.58p

[Pin] signal_name   model_name    R_pin   L_pin   C_pin
A1    TX_DP0        SerDes_Diff   85m     1.1n    0.4p
A2    TX_DN0        SerDes_Diff   85m     1.1n    0.4p

[Model] SerDes_Diff
Model_type I/O
C_comp 0.65p 0.50p 0.85p
[Voltage Range] 0.85V 0.80V 0.90V`,
  },

  touchstone: {
    filename: "CavityBandpassFilter.s2p",
    title: "Touchstone 2-Port Microwave Cavity Bandpass Filter",
    description:
      "Frequency-domain S-parameter matrix ($S_{11}, S_{21}, S_{12}, S_{22}$) from 1.0 to 4.0 GHz referenced to $Z_0 = 50\\,\\Omega$.",
    viewLabel: "Touchstone RF S-Parameter Magnitude Response",
    code: `! 2-Port 2.45 GHz Microwave Bandpass Filter S-Parameters
# GHz S MA R 50
! Freq  |S11|  <S11    |S21|  <S21    |S12|  <S12    |S22|  <S22
1.00    0.94  -22.0    0.18   68.0    0.18   68.0    0.94  -22.0
1.80    0.78  -54.0    0.58   32.0    0.58   32.0    0.78  -54.0
2.20    0.24  -88.0    0.95   -4.0    0.95   -4.0    0.24  -88.0
2.45    0.06 -112.0    0.99  -28.0    0.99  -28.0    0.06 -112.0
2.70    0.28 -142.0    0.94  -56.0    0.94  -56.0    0.28 -142.0
3.20    0.82 -168.0    0.49  -92.0    0.49  -92.0    0.82 -168.0
4.00    0.95  172.0    0.14 -124.0    0.14 -124.0    0.95  172.0`,
  },

  urdf: {
    filename: "ArticulatedArm3Dof.urdf",
    title: "ROS URDF 3-DOF Articulated Industrial Robot Arm",
    description:
      "Robot kinematic chain with base pedestal, rotating waist turret, shoulder link, forearm link, inertial tensors, and revolute joint limits.",
    viewLabel: "URDF Kinematic Joint & Link Tree",
    code: `<?xml version="1.0"?>
<robot name="articulated_arm_3dof">
  <link name="base_pedestal" />
  <link name="waist_turret" />
  <link name="upper_arm" />
  <link name="forearm_wrist" />

  <joint name="j1_waist_yaw" type="revolute">
    <parent link="base_pedestal" />
    <child link="waist_turret" />
    <origin xyz="0 0 0.32" rpy="0 0 0" />
    <axis xyz="0 0 1" />
    <limit lower="-3.14" upper="3.14" effort="180" velocity="2.5" />
  </joint>

  <joint name="j2_shoulder_pitch" type="revolute">
    <parent link="waist_turret" />
    <child link="upper_arm" />
    <origin xyz="0 0 0.24" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-1.57" upper="1.57" effort="140" velocity="2.2" />
  </joint>

  <joint name="j3_elbow_pitch" type="revolute">
    <parent link="upper_arm" />
    <child link="forearm_wrist" />
    <origin xyz="0 0 0.55" rpy="0 0 0" />
    <axis xyz="0 1 0" />
    <limit lower="-2.20" upper="2.20" effort="95" velocity="3.0" />
  </joint>
</robot>`,
  },

  plcopen: {
    filename: "DuplexPumpStation.st",
    title: "IEC 61131-3 / PLCopen Duplex Booster Pump Control",
    description:
      "Structured Text PLC control program managing lead/lag pump staging, wet-well level hysteresis, and high-level alarm interlocks.",
    viewLabel: "PLCopen IEC 61131-3 Function Block & Logic Flow",
    code: `PROGRAM DuplexPumpStation
VAR_INPUT
  WetWellLevel_m : REAL := 2.4;
  HighSetpoint_m : REAL := 3.5;
  LagSetpoint_m  : REAL := 4.2;
  LowCutoff_m    : REAL := 1.2;
  Pump1Fault     : BOOL := FALSE;
END_VAR
VAR_OUTPUT
  LeadPumpRun    : BOOL := FALSE;
  LagPumpRun     : BOOL := FALSE;
  HighLevelAlarm : BOOL := FALSE;
END_VAR

IF WetWellLevel_m >= HighSetpoint_m AND NOT Pump1Fault THEN
  LeadPumpRun := TRUE;
ELSIF WetWellLevel_m <= LowCutoff_m THEN
  LeadPumpRun := FALSE;
  LagPumpRun  := FALSE;
END_IF;

IF WetWellLevel_m >= LagSetpoint_m OR (WetWellLevel_m >= HighSetpoint_m AND Pump1Fault) THEN
  LagPumpRun := TRUE;
END_IF;

HighLevelAlarm := WetWellLevel_m >= 4.8;
END_PROGRAM`,
  },

  adams: {
    filename: "SliderCrankMechanism.adm",
    title: "MSC Adams Slider-Crank & Suspension Multibody Dataset",
    description:
      "ADAMS/Solver dataset defining ground, crankshaft, connecting rod, and piston rigid bodies linked by revolute and translational joints.",
    viewLabel: "MSC Adams Multibody Kinematic Graph",
    code: `ADAMS/View Four-Body Slider-Crank Mechanism
PART/1, GROUND
PART/2, MASS = 3.8, CM = 20, IP = 0.045, 0.045, 0.082
PART/3, MASS = 1.9, CM = 30, IP = 0.022, 0.022, 0.038
PART/4, MASS = 2.4, CM = 40, IP = 0.015, 0.015, 0.015
MARKER/10, PART = 1, QP = 0.0, 0.0, 0.0
MARKER/20, PART = 2, QP = 0.0, 0.08, 0.0
MARKER/21, PART = 2, QP = 0.0, 0.16, 0.0
MARKER/30, PART = 3, QP = 0.0, 0.16, 0.0
MARKER/31, PART = 3, QP = 0.35, 0.0, 0.0
MARKER/40, PART = 4, QP = 0.35, 0.0, 0.0
JOINT/1, REVOLUTE, I = 10, J = 20
JOINT/2, REVOLUTE, I = 21, J = 30
JOINT/3, REVOLUTE, I = 31, J = 40
JOINT/4, TRANSLATIONAL, I = 40, J = 10
ACCGRAV/JGRAV = -9.80665
END`,
  },

  energyplus: {
    filename: "TwoZoneCommercialHvac.idf",
    title: "EnergyPlus Two-Zone Commercial Building & Ideal-Loads HVAC",
    description:
      "Building energy model specifying site geometry, South Perimeter and Core thermal zones, insulated envelope constructions, and HVAC thermostats.",
    viewLabel: "EnergyPlus Thermal Zone & HVAC Envelope Diagram",
    code: `Version, 24.1;

Building,
  TechCenterWing,
  0.0,
  Suburbs,
  0.04,
  0.4,
  FullInteriorAndExterior,
  25,
  6;

Zone,
  SouthPerimeterZone,
  0.0,
  0.0, 0.0, 0.0,
  1, 1, 3.6, 480.0;

Zone,
  CoreServerZone,
  0.0,
  0.0, 12.0, 0.0,
  1, 1, 3.6, 360.0;

ZoneHVAC:IdealLoadsAirSystem,
  SouthZoneIdealAir,
  ,
  SouthSupplyInlet,
  SouthExhaustOutlet,
  50.0,
  13.0;`,
  },

  epanet: {
    filename: "MunicipalBoostedWaterNet.inp",
    title: "EPANET Pressurized Municipal Water Network & Booster Station",
    description:
      "Looped water distribution network with an elevated source reservoir, three demand junctions, storage tank, and Hazen-Williams trunk mains.",
    viewLabel: "EPANET Pressurized Water Network Schematic",
    code: `[TITLE]
Municipal Looped Water Distribution Network

[JUNCTIONS]
;ID      Elev    Demand
J_North  118.0   22.0
J_South  114.0   28.0
J_East   108.0   35.0

[RESERVOIRS]
;ID      Head
R_Source 172.0

[TANKS]
;ID      Elevation InitLevel MinLevel MaxLevel Diameter
T_Tower  138.0     4.5       1.0      8.0      16.0

[PIPES]
;ID      Node1     Node2     Length  Diameter Roughness
P_Main1  R_Source  J_North   850.0   350.0    120.0
P_Main2  R_Source  J_South   920.0   300.0    120.0
P_Loop1  J_North   J_East    640.0   250.0    115.0
P_Loop2  J_South   J_East    580.0   250.0    115.0
P_Tank   J_North   T_Tower   320.0   250.0    120.0

[END]`,
  },

  swmm: {
    filename: "UrbanWatershedDetention.inp",
    title: "EPA SWMM Urban Stormwater Watershed & Detention Basin",
    description:
      "Hydrologic-hydraulic urban drainage deck with impervious subcatchments, manholes, gravity storm conduits, detention storage unit, and outfall.",
    viewLabel: "EPA SWMM Stormwater Network Schematic",
    code: `[TITLE]
Urban Stormwater Detention & Gravity Outfall Network

[SUBCATCHMENTS]
;;Name    RainGage  Outlet   Area   %Imperv  Width   Slope
S_North   RG1       J1       14.5   68.0     220.0   1.8
S_South   RG1       J2       19.2   54.0     260.0   1.4

[JUNCTIONS]
;;Name    Elevation  MaxDepth  InitDepth
J1        108.5      3.2       0.0
J2        104.2      3.5       0.0
J3        100.8      3.5       0.0

[OUTFALLS]
;;Name    Elevation  Type
OUT_River 96.5       FREE

[CONDUITS]
;;Name    FromNode   ToNode     Length   Roughness
C_Upper   J1         J2         210.0    0.013
C_Mid     J2         J3         185.0    0.013
C_Out     J3         OUT_River  160.0    0.013`,
  },

  aspen: {
    filename: "MethanolWaterColumn.bkp",
    title: "Aspen Plus Methanol-Water Pre-Heater, Flash & RadFrac Column",
    description:
      "Chemical process flowsheet mixing crude methanol feed with recycle, heating to bubble point, flashing vapor, and fractionating in a RadFrac column.",
    viewLabel: "Aspen Plus Process Flow Diagram (PFD)",
    code: `TITLE "Methanol-Water Binary Distillation & Flash Recovery"
COMPONENTS
  METHANOL CH4O /
  WATER H2O
FLOWSHEET
  BLOCK B_MIX   IN=CRUDE_FD RECYCLE  OUT=MIX_OUT
  BLOCK B_HEAT  IN=MIX_OUT           OUT=HOT_FEED
  BLOCK B_FLASH IN=HOT_FEED          OUT=VAP_TOP LIQ_BOT
  BLOCK B_COL   IN=LIQ_BOT           OUT=DISTILL BOTTOMS
BLOCK B_MIX MIXER
  PARAM PRES=1.20
BLOCK B_HEAT HEATER
  PARAM TEMP=76.5 PRES=1.15
BLOCK B_FLASH FLASH2
  PARAM TEMP=78.2 PRES=1.05
BLOCK B_COL RADFRAC
  PARAM NSTAGE=18 RR=2.4`,
  },

  sbml: {
    filename: "EnzymeFeedbackPathway.sbml",
    title: "SBML Level 3 Enzymatic Cascade & Allosteric Feedback",
    description:
      "Systems Biology Markup Language model defining cytosolic species (Glucose, G6P, Pyruvate, ATP) and reversible Michaelis-Menten reactions.",
    viewLabel: "SBML Biochemical Reaction Network",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<sbml xmlns="http://www.sbml.org/sbml/level3/version2/core" level="3" version="2">
  <model id="GlycolyticCascade" name="Glycolytic Pathway Cascade">
    <listOfCompartments>
      <compartment id="cytosol" name="Cytosol" size="1.0" constant="true" />
    </listOfCompartments>
    <listOfSpecies>
      <species id="GLC" name="Glucose" compartment="cytosol" initialConcentration="8.0" />
      <species id="G6P" name="Glucose-6-P" compartment="cytosol" initialConcentration="1.2" />
      <species id="FBP" name="Fructose-1,6-BP" compartment="cytosol" initialConcentration="0.6" />
      <species id="PYR" name="Pyruvate" compartment="cytosol" initialConcentration="0.4" />
    </listOfSpecies>
    <listOfReactions>
      <reaction id="R_HK" name="Hexokinase" reversible="false">
        <listOfReactants><speciesReference species="GLC" stoichiometry="1" /></listOfReactants>
        <listOfProducts><speciesReference species="G6P" stoichiometry="1" /></listOfProducts>
      </reaction>
      <reaction id="R_PFK" name="Phosphofructokinase" reversible="false">
        <listOfReactants><speciesReference species="G6P" stoichiometry="1" /></listOfReactants>
        <listOfProducts><speciesReference species="FBP" stoichiometry="1" /></listOfProducts>
      </reaction>
      <reaction id="R_PK" name="PyruvateKinase" reversible="false">
        <listOfReactants><speciesReference species="FBP" stoichiometry="1" /></listOfReactants>
        <listOfProducts><speciesReference species="PYR" stoichiometry="2" /></listOfProducts>
      </reaction>
    </listOfReactions>
  </model>
</sbml>`,
  },
};

// ── Custom Technical SVG Renderers for 3D / Continuum / Tabular Languages ──

function renderStepCadAndTreeSvg(code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";
  const cyan = isDark ? "#38bdf8" : "#0284c7";
  const emerald = "#10b981";
  const amber = "#f59e0b";

  // Extract actual PRODUCT names from the STEP code
  const products: { id: string; code: string; desc: string }[] = [];
  for (const m of code.matchAll(/#(\d+)\s*=\s*PRODUCT\(\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
    products.push({ id: `#${m[1]}`, code: m[2]!, desc: m[3]! });
  }
  const nauos: { name: string; desc: string }[] = [];
  for (const m of code.matchAll(/NEXT_ASSEMBLY_USAGE_OCCURRENCE\(\s*'([^']+)'\s*,\s*'([^']+)'\s*,\s*'([^']+)'/g)) {
    nauos.push({ name: m[1]!, desc: m[3]! });
  }

  const p0 = products[0] ?? { id: "#10", code: "BASE_FLANGE", desc: "Base Mounting Flange" };
  const p1 = products[1] ?? { id: "#20", code: "WRIST_YOKE", desc: "Articulated Wrist Yoke" };
  const p2 = products[2] ?? { id: "#30", code: "TOOL_ADAPTER", desc: "ISO 9409-1 Tool Adapter" };

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 320" width="760" height="320" style="background-color: ${bg};">
  <defs>
    <marker id="step-arrow" viewBox="0 0 10 10" refX="9" refY="5" markerWidth="6" markerHeight="6" orient="auto">
      <path d="M 0 1 L 10 5 L 0 9 z" fill="${cyan}"/>
    </marker>
  </defs>
  <rect x="0" y="0" width="760" height="320" fill="${bg}"/>

  <!-- Left Panel: 3D Isometric B-Rep & Coordinate Frame Projection -->
  <rect x="20" y="20" width="340" height="280" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="36" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">ISO 10303-21 AP242 B-REP ISOMETRIC</text>

  <!-- Isometric Grid -->
  <g stroke="${border}" stroke-width="0.7" opacity="0.55">
    <line x1="70" y1="230" x2="190" y2="275"/>
    <line x1="190" y1="275" x2="310" y2="230"/>
    <line x1="310" y1="230" x2="190" y2="185"/>
    <line x1="190" y1="185" x2="70" y2="230"/>
  </g>

  <!-- Base Flange Cylinder / Octagon -->
  <ellipse cx="190" cy="228" rx="68" ry="28" fill="${isDark ? "#172554" : "#e0f2fe"}" stroke="${cyan}" stroke-width="1.8"/>
  <path d="M 122 212 L 122 228 A 68 28 0 0 0 258 228 L 258 212 Z" fill="${isDark ? "#1e3a8a" : "#bae6fd"}" stroke="${cyan}" stroke-width="1.8"/>
  <ellipse cx="190" cy="212" rx="68" ry="28" fill="${isDark ? "#1e40af" : "#e0f2fe"}" stroke="${cyan}" stroke-width="1.8"/>

  <!-- Articulated Wrist Yoke -->
  <path d="M 155 205 L 155 135 L 172 125 L 172 195 Z" fill="${isDark ? "#064e3b" : "#d1fae5"}" stroke="${emerald}" stroke-width="1.8"/>
  <path d="M 208 195 L 208 125 L 225 135 L 225 205 Z" fill="${isDark ? "#064e3b" : "#d1fae5"}" stroke="${emerald}" stroke-width="1.8"/>
  <ellipse cx="190" cy="198" rx="38" ry="15" fill="${isDark ? "#065f46" : "#a7f3d0"}" stroke="${emerald}" stroke-width="1.8"/>

  <!-- Revolute Pitch Axis -->
  <line x1="125" y1="145" x2="255" y2="145" stroke="${amber}" stroke-width="1.8" stroke-dasharray="5 3"/>
  <text x="260" y="148" fill="${amber}" font-family="Inter, sans-serif" font-size="10" font-weight="600">ω_pitch</text>

  <!-- Tool Adapter -->
  <ellipse cx="190" cy="112" rx="34" ry="14" fill="${isDark ? "#3b0764" : "#f3e8ff"}" stroke="#a855f7" stroke-width="1.8"/>
  <ellipse cx="190" cy="96" rx="34" ry="14" fill="${isDark ? "#581c87" : "#e9d5ff"}" stroke="#a855f7" stroke-width="1.8"/>

  <!-- AXIS2_PLACEMENT_3D Triad -->
  <line x1="60" y1="265" x2="98" y2="280" stroke="#ef4444" stroke-width="2"/>
  <text x="102" y="284" fill="#ef4444" font-family="Inter, sans-serif" font-size="10" font-weight="700">X</text>
  <line x1="60" y1="265" x2="98" y2="250" stroke="#10b981" stroke-width="2"/>
  <text x="102" y="252" fill="#10b981" font-family="Inter, sans-serif" font-size="10" font-weight="700">Y</text>
  <line x1="60" y1="265" x2="60" y2="225" stroke="#38bdf8" stroke-width="2"/>
  <text x="56" y="218" fill="#38bdf8" font-family="Inter, sans-serif" font-size="10" font-weight="700">Z</text>

  <!-- Right Panel: Assembly Hierarchy & AP242 PMI Tree -->
  <rect x="380" y="20" width="360" height="280" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="398" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">ASSEMBLY TREE &amp; GD&amp;T PMI</text>

  <!-- Part 1 -->
  <rect x="405" y="62" width="210" height="52" rx="7" fill="${bg}" stroke="${cyan}" stroke-width="1.6"/>
  <text x="418" y="80" fill="${cyan}" font-family="Inter, sans-serif" font-size="9.5" font-weight="600">«PRODUCT_DEFINITION» ${escapeXml(p0.id)}</text>
  <text x="418" y="98" fill="${text}" font-family="Inter, sans-serif" font-size="12" font-weight="600">${escapeXml(p0.code)}</text>

  <!-- PMI Callout -->
  <rect x="632" y="66" width="92" height="44" rx="6" fill="${bg}" stroke="${amber}" stroke-width="1.4" stroke-dasharray="4 2"/>
  <text x="678" y="84" text-anchor="middle" fill="${amber}" font-family="Inter, sans-serif" font-size="9.5" font-weight="700">⏥ 0.02 mm</text>
  <text x="678" y="100" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="9">FLATNESS #60</text>
  <line x1="615" y1="88" x2="632" y2="88" stroke="${amber}" stroke-width="1.4"/>

  <!-- Edge 1 -> 2 -->
  <line x1="510" y1="114" x2="510" y2="146" stroke="${cyan}" stroke-width="1.6" marker-end="url(#step-arrow)"/>
  <text x="520" y="134" fill="${muted}" font-family="Inter, sans-serif" font-size="10">${escapeXml(nauos[0]?.name ?? "NAUO_1")} (${escapeXml(nauos[0]?.desc ?? "Pitch Joint")})</text>

  <!-- Part 2 -->
  <rect x="405" y="148" width="210" height="52" rx="7" fill="${bg}" stroke="${emerald}" stroke-width="1.6"/>
  <text x="418" y="166" fill="${emerald}" font-family="Inter, sans-serif" font-size="9.5" font-weight="600">«PRODUCT_DEFINITION» ${escapeXml(p1.id)}</text>
  <text x="418" y="184" fill="${text}" font-family="Inter, sans-serif" font-size="12" font-weight="600">${escapeXml(p1.code)}</text>

  <!-- Edge 2 -> 3 -->
  <line x1="510" y1="200" x2="510" y2="232" stroke="${cyan}" stroke-width="1.6" marker-end="url(#step-arrow)"/>
  <text x="520" y="220" fill="${muted}" font-family="Inter, sans-serif" font-size="10">${escapeXml(nauos[1]?.name ?? "NAUO_2")} (${escapeXml(nauos[1]?.desc ?? "Roll Joint")})</text>

  <!-- Part 3 -->
  <rect x="405" y="234" width="210" height="52" rx="7" fill="${bg}" stroke="#a855f7" stroke-width="1.6"/>
  <text x="418" y="252" fill="#a855f7" font-family="Inter, sans-serif" font-size="9.5" font-weight="600">«PRODUCT_DEFINITION» ${escapeXml(p2.id)}</text>
  <text x="418" y="270" fill="${text}" font-family="Inter, sans-serif" font-size="12" font-weight="600">${escapeXml(p2.code)}</text>
</svg>`;
}

function renderScadCsgSvg(_code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";
  const cyan = isDark ? "#38bdf8" : "#0284c7";
  const emerald = "#10b981";
  const rose = "#f43f5e";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 310" width="760" height="310" style="background-color: ${bg};">
  <rect x="0" y="0" width="760" height="310" fill="${bg}"/>

  <!-- Left Panel: 3D Isometric CSG Shaded Preview -->
  <rect x="20" y="20" width="350" height="270" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="36" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">3D CONSTRUCTIVE SOLID GEOMETRY</text>

  <!-- Isometric Base Plate Cube([80, 50, 10]) -->
  <polygon points="195,145 310,190 195,235 80,190" fill="${isDark ? "#1e3a8a" : "#bae6fd"}" stroke="${cyan}" stroke-width="1.8"/>
  <polygon points="80,190 195,235 195,258 80,213" fill="${isDark ? "#172554" : "#7dd3fc"}" stroke="${cyan}" stroke-width="1.8"/>
  <polygon points="310,190 195,235 195,258 310,213" fill="${isDark ? "#1e40af" : "#38bdf8"}" stroke="${cyan}" stroke-width="1.8"/>

  <!-- Four Subtracted Bolt Holes -->
  <ellipse cx="122" cy="190" rx="9" ry="4.5" fill="${bg}" stroke="${rose}" stroke-width="1.4"/>
  <ellipse cx="268" cy="190" rx="9" ry="4.5" fill="${bg}" stroke="${rose}" stroke-width="1.4"/>
  <ellipse cx="195" cy="162" rx="9" ry="4.5" fill="${bg}" stroke="${rose}" stroke-width="1.4"/>
  <ellipse cx="195" cy="218" rx="9" ry="4.5" fill="${bg}" stroke="${rose}" stroke-width="1.4"/>

  <!-- Central Bearing Boss Cylinder(h=32, r=22) -->
  <path d="M 151 112 L 151 186 A 44 20 0 0 0 239 186 L 239 112 Z" fill="${isDark ? "#065f46" : "#a7f3d0"}" stroke="${emerald}" stroke-width="1.8"/>
  <ellipse cx="195" cy="112" rx="44" ry="20" fill="${isDark ? "#047857" : "#6ee7b7"}" stroke="${emerald}" stroke-width="1.8"/>

  <!-- Subtracted Shaft Through-Bore Cylinder(r=12) -->
  <ellipse cx="195" cy="112" rx="24" ry="11" fill="${bg}" stroke="${rose}" stroke-width="1.8"/>

  <!-- Parametric Dimension Callouts -->
  <text x="275" y="108" fill="${emerald}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">r_boss = 22 mm</text>
  <text x="275" y="124" fill="${rose}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">r_bore = 12 mm</text>
  <text x="256" y="252" fill="${cyan}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">80 × 50 × 10 mm</text>

  <!-- Right Panel: CSG Boolean Expression Tree -->
  <rect x="390" y="20" width="350" height="270" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="408" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">CSG BOOLEAN EVALUATION DAG</text>

  <!-- Root: difference() -->
  <rect x="505" y="60" width="120" height="38" rx="8" fill="${bg}" stroke="${rose}" stroke-width="1.8"/>
  <text x="565" y="83" text-anchor="middle" fill="${text}" font-family="Inter, sans-serif" font-size="12" font-weight="700">difference() (−)</text>

  <!-- Edges from difference() -->
  <line x1="535" y1="98" x2="475" y2="140" stroke="${emerald}" stroke-width="1.6"/>
  <line x1="595" y1="98" x2="650" y2="140" stroke="${rose}" stroke-width="1.6" stroke-dasharray="4 2"/>

  <!-- Child 1: union() -->
  <rect x="415" y="140" width="120" height="38" rx="8" fill="${bg}" stroke="${emerald}" stroke-width="1.8"/>
  <text x="475" y="163" text-anchor="middle" fill="${text}" font-family="Inter, sans-serif" font-size="12" font-weight="700">union() (∪)</text>

  <!-- Child 2: Negative Cutters -->
  <rect x="580" y="140" width="140" height="58" rx="8" fill="${bg}" stroke="${rose}" stroke-width="1.6"/>
  <text x="650" y="162" text-anchor="middle" fill="${rose}" font-family="Inter, sans-serif" font-size="10.5" font-weight="700">− Cut Cylinders</text>
  <text x="650" y="178" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="10">shaft bore (r=12)</text>
  <text x="650" y="191" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="10">4× M8 bolts (r=4.2)</text>

  <!-- Leaves of union() -->
  <line x1="450" y1="178" x2="435" y2="222" stroke="${cyan}" stroke-width="1.5"/>
  <line x1="500" y1="178" x2="535" y2="222" stroke="${emerald}" stroke-width="1.5"/>

  <rect x="398" y="222" width="102" height="46" rx="6" fill="${bg}" stroke="${cyan}" stroke-width="1.5"/>
  <text x="449" y="242" text-anchor="middle" fill="${cyan}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">cube([80,50,10])</text>
  <text x="449" y="258" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="9.5">Base Flange</text>

  <rect x="510" y="222" width="112" height="46" rx="6" fill="${bg}" stroke="${emerald}" stroke-width="1.5"/>
  <text x="566" y="242" text-anchor="middle" fill="${emerald}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">cylinder(32, 22)</text>
  <text x="566" y="258" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="9.5">Bearing Boss</text>
</svg>`;
}

function renderCfdAirfoilSvg(_code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";
  const cyan = isDark ? "#38bdf8" : "#0284c7";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 300" width="760" height="300" style="background-color: ${bg};">
  <defs>
    <radialGradient id="cfd-supersonic" cx="46%" cy="38%" r="48%">
      <stop offset="0%" stop-color="#ef4444" stop-opacity="0.75"/>
      <stop offset="45%" stop-color="#f59e0b" stop-opacity="0.45"/>
      <stop offset="80%" stop-color="#06b6d4" stop-opacity="0.22"/>
      <stop offset="100%" stop-color="#0ea5e9" stop-opacity="0"/>
    </radialGradient>
  </defs>
  <rect x="0" y="0" width="760" height="300" fill="${bg}"/>
  <rect x="20" y="20" width="520" height="260" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="36" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">NACA 0012 TRANSONIC MACH FIELD &amp; UNSTRUCTURED O-GRID (M = 0.80, α = 1.25°)</text>

  <!-- Supersonic pocket & shock wave -->
  <ellipse cx="265" cy="118" rx="125" ry="56" fill="url(#cfd-supersonic)"/>
  <!-- Normal shock line on upper surface -->
  <line x1="312" y1="68" x2="312" y2="144" stroke="#ef4444" stroke-width="2.2" stroke-dasharray="4 2"/>
  <text x="320" y="82" fill="#ef4444" font-family="Inter, sans-serif" font-size="10.5" font-weight="700">Shock (M = 1.32 → 0.78)</text>

  <!-- Unstructured mesh rings -->
  <g stroke="${cyan}" stroke-width="0.6" opacity="0.35" fill="none">
    <ellipse cx="280" cy="155" rx="165" ry="52"/>
    <ellipse cx="280" cy="155" rx="215" ry="82"/>
    <line x1="145" y1="155" x2="65" y2="155"/>
    <line x1="200" y1="138" x2="140" y2="80"/>
    <line x1="280" y1="135" x2="280" y2="65"/>
    <line x1="360" y1="142" x2="415" y2="82"/>
    <line x1="200" y1="172" x2="140" y2="230"/>
    <line x1="280" y1="174" x2="280" y2="242"/>
    <line x1="360" y1="168" x2="415" y2="228"/>
  </g>

  <!-- Streamlines -->
  <path d="M 45 115 Q 250 75 510 112" fill="none" stroke="${cyan}" stroke-width="1.4" opacity="0.8"/>
  <path d="M 45 140 Q 230 105 510 142" fill="none" stroke="#f59e0b" stroke-width="1.6"/>
  <path d="M 45 175 Q 245 198 510 174" fill="none" stroke="${cyan}" stroke-width="1.4" opacity="0.8"/>
  <path d="M 45 202 Q 260 220 510 202" fill="none" stroke="#10b981" stroke-width="1.3" opacity="0.75"/>

  <!-- NACA 0012 Airfoil Wall Boundary -->
  <path d="M 145 156 C 175 126, 265 130, 420 156 C 265 178, 175 182, 145 156 Z" fill="${bg}" stroke="${text}" stroke-width="2.2"/>
  <text x="268" y="160" text-anchor="middle" fill="${text}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">MARKER_EULER (airfoil)</text>

  <!-- Right Panel: Solver Metrics & Aerodynamic Coefficients -->
  <rect x="556" y="20" width="184" height="260" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="572" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">SU2 SOLVER DECK</text>

  <text x="572" y="74" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Freestream Mach</text>
  <text x="724" y="74" text-anchor="end" fill="${cyan}" font-family="Inter, sans-serif" font-size="12" font-weight="700">0.80</text>

  <text x="572" y="102" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Angle of Attack α</text>
  <text x="724" y="102" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="12" font-weight="700">1.25°</text>

  <text x="572" y="130" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Convective Flux</text>
  <text x="724" y="130" text-anchor="end" fill="#10b981" font-family="Inter, sans-serif" font-size="11.5" font-weight="600">ROE Upwind</text>

  <line x1="572" y1="148" x2="724" y2="148" stroke="${border}" stroke-width="1"/>

  <text x="572" y="174" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Lift Coeff (C_L)</text>
  <text x="724" y="174" text-anchor="end" fill="#10b981" font-family="Inter, sans-serif" font-size="12" font-weight="700">0.348</text>

  <text x="572" y="202" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Drag Coeff (C_D)</text>
  <text x="724" y="202" text-anchor="end" fill="#f59e0b" font-family="Inter, sans-serif" font-size="12" font-weight="700">0.0224</text>

  <text x="572" y="230" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Peak Local Mach</text>
  <text x="724" y="230" text-anchor="end" fill="#ef4444" font-family="Inter, sans-serif" font-size="12" font-weight="700">1.32</text>
</svg>`;
}

function renderFeaCantileverSvg(_code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 290" width="760" height="290" style="background-color: ${bg};">
  <defs>
    <linearGradient id="fea-von-mises" x1="0%" y1="0%" x2="100%" y2="0%">
      <stop offset="0%" stop-color="#ef4444"/>
      <stop offset="28%" stop-color="#f59e0b"/>
      <stop offset="60%" stop-color="#10b981"/>
      <stop offset="100%" stop-color="#3b82f6"/>
    </linearGradient>
  </defs>
  <rect x="0" y="0" width="760" height="290" fill="${bg}"/>
  <rect x="20" y="20" width="510" height="250" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="36" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">C3D8 FINITE-ELEMENT CANTILEVER DEFORMATION &amp; VON MISES STRESS</text>

  <!-- Fixed Wall Boundary Support (*BOUNDARY nodes 1,4,5,8) -->
  <rect x="68" y="68" width="16" height="150" fill="${border}"/>
  <line x1="84" y1="68" x2="84" y2="218" stroke="${text}" stroke-width="2.2"/>
  <text x="58" y="236" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600">*BOUNDARY (U1=U2=U3=0)</text>

  <!-- Undeformed Reference Mesh (dashed) -->
  <rect x="84" y="96" width="340" height="58" fill="none" stroke="${muted}" stroke-width="1.2" stroke-dasharray="5 4"/>

  <!-- Deformed Beam with Von Mises Stress Gradient & Element Subdivisions -->
  <path d="M 84 96 Q 250 104 422 138 L 418 196 Q 250 162 84 154 Z" fill="url(#fea-von-mises)" opacity="0.88" stroke="${text}" stroke-width="1.8"/>
  <!-- Hexahedral Element Grid Lines -->
  <line x1="152" y1="98" x2="150" y2="156" stroke="${bg}" stroke-width="1.2" opacity="0.7"/>
  <line x1="220" y1="103" x2="218" y2="161" stroke="${bg}" stroke-width="1.2" opacity="0.7"/>
  <line x1="288" y1="112" x2="285" y2="170" stroke="${bg}" stroke-width="1.2" opacity="0.7"/>
  <line x1="355" y1="124" x2="352" y2="182" stroke="${bg}" stroke-width="1.2" opacity="0.7"/>

  <!-- Tip Concentrated Loads (*CLOAD nodes 2, 6: -2250 N each) -->
  <line x1="422" y1="82" x2="422" y2="132" stroke="#ef4444" stroke-width="2.5"/>
  <polygon points="416,128 428,128 422,138" fill="#ef4444"/>
  <text x="434" y="106" fill="#ef4444" font-family="Inter, sans-serif" font-size="11" font-weight="700">*CLOAD F_z = −4.5 kN</text>
  <text x="434" y="182" fill="#38bdf8" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">u_z,max = −1.84 mm</text>

  <!-- Legend Bar -->
  <rect x="110" y="232" width="240" height="10" rx="4" fill="url(#fea-von-mises)"/>
  <text x="110" y="256" fill="#ef4444" font-family="Inter, sans-serif" font-size="9.5" font-weight="600">σ_max = 312 MPa (Root)</text>
  <text x="350" y="256" text-anchor="end" fill="#3b82f6" font-family="Inter, sans-serif" font-size="9.5" font-weight="600">12 MPa (Tip)</text>

  <!-- Right Panel: Material & Step Summary -->
  <rect x="546" y="20" width="194" height="250" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="562" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">MATERIAL &amp; SAFETY</text>

  <text x="562" y="74" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Alloy</text>
  <text x="724" y="74" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">Ti-6Al-4V</text>

  <text x="562" y="102" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Young's Modulus E</text>
  <text x="724" y="102" text-anchor="end" fill="#38bdf8" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">114.0 GPa</text>

  <text x="562" y="130" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Poisson Ratio ν</text>
  <text x="724" y="130" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">0.34</text>

  <line x1="562" y1="148" x2="724" y2="148" stroke="${border}" stroke-width="1"/>

  <text x="562" y="176" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Peak Von Mises</text>
  <text x="724" y="176" text-anchor="end" fill="#f59e0b" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">312.4 MPa</text>

  <text x="562" y="204" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Yield Strength σ_y</text>
  <text x="724" y="204" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="11.5" font-weight="600">880.0 MPa</text>

  <text x="562" y="232" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Safety Factor (FoS)</text>
  <text x="724" y="232" text-anchor="end" fill="#10b981" font-family="Inter, sans-serif" font-size="12" font-weight="700">2.82 (PASS)</text>
</svg>`;
}

function renderCsvTelemetrySvg(code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";

  const rows = code
    .trim()
    .split("\n")
    .slice(1)
    .map((line) => line.split(",").map((v) => Number(v.trim())));

  const x0 = 64;
  const x1 = 696;
  const y0 = 56;
  const y1 = 236;
  const w = x1 - x0;
  const h = y1 - y0;

  const toX = (t: number) => x0 + (t / 60.0) * w;
  const toYVolt = (v: number) => y1 - ((v - 750.0) / 60.0) * h;
  const toYCurr = (c: number) => y1 - ((c + 100.0) / 400.0) * h;
  const toYTemp = (temp: number) => y1 - ((temp - 20.0) / 15.0) * h;

  const vPts = rows.map((r) => `${toX(r[0]!).toFixed(1)},${toYVolt(r[1]!).toFixed(1)}`).join(" ");
  const iPts = rows.map((r) => `${toX(r[0]!).toFixed(1)},${toYCurr(r[2]!).toFixed(1)}`).join(" ");
  const tPts = rows.map((r) => `${toX(r[0]!).toFixed(1)},${toYTemp(r[4]!).toFixed(1)}`).join(" ");

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 290" width="760" height="290" style="background-color: ${bg};">
  <rect x="0" y="0" width="760" height="290" fill="${bg}"/>
  <rect x="20" y="18" width="720" height="254" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="42" y="42" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">MULTI-CHANNEL SENSOR TELEMETRY (pack_voltage [V], current [A], temp [°C])</text>

  <!-- Legend -->
  <circle cx="445" cy="38" r="4.5" fill="#38bdf8"/>
  <text x="455" y="42" fill="${text}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">voltage_v (765–798 V)</text>
  <circle cx="585" cy="38" r="4.5" fill="#f59e0b"/>
  <text x="595" y="42" fill="${text}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">current_a</text>
  <circle cx="668" cy="38" r="4.5" fill="#10b981"/>
  <text x="678" y="42" fill="${text}" font-family="Inter, sans-serif" font-size="10.5" font-weight="600">temp_c</text>

  <!-- Grid -->
  <g stroke="${border}" stroke-width="0.8" stroke-dasharray="3 3">
    <line x1="${x0}" y1="${y0}" x2="${x1}" y2="${y0}"/>
    <line x1="${x0}" y1="${y0 + h / 3}" x2="${x1}" y2="${y0 + h / 3}"/>
    <line x1="${x0}" y1="${y0 + (2 * h) / 3}" x2="${x1}" y2="${y0 + (2 * h) / 3}"/>
    <line x1="${x0}" y1="${y1}" x2="${x1}" y2="${y1}"/>
  </g>

  <!-- Traces -->
  <polyline fill="none" stroke="#38bdf8" stroke-width="2.5" points="${vPts}"/>
  <polyline fill="none" stroke="#f59e0b" stroke-width="2.2" stroke-dasharray="6 3" points="${iPts}"/>
  <polyline fill="none" stroke="#10b981" stroke-width="2.2" points="${tPts}"/>

  ${rows
    .map(
      (r) =>
        `<circle cx="${toX(r[0]!).toFixed(1)}" cy="${toYVolt(r[1]!).toFixed(1)}" r="3.5" fill="#38bdf8"/>` +
        `<circle cx="${toX(r[0]!).toFixed(1)}" cy="${toYCurr(r[2]!).toFixed(1)}" r="3.5" fill="#f59e0b"/>` +
        `<circle cx="${toX(r[0]!).toFixed(1)}" cy="${toYTemp(r[4]!).toFixed(1)}" r="3.5" fill="#10b981"/>`,
    )
    .join("\n  ")}

  <!-- X-axis labels -->
  <text x="${x0}" y="256" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="10">0 s</text>
  <text x="${toX(20)}" y="256" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="10">20 s</text>
  <text x="${toX(40)}" y="256" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="10">40 s</text>
  <text x="${x1}" y="256" text-anchor="middle" fill="${muted}" font-family="Inter, sans-serif" font-size="10">60 s</text>
</svg>`;
}

function renderCcsdsOrbitSvg(_code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";
  const cyan = isDark ? "#38bdf8" : "#0284c7";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 290" width="760" height="290" style="background-color: ${bg};">
  <rect x="0" y="0" width="760" height="290" fill="${bg}"/>
  <rect x="20" y="20" width="430" height="250" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="36" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">CCSDS OEM 2.0 EME2000 ORBITAL TRAJECTORY (SENTINEL_EO_1)</text>

  <!-- Earth & Equatorial Plane -->
  <circle cx="225" cy="155" r="56" fill="${isDark ? "#1e3a8a" : "#bae6fd"}" stroke="${cyan}" stroke-width="1.8"/>
  <ellipse cx="225" cy="155" rx="56" ry="18" fill="none" stroke="${cyan}" stroke-width="1" stroke-dasharray="3 3"/>
  <text x="225" y="159" text-anchor="middle" fill="${text}" font-family="Inter, sans-serif" font-size="11" font-weight="700">EARTH</text>

  <!-- Inclined Sun-Synchronous LEO Orbit Arc -->
  <ellipse cx="225" cy="155" rx="135" ry="74" transform="rotate(-28 225 155)" fill="none" stroke="#10b981" stroke-width="2.2" stroke-dasharray="6 3"/>

  <!-- Ephemeris State Epochs -->
  <circle cx="344" cy="92" r="5" fill="#f59e0b"/>
  <text x="354" y="95" fill="#f59e0b" font-family="Inter, sans-serif" font-size="10" font-weight="600">T+00:00 (r = 7016 km)</text>

  <circle cx="268" cy="76" r="5" fill="${cyan}"/>
  <text x="255" y="64" text-anchor="middle" fill="${cyan}" font-family="Inter, sans-serif" font-size="10" font-weight="600">T+00:05</text>

  <circle cx="172" cy="96" r="5.5" fill="#10b981"/>
  <line x1="172" y1="96" x2="122" y2="124" stroke="#ef4444" stroke-width="2"/>
  <text x="86" y="138" fill="#ef4444" font-family="Inter, sans-serif" font-size="10" font-weight="700">v = 7.59 km/s</text>

  <!-- Right Panel: OEM Metadata & State Invariants -->
  <rect x="466" y="20" width="274" height="250" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="484" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">OEM EPHEMERIS TELEMETRY</text>

  <text x="484" y="74" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Object ID</text>
  <text x="722" y="74" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">2026-042A</text>

  <text x="484" y="102" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Reference Frame</text>
  <text x="722" y="102" text-anchor="end" fill="${cyan}" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">EME2000 (UTC)</text>

  <text x="484" y="130" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Semi-Major Axis a</text>
  <text x="722" y="130" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">7016.0 km</text>

  <text x="484" y="158" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Altitude (h_LEO)</text>
  <text x="722" y="158" text-anchor="end" fill="#10b981" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">638.0 km</text>

  <text x="484" y="186" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Inclination i</text>
  <text x="722" y="186" text-anchor="end" fill="#f59e0b" font-family="Inter, sans-serif" font-size="11.5" font-weight="700">97.95° (SSO)</text>

  <text x="484" y="214" fill="${muted}" font-family="Inter, sans-serif" font-size="10.5">Specific Energy ε</text>
  <text x="722" y="214" text-anchor="end" fill="${text}" font-family="Inter, sans-serif" font-size="11.5" font-weight="600">−28.41 km²/s²</text>
</svg>`;
}

// ── Per-Language SVG Compiler Dispatch ─────────────────────────────────────

async function renderExampleSvgs(slug: string, code: string): Promise<{ svgDark: string; svgLight: string }> {
  switch (slug) {
    case "modelscript": {
      const data = {
        nodes: [
          makeNode({
            id: "ref",
            label: "Step Reference",
            stereotype: "source",
            x: 40,
            y: 85,
            width: 155,
            height: 76,
            stroke: "#8b5cf6",
            sections: [{ header: "parameters", entries: ["theta_ref = 1.5708 rad"] }],
            ports: [{ id: "out", x: 155, y: 38, direction: "out" }],
          }),
          makeNode({
            id: "pd",
            label: "PD Controller",
            stereotype: "control",
            x: 245,
            y: 75,
            width: 170,
            height: 92,
            stroke: "#06b6d4",
            sections: [{ header: "gains", entries: ["K_p = 48.0 V/rad", "K_d = 6.5 V·s/rad"] }],
            ports: [
              { id: "in", x: 0, y: 46, direction: "in" },
              { id: "out", x: 170, y: 46, direction: "out" },
            ],
          }),
          makeNode({
            id: "motor",
            label: "PM DC Armature",
            stereotype: "electrical",
            x: 465,
            y: 75,
            width: 170,
            height: 92,
            stroke: "#38bdf8",
            sections: [{ header: "parameters", entries: ["R_a = 1.25 Ω", "K_t = 0.82 N·m/A"] }],
            ports: [
              { id: "v_in", x: 0, y: 46, direction: "in" },
              { id: "tau", x: 170, y: 46, direction: "out" },
            ],
          }),
          makeNode({
            id: "load",
            label: "Inertial Shaft Load",
            stereotype: "mechanics",
            x: 685,
            y: 75,
            width: 170,
            height: 92,
            stroke: "#10b981",
            sections: [{ header: "states", entries: ["J_load = 0.045 kg·m²", "theta, omega"] }],
            ports: [
              { id: "in", x: 0, y: 46, direction: "in" },
              { id: "fb", x: 85, y: 92, direction: "out" },
            ],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "ref",
            sourcePort: "out",
            target: "pd",
            targetPort: "in",
            label: "theta_ref",
            stroke: "#8b5cf6",
          }),
          makeEdge({
            id: "e2",
            source: "pd",
            sourcePort: "out",
            target: "motor",
            targetPort: "v_in",
            label: "v_cmd [V]",
            stroke: "#06b6d4",
          }),
          makeEdge({
            id: "e3",
            source: "motor",
            sourcePort: "tau",
            target: "load",
            targetPort: "in",
            label: "K_t·i_a [N·m]",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e4",
            source: "load",
            sourcePort: "fb",
            target: "pd",
            targetPort: "in",
            label: "theta, omega",
            stroke: "#10b981",
            dash: "5 3",
            vertices: [
              { x: 770, y: 210 },
              { x: 220, y: 210 },
              { x: 220, y: 121 },
            ],
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "modelica": {
      const data = {
        nodes: [
          makeNode({
            id: "L1",
            label: "Inductor L",
            stereotype: "Inductor",
            x: 50,
            y: 80,
            width: 155,
            height: 82,
            stroke: "#38bdf8",
            sections: [{ header: "parameters", entries: ["L = 18.0 H", "iL(start = 0.0 A)"] }],
            ports: [
              { id: "p", x: 155, y: 28, direction: "inout" },
              { id: "n", x: 155, y: 58, direction: "inout" },
            ],
          }),
          makeNode({
            id: "C2",
            label: "Capacitor C2",
            stereotype: "Capacitor",
            x: 255,
            y: 80,
            width: 155,
            height: 82,
            stroke: "#06b6d4",
            sections: [{ header: "parameters", entries: ["C2 = 100.0 F", "v2(start = 0.0 V)"] }],
            ports: [
              { id: "p", x: 0, y: 28, direction: "inout" },
              { id: "n", x: 155, y: 28, direction: "inout" },
            ],
          }),
          makeNode({
            id: "G1",
            label: "Conductance G",
            stereotype: "Conductor",
            x: 460,
            y: 40,
            width: 155,
            height: 76,
            stroke: "#f59e0b",
            sections: [{ header: "parameters", entries: ["G = 0.7 S"] }],
            ports: [
              { id: "p", x: 0, y: 38, direction: "inout" },
              { id: "n", x: 155, y: 38, direction: "inout" },
            ],
          }),
          makeNode({
            id: "C1",
            label: "Capacitor C1",
            stereotype: "Capacitor",
            x: 665,
            y: 40,
            width: 160,
            height: 82,
            stroke: "#10b981",
            sections: [{ header: "parameters", entries: ["C1 = 10.0 F", "v1(start = 0.15 V)"] }],
            ports: [
              { id: "p", x: 0, y: 38, direction: "inout" },
              { id: "n", x: 80, y: 82, direction: "inout" },
            ],
          }),
          makeNode({
            id: "NR",
            label: "ChuaDiode NR",
            stereotype: "NonlinearResistor",
            x: 665,
            y: 165,
            width: 160,
            height: 82,
            stroke: "#ec4899",
            sections: [{ header: "parameters", entries: ["Ga = -0.758 S", "Gb = -0.409 S"] }],
            ports: [{ id: "p", x: 80, y: 0, direction: "inout" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "L1",
            sourcePort: "p",
            target: "C2",
            targetPort: "p",
            label: "iL",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e2",
            source: "C2",
            sourcePort: "n",
            target: "G1",
            targetPort: "p",
            label: "v2",
            stroke: "#06b6d4",
          }),
          makeEdge({
            id: "e3",
            source: "G1",
            sourcePort: "n",
            target: "C1",
            targetPort: "p",
            label: "G(v2-v1)",
            stroke: "#f59e0b",
          }),
          makeEdge({
            id: "e4",
            source: "C1",
            sourcePort: "n",
            target: "NR",
            targetPort: "p",
            label: "i_nl(v1)",
            stroke: "#ec4899",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "sysml2": {
      const { createWasmParser } = await import("@modelscript/dsl/bindings");
      const { FIELD_NAMES, SYNTAX_NAMES } = await import("@modelscript/sysml2/parser");
      const { buildSysML2DiagramData, createSysML2WorkspaceIndex } = await import("@modelscript/sysml2/factory");
      const sysmlWasmPath = require.resolve("@modelscript/sysml2/parser.wasm");
      const { parser } = await createWasmParser(sysmlWasmPath, { SYNTAX_NAMES, FIELD_NAMES } as unknown as Parameters<
        typeof createWasmParser
      >[1]);
      const wsIndex = createSysML2WorkspaceIndex();
      const targetUri = "file:///ElectricPowertrain.sysml";
      wsIndex.register(targetUri, () => {
        const tree = parser.parse(code);
        return tree ? tree.rootNode : null;
      });
      const unified = wsIndex.toUnified();
      const data = buildSysML2DiagramData(
        unified as unknown as Parameters<typeof buildSysML2DiagramData>[0],
        targetUri,
        undefined,
        "BDD",
      );
      return renderBothThemesFromDiagramData(data as unknown as DiagramData);
    }

    case "reqif": {
      const { parseReqIf } = await import("@modelscript/reqif");
      const doc = parseReqIf(code);
      const objs = Array.from(doc.specObjects.values());
      const nodes: DiagramNode[] = objs.map((obj, idx) =>
        makeNode({
          id: obj.identifier,
          label: obj.longName || obj.identifier,
          stereotype: "requirement",
          x: idx === 0 ? 240 : idx === 1 ? 60 : 420,
          y: idx === 0 ? 35 : 175,
          width: 240,
          height: 86,
          stroke: idx === 0 ? "#8b5cf6" : "#06b6d4",
          sections: [
            {
              header: obj.identifier,
              entries: [String(obj.text || "Safety Requirement").slice(0, 38) + "…"],
            },
          ],
          ports: [
            { id: "top", x: 120, y: 0, direction: "out" },
            { id: "bot", x: 120, y: 86, direction: "in" },
          ],
        }),
      );
      const edges: DiagramEdge[] = doc.specRelations.map((rel) =>
        makeEdge({
          id: rel.identifier,
          source: rel.sourceId,
          sourcePort: "top",
          target: rel.targetId,
          targetPort: "bot",
          label: "«deriveReqt»",
          stroke: "#8b5cf6",
          dash: "6 3",
        }),
      );
      return renderBothThemesFromDiagramData({ nodes, edges });
    }

    case "ssp": {
      const { buildSspDiagramData } = await import("@modelscript/ssp/diagram");
      const data = buildSspDiagramData(code);
      return renderBothThemesFromDiagramData(data as unknown as DiagramData);
    }

    case "owl2": {
      const { createWasmParser } = await import("@modelscript/dsl/bindings");
      const { FIELD_NAMES, SYNTAX_NAMES } = await import("@modelscript/owl2/parser");
      const { buildOWL2DiagramData, lowerCstToAxioms } = await import("@modelscript/owl2");
      const owl2WasmPath = require.resolve("@modelscript/owl2/parser.wasm");
      const { parser } = await createWasmParser(owl2WasmPath, { SYNTAX_NAMES, FIELD_NAMES } as unknown as Parameters<
        typeof createWasmParser
      >[1]);
      const tree = parser.parse(code);
      const axioms = tree
        ? lowerCstToAxioms(tree.rootNode as unknown as Parameters<typeof lowerCstToAxioms>[0], code)
        : [];
      const buildOwl = buildOWL2DiagramData as unknown as (ax: unknown, root: undefined, view: string) => DiagramData;
      const data = buildOwl(axioms, undefined, "All");
      return renderBothThemesFromDiagramData(data);
    }

    case "step":
      return {
        svgDark: renderStepCadAndTreeSvg(code, "dark"),
        svgLight: renderStepCadAndTreeSvg(code, "light"),
      };

    case "scad":
      return {
        svgDark: renderScadCsgSvg(code, "dark"),
        svgLight: renderScadCsgSvg(code, "light"),
      };

    case "cfd":
      return {
        svgDark: renderCfdAirfoilSvg(code, "dark"),
        svgLight: renderCfdAirfoilSvg(code, "light"),
      };

    case "fea":
      return {
        svgDark: renderFeaCantileverSvg(code, "dark"),
        svgLight: renderFeaCantileverSvg(code, "light"),
      };

    case "csv":
      return {
        svgDark: renderCsvTelemetrySvg(code, "dark"),
        svgLight: renderCsvTelemetrySvg(code, "light"),
      };

    case "c": {
      const data = {
        nodes: [
          makeNode({
            id: "inputs",
            label: "FOC Telemetry Inputs",
            stereotype: "c_inputs",
            x: 40,
            y: 70,
            width: 175,
            height: 86,
            stroke: "#38bdf8",
            sections: [{ header: "arguments", entries: ["double i_ref [A]", "double i_meas [A]", "double dt [s]"] }],
            ports: [{ id: "out", x: 175, y: 43, direction: "out" }],
          }),
          makeNode({
            id: "fn",
            label: "pi_current_step()",
            stereotype: "c_function",
            x: 270,
            y: 55,
            width: 210,
            height: 112,
            stroke: "#10b981",
            sections: [
              {
                header: "struct PiController",
                entries: ["err = i_ref - i_meas", "integral += ki * err * dt", "clamp(±v_max) anti-windup"],
              },
            ],
            ports: [
              { id: "in", x: 0, y: 56, direction: "in" },
              { id: "out", x: 210, y: 56, direction: "out" },
            ],
          }),
          makeNode({
            id: "dae",
            label: "DAE Arena Lowering",
            stereotype: "dae_output",
            x: 535,
            y: 70,
            width: 185,
            height: 86,
            stroke: "#f59e0b",
            sections: [{ header: "return", entries: ["double v_out [V]", "Clamped Bus Command"] }],
            ports: [{ id: "in", x: 0, y: 43, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "inputs",
            sourcePort: "out",
            target: "fn",
            targetPort: "in",
            label: "call",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e2",
            source: "fn",
            sourcePort: "out",
            target: "dae",
            targetPort: "in",
            label: "v_out",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "fortran": {
      const data = {
        nodes: [
          makeNode({
            id: "in",
            label: "intent(in) Parameters",
            stereotype: "fortran_in",
            x: 40,
            y: 65,
            width: 180,
            height: 92,
            stroke: "#38bdf8",
            sections: [{ header: "real(8)", entries: ["t_fluid, q_solar", "c_th, h_conv, dt"] }],
            ports: [{ id: "out", x: 180, y: 46, direction: "out" }],
          }),
          makeNode({
            id: "sub",
            label: "thermal_node_step",
            stereotype: "subroutine",
            x: 275,
            y: 55,
            width: 215,
            height: 112,
            stroke: "#8b5cf6",
            sections: [
              {
                header: "energy balance",
                entries: [
                  "q_conv = h_conv*(t_wall - t_fluid)",
                  "dt_wall = (q_solar - q_conv)/c_th",
                  "t_wall = t_wall + dt_wall*dt",
                ],
              },
            ],
            ports: [
              { id: "in", x: 0, y: 56, direction: "in" },
              { id: "out", x: 215, y: 56, direction: "out" },
            ],
          }),
          makeNode({
            id: "inout",
            label: "intent(inout) State",
            stereotype: "dae_state",
            x: 545,
            y: 65,
            width: 175,
            height: 92,
            stroke: "#10b981",
            sections: [{ header: "updated state", entries: ["real(8) :: t_wall [K]", "DAE Arena State Slot"] }],
            ports: [{ id: "in", x: 0, y: 46, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({ id: "e1", source: "in", sourcePort: "out", target: "sub", targetPort: "in", stroke: "#38bdf8" }),
          makeEdge({
            id: "e2",
            source: "sub",
            sourcePort: "out",
            target: "inout",
            targetPort: "in",
            label: "t_wall(k+1)",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "jsbsim": {
      const { parseJsbsim } = await import("@modelscript/jsbsim");
      const { renderJsbsimSvg } = await import("@modelscript/diagram/jsbsim-diagram-builder");
      const fdm = parseJsbsim(code);
      return {
        svgDark: renderJsbsimSvg(fdm as unknown as Parameters<typeof renderJsbsimSvg>[0], { theme: "dark" }),
        svgLight: renderJsbsimSvg(fdm as unknown as Parameters<typeof renderJsbsimSvg>[0], { theme: "light" }),
      };
    }

    case "rocets": {
      const { parseRocetsDeck, renderRocetsPidSvg } = await import("@modelscript/rocets");
      const model = parseRocetsDeck(code);
      const svgDark = renderRocetsPidSvg(model);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "ccsds":
      return {
        svgDark: renderCcsdsOrbitSvg(code, "dark"),
        svgLight: renderCcsdsOrbitSvg(code, "light"),
      };

    case "easy5": {
      const { parseEasy5, renderEasy5SchematicSvg } = await import("@modelscript/easy5");
      const model = parseEasy5(code);
      const svgDark = renderEasy5SchematicSvg(model);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "autosar": {
      const { parseArxml } = await import("@modelscript/autosar");
      const model = parseArxml(code);
      const swcs = Array.from(model.components.values()).filter((swc) => swc.kind !== "COMPOSITION-SW-COMPONENT-TYPE");
      const nodes: DiagramNode[] = swcs.map((swc, idx) =>
        makeNode({
          id: swc.shortName,
          label: swc.shortName,
          stereotype: swc.kind || "SWC",
          x: 40 + idx * 245,
          y: 65,
          width: 195,
          height: 92,
          stroke: idx === 1 ? "#10b981" : "#38bdf8",
          sections: [
            {
              header: "ports",
              entries: Array.from(swc.ports.values()).map(
                (p) => `${p.direction === "provided" ? "P" : "R"}: ${p.shortName}`,
              ),
            },
          ],
          ports: [
            { id: "in", x: 0, y: 46, direction: "in" },
            { id: "out", x: 195, y: 46, direction: "out" },
          ],
        }),
      );
      const edges: DiagramEdge[] = [];
      for (let i = 0; i < nodes.length - 1; i++) {
        edges.push(
          makeEdge({
            id: `rte_${i}`,
            source: nodes[i]!.id,
            sourcePort: "out",
            target: nodes[i + 1]!.id,
            targetPort: "in",
            label: i === 0 ? "YawRate_deg_s" : "TorqueSplit_Nm",
            stroke: "#10b981",
          }),
        );
      }
      return renderBothThemesFromDiagramData({ nodes, edges, coordinateSystem: null, diagramBackground: null });
    }

    case "simulink": {
      const { parseMdl, renderSimulinkSvg } = await import("@modelscript/simulink");
      const model = parseMdl(code);
      const svgDark = renderSimulinkSvg(model);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "gtsuite": {
      const { parseGtmModel, renderGtSuiteSchematicSvg } = await import("@modelscript/gtsuite");
      const model = parseGtmModel(code);
      const svgDark = renderGtSuiteSchematicSvg(model);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "opendrive": {
      const { parseOpenDrive, renderOpenDriveSvg } = await import("@modelscript/opendrive");
      const doc = parseOpenDrive(code);
      return {
        svgDark: renderOpenDriveSvg(doc, { theme: "dark" }),
        svgLight: renderOpenDriveSvg(doc, { theme: "light" }),
      };
    }

    case "openscenario": {
      const { parseOpenScenario } = await import("@modelscript/openscenario");
      const { renderOpenScenarioSvg } = await import("@modelscript/diagram/openscenario-diagram-builder");
      const scen = parseOpenScenario(code);
      const oscLike = {
        title: scen.header.description || "Highway Autonomous Cut-In",
        entities: Array.from(scen.entities.values()).map((ent, idx) => ({
          name: ent.name,
          category: (ent.category as "car" | "truck") ?? "car",
          role: ent.isEgo || ent.name.toLowerCase().includes("ego") ? ("ego" as const) : ("target" as const),
          speed: ent.initialSpeed ?? (idx === 0 ? 33.3 : 27.8),
          x: ent.initialPosition?.lane?.s ?? (idx === 0 ? 20 : 65),
          lane: Math.abs(ent.initialPosition?.lane?.laneId ?? (idx === 0 ? 1 : 2)),
        })),
        safety: {
          ttcSec: 2.35,
          minDistanceMeters: 18.4,
          rssViolated: false,
        },
        laneCount: 3,
      };
      return {
        svgDark: renderOpenScenarioSvg(oscLike, { theme: "dark" }),
        svgLight: renderOpenScenarioSvg(oscLike, { theme: "light" }),
      };
    }

    case "gensys": {
      const { parseGensysDeck, renderGensysSvg } = await import("@modelscript/gensys");
      const model = parseGensysDeck(code);
      return {
        svgDark: renderGensysSvg(model, { theme: "dark" }),
        svgLight: renderGensysSvg(model, { theme: "light" }),
      };
    }

    case "simpack": {
      const { parseSimDeck, renderSimpackSvg } = await import("@modelscript/simpack");
      const model = parseSimDeck(code);
      return {
        svgDark: renderSimpackSvg(model, { theme: "dark" }),
        svgLight: renderSimpackSvg(model, { theme: "light" }),
      };
    }

    case "pscad": {
      const { parsePscx } = await import("@modelscript/pscad");
      const { renderPscadSvg } = await import("@modelscript/diagram/pscad-diagram-builder");
      const project = parsePscx(code);
      const svgDark = renderPscadSvg(project);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "psse": {
      const { parseRaw } = await import("@modelscript/psse");
      const { renderPsseSvg } = await import("@modelscript/diagram/psse-diagram-builder");
      const rawCase = parseRaw(code);
      const svgDark = renderPsseSvg(rawCase as unknown as Parameters<typeof renderPsseSvg>[0]);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "opendss": {
      const { parseOpenDss } = await import("@modelscript/opendss");
      const { renderOpenDssSvg } = await import("@modelscript/diagram/opendss-diagram-builder");
      const deck = parseOpenDss(code);
      return {
        svgDark: renderOpenDssSvg(deck as unknown as Parameters<typeof renderOpenDssSvg>[0], { theme: "dark" }),
        svgLight: renderOpenDssSvg(deck as unknown as Parameters<typeof renderOpenDssSvg>[0], { theme: "light" }),
      };
    }

    case "olga": {
      const { parseOlga } = await import("@modelscript/olga");
      const { renderOlgaSchematicSvg } = await import("@modelscript/diagram/olga-diagram-builder");
      const model = parseOlga(code);
      const svgDark = renderOlgaSchematicSvg(model as unknown as Parameters<typeof renderOlgaSchematicSvg>[0]);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "lps": {
      const { parseLps } = await import("@modelscript/lps");
      const { renderLpsSchematicSvg } = await import("@modelscript/diagram/lps-diagram-builder");
      const model = parseLps(code);
      const svgDark = renderLpsSchematicSvg(model as unknown as Parameters<typeof renderLpsSchematicSvg>[0]);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "eclipse": {
      const { parseEclipse } = await import("@modelscript/eclipse");
      const { renderEclipseSvg } = await import("@modelscript/diagram/eclipse-diagram-builder");
      const deck = parseEclipse(code);
      return {
        svgDark: renderEclipseSvg(deck as unknown as Parameters<typeof renderEclipseSvg>[0], { theme: "dark" }),
        svgLight: renderEclipseSvg(deck as unknown as Parameters<typeof renderEclipseSvg>[0], { theme: "light" }),
      };
    }

    case "relap5": {
      const { parseRelap5 } = await import("@modelscript/relap5");
      const { renderRelap5Svg } = await import("@modelscript/diagram/relap5-diagram-builder");
      const deck = parseRelap5(code);
      return {
        svgDark: renderRelap5Svg(deck as unknown as Parameters<typeof renderRelap5Svg>[0], { theme: "dark" }),
        svgLight: renderRelap5Svg(deck as unknown as Parameters<typeof renderRelap5Svg>[0], { theme: "light" }),
      };
    }

    case "sima": {
      const { renderSimaCatenaryProfileSvg } = await import("@modelscript/diagram/sima-diagram-builder");
      const svgDark = renderSimaCatenaryProfileSvg({
        waterDepth: 320,
        horizontalSpan: 820,
        lineLength: 885,
        touchdownDistance: 540,
        fairleadTotalTension: 2450,
        vesselName: "15MW Spar Turbine",
        vesselDraft: 70,
      });
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "spice": {
      const { parseSpice, renderSpiceSvg } = await import("@modelscript/spice");
      const circuit = parseSpice(code);
      const svgDark = renderSpiceSvg(circuit);
      return { svgDark, svgLight: adaptSvgToLightTheme(svgDark) };
    }

    case "verilog-a": {
      const data = {
        nodes: [
          makeNode({
            id: "anode",
            label: "Terminal: anode",
            stereotype: "electrical_port",
            x: 40,
            y: 95,
            width: 145,
            height: 68,
            stroke: "#38bdf8",
            ports: [{ id: "p", x: 145, y: 34, direction: "out" }],
          }),
          makeNode({
            id: "pn",
            label: "Shockley PN Branch",
            stereotype: "analog_i",
            x: 245,
            y: 25,
            width: 220,
            height: 68,
            stroke: "#10b981",
            sections: [{ header: "KCL contribution", entries: ["I <+ Is*(limexp(V/Vt) - 1)"] }],
            ports: [
              { id: "in", x: 0, y: 34, direction: "in" },
              { id: "out", x: 220, y: 34, direction: "out" },
            ],
          }),
          makeNode({
            id: "rs",
            label: "Ohmic Conductance",
            stereotype: "analog_i",
            x: 245,
            y: 108,
            width: 220,
            height: 68,
            stroke: "#f59e0b",
            sections: [{ header: "KCL contribution", entries: ["I <+ V(anode,cathode) / Rs"] }],
            ports: [
              { id: "in", x: 0, y: 34, direction: "in" },
              { id: "out", x: 220, y: 34, direction: "out" },
            ],
          }),
          makeNode({
            id: "cj",
            label: "Depletion Capacitance",
            stereotype: "analog_ddt",
            x: 245,
            y: 191,
            width: 220,
            height: 68,
            stroke: "#8b5cf6",
            sections: [{ header: "dynamic charge", entries: ["I <+ Cj * ddt(V)"] }],
            ports: [
              { id: "in", x: 0, y: 34, direction: "in" },
              { id: "out", x: 220, y: 34, direction: "out" },
            ],
          }),
          makeNode({
            id: "cathode",
            label: "Terminal: cathode",
            stereotype: "electrical_port",
            x: 525,
            y: 95,
            width: 150,
            height: 68,
            stroke: "#38bdf8",
            ports: [{ id: "n", x: 0, y: 34, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({ id: "e1", source: "anode", sourcePort: "p", target: "pn", targetPort: "in", stroke: "#10b981" }),
          makeEdge({ id: "e2", source: "anode", sourcePort: "p", target: "rs", targetPort: "in", stroke: "#f59e0b" }),
          makeEdge({ id: "e3", source: "anode", sourcePort: "p", target: "cj", targetPort: "in", stroke: "#8b5cf6" }),
          makeEdge({
            id: "e4",
            source: "pn",
            sourcePort: "out",
            target: "cathode",
            targetPort: "n",
            stroke: "#10b981",
          }),
          makeEdge({
            id: "e5",
            source: "rs",
            sourcePort: "out",
            target: "cathode",
            targetPort: "n",
            stroke: "#f59e0b",
          }),
          makeEdge({
            id: "e6",
            source: "cj",
            sourcePort: "out",
            target: "cathode",
            targetPort: "n",
            stroke: "#8b5cf6",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "ibis": {
      const { parseIbis } = await import("@modelscript/ibis");
      const { renderIbisBufferSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
      const deck = parseIbis(code);
      const firstComp = Array.from(deck.components.values())[0];
      const firstModel = Array.from(deck.models.values())[0];
      const ibisLike = {
        componentName: firstComp?.name || "PCIe5_SerDes_TX",
        modelName: firstModel?.name || "SerDes_Diff",
        modelType: firstModel?.modelType || "I/O",
        rPkg: firstComp?.package?.rPkg?.typ ?? 0.095,
        lPkg: firstComp?.package?.lPkg?.typ ?? 1.15e-9,
        cPkg: firstComp?.package?.cPkg?.typ ?? 0.42e-12,
        cComp: firstModel?.cComp?.typ ?? 0.65e-12,
        vcc: firstModel?.voltageRange?.typ ?? 0.85,
      };
      return {
        svgDark: renderIbisBufferSvg(ibisLike, { theme: "dark" }),
        svgLight: renderIbisBufferSvg(ibisLike, { theme: "light" }),
      };
    }

    case "touchstone": {
      const { parseTouchstone } = await import("@modelscript/touchstone");
      const { renderTouchstoneSvg } = await import("@modelscript/diagram/touchstone-diagram-builder");
      const net = parseTouchstone(code);
      return {
        svgDark: renderTouchstoneSvg(net as unknown as Parameters<typeof renderTouchstoneSvg>[0], { theme: "dark" }),
        svgLight: renderTouchstoneSvg(net as unknown as Parameters<typeof renderTouchstoneSvg>[0], { theme: "light" }),
      };
    }

    case "urdf": {
      const { parseUrdf, renderUrdfSvg } = await import("@modelscript/urdf");
      const robot = parseUrdf(code);
      return {
        svgDark: renderUrdfSvg(robot, { theme: "dark" }),
        svgLight: renderUrdfSvg(robot, { theme: "light" }),
      };
    }

    case "plcopen": {
      const data = {
        nodes: [
          makeNode({
            id: "sensors",
            label: "Wet-Well Inputs",
            stereotype: "VAR_INPUT",
            x: 40,
            y: 65,
            width: 185,
            height: 98,
            stroke: "#38bdf8",
            sections: [
              {
                header: "field signals",
                entries: ["WetWellLevel_m := 2.4", "HighSetpoint_m := 3.5", "LagSetpoint_m := 4.2"],
              },
            ],
            ports: [{ id: "out", x: 185, y: 49, direction: "out" }],
          }),
          makeNode({
            id: "pou",
            label: "DuplexPumpStation",
            stereotype: "PROGRAM (IEC 61131-3)",
            x: 280,
            y: 55,
            width: 215,
            height: 116,
            stroke: "#10b981",
            sections: [
              {
                header: "hysteresis & failover",
                entries: ["Level >= 3.5m → Lead ON", "Level >= 4.2m → Lag ON", "Pump1Fault → Auto Failover"],
              },
            ],
            ports: [
              { id: "in", x: 0, y: 58, direction: "in" },
              { id: "out", x: 215, y: 58, direction: "out" },
            ],
          }),
          makeNode({
            id: "coils",
            label: "Contactor Outputs",
            stereotype: "VAR_OUTPUT",
            x: 550,
            y: 65,
            width: 180,
            height: 98,
            stroke: "#f59e0b",
            sections: [
              {
                header: "discrete coils",
                entries: ["LeadPumpRun : BOOL", "LagPumpRun : BOOL", "HighLevelAlarm : BOOL"],
              },
            ],
            ports: [{ id: "in", x: 0, y: 49, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "sensors",
            sourcePort: "out",
            target: "pou",
            targetPort: "in",
            label: "4–20 mA",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e2",
            source: "pou",
            sourcePort: "out",
            target: "coils",
            targetPort: "in",
            label: "24V DO",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "adams": {
      const { parseAdams, renderAdamsSvg } = await import("@modelscript/adams");
      const dataset = parseAdams(code);
      return {
        svgDark: renderAdamsSvg(dataset, { theme: "dark" }),
        svgLight: renderAdamsSvg(dataset, { theme: "light" }),
      };
    }

    case "energyplus": {
      const data = {
        nodes: [
          makeNode({
            id: "env",
            label: "Outdoor Solar & Weather",
            stereotype: "Environment",
            x: 40,
            y: 75,
            width: 175,
            height: 86,
            stroke: "#f59e0b",
            sections: [{ header: "boundary", entries: ["FullInteriorAndExterior", "Solar Beam + Diffuse"] }],
            ports: [{ id: "out", x: 175, y: 43, direction: "out" }],
          }),
          makeNode({
            id: "z1",
            label: "SouthPerimeterZone",
            stereotype: "ThermalZone",
            x: 270,
            y: 35,
            width: 195,
            height: 82,
            stroke: "#38bdf8",
            sections: [{ header: "geometry", entries: ["Volume = 480.0 m³", "Ceiling = 3.6 m"] }],
            ports: [
              { id: "in", x: 0, y: 41, direction: "in" },
              { id: "hvac", x: 195, y: 41, direction: "inout" },
            ],
          }),
          makeNode({
            id: "z2",
            label: "CoreServerZone",
            stereotype: "ThermalZone",
            x: 270,
            y: 145,
            width: 195,
            height: 82,
            stroke: "#8b5cf6",
            sections: [{ header: "geometry", entries: ["Volume = 360.0 m³", "Internal IT Load"] }],
            ports: [
              { id: "in", x: 0, y: 41, direction: "in" },
              { id: "hvac", x: 195, y: 41, direction: "inout" },
            ],
          }),
          makeNode({
            id: "ahu",
            label: "IdealLoadsAirSystem",
            stereotype: "ZoneHVAC",
            x: 525,
            y: 75,
            width: 195,
            height: 92,
            stroke: "#10b981",
            sections: [{ header: "supply limits", entries: ["T_heat,max = 50.0 °C", "T_cool,min = 13.0 °C"] }],
            ports: [{ id: "air", x: 0, y: 46, direction: "inout" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "env",
            sourcePort: "out",
            target: "z1",
            targetPort: "in",
            label: "Q_solar",
            stroke: "#f59e0b",
          }),
          makeEdge({
            id: "e2",
            source: "env",
            sourcePort: "out",
            target: "z2",
            targetPort: "in",
            label: "Q_cond",
            stroke: "#f59e0b",
          }),
          makeEdge({
            id: "e3",
            source: "ahu",
            sourcePort: "air",
            target: "z1",
            targetPort: "hvac",
            label: "Supply Air",
            stroke: "#10b981",
          }),
          makeEdge({
            id: "e4",
            source: "ahu",
            sourcePort: "air",
            target: "z2",
            targetPort: "hvac",
            label: "Chilled Air",
            stroke: "#06b6d4",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "epanet": {
      const { parseInp, solveHydraulics } = await import("@modelscript/epanet");
      const net = parseInp(code);
      const res = solveHydraulics(net);
      const hNorth = res.nodeHeads.get("J_North")?.toFixed(1) ?? "154.2";
      const hSouth = res.nodeHeads.get("J_South")?.toFixed(1) ?? "151.8";
      const hEast = res.nodeHeads.get("J_East")?.toFixed(1) ?? "143.6";
      const data = {
        nodes: [
          makeNode({
            id: "R_Source",
            label: "R_Source Reservoir",
            stereotype: "RESERVOIR",
            x: 40,
            y: 95,
            width: 170,
            height: 76,
            stroke: "#0284c7",
            sections: [{ header: "fixed grade", entries: ["Head = 172.0 m"] }],
            ports: [{ id: "out", x: 170, y: 38, direction: "out" }],
          }),
          makeNode({
            id: "J_North",
            label: "Junction J_North",
            stereotype: "JUNCTION",
            x: 270,
            y: 30,
            width: 175,
            height: 82,
            stroke: "#10b981",
            sections: [{ header: "hydraulics", entries: ["Elev = 118.0 m", `Head = ${hNorth} m`] }],
            ports: [
              { id: "in", x: 0, y: 41, direction: "in" },
              { id: "out", x: 175, y: 41, direction: "out" },
            ],
          }),
          makeNode({
            id: "J_South",
            label: "Junction J_South",
            stereotype: "JUNCTION",
            x: 270,
            y: 165,
            width: 175,
            height: 82,
            stroke: "#10b981",
            sections: [{ header: "hydraulics", entries: ["Elev = 114.0 m", `Head = ${hSouth} m`] }],
            ports: [
              { id: "in", x: 0, y: 41, direction: "in" },
              { id: "out", x: 175, y: 41, direction: "out" },
            ],
          }),
          makeNode({
            id: "T_Tower",
            label: "T_Tower Storage",
            stereotype: "TANK",
            x: 515,
            y: 25,
            width: 175,
            height: 76,
            stroke: "#8b5cf6",
            sections: [{ header: "level", entries: ["Elev = 138.0 m (+4.5 m)"] }],
            ports: [{ id: "in", x: 0, y: 38, direction: "inout" }],
          }),
          makeNode({
            id: "J_East",
            label: "Junction J_East",
            stereotype: "JUNCTION",
            x: 515,
            y: 155,
            width: 175,
            height: 82,
            stroke: "#f59e0b",
            sections: [{ header: "hydraulics", entries: ["Demand = 35.0 L/s", `Head = ${hEast} m`] }],
            ports: [{ id: "in", x: 0, y: 41, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "P1",
            source: "R_Source",
            sourcePort: "out",
            target: "J_North",
            targetPort: "in",
            label: "P_Main1 (350mm)",
            stroke: "#0284c7",
          }),
          makeEdge({
            id: "P2",
            source: "R_Source",
            sourcePort: "out",
            target: "J_South",
            targetPort: "in",
            label: "P_Main2 (300mm)",
            stroke: "#0284c7",
          }),
          makeEdge({
            id: "PT",
            source: "J_North",
            sourcePort: "out",
            target: "T_Tower",
            targetPort: "in",
            label: "P_Tank",
            stroke: "#8b5cf6",
          }),
          makeEdge({
            id: "PL1",
            source: "J_North",
            sourcePort: "out",
            target: "J_East",
            targetPort: "in",
            label: "P_Loop1",
            stroke: "#10b981",
          }),
          makeEdge({
            id: "PL2",
            source: "J_South",
            sourcePort: "out",
            target: "J_East",
            targetPort: "in",
            label: "P_Loop2",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "swmm": {
      const { parseSwmm } = await import("@modelscript/swmm");
      const { renderSwmmSvg } = await import("@modelscript/diagram/swmm-diagram-builder");
      const deck = parseSwmm(code);
      return {
        svgDark: renderSwmmSvg(deck as unknown as Parameters<typeof renderSwmmSvg>[0], { theme: "dark" }),
        svgLight: renderSwmmSvg(deck as unknown as Parameters<typeof renderSwmmSvg>[0], { theme: "light" }),
      };
    }

    case "aspen": {
      const { parseAspen } = await import("@modelscript/aspen");
      const { renderAspenSvg } = await import("@modelscript/diagram/aspen-diagram-builder");
      const model = parseAspen(code);
      return {
        svgDark: renderAspenSvg(model as unknown as Parameters<typeof renderAspenSvg>[0], { theme: "dark" }),
        svgLight: renderAspenSvg(model as unknown as Parameters<typeof renderAspenSvg>[0], { theme: "light" }),
      };
    }

    case "sbml": {
      const { parseSbml } = await import("@modelscript/sbml");
      const { renderSbmlSvg } = await import("@modelscript/diagram/sbml-diagram-builder");
      const doc = parseSbml(code);
      return {
        svgDark: renderSbmlSvg(doc.model as unknown as Parameters<typeof renderSbmlSvg>[0], { theme: "dark" }),
        svgLight: renderSbmlSvg(doc.model as unknown as Parameters<typeof renderSbmlSvg>[0], { theme: "light" }),
      };
    }

    default:
      throw new Error(`No diagram renderer configured for language slug '${slug}'`);
  }
}

async function generateAllExamples(): Promise<GeneratedLanguageExample[]> {
  const results: GeneratedLanguageExample[] = [];
  for (const lang of LANGUAGES) {
    const spec = EXAMPLE_SPECS[lang.slug];
    if (!spec) {
      throw new Error(`Missing example specification in EXAMPLE_SPECS for language '${lang.slug}'`);
    }
    if (process.env["DEBUG_EXAMPLES"]) {
      console.error(`[gen-examples] rendering ${lang.slug}...`);
    }
    const { svgDark, svgLight } = await renderExampleSvgs(lang.slug, spec.code);
    if (!svgDark.includes("<svg") || !svgLight.includes("<svg")) {
      throw new Error(`Invalid SVG output generated for '${lang.slug}'`);
    }
    const trimmedCode = spec.code.trim();
    results.push({
      slug: lang.slug,
      name: lang.name,
      ext: lang.ext,
      filename: spec.filename,
      title: spec.title,
      description: spec.description,
      viewLabel: spec.viewLabel,
      code: trimmedCode,
      lineCount: trimmedCode.split("\n").length,
      permalinkToken: encodePermalinkToken(lang.slug, spec.filename, trimmedCode),
      svgDark: namespaceSvgIds(svgDark, `${lang.slug}-d`),
      svgLight: namespaceSvgIds(svgLight, `${lang.slug}-l`),
    });
  }
  return results;
}

const examples = await generateAllExamples();
const jsonOutput = JSON.stringify(examples, null, 2) + "\n";

if (process.argv.includes("--check")) {
  const current = fs.existsSync(outputPath) ? fs.readFileSync(outputPath, "utf8") : "";
  if (current !== jsonOutput) {
    console.error(
      "✖ language-examples.generated.json is out of date. Run `npm run gen:examples --workspace=@modelscript/docs`.",
    );
    process.exit(1);
  }
  console.log(`✓ language-examples.generated.json is up to date (${examples.length} languages).`);
  process.exit(0);
}

fs.writeFileSync(outputPath, jsonOutput, "utf8");
console.log(`✓ Wrote ${examples.length} language examples + SVGs to ${path.relative(process.cwd(), outputPath)}`);
process.exit(0);
