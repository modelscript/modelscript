// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @fileoverview TGG-Driven Cross-Language Symbol Projection Table & Incremental Correspondence Indexer.
 *
 * Bridges declarative Triple Graph Grammar (`tggRule` / `tggThreadRule`) specifications with
 * `UnifiedWorkspace`, `WasmQueryEngine`, and `DigitalThreadHypergraph`:
 *   1. `TggSymbolProjectionTable`: Answers whether a foreign `SymbolEntry` in `UnifiedWorkspace`
 *      can satisfy an intra/inter-file reference (`import`, typing, `satisfy`, `verify`, `allocate`)
 *      under registered TGG rules, and projects foreign ports/parameters across primitive `typeMaps`.
 *   2. `TggCorrespondenceIndexer`: Incrementally aligns cross-language symbol declarations in O(ΔN)
 *      via native references, TGG `foreignKey` attributes (e.g. QIF `stepEntityId` -> STEP `#N`),
 *      unambiguous root container rules, and scoped contextual child rules — without global name collisions.
 */

import type {
  PolyglotConfig,
  TGGConstraint,
  TGGForeignKeySpec,
  TGGIdentityKey,
  TGGRelationRole,
  TGGRuleOptions,
  TGGThreadRuleOptions,
} from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, SymbolIndex } from "../runtime.js";
import {
  isMemberLikeSymbol,
  isPortLikeSymbol,
  isRelationshipOrImportSymbol,
  isTypeLikeSymbol,
} from "../util/symbol_roles.js";
import { evaluateRuleDescriptor } from "./tgg-pattern-interpreter.js";
import { DigitalThreadHypergraph, ThreadDomain, ThreadRelation } from "./thread_hypergraph.js";

const VAR_PREFIX = "__var_";

function stripVar(v: unknown): string {
  return typeof v === "string" && v.startsWith(VAR_PREFIX) ? v.slice(VAR_PREFIX.length) : String(v ?? "");
}

/** Canonical language ID normalization (e.g. `"sysml"` -> `"sysml2"`). */
export function normalizeTggLanguageId(lang: string | undefined): string {
  if (!lang) return "";
  const lower = lang.trim().toLowerCase();
  if (lower === "sysml") return "sysml2";
  return lower;
}

/**
 * Equivalent grammar/metaclass aliases connecting TGG pattern `nodeType` names
 * (e.g. `ClassDefinition`, `ComponentClause`, `SpecObject`, `StepEntity`) with
 * `SymbolEntry.ruleName` and `SymbolEntry.kind` values emitted by language indexers.
 */
const EQUIVALENT_NODE_TYPES: ReadonlyArray<ReadonlySet<string>> = [
  new Set([
    "classdefinition",
    "class_definition",
    "short_class_definition",
    "class",
    "model",
    "block",
    "connector",
    "record",
    "package",
    "verificationblock",
  ]),
  new Set(["blockdefinition", "partdefinition", "part_definition", "itemdefinition", "portdefinition"]),
  new Set([
    "partusage",
    "part_usage",
    "itemusage",
    "component",
    "componentclause",
    "component_declaration",
    "component_clause",
  ]),
  new Set([
    "attributeusage",
    "attribute_usage",
    "property",
    "variable",
    "parameter",
    "assignstatement",
    "assign_statement",
    "variable_declaration",
  ]),
  new Set(["portusage", "port_usage", "pscad_port", "psse_port", "taggedport", "tagportop", "tag_port"]),
  new Set(["moduledeclaration", "module_declaration", "module"]),
  new Set(["functiondeclaration", "function_declaration", "calcdefinition", "calculationdefinition", "function"]),
  new Set([
    "requirementdefinition",
    "requirement_definition",
    "requirementusage",
    "requirement_usage",
    "specobject",
    "reqif_requirement",
    "dimensionalcharacteristic",
    "qif_characteristic",
  ]),
  new Set(["satisfyrequirementusage", "specrelation", "reqif_relation"]),
  new Set(["verifyrequirementusage", "verificationcasedefinition", "verificationcaseusage"]),
  new Set(["stepentity", "step_product", "step_shape", "step_entity", "entity", "product"]),
  new Set(["measurementfeature", "qif_feature"]),
  new Set(["qif_datum", "datum", "step_datum"]),
  new Set(["pscad_component", "usercmpdefn", "pscad_project", "pscad_library"]),
  new Set(["pscad_parameter", "psse_parameter"]),
  new Set(["psse_model", "psse_case", "psse_dyr_case", "psse_dyr_record", "psse_component"]),
];

function nodeTypesCompatible(patternNodeType: string, actualRuleOrKind: string | undefined): boolean {
  if (!patternNodeType || !actualRuleOrKind) return false;
  const a = patternNodeType.toLowerCase().replace(/[_-]/g, "");
  const b = actualRuleOrKind.toLowerCase().replace(/[_-]/g, "");
  if (a === b) return true;
  const aRaw = patternNodeType.toLowerCase();
  const bRaw = actualRuleOrKind.toLowerCase();
  for (const group of EQUIVALENT_NODE_TYPES) {
    if ((group.has(aRaw) || group.has(a)) && (group.has(bRaw) || group.has(b))) {
      return true;
    }
  }
  return false;
}

function matchesEntryNodeType(
  entry: SymbolEntry,
  patternNodeType: string,
  literalBindings?: Record<string, unknown>,
): boolean {
  if (patternNodeType === "FunctionCall" && literalBindings?.["name"] === "tag_port") {
    return (
      entry.kind === "TaggedPort" ||
      entry.ruleName === "TagPortOp" ||
      entry.ruleName === "tag_port" ||
      entry.metadata?.["isTaggedPort"] === true
    );
  }
  const typeMatched =
    nodeTypesCompatible(patternNodeType, entry.ruleName) || nodeTypesCompatible(patternNodeType, entry.kind);
  if (!typeMatched) return false;

  if (literalBindings) {
    const reqEntityType = literalBindings["entityType"];
    if (typeof reqEntityType === "string") {
      const entUpper = reqEntityType.toUpperCase();
      const metaStep = String(entry.metadata?.["stepType"] ?? entry.metadata?.["entityType"] ?? "").toUpperCase();
      if (entUpper === "PRODUCT") {
        if (
          entry.ruleName !== "step_product" &&
          entry.ruleName !== "step_shape" &&
          metaStep !== "PRODUCT" &&
          metaStep !== "NAMEDSHAPE" &&
          !metaStep.startsWith("PRODUCT(")
        ) {
          return false;
        }
      } else if (metaStep && !metaStep.includes(entUpper) && entry.ruleName !== `step_${entUpper.toLowerCase()}`) {
        return false;
      }
    }
  }
  return true;
}

