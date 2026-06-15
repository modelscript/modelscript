import { LanguageOptions, Rule, toRule } from "./dsl.js";

export type SymbolName = string;

export interface Production {
  id: number;
  left: SymbolName;
  right: SymbolName[];
  prec?: number;
  assoc?: "left" | "right";
  dynamicPrec?: number;
  isInvisible: boolean;
  isList: boolean;
  aliases?: { index: number; target: string }[];
}

export class NormalizedGrammar {
  productions: Production[] = [];
  terminals = new Set<SymbolName>();
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
            if (rule.type === "SYMBOL") return rule.value;
            if (rule.type === "TOKEN") return `"${rule.value}"`;
            return "";
          })
          .filter((r) => r !== ""),
      );
    } else {
      this.conflicts = (grammar.conflicts as string[][]) || [];
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
    switch (rule.type) {
      case "SYMBOL":
        return [{ sym: rule.value }];

      case "TOKEN": {
        let tokenName = rule.value.toString();
        if (typeof rule.value === "string") {
          tokenName = `"${rule.value}"`;
        }
        this.terminals.add(tokenName);
        return [{ sym: tokenName }];
      }

      case "SEQ": {
        const seqSyms: { sym: SymbolName; alias?: string }[] = [];
        for (const child of rule.children || []) {
          seqSyms.push(...this.flatten(contextName, child, p));
        }
        return seqSyms;
      }

      case "CHOICE": {
        const choiceSym = this.nextSynthetic();
        for (const child of rule.children || []) {
          const childP: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number } = { ...p };
          const childSyms = this.flatten(contextName, child, childP);
          this.addProduction(choiceSym, childSyms, childP.prec, childP.assoc, false, childP.dynamicPrec);
        }
        return [{ sym: choiceSym }];
      }

      case "REPEAT": {
        const childP: { prec?: number; assoc?: "left" | "right"; dynamicPrec?: number } = { ...p };
        const childSyms = this.flatten(contextName, (rule.children || [])[0], childP);
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

      case "PREC":
        p.prec = rule.value;
        return this.flatten(contextName, rule.children![0], p);

      case "PREC_LEFT":
        p.prec = rule.value;
        p.assoc = "left";
        return this.flatten(contextName, rule.children![0], p);

      case "PREC_RIGHT":
        p.prec = rule.value;
        p.assoc = "right";
        return this.flatten(contextName, rule.children![0], p);

      case "PREC_DYNAMIC":
        (p as any).dynamicPrec = rule.value;
        return this.flatten(contextName, rule.children![0], p);

      case "FIELD":
      case "RESERVED":
      case "TOKEN_IMMEDIATE": {
        // Ignored for raw grammar parsing (used later for AST building)
        return this.flatten(contextName, (rule.children || [])[0], p);
      }

      case "ALIAS": {
        const res = this.flatten(contextName, (rule.children || [])[0], p);
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
        return this.flatten(contextName, (rule.children || [])[0], p);
      }

      default:
        console.error("UNKNOWN RULE:", rule);
        throw new Error(`Unknown rule type: ${rule.type}`);
    }
  }
}
