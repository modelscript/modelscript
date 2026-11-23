// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseMolfileDocument } from "./parser/molfile-parser.js";
import { analyzeMolRecord } from "./solver/analyzer.js";

/**
 * Declarative `UnifiedWorkspace` file indexer for MDL Molfile V2000/V3000 & SDF documents (`.mol`, `.sdf`).
 */
export function indexMolfileFile(ctx: DslIndexFileContext): void {
  try {
    const doc = parseMolfileDocument(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      "MolfileLibrary",
      "package",
      null,
      0,
      ctx.text.length,
      {
        format: doc.format,
        recordCount: doc.records.length,
      },
      { ruleName: "molfile_symbol" },
    );

    for (const rec of doc.records) {
      const start = rec.range.startOffset;
      const end = rec.range.endOffset;
      const analysis = analyzeMolRecord(rec);

      const recSymId = ctx.addSymbol(
        rec.name || rec.id,
        "struct",
        rootId,
        start,
        end,
        {
          id: rec.id,
          version: rec.counts.version,
          formula: analysis.formula,
          molecularWeight: analysis.molecularWeight,
          exactMass: analysis.exactMass,
          atomCount: rec.atoms.length,
          bondCount: rec.bonds.length,
          ringCount: analysis.ringCount,
          totalStretchEnergy: analysis.totalStretchEnergy,
        },
        { ruleName: "molfile_symbol" },
      );

      for (const item of rec.sdfDataItems) {
        ctx.addSymbol(
          `${rec.name}_${item.tag}`,
          "property",
          recSymId,
          start,
          end,
          {
            tag: item.tag,
            value: item.value,
          },
          { ruleName: "molfile_symbol" },
        );
      }
    }
  } catch {
    // Return partial symbol map if parsing failed
  }
}