export interface EvaluatedCorrespondenceRule {
  ruleName: string;
  sourceLang: string;
  targetLang: string;
  sourceNodeType: string;
  targetNodeType: string;
  contextSourceType?: string | undefined;
  contextTargetType?: string | undefined;
  sourceLiteralGuards: Record<string, unknown>;
  targetLiteralGuards: Record<string, unknown>;
  identityKeys: TGGIdentityKey[];
  foreignKey?: TGGForeignKeySpec | undefined;
  fieldAliases: Array<{ sourceField: string; targetField: string; aliases?: Record<string, string> | undefined }>;
  allowCrossLanguageRef: boolean;
  relation: TGGRelationRole;
  priority: number;
}

export interface ProjectedForeignMember {
  symbolId: SymbolId;
  name: string;
  projectedType: string;
  role: "port" | "parameter" | "component" | "attribute";
  direction?: "in" | "out" | "inout" | undefined;
  defaultValue?: unknown;
  unit?: string | undefined;
}

export interface ProjectedForeignSignature {
  symbolId: SymbolId;
  name: string;
  sourceLang: string;
  targetLang: string;
  matchedRule: EvaluatedCorrespondenceRule | null;
  members: ProjectedForeignMember[];
}

function deriveRuleIdentityKeys(
  rule: TGGRuleOptions,
  srcBindings: Record<string, unknown>,
  tgtBindings: Record<string, unknown>,
  constraints: TGGConstraint[],
): TGGIdentityKey[] {
  if (rule.identityKeys && rule.identityKeys.length > 0) {
    return [...rule.identityKeys];
  }
  const keys: TGGIdentityKey[] = [];
  const seen = new Set<string>();
  const addKey = (k: TGGIdentityKey) => {
    const id = `${k.source}->${k.target}:${k.transform ?? "exact"}:${k.prefix ?? ""}`;
    if (!seen.has(id)) {
      seen.add(id);
      keys.push(k);
    }
  };

  for (const [sProp, sVal] of Object.entries(srcBindings)) {
    if (typeof sVal !== "string" || !sVal.startsWith(VAR_PREFIX)) continue;
    for (const [tProp, tVal] of Object.entries(tgtBindings)) {
      if (tVal === sVal) {
        addKey({ source: sProp, target: tProp, transform: "exact" });
      }
    }
  }

  for (const c of constraints) {
    if (c.kind === "eq") {
      const [a, b] = c.args;
      const sProp = Object.keys(srcBindings).find((k) => srcBindings[k] === a || k === stripVar(a));
      const tProp = Object.keys(tgtBindings).find((k) => tgtBindings[k] === b || k === stripVar(b));
      if (sProp && tProp) addKey({ source: sProp, target: tProp, transform: "exact" });
    } else if (c.kind === "formatUri") {
      const [idVar, prefix, targetVar] = c.args;
      const sProp = Object.keys(srcBindings).find((k) => srcBindings[k] === idVar || k === stripVar(idVar));
      const tProp = Object.keys(tgtBindings).find((k) => tgtBindings[k] === targetVar || k === stripVar(targetVar));
      if (sProp && tProp) {
        addKey({
          source: sProp,
          target: tProp,
          transform: "stripPrefix",
          prefix: typeof prefix === "string" ? prefix : undefined,
        });
      }
    }
  }

  if (keys.length === 0) {
    addKey({ source: "name", target: "name", transform: "exact" });
  }
  return keys;
}

/**
 * Aggregates declarative TGG rules across registered languages to determine cross-language
 * reference compatibility and project foreign symbol member signatures.
 */
export class TggSymbolProjectionTable {
  private rules: EvaluatedCorrespondenceRule[] = [];
  private ruleDedup = new Set<string>();
  private typeMaps = new Map<string, Map<string, Record<string, string>>>();

  /** Registers all TGG rules and primitive `typeMaps` from a language's `PolyglotConfig`. */
  registerPolyglotConfig(defaultSourceLang: string, config: PolyglotConfig | undefined): void {
    if (!config) return;
    const normSrc = normalizeTggLanguageId(defaultSourceLang);
    if (config.typeMaps) {
      let langMap = this.typeMaps.get(normSrc);
      if (!langMap) {
        langMap = new Map();
        this.typeMaps.set(normSrc, langMap);
      }
      for (const [tgtLang, dict] of Object.entries(config.typeMaps)) {
        const normTgt = normalizeTggLanguageId(tgtLang);
        langMap.set(normTgt, { ...(langMap.get(normTgt) ?? {}), ...dict });
      }
    }
    for (const rule of config.rules ?? []) {
      this.registerRule(rule, normSrc);
    }
  }

  /** Registers a single declarative `TGGRuleOptions` descriptor. */
  registerRule(rule: TGGRuleOptions, defaultSourceLang?: string): void {
    const desc = evaluateRuleDescriptor(rule);
    const sourceLang = normalizeTggLanguageId(rule.sourceLang ?? defaultSourceLang);
    const targetLang = normalizeTggLanguageId(rule.targetLang);
    if (!sourceLang || !targetLang) return;

    const dedupKey = `${sourceLang}->${targetLang}:${rule.name}`;
    if (this.ruleDedup.has(dedupKey)) return;
    this.ruleDedup.add(dedupKey);

    const srcBindings = desc.sourcePattern.bindings || {};
    const tgtBindings = desc.targetPattern.bindings || {};
    const srcGuards: Record<string, unknown> = {};
    const tgtGuards: Record<string, unknown> = {};

    for (const [k, v] of Object.entries(srcBindings)) {
      if (v !== undefined && (typeof v !== "string" || !v.startsWith(VAR_PREFIX))) {
        srcGuards[k] = v;
      }
    }
    for (const [k, v] of Object.entries(tgtBindings)) {
      if (v !== undefined && (typeof v !== "string" || !v.startsWith(VAR_PREFIX))) {
        tgtGuards[k] = v;
      }
    }

    const fieldAliases: Array<{
      sourceField: string;
      targetField: string;
      aliases?: Record<string, string> | undefined;
    }> = [];
    for (const c of desc.constraints) {
      if (c.kind === "fieldAlias") {
        const [sF, tF, dict] = c.args;
        const sourceField = stripVar(sF);
        const targetField = stripVar(tF);
        if (sourceField && targetField) {
          fieldAliases.push({
            sourceField,
            targetField,
            ...(dict && typeof dict === "object" ? { aliases: dict as Record<string, string> } : {}),
          });
        }
      }
    }

    // Literal name-mapping rules like `AssignStatement(name: "projected_area") <-> ComponentClause(name: "A")`
    if (
      typeof srcGuards["name"] === "string" &&
      typeof tgtGuards["name"] === "string" &&
      srcGuards["name"] !== tgtGuards["name"]
    ) {
      fieldAliases.push({ sourceField: String(srcGuards["name"]), targetField: String(tgtGuards["name"]) });
    }
    if (
      typeof srcGuards["name"] === "string" &&
      typeof tgtGuards["declaredName"] === "string" &&
      srcGuards["name"] !== tgtGuards["declaredName"]
    ) {
      fieldAliases.push({ sourceField: String(srcGuards["name"]), targetField: String(tgtGuards["declaredName"]) });
    }

    this.rules.push({
      ruleName: rule.name,
      sourceLang,
      targetLang,
      sourceNodeType: desc.sourcePattern.nodeType,
      targetNodeType: desc.targetPattern.nodeType,
      contextSourceType: desc.contextSourcePattern?.nodeType,
      contextTargetType: desc.contextTargetPattern?.nodeType,
      sourceLiteralGuards: srcGuards,
      targetLiteralGuards: tgtGuards,
      identityKeys: deriveRuleIdentityKeys(rule, srcBindings, tgtBindings, desc.constraints),
      foreignKey: rule.foreignKey,
      fieldAliases,
      allowCrossLanguageRef: rule.allowCrossLanguageRef ?? true,
      relation: rule.relation ?? rule.foreignKey?.relation ?? "aligned",
      priority: rule.priority ?? 0,
    });
    this.rules.sort((a, b) => b.priority - a.priority);
  }

