// SPDX-License-Identifier: AGPL-3.0-or-later

import { createCanonicalPolyglotDemoBoard, type CanvasDocument, type DiagramMarkupNode } from "@modelscript/canvas";
import { buildRotundaCanvasDocument, type RotundaModelEntry, type RotundaScenarioPreset } from "./types.js";

// ── Curated 9 Multi-Part 3D Showcase Assemblies ─────────────────────────────

const SHOWCASE_ACTUATOR: RotundaModelEntry = {
  id: "showcase-actuator",
  title: "Robotic Harmonic Servo Actuator",
  subtitle: "STEP B-Rep Multi-Body Assembly",
  kind: "cad",
  sourceTileId: "tile_step",
  accentColor: "#38bdf8",
};

const SHOWCASE_ROBOT_ARM: RotundaModelEntry = {
  id: "showcase-robot-arm",
  title: "4-DOF Industrial Robot Arm",
  subtitle: "URDF Articulated Kinematics",
  kind: "urdf",
  accentColor: "#f59e0b",
};

const SHOWCASE_DRONE: RotundaModelEntry = {
  id: "showcase-drone",
  title: "Autonomous Hexacopter UAV",
  subtitle: "6-Rotor Attitude & Aero Twin",
  kind: "drone",
  accentColor: "#22c55e",
};

const SHOWCASE_WIND_TURBINE: RotundaModelEntry = {
  id: "showcase-wind-turbine",
  title: "5 MW Wind Turbine & Gearbox",
  subtitle: "Aero-Elastic Nacelle & Drivetrain",
  kind: "wind-turbine",
  accentColor: "#10b981",
};

const SHOWCASE_SATELLITE: RotundaModelEntry = {
  id: "showcase-satellite",
  title: "LEO Orbital Satellite Bus",
  subtitle: "SysML Power, Thermal & ADCS",
  kind: "satellite",
  accentColor: "#8b5cf6",
};

const SHOWCASE_EV_BATTERY: RotundaModelEntry = {
  id: "showcase-ev-battery",
  title: "800V EV Liquid-Cooled Pack",
  subtitle: "Electro-Thermal BMS & Cold Plate",
  kind: "ev-battery",
  accentColor: "#06b6d4",
};

const SHOWCASE_CNC_IMPELLER: RotundaModelEntry = {
  id: "showcase-cnc-impeller",
  title: "5-Axis CNC Machined Impeller",
  subtitle: "Live G-Code Contour Toolpath",
  kind: "gcode",
  accentColor: "#eab308",
};

const SHOWCASE_FEA_BRACKET: RotundaModelEntry = {
  id: "showcase-fea-bracket",
  title: "Aerospace Cantilever Bracket",
  subtitle: "FEA Von Mises Stress Field",
  kind: "fea",
  accentColor: "#f97316",
};

const SHOWCASE_CFD_TURBOFAN: RotundaModelEntry = {
  id: "showcase-cfd-turbofan",
  title: "Ducted Turbofan Rotor",
  subtitle: "CFD Streamlines & Vorticity",
  kind: "cfd",
  accentColor: "#0ea5e9",
};

const SHOWCASE_OCTOPUS_ROV: RotundaModelEntry = {
  id: "showcase-octopus-rov",
  title: "Pelagos OC-8 Robotic Octopus",
  subtitle: "8-Arm Subsea Drone · 202 Links · 489 Wheels · 7-Piston Pump",
  kind: "octopus-rov",
  accentColor: "#f97316",
};

/**
 * Canonical catalog of all 10 distinct procedural multi-part 3D engineering assemblies
 * hosted on the Engineering Rotunda Circular Metrology Plinth & Orbital Carousel.
 */
export const ROTUNDA_SHOWCASE_MODELS: readonly RotundaModelEntry[] = [
  SHOWCASE_ACTUATOR,
  SHOWCASE_ROBOT_ARM,
  SHOWCASE_DRONE,
  SHOWCASE_WIND_TURBINE,
  SHOWCASE_SATELLITE,
  SHOWCASE_EV_BATTERY,
  SHOWCASE_CNC_IMPELLER,
  SHOWCASE_FEA_BRACKET,
  SHOWCASE_CFD_TURBOFAN,
  SHOWCASE_OCTOPUS_ROV,
] as const;

// ── Domain Schematic & Telemetry Synthesis Helpers ──────────────────────────

interface SchematicPortSpec {
  id: string;
  x: number;
  y: number;
  color: string;
}

interface SchematicBlockSpec {
  id: string;
  title: string;
  subtitle: string;
  x: number;
  y: number;
  width: number;
  height: number;
  stroke: string;
  ports: readonly SchematicPortSpec[];
}

interface SchematicEdgeSpec {
  id: string;
  sourceCell: string;
  sourcePort: string;
  targetCell: string;
  targetPort: string;
  stroke: string;
}

