// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Grammar normalization and BNF production flattening for DSL language definitions.
 */

import { FORMAT_SENTINEL_END, FORMAT_SENTINEL_START } from "./codec-types.js";
import { LanguageOptions, Rule, toRule } from "./language.js";

/** A type alias for string, representing a grammar symbol (terminal or non-terminal) */
export type SymbolName = string;

/** Static diagnostic emitted by `validateGrammar` before LR automaton construction. */
export interface GrammarDiagnostic {
  code: "undefined-rule" | "unreachable-rule" | "unproductive-rule" | "nullable-repeat";
  severity: "error" | "warning";
  rule?: string | undefined;
  message: string;
}

/**
 * Represents a single normalized production rule in BNF (Backus-Naur Form).
 */
export interface Production {
  /** Unique integer identifier for this production. */
  id: number;
  /** The non-terminal symbol on the left-hand side of the production. */
  left: SymbolName;
  /** The sequence of symbols (terminals/non-terminals) on the right-hand side. */
  right: SymbolName[];
  /** Optional static precedence for conflict resolution. */
  prec?: number | undefined;
  /** Optional associativity for shift/reduce conflict resolution. */
  assoc?: "left" | "right" | undefined;
  /** Optional dynamic precedence for GLR runtime tie-breaking. */
  dynamicPrec?: number | undefined;
  /** True if this production is a synthetic helper or marked inline, and should not appear in AST */
  isInvisible: boolean;
  /** True if this production represents a list (e.g. from repeat or repeat1 rules). */
  isList: boolean;
  /** AST node renaming aliases assigned to specific RHS symbols. */
  aliases?: { index: number; target: string }[] | undefined;
  /** AST named fields assigned to specific RHS symbols. */
  fields?: { index: number; fieldId: number }[] | undefined;
  /** Semantic token assignments applied to specific RHS symbols. */
  semantics?: { index: number; type: string; modifiers: unknown }[] | undefined;
}

/** Structural shape of a DSL rule node inspected during grammar normalization. */
export interface GrammarRuleNode {
  type: string;
  value?: unknown;
  name?: string | undefined;
  arg?: unknown;
  args?: (GrammarRuleNode | string | RegExp)[] | undefined;
  children?: (GrammarRuleNode | string | RegExp)[] | undefined;
  rule?: GrammarRuleNode | string | RegExp | undefined;
  precedence?: number | undefined;
}

export type GrammarRuleInput = GrammarRuleNode | string | RegExp | null | undefined;

/** Context passed down during grammar flattening to propagate precedence, associativity, and field names. */
export interface FlattenContext {
  /** Inherited static numeric precedence level. */
  prec?: number | undefined;
  /** Inherited operator associativity (`"left"` or `"right"`). */
  assoc?: "left" | "right" | undefined;
  /** Inherited dynamic precedence for runtime GLR tie-breaking. */
  dynamicPrec?: number | undefined;
  /** Active AST field name enclosing the current rule subtree. */
  field?: string | undefined;
  /** True when a `prec*()` wrapper can attach directly to the enclosing production without synthesizing a wrapper non-terminal. */
  canAttachPrec?: boolean | undefined;
}

function escapeRegexLiteral(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\/]/g, "\\$&");
}

/**
 * Compiles a composite lexical rule tree (`token(seq(...))`, `token(choice(...))`, etc.)
 * into a single monolithic regular expression body string, or returns `null` if the rule
 * contains non-lexical constructs (such as non-terminal `SYMBOL` references or flagged regexes).
 */
export function compileRuleToRegex(rule: GrammarRuleInput): string | null {
  if (rule === null || rule === undefined) return null;
  if (typeof rule === "string") return escapeRegexLiteral(rule);
  if (rule instanceof RegExp || Object.prototype.toString.call(rule) === "[object RegExp]") {
    const re = rule as RegExp;
    if (re.flags && re.flags.length > 0) return null;
    return `(?:${re.source})`;
  }
  const t = (rule.type || "").toUpperCase();
  const children =
    rule.children || rule.args || (rule.arg !== undefined ? [rule.arg as GrammarRuleNode | string | RegExp] : []);
  if (t === "TOKEN") {
    if (rule.value !== undefined) {
      if (typeof rule.value === "string") {
        if (rule.value.startsWith("/") && rule.value.endsWith("/") && rule.value.length > 1) {
          return `(?:${rule.value.slice(1, -1)})`;
        }
        return escapeRegexLiteral(rule.value);
      }
      if (rule.value instanceof RegExp || Object.prototype.toString.call(rule.value) === "[object RegExp]") {
        const re = rule.value as RegExp;
        if (re.flags && re.flags.length > 0) return null;
        return `(?:${re.source})`;
      }
      return null;
    }
    if (children.length === 1) return compileRuleToRegex(children[0]);
    return null;
  }
  if (t === "BLANK") return "";
  if (t === "SEQ") {
    const parts: string[] = [];
    for (const c of children) {
      const compiled = compileRuleToRegex(c);
      if (compiled === null) return null;
      parts.push(compiled);
    }
    return `(?:${parts.join("")})`;
  }
  if (t === "CHOICE") {
    const parts: string[] = [];
    for (const c of children) {
      const compiled = compileRuleToRegex(c);
      if (compiled === null) return null;
      parts.push(compiled);
    }
    return parts.length > 0 ? `(?:${parts.join("|")})` : null;
  }
  if (t === "REPEAT") {
    const inner = compileRuleToRegex(children[0]);
    return inner !== null ? `(?:${inner})*` : null;
  }
  if (t === "REPEAT1") {
    const inner = compileRuleToRegex(children[0]);
    return inner !== null ? `(?:${inner})+` : null;
  }
  if (t === "OPTIONAL") {
    const inner = compileRuleToRegex(children[0]);
    return inner !== null ? `(?:${inner})?` : null;
  }
  if (t === "SYNTAX_TOKEN" || t === "ALIAS" || t === "SEMANTIC" || t === "TOKEN_IMMEDIATE" || t === "RESERVED") {
    return compileRuleToRegex(rule.rule || children[0]);
  }
  return null;
}

/** The result of flattening a rule: a flat sequence of symbol names and their metadata. */
export interface FlattenResult {
  /** The terminal or non-terminal symbol name produced by flattening. */
  sym: SymbolName;
  /** Optional AST alias overriding the symbol's node kind in the CST. */
  alias?: string | undefined;
  /** Optional AST field name assigned to this symbol occurrence. */
  field?: string | undefined;
  /** Optional LSP semantic token type and modifiers attached to this symbol. */
  semantic?: { type: string; modifiers: unknown } | undefined;
}

/**
 * Strategy interface for translating DSL rule trees into flattened BNF productions.
 */
