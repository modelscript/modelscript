// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseIgtl } from "./parser/index.js";

export function canIndexIgtl(uri: string, text?: string): boolean {
  const lower = uri.toLowerCase();
  return (
    lower.endsWith(".igtl") ||
    lower.endsWith(".igtl.json") ||
    lower.endsWith(".plus.xml") ||
    Boolean(text && (text.includes("<PlusConfiguration") || text.includes("OpenIGTLink")))
  );
}

export function indexIgtlFile(ctx: DslIndexFileContext): void {
  const doc = parseIgtl(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  // 1. Index Devices & Child DataSources
  for (const dev of doc.devices) {
    const devSymId = ctx.addSymbol(
      dev.id,
      "Component",
      null,
      dev.range.startOffset,
      dev.range.endOffset,
      {
        type: dev.type,
        acquisitionRate: dev.acquisitionRate,
        toolReferenceFrame: dev.toolReferenceFrame,
      },
      {
        ruleName: "igtl_device",
        namePath: dev.id,
        exports: dev.outputChannelIds,
      },
    );

    for (const ds of dev.dataSources) {
      ctx.addSymbol(
        ds.id,
        "Property",
        devSymId,
        ds.range.startOffset,
        ds.range.endOffset,
        {
          type: ds.type,
          portName: ds.portName,
        },
        {
          ruleName: "igtl_data_source",
          namePath: `${dev.id}.${ds.id}`,
        },
      );
    }
  }

  // 2. Index Coordinate Transforms
  for (const tf of doc.transforms) {
    const tfName = `${tf.from}To${tf.to}`;
    ctx.addSymbol(
      tfName,
      "Function",
      null,
      tf.range.startOffset,
      tf.range.endOffset,
      {
        from: tf.from,
        to: tf.to,
        errorMm: tf.errorMm,
      },
      {
        ruleName: "igtl_transform",
        namePath: tfName,
        aliases: [tf.from, tf.to],
      },
    );
  }

  // 3. Index OpenIGTLink Servers
  for (const srv of doc.servers) {
    ctx.addSymbol(
      srv.id,
      "Event",
      null,
      srv.range.startOffset,
      srv.range.endOffset,
      {
        listeningPort: srv.listeningPort,
        outputChannelId: srv.outputChannelId,
      },
      {
        ruleName: "igtl_server",
        namePath: srv.id,
      },
    );
  }
}

export function resolveIgtlInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri?: string,
): SymbolEntry | null {
  const fileIdx = uri ? workspace.getFileIndex(uri) : undefined;
  const idx = fileIdx ?? workspace.getIndex();

  if (scopeId !== null) {
    const children = idx.childrenOf.get(scopeId) ?? workspace.getIndex().childrenOf.get(scopeId);
    if (children) {
      const merged = workspace.getIndex();
      for (const cid of children) {
        const sym = idx.symbols.get(cid) ?? merged.symbols.get(cid);
        if (sym && sym.name.toLowerCase() === name.toLowerCase()) {
          return sym;
        }
      }
    }
  }

  const found = workspace.findSymbolsByName(name);
  return found[0] ?? null;
}