function buildSchematicBlockNode(spec: SchematicBlockSpec): Record<string, unknown> {
  const markup: DiagramMarkupNode[] = [
    {
      tagName: "rect",
      selector: "body",
      attrs: {
        x: 0,
        y: 0,
        width: spec.width,
        height: spec.height,
        rx: 6,
        ry: 6,
        fill: "#132038",
        stroke: spec.stroke,
        "stroke-width": 1.6,
      },
    },
    {
      tagName: "text",
      selector: "label",
      attrs: {
        x: spec.width / 2,
        y: spec.height * 0.42,
        "text-anchor": "middle",
        fill: "#f8fafc",
        "font-size": 11,
        "font-weight": "600",
        "font-family": "sans-serif",
      },
      textContent: spec.title,
    },
    {
      tagName: "text",
      selector: "sublabel",
      attrs: {
        x: spec.width / 2,
        y: spec.height * 0.74,
        "text-anchor": "middle",
        fill: "#94a3b8",
        "font-size": 9,
        "font-family": "monospace",
      },
      textContent: spec.subtitle,
    },
  ];

  for (let i = 0; i < spec.ports.length; i++) {
    const port = spec.ports[i];
    if (!port) continue;
    markup.push({
      tagName: "circle",
      selector: `port_${i}`,
      attrs: {
        cx: port.x,
        cy: port.y,
        r: 3.5,
        fill: port.color,
        stroke: "#090f1d",
        "stroke-width": 1.2,
      },
    });
  }

  return {
    id: spec.id,
    shape: "rect",
    x: spec.x,
    y: spec.y,
    width: spec.width,
    height: spec.height,
    label: spec.title,
    markup,
    ports: {
      items: spec.ports.map((p) => ({ id: p.id, args: { x: p.x, y: p.y } })),
    },
  };
}

function buildScenarioDiagramData(
  blocks: readonly SchematicBlockSpec[],
  edges: readonly SchematicEdgeSpec[],
): Record<string, unknown> {
  return {
    nodes: blocks.map(buildSchematicBlockNode),
    edges: edges.map((e) => ({
      id: e.id,
      source: { cell: e.sourceCell, port: e.sourcePort },
      target: { cell: e.targetCell, port: e.targetPort },
      connector: { name: "rounded", args: { radius: 6 } },
      attrs: { line: { stroke: e.stroke, strokeWidth: 1.9 } },
    })),
  };
}

function sampleTelemetryCurve(
  sampleCount: number,
  durationSec: number,
  fn: (t: number) => number,
): { x: number[]; y: number[] } {
  const count = Math.max(2, sampleCount);
  const x: number[] = [];
  const y: number[] = [];
  for (let i = 0; i < count; i++) {
    const t = (i / (count - 1)) * durationSec;
    x.push(Number(t.toFixed(3)));
    y.push(Number(fn(t).toFixed(3)));
  }
  return { x, y };
}

// ── Scenario Board Builders ─────────────────────────────────────────────────

