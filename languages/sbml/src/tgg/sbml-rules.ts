// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const sbmlTggRules = [
  tggRule({
    name: "SbmlSpeciesToModelicaVariable",
    sourceLang: "sbml",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["SbmlSpecies"]?.({ name: v("spId"), initialConc: v("conc") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("spId"), typeSpecifier: "Real", start: v("conc") }),
    where: (v) => [
      tggEq(v("spId"), v("spId")),
      tggEq(v("conc"), v("conc")),
      tggReconcilePhysics(v("conc"), v("conc"), { min: 0.0, max: 1e6 }),
      tggComplement(["compartment", "boundaryCondition"]),
    ],
  }),
  tggRule({
    name: "SbmlReactionToSysmlConstraint",
    sourceLang: "sbml",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SbmlReaction"]?.({ name: v("rxnId"), kineticLaw: v("law") }),
    target: ($, v) => $["ConstraintUsage"]?.({ declaredName: v("rxnId"), expression: v("law") }),
    where: (v) => [
      tggEq(v("rxnId"), v("rxnId")),
      tggEq(v("law"), v("law")),
      tggComplement(["reversible", "reactants", "products"]),
    ],
  }),
];

export const sbmlPolyglotConfig: PolyglotConfig = {
  languages: ["modelica", "sysml2"],
  rules: sbmlTggRules,
};
