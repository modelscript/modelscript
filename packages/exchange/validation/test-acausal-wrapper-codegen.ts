// SPDX-License-Identifier: AGPL-3.0-or-later

import assert from "node:assert";
import { generateFmuWrapperModelica, type FmiModelDescription, type FmiTerminal } from "../src/fmu/index.js";

console.log("=== Running Acausal FMU Wrapper Codegen Tests ===");

// 1. Mock FMI 3.0 description with Model Exchange and Terminals
const mockDesc: FmiModelDescription = {
  fmiVersion: "3.0",
  modelName: "HeatExchangerUnit",
  guid: "{9d4e1124-7c38-4f81-a7b2-10f8a923bc11}",
  description: "Acausal Model Exchange wrapper for HeatExchangerUnit",
  author: "ModelScript Engineering",
  generationTool: "ModelScript 0.0.18",
  coSimulationModelIdentifier: "HeatExchangerUnit_cs",
  modelExchangeModelIdentifier: "HeatExchangerUnit_me",
  supportsCoSimulation: true,
  supportsModelExchange: true,
  defaultExperiment: {
    startTime: 0,
    stopTime: 10,
    tolerance: 1e-6,
    stepSize: 0.01,
  },
  numberOfEventIndicators: 2,
  variables: [
    // Terminal variables (claimed)
    { name: "port_a.p", valueReference: 1, causality: "input", variability: "continuous", type: "Real" },
    { name: "port_a.m_flow", valueReference: 2, causality: "output", variability: "continuous", type: "Real" },
    { name: "port_a.h_outflow", valueReference: 3, causality: "output", variability: "continuous", type: "Real" },
    { name: "port_b.p", valueReference: 4, causality: "input", variability: "continuous", type: "Real" },
    { name: "port_b.m_flow", valueReference: 5, causality: "output", variability: "continuous", type: "Real" },
    { name: "port_b.h_outflow", valueReference: 6, causality: "output", variability: "continuous", type: "Real" },
    { name: "heatPort.T", valueReference: 7, causality: "input", variability: "continuous", type: "Real" },
    { name: "heatPort.Q_flow", valueReference: 8, causality: "output", variability: "continuous", type: "Real" },

    // Unclaimed causal signals & parameters
    {
      name: "bypass_valve",
      valueReference: 9,
      causality: "input",
      variability: "continuous",
      type: "Real",
      start: 0.0,
      description: "Valve position command",
    },
    {
      name: "effectiveness",
      valueReference: 10,
      causality: "output",
      variability: "continuous",
      type: "Real",
      description: "Calculated heat exchanger effectiveness",
    },
    {
      name: "nominal_flow",
      valueReference: 11,
      causality: "parameter",
      variability: "fixed",
      type: "Real",
      start: 1.5,
      description: "Nominal mass flow rate [kg/s]",
    },
  ],
};

const mockTerminals: FmiTerminal[] = [
  {
    name: "port_a",
    terminalKind: "org.modelica.types.fluid.FluidPort_a",
    description: "Inlet fluid port",
    memberVariables: [
      { variableName: "port_a.p", memberName: "p", variableKind: "potential" },
      { variableName: "port_a.m_flow", memberName: "m_flow", variableKind: "flow" },
      { variableName: "port_a.h_outflow", memberName: "h_outflow", variableKind: "stream" },
    ],
    graphicalRepresentation: { x1: -110, y1: 10, x2: -90, y2: 30 },
  },
  {
    name: "port_b",
    terminalKind: "org.modelica.types.fluid.FluidPort_b",
    description: "Outlet fluid port",
    memberVariables: [
      { variableName: "port_b.p", memberName: "p", variableKind: "potential" },
      { variableName: "port_b.m_flow", memberName: "m_flow", variableKind: "flow" },
      { variableName: "port_b.h_outflow", memberName: "h_outflow", variableKind: "stream" },
    ],
    graphicalRepresentation: { x1: 90, y1: -30, x2: 110, y2: -10 },
  },
  {
    name: "heatPort",
    terminalKind: "org.modelica.types.thermal.HeatPort_a",
    description: "Thermal boundary port",
    memberVariables: [
      { variableName: "heatPort.T", memberName: "T", variableKind: "potential" },
      { variableName: "heatPort.Q_flow", memberName: "Q_flow", variableKind: "flow" },
    ],
    graphicalRepresentation: { x1: -10, y1: 90, x2: 10, y2: 110 },
  },
];

// Test 1: Generate acausal model with explicit terminals
const code = generateFmuWrapperModelica(mockDesc, "HeatExchangerUnit.fmu", "ImportedFMUs", mockTerminals);
console.log("Generated Acausal Modelica:\n" + code);

