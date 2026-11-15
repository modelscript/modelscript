// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const gtfsTggRules = [
  tggRule({
    name: "GtfsStopToSysmlPart",
    sourceLang: "gtfs",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["TransitStop"]?.({ name: v("stopId"), stopLat: v("lat") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("stopId"), declaredType: "TransitStop", latitude: v("lat") }),
    where: (v) => [
      tggEq(v("stopId"), v("stopId")),
      tggEq(v("lat"), v("lat")),
      tggReconcilePhysics(v("lat"), v("lat"), { min: -90.0, max: 90.0 }),
      tggComplement(["stopLon", "stopName", "zoneId"]),
    ],
  }),
  tggRule({
    name: "GtfsRouteToModelicaBlock",
    sourceLang: "gtfs",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["TransitRoute"]?.({ name: v("routeId"), headwaySec: v("hw") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("routeId"),
        typeSpecifier: "Modelica.Blocks.Sources.Pulse",
        period: v("hw"),
      }),
    where: (v) => [
      tggEq(v("routeId"), v("routeId")),
      tggEq(v("hw"), v("hw")),
      tggReconcilePhysics(v("hw"), v("hw"), { min: 10.0, max: 86400.0 }),
      tggComplement(["routeType", "agencyId"]),
    ],
  }),
];

export const gtfsPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: gtfsTggRules,
};
