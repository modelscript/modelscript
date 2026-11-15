// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const openadrTggRules = [
  tggRule({
    name: "OpenAdrEventToSysmlRequirement",
    sourceLang: "openadr",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["DrEvent"]?.({ name: v("evtId"), targetCurtailmentKw: v("kw") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("evtId"), curtailmentKw: v("kw") }),
    where: (v) => [
      tggEq(v("evtId"), v("evtId")),
      tggEq(v("kw"), v("kw")),
      tggReconcilePhysics(v("kw"), v("kw"), { min: 0.0, max: 1e6 }),
      tggComplement(["marketContext", "priority"]),
    ],
  }),
  tggRule({
    name: "OpenAdrVenToModelicaLoad",
    sourceLang: "openadr",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["VirtualEndNode"]?.({ name: v("venName"), baselineKw: v("baseKw") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("venName"),
        typeSpecifier: "OpenIPSL.Electrical.Loads.PSSE.Load",
        P_0: v("baseKw"),
      }),
    where: (v) => [
      tggEq(v("venName"), v("venName")),
      tggEq(v("baseKw"), v("baseKw")),
      tggReconcilePhysics(v("baseKw"), v("baseKw"), { min: 0.0, max: 1e6 }),
      tggComplement(["venId", "transport"]),
    ],
  }),
];

export const openadrPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: openadrTggRules,
};
