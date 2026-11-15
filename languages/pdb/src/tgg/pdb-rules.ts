// SPDX-License-Identifier: AGPL-3.0-or-later

import { tggComplement, tggEq, tggReconcilePhysics, tggRule, type PolyglotConfig } from "@modelscript/dsl";

export const pdbTggRules = [
  tggRule({
    name: "PdbChainToSysmlPart",
    sourceLang: "pdb",
    targetLang: "sysml2",
    priority: 10,
    source: ($, v) => $["PolypeptideChain"]?.({ name: v("chainId"), residueCount: v("resCount") }),
    target: ($, v) =>
      $["PartUsage"]?.({ declaredName: v("chainId"), declaredType: "ProteinChain", residueCount: v("resCount") }),
    where: (v) => [
      tggEq(v("chainId"), v("chainId")),
      tggEq(v("resCount"), v("resCount")),
      tggComplement(["organism", "ecNumber"]),
    ],
  }),
  tggRule({
    name: "PdbAtomSiteToModelicaParam",
    sourceLang: "pdb",
    targetLang: "modelica",
    priority: 15,
    source: ($, v) => $["AtomSite"]?.({ name: v("atomName"), bFactor: v("bFac") }),
    target: ($, v) => $["ComponentClause"]?.({ name: v("atomName"), typeSpecifier: "Real", B_factor: v("bFac") }),
    where: (v) => [
      tggEq(v("atomName"), v("atomName")),
      tggEq(v("bFac"), v("bFac")),
      tggReconcilePhysics(v("bFac"), v("bFac"), { min: 0.0, max: 500.0 }),
      tggComplement(["x", "y", "z", "occupancy"]),
    ],
  }),
];

export const pdbPolyglotConfig: PolyglotConfig = {
  languages: ["sysml2", "modelica"],
  rules: pdbTggRules,
};
