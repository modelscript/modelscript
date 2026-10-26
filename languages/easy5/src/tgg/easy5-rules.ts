// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/easy5 — Bidirectional Triple Graph Grammar (TGG) Rules.
 *
 * Establishes declarative bijective and symmetric transformation rules mapping
 * Boeing/MSC Software EASY5 control models to standard Modelica 3.x blocks and SysML v2 part definitions.
 */

import { tggComplement, tggDefaultVal, tggEq, tggReconcile, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const easy5TggRules = [
  // 1. GP/GA (Gain) <-> Modelica.Blocks.Math.Gain
  tggRule({
    name: "Easy5GainToModelicaGain",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) => $.Component({ type: "GP/GA", id: v("name"), K: v("k") }),
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
      tggComplement(["location", "ports", "title", "userCode"]),
    ],
  }),

  // 2. GP/IN (Integrator) <-> Modelica.Blocks.Continuous.Integrator
  tggRule({
    name: "Easy5IntegratorToModelicaIntegrator",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) => $.Component({ type: "GP/IN", id: v("name"), GAIN: v("k"), S0: v("y_start") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Continuous.Integrator",
        k: v("k"),
        y_start: v("y_start"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("k"), v("k")),
      tggEq(v("y_start"), v("y_start")),
      tggReconcile(v("k"), v("k"), "target-wins"),
      tggReconcile(v("y_start"), v("y_start"), "target-wins"),
      tggComplement(["location", "ports", "initialStates"]),
    ],
  }),

  // 3. GP/SJ (Summing Junction) <-> Modelica.Blocks.Math.Add
  tggRule({
    name: "Easy5SumToModelicaAdd",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) => $.Component({ type: "GP/SJ", id: v("name") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Math.Add",
      }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["location", "ports"])],
  }),

  // 4. GP/TF (Transfer Function) <-> Modelica.Blocks.Continuous.TransferFunction
  tggRule({
    name: "Easy5TransferFcnToModelicaTransferFunction",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) => $.Component({ type: "GP/TF", id: v("name"), NUM: v("b"), DEN: v("a") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Continuous.TransferFunction",
        b: v("b"),
        a: v("a"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("b"), v("b")),
      tggEq(v("a"), v("a")),
      tggComplement(["location", "ports"]),
    ],
  }),

  // 5. GP/LA (Lead-Lag) <-> Modelica.Blocks.Continuous.TransferFunction
  tggRule({
    name: "Easy5LeadLagToModelicaTransferFunction",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) =>
      $.Component({
        type: "GP/LA",
        id: v("name"),
        GAIN: v("gain"),
        TAU1: v("tau1"),
        TAU2: v("tau2"),
      }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Continuous.TransferFunction",
      }),
    where: (v) => [tggEq(v("name"), v("name")), tggComplement(["location", "ports"])],
  }),

  // 6. GP/LM (Limiter) <-> Modelica.Blocks.Nonlinear.Limiter
  tggRule({
    name: "Easy5LimiterToModelicaLimiter",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) => $.Component({ type: "GP/LM", id: v("name"), UL: v("uMax"), LL: v("uMin") }),
    target: ($, v) =>
      $.ComponentDeclaration({
        name: v("name"),
        typeSpecifier: "Modelica.Blocks.Nonlinear.Limiter",
        uMax: v("uMax"),
        uMin: v("uMin"),
      }),
    where: (v) => [
      tggEq(v("name"), v("name")),
      tggEq(v("uMax"), v("uMax")),
      tggEq(v("uMin"), v("uMin")),
      tggComplement(["location", "ports"]),
    ],
  }),

  // 7. Arrow Connection <-> connect(...) Equation
  tggRule({
    name: "Easy5ConnectionToConnect",
    sourceLang: "easy5",
    targetLang: "modelica",
    source: ($, v) =>
      $.Connection({
        fromComponent: v("fromComp"),
        fromPort: v("fromPort"),
        toComponent: v("toComp"),
        toPort: v("toPort"),
      }),
    target: ($, v) =>
      $.ConnectEquation({
        source: v("srcConn"),
        target: v("dstConn"),
      }),
    where: (v) => [tggEq(v("srcConn"), v("srcConn")), tggEq(v("dstConn"), v("dstConn"))],
  }),

  // 8. EASY5 Component <-> SysML v2 Part Definition
  tggRule({
    name: "Easy5ComponentToSysmlPart",
    sourceLang: "easy5",
    targetLang: "sysml2",
    source: ($, v) => $.Component({ id: v("name"), type: v("compType") }),
    target: ($, v) => $.PartDefinition({ name: v("name"), declaredType: v("compType") }),
    where: (v) => [tggEq(v("name"), v("name")), tggDefaultVal(v("isAbstract"), false)],
  }),
];

export const easy5PolyglotConfig: PolyglotConfig = {
  languages: ["easy5", "modelica", "sysml2"],
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
  rules: easy5TggRules,
};
