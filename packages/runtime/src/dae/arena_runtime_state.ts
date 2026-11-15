// SPDX-License-Identifier: AGPL-3.0-or-later

export interface ArenaRuntimeState {
  isInitialPhase?: boolean | undefined;
  isTerminalPhase?: boolean | undefined;
  preValuesByStringId?: Float64Array | undefined;
  lastFunctionOutputs?: unknown[] | undefined;
  lastOutputs?: unknown[] | undefined;
  delayHistory?: Map<number, { t: number[]; v: number[] }> | undefined;
  stmtWhenActive?: Map<number, boolean> | undefined;
  pendingReinits?: Map<string, number> | undefined;
  terminateRequested?: boolean | undefined;
}

const arenaRuntimeStateStore = new WeakMap<object, ArenaRuntimeState>();

/**
 * Returns the WeakMap-backed transient runtime execution state associated with a DAE arena.
 */
export function getArenaRuntimeState(arena: object): ArenaRuntimeState {
  let state = arenaRuntimeStateStore.get(arena);
  if (!state) {
    state = {};
    arenaRuntimeStateStore.set(arena, state);
  }
  return state;
}
