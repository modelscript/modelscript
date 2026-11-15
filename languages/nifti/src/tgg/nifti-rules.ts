// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const niftiTggRules = [
  tggRule({
    name: "NiftiVolumeToSysmlPart",
    sourceLang: "nifti",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["NiftiHeader"]?.({ name: v("volName"), voxelSpacingMm: v("dx") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("volName"), declaredType: "VoxelVolume", voxelSpacingMm: v("dx") }),
    where: (v) => [
      tggEq(v("volName"), v("volName")),
      tggEq(v("dx"), v("dx")),
      tggReconcilePhysics(v("dx"), v("dx"), { min: 0.01, max: 50.0 }),
      tggComplement(["dim", "datatype", "qformCode"]),
    ],
  }),
  tggRule({
    name: "NiftiIntensityToModelicaParam",
    sourceLang: "nifti",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["IntensityWindow"]?.({ name: v("winName"), sclSlope: v("slope") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("winName"), typeSpecifier: "Real", slope: v("slope") }),
    where: (v) => [
      tggEq(v("winName"), v("winName")),
      tggEq(v("slope"), v("slope")),
      tggReconcilePhysics(v("slope"), v("slope"), { min: 1e-6, max: 1e6 }),
      tggComplement(["sclInter"]),
    ],
  }),
];

export const niftiPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: niftiTggRules,
};
