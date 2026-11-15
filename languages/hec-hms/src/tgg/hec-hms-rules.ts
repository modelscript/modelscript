// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const hecHmsTggRules = [
  tggRule({
    name: "HecHmsSubbasinToModelicaCatchment",
    sourceLang: "hec-hms",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["Subbasin"]?.({ name: v("basinName"), areaKm2: v("area") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("basinName"),
        typeSpecifier: "Modelica.Fluid.Vessels.OpenTank",
        areaKm2: v("area"),
      }),
    where: (v) => [
      tggEq(v("basinName"), v("basinName")),
      tggEq(v("area"), v("area")),
      tggReconcilePhysics(v("area"), v("area"), { min: 0.001, max: 1e6 }),
      tggComplement(["curveNumber", "lagTimeMin"]),
    ],
  }),
  tggRule({
    name: "HecHmsJunctionToSysmlPart",
    sourceLang: "hec-hms",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["HydroJunction"]?.({ name: v("jName"), downstream: v("ds") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("jName"), declaredType: "HydroJunction", downstream: v("ds") }),
    where: (v) => [tggEq(v("jName"), v("jName")), tggEq(v("ds"), v("ds"))],
  }),
];

export const hecHmsPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: hecHmsTggRules,
};
