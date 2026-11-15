// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const automationmlTggRules = [
  tggRule({
    name: "AmlInternalElementToSysmlPart",
    sourceLang: "automationml",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["InternalElement"]?.({ name: v("elName"), roleClass: v("role") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("elName"), declaredType: v("role") }),
    where: (v) => [
      tggEq(v("elName"), v("elName")),
      tggEq(v("role"), v("role")),
      tggComplement(["id", "refBaseSystemUnitPath"]),
    ],
  }),
  tggRule({
    name: "AmlExternalInterfaceToModelicaPort",
    sourceLang: "automationml",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["ExternalInterface"]?.({ name: v("ifName"), interfaceClass: v("ifClass") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("ifName"), typeSpecifier: v("ifClass") }),
    where: (v) => [tggEq(v("ifName"), v("ifName")), tggEq(v("ifClass"), v("ifClass")), tggComplement(["id"])],
  }),
];

export const automationmlPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: automationmlTggRules,
};
