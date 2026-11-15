// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const jsbsimTggRules = [
  tggRule({
    name: "JsbsimMetricsToModelicaBody",
    sourceLang: "jsbsim",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["MassBalance"]?.({ name: v("acName"), emptyWtLbs: v("wt") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("acName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Parts.Body",
        m_lbs: v("wt"),
      }),
    where: (v) => [
      tggEq(v("acName"), v("acName")),
      tggEq(v("wt"), v("wt")),
      tggReconcilePhysics(v("wt"), v("wt"), { min: 1.0, max: 2e6 }),
      tggComplement(["ixx", "iyy", "izz", "cgLoc"]),
    ],
  }),
  tggRule({
    name: "JsbsimChannelToSysmlPart",
    sourceLang: "jsbsim",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["FlightControlChannel"]?.({ name: v("chName"), gain: v("kVal") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("chName"), declaredType: "FlightControlChannel", gain: v("kVal") }),
    where: (v) => [
      tggEq(v("chName"), v("chName")),
      tggEq(v("kVal"), v("kVal")),
      tggReconcilePhysics(v("kVal"), v("kVal"), { min: -1e4, max: 1e4 }),
      tggComplement(["executeRateHz"]),
    ],
  }),
];

export const jsbsimPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: jsbsimTggRules,
};
