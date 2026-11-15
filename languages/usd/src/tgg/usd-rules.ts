// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const usdTggRules = [
  tggRule({
    name: "UsdPrimToSysmlPart",
    sourceLang: "usd",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["UsdPrim"]?.({ name: v("primName"), primType: v("pType") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("primName"), declaredType: v("pType") }),
    where: (v) => [
      tggEq(v("primName"), v("primName")),
      tggEq(v("pType"), v("pType")),
      tggComplement(["specifier", "apiSchemas"]),
    ],
  }),
  tggRule({
    name: "UsdPhysicsMassToModelicaParam",
    sourceLang: "usd",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["UsdPhysicsMassApi"]?.({ name: v("bodyName"), massKg: v("mass") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("bodyName"), typeSpecifier: "Real", m: v("mass") }),
    where: (v) => [
      tggEq(v("bodyName"), v("bodyName")),
      tggEq(v("mass"), v("mass")),
      tggReconcilePhysics(v("mass"), v("mass"), { min: 1e-4, max: 1e8 }),
      tggComplement(["centerOfMass", "diagonalInertia"]),
    ],
  }),
];

export const usdPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: usdTggRules,
};
