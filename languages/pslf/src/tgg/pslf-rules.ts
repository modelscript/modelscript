// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const pslfTggRules = [
  tggRule({
    name: "PslfBusToModelicaBus",
    sourceLang: "pslf",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["BusRecord"]?.({ name: v("busName"), baseKv: v("kv") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("busName"),
        typeSpecifier: "OpenIPSL.Electrical.Buses.Bus",
        V_b: v("kv"),
      }),
    where: (v) => [
      tggEq(v("busName"), v("busName")),
      tggEq(v("kv"), v("kv")),
      tggReconcilePhysics(v("kv"), v("kv"), { min: 0.1, max: 1200.0 }),
      tggComplement(["busNum", "vm", "va"]),
    ],
  }),
  tggRule({
    name: "PslfBranchToModelicaLine",
    sourceLang: "pslf",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["BranchRecord"]?.({ name: v("brName"), x: v("xVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("brName"),
        typeSpecifier: "OpenIPSL.Electrical.Branches.PwLine",
        X: v("xVal"),
      }),
    where: (v) => [
      tggEq(v("brName"), v("brName")),
      tggEq(v("xVal"), v("xVal")),
      tggReconcilePhysics(v("xVal"), v("xVal"), { min: 1e-5, max: 50.0 }),
      tggComplement(["fromBus", "toBus", "r", "b"]),
    ],
  }),
  tggRule({
    name: "PslfGeneratorToSysmlPart",
    sourceLang: "pslf",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["GeneratorRecord"]?.({ name: v("genName"), pgen: v("mw") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("genName"), declaredType: "Generator", ratedPowerMW: v("mw") }),
    where: (v) => [
      tggEq(v("genName"), v("genName")),
      tggEq(v("mw"), v("mw")),
      tggReconcilePhysics(v("mw"), v("mw"), { min: -5000.0, max: 5000.0 }),
      tggComplement(["qgen", "mbase"]),
    ],
  }),
];

export const pslfPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: pslfTggRules,
};