  /** Registers an N-ary `TGGThreadRuleOptions` by expanding pairwise bidirectional projections. */
  registerThreadRule(threadRule: TGGThreadRuleOptions): void {
    const entries = Object.entries(threadRule.domains);
    for (let i = 0; i < entries.length; i++) {
      for (let j = i + 1; j < entries.length; j++) {
        const [langA, fnA] = entries[i]!;
        const [langB, fnB] = entries[j]!;
        this.registerRule({
          name: `${threadRule.name ?? "ThreadRule"}_${langA}_${langB}`,
          sourceLang: langA,
          targetLang: langB,
          source: fnA,
          target: fnB,
          where: threadRule.where,
          priority: threadRule.priority,
          allowCrossLanguageRef: threadRule.allowCrossLanguageRef,
          relation: threadRule.relation,
        });
      }
    }
  }

  getAllRules(): readonly EvaluatedCorrespondenceRule[] {
    return this.rules;
  }

  /**
   * Checks whether `candidate` (in a foreign language) can satisfy a reference originating in `referencingLang`
   * expecting one of `expectedKindsOrRules` (or any cross-language resolvable metaclass if omitted).
   */
  canResolveAs(
    referencingLang: string,
    candidate: SymbolEntry,
    expectedKindsOrRules?: readonly string[],
  ): EvaluatedCorrespondenceRule | null {
    const reqLang = normalizeTggLanguageId(referencingLang);
    const candLang = normalizeTggLanguageId(candidate.language);
    if (!reqLang || !candLang || reqLang === candLang) return null;

    for (const r of this.rules) {
      if (!r.allowCrossLanguageRef) continue;

      // Case 1: rule maps candLang (source) -> reqLang (target)
      if (r.sourceLang === candLang && r.targetLang === reqLang) {
        if (!matchesEntryNodeType(candidate, r.sourceNodeType, r.sourceLiteralGuards)) continue;
        if (
          !expectedKindsOrRules ||
          expectedKindsOrRules.length === 0 ||
          expectedKindsOrRules.some((exp) => nodeTypesCompatible(r.targetNodeType, exp))
        ) {
          return r;
        }
      }

      // Case 2: rule maps reqLang (source) -> candLang (target) (symmetric TGG)
      if (r.sourceLang === reqLang && r.targetLang === candLang) {
        if (!matchesEntryNodeType(candidate, r.targetNodeType, r.targetLiteralGuards)) continue;
        if (
          !expectedKindsOrRules ||
          expectedKindsOrRules.length === 0 ||
          expectedKindsOrRules.some((exp) => nodeTypesCompatible(r.sourceNodeType, exp))
        ) {
          return r;
        }
      }
    }
    return null;
  }

  /** Maps a primitive or connector type name from `sourceLang` into `targetLang`. */
  mapType(sourceLang: string, targetLang: string, rawType: string): string {
    const s = normalizeTggLanguageId(sourceLang);
    const t = normalizeTggLanguageId(targetLang);
    const forward = this.typeMaps.get(s)?.get(t)?.[rawType];
    if (forward) return forward;
    const reverseDict = this.typeMaps.get(t)?.get(s);
    if (reverseDict) {
      for (const [k, v] of Object.entries(reverseDict)) {
        if (v === rawType) return k;
      }
    }
    return rawType;
  }

  /** Projects a foreign container symbol's ports, parameters, and subcomponents into `targetLang`. */
  projectForeignSignature(candidate: SymbolEntry, index: SymbolIndex, targetLang: string): ProjectedForeignSignature {
    const candLang = normalizeTggLanguageId(candidate.language);
    const normTgt = normalizeTggLanguageId(targetLang);
    const matchedRule = this.canResolveAs(normTgt, candidate);
    const childIds = index.childrenOf.get(candidate.id) ?? [];
    const members: ProjectedForeignMember[] = [];

    for (const cid of childIds) {
      const ch = index.symbols.get(cid);
      if (!ch || isRelationshipOrImportSymbol(ch)) continue;
      const meta = ch.metadata ?? {};
      const rawType = String(meta["typeSpecifier"] ?? meta["type"] ?? meta["featureType"] ?? "Real");
      const projectedType = this.mapType(candLang, normTgt, rawType);
      const isPort =
        isPortLikeSymbol(ch) ||
        ch.kind === "TaggedPort" ||
        ch.ruleName === "pscad_port" ||
        ch.ruleName === "psse_port" ||
        meta["isConnectorPort"] === true;
      const variability = String(meta["variability"] ?? "");
      const role: ProjectedForeignMember["role"] = isPort
        ? "port"
        : variability === "parameter" ||
            ch.ruleName?.includes("parameter") ||
            ch.kind === "Property" ||
            ch.kind === "Variable"
          ? "parameter"
          : isMemberLikeSymbol(ch)
            ? "component"
            : "attribute";
      const dirRaw = String(meta["direction"] ?? meta["causality"] ?? "").toLowerCase();
      const direction: ProjectedForeignMember["direction"] =
        dirRaw === "in" || dirRaw === "input"
          ? "in"
          : dirRaw === "out" || dirRaw === "output"
            ? "out"
            : dirRaw === "inout"
              ? "inout"
              : undefined;

      members.push({
        symbolId: ch.id,
        name: ch.name,
        projectedType,
        role,
        ...(direction ? { direction } : {}),
        ...(meta["defaultValue"] !== undefined || meta["value"] !== undefined
          ? { defaultValue: meta["defaultValue"] ?? meta["value"] }
          : {}),
        ...(typeof meta["unit"] === "string" ? { unit: meta["unit"] } : {}),
      });
    }

    return {
      symbolId: candidate.id,
      name: candidate.name,
      sourceLang: candLang,
      targetLang: normTgt,
      matchedRule,
      members,
    };
  }

