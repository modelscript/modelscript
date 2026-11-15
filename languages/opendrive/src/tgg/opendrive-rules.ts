// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const opendriveTggRules = [
  tggRule({
    name: "OpenDriveRoadToSysmlPart",
    sourceLang: "opendrive",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["RoadSegment"]?.({ name: v("roadId"), lengthM: v("len") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("roadId"), declaredType: "RoadSegment", lengthM: v("len") }),
    where: (v) => [
      tggEq(v("roadId"), v("roadId")),
      tggEq(v("len"), v("len")),
      tggReconcilePhysics(v("len"), v("len"), { min: 0.1, max: 1e6 }),
      tggComplement(["junctionId", "lanes"]),
    ],
  }),
  tggRule({
    name: "OpenDriveSpeedLimitToModelicaParam",
    sourceLang: "opendrive",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["LaneSpeedLimit"]?.({ name: v("laneId"), maxSpeedMps: v("vMax") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("laneId"), typeSpecifier: "Real", v_max: v("vMax") }),
    where: (v) => [
      tggEq(v("laneId"), v("laneId")),
      tggEq(v("vMax"), v("vMax")),
      tggReconcilePhysics(v("vMax"), v("vMax"), { min: 0.0, max: 100.0 }),
      tggComplement(["unit"]),
    ],
  }),
];

export const opendrivePolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: opendriveTggRules,
};
