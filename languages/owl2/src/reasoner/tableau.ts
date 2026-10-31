// SPDX-License-Identifier: AGPL-3.0-or-later

import type { OWL2Axiom } from "@modelscript/runtime";
import { BUILTIN_OWL2_PREFIXES } from "../cst-lowering.js";
import { detectOwl2Format, parseOwlXmlToAxioms, parseTurtleToOwl2Axioms } from "../parser/index.js";

// ── SROIQ(D) Class Expressions & Facets ──────────────────────────────────────

export type FacetKind = "minInclusive" | "maxInclusive" | "minExclusive" | "maxExclusive";

export interface NumericFacetRestriction {
  facet: FacetKind;
  value: number;
}

export interface DataRangeSpec {
  datatypeIri: string;
  facets: NumericFacetRestriction[];
}

export type TableauClassExpr =
  | { kind: "NamedClass"; iri: string }
  | { kind: "ObjectComplementOf"; operand: TableauClassExpr }
  | { kind: "ObjectIntersectionOf"; operands: TableauClassExpr[] }
  | { kind: "ObjectUnionOf"; operands: TableauClassExpr[] }
  | { kind: "ObjectOneOf"; individuals: string[] }
  | { kind: "ObjectSomeValuesFrom"; property: string; filler: TableauClassExpr }
  | { kind: "ObjectAllValuesFrom"; property: string; filler: TableauClassExpr }
  | { kind: "ObjectHasValue"; property: string; individual: string }
  | { kind: "ObjectHasSelf"; property: string }
  | {
      kind: "ObjectCardinality";
      cardType: "min" | "max" | "exact";
      count: number;
      property: string;
      filler: TableauClassExpr;
    }
  | { kind: "DataSomeValuesFrom"; property: string; range: DataRangeSpec }
  | { kind: "DataAllValuesFrom"; property: string; range: DataRangeSpec }
  | { kind: "DataHasValue"; property: string; value: string | number };

export interface TableauSubClassAxiom {
  sub: TableauClassExpr;
  sup: TableauClassExpr;
}

export interface PropertyChainAxiom {
  chain: string[];
  superProperty: string;
}

export interface Owl2ReasoningResult {
  consistent: boolean;
  unsatisfiableClasses: string[];
  clashes: string[];
  inferredSubClasses: Map<string, Set<string>>;
  inferredTypes: Map<string, Set<string>>;
  inferredRoleAssertions: Array<{ property: string; subject: string; object: string }>;
  sameIndividuals: Map<string, Set<string>>;
}

interface NumericInterval {
  min: number;
  max: number;
  minInclusive: boolean;
  maxInclusive: boolean;
  integerOnly: boolean;
}

const INTEGER_DATATYPES = new Set([
  "xsd:integer",
  "xsd:long",
  "xsd:int",
  "xsd:short",
  "xsd:byte",
  "xsd:nonNegativeInteger",
  "xsd:positiveInteger",
  "xsd:nonPositiveInteger",
  "xsd:negativeInteger",
  "xsd:unsignedLong",
  "xsd:unsignedInt",
  "xsd:unsignedShort",
  "xsd:unsignedByte",
]);

function createDefaultInterval(datatypeIri = "xsd:double"): NumericInterval {
  const shortDt = datatypeIri.includes("#") ? `xsd:${datatypeIri.split("#").pop()}` : datatypeIri;
  const integerOnly = INTEGER_DATATYPES.has(shortDt);
  let min = -Infinity;
  let max = Infinity;
  if (
    shortDt === "xsd:nonNegativeInteger" ||
    shortDt === "xsd:unsignedLong" ||
    shortDt === "xsd:unsignedInt" ||
    shortDt === "xsd:unsignedShort" ||
    shortDt === "xsd:unsignedByte"
  ) {
    min = 0;
  } else if (shortDt === "xsd:positiveInteger") {
    min = 1;
  } else if (shortDt === "xsd:nonPositiveInteger") {
    max = 0;
  } else if (shortDt === "xsd:negativeInteger") {
    max = -1;
  }
  return {
    min,
    max,
    minInclusive: true,
    maxInclusive: true,
    integerOnly,
  };
}

function intersectIntervalWithRange(base: NumericInterval, range: DataRangeSpec): NumericInterval {
  const dtInit = createDefaultInterval(range.datatypeIri);
  let min = Math.max(base.min, dtInit.min);
  let max = Math.min(base.max, dtInit.max);
  let minInc = base.minInclusive;
  let maxInc = base.maxInclusive;
  const integerOnly = base.integerOnly || dtInit.integerOnly;

  for (const f of range.facets) {
    if (f.facet === "minInclusive") {
      if (f.value > min) {
        min = f.value;
        minInc = true;
      }
    } else if (f.facet === "minExclusive") {
      if (f.value > min || (f.value === min && minInc)) {
        min = f.value;
        minInc = false;
      }
    } else if (f.facet === "maxInclusive") {
      if (f.value < max) {
        max = f.value;
        maxInc = true;
      }
    } else if (f.facet === "maxExclusive") {
      if (f.value < max || (f.value === max && maxInc)) {
        max = f.value;
        maxInc = false;
      }
    }
  }

  return { min, max, minInclusive: minInc, maxInclusive: maxInc, integerOnly };
}

function isIntervalSatisfiable(iv: NumericInterval): boolean {
  if (iv.min > iv.max) return false;
  if (iv.min === iv.max && (!iv.minInclusive || !iv.maxInclusive)) return false;
  if (iv.integerOnly) {
    const lowInt = iv.minInclusive ? Math.ceil(iv.min) : Math.floor(iv.min) + 1;
    const highInt = iv.maxInclusive ? Math.floor(iv.max) : Math.ceil(iv.max) - 1;
    if (lowInt > highInt) return false;
  }
  return true;
}

function valueSatisfiesInterval(val: number, iv: NumericInterval): boolean {
  if (Number.isNaN(val)) return false;
  if (iv.integerOnly && !Number.isInteger(val)) return false;
  if (val < iv.min || (val === iv.min && !iv.minInclusive)) return false;
  if (val > iv.max || (val === iv.max && !iv.maxInclusive)) return false;
  return true;
}

// ── Functional-Style Syntax S-Expression Parser for SROIQ(D) ─────────────────

interface SExprNode {
  head: string;
  args: (string | SExprNode)[];
}

function tokenizeOwlFunctional(source: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  const n = source.length;
  while (i < n) {
    const ch = source[i]!;
    if (/\s/.test(ch)) {
      i++;
      continue;
    }
    if (ch === "#" || (ch === "/" && source[i + 1] === "/")) {
      while (i < n && source[i] !== "\n") i++;
      continue;
    }
    if (ch === "(" || ch === ")" || ch === "=") {
      tokens.push(ch);
      i++;
      continue;
    }
    if (ch === '"') {
      const start = i;
      i++;
      while (i < n && source[i] !== '"') {
        if (source[i] === "\\") i++;
        i++;
      }
      if (i < n) i++;
      // Optional ^^datatype or @lang suffix
      while (i < n && !/\s|[()=]/.test(source[i]!)) {
        if (source[i] === "<") {
          while (i < n && source[i] !== ">") i++;
          if (i < n) i++;
        } else {
          i++;
        }
      }
      tokens.push(source.slice(start, i));
      continue;
    }
    if (ch === "<") {
      const start = i;
      while (i < n && source[i] !== ">") i++;
      if (i < n) i++;
      tokens.push(source.slice(start, i));
      continue;
    }
    const start = i;
    while (i < n && !/\s|[()=]/.test(source[i]!)) i++;
    tokens.push(source.slice(start, i));
  }
  return tokens;
}

function parseSExprList(tokens: string[]): SExprNode[] {
  let pos = 0;

  function parseOne(): string | SExprNode {
    const tok = tokens[pos]!;
    if (pos + 1 < tokens.length && tokens[pos + 1] === "(") {
      const head = tok;
      pos += 2; // consume head and '('
      const args: (string | SExprNode)[] = [];
      while (pos < tokens.length && tokens[pos] !== ")") {
        if (tokens[pos] === "=") {
          pos++;
          continue;
        }
        args.push(parseOne());
      }
      if (pos < tokens.length && tokens[pos] === ")") pos++;
      return { head, args };
    }
    pos++;
    return tok;
  }

  const out: SExprNode[] = [];
  while (pos < tokens.length) {
    const item = parseOne();
    if (typeof item !== "string") out.push(item);
  }
  return out;
}

function parseNumericLiteral(raw: string): number | null {
  const m = raw.match(/^"?([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?)"?/);
  if (!m) return null;
  const v = Number(m[1]);
  return Number.isNaN(v) ? null : v;
}

function stripLiteralValue(raw: string): string {
  const m = raw.match(/^"([^"]*)"/);
  return m ? m[1]! : raw.trim();
}

function normalizeFacetKind(rawFacet: string): FacetKind | null {
  const lower = rawFacet.toLowerCase();
  if (lower.endsWith("mininclusive")) return "minInclusive";
  if (lower.endsWith("maxinclusive")) return "maxInclusive";
  if (lower.endsWith("minexclusive")) return "minExclusive";
  if (lower.endsWith("maxexclusive")) return "maxExclusive";
  return null;
}

function exprKey(expr: TableauClassExpr): string {
  switch (expr.kind) {
    case "NamedClass":
      return `C:${expr.iri}`;
    case "ObjectComplementOf":
      return `NOT(${exprKey(expr.operand)})`;
    case "ObjectIntersectionOf":
      return `AND(${expr.operands.map(exprKey).sort().join(",")})`;
    case "ObjectUnionOf":
      return `OR(${expr.operands.map(exprKey).sort().join(",")})`;
    case "ObjectOneOf":
      return `ONEOF(${[...expr.individuals].sort().join(",")})`;
    case "ObjectSomeValuesFrom":
      return `SOME(${expr.property},${exprKey(expr.filler)})`;
    case "ObjectAllValuesFrom":
      return `ALL(${expr.property},${exprKey(expr.filler)})`;
    case "ObjectHasValue":
      return `HASVAL(${expr.property},${expr.individual})`;
    case "ObjectHasSelf":
      return `SELF(${expr.property})`;
    case "ObjectCardinality":
      return `CARD(${expr.cardType},${expr.count},${expr.property},${exprKey(expr.filler)})`;
    case "DataSomeValuesFrom":
      return `DSOME(${expr.property},${expr.range.datatypeIri}:${expr.range.facets.map((f) => `${f.facet}=${f.value}`).join(",")})`;
    case "DataAllValuesFrom":
      return `DALL(${expr.property},${expr.range.datatypeIri}:${expr.range.facets.map((f) => `${f.facet}=${f.value}`).join(",")})`;
    case "DataHasValue":
      return `DHAS(${expr.property},${expr.value})`;
  }
}

function negateClassExpr(expr: TableauClassExpr): TableauClassExpr {
  if (expr.kind === "ObjectComplementOf") return expr.operand;
  if (expr.kind === "NamedClass") {
    if (expr.iri === "owl:Thing") return { kind: "NamedClass", iri: "owl:Nothing" };
    if (expr.iri === "owl:Nothing") return { kind: "NamedClass", iri: "owl:Thing" };
  }
  return { kind: "ObjectComplementOf", operand: expr };
}

// ── Tableau Completion Graph State (Cloned on Nondeterministic Branches) ─────