function createAerospaceProvingGroundBoard(): CanvasDocument {
  const diagramData = buildScenarioDiagramData(
    [
      {
        id: "wind_field",
        title: "Turbulent Wind",
        subtitle: "14.2 m/s Gust",
        x: 16,
        y: 66,
        width: 112,
        height: 56,
        stroke: "#38bdf8",
        ports: [
          { id: "out_top", x: 112, y: 18, color: "#38bdf8" },
          { id: "out_bot", x: 112, y: 40, color: "#10b981" },
        ],
      },
      {
        id: "hex_ekf",
        title: "6-DOF Attitude",
        subtitle: "EKF + PID Loop",
        x: 164,
        y: 18,
        width: 120,
        height: 58,
        stroke: "#22c55e",
        ports: [
          { id: "in", x: 0, y: 29, color: "#38bdf8" },
          { id: "out", x: 120, y: 29, color: "#22c55e" },
        ],
      },
      {
        id: "hex_mixer",
        title: "6-Rotor Mixer",
        subtitle: "BLDC ESC PWM",
        x: 320,
        y: 18,
        width: 116,
        height: 58,
        stroke: "#f59e0b",
        ports: [{ id: "in", x: 0, y: 29, color: "#22c55e" }],
      },
      {
        id: "wind_rotor",
        title: "5 MW Aero Rotor",
        subtitle: "Blade Pitch BEM",
        x: 164,
        y: 110,
        width: 120,
        height: 58,
        stroke: "#10b981",
        ports: [
          { id: "in", x: 0, y: 29, color: "#10b981" },
          { id: "out", x: 120, y: 29, color: "#06b6d4" },
        ],
      },
      {
        id: "drivetrain_gen",
        title: "Gearbox + PMSG",
        subtitle: "Grid Inverter",
        x: 320,
        y: 110,
        width: 116,
        height: 58,
        stroke: "#06b6d4",
        ports: [{ id: "in", x: 0, y: 29, color: "#06b6d4" }],
      },
    ],
    [
      {
        id: "e_wind_ekf",
        sourceCell: "wind_field",
        sourcePort: "out_top",
        targetCell: "hex_ekf",
        targetPort: "in",
        stroke: "#38bdf8",
      },
      {
        id: "e_ekf_mixer",
        sourceCell: "hex_ekf",
        sourcePort: "out",
        targetCell: "hex_mixer",
        targetPort: "in",
        stroke: "#22c55e",
      },
      {
        id: "e_wind_rotor",
        sourceCell: "wind_field",
        sourcePort: "out_bot",
        targetCell: "wind_rotor",
        targetPort: "in",
        stroke: "#10b981",
      },
      {
        id: "e_rotor_gen",
        sourceCell: "wind_rotor",
        sourcePort: "out",
        targetCell: "drivetrain_gen",
        targetPort: "in",
        stroke: "#06b6d4",
      },
    ],
  );

  const thrustCurve = sampleTelemetryCurve(61, 10, (t) => {
    const gustImpulse = 8.4 * Math.exp(-Math.pow((t - 3.6) / 0.9, 2));
    return 54.2 + gustImpulse + 1.4 * Math.sin(t * 2.3) * Math.exp(-t * 0.14);
  });
  const powerCurve = sampleTelemetryCurve(61, 10, (t) => {
    const ramp = 3.6 + 1.42 * (1 - Math.exp(-t * 0.55));
    return ramp + 0.16 * Math.sin(t * 1.45);
  });
  const pitchCurve = sampleTelemetryCurve(61, 10, (t) => {
    const dt = Math.max(0, t - 3.2);
    return dt === 0 ? 0.25 * Math.sin(t * 1.6) : 3.8 * Math.exp(-dt * 1.15) * Math.sin(dt * 4.2);
  });

  return buildRotundaCanvasDocument({
    title: "Flight Attitude & Wind Energy Proving Ground",
    languageId: "modelica",
    artifactUri: "aero/FlightWindProvingGround.mo",
    diagramData,
    simulationSeries: [
      {
        id: "hex_thrust",
        label: "Hexacopter Thrust",
        color: "#22c55e",
        unit: "N",
        x: thrustCurve.x,
        y: thrustCurve.y,
      },
      {
        id: "turbine_power",
        label: "Turbine Output",
        color: "#38bdf8",
        unit: "MW",
        x: powerCurve.x,
        y: powerCurve.y,
      },
      {
        id: "attitude_pitch",
        label: "Pitch Gust Error",
        color: "#f59e0b",
        unit: "deg",
        x: pitchCurve.x,
        y: pitchCurve.y,
      },
    ],
    parameters: [
      { name: "REQ-AERO-01 T/W >= 2.0", value: "PASS (2.35x)" },
      { name: "REQ-AERO-02 Gust Settle <= 1.5s", value: "PASS (1.12 s)" },
      { name: "REQ-WIND-03 Tip Speed <= 90 m/s", value: "PASS (84.2 m/s)" },
      { name: "REQ-WIND-04 Rated Power >= 5 MW", value: "PASS (5.02 MW)" },
      { name: "Hex_Hover_RPM", value: 4820, unit: "rpm" },
      { name: "Rotor_Diameter", value: 126.0, unit: "m" },
    ],
  });
}

