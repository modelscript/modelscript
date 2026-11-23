// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/endf6 — Declarative UnifiedWorkspace Indexing.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { ENDF6_MT_DESCRIPTORS } from "./catalog/endf6-std-schemas.js";
import { parseEndf6Tape } from "./parser/tape-parser.js";

export const endf6Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (
      lower.endsWith(".endf") ||
      lower.endsWith(".endf6") ||
      lower.endsWith(".enf") ||
      lower.endsWith(".pendf") ||
      lower.endsWith(".gendf") ||
      lower.endsWith(".tape")
    ) {
      return true;
    }
    if (!text) return false;
    // Detect 80-column ENDF-6 card format with MAT/MF/MT columns and exponent-omitted float
    return /[+-]?\d\.\d{4,6}[+-]\d\s*\d{1,4}\s*[1-9]\s*\d{1,3}/.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const tape = parseEndf6Tape(ctx.text);
    ctx.setParsedModel(tape);

    const rootId = ctx.addSymbol(
      tape.tpid || "ENDF-6 Tape",
      "Package",
      null,
      0,
      ctx.text.length,
      { materialCount: tape.materials.size, hasTend: tape.hasTend },
      { ruleName: "Tape", namePath: "tpid" },
    );

    for (const mat of tape.materials.values()) {
      const matId = ctx.addSymbol(
        `${mat.name} (MAT=${mat.mat})`,
        "Class",
        rootId,
        mat.startOffset,
        mat.endOffset,
        { mat: mat.mat, za: mat.za, awr: mat.awr },
        { ruleName: "Material", namePath: `MAT_${mat.mat}`, aliases: [mat.name, `MAT${mat.mat}`] },
      );

      for (const xs of mat.crossSections.values()) {
        const desc = ENDF6_MT_DESCRIPTORS.get(xs.mt);
        const label = desc ? `MF=3 MT=${xs.mt} (${desc.name})` : `MF=3 MT=${xs.mt}`;
        ctx.addSymbol(
          label,
          "Function",
          matId,
          xs.startOffset,
          xs.endOffset,
          { mat: mat.mat, mf: 3, mt: xs.mt, np: xs.tab1.np },
          { ruleName: "CrossSection", namePath: `MAT_${mat.mat}.MF3.MT${xs.mt}` },
        );
      }
    }
  },
};