interface TableauState {
  individuals: Set<string>;
  nominalIndividuals: Set<string>;
  /** Canonical representative mapping for merged individuals (`SameIndividual` / nominal / max-cardinality merge). */
  repOf: Map<string, string>;
  /** Explicit inequality pairs (`DifferentIndividuals` and $\ge n$ generated successors). */
  differentPairs: Set<string>;
  /** Map from canonical individual ID to set of `exprKey(expr)` strings. */
  conceptsByInd: Map<string, Map<string, TableauClassExpr>>;
  /** Role edges `property -> Set<"subj|obj">`. */
  roleEdges: Map<string, Set<string>>;
  /** Negative role assertions `property -> Set<"subj|obj">`. */
  negRoleEdges: Map<string, Set<string>>;
  /** Data property literal assertions `ind|prop -> Set<string>`. */
  dataLiterals: Map<string, Set<string>>;
  /** Negative data property literal assertions `ind|prop -> Set<string>`. */
  negDataLiterals: Map<string, Set<string>>;
  /** Data property numeric intervals `ind|prop -> NumericInterval`. */
  dataIntervals: Map<string, NumericInterval>;
  /** Applied existential/min-cardinality witness keys to prevent infinite re-application. */
  appliedWitnesses: Set<string>;
  /** Applied choice keys `(ind|prop|fillerKey|targetInd)`. */
  appliedChoices: Set<string>;
  nextAnonId: number;
}

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

function cloneState(st: TableauState): TableauState {
  const conceptsByInd = new Map<string, Map<string, TableauClassExpr>>();
  for (const [k, m] of st.conceptsByInd) {
    conceptsByInd.set(k, new Map(m));
  }
  const roleEdges = new Map<string, Set<string>>();
  for (const [k, s] of st.roleEdges) {
    roleEdges.set(k, new Set(s));
  }
  const negRoleEdges = new Map<string, Set<string>>();
  for (const [k, s] of st.negRoleEdges) {
    negRoleEdges.set(k, new Set(s));
  }
  const dataLiterals = new Map<string, Set<string>>();
  for (const [k, s] of st.dataLiterals) {
    dataLiterals.set(k, new Set(s));
  }
  const negDataLiterals = new Map<string, Set<string>>();
  for (const [k, s] of st.negDataLiterals) {
    negDataLiterals.set(k, new Set(s));
  }
  const dataIntervals = new Map<string, NumericInterval>();
  for (const [k, iv] of st.dataIntervals) {
    dataIntervals.set(k, { ...iv });
  }
  return {
    individuals: new Set(st.individuals),
    nominalIndividuals: new Set(st.nominalIndividuals),
    repOf: new Map(st.repOf),
    differentPairs: new Set(st.differentPairs),
    conceptsByInd,
    roleEdges,
    negRoleEdges,
    dataLiterals,
    negDataLiterals,
    dataIntervals,
    appliedWitnesses: new Set(st.appliedWitnesses),
    appliedChoices: new Set(st.appliedChoices),
    nextAnonId: st.nextAnonId,
  };
}

// ── Owl2TableauReasoner ──────────────────────────────────────────────────────

/**
 * $\mathcal{SROIQ}(D)$ Tableau Reasoner supporting:
 * - Nominals (`ObjectOneOf`, `ObjectHasValue`)
 * - Qualified Cardinality Restrictions (`ObjectMinCardinality`, `ObjectMaxCardinality`, `ObjectExactCardinality`)
 * - Transitive roles & sub-property chains (`TransitiveObjectProperty`, `SubObjectPropertyOf(ObjectPropertyChain(...))`)
 * - Numeric datatype facet restrictions (`DatatypeRestriction` with `xsd:minInclusive`, `xsd:maxInclusive`, `xsd:minExclusive`, `xsd:maxExclusive`)
 */
interface TableauAxiomInput {
  type?: string;
  iri?: unknown;
  intersectionOf?: unknown[];
  unionOf?: unknown[];
  complementOf?: unknown;
  someValuesFrom?: { propertyIri?: unknown; fillerClassIri?: unknown };
  allValuesFrom?: { propertyIri?: unknown; targetClassIri?: unknown };
  subClassIri?: unknown;
  superClassIri?: unknown;
  classIris?: unknown[];
  unionEquiv?: boolean;
  propertyIri?: unknown;
  fillerClassIri?: unknown;
  isNominal?: boolean;
  classIri?: unknown;
  individualIri?: unknown;
  targetClassIri?: unknown;
  fillerDatatypeIri?: unknown;
  datatypeIri?: unknown;
  facets?: NumericFacetRestriction[];
  value?: unknown;
  individualIris?: unknown[];
  cardinalityType?: string;
  count?: unknown;
  subPropertyIri?: unknown;
  superPropertyIri?: unknown;
  propertyChainIris?: unknown[];
  inversePropertyIri?: unknown;
  propertyIris?: unknown[];
  domainIri?: unknown;
  rangeIri?: unknown;
  subjectIri?: unknown;
  objectIri?: unknown;
}

export class Owl2TableauReasoner {
  private prefixes = new Map<string, string>(BUILTIN_OWL2_PREFIXES);
  public classes = new Set<string>(["owl:Thing", "owl:Nothing"]);
  public objectProperties = new Set<string>();
  public dataProperties = new Set<string>();
  public namedIndividuals = new Set<string>();

  public subClassAxioms: TableauSubClassAxiom[] = [];
  public disjointClassSets: TableauClassExpr[][] = [];
  public subObjectProperties: Array<{ sub: string; sup: string }> = [];
  public subDataProperties: Array<{ sub: string; sup: string }> = [];
  public propertyChains: PropertyChainAxiom[] = [];
  public inverseProperties: Array<{ p1: string; p2: string }> = [];
  public transitiveProperties = new Set<string>();
  public symmetricProperties = new Set<string>();
  public asymmetricProperties = new Set<string>();
  public reflexiveProperties = new Set<string>();
  public irreflexiveProperties = new Set<string>();
  public functionalObjectProperties = new Set<string>();
  public inverseFunctionalObjectProperties = new Set<string>();
  public functionalDataProperties = new Set<string>();
  public disjointObjectPropertySets: string[][] = [];
  public objectPropertyDomains = new Map<string, TableauClassExpr[]>();
  public objectPropertyRanges = new Map<string, TableauClassExpr[]>();
  public dataPropertyDomains = new Map<string, TableauClassExpr[]>();
  public dataPropertyRanges = new Map<string, DataRangeSpec[]>();

  public classAssertions: Array<{ individual: string; concept: TableauClassExpr }> = [];
  public roleAssertions: Array<{ property: string; subject: string; object: string }> = [];
  public negRoleAssertions: Array<{ property: string; subject: string; object: string }> = [];
  public dataAssertions: Array<{ property: string; subject: string; value: string }> = [];
  public negDataAssertions: Array<{ property: string; subject: string; value: string }> = [];
  public sameIndividualSets: string[][] = [];
  public differentIndividualSets: string[][] = [];

  constructor(initialSourceOrAxioms?: string | OWL2Axiom[]) {
    if (typeof initialSourceOrAxioms === "string") {
      this.loadSource(initialSourceOrAxioms);
    } else if (Array.isArray(initialSourceOrAxioms)) {
      this.addAxioms(initialSourceOrAxioms);
    }
  }

  private normIri(raw: string): string {
    const clean = raw.trim();
    if (clean.startsWith("<") && clean.endsWith(">")) {
      const inner = clean.slice(1, -1);
      for (const [pref, base] of this.prefixes) {
        if (inner.startsWith(base) && inner.length > base.length) {
          return `${pref}${inner.slice(base.length)}`;
        }
      }
      return inner;
    }
    return clean;
  }

  private addNamedClass(iri: string): void {
    if (iri && !iri.startsWith("__aux_") && !iri.startsWith("_:")) {
      this.classes.add(iri);
    }
  }

  /**
   * Parses OWL 2 Functional-Style Syntax (`.ofn`), Turtle (`.ttl`), or OWL/XML / RDF/XML (`.owx` / `.owl`)
   * text directly into the $\mathcal{SROIQ}(D)$ knowledge base.
   */
  public loadSource(source: string): void {
    const format = detectOwl2Format(source);
    if (format === "ttl") {
      this.addAxioms(parseTurtleToOwl2Axioms(source));
      return;
    }
    if (format === "owx") {
      this.addAxioms(parseOwlXmlToAxioms(source));
      return;
    }
    const tokens = tokenizeOwlFunctional(source);
    const sexprs = parseSExprList(tokens);
    for (const node of sexprs) {
      this.processSExpr(node);
    }
  }