export interface RuleNormalizer {
  /** Flattens a DSL rule node and its children into a sequence of `FlattenResult` items, registering synthetic productions on `g` as needed. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[];
  /** Returns a canonical EBNF string representation of `rule` used for naming and deduplicating synthetic rules. */
  getEBNF(
    g: NormalizedGrammar,
    rule: GrammarRuleNode,
    getChild: (r: GrammarRuleNode) => GrammarRuleInput,
    getChildren: (r: GrammarRuleNode) => (GrammarRuleNode | string | RegExp)[],
  ): string;
}

/** Normalizes a direct symbol reference, expanding non-recursive `inline` rules directly into their call sites. */
export class SymbolNormalizer implements RuleNormalizer {
  /** Returns a single `FlattenResult` referencing the target symbol name with the inherited field context. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    _children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    if (typeof rule.value === "string") {
      g.recordSymbolRef(ctx, rule.value);
      if (
        g.inlineSet.has(rule.value) &&
        !g.inliningStack.has(rule.value) &&
        g.evaluatedRules[rule.value] !== undefined
      ) {
        g.inliningStack.add(rule.value);
        try {
          return g.flatten(ctx, g.evaluatedRules[rule.value]!, p);
        } finally {
          g.inliningStack.delete(rule.value);
        }
      }
    }
    return [{ sym: String(rule.value), field: p.field }];
  }
  /** Formats the referenced symbol name as its literal EBNF identifier. */
  getEBNF(_g: NormalizedGrammar, rule: GrammarRuleNode): string {
    return rule.value as string;
  }
}

