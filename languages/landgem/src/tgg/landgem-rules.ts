// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const landgemTggRules = [
  tggRule({
    name: "LandGemCellToModelicaSource",
    sourceLang: "landgem",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["LandfillCell"]?.({ name: v("cellName"), methaneDecayK: v("kVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("cellName"),
        typeSpecifier: "Modelica.Fluid.Sources.MassFlowSource_T",
        k_decay: v("kVal"),
      }),
    where: (v) => [
      tggEq(v("cellName"), v("cellName")),
      tggEq(v("kVal"), v("kVal")),
      tggReconcilePhysics(v("kVal"), v("kVal"), { min: 0.001, max: 1.0 }),
      tggComplement(["l0", "wasteAcceptanceTonsPerYr"]),
    ],
  }),
  tggRule({
    name: "LandGemSiteToSysmlPart",
    sourceLang: "landgem",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["LandfillSite"]?.({ name: v("siteName"), openYear: v("yr") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("siteName"), declaredType: "LandfillSite", openYear: v("yr") }),
    where: (v) => [
      tggEq(v("siteName"), v("siteName")),
      tggEq(v("yr"), v("yr")),
      tggReconcilePhysics(v("yr"), v("yr"), { min: 1900, max: 2200 }),
      tggComplement(["closureYear", "nmocPpm"]),
    ],
  }),
];

export const landgemPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: landgemTggRules,
};
