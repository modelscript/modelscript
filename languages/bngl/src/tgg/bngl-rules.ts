// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const bnglTggRules = [
  tggRule({
    name: "BnglMoleculeToSysmlPart",
    sourceLang: "bngl",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["MoleculeType"]?.({ name: v("molName"), sites: v("siteList") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("molName"), sites: v("siteList") }),
    where: (v) => [tggEq(v("molName"), v("molName")), tggEq(v("siteList"), v("siteList"))],
  }),
  tggRule({
    name: "BnglRuleToModelicaParam",
    sourceLang: "bngl",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["BnglReactionRule"]?.({ name: v("ruleName"), rateConstant: v("kf") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("ruleName"), typeSpecifier: "Real", k_f: v("kf") }),
    where: (v) => [
      tggEq(v("ruleName"), v("ruleName")),
      tggEq(v("kf"), v("kf")),
      tggReconcilePhysics(v("kf"), v("kf"), { min: 0.0, max: 1e10 }),
      tggComplement(["reverseRate"]),
    ],
  }),
];

export const bnglPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: bnglTggRules,
};
