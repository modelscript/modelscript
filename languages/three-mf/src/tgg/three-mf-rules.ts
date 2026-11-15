// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const threeMfTggRules = [
  tggRule({
    name: "ThreeMfObjectToStepProduct",
    sourceLang: "three-mf",
    targetLang: "step",
    priority: 10,
    source: ($, v) => $["ThreeMfObject"]?.({ name: v("objName"), objectType: v("oType") }),
    target: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: v("objName"), objectType: v("oType") }),
    where: (v) => [
      tggEq(v("objName"), v("objName")),
      tggEq(v("oType"), v("oType")),
      tggComplement(["id", "partNumber", "mesh"]),
    ],
  }),
  tggRule({
    name: "ThreeMfBuildItemToSysmlPart",
    sourceLang: "three-mf",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["BuildItem"]?.({ name: v("itemName"), transformMatrix: v("xform") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("itemName"), declaredType: "PrintablePart", transform: v("xform") }),
    where: (v) => [tggEq(v("itemName"), v("itemName")), tggEq(v("xform"), v("xform"))],
  }),
];

export const threeMfPolyglotConfig: PolyglotConfig = {
  languages: ["step", "sysml2"],
  rules: threeMfTggRules,
};
