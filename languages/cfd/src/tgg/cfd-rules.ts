// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const cfdTggRules = [
  tggRule({
    name: "CfdDragPolarToModelicaParam",
    sourceLang: "cfd",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["Directive"]?.({ key: "CD", value: v("cdVal") }),
    target: ($, v) => $["ComponentClause"]?.({ name: "Cd", defaultValue: v("cdVal") }),
    where: (v) => [
      tggEq(v("cdVal"), v("cdVal")),
      tggReconcilePhysics(v("cdVal"), v("cdVal"), { min: 0.0, max: 10.0 }),
      tggComplement(["refArea", "cl"]),
    ],
  }),
  tggRule({
    name: "CfdDragPolarToSysmlAttribute",
    sourceLang: "cfd",
    targetLang: "sysml2",
    priority: 15,
    source: ($, v) => $["Directive"]?.({ key: "CD", value: v("cdVal") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: "aeroDragCoeff", defaultValue: v("cdVal") }),
    where: (v) => [
      tggEq(v("cdVal"), v("cdVal")),
      tggReconcilePhysics(v("cdVal"), v("cdVal"), { min: 0.0, max: 10.0 }),
      tggComplement(["refArea", "cl"]),
    ],
  }),
  tggRule({
    name: "CfdInletToModelicaFluidPort",
    sourceLang: "cfd",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["Directive"]?.({ key: "MARKER_INLET", value: v("markerVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: "inlet",
        typeSpecifier: "Modelica.Fluid.Interfaces.FluidPort_a",
        modification: v("markerVal"),
      }),
    where: (v) => [tggEq(v("markerVal"), v("markerVal")), tggComplement(["dialect", "meshFilename", "options"])],
  }),
  tggRule({
    name: "CfdHeatFluxToModelicaHeatPort",
    sourceLang: "cfd",
    targetLang: "modelica",
    priority: 9,
    source: ($, v) => $["Directive"]?.({ key: "MARKER_HEATFLUX", value: v("markerVal") }),
    target: ($, v) =>
      $["ComponentClause"]?.({
        name: "heatPort",
        typeSpecifier: "Modelica.Thermal.HeatTransfer.Interfaces.HeatPort_a",
        modification: v("markerVal"),
      }),
    where: (v) => [tggEq(v("markerVal"), v("markerVal")), tggComplement(["dialect", "meshFilename", "options"])],
  }),
  tggRule({
    name: "CfdMarkerToSysmlPort",
    sourceLang: "cfd",
    targetLang: "sysml2",
    priority: 5,
    source: ($, v) => $["Directive"]?.({ key: "MARKER_SYM", value: v("markerVal") }),
    target: ($, v) => $["PortUsage"]?.({ declaredName: "marker_sym", declaredType: v("markerVal") }),
    where: (v) => [tggEq(v("markerVal"), v("markerVal")), tggComplement(["dialect", "options"])],
  }),
  tggRule({
    name: "CfdDirectiveToSysmlConstraint",
    sourceLang: "cfd",
    targetLang: "sysml2",
    priority: 0,
    source: ($, v) => $["Directive"]?.({ key: v("dirKey"), value: v("dirVal") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("dirKey"), expression: v("dirVal") }),
    where: (v) => [tggEq(v("dirKey"), v("dirKey")), tggEq(v("dirVal"), v("dirVal"))],
  }),
];

export const cfdPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: cfdTggRules,
};