/** Normalizes a terminal token (string or regex), extracting it into the grammar's terminal set. */
export class TokenNormalizer implements RuleNormalizer {
  /** Registers the string literal or regular expression in `g.terminals` and returns its terminal symbol reference. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    _children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    if (rule.children && rule.children.length > 0 && rule.value === undefined) {
      const compiledRegex = compileRuleToRegex(rule.children[0]);
      if (compiledRegex !== null && compiledRegex.length > 0) {
        const tokenName = `/${compiledRegex}/`;
        g.terminals.add(tokenName);
        return [{ sym: tokenName, field: p.field }];
      }
      return g.flatten(ctx, rule.children[0], p);
    }
    const val = rule.value !== undefined ? rule.value : rule.arg;
    if (
      typeof val !== "string" &&
      !(val instanceof RegExp || Object.prototype.toString.call(val) === "[object RegExp]")
    ) {
      throw new Error(`Invalid token value in context '${ctx}': expected string or RegExp, got ${typeof val}`);
    }
    let tokenName = (val as string | RegExp).toString();
    if (typeof val === "string") {
      tokenName = `"${val}"`;
    }
    g.terminals.add(tokenName);
    return [{ sym: tokenName, field: p.field }];
  }
  /** Formats the token pattern as a quoted string literal or `/regex/` in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    if (rule.children && rule.children.length > 0 && rule.value === undefined) {
      return g.getEBNF(getChild(rule));
    }
    return typeof rule.value === "string"
      ? `"${rule.value}"`
      : rule.value instanceof RegExp || Object.prototype.toString.call(rule.value) === "[object RegExp]"
        ? `/${(rule.value as RegExp).source}/`
        : "token";
  }
}

/** Normalizes a sequence of rules by concatenating their flattened results. */
export class SeqNormalizer implements RuleNormalizer {
  /** Flattens each child rule in order and concatenates their resulting symbol sequences. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    _rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const seqSyms: FlattenResult[] = [];
    for (const child of children) {
      seqSyms.push(...g.flatten(ctx, child, { ...p, canAttachPrec: false }));
    }
    return seqSyms;
  }
  /** Formats the sequence as a parenthesized space-separated list of child EBNF expressions. */
  getEBNF(
    g: NormalizedGrammar,
    rule: GrammarRuleNode,
    _getChild: (r: GrammarRuleNode) => GrammarRuleInput,
    getChildren: (r: GrammarRuleNode) => (GrammarRuleNode | string | RegExp)[],
  ): string {
    return `(${getChildren(rule)
      .map((c) => g.getEBNF(c))
      .join(" ")})`;
  }
}

/** Normalizes a choice of rules by creating a synthetic non-terminal with multiple productions. */
export class ChoiceNormalizer implements RuleNormalizer {
  /** Synthesizes a helper non-terminal with one production per alternative branch and returns a reference to it. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const choiceSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);
    if (g.nonTerminals.has(choiceSym)) return [{ sym: choiceSym, field: p.field }];

    for (const child of children) {
      const childP: FlattenContext = { ...p, canAttachPrec: true };
      const childSyms = g.flatten(ctx, child, childP);
      g.addProduction(choiceSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    }
    return [{ sym: choiceSym, field: p.field }];
  }
  /** Formats the alternation as a parenthesized `|`-separated list of child EBNF expressions. */
  getEBNF(
    g: NormalizedGrammar,
    rule: GrammarRuleNode,
    _getChild: (r: GrammarRuleNode) => GrammarRuleInput,
    getChildren: (r: GrammarRuleNode) => (GrammarRuleNode | string | RegExp)[],
  ): string {
    return `(${getChildren(rule)
      .map((c) => g.getEBNF(c))
      .join(" | ")})`;
  }
}

/** Normalizes a zero-or-more repetition (*), creating a recursive synthetic list production. */
export class RepeatNormalizer implements RuleNormalizer {
  /** Synthesizes a left-recursive list non-terminal with a recursive step production and an empty base production. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const childP: FlattenContext = { ...p, canAttachPrec: true };
    const childSyms = g.flatten(ctx, children[0], childP);
    const repeatSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);

    if (g.nonTerminals.has(repeatSym)) return [{ sym: repeatSym, field: p.field }];

    g.addProduction(repeatSym, [{ sym: repeatSym }, ...childSyms], childP.prec, childP.assoc, true, childP.dynamicPrec);
    g.addProduction(repeatSym, [], undefined, undefined, true);
    return [{ sym: repeatSym, field: p.field }];
  }
  /** Formats the repetition with a trailing Kleene star (`*`) in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return `${g.getEBNF(getChild(rule))}*`;
  }
}

/** Normalizes a one-or-more repetition (+), creating a recursive synthetic list production. */
export class Repeat1Normalizer implements RuleNormalizer {
  /** Synthesizes a left-recursive list non-terminal with a single-element base production and a recursive step production. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const childP: FlattenContext = { ...p, canAttachPrec: true };
    const childSyms = g.flatten(ctx, children[0], childP);
    const repeatSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);

    if (g.nonTerminals.has(repeatSym)) return [{ sym: repeatSym, field: p.field }];

    g.addProduction(repeatSym, childSyms, childP.prec, childP.assoc, true, childP.dynamicPrec);
    g.addProduction(repeatSym, [{ sym: repeatSym }, ...childSyms], childP.prec, childP.assoc, true, childP.dynamicPrec);
    return [{ sym: repeatSym, field: p.field }];
  }
  /** Formats the one-or-more repetition with a trailing Kleene plus (`+`) in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return `${g.getEBNF(getChild(rule))}+`;
  }
}

/**
 * Shared helper for precedence normalizers.
 * When `p.canAttachPrec` is true (direct rule body, choice branch, repeat/optional body), attaches
 * precedence directly onto `p` so the enclosing production carries it without allocating a synthetic
 * wrapper non-terminal. Otherwise synthesizes a helper non-terminal while avoiding `X -> X` self-loops.
 */
function normalizePrec(
  g: NormalizedGrammar,
  ctx: string,
  rule: GrammarRuleNode,
  children: (GrammarRuleNode | string | RegExp)[],
  p: FlattenContext,
  childP: FlattenContext,
): FlattenResult[] {
  if (p.canAttachPrec) {
    p.prec = childP.prec;
    p.assoc = childP.assoc;
    p.dynamicPrec = childP.dynamicPrec;
    return g.flatten(ctx, children[0], p);
  }
  const precSym = g.nextSynthetic(g.getEBNF(rule), childP, rule, ctx);
  if (g.nonTerminals.has(precSym)) return [{ sym: precSym, field: p.field }];

  const innerP: FlattenContext = { ...childP, canAttachPrec: true };
  const childSyms = g.flatten(ctx, children[0], innerP);
  if (childSyms.length !== 1 || childSyms[0]!.sym !== precSym) {
    g.addProduction(precSym, childSyms, innerP.prec, innerP.assoc, false, innerP.dynamicPrec);
  }
  return [{ sym: precSym, field: p.field }];
}

/** Propagates static precedence to child rules without associativity. */
export class PrecNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying the specified static precedence level. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const childP = { ...p, prec: (rule.value !== undefined ? rule.value : rule.precedence) as number | undefined };
    return normalizePrec(g, ctx, rule, children, p, childP);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Propagates static precedence with left-associativity to child rules. */
export class PrecLeftNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying static precedence and `"left"` associativity. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const childP = {
      ...p,
      prec: (rule.value !== undefined ? rule.value : rule.precedence) as number | undefined,
      assoc: "left" as const,
    };
    return normalizePrec(g, ctx, rule, children, p, childP);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Propagates static precedence with right-associativity to child rules. */
export class PrecRightNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying static precedence and `"right"` associativity. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const childP = {
      ...p,
      prec: (rule.value !== undefined ? rule.value : rule.precedence) as number | undefined,
      assoc: "right" as const,
    };
    return normalizePrec(g, ctx, rule, children, p, childP);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Propagates dynamic precedence for runtime GLR conflict resolution. */
export class PrecDynamicNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying the specified dynamic precedence value. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const childP = {
      ...p,
      dynamicPrec: (rule.value !== undefined ? rule.value : rule.precedence) as number | undefined,
    };
    return normalizePrec(g, ctx, rule, children, p, childP);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes symbol definition (`DEF`), reference (`REF`), `RESERVED`, and `TOKEN_IMMEDIATE` wrapper rules by delegating to their inner syntax rule. */
export class DefRefNormalizer implements RuleNormalizer {
  /** Flattens the inner syntax rule wrapped by this definition or reference combinator. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    return g.flatten(ctx, rule.rule || children[0], p);
  }
  /** Returns the EBNF string of the inner syntax rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes `reserved(wordset, rule)`, recording the referenced wordset and flattening the inner rule. */
export class ReservedNormalizer implements RuleNormalizer {
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    if (typeof rule.value === "string" && rule.value.length > 0) {
      g.usedReservedWordsets.add(rule.value);
    }
    return g.flatten(ctx, rule.rule || children[0], p);
  }
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes `token.immediate(...)`, recording matched terminals as adjacency-constrained (no intervening extras). */
export class TokenImmediateNormalizer implements RuleNormalizer {
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const inner = rule.rule || children[0];
    const compiledRegex = compileRuleToRegex(inner);
    if (
      compiledRegex !== null &&
      compiledRegex.length > 0 &&
      typeof inner === "object" &&
      inner !== null &&
      "type" in inner &&
      (inner as GrammarRuleNode).type !== "TOKEN"
    ) {
      const tokenName = `/${compiledRegex}/`;
      g.terminals.add(tokenName);
      g.immediateTerminals.add(tokenName);
      return [{ sym: tokenName, field: p.field }];
    }
    const res = g.flatten(ctx, inner, p);
    for (const r of res) {
      if (g.terminals.has(r.sym)) {
        g.immediateTerminals.add(r.sym);
      }
    }
    return res;
  }
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes an optional rule (?) by creating an empty epsilon production. */
export class OptionalNormalizer implements RuleNormalizer {
  /** Synthesizes a helper non-terminal with one production matching the child rule and one empty epsilon production. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const optSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);
    if (g.nonTerminals.has(optSym)) return [{ sym: optSym, field: p.field }];

    const childP: FlattenContext = { ...p, canAttachPrec: true };
    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(optSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    g.addProduction(optSym, [], undefined, undefined, false);
    return [{ sym: optSym, field: p.field }];
  }
  /** Formats the optional rule with a trailing question mark (`?`) in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return `${g.getEBNF(getChild(rule))}?`;
  }
}

/** Normalizes a completely blank (epsilon) rule. */
export class BlankNormalizer implements RuleNormalizer {
  /** Returns an empty symbol sequence representing an epsilon transition. */
  normalize(): FlattenResult[] {
    return [];
  }
  /** Returns `"blank"` as the EBNF representation of an empty rule. */
  getEBNF(): string {
    return "blank";
  }
}

/** Attaches an AST field name to the result of a child rule. */
export class FieldNormalizer implements RuleNormalizer {
  /** Registers the field name in `g.fieldToInt` and annotates flattened child symbols with the field name. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const fieldName = rule.value as string | undefined;
    if (fieldName && !g.fieldToInt.has(fieldName)) {
      g.fieldToInt.set(fieldName, g.fieldToInt.size + 1);
    }
    const childP: FlattenContext = { ...p, field: fieldName };
    const res = g.flatten(ctx, children[0], childP);
    if (fieldName) {
      for (const r of res) {
        if (!r.field) {
          r.field = fieldName;
        }
      }
    }
    return res;
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Attaches an AST alias to the result of a child rule. */
export class AliasNormalizer implements RuleNormalizer {
  /** Flattens the child rule and attaches the target alias name to each resulting symbol entry. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const res = g.flatten(ctx, children[0], p);
    for (const r of res) {
      if (!r.alias) {
        r.alias = rule.value as string | undefined;
      }
    }
    return res;
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Attaches LSP semantic token modifiers to the result of a child rule. */
export class SemanticNormalizer implements RuleNormalizer {
  /** Flattens the child rule and attaches the semantic token classification metadata to each resulting symbol entry. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const res = g.flatten(ctx, children[0], p);
    for (const r of res) {
      if (!r.semantic) {
        r.semantic = rule.value as { type: string; modifiers: unknown } | undefined;
      }
    }
    return res;
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes a syntax token by passing through its child rule transparently. */
export class SyntaxTokenNormalizer implements RuleNormalizer {
  /** Transparently flattens the wrapped child rule without introducing additional productions. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    _rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    return g.flatten(ctx, children[0], p);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Extracts synchronization tokens for error recovery and passes through the child rule. */
export class SyncNormalizer implements RuleNormalizer {
  /** Registers synchronization token literals in `g.localSyncTokens` and flattens the child rule. */
  normalize(
    g: NormalizedGrammar,
    ctx: string,
    rule: GrammarRuleNode,
    children: (GrammarRuleNode | string | RegExp)[],
    p: FlattenContext,
  ): FlattenResult[] {
    const tokens = rule.value as string[];
    for (const t of tokens) {
      g.localSyncTokens.add(t);
    }
    return g.flatten(ctx, children[0], p);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: GrammarRuleNode, getChild: (r: GrammarRuleNode) => GrammarRuleInput): string {
    return g.getEBNF(getChild(rule));
  }
}

/**
 * Dispatch table mapping uppercase DSL rule type tags to their corresponding `RuleNormalizer` implementations.
 */
export const RULE_NORMALIZERS: Record<string, RuleNormalizer> = {
  SYMBOL: new SymbolNormalizer(),
  TOKEN: new TokenNormalizer(),
  SEQ: new SeqNormalizer(),
  CHOICE: new ChoiceNormalizer(),
  REPEAT: new RepeatNormalizer(),
  REPEAT1: new Repeat1Normalizer(),
  PREC: new PrecNormalizer(),
  PREC_LEFT: new PrecLeftNormalizer(),
  PREC_RIGHT: new PrecRightNormalizer(),
  PREC_DYNAMIC: new PrecDynamicNormalizer(),
  DEF: new DefRefNormalizer(),
  REF: new DefRefNormalizer(),
  OPTIONAL: new OptionalNormalizer(),
  BLANK: new BlankNormalizer(),
  FIELD: new FieldNormalizer(),
  RESERVED: new ReservedNormalizer(),
  TOKEN_IMMEDIATE: new TokenImmediateNormalizer(),
  ALIAS: new AliasNormalizer(),
  SEMANTIC: new SemanticNormalizer(),
  SYNTAX_TOKEN: new SyntaxTokenNormalizer(), // Transparently pass through syntax tokens
  SYNC: new SyncNormalizer(),
};

/**
 * Converts nested Tree-sitter style DSL rule trees into a flat list of formal BNF-style
 * productions. It handles extracting terminals, synthesizing hidden rules for repetitions
 * and choices, and propagating precedences.
 */
export class NormalizedGrammar {
  /** All flattened productions in the grammar. */
  productions: Production[] = [];
  /** Set of all terminal symbols (tokens) discovered. */
  terminals = new Set<SymbolName>();
  /** Set of all non-terminal symbols (rules) discovered. */
  nonTerminals = new Set<SymbolName>();
  /** The root non-terminal symbol of the grammar (the first declared rule). */
  startSymbol: SymbolName;
  /** The human-readable name of the language grammar. */
  name: string;
  /** Whether unresolved LR conflicts should cause compilation to fail instead of branching via GLR. */
  strictConflicts: boolean;