  /** Checks whether two member names inside an aligned parent context match directly or via TGG field aliases. */
  areMemberNamesAligned(langA: string, nameA: string, langB: string, nameB: string): boolean {
    if (!nameA || !nameB) return false;
    const cleanA = unquotePortOrIdent(nameA);
    const cleanB = unquotePortOrIdent(nameB);
    if (cleanA === cleanB) return true;

    const normLangA = normalizeTggLanguageId(langA);
    const normLangB = normalizeTggLanguageId(langB);
    for (const r of this.rules) {
      if (r.sourceLang === normLangA && r.targetLang === normLangB) {
        for (const fa of r.fieldAliases) {
          if (fa.sourceField === cleanA && fa.targetField === cleanB) return true;
          if (fa.aliases && fa.aliases[cleanA] === cleanB) return true;
        }
      } else if (r.sourceLang === normLangB && r.targetLang === normLangA) {
        for (const fa of r.fieldAliases) {
          if (fa.sourceField === cleanB && fa.targetField === cleanA) return true;
          if (fa.aliases && fa.aliases[cleanB] === cleanA) return true;
        }
      }
    }
    return false;
  }
}

function unquotePortOrIdent(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith('"') && trimmed.endsWith('"')) || (trimmed.startsWith("'") && trimmed.endsWith("'"))) {
    return trimmed.slice(1, -1).trim();
  }
  const firstComma = trimmed.indexOf(",");
  if (firstComma > 0) {
    return unquotePortOrIdent(trimmed.slice(0, firstComma));
  }
  return trimmed;
}

function normalizeStepEntityKey(raw: unknown): string | null {
  if (raw === undefined || raw === null) return null;
  const s = String(raw).trim();
  if (!s) return null;
  const hashIdx = s.lastIndexOf("#");
  const tail = hashIdx >= 0 ? s.slice(hashIdx + 1) : s;
  const digits = /^\d+/.exec(tail)?.[0];
  return digits ? `#${digits}` : null;
}

function readSymbolKeyAttribute(entry: SymbolEntry, attr: string): string | null {
  if (attr === "name" || attr === "declaredName" || attr === "className" || attr === "modName" || attr === "prodName") {
    return unquotePortOrIdent(entry.name);
  }
  const meta = entry.metadata;
  if (meta && meta[attr] !== undefined && meta[attr] !== null) {
    return String(meta[attr]).trim();
  }
  if (attr === "identifier" || attr === "reqId" || attr === "charName" || attr === "featName" || attr === "caseName") {
    return String(meta?.[attr] ?? entry.name).trim();
  }
  if (attr === "stepId" && entry.name.startsWith("#")) {
    return entry.name.trim();
  }
  return entry.name ? unquotePortOrIdent(entry.name) : null;
}

function keysMatchWithTransform(valA: string | null, valB: string | null, keySpec: TGGIdentityKey): boolean {
  if (!valA || !valB) return false;
  const mode = keySpec.transform ?? "exact";
  if (mode === "stepId") {
    const nA = normalizeStepEntityKey(valA);
    const nB = normalizeStepEntityKey(valB);
    return Boolean(nA && nB && nA === nB);
  }
  if (mode === "stripPrefix" && keySpec.prefix) {
    const strippedA = valA.startsWith(keySpec.prefix) ? valA.slice(keySpec.prefix.length) : valA;
    const strippedB = valB.startsWith(keySpec.prefix) ? valB.slice(keySpec.prefix.length) : valB;
    return strippedA === strippedB;
  }
  if (mode === "caseInsensitive") {
    return valA.toLowerCase() === valB.toLowerCase();
  }
  return valA === valB;
}

function mapRoleToThreadRelation(role: TGGRelationRole): ThreadRelation {
  switch (role) {
    case "satisfy":
      return ThreadRelation.Satisfies;
    case "verify":
      return ThreadRelation.Verifies;
    case "allocate":
      return ThreadRelation.AllocatesTo;
    default:
      return ThreadRelation.Aligned;
  }
}

export interface TggCorrespondenceIndexerOptions {
  /** Automatically align unambiguous top-level container symbols matching a root TGG rule (default: true). */
  autoAlignTopLevel?: boolean | undefined;
}

export interface TggAlignmentSummary {
  slotCount: number;
  boundSymbolCount: number;
  touchedSlots: number[];
}

/**
 * Evaluates TGG correspondence rules, native cross-language references (`Import`, typing,
 * `satisfy`, `verify`, `allocate`), and foreign keys (`stepEntityId`) over a `UnifiedWorkspace`
 * `SymbolIndex`, populating `DigitalThreadHypergraph` and `WasmQueryEngine`'s `correspondenceSlotMap`.
 */
export class TggCorrespondenceIndexer {
  public readonly projectionTable: TggSymbolProjectionTable;
  public readonly hypergraph: DigitalThreadHypergraph;
  public readonly slotMap = new Map<SymbolId, number>();
  public readonly slotsBySymbol = new Map<SymbolId, Set<number>>();
  private autoAlignTopLevel: boolean;
  private indexerOwnedSlots = new Set<number>();
  private lastVersion = -1;
  private lastSymbolCount = -1;

  constructor(
    projectionTable = new TggSymbolProjectionTable(),
    hypergraph = new DigitalThreadHypergraph(),
    options: TggCorrespondenceIndexerOptions = {},
  ) {
    this.projectionTable = projectionTable;
    this.hypergraph = hypergraph;
    this.autoAlignTopLevel = options.autoAlignTopLevel ?? true;
  }

  /** Maps a language ID to its canonical `ThreadDomain` in `this.hypergraph`. */
  resolveThreadDomain(langId: string): ThreadDomain {
    return this.hypergraph.resolveOrRegisterDomain(normalizeTggLanguageId(langId)) as ThreadDomain;
  }

  /** Returns all hypergraph slots associated with `symbolId`. */
  getSlotsForSymbol(symbolId: SymbolId): ReadonlySet<number> {
    return this.slotsBySymbol.get(symbolId) ?? new Set();
  }

  private cachedStepByEntityKey = new Map<string, SymbolEntry[]>();

