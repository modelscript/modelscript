// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Typed in-memory store for an optional simulation initial snapshot (`.snp` / `.json`).
 *
 * Replaces ad-hoc `window.__ansatzInitialSnapshot` global IPC between the simulation
 * toolbar/results file picker and the `useAnsatzEngine` simulation runner.
 */

export type InitialSnapshotValue = string | Record<string, unknown>;

export type InitialSnapshotListener = (snapshot: InitialSnapshotValue | undefined) => void;

let currentInitialSnapshot: InitialSnapshotValue | undefined;
const listeners = new Set<InitialSnapshotListener>();

function notifyListeners(): void {
  for (const listener of listeners) {
    listener(currentInitialSnapshot);
  }
}

export function isInitialSnapshotValue(value: unknown): value is InitialSnapshotValue {
  if (typeof value === "string") {
    return true;
  }
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

export function setInitialSnapshot(snapshot: InitialSnapshotValue | undefined): void {
  if (currentInitialSnapshot === snapshot) {
    return;
  }
  currentInitialSnapshot = snapshot;
  notifyListeners();
}

export function getInitialSnapshot(): InitialSnapshotValue | undefined {
  return currentInitialSnapshot;
}

export function clearInitialSnapshot(): void {
  setInitialSnapshot(undefined);
}

export function subscribeInitialSnapshot(listener: InitialSnapshotListener): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/**
 * Parses a JSON-encoded `.snp` / `.json` snapshot file and stores it if valid.
 * Clears any previously stored snapshot when parsing fails or the payload is not
 * a string or plain object.
 */
export function loadInitialSnapshotFromJson(rawJson: string): InitialSnapshotValue | undefined {
  try {
    const parsed: unknown = JSON.parse(rawJson);
    if (isInitialSnapshotValue(parsed)) {
      setInitialSnapshot(parsed);
      return parsed;
    }
    clearInitialSnapshot();
    return undefined;
  } catch {
    clearInitialSnapshot();
    return undefined;
  }
}
