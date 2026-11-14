// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SymbolEntry } from "../runtime.js";
import {
  isMemberLikeSymbol,
  isPortLikeSymbol,
  isRelationshipOrImportSymbol,
  isTypeLikeSymbol,
  splitQualifiedPath,
  stripConjugationPrefix,
} from "./symbol_roles.js";
import type { WorkspaceTypeRegistry } from "./type_registry.js";

/** Normalized flow category for a single variable/signal on a port or connector. */
export type PortFlowKind = "potential" | "flow" | "stream" | "signal";

/** Normalized causal direction of a port variable/signal. */
export type PortDirection = "in" | "out" | "inout";

/** Normalized signal/variable entry inside a `PortInterfaceSignature`. */
export interface PortVariableSignature {
  name: string;
  rawType: string;
  canonicalType: string;
  language: string;
  flowKind: PortFlowKind;
  direction: PortDirection;
  unit?: string | undefined;
}

/** Language-neutral interface descriptor for connectors, SysML v2 ports, and simulation terminals. */
export interface PortInterfaceSignature {
  typeName: string;
  language: string;
  isConnectorOrPort: boolean;
  isConjugated: boolean;
  variables: PortVariableSignature[];
}

/** Minimal database interface needed for port signature extraction. */
export interface PortLookupDB {
  symbol(id: number): SymbolEntry | undefined;
  childrenOf(id: number | null): SymbolEntry[];
  byName?(name: string): SymbolEntry[];
}

function flipDirection(dir: PortDirection, conjugate: boolean): PortDirection {
  if (!conjugate || dir === "inout") return dir;
  return dir === "in" ? "out" : "in";
}

function extractRawTypeName(db: PortLookupDB, entry: SymbolEntry): { rawType: string; isConjugated: boolean } {
  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const children = db.childrenOf(entry.id);
  const conjChild = children.find((c) => c.ruleName === "ConjugatedPortTyping" && c.name);
  if (conjChild?.name) {
    const parsed = stripConjugationPrefix(conjChild.name);
    return { rawType: parsed.cleanPath, isConjugated: true };
  }
  const typeChild = children.find(
    (c) => c.ruleName === "OwnedFeatureTyping" || c.ruleName === "FeatureTyping" || c.ruleName === "type_specifier",
  );
  if (typeChild?.name) {
    const parsed = stripConjugationPrefix(typeChild.name);
    return { rawType: parsed.cleanPath, isConjugated: parsed.isConjugated };
  }
  const metaType = meta["typeSpecifier"] ?? meta["type_specifier"] ?? meta["type"];
  if (typeof metaType === "string" && metaType.trim()) {
    const parsed = stripConjugationPrefix(metaType);
    return { rawType: parsed.cleanPath, isConjugated: parsed.isConjugated };
  }
  return { rawType: "", isConjugated: false };
}

function resolveTypeEntry(db: PortLookupDB, rawType: string, preferredLang?: string): SymbolEntry | undefined {
  if (!rawType) return undefined;
  const parts = splitQualifiedPath(rawType);
  if (parts.length === 0) return undefined;
  const leaf = parts[parts.length - 1]!;
  const candidates = db.byName ? db.byName(leaf) : [];
  if (candidates.length === 0) return undefined;

  if (parts.length === 1) {
    return (
      candidates.find((c) => isTypeLikeSymbol(c) && (!preferredLang || c.language === preferredLang)) ??
      candidates.find((c) => isTypeLikeSymbol(c))
    );
  }

  const rootCandidates = db.byName ? db.byName(parts[0]!) : [];
  for (const root of rootCandidates) {
    let curr: SymbolEntry | undefined = root;
    for (let i = 1; i < parts.length && curr; i++) {
      const seg = parts[i]!;
      curr = db.childrenOf(curr.id).find((c) => c.name === seg && !isRelationshipOrImportSymbol(c));
    }
    if (curr && isTypeLikeSymbol(curr)) return curr;
  }

  return candidates.find((c) => isTypeLikeSymbol(c));
}

function normalizeDirection(meta: Record<string, unknown>, isConj: boolean): PortDirection {
  const dir = typeof meta["direction"] === "string" ? meta["direction"].toLowerCase() : "";
  const causality = typeof meta["causality"] === "string" ? meta["causality"].toLowerCase() : "";
  let base: PortDirection = "inout";
  if (dir === "in" || causality === "input" || dir === "input") base = "in";
  else if (dir === "out" || causality === "output" || dir === "output") base = "out";
  return flipDirection(base, isConj);
}

function normalizeFlowKind(meta: Record<string, unknown>): PortFlowKind {
  const prefix = typeof meta["prefix"] === "string" ? meta["prefix"].toLowerCase() : "";
  if (meta["isFlow"] === true || prefix.includes("flow")) return "flow";
  if (meta["isStream"] === true || prefix.includes("stream")) return "stream";
  const dir = typeof meta["direction"] === "string" ? meta["direction"].toLowerCase() : "";
  const causality = typeof meta["causality"] === "string" ? meta["causality"].toLowerCase() : "";
  if (dir === "in" || dir === "out" || causality === "input" || causality === "output") return "signal";
  return "potential";
}

