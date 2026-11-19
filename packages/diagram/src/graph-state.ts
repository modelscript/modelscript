// SPDX-License-Identifier: AGPL-3.0-or-later

export interface DiagramGraphState {
  readOnly: boolean;
  defaultConnector?: unknown;
  metadata?: Record<string, unknown> | undefined;
  selectedNodeId: string | null;
  propertyCache: Map<string, unknown>;
  lastRenderedModule: string | null;
  lastRenderWasLoading: boolean;
}

const graphStateMap = new WeakMap<object, DiagramGraphState>();

/**
 * Returns or lazily creates the isolated state record associated with a `Graph` instance.
 */
export function getGraphState<G extends object>(g?: G | null): DiagramGraphState | null {
  if (!g) return null;
  let state = graphStateMap.get(g);
  if (!state) {
    state = {
      readOnly: false,
      selectedNodeId: null,
      propertyCache: new Map<string, unknown>(),
      lastRenderedModule: null,
      lastRenderWasLoading: false,
    };
    graphStateMap.set(g, state);
  }
  return state;
}

/**
 * Looks up an existing `DiagramGraphState` without mutating the map.
 */
export function peekGraphState<G extends object>(g?: G | null): DiagramGraphState | undefined {
  return g ? graphStateMap.get(g) : undefined;
}

/**
 * Updates per-graph render state (`readOnly`, `defaultConnector`, `metadata`, module transition tracking)
 * without leaking across independently mounted `Graph` instances.
 */
export function beginGraphRenderState<G extends object>(
  g: G,
  opts: {
    readOnly: boolean;
    defaultConnector?: unknown;
    metadata?: Record<string, unknown> | undefined;
    currentModule: string | null;
    isLoading: boolean;
  },
): { state: DiagramGraphState; moduleChanged: boolean; loadingCompleted: boolean } {
  const state = getGraphState(g)!;
  state.readOnly = opts.readOnly;
  state.defaultConnector = opts.defaultConnector;
  state.metadata = opts.metadata;

  const loadingCompleted = state.lastRenderWasLoading && !opts.isLoading;
  state.lastRenderWasLoading = opts.isLoading;
  const moduleChanged =
    !opts.isLoading && state.lastRenderedModule !== null && state.lastRenderedModule !== opts.currentModule;
  if (moduleChanged) {
    state.propertyCache.clear();
    state.selectedNodeId = null;
  }
  if (!opts.isLoading) {
    state.lastRenderedModule = opts.currentModule;
  }
  return { state, moduleChanged, loadingCompleted };
}

export function isGraphReadOnly(g: object | null | undefined, fallbackReadOnly: boolean): boolean {
  const state = peekGraphState(g ?? null);
  return state ? state.readOnly : fallbackReadOnly;
}
