// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const cgmesTggRules = [
  tggRule({
    name: "CgmesLineToModelicaLine",
    sourceLang: "cgmes",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["ACLineSegment"]?.({ name: v("lineName"), r: v("rVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("lineName"),
        typeSpecifier: "OpenIPSL.Electrical.Branches.PwLine",
        R: v("rVal"),
      }),
    where: (v) => [
      tggEq(v("lineName"), v("lineName")),
      tggEq(v("rVal"), v("rVal")),
      tggReconcilePhysics(v("rVal"), v("rVal"), { min: 0.0, max: 100.0 }),
      tggComplement(["x", "bch", "length"]),
    ],
  }),
  tggRule({
    name: "CgmesGeneratorToModelicaMachine",
    sourceLang: "cgmes",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["SynchronousMachine"]?.({ name: v("genName"), ratedS: v("mva") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("genName"),
        typeSpecifier: "OpenIPSL.Electrical.Machines.PSSE.GENROU",
        M_b: v("mva"),
      }),
    where: (v) => [
      tggEq(v("genName"), v("genName")),
      tggEq(v("mva"), v("mva")),
      tggReconcilePhysics(v("mva"), v("mva"), { min: 0.1, max: 10000.0 }),
      tggComplement(["ratedU", "p", "q"]),
    ],
  }),
  tggRule({
    name: "CgmesSubstationToSysmlPart",
    sourceLang: "cgmes",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["Substation"]?.({ name: v("subName"), region: v("regName") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("subName"), declaredType: v("regName") }),
    where: (v) => [
      tggEq(v("subName"), v("subName")),
      tggEq(v("regName"), v("regName")),
      tggComplement(["rdfId", "voltageLevels"]),
    ],
  }),
];

export const cgmesPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: cgmesTggRules,
};
