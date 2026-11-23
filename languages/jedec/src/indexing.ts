// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/jedec — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes JEDEC JESD3 PLD fuse-map and test-vector files (`.jed`, `.jedec`) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseJedec } from "./parser/jedec-parser.js";
import { extractJedecEquations } from "./solver/boolean-extractor.js";

const JEDEC_EXTENSIONS = [".jed", ".jedec"];

export const jedecIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (JEDEC_EXTENSIONS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
    if (!text) return false;
    return /\bQF\d+\*/.test(text) && (/\bL\d+\s+[01]+/.test(text) || /\bQP\d+\*/.test(text));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseJedec(ctx.text, ctx.uri);
    ctx.setParsedModel(doc);

    const extraction = extractJedecEquations(doc);

    const rootId = ctx.addSymbol(
      doc.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        deviceName: doc.deviceName,
        pinCount: doc.pinCount ?? extraction.pinCount,
        fuseCount: doc.fuseCount ?? doc.fuses.length,
        vectorCount: doc.testVectors.length,
      },
      {
        ruleName: "jedec_file",
        namePath: "name",
      },
    );

    for (const eq of extraction.equations) {
      if (eq.activeTerms.length === 0 && (!eq.oeTerm || eq.oeTerm.alwaysFalse)) continue;
      ctx.addSymbol(
        eq.signalName,
        "Component",
        rootId,
        0,
        ctx.text.length,
        {
          pin: eq.pin,
          activeLow: eq.activeLow,
          activeTermCount: eq.activeTerms.length,
          equation: eq.equation,
        },
        {
          ruleName: "output_macrocell",
          namePath: "name",
          aliases: [`PIN${eq.pin}`, eq.signalName],
        },
      );
    }

    for (const block of doc.fuseBlocks) {
      ctx.addSymbol(
        `L${block.address}`,
        "Variable",
        rootId,
        block.span.startOffset,
        block.span.endOffset,
        {
          address: block.address,
          bitLength: block.bits.length,
        },
        {
          ruleName: "fuse_list",
          namePath: "name",
        },
      );
    }

    for (const vec of doc.testVectors) {
      ctx.addSymbol(
        `V${String(vec.number).padStart(4, "0")}`,
        "Function",
        rootId,
        vec.span.startOffset,
        vec.span.endOffset,
        {
          vectorNumber: vec.number,
          pins: vec.pins,
        },
        {
          ruleName: "test_vector",
          namePath: "name",
        },
      );
    }
  },
};
