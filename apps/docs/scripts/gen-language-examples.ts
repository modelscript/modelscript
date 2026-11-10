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

// Seed Math.random deterministically so layout engines (e.g. ELK tie-breaking) produce identical SVGs across --check runs.
let _rngState = 0x12345678;
Math.random = () => {
  _rngState = (_rngState * 1664525 + 1013904223) >>> 0;
  return _rngState / 0x100000000;
};

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

  ampl: {
    filename: "TransportationNetwork.mod",
    title: "Hitchcock-Koopmans Multi-Commodity Transportation",
    description:
      "Linear programming model with multi-dimensional sets, demand satisfaction equations, and capacity constraints.",
    viewLabel: "Optimization Model & Network Flow",
    code: `set ORIG;
set DEST;

param supply {ORIG} >= 0;
param demand {DEST} >= 0;
param cost {ORIG, DEST} >= 0;

var Trans {ORIG, DEST} >= 0;

minimize Total_Cost:
  sum {i in ORIG, j in DEST} cost[i, j] * Trans[i, j];

subject to Supply_Limit {i in ORIG}:
  sum {j in DEST} Trans[i, j] <= supply[i];

subject to Demand_Satisfaction {j in DEST}:
  sum {i in ORIG} Trans[i, j] = demand[j];`,
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

  usd: {
    filename: "RoboticManipulator.usda",
    title: "OpenUSD UsdPhysics Articulated Robotic Manipulator Stage",
    description:
      "Hierarchical UTF-8 ASCII OpenUSD stage defining rigid bodies, revolute joint limits, diagonal inertia tensors, and time-sampled joint trajectories.",
    viewLabel: "3D Digital Twin Prim Hierarchy & UsdPhysics DAG",
    code: `#usda 1.0
(
    defaultPrim = "IndustrialArm"
    metersPerUnit = 1.0
    upAxis = "Z"
)

def Xform "IndustrialArm" (
    kind = "assembly"
)
{
    def Xform "base_link" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 12.5
        float3 physics:diagonalInertia = (1.2, 1.2, 0.6)

        def Cube "visual_base"
        {
            double size = 1.0
            double3 xformOp:scale = (0.25, 0.25, 0.4)
            uniform token[] xformOpOrder = ["xformOp:scale"]
        }
    }

    def Xform "link_1" (
        prepend apiSchemas = ["PhysicsRigidBodyAPI", "PhysicsMassAPI"]
    )
    {
        bool physics:rigidBodyEnabled = true
        float physics:mass = 4.8
        float3 physics:diagonalInertia = (0.45, 0.45, 0.12)

        double3 xformOp:translate.timeSamples = {
            0.0: (0.0, 0.0, 0.4),
            0.5: (0.1, 0.0, 0.6),
            1.0: (0.2, 0.0, 0.7),
        }
        uniform token[] xformOpOrder = ["xformOp:translate"]
    }

    def PhysicsRevoluteJoint "shoulder_joint"
    {
        rel physics:body0 = </IndustrialArm/base_link>
        rel physics:body1 = </IndustrialArm/link_1>
        uniform token physics:axis = "Z"
        float physics:lowerLimit = -3.14159
        float physics:upperLimit = 3.14159
    }
}`,
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

  cgmes: {
    filename: "EntsoeInterconnector380kV.xml",
    title: "ENTSO-E CGMES v2.4.15 380/220 kV Substation & Tie-Line Exchange",
    description:
      "IEC 61970-600-2 Common Grid Model Exchange Standard RDF/XML profile defining Substations, VoltageLevels, TopologicalNodes, SynchronousMachines, PowerTransformers, and ACLineSegments.",
    viewLabel: "CGMES Node-Breaker & Bus-Branch Substation Schematic",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:cim="http://iec.ch/TC57/2013/CIM-schema-cim16#">
  <cim:Substation rdf:ID="Sub_Alpha">
    <cim:IdentifiedObject.name>Substation_Alpha_380kV</cim:IdentifiedObject.name>
  </cim:Substation>
  <cim:VoltageLevel rdf:ID="VL_380">
    <cim:IdentifiedObject.name>Alpha_380kV</cim:IdentifiedObject.name>
    <cim:VoltageLevel.Substation rdf:resource="#Sub_Alpha"/>
    <cim:VoltageLevel.BaseVoltage rdf:resource="#BV_380"/>
  </cim:VoltageLevel>
  <cim:TopologicalNode rdf:ID="TN_Alpha_380">
    <cim:IdentifiedObject.name>Bus_Alpha_380</cim:IdentifiedObject.name>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#VL_380"/>
  </cim:TopologicalNode>
  <cim:TopologicalNode rdf:ID="TN_Beta_380">
    <cim:IdentifiedObject.name>Bus_Beta_380</cim:IdentifiedObject.name>
    <cim:TopologicalNode.ConnectivityNodeContainer rdf:resource="#VL_380"/>
  </cim:TopologicalNode>
  <cim:SynchronousMachine rdf:ID="Gen_Nuclear_1">
    <cim:IdentifiedObject.name>NuclearUnit_1200MW</cim:IdentifiedObject.name>
    <cim:RotatingMachine.ratedS>1350.0</cim:RotatingMachine.ratedS>
    <cim:RotatingMachine.p>-1150.0</cim:RotatingMachine.p>
    <cim:RotatingMachine.q>-220.0</cim:RotatingMachine.q>
  </cim:SynchronousMachine>
  <cim:ACLineSegment rdf:ID="Line_Alpha_Beta_1">
    <cim:IdentifiedObject.name>TieLine_Alpha_Beta_380kV</cim:IdentifiedObject.name>
    <cim:Conductor.length>84.5</cim:Conductor.length>
    <cim:ACLineSegment.r>1.85</cim:ACLineSegment.r>
    <cim:ACLineSegment.x>24.60</cim:ACLineSegment.x>
    <cim:ACLineSegment.bch>0.000315</cim:ACLineSegment.bch>
  </cim:ACLineSegment>
  <cim:EnergyConsumer rdf:ID="Load_Metro_Beta">
    <cim:IdentifiedObject.name>MetroHub_Beta_Load</cim:IdentifiedObject.name>
    <cim:EnergyConsumer.p>820.0</cim:EnergyConsumer.p>
    <cim:EnergyConsumer.q>195.0</cim:EnergyConsumer.q>
  </cim:EnergyConsumer>
</rdf:RDF>`,
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

  optical: {
    filename: "MetroRoadmRing.json",
    title: "OpenROADM DWDM Transmission & ROADM Mesh",
    description:
      "OpenROADM multi-degree ROADM ring topology with in-line EDFA amplifiers, colorless/directionless add-drop banks, and optical span budgets.",
    viewLabel: "OpenROADM DWDM Optical Topology",
    code: `{
  "network-name": "US-NorthEast-ROADM-Ring",
  "nodes": [
    {
      "node-id": "ROADM-NYC",
      "name": "New York Core Hub",
      "node-type": "rdm",
      "degrees": [{ "degree-number": 1, "max-wavelengths": 96 }, { "degree-number": 2, "max-wavelengths": 96 }],
      "srgs": [{ "srg-number": 1, "max-add-drop": 96, "colorless": true, "directionless": true }]
    },
    {
      "node-id": "ILA-HARTFORD",
      "name": "Hartford In-Line Optical Amp",
      "node-type": "ila",
      "degrees": [{ "degree-number": 1, "max-wavelengths": 96 }]
    },
    {
      "node-id": "ROADM-BOS",
      "name": "Boston Regional Hub",
      "node-type": "rdm",
      "degrees": [{ "degree-number": 1, "max-wavelengths": 96 }, { "degree-number": 2, "max-wavelengths": 96 }],
      "srgs": [{ "srg-number": 1, "max-add-drop": 96, "colorless": true, "directionless": true }]
    }
  ],
  "links": [
    {
      "link-id": "SPAN-NYC-HARTFORD",
      "source": "ROADM-NYC",
      "dest": "ILA-HARTFORD",
      "length-km": 178.5,
      "span-loss-db": 39.2
    },
    {
      "link-id": "SPAN-HARTFORD-BOS",
      "source": "ILA-HARTFORD",
      "dest": "ROADM-BOS",
      "length-km": 162.0,
      "span-loss-db": 35.6
    }
  ]
}`,
  },

  ran: {
    filename: "SectorAntenna.adf",
    title: "NSMA WG16 Base Station Antenna Radiation Pattern",
    description:
      "NSMA WG16 antenna pattern defining horizontal azimuth and vertical elevation cuts, electrical downtilt, cross-polarization, and front-to-back ratio.",
    viewLabel: "Antenna 3D Radiation Pattern & Envelope",
    code: `REVNUM: 1.01
PATTYP: C
DESCR1: 65deg 18dBi Dual-Pol Base Station Antenna
DESCR2: 1710-2170MHz
MANUF: ModelScript Wireless
MODEL: MSX-HEX-65-18
GAIN: 18.0
GAINU: DBI
FRQREC: 1710.0 2170.0
POLARZ: D
DTILTE: 2.0
DTILTM: 0.0
NOAVAL: 13
0.0 0.0
30.0 2.8
32.5 3.0
60.0 12.0
90.0 22.0
120.0 25.0
150.0 28.0
180.0 30.0
210.0 28.0
240.0 25.0
270.0 22.0
300.0 12.0
330.0 2.8
NOEVAL: 9
0.0 0.0
3.5 3.0
7.0 12.0
15.0 20.0
30.0 25.0
90.0 30.0
270.0 30.0
345.0 20.0
356.5 3.0`,
  },

  fiber: {
    filename: "OutsidePlantFeeder.geojson",
    title: "TIA-598 Outside Plant Cable Cadastre & Splice Topology",
    description:
      "Outside Plant (OSP) GeoJSON network tracing feeder cables, buffer tube hierarchies, splice closures, and central office termination paths.",
    viewLabel: "Outside Plant GIS & Fiber Cadastre",
    code: `{
  "type": "FeatureCollection",
  "name": "Metro-FTTx-Feeder",
  "features": [
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-73.9851, 40.7488] },
      "properties": { "id": "CO_MIDTOWN", "name": "Midtown Central Office", "node-type": "central-office" }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-73.98, 40.752] },
      "properties": { "id": "MH_42ND_5TH", "name": "Manhole 42nd & 5th", "node-type": "manhole" }
    },
    {
      "type": "Feature",
      "geometry": { "type": "Point", "coordinates": [-73.975, 40.755] },
      "properties": { "id": "FST_LEXINGTON", "name": "Splice Closure Lexington", "node-type": "splice-closure" }
    },
    {
      "type": "Feature",
      "geometry": {
        "type": "LineString",
        "coordinates": [[-73.9851, 40.7488], [-73.98, 40.752], [-73.975, 40.755]]
      },
      "properties": {
        "id": "CABLE-FEEDER-144",
        "name": "Midtown Feeder Cable",
        "from": "CO_MIDTOWN",
        "to": "FST_LEXINGTON",
        "strands": 144,
        "standard": "TIA-598-D"
      }
    }
  ]
}`,
  },

  gtfs: {
    filename: "TransitSchedule.gtfs",
    title: "GTFS Schedule & Electric Bus Fleet Dispatch",
    description:
      "General Transit Feed Specification defining routes, stops, trips, and vehicle stop times for fleet electrification and depot charging dispatch.",
    viewLabel: "Transit Electrification & Schedule Graph",
    code: `# STOPS
stop_id,stop_name,stop_lat,stop_lon
STOP_1,Central Terminal,37.7749,-122.4194
STOP_2,Civic Plaza,37.7793,-122.4175
STOP_3,Metro Depot,37.7599,-122.4148

# ROUTES
route_id,route_short_name,route_long_name,route_type
ROUTE_14,14,Mission Electric Rapid,3

# TRIPS
route_id,service_id,trip_id
ROUTE_14,WEEKDAY,TRIP_101

