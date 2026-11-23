// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/iges — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes IGES 5.3 CAD exchange files (.igs, .iges) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseIges } from "./parser/iges-parser.js";
import { IGES_ENTITY_TYPE_NAMES } from "./types.js";

export const igesIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".igs") || lower.endsWith(".iges")) {
      return true;
    }
    if (!text) return false;
    const lines = text.split(/\r?\n/, 4);
    return lines.some((l) => l.length === 80 && l[72] === "S" && /^\s*\d+$/.test(l.slice(73, 80)));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseIges(ctx.text);
    ctx.setParsedModel(doc);

    const modelName = doc.global?.productIdSender || doc.global?.fileName || "IGES_Model";
    const rootId = ctx.addSymbol(
      modelName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        unitFlag: doc.global?.unitFlag ?? 6,
        unitName: doc.global?.unitName ?? "M",
        entityCount: doc.entities.length,
      },
      {
        ruleName: "igesModel",
        namePath: "name",
      },
    );

    for (const [deNum, de] of doc.directoryEntries) {
      const typeName = IGES_ENTITY_TYPE_NAMES[de.entityType] ?? `Type ${de.entityType}`;
      const label = de.entityLabel ? `${de.entityLabel} [D${deNum}: ${typeName}]` : `D${deNum} [${typeName}]`;
      ctx.addSymbol(
        label,
        "Class",
        rootId,
        de.startOffset,
        de.endOffset,
        {
          deNumber: deNum,
          entityType: de.entityType,
          formNumber: de.formNumber,
          label: de.entityLabel,
        },
        {
          ruleName: "igesEntity",
          namePath: "name",
          aliases: [`D${deNum}`, ...(de.entityLabel ? [de.entityLabel] : [])],
        },
      );
    }
  },
};
