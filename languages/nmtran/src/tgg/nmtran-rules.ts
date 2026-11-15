// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const nmtranTggRules = [
  tggRule({
    name: "NmtranThetaToModelicaParam",
    sourceLang: "nmtran",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["ThetaParam"]?.({ name: v("thName"), initEstimate: v("val") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("thName"), typeSpecifier: "Real", defaultValue: v("val") }),
    where: (v) => [
      tggEq(v("thName"), v("thName")),
      tggEq(v("val"), v("val")),
      tggReconcilePhysics(v("val"), v("val"), { min: 1e-6, max: 1e6 }),
      tggComplement(["lowerBound", "upperBound"]),
    ],
  }),
  tggRule({
    name: "NmtranCompartmentToSysmlPart",
    sourceLang: "nmtran",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["PkCompartment"]?.({ name: v("cmtName"), volumeL: v("vol") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("cmtName"), declaredType: "PkCompartment", volumeL: v("vol") }),
    where: (v) => [
      tggEq(v("cmtName"), v("cmtName")),
      tggEq(v("vol"), v("vol")),
      tggReconcilePhysics(v("vol"), v("vol"), { min: 0.01, max: 10000.0 }),
      tggComplement(["cmtIndex"]),
    ],
  }),
];

export const nmtranPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: nmtranTggRules,
};
