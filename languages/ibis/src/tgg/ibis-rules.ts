// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const ibisTggRules = [
  tggRule({
    name: "IbisComponentToSysmlPart",
    sourceLang: "ibis",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["IbisComponent"]?.({ name: v("compName"), manufacturer: v("mfg") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("compName"), declaredType: v("mfg") }),
    where: (v) => [tggEq(v("compName"), v("compName")), tggEq(v("mfg"), v("mfg")), tggComplement(["pins", "package"])],
  }),
  tggRule({
    name: "IbisModelToModelicaBuffer",
    sourceLang: "ibis",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["IbisModel"]?.({ name: v("modName"), cCompPf: v("cComp") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("modName"),
        typeSpecifier: "Modelica.Electrical.Analog.Basic.Capacitor",
        C: v("cComp"),
      }),
    where: (v) => [
      tggEq(v("modName"), v("modName")),
      tggEq(v("cComp"), v("cComp")),
      tggReconcilePhysics(v("cComp"), v("cComp"), { min: 0.0, max: 1e3 }),
      tggComplement(["modelType", "vinh", "vinl"]),
    ],
  }),
];

export const ibisPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: ibisTggRules,
};
