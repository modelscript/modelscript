// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Grammar normalization and BNF production flattening for DSL language definitions.
 */

import { LanguageOptions, Rule, toRule } from "./language.js";

/** A type alias for string, representing a grammar symbol (terminal or non-terminal) */
export type SymbolName = string;

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
  semantics?: { index: number; type: string; modifiers: any }[] | undefined;
}

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
  semantic?: { type: string; modifiers: any } | undefined;
}

/**
 * Strategy interface for translating DSL rule trees into flattened BNF productions.
 */
export interface RuleNormalizer {
  /** Flattens a DSL rule node and its children into a sequence of `FlattenResult` items, registering synthetic productions on `g` as needed. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[];
  /** Returns a canonical EBNF string representation of `rule` used for naming and deduplicating synthetic rules. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: (r: any) => any, getChildren: (r: any) => any[]): string;
}

/** Normalizes a direct symbol reference. */
export class SymbolNormalizer implements RuleNormalizer {
  /** Returns a single `FlattenResult` referencing the target symbol name with the inherited field context. */
  normalize(_g: NormalizedGrammar, _ctx: string, rule: any, _children: any[], p: FlattenContext): FlattenResult[] {
    return [{ sym: rule.value, field: p.field }];
  }
  /** Formats the referenced symbol name as its literal EBNF identifier. */
  getEBNF(_g: NormalizedGrammar, rule: any): string {
    return rule.value as string;
  }
}

/** Normalizes a terminal token (string or regex), extracting it into the grammar's terminal set. */
export class TokenNormalizer implements RuleNormalizer {
  /** Registers the string literal or regular expression in `g.terminals` and returns its terminal symbol reference. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, _children: any[], p: FlattenContext): FlattenResult[] {
    if (rule.children && rule.children.length > 0 && rule.value === undefined) {
      return g.flatten(ctx, rule.children[0], p);
    }
    const val = rule.value !== undefined ? rule.value : rule.arg;
    if (
      typeof val !== "string" &&
      !(val instanceof RegExp || Object.prototype.toString.call(val) === "[object RegExp]")
    ) {
      throw new Error(`Invalid token value in context '${ctx}': expected string or RegExp, got ${typeof val}`);
    }
    let tokenName = val.toString();
    if (typeof val === "string") {
      tokenName = `"${val}"`;
    }
    g.terminals.add(tokenName);
    return [{ sym: tokenName, field: p.field }];
  }
  /** Formats the token pattern as a quoted string literal or `/regex/` in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    if (rule.children && rule.children.length > 0 && rule.value === undefined) {
      return g.getEBNF(getChild(rule));
    }
    return typeof rule.value === "string"
      ? `"${rule.value}"`
      : rule.value instanceof RegExp || Object.prototype.toString.call(rule.value) === "[object RegExp]"
        ? `/${rule.value.source}/`
        : "token";
  }
}

/** Normalizes a sequence of rules by concatenating their flattened results. */
export class SeqNormalizer implements RuleNormalizer {
  /** Flattens each child rule in order and concatenates their resulting symbol sequences. */
  normalize(g: NormalizedGrammar, ctx: string, _rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const seqSyms: FlattenResult[] = [];
    for (const child of children) {
      seqSyms.push(...g.flatten(ctx, child, { ...p }));
    }
    return seqSyms;
  }
  /** Formats the sequence as a parenthesized space-separated list of child EBNF expressions. */
  getEBNF(g: NormalizedGrammar, rule: any, _getChild: any, getChildren: any): string {
    return `(${getChildren(rule)
      .map((c: any) => g.getEBNF(c))
      .join(" ")})`;
  }
}

/** Normalizes a choice of rules by creating a synthetic non-terminal with multiple productions. */
export class ChoiceNormalizer implements RuleNormalizer {
  /** Synthesizes a helper non-terminal with one production per alternative branch and returns a reference to it. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const choiceSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);
    if (g.nonTerminals.has(choiceSym)) return [{ sym: choiceSym, field: p.field }];

    for (const child of children) {
      const childP: FlattenContext = { ...p };
      const childSyms = g.flatten(ctx, child, childP);
      g.addProduction(choiceSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    }
    return [{ sym: choiceSym, field: p.field }];
  }
  /** Formats the alternation as a parenthesized `|`-separated list of child EBNF expressions. */
  getEBNF(g: NormalizedGrammar, rule: any, _getChild: any, getChildren: any): string {
    return `(${getChildren(rule)
      .map((c: any) => g.getEBNF(c))
      .join(" | ")})`;
  }
}

/** Normalizes a zero-or-more repetition (*), creating a recursive synthetic list production. */
export class RepeatNormalizer implements RuleNormalizer {
  /** Synthesizes a left-recursive list non-terminal with a recursive step production and an empty base production. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP: FlattenContext = { ...p };
    const childSyms = g.flatten(ctx, children[0], childP);
    const repeatSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);

    if (g.nonTerminals.has(repeatSym)) return [{ sym: repeatSym, field: p.field }];

    g.addProduction(repeatSym, [{ sym: repeatSym }, ...childSyms], childP.prec, childP.assoc, true, childP.dynamicPrec);
    g.addProduction(repeatSym, [], undefined, undefined, true);
    return [{ sym: repeatSym, field: p.field }];
  }
  /** Formats the repetition with a trailing Kleene star (`*`) in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return `${g.getEBNF(getChild(rule))}*`;
  }
}

/** Normalizes a one-or-more repetition (+), creating a recursive synthetic list production. */
export class Repeat1Normalizer implements RuleNormalizer {
  /** Synthesizes a left-recursive list non-terminal with a single-element base production and a recursive step production. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP: FlattenContext = { ...p };
    const childSyms = g.flatten(ctx, children[0], childP);
    const repeatSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);

    if (g.nonTerminals.has(repeatSym)) return [{ sym: repeatSym, field: p.field }];

    g.addProduction(repeatSym, childSyms, childP.prec, childP.assoc, true, childP.dynamicPrec);
    g.addProduction(repeatSym, [{ sym: repeatSym }, ...childSyms], childP.prec, childP.assoc, true, childP.dynamicPrec);
    return [{ sym: repeatSym, field: p.field }];
  }
  /** Formats the one-or-more repetition with a trailing Kleene plus (`+`) in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return `${g.getEBNF(getChild(rule))}+`;
  }
}

/** Propagates static precedence to child rules without associativity. */
export class PrecNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying the specified static precedence level. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, prec: rule.value !== undefined ? rule.value : rule.precedence };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP, rule, ctx);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym, field: p.field }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym, field: p.field }];
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Propagates static precedence with left-associativity to child rules. */
export class PrecLeftNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying static precedence and `"left"` associativity. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, prec: rule.value !== undefined ? rule.value : rule.precedence, assoc: "left" as const };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP, rule, ctx);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym, field: p.field }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym, field: p.field }];
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Propagates static precedence with right-associativity to child rules. */
export class PrecRightNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying static precedence and `"right"` associativity. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, prec: rule.value !== undefined ? rule.value : rule.precedence, assoc: "right" as const };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP, rule, ctx);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym, field: p.field }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym, field: p.field }];
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Propagates dynamic precedence for runtime GLR conflict resolution. */
export class PrecDynamicNormalizer implements RuleNormalizer {
  /** Wraps the child rule in a synthetic non-terminal carrying the specified dynamic precedence value. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, dynamicPrec: rule.value !== undefined ? rule.value : rule.precedence };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP, rule, ctx);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym, field: p.field }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym, field: p.field }];
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes symbol definition (`DEF`), reference (`REF`), `RESERVED`, and `TOKEN_IMMEDIATE` wrapper rules by delegating to their inner syntax rule. */
export class DefRefNormalizer implements RuleNormalizer {
  /** Flattens the inner syntax rule wrapped by this definition or reference combinator. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    return g.flatten(ctx, rule.rule || children[0], p);
  }
  /** Returns the EBNF string of the inner syntax rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes an optional rule (?) by creating an empty epsilon production. */
export class OptionalNormalizer implements RuleNormalizer {
  /** Synthesizes a helper non-terminal with one production matching the child rule and one empty epsilon production. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const optSym = g.nextSynthetic(g.getEBNF(rule), p, rule, ctx);
    if (g.nonTerminals.has(optSym)) return [{ sym: optSym, field: p.field }];

    const childSyms = g.flatten(ctx, children[0], p);
    g.addProduction(optSym, childSyms, p.prec, p.assoc, false, p.dynamicPrec);
    g.addProduction(optSym, [], undefined, undefined, false);
    return [{ sym: optSym, field: p.field }];
  }
  /** Formats the optional rule with a trailing question mark (`?`) in EBNF notation. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
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
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const fieldName = rule.value;
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
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Attaches an AST alias to the result of a child rule. */
export class AliasNormalizer implements RuleNormalizer {
  /** Flattens the child rule and attaches the target alias name to each resulting symbol entry. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const res = g.flatten(ctx, children[0], p);
    for (const r of res) {
      if (!r.alias) {
        r.alias = rule.value;
      }
    }
    return res;
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Attaches LSP semantic token modifiers to the result of a child rule. */
export class SemanticNormalizer implements RuleNormalizer {
  /** Flattens the child rule and attaches the semantic token classification metadata to each resulting symbol entry. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const res = g.flatten(ctx, children[0], p);
    for (const r of res) {
      if (!r.semantic) {
        r.semantic = rule.value;
      }
    }
    return res;
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Normalizes a syntax token by passing through its child rule transparently. */
export class SyntaxTokenNormalizer implements RuleNormalizer {
  /** Transparently flattens the wrapped child rule without introducing additional productions. */
  normalize(g: NormalizedGrammar, ctx: string, _rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    return g.flatten(ctx, children[0], p);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

/** Extracts synchronization tokens for error recovery and passes through the child rule. */
export class SyncNormalizer implements RuleNormalizer {
  /** Registers synchronization token literals in `g.localSyncTokens` and flattens the child rule. */
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const tokens = rule.value as string[];
    for (const t of tokens) {
      g.localSyncTokens.add(t);
    }
    return g.flatten(ctx, children[0], p);
  }
  /** Returns the EBNF string of the underlying child rule. */
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
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
  RESERVED: new DefRefNormalizer(),
  TOKEN_IMMEDIATE: new DefRefNormalizer(),
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
  evaluatedRules: Record<string, Rule<any>> = {};
  /** Explicit GLR conflict groups declared in the grammar specification. */
  conflicts: string[][] = [];
  /** Extra trivia rules (e.g., whitespace and comments) allowed between any tokens. */
  extras: Rule<any>[] = [];
  /** List of rule names marked to be inlined / hidden from the public CST. */
  inlineRules: string[] = [];
  /** Mapping from supertype rule names to their constituent subtype symbol names. */
  supertypes = new Map<string, string[]>();
  /** Global precedence levels keyed by rule or precedence group name. */
  globalPrecedences = new Map<string, number>();
  /** Named sets of reserved keyword tokens keyed by wordset name. */
  reservedKeywords = new Map<string, Set<string>>();
  /** Keyword string literals automatically extracted using the grammar's `word` token pattern. */
  extractedKeywords?: string[] | undefined;

  /**
   * Evaluates and flattens a declarative `LanguageOptions` specification into normalized BNF productions.
   */
  constructor(grammar: LanguageOptions<any>) {
    this.name = grammar.name || "Grammar";
    this.strictConflicts = !!grammar.strictConflicts;
    const dummy$ = new Proxy(
      {},
      {
        get: (_target, prop: string) => ({ type: "SYMBOL", value: prop }),
      },
    );
    if (typeof grammar.conflicts === "function") {
      const confs = grammar.conflicts(dummy$ as any) as any[][];
      this.conflicts = confs.map((group) =>
        group
          .map((rule) => {
            if (typeof rule === "string") return rule;
            if (rule.type === "SYMBOL") return rule.value || rule.name;
            if (rule.type === "TOKEN") {
              const val = rule.value !== undefined ? rule.value : rule.arg;
              return `"${val}"`;
            }
            return "";
          })
          .filter((r) => r !== ""),
      );
    } else {
      this.conflicts = (grammar.conflicts as string[][]) || [];
    }

    if (grammar.extras) {
      this.extras = grammar.extras(dummy$ as any).map(toRule);
      for (const rule of this.extras) {
        this.flatten("_extras", rule, {});
      }
    }

    if (grammar.precedences) {
      let precVal = grammar.precedences.length;
      for (const group of grammar.precedences) {
        for (const item of group) {
          this.globalPrecedences.set(item, precVal);
        }
        precVal--;
      }
    }

    if (grammar.reserved) {
      for (const [key, resolver] of Object.entries(grammar.reserved)) {
        const rules = resolver(dummy$ as any).map(toRule);
        const tokens = new Set<string>();
        const extractToken = (r: Rule<any>) => {
          if (r.type === "SYMBOL") tokens.add(r.value as string);
          else if (r.type === "TOKEN") tokens.add(`"${r.value}"`);
          else if (r.type === "SYNTAX_TOKEN" && r.children) {
            for (const child of r.children) extractToken(child);
          }
        };
        for (const r of rules) extractToken(r);
        this.reservedKeywords.set(key, tokens);
      }
    }

    this.inlineRules = grammar.inline || [];
    this.startSymbol = Object.keys(grammar.rules ?? {})[0]!; // First rule is start

    if (grammar.primitives && grammar.primitives.multiWordKeywords) {
      for (const mwk of grammar.primitives.multiWordKeywords) {
        this.terminals.add(`"${mwk}"`);
      }
    }

    const isTerminalRule = (r: any): boolean => {
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
      const evalRule = toRule(grammar.rules[ruleName]!(dummy$ as any));
      this.evaluatedRules[ruleName] = evalRule;
      if (isTerminalRule(evalRule)) {
        console.log(`grammar.ts: added ${ruleName} to terminals`);
        this.terminals.add(ruleName);
      } else {
        console.log(`grammar.ts: added ${ruleName} to nonTerminals (type: ${evalRule.type})`);
        this.nonTerminals.add(ruleName);
      }
    }

    if (grammar.supertypes) {
      const stRules = grammar.supertypes(dummy$ as any).map(toRule);
      for (const stRule of stRules) {
        if (stRule.type === "SYMBOL") {
          const stName = stRule.value as string;
          const targetRule = this.evaluatedRules[stName];
          if (targetRule && targetRule.type === "CHOICE") {
            const subTypes: string[] = [];
            const extractSymbols = (r: Rule<any>) => {
              if (r.type === "SYMBOL") {
                subTypes.push(r.value as string);
              } else if (r.type === "CHOICE" && r.children) {
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
        const dummy$ = new Proxy({}, { get: (_t, p: string) => ({ type: "SYMBOL", value: p }) });
        const res = (grammar.word as any)(dummy$);
        wordKey = typeof res === "string" ? res : res?.value || res?.name;
      }
    }
    if (wordKey && this.evaluatedRules[wordKey]) {
      let wordRegex: RegExp | null = null;
      const wordRule = this.evaluatedRules[wordKey]!;
      if (wordRule.type === "TOKEN" && wordRule.value) {
        let patternStr = "";
        if (wordRule.value instanceof RegExp || Object.prototype.toString.call(wordRule.value) === "[object RegExp]") {
          patternStr = wordRule.value.source;
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
        const extractedKeywords: string[] = [];

        function findKeywords(r: Rule<any>) {
          if (r.type === "TOKEN" && r.value && typeof r.value === "string" && !r.value.startsWith("/")) {
            if (wordRegex!.test(r.value)) {
              if (!extractedKeywords.includes(r.value)) {
                extractedKeywords.push(r.value);
              }
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

        if (extractedKeywords.length > 0) {
          this.extractedKeywords = extractedKeywords;
        }
      }
    }

    // Add augmented start symbol
    this.addProduction("_START", [{ sym: this.startSymbol }, { sym: "EOF" }]);

    // Add externals
    if (grammar.externals) {
      const extRules = grammar.externals(dummy$ as any);
      for (const ext of extRules) {
        if (ext.type === "SYMBOL") {
          this.terminals.add(ext.value);
        }
      }
    }

    // Flatten rules
    for (const [name, rule] of Object.entries(this.evaluatedRules)) {
      const p: { prec?: number | undefined; assoc?: "left" | "right" | undefined; dynamicPrec?: number | undefined } =
        {};
      const globalPrec = this.globalPrecedences.get(name);
      if (globalPrec !== undefined) p.prec = globalPrec;
      const right = this.flatten(name, rule, p);
      this.addProduction(name, right, p.prec, p.assoc, false, p.dynamicPrec);
    }

    // Ensure symbols that have productions (nonTerminals) are not classified as terminals
    for (const nt of this.nonTerminals) {
      this.terminals.delete(nt);
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
      semantic?: { type: string; modifiers: any } | undefined;
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
      modifiers: any;
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
      this.nonTerminals.add(a.target);
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
  getEBNF(rule: any): string {
    if (typeof rule === "string") return rule;
    if (rule instanceof RegExp || Object.prototype.toString.call(rule) === "[object RegExp]") return `/${rule.source}/`;
    if (!rule || !rule.type) return "unknown";

    const getChild = (r: any): any => {
      if (!r) return null;
      if (r.arg) return r.arg;
      if (r.children && r.children.length > 0) return r.children[0];
      if (r.args && r.args.length > 0) return r.args[0];
      return null;
    };

    const getChildren = (r: any): any[] => {
      if (!r) return [];
      if (r.children) return r.children;
      if (r.args) return r.args;
      if (r.arg) return [r.arg];
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
  getRuleSignature(rule: any): string {
    if (typeof rule === "string") return rule;
    if (rule instanceof RegExp || Object.prototype.toString.call(rule) === "[object RegExp]") return `/${rule.source}/`;
    if (!rule || !rule.type) return "unknown";

    const getChild = (r: any): any => {
      if (!r) return null;
      if (r.arg) return r.arg;
      if (r.children && r.children.length > 0) return r.children[0];
      if (r.args && r.args.length > 0) return r.args[0];
      return null;
    };

    const getChildren = (r: any): any[] => {
      if (!r) return [];
      if (r.children) return r.children;
      if (r.args) return r.args;
      if (r.arg) return [r.arg];
      return [];
    };

    const t = rule.type.toUpperCase();
    if (t === "FIELD") return `field(${rule.value},${this.getRuleSignature(getChild(rule))})`;
    if (t === "ALIAS") return `alias(${rule.value},${this.getRuleSignature(getChild(rule))})`;
    if (t === "SEMANTIC_TOKEN") return `sem(${rule.value?.type},${this.getRuleSignature(getChild(rule))})`;
    if (t === "SEQ")
      return `(${getChildren(rule)
        .map((c: any) => this.getRuleSignature(c))
        .join(" ")})`;
    if (t === "CHOICE")
      return `(${getChildren(rule)
        .map((c: any) => this.getRuleSignature(c))
        .join(" | ")})`;
    if (t === "REPEAT") return `${this.getRuleSignature(getChild(rule))}*`;
    if (t === "REPEAT1") return `${this.getRuleSignature(getChild(rule))}+`;
    if (t === "OPTIONAL") return `${this.getRuleSignature(getChild(rule))}?`;
    if (t === "PREC" || t === "PREC_LEFT" || t === "PREC_RIGHT" || t === "PREC_DYNAMIC" || t === "SYNTAX_TOKEN") {
      return this.getRuleSignature(getChild(rule));
    }
    if (t === "DEF_REF") return this.getRuleSignature(rule.rule || getChild(rule));
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
    rule?: any,
    ctx?: string,
  ): string {
    const sig = rule ? this.getRuleSignature(rule) : ebnf;
    const cacheKey = `${sig}#${p.prec}#${p.assoc}#${p.dynamicPrec}#${p.field}`;
    let symName = this.syntheticCache.get(cacheKey);
    if (!symName) {
      symName = `_${ebnf}`;
      let counter = 1;
      while (this.nonTerminals.has(symName)) {
        symName = `_${ebnf}_${counter++}`;
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
        const children = rule.children || rule.args || (rule.arg ? [rule.arg] : []);
        for (const c of children) {
          if (c && typeof c === "object") {
            if (c.type === "SYMBOL" && (c.value || c.name)) {
              set.add(c.value || c.name);
            } else if (c.value && typeof c.value === "string") {
              set.add(c.value);
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
  flatten(contextName: string, rule: Rule | any, p: FlattenContext): FlattenResult[] {
    if (!rule) {
      throw new Error(
        `Invalid grammar rule encountered in context '${contextName}'. This usually means an array contains undefined or a referenced rule is missing.`,
      );
    }

    if (
      typeof rule === "string" ||
      rule instanceof RegExp ||
      Object.prototype.toString.call(rule) === "[object RegExp]"
    ) {
      rule = { type: "TOKEN", value: rule };
    }
    const ruleType = (rule.type || "").toUpperCase();
    const children = rule.children || rule.args || (rule.arg ? [rule.arg] : []);

    const normalizer = RULE_NORMALIZERS[ruleType];
    if (normalizer) {
      return normalizer.normalize(this, contextName, rule, children, p);
    }

    console.error("UNKNOWN RULE:", rule);
    throw new Error(`Unknown rule type: ${rule.type}`);
  }
}
