// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/kicad — UnifiedWorkspace File Indexer.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import { parseKiCadDocument } from "./parser/kicad-parser.js";

function deriveNameFromUri(uri: string): string {
  const filename = uri.split("/").pop() ?? "board.kicad_pcb";
  return filename.replace(/\.(kicad_pcb|kicad_sch|kicad_sym|kicad_mod)$/i, "");
}

export function canIndexKiCadFile(uri: string, text = ""): boolean {
  if (/\.(kicad_pcb|kicad_sch|kicad_sym|kicad_mod)$/i.test(uri)) return true;
  return /^\s*\(\s*(?:kicad_pcb|kicad_sch|kicad_symbol_lib|footprint)\b/.test(text);
}

export function indexKiCadFile(ctx: DslIndexFileContext): void {
  const doc = parseKiCadDocument(ctx.text);
  ctx.setParsedModel(doc);
  const title = deriveNameFromUri(ctx.uri);

  if (doc.kind === "kicad_pcb") {
    const rootId = ctx.addSymbol(
      title,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        language: "kicad",
        documentKind: "kicad_pcb",
        footprintCount: doc.footprints.length,
        netCount: doc.nets.length,
        segmentCount: doc.segments.length,
      },
      { ruleName: "kicad_pcb", namePath: title },
    );

    for (const fp of doc.footprints) {
      const name = fp.refDes || fp.libId;
      ctx.addSymbol(
        name,
        "Component",
        rootId,
        fp.span?.startOffset ?? 0,
        fp.span?.endOffset ?? 0,
        { language: "kicad", libId: fp.libId, value: fp.value, layer: fp.layer, padCount: fp.pads.length },
        { ruleName: "kicad_footprint", namePath: `${title}.${name}` },
      );
    }

    for (const net of doc.nets) {
      if (!net.name) continue;
      ctx.addSymbol(
        net.name,
        "Variable",
        rootId,
        net.span?.startOffset ?? 0,
        net.span?.endOffset ?? 0,
        { language: "kicad", netId: net.id },
        { ruleName: "kicad_net", namePath: `${title}.net.${net.name}` },
      );
    }
    return;
  }

  if (doc.kind === "kicad_sch") {
    const rootId = ctx.addSymbol(
      title,
      "Package",
      null,
      0,
      ctx.text.length,
      {
        language: "kicad",
        documentKind: "kicad_sch",
        symbolCount: doc.symbols.length,
        wireCount: doc.wires.length,
      },
      { ruleName: "kicad_sch", namePath: title },
    );

    for (const sym of doc.symbols) {
      const name = sym.refDes || sym.libId;
      ctx.addSymbol(
        name,
        "Component",
        rootId,
        sym.span?.startOffset ?? 0,
        sym.span?.endOffset ?? 0,
        { language: "kicad", libId: sym.libId, value: sym.value, footprint: sym.footprint },
        { ruleName: "kicad_symbol", namePath: `${title}.${name}` },
      );
    }
  }
}