  /** Monotonically increasing counter for assigning unique `Production.id` values. */
  private nextId = 0;
  /** Counter for generating unique synthetic non-terminal names. */
  public syntheticCount = 0;
  /** Memoization map from structural rule signatures to synthesized non-terminal names. */
  private syntheticCache = new Map<string, string>();
  /** Mapping from synthetic non-terminal symbol names to the grammar rule(s) and wrapped symbol(s) they originate from. */
  public syntheticOrigins = new Map<string, Set<string>>();

  /** Bijective mapping from terminal and non-terminal symbol names to numeric symbol IDs. */
  symToInt = new Map<string, number>();
  /** Mapping from AST field names to 1-indexed numeric field IDs. */
  fieldToInt = new Map<string, number>();
  /** Set of token literals designated as synchronization anchor points for parser error recovery. */
  localSyncTokens = new Set<string>();

  /** Evaluated AST `Rule` trees keyed by their declared rule name. */
  evaluatedRules: Record<string, Rule<string>> = {};
  /** Explicit GLR conflict groups declared in the grammar specification. */
  conflicts: string[][] = [];
  /** Extra trivia rules (e.g., whitespace and comments) allowed between any tokens. */
  extras: Rule<string>[] = [];
  /** List of rule names marked to be inlined / hidden from the public CST. */
  inlineRules: string[] = [];
  /** Fast lookup set for `inlineRules`. */
  inlineSet = new Set<string>();
  /** Active inlining recursion stack to prevent infinite expansion on recursive inline rules. */
  inliningStack = new Set<string>();
  /** Terminals wrapped in `token.immediate(...)` that must match with zero intervening extras. */
  immediateTerminals = new Set<string>();
  /** Mapping from supertype rule names to their constituent subtype symbol names. */
  supertypes = new Map<string, string[]>();
  /** Global precedence levels keyed by rule or precedence group name. */
  globalPrecedences = new Map<string, number>();
  /** Named sets of reserved keyword tokens keyed by wordset name. */
  reservedKeywords = new Map<string, Set<string>>();
  /** Wordset names explicitly referenced by per-rule `reserved(wordset, rule)` wrappers. */
  usedReservedWordsets = new Set<string>();
  /** Keyword string literals automatically extracted using the grammar's `word` token pattern. */
  extractedKeywords?: string[] | undefined;
  /** Symbol references (`$['name']`) recorded per rule context for static grammar validation. */
  symbolRefs = new Map<string, Set<string>>();
  /** Extra symbol names referenced in `extras` or `externals` for reachability analysis. */
  entrySymbols = new Set<string>();
  /** Synthesized PUA format-dispatch sentinels (`\uE000<format>\uE001`) generated from `LanguageOptions.formats`. */
  formatSentinels = new Map<string, { sentinel: string; startRule: string }>();
  /** Static grammar diagnostics computed after flattening. */
  diagnostics: GrammarDiagnostic[] = [];

