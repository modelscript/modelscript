// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const rocetsTggRules = [
  tggRule({
    name: "RocetsChamberToModelicaVolume",
    sourceLang: "rocets",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["ThrustChamber"]?.({ name: v("chName"), chamberPressureBar: v("pc") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("chName"),
        typeSpecifier: "Modelica.Fluid.Vessels.ClosedVolume",
        p_c: v("pc"),
      }),
    where: (v) => [
      tggEq(v("chName"), v("chName")),
      tggEq(v("pc"), v("pc")),
      tggReconcilePhysics(v("pc"), v("pc"), { min: 1.0, max: 500.0 }),
      tggComplement(["ispVacSec", "expansionRatio"]),
    ],
  }),
  tggRule({
    name: "RocetsTurbopumpToSysmlPart",
    sourceLang: "rocets",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["Turbopump"]?.({ name: v("tpName"), shaftRpm: v("rpm") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("tpName"), declaredType: "Turbopump", shaftRpm: v("rpm") }),
    where: (v) => [
      tggEq(v("tpName"), v("tpName")),
      tggEq(v("rpm"), v("rpm")),
      tggReconcilePhysics(v("rpm"), v("rpm"), { min: 100.0, max: 150000.0 }),
      tggComplement(["efficiency", "propellant"]),
    ],
  }),
];

export const rocetsPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: rocetsTggRules,
};
