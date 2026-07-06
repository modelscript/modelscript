import { LanguageOptions, Rule, toRule } from "./dsl.js";

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
  prec?: number;
  /** Optional associativity for shift/reduce conflict resolution. */
  assoc?: "left" | "right";
  /** Optional dynamic precedence for GLR runtime tie-breaking. */
  dynamicPrec?: number;
  /** True if this production is a synthetic helper or marked inline, and should not appear in AST */
  isInvisible: boolean;
  /** True if this production represents a list (e.g. from repeat or repeat1 rules). */
  isList: boolean;
  /** AST node renaming aliases assigned to specific RHS symbols. */
  aliases?: { index: number; target: string }[];
  /** AST named fields assigned to specific RHS symbols. */
  fields?: { index: number; fieldId: number }[];
  /** Semantic token assignments applied to specific RHS symbols. */
  semantics?: { index: number; type: string; modifiers: any }[];
}

export interface FlattenContext {
  prec?: number;
  assoc?: "left" | "right";
  dynamicPrec?: number;
}

export interface FlattenResult {
  sym: SymbolName;
  alias?: string;
  field?: string;
  semantic?: { type: string; modifiers: any };
}

export interface RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[];
  getEBNF(g: NormalizedGrammar, rule: any, getChild: (r: any) => any, getChildren: (r: any) => any[]): string;
}

export class SymbolNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    return [{ sym: rule.value }];
  }
  getEBNF(g: NormalizedGrammar, rule: any): string {
    return rule.value as string;
  }
}

export class TokenNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const val = rule.value !== undefined ? rule.value : rule.arg;
    if (typeof val !== "string" && !(val instanceof RegExp)) {
      throw new Error(`Invalid token value in context '${ctx}': expected string or RegExp, got ${typeof val}`);
    }
    let tokenName = val.toString();
    if (typeof val === "string") {
      tokenName = `"${val}"`;
    }
    g.terminals.add(tokenName);
    return [{ sym: tokenName }];
  }
  getEBNF(g: NormalizedGrammar, rule: any): string {
    return typeof rule.value === "string"
      ? `"${rule.value}"`
      : rule.value instanceof RegExp
        ? `/${rule.value.source}/`
        : "token";
  }
}

export class SeqNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const seqSyms: FlattenResult[] = [];
    for (const child of children) {
      seqSyms.push(...g.flatten(ctx, child, { ...p }));
    }
    return seqSyms;
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any, getChildren: any): string {
    return `(${getChildren(rule)
      .map((c: any) => g.getEBNF(c))
      .join(" ")})`;
  }
}

export class ChoiceNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const choiceSym = g.nextSynthetic(g.getEBNF(rule), p);
    if (g.nonTerminals.has(choiceSym)) return [{ sym: choiceSym }];

    for (const child of children) {
      const childP: FlattenContext = { ...p };
      const childSyms = g.flatten(ctx, child, childP);
      g.addProduction(choiceSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    }
    return [{ sym: choiceSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any, getChildren: any): string {
    return `(${getChildren(rule)
      .map((c: any) => g.getEBNF(c))
      .join(" | ")})`;
  }
}

export class RepeatNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP: FlattenContext = { ...p };
    const childSyms = g.flatten(ctx, children[0], childP);
    const repeatSym = g.nextSynthetic(g.getEBNF(rule), p);

    if (g.nonTerminals.has(repeatSym)) return [{ sym: repeatSym }];

    g.addProduction(repeatSym, [{ sym: repeatSym }, ...childSyms], childP.prec, childP.assoc, true, childP.dynamicPrec);
    g.addProduction(repeatSym, [], undefined, undefined, true);
    return [{ sym: repeatSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return `${g.getEBNF(getChild(rule))}*`;
  }
}

export class Repeat1Normalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP: FlattenContext = { ...p };
    const childSyms = g.flatten(ctx, children[0], childP);
    const repeatSym = g.nextSynthetic(g.getEBNF(rule), p);

    if (g.nonTerminals.has(repeatSym)) return [{ sym: repeatSym }];

    g.addProduction(repeatSym, childSyms, childP.prec, childP.assoc, true, childP.dynamicPrec);
    g.addProduction(repeatSym, [{ sym: repeatSym }, ...childSyms], childP.prec, childP.assoc, true, childP.dynamicPrec);
    return [{ sym: repeatSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return `${g.getEBNF(getChild(rule))}+`;
  }
}

export class PrecNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, prec: rule.value !== undefined ? rule.value : rule.precedence };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class PrecLeftNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, prec: rule.value !== undefined ? rule.value : rule.precedence, assoc: "left" as const };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class PrecRightNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, prec: rule.value !== undefined ? rule.value : rule.precedence, assoc: "right" as const };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class PrecDynamicNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const childP = { ...p, dynamicPrec: rule.value !== undefined ? rule.value : rule.precedence };
    const precSym = g.nextSynthetic(g.getEBNF(rule), childP);
    if (g.nonTerminals.has(precSym)) return [{ sym: precSym }];

    const childSyms = g.flatten(ctx, children[0], childP);
    g.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
    return [{ sym: precSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class DefRefNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    return g.flatten(ctx, rule.rule || children[0], p);
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class OptionalNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const optSym = g.nextSynthetic(g.getEBNF(rule), p);
    if (g.nonTerminals.has(optSym)) return [{ sym: optSym }];

    const childSyms = g.flatten(ctx, children[0], p);
    g.addProduction(optSym, childSyms, p.prec, p.assoc, false, p.dynamicPrec);
    g.addProduction(optSym, [], undefined, undefined, true);
    return [{ sym: optSym }];
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return `${g.getEBNF(getChild(rule))}?`;
  }
}

