// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const sbolTggRules = [
  tggRule({
    name: "SbolComponentToSysmlPart",
    sourceLang: "sbol",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ComponentDefinition"]?.({ name: v("compId"), roleUri: v("role") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("compId"), roleUri: v("role") }),
    where: (v) => [
      tggEq(v("compId"), v("compId")),
      tggEq(v("role"), v("role")),
      tggComplement(["sequenceUri", "displayId"]),
    ],
  }),
  tggRule({
    name: "SbolInteractionToModelicaBlock",
    sourceLang: "sbol",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["GeneticInteraction"]?.({ name: v("intId"), interactionType: v("iType") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("intId"), typeSpecifier: v("iType") }),
    where: (v) => [tggEq(v("intId"), v("intId")), tggEq(v("iType"), v("iType")), tggComplement(["participations"])],
  }),
];

export const sbolPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: sbolTggRules,
};