function createRoboticsWarehouseBoard(): CanvasDocument {
  const diagramData = buildScenarioDiagramData(
    [
      {
        id: "traj_plan",
        title: "Spline Planner",
        subtitle: "S-Curve G-Code",
        x: 16,
        y: 66,
        width: 110,
        height: 56,
        stroke: "#f59e0b",
        ports: [
          { id: "out_arm", x: 110, y: 18, color: "#f59e0b" },
          { id: "out_cnc", x: 110, y: 40, color: "#eab308" },
        ],
      },
      {
        id: "ik_ctrl",
        title: "4-DOF IK Servo",
        subtitle: "Harmonic Torque",
        x: 162,
        y: 18,
        width: 118,
        height: 58,
        stroke: "#38bdf8",
        ports: [
          { id: "in", x: 0, y: 29, color: "#f59e0b" },
          { id: "out", x: 118, y: 29, color: "#38bdf8" },
        ],
      },
      {
        id: "cnc_mill",
        title: "5-Axis Impeller",
        subtitle: "24k RPM Spindle",
        x: 162,
        y: 110,
        width: 118,
        height: 58,
        stroke: "#eab308",
        ports: [
          { id: "in", x: 0, y: 29, color: "#eab308" },
          { id: "out", x: 118, y: 29, color: "#a855f7" },
        ],
      },
      {
        id: "safety_plc",
        title: "ISO 10218 PLC",
        subtitle: "Zone Clearance",
        x: 318,
        y: 64,
        width: 118,
        height: 60,
        stroke: "#10b981",
        ports: [
          { id: "in_top", x: 0, y: 18, color: "#38bdf8" },
          { id: "in_bot", x: 0, y: 42, color: "#a855f7" },
        ],
      },
    ],
    [
      {
        id: "e_plan_ik",
        sourceCell: "traj_plan",
        sourcePort: "out_arm",
        targetCell: "ik_ctrl",
        targetPort: "in",
        stroke: "#f59e0b",
      },
      {
        id: "e_plan_cnc",
        sourceCell: "traj_plan",
        sourcePort: "out_cnc",
        targetCell: "cnc_mill",
        targetPort: "in",
        stroke: "#eab308",
      },
      {
        id: "e_ik_plc",
        sourceCell: "ik_ctrl",
        sourcePort: "out",
        targetCell: "safety_plc",
        targetPort: "in_top",
        stroke: "#38bdf8",
      },
      {
        id: "e_cnc_plc",
        sourceCell: "cnc_mill",
        sourcePort: "out",
        targetCell: "safety_plc",
        targetPort: "in_bot",
        stroke: "#a855f7",
      },
    ],
  );

  const j1Torque = sampleTelemetryCurve(61, 10, (t) => 68 + 26 * Math.sin(t * 1.15) + 7 * Math.cos(t * 2.9));
  const j2Torque = sampleTelemetryCurve(61, 10, (t) => 42 + 19 * Math.sin(t * 1.15 - 0.65) + 4.5 * Math.sin(t * 3.4));
  const spindleLoad = sampleTelemetryCurve(61, 10, (t) => 56 + 14 * Math.sin(t * 1.85) + 6 * Math.sin(t * 5.2));

  return buildRotundaCanvasDocument({
    title: "Kinematics & 5-Axis Motion Control Cell",
    languageId: "urdf",
    artifactUri: "robotics/ManufacturingCell.urdf",
    diagramData,
    simulationSeries: [
      {
        id: "j1_torque",
        label: "Joint 1 Base Torque",
        color: "#f59e0b",
        unit: "N·m",
        x: j1Torque.x,
        y: j1Torque.y,
      },
      {
        id: "j2_torque",
        label: "Joint 2 Shoulder Torque",
        color: "#38bdf8",
        unit: "N·m",
        x: j2Torque.x,
        y: j2Torque.y,
      },
      {
        id: "spindle_load",
        label: "5-Axis Spindle Load",
        color: "#a855f7",
        unit: "%",
        x: spindleLoad.x,
        y: spindleLoad.y,
      },
    ],
    parameters: [
      { name: "REQ-ISO10218-01 Clearance >= 0.45m", value: "PASS (0.62 m)" },
      { name: "REQ-ISO10218-02 E-Stop <= 0.18s", value: "PASS (0.11 s)" },
      { name: "REQ-CNC-03 Impeller Ra <= 0.8um", value: "PASS (0.52 um)" },
      { name: "REQ-FEA-04 Mount SF >= 2.2", value: "PASS (2.68)" },
      { name: "Payload_Rated", value: 18.0, unit: "kg" },
      { name: "Spindle_Speed", value: 24000, unit: "rpm" },
    ],
  });
}

