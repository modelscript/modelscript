// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const dicomRtTggRules = [
  tggRule({
    name: "DicomRtPlanToSysmlRequirement",
    sourceLang: "dicom-rt",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["RtPlan"]?.({ name: v("planLabel"), prescribedDoseGy: v("doseGy") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("planLabel"), targetDoseGy: v("doseGy") }),
    where: (v) => [
      tggEq(v("planLabel"), v("planLabel")),
      tggEq(v("doseGy"), v("doseGy")),
      tggReconcilePhysics(v("doseGy"), v("doseGy"), { min: 0.1, max: 200.0 }),
      tggComplement(["fractionCount", "modality"]),
    ],
  }),
  tggRule({
    name: "DicomRtBeamToModelicaParam",
    sourceLang: "dicom-rt",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["RtBeam"]?.({ name: v("beamName"), gantryAngleDeg: v("angle") }),
    target: ($, v) =>
      $["ComponentClause"]?.({ name: v("beamName"), typeSpecifier: "Real", gantryAngleDeg: v("angle") }),
    where: (v) => [
      tggEq(v("beamName"), v("beamName")),
      tggEq(v("angle"), v("angle")),
      tggReconcilePhysics(v("angle"), v("angle"), { min: 0.0, max: 360.0 }),
      tggComplement(["energyMeV", "metersets"]),
    ],
  }),
];

export const dicomRtPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: dicomRtTggRules,
};
