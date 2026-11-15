// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const fiberTggRules = [
  tggRule({
    name: "FiberSpanToModelicaLink",
    sourceLang: "fiber",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["FiberSpan"]?.({ name: v("spanName"), lengthKm: v("lenKm") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("spanName"),
        typeSpecifier: "Modelica.Blocks.Continuous.TransferFunction",
        L_km: v("lenKm"),
      }),
    where: (v) => [
      tggEq(v("spanName"), v("spanName")),
      tggEq(v("lenKm"), v("lenKm")),
      tggReconcilePhysics(v("lenKm"), v("lenKm"), { min: 0.001, max: 10000.0 }),
      tggComplement(["attenuationDbPerKm", "dispersion"]),
    ],
  }),
  tggRule({
    name: "FiberNodeToSysmlPart",
    sourceLang: "fiber",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["OpticalNode"]?.({ name: v("nodeName"), nodeType: v("nType") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("nodeName"), declaredType: v("nType") }),
    where: (v) => [
      tggEq(v("nodeName"), v("nodeName")),
      tggEq(v("nType"), v("nType")),
      tggComplement(["insertionLossDb"]),
    ],
  }),
];

export const fiberPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: fiberTggRules,
};