function createEvThermalStudioBoard(): CanvasDocument {
  const diagramData = buildScenarioDiagramData(
    [
      {
        id: "cell_modules",
        title: "800V Cell Stack",
        subtitle: "216s3p NMC 98kWh",
        x: 16,
        y: 66,
        width: 114,
        height: 58,
        stroke: "#06b6d4",
        ports: [
          { id: "out_bms", x: 114, y: 18, color: "#38bdf8" },
          { id: "out_thm", x: 114, y: 40, color: "#ef4444" },
        ],
      },
      {
        id: "bms_ecu",
        title: "BMS Estimator",
        subtitle: "EKF SOC / SOH",
        x: 166,
        y: 18,
        width: 118,
        height: 58,
        stroke: "#22c55e",
        ports: [
          { id: "in", x: 0, y: 29, color: "#38bdf8" },
          { id: "out", x: 118, y: 29, color: "#22c55e" },
        ],
      },
      {
        id: "cold_plate",
        title: "Glycol Cold Plate",
        subtitle: "50/50 Microchannel",
        x: 166,
        y: 110,
        width: 118,
        height: 58,
        stroke: "#ef4444",
        ports: [
          { id: "in", x: 0, y: 29, color: "#ef4444" },
          { id: "out", x: 118, y: 29, color: "#06b6d4" },
        ],
      },
      {
        id: "chiller_loop",
        title: "Radiator + Valve",
        subtitle: "18 L/min Pump",
        x: 320,
        y: 64,
        width: 116,
        height: 60,
        stroke: "#38bdf8",
        ports: [
          { id: "in_ctrl", x: 0, y: 18, color: "#22c55e" },
          { id: "in_flow", x: 0, y: 42, color: "#06b6d4" },
        ],
      },
    ],
    [
      {
        id: "e_cells_bms",
        sourceCell: "cell_modules",
        sourcePort: "out_bms",
        targetCell: "bms_ecu",
        targetPort: "in",
        stroke: "#38bdf8",
      },
      {
        id: "e_cells_plate",
        sourceCell: "cell_modules",
        sourcePort: "out_thm",
        targetCell: "cold_plate",
        targetPort: "in",
        stroke: "#ef4444",
      },
      {
        id: "e_bms_chiller",
        sourceCell: "bms_ecu",
        sourcePort: "out",
        targetCell: "chiller_loop",
        targetPort: "in_ctrl",
        stroke: "#22c55e",
      },
      {
        id: "e_plate_chiller",
        sourceCell: "cold_plate",
        sourcePort: "out",
        targetCell: "chiller_loop",
        targetPort: "in_flow",
        stroke: "#06b6d4",
      },
    ],
  );

  const cellTemp = sampleTelemetryCurve(
    61,
    10,
    (t) => 27.5 + 15.8 * (1 - Math.exp(-t * 0.34)) + 0.65 * Math.sin(t * 1.1),
  );
  const coolantOut = sampleTelemetryCurve(
    61,
    10,
    (t) => 24.0 + 10.6 * (1 - Math.exp(-t * 0.3)) + 0.45 * Math.sin(t * 1.1 - 0.5),
  );
  const packSoc = sampleTelemetryCurve(61, 10, (t) => 22.0 + 5.6 * t - 0.08 * t * t);

  return buildRotundaCanvasDocument({
    title: "800V BMS & Liquid Cooling Studio",
    languageId: "modelica",
    artifactUri: "ev/BatteryThermalBMS.mo",
    diagramData,
    simulationSeries: [
      {
        id: "cell_temp_peak",
        label: "Peak Cell Temp",
        color: "#ef4444",
        unit: "°C",
        x: cellTemp.x,
        y: cellTemp.y,
      },
      {
        id: "coolant_outlet",
        label: "Cold Plate Outlet",
        color: "#06b6d4",
        unit: "°C",
        x: coolantOut.x,
        y: coolantOut.y,
      },
      {
        id: "pack_soc",
        label: "Fast-Charge SOC",
        color: "#22c55e",
        unit: "%",
        x: packSoc.x,
        y: packSoc.y,
      },
    ],
    parameters: [
      { name: "REQ-UN38.3-01 Peak Temp <= 55 C", value: "PASS (43.2 C)" },
      { name: "REQ-UN38.3-02 Cell Delta-T <= 5 K", value: "PASS (3.1 K)" },
      { name: "REQ-BMS-03 Isolation >= 500 Ohm/V", value: "PASS (1.4 kOhm/V)" },
      { name: "REQ-CRASH-04 Mount Load >= 20 g", value: "PASS (24.5 g)" },
      { name: "Bus_Voltage", value: 800, unit: "V" },
      { name: "Coolant_Flow", value: 18.4, unit: "L/min" },
    ],
  });
}

