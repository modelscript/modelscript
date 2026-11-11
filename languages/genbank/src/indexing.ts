// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { UnifiedWorkspace } from "@modelscript/runtime";
import { getFeatureDisplayName } from "./lints/genbank-linter.js";
import { parseGenbank } from "./parser/genbank-parser.js";
import type { GenbankDocument } from "./types.js";

/**
 * Declarative multi-file workspace indexer for GenBank and FASTA documents (.gb, .gbk, .fasta, .fa).
 */
export function indexGenbankDocument(ctx: DslIndexFileContext): void {
  const { uri, text } = ctx;
  try {
    const doc = parseGenbank(text, uri);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      "GenbankDocument",
      "package",
      null,
      0,
      text.length,
      {
        format: doc.format,
        recordCount: doc.records.length,
      },
      { ruleName: "genbank_symbol", namePath: "GenbankDocument" },
    );

    for (const rec of doc.records) {
      const recStart = rec.range?.startOffset ?? 0;
      const recEnd = rec.range?.endOffset ?? text.length;
      const recId = ctx.addSymbol(
        rec.locus,
        "class",
        rootId,
        recStart,
        recEnd,
        {
          declaredLength: rec.declaredLength,
          actualLength: rec.sequence.length,
          moleculeType: rec.moleculeType,
          topology: rec.topology,
          definition: rec.definition,
          accession: rec.accession,
        },
        { ruleName: "genbank_symbol", namePath: rec.locus },
      );

      for (let i = 0; i < rec.features.length; i++) {
        const feat = rec.features[i]!;
        const featName = getFeatureDisplayName(feat, i);
        const fStart = feat.range?.startOffset ?? recStart;
        const fEnd = feat.range?.endOffset ?? recEnd;
        ctx.addSymbol(
          featName,
          feat.key === "CDS" ? "function" : "field",
          recId,
          fStart,
          fEnd,
          {
            key: feat.key,
            start: feat.location.start,
            end: feat.location.end,
            strand: feat.location.strand,
            qualifiers: feat.qualifiers,
          },
          { ruleName: "genbank_symbol", namePath: `${rec.locus}.${featName}` },
        );
      }
    }
  } catch {
    // Ignore partial parse errors during incremental editing
  }
}

export function getGenbankDocument(workspace: UnifiedWorkspace, uri: string): GenbankDocument | undefined {
  return workspace.getParsedModel<GenbankDocument>(uri);
}