  private processSExpr(node: SExprNode): void {
    const head = node.head;
    if (head === "Prefix") {
      if (node.args.length >= 2) {
        const pref = String(node.args[0]);
        const rawBase = String(node.args[1]);
        const base = rawBase.startsWith("<") && rawBase.endsWith(">") ? rawBase.slice(1, -1) : rawBase;
        this.prefixes.set(pref.endsWith(":") ? pref : `${pref}:`, base);
      }
      return;
    }
    if (head === "Ontology") {
      for (const arg of node.args) {
        if (typeof arg !== "string") this.processSExpr(arg);
      }
      return;
    }
    if (head === "Declaration") {
      const inner = node.args.find((a): a is SExprNode => typeof a !== "string");
      if (inner && inner.args.length >= 1) {
        const iri = this.normIri(String(inner.args[0]));
        if (inner.head === "Class") this.classes.add(iri);
        else if (inner.head === "ObjectProperty") this.objectProperties.add(iri);
        else if (inner.head === "DataProperty") this.dataProperties.add(iri);
        else if (inner.head === "NamedIndividual") this.namedIndividuals.add(iri);
      }
      return;
    }
    if (head === "SubClassOf" && node.args.length >= 2) {
      const sub = this.parseClassExpr(node.args[node.args.length - 2]!);
      const sup = this.parseClassExpr(node.args[node.args.length - 1]!);
      this.subClassAxioms.push({ sub, sup });
      return;
    }
    if (head === "EquivalentClasses" && node.args.length >= 2) {
      const exprs = node.args.map((a) => this.parseClassExpr(a));
      for (let i = 0; i < exprs.length; i++) {
        for (let j = 0; j < exprs.length; j++) {
          if (i !== j) {
            this.subClassAxioms.push({ sub: exprs[i]!, sup: exprs[j]! });
          }
        }
      }
      return;
    }
    if (head === "DisjointClasses" && node.args.length >= 2) {
      this.disjointClassSets.push(node.args.map((a) => this.parseClassExpr(a)));
      return;
    }
    if (head === "DisjointUnion" && node.args.length >= 2) {
      const target = this.parseClassExpr(node.args[0]!);
      const parts = node.args.slice(1).map((a) => this.parseClassExpr(a));
      this.disjointClassSets.push(parts);
      this.subClassAxioms.push({ sub: target, sup: { kind: "ObjectUnionOf", operands: parts } });
      for (const p of parts) {
        this.subClassAxioms.push({ sub: p, sup: target });
      }
      return;
    }
    if (head === "SubObjectPropertyOf" && node.args.length >= 2) {
      const first = node.args[node.args.length - 2]!;
      const second = node.args[node.args.length - 1]!;
      const supProp = this.normIri(typeof second === "string" ? second : String(second.args[0] ?? ""));
      this.objectProperties.add(supProp);
      if (typeof first !== "string" && first.head === "ObjectPropertyChain") {
        const chain = first.args.map((a) => this.normIri(String(a)));
        for (const p of chain) this.objectProperties.add(p);
        this.propertyChains.push({ chain, superProperty: supProp });
      } else {
        const subProp = this.normIri(typeof first === "string" ? first : String(first.args[0] ?? ""));
        this.objectProperties.add(subProp);
        this.subObjectProperties.push({ sub: subProp, sup: supProp });
      }
      return;
    }
    if (head === "EquivalentObjectProperties" && node.args.length >= 2) {
      const props = node.args.map((a) => this.normIri(String(a)));
      for (let i = 0; i < props.length; i++) {
        this.objectProperties.add(props[i]!);
        for (let j = 0; j < props.length; j++) {
          if (i !== j) this.subObjectProperties.push({ sub: props[i]!, sup: props[j]! });
        }
      }
      return;
    }
    if (head === "SubDataPropertyOf" && node.args.length >= 2) {
      const sub = this.normIri(String(node.args[0]));
      const sup = this.normIri(String(node.args[1]));
      this.dataProperties.add(sub);
      this.dataProperties.add(sup);
      this.subDataProperties.push({ sub, sup });
      return;
    }
    if (head === "InverseObjectProperties" && node.args.length >= 2) {
      const p1 = this.normIri(String(node.args[0]));
      const p2 = this.normIri(String(node.args[1]));
      this.objectProperties.add(p1);
      this.objectProperties.add(p2);
      this.inverseProperties.push({ p1, p2 });
      return;
    }
    if (head === "TransitiveObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.transitiveProperties.add(p);
      return;
    }
    if (head === "SymmetricObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.symmetricProperties.add(p);
      return;
    }
    if (head === "AsymmetricObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.asymmetricProperties.add(p);
      return;
    }
    if (head === "ReflexiveObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.reflexiveProperties.add(p);
      return;
    }
    if (head === "IrreflexiveObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.irreflexiveProperties.add(p);
      return;
    }
    if (head === "FunctionalObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.functionalObjectProperties.add(p);
      return;
    }
    if (head === "InverseFunctionalObjectProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.objectProperties.add(p);
      this.inverseFunctionalObjectProperties.add(p);
      return;
    }
    if (head === "FunctionalDataProperty" && node.args.length >= 1) {
      const p = this.normIri(String(node.args[0]));
      this.dataProperties.add(p);
      this.functionalDataProperties.add(p);
      return;
    }
    if (head === "DisjointObjectProperties" && node.args.length >= 2) {
      const props = node.args.map((a) => this.normIri(String(a)));
      for (const p of props) this.objectProperties.add(p);
      this.disjointObjectPropertySets.push(props);
      return;
    }
    if (head === "ObjectPropertyDomain" && node.args.length >= 2) {
      const p = this.normIri(String(node.args[0]));
      const dom = this.parseClassExpr(node.args[1]!);
      this.objectProperties.add(p);
      const list = this.objectPropertyDomains.get(p) ?? [];
      list.push(dom);
      this.objectPropertyDomains.set(p, list);
      return;
    }
    if (head === "ObjectPropertyRange" && node.args.length >= 2) {
      const p = this.normIri(String(node.args[0]));
      const rng = this.parseClassExpr(node.args[1]!);
      this.objectProperties.add(p);
      const list = this.objectPropertyRanges.get(p) ?? [];
      list.push(rng);
      this.objectPropertyRanges.set(p, list);
      return;
    }
    if (head === "DataPropertyDomain" && node.args.length >= 2) {
      const p = this.normIri(String(node.args[0]));
      const dom = this.parseClassExpr(node.args[1]!);
      this.dataProperties.add(p);
      const list = this.dataPropertyDomains.get(p) ?? [];
      list.push(dom);
      this.dataPropertyDomains.set(p, list);
      return;
    }
    if (head === "DataPropertyRange" && node.args.length >= 2) {
      const p = this.normIri(String(node.args[0]));
      const rng = this.parseDataRange(node.args[1]!);
      this.dataProperties.add(p);
      const list = this.dataPropertyRanges.get(p) ?? [];
      list.push(rng);
      this.dataPropertyRanges.set(p, list);
      return;
    }
    if (head === "ClassAssertion" && node.args.length >= 2) {
      const concept = this.parseClassExpr(node.args[node.args.length - 2]!);
      const ind = this.normIri(String(node.args[node.args.length - 1]));
      this.namedIndividuals.add(ind);
      this.classAssertions.push({ individual: ind, concept });
      return;
    }
    if (head === "ObjectPropertyAssertion" && node.args.length >= 3) {
      const prop = this.normIri(String(node.args[0]));
      const subj = this.normIri(String(node.args[1]));
      const obj = this.normIri(String(node.args[2]));
      this.objectProperties.add(prop);
      this.namedIndividuals.add(subj);
      this.namedIndividuals.add(obj);
      this.roleAssertions.push({ property: prop, subject: subj, object: obj });
      return;
    }
    if (head === "NegativeObjectPropertyAssertion" && node.args.length >= 3) {
      const prop = this.normIri(String(node.args[0]));
      const subj = this.normIri(String(node.args[1]));
      const obj = this.normIri(String(node.args[2]));
      this.objectProperties.add(prop);
      this.namedIndividuals.add(subj);
      this.namedIndividuals.add(obj);
      this.negRoleAssertions.push({ property: prop, subject: subj, object: obj });
      return;
    }
    if (head === "DataPropertyAssertion" && node.args.length >= 3) {
      const prop = this.normIri(String(node.args[0]));
      const subj = this.normIri(String(node.args[1]));
      const val = stripLiteralValue(String(node.args[2]));
      this.dataProperties.add(prop);
      this.namedIndividuals.add(subj);
      this.dataAssertions.push({ property: prop, subject: subj, value: val });
      return;
    }
    if (head === "NegativeDataPropertyAssertion" && node.args.length >= 3) {
      const prop = this.normIri(String(node.args[0]));
      const subj = this.normIri(String(node.args[1]));
      const val = stripLiteralValue(String(node.args[2]));
      this.dataProperties.add(prop);
      this.namedIndividuals.add(subj);
      this.negDataAssertions.push({ property: prop, subject: subj, value: val });
      return;
    }
    if (head === "SameIndividual" && node.args.length >= 2) {
      const inds = node.args.map((a) => this.normIri(String(a)));
      for (const i of inds) this.namedIndividuals.add(i);
      this.sameIndividualSets.push(inds);
      return;
    }
    if (head === "DifferentIndividuals" && node.args.length >= 2) {
      const inds = node.args.map((a) => this.normIri(String(a)));
      for (const i of inds) this.namedIndividuals.add(i);
      this.differentIndividualSets.push(inds);
      return;
    }
  }

  private parseDataRange(raw: string | SExprNode): DataRangeSpec {
    if (typeof raw === "string") {
      return { datatypeIri: this.normIri(raw), facets: [] };
    }
    if (raw.head === "DatatypeRestriction" && raw.args.length >= 1) {
      const datatypeIri = this.normIri(String(raw.args[0]));
      const facets: NumericFacetRestriction[] = [];
      for (let i = 1; i + 1 < raw.args.length; i += 2) {
        const facetName = normalizeFacetKind(this.normIri(String(raw.args[i])));
        const numVal = parseNumericLiteral(String(raw.args[i + 1]));
        if (facetName && numVal !== null) {
          facets.push({ facet: facetName, value: numVal });
        }
      }
      return { datatypeIri, facets };
    }
    if (raw.head === "DataIntersectionOf") {
      const subRanges = raw.args.map((a) => this.parseDataRange(a));
      return {
        datatypeIri: subRanges[0]?.datatypeIri ?? "xsd:double",
        facets: subRanges.flatMap((r) => r.facets),
      };
    }
    return { datatypeIri: "xsd:double", facets: [] };
  }

  private parseClassExpr(raw: string | SExprNode): TableauClassExpr {
    if (typeof raw === "string") {
      const iri = this.normIri(raw);
      this.classes.add(iri);
      return { kind: "NamedClass", iri };
    }
    const h = raw.head;
    if (h === "ObjectIntersectionOf") {
      return { kind: "ObjectIntersectionOf", operands: raw.args.map((a) => this.parseClassExpr(a)) };
    }
    if (h === "ObjectUnionOf") {
      return { kind: "ObjectUnionOf", operands: raw.args.map((a) => this.parseClassExpr(a)) };
    }
    if (h === "ObjectComplementOf" && raw.args.length >= 1) {
      return { kind: "ObjectComplementOf", operand: this.parseClassExpr(raw.args[0]!) };
    }
    if (h === "ObjectOneOf") {
      const inds = raw.args.map((a) => this.normIri(String(a)));
      for (const ind of inds) this.namedIndividuals.add(ind);
      return { kind: "ObjectOneOf", individuals: inds };
    }
    if (h === "ObjectSomeValuesFrom" && raw.args.length >= 2) {
      const prop = this.normIri(String(raw.args[0]));
      this.objectProperties.add(prop);
      return { kind: "ObjectSomeValuesFrom", property: prop, filler: this.parseClassExpr(raw.args[1]!) };
    }
    if (h === "ObjectAllValuesFrom" && raw.args.length >= 2) {
      const prop = this.normIri(String(raw.args[0]));
      this.objectProperties.add(prop);
      return { kind: "ObjectAllValuesFrom", property: prop, filler: this.parseClassExpr(raw.args[1]!) };
    }
    if (h === "ObjectHasValue" && raw.args.length >= 2) {
      const prop = this.normIri(String(raw.args[0]));
      const ind = this.normIri(String(raw.args[1]));
      this.objectProperties.add(prop);
      this.namedIndividuals.add(ind);
      return { kind: "ObjectHasValue", property: prop, individual: ind };
    }
    if (h === "ObjectHasSelf" && raw.args.length >= 1) {
      const prop = this.normIri(String(raw.args[0]));
      this.objectProperties.add(prop);
      return { kind: "ObjectHasSelf", property: prop };
    }
    if (
      (h === "ObjectMinCardinality" || h === "ObjectMaxCardinality" || h === "ObjectExactCardinality") &&
      raw.args.length >= 2
    ) {
      const cardType = h === "ObjectMinCardinality" ? "min" : h === "ObjectMaxCardinality" ? "max" : "exact";
      const count = Math.max(0, parseInt(String(raw.args[0]), 10) || 0);
      const prop = this.normIri(String(raw.args[1]));
      this.objectProperties.add(prop);
      const filler: TableauClassExpr =
        raw.args.length >= 3 ? this.parseClassExpr(raw.args[2]!) : { kind: "NamedClass", iri: "owl:Thing" };
      return { kind: "ObjectCardinality", cardType, count, property: prop, filler };
    }
    if (h === "DataSomeValuesFrom" && raw.args.length >= 2) {
      const prop = this.normIri(String(raw.args[0]));
      this.dataProperties.add(prop);
      return {
        kind: "DataSomeValuesFrom",
        property: prop,
        range: this.parseDataRange(raw.args[raw.args.length - 1]!),
      };
    }
    if (h === "DataAllValuesFrom" && raw.args.length >= 2) {
      const prop = this.normIri(String(raw.args[0]));
      this.dataProperties.add(prop);
      return {
        kind: "DataAllValuesFrom",
        property: prop,
        range: this.parseDataRange(raw.args[raw.args.length - 1]!),
      };
    }
    if (h === "DataHasValue" && raw.args.length >= 2) {
      const prop = this.normIri(String(raw.args[0]));
      this.dataProperties.add(prop);
      const lit = stripLiteralValue(String(raw.args[1]));
      return { kind: "DataHasValue", property: prop, value: lit };
    }
    const fallbackIri = this.normIri(h);
    this.classes.add(fallbackIri);
    return { kind: "NamedClass", iri: fallbackIri };
  }

  /**
   * Loads lowered `OWL2Axiom` objects from `lowerCstToAxioms` into the tableau reasoner.
   */
  public addAxioms(axioms: readonly OWL2Axiom[]): void {
    for (const ax of axioms) {
      this.addAxiom(ax);
    }
  }