  /** Records a symbol reference from `ctx` to `target` for undefined-rule checking. */
  recordSymbolRef(ctx: string, target: string): void {
    let refs = this.symbolRefs.get(ctx);
    if (!refs) {
      refs = new Set();
      this.symbolRefs.set(ctx, refs);
    }
    refs.add(target);
  }

  /**
   * Evaluates and flattens a declarative `LanguageOptions` specification into normalized BNF productions.
   */
  constructor(grammar: LanguageOptions) {
    this.name = grammar.name || "Grammar";
    this.strictConflicts = !!grammar.strictConflicts;
    const dummy$ = new Proxy(
      {},
      {
        get: (_target, prop: string) => ({ type: "SYMBOL", value: prop }),
      },
    ) as Record<string, Rule<string>>;
    if (typeof grammar.conflicts === "function") {
      const confs = grammar.conflicts(dummy$) as (GrammarRuleNode | string)[][];
      this.conflicts = confs.map((group) =>
        group
          .map((rule) => {
            if (typeof rule === "string") return rule;
            if (rule.type === "SYMBOL") return String(rule.value || rule.name || "");
            if (rule.type === "TOKEN") {
              const val = rule.value !== undefined ? rule.value : rule.arg;
              return `"${String(val)}"`;
            }
            return "";
          })
          .filter((r) => r !== ""),
      );
    } else {
      this.conflicts = (grammar.conflicts as string[][]) || [];
    }

    if (grammar.extras) {
      this.extras = grammar.extras(dummy$).map(toRule);
      for (const rule of this.extras) {
        this.flatten("_extras", rule, {});
      }
    }

    if (grammar.precedences) {
      const precDef = typeof grammar.precedences === "function" ? grammar.precedences(dummy$) : grammar.precedences;
      if (Array.isArray(precDef)) {
        let precVal = precDef.length;
        for (const group of precDef) {
          if (Array.isArray(group)) {
            for (const rawItem of group) {
              const item =
                typeof rawItem === "object" && rawItem !== null && "value" in rawItem
                  ? (rawItem as GrammarRuleNode).value
                  : typeof rawItem === "object" && rawItem !== null && "name" in rawItem
                    ? (rawItem as GrammarRuleNode).name
                    : rawItem;
              if (typeof item === "string") {
                this.globalPrecedences.set(item, precVal);
                if (item.startsWith('"') && item.endsWith('"')) {
                  this.globalPrecedences.set(item.slice(1, -1), precVal);
                } else {
                  this.globalPrecedences.set(`"${item}"`, precVal);
                }
              }
            }
          }
          precVal--;
        }
      }
    }

    if (grammar.reserved) {
      for (const [key, resolver] of Object.entries(grammar.reserved)) {
        const rules = resolver(dummy$).map(toRule);
        const tokens = new Set<string>();
        const extractToken = (r: Rule<string>) => {
          if (r.type === "SYMBOL") tokens.add(r.value as string);
          else if (r.type === "TOKEN") tokens.add(`"${String(r.value)}"`);
          else if (r.type === "SYNTAX_TOKEN" && r.children) {
            for (const child of r.children) extractToken(child);
          }
        };
        for (const r of rules) extractToken(r);
        this.reservedKeywords.set(key, tokens);
      }
    }

    const inlineOpt = grammar.inline as unknown;
    if (typeof inlineOpt === "function") {
      const strDummy$ = new Proxy({}, { get: (_t, p: string) => p }) as Record<string, string>;
      this.inlineRules = (inlineOpt as (d: Record<string, string>) => string[])(strDummy$) || [];
    } else {
      this.inlineRules = grammar.inline || [];
    }
    this.inlineSet = new Set(this.inlineRules);
    this.startSymbol = Object.keys(grammar.rules ?? {})[0]!; // First rule is start

    if (grammar.primitives && grammar.primitives.multiWordKeywords) {
      for (const mwk of grammar.primitives.multiWordKeywords) {
        this.terminals.add(`"${mwk}"`);
      }
    }
    if (grammar.primitives && grammar.primitives.layout) {
      const { indent, dedent } = grammar.primitives.layout;
      if (indent) {
        this.terminals.add(indent);
        this.entrySymbols.add(indent);
      }
      if (dedent) {
        this.terminals.add(dedent);
        this.entrySymbols.add(dedent);
      }
    }

    const isTerminalRule = (r: Rule<string> | undefined): boolean => {
      if (!r) return false;
      if (r.type === "TOKEN" && r.value) return true;
      if (r.children && r.children.length === 1) {
        if (r.type === "SEMANTIC" || r.type === "ALIAS" || r.type === "SYNTAX_TOKEN") {
          return isTerminalRule(r.children[0]);
        }
      }
      return false;
    };

    // Evaluate all rules to build the graph
    for (const ruleName in grammar.rules) {
      const evalRule = toRule(grammar.rules[ruleName]!(dummy$));
      this.evaluatedRules[ruleName] = evalRule;
      if (isTerminalRule(evalRule)) {
        this.terminals.add(ruleName);
      } else {
        this.nonTerminals.add(ruleName);
      }
    }

    if (grammar.supertypes) {
      const rawSupertypes = typeof grammar.supertypes === "function" ? grammar.supertypes(dummy$) : grammar.supertypes;
      const rawList = Array.isArray(rawSupertypes) ? rawSupertypes : [];
      for (const item of rawList) {
        const itemNode = typeof item === "object" && item !== null ? (item as GrammarRuleNode) : undefined;
        const stName = typeof item === "string" ? item : itemNode?.value || itemNode?.name;
        if (typeof stName === "string") {
          const targetRule = this.evaluatedRules[stName];
          if (targetRule && targetRule.type === "CHOICE") {
            const subTypes: string[] = [];
            const extractSymbols = (r: Rule<string>) => {
              if (r.type === "SYMBOL") {
                subTypes.push(r.value as string);
              } else if (
                (r.type === "CHOICE" ||
                  r.type === "SEMANTIC" ||
                  r.type === "SYNTAX_TOKEN" ||
                  r.type === "ALIAS" ||
                  r.type === "FIELD" ||
                  r.type === "PREC" ||
                  r.type === "PREC_LEFT" ||
                  r.type === "PREC_RIGHT" ||
                  r.type === "PREC_DYNAMIC" ||
                  r.type === "DEF" ||
                  r.type === "REF") &&
                r.children
              ) {
                r.children.forEach(extractSymbols);
              }
            };
            extractSymbols(targetRule);
            this.supertypes.set(stName, subTypes);
          }
        }
      }
    }

    // Tree-sitter style keyword extraction
    let wordKey: string | null = null;
    if (grammar.word) {
      if (typeof grammar.word === "string") {
        wordKey = grammar.word;
      } else if (typeof grammar.word === "function") {
        const res = (grammar.word as (d: Record<string, Rule<string>>) => unknown)(dummy$);
        const resNode = typeof res === "object" && res !== null ? (res as GrammarRuleNode) : undefined;
        wordKey = typeof res === "string" ? res : (resNode?.value as string | undefined) || resNode?.name || null;
      }
    }
    if (wordKey && this.evaluatedRules[wordKey]) {
      let wordRegex: RegExp | null = null;
      const wordRule = this.evaluatedRules[wordKey]!;
      if (wordRule.type === "TOKEN" && wordRule.value) {
        let patternStr = "";
        if (wordRule.value instanceof RegExp || Object.prototype.toString.call(wordRule.value) === "[object RegExp]") {
          patternStr = (wordRule.value as RegExp).source;
        } else if (
          typeof wordRule.value === "string" &&
          wordRule.value.startsWith("/") &&
          wordRule.value.lastIndexOf("/") > 0
        ) {
          patternStr = wordRule.value.substring(1, wordRule.value.lastIndexOf("/"));
        }
        if (patternStr) {
          wordRegex = new RegExp("^(" + patternStr + ")$");
        }
      }

      if (wordRegex) {
        const extractedKeywordSet = new Set<string>();

        function findKeywords(r: Rule<string>) {
          if (r.type === "TOKEN" && r.value && typeof r.value === "string" && !r.value.startsWith("/")) {
            if (wordRegex!.test(r.value)) {
              extractedKeywordSet.add(r.value);
            }
          }
          if (r.children) {
            for (const child of r.children) {
              findKeywords(child);
            }
          }
        }

        for (const rName in this.evaluatedRules) {
          findKeywords(this.evaluatedRules[rName]!);
        }

        if (extractedKeywordSet.size > 0) {
          this.extractedKeywords = Array.from(extractedKeywordSet);
        }
      }
    }

    // Add augmented start symbol
    this.addProduction("_START", [{ sym: this.startSymbol }, { sym: "EOF" }]);

    // Add externals
    if (grammar.externals) {
      const extRules = grammar.externals(dummy$);
      for (const ext of extRules) {
        if (ext.type === "SYMBOL") {
          this.terminals.add(String(ext.value));
          this.entrySymbols.add(String(ext.value));
        }
      }
    }

    // Flatten rules
    for (const [name, rule] of Object.entries(this.evaluatedRules)) {
      const p: FlattenContext = { canAttachPrec: true };
      const globalPrec = this.globalPrecedences.get(name);
      if (globalPrec !== undefined) p.prec = globalPrec;
      const right = this.flatten(name, rule, p);
      this.addProduction(name, right, p.prec, p.assoc, false, p.dynamicPrec);
    }

    // Wire declarative `formats` text entry points into GLR dispatch & reachability
    if (grammar.formats) {
      const existingTerminals = Array.from(this.terminals);
      for (const [fmtKey, fmtDef] of Object.entries(grammar.formats)) {
        if (fmtDef.kind !== "text" || !fmtDef.startRule) continue;
        if (!this.evaluatedRules[fmtDef.startRule]) {
          this.recordSymbolRef("_formats", fmtDef.startRule);
          continue;
        }
        this.entrySymbols.add(fmtDef.startRule);
        const sentinel = `${FORMAT_SENTINEL_START}${fmtKey}${FORMAT_SENTINEL_END}`;
        const quotedSentinel = `"${sentinel}"`;
        const escapedSentinel = `\\uE000${fmtKey}\\uE001`;
        const alreadyDeclared = existingTerminals.some(
          (t) => t === quotedSentinel || t.includes(sentinel) || t.includes(escapedSentinel),
        );
        if (!alreadyDeclared && this.startSymbol) {
          this.formatSentinels.set(fmtKey, { sentinel, startRule: fmtDef.startRule });
          this.terminals.add(quotedSentinel);
          this.addProduction(this.startSymbol, [{ sym: quotedSentinel }, { sym: fmtDef.startRule }]);
        }
      }
    }

    // Ensure symbols that have productions (nonTerminals) are not classified as terminals
    for (const prod of this.productions) {
      this.terminals.delete(prod.left);
    }

    // Build symToInt mapping
    let symId = 1;
    for (const term of this.terminals) {
      if (term === "EOF" || term === "ERROR") continue;
      this.symToInt.set(term, symId++);
    }
    for (const nonTerm of this.nonTerminals) {
      if (nonTerm === "EOF" || nonTerm === "ERROR") continue;
      if (this.symToInt.has(nonTerm)) continue;
      this.symToInt.set(nonTerm, symId++);
    }
    this.symToInt.set("EOF", 1023);

    this.diagnostics = validateGrammar(this);
    if (grammar.strictGrammar || process.env["STRICT_GRAMMAR_VALIDATION"] === "true") {
      const fatalErrors = this.diagnostics.filter((d) => d.severity === "error");
      if (fatalErrors.length > 0) {
        throw new Error(
          `Grammar '${this.name}' failed static validation with ${fatalErrors.length} error(s):\n` +
            fatalErrors.map((d) => `  [${d.code}] ${d.message}`).join("\n"),
        );
      }
    }
  }

