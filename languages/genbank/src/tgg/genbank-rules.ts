// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const genbankTggRules = [
  tggRule({
    name: "GenbankLocusToSysmlPart",
    sourceLang: "genbank",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["GenBankLocus"]?.({ name: v("locusName"), moleculeType: v("molType") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("locusName"), declaredType: v("molType") }),
    where: (v) => [
      tggEq(v("locusName"), v("locusName")),
      tggEq(v("molType"), v("molType")),
      tggComplement(["lengthBp", "topology", "division"]),
    ],
  }),
  tggRule({
    name: "GenbankFeatureToSbolComponent",
    sourceLang: "genbank",
    targetLang: "sbol",
    priority: 10,
    source: ($, v) => $["SequenceFeature"]?.({ name: v("geneName"), featureKey: v("fKey") }),
    target: ($, v) => $["ComponentDefinition"]?.({ name: v("geneName"), roleUri: v("fKey") }),
    where: (v) => [
      tggEq(v("geneName"), v("geneName")),
      tggEq(v("fKey"), v("fKey")),
      tggComplement(["location", "qualifiers"]),
    ],
  }),
];

export const genbankPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "sbol"],
  rules: genbankTggRules,
};
