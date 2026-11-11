// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseSmilesDocument } from "./parser/smiles-parser.js";
import { estimateThermophysicalProperties } from "./solvers/property-estimator.js";

/**
 * Declarative `UnifiedWorkspace` file indexer for SMILES/SMARTS and MDL Molfile/SDF documents (`.smi`, `.smarts`, `.mol`, `.sdf`).
 */
export function indexSmilesFile(ctx: DslIndexFileContext): void {
  try {
    const doc = parseSmilesDocument(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      "SmilesLibrary",
      "package",
      null,
      0,
      ctx.text.length,
      {
        format: doc.format,
        moleculeCount: doc.molecules.length,
      },
      { ruleName: "smiles_symbol" },
    );

    for (const mol of doc.molecules) {
      const start = mol.range?.startOffset ?? 0;
      const end = mol.range?.endOffset ?? ctx.text.length;
      const est = estimateThermophysicalProperties(mol);

      const molSymId = ctx.addSymbol(
        mol.name || mol.id,
        "struct",
        rootId,
        start,
        end,
        {
          id: mol.id,
          smiles: mol.smiles,
          formula: est.formula,
          molecularWeight: est.molecularWeight,
          Tb: est.Tb,
          Tc: est.Tc,
          Pc: est.Pc,
          Vc: est.Vc,
          logP: est.logP,
          tpsa: est.tpsa,
        },
        { ruleName: "smiles_symbol" },
      );

      for (const [grpName, count] of Object.entries(est.groupCounts)) {
        ctx.addSymbol(
          `${mol.name}_${grpName}`,
          "property",
          molSymId,
          start,
          end,
          {
            group: grpName,
            count,
          },
          { ruleName: "smiles_symbol" },
        );
      }
    }
  } catch {
    // Return partial symbol map if parsing failed
  }
}