  /**
   * Registers a normalized BNF production rule `left -> right` with optional precedence, associativity, and CST metadata.
   */
  addProduction(
    left: SymbolName,
    right: {
      sym: SymbolName;
      alias?: string | undefined;
      field?: string | undefined;
      semantic?: { type: string; modifiers: unknown } | undefined;
    }[],
    prec?: number,
    assoc?: "left" | "right",
    isList = false,
    dynamicPrec?: number,
  ) {
    const syms = right.map((r) => r.sym);
    const aliases = right.map((r, i) => (r.alias ? { index: i, target: r.alias } : null)).filter((a) => a !== null) as {
      index: number;
      target: string;
    }[];
    const fields = right
      .map((r, i) => (r.field ? { index: i, fieldId: this.fieldToInt.get(r.field)! } : null))
      .filter((a) => a !== null) as {
      index: number;
      fieldId: number;
    }[];
    const semantics = right
      .map((r, i) => (r.semantic ? { index: i, type: r.semantic.type, modifiers: r.semantic.modifiers } : null))
      .filter((a) => a !== null) as {
      index: number;
      type: string;
      modifiers: unknown;
    }[];

    this.productions.push({
      id: this.nextId++,
      left,
      right: syms,
      prec,
      assoc,
      dynamicPrec,
      isInvisible: left.startsWith("_") || this.inlineRules.includes(left),
      isList,
      aliases: aliases.length > 0 ? aliases : undefined,
      fields: fields.length > 0 ? fields : undefined,
      semantics: semantics.length > 0 ? semantics : undefined,
    });
    this.nonTerminals.add(left);
    for (const a of aliases) {
      if (!this.terminals.has(a.target)) {
        this.nonTerminals.add(a.target);
      }
    }
    for (const r of right) {
      const _sym = r.sym;
      void _sym;
      // If it's not a known non-terminal or synthetic, we can guess it might be terminal,
      // but actual terminal identification will be refined.
    }
  }