function createOrbitalSpacecraftBoard(): CanvasDocument {
  const diagramData = buildScenarioDiagramData(
    [
      {
        id: "solar_wings",
        title: "Solar Array",
        subtitle: "GaAs 1.45 kW BOL",
        x: 16,
        y: 66,
        width: 112,
        height: 58,
        stroke: "#eab308",
        ports: [{ id: "out_eps", x: 112, y: 29, color: "#eab308" }],
      },
      {
        id: "eps_bus",
        title: "28V EPS Bus",
        subtitle: "MPPT + Li-Ion",
        x: 162,
        y: 66,
        width: 114,
        height: 58,
        stroke: "#38bdf8",
        ports: [
          { id: "in", x: 0, y: 29, color: "#eab308" },
          { id: "out_adcs", x: 114, y: 16, color: "#8b5cf6" },
          { id: "out_thm", x: 114, y: 42, color: "#f97316" },
        ],
      },
      {
        id: "adcs_ctrl",
        title: "ADCS + Star Trk",
        subtitle: "3-Axis RWA Loop",
        x: 314,
        y: 18,
        width: 122,
        height: 58,
        stroke: "#8b5cf6",
        ports: [{ id: "in", x: 0, y: 29, color: "#8b5cf6" }],
      },
      {
        id: "thermal_rad",
        title: "MLI + Louvers",
        subtitle: "Eclipse Heater",
        x: 314,
        y: 110,
        width: 122,
        height: 58,
        stroke: "#f97316",
        ports: [{ id: "in", x: 0, y: 29, color: "#f97316" }],
      },
    ],
    [
      {
        id: "e_solar_eps",
        sourceCell: "solar_wings",
        sourcePort: "out_eps",
        targetCell: "eps_bus",
        targetPort: "in",
        stroke: "#eab308",
      },
      {
        id: "e_eps_adcs",
        sourceCell: "eps_bus",
        sourcePort: "out_adcs",
        targetCell: "adcs_ctrl",
        targetPort: "in",
        stroke: "#8b5cf6",
      },
      {
        id: "e_eps_thm",
        sourceCell: "eps_bus",
        sourcePort: "out_thm",
        targetCell: "thermal_rad",
        targetPort: "in",
        stroke: "#f97316",
      },
    ],
  );

  // Orbit sunlit -> eclipse (t in [3.5, 6.8]) -> sunlit exit thermal & power response
  const busTemp = sampleTelemetryCurve(61, 10, (t) => {
    const eclipseDip = 31.0 * Math.exp(-Math.pow((t - 5.4) / 1.55, 2));
    return 296.5 - eclipseDip + 1.8 * Math.sin(t * 0.9);
  });
  const solarPower = sampleTelemetryCurve(61, 10, (t) => {
    const inEclipse = 1 / (1 + Math.exp(-(t - 3.4) * 5.2)) - 1 / (1 + Math.exp(-(t - 6.8) * 5.2));
    return Math.max(0, 1420 * (1 - inEclipse) + 18 * Math.sin(t * 1.2));
  });
  const pointingErr = sampleTelemetryCurve(61, 10, (t) => {
    const slewPulse = 6.2 * Math.exp(-Math.pow((t - 3.5) / 0.55, 2)) + 4.4 * Math.exp(-Math.pow((t - 6.8) / 0.55, 2));
    return 4.1 + slewPulse + 0.8 * Math.sin(t * 3.1);
  });

  return buildRotundaCanvasDocument({
    title: "ADCS & Solar Power Bus Mission Twin",
    languageId: "sysml2",
    artifactUri: "space/OrbitalMissionTwin.sysml",
    diagramData,
    simulationSeries: [
      {
        id: "bus_temp_k",
        label: "Bus Eclipse Temp",
        color: "#f97316",
        unit: "K",
        x: busTemp.x,
        y: busTemp.y,
      },
      {
        id: "solar_power_w",
        label: "Solar Array Power",
        color: "#eab308",
        unit: "W",
        x: solarPower.x,
        y: solarPower.y,
      },
      {
        id: "adcs_pointing",
        label: "Pointing Error",
        color: "#a855f7",
        unit: "arcsec",
        x: pointingErr.x,
        y: pointingErr.y,
      },
    ],
    parameters: [
      { name: "REQ-ADCS-01 Pointing <= 15 arcsec", value: "PASS (10.4 arcsec)" },
      { name: "REQ-THM-02 Eclipse >= 255 K", value: "PASS (265.2 K)" },
      { name: "REQ-RAD-03 Shielding >= 50 krad", value: "PASS (64 krad)" },
      { name: "REQ-EPS-04 Eclipse DoD <= 32%", value: "PASS (24.8%)" },
      { name: "Orbit_Altitude", value: 550, unit: "km" },
      { name: "Array_Area", value: 6.4, unit: "m2" },
    ],
  });
}

// ── Curated 5 Multi-Domain VR Scenarios ─────────────────────────────────────

/**
 * Curated multi-domain VR engineering scenarios pairing a tailored `.mscanvas` 45° podium board,
 * curated 3D model carousel, ideal procedural environment, CAE physics overlay, and scale mode.
 */
