// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const watermlTggRules = [
  tggRule({
    name: "WaterMlSeriesToModelicaTable",
    sourceLang: "waterml",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["TimeSeriesObservation"]?.({ name: v("obsName"), unitCode: v("unit") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("obsName"),
        typeSpecifier: "Modelica.Blocks.Sources.CombiTimeTable",
        unit: v("unit"),
      }),
    where: (v) => [
      tggEq(v("obsName"), v("obsName")),
      tggEq(v("unit"), v("unit")),
      tggComplement(["observedProperty", "points"]),
    ],
  }),
  tggRule({
    name: "WaterMlMonitoringPointToSysmlAttribute",
    sourceLang: "waterml",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["MonitoringPoint"]?.({ name: v("siteId"), elevationM: v("elev") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("siteId"), elevationM: v("elev") }),
    where: (v) => [
      tggEq(v("siteId"), v("siteId")),
      tggEq(v("elev"), v("elev")),
      tggReconcilePhysics(v("elev"), v("elev"), { min: -500.0, max: 9000.0 }),
      tggComplement(["latitude", "longitude"]),
    ],
  }),
];

export const watermlPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: watermlTggRules,
};
