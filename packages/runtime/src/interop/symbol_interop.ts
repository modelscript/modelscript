// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview Trait-Based `SymbolInteropProtocol` (GraalVM/Truffle `InteropLibrary` pattern).
 *
 * Keeps foreign language symbols in their native linear-memory / `SymbolIndex` representation
 * and exposes orthogonal capability traits keyed directly on 32-bit partitioned `SymbolId`s
 * (`(domainId << 24) | localSeq`), avoiding eager `PolyglotNode` DTO allocations on hot paths.
 */

import type { DAEBuilder } from "../dae/wasm_dae.js";
import {
  getDomainLanguageName,
  getSymbolDomain,
  registerLanguageDomain,
  type SymbolEntry,
  type SymbolId,
  type SymbolIndex,
} from "../runtime.js";
import type { PolyglotNode } from "./polyglot-transformer.js";

/**
 * Orthogonal 32-bit capability bitmask advertised by a `SymbolInteropLibrary`
 * for any given `SymbolId`.
 */
export enum InteropTrait {
  None = 0,
  /** Symbol exposes physical connectors, pins, flow/potential ports, or signal ports. */
  HasPorts = 0x01,
  /** Symbol exposes typed, optionally unit-bearing parameters or attributes. */
  HasParameters = 0x02,
  /** Symbol can be lowered directly into a shared `DAEBuilder` linear-memory arena. */
  LowerableDAE = 0x04,
  /** Symbol exposes 3D geometric bounds (AABB) or spatial kinematics. */
  HasGeometry = 0x08,
  /** Symbol participates in requirement satisfaction, verification, or allocation links. */
  HasRequirements = 0x10,
  /** Symbol carries ontological / taxonomy classification (OWL2 / DL-Lite). */
  HasTaxonomy = 0x20,
  /** Symbol contains discrete modes, states, or state-machine transitions. */
  HasStates = 0x40,
}

export type InteropPortDirection = "in" | "out" | "inout" | "flow" | "potential" | "unknown";

/** Zero-allocation callback sink for streaming port declarations from a foreign symbol. */
export interface PortSink {
  (name: string, portType: string, direction: InteropPortDirection, isFlow: boolean, isInherited: boolean): void;
}

/** Zero-allocation callback sink for streaming parameter/attribute declarations from a foreign symbol. */
export interface ParamSink {
  (
    name: string,
    paramType: string,
    defaultValue: string | undefined,
    unit: string | undefined,
    isInherited: boolean,
  ): void;
}

export type InteropReqRelation = "satisfies" | "verifies" | "allocates" | "derivesFrom" | "refines";

/** Zero-allocation callback sink for streaming requirement links from a foreign symbol. */
export interface ReqLinkSink {
  (targetNameOrId: string, relation: InteropReqRelation): void;
}

/**
 * Descriptor returned when a foreign symbol is lowered into a host `DAEBuilder` arena.
 */
export interface LoweredPortBinding {
  /** Unqualified port name on the foreign component (e.g. `"p"`, `"n"`). */
  portName: string;
  /** Port type / physical domain (e.g. `"Pin"`, `"ElectricalNode"`, `"RealInput"`). */
  portType: string;
  /** Across / potential variable ID in the host `DAEBuilder` (e.g. voltage `v`), if applicable. */
  potentialVarId?: number | undefined;
  /** Through / flow variable ID in the host `DAEBuilder` (e.g. current `i`), if applicable. */
  flowVarId?: number | undefined;
  /** Signal variable ID for causal ports (`in`/`out`), if applicable. */
  signalVarId?: number | undefined;
}

export interface LowerToDaeResult {
  /** Hierarchical prefix applied to emitted DAE variables. */
  prefix: string;
  /** Number of variables added to `dae`. */
  addedVars: number;
  /** Number of equations added to `dae`. */
  addedEqs: number;
  /** Exposed port variable bindings for cross-boundary connection synthesis. */
  ports: LoweredPortBinding[];
}

/**
 * Language-specific interop trait provider (analogous to Truffle `@ExportLibrary(InteropLibrary.class)`).
 */
export interface SymbolInteropLibrary {
  /** 8-bit `LanguageDomainId` served by this library. */
  readonly domainId: number;
  /** Human-readable canonical language identifier (e.g. `"modelica"`, `"spice"`). */
  readonly languageId: string;

