// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/dxf — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes AutoCAD DXF (.dxf) drawings (layers, blocks, and entities) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseDxf } from "./parser/dxf-parser.js";

export const dxfIndexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    if (uri.toLowerCase().endsWith(".dxf")) {
      return true;
    }
    if (!text) return false;
    return /^\s*0\s*\r?\n\s*SECTION\b/m.test(text) && /\b(?:ENTITIES|HEADER|TABLES|BLOCKS)\b/.test(text);
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseDxf(ctx.text);
    ctx.setParsedModel(doc);

    const rootName = doc.header.acadVer ? `DXF (${doc.header.acadVer})` : "DXFDrawing";
    const rootId = ctx.addSymbol(
      rootName,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        acadVer: doc.header.acadVer,
        insUnits: doc.header.insUnits,
        entityCount: doc.entities.length,
        blockCount: doc.blocks.size,
        layerCount: doc.layers.size,
      },
      {
        ruleName: "document",
        namePath: "name",
      },
    );

    // Index LAYER records
    for (const [layerName, layer] of doc.layers) {
      ctx.addSymbol(
        `LAYER:${layerName}`,
        "Variable",
        rootId,
        layer.startOffset,
        layer.endOffset,
        {
          layerName,
          color: layer.color,
          lineType: layer.lineType,
        },
        {
          ruleName: "layer",
          namePath: "name",
          aliases: [layerName],
        },
      );
    }

    // Index BLOCK definitions
    for (const [blockName, blk] of doc.blocks) {
      ctx.addSymbol(
        blockName,
        "Class",
        rootId,
        blk.startOffset,
        blk.endOffset,
        {
          blockName,
          entityCount: blk.entities.length,
          basePoint: blk.basePoint,
        },
        {
          ruleName: "block",
          namePath: "name",
          aliases: [blockName],
        },
      );
    }

    // Index ENTITIES
    doc.entities.forEach((ent, idx) => {
      const label = ent.type === "INSERT" ? `INSERT:${ent.blockName}` : `${ent.type}#${idx + 1}`;
      ctx.addSymbol(
        label,
        "Component",
        rootId,
        ent.startOffset,
        ent.endOffset,
        {
          entityType: ent.type,
          layer: ent.layer,
          handle: ent.handle,
        },
        {
          ruleName: "entity",
          namePath: "name",
        },
      );
    });
  },
};