assert.ok(code.includes("within ImportedFMUs;"), "Should include within statement");
assert.ok(code.includes("model HeatExchangerUnit"), "Should declare a model, NOT a block");
assert.ok(!code.includes("block HeatExchangerUnit"), "Should not be a block");

// Check MSL domain imports
assert.ok(code.includes("import Modelica.Fluid.Interfaces.FluidPort_a;"), "Should import FluidPort_a");
assert.ok(code.includes("import Modelica.Fluid.Interfaces.FluidPort_b;"), "Should import FluidPort_b");
assert.ok(code.includes("import Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a;"), "Should import HeatPort_a");

// Check acausal connectors
assert.ok(
  code.includes(
    'FluidPort_a port_a "Inlet fluid port" annotation(Placement(transformation(extent = {{-110, 10}, {-90, 30}})));',
  ),
  "Should declare port_a with placement",
);
assert.ok(
  code.includes(
    'FluidPort_b port_b "Outlet fluid port" annotation(Placement(transformation(extent = {{90, -30}, {110, -10}})));',
  ),
  "Should declare port_b with placement",
);
assert.ok(
  code.includes(
    'HeatPort_a heatPort "Thermal boundary port" annotation(Placement(transformation(extent = {{-10, 90}, {10, 110}})));',
  ),
  "Should declare heatPort with placement",
);

// Check unclaimed variables
assert.ok(code.includes('input Real bypass_valve = 0 "Valve position command";'), "Should declare input bypass_valve");
assert.ok(
  code.includes('output Real effectiveness "Calculated heat exchanger effectiveness";'),
  "Should declare output effectiveness",
);
assert.ok(
  code.includes('parameter Real nominal_flow = 1.5 "Nominal mass flow rate [kg/s]";'),
  "Should declare parameter nominal_flow",
);

// Check protected variables
assert.ok(code.includes("protected"), "Should have protected section");
assert.ok(code.includes("Real fmu_port_a_p;"), "Should declare fmu_port_a_p");
assert.ok(code.includes("Real fmu_port_a_m_flow;"), "Should declare fmu_port_a_m_flow");
assert.ok(code.includes("Real fmu_port_a_h_outflow;"), "Should declare fmu_port_a_h_outflow");
assert.ok(code.includes("Real fmu_heatPort_T;"), "Should declare fmu_heatPort_T");
assert.ok(code.includes("Real fmu_heatPort_Q_flow;"), "Should declare fmu_heatPort_Q_flow");

// Check annotations
assert.ok(code.includes('__ModelScript_preferredKind = "ModelExchange"'), "Should prefer Model Exchange");
assert.ok(code.includes('__ModelScript_guid = "{9d4e1124-7c38-4f81-a7b2-10f8a923bc11}"'), "Should include GUID");
assert.ok(code.includes('("port_a.p", "fmu_port_a_p")'), "Should map port_a.p to fmu_port_a_p");
assert.ok(code.includes('("heatPort.T", "fmu_heatPort_T")'), "Should map heatPort.T to fmu_heatPort_T");

// Check boundary equations
assert.ok(code.includes("equation"), "Should have equation section");
assert.ok(code.includes("port_a.p = fmu_port_a_p;"), "Should couple port_a.p");
assert.ok(code.includes("port_a.m_flow = fmu_port_a_m_flow;"), "Should couple port_a.m_flow");
assert.ok(code.includes("port_a.h_outflow = fmu_port_a_h_outflow;"), "Should couple port_a.h_outflow");
assert.ok(code.includes("heatPort.T = fmu_heatPort_T;"), "Should couple heatPort.T");
assert.ok(code.includes("heatPort.Q_flow = fmu_heatPort_Q_flow;"), "Should couple heatPort.Q_flow");

// Test 2: Fallback to causal block when terminals are empty
const causalDesc: FmiModelDescription = {
  ...mockDesc,
  modelName: "SignalController",
  supportsModelExchange: false,
  supportsCoSimulation: true,
  terminals: [],
};
const causalCode = generateFmuWrapperModelica(causalDesc, "SignalController.fmu");
assert.ok(causalCode.includes("block SignalController"), "Should generate block when no terminals");
assert.ok(
  causalCode.includes('__ModelScript_preferredKind = "CoSimulation"'),
  "Should set preferred kind CoSimulation",
);
assert.ok(!causalCode.includes("protected"), "Causal block does not need protected section");

// Test 3: Embedded terminals in desc.terminals
const descWithEmbeddedTerminals: FmiModelDescription = {
  ...mockDesc,
  terminals: mockTerminals,
};
const embeddedCode = generateFmuWrapperModelica(descWithEmbeddedTerminals, "HeatExchangerUnit.fmu");
assert.ok(embeddedCode.includes("model HeatExchangerUnit"), "Should generate model using desc.terminals");

console.log("✓ All Acausal FMU Wrapper Codegen tests passed successfully!");