  public addAxiom(ax: OWL2Axiom | Record<string, unknown>): void {
    const t = String((ax as { type?: string }).type ?? "");
    const a = ax as TableauAxiomInput;
    switch (t) {
      case "ClassDeclaration": {
        const iri = String(a.iri);
        this.addNamedClass(iri);
        if (Array.isArray(a.intersectionOf) && a.intersectionOf.length >= 1) {
          const opIris: string[] = a.intersectionOf.map(String);
          for (const op of opIris) this.addNamedClass(op);
          this.subClassAxioms.push({
            sub: {
              kind: "ObjectIntersectionOf",
              operands: opIris.map((op) => ({ kind: "NamedClass", iri: op })),
            },
            sup: { kind: "NamedClass", iri },
          });
        }
        if (Array.isArray(a.unionOf) && a.unionOf.length >= 1) {
          const opIris: string[] = a.unionOf.map(String);
          for (const op of opIris) this.addNamedClass(op);
          this.subClassAxioms.push({
            sub: { kind: "NamedClass", iri },
            sup: {
              kind: "ObjectUnionOf",
              operands: opIris.map((op) => ({ kind: "NamedClass", iri: op })),
            },
          });
        }
        if (typeof a.complementOf === "string" && a.complementOf) {
          const opIri = String(a.complementOf);
          this.addNamedClass(opIri);
          this.subClassAxioms.push({
            sub: { kind: "NamedClass", iri },
            sup: { kind: "ObjectComplementOf", operand: { kind: "NamedClass", iri: opIri } },
          });
          this.subClassAxioms.push({
            sub: { kind: "ObjectComplementOf", operand: { kind: "NamedClass", iri: opIri } },
            sup: { kind: "NamedClass", iri },
          });
        }
        if (a.someValuesFrom && typeof a.someValuesFrom === "object") {
          const svf = a.someValuesFrom;
          const propIri = String(svf.propertyIri);
          const fillerIri = String(svf.fillerClassIri ?? "owl:Thing");
          this.objectProperties.add(propIri);
          this.addNamedClass(fillerIri);
          this.subClassAxioms.push({
            sub: {
              kind: "ObjectSomeValuesFrom",
              property: propIri,
              filler: { kind: "NamedClass", iri: fillerIri },
            },
            sup: { kind: "NamedClass", iri },
          });
        }
        if (a.allValuesFrom && typeof a.allValuesFrom === "object") {
          const avf = a.allValuesFrom;
          const propIri = String(avf.propertyIri);
          const fillerIri = String(avf.targetClassIri ?? "owl:Thing");
          this.objectProperties.add(propIri);
          this.addNamedClass(fillerIri);
          this.subClassAxioms.push({
            sub: {
              kind: "ObjectAllValuesFrom",
              property: propIri,
              filler: { kind: "NamedClass", iri: fillerIri },
            },
            sup: { kind: "NamedClass", iri },
          });
        }
        break;
      }
      case "ObjectPropertyDeclaration":
        this.objectProperties.add(String(a.iri));
        break;
      case "DataPropertyDeclaration":
        this.dataProperties.add(String(a.iri));
        break;
      case "IndividualDeclaration":
        this.namedIndividuals.add(String(a.iri));
        break;
      case "SubClassOf": {
        const subIri = String(a.subClassIri);
        const supIri = String(a.superClassIri);
        this.addNamedClass(subIri);
        this.addNamedClass(supIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: { kind: "NamedClass", iri: supIri },
        });
        break;
      }
      case "EquivalentClasses": {
        const iris: string[] = Array.isArray(a.classIris) ? a.classIris.map(String) : [];
        for (const iri of iris) this.addNamedClass(iri);
        for (let i = 0; i < iris.length; i++) {
          for (let j = 0; j < iris.length; j++) {
            if (i !== j) {
              this.subClassAxioms.push({
                sub: { kind: "NamedClass", iri: iris[i]! },
                sup: { kind: "NamedClass", iri: iris[j]! },
              });
            }
          }
        }
        break;
      }
      case "DisjointClasses": {
        const iris: string[] = Array.isArray(a.classIris) ? a.classIris.map(String) : [];
        for (const iri of iris) this.addNamedClass(iri);
        this.disjointClassSets.push(iris.map((iri) => ({ kind: "NamedClass", iri })));
        break;
      }
      case "DisjunctiveClass": {
        const supIri = String(a.superClassIri);
        const iris: string[] = Array.isArray(a.classIris) ? a.classIris.map(String) : [];
        this.addNamedClass(supIri);
        for (const iri of iris) {
          this.addNamedClass(iri);
          this.subClassAxioms.push({
            sub: { kind: "NamedClass", iri },
            sup: { kind: "NamedClass", iri: supIri },
          });
        }
        if (a.unionEquiv || supIri.startsWith("__aux_")) {
          this.subClassAxioms.push({
            sub: { kind: "NamedClass", iri: supIri },
            sup: {
              kind: "ObjectUnionOf",
              operands: iris.map((iri) => ({ kind: "NamedClass", iri })),
            },
          });
        }
        break;
      }
      case "ObjectSomeValuesFrom": {
        const subIri = String(a.subClassIri ?? "owl:Thing");
        const propIri = String(a.propertyIri);
        const fillerIri = String(a.fillerClassIri ?? "owl:Thing");
        this.addNamedClass(subIri);
        this.objectProperties.add(propIri);
        if (a.isNominal || this.namedIndividuals.has(fillerIri)) {
          this.namedIndividuals.add(fillerIri);
          this.subClassAxioms.push({
            sub: { kind: "NamedClass", iri: subIri },
            sup: { kind: "ObjectHasValue", property: propIri, individual: fillerIri },
          });
        } else {
          this.addNamedClass(fillerIri);
          this.subClassAxioms.push({
            sub: { kind: "NamedClass", iri: subIri },
            sup: {
              kind: "ObjectSomeValuesFrom",
              property: propIri,
              filler: { kind: "NamedClass", iri: fillerIri },
            },
          });
        }
        break;
      }
      case "ObjectHasValue": {
        const subIri = String(a.classIri ?? a.subClassIri ?? "owl:Thing");
        const propIri = String(a.propertyIri);
        const indIri = String(a.individualIri ?? a.fillerClassIri);
        this.addNamedClass(subIri);
        this.objectProperties.add(propIri);
        this.namedIndividuals.add(indIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: { kind: "ObjectHasValue", property: propIri, individual: indIri },
        });
        break;
      }
      case "UniversalRestriction": {
        const subIri = String(a.classIri);
        const propIri = String(a.propertyIri);
        const targetIri = String(a.targetClassIri);
        this.addNamedClass(subIri);
        this.addNamedClass(targetIri);
        this.objectProperties.add(propIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: {
            kind: "ObjectAllValuesFrom",
            property: propIri,
            filler: { kind: "NamedClass", iri: targetIri },
          },
        });
        break;
      }
      case "DataSomeValuesFrom": {
        const subIri = String(a.subClassIri ?? a.classIri ?? "owl:Thing");
        const propIri = String(a.propertyIri);
        const rangeIri = String(a.fillerDatatypeIri ?? a.datatypeIri ?? "xsd:double");
        this.addNamedClass(subIri);
        this.dataProperties.add(propIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: {
            kind: "DataSomeValuesFrom",
            property: propIri,
            range: { datatypeIri: rangeIri, facets: Array.isArray(a.facets) ? a.facets : [] },
          },
        });
        break;
      }
      case "DataAllValuesFrom": {
        const subIri = String(a.subClassIri ?? a.classIri ?? "owl:Thing");
        const propIri = String(a.propertyIri);
        const rangeIri = String(a.fillerDatatypeIri ?? a.datatypeIri ?? "xsd:double");
        this.addNamedClass(subIri);
        this.dataProperties.add(propIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: {
            kind: "DataAllValuesFrom",
            property: propIri,
            range: { datatypeIri: rangeIri, facets: Array.isArray(a.facets) ? a.facets : [] },
          },
        });
        break;
      }
      case "DataHasValue": {
        const subIri = String(a.classIri ?? a.subClassIri ?? "owl:Thing");
        const propIri = String(a.propertyIri);
        const val = String(a.value ?? "");
        this.addNamedClass(subIri);
        this.dataProperties.add(propIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: { kind: "DataHasValue", property: propIri, value: val },
        });
        break;
      }
      case "SelfRestriction": {
        const subIri = String(a.classIri);
        const propIri = String(a.propertyIri);
        this.addNamedClass(subIri);
        this.objectProperties.add(propIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: subIri },
          sup: { kind: "ObjectHasSelf", property: propIri },
        });
        break;
      }
      case "ObjectOneOf": {
        const clsIri = String(a.classIri);
        const inds: string[] = Array.isArray(a.individualIris) ? a.individualIris.map(String) : [];
        this.addNamedClass(clsIri);
        for (const ind of inds) this.namedIndividuals.add(ind);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: clsIri },
          sup: { kind: "ObjectOneOf", individuals: inds },
        });
        break;
      }
      case "QualifiedCardinality": {
        const clsIri = String(a.classIri);
        const propIri = String(a.propertyIri);
        const cardType: "min" | "max" | "exact" =
          a.cardinalityType === "max" ? "max" : a.cardinalityType === "exact" ? "exact" : "min";
        const count = Number(a.count ?? 1);
        const fillerIri = String(a.fillerClassIri ?? "owl:Thing");
        this.addNamedClass(clsIri);
        this.addNamedClass(fillerIri);
        this.objectProperties.add(propIri);
        this.subClassAxioms.push({
          sub: { kind: "NamedClass", iri: clsIri },
          sup: {
            kind: "ObjectCardinality",
            cardType,
            count,
            property: propIri,
            filler: { kind: "NamedClass", iri: fillerIri },
          },
        });
        break;
      }
      case "SubObjectPropertyOf": {
        const sub = String(a.subPropertyIri);
        const sup = String(a.superPropertyIri);
        this.objectProperties.add(sub);
        this.objectProperties.add(sup);
        this.subObjectProperties.push({ sub, sup });
        break;
      }
      case "SubObjectPropertyChainOf": {
        const chain: string[] = Array.isArray(a.propertyChainIris) ? a.propertyChainIris.map(String) : [];
        const sup = String(a.superPropertyIri);
        for (const p of chain) this.objectProperties.add(p);
        this.objectProperties.add(sup);
        if (chain.length >= 2) {
          this.propertyChains.push({ chain, superProperty: sup });
        }
        break;
      }
      case "TransitiveObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.transitiveProperties.add(String(a.propertyIri));
        break;
      case "SymmetricObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.symmetricProperties.add(String(a.propertyIri));
        break;
      case "AsymmetricObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.asymmetricProperties.add(String(a.propertyIri));
        break;
      case "ReflexiveObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.reflexiveProperties.add(String(a.propertyIri));
        break;
      case "IrreflexiveObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.irreflexiveProperties.add(String(a.propertyIri));
        break;
      case "FunctionalObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.functionalObjectProperties.add(String(a.propertyIri));
        break;
      case "InverseFunctionalObjectProperty":
        this.objectProperties.add(String(a.propertyIri));
        this.inverseFunctionalObjectProperties.add(String(a.propertyIri));
        break;
      case "FunctionalDataProperty":
        this.dataProperties.add(String(a.propertyIri));
        this.functionalDataProperties.add(String(a.propertyIri));
        break;
      case "InverseObjectProperty": {
        const p1 = String(a.propertyIri);
        const p2 = String(a.inversePropertyIri);
        this.objectProperties.add(p1);
        this.objectProperties.add(p2);
        this.inverseProperties.push({ p1, p2 });
        break;
      }
      case "DisjointObjectProperties": {
        const props: string[] = Array.isArray(a.propertyIris) ? a.propertyIris.map(String) : [];
        for (const p of props) this.objectProperties.add(p);
        this.disjointObjectPropertySets.push(props);
        break;
      }
      case "ObjectPropertyDomain": {
        const p = String(a.propertyIri);
        const dom = String(a.domainIri);
        this.objectProperties.add(p);
        this.addNamedClass(dom);
        const list = this.objectPropertyDomains.get(p) ?? [];
        list.push({ kind: "NamedClass", iri: dom });
        this.objectPropertyDomains.set(p, list);
        break;
      }
      case "ObjectPropertyRange": {
        const p = String(a.propertyIri);
        const rng = String(a.rangeIri);
        this.objectProperties.add(p);
        this.addNamedClass(rng);
        const list = this.objectPropertyRanges.get(p) ?? [];
        list.push({ kind: "NamedClass", iri: rng });
        this.objectPropertyRanges.set(p, list);
        break;
      }
      case "DataPropertyDomain": {
        const p = String(a.propertyIri);
        const dom = String(a.domainIri);
        this.dataProperties.add(p);
        this.addNamedClass(dom);
        const list = this.dataPropertyDomains.get(p) ?? [];
        list.push({ kind: "NamedClass", iri: dom });
        this.dataPropertyDomains.set(p, list);
        break;
      }
      case "DataPropertyRange": {
        const p = String(a.propertyIri);
        const rng = String(a.rangeIri);
        this.dataProperties.add(p);
        const list = this.dataPropertyRanges.get(p) ?? [];
        list.push({ datatypeIri: rng, facets: Array.isArray(a.facets) ? a.facets : [] });
        this.dataPropertyRanges.set(p, list);
        break;
      }
      case "ClassAssertion": {
        const clsIri = String(a.classIri);
        const indIri = String(a.individualIri);
        this.addNamedClass(clsIri);
        this.namedIndividuals.add(indIri);
        this.classAssertions.push({
          individual: indIri,
          concept: { kind: "NamedClass", iri: clsIri },
        });
        break;
      }
      case "ObjectPropertyAssertion": {
        const prop = String(a.propertyIri);
        const subj = String(a.subjectIri);
        const obj = String(a.objectIri);
        this.objectProperties.add(prop);
        this.namedIndividuals.add(subj);
        this.namedIndividuals.add(obj);
        this.roleAssertions.push({ property: prop, subject: subj, object: obj });
        break;
      }
      case "NegativeObjectPropertyAssertion": {
        const prop = String(a.propertyIri);
        const subj = String(a.subjectIri);
        const obj = String(a.objectIri);
        this.objectProperties.add(prop);
        this.namedIndividuals.add(subj);
        this.namedIndividuals.add(obj);
        this.negRoleAssertions.push({ property: prop, subject: subj, object: obj });
        break;
      }
      case "DataPropertyAssertion": {
        const prop = String(a.propertyIri);
        const subj = String(a.subjectIri);
        const val = String(a.value ?? "");
        this.dataProperties.add(prop);
        this.namedIndividuals.add(subj);
        this.dataAssertions.push({ property: prop, subject: subj, value: val });
        break;
      }
      case "NegativeDataPropertyAssertion": {
        const prop = String(a.propertyIri);
        const subj = String(a.subjectIri);
        const val = String(a.value ?? "");
        this.dataProperties.add(prop);
        this.namedIndividuals.add(subj);
        this.negDataAssertions.push({ property: prop, subject: subj, value: val });
        break;
      }
      case "SameIndividual": {
        const inds: string[] = Array.isArray(a.individualIris) ? a.individualIris.map(String) : [];
        for (const i of inds) this.namedIndividuals.add(i);
        this.sameIndividualSets.push(inds);
        break;
      }
      case "DifferentIndividuals": {
        const inds: string[] = Array.isArray(a.individualIris) ? a.individualIris.map(String) : [];
        for (const i of inds) this.namedIndividuals.add(i);
        this.differentIndividualSets.push(inds);
        break;
      }
    }
  }

  // ── Core Tableau Expansion Engine ──────────────────────────────────────────

  private getRep(st: TableauState, ind: string): string {
    let curr = ind;
    while (st.repOf.has(curr) && st.repOf.get(curr)! !== curr) {
      curr = st.repOf.get(curr)!;
    }
    return curr;
  }

  private ensureIndividual(st: TableauState, ind: string, isNominal = false): string {
    const rep = this.getRep(st, ind);
    st.individuals.add(rep);
    if (isNominal) st.nominalIndividuals.add(rep);
    if (!st.conceptsByInd.has(rep)) {
      const m = new Map<string, TableauClassExpr>();
      const top: TableauClassExpr = { kind: "NamedClass", iri: "owl:Thing" };
      m.set(exprKey(top), top);
      st.conceptsByInd.set(rep, m);
    }
    return rep;
  }

  private addConcept(st: TableauState, ind: string, expr: TableauClassExpr): boolean {
    const rep = this.ensureIndividual(st, ind);
    const map = st.conceptsByInd.get(rep)!;
    const k = exprKey(expr);
    if (map.has(k)) return false;
    map.set(k, expr);
    return true;
  }

  private hasConcept(st: TableauState, ind: string, expr: TableauClassExpr): boolean {
    const rep = this.getRep(st, ind);
    return st.conceptsByInd.get(rep)?.has(exprKey(expr)) ?? false;
  }

  private addRoleEdge(st: TableauState, prop: string, subj: string, obj: string): boolean {
    const s = this.ensureIndividual(st, subj);
    const o = this.ensureIndividual(st, obj);
    let set = st.roleEdges.get(prop);
    if (!set) {
      set = new Set();
      st.roleEdges.set(prop, set);
    }
    const key = `${s}|${o}`;
    if (set.has(key)) return false;
    set.add(key);
    return true;
  }

  private getRolePairs(st: TableauState, prop: string): Array<[string, string]> {
    const set = st.roleEdges.get(prop);
    if (!set) return [];
    const out: Array<[string, string]> = [];
    for (const key of set) {
      const idx = key.indexOf("|");
      const s = this.getRep(st, key.slice(0, idx));
      const o = this.getRep(st, key.slice(idx + 1));
      out.push([s, o]);
    }
    return out;
  }

  /**
   * Merges individual `sourceInd` into `targetInd` (preferring nominal individuals as canonical reps).
   * Returns `false` if merging violates `differentPairs`.
   */
  private mergeIndividuals(st: TableauState, indA: string, indB: string): boolean {
    const repA = this.getRep(st, indA);
    const repB = this.getRep(st, indB);
    if (repA === repB) return true;
    if (st.differentPairs.has(pairKey(repA, repB))) {
      return false;
    }

    // Prefer nominal/named individual as canonical target
    const keep = st.nominalIndividuals.has(repA) || !st.nominalIndividuals.has(repB) ? repA : repB;
    const absorbed = keep === repA ? repB : repA;

    st.repOf.set(absorbed, keep);
    st.individuals.delete(absorbed);

    // Merge concepts
    const srcConcepts = st.conceptsByInd.get(absorbed);
    if (srcConcepts) {
      for (const [, expr] of srcConcepts) {
        this.addConcept(st, keep, expr);
      }
      st.conceptsByInd.delete(absorbed);
    }

    // Rewrite role edges
    for (const [, edges] of st.roleEdges) {
      const updated = new Set<string>();
      for (const e of edges) {
        const idx = e.indexOf("|");
        const s = this.getRep(st, e.slice(0, idx));
        const o = this.getRep(st, e.slice(idx + 1));
        updated.add(`${s}|${o}`);
      }
      edges.clear();
      for (const e of updated) edges.add(e);
    }

    // Rewrite negative role edges
    for (const [, edges] of st.negRoleEdges) {
      const updated = new Set<string>();
      for (const e of edges) {
        const idx = e.indexOf("|");
        const s = this.getRep(st, e.slice(0, idx));
        const o = this.getRep(st, e.slice(idx + 1));
        updated.add(`${s}|${o}`);
      }
      edges.clear();
      for (const e of updated) edges.add(e);
    }

    // Rewrite inequality pairs
    const newDiff = new Set<string>();
    for (const pk of st.differentPairs) {
      const idx = pk.indexOf("|");
      const x = this.getRep(st, pk.slice(0, idx));
      const y = this.getRep(st, pk.slice(idx + 1));
      if (x === y) return false;
      newDiff.add(pairKey(x, y));
    }
    st.differentPairs = newDiff;

    // Merge data literals & intervals
    for (const [k, lits] of [...st.dataLiterals.entries()]) {
      const idx = k.indexOf("|");
      const owner = k.slice(0, idx);
      const prop = k.slice(idx + 1);
      if (owner === absorbed) {
        const targetKey = `${keep}|${prop}`;
        const tSet = st.dataLiterals.get(targetKey) ?? new Set<string>();
        for (const v of lits) tSet.add(v);
        st.dataLiterals.set(targetKey, tSet);
        st.dataLiterals.delete(k);
      }
    }

    return true;
  }

  private exprContains(haystack: TableauClassExpr, needle: TableauClassExpr): boolean {
    if (exprKey(haystack) === exprKey(needle)) return true;
    if (haystack.kind === "ObjectIntersectionOf") {
      return haystack.operands.some((op) => this.exprContains(op, needle));
    }
    return false;
  }

  private createInitialState(extraAssertions?: Array<{ individual: string; concept: TableauClassExpr }>): {
    state: TableauState;
    immediateClash?: string | undefined;
  } {
    const st: TableauState = {
      individuals: new Set(),
      nominalIndividuals: new Set(),
      repOf: new Map(),
      differentPairs: new Set(),
      conceptsByInd: new Map(),
      roleEdges: new Map(),
      negRoleEdges: new Map(),
      dataLiterals: new Map(),
      negDataLiterals: new Map(),
      dataIntervals: new Map(),
      appliedWitnesses: new Set(),
      appliedChoices: new Set(),
      nextAnonId: 1,
    };

    for (const ind of this.namedIndividuals) {
      this.ensureIndividual(st, ind, true);
    }
    for (const diffSet of this.differentIndividualSets) {
      for (let i = 0; i < diffSet.length; i++) {
        const a = this.ensureIndividual(st, diffSet[i]!, true);
        for (let j = i + 1; j < diffSet.length; j++) {
          const b = this.ensureIndividual(st, diffSet[j]!, true);
          if (a === b) {
            return { state: st, immediateClash: `DifferentIndividuals contains identical individual '${a}'` };
          }
          st.differentPairs.add(pairKey(a, b));
        }
      }
    }
    for (const sameSet of this.sameIndividualSets) {
      for (let i = 1; i < sameSet.length; i++) {
        const a = this.ensureIndividual(st, sameSet[0]!, true);
        const b = this.ensureIndividual(st, sameSet[i]!, true);
        if (!this.mergeIndividuals(st, a, b)) {
          return {
            state: st,
            immediateClash: `SameIndividual(${a}, ${b}) contradicts DifferentIndividuals(${a}, ${b})`,
          };
        }
      }
    }

    for (const ca of this.classAssertions) {
      this.addConcept(st, ca.individual, ca.concept);
    }
    if (extraAssertions) {
      for (const ca of extraAssertions) {
        this.ensureIndividual(st, ca.individual, !ca.individual.startsWith("_:anon"));
        this.addConcept(st, ca.individual, ca.concept);
      }
    }

    for (const ra of this.roleAssertions) {
      this.addRoleEdge(st, ra.property, ra.subject, ra.object);
    }
    for (const nra of this.negRoleAssertions) {
      const s = this.ensureIndividual(st, nra.subject, true);
      const o = this.ensureIndividual(st, nra.object, true);
      const set = st.negRoleEdges.get(nra.property) ?? new Set<string>();
      set.add(`${s}|${o}`);
      st.negRoleEdges.set(nra.property, set);
    }
    for (const da of this.dataAssertions) {
      const s = this.ensureIndividual(st, da.subject, true);
      const key = `${s}|${da.property}`;
      const set = st.dataLiterals.get(key) ?? new Set<string>();
      set.add(da.value);
      st.dataLiterals.set(key, set);
    }
    for (const nda of this.negDataAssertions) {
      const s = this.ensureIndividual(st, nda.subject, true);
      const key = `${s}|${nda.property}`;
      const set = st.negDataLiterals.get(key) ?? new Set<string>();
      set.add(nda.value);
      st.negDataLiterals.set(key, set);
    }

    if (st.individuals.size === 0) {
      this.ensureIndividual(st, "_:root", false);
    }

    return { state: st };
  }

  /**
   * Saturates deterministic tableau rules on `st` and returns either a clash message,
   * or a nondeterministic branching point (`alternatives`), or `null` when saturated and clash-free.
   */
  private saturateDeterministic(st: TableauState): {
    clash?: string | undefined;
    branches?: Array<() => TableauState | null> | undefined;
  } {
    let changed = true;
    let iterations = 0;

    while (changed && ++iterations < 200) {
      changed = false;

      // 1. Reflexive object properties: (x, x) in R for all individuals
      for (const refProp of this.reflexiveProperties) {
        for (const ind of [...st.individuals]) {
          if (this.addRoleEdge(st, refProp, ind, ind)) changed = true;
        }
      }

      // 2. Role hierarchy, inverse roles, symmetric roles, transitive roles, and property chains
      for (const { sub, sup } of this.subObjectProperties) {
        for (const [s, o] of this.getRolePairs(st, sub)) {
          if (this.addRoleEdge(st, sup, s, o)) changed = true;
        }
      }
      for (const { p1, p2 } of this.inverseProperties) {
        for (const [s, o] of this.getRolePairs(st, p1)) {
          if (this.addRoleEdge(st, p2, o, s)) changed = true;
        }
        for (const [s, o] of this.getRolePairs(st, p2)) {
          if (this.addRoleEdge(st, p1, o, s)) changed = true;
        }
      }
      for (const symProp of this.symmetricProperties) {
        for (const [s, o] of this.getRolePairs(st, symProp)) {
          if (this.addRoleEdge(st, symProp, o, s)) changed = true;
        }
      }
      for (const transProp of this.transitiveProperties) {
        const pairs = this.getRolePairs(st, transProp);
        for (const [a, b] of pairs) {
          for (const [b2, c] of pairs) {
            if (b === b2 && this.addRoleEdge(st, transProp, a, c)) {
              changed = true;
            }
          }
        }
      }
      // SubObjectPropertyOf(ObjectPropertyChain(R1, R2, ..., Rk), S)
      for (const { chain, superProperty } of this.propertyChains) {
        if (chain.length < 2) continue;
        let reach = this.getRolePairs(st, chain[0]!);
        for (let step = 1; step < chain.length; step++) {
          const nextPairs = this.getRolePairs(st, chain[step]!);
          const composed: Array<[string, string]> = [];
          for (const [a, b] of reach) {
            for (const [b2, c] of nextPairs) {
              if (b === b2) composed.push([a, c]);
            }
          }
          reach = composed;
        }
        for (const [a, c] of reach) {
          if (this.addRoleEdge(st, superProperty, a, c)) changed = true;
        }
      }

      // 3. SubDataPropertyOf propagation
      for (const { sub, sup } of this.subDataProperties) {
        for (const [k, vals] of [...st.dataLiterals.entries()]) {
          const idx = k.indexOf("|");
          const subj = k.slice(0, idx);
          const prop = k.slice(idx + 1);
          if (prop === sub) {
            const supKey = `${subj}|${sup}`;
            const supSet = st.dataLiterals.get(supKey) ?? new Set<string>();
            for (const v of vals) {
              if (!supSet.has(v)) {
                supSet.add(v);
                changed = true;
              }
            }
            st.dataLiterals.set(supKey, supSet);
          }
        }
      }

      // 4. Object/Data Property Domains & Ranges
      for (const [prop, doms] of this.objectPropertyDomains) {
        for (const [s] of this.getRolePairs(st, prop)) {
          for (const dom of doms) {
            if (this.addConcept(st, s, dom)) changed = true;
          }
        }
      }
      for (const [prop, rngs] of this.objectPropertyRanges) {
        for (const [, o] of this.getRolePairs(st, prop)) {
          for (const rng of rngs) {
            if (this.addConcept(st, o, rng)) changed = true;
          }
        }
      }
      for (const [prop, doms] of this.dataPropertyDomains) {
        for (const [k, vals] of st.dataLiterals) {
          if (vals.size === 0) continue;
          const idx = k.indexOf("|");
          const s = k.slice(0, idx);
          const p = k.slice(idx + 1);
          if (p === prop) {
            for (const dom of doms) {
              if (this.addConcept(st, s, dom)) changed = true;
            }
          }
        }
      }
      for (const [prop, rngs] of this.dataPropertyRanges) {
        for (const ind of [...st.individuals]) {
          const key = `${ind}|${prop}`;
          if (st.dataLiterals.has(key) || st.dataIntervals.has(key)) {
            let iv = st.dataIntervals.get(key) ?? createDefaultInterval(rngs[0]?.datatypeIri);
            for (const rng of rngs) {
              iv = intersectIntervalWithRange(iv, rng);
            }
            st.dataIntervals.set(key, iv);
          }
        }
      }

      // 5. Functional & InverseFunctional Object Properties -> merge or clash
      for (const funcProp of this.functionalObjectProperties) {
        const pairs = this.getRolePairs(st, funcProp);
        const bySubj = new Map<string, string[]>();
        for (const [s, o] of pairs) {
          const list = bySubj.get(s) ?? [];
          if (!list.includes(o)) list.push(o);
          bySubj.set(s, list);
        }
        for (const [s, objs] of bySubj) {
          if (objs.length > 1) {
            if (!this.mergeIndividuals(st, objs[0]!, objs[1]!)) {
              return { clash: `FunctionalObjectProperty(${funcProp}) violated on '${s}'` };
            }
            changed = true;
            break;
          }
        }
      }
      for (const invFuncProp of this.inverseFunctionalObjectProperties) {
        const pairs = this.getRolePairs(st, invFuncProp);
        const byObj = new Map<string, string[]>();
        for (const [s, o] of pairs) {
          const list = byObj.get(o) ?? [];
          if (!list.includes(s)) list.push(s);
          byObj.set(o, list);
        }
        for (const [o, subjs] of byObj) {
          if (subjs.length > 1) {
            if (!this.mergeIndividuals(st, subjs[0]!, subjs[1]!)) {
              return { clash: `InverseFunctionalObjectProperty(${invFuncProp}) violated on '${o}'` };
            }
            changed = true;
            break;
          }
        }
      }

      // 6. Concept unfolding, GCI absorption, Conjunction, Universal, HasValue, HasSelf, ExactCardinality
      for (const ind of [...st.individuals]) {
        const conceptMap = st.conceptsByInd.get(ind);
        if (!conceptMap) continue;
        const currentConcepts = [...conceptMap.values()];

        // Check SubClassOf axioms
        for (const ax of this.subClassAxioms) {
          if (this.satisfiesConceptDeterministically(st, ind, ax.sub)) {
            if (this.addConcept(st, ind, ax.sup)) changed = true;
          }
        }

        // Check DisjointClasses sets
        for (const disjSet of this.disjointClassSets) {
          for (let i = 0; i < disjSet.length; i++) {
            if (this.satisfiesConceptDeterministically(st, ind, disjSet[i]!)) {
              for (let j = 0; j < disjSet.length; j++) {
                if (i !== j) {
                  if (this.addConcept(st, ind, negateClassExpr(disjSet[j]!))) changed = true;
                }
              }
            }
          }
        }

        for (const c of currentConcepts) {
          if (c.kind === "ObjectIntersectionOf") {
            for (const op of c.operands) {
              if (this.addConcept(st, ind, op)) changed = true;
            }
          } else if (c.kind === "ObjectComplementOf") {
            const inner = c.operand;
            // De Morgan laws
            if (inner.kind === "ObjectUnionOf") {
              for (const op of inner.operands) {
                if (this.addConcept(st, ind, negateClassExpr(op))) changed = true;
              }
            } else if (inner.kind === "ObjectIntersectionOf") {
              const negOps = inner.operands.map((op) => negateClassExpr(op));
              if (this.addConcept(st, ind, { kind: "ObjectUnionOf", operands: negOps })) changed = true;
            } else if (inner.kind === "ObjectSomeValuesFrom") {
              if (
                this.addConcept(st, ind, {
                  kind: "ObjectAllValuesFrom",
                  property: inner.property,
                  filler: negateClassExpr(inner.filler),
                })
              ) {
                changed = true;
              }
            } else if (inner.kind === "ObjectAllValuesFrom") {
              if (
                this.addConcept(st, ind, {
                  kind: "ObjectSomeValuesFrom",
                  property: inner.property,
                  filler: negateClassExpr(inner.filler),
                })
              ) {
                changed = true;
              }
            }
          } else if (c.kind === "ObjectHasValue") {
            this.ensureIndividual(st, c.individual, true);
            if (this.addRoleEdge(st, c.property, ind, c.individual)) changed = true;
          } else if (c.kind === "ObjectHasSelf") {
            if (this.addRoleEdge(st, c.property, ind, ind)) changed = true;
          } else if (c.kind === "ObjectAllValuesFrom") {
            for (const [s, o] of this.getRolePairs(st, c.property)) {
              if (s === ind && this.addConcept(st, o, c.filler)) {
                changed = true;
              }
            }
          } else if (c.kind === "ObjectCardinality" && c.cardType === "exact") {
            if (
              this.addConcept(st, ind, {
                kind: "ObjectCardinality",
                cardType: "min",
                count: c.count,
                property: c.property,
                filler: c.filler,
              })
            ) {
              changed = true;
            }
            if (
              this.addConcept(st, ind, {
                kind: "ObjectCardinality",
                cardType: "max",
                count: c.count,
                property: c.property,
                filler: c.filler,
              })
            ) {
              changed = true;
            }
          } else if (c.kind === "ObjectCardinality" && c.cardType === "max" && c.count === 0) {
            // <= 0 R.C is equivalent to \forall R. \neg C
            if (
              this.addConcept(st, ind, {
                kind: "ObjectAllValuesFrom",
                property: c.property,
                filler: negateClassExpr(c.filler),
              })
            ) {
              changed = true;
            }
          } else if (c.kind === "DataSomeValuesFrom" || c.kind === "DataAllValuesFrom") {
            const key = `${ind}|${c.property}`;
            const prev = st.dataIntervals.get(key) ?? createDefaultInterval(c.range.datatypeIri);
            const nextIv = intersectIntervalWithRange(prev, c.range);
            if (
              nextIv.min !== prev.min ||
              nextIv.max !== prev.max ||
              nextIv.minInclusive !== prev.minInclusive ||
              nextIv.maxInclusive !== prev.maxInclusive ||
              nextIv.integerOnly !== prev.integerOnly ||
              !st.dataIntervals.has(key)
            ) {
              st.dataIntervals.set(key, nextIv);
              changed = true;
            }
          } else if (c.kind === "DataHasValue") {
            const key = `${ind}|${c.property}`;
            const set = st.dataLiterals.get(key) ?? new Set<string>();
            const strVal = String(c.value);
            if (!set.has(strVal)) {
              set.add(strVal);
              st.dataLiterals.set(key, set);
              changed = true;
            }
          }
        }
      }

      // 7. Reverse ObjectHasValue recognition: if (x, a) in R and a is nominal, x in ObjectHasValue(R, a)
      for (const [prop, edges] of st.roleEdges) {
        for (const e of edges) {
          const idx = e.indexOf("|");
          const s = this.getRep(st, e.slice(0, idx));
          const o = this.getRep(st, e.slice(idx + 1));
          if (st.nominalIndividuals.has(o)) {
            if (this.addConcept(st, s, { kind: "ObjectHasValue", property: prop, individual: o })) {
              changed = true;
            }
          }
          if (s === o) {
            if (this.addConcept(st, s, { kind: "ObjectHasSelf", property: prop })) {
              changed = true;
            }
          }
        }
      }

      // 8. Clash detection
      const clash = this.detectClash(st);
      if (clash) return { clash };

      // 9. Existential (\exists R.C) and MinCardinality (\ge n R.C) witness generation (with cycle blocking)
      for (const ind of [...st.individuals]) {
        const conceptMap = st.conceptsByInd.get(ind);
        if (!conceptMap) continue;
        for (const c of [...conceptMap.values()]) {
          if (c.kind === "ObjectSomeValuesFrom") {
            const wKey = `${ind}|SOME|${exprKey(c)}`;
            if (st.appliedWitnesses.has(wKey)) continue;
            // Check if an existing R-successor already satisfies filler
            const succs = this.getRolePairs(st, c.property)
              .filter(([s]) => s === ind)
              .map(([, o]) => o);
            if (succs.some((o) => this.satisfiesConceptDeterministically(st, o, c.filler))) {
              st.appliedWitnesses.add(wKey);
              continue;
            }
            // Cycle blocking: prevent infinite anonymous chain if an ancestor already has identical concept set
            if (ind.startsWith("_:anon") && st.nextAnonId > 32) {
              st.appliedWitnesses.add(wKey);
              continue;
            }
            st.appliedWitnesses.add(wKey);
            const newInd = `_:anon${st.nextAnonId++}`;
            this.ensureIndividual(st, newInd, false);
            this.addRoleEdge(st, c.property, ind, newInd);
            this.addConcept(st, newInd, c.filler);
            changed = true;
          } else if (c.kind === "ObjectCardinality" && c.cardType === "min" && c.count > 0) {
            const wKey = `${ind}|MIN|${exprKey(c)}`;
            if (st.appliedWitnesses.has(wKey)) continue;
            const existingQualified = this.getRolePairs(st, c.property)
              .filter(([s, o]) => s === ind && this.satisfiesConceptDeterministically(st, o, c.filler))
              .map(([, o]) => o);
            const uniqueExisting = [...new Set(existingQualified)];
            // Only reuse existing if they are pairwise distinct
            let canReuseAll = uniqueExisting.length >= c.count;
            if (canReuseAll) {
              for (let i = 0; i < c.count && canReuseAll; i++) {
                for (let j = i + 1; j < c.count; j++) {
                  if (!st.differentPairs.has(pairKey(uniqueExisting[i]!, uniqueExisting[j]!))) {
                    canReuseAll = false;
                    break;
                  }
                }
              }
            }
            if (canReuseAll) {
              st.appliedWitnesses.add(wKey);
              continue;
            }
            if (ind.startsWith("_:anon") && st.nextAnonId > 32) {
              st.appliedWitnesses.add(wKey);
              continue;
            }
            st.appliedWitnesses.add(wKey);
            const created: string[] = [];
            for (let k = 0; k < c.count; k++) {
              const newInd = `_:anon${st.nextAnonId++}`;
              this.ensureIndividual(st, newInd, false);
              this.addRoleEdge(st, c.property, ind, newInd);
              this.addConcept(st, newInd, c.filler);
              created.push(newInd);
            }
            for (let i = 0; i < created.length; i++) {
              for (let j = i + 1; j < created.length; j++) {
                st.differentPairs.add(pairKey(created[i]!, created[j]!));
              }
            }
            changed = true;
          }
        }
      }
    }

    // Check clashes again after saturation
    const finalClash = this.detectClash(st);
    if (finalClash) return { clash: finalClash };

    // ── Nondeterministic Branching Rules (Or-Rule, OneOf-Rule, MaxCard Choose & Merge Rules) ──

    for (const ind of [...st.individuals]) {
      const conceptMap = st.conceptsByInd.get(ind);
      if (!conceptMap) continue;

      for (const c of [...conceptMap.values()]) {
        // 1. Disjunction (ObjectUnionOf): branch on each operand
        if (c.kind === "ObjectUnionOf") {
          if (c.operands.length === 0) {
            return { clash: `Empty ObjectUnionOf on '${ind}'` };
          }
          if (!c.operands.some((op) => this.satisfiesConceptDeterministically(st, ind, op))) {
            return {
              branches: c.operands.map((op) => () => {
                const next = cloneState(st);
                this.addConcept(next, ind, op);
                return next;
              }),
            };
          }
        }

        // 2. Nominal enumeration (ObjectOneOf): branch on merging `ind` with one of `c.individuals`
        if (c.kind === "ObjectOneOf") {
          if (c.individuals.length === 0) {
            return { clash: `Empty ObjectOneOf on '${ind}'` };
          }
          const repInd = this.getRep(st, ind);
          const alreadyMerged = c.individuals.some((nom) => this.getRep(st, nom) === repInd);
          if (!alreadyMerged) {
            return {
              branches: c.individuals.map((nom) => () => {
                const next = cloneState(st);
                this.ensureIndividual(next, nom, true);
                if (!this.mergeIndividuals(next, repInd, nom)) return null;
                return next;
              }),
            };
          }
        }

        // 3. Qualified Max Cardinality (\le n R.C): Choose-rule & Merge-rule
        if (c.kind === "ObjectCardinality" && c.cardType === "max" && c.count >= 1) {
          const rSuccs = [
            ...new Set(
              this.getRolePairs(st, c.property)
                .filter(([s]) => s === ind)
                .map(([, o]) => o),
            ),
          ];

          // Choose-rule: ensure every R-successor is decided wrt C or \neg C
          for (const succ of rSuccs) {
            const hasPos = this.satisfiesConceptDeterministically(st, succ, c.filler);
            const hasNeg = this.satisfiesConceptDeterministically(st, succ, negateClassExpr(c.filler));
            const choiceKey = `${ind}|${c.property}|${exprKey(c.filler)}|${succ}`;
            if (!hasPos && !hasNeg && !st.appliedChoices.has(choiceKey)) {
              return {
                branches: [
                  () => {
                    const next = cloneState(st);
                    next.appliedChoices.add(choiceKey);
                    this.addConcept(next, succ, c.filler);
                    return next;
                  },
                  () => {
                    const next = cloneState(st);
                    next.appliedChoices.add(choiceKey);
                    this.addConcept(next, succ, negateClassExpr(c.filler));
                    return next;
                  },
                ],
              };
            }
          }

          // Merge-rule: if > c.count R-successors satisfy C, branch over merging any mergeable pair
          const qualifiedSuccs = rSuccs.filter((succ) => this.satisfiesConceptDeterministically(st, succ, c.filler));
          if (qualifiedSuccs.length > c.count) {
            const mergeBranches: Array<() => TableauState | null> = [];
            for (let i = 0; i < qualifiedSuccs.length; i++) {
              for (let j = i + 1; j < qualifiedSuccs.length; j++) {
                const u = qualifiedSuccs[i]!;
                const v = qualifiedSuccs[j]!;
                if (!st.differentPairs.has(pairKey(u, v))) {
                  mergeBranches.push(() => {
                    const next = cloneState(st);
                    if (!this.mergeIndividuals(next, u, v)) return null;
                    return next;
                  });
                }
              }
            }
            if (mergeBranches.length === 0) {
              return {
                clash: `ObjectMaxCardinality(${c.count} ${c.property}) violated on '${ind}': found ${qualifiedSuccs.length} pairwise distinct successors`,
              };
            }
            return { branches: mergeBranches };
          }
        }
      }
    }

    return {};
  }

  private satisfiesConceptDeterministically(st: TableauState, ind: string, expr: TableauClassExpr): boolean {
    if (expr.kind === "NamedClass" && expr.iri === "owl:Thing") return true;
    if (this.hasConcept(st, ind, expr)) return true;
    if (expr.kind === "ObjectIntersectionOf") {
      return expr.operands.every((op) => this.satisfiesConceptDeterministically(st, ind, op));
    }
    if (expr.kind === "ObjectUnionOf") {
      return expr.operands.some((op) => this.satisfiesConceptDeterministically(st, ind, op));
    }
    if (expr.kind === "ObjectOneOf") {
      const rep = this.getRep(st, ind);
      return expr.individuals.some((nom) => this.getRep(st, nom) === rep);
    }
    if (expr.kind === "ObjectHasValue") {
      const rep = this.getRep(st, ind);
      const nomRep = this.getRep(st, expr.individual);
      return this.getRolePairs(st, expr.property).some(([s, o]) => s === rep && o === nomRep);
    }
    if (expr.kind === "ObjectHasSelf") {
      const rep = this.getRep(st, ind);
      return this.getRolePairs(st, expr.property).some(([s, o]) => s === rep && o === rep);
    }
    if (expr.kind === "ObjectSomeValuesFrom") {
      const rep = this.getRep(st, ind);
      return this.getRolePairs(st, expr.property).some(
        ([s, o]) => s === rep && this.satisfiesConceptDeterministically(st, o, expr.filler),
      );
    }
    return false;
  }

  private detectClash(st: TableauState): string | null {
    // 1. Concept clashes: owl:Nothing or C and \neg C on the same individual
    for (const ind of st.individuals) {
      const conceptMap = st.conceptsByInd.get(ind);
      if (!conceptMap) continue;
      for (const c of conceptMap.values()) {
        if (c.kind === "NamedClass" && c.iri === "owl:Nothing") {
          return `Individual '${ind}' belongs to owl:Nothing`;
        }
        if (c.kind === "ObjectComplementOf") {
          if (this.satisfiesConceptDeterministically(st, ind, c.operand)) {
            return `Clash on '${ind}': both ${exprKey(c.operand)} and its complement hold`;
          }
        }
      }
    }

    // 2. Irreflexive, Asymmetric, DisjointObjectProperties, and NegativeObjectPropertyAssertion clashes
    for (const irrProp of this.irreflexiveProperties) {
      for (const [s, o] of this.getRolePairs(st, irrProp)) {
        if (s === o) {
          return `IrreflexiveObjectProperty(${irrProp}) violated by (${s}, ${s})`;
        }
      }
    }
    for (const asymProp of this.asymmetricProperties) {
      const pairs = this.getRolePairs(st, asymProp);
      for (const [s, o] of pairs) {
        if (pairs.some(([s2, o2]) => s2 === o && o2 === s)) {
          return `AsymmetricObjectProperty(${asymProp}) violated by (${s}, ${o}) and (${o}, ${s})`;
        }
      }
    }
    for (const disjProps of this.disjointObjectPropertySets) {
      for (let i = 0; i < disjProps.length; i++) {
        const pairsI = this.getRolePairs(st, disjProps[i]!);
        for (let j = i + 1; j < disjProps.length; j++) {
          const pairsJ = this.getRolePairs(st, disjProps[j]!);
          for (const [s, o] of pairsI) {
            if (pairsJ.some(([s2, o2]) => s2 === s && o2 === o)) {
              return `DisjointObjectProperties(${disjProps[i]}, ${disjProps[j]}) violated by (${s}, ${o})`;
            }
          }
        }
      }
    }
    for (const [prop, negSet] of st.negRoleEdges) {
      const posPairs = this.getRolePairs(st, prop);
      for (const negKey of negSet) {
        const idx = negKey.indexOf("|");
        const ns = this.getRep(st, negKey.slice(0, idx));
        const no = this.getRep(st, negKey.slice(idx + 1));
        if (posPairs.some(([s, o]) => s === ns && o === no)) {
          return `NegativeObjectPropertyAssertion(${prop} ${ns} ${no}) contradicted`;
        }
      }
    }

    // 3. Datatype interval & literal clashes (D)
    for (const [key, iv] of st.dataIntervals) {
      if (!isIntervalSatisfiable(iv)) {
        return `Unsatisfiable DatatypeRestriction interval on '${key}': [${iv.min}, ${iv.max}]`;
      }
      const lits = st.dataLiterals.get(key);
      if (lits) {
        for (const lit of lits) {
          const num = Number(lit);
          if (!valueSatisfiesInterval(num, iv)) {
            return `DataPropertyAssertion value '${lit}' on '${key}' violates DatatypeRestriction [${iv.min}, ${iv.max}]`;
          }
        }
      }
    }
    for (const [key, lits] of st.dataLiterals) {
      const idx = key.indexOf("|");
      const prop = key.slice(idx + 1);
      if (this.functionalDataProperties.has(prop) && lits.size > 1) {
        return `FunctionalDataProperty(${prop}) violated on '${key}': multiple distinct values`;
      }
      const negLits = st.negDataLiterals.get(key);
      if (negLits) {
        for (const v of lits) {
          if (negLits.has(v)) {
            return `NegativeDataPropertyAssertion(${prop}) contradicted for value '${v}'`;
          }
        }
      }
    }

    return null;
  }

  /**
   * Depth-first backtracking tableau search. Returns a clash-free completed `TableauState`
   * if one exists, or `{ state: null, clashes }` if all branches close with a clash.
   */
  private solveTableau(initialState: TableauState, maxDepth = 24): { model: TableauState | null; clashes: string[] } {
    const clashes: string[] = [];

    const dfs = (st: TableauState, depth: number): TableauState | null => {
      const res = this.saturateDeterministic(st);
      if (res.clash) {
        clashes.push(res.clash);
        return null;
      }
      if (!res.branches || res.branches.length === 0 || depth >= maxDepth) {
        return st;
      }
      for (const makeBranch of res.branches) {
        const nextSt = makeBranch();
        if (!nextSt) continue;
        const solved = dfs(nextSt, depth + 1);
        if (solved) return solved;
      }
      return null;
    };

    const model = dfs(initialState, 0);
    return { model, clashes };
  }

  // ── Public Reasoning API ───────────────────────────────────────────────────

  /**
   * Checks global ABox + TBox + RBox consistency and computes class satisfiability,
   * subsumption hierarchy, individual types, and role assertions.
   */
  public checkConsistency(): Owl2ReasoningResult {
    const init = this.createInitialState();
    if (init.immediateClash) {
      return {
        consistent: false,
        unsatisfiableClasses: [],
        clashes: [init.immediateClash],
        inferredSubClasses: new Map(),
        inferredTypes: new Map(),
        inferredRoleAssertions: [],
        sameIndividuals: new Map(),
      };
    }

    const { model, clashes } = this.solveTableau(init.state);
    if (!model) {
      return {
        consistent: false,
        unsatisfiableClasses: [],
        clashes,
        inferredSubClasses: new Map(),
        inferredTypes: new Map(),
        inferredRoleAssertions: [],
        sameIndividuals: new Map(),
      };
    }

    // Extract inferred individual types and role assertions from the canonical completion model
    const inferredTypes = new Map<string, Set<string>>();
    const sameIndividuals = new Map<string, Set<string>>();
    for (const ind of this.namedIndividuals) {
      const rep = this.getRep(model, ind);
      const tSet = new Set<string>();
      const concepts = model.conceptsByInd.get(rep);
      if (concepts) {
        for (const c of concepts.values()) {
          if (c.kind === "NamedClass" && !c.iri.startsWith("__aux_") && !c.iri.startsWith("_:")) {
            tSet.add(c.iri);
          }
        }
      }
      inferredTypes.set(ind, tSet);

      const eqSet = new Set<string>();
      for (const other of this.namedIndividuals) {
        if (this.getRep(model, other) === rep) eqSet.add(other);
      }
      sameIndividuals.set(ind, eqSet);
    }

    const inferredRoleAssertions: Array<{ property: string; subject: string; object: string }> = [];
    for (const prop of this.objectProperties) {
      const pairs = this.getRolePairs(model, prop);
      for (const [sRep, oRep] of pairs) {
        // Map back to all named individuals represented by sRep and oRep
        const sNamed = [...this.namedIndividuals].filter((n) => this.getRep(model, n) === sRep);
        const oNamed = [...this.namedIndividuals].filter((n) => this.getRep(model, n) === oRep);
        for (const s of sNamed) {
          for (const o of oNamed) {
            if (!inferredRoleAssertions.some((r) => r.property === prop && r.subject === s && r.object === o)) {
              inferredRoleAssertions.push({ property: prop, subject: s, object: o });
            }
          }
        }
      }
    }

    // Check satisfiability of each named class
    const unsatisfiableClasses: string[] = [];
    for (const cls of this.classes) {
      if (cls === "owl:Thing") continue;
      if (cls === "owl:Nothing") {
        unsatisfiableClasses.push(cls);
        continue;
      }
      if (!this.isClassSatisfiable(cls)) {
        unsatisfiableClasses.push(cls);
      }
    }

    // Compute inferred SubClassOf hierarchy among satisfiable named classes
    const inferredSubClasses = new Map<string, Set<string>>();
    const namedClassList = [...this.classes].filter((c) => c !== "owl:Nothing");
    for (const sub of namedClassList) {
      const supers = new Set<string>(["owl:Thing", sub]);
      for (const sup of namedClassList) {
        if (sub !== sup && sup !== "owl:Thing") {
          if (this.isSubClassOf(sub, sup)) {
            supers.add(sup);
          }
        }
      }
      inferredSubClasses.set(sub, supers);
    }

    return {
      consistent: true,
      unsatisfiableClasses,
      clashes: [],
      inferredSubClasses,
      inferredTypes,
      inferredRoleAssertions,
      sameIndividuals,
    };
  }

  /**
   * Returns `true` if the ontology (TBox + RBox + ABox) has at least one clash-free tableau completion.
   */
  public isConsistent(): boolean {
    const init = this.createInitialState();
    if (init.immediateClash) return false;
    return this.solveTableau(init.state).model !== null;
  }

  /**
   * Tests whether a class IRI or `TableauClassExpr` is satisfiable with respect to the ontology
   * by asserting a fresh probe individual `_probe \in C` and checking tableau consistency.
   */
  public isClassSatisfiable(classOrExpr: string | TableauClassExpr): boolean {
    const concept: TableauClassExpr =
      typeof classOrExpr === "string" ? { kind: "NamedClass", iri: this.normIri(classOrExpr) } : classOrExpr;
    if (concept.kind === "NamedClass" && concept.iri === "owl:Nothing") return false;
    const init = this.createInitialState([{ individual: "_:probe_sat", concept }]);
    if (init.immediateClash) return false;
    return this.solveTableau(init.state).model !== null;
  }

  /**
   * Tests whether `SubClassOf(sub, sup)` is entailed by checking unsatisfiability of `sub \sqcap \neg sup`.
   */
  public isSubClassOf(subClass: string | TableauClassExpr, superClass: string | TableauClassExpr): boolean {
    const sub: TableauClassExpr =
      typeof subClass === "string" ? { kind: "NamedClass", iri: this.normIri(subClass) } : subClass;
    const sup: TableauClassExpr =
      typeof superClass === "string" ? { kind: "NamedClass", iri: this.normIri(superClass) } : superClass;
    const counterConcept: TableauClassExpr = {
      kind: "ObjectIntersectionOf",
      operands: [sub, negateClassExpr(sup)],
    };
    return !this.isClassSatisfiable(counterConcept);
  }

  /**
   * Tests whether an individual `indIri` is entailed to be an instance of `classOrExpr`
   * by checking unsatisfiability of asserting `indIri : \neg classOrExpr`.
   */
  public isInstanceOf(indIri: string, classOrExpr: string | TableauClassExpr): boolean {
    const ind = this.normIri(indIri);
    const concept: TableauClassExpr =
      typeof classOrExpr === "string" ? { kind: "NamedClass", iri: this.normIri(classOrExpr) } : classOrExpr;
    const init = this.createInitialState([{ individual: ind, concept: negateClassExpr(concept) }]);
    if (init.immediateClash) return true;
    return this.solveTableau(init.state).model === null;
  }

  /**
   * Tests whether a role assertion `(subjectIri, objectIri) \in propertyIri` is entailed.
   */
  public hasRoleRelationship(propertyIri: string, subjectIri: string, objectIri: string): boolean {
    const prop = this.normIri(propertyIri);
    const subj = this.normIri(subjectIri);
    const obj = this.normIri(objectIri);
    const init = this.createInitialState();
    if (init.immediateClash) return true;
    const s = this.ensureIndividual(init.state, subj, true);
    const o = this.ensureIndividual(init.state, obj, true);
    const negSet = init.state.negRoleEdges.get(prop) ?? new Set<string>();
    negSet.add(`${s}|${o}`);
    init.state.negRoleEdges.set(prop, negSet);
    return this.solveTableau(init.state).model === null;
  }

  /**
   * Returns all named superclasses of `classIri`.
   */
  public getSuperClasses(classIri: string): string[] {
    const target = this.normIri(classIri);
    const out: string[] = [];
    for (const c of this.classes) {
      if (c !== target && c !== "owl:Nothing" && this.isSubClassOf(target, c)) {
        out.push(c);
      }
    }
    return out;
  }

  /**
   * Returns all named subclasses of `classIri`.
   */
  public getSubClasses(classIri: string): string[] {
    const target = this.normIri(classIri);
    const out: string[] = [];
    for (const c of this.classes) {
      if (c !== target && c !== "owl:Nothing" && this.isSubClassOf(c, target)) {
        out.push(c);
      }
    }
    return out;
  }

  /**
   * Returns all named classes that `individualIri` is entailed to instantiate.
   */
  public getIndividualTypes(individualIri: string): string[] {
    const ind = this.normIri(individualIri);
    const out: string[] = [];
    for (const c of this.classes) {
      if (c !== "owl:Nothing" && this.isInstanceOf(ind, c)) {
        out.push(c);
      }
    }
    return out;
  }

  /**
   * Returns all unsatisfiable named classes in the ontology (excluding `owl:Nothing`).
   */
  public getUnsatisfiableClasses(): string[] {
    const out: string[] = [];
    for (const c of this.classes) {
      if (c !== "owl:Thing" && c !== "owl:Nothing" && !this.isClassSatisfiable(c)) {
        out.push(c);
      }
    }
    return out;
  }
}

/**
 * Convenience helper that parses an OWL 2 Functional-Style Syntax ontology (or axiom array)
 * and runs the $\mathcal{SROIQ}(D)$ tableau reasoner.
 */
export function reasonOwl2Ontology(sourceOrAxioms: string | OWL2Axiom[]): Owl2ReasoningResult {
  const reasoner = new Owl2TableauReasoner(sourceOrAxioms);
  return reasoner.checkConsistency();
}
