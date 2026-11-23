// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/srec — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes Motorola S-Record firmware images (.srec, .s19, .s28, .s37, .mot, .sre, .sx)
 * into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseSrec } from "./parser/index.js";
import { solveSrecMemory } from "./solver/index.js";

const SREC_EXTS = [".srec", ".s19", ".s28", ".s37", ".mot", ".sre", ".sx"];

export const srecIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (SREC_EXTS.some((ext) => lower.endsWith(ext))) {
      return true;
    }
    if (!text) return false;
    return /^\s*S[0-35-9][0-9A-Fa-f]{8,}/m.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const file = parseSrec(ctx.text);
    const solved = solveSrecMemory(file);
    ctx.setParsedModel(file);

    const rootId = ctx.addSymbol(
      file.name,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        recordCount: file.records.length,
        totalDataBytes: solved.totalDataBytes,
        crc32: solved.overallCrc32,
      },
      {
        ruleName: "SrecFile",
        namePath: "name",
      },
    );

    for (const region of solved.regions) {
      const addrHex = `0x${region.startAddress.toString(16).toUpperCase().padStart(8, "0")}`;
      const label = `Region_${region.index} [${addrHex}, ${region.size} B]`;
      const firstRec = file.records.find((r) => r.line === region.firstLine);
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        firstRec?.startOffset ?? 0,
        firstRec?.endOffset ?? 0,
        {
          regionIndex: region.index,
          startAddress: region.startAddress,
          endAddress: region.endAddress,
          size: region.size,
          crc32: region.crc32,
        },
        {
          ruleName: "Record",
          namePath: "name",
          aliases: [`Region_${region.index}`, addrHex],
        },
      );
    }
  },
};
