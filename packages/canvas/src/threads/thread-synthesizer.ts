// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CanvasDocument, CanvasWire, CanvasWireKind, CanvasWireStatus } from "../schema/canvas-document.js";

/**
 * Lightweight projection of a Digital Thread alignment record from
 * `@modelscript/runtime`'s `ThreadHypergraph` so `@modelscript/canvas`
 * remains decoupled from WASM runtime instantiation in browser/worker contexts.
 */
export interface DigitalThreadAlignmentInput {
  slot: number;
  relation: "aligned" | "satisfies" | "verifies" | "derives-from" | "calibrates" | "allocates-to";
  status: "synced" | "stale" | "conflict";
  liveValue?: string | undefined;
  endpoints: {
    artifactUri: string;
    anchorPath: string;
  }[];
}

function relationToWireKind(relation: DigitalThreadAlignmentInput["relation"]): CanvasWireKind {
  if (relation === "satisfies" || relation === "verifies") {
    return "requirement-trace";
  }
  return "shared-parameter";
}

function mapStatus(status: DigitalThreadAlignmentInput["status"]): CanvasWireStatus {
  return status;
}

/**
 * Synthesizes live `auto-thread` CanvasWires for all Digital Thread alignments
 * whose endpoints match two or more tiles currently placed on the canvas.
 * Preserves all user-authored and SSP-imported wires untouched.
 */
export function synthesizeThreadsForCanvas(
  doc: CanvasDocument,
  alignments: readonly DigitalThreadAlignmentInput[],
): Record<string, CanvasWire> {
  const merged: Record<string, CanvasWire> = {};

  // Preserve explicit user-authored & SSP wires
  for (const [id, wire] of Object.entries(doc.wires)) {
    if (wire.origin !== "auto-thread") {
      merged[id] = wire;
    }
  }

  // Index tiles by normalized artifactUri
  const tilesByUri = new Map<string, string[]>();
  for (const tile of Object.values(doc.tiles)) {
    const key = tile.artifactUri.toLowerCase();
    const list = tilesByUri.get(key) ?? [];
    list.push(tile.id);
    tilesByUri.set(key, list);
  }

  for (const alignment of alignments) {
    const matchedEndpoints: { tileId: string; anchorPath: string }[] = [];
    for (const ep of alignment.endpoints) {
      const tileIds = tilesByUri.get(ep.artifactUri.toLowerCase());
      if (!tileIds) continue;
      for (const tileId of tileIds) {
        matchedEndpoints.push({ tileId, anchorPath: ep.anchorPath });
      }
    }

    if (matchedEndpoints.length < 2) continue;

    // Star-connect from primary endpoint [0] to all other matched tiles on the board
    const primary = matchedEndpoints[0]!;
    for (let i = 1; i < matchedEndpoints.length; i++) {
      const peer = matchedEndpoints[i]!;
      if (primary.tileId === peer.tileId && primary.anchorPath === peer.anchorPath) continue;

      const wireId = `thread_${alignment.slot}_${primary.tileId}_${peer.tileId}_${i}`;
      merged[wireId] = {
        id: wireId,
        kind: relationToWireKind(alignment.relation),
        source: { tileId: primary.tileId, anchorPath: primary.anchorPath },
        target: { tileId: peer.tileId, anchorPath: peer.anchorPath },
        origin: "auto-thread",
        status: mapStatus(alignment.status),
        liveValue: alignment.liveValue,
        threadSlot: alignment.slot,
      };
    }
  }

  return merged;
}
