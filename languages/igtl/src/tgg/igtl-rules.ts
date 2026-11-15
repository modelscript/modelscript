// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const igtlTggRules = [
  tggRule({
    name: "IgtlTransformToModelicaFrame",
    sourceLang: "igtl",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["IgtlTransformMsg"]?.({ name: v("devName"), timestampSec: v("ts") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("devName"),
        typeSpecifier: "Modelica.Mechanics.MultiBody.Frames.TransformationMatrices.Orientation",
        t_stamp: v("ts"),
      }),
    where: (v) => [
      tggEq(v("devName"), v("devName")),
      tggEq(v("ts"), v("ts")),
      tggReconcilePhysics(v("ts"), v("ts"), { min: 0.0, max: 1e10 }),
      tggComplement(["matrix4x4"]),
    ],
  }),
  tggRule({
    name: "IgtlDeviceToSysmlPort",
    sourceLang: "igtl",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["IgtlEndpoint"]?.({ name: v("epName"), msgType: v("mType") }),
    target: ($, v) => $["PortUsage"]?.({ declaredName: v("epName"), declaredType: v("mType") }),
    where: (v) => [tggEq(v("epName"), v("epName")), tggEq(v("mType"), v("mType")), tggComplement(["host", "port"])],
  }),
];

export const igtlPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: igtlTggRules,
};
