// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const topasTggRules = [
  tggRule({
    name: "TopasGeometryToSysmlPart",
    sourceLang: "topas",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["GeComponent"]?.({ name: v("compName"), componentType: v("gType") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("compName"), declaredType: v("gType") }),
    where: (v) => [
      tggEq(v("compName"), v("compName")),
      tggEq(v("gType"), v("gType")),
      tggComplement(["material", "parent"]),
    ],
  }),
  tggRule({
    name: "TopasBeamToModelicaParam",
    sourceLang: "topas",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["SoSource"]?.({ name: v("srcName"), beamEnergyMev: v("energy") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("srcName"), typeSpecifier: "Real", E_MeV: v("energy") }),
    where: (v) => [
      tggEq(v("srcName"), v("srcName")),
      tggEq(v("energy"), v("energy")),
      tggReconcilePhysics(v("energy"), v("energy"), { min: 0.001, max: 1000.0 }),
      tggComplement(["particle", "histories"]),
    ],
  }),
];

export const topasPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: topasTggRules,
};
