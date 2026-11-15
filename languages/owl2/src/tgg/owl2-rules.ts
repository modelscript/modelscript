// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const owl2TggRules = [
  tggRule({
    name: "OWL2ClassToSysML2Part",
    sourceLang: "owl2",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ClassDeclaration"]?.({ iri: v("iri") }),
    target: ($, v) => $["PartDefinition"]?.({ declaredName: v("iri") }),
    where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["annotations"])],
  }),
  tggRule({
    name: "OWL2SubClassToSysML2Specialization",
    sourceLang: "owl2",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SubClassOfAxiom"]?.({ subClass: v("sub"), superClass: v("sup") }),
    target: ($, v) => $["Specialization"]?.({ generalName: v("sup"), specificName: v("sub") }),
    where: (v) => [tggEq(v("sub"), v("sub")), tggEq(v("sup"), v("sup"))],
  }),
  tggRule({
    name: "OWL2ObjectPropertyToSysML2Port",
    sourceLang: "owl2",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["ObjectPropertyDeclaration"]?.({ iri: v("iri") }),
    target: ($, v) => $["PortDefinition"]?.({ declaredName: v("iri") }),
    where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["isFunctional", "isTransitive"])],
  }),
  tggRule({
    name: "OWL2DataPropertyToSysML2Attribute",
    sourceLang: "owl2",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["DataPropertyDeclaration"]?.({ iri: v("iri") }),
    target: ($, v) => $["AttributeDefinition"]?.({ declaredName: v("iri") }),
    where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["rangeType"])],
  }),
  tggRule({
    name: "OWL2ClassToModelicaModel",
    sourceLang: "owl2",
    targetLang: "modelica",
    priority: 10,
    source: ($, v) => $["ClassDeclaration"]?.({ iri: v("iri") }),
    target: ($, v) => $["ClassDefinition"]?.({ name: v("iri"), classKind: "model" }),
    where: (v) => [tggEq(v("iri"), v("iri")), tggComplement(["annotations"])],
  }),
];

export const owl2PolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: owl2TggRules,
};
