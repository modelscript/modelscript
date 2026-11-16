// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const stepTggRules = [
  tggRule({
    name: "StepProductToSysmlPartDef",
    sourceLang: "step",
    targetLang: "sysml2",
    priority: 12,
    source: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: v("prodName") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("prodName") }),
    where: (v) => [tggEq(v("prodName"), v("prodName")), tggComplement(["stepId", "frameOfReference"])],
  }),
  tggRule({
    name: "StepProductToSysmlPart",
    sourceLang: "step",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: v("prodName") }),
    target: ($, v) => $["PartUsage"]?.({ declaredName: v("prodName"), declaredType: "MechanicalPart" }),
    where: (v) => [tggEq(v("prodName"), v("prodName")), tggComplement(["stepId", "frameOfReference"])],
  }),
  tggRule({
    name: "StepProductToModelicaModel",
    sourceLang: "step",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["StepEntity"]?.({ entityType: "PRODUCT", name: v("prodName") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("prodName"), classKind: "model" }),
    where: (v) => [tggEq(v("prodName"), v("prodName")), tggComplement(["stepId", "frameOfReference"])],
  }),
  tggRule({
    name: "StepDatumToQifDatum",
    sourceLang: "step",
    targetLang: "qif",
    priority: 9,
    relation: "verify",
    source: ($, v) => $["StepEntity"]?.({ entityType: "DATUM", name: v("datumLabel") }),
    target: ($, v) => $["qif_datum"]?.({ name: v("datumLabel") }),
    where: (v) => [tggEq(v("datumLabel"), v("datumLabel")), tggComplement(["stepId"])],
  }),
  tggRule({
    name: "StepGeometricToleranceToQifCharacteristic",
    sourceLang: "step",
    targetLang: "qif",
    priority: 9,
    relation: "verify",
    source: ($, v) => $["StepEntity"]?.({ entityType: "TOLERANCE", name: v("charName") }),
    target: ($, v) => $["DimensionalCharacteristic"]?.({ name: v("charName") }),
    where: (v) => [tggEq(v("charName"), v("charName")), tggComplement(["stepId"])],
  }),
  tggRule({
    name: "StepPointToSysmlAttribute",
    sourceLang: "step",
    targetLang: "sysml2",
    priority: 5,
    source: ($, v) => $["StepEntity"]?.({ entityType: "CARTESIAN_POINT", name: v("ptName") }),
    target: ($, v) => $["AttributeUsage"]?.({ declaredName: v("ptName"), declaredType: "CartesianPoint3D" }),
    where: (v) => [tggEq(v("ptName"), v("ptName")), tggComplement(["stepId", "coordinates"])],
  }),
];

export const stepPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica", "scad", "qif"],
  rules: stepTggRules,
};
