// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const opticalTggRules = [
  tggRule({
    name: "OpticalSurfaceToSysmlPart",
    sourceLang: "optical",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["OpticalSurface"]?.({ name: v("surfName"), radiusMm: v("rad") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("surfName"), declaredType: "OpticalSurface", radiusMm: v("rad") }),
    where: (v) => [
      tggEq(v("surfName"), v("surfName")),
      tggEq(v("rad"), v("rad")),
      tggReconcilePhysics(v("rad"), v("rad"), { min: -1e6, max: 1e6 }),
      tggComplement(["thickness", "glass", "conic"]),
    ],
  }),
  tggRule({
    name: "OpticalLaserToModelicaSource",
    sourceLang: "optical",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["OpticalSource"]?.({ name: v("srcName"), wavelengthNm: v("wl") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("srcName"),
        typeSpecifier: "Modelica.Blocks.Sources.Constant",
        lambda_nm: v("wl"),
      }),
    where: (v) => [
      tggEq(v("srcName"), v("srcName")),
      tggEq(v("wl"), v("wl")),
      tggReconcilePhysics(v("wl"), v("wl"), { min: 100.0, max: 20000.0 }),
      tggComplement(["powerMw", "beamWaist"]),
    ],
  }),
];

export const opticalPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: opticalTggRules,
};