export class BlankNormalizer implements RuleNormalizer {
  normalize(): FlattenResult[] {
    return [];
  }
  getEBNF(): string {
    return "blank";
  }
}

export class FieldNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const fieldName = rule.value;
    if (fieldName && !g.fieldToInt.has(fieldName)) {
      g.fieldToInt.set(fieldName, g.fieldToInt.size + 1);
    }
    const res = g.flatten(ctx, children[0], p);
    if (fieldName) {
      for (const r of res) {
        r.field = fieldName;
      }
    }
    return res;
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class AliasNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const res = g.flatten(ctx, children[0], p);
    if (res.length === 1) {
      res[0].alias = rule.value;
    }
    return res;
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class SemanticNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const res = g.flatten(ctx, children[0], p);
    if (res.length === 1) {
      res[0].semantic = rule.value;
    }
    return res;
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

export class SyncNormalizer implements RuleNormalizer {
  normalize(g: NormalizedGrammar, ctx: string, rule: any, children: any[], p: FlattenContext): FlattenResult[] {
    const tokens = rule.value as string[];
    for (const t of tokens) {
      g.localSyncTokens.add(t);
    }
    return g.flatten(ctx, children[0], p);
  }
  getEBNF(g: NormalizedGrammar, rule: any, getChild: any): string {
    return g.getEBNF(getChild(rule));
  }
}

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
  startSymbol: SymbolName;

  private nextId = 0;
  private syntheticCount = 0;
  private syntheticCache = new Map<string, string>();

  symToInt = new Map<string, number>();
  fieldToInt = new Map<string, number>();
  localSyncTokens = new Set<string>();

  evaluatedRules: Record<string, Rule<any>> = {};
  conflicts: string[][] = [];
  extras: Rule<any>[] = [];
  inlineRules: string[] = [];
  supertypes = new Map<string, string[]>();
  globalPrecedences = new Map<string, number>();
  reservedKeywords = new Map<string, Set<string>>();
  extractedKeywords?: string[];

  constructor(grammar: LanguageOptions<any>) {
    const dummy$ = new Proxy(
      {},
      {
        get: (target, prop: string) => ({ type: "SYMBOL", value: prop }),
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
    console.log("Loaded conflicts:", this.conflicts);

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
        for (const r of rules) {
          if (r.type === "SYMBOL") tokens.add(r.value as string);
          else if (r.type === "TOKEN") tokens.add(`"${r.value}"`);
        }
        this.reservedKeywords.set(key, tokens);
      }
    }

    this.inlineRules = grammar.inline || [];
    this.startSymbol = Object.keys(grammar.rules)[0]; // First rule is start

    if (grammar.primitives && grammar.primitives.multiWordKeywords) {
      for (const mwk of grammar.primitives.multiWordKeywords) {
        this.terminals.add(`"${mwk}"`);
      }
    }

    // Evaluate all rules to build the graph
    for (const ruleName in grammar.rules) {
      this.evaluatedRules[ruleName] = toRule(grammar.rules[ruleName](dummy$ as any));
      this.nonTerminals.add(ruleName);
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
    if (grammar.word && this.evaluatedRules[grammar.word]) {
      let wordRegex: RegExp | null = null;
      const wordRule = this.evaluatedRules[grammar.word];
      if (wordRule.type === "TOKEN" && wordRule.value) {
        let patternStr = "";
        if (wordRule.value instanceof RegExp) {
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
          findKeywords(this.evaluatedRules[rName]);
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
      const p: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number } = {};
      const globalPrec = this.globalPrecedences.get(name);
      if (globalPrec !== undefined) p.prec = globalPrec;
      const right = this.flatten(name, rule, p);
      this.addProduction(name, right, p.prec, p.assoc, false, p.dynamicPrec);
    }

    // Build symToInt mapping
    let symId = 1;
    for (const term of this.terminals) {
      if (term === "EOF" || term === "ERROR") continue;
      this.symToInt.set(term, symId++);
    }
    for (const nonTerm of this.nonTerminals) {
      if (nonTerm === "EOF" || nonTerm === "ERROR") continue;
      this.symToInt.set(nonTerm, symId++);
    }
    this.symToInt.set("EOF", 1023);
  }

  addProduction(
    left: SymbolName,
    right: { sym: SymbolName; alias?: string; field?: string; semantic?: { type: string; modifiers: any } }[],
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
      const sym = r.sym;
      // If it's not a known non-terminal or synthetic, we can guess it might be terminal,
      // but actual terminal identification will be refined.
    }
  }

  getEBNF(rule: any): string {
    if (typeof rule === "string") return rule;
    if (rule instanceof RegExp) return `/${rule.source}/`;
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

  nextSynthetic(ebnf: string, p: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number }): string {
    const cacheKey = `${ebnf}#${p.prec}#${p.assoc}#${p.dynamicPrec}`;
    if (this.syntheticCache.has(cacheKey)) {
      return this.syntheticCache.get(cacheKey)!;
    }

    let symName = `_${ebnf}`;
    let counter = 1;
    while (this.nonTerminals.has(symName)) {
      symName = `_${ebnf}_${counter++}`;
    }

    this.syntheticCache.set(cacheKey, symName);
    return symName;
  }

  // Returns the symbol name representing this rule
  flatten(contextName: string, rule: Rule | any, p: FlattenContext): FlattenResult[] {
    if (!rule) {
      throw new Error(
        `Invalid grammar rule encountered in context '${contextName}'. This usually means an array contains undefined or a referenced rule is missing.`,
      );
    }

    if (typeof rule === "string" || rule instanceof RegExp) {
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