  /**
   * Aligns cross-language symbols from `index` into `DigitalThreadHypergraph` and `slotMap`.
   * Reuses unchanged slots in O(delta N) when `changedIds` / `changedNames` are supplied.
   */
  syncIndex(
    index: SymbolIndex,
    version?: number,
    changedIds?: Iterable<SymbolId>,
    changedNames?: Iterable<string>,
  ): TggAlignmentSummary {
    if (
      version !== undefined &&
      version === this.lastVersion &&
      index.symbols.size === this.lastSymbolCount &&
      this.slotMap.size > 0
    ) {
      return {
        slotCount: this.indexerOwnedSlots.size,
        boundSymbolCount: this.slotMap.size,
        touchedSlots: Array.from(this.indexerOwnedSlots),
      };
    }
    if (version !== undefined) {
      this.lastVersion = version;
    }

    const deltaIdSet = new Set<SymbolId>();
    if (changedIds) {
      for (const id of changedIds) deltaIdSet.add(id);
    }
    if (changedNames) {
      for (const name of changedNames) {
        if (!name) continue;
        for (const id of index.byName.get(name) ?? []) {
          deltaIdSet.add(id);
        }
      }
    }

    const isIncremental =
      this.indexerOwnedSlots.size > 0 &&
      deltaIdSet.size > 0 &&
      deltaIdSet.size < Math.max(64, Math.floor(index.symbols.size / 4));

    this.lastSymbolCount = index.symbols.size;

    const dirtyIds = new Set<SymbolId>();
    if (isIncremental) {
      const expandSymbol = (id: SymbolId) => {
        if (dirtyIds.has(id)) return;
        dirtyIds.add(id);
        const entry = index.symbols.get(id);
        if (entry) {
          if (entry.parentId !== null) dirtyIds.add(entry.parentId);
          for (const cid of index.childrenOf.get(id) ?? []) dirtyIds.add(cid);
          if (entry.name) {
            for (const peerNameId of index.byName.get(entry.name) ?? []) {
              dirtyIds.add(peerNameId);
            }
          }
        }
        const existingSlots = this.slotsBySymbol.get(id);
        if (existingSlots) {
          for (const oldSlot of existingSlots) {
            const rec = this.hypergraph.getRecord(oldSlot);
            if (!rec) continue;
            for (const memberId of Object.values(rec.domainNodes)) {
              if (typeof memberId === "number") dirtyIds.add(memberId);
            }
          }
        }
      };
      for (const seedId of deltaIdSet) {
        expandSymbol(seedId);
      }

      const slotsToRetract = new Set<number>();
      for (const did of dirtyIds) {
        for (const s of this.slotsBySymbol.get(did) ?? []) {
          slotsToRetract.add(s);
        }
      }
      for (const oldSlot of slotsToRetract) {
        this.hypergraph.markRemoved(oldSlot);
        this.indexerOwnedSlots.delete(oldSlot);
      }
      for (const did of dirtyIds) {
        const sSet = this.slotsBySymbol.get(did);
        if (sSet) {
          for (const s of slotsToRetract) sSet.delete(s);
          if (sSet.size === 0) {
            this.slotsBySymbol.delete(did);
            this.slotMap.delete(did);
          } else {
            this.slotMap.set(did, sSet.values().next().value!);
          }
        } else {
          this.slotMap.delete(did);
        }
      }
    } else {
      // Full retraction of previously auto-indexed slots while leaving manual threads intact
      for (const oldSlot of this.indexerOwnedSlots) {
        this.hypergraph.markRemoved(oldSlot);
      }
      this.indexerOwnedSlots.clear();
      this.slotMap.clear();
      this.slotsBySymbol.clear();
      this.cachedStepByEntityKey.clear();
    }

    const touchedSlots: number[] = [];
    const containerPairs: Array<{ a: SymbolEntry; b: SymbolEntry; slot: number }> = [];
    const boundPairs = new Set<string>();

    const recordSymbolSlot = (symId: SymbolId, s: number) => {
      if (!this.slotMap.has(symId)) {
        this.slotMap.set(symId, s);
      }
      let set = this.slotsBySymbol.get(symId);
      if (!set) {
        set = new Set<number>();
        this.slotsBySymbol.set(symId, set);
      }
      set.add(s);
    };

    const bindPair = (
      a: SymbolEntry,
      b: SymbolEntry,
      relation: ThreadRelation = ThreadRelation.Aligned,
    ): number | null => {
      const langA = normalizeTggLanguageId(a.language);
      const langB = normalizeTggLanguageId(b.language);
      if (!langA || !langB || langA === langB) return null;

      const pairId = a.id < b.id ? `${a.id}:${b.id}` : `${b.id}:${a.id}`;
      if (boundPairs.has(pairId)) {
        return this.slotMap.get(a.id) ?? null;
      }
      boundPairs.add(pairId);

      // Reuse an existing N-ary slot if either symbol is already bound in a compatible slot without domain or relation conflict
      const domA = this.resolveThreadDomain(langA);
      const domB = this.resolveThreadDomain(langB);
      let slot: number | undefined;
      const candidateSlots = [...(this.slotsBySymbol.get(a.id) ?? []), ...(this.slotsBySymbol.get(b.id) ?? [])];
      for (const candSlot of candidateSlots) {
        const rec = this.hypergraph.getRecord(candSlot);
        if (!rec || rec.isRemoved || rec.relation !== relation) continue;
        const existingA = rec.domainNodes[domA];
        const existingB = rec.domainNodes[domB];
        if ((existingA === undefined || existingA === a.id) && (existingB === undefined || existingB === b.id)) {
          slot = candSlot;
          break;
        }
      }

      if (slot === undefined) {
        const stableKey = [
          `${langA}:${a.resourceId ?? ""}:${this.computeSymbolPath(index, a)}`,
          `${langB}:${b.resourceId ?? ""}:${this.computeSymbolPath(index, b)}`,
        ]
          .sort()
          .join("|");
        const threadId = 200_000 + (fnv1a32(stableKey) % 700_000_000);
        const existingSlot = this.hypergraph.findSlotByThreadId(threadId);
        if (existingSlot !== null && existingSlot !== undefined) {
          slot = existingSlot;
          this.hypergraph.resetSlot(existingSlot, relation);
        } else {
          slot = this.hypergraph.createThread(threadId, 1, relation);
        }
        this.indexerOwnedSlots.add(slot);
        touchedSlots.push(slot);
      }

      this.hypergraph.bindDomainNode(slot, domA, a.id);
      this.hypergraph.bindDomainNode(slot, domB, b.id);
      recordSymbolSlot(a.id, slot);
      recordSymbolSlot(b.id, slot);

      if (this.isContainerSymbol(index, a) && this.isContainerSymbol(index, b)) {
        containerPairs.push({ a, b, slot });
      }
      return slot;
    };

    const allSymbols: SymbolEntry[] = isIncremental
      ? Array.from(dirtyIds)
          .map((id) => index.symbols.get(id))
          .filter((s): s is SymbolEntry => Boolean(s))
      : Array.from(index.symbols.values());

    // Build O(1) lookup tables for STEP entity IDs (`#123`) and top-level containers by language
    const stepByEntityKey = this.cachedStepByEntityKey;
    const topLevelByLang = new Map<string, SymbolEntry[]>();
    const pushTopLevel = (lang: string, sym: SymbolEntry) => {
      if (sym.parentId === null && !isRelationshipOrImportSymbol(sym)) {
        const list = topLevelByLang.get(lang) ?? [];
        list.push(sym);
        topLevelByLang.set(lang, list);
      } else if (sym.parentId !== null && !isRelationshipOrImportSymbol(sym)) {
        // Symbols nested directly inside a top-level Package/Specification/Library also act as addressable declarations
        const parent = index.symbols.get(sym.parentId);
        if (
          parent &&
          parent.parentId === null &&
          (parent.kind === "Package" ||
            parent.ruleName === "Package" ||
            parent.ruleName === "PackageBody" ||
            parent.ruleName === "reqif_specification" ||
            parent.ruleName === "pscad_library" ||
            parent.ruleName === "pscad_project" ||
            parent.ruleName === "scad_file" ||
            parent.ruleName === "step_product") &&
          (isTypeLikeSymbol(sym) ||
            sym.kind === "Module" ||
            sym.ruleName === "reqif_requirement" ||
            sym.ruleName === "qif_characteristic")
        ) {
          const list = topLevelByLang.get(lang) ?? [];
          list.push(sym);
          topLevelByLang.set(lang, list);
        }
      }
    };

    for (const sym of allSymbols) {
      const lang = normalizeTggLanguageId(sym.language);
      if (!lang) continue;
      if (lang === "step") {
        const stepKey = normalizeStepEntityKey(sym.metadata?.["stepId"] ?? sym.name);
        if (stepKey) {
          const list = stepByEntityKey.get(stepKey) ?? [];
          if (!list.some((existing) => existing.id === sym.id)) {
            list.push(sym);
          }
          stepByEntityKey.set(stepKey, list);
        }
      }
      pushTopLevel(lang, sym);
    }

    if (isIncremental) {
      const seenTopIds = new Set<SymbolId>(allSymbols.map((s) => s.id));
      for (const sym of allSymbols) {
        if (!sym.name) continue;
        for (const peerId of index.byName.get(sym.name) ?? []) {
          if (seenTopIds.has(peerId)) continue;
          const peer = index.symbols.get(peerId);
          if (!peer) continue;
          const pLang = normalizeTggLanguageId(peer.language);
          if (!pLang) continue;
          seenTopIds.add(peerId);
          pushTopLevel(pLang, peer);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pass 1: Tier 1 Native Cross-Language References (Import, Typing, Extends, Satisfy/Verify/Allocate)
    // -----------------------------------------------------------------------
    for (const sym of allSymbols) {
      const srcLang = normalizeTggLanguageId(sym.language);
      if (!srcLang) continue;
      const meta = sym.metadata ?? {};

      // 1a. Import clauses (`import ForeignPkg::Comp` or `import ForeignPkg.Comp`)
      if (sym.kind === "Import" && sym.name) {
        const target = this.resolveForeignQualifiedTarget(index, sym.name, srcLang);
        if (target && this.projectionTable.canResolveAs(srcLang, target)) {
          const owner = sym.parentId !== null ? index.symbols.get(sym.parentId) : undefined;
          bindPair(owner ?? sym, target, ThreadRelation.Aligned);
        }
        continue;
      }

      // 1b. Extends / Subclassification clauses
      if (
        (sym.kind === "Extends" || sym.ruleName === "OwnedSubclassification" || sym.ruleName === "Specialization") &&
        sym.name
      ) {
        const target = this.resolveForeignQualifiedTarget(index, sym.name, srcLang, [
          "Class",
          "PartDefinition",
          "Type",
        ]);
        if (target) {
          const owner = sym.parentId !== null ? index.symbols.get(sym.parentId) : undefined;
          if (owner) bindPair(owner, target, ThreadRelation.DerivesFrom);
        }
        continue;
      }

      // 1c. Satisfy / Verify / Allocate clauses (e.g. SysML v2 `satisfy REQ_01 by ctrl;`)
      if (
        sym.ruleName === "SatisfyRequirementUsage" ||
        sym.ruleName === "VerifyRequirementUsage" ||
        sym.ruleName === "AllocationUsage" ||
        sym.ruleName === "AllocateDefinition"
      ) {
        const rel =
          sym.ruleName === "VerifyRequirementUsage"
            ? ThreadRelation.Verifies
            : sym.ruleName.includes("Allocat")
              ? ThreadRelation.AllocatesTo
              : ThreadRelation.Satisfies;
        const expected =
          sym.ruleName === "SatisfyRequirementUsage" || sym.ruleName === "VerifyRequirementUsage"
            ? ["RequirementDefinition", "RequirementUsage"]
            : undefined;
        const targetName = String(meta["target"] ?? sym.name ?? "").trim();
        if (targetName) {
          const target = this.resolveForeignQualifiedTarget(index, targetName, srcLang, expected);
          if (target) {
            const subject = sym.parentId !== null ? (index.symbols.get(sym.parentId) ?? sym) : sym;
            bindPair(subject, target, rel);
          }
        }
        continue;
      }

      // 1d. Typed component/part usages (`part m : ForeignModel;` or `ForeignModel m;`)
      if (isMemberLikeSymbol(sym)) {
        const childIds = index.childrenOf.get(sym.id) ?? [];
        let rawType = String(meta["typeSpecifier"] ?? meta["type_specifier"] ?? meta["declaredType"] ?? "").trim();
        if (!rawType) {
          for (const cid of childIds) {
            const c = index.symbols.get(cid);
            if (
              c &&
              (c.ruleName === "OwnedFeatureTyping" ||
                c.ruleName === "ConjugatedPortTyping" ||
                c.ruleName === "FeatureTyping")
            ) {
              rawType = c.name.trim();
              break;
            }
          }
        }
        if (rawType) {
          const target = this.resolveForeignQualifiedTarget(index, rawType, srcLang, [
            "Class",
            "PartDefinition",
            "PortDefinition",
            "AttributeDefinition",
            "Module",
            "Type",
          ]);
          if (target) {
            bindPair(sym, target, ThreadRelation.Aligned);
            // Also propagate contextual child bindings between the typed usage's enclosing container or usage children and target
            containerPairs.push({ a: sym, b: target, slot: this.slotMap.get(sym.id)! });
          }
        }
      }

      // 1e. Explicit Tier-3 overrides (`twin`, `implements`, `counterpart`) preserved for backwards compatibility
      const explicitTarget =
        typeof meta["implements"] === "string"
          ? meta["implements"]
          : typeof meta["twin"] === "string"
            ? meta["twin"]
            : typeof meta["counterpart"] === "string"
              ? meta["counterpart"]
              : undefined;
      if (explicitTarget) {
        const target = this.resolveForeignQualifiedTarget(index, explicitTarget, srcLang, undefined, true);
        if (target) {
          bindPair(sym, target, ThreadRelation.Aligned);
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pass 2: Tier 2 Declarative Foreign-Key TGG Rules (e.g. QIF stepEntityId -> STEP #N)
    // -----------------------------------------------------------------------
    for (const rule of this.projectionTable.getAllRules()) {
      if (!rule.foreignKey) continue;
      const { sourceAttr, targetAttr, relation } = rule.foreignKey;
      const rel = mapRoleToThreadRelation(relation ?? rule.relation);

      for (const sym of allSymbols) {
        if (normalizeTggLanguageId(sym.language) !== rule.sourceLang) continue;
        if (!matchesEntryNodeType(sym, rule.sourceNodeType, rule.sourceLiteralGuards)) continue;
        const fkRaw = sym.metadata?.[sourceAttr];
        if (fkRaw === undefined || fkRaw === null || fkRaw === "") continue;

        if (rule.targetLang === "step" && (targetAttr === "stepId" || targetAttr === "id" || targetAttr === "name")) {
          const stepKey = normalizeStepEntityKey(fkRaw);
          const targets = stepKey ? stepByEntityKey.get(stepKey) : undefined;
          if (targets && targets.length > 0) {
            bindPair(sym, targets[0]!, rel);
            continue;
          }
        }

        const fkStr = String(fkRaw).trim();
        const candIds = index.byName.get(fkStr) ?? [];
        for (const cid of candIds) {
          const cand = index.symbols.get(cid);
          if (
            cand &&
            normalizeTggLanguageId(cand.language) === rule.targetLang &&
            matchesEntryNodeType(cand, rule.targetNodeType, rule.targetLiteralGuards)
          ) {
            bindPair(sym, cand, rel);
            break;
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pass 3: Tier 2 Unambiguous Top-Level TGG Container Alignment
    // -----------------------------------------------------------------------
    if (this.autoAlignTopLevel) {
      for (const rule of this.projectionTable.getAllRules()) {
        // Context-dependent rules only fire inside an already-aligned parent container (Pass 4)
        if (rule.contextSourceType || rule.contextTargetType || rule.foreignKey) continue;
        // Never auto-align generic leaf variables/parameters globally without an enclosing container
        if (this.isLeafOnlyNodeType(rule.sourceNodeType) || this.isLeafOnlyNodeType(rule.targetNodeType)) continue;

        const srcCandidates = topLevelByLang.get(rule.sourceLang);
        const tgtCandidates = topLevelByLang.get(rule.targetLang);
        if (!srcCandidates || !tgtCandidates || srcCandidates.length === 0 || tgtCandidates.length === 0) continue;

        for (const ik of rule.identityKeys) {
          // Group target candidates by normalized identity key; skip ambiguous distinct declarations
          const tgtByKey = new Map<string, SymbolEntry | "AMBIGUOUS">();
          for (const tgt of tgtCandidates) {
            if (!matchesEntryNodeType(tgt, rule.targetNodeType, rule.targetLiteralGuards)) continue;
            const kVal = this.normalizeKeyForLookup(readSymbolKeyAttribute(tgt, ik.target), ik);
            if (!kVal) continue;
            const existing = tgtByKey.get(kVal);
            if (!existing) {
              tgtByKey.set(kVal, tgt);
            } else if (
              existing !== "AMBIGUOUS" &&
              (existing.resourceId !== tgt.resourceId || existing.startOffset !== tgt.startOffset)
            ) {
              tgtByKey.set(kVal, "AMBIGUOUS");
            }
          }
          if (tgtByKey.size === 0) continue;

          const srcByKey = new Map<string, SymbolEntry | "AMBIGUOUS">();
          for (const src of srcCandidates) {
            if (!matchesEntryNodeType(src, rule.sourceNodeType, rule.sourceLiteralGuards)) continue;
            const kVal = this.normalizeKeyForLookup(readSymbolKeyAttribute(src, ik.source), ik);
            if (!kVal) continue;
            const existing = srcByKey.get(kVal);
            if (!existing) {
              srcByKey.set(kVal, src);
            } else if (
              existing !== "AMBIGUOUS" &&
              (existing.resourceId !== src.resourceId || existing.startOffset !== src.startOffset)
            ) {
              srcByKey.set(kVal, "AMBIGUOUS");
            }
          }

          for (const [kVal, src] of srcByKey.entries()) {
            if (src === "AMBIGUOUS") continue;
            const tgt = tgtByKey.get(kVal);
            if (!tgt || tgt === "AMBIGUOUS") continue;
            if (
              keysMatchWithTransform(readSymbolKeyAttribute(src, ik.source), readSymbolKeyAttribute(tgt, ik.target), ik)
            ) {
              bindPair(src, tgt, mapRoleToThreadRelation(rule.relation));
            }
          }
        }
      }
    }

    // -----------------------------------------------------------------------
    // Pass 4: Scoped Contextual Child Propagation (Ports, Parameters, Sub-parts)
    // -----------------------------------------------------------------------
    for (let i = 0; i < containerPairs.length; i++) {
      const { a, b } = containerPairs[i]!;
      const langA = normalizeTggLanguageId(a.language);
      const langB = normalizeTggLanguageId(b.language);
      const childrenA = (index.childrenOf.get(a.id) ?? [])
        .map((id) => index.symbols.get(id))
        .filter((s): s is SymbolEntry => Boolean(s) && !isRelationshipOrImportSymbol(s));
      const childrenB = (index.childrenOf.get(b.id) ?? [])
        .map((id) => index.symbols.get(id))
        .filter((s): s is SymbolEntry => Boolean(s) && !isRelationshipOrImportSymbol(s));

      if (childrenA.length === 0 || childrenB.length === 0) continue;

      for (const chA of childrenA) {
        for (const chB of childrenB) {
          if (!this.areChildRolesCompatible(chA, chB)) continue;
          if (this.projectionTable.areMemberNamesAligned(langA, chA.name, langB, chB.name)) {
            bindPair(chA, chB, ThreadRelation.Aligned);
          }
        }
      }
    }

    return {
      slotCount: this.indexerOwnedSlots.size,
      boundSymbolCount: this.slotMap.size,
      touchedSlots,
    };
  }

  /**
   * Resolves a simple or qualified foreign symbol path (`Pkg::Type`, `Pkg.Type`, `Domain::Pkg::Type`, or `Name`)
   * against `index`, checking `TggSymbolProjectionTable.canResolveAs` unless `bypassRuleCheck` is set.
   */
  resolveForeignQualifiedTarget(
    index: SymbolIndex,
    rawPath: string,
    sourceLang: string,
    expectedKindsOrRules?: readonly string[],
    bypassRuleCheck = false,
  ): SymbolEntry | undefined {
    const trimmed = rawPath.trim();
    if (!trimmed) return undefined;

    let explicitDomain: string | undefined;
    let pathBody = trimmed;
    const domainPrefix = /^([a-zA-Z0-9_-]+)(?:::|\/\/)(.+)$/.exec(trimmed);
    if (domainPrefix && domainPrefix[1] && domainPrefix[2]) {
      const maybeLang = normalizeTggLanguageId(domainPrefix[1]);
      if (
        maybeLang === "sysml2" ||
        maybeLang === "modelica" ||
        maybeLang === "scad" ||
        maybeLang === "step" ||
        maybeLang === "cad" ||
        maybeLang === "reqif" ||
        maybeLang === "qif" ||
        maybeLang === "pscad" ||
        maybeLang === "psse" ||
        maybeLang === "urdf" ||
        maybeLang === "fea" ||
        maybeLang === "cfd"
      ) {
        explicitDomain = maybeLang === "cad" ? "step" : maybeLang;
        pathBody = domainPrefix[2];
      }
    }

    if (explicitDomain === "step" || pathBody.includes("#")) {
      const stepKey = normalizeStepEntityKey(pathBody);
      if (stepKey) {
        for (const entry of index.symbols.values()) {
          if (normalizeTggLanguageId(entry.language) !== "step") continue;
          const entryStepKey = normalizeStepEntityKey(entry.metadata?.["stepId"] ?? entry.name);
          if (entryStepKey === stepKey) return entry;
        }
      }
    }

    const segments = pathBody.split(/::|\./).filter((s) => s.length > 0);
    if (segments.length === 0) return undefined;

    const accepts = (cand: SymbolEntry): boolean => {
      const candLang = normalizeTggLanguageId(cand.language);
      if (!candLang || candLang === sourceLang) return false;
      if (explicitDomain && candLang !== explicitDomain) return false;
      if (isRelationshipOrImportSymbol(cand)) return false;
      if (bypassRuleCheck) return true;
      return this.projectionTable.canResolveAs(sourceLang, cand, expectedKindsOrRules) !== null;
    };

    // Multi-segment hierarchical walk
    if (segments.length > 1) {
      const rootIds = index.byName.get(segments[0]!) ?? [];
      for (const rid of rootIds) {
        let cur = index.symbols.get(rid);
        if (!cur) continue;
        for (let i = 1; i < segments.length && cur; i++) {
          const seg = segments[i]!;
          const childIds = index.childrenOf.get(cur.id) ?? [];
          let next: SymbolEntry | undefined;
          for (const cid of childIds) {
            const ch = index.symbols.get(cid);
            if (ch && ch.name === seg && !isRelationshipOrImportSymbol(ch)) {
              next = ch;
              break;
            }
          }
          cur = next;
        }
        if (cur && accepts(cur)) return cur;
      }
    }

    // Leaf lookup (with suffix validation when multi-segment)
    const leaf = segments[segments.length - 1]!;
    const leafIds = index.byName.get(leaf) ?? [];
    const expectedSuffix = segments.join(".").toLowerCase();
    for (const lid of leafIds) {
      const cand = index.symbols.get(lid);
      if (!cand || !accepts(cand)) continue;
      if (segments.length === 1) return cand;
      const candPath = this.computeSymbolPath(index, cand).toLowerCase();
      if (candPath === expectedSuffix || candPath.endsWith(`.${expectedSuffix}`)) {
        return cand;
      }
    }
    return undefined;
  }

  private computeSymbolPath(index: SymbolIndex, entry: SymbolEntry): string {
    const parts: string[] = [];
    let cur: SymbolEntry | undefined = entry;
    const seen = new Set<SymbolId>();
    while (cur && !seen.has(cur.id)) {
      seen.add(cur.id);
      if (cur.name) parts.unshift(cur.name);
      cur = cur.parentId !== null ? index.symbols.get(cur.parentId) : undefined;
    }
    return parts.join(".");
  }

  private isContainerSymbol(index: SymbolIndex, entry: SymbolEntry): boolean {
    if (isTypeLikeSymbol(entry) || entry.kind === "Module" || entry.kind === "Package") return true;
    const children = index.childrenOf.get(entry.id);
    return Boolean(children && children.length > 0);
  }

  private isLeafOnlyNodeType(nodeType: string): boolean {
    const low = nodeType.toLowerCase();
    return (
      low === "componentclause" ||
      low === "attributeusage" ||
      low === "portusage" ||
      low === "assignstatement" ||
      low === "pscad_port" ||
      low === "pscad_parameter" ||
      low === "psse_port" ||
      low === "psse_parameter" ||
      low === "simpleequation" ||
      low === "derequation" ||
      low === "equationclause"
    );
  }

  private normalizeKeyForLookup(val: string | null, keySpec: TGGIdentityKey): string | null {
    if (!val) return null;
    if (keySpec.transform === "stepId") return normalizeStepEntityKey(val);
    if (keySpec.transform === "stripPrefix" && keySpec.prefix && val.startsWith(keySpec.prefix)) {
      return val.slice(keySpec.prefix.length);
    }
    if (keySpec.transform === "caseInsensitive") return val.toLowerCase();
    return val;
  }

  private areChildRolesCompatible(a: SymbolEntry, b: SymbolEntry): boolean {
    const portA =
      isPortLikeSymbol(a) ||
      a.kind === "TaggedPort" ||
      a.ruleName === "pscad_port" ||
      a.ruleName === "psse_port" ||
      a.metadata?.["isConnectorPort"] === true;
    const portB =
      isPortLikeSymbol(b) ||
      b.kind === "TaggedPort" ||
      b.ruleName === "pscad_port" ||
      b.ruleName === "psse_port" ||
      b.metadata?.["isConnectorPort"] === true;
    if (portA && portB) return true;
    if (portA !== portB) {
      // In Modelica, connector ports are indexed as `Component` (`component_declaration`) without `isConnectorPort` metadata
      const aCouldBeModelicaPort = normalizeTggLanguageId(a.language) === "modelica" && a.kind === "Component";
      const bCouldBeModelicaPort = normalizeTggLanguageId(b.language) === "modelica" && b.kind === "Component";
      if ((portA && bCouldBeModelicaPort) || (portB && aCouldBeModelicaPort)) return true;
      return false;
    }
    return true;
  }
}

function fnv1a32(str: string): number {
  let h = 2166136261;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 16777619) >>> 0;
  }
  return h;
}
