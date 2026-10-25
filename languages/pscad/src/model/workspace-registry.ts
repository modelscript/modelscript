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

/**
 * Tries to discover and register a local master.pslx if present in standard locations.
 */
function tryAutoDiscoverMaster(): void {
  if (typeof process === "undefined" || !process.env) return;
  try {
    const nodeFs = typeof process.versions?.node === "string" ? eval("require('node:fs')") : undefined;
    if (!nodeFs) return;
    const candidates = [
      process.env["PSCAD_MASTER_LIB_PATH"],
      "master.pslx",
      ".pscad/master.pslx",
      ".cache/pscad-corpus/master.pslx",
      ".cache/pscad-corpus/DC-EMT_v0/master.pslx",
    ].filter((p): p is string => typeof p === "string" && p.length > 0);

    for (const cand of candidates) {
      if (nodeFs.existsSync(cand)) {
        const text = nodeFs.readFileSync(cand, "utf-8");
        registerPscadSource("file:///master.pslx", text);
        break;
      }
    }
  } catch {
    // Environment does not support synchronous fs lookup; ignore
  }
}

/** Registers a master library text (e.g. from user-provided master.pslx). */
export function registerMasterLibrary(text: string): void {
  registerPscadSource("file:///master.pslx", text);
}

/** Returns the registered master library project model if one is registered or discovered. */
export function getRegisteredMasterProject(): PscadProjectModel | undefined {
  return projects().get("master") ?? projects().get("Master");
}

function projects(): Map<string, PscadProjectModel> {
  if (byName) return byName;
  if (!sources.has("file:///master.pslx")) {
    tryAutoDiscoverMaster();
  }
  const map = new Map<string, PscadProjectModel>();
  for (const [uri, text] of sources.entries()) {
    try {
      const m = buildProjectModel(text);
      if (m.name) {
        if (!map.has(m.name)) map.set(m.name, m);
        const lower = m.name.toLowerCase();
        if (!map.has(lower)) map.set(lower, m);
      }
      if (uri.toLowerCase().endsWith("master.pslx")) {
        if (!map.has("master")) map.set("master", m);
      }
    } catch {
      // Unparseable sources simply do not contribute definitions.
    }
  }
  byName = map;
  return map;
}

/** Lookup suitable for `buildProjectModel`/`parsePscx`; `undefined` when nothing is registered. */
export function registeredExternalDefinitions(): ExternalDefinitions | undefined {
  if (sources.size === 0) {
    tryAutoDiscoverMaster();
  }
  if (sources.size === 0) return undefined;
  return (lib: string, name: string): ModelDefinition | undefined => {
    const p = projects();
    return p.get(lib)?.definitions.get(name) ?? p.get(lib.toLowerCase())?.definitions.get(name);
  };
}

/** Raw texts of every registered source (used to resolve cross-file schematic modules). */
export function registeredPscadSourceTexts(): string[] {
  return [...sources.values()];
}
