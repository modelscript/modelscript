// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/opendrive — Declarative Multi-File Indexing.
 *
 * Indexes ASAM OpenDRIVE files (.xodr, .xml) including roads, planView geometries,
 * junctions, lane sections, and signals into UnifiedWorkspace.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseOpenDrive } from "./parser/index.js";
import type { OpenDriveDocument } from "./types.js";

export function indexOpenDriveFile(ctx: DslIndexFileContext): void {
  const doc = parseOpenDrive(ctx.text, ctx.uri);
  ctx.setParsedModel(doc);

  for (const road of doc.roads) {
    const roadName = road.name ? `${road.name} (${road.id})` : `Road_${road.id}`;
    const roadId = ctx.addSymbol(
      roadName,
      "Class",
      null,
      road.range.startOffset,
      road.range.endOffset,
      {
        roadId: road.id,
        length: road.length,
        junction: road.junction,
        geometriesCount: road.planView.length,
        laneSectionsCount: road.lanes.laneSections.length,
        signalsCount: road.signals.length,
      },
      {
        ruleName: "opendrive_road",
        namePath: roadName,
        aliases: road.name ? [road.id, road.name] : [road.id],
      },
    );

    for (let gi = 0; gi < road.planView.length; gi++) {
      const g = road.planView[gi];
      if (!g) continue;
      const gName = `Geometry_${gi}_${g.type}`;
      ctx.addSymbol(
        gName,
        "Component",
        roadId,
        g.range.startOffset,
        g.range.endOffset,
        {
          s: g.s,
          type: g.type,
          length: g.length,
        },
        {
          ruleName: `opendrive_geom_${g.type}`,
          namePath: `${roadName}.${gName}`,
        },
      );
    }

    for (const sig of road.signals) {
      const sigName = sig.name ? `${sig.name} (${sig.id})` : `Signal_${sig.id}`;
      ctx.addSymbol(
        sigName,
        "Event",
        roadId,
        sig.range.startOffset,
        sig.range.endOffset,
        {
          s: sig.s,
          t: sig.t,
          dynamic: sig.dynamic,
        },
        {
          ruleName: "opendrive_signal",
          namePath: `${roadName}.${sigName}`,
          aliases: sig.name ? [sig.id, sig.name] : [sig.id],
        },
      );
    }
  }

  for (const junc of doc.junctions) {
    const jName = junc.name ? `${junc.name} (${junc.id})` : `Junction_${junc.id}`;
    ctx.addSymbol(
      jName,
      "Package",
      null,
      junc.range.startOffset,
      junc.range.endOffset,
      {
        junctionId: junc.id,
        connectionsCount: junc.connections.length,
      },
      {
        ruleName: "opendrive_junction",
        namePath: jName,
        aliases: junc.name ? [junc.id, junc.name] : [junc.id],
      },
    );
  }
}

export function getOpenDriveDocument(workspace: UnifiedWorkspace, uri: string): OpenDriveDocument | undefined {
  return workspace.getParsedModel<OpenDriveDocument>(uri);
}

export function resolveOpenDriveInScope(
  workspace: UnifiedWorkspace,
  name: string,
  scopeId: SymbolId | null,
  uri: string,
): SymbolEntry | null {
  const idx = workspace.getFileIndex(uri);
  if (idx && scopeId !== null) {
    const children = idx.childrenOf.get(scopeId);
    if (children) {
      for (const cid of children) {
        const sym = idx.symbols.get(cid);
        if (sym && sym.name.toLowerCase().includes(name.toLowerCase())) {
          return sym;
        }
      }
    }
  }

  const found = workspace.findSymbolsByName(name);
  return found[0] ?? null;
}
