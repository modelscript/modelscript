// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const openscenarioTggRules = [
  tggRule({
    name: "OpenScenarioEntityToSysmlPart",
    sourceLang: "openscenario",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ScenarioEntity"]?.({ name: v("entName"), category: v("cat") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("entName"), declaredType: v("cat") }),
    where: (v) => [
      tggEq(v("entName"), v("entName")),
      tggEq(v("cat"), v("cat")),
      tggComplement(["boundingBox", "performance"]),
    ],
  }),
  tggRule({
    name: "OpenScenarioManeuverToSysmlRequirement",
    sourceLang: "openscenario",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SpeedAction"]?.({ name: v("actName"), targetSpeedMps: v("vTgt") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("actName"), targetSpeedMps: v("vTgt") }),
    where: (v) => [
      tggEq(v("actName"), v("actName")),
      tggEq(v("vTgt"), v("vTgt")),
      tggReconcilePhysics(v("vTgt"), v("vTgt"), { min: 0.0, max: 100.0 }),
      tggComplement(["transitionDynamics"]),
    ],
  }),
];

export const openscenarioPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2"],
  rules: openscenarioTggRules,
};
