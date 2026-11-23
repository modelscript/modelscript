// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/grib — Declarative Multi-File Workspace Indexing.
 *
 * Indexes GRIB Edition 1 descriptors and datasets (`.grb`, `.grib`, `.grib1`) into `UnifiedWorkspace`.
 */

import type { DslIndexFileContext, LanguageIndexingConfig } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseGribDescriptor } from "./parser/text-parser.js";
import type { GribDocument } from "./types.js";

/**
 * Predicate to identify GRIB1 documents by file extension or leading `GRIB` indicator header.
 */
export function canIndexGrib(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".grb") || lower.endsWith(".grib") || lower.endsWith(".grib1")) {
    return true;
  }
  if (!text) return false;
  return /^\s*GRIB\b/m.test(text);
}

/**
 * Indexes GRIB1 messages, PDS parameters, GDS grids, and BDS sections into `UnifiedWorkspace`.
 */
export function indexGribDocument(ctx: DslIndexFileContext): void {
  const doc = parseGribDescriptor(ctx.text, ctx.uri);
  ctx.setParsedModel<GribDocument>(doc);

  const addSym = (
    name: string,
    kind: string,
    parentId: SymbolId | null = null,
    extra?: Record<string, unknown>,
  ): SymbolId =>
    ctx.addSymbol(name, kind, parentId, 0, ctx.text.length, extra ?? {}, {
      ruleName: `grib_${kind}`,
    });

  const rootId = addSym("GRIB_Document", "grib_file", null, {
    messageCount: doc.messages.length,
    isBinary: doc.isBinary,
  });

  for (const msg of doc.messages) {
    const paramName = msg.pds?.parameterName ?? `P${msg.pds?.parameterCode ?? msg.index}`;
    const msgId = addSym(`GRIB_${msg.index}_${paramName}`, "grib_message", rootId, {
      edition: msg.indicator.edition,
      parameterCode: msg.pds?.parameterCode ?? null,
      levelType: msg.pds?.levelType ?? null,
      levelValue: msg.pds?.levelValue ?? null,
    });

    if (msg.pds) {
      addSym(paramName, "grib_parameter", msgId, {
        code: msg.pds.parameterCode,
        levelType: msg.pds.levelType,
        levelValue: msg.pds.levelValue,
        decimalScaleFactor: msg.pds.decimalScaleFactor,
      });
    }

    if (msg.gds) {
      addSym(`GDS_${msg.gds.ni}x${msg.gds.nj}`, "grib_grid", msgId, {
        ni: msg.gds.ni,
        nj: msg.gds.nj,
        la1: msg.gds.la1,
        lo1: msg.gds.lo1,
        la2: msg.gds.la2,
        lo2: msg.gds.lo2,
      });
    }
  }
}

export const gribIndexing: LanguageIndexingConfig = {
  canIndex: canIndexGrib,
  indexFile: indexGribDocument,
};

/**
 * Retrieves the parsed `GribDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getGribDocument(workspace: UnifiedWorkspace, uri: string): GribDocument | undefined {
  return workspace.getParsedModel<GribDocument>(uri);
}

/**
 * Finds all indexed GRIB symbols matching `kind` across `workspace`.
 */
export function findGribSymbolsByType(workspace: UnifiedWorkspace, kind: string): SymbolEntry[] {
  return workspace.getSymbolsForUri().filter((sym) => sym.kind === kind || sym.ruleName === `grib_${kind}`);
}