function extractVariablesFromMetadataPorts(
  meta: Record<string, unknown>,
  lang: string,
  isConj: boolean,
): PortVariableSignature[] {
  const vars: PortVariableSignature[] = [];
  const rawPorts = Array.isArray(meta["ports"])
    ? meta["ports"]
    : Array.isArray(meta["pins"])
      ? meta["pins"]
      : Array.isArray((meta["flyBy"] as Record<string, unknown> | undefined)?.["ports"])
        ? ((meta["flyBy"] as Record<string, unknown>)["ports"] as unknown[])
        : null;

  if (!rawPorts) return vars;
  for (const item of rawPorts) {
    if (!item || typeof item !== "object") continue;
    const rec = item as Record<string, unknown>;
    const name = typeof rec["name"] === "string" ? rec["name"] : "pin";
    const rawType =
      typeof rec["type"] === "string" ? rec["type"] : typeof rec["dataType"] === "string" ? rec["dataType"] : "Real";
    const dirStr = typeof rec["direction"] === "string" ? rec["direction"].toLowerCase() : "inout";
    const baseDir: PortDirection =
      dirStr === "in" || dirStr === "input" ? "in" : dirStr === "out" || dirStr === "output" ? "out" : "inout";
    vars.push({
      name,
      rawType,
      canonicalType: rawType,
      language: lang,
      flowKind: rec["isFlow"] === true ? "flow" : baseDir === "inout" ? "potential" : "signal",
      direction: flipDirection(baseDir, isConj),
      ...(typeof rec["unit"] === "string" ? { unit: rec["unit"] } : {}),
    });
  }
  return vars;
}

/**
 * Extracts a normalized `PortInterfaceSignature` for a port/connector definition or usage
 * symbol across Modelica, SysML v2, and simulation formats (PSCAD, PSS/E, Simulink, SPICE).
 * Returns `null` if the symbol is clearly not a connector/port interface.
 */
export function extractPortSignature(
  db: PortLookupDB,
  entry: SymbolEntry | undefined,
  options?: {
    isConjugated?: boolean | undefined;
    visited?: Set<number> | undefined;
    registry?: WorkspaceTypeRegistry | undefined;
  },
): PortInterfaceSignature | null {
  if (!entry) return null;
  const visited = options?.visited ?? new Set<number>();
  if (visited.has(entry.id)) return null;
  visited.add(entry.id);

  const meta = (entry.metadata ?? {}) as Record<string, unknown>;
  const lang = (entry.language ?? "modelica").toLowerCase();
  const isConj = Boolean(options?.isConjugated || meta["isConjugated"]);

  // If this is a usage/component instance (e.g., Modelica `Pin p;` or SysML `port p : ~MyPort;`),
  // resolve its referenced port/connector type definition and apply local conjugation.
  if (isMemberLikeSymbol(entry) && !isTypeLikeSymbol(entry)) {
    const { rawType, isConjugated: childConj } = extractRawTypeName(db, entry);
    const totalConj = isConj !== childConj; // XOR for double-tilde cancellation
    if (rawType) {
      const targetType = resolveTypeEntry(db, rawType, entry.language);
      if (targetType && targetType.id !== entry.id) {
        const nested = extractPortSignature(db, targetType, {
          isConjugated: totalConj,
          visited,
          registry: options?.registry,
        });
        if (nested) return nested;
      }
      // Primitive causal signal ports (e.g. Modelica `input Real u;` / `Modelica.Blocks.Interfaces.RealInput`)
      const dir = normalizeDirection(meta, totalConj);
      if (isPortLikeSymbol(entry) || dir !== "inout" || meta["isFlow"] === true) {
        return {
          typeName: rawType,
          language: lang,
          isConnectorOrPort: true,
          isConjugated: totalConj,
          variables: [
            {
              name: entry.name || "signal",
              rawType,
              canonicalType: rawType,
              language: lang,
              flowKind: normalizeFlowKind(meta),
              direction: dir,
              ...(typeof meta["unit"] === "string" ? { unit: meta["unit"] } : {}),
            },
          ],
        };
      }
    }
  }

  const isPortEntry = isPortLikeSymbol(entry);
  const directChildren = db.childrenOf(entry.id).filter((c) => isMemberLikeSymbol(c));
  const metaVars = extractVariablesFromMetadataPorts(meta, lang, isConj);

  if (!isPortEntry && metaVars.length === 0) {
    // Allow causal blocks or primitive connectors only when explicitly marked as port/connector
    return null;
  }

  const variables: PortVariableSignature[] = [];
  for (const child of directChildren) {
    const cMeta = (child.metadata ?? {}) as Record<string, unknown>;
    const { rawType } = extractRawTypeName(db, child);
    const dir = normalizeDirection(cMeta, isConj);
    variables.push({
      name: child.name,
      rawType: rawType || "Real",
      canonicalType: rawType || "Real",
      language: (child.language ?? lang).toLowerCase(),
      flowKind: normalizeFlowKind(cMeta),
      direction: dir,
      ...(typeof cMeta["unit"] === "string" ? { unit: cMeta["unit"] } : {}),
    });
  }

  if (variables.length === 0 && metaVars.length > 0) {
    variables.push(...metaVars);
  }

  // Handle single-item shorthand when SysML2 / foreign port directly annotates item type on itself
  if (variables.length === 0 && isPortEntry) {
    const { rawType } = extractRawTypeName(db, entry);
    if (rawType) {
      variables.push({
        name: entry.name || "value",
        rawType,
        canonicalType: rawType,
        language: lang,
        flowKind: normalizeFlowKind(meta),
        direction: normalizeDirection(meta, isConj),
        ...(typeof meta["unit"] === "string" ? { unit: meta["unit"] } : {}),
      });
    }
  }

  return {
    typeName: entry.name,
    language: lang,
    isConnectorOrPort: true,
    isConjugated: isConj,
    variables,
  };
}