# STOP_TIMES
trip_id,arrival_time,departure_time,stop_id,stop_sequence
TRIP_101,06:00:00,06:02:00,STOP_1,1
TRIP_101,06:15:00,06:17:00,STOP_2,2
TRIP_101,06:30:00,06:35:00,STOP_3,3`,
  },

  ocpp: {
    filename: "DepotCharger.ocpp",
    title: "OCPP 2.0.1 Smart Charging Profile & EVSE Load Shaving",
    description:
      "OCPP charging station topology with multi-EVSE load limits, dynamic SoC targets, and transformer peak shaving constraints.",
    viewLabel: "OCPP EV Smart Charging & Load Profile",
    code: `station "Fleet_Depot_1" {
  model: "Terra-184"
  vendor: "ABB"
  gridLimitKW: 180.0

  evse 1 {
    connector 1 {
      type: "CCS2"
      maxPowerKW: 90.0
      currentSession: {
        transactionId: "TX-1001"
        evBatteryCapacityKWh: 80.0
        currentSoC: 0.20
        targetSoC: 0.85
        departureMinutes: 45
      }
    }
  }

  evse 2 {
    connector 1 {
      type: "CCS2"
      maxPowerKW: 90.0
      currentSession: {
        transactionId: "TX-1002"
        evBatteryCapacityKWh: 60.0
        currentSoC: 0.40
        targetSoC: 0.90
        departureMinutes: 60
      }
    }
  }
}`,
  },

  openadr: {
    filename: "PeakFlexProgram.oadr",
    title: "OpenADR 2.0b Automated Demand Response & Peak Shaving",
    description:
      "OpenADR demand response program defining Curtailment events, dispatch intervals, and setpoint payloads for grid-interactive buildings and charging depots.",
    viewLabel: "OpenADR Demand Response Program & Dispatch",
    code: `program "Summer_Peak_Flex" {
  event "DR_EV_01" {
    status: "active"
    signalType: "setpoint"
    targetVenId: "VEN-FLEET-DEPOT-1"

    interval {
      start: "2026-07-15T14:00:00Z"
      durationSeconds: 7200
      payload: 100.0
    }

    interval {
      start: "2026-07-15T16:00:00Z"
      durationSeconds: 3600
      payload: 50.0
    }
  }
}`,
  },

  tough: {
    filename: "GeothermalReservoir.tgh",
    title: "LBNL TOUGH2 Multi-Phase Geothermal Reservoir Simulation",
    description:
      "TOUGH2 numerical grid specifying basalt rock thermal properties, 3D element volumes, Darcy flow connections, and geothermal production well enthalpy rates.",
    viewLabel: "TOUGH2 Geothermal Thermodynamic State",
    code: `Geothermal Reservoir 2-Element Benchmark
ROCKS
BASLT    2700.0      0.10 5.0E-14 5.0E-14 1.0E-14       2.8    1050.0
ELEME
A1  1BASLT 1.0E+05
A1  2BASLT 1.0E+05
CONNE
A1  1A1  2 50.0 50.0 1.0E+03       0.0
GENER
A1  1WELL1MASS      -20.0    1.5E+06
INCON
A1  1        1.2E+07       260.0
A1  2        1.2E+07       260.0
ENDCY`,
  },

  "hec-ras": {
    filename: "RiverBasinReach.g01",
    title: "USACE HEC-RAS 1D/2D River Hydraulics & Flood Analysis",
    description:
      "USACE HEC-RAS geometric definition containing station-elevation coordinates, Manning roughness factors, bank stations, and reach lengths.",
    viewLabel: "HEC-RAS River Hydraulic Geometry & Profile",
    code: `Geom Title=Columbia River Reach 1
Program Version=6.3.1
River Reach=Columbia,ReachA
Reach XY=3
0, 1000
500, 1500
1000, 2000

Type RM CEM CS= 1 ,1000    ,        ,
DESCRIPTION=Upstream Boundary Cross Section
Station Elevation Data= 5
0, 110  25, 98  50, 92  75, 98  100, 110
Cross Section Reach Lengths and Manning Values=
250, 250, 250, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=25,75
Exp/Contr=0.1,0.3

Type RM CEM CS= 1 ,750     ,        ,
DESCRIPTION=Downstream Cross Section
Station Elevation Data= 5
0, 108  20, 96  50, 90  80, 96  100, 108
Cross Section Reach Lengths and Manning Values=
250, 250, 250, 3, 0.045, 0.035, 0.045, 0, 0
Bank Sta=20,80
Exp/Contr=0.1,0.3`,
  },

  modflow: {
    filename: "GroundwaterBasin.dis6",
    title: "USGS MODFLOW 6 Hydrogeological Groundwater Aquifer",
    description:
      "MODFLOW 6 structured discretization (DIS6) and node property flow (NPF6) grid modeling 3D Darcy groundwater seepage and well discharge.",
    viewLabel: "MODFLOW Groundwater Flow & Aquifer Head",
    code: `# MODFLOW 6 Simulation Model
BEGIN DIS6
  NLAY 2
  NROW 3
  NCOL 3
  DELR 100.0
  DELC 100.0
  TOP 50.0
  BOTM 20.0 0.0
END DIS6

BEGIN NPF6
  K 15.0
  K33 2.0
  SS 1.0e-5
  SY 0.18
END NPF6

BEGIN WEL6
  1 2 2 -400.0
END WEL6

BEGIN RIV6
  1 1 1 48.0 250.0 42.0
END RIV6`,
  },

  landgem: {
    filename: "PineCreekFacility.landgem",
    title: "EPA LandGEM Municipal Solid Waste Biogas Generation",
    description:
      "EPA LandGEM first-order decay model calculating methane generation rate, NMOC emissions, and landfill gas energy potential.",
    viewLabel: "LandGEM Biogas Generation & Methane Decay",
    code: `# Regional Solid Waste & Biogas Facility
SITE "PineCreekLandfill"
  OPEN 2010
  CLOSE 2035
  L0 100.0  # m^3/Mg
  K 0.04    # 1/yr conventional
  NMOC 600  # ppmv
  METHANE_PERCENT 50.0

