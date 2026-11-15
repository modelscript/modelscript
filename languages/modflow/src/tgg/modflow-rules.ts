// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const modflowTggRules = [
  tggRule({
    name: "ModflowAquiferToModelicaMedium",
    sourceLang: "modflow",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["AquiferLayer"]?.({ name: v("layerName"), hydraulicCond: v("hk") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("layerName"),
        typeSpecifier: "Modelica.Fluid.Pipes.StaticPipe",
        K: v("hk"),
      }),
    where: (v) => [
      tggEq(v("layerName"), v("layerName")),
      tggEq(v("hk"), v("hk")),
      tggReconcilePhysics(v("hk"), v("hk"), { min: 1e-12, max: 100.0 }),
      tggComplement(["specificYield", "bottomElev"]),
    ],
  }),
  tggRule({
    name: "ModflowWellToSysmlPart",
    sourceLang: "modflow",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["WellBoundary"]?.({ name: v("wellName"), pumpingRate: v("q") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("wellName"), declaredType: "GroundwaterWell", rate: v("q") }),
    where: (v) => [
      tggEq(v("wellName"), v("wellName")),
      tggEq(v("q"), v("q")),
      tggReconcilePhysics(v("q"), v("q"), { min: -1e5, max: 1e5 }),
      tggComplement(["layer", "row", "col"]),
    ],
  }),
];

export const modflowPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: modflowTggRules,
};
