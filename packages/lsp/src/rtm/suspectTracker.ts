// SPDX-License-Identifier: AGPL-3.0-or-later

import { computeSemanticDiff, type SemanticEdit } from "@modelscript/dsl";
import type { SymbolEntry } from "@modelscript/runtime";

export interface VerifiedBaseline {
  symbolName: string;
  uri: string;
  snapshotHash: string;
  timestamp: number;
  metadata?: Record<string, any>;
}

/**
 * Tracks semantic modifications across the digital thread and flags invalid / suspect links.
 */
export class SuspectTracker {
  private baselines = new Map<string, VerifiedBaseline>();
  private suspects = new Map<string, { isSuspect: boolean; reason?: string; timestamp: number }>();

  /**
   * Computes a deterministic signature hash for a symbol entry.
   */
  private computeHash(entry: SymbolEntry): string {
    const core = [
      entry.name,
      entry.ruleName,
      entry.kind,
      JSON.stringify(entry.metadata ?? {}),
      entry.endByte - entry.startByte,
    ].join("::");
    let hash = 0;
    for (let i = 0; i < core.length; i++) {
      hash = (hash << 5) - hash + core.charCodeAt(i);
      hash |= 0;
    }
    return hash.toString(16);
  }

  /**
   * Records a verified baseline for a requirement or model element.
   */
  recordBaseline(symbolName: string, entry: SymbolEntry): void {
    const hash = this.computeHash(entry);
    this.baselines.set(symbolName, {
      symbolName,
      uri: entry.resourceId ?? "",
      snapshotHash: hash,
      timestamp: Date.now(),
      metadata: entry.metadata ? { ...entry.metadata } : undefined,
    });

    // Clear any existing suspect flag for this symbol
    for (const [key, val] of this.suspects.entries()) {
      if (key.endsWith(`|${symbolName}`) || key.startsWith(`${symbolName}|`)) {
        this.suspects.delete(key);
      }
    }
  }

  /**
   * Evaluates if a modified symbol invalidates downstream or upstream trace links.
   */
  evaluateSymbolChange(
    symbolName: string,
    oldEntry: SymbolEntry | null,
    newEntry: SymbolEntry | null,
    db: any,
  ): SemanticEdit | null {
    if (!oldEntry || !newEntry) {
      if (!newEntry && oldEntry) {
        // Deleted symbol
        this.flagSuspect(symbolName, `Target '${symbolName}' was deleted from source code`);
      }
      return null;
    }

    const oldRef = { id: oldEntry.id, db };
    const newRef = { id: newEntry.id, db };

    try {
      const diff = computeSemanticDiff(oldRef, newRef);
      if (diff.action === "none") return diff;

      const isSignificant =
        diff.isBreaking ||
        diff.category === "binding" ||
        diff.category === "structural" ||
        diff.category === "type" ||
        diff.category === "topology";

      if (isSignificant) {
        const reason =
          diff.description ?? `Semantic modification detected in '${symbolName}' (${diff.category ?? "structural"})`;
        this.flagSuspect(symbolName, reason);
      }

      return diff;
    } catch {
      // Fallback to hash comparison if computeSemanticDiff encounters CST node mismatches
      const oldHash = this.computeHash(oldEntry);
      const newHash = this.computeHash(newEntry);
      if (oldHash !== newHash) {
        this.flagSuspect(symbolName, `Modified content in '${symbolName}'`);
      }
      return null;
    }
  }

  /**
   * Flags all links connected to a symbol as suspect.
   */
  flagSuspect(symbolName: string, reason: string): void {
    // Flag for exact symbol name
    this.suspects.set(symbolName, {
      isSuspect: true,
      reason,
      timestamp: Date.now(),
    });
  }

  /**
   * Checks whether a trace link (by key `${sourceName}|${targetName}`) is suspect.
   */
  checkLinkSuspect(linkKey: string): { isSuspect: boolean; reason?: string } {
    const direct = this.suspects.get(linkKey);
    if (direct?.isSuspect) return direct;

    const parts = linkKey.split("|");
    if (parts.length === 2) {
      const [src, tgt] = parts;
      const srcSuspect = this.suspects.get(src!);
      if (srcSuspect?.isSuspect) {
        return { isSuspect: true, reason: `Source component modified: ${srcSuspect.reason}` };
      }
      const tgtSuspect = this.suspects.get(tgt!);
      if (tgtSuspect?.isSuspect) {
        return { isSuspect: true, reason: `Target requirement modified: ${tgtSuspect.reason}` };
      }
    }

    return { isSuspect: false };
  }

  /**
   * Acknowledges or clears a suspect flag manually.
   */
  clearSuspect(linkKey: string): void {
    this.suspects.delete(linkKey);
    const parts = linkKey.split("|");
    if (parts.length === 2) {
      this.suspects.delete(parts[0]!);
      this.suspects.delete(parts[1]!);
    }
  }

  /**
   * Returns a map of all currently suspect links.
   */
  getSuspectMap(): Map<string, { isSuspect: boolean; reason?: string }> {
    const res = new Map<string, { isSuspect: boolean; reason?: string }>();
    for (const [k, v] of this.suspects) {
      res.set(k, { isSuspect: v.isSuspect, reason: v.reason });
    }
    return res;
  }
}
