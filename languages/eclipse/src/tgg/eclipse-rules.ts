// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const eclipseTggRules = [
  tggRule({
    name: "EclipseWellToModelicaSink",
    sourceLang: "eclipse",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["WellSpec"]?.({ name: v("wellName"), bhpBar: v("bhp") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: v("wellName"),
        typeSpecifier: "Modelica.Fluid.Sources.Boundary_pT",
        p: v("bhp"),
      }),
    where: (v) => [
      tggEq(v("wellName"), v("wellName")),
      tggEq(v("bhp"), v("bhp")),
      tggReconcilePhysics(v("bhp"), v("bhp"), { min: 1.0, max: 1500.0 }),
      tggComplement(["wellGroup", "phase", "skin"]),
    ],
  }),
  tggRule({
    name: "EclipseGridToSysmlPart",
    sourceLang: "eclipse",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ReservoirGrid"]?.({ name: v("gridName"), porosity: v("phi") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("gridName"), declaredType: "ReservoirGrid", porosity: v("phi") }),
    where: (v) => [
      tggEq(v("gridName"), v("gridName")),
      tggEq(v("phi"), v("phi")),
      tggReconcilePhysics(v("phi"), v("phi"), { min: 0.0, max: 1.0 }),
      tggComplement(["nx", "ny", "nz", "permx"]),
    ],
  }),
];

export const eclipsePolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: eclipseTggRules,
};
