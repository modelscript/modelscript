// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview 3-Way Bidirectional Conflict Resolution Engine for Component Properties.
 * Reconciles local optimistic edits in the properties inspector with incoming
 * asynchronous updates from document edits (LSP, external text edits).
 */

export interface PropertyConflict {
  fieldKey: string;
  baseValue: string;
  localValue: string;
  remoteValue: string;
  timestamp: number;
}

export interface ConflictManagerOptions {
  onConflict?: (conflict: PropertyConflict) => void;
  onResolved?: (fieldKey: string, finalValue: string) => void;
}

export class ConflictManager {
  private baseValues = new Map<string, string>();
  private localValues = new Map<string, string>();
  private remoteValues = new Map<string, string>();
  private conflicts = new Map<string, PropertyConflict>();
  private pendingTxQueue: { txId: string; fieldKey: string; value: string; timestamp: number }[] = [];
  private txCounter = 0;

  constructor(private options: ConflictManagerOptions = {}) {}

  /**
   * Initializes or resets the baseline state when a new component is inspected.
   */
  public reset(initialValues: Record<string, unknown> = {}): void {
    this.baseValues.clear();
    this.localValues.clear();
    this.remoteValues.clear();
    this.conflicts.clear();
    this.pendingTxQueue = [];

    for (const [key, val] of Object.entries(initialValues)) {
      const strVal = String(val ?? "");
      this.baseValues.set(key, strVal);
      this.localValues.set(key, strVal);
      this.remoteValues.set(key, strVal);
    }
  }

  /**
   * Records a user's local edit in the properties panel.
   * Returns a unique client transaction ID to correlate with the host's document change.
   */
  public setLocalValue(fieldKey: string, value: string): string {
    const txId = `tx_${Date.now()}_${++this.txCounter}`;
    this.localValues.set(fieldKey, value);

    // If an existing conflict was active, check if user resolved it by typing remote value
    const activeConflict = this.conflicts.get(fieldKey);
    if (activeConflict && value === activeConflict.remoteValue) {
      this.conflicts.delete(fieldKey);
      this.baseValues.set(fieldKey, value);
      this.options.onResolved?.(fieldKey, value);
    }

    this.pendingTxQueue.push({
      txId,
      fieldKey,
      value,
      timestamp: Date.now(),
    });

    return txId;
  }

  /**
   * Ingests fresh property values arriving from the document or LSP.
   * Handles self-echo acknowledgment, non-conflicting auto-syncs, and detects true collisions.
   */
  public handleRemoteUpdate(
    newRemoteValues: Record<string, unknown>,
    appliedTxId?: string,
  ): {
    updatedKeys: string[];
    newConflicts: PropertyConflict[];
    resolvedConflicts: string[];
  } {
    const updatedKeys: string[] = [];
    const newConflicts: PropertyConflict[] = [];
    const resolvedConflicts: string[] = [];

    // 1. Process transaction acknowledgment if provided
    if (appliedTxId) {
      const idx = this.pendingTxQueue.findIndex((item) => item.txId === appliedTxId);
      if (idx !== -1) {
        const acknowledged = this.pendingTxQueue.splice(0, idx + 1);
        for (const item of acknowledged) {
          this.baseValues.set(item.fieldKey, item.value);
        }
      }
    }

    // 2. Compare incoming remote values against 3-way state
    for (const [key, rawVal] of Object.entries(newRemoteValues)) {
      const remoteVal = String(rawVal ?? "");
      const prevRemoteVal = this.remoteValues.get(key);
      this.remoteValues.set(key, remoteVal);

      if (remoteVal === prevRemoteVal && this.baseValues.has(key)) {
        continue;
      }

      const baseVal = this.baseValues.get(key) ?? "";
      const localVal = this.localValues.get(key) ?? baseVal;
      const isDirty = localVal !== baseVal;

      if (!isDirty) {
        // Not dirty: auto-sync local and base quietly
        if (localVal !== remoteVal) {
          this.localValues.set(key, remoteVal);
          this.baseValues.set(key, remoteVal);
          updatedKeys.push(key);
        }
        if (this.conflicts.has(key)) {
          this.conflicts.delete(key);
          resolvedConflicts.push(key);
        }
      } else {
        // Dirty: check if remote matches local (user's change caught up)
        if (remoteVal === localVal) {
          this.baseValues.set(key, remoteVal);
          if (this.conflicts.has(key)) {
            this.conflicts.delete(key);
            resolvedConflicts.push(key);
          }
        } else if (remoteVal !== baseVal) {
          // Collision: both local and remote have changed to different values
          const conflict: PropertyConflict = {
            fieldKey: key,
            baseValue: baseVal,
            localValue: localVal,
            remoteValue: remoteVal,
            timestamp: Date.now(),
          };
          this.conflicts.set(key, conflict);
          newConflicts.push(conflict);
          this.options.onConflict?.(conflict);
        }
      }
    }

    return { updatedKeys, newConflicts, resolvedConflicts };
  }

  /**
   * Resolves an active conflict by either keeping local or accepting remote.
   */
  public resolveConflict(fieldKey: string, resolution: "keep_local" | "accept_remote"): string {
    const conflict = this.conflicts.get(fieldKey);
    if (!conflict) {
      return this.localValues.get(fieldKey) ?? "";
    }

    let finalValue: string;
    if (resolution === "keep_local") {
      finalValue = conflict.localValue;
      this.baseValues.set(fieldKey, conflict.remoteValue); // remote is now base; local is dirty edit
    } else {
      finalValue = conflict.remoteValue;
      this.localValues.set(fieldKey, finalValue);
      this.baseValues.set(fieldKey, finalValue);
    }

    this.conflicts.delete(fieldKey);
    this.options.onResolved?.(fieldKey, finalValue);
    return finalValue;
  }

  public getConflict(fieldKey: string): PropertyConflict | null {
    return this.conflicts.get(fieldKey) ?? null;
  }

  public getAllConflicts(): PropertyConflict[] {
    return Array.from(this.conflicts.values());
  }

  public hasConflicts(): boolean {
    return this.conflicts.size > 0;
  }

  public isFieldDirty(fieldKey: string): boolean {
    const base = this.baseValues.get(fieldKey) ?? "";
    const local = this.localValues.get(fieldKey) ?? base;
    return local !== base;
  }

  public getLocalValue(fieldKey: string): string | undefined {
    return this.localValues.get(fieldKey);
  }

  public getAllLocalValues(): Record<string, string> {
    const result: Record<string, string> = {};
    for (const [k, v] of this.localValues.entries()) {
      result[k] = v;
    }
    return result;
  }

  /** Alias for setLocalValue */
  public recordLocalChange(fieldKey: string, value: string): string {
    return this.setLocalValue(fieldKey, value);
  }

  /** Alias for handleRemoteUpdate */
  public syncRemote(
    newRemoteValues: Record<string, unknown>,
    appliedTxId?: string,
  ): {
    updatedKeys: string[];
    newConflicts: PropertyConflict[];
    resolvedConflicts: string[];
  } {
    return this.handleRemoteUpdate(newRemoteValues, appliedTxId);
  }

  /** Alias for getAllLocalValues */
  public getLocalValues(): Record<string, string> {
    return this.getAllLocalValues();
  }
}
