// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const qifTggRules = [
  tggRule({
    name: "QifCharacteristicToSysmlRequirement",
    sourceLang: "qif",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["DimensionalCharacteristic"]?.({ name: v("charName"), nominalMm: v("nom") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("charName"), nominalMm: v("nom") }),
    where: (v) => [
      tggEq(v("charName"), v("charName")),
      tggEq(v("nom"), v("nom")),
      tggReconcilePhysics(v("nom"), v("nom"), { min: 0.0, max: 1e5 }),
      tggComplement(["plusTolMm", "minusTolMm", "datumRef"]),
    ],
  }),
  tggRule({
    name: "QifFeatureToStepEntity",
    sourceLang: "qif",
    targetLang: "step",
    priority: 10,
    source: ($, v) => $["MeasurementFeature"]?.({ name: v("featName"), featureType: v("fType") }),
    target: ($, v) => $["StepEntity"]?.({ entityType: v("fType"), name: v("featName") }),
    where: (v) => [tggEq(v("featName"), v("featName")), tggEq(v("fType"), v("fType")), tggComplement(["qifId"])],
  }),
];

export const qifPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "step"],
  rules: qifTggRules,
};
