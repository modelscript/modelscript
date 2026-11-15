// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const gensysTggRules = [
  tggRule({
    name: "GensysCarBodyToModelicaBody",
    sourceLang: "gensys",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["RailVehicleBody"]?.({ name: v("bodyName"), massKg: v("mass") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("bodyName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Parts.Body",
        m: v("mass"),
      }),
    where: (v) => [
      tggEq(v("bodyName"), v("bodyName")),
      tggEq(v("mass"), v("mass")),
      tggReconcilePhysics(v("mass"), v("mass"), { min: 100.0, max: 2e5 }),
      tggComplement(["bogieSpacingM", "axleLoadKn"]),
    ],
  }),
  tggRule({
    name: "GensysTrackToSysmlPart",
    sourceLang: "gensys",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["TrackSegment"]?.({ name: v("trkName"), gaugeMm: v("gauge") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("trkName"), declaredType: "RailTrack", gaugeMm: v("gauge") }),
    where: (v) => [
      tggEq(v("trkName"), v("trkName")),
      tggEq(v("gauge"), v("gauge")),
      tggReconcilePhysics(v("gauge"), v("gauge"), { min: 600.0, max: 1700.0 }),
      tggComplement(["cantMm", "curveRadiusM"]),
    ],
  }),
];

export const gensysPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: gensysTggRules,
};
