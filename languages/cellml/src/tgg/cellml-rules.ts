// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const cellmlTggRules = [
  tggRule({
    name: "CellmlComponentToModelicaModel",
    sourceLang: "cellml",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["CellmlComponent"]?.({ name: v("compName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("compName"), classKind: "model" }),
    where: (v) => [tggEq(v("compName"), v("compName")), tggComplement(["units"])],
  }),
  tggRule({
    name: "CellmlVariableToModelicaVar",
    sourceLang: "cellml",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["CellmlVariable"]?.({ name: v("varName"), initialValue: v("initVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("varName"), typeSpecifier: "Real", start: v("initVal") }),
    where: (v) => [
      tggEq(v("varName"), v("varName")),
      tggEq(v("initVal"), v("initVal")),
      tggReconcilePhysics(v("initVal"), v("initVal"), { min: -1e9, max: 1e9 }),
      tggComplement(["units", "publicInterface"]),
    ],
  }),
  tggRule({
    name: "CellmlEncapsulationToSysmlPart",
    sourceLang: "cellml",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ComponentRef"]?.({ name: v("compName"), relationship: v("rel") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("compName"), declaredType: v("rel") }),
    where: (v) => [tggEq(v("compName"), v("compName")), tggEq(v("rel"), v("rel"))],
  }),
];

export const cellmlPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: cellmlTggRules,
};
