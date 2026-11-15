// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const energyplusTggRules = [
  tggRule({
    name: "EnergyPlusZoneToModelicaThermalZone",
    sourceLang: "energyplus",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["ThermalZone"]?.({ name: v("zoneName"), volumeM3: v("vol") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("zoneName"),
        typeSpecifier: "Buildings.ThermalZones.EnergyPlus_9_6_0.ThermalZone",
        V: v("vol"),
      }),
    where: (v) => [
      tggEq(v("zoneName"), v("zoneName")),
      tggEq(v("vol"), v("vol")),
      tggReconcilePhysics(v("vol"), v("vol"), { min: 1.0, max: 1e6 }),
      tggComplement(["floorAreaM2", "ceilingHeightM"]),
    ],
  }),
  tggRule({
    name: "EnergyPlusSetPointToSysmlRequirement",
    sourceLang: "energyplus",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ThermostatSetpoint"]?.({ name: v("spName"), heatingTempC: v("tHeat") }),
    target: ($, v) => $["RequirementUsage"]?.({ declaredName: v("spName"), heatingSetpointC: v("tHeat") }),
    where: (v) => [
      tggEq(v("spName"), v("spName")),
      tggEq(v("tHeat"), v("tHeat")),
      tggReconcilePhysics(v("tHeat"), v("tHeat"), { min: 5.0, max: 35.0 }),
      tggComplement(["coolingTempC", "scheduleName"]),
    ],
  }),
];

export const energyplusPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: energyplusTggRules,
};
