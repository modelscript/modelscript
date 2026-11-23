// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/hdf4 — Declarative UnifiedWorkspace Indexing.
 *
 * Indexes NCSA HDF4 DDL files (.hdf, .h4, .hdf4, .eos) into UnifiedWorkspace.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import { parseHdf4Ddl } from "./parser/ddl-parser.js";

export const hdf4Indexing: LanguageIndexingConfig = {
  canIndex(uri: string, text: string): boolean {
    const lower = uri.toLowerCase();
    if (lower.endsWith(".hdf") || lower.endsWith(".h4") || lower.endsWith(".hdf4") || lower.endsWith(".eos")) {
      return true;
    }
    if (!text) return false;
    return /^\s*HDF4\s+/m.test(text) || (/^\s*(?:SDS|VGROUP|VDATA)\s+/m.test(text) && /^\s*END\b/m.test(text));
  },

  indexFile(ctx: DslIndexFileContext): void {
    const doc = parseHdf4Ddl(ctx.text);
    ctx.setParsedModel(doc);

    const rootId = ctx.addSymbol(
      doc.name,
      "Package",
      null,
      0,
      ctx.text.length,
      { version: doc.version },
      { ruleName: "Hdf4File", namePath: "name" },
    );

    for (const sds of doc.sdsList) {
      ctx.addSymbol(
        sds.name,
        "Class",
        rootId,
        sds.location?.startOffset ?? 0,
        sds.location?.endOffset ?? 0,
        {
          kind: "SDS",
          ref: sds.ref,
          dataType: sds.dataType,
          dims: sds.dims.map((d) => d.size),
        },
        { ruleName: "SdsBlock", namePath: "name" },
      );
    }

    for (const vg of doc.vgroups) {
      ctx.addSymbol(
        vg.name,
        "Package",
        rootId,
        vg.location?.startOffset ?? 0,
        vg.location?.endOffset ?? 0,
        {
          kind: "VGROUP",
          ref: vg.ref,
          vgroupClass: vg.vgroupClass,
          memberCount: vg.members.length,
        },
        { ruleName: "VgroupBlock", namePath: "name" },
      );
    }

    for (const vd of doc.vdatas) {
      ctx.addSymbol(
        vd.name,
        "Class",
        rootId,
        vd.location?.startOffset ?? 0,
        vd.location?.endOffset ?? 0,
        {
          kind: "VDATA",
          ref: vd.ref,
          fieldCount: vd.fields.length,
          recordCount: vd.records.length,
        },
        { ruleName: "VdataBlock", namePath: "name" },
      );
    }
  },
};
