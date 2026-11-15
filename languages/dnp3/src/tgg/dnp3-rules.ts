// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const dnp3TggRules = [
  tggRule({
    name: "Dnp3OutstationToSysmlPart",
    sourceLang: "dnp3",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["OutstationDevice"]?.({ name: v("devName"), address: v("addr") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("devName"), declaredType: "Dnp3Outstation", dnpAddress: v("addr") }),
    where: (v) => [
      tggEq(v("devName"), v("devName")),
      tggEq(v("addr"), v("addr")),
      tggComplement(["masterAddress", "unsolicited"]),
    ],
  }),
  tggRule({
    name: "Dnp3PointToModelicaSignal",
    sourceLang: "dnp3",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["PointMapping"]?.({ name: v("ptName"), group: v("grpName") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("ptName"),
        typeSpecifier: "Modelica.Blocks.Interfaces.RealInput",
        pointGroup: v("grpName"),
      }),
    where: (v) => [
      tggEq(v("ptName"), v("ptName")),
      tggEq(v("grpName"), v("grpName")),
      tggComplement(["index", "classAssign", "deadband"]),
    ],
  }),
];

export const dnp3PolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: dnp3TggRules,
};