  /**
   * Formats a DSL rule tree into a human-readable EBNF string by delegating to the rule's `RuleNormalizer`.
   */
  getEBNF(rule: GrammarRuleInput): string {
    if (typeof rule === "string") return rule;
    if (rule instanceof RegExp || Object.prototype.toString.call(rule) === "[object RegExp]") {
      return `/${(rule as RegExp).source}/`;
    }
    if (!rule || !rule.type) return "unknown";

    const getChild = (r: GrammarRuleNode): GrammarRuleInput => {
      if (!r) return null;
      if (r.arg !== undefined) return r.arg as GrammarRuleInput;
      if (r.children && r.children.length > 0) return r.children[0];
      if (r.args && r.args.length > 0) return r.args[0];
      return null;
    };

    const getChildren = (r: GrammarRuleNode): (GrammarRuleNode | string | RegExp)[] => {
      if (!r) return [];
      if (r.children) return r.children;
      if (r.args) return r.args;
      if (r.arg !== undefined) return [r.arg as GrammarRuleNode | string | RegExp];
      return [];
    };

    const normalizer = RULE_NORMALIZERS[rule.type.toUpperCase()];
    if (normalizer) {
      return normalizer.getEBNF(this, rule, getChild, getChildren);
    }
    return "unknown";
  }

  /**
   * Computes a structural signature string for `rule` that includes `field`, `alias`, and `semanticToken` annotations for deduplicating synthetic rules.
   */
  getRuleSignature(rule: GrammarRuleInput): string {
    if (typeof rule === "string") return rule;
    if (rule instanceof RegExp || Object.prototype.toString.call(rule) === "[object RegExp]") {
      return `/${(rule as RegExp).source}/`;
    }
    if (!rule || !rule.type) return "unknown";

    const getChild = (r: GrammarRuleNode): GrammarRuleInput => {
      if (!r) return null;
      if (r.arg !== undefined) return r.arg as GrammarRuleInput;
      if (r.children && r.children.length > 0) return r.children[0];
      if (r.args && r.args.length > 0) return r.args[0];
      return null;
    };

    const getChildren = (r: GrammarRuleNode): (GrammarRuleNode | string | RegExp)[] => {
      if (!r) return [];
      if (r.children) return r.children;
      if (r.args) return r.args;
      if (r.arg !== undefined) return [r.arg as GrammarRuleNode | string | RegExp];
      return [];
    };

    const t = rule.type.toUpperCase();
    if (t === "FIELD") return `field(${String(rule.value)},${this.getRuleSignature(getChild(rule))})`;
    if (t === "ALIAS") return `alias(${String(rule.value)},${this.getRuleSignature(getChild(rule))})`;
    if (t === "SEMANTIC" || t === "SEMANTIC_TOKEN") {
      const valType = (rule.value as { type?: string } | undefined)?.type ?? rule.value;
      return `sem(${String(valType)},${this.getRuleSignature(getChild(rule))})`;
    }
    if (t === "SEQ")
      return `(${getChildren(rule)
        .map((c) => this.getRuleSignature(c))
        .join(" ")})`;
    if (t === "CHOICE")
      return `(${getChildren(rule)
        .map((c) => this.getRuleSignature(c))
        .join(" | ")})`;
    if (t === "REPEAT") return `${this.getRuleSignature(getChild(rule))}*`;
    if (t === "REPEAT1") return `${this.getRuleSignature(getChild(rule))}+`;
    if (t === "OPTIONAL") return `${this.getRuleSignature(getChild(rule))}?`;
    if (t === "PREC") return `prec(${String(rule.value)},${this.getRuleSignature(getChild(rule))})`;
    if (t === "PREC_LEFT") return `prec.left(${String(rule.value)},${this.getRuleSignature(getChild(rule))})`;
    if (t === "PREC_RIGHT") return `prec.right(${String(rule.value)},${this.getRuleSignature(getChild(rule))})`;
    if (t === "PREC_DYNAMIC") return `prec.dynamic(${String(rule.value)},${this.getRuleSignature(getChild(rule))})`;
    if (t === "SYNTAX_TOKEN") return this.getRuleSignature(getChild(rule));
    if (t === "DEF" || t === "REF" || t === "DEF_REF") return this.getRuleSignature(rule.rule || getChild(rule));
    return this.getEBNF(rule);
  }

  /**
   * Allocates or retrieves a cached synthetic non-terminal symbol name (prefixed with `_`) for a composite rule.
   */
  nextSynthetic(
    ebnf: string,
    p: {
      prec?: number | undefined;
      assoc?: "left" | "right" | undefined;
      dynamicPrec?: number | undefined;
      field?: string | undefined;
    },
    rule?: GrammarRuleNode,
    ctx?: string,
  ): string {
    const sig = rule ? this.getRuleSignature(rule) : ebnf;
    const cacheKey = `${sig}#${p.prec}#${p.assoc}#${p.dynamicPrec}#${p.field}`;
    let symName = this.syntheticCache.get(cacheKey);
    if (!symName) {
      const bounded = ebnf.length > 48 ? `${ebnf.slice(0, 40)}_${fnv1aHex(sig)}` : ebnf;
      symName = `_${bounded}`;
      let counter = 1;
      while (this.nonTerminals.has(symName)) {
        symName = `_${bounded}_${counter++}`;
      }
      this.syntheticCache.set(cacheKey, symName);
    }

    if (ctx || rule) {
      if (!this.syntheticOrigins.has(symName)) {
        this.syntheticOrigins.set(symName, new Set());
      }
      const set = this.syntheticOrigins.get(symName)!;
      if (ctx) {
        set.add(ctx);
        const parentOrigins = this.syntheticOrigins.get(ctx);
        if (parentOrigins) {
          for (const o of parentOrigins) set.add(o);
        }
      }
      if (rule) {
        if (rule.value && typeof rule.value === "string") set.add(rule.value);
        if (rule.name && typeof rule.name === "string") set.add(rule.name);
        const children = rule.children || rule.args || (rule.arg !== undefined ? [rule.arg] : []);
        for (const c of children) {
          if (c && typeof c === "object") {
            const childNode = c as GrammarRuleNode;
            if (childNode.type === "SYMBOL" && (childNode.value || childNode.name)) {
              set.add(String(childNode.value || childNode.name));
            } else if (childNode.value && typeof childNode.value === "string") {
              set.add(childNode.value);
            }
          }
        }
      }
    }

    return symName;
  }

