// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const oscalTggRules = [
  tggRule({
    name: "OscalSspToSysmlPackage",
    sourceLang: "oscal",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SystemSecurityPlan"]?.({ uuid: v("planId"), title: v("planTitle") }),
    target: ($, v) => $["Package"]?.({ declaredName: v("planId"), documentation: v("planTitle") }),
    where: (v) => [
      tggEq(v("planId"), v("planId")),
      tggEq(v("planTitle"), v("planTitle")),
      tggComplement(["oscalVersion", "metadata"]),
    ],
  }),
  tggRule({
    name: "OscalControlToSysmlRequirement",
    sourceLang: "oscal",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ImplementedRequirement"]?.({ controlId: v("ctrlId"), description: v("desc") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("ctrlId"), text: v("desc") }),
    where: (v) => [
      tggEq(v("ctrlId"), v("ctrlId")),
      tggEq(v("desc"), v("desc")),
      tggComplement(["statements", "responsibleRoles"]),
    ],
  }),
  tggRule({
    name: "OscalComponentToSysmlPart",
    sourceLang: "oscal",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SystemComponent"]?.({ title: v("compName"), componentType: v("compType") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("compName"), declaredType: v("compType") }),
    where: (v) => [
      tggEq(v("compName"), v("compName")),
      tggEq(v("compType"), v("compType")),
      tggComplement(["uuid", "status"]),
    ],
  }),
];

export const oscalPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2"],
  rules: oscalTggRules,
};
