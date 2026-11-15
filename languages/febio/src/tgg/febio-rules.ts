// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const febioTggRules = [
  tggRule({
    name: "FebioMaterialToModelicaParam",
    sourceLang: "febio",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["FebioMaterial"]?.({ name: v("matName"), youngsModulusPa: v("eMod") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("matName"), typeSpecifier: "Real", E: v("eMod") }),
    where: (v) => [
      tggEq(v("matName"), v("matName")),
      tggEq(v("eMod"), v("eMod")),
      tggReconcilePhysics(v("eMod"), v("eMod"), { min: 1.0, max: 1e12 }),
      tggComplement(["poissonsRatio", "density", "constitutiveModel"]),
    ],
  }),
  tggRule({
    name: "FebioBoundaryToSysmlConstraint",
    sourceLang: "febio",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["FebioBoundary"]?.({ name: v("bcName"), bcType: v("bType") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("bcName"), expression: v("bType") }),
    where: (v) => [tggEq(v("bcName"), v("bcName")), tggEq(v("bType"), v("bType")), tggComplement(["nodeSet"])],
  }),
];

export const febioPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: febioTggRules,
};
