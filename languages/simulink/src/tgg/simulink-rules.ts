// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/simulink — Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Establishes declarative bijective and symmetric transformation rules mapping
 * MATLAB/Simulink block diagram ASTs to standard Modelica 3.x blocks and SysML v2 part definitions.
 */

import { tggComplement, tggDefaultVal, tggEq, tggReconcile, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const simulinkTggRules = [
  // 1. Gain Block <-> Modelica.Blocks.Math.Gain
  tggRule({
    name: "SimulinkGainToModelicaGain",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Gain", name: v("name"), Gain: v("k") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Math.Gain",
        k: v("k"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("k"), v("k")),
      tggReconcile(v("k"), v("k"), "target-wins"),
      tggComplement(["id", "range", "ports", "subsystem"]),
    ],
  }),

  // 2. Integrator Block <-> Modelica.Blocks.Continuous.Integrator
  tggRule({
    name: "SimulinkIntegratorToModelicaIntegrator",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Integrator", name: v("name"), InitialCondition: v("ic") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Continuous.Integrator",
        y_start: v("ic"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("ic"), v("ic")),
      tggReconcile(v("ic"), v("ic"), "target-wins"),
      tggComplement(["id", "range", "ports"]),
    ],
  }),

  // 3. Constant Block <-> Modelica.Blocks.Sources.Constant
  tggRule({
    name: "SimulinkConstantToModelicaConstant",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Constant", name: v("name"), Value: v("val") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Sources.Constant",
        k: v("val"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("val"), v("val")),
      tggReconcile(v("val"), v("val"), "target-wins"),
      tggComplement(["id", "range", "ports"]),
    ],
  }),

  // 4. Sum (++) <-> Modelica.Blocks.Math.Add
  tggRule({
    name: "SimulinkSumToAdd",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Sum", name: v("name"), Inputs: "++" }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Math.Add",
      }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["id", "range", "ports"])],
  }),

  // 5. Sum (+-) <-> Modelica.Blocks.Math.Feedback
  tggRule({
    name: "SimulinkSumToFeedback",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Sum", name: v("name"), Inputs: "+-" }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Math.Feedback",
      }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["id", "range", "ports"])],
  }),

  // 6. Transfer Function <-> Modelica.Blocks.Continuous.TransferFunction
  tggRule({
    name: "SimulinkTransferFcnToTransferFunction",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) =>
      $.Block({
        type: "TransferFcn",
        name: v("name"),
        Numerator: v("num"),
        Denominator: v("den"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Continuous.TransferFunction",
        b: v("num"),
        a: v("den"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("num"), v("b")),
      tggEq(v("den"), v("a")),
      tggComplement(["id", "range", "ports"]),
    ],
  }),

  // 7. Unit Delay <-> Modelica.Blocks.Discrete.UnitDelay
  tggRule({
    name: "SimulinkUnitDelayToUnitDelay",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) =>
      $.Block({
        type: "UnitDelay",
        name: v("name"),
        SampleTime: v("st"),
        InitialCondition: v("ic"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Discrete.UnitDelay",
        samplePeriod: v("st"),
        y_start: v("ic"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("st"), v("st")),
      tggEq(v("ic"), v("ic")),
      tggComplement(["id", "range", "ports"]),
    ],
  }),

  // 8. Inport <-> Modelica.Blocks.Interfaces.RealInput
  tggRule({
    name: "SimulinkInportToRealInput",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Inport", name: v("name") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Interfaces.RealInput",
      }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["id", "range", "ports"])],
  }),

  // 9. Outport <-> Modelica.Blocks.Interfaces.RealOutput
  tggRule({
    name: "SimulinkOutportToRealOutput",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) => $.Block({ type: "Outport", name: v("name") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Interfaces.RealOutput",
      }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["id", "range", "ports"])],
  }),

  // 10. Line Connectivity <-> connect(...) Equation
  tggRule({
    name: "SimulinkLineToConnect",
    sourceLang: "simulink",
    targetLang: "modelica",
    source: ($, v) =>
      $.Line({
        srcBlock: v("src"),
        srcPort: v("srcP"),
        dstBlock: v("dst"),
        dstPort: v("dstP"),
      }),
    target: ($, v) =>
      $.ConnectEquation({
        source: v("srcConn"),
        target: v("dstConn"),
      }),
    where: (v) => [
      tggEq(v("srcConn"), v("srcConn")),
      tggEq(v("dstConn"), v("dstConn")),
      tggComplement(["id", "range", "branches"]),
    ],
  }),

  // 11. Simulink Block <-> SysML v2 Part Definition
  tggRule({
    name: "SimulinkBlockToSysmlPart",
    sourceLang: "simulink",
    targetLang: "sysml2",
    source: ($, v) => $.Block({ name: v("name"), type: v("blockType") }),
    target: ($, v) => $.PartDefinition({ name: v("name"), declaredType: v("blockType") }),
    where: (v) => [tggEq(v("name"), v("name")), tggDefaultVal(v("isAbstract"), false)],
  }),
];

export const simulinkPolyglotConfig: PolyglotConfig = {
  languages: ["simulink", "modelica", "sysml2"],
  typeMaps: {
    modelica: {
      Real: "Real",
      Integer: "Integer",
      Boolean: "Boolean",
    },
    sysml2: {
      Real: "Real",
      Integer: "Integer",
      Boolean: "Boolean",
    },
  },
  rules: simulinkTggRules,
};
