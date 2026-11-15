// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const simaTggRules = [
  tggRule({
    name: "SimaFloaterToModelicaBody",
    sourceLang: "sima",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["FloatingBody"]?.({ name: v("fltName"), displacementTons: v("disp") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("fltName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Parts.Body",
        displacementTons: v("disp"),
      }),
    where: (v) => [
      tggEq(v("fltName"), v("fltName")),
      tggEq(v("disp"), v("disp")),
      tggReconcilePhysics(v("disp"), v("disp"), { min: 1.0, max: 1e6 }),
      tggComplement(["draftM", "waterDepthM"]),
    ],
  }),
  tggRule({
    name: "SimaMooringToSysmlConnection",
    sourceLang: "sima",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["MooringLine"]?.({ name: v("lineName"), pretensionKn: v("pret") }),
    target: ($, v) => $["ConnectionUsage"]?.({ declaredName: v("lineName"), pretensionKn: v("pret") }),
    where: (v) => [
      tggEq(v("lineName"), v("lineName")),
      tggEq(v("pret"), v("pret")),
      tggReconcilePhysics(v("pret"), v("pret"), { min: 0.0, max: 1e5 }),
      tggComplement(["lengthM", "eaKn"]),
    ],
  }),
];

export const simaPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: simaTggRules,
};
