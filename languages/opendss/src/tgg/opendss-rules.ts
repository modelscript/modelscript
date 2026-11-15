// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const opendssTggRules = [
  tggRule({
    name: "OpenDssLineToModelicaLine",
    sourceLang: "opendss",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["LineElement"]?.({ name: v("lineName"), length: v("len") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("lineName"),
        typeSpecifier: "Modelica.Electrical.PowerConverters.Examples.DistributionLine",
        length: v("len"),
      }),
    where: (v) => [
      tggEq(v("lineName"), v("lineName")),
      tggEq(v("len"), v("len")),
      tggReconcilePhysics(v("len"), v("len"), { min: 0.001, max: 1000.0 }),
      tggComplement(["bus1", "bus2", "phases", "r1", "x1"]),
    ],
  }),
  tggRule({
    name: "OpenDssLoadToModelicaLoad",
    sourceLang: "opendss",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["LoadElement"]?.({ name: v("loadName"), kw: v("kwVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("loadName"),
        typeSpecifier: "OpenIPSL.Electrical.Loads.PSSE.Load",
        P_0: v("kwVal"),
      }),
    where: (v) => [
      tggEq(v("loadName"), v("loadName")),
      tggEq(v("kwVal"), v("kwVal")),
      tggReconcilePhysics(v("kwVal"), v("kwVal"), { min: 0.0, max: 1e6 }),
      tggComplement(["kvar", "kv", "model"]),
    ],
  }),
  tggRule({
    name: "OpenDssCircuitToSysmlPart",
    sourceLang: "opendss",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["CircuitElement"]?.({ name: v("cktName"), basekv: v("kv") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("cktName"), declaredType: "DistributionFeeder", baseKv: v("kv") }),
    where: (v) => [
      tggEq(v("cktName"), v("cktName")),
      tggEq(v("kv"), v("kv")),
      tggReconcilePhysics(v("kv"), v("kv"), { min: 0.1, max: 500.0 }),
      tggComplement(["pu", "phases"]),
    ],
  }),
];

export const opendssPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: opendssTggRules,
};