WASTE_ACCEPTANCE
  2010 150000
  2011 160000
  2012 175000
  2013 180000
  2014 190000`,
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

  oscal: {
    filename: "AvionicsSSP.oscal.json",
    title: "NIST SP 800-53 Rev 5 System Security Plan (OSCAL)",
    description:
      "Open Security Controls Assessment Language (OSCAL 1.1.2) System Security Plan mapping AC-2 and SC-8 controls to flight control hardware.",
    viewLabel: "OSCAL Control & Component Traceability",
    code: `{
  "system-security-plan": {
    "uuid": "550e8400-e29b-41d4-a716-446655440000",
    "metadata": {
      "title": "Avionics Flight Control System Security Plan",
      "oscal-version": "1.1.2",
      "version": "2.1.0"
    },
    "system-implementation": {
      "components": [
        {
          "uuid": "11111111-2222-4333-8444-555555555555",
          "type": "hardware",
          "title": "Primary Flight Control Computer",
          "status": { "state": "operational" }
        }
      ]
    },
    "control-implementation": {
      "description": "NIST SP 800-53 Rev 5 High-Baseline Implementation",
      "implemented-requirements": [
        {
          "uuid": "aaaaaaaa-bbbb-4ccc-8ddd-eeeeeeeeeeee",
          "control-id": "ac-2",
          "by-components": [
            {
              "component-uuid": "11111111-2222-4333-8444-555555555555",
              "description": "Enforces hardware-isolated role-based authentication."
            }
          ]
        }
      ]
    }
  }
}`,
  },

  qif: {
    filename: "TurbineBladeInspection.qif",
    title: "ISO 23952 QIF 3.0 GD&T Datum & CMM Inspection Plan",
    description:
      "Quality Information Framework (QIF) digital metrology document linking datum reference frames and true-position tolerances to CMM measurement results.",
    viewLabel: "QIF GD&T Tolerance & CMM Metrology Chain",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<QIFDocument xmlns="http://qifstandards.org/xsd/qif3" versionQIF="3.0.0" idMax="40">
  <QPId>f47ac10b-58cc-4372-a567-0e02b2c3d479</QPId>
  <DatumDefinitions n="1">
    <DatumDefinition id="10"><DatumLabel>A</DatumLabel></DatumDefinition>
  </DatumDefinitions>
  <DatumReferenceFrames n="1">
    <DatumReferenceFrame id="12">
      <Datums n="1">
        <Datum><SimpleDatum id="10"/><MaterialModifier>NONE</MaterialModifier><ReferencedComponent>ACTUAL</ReferencedComponent></Datum>
      </Datums>
    </DatumReferenceFrame>
  </DatumReferenceFrames>
  <Characteristics>
    <CharacteristicDefinitions n="1">
      <PositionCharacteristicDefinition id="20">
        <ToleranceValue>0.025</ToleranceValue>
        <DatumReferenceFrameId>12</DatumReferenceFrameId>
        <MaterialCondition>MAXIMUM</MaterialCondition>
        <ZoneShape><DiametricalZone/></ZoneShape>
      </PositionCharacteristicDefinition>
    </CharacteristicDefinitions>
  </Characteristics>
</QIFDocument>`,
  },

  automationml: {
    filename: "RoboticWorkcell.aml",
    title: "IEC 62714 AutomationML CAEX 3.0 Robotic Workcell Topology",
    description:
      "AutomationML plant hierarchy combining a 6-DOF industrial manipulator, safety PLC controller, and Profinet IO links.",
    viewLabel: "AutomationML CAEX 3.0 InstanceHierarchy",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<CAEXFile SchemaVersion="3.0" FileName="RoboticWorkcell.aml" xmlns="http://www.dke.de/CAEX">
  <SuperiorStandardVersion>AutomationML 2.10</SuperiorStandardVersion>
  <InstanceHierarchy Name="AssemblyCell_01">
    <Version>1.0.0</Version>
    <InternalElement Name="WeldingRobot_KR60" ID="1001" RefBaseSystemUnitPath="RobotLib/Manipulator6DOF">
      <Attribute Name="PayloadKg" AttributeDataType="xs:double"><Value>60.0</Value></Attribute>
      <ExternalInterface Name="ProfinetPort" ID="1002" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication"/>
      <RoleRequirements RefBaseRoleClassPath="AutomationMLBaseRoleClassLib/AutomationMLBaseRole/Resource"/>
    </InternalElement>
    <InternalElement Name="CellController_PLC" ID="2001" RefBaseSystemUnitPath="ControlLib/SafetyPLC">
      <ExternalInterface Name="ProfinetMaster" ID="2002" RefBaseClassPath="AutomationMLInterfaceClassLib/AutomationMLBaseInterface/Communication"/>
    </InternalElement>
    <InternalLink Name="ProfinetLink_1" RefPartnerSideA="1001:1002" RefPartnerSideB="2001:2002"/>
  </InstanceHierarchy>
</CAEXFile>`,
  },

  gproms: {
    filename: "ExothermicCSTR.gproms",
    title: "gPROMS Non-Isothermal CSTR Process Model",
    description:
      "Equation-oriented process model coupling Arrhenius first-order reaction kinetics with jacketed heat transfer.",
    viewLabel: "gPROMS Process Flowsheet & DAE Equations",
    code: `PARAMETER
  k0   AS REAL DEFAULT 1.2e6 ;
  Ea_R AS REAL DEFAULT 4500.0 ;
  V    AS REAL DEFAULT 2.5 ;
VARIABLE
  Ca   AS Concentration ;
  T    AS Temperature ;
  r_A  AS ReactionRate ;
EQUATION
  r_A = k0 * EXP(-Ea_R / T) * Ca ;
  V * $Ca = 1.2 * (2.0 - Ca) - V * r_A ;
  V * 4184.0 * $T = 1.2 * 4184.0 * (300.0 - T) + 65000.0 * V * r_A ;`,
  },

  cantera: {
    filename: "HydrogenAirMechanism.cti",
    title: "Cantera H2/O2 Elementary Reaction Mechanism",
    description:
      "Gas-phase chemical kinetics mechanism with NASA-7 thermodynamic polynomials and modified Arrhenius rate coefficients.",
    viewLabel: "Cantera Gas-Phase Reaction Network",
    code: `units(length="cm", time="s", quantity="mol", act_energy="cal/mol")

ideal_gas(
    name="h2_air_mix",
    elements="H O N Ar",
    species="H2 O2 H O OH H2O N2",
    reactions="all",
    initial_state=state(temperature=1200.0, pressure=101325.0, mole_fractions="H2:2.0, O2:1.0, N2:3.76")
)

reaction("H + O2 <=> O + OH", [3.547e15, -0.406, 16599.0])
reaction("O + H2 <=> H + OH", [5.080e04,  2.670,  6290.0])
reaction("H2 + OH <=> H2O + H", [2.160e08, 1.510, 3430.0])`,
  },

  phreeqc: {
    filename: "CalciteEquilibrium.pqi",
    title: "PHREEQC Aqueous Speciation & Calcite Dissolution",
    description:
      "Hydrogeochemical input deck equilibrating a Ca-HCO3-Cl groundwater solution with calcite and CO2(g) partial pressure.",
    viewLabel: "PHREEQC Aqueous Speciation & Mineral Equilibria",
    code: `TITLE Calcite and CO2(g) Equilibrium Speciation
SOLUTION 1 Limestone Aquifer Water
    temp      25.0
    pH        7.35
    pe        4.0
    units     mmol/kgw
    Ca        1.85
    Mg        0.42
    Alkalinity 3.60 as HCO3
    Cl        1.10
EQUILIBRIUM_PHASES 1
    Calcite   0.0   10.0
    CO2(g)   -2.1   1.0
END`,
  },

  smiles: {
    filename: "AnalgesicLibrary.smi",
    title: "OpenSMILES Molecular Library & Lipinski Profile",
    description:
      "Canonical OpenSMILES chemical structure table with aromaticity, stereochemistry, and molecular property checks.",
    viewLabel: "SMILES Molecular Graph & Valence Topology",
    code: `CC(=O)Oc1ccccc1C(=O)O\tAspirin
CC(=O)Nc1ccc(O)cc1\tParacetamol
CC(C)Cc1ccc(cc1)[C@@H](C)C(=O)O\tDexibuprofen
CN1C=NC2=C1C(=O)N(C(=O)N2C)C\tCaffeine`,
  },

  antimony: {
    filename: "RepressilatorCircuit.ant",
    title: "Antimony Synthetic Transcriptional Repressilator",
    description:
      "Modular human-readable biological network model of the three-gene TetR-LacI-cI synthetic oscillatory circuit.",
    viewLabel: "Antimony Gene Regulatory Network",
    code: `model RepressilatorCircuit()
  compartment cell = 1.0;
  species m_LacI in cell, m_TetR in cell, m_cI in cell;
  species p_LacI in cell, p_TetR in cell, p_cI in cell;

  alpha = 216.0; alpha0 = 0.216; n = 2.0; beta = 0.2;

  J_tx_LacI: => m_LacI; alpha0 + alpha / (1 + p_cI^n);
  J_deg_LacI: m_LacI => ; m_LacI;
  J_tl_LacI: => p_LacI; beta * m_LacI;
  J_pdeg_LacI: p_LacI => ; beta * p_LacI;

  m_LacI = 0.0; m_TetR = 0.5; m_cI = 0.0;
  p_LacI = 5.0; p_TetR = 0.0; p_cI = 0.0;
end`,
  },

  bngl: {
    filename: "EgfrSignaling.bngl",
    title: "BioNetGen Rule-Based EGFR Dimerization & Phosphorylation",
    description:
      "Rule-based signaling model tracking ligand binding, receptor dimerization, trans-autophosphorylation, and Grb2 recruitment.",
    viewLabel: "BioNetGen Rule-Based Contact Map",
    code: `begin model
begin parameters
  kp1  1.0e-3
  km1  0.10
  kp2  5.0e-3
  km2  0.05
  k_p  1.20
end parameters
begin molecule types
  EGF(r)
  EGFR(l,d,Y1068~U~P)
end molecule types
begin seed species
  EGF(r)               1200.0
  EGFR(l,d,Y1068~U)    1000.0
end seed species
begin reaction rules
  R_Bind:  EGF(r) + EGFR(l,d) <-> EGF(r!1).EGFR(l!1,d) kp1, km1
  R_Dimer: EGFR(l!+,d) + EGFR(l!+,d) <-> EGFR(l!+,d!2).EGFR(l!+,d!2) kp2, km2
  R_Phos:  EGFR(d!+,Y1068~U) -> EGFR(d!+,Y1068~P) k_p
end reaction rules
end model`,
  },

  genbank: {
    filename: "pET28a_GFP.gb",
    title: "GenBank T7-lac GFP Expression Plasmid Map",
    description:
      "INSDC GenBank flatfile sequence record with promoter, RBS, His6-GFP coding sequence (CDS), and terminator features.",
    viewLabel: "GenBank Annotated Feature Map",
    code: `LOCUS       pET28a_GFP               180 bp    DNA     circular SYN 01-JAN-2026
DEFINITION  Synthetic T7-lac inducible GFP reporter cassette.
ACCESSION   SYN_GFP_001
FEATURES             Location/Qualifiers
     promoter        1..20
                     /label="T7_promoter"
     RBS             25..36
                     /label="ribosome_binding_site"
     CDS             43..150
                     /gene="gfp"
                     /codon_start=1
                     /product="Green Fluorescent Protein"
     terminator      155..180
                     /label="T7_terminator"
ORIGIN
        1 taatacgact cactataggg agaccacaac ggtttccctc tagaaataat tttgtttaac
       61 tttaagaagg agatatacca tgggcagca gccatcatca tcatcatcac agcagcggcc
      121 tggtgccgcg cggcagccat atggctagct aactagcata accccttggg gcctctaaac
//`,
  },

  nmtran: {
    filename: "TwoCompOralPK.ctl",
    title: "NONMEM NM-TRAN Two-Compartment Population PK Control Stream",
    description:
      "Pharmacometric control stream (ADVAN4 TRANS4) with between-subject exponential random effects and proportional residual error.",
    viewLabel: "NM-TRAN Compartmental PK/PD Structure",
    code: `$PROBLEM Oral Two-Compartment Population PK Analysis
$INPUT ID TIME AMT DV MDV EVID WT CRCL
$DATA ../data/pk_phase2.csv IGNORE=@
$SUBROUTINES ADVAN4 TRANS4
$PK
  TVCL = THETA(1) * (WT / 70.0)**0.75
  TVV2 = THETA(2) * (WT / 70.0)
  TVQ  = THETA(3)
  TVV3 = THETA(4)
  TVKA = THETA(5)
  CL   = TVCL * EXP(ETA(1))
  V2   = TVV2 * EXP(ETA(2))
  Q    = TVQ
  V3   = TVV3
  KA   = TVKA * EXP(ETA(3))
  S2   = V2
$ERROR
  IPRED = F
  Y = IPRED * (1.0 + ERR(1))
$THETA
  (0.1, 4.5, 25.0) ; POP_CL (L/h)
  (1.0, 32.0, 120.0) ; POP_V2 (L)
  (0.1, 2.8, 20.0) ; POP_Q  (L/h)
  (5.0, 48.0, 200.0) ; POP_V3 (L)
  (0.05, 1.1, 5.0) ; POP_KA (1/h)
$OMEGA 0.09 0.06 0.12
$SIGMA 0.04
$ESTIMATION METHOD=1 INTERACTION MAXEVAL=9999 PRINT=5`,
  },

  pdb: {
    filename: "AlphaHelixPeptide.pdb",
    title: "WWPDB Alpha-Helical Peptide & Disulfide Bridge Record",
    description:
      "Protein Data Bank macromolecular structure defining secondary structure HELIX ranges, ATOM coordinates, and CONECT records.",
    viewLabel: "PDB Secondary Structure & Atomic Topology",
    code: `HEADER    DE NOVO PROTEIN                         01-JAN-26   1MSX
TITLE     COMPUTATIONAL ALPHA-HELICAL PEPTIDE FRAGMENT
HELIX    1  H1 ALA A    1  ALA A    5  1                                   5
ATOM      1  N   ALA A   1      10.120  12.450   8.310  1.00 14.20           N
ATOM      2  CA  ALA A   1      11.480  12.920   8.560  1.00 13.80           C
ATOM      3  C   ALA A   1      12.460  11.750   8.620  1.00 14.10           C
ATOM      4  O   ALA A   1      13.660  11.940   8.810  1.00 15.60           O
ATOM      5  CB  ALA A   1      11.880  13.940   7.490  1.00 14.90           C
TER       6      ALA A   1
END`,
  },

  sbol: {
    filename: "ToggleSwitchCassette.sbol",
    title: "SBOL 3.1 Genetic Toggle Switch Cassette",
    description:
      "Synthetic Biology Open Language RDF/XML design ordering Promoter, RBS, CDS, and Terminator SubComponents.",
    viewLabel: "SBOL 3.1 Genetic Construct Architecture",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<rdf:RDF xmlns:rdf="http://www.w3.org/1999/02/22-rdf-syntax-ns#"
         xmlns:sbol="http://sbols.org/v3#">
  <sbol:Component rdf:about="https://modelscript.org/sbol/ToggleCassette">
    <sbol:displayId>ToggleCassette</sbol:displayId>
    <sbol:type rdf:resource="https://identifiers.org/SBO:0000251"/>
    <sbol:role rdf:resource="http://identifiers.org/SO:0005850"/>
    <sbol:hasFeature>
      <sbol:SubComponent rdf:about="https://modelscript.org/sbol/ToggleCassette/sc_pTet">
        <sbol:displayId>sc_pTet</sbol:displayId>
        <sbol:instanceOf rdf:resource="https://modelscript.org/sbol/pTet_Promoter"/>
      </sbol:SubComponent>
    </sbol:hasFeature>
  </sbol:Component>
</rdf:RDF>`,
  },

  sedml: {
    filename: "GlycolysisExperiment.sedml",
    title: "SED-ML Level 1 Version 4 Reproducible Time-Course Protocol",
    description:
      "Simulation Experiment Description Markup Language protocol binding KiSAO:0000019 (CVODE) to an SBML pathway model.",
    viewLabel: "SED-ML Simulation Experiment Workflow",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<sedML xmlns="http://sed-ml.org/sed-ml/level1/version4" level="1" version="4">
  <listOfModels>
    <model id="model_glycolysis" language="urn:sedml:language:sbml" source="EnzymeFeedbackPathway.sbml"/>
  </listOfModels>
  <listOfSimulations>
    <uniformTimeCourse id="sim_timecourse" initialTime="0.0" outputStartTime="0.0" outputEndTime="120.0" numberOfSteps="600">
      <algorithm kisaoID="KISAO:0000019"/>
    </uniformTimeCourse>
  </listOfSimulations>
  <listOfTasks>
    <task id="task_baseline" modelReference="model_glycolysis" simulationReference="sim_timecourse"/>
  </listOfTasks>
</sedML>`,
  },

  opensim: {
    filename: "ElbowFlexionHill.osim",
    title: "OpenSim 4.0 Musculoskeletal Elbow Flexion & Hill-Type Muscle",
    description:
      "Biomechanical multibody model coupling humerus and radius-ulna rigid bodies via a revolute elbow joint and Thelen2003Muscle actuator.",
    viewLabel: "OpenSim Musculoskeletal Joint & Hill Muscle Topology",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<OpenSimDocument Version="40000">
  <Model name="ElbowFlexionModel">
    <gravity>0 -9.80665 0</gravity>
    <BodySet>
      <objects>
        <Body name="humerus"><mass>1.85</mass></Body>
        <Body name="radius_ulna"><mass>1.12</mass></Body>
      </objects>
    </BodySet>
    <JointSet>
      <objects>
        <PinJoint name="elbow_joint">
          <socket_parent_frame>humerus</socket_parent_frame>
          <socket_child_frame>radius_ulna</socket_child_frame>
        </PinJoint>
      </objects>
    </JointSet>
    <ForceSet>
      <objects>
        <Thelen2003Muscle name="biceps_brachii">
          <max_isometric_force>624.3</max_isometric_force>
          <optimal_fiber_length>0.1157</optimal_fiber_length>
          <tendon_slack_length>0.1923</tendon_slack_length>
        </Thelen2003Muscle>
      </objects>
    </ForceSet>
  </Model>
</OpenSimDocument>`,
  },

  "dicom-rt": {
    filename: "ProstateIMRTPlan.dcm.json",
    title: "DICOM-RT IMRT Treatment Plan & OAR Dose-Volume Constraints",
    description:
      "Radiation oncology treatment plan specifying PTV_7800 target prescription, OAR QUANTEC constraints, and 6 MV photon beams.",
    viewLabel: "DICOM-RT Beam Geometry & DVH Verification",
    code: `{
  "Modality": "RTPLAN",
  "RTPlanLabel": "PROSTATE_IMRT_78GY",
  "FractionGroupSequence": [
    {
      "FractionGroupNumber": 1,
      "NumberOfFractionsPlanned": 39,
      "TargetPrescriptionDoseGy": 78.0
    }
  ],
  "ROIContourSequence": [
    { "ROINumber": 1, "ROIName": "PTV_7800", "RTROIInterpretedType": "PTV", "VolumeCc": 94.2 },
    { "ROINumber": 2, "ROIName": "Rectum",   "RTROIInterpretedType": "ORGAN", "VolumeCc": 68.5 },
    { "ROINumber": 3, "ROIName": "Bladder",  "RTROIInterpretedType": "ORGAN", "VolumeCc": 182.0 }
  ],
  "BeamSequence": [
    { "BeamNumber": 1, "BeamName": "LAO_45", "RadiationType": "PHOTON", "BeamEnergyMeV": 6.0, "GantryAngleDeg": 45.0, "BeamMetersetMU": 142.5 }
  ]
}`,
  },

  cellml: {
    filename: "HodgkinHuxleyMembrane.cellml",
    title: "CellML 2.0 Cardiac & Excitable Membrane Action Potential",
    description:
      "Component-based physiological electrophysiology model enforcing strict dimensional units (mV, ms, uA_per_cm2, mS_per_cm2).",
    viewLabel: "CellML Component Encapsulation & Ion Channel Ports",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<model xmlns="http://www.cellml.org/cellml/2.0#" name="HodgkinHuxleyMembrane">
  <units name="ms"><unit prefix="milli" units="second"/></units>
  <units name="mV"><unit prefix="milli" units="volt"/></units>
  <component name="membrane">
    <variable name="t" units="ms" interface="public"/>
    <variable name="V" units="mV" initial_value="-75.0" interface="public"/>
    <variable name="Cm" units="dimensionless" initial_value="1.0"/>
    <variable name="I_ion" units="dimensionless" initial_value="0.0" interface="public"/>
  </component>
</model>`,
  },

  febio: {
    filename: "ArterialWallMooneyRivlin.feb",
    title: "FEBio 4.0 Hyperelastic Soft-Tissue Biomechanics",
    description:
      "Nonlinear finite element specification modeling uncoupled Mooney-Rivlin soft tissue under physiological intraluminal pressure.",
    viewLabel: "FEBio Hyperelastic Soft-Tissue Solver Pipeline",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<febio_spec version="4.0">
  <Module type="solid"/>
  <Control>
    <analysis>STATIC</analysis>
    <time_steps>20</time_steps>
    <step_size>0.05</step_size>
  </Control>
  <Material>
    <material id="1" name="ArterialMedia" type="Mooney-Rivlin">
      <density>1060.0</density>
      <c1>18.5e3</c1>
      <c2>4.2e3</c2>
      <k>2.5e6</k>
    </material>
  </Material>
</febio_spec>`,
  },

  nifti: {
    filename: "BrainT1wMNI152.nii.json",
    title: "NIfTI-1 Neuroimaging Volume & RAS+ Affine Registration",
    description:
      "3D T1-weighted MRI header manifest defining isotropic 1 mm voxel geometry and qform/sform affine world coordinate matrices.",
    viewLabel: "NIfTI Voxel Grid to RAS+ World Coordinate Transform",
    code: `{
  "sizeof_hdr": 348,
  "magic": "n+1",
  "datatype": "FLOAT32",
  "dim": [3, 192, 256, 256, 1, 1, 1, 1],
  "pixdim": [1.0, 1.0, 1.0, 1.0, 0.0, 0.0, 0.0, 0.0],
  "xyzt_units": ["mm", "sec"],
  "qform_code": 1,
  "sform_code": 4,
  "srow_x": [-1.0, 0.0, 0.0, 96.0],
  "srow_y": [0.0, 1.0, 0.0, -128.0],
  "srow_z": [0.0, 0.0, 1.0, -128.0]
}`,
  },

  topas: {
    filename: "ProtonBraggPeakWater.topas",
    title: "TOPAS 150 MeV Clinical Proton Beam & Water Phantom Scoring",
    description:
      "Monte Carlo radiation transport parameter file configuring a 150 MeV proton pencil beam and 300-bin Bragg peak depth-dose scorer.",
    viewLabel: "TOPAS Monte Carlo Geometry & Bragg Peak Scoring",
    code: `s:Ge/World/Material  = "Air"
d:Ge/World/HLX       = 50.0 cm
d:Ge/World/HLY       = 50.0 cm
d:Ge/World/HLZ       = 50.0 cm

s:Ge/WaterPhantom/Type     = "TsBox"
s:Ge/WaterPhantom/Parent   = "World"
s:Ge/WaterPhantom/Material = "G4_WATER"
d:Ge/WaterPhantom/HLX      = 15.0 cm
d:Ge/WaterPhantom/HLY      = 15.0 cm
d:Ge/WaterPhantom/HLZ      = 20.0 cm
i:Ge/WaterPhantom/ZBins    = 200

s:So/ProtonBeam/BeamParticle = "proton"
d:So/ProtonBeam/BeamEnergy   = 150.0 MeV
i:So/ProtonBeam/NumberOfHistoriesInRun = 100000

s:Sc/BraggPeakDose/Quantity  = "DoseToMedium"
s:Sc/BraggPeakDose/Component = "WaterPhantom"`,
  },

  "three-mf": {
    filename: "PatientMandibleGuide.3mf",
    title: "3MF Patient-Specific Ti-6Al-4V Surgical Cutting Guide",
    description:
      "Additive manufacturing package defining a watertight 2-manifold mesh with Euler-Poincare chi = 2 topology verification.",
    viewLabel: "3MF Watertight Manifold Mesh & Build Tray",
    code: `<?xml version="1.0" encoding="UTF-8"?>
<model unit="millimeter" xml:lang="en-US" xmlns="http://schemas.microsoft.com/3dmanufacturing/core/2015/02">
  <resources>
    <basematerials id="1">
      <base name="Ti-6Al-4V ELI (ASTM F136)" displaycolor="#94A3B8"/>
    </basematerials>
    <object id="2" name="MandibularCuttingGuide" type="model" pid="1" pindex="0">
      <mesh>
        <vertices>
          <vertex x="0.0"  y="0.0"  z="0.0"/>
          <vertex x="24.0" y="0.0"  z="0.0"/>
          <vertex x="12.0" y="20.0" z="0.0"/>
          <vertex x="12.0" y="8.0"  z="16.0"/>
        </vertices>
        <triangles>
          <triangle v1="0" v2="2" v3="1"/>
          <triangle v1="0" v2="1" v3="3"/>
          <triangle v1="1" v2="2" v3="3"/>
          <triangle v1="2" v2="0" v3="3"/>
        </triangles>
      </mesh>
    </object>
  </resources>
  <build><item objectid="2"/></build>
</model>`,
  },

  igtl: {
    filename: "CraniotomyNavSession.igtl.json",
    title: "OpenIGTLink v3 Optical Tracker & Robotic Hand-Eye Calibration",
    description:
      "Computer-assisted surgery navigation stream coupling optical tracker TRANSFORM frames, PivotTip calibration, and AX=XB hand-eye alignment.",
    viewLabel: "OpenIGTLink Surgical Coordinate Frame Chain",
    code: `{
  "protocolVersion": "3.0",
  "sessionName": "Craniotomy_OpticalNav_01",
  "coordinateFrames": [
    { "name": "TrackerBase", "parent": "World" },
    { "name": "PatientReferenceStar", "parent": "TrackerBase" },
    { "name": "SurgicalPointer", "parent": "TrackerBase" }
  ],
  "messages": [
    {
      "type": "TRANSFORM",
      "deviceName": "SurgicalPointerToTracker",
      "timestampNs": 1767225600125000000,
      "matrix4x4": [
        [0.9998, -0.0175, 0.0087, 124.50],
        [0.0175,  0.9998, 0.0052, -42.15],
        [-0.0088, -0.0050, 0.9999, 618.30],
        [0.0,     0.0,     0.0,    1.0]
      ]
    }
  ]
}`,
  },

  powerfactory: {
    filename: "IEEE9_RMS_Governing.dsl",
    title: "DIgSILENT PowerFactory DSL Speed Governor & DGS Grid Exchange",
    description:
      "PowerFactory DSL block definition with lim(), picdrop(), and select() intrinsics coupled to an ElmSym/ElmTr2/ElmLne DGS transmission network.",
    viewLabel: "PowerFactory DSL Block & DGS Grid Pipeline",
    code: `BlkDef 'IEEEG1_Gov'
  inc(wref = 1.0, pset = 0.85, K = 20.0, T1 = 0.1, T3 = 0.25)
  vardef(w) = 'Rotor Speed (p.u.)';
  vardef(pm) = 'Mechanical Power (p.u.)';
  limits(T1)[0.001, 10.0];

  dw = wref - w;
  xe = lim(K * dw + pset, 0.0, 1.05);
  x1. = (xe - x1) / T1;
  pm = select(x1 > 0.0, x1, 0.0);
end`,
  },

  pslf: {
    filename: "WECC_2Bus_Gencc.epc",
    title: "GE PSLF .epc Power Flow & .dyd GENCC / EXST1 Dynamic Deck",
    description:
      "WECC-standard GE PSLF EPC power flow deck with bus/branch/generator/transformer tables and DYD dynamic models (gencc, exst1, tgov1) lowered to the DAE arena.",
    viewLabel: "GE PSLF .epc / .dyd WECC Transmission Pipeline",
    code: `title
WECC 2-Bus 500 kV Benchmark (.epc + .dyd)
!
bus data
   1 "BUS1_GEN"  20.00  1   1.030   0.00   1   1
   2 "BUS2_LOAD" 500.0  2   0.995  -4.20   1   1
99999
branch data
   1 "BUS1_GEN" 20.0 2 "BUS2_LOAD" 500.0 "1 " 0.0015 0.0450 0.0800 600.0
99999
generator data
   1 "BUS1_GEN" 20.0 "1 " 1  450.0  150.0  300.0 -150.0 550.0 0.0 0.20
99999
load data
   2 "BUS2_LOAD" 500.0 "1 " 1  440.0  120.0  0.0  0.0  0.0  0.0
99999
end`,
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

function renderUsdStageSvg(_code: string, theme: "dark" | "light"): string {
  const isDark = theme === "dark";
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const panelBg = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#f8fafc" : "#0f172a";
  const muted = isDark ? "#94a3b8" : "#64748b";
  const cyan = isDark ? "#38bdf8" : "#0284c7";
  const emerald = "#10b981";
  const amber = "#f59e0b";
  const purple = isDark ? "#c084fc" : "#9333ea";

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 760 300" width="760" height="300" style="background-color: ${bg};">
  <rect x="0" y="0" width="760" height="300" fill="${bg}"/>

  <!-- Left Panel: 3D Digital Twin & UsdPhysics Kinematics -->
  <rect x="20" y="20" width="370" height="260" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="36" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">3D DIGITAL TWIN &amp; USDPHYSICS STAGE</text>

  <!-- Ground Plane Grid -->
  <line x1="50" y1="230" x2="350" y2="230" stroke="${border}" stroke-width="1" stroke-dasharray="4 4"/>
  <line x1="120" y1="250" x2="310" y2="190" stroke="${border}" stroke-width="1" stroke-dasharray="4 4"/>

  <!-- Base Link Cube: (mass = 12.5 kg) -->
  <polygon points="175,170 235,188 175,206 115,188" fill="${isDark ? "#1e3a8a" : "#bae6fd"}" stroke="${cyan}" stroke-width="1.8"/>
  <polygon points="115,188 175,206 175,236 115,218" fill="${isDark ? "#172554" : "#7dd3fc"}" stroke="${cyan}" stroke-width="1.8"/>
  <polygon points="235,188 175,206 175,236 235,218" fill="${isDark ? "#1e40af" : "#38bdf8"}" stroke="${cyan}" stroke-width="1.8"/>
  <text x="175" y="222" text-anchor="middle" fill="${isDark ? "#ffffff" : "#0f172a"}" font-family="Inter, sans-serif" font-size="10" font-weight="700">base_link</text>

  <!-- Revolute Joint Axis Indicator (Z-Axis) -->
  <ellipse cx="175" cy="160" rx="28" ry="10" fill="none" stroke="${amber}" stroke-width="1.8" stroke-dasharray="4 2"/>
  <polygon points="203,160 200,154 206,155" fill="${amber}"/>
  <line x1="175" y1="175" x2="175" y2="135" stroke="${amber}" stroke-width="2"/>
  <text x="214" y="164" fill="${amber}" font-family="Inter, sans-serif" font-size="9.5" font-weight="700">j1: axis="Z"</text>

  <!-- Link 1 Arm -->
  <polygon points="175,100 240,118 175,136 110,118" fill="${isDark ? "#065f46" : "#a7f3d0"}" stroke="${emerald}" stroke-width="1.8"/>
  <polygon points="110,118 175,136 175,150 110,132" fill="${isDark ? "#047857" : "#6ee7b7"}" stroke="${emerald}" stroke-width="1.8"/>
  <polygon points="240,118 175,136 175,150 240,132" fill="${isDark ? "#059669" : "#34d399"}" stroke="${emerald}" stroke-width="1.8"/>
  <text x="175" y="126" text-anchor="middle" fill="${isDark ? "#ffffff" : "#0f172a"}" font-family="Inter, sans-serif" font-size="10" font-weight="700">link_1 (4.8 kg)</text>

  <!-- Trajectory Arc with Keyframes -->
  <path d="M 175 100 Q 220 75 270 95" fill="none" stroke="${purple}" stroke-width="1.8" stroke-dasharray="3 3"/>
  <circle cx="175" cy="100" r="3.5" fill="${purple}"/>
  <circle cx="225" cy="85" r="3.5" fill="${purple}"/>
  <circle cx="270" cy="95" r="3.5" fill="${purple}"/>
  <text x="280" y="98" fill="${purple}" font-family="Inter, sans-serif" font-size="9.5" font-weight="600">t = [0.0, 0.5, 1.0] s</text>

  <!-- Stage Units & Coordinate Tokens -->
  <text x="36" y="260" fill="${muted}" font-family="Inter, sans-serif" font-size="9.5">metersPerUnit = 1.0 | upAxis = "Z"</text>

  <!-- Right Panel: Scenegraph Prim Hierarchy & Schemas -->
  <rect x="405" y="20" width="335" height="260" rx="10" fill="${panelBg}" stroke="${border}" stroke-width="1.5"/>
  <text x="421" y="44" fill="${muted}" font-family="Inter, sans-serif" font-size="10" font-weight="600" letter-spacing="0.06em">OPENUSD STAGE SCENEGRAPH &amp; APIS</text>

  <!-- Stage Root Prim -->
  <rect x="421" y="60" width="300" height="32" rx="6" fill="${bg}" stroke="${border}" stroke-width="1.2"/>
  <text x="435" y="80" fill="${text}" font-family="Inter, sans-serif" font-size="11" font-weight="700">def Xform "IndustrialArm"</text>
  <text x="705" y="80" text-anchor="end" fill="${cyan}" font-family="Inter, sans-serif" font-size="9.5">assembly</text>

  <!-- Branch to base_link -->
  <line x1="440" y1="92" x2="440" y2="114" stroke="${border}" stroke-width="1.5"/>
  <line x1="440" y1="114" x2="455" y2="114" stroke="${border}" stroke-width="1.5"/>
  <rect x="455" y="100" width="266" height="36" rx="6" fill="${bg}" stroke="${cyan}" stroke-width="1.2"/>
  <text x="467" y="117" fill="${cyan}" font-family="Inter, sans-serif" font-size="10.5" font-weight="700">base_link</text>
  <text x="467" y="130" fill="${muted}" font-family="Inter, sans-serif" font-size="9">PhysicsRigidBodyAPI | mass = 12.5 kg</text>

  <!-- Branch to link_1 -->
  <line x1="440" y1="114" x2="440" y2="158" stroke="${border}" stroke-width="1.5"/>
  <line x1="440" y1="158" x2="455" y2="158" stroke="${border}" stroke-width="1.5"/>
  <rect x="455" y="144" width="266" height="36" rx="6" fill="${bg}" stroke="${emerald}" stroke-width="1.2"/>
  <text x="467" y="161" fill="${emerald}" font-family="Inter, sans-serif" font-size="10.5" font-weight="700">link_1</text>
  <text x="467" y="174" fill="${muted}" font-family="Inter, sans-serif" font-size="9">PhysicsMassAPI | timeSamples trajectory</text>

  <!-- Branch to shoulder_joint -->
  <line x1="440" y1="158" x2="440" y2="202" stroke="${border}" stroke-width="1.5"/>
  <line x1="440" y1="202" x2="455" y2="202" stroke="${border}" stroke-width="1.5"/>
  <rect x="455" y="188" width="266" height="36" rx="6" fill="${bg}" stroke="${amber}" stroke-width="1.2"/>
  <text x="467" y="205" fill="${amber}" font-family="Inter, sans-serif" font-size="10.5" font-weight="700">PhysicsRevoluteJoint "shoulder_joint"</text>
  <text x="467" y="218" fill="${muted}" font-family="Inter, sans-serif" font-size="9">rel: base_link → link_1 | [−π, +π] rad</text>

  <!-- Lowering Badge -->
  <rect x="455" y="236" width="266" height="28" rx="6" fill="${isDark ? "#1e293b" : "#f1f5f9"}" stroke="${purple}" stroke-width="1"/>
  <text x="588" y="254" text-anchor="middle" fill="${purple}" font-family="Inter, sans-serif" font-size="10" font-weight="600">lowerUsdToDae: Lowers to DAE arena</text>
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

    case "usd":
      return {
        svgDark: renderUsdStageSvg(code, "dark"),
        svgLight: renderUsdStageSvg(code, "light"),
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

    case "oscal": {
      const data: DiagramData = {
        nodes: [
          makeNode({
            id: "ssp",
            label: "AvionicsSSP (1.1.2)",
            stereotype: "«system-security-plan»",
            x: 30,
            y: 50,
            width: 210,
            height: 86,
            stroke: "#38bdf8",
            sections: [{ header: "Metadata", entries: ["version = 2.1.0", "baseline = NIST-800-53-High"] }],
            ports: [{ id: "out", x: 210, y: 43, direction: "out" }],
          }),
          makeNode({
            id: "ctrl",
            label: "Control AC-2",
            stereotype: "«implemented-requirement»",
            x: 290,
            y: 50,
            width: 200,
            height: 86,
            stroke: "#f59e0b",
            sections: [{ header: "Control", entries: ["id = ac-2", "rbac = hardware-isolated"] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "out", x: 200, y: 43, direction: "out" },
            ],
          }),
          makeNode({
            id: "comp",
            label: "FlightControlComputer",
            stereotype: "«component:hardware»",
            x: 540,
            y: 50,
            width: 210,
            height: 86,
            stroke: "#10b981",
            sections: [{ header: "Status", entries: ["state = operational", "uuid = 11111111-..."] }],
            ports: [{ id: "in", x: 0, y: 43, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "ssp",
            sourcePort: "out",
            target: "ctrl",
            targetPort: "in",
            label: "enforces",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e2",
            source: "ctrl",
            sourcePort: "out",
            target: "comp",
            targetPort: "in",
            label: "by-component",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "qif": {
      const data: DiagramData = {
        nodes: [
          makeNode({
            id: "datum",
            label: "Datum A (ID=10)",
            stereotype: "«DatumDefinition»",
            x: 30,
            y: 50,
            width: 195,
            height: 86,
            stroke: "#38bdf8",
            sections: [{ header: "Reference", entries: ["label = A", "comp = ACTUAL"] }],
            ports: [{ id: "out", x: 195, y: 43, direction: "out" }],
          }),
          makeNode({
            id: "drf",
            label: "DRF_Primary (ID=12)",
            stereotype: "«DatumReferenceFrame»",
            x: 275,
            y: 50,
            width: 205,
            height: 86,
            stroke: "#8b5cf6",
            sections: [{ header: "Modifier", entries: ["material = NONE", "dof = 6-DOF locked"] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "out", x: 205, y: 43, direction: "out" },
            ],
          }),
          makeNode({
            id: "pos",
            label: "TruePosition (ID=20)",
            stereotype: "«PositionCharacteristic»",
            x: 530,
            y: 50,
            width: 215,
            height: 86,
            stroke: "#10b981",
            sections: [{ header: "GD&T Zone", entries: ["tol = 0.025 mm (MMC)", "zone = Diametrical"] }],
            ports: [{ id: "in", x: 0, y: 43, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "datum",
            sourcePort: "out",
            target: "drf",
            targetPort: "in",
            label: "constrains",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e2",
            source: "drf",
            sourcePort: "out",
            target: "pos",
            targetPort: "in",
            label: "DRF=12",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "automationml": {
      const data: DiagramData = {
        nodes: [
          makeNode({
            id: "cell",
            label: "AssemblyCell_01",
            stereotype: "«InstanceHierarchy»",
            x: 30,
            y: 50,
            width: 195,
            height: 86,
            stroke: "#8b5cf6",
            sections: [{ header: "CAEX 3.0", entries: ["version = 1.0.0", "std = AML 2.10"] }],
            ports: [{ id: "out", x: 195, y: 43, direction: "out" }],
          }),
          makeNode({
            id: "robot",
            label: "WeldingRobot_KR60",
            stereotype: "«InternalElement»",
            x: 275,
            y: 50,
            width: 210,
            height: 86,
            stroke: "#38bdf8",
            sections: [{ header: "Attributes", entries: ["PayloadKg = 60.0", "Port = 1002"] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "out", x: 210, y: 43, direction: "out" },
            ],
          }),
          makeNode({
            id: "plc",
            label: "CellController_PLC",
            stereotype: "«InternalElement»",
            x: 535,
            y: 50,
            width: 210,
            height: 86,
            stroke: "#10b981",
            sections: [{ header: "SafetyPLC", entries: ["ID = 2001", "MasterPort = 2002"] }],
            ports: [{ id: "in", x: 0, y: 43, direction: "in" }],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "cell",
            sourcePort: "out",
            target: "robot",
            targetPort: "in",
            label: "contains",
            stroke: "#8b5cf6",
          }),
          makeEdge({
            id: "e2",
            source: "robot",
            sourcePort: "out",
            target: "plc",
            targetPort: "in",
            label: "ProfinetLink_1",
            stroke: "#10b981",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "cgmes": {
      const data: DiagramData = {
        nodes: [
          makeNode({
            id: "gen",
            label: "Gen_Nuclear_1",
            stereotype: "«cim:SynchronousMachine»",
            x: 25,
            y: 30,
            width: 210,
            height: 86,
            stroke: "#f59e0b",
            sections: [{ header: "SSH Injection", entries: ["ratedS = 1350 MVA", "P = -1150 MW, Q = -220 MVAr"] }],
            ports: [{ id: "out", x: 210, y: 43, direction: "out" }],
          }),
          makeNode({
            id: "subA",
            label: "Substation_Alpha_380kV",
            stereotype: "«cim:TopologicalNode»",
            x: 280,
            y: 30,
            width: 215,
            height: 86,
            stroke: "#38bdf8",
            sections: [{ header: "TP / SV Bus", entries: ["TN_Alpha_380 (380 kV)", "V = 1.024 pu, angle = 0.0 deg"] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "out", x: 215, y: 43, direction: "out" },
              { id: "bot", x: 107, y: 86, direction: "out" },
            ],
          }),
          makeNode({
            id: "subB",
            label: "Substation_Beta_380kV",
            stereotype: "«cim:TopologicalNode»",
            x: 545,
            y: 30,
            width: 215,
            height: 86,
            stroke: "#10b981",
            sections: [{ header: "TP / SV Bus", entries: ["TN_Beta_380 (380 kV)", "V = 0.996 pu, angle = -4.8 deg"] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "bot", x: 107, y: 86, direction: "out" },
            ],
          }),
          makeNode({
            id: "xfmr",
            label: "AutoXfmr_380_220",
            stereotype: "«cim:PowerTransformer»",
            x: 280,
            y: 155,
            width: 215,
            height: 84,
            stroke: "#8b5cf6",
            sections: [{ header: "2-Winding Tap", entries: ["380/220 kV, 600 MVA", "uk = 12.4%, tap = 1.012"] }],
            ports: [
              { id: "top", x: 107, y: 0, direction: "in" },
              { id: "out", x: 215, y: 42, direction: "out" },
            ],
          }),
          makeNode({
            id: "load",
            label: "MetroHub_Beta_Load",
            stereotype: "«cim:EnergyConsumer»",
            x: 545,
            y: 155,
            width: 215,
            height: 84,
            stroke: "#ec4899",
            sections: [
              { header: "PQ Demand & Export", entries: ["P = 820 MW, Q = 195 MVAr", "PSS/E RAW + OpenIPSL .mo"] },
            ],
            ports: [
              { id: "top", x: 107, y: 0, direction: "in" },
              { id: "in", x: 0, y: 42, direction: "in" },
            ],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "gen",
            sourcePort: "out",
            target: "subA",
            targetPort: "in",
            label: "CB_101 (Closed)",
            stroke: "#f59e0b",
          }),
          makeEdge({
            id: "e2",
            source: "subA",
            sourcePort: "out",
            target: "subB",
            targetPort: "in",
            label: "TieLine 84.5 km",
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e3",
            source: "subA",
            sourcePort: "bot",
            target: "xfmr",
            targetPort: "top",
            label: "End 1 (380 kV)",
            stroke: "#8b5cf6",
          }),
          makeEdge({
            id: "e4",
            source: "subB",
            sourcePort: "bot",
            target: "load",
            targetPort: "top",
            label: "Feeder Bay",
            stroke: "#10b981",
          }),
          makeEdge({
            id: "e5",
            source: "xfmr",
            sourcePort: "out",
            target: "load",
            targetPort: "in",
            label: "220 kV Corridor",
            stroke: "#ec4899",
            dash: "5 3",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
    }

    case "ampl":
    case "optical":
    case "ran":
    case "fiber":
    case "gproms":
    case "cantera":
    case "phreeqc":
    case "smiles":
    case "antimony":
    case "bngl":
    case "genbank":
    case "nmtran":
    case "pdb":
    case "sbol":
    case "sedml":
    case "opensim":
    case "dicom-rt":
    case "cellml":
    case "febio":
    case "nifti":
    case "topas":
    case "three-mf":
    case "igtl":
    case "gtfs":
    case "ocpp":
    case "openadr":
    case "tough":
    case "hec-ras":
    case "modflow":
    case "landgem":
    case "powerfactory":
    case "pslf": {
      const spec = EXAMPLE_SPECS[slug]!;
      const domainMeta: Record<
        string,
        {
          n1: [string, string, string[]];
          n2: [string, string, string[]];
          n3: [string, string, string[]];
          n4: [string, string, string[]];
          n5: [string, string, string[]];
          e1: string;
          e2: string;
          e3: string;
          e4: string;
          e5: string;
        }
      > = {
        ampl: {
          n1: ["Supply Plants", "«ORIG Set»", ["Seattle = 350", "San_Diego = 600"]],
          n2: ["Trans[i, j]", "«Decision Vars»", ["Trans >= 0", "cost[i, j] freight"]],
          n3: ["Demand Markets", "«DEST Set»", ["NY = 325, Chi = 300", "Topeka = 275"]],
          n4: ["LP Solver", "«COIN-OR CLP»", ["Two-Phase Simplex", "Z* = 1707.50"]],
          n5: ["DAE / ASL .nl", "«Target Bridge»", ["writeNlProblem", "lowerAmplToDae"]],
          e1: "shipment",
          e2: "demand meet",
          e3: "optimal basis",
          e4: "sparsity A",
          e5: "solution",
        },
        optical: {
          n1: ["ROADM-NYC", "«Core WSS Node»", ["Degree 1 & 2 (96 ch)", "Colorless/Directionless"]],
          n2: ["In-Line EDFA", "«Optical Amp»", ["Gain = 20.0 dB", "NF = 5.5 dB"]],
          n3: ["ROADM-BOS", "«Terminal Node»", ["Degree 1 & 2 (96 ch)", "Demux / Transponders"]],
          n4: ["OTDR / .sor", "«Trace Analysis»", ["SR-4731 1550nm", "Loss = 0.22 dB/km"]],
          n5: ["GNPy / OSNR", "«GSNR Engine»", ["GSNR = 21.4 dB", "Q-factor verified"]],
          e1: "1550nm C-Band",
          e2: "amplified span",
          e3: "trace probe",
          e4: "non-linear phase",
          e5: "BER & margins",
        },
        ran: {
          n1: ["BaseStation", "«eNodeB / gNodeB»", ["Freq = 1900 MHz", "Pout = 43 dBm"]],
          n2: ["Antenna Array", "«Dual-Pol 65deg»", ["Gain = 18.0 dBi", "Tilt = 2.0 deg elect"]],
          n3: ["Cell Coverage", "«RF Footprint»", ["3GPP 38.901 UMa", "RSRP >= -95 dBm"]],
          n4: ["NSMA .adf", "«WG16 Pattern»", ["Azimuth 3dB = 65°", "Elevation 3dB = 7°"]],
          n5: ["Link Budget", "«CINR & Throughput»", ["SINR = 19.8 dB", "CQI-15 256-QAM"]],
          e1: "feeder loss",
          e2: "beamforming",
          e3: "pattern cut",
          e4: "downtilt tilt",
          e5: "cell throughput",
        },
        fiber: {
          n1: ["Central Office", "«ODF Optical Frame»", ["CO_MIDTOWN", "Patch 1-144"]],
          n2: ["Feeder Cable", "«TIA-598-D 144F»", ["12 Buffer Tubes", "Loose tube SMF-28"]],
          n3: ["Splice Closure", "«FST Enclosure»", ["FST_LEXINGTON", "Fusion splice trays"]],
          n4: ["Color Engine", "«Strand Registry»", ["Tube 1: Blue", "Strand 1: Blue"]],
          n5: ["SRLG Graph", "«Route Diversity»", ["Zero shared conduit", "Dual-homed link"]],
          e1: "distribution",
          e2: "enclosure drop",
          e3: "color lookup",
          e4: "trace strand",
          e5: "SRLG verify",
        },
        gproms: {
          n1: ["FeedStream", "«gPROMS Port»", ["Cin = 2.0 kmol/m3", "Tin = 300.0 K"]],
          n2: ["ExothermicCSTR", "«gPROMS Model»", ["r_A = k0*exp(-Ea/RT)*Ca", "V = 2.5 m3"]],
          n3: ["DAE Arena Solver", "«BDF Stiff Solver»", ["states = [Ca, T]", "alg = [r_A]"]],
          n4: ["CoolingJacket", "«Energy Balance»", ["UA = 4.8 kW/K", "Tc = 292.0 K"]],
          n5: ["Modelica / FMU", "«Target Projection»", ["Method of Lines", "Index-1 verified"]],
          e1: "F = 1.2 m3/s",
          e2: "lowerToDAE",
          e3: "heat removal",
          e4: "thermal coupling",
          e5: "export DAE",
        },
        cantera: {
          n1: ["h2_air_mix", "«ideal_gas»", ["T = 1200 K", "P = 101325 Pa"]],
          n2: ["ElementaryRxns", "«Arrhenius Network»", ["H + O2 <=> O + OH", "O + H2 <=> H + OH"]],
          n3: ["IgnitionDelay", "«ODE Integrator»", ["species = 7", "reactions = 3"]],
          n4: ["NASA-7 Polynomials", "«Thermo Database»", ["Cp(T), H(T), S(T)", "T_mid = 1000 K"]],
          n5: ["Zero-D Reactor", "«Sensitivity & Eigen»", ["t_ign = 0.18 ms", "stiff Jacobian"]],
          e1: "mixture state",
          e2: "net production",
          e3: "K_eq(T)",
          e4: "enthalpy flux",
          e5: "trajectory",
        },
        phreeqc: {
          n1: ["SOLUTION 1", "«Aqueous Phase»", ["pH = 7.35, T = 25 C", "Ca = 1.85 mmol/kgw"]],
          n2: ["EQUILIBRIUM_PHASES", "«Mineral Buffer»", ["Calcite (SI = 0.0)", "CO2(g) (logP = -2.1)"]],
          n3: ["SpeciationResult", "«Newton-Raphson»", ["charge balance", "ionic strength I"]],
          n4: ["Davies / Debye", "«Activity Model»", ["gamma_i(I, z_i)", "I = 0.0058 mol/kgw"]],
          n5: ["Saturation Index", "«Scaling Forecast»", ["SI = log10(IAP/Ksp)", "Calcite & Dolomite"]],
          e1: "mass action",
          e2: "equilibrate",
          e3: "activity coeff",
          e4: "ion pairing",
          e5: "SI report",
        },
        smiles: {
          n1: ["OpenSMILES", "«Chemical Graph»", ["CC(=O)Oc1ccccc1C(=O)O", "Aspirin (MW = 180.16)"]],
          n2: ["Valence & Rings", "«Huckel 4n+2»", ["ring = 6-membered", "chiral = R/S verified"]],
          n3: ["Lipinski Ro5", "«ADMET Profile»", ["LogP = 1.19", "HBD = 1, HBA = 4"]],
          n4: ["Joback Groups", "«Thermo Estimation»", ["Tb = 408.2 K", "Tc = 635.0 K, Pc = 38 bar"]],
          n5: ["QSAR & SDF V2000", "«3D Conformer»", ["TPSA = 63.6 A^2", "0 Ro5 violations"]],
          e1: "parse graph",
          e2: "descriptors",
          e3: "fragmentation",
          e4: "group additivity",
          e5: "property card",
        },
        antimony: {
          n1: ["TetR_Module", "«Transcriptional»", ["p_TetR -| m_cI", "Hill n = 2.0"]],
          n2: ["cI_Module", "«Transcriptional»", ["p_cI -| m_LacI", "alpha = 216.0"]],
          n3: ["LacI_Module", "«Transcriptional»", ["p_LacI -| m_TetR", "beta = 0.2"]],
          n4: ["mRNA Pool", "«Degradation Kinetics»", ["k_deg = 0.012 s^-1", "ribosome binding"]],
          n5: ["Limit-Cycle ODE", "«SBML / DAE Target»", ["period = 148 min", "sustained oscillation"]],
          e1: "represses cI",
          e2: "represses LacI",
          e3: "transcribes",
          e4: "translates",
          e5: "represses TetR",
        },
        bngl: {
          n1: ["EGF(r) + EGFR(l,d)", "«Seed Species»", ["EGF = 1200", "EGFR = 1000"]],
          n2: ["R_Bind & R_Dimer", "«Reaction Rules»", ["kp1 = 1e-3, km1 = 0.1", "kp2 = 5e-3, km2 = 0.05"]],
          n3: ["EGFR(d!+,Y1068~P)", "«Phosphorylated»", ["k_p = 1.20 s^-1", "Rule-based ODE/SSA"]],
          n4: ["Grb2(sh2,sh3) + SOS", "«Adaptor Complex»", ["Grb2 recruitment", "Y1068~P docking"]],
          n5: ["Expanded Network", "«24 Species / 68 Rxns»", ["Observable Dimers", "Gillespie SSA / CVODE"]],
          e1: "ligand bind",
          e2: "trans-phos",
          e3: "SH2 docking",
          e4: "complexation",
          e5: "emit observables",
        },
        genbank: {
          n1: ["T7_promoter", "«promoter 1..20»", ["inducible T7-lac", "RBS = 25..36"]],
          n2: ["gfp (CDS)", "«CDS 43..150»", ["codon_start = 1", "His6-GFP fusion"]],
          n3: ["T7_terminator", "«terminator 155..180»", ["180 bp circular", "ORF validated"]],
          n4: ["Restriction Map", "«Endonuclease Cut»", ["EcoRI, BamHI, NotI", "zero internal cuts"]],
          n5: ["SBOL3 / AA Translation", "«Protein Sequence»", ["CAI = 0.84 (E. coli)", "MW = 26.9 kDa"]],
          e1: "transcription",
          e2: "termination",
          e3: "digest check",
          e4: "ORF frame +1",
          e5: "export SBOL3",
        },
        nmtran: {
          n1: ["Depot (Gut)", "«Compartment 1»", ["KA = THETA(5)*exp(ETA3)", "Oral bolus dose"]],
          n2: ["Central (Plasma)", "«Compartment 2»", ["CL = 4.5 L/h, V2 = 32 L", "WT allometric 0.75"]],
          n3: ["Peripheral", "«Compartment 3»", ["Q = 2.8 L/h, V3 = 48 L", "FOCE-I estimation"]],
          n4: ["Covariate Model", "«Allometric Scaling»", ["CRCL renal clearance", "OMEGA 3x3 IIV block"]],
          n5: ["Plasma PK Profile", "«Emax PD & AUC»", ["Cp = A2 / V2", "Proportional + Add Err"]],
          e1: "ka absorption",
          e2: "Q inter-comp",
          e3: "THETA/ETA",
          e4: "CL elimination",
          e5: "Cmax & AUC0-inf",
        },
        pdb: {
          n1: ["HELIX H1", "«Secondary Structure»", ["ALA A 1 .. ALA A 5", "Right-handed alpha"]],
          n2: ["Backbone Coordinates", "«ATOM 1..5»", ["N-CA-C-O peptide", "B-factor = 14.2 A^2"]],
          n3: ["Ramachandran Check", "«Steric Validation»", ["phi/psi allowed", "no steric clashes"]],
          n4: ["Contact Kirchoff", "«GNM / ANM Network»", ["cutoff Rc = 7.0 A", "spring gamma = 1.0"]],
          n5: ["B-Factor & Modes", "«Normal Mode Analysis»", ["low-freq fluctuations", "RMSD = 0.42 A"]],
          e1: "covalent",
          e2: "dihedral angles",
          e3: "CA-CA distance",
          e4: "Hessian eigen",
          e5: "steric QA pass",
        },
        sbol: {
          n1: ["pTet_Promoter", "«sbol:SubComponent»", ["SO:0000167", "TetR repressible"]],
          n2: ["ToggleCassette", "«sbol:Component»", ["SBO:0000251 (DNA)", "SO:0005850 cassette"]],
          n3: ["GFP_Reporter", "«sbol:Sequence»", ["IUPAC nucleotide", "SBOL 3.1 RDF/XML"]],
          n4: ["RepressionInteraction", "«SBO:0000169»", ["TetR -| pTet", "K_d = 12.5 nM, n = 2"]],
          n5: ["SBML Hill ODE", "«Projected Model»", ["d[GFP]/dt synthesis", "Provenance verified"]],
          e1: "hasFeature",
          e2: "encodes",
          e3: "participatesIn",
          e4: "regulates",
          e5: "lowerToSBML",
        },
        sedml: {
          n1: ["model_glycolysis", "«sedML:model»", ["urn:sedml:language:sbml", "EnzymeFeedbackPathway"]],
          n2: ["sim_timecourse", "«uniformTimeCourse»", ["KISAO:0000019 (CVODE)", "t = 0..120 (600 steps)"]],
          n3: ["task_baseline", "«sedML:task»", ["DataGenerators", "Reproducible Plot2D"]],
          n4: ["ChangeAttribute", "«Model Perturbation»", ["Vmax_PFK = 1.85", "ATP inhibition sweep"]],
          n5: ["COMBINE Archive", "«OMEX / CSV Output»", ["NADH & Pyruvate curves", "Bit-exact trajectory"]],
          e1: "modelRef",
          e2: "simulationRef",
          e3: "listOfChanges",
          e4: "executes",
          e5: "emits report",
        },
        opensim: {
          n1: ["humerus", "«OpenSim Body»", ["mass = 1.85 kg", "parent frame"]],
          n2: ["elbow_joint", "«PinJoint (1-DOF)»", ["coord = elbow_flexion", "range = [0, 2.44 rad]"]],
          n3: ["biceps_brachii", "«Thelen2003Muscle»", ["Fmax = 624.3 N", "Lopt = 0.1157 m"]],
          n4: ["ActivationDynamics", "«Excitation u(t)»", ["tau_act = 10 ms", "tau_deact = 40 ms"]],
          n5: ["Inverse Dynamics", "«Joint Moment & EMG»", ["moment arm r(q)", "Featherstone M(q)qdd"]],
          e1: "articulates",
          e2: "actuates",
          e3: "neural drive",
          e4: "Hill force-vel",
          e5: "net torque",
        },
        "dicom-rt": {
          n1: ["LAO_45 Beam", "«6 MV Photon IMRT»", ["Gantry = 45.0 deg", "Meterset = 142.5 MU"]],
          n2: ["PTV_7800 Target", "«Prescription 78 Gy»", ["39 fractions (2 Gy/fx)", "Vol = 94.2 cc"]],
          n3: ["OAR DVH & Gamma", "«QUANTEC QA»", ["Rectum & Bladder", "3%/3mm Pass = 99.4%"]],
          n4: ["RTDOSE 3D Grid", "«DoseGridScaling»", ["2.0 mm isotropic", "D95 = 76.8 Gy, D2 = 80.4 Gy"]],
          n5: ["LQ Biological Dose", "«BED & EQD2»", ["alpha/beta = 3.0 Gy", "EQD2 = 78.0 Gy verified"]],
          e1: "fluences",
          e2: "DVH evaluation",
          e3: "convolves dose",
          e4: "voxel histogram",
          e5: "QUANTEC pass",
        },
        cellml: {
          n1: ["Units Registry", "«CellML 2.0 Units»", ["ms = 1e-3 s", "mV = 1e-3 V"]],
          n2: ["membrane", "«CellML Component»", ["V_init = -75.0 mV", "Cm = 1.0 uF/cm2"]],
          n3: ["ActionPotential", "«ODE Solver»", ["dV/dt = -I_ion / Cm", "public port encapsulation"]],
          n4: ["Na & K Channels", "«Hodgkin-Huxley Gates»", ["m^3*h*g_Na*(V-E_Na)", "n^4*g_K*(V-E_K)"]],
          n5: ["DAE Arena Lowering", "«BDF / CVODE Target»", ["APD90 = 245 ms", "Zero unit mismatches"]],
          e1: "dimensional check",
          e2: "integrate ODE",
          e3: "gating kinetics",
          e4: "ionic current I_ion",
          e5: "voltage trace",
        },
        febio: {
          n1: ["ArterialMedia", "«Mooney-Rivlin»", ["c1 = 18.5 kPa", "c2 = 4.2 kPa, k = 2.5 MPa"]],
          n2: ["SolidModule", "«FEBio 4.0 Static»", ["dt = 0.05 (20 steps)", "Incompressible J ~ 1"]],
          n3: ["CauchyStress", "«Biomechanical Response»", ["stretch lambda = 1..1.4", "strain energy W"]],
          n4: ["Hex8 Vessel Mesh", "«Boundary Conditions»", ["Lumen P = 16.0 kPa", "Axial stretch = 1.15"]],
          n5: ["Nonlinear Newton", "«BFGS / Quasi-Newton»", ["sigma_vm = 142 kPa", "Positive-definite tangent"]],
          e1: "constitutive",
          e2: "stress tensor",
          e3: "discretizes",
          e4: "virtual work",
          e5: "converged state",
        },
        nifti: {
          n1: ["Voxel Grid (i,j,k)", "«NIfTI-1 FLOAT32»", ["dim = 192 x 256 x 256", "pixdim = 1.0 mm iso"]],
          n2: ["sform Affine", "«sform_code = 4»", ["MNI152 stereotactic", "det(A) = -1.0 mm^3"]],
          n3: ["RAS+ World (x,y,z)", "«Neuroimaging Space»", ["Right-Anterior-Superior", "FOV = 192x256x256 mm"]],
          n4: ["Quaternion qform", "«Rigid Orientation»", ["qb, qc, qd unit norm", "qfac = 1.0 handedness"]],
          n5: ["Marching Cubes Surface", "«3MF / STL Iso-Mesh»", ["Hounsfield threshold", "Watertight anatomy"]],
          e1: "A * [i,j,k,1]^T",
          e2: "spatial registration",
          e3: "qform check",
          e4: "orthonormal R",
          e5: "extract mesh",
        },
        topas: {
          n1: ["ProtonBeam", "«150 MeV Source»", ["Particle = proton", "Histories = 100,000"]],
          n2: ["WaterPhantom", "«TsBox G4_WATER»", ["HLZ = 20.0 cm", "ZBins = 200"]],
          n3: ["BraggPeakDose", "«DoseToMedium»", ["R80 = 15.77 cm", "Bethe-Bloch LET"]],
          n4: ["RangeModulator", "«SOBP Wheel / Nozzle»", ["Snout pos = 18.0 cm", "Energy spread = 0.8%"]],
          n5: ["Bortfeld Analytical", "«Depth-Dose Curve»", ["Peak-to-plateau = 4.6", "Distal falloff = 3.2 mm"]],
          e1: "transport",
          e2: "score depth-dose",
          e3: "collimates",
          e4: "stopping power",
          e5: "DICOM-RT export",
        },
        "three-mf": {
          n1: ["Ti-6Al-4V ELI", "«ASTM F136 Material»", ["id = 1", "surgical grade alloy"]],
          n2: ["CuttingGuide Mesh", "«2-Manifold Object»", ["V = 4, E = 6, F = 4", "Euler chi = 2"]],
          n3: ["Build Tray", "«3MF Build Item»", ["watertight = true", "zero non-manifold edges"]],
          n4: ["K-Wire Drill Sleeve", "«Cylindrical Datum»", ["Clearance = +0.15 mm", "Min wall = 2.4 mm"]],
          n5: ["Sterilization & Print", "«ISO/ASTM 52915 QA»", ["Positive volume", "Outward normals verified"]],
          e1: "assigns material",
          e2: "places on bed",
          e3: "boolean guide",
          e4: "half-edge check",
          e5: "ready to print",
        },
        igtl: {
          n1: ["TrackerBase", "«Optical Camera»", ["World reference", "6-DOF optical tracking"]],
          n2: ["SurgicalPointer", "«TRANSFORM Stream»", ["t = [124.5, -42.2, 618.3]", "SO(3) ortho verified"]],
          n3: ["Pivot & Hand-Eye", "«AX = XB Calibration»", ["Pivot RMS < 0.35 mm", "Real-time CAS nav"]],
          n4: ["Fiducial Markers", "«Patient Registration»", ["N = 6 skull fiducials", "FLE = 0.25 mm iso"]],
          n5: ["Fitzpatrick TRE", "«Target Error Bound»", ["TRE_tip = 0.48 mm", "120 Hz stream active"]],
          e1: "T_tracker_pointer",
          e2: "calibrate tip",
          e3: "locates fiducials",
          e4: "SVD registration",
          e5: "TRE safety gate",
        },
        gtfs: {
          n1: ["Transit Agency", "«GTFS Feed»", ["agency.txt & routes.txt", "12 express corridors"]],
          n2: ["Timetable Graph", "«stop_times.txt»", ["headway = 10 min", "trips & frequencies"]],
          n3: ["Fleet Battery DAE", "«Electric Buses»", ["SoC = 45..90%", "peak traction kW"]],
          n4: ["Depot Chargers", "«Smart Charging»", ["150 kW DC Fast", "demand response gate"]],
          n5: ["Transit Sim DAE", "«Modelica / DAE»", ["on-time reliability", "energy consumption"]],
          e1: "schedules",
          e2: "dispatches",
          e3: "charges",
          e4: "grid load",
          e5: "lowerToDAE",
        },
        ocpp: {
          n1: ["Charging Station", "«OCPP 2.0.1 CSMS»", ["Dual CCS2 Dispensers", "ISO 15118 PnC"]],
          n2: ["Transaction Event", "«Smart Charging»", ["TxStarted / MeterValues", "P_limit = 120 kW"]],
          n3: ["Vehicle Battery", "«EV Equivalent Ckt»", ["Capacity = 77 kWh", "SoC target = 80%"]],
          n4: ["Depot Transformer", "«Substation Feeder»", ["Peak 630 kVA limit", "Grid curtailment"]],
          n5: ["DAE Coupled Sim", "«Modelica Target»", ["thermal throttling", "voltage stability"]],
          e1: "authorizes",
          e2: "meter values",
          e3: "power profile",
          e4: "transformer load",
          e5: "lowerToDAE",
        },
        openadr: {
          n1: ["VTN Server", "«OpenADR 2.0b VTN»", ["Demand Response Node", "OASIS EI Event"]],
          n2: ["VEN Client", "«Facility VEN»", ["EiEvent / EiReport", "HTTP/XMPP payload"]],
          n3: ["Curtailment Plan", "«Shed Strategy»", ["HVAC setback = +2°C", "Load drop = 250 kW"]],
          n4: ["BTM Battery & PV", "«Flexibility Asset»", ["500 kWh BESS", "solar firming"]],
          n5: ["Grid Stability DAE", "«DAE Arena Lowering»", ["spinning reserve", "ancillary services"]],
          e1: "distributeEvent",
          e2: "optIn / optOut",
          e3: "telemetry report",
          e4: "dispatch BESS",
          e5: "verifyResponse",
        },
        tough: {
          n1: ["Geothermal Reservoir", "«TOUGH2 / EOS1»", ["Perm = 50 mD", "Porosity = 0.15"]],
          n2: ["Grid Mesh", "«Voronoi Elements»", ["3D Radial Discretization", "Volume = 2500 m3"]],
          n3: ["Darcy Multiphase", "«Mass & Heat Flux»", ["Liquid & Steam", "P = 8.5 MPa, T = 260°C"]],
          n4: ["Production Well", "«Wellbore Hydr»", ["Mass flow = 45 kg/s", "Enthalpy = 1150 kJ/kg"]],
          n5: ["Flash Simulator", "«DAE / Power Cycle»", ["Double-Flash Turbine", "Net Output = 12.5 MW"]],
          e1: "geometric mesh",
          e2: "phase flux",
          e3: "well inflow",
          e4: "steam extraction",
          e5: "lowerToDAE",
        },
        "hec-ras": {
          n1: ["River Reach", "«HEC-RAS Geometry»", ["River: Pine Creek", "Reach: Lower Reach"]],
          n2: ["Upstream XS", "«Cross Section 102»", ["Bank stations 45..120", "Manning n = 0.035"]],
          n3: ["Downstream XS", "«Cross Section 101»", ["Bed slope S0 = 0.0015", "Expansion coeff = 0.3"]],
          n4: ["Standard Step DAE", "«Energy & Momentum»", ["Q = 145.0 m3/s", "Subcritical Froude < 1"]],
          n5: ["Flood Inundation", "«Surface Elevation»", ["WSE = 104.82 m", "Zero overbank hazard"]],
          e1: "reach connect",
          e2: "friction slope",
          e3: "backwater step",
          e4: "energy balance",
          e5: "flood boundary",
        },
        modflow: {
          n1: ["Aquifer Domain", "«MODFLOW-6 DIS»", ["3 Layers, Unconfined", "Kh = 25 m/d, Kv = 2.5 m/d"]],
          n2: ["Structured Grid", "«Finite Difference»", ["50x50 cells (100m)", "Top = 50m, Bot = 10m"]],
          n3: ["Pumping Wells", "«WEL Package»", ["Well 1: Q = -1200 m3/d", "Drawdown cone"]],
          n4: ["River Boundary", "«RIV Package»", ["Stage = 42m, Rbot = 39m", "Conductance = 250 m2/d"]],
          n5: ["Darcy Head DAE", "«Transient Flow»", ["Head field h(x,y,t)", "Mass balance error < 0.1%"]],
          e1: "spatial mesh",
          e2: "well discharge",
          e3: "river seepage",
          e4: "hydraulic head",
          e5: "lowerToDAE",
        },
        landgem: {
          n1: ["Landfill Facility", "«LandGEM 3.03»", ["Annual Waste Tonnage", "Open: 2010, Close: 2035"]],
          n2: ["Methane Parameters", "«EPA AP-42 Reg»", ["Lo = 100 m3/Mg", "k = 0.040 yr^-1 (CAA)"]],
          n3: ["Decay Equation", "«First-Order ODE»", ["Q_CH4 = 2*k*Lo*M*e^-kt", "Peak Year: 2036"]],
          n4: ["Gas Recovery", "«Extraction Wellfield»", ["Capture eff = 85%", "Flare destruction = 99%"]],
          n5: ["Biogas CHP DAE", "«DAE / Energy Model»", ["P_elec = 1.8 MW", "Avoided CO2e metric"]],
          e1: "inventory",
          e2: "kinetics",
          e3: "methane yield",
          e4: "wellfield capture",
          e5: "chp generation",
        },
        powerfactory: {
          n1: ["BlkDef 'IEEEG1'", "«PowerFactory DSL»", ["inc(wref, pset, K, T1)", "vardef(w, pm)"]],
          n2: ["DSL Intrinsics", "«lim / picdrop / select»", ["x1. = (xe - x1) / T1", "limits(T1)[0.001, 10]"]],
          n3: ["DGS Network", "«ElmSym / ElmTr2»", ["ElmTerm & ElmLne", "AC Load Flow"]],
          n4: ["Composite Frame", "«BlkDef Frame Slots»", ["AVR + Gov + PSS", "Signal wiring"]],
          n5: ["DAE / PSS/E / Modelica", "«Target Bridge»", ["compilePowerFactoryDsl", "exportDgsToPsseRaw"]],
          e1: "parse & lint",
          e2: "couple grid",
          e3: "slot binding",
          e4: "RMS equations",
          e5: "lowerToDAE",
        },
        pslf: {
          n1: ["WECC .epc Deck", "«GE PSLF Powerflow»", ["bus / branch / gen", "500 kV transmission"]],
          n2: [".dyd Dynamics", "«GENCC / EXST1 / TGOV1»", ["PSS2A stabilizer", "REEC_A / REGCA IBR"]],
          n3: ["Newton Powerflow", "«Sparse AC Solver»", ["V = 1.030 pu, 0.0 deg", "P_load = 440 MW"]],
          n4: ["Transient DAE", "«Swing & Flux ODEs»", ["H = 3.5 s, D = 2.0", "Subtransient X''d"]],
          n5: ["PSS/E .raw / Modelica", "«Bidirectional Bridge»", ["exportEpcToPsseRaw", "exportPslfToModelica"]],
          e1: "couple .dyd",
          e2: "solve Ybus",
          e3: "initialize states",
          e4: "integrate RMS",
          e5: "export deck",
        },
      };
      const meta = domainMeta[slug] ?? {
        n1: [spec.filename, "«Source Artifact»", [`slug = ${slug}`]],
        n2: [spec.title.slice(0, 22), "«Semantic AST»", ["WASM GLR + Lint"]],
        n3: ["Verified Output", "«ModelScript Pipeline»", ["Digital Thread"]],
        n4: ["Domain Constraints", "«Static & Unit Rules»", ["Zero diagnostics"]],
        n5: ["DAE & Projections", "«Downstream Target»", ["Simulation ready"]],
        e1: "parse & index",
        e2: "lower model",
        e3: "lint rules",
        e4: "couple constraints",
        e5: "verify & export",
      };
      const data: DiagramData = {
        nodes: [
          makeNode({
            id: "n1",
            label: meta.n1[0],
            stereotype: meta.n1[1],
            x: 25,
            y: 30,
            width: 210,
            height: 86,
            stroke: "#38bdf8",
            sections: [{ header: "Inputs & Spec", entries: meta.n1[2] }],
            ports: [
              { id: "out", x: 210, y: 43, direction: "out" },
              { id: "bot", x: 105, y: 86, direction: "out" },
            ],
          }),
          makeNode({
            id: "n2",
            label: meta.n2[0],
            stereotype: meta.n2[1],
            x: 280,
            y: 30,
            width: 215,
            height: 86,
            stroke: "#8b5cf6",
            sections: [{ header: "Core Formulation", entries: meta.n2[2] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "out", x: 215, y: 43, direction: "out" },
              { id: "bot", x: 107, y: 86, direction: "in" },
            ],
          }),
          makeNode({
            id: "n3",
            label: meta.n3[0],
            stereotype: meta.n3[1],
            x: 545,
            y: 30,
            width: 215,
            height: 86,
            stroke: "#10b981",
            sections: [{ header: "Solver & Analysis", entries: meta.n3[2] }],
            ports: [
              { id: "in", x: 0, y: 43, direction: "in" },
              { id: "bot", x: 107, y: 86, direction: "out" },
            ],
          }),
          makeNode({
            id: "n4",
            label: meta.n4[0],
            stereotype: meta.n4[1],
            x: 150,
            y: 155,
            width: 225,
            height: 84,
            stroke: "#f59e0b",
            sections: [{ header: "Coupled Subsystem", entries: meta.n4[2] }],
            ports: [
              { id: "top", x: 60, y: 0, direction: "in" },
              { id: "topOut", x: 175, y: 0, direction: "out" },
              { id: "out", x: 225, y: 42, direction: "out" },
            ],
          }),
          makeNode({
            id: "n5",
            label: meta.n5[0],
            stereotype: meta.n5[1],
            x: 455,
            y: 155,
            width: 235,
            height: 84,
            stroke: "#ec4899",
            sections: [{ header: "Verified Output", entries: meta.n5[2] }],
            ports: [
              { id: "in", x: 0, y: 42, direction: "in" },
              { id: "top", x: 155, y: 0, direction: "in" },
            ],
          }),
        ],
        edges: [
          makeEdge({
            id: "e1",
            source: "n1",
            sourcePort: "out",
            target: "n2",
            targetPort: "in",
            label: meta.e1,
            stroke: "#38bdf8",
          }),
          makeEdge({
            id: "e2",
            source: "n2",
            sourcePort: "out",
            target: "n3",
            targetPort: "in",
            label: meta.e2,
            stroke: "#10b981",
          }),
          makeEdge({
            id: "e3",
            source: "n1",
            sourcePort: "bot",
            target: "n4",
            targetPort: "top",
            label: meta.e3,
            stroke: "#f59e0b",
          }),
          makeEdge({
            id: "e4",
            source: "n4",
            sourcePort: "topOut",
            target: "n2",
            targetPort: "bot",
            label: meta.e4,
            stroke: "#8b5cf6",
          }),
          makeEdge({
            id: "e5",
            source: "n3",
            sourcePort: "bot",
            target: "n5",
            targetPort: "top",
            label: meta.e5,
            stroke: "#ec4899",
          }),
        ],
        coordinateSystem: null,
        diagramBackground: null,
      };
      return renderBothThemesFromDiagramData(data);
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
