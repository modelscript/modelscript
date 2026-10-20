// SPDX-License-Identifier: AGPL-3.0-or-later

import {
  buildProjectModel,
  type ExternalDefinitions,
  type ModelDefinition,
  type PscadProjectModel,
} from "./pscad-model.js";

/**
 * Process-wide registry of PSCAD project sources known to the workspace (libraries, cases).
 *
 * Workspace indexers register every file they see; `parsePscx` then resolves
 * cross-file user definitions (e.g. `DC_EMT_lib:AC_Grid_Eq`) through `externalDefinitions`
 * without every caller having to thread a workspace object through.
 */
const sources = new Map<string, string>();
let byName: Map<string, PscadProjectModel> | undefined;

export function registerPscadSource(uri: string, text: string): void {
  if (sources.get(uri) === text) return;
  sources.set(uri, text);
  byName = undefined;
}

export function unregisterPscadSource(uri: string): void {
  if (sources.delete(uri)) byName = undefined;
}

export function clearPscadSources(): void {
  sources.clear();
  byName = undefined;
}

function projects(): Map<string, PscadProjectModel> {
  if (byName) return byName;
  const map = new Map<string, PscadProjectModel>();
  for (const text of sources.values()) {
    try {
      const m = buildProjectModel(text);
      if (m.name && !map.has(m.name)) map.set(m.name, m);
    } catch {
      // Unparseable sources simply do not contribute definitions.
    }
  }
  byName = map;
  return map;
}

/** Lookup suitable for `buildProjectModel`/`parsePscx`; `undefined` when nothing is registered. */
export function registeredExternalDefinitions(): ExternalDefinitions | undefined {
  if (sources.size === 0) return undefined;
  return (lib: string, name: string): ModelDefinition | undefined => projects().get(lib)?.definitions.get(name);
}

/** Raw texts of every registered source (used to resolve cross-file schematic modules). */
export function registeredPscadSourceTexts(): string[] {
  return [...sources.values()];
}