  /** Returns the `InteropTrait` bitmask supported by `symbolId` (O(1) capability check). */
  getTraits(symbolId: SymbolId, index?: SymbolIndex): number;

  /** Streams ports into `sink` without allocating intermediate DTO arrays. */
  readPorts?(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void;

  /** Streams parameters/attributes into `sink` without allocating intermediate DTO arrays. */
  readParameters?(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void;

  /** Lowers `symbolId` directly into a shared `DAEBuilder` arena under `prefix`. */
  lowerToDAE?(
    symbolId: SymbolId,
    dae: DAEBuilder,
    prefix: string,
    parameterOverrides?: ReadonlyMap<string, number>,
    index?: SymbolIndex,
  ): LowerToDaeResult;

  /**
   * Writes axis-aligned 3D bounding box `[minX, minY, minZ, maxX, maxY, maxZ]`
   * into `outF64` (length >= 6) without heap allocation. Returns `true` if available.
   */
  readGeometryBounds?(symbolId: SymbolId, outF64: Float64Array, index?: SymbolIndex): boolean;

  /** Streams requirement traceability links into `sink`. */
  readRequirementLinks?(symbolId: SymbolId, sink: ReqLinkSink, index?: SymbolIndex): void;

  /** Returns ontology/taxonomy class IRIs or names associated with `symbolId`. */
  readTaxonomyClasses?(symbolId: SymbolId, index?: SymbolIndex): readonly string[];
}

/**
 * Central dispatch table mapping 8-bit `LanguageDomainId` -> `SymbolInteropLibrary`.
 * Indexed by a fixed 256-slot array for O(1) monomorphic-speed lookup with zero Map hashing.
 */
export class SymbolInteropRegistry {
  private readonly libraries: Array<SymbolInteropLibrary | undefined> = new Array(256);

  /** Registers a `SymbolInteropLibrary` for its `domainId`. */
  register(lib: SymbolInteropLibrary): this {
    const id = lib.domainId & 0xff;
    this.libraries[id] = lib;
    return this;
  }

  /** Unregisters the library for `domainId`. */
  unregister(domainId: number): boolean {
    const id = domainId & 0xff;
    if (this.libraries[id] === undefined) return false;
    this.libraries[id] = undefined;
    return true;
  }

  /** O(1) lookup by 8-bit `domainId`. */
  getByDomain(domainId: number): SymbolInteropLibrary | undefined {
    return this.libraries[domainId & 0xff];
  }

  /** O(1) lookup directly from a partitioned 32-bit `SymbolId`. */
  getForSymbol(symbolId: SymbolId): SymbolInteropLibrary | undefined {
    return this.libraries[getSymbolDomain(symbolId)];
  }

  /** Returns the `InteropTrait` bitmask for `symbolId` (or `InteropTrait.None` if unregistered). */
  getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
    const lib = this.libraries[getSymbolDomain(symbolId)];
    return lib ? lib.getTraits(symbolId, index) : InteropTrait.None;
  }

  /** Checks whether `symbolId` supports all bits in `requiredTraits`. */
  hasTraits(symbolId: SymbolId, requiredTraits: number, index?: SymbolIndex): boolean {
    if (requiredTraits === InteropTrait.None) return true;
    const actual = this.getTraits(symbolId, index);
    return (actual & requiredTraits) === requiredTraits;
  }

  /** Lists all registered `SymbolInteropLibrary` instances. */
  listLibraries(): SymbolInteropLibrary[] {
    const out: SymbolInteropLibrary[] = [];
    for (let i = 0; i < 256; i++) {
      const lib = this.libraries[i];
      if (lib !== undefined) out.push(lib);
    }
    return out;
  }

  /**
   * Compatibility bridge: materializes a `PolyglotNode` lazily from a `SymbolInteropLibrary`
   * when legacy callers (e.g. `PolyglotTransformer`) request a DTO view.
   */
  materializePolyglotNode(symbolId: SymbolId, index: SymbolIndex): PolyglotNode | undefined {
    const entry = index.symbols.get(symbolId);
    if (!entry) return undefined;

    const lib = this.getForSymbol(symbolId);
    const ports: NonNullable<PolyglotNode["ports"]> = [];
    const attributes: NonNullable<PolyglotNode["attributes"]> = [];

    if (lib) {
      const traits = lib.getTraits(symbolId, index);
      if ((traits & InteropTrait.HasPorts) !== 0 && lib.readPorts) {
        lib.readPorts(
          symbolId,
          (name, portType, _dir, _isFlow, isInherited) => {
            ports.push({ name, type: portType, isInherited });
          },
          index,
        );
      }
      if ((traits & InteropTrait.HasParameters) !== 0 && lib.readParameters) {
        lib.readParameters(
          symbolId,
          (name, paramType, defaultValue, _unit, isInherited) => {
            attributes.push({ name, type: paramType, value: defaultValue, isInherited });
          },
          index,
        );
      }
    }

    return {
      id: symbolId,
      name: entry.name,
      kind: entry.kind,
      ports: ports.length > 0 ? ports : undefined,
      attributes: attributes.length > 0 ? attributes : undefined,
    };
  }
}

/**
 * Default generic `SymbolInteropLibrary` implementation backed directly by `SymbolIndex`
 * child entries and `SymbolEntry.metadata` (usable as a zero-boilerplate baseline for any
 * of ModelScript's 106 languages).
 */
export function createIndexBackedInteropLibrary(domainId: number, languageId?: string): SymbolInteropLibrary {
  const resolvedLang = languageId ?? getDomainLanguageName(domainId);
  return {
    domainId: domainId & 0xff,
    languageId: resolvedLang,

    getTraits(symbolId: SymbolId, index?: SymbolIndex): number {
      if (!index) return InteropTrait.None;
      const entry = index.symbols.get(symbolId);
      if (!entry) return InteropTrait.None;

      let traits = InteropTrait.None;
      const children = index.childrenOf.get(symbolId);
      if (children && children.length > 0) {
        for (const cid of children) {
          const child = index.symbols.get(cid);
          if (!child) continue;
          const k = child.kind.toLowerCase();
          if (k.includes("port") || k.includes("pin") || k.includes("connector") || k.includes("terminal")) {
            traits |= InteropTrait.HasPorts;
          } else if (
            k.includes("param") ||
            k.includes("attr") ||
            k.includes("var") ||
            k.includes("field") ||
            k.includes("property")
          ) {
            traits |= InteropTrait.HasParameters;
          } else if (k.includes("state") || k.includes("transition")) {
            traits |= InteropTrait.HasStates;
          }
        }
      }

      const meta = entry.metadata;
      if (meta) {
        if (Array.isArray(meta["ports"]) && meta["ports"].length > 0) traits |= InteropTrait.HasPorts;
        if (Array.isArray(meta["parameters"]) && meta["parameters"].length > 0) traits |= InteropTrait.HasParameters;
        if (Array.isArray(meta["bounds"]) && meta["bounds"].length >= 6) traits |= InteropTrait.HasGeometry;
        if (Array.isArray(meta["requirements"]) && meta["requirements"].length > 0)
          traits |= InteropTrait.HasRequirements;
        if (Array.isArray(meta["taxonomy"]) && meta["taxonomy"].length > 0) traits |= InteropTrait.HasTaxonomy;
      }

      return traits;
    },

    readPorts(symbolId: SymbolId, sink: PortSink, index?: SymbolIndex): void {
      if (!index) return;
      const children = index.childrenOf.get(symbolId);
      if (children) {
        for (const cid of children) {
          const child = index.symbols.get(cid);
          if (!child) continue;
          const k = child.kind.toLowerCase();
          if (k.includes("port") || k.includes("pin") || k.includes("connector") || k.includes("terminal")) {
            const meta = child.metadata ?? {};
            const portType = typeof meta["type"] === "string" ? meta["type"] : child.kind;
            const rawDir = typeof meta["direction"] === "string" ? meta["direction"].toLowerCase() : "unknown";
            const dir: InteropPortDirection =
              rawDir === "in" || rawDir === "out" || rawDir === "inout" || rawDir === "flow" || rawDir === "potential"
                ? rawDir
                : "unknown";
            sink(child.name, portType, dir, Boolean(meta["isFlow"]), Boolean(meta["isInherited"]));
          }
        }
      }
      const entry: SymbolEntry | undefined = index.symbols.get(symbolId);
      const metaPorts = entry?.metadata?.["ports"];
      if (Array.isArray(metaPorts)) {
        for (const p of metaPorts) {
          if (p && typeof p === "object" && typeof (p as { name?: unknown }).name === "string") {
            const portObj = p as {
              name: string;
              type?: string;
              direction?: InteropPortDirection;
              isFlow?: boolean;
              isInherited?: boolean;
            };
            sink(
              portObj.name,
              portObj.type ?? "Port",
              portObj.direction ?? "unknown",
              Boolean(portObj.isFlow),
              Boolean(portObj.isInherited),
            );
          }
        }
      }
    },

    readParameters(symbolId: SymbolId, sink: ParamSink, index?: SymbolIndex): void {
      if (!index) return;
      const children = index.childrenOf.get(symbolId);
      if (children) {
        for (const cid of children) {
          const child = index.symbols.get(cid);
          if (!child) continue;
          const k = child.kind.toLowerCase();
          if (
            k.includes("param") ||
            k.includes("attr") ||
            k.includes("var") ||
            k.includes("field") ||
            k.includes("property")
          ) {
            const meta = child.metadata ?? {};
            const paramType = typeof meta["type"] === "string" ? meta["type"] : "Real";
            const defaultValue =
              meta["value"] !== undefined
                ? String(meta["value"])
                : typeof meta["default"] === "string"
                  ? meta["default"]
                  : undefined;
            const unit = typeof meta["unit"] === "string" ? meta["unit"] : undefined;
            sink(child.name, paramType, defaultValue, unit, Boolean(meta["isInherited"]));
          }
        }
      }
    },

    readGeometryBounds(symbolId: SymbolId, outF64: Float64Array, index?: SymbolIndex): boolean {
      if (!index || outF64.length < 6) return false;
      const bounds = index.symbols.get(symbolId)?.metadata?.["bounds"];
      if (!Array.isArray(bounds) || bounds.length < 6) return false;
      for (let i = 0; i < 6; i++) {
        outF64[i] = Number(bounds[i]);
      }
      return true;
    },

    readRequirementLinks(symbolId: SymbolId, sink: ReqLinkSink, index?: SymbolIndex): void {
      if (!index) return;
      const reqs = index.symbols.get(symbolId)?.metadata?.["requirements"];
      if (!Array.isArray(reqs)) return;
      for (const r of reqs) {
        if (r && typeof r === "object" && typeof (r as { target?: unknown }).target === "string") {
          const obj = r as { target: string; relation?: InteropReqRelation };
          sink(obj.target, obj.relation ?? "satisfies");
        }
      }
    },

    readTaxonomyClasses(symbolId: SymbolId, index?: SymbolIndex): readonly string[] {
      const tax = index?.symbols.get(symbolId)?.metadata?.["taxonomy"];
      return Array.isArray(tax) ? tax.filter((x): x is string => typeof x === "string") : [];
    },
  };
}

/** Global default `SymbolInteropRegistry` shared across the runtime unless overridden by a `PolyglotEngine`. */
export const defaultSymbolInteropRegistry = new SymbolInteropRegistry();

const FLAGSHIP_INTEROP_DOMAINS: readonly string[] = [
  "modelica",
  "sysml2",
  "spice",
  "reqif",
  "step",
  "scad",
  "pscad",
  "psse",
  "owl2",
  "qif",
  "ssp",
  "fea",
  "cfd",
];

/**
 * Registers index-backed baseline `SymbolInteropLibrary` adapters for flagship
 * engineering domains on `registry` (without overwriting any custom libraries already registered).
 */
export function registerDefaultInteropLibraries(
  registry: SymbolInteropRegistry = defaultSymbolInteropRegistry,
  registerDomainFn?: (lang: string) => number,
): SymbolInteropRegistry {
  for (const lang of FLAGSHIP_INTEROP_DOMAINS) {
    const domId = registerDomainFn ? registerDomainFn(lang) : registerLanguageDomain(lang);
    if (!registry.getByDomain(domId)) {
      registry.register(createIndexBackedInteropLibrary(domId, lang));
    }
  }
  return registry;
}
