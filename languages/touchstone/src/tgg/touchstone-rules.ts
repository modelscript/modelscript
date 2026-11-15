// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const touchstoneTggRules = [
  tggRule({
    name: "TouchstoneNetworkToModelicaPort",
    sourceLang: "touchstone",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["TouchstoneOption"]?.({ name: v("netName"), z0Ohm: v("z0") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("netName"),
        typeSpecifier: "Modelica.Electrical.Analog.Lines.TLine",
        Z0: v("z0"),
      }),
    where: (v) => [
      tggEq(v("netName"), v("netName")),
      tggEq(v("z0"), v("z0")),
      tggReconcilePhysics(v("z0"), v("z0"), { min: 1.0, max: 1000.0 }),
      tggComplement(["freqUnit", "paramType", "format"]),
    ],
  }),
  tggRule({
    name: "TouchstoneSampleToSysmlAttribute",
    sourceLang: "touchstone",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SParamSample"]?.({ name: v("ptName"), freqHz: v("freq") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("ptName"), frequencyHz: v("freq") }),
    where: (v) => [
      tggEq(v("ptName"), v("ptName")),
      tggEq(v("freq"), v("freq")),
      tggReconcilePhysics(v("freq"), v("freq"), { min: 0.0, max: 1e12 }),
      tggComplement(["matrix"]),
    ],
  }),
];

export const touchstonePolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: touchstoneTggRules,
};