function createSubseaOctopusBoard(): CanvasDocument {
  const diagramData = buildScenarioDiagramData(
    [
      {
        id: "mission_ctrl",
        title: "Mission Autonomy",
        subtitle: "25s 4-Phase Seq",
        x: 24,
        y: 26,
        width: 142,
        height: 54,
        stroke: "#38bdf8",
        ports: [
          { id: "out_spd", x: 142, y: 18, color: "#10b981" },
          { id: "out_dep", x: 142, y: 38, color: "#38bdf8" },
        ],
      },
      {
        id: "seawater_intake",
        title: "Seawater Intake",
        subtitle: "p = patm + rho·g·z",
        x: 24,
        y: 122,
        width: 142,
        height: 54,
        stroke: "#06b6d4",
        ports: [{ id: "port_out", x: 142, y: 27, color: "#06b6d4" }],
      },
      {
        id: "pump_core",
        title: "7-Piston Pump",
        subtitle: "Swashplate 0.28 rad",
        x: 204,
        y: 108,
        width: 152,
        height: 62,
        stroke: "#10b981",
        ports: [
          { id: "port_in", x: 0, y: 40, color: "#06b6d4" },
          { id: "shaft", x: 76, y: 0, color: "#10b981" },
          { id: "port_out", x: 152, y: 31, color: "#0284c7" },
        ],
      },
      {
        id: "siphon_nozzle",
        title: "Siphon Nozzle",
        subtitle: "2.68 m/s · 6.0 N",
        x: 392,
        y: 108,
        width: 146,
        height: 62,
        stroke: "#f97316",
        ports: [
          { id: "port_in", x: 0, y: 31, color: "#0284c7" },
          { id: "flange_hull", x: 146, y: 31, color: "#f97316" },
        ],
      },
      {
        id: "mantle_hull",
        title: "Mantle 4-DOF Body",
        subtitle: "Surge · Heave · Att",
        x: 410,
        y: 20,
        width: 156,
        height: 58,
        stroke: "#cbd5e1",
        ports: [
          { id: "flange_surge", x: 0, y: 42, color: "#f97316" },
          { id: "flange_heave", x: 0, y: 18, color: "#38bdf8" },
          { id: "flange_arms", x: 78, y: 58, color: "#a855f7" },
        ],
      },
      {
        id: "arm_bank",
        title: "8 Arm Chains",
        subtitle: "202 Links · Arm 3 Detach",
        x: 386,
        y: 204,
        width: 176,
        height: 58,
        stroke: "#a855f7",
        ports: [{ id: "flange_mantle", x: 88, y: 0, color: "#a855f7" }],
      },
    ],
    [
      {
        id: "e_mission_pump",
        sourceCell: "mission_ctrl",
        sourcePort: "out_spd",
        targetCell: "pump_core",
        targetPort: "shaft",
        stroke: "#10b981",
      },
      {
        id: "e_mission_hull",
        sourceCell: "mission_ctrl",
        sourcePort: "out_dep",
        targetCell: "mantle_hull",
        targetPort: "flange_heave",
        stroke: "#38bdf8",
      },
      {
        id: "e_intake_pump",
        sourceCell: "seawater_intake",
        sourcePort: "port_out",
        targetCell: "pump_core",
        targetPort: "port_in",
        stroke: "#06b6d4",
      },
      {
        id: "e_pump_siphon",
        sourceCell: "pump_core",
        sourcePort: "port_out",
        targetCell: "siphon_nozzle",
        targetPort: "port_in",
        stroke: "#0284c7",
      },
      {
        id: "e_siphon_hull",
        sourceCell: "siphon_nozzle",
        sourcePort: "flange_hull",
        targetCell: "mantle_hull",
        targetPort: "flange_surge",
        stroke: "#f97316",
      },
      {
        id: "e_arms_hull",
        sourceCell: "arm_bank",
        sourcePort: "flange_mantle",
        targetCell: "mantle_hull",
        targetPort: "flange_arms",
        stroke: "#a855f7",
      },
    ],
  );

  const t = Array.from({ length: 51 }, (_, i) => i * 0.5);
  const thrust = t.map((sec) => {
    const burst = sec >= 13 && sec <= 20 ? 1 : 0.15;
    return Number((6.0 * burst * (0.9 + 0.1 * Math.sin(sec * 2.4))).toFixed(2));
  });
  const jetVel = thrust.map((f) => Number((2.68 * Math.sqrt(Math.max(0, f / 6.0))).toFixed(2)));
  const pumpTemp = t.map((sec) => Number((23 + (sec >= 13 && sec <= 20 ? 12 : 2) + Math.sin(sec * 0.6)).toFixed(1)));

  return buildRotundaCanvasDocument({
    title: "Pelagos OC-8 Subsea Robotic Octopus",
    languageId: "modelica",
    artifactUri: "PelagosOC8Octopus.mo",
    diagramData,
    parameters: [
      { name: "arm_segments", value: 202, unit: "links" },
      { name: "traction_wheels", value: 489, unit: "rollers" },
      { name: "pump_pistons", value: 7, unit: "cyl" },
      { name: "siphon_vmax", value: 2.68, unit: "m/s" },
      { name: "burst_thrust", value: 6.0, unit: "N" },
      { name: "detach_mode", value: "AUTO", unit: "arm3" },
    ],
    simulationSeries: [
      { id: "siphon_thrust", label: "Siphon Thrust (N)", color: "#f97316", unit: "N", x: t, y: thrust },
      { id: "jet_velocity", label: "Jet Velocity (m/s)", color: "#06b6d4", unit: "m/s", x: t, y: jetVel },
      { id: "pump_temp", label: "7-Piston Core Temp (°C)", color: "#10b981", unit: "°C", x: t, y: pumpTemp },
    ],
  });
}