  /**
   * Recursively flattens a nested DSL `Rule` within `contextName` into a flat sequence of `FlattenResult` symbol references.
   */
  // Returns the symbol name representing this rule
  flatten(contextName: string, rule: Rule | GrammarRuleInput, p: FlattenContext): FlattenResult[] {
    if (!rule) {
      throw new Error(
        `Invalid grammar rule encountered in context '${contextName}'. This usually means an array contains undefined or a referenced rule is missing.`,
      );
    }

    let node: GrammarRuleNode;
    if (
      typeof rule === "string" ||
      rule instanceof RegExp ||
      Object.prototype.toString.call(rule) === "[object RegExp]"
    ) {
      node = { type: "TOKEN", value: rule };
    } else {
      node = rule as GrammarRuleNode;
    }
    const ruleType = (node.type || "").toUpperCase();
    const children =
      node.children || node.args || (node.arg !== undefined ? [node.arg as GrammarRuleNode | string | RegExp] : []);

    const normalizer = RULE_NORMALIZERS[ruleType];
    if (normalizer) {
      return normalizer.normalize(this, contextName, node, children, p);
    }

    console.error("UNKNOWN RULE:", node);
    throw new Error(`Unknown rule type: ${node.type}`);
  }
}

function fnv1aHex(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i++) {
    hash ^= input.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return (hash >>> 0).toString(16).padStart(8, "0");
}

/**
 * Runs static validation checks over a `NormalizedGrammar` before LR automaton construction:
 * - `undefined-rule`: `$['name']` references that are not declared in `rules`, `terminals`, or `externals`
 * - `unreachable-rule`: declared rules unreachable from `startSymbol` or `extras`
 * - `unproductive-rule`: non-terminals that cannot derive any finite terminal string
 * - `nullable-repeat`: `repeat()` / `repeat1()` whose body can derive epsilon (infinite empty-reduction loop)
 */
export function validateGrammar(grammar: NormalizedGrammar): GrammarDiagnostic[] {
  const diagnostics: GrammarDiagnostic[] = [];
  const declaredRules = Object.keys(grammar.evaluatedRules);
  if (declaredRules.length === 0) return diagnostics;

  // 1. Undefined rule references
  for (const [ctx, refs] of grammar.symbolRefs.entries()) {
    for (const target of refs) {
      if (target === "EOF" || target === "ERROR") continue;
      if (!grammar.evaluatedRules[target] && !grammar.terminals.has(target) && !grammar.nonTerminals.has(target)) {
        diagnostics.push({
          code: "undefined-rule",
          severity: "error",
          rule: ctx,
          message: `Rule '${ctx}' references undefined symbol '${target}'.`,
        });
      }
    }
  }

  // 2. Nullable set (fixed-point)
  const nullable = new Set<string>();
  let changed = true;
  while (changed) {
    changed = false;
    for (const prod of grammar.productions) {
      if (nullable.has(prod.left)) continue;
      if (prod.right.length === 0 || prod.right.every((sym) => nullable.has(sym))) {
        nullable.add(prod.left);
        changed = true;
      }
    }
  }

  // 3. Nullable repetition loops (isList recursive step whose body is empty or all-nullable)
  const reportedRepeats = new Set<string>();
  for (const prod of grammar.productions) {
    if (!prod.isList || prod.right.length === 0) continue;
    if (prod.right[0] !== prod.left) continue;
    const body = prod.right.slice(1);
    if (body.length === 0 || body.every((sym) => nullable.has(sym))) {
      if (!reportedRepeats.has(prod.left)) {
        reportedRepeats.add(prod.left);
        const origins = grammar.syntheticOrigins.get(prod.left);
        const originRule = origins ? Array.from(origins).find((o) => !!grammar.evaluatedRules[o]) : undefined;
        diagnostics.push({
          code: "nullable-repeat",
          severity: "error",
          rule: originRule ?? prod.left,
          message: `Repetition '${prod.left}'${originRule ? ` in rule '${originRule}'` : ""} matches an empty string on every iteration (nullable body inside repeat/repeat1).`,
        });
      }
    }
  }

  // 4. Productive non-terminals (fixed-point)
  const productive = new Set<string>(grammar.terminals);
  productive.add("EOF");
  productive.add("ERROR");
  changed = true;
  while (changed) {
    changed = false;
    for (const prod of grammar.productions) {
      if (productive.has(prod.left)) continue;
      if (prod.right.length === 0 || prod.right.every((sym) => productive.has(sym))) {
        productive.add(prod.left);
        changed = true;
      }
    }
  }
  for (const ruleName of declaredRules) {
    if (grammar.nonTerminals.has(ruleName) && !productive.has(ruleName)) {
      diagnostics.push({
        code: "unproductive-rule",
        severity: "error",
        rule: ruleName,
        message: `Non-terminal '${ruleName}' is unproductive (cannot derive any terminal string).`,
      });
    }
  }

  // 5. Unreachable rules from startSymbol / _extras / entrySymbols
  const prodsByLhs = new Map<string, Production[]>();
  for (const prod of grammar.productions) {
    let list = prodsByLhs.get(prod.left);
    if (!list) {
      list = [];
      prodsByLhs.set(prod.left, list);
    }
    list.push(prod);
  }
  const reachable = new Set<string>();
  const queue: string[] = [];
  if (grammar.startSymbol) queue.push(grammar.startSymbol);
  for (const entry of grammar.entrySymbols) queue.push(entry);
  for (const [ctx, refs] of grammar.symbolRefs.entries()) {
    if (ctx === "_extras") {
      for (const r of refs) queue.push(r);
    }
  }
  for (let qHead = 0; qHead < queue.length; qHead++) {
    const sym = queue[qHead]!;
    if (reachable.has(sym)) continue;
    reachable.add(sym);
    const prods = prodsByLhs.get(sym);
    if (prods) {
      for (const prod of prods) {
        for (const rhsSym of prod.right) {
          if (!reachable.has(rhsSym)) queue.push(rhsSym);
        }
      }
    }
  }
  for (const ruleName of declaredRules) {
    if (!reachable.has(ruleName) && !grammar.inlineSet.has(ruleName)) {
      diagnostics.push({
        code: "unreachable-rule",
        severity: "warning",
        rule: ruleName,
        message: `Rule '${ruleName}' is unreachable from start symbol '${grammar.startSymbol}'.`,
      });
    }
  }

  return diagnostics;
}