export interface PortCompatibilityResult {
  compatible: boolean;
  reason?: string | undefined;
}

function areDirectionsConnectable(a: PortDirection, b: PortDirection): boolean {
  if (a === "inout" || b === "inout") return true;
  return a !== b;
}

/**
 * Checks plug-compatibility between two `PortInterfaceSignature` endpoints using
 * `WorkspaceTypeRegistry` for primitive/custom type equivalence, direction complementarity,
 * and flow/potential balance.
 */
export function checkPortPlugCompatibility(
  lhs: PortInterfaceSignature,
  rhs: PortInterfaceSignature,
  registry: WorkspaceTypeRegistry,
): PortCompatibilityResult {
  if (!lhs.isConnectorOrPort || !rhs.isConnectorOrPort) {
    return { compatible: false, reason: "One or both connection endpoints are not ports or connectors." };
  }

  // Empty structural/expandable connectors or untyped opaque terminals remain compatible
  if (lhs.variables.length === 0 && rhs.variables.length === 0) {
    return { compatible: true };
  }

  // Single-variable causal signal pairing (e.g. Modelica RealOutput y -> SysML in torqueCmd : ScalarValues::Real)
  if (lhs.variables.length === 1 && rhs.variables.length === 1) {
    const lv = lhs.variables[0]!;
    const rv = rhs.variables[0]!;
    if (!areDirectionsConnectable(lv.direction, rv.direction)) {
      return {
        compatible: false,
        reason: `Port direction mismatch: cannot connect '${lv.direction}' ('${lv.name}') with '${rv.direction}' ('${rv.name}').`,
      };
    }
    const typeCheck = registry.areTypesCompatible(lv.language, lv.rawType, rv.language, rv.rawType, {
      ...(lv.unit ? { sourceUnit: lv.unit } : {}),
      ...(rv.unit ? { targetUnit: rv.unit } : {}),
    });
    if (!typeCheck.compatible) {
      return {
        compatible: false,
        reason: typeCheck.reason ?? `Incompatible port types '${lv.rawType}' and '${rv.rawType}'.`,
      };
    }
    return { compatible: true };
  }

  if (lhs.variables.length !== rhs.variables.length) {
    return {
      compatible: false,
      reason: `Connector '${lhs.typeName}' has ${lhs.variables.length} variables, whereas '${rhs.typeName}' has ${rhs.variables.length}.`,
    };
  }

  // Match structured connector variables by name first, then position if single-role matched
  const rhsByName = new Map(rhs.variables.map((v) => [v.name.toLowerCase(), v]));
  for (let i = 0; i < lhs.variables.length; i++) {
    const lv = lhs.variables[i]!;
    const rv = rhsByName.get(lv.name.toLowerCase()) ?? rhs.variables[i];
    if (!rv) {
      return { compatible: false, reason: `Missing counterpart variable '${lv.name}' on '${rhs.typeName}'.` };
    }
    if (lv.flowKind === "flow" && rv.flowKind !== "flow") {
      return {
        compatible: false,
        reason: `Flow polarity mismatch: '${lv.name}' is a flow variable while '${rv.name}' is ${rv.flowKind}.`,
      };
    }
    if (rv.flowKind === "flow" && lv.flowKind !== "flow") {
      return {
        compatible: false,
        reason: `Flow polarity mismatch: '${rv.name}' is a flow variable while '${lv.name}' is ${lv.flowKind}.`,
      };
    }
    if (!areDirectionsConnectable(lv.direction, rv.direction)) {
      return {
        compatible: false,
        reason: `Direction mismatch for '${lv.name}': '${lv.direction}' cannot connect to '${rv.direction}'.`,
      };
    }
    const typeCheck = registry.areTypesCompatible(lv.language, lv.rawType, rv.language, rv.rawType, {
      ...(lv.unit ? { sourceUnit: lv.unit } : {}),
      ...(rv.unit ? { targetUnit: rv.unit } : {}),
    });
    if (!typeCheck.compatible) {
      return {
        compatible: false,
        reason: typeCheck.reason ?? `Type mismatch on port variable '${lv.name}': '${lv.rawType}' vs '${rv.rawType}'.`,
      };
    }
  }

  return { compatible: true };
}
