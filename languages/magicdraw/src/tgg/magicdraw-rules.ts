// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const magicDrawTggRules = [
  tggRule({
    name: "MagicDrawBlockToSysml2PartDef",
    sourceLang: "magicdraw",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["MagicDrawBlock"]?.({ name: v("blockName"), xmiId: v("xmiId") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("blockName"), externalId: v("xmiId") }),
    where: (v) => [
      tggEq(v("blockName"), v("blockName")),
      tggEq(v("xmiId"), v("xmiId")),
      tggComplement(["mdOwnedViews", "stereotypes"]),
    ],
  }),
  tggRule({
    name: "MagicDrawRequirementToReqIfSpecObject",
    sourceLang: "magicdraw",
    targetLang: "reqif",
    priority: 10,
    source: ($, v) =>
      $["MagicDrawRequirement"]?.({ requirementId: v("reqId"), name: v("reqName"), text: v("reqText") }),
    target: ($, v) => $["SpecObject"]?.({ identifier: v("reqId"), longName: v("reqName"), text: v("reqText") }),
    where: (v) => [tggEq(v("reqId"), v("reqId")), tggEq(v("reqName"), v("reqName")), tggEq(v("reqText"), v("reqText"))],
  }),
  tggRule({
    name: "MagicDrawConstraintBlockToModelicaModel",
    sourceLang: "magicdraw",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["MagicDrawConstraintBlock"]?.({ name: v("cbName"), equation: v("eqBody") }),
    target: ($, v) => $["ModelicaClass"]?.({ name: v("cbName"), equation: v("eqBody") }),
    where: (v) => [tggEq(v("cbName"), v("cbName")), tggEq(v("eqBody"), v("eqBody"))],
  }),
];

export const magicDrawPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "reqif", "modelica"],
  rules: magicDrawTggRules,
};