export const ROTUNDA_SHOWCASE_SCENARIOS: readonly RotundaScenarioPreset[] = [
  {
    id: "all-showcase",
    label: "Full VR Showcase (10 Models)",
    shortLabel: "All 10 Models",
    description:
      "Complete 10-assembly multi-domain showcase including the 691-part Pelagos OC-8 Robotic Octopus paired with the canonical polyglot electro-mechanical system board.",
    recommendedEnvironment: "outdoors",
    recommendedScaleMode: "tabletop",
    recommendedCaeOverlay: "none",
    models: ROTUNDA_SHOWCASE_MODELS,
    createDocument: () => createCanonicalPolyglotDemoBoard(),
  },
  {
    id: "subsea-octopus",
    label: "Pelagos OC-8 Subsea Octopus Field Sim",
    shortLabel: "Subsea ROV",
    description:
      "Bright studio inspection of the 8-arm Pelagos OC-8 robotic octopus (202 linked segments, 489 wheels, internal 7-piston swashplate pump, 2.68 m/s siphon jet, and autonomous Arm 3 detach/reconnect).",
    recommendedEnvironment: "office",
    recommendedScaleMode: "tabletop",
    recommendedCaeOverlay: "none",
    models: [
      { ...SHOWCASE_OCTOPUS_ROV, sourceTileId: "tile_primary_schematic" },
      SHOWCASE_CFD_TURBOFAN,
      SHOWCASE_ROBOT_ARM,
      SHOWCASE_ACTUATOR,
    ],
    createDocument: createSubseaOctopusBoard,
  },
  {
    id: "aerospace-proving-ground",
    label: "Drone & Wind Proving Ground",
    shortLabel: "Outdoors Aero",
    description:
      "Open-field flight dynamics and 5 MW wind energy proving ground with live CFD streamlines, thrust & power curves, and airworthiness contracts.",
    recommendedEnvironment: "outdoors",
    recommendedScaleMode: "tabletop",
    recommendedCaeOverlay: "cfd-flow",
    models: [
      { ...SHOWCASE_DRONE, sourceTileId: "tile_primary_cad" },
      SHOWCASE_WIND_TURBINE,
      SHOWCASE_CFD_TURBOFAN,
      SHOWCASE_SATELLITE,
    ],
    createDocument: createAerospaceProvingGroundBoard,
  },
  {
    id: "robotics-warehouse",
    label: "Robotics & 5-Axis CNC Cell",
    shortLabel: "Robot Hangar",
    description:
      "Full 1:1 scale industrial manufacturing hangar pairing a 4-DOF articulated robot arm, 5-axis CNC impeller toolpath, harmonic servo, and ISO 10218 contracts.",
    recommendedEnvironment: "warehouse",
    recommendedScaleMode: "real-scale",
    recommendedCaeOverlay: "none",
    models: [
      { ...SHOWCASE_ROBOT_ARM, sourceTileId: "tile_primary_cad" },
      SHOWCASE_CNC_IMPELLER,
      { ...SHOWCASE_ACTUATOR, sourceTileId: undefined },
      SHOWCASE_FEA_BRACKET,
    ],
    createDocument: createRoboticsWarehouseBoard,
  },
  {
    id: "ev-thermal-studio",
    label: "EV Battery & Thermal Studio",
    shortLabel: "EV Thermal",
    description:
      "Sunlit design studio inspecting an 800V liquid-cooled EV pack, thermal field overlay, BMS fast-charge telemetry, and UN38.3 safety contracts.",
    recommendedEnvironment: "office",
    recommendedScaleMode: "tabletop",
    recommendedCaeOverlay: "thermal",
    models: [
      { ...SHOWCASE_EV_BATTERY, sourceTileId: "tile_primary_cad" },
      {
        ...SHOWCASE_ACTUATOR,
        subtitle: "Coolant Valve & Contactor Drive",
        sourceTileId: undefined,
      },
      {
        ...SHOWCASE_CFD_TURBOFAN,
        id: "ev-cooling-rotor",
        title: "Ducted Cooling Rotor",
        subtitle: "Thermal Radiator Airflow CFD",
      },
      {
        ...SHOWCASE_FEA_BRACKET,
        id: "ev-structural-mount",
        title: "FEA Structural Mount",
        subtitle: "Pack Crash & Vibration Bracket",
      },
    ],
    createDocument: createEvThermalStudioBoard,
  },
  {
    id: "orbital-spacecraft",
    label: "Orbital Spacecraft Mission Twin",
    shortLabel: "Spacecraft",
    description:
      "Dark-lab orbital spacecraft twin pairing SysML ADCS & solar power architecture, eclipse thermal cycling, reaction wheel actuator, and launch load verification.",
    recommendedEnvironment: "dark-lab",
    recommendedScaleMode: "tabletop",
    recommendedCaeOverlay: "thermal",
    models: [
      { ...SHOWCASE_SATELLITE, sourceTileId: "tile_primary_cad" },
      {
        ...SHOWCASE_FEA_BRACKET,
        id: "space-launch-bracket",
        title: "FEA Launch Bracket",
        subtitle: "Launch Vibe & Payload Adapter",
      },
      {
        ...SHOWCASE_ACTUATOR,
        id: "space-reaction-wheel",
        title: "Reaction Wheel Actuator",
        subtitle: "3-Axis Precision Momentum Wheel",
        sourceTileId: undefined,
      },
      {
        ...SHOWCASE_CFD_TURBOFAN,
        id: "space-cfd-nozzle",
        title: "Propulsion CFD Nozzle",
        subtitle: "Thruster Plume & Nozzle Flow",
      },
    ],
    createDocument: createOrbitalSpacecraftBoard,
  },
] as const;

/** Looks up a curated VR scenario preset by ID (case-insensitive, trimmed). */
export function getRotundaScenarioById(id: string | null | undefined): RotundaScenarioPreset | undefined {
  if (!id) return undefined;
  const normalized = id.trim().toLowerCase();
  if (!normalized) return undefined;
  return ROTUNDA_SHOWCASE_SCENARIOS.find((scenario) => scenario.id.toLowerCase() === normalized);
}
