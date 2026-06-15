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
}

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

  symToInt = new Map<string, number>();
  localSyncTokens = new Set<string>();

  evaluatedRules: Record<string, Rule> = {};
  conflicts: string[][] = [];
  extras: Rule[] = [];
  inlineRules: string[] = [];
  supertypes = new Map<string, string[]>();
  globalPrecedences = new Map<string, number>();
  reservedKeywords = new Map<string, Set<string>>();

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
            const extractSymbols = (r: Rule) => {
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

        function findKeywords(r: Rule) {
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
          const keywordRules: Rule[] = extractedKeywords.map((kw) => ({ type: "TOKEN", value: kw }));
          this.evaluatedRules[grammar.word] = {
            type: "CHOICE",
            children: [wordRule, ...keywordRules],
          };
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

  private addProduction(
    left: SymbolName,
    right: { sym: SymbolName; alias?: string }[],
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

  private nextSynthetic(): string {
    return `_SYN_${this.syntheticCount++}`;
  }

  // Returns the symbol name representing this rule
  private flatten(
    contextName: string,
    rule: Rule | any,
    p: { prec?: number; assoc?: "left" | "right" },
  ): { sym: SymbolName; alias?: string }[] {
    if (typeof rule === "string" || rule instanceof RegExp) {
      rule = { type: "TOKEN", value: rule };
    }
    const ruleType = rule.type || "";
    const children = rule.children || rule.args || (rule.arg ? [rule.arg] : []);
    switch (ruleType) {
      case "SYMBOL":
        return [{ sym: rule.value }];

      case "TOKEN": {
        const val = rule.value !== undefined ? rule.value : rule.arg;
        let tokenName = val.toString();
        if (typeof val === "string") {
          tokenName = `"${val}"`;
        }
        this.terminals.add(tokenName);
        return [{ sym: tokenName }];
      }

      case "SEQ": {
        const seqSyms: { sym: SymbolName; alias?: string }[] = [];
        for (const child of children) {
          const childP: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number } = { ...p };
          seqSyms.push(...this.flatten(contextName, child, childP));
        }
        return seqSyms;
      }

      case "CHOICE": {
        const choiceSym = this.nextSynthetic();
        for (const child of children) {
          const childP: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number } = { ...p };
          const childSyms = this.flatten(contextName, child, childP);
          this.addProduction(choiceSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
        }
        return [{ sym: choiceSym }];
      }

      case "REPEAT":
      case "REPEAT1": {
        const childP: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number } = { ...p };
        const childSyms = this.flatten(contextName, children[0], childP);
        const repeatSym = this.nextSynthetic();

        // repeatSym -> repeatSym childSyms | epsilon
        this.addProduction(
          repeatSym,
          [{ sym: repeatSym }, ...childSyms],
          childP.prec,
          childP.assoc,
          true,
          childP.dynamicPrec,
        );
        this.addProduction(repeatSym, [], undefined, undefined, true); // Epsilon production
        return [{ sym: repeatSym }];
      }

      case "PREC": {
        const precSym = this.nextSynthetic();
        const childP = { ...p, prec: rule.value || rule.precedence };
        const childSyms = this.flatten(contextName, children[0], childP);
        this.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, (childP as any).dynamicPrec);
        return [{ sym: precSym }];
      }

      case "PREC_LEFT": {
        const precSym = this.nextSynthetic();
        const childP = { ...p, prec: rule.value || rule.precedence, assoc: "left" as const };
        const childSyms = this.flatten(contextName, children[0], childP);
        this.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, (childP as any).dynamicPrec);
        return [{ sym: precSym }];
      }

      case "PREC_RIGHT": {
        const precSym = this.nextSynthetic();
        const childP = { ...p, prec: rule.value || rule.precedence, assoc: "right" as const };
        const childSyms = this.flatten(contextName, children[0], childP);
        this.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, (childP as any).dynamicPrec);
        return [{ sym: precSym }];
      }

      case "PREC_DYNAMIC": {
        const precSym = this.nextSynthetic();
        const childP = { ...p, dynamicPrec: rule.value || rule.precedence };
        const childSyms = this.flatten(contextName, children[0], childP);
        this.addProduction(precSym, childSyms, childP.prec, childP.assoc, false, (childP as any).dynamicPrec);
        return [{ sym: precSym }];
      }

      case "DEF":
      case "REF":
        return this.flatten(contextName, rule.rule || children[0], p);

      case "OPTIONAL": {
        const optSym = this.nextSynthetic();
        const childSyms = this.flatten(contextName, children[0], p);
        this.addProduction(optSym, childSyms, p.prec, p.assoc, false, (p as any).dynamicPrec);
        this.addProduction(optSym, [], undefined, undefined, true);
        return [{ sym: optSym }];
      }

      case "BLANK":
        return [];

      case "FIELD":
      case "RESERVED":
      case "TOKEN_IMMEDIATE": {
        // Ignored for raw grammar parsing (used later for AST building)
        return this.flatten(contextName, children[0], p);
      }

      case "ALIAS": {
        const res = this.flatten(contextName, children[0], p);
        if (res.length === 1) {
          res[0].alias = rule.value;
        }
        return res;
      }

      case "SYNC": {
        const tokens = rule.value as string[];
        for (const t of tokens) {
          this.localSyncTokens.add(t);
        }
        return this.flatten(contextName, children[0], p);
      }

      default:
        console.error("UNKNOWN RULE:", rule);
        throw new Error(`Unknown rule type: ${rule.type}`);
    }
  }
}
