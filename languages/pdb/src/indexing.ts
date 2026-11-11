// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, UnifiedWorkspace } from "@modelscript/runtime";
import { parsePdb } from "./parser/pdb-parser.js";
import { solveProteinBiophysics } from "./solvers/protein-biophysics-solver.js";
import type { PdbDocument } from "./types.js";

/**
 * Declarative multi-file indexer for Protein Data Bank (.pdb, .ent) and PDBx/mmCIF (.cif, .mmcif) documents.
 */
export function indexPdbFile(ctx: DslIndexFileContext): void {
  try {
    const doc = parsePdb(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);
    const bio = solveProteinBiophysics(doc);

    const rootName = doc.id || "PDBStructure";
    const rootId = ctx.addSymbol(
      rootName,
      "package",
      null,
      0,
      ctx.text.length,
      {
        id: doc.id,
        title: doc.title,
        format: doc.format,
        atomCount: bio.atomCount,
        residueCount: bio.residueCount,
        chainCount: bio.chainCount,
        molecularWeightDa: bio.molecularWeightDa,
        radiusOfGyration: bio.radiusOfGyration,
      },
      {
        ruleName: "pdb_symbol",
        namePath: rootName,
      },
    );

    for (const chain of doc.chains) {
      const cStart = chain.range?.startOffset ?? 0;
      const cEnd = chain.range?.endOffset ?? ctx.text.length;
      const chainName = `Chain_${chain.id}`;
      const chainSymId = ctx.addSymbol(
        chainName,
        "module",
        rootId,
        cStart,
        cEnd,
        {
          chainId: chain.id,
          sequence: chain.sequence,
          residueCount: chain.residues.length,
        },
        {
          ruleName: "pdb_symbol",
          namePath: chainName,
        },
      );

      for (const res of chain.residues) {
        const rStart = res.range?.startOffset ?? cStart;
        const rEnd = res.range?.endOffset ?? cEnd;
        const resName = `${res.resName}${res.resSeq}`;
        ctx.addSymbol(
          resName,
          "struct",
          chainSymId,
          rStart,
          rEnd,
          {
            resName: res.resName,
            resSeq: res.resSeq,
            chainId: res.chainId,
            atomCount: res.atoms.length,
          },
          {
            ruleName: "pdb_symbol",
            namePath: resName,
          },
        );
      }
    }
  } catch {
    // Preserve partial symbol map if parsing failed
  }
}

export function getPdbDocument(workspace: UnifiedWorkspace, uri: string): PdbDocument | undefined {
  return workspace.getParsedModel<PdbDocument>(uri);
}

export function findPdbDefinition(workspace: UnifiedWorkspace, name: string): SymbolEntry | undefined {
  return workspace.findSymbolsByName(name)[0];
}

export function findPdbReferences(workspace: UnifiedWorkspace, name: string): SymbolEntry[] {
  return workspace.findSymbolsByName(name);
}
