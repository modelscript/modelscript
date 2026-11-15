// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const smilesTggRules = [
  tggRule({
    name: "SmilesMoleculeToSysmlPart",
    sourceLang: "smiles",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["SmilesMolecule"]?.({ name: v("molName"), canonicalSmiles: v("smiles") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("molName"), declaredType: "ChemicalSpecies", smiles: v("smiles") }),
    where: (v) => [
      tggEq(v("molName"), v("molName")),
      tggEq(v("smiles"), v("smiles")),
      tggComplement(["charge", "chirality"]),
    ],
  }),
  tggRule({
    name: "SmilesPropertyToModelicaParam",
    sourceLang: "smiles",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["MolecularProperty"]?.({ name: v("propName"), molarMassGmol: v("mw") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("propName"), typeSpecifier: "Real", MM: v("mw") }),
    where: (v) => [
      tggEq(v("propName"), v("propName")),
      tggEq(v("mw"), v("mw")),
      tggReconcilePhysics(v("mw"), v("mw"), { min: 1.0, max: 1e6 }),
      tggComplement(["formula"]),
    ],
  }),
];

export const smilesPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: smilesTggRules,
};
