// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const sclTggRules = [
  tggRule({
    name: "SclIedToSysmlPart",
    sourceLang: "scl",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["IED"]?.({ name: v("iedName"), manufacturer: v("mfg") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("iedName"), declaredType: v("mfg") }),
    where: (v) => [
      tggEq(v("iedName"), v("iedName")),
      tggEq(v("mfg"), v("mfg")),
      tggComplement(["type", "configVersion"]),
    ],
  }),
  tggRule({
    name: "SclLogicalNodeToModelicaBlock",
    sourceLang: "scl",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["LogicalNode"]?.({ name: v("lnName"), lnClass: v("lnClass") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("lnName"), typeSpecifier: v("lnClass") }),
    where: (v) => [
      tggEq(v("lnName"), v("lnName")),
      tggEq(v("lnClass"), v("lnClass")),
      tggComplement(["inst", "prefix"]),
    ],
  }),
  tggRule({
    name: "SclGooseToSysmlConnection",
    sourceLang: "scl",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["GSEControl"]?.({ name: v("gseName"), appID: v("appId") }),
    target: ($, v) => $["ConnectionUsage"]?.({ declaredName: v("gseName"), protocolId: v("appId") }),
    where: (v) => [
      tggEq(v("gseName"), v("gseName")),
      tggEq(v("appId"), v("appId")),
      tggComplement(["datSet", "confRev"]),
    ],
  }),
];

export const sclPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: sclTggRules,
};
