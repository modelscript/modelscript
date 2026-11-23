// SPDX-License-Identifier: AGPL-3.0-or-later

import type {
  CanvasCommentThread,
  CanvasDocument,
  CanvasFrame,
  CanvasTile,
  CanvasWire,
  WorldBounds,
  WorldPoint,
} from "../schema/canvas-document.js";

export type CanvasCommand =
  | { type: "upsertTile"; tile: CanvasTile }
  | { type: "removeTiles"; tileIds: string[] }
  | { type: "moveTiles"; moves: Record<string, WorldPoint> }
  | { type: "resizeTile"; tileId: string; bounds: WorldBounds }
  | { type: "upsertWire"; wire: CanvasWire }
  | { type: "removeWires"; wireIds: string[] }
  | { type: "upsertFrame"; frame: CanvasFrame }
  | { type: "upsertComment"; comment: CanvasCommentThread }
  | { type: "updateTileViewState"; tileId: string; viewState: Record<string, unknown> };

interface HistoryEntry {
  before: CanvasDocument;
  after: CanvasDocument;
  label: string;
}

function cloneDoc(doc: CanvasDocument): CanvasDocument {
  return structuredClone(doc);
}

/**
 * Transactional command bus with deterministic undo/redo stacks for editing
 * a CanvasDocument atomically.
 */
export class CanvasCommandBus {
  private doc: CanvasDocument;
  private undoStack: HistoryEntry[] = [];
  private redoStack: HistoryEntry[] = [];
  private readonly maxHistory: number;
  private listeners = new Set<(doc: CanvasDocument) => void>();

  constructor(initialDoc: CanvasDocument, maxHistory = 100) {
    this.doc = cloneDoc(initialDoc);
    this.maxHistory = Math.max(1, maxHistory);
  }

  public getDocument(): CanvasDocument {
    return this.doc;
  }

  public canUndo(): boolean {
    return this.undoStack.length > 0;
  }

  public canRedo(): boolean {
    return this.redoStack.length > 0;
  }

  public subscribe(listener: (doc: CanvasDocument) => void): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  public execute(command: CanvasCommand, label?: string): CanvasDocument {
    return this.executeBatch([command], label ?? command.type);
  }

  public executeBatch(commands: CanvasCommand[], label = "batch"): CanvasDocument {
    if (commands.length === 0) return this.doc;
    const before = cloneDoc(this.doc);
    const next = cloneDoc(this.doc);

    for (const cmd of commands) {
      this.applyCommand(next, cmd);
    }
    next.metadata.updatedAt = new Date().toISOString();

    this.doc = next;
    this.undoStack.push({ before, after: cloneDoc(next), label });
    if (this.undoStack.length > this.maxHistory) {
      this.undoStack.shift();
    }
    this.redoStack = [];
    this.emit();
    return this.doc;
  }

  public undo(): CanvasDocument | null {
    const entry = this.undoStack.pop();
    if (!entry) return null;
    this.redoStack.push(entry);
    this.doc = cloneDoc(entry.before);
    this.emit();
    return this.doc;
  }

  public redo(): CanvasDocument | null {
    const entry = this.redoStack.pop();
    if (!entry) return null;
    this.undoStack.push(entry);
    this.doc = cloneDoc(entry.after);
    this.emit();
    return this.doc;
  }

  private applyCommand(doc: CanvasDocument, cmd: CanvasCommand): void {
    switch (cmd.type) {
      case "upsertTile": {
        doc.tiles[cmd.tile.id] = structuredClone(cmd.tile);
        break;
      }
      case "removeTiles": {
        const removed = new Set(cmd.tileIds);
        doc.tiles = Object.fromEntries(Object.entries(doc.tiles).filter(([id]) => !removed.has(id)));
        // Cascade-remove dangling wires attached to deleted tiles
        doc.wires = Object.fromEntries(
          Object.entries(doc.wires).filter(
            ([, wire]) => !removed.has(wire.source.tileId) && !removed.has(wire.target.tileId),
          ),
        );
        break;
      }
      case "moveTiles": {
        for (const [tileId, pos] of Object.entries(cmd.moves)) {
          const tile = doc.tiles[tileId];
          if (tile && !tile.locked) {
            tile.bounds = { ...tile.bounds, x: pos.x, y: pos.y };
          }
        }
        break;
      }
      case "resizeTile": {
        const tile = doc.tiles[cmd.tileId];
        if (tile && !tile.locked) {
          tile.bounds = {
            x: cmd.bounds.x,
            y: cmd.bounds.y,
            width: Math.max(120, cmd.bounds.width),
            height: Math.max(90, cmd.bounds.height),
          };
        }
        break;
      }
      case "upsertWire": {
        if (doc.tiles[cmd.wire.source.tileId] && doc.tiles[cmd.wire.target.tileId]) {
          doc.wires[cmd.wire.id] = structuredClone(cmd.wire);
        }
        break;
      }
      case "removeWires": {
        const removed = new Set(cmd.wireIds);
        doc.wires = Object.fromEntries(Object.entries(doc.wires).filter(([id]) => !removed.has(id)));
        break;
      }
      case "upsertFrame": {
        doc.frames[cmd.frame.id] = structuredClone(cmd.frame);
        break;
      }
      case "upsertComment": {
        doc.comments[cmd.comment.id] = structuredClone(cmd.comment);
        break;
      }
      case "updateTileViewState": {
        const tile = doc.tiles[cmd.tileId];
        if (tile) {
          tile.viewState = { ...(tile.viewState ?? {}), ...cmd.viewState };
        }
        break;
      }
    }
  }

  private emit(): void {
    for (const listener of this.listeners) {
      listener(this.doc);
    }
  }
}
