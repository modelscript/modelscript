// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileRegexToDFA } from "../../dsl/automata.js";
import { compileRuleToRegex, NormalizedGrammar } from "../../dsl/grammar.js";
import type { LanguageOptions, Rule } from "../../dsl/language.js";
import { toRule } from "../../dsl/language.js";
import { buildSymIntToEnumNameMap } from "../emitters/types.js";
import { transpileQuery } from "../transpiler/transpiler.js";

/**
 * Generates an AssemblyScript DFA-based lexer state machine for the specified grammar.
 * Emits code for UTF-8/UTF-16 character decoding, string literal matching,
 * regex DFA state transitions, whitespace/comment skipping, and multi-word keyword lookahead.
 *
 * @param grammar Language configuration options from the DSL.
 * @param normalized Normalized grammar containing symbol-to-integer mappings.
 * @returns AssemblyScript source code string for the lexer.
 */
export function toCodePoints(str: string): number[] {
  const result: number[] = [];
  for (const ch of str) {
    result.push(ch.codePointAt(0)!);
  }
  return result;
}

interface LexerRuleMeta {
  type?: string;
  value?: unknown;
  name?: string;
  rule?: Rule<string>;
  arg?: Rule<string>;
  args?: Rule<string>[];
  children?: Rule<string>[];
}

export function generateLexer(grammar: LanguageOptions, normalized: NormalizedGrammar): string {
  // Extract all token patterns from the grammar rules
  const stringTokens = new Map<string, string>();
  const regexTokens = new Map<string, string>();

  function extractTokens(rule: Rule<string>) {
    if (!rule) return;
    if (
      typeof rule === "string" ||
      rule instanceof RegExp ||
      Object.prototype.toString.call(rule) === "[object RegExp]"
    ) {
      rule = { type: "TOKEN", value: rule } as unknown as Rule<string>;
    }
    const meta = rule as unknown as LexerRuleMeta;
    const ruleType = (rule.type || "").toUpperCase();
    const ruleValue = rule.value !== undefined ? rule.value : meta.arg;
    if (ruleType === "TOKEN" && ruleValue === undefined && rule.children && rule.children.length > 0) {
      const compiled = compileRuleToRegex(rule.children[0]);
      if (compiled !== null && compiled.length > 0) {
        const key = `/${compiled}/`;
        regexTokens.set(key, key);
        return;
      }
    }
    if (ruleType === "TOKEN_IMMEDIATE" && rule.children && rule.children.length > 0) {
      const inner = rule.children[0]!;
      if ((inner.type || "").toUpperCase() !== "TOKEN") {
        const compiled = compileRuleToRegex(inner);
        if (compiled !== null && compiled.length > 0) {
          const key = `/${compiled}/`;
          regexTokens.set(key, key);
          return;
        }
      }
    }
    if (ruleType === "TOKEN" && ruleValue) {
      const isRegex =
        ruleValue instanceof RegExp ||
        Object.prototype.toString.call(ruleValue) === "[object RegExp]" ||
        (typeof ruleValue === "string" && ruleValue.startsWith("/") && ruleValue.endsWith("/") && ruleValue.length > 1);
      const key = ruleValue.toString();

      if (isRegex) {
        regexTokens.set(key, key);
      } else {
        stringTokens.set(key, ruleValue as string);
      }
    }
    const children = rule.children || meta.args || (meta.arg ? [meta.arg] : []) || (meta.rule ? [meta.rule] : []);
    if (children) {
      for (const child of children) {
        extractTokens(child);
      }
    }
    if (meta.rule) {
      extractTokens(meta.rule);
    }
  }

  for (const ruleName in grammar.rules) {
    const dummy$ = new Proxy(
      {},
      {
        get: (_target, prop: string) => ({ type: "SYMBOL", value: prop }),
      },
    );
    const rule = toRule(grammar.rules[ruleName]!(dummy$ as never));
    extractTokens(rule);
  }

  if (normalized.extras) {
    for (const rule of normalized.extras) {
      extractTokens(rule);
    }
  }

  for (const { sentinel } of normalized.formatSentinels.values()) {
    stringTokens.set(sentinel, sentinel);
  }

  let wordRegex: RegExp | null = null;
  let wordName: string | null = null;

  if (grammar.word) {
    const dummy$ = new Proxy({}, { get: (_t, p: string) => ({ type: "SYMBOL", value: p }) });
    let wResult: unknown = grammar.word;
    if (typeof grammar.word === "function") {
      wResult = (grammar.word as (d: never) => unknown)(dummy$ as never);
    }
    const wordRule = toRule(wResult as Parameters<typeof toRule>[0]);
    const wordMeta = wordRule as unknown as LexerRuleMeta;
    if (wordRule.type === "SYMBOL") {
      wordName = wordRule.value as string;
    } else {
      wordName = wordMeta.name || wordMeta.value?.toString() || null;
    }
  }

  if (wordName && grammar.rules?.[wordName]) {
    const dummy$ = new Proxy({}, { get: (_target, prop: string) => ({ type: "SYMBOL", value: prop }) });
    let rule = toRule(grammar.rules[wordName]!(dummy$ as never));
    let rType = (rule.type || "").toUpperCase();
    if (rType === "DEF" || rType === "REF") {
      const meta = rule as unknown as LexerRuleMeta;
      rule =
        meta.rule || (meta.args ? meta.args[0] : null) || (rule.children ? rule.children[0] : null) || meta.arg || rule;
      rType = (rule.type || "").toUpperCase();
    }
    if (rType === "TOKEN" && rule.value) {
      let patternStr = "";
      if (rule.value instanceof RegExp || Object.prototype.toString.call(rule.value) === "[object RegExp]") {
        patternStr = (rule.value as RegExp).source;
      } else if (typeof rule.value === "string" && rule.value.startsWith("/") && rule.value.lastIndexOf("/") > 0) {
        patternStr = rule.value.substring(1, rule.value.lastIndexOf("/"));
      }
      if (patternStr) {
        wordRegex = new RegExp("^(" + patternStr + ")$");
      }
    }

    if (!wordRegex) {
      // Hardcode common identifier patterns if it's a complex rule
      wordRegex = new RegExp("^([a-zA-Z_][a-zA-Z0-9_]*)$");
    }
  }

  // Force IDENT into regexTokens if it's missing so the DFA generates it!
  if (wordName && !grammar.rules?.[wordName] && !regexTokens.has(wordName)) {
    // Inject generic word pattern only if wordName is not already a rule in the grammar
    regexTokens.set(wordName, "/[_a-zA-Z][_a-zA-Z0-9]*/");
  }

  /** Returns the key of the first regex token whose pattern fully accepts `probe`. */
  const findRegexTokenAccepting = (probe: string): string | undefined => {
    for (const [key, val] of regexTokens.entries()) {
      const body = val.startsWith("/") && val.lastIndexOf("/") > 0 ? val.substring(1, val.lastIndexOf("/")) : val;
      try {
        if (new RegExp("^(?:" + body + ")$").test(probe)) return key;
      } catch {
        // Not compilable by the JS engine; skip.
      }
    }
    return undefined;
  };
  let lexerGlobals = `// DFA Lexer State Machine\n`;
  lexerGlobals += `// Extracted ${stringTokens.size} string literals and ${regexTokens.size} regex patterns\n\n`;

  let lexerCode = ``;

  lexerCode += `\nexport let is_extra_token: usize = 0;\n`;
  lexerCode += `export function initExtras(): void {\n`;
  lexerCode += `  if (is_extra_token == 0) {\n    let extraCap: u32 = ((MAX_TERMINAL_ID as u32) + 1) > 2048 ? ((MAX_TERMINAL_ID as u32) + 1) : 2048;\n    is_extra_token = atomicChunkAlloc(extraCap);\n    memory.fill(is_extra_token, 0, extraCap);\n  }\n`;
  const idToEnumName = buildSymIntToEnumNameMap(normalized);
  const extraTerminalIds = new Set<number>();
  const extraTokenPatterns: (string | RegExp)[] = [];

  const collectExtraTokens = (r: unknown, visited: Set<string>) => {
    if (!r) return;
    if (typeof r === "string") {
      extraTokenPatterns.push(r);
      const id = normalized.symToInt.get(`"${r}"`) ?? normalized.symToInt.get(r);
      if (id !== undefined) extraTerminalIds.add(id);
      return;
    }
    if (r instanceof RegExp || Object.prototype.toString.call(r) === "[object RegExp]") {
      extraTokenPatterns.push(r as RegExp);
      const id = normalized.symToInt.get((r as RegExp).toString());
      if (id !== undefined) extraTerminalIds.add(id);
      return;
    }
    if (typeof r !== "object") return;
    const obj = r as LexerRuleMeta & { child?: unknown };
    const t = (obj.type || "").toUpperCase();
    if (t === "SYMBOL") {
      const symName = obj.name || String(obj.value ?? "");
      const symInt = normalized.symToInt.get(symName);
      if (symInt !== undefined) extraTerminalIds.add(symInt);
      if (symName && !visited.has(symName) && normalized.evaluatedRules[symName]) {
        visited.add(symName);
        collectExtraTokens(normalized.evaluatedRules[symName], visited);
      }
      return;
    }
    if (t === "TOKEN") {
      if (obj.value !== undefined) {
        if (
          typeof obj.value === "string" ||
          obj.value instanceof RegExp ||
          Object.prototype.toString.call(obj.value) === "[object RegExp]"
        ) {
          extraTokenPatterns.push(obj.value as string | RegExp);
          let val = String(obj.value);
          if (typeof obj.value === "string" && !(val.startsWith("/") && val.endsWith("/"))) {
            val = `"${obj.value}"`;
          }
          const id = normalized.symToInt.get(val);
          if (id !== undefined) extraTerminalIds.add(id);
        }
        return;
      }
      if (obj.children && obj.children.length > 0) {
        const compiled = compileRuleToRegex(obj.children[0]);
        if (compiled !== null && compiled.length > 0) {
          const key = `/${compiled}/`;
          try {
            extraTokenPatterns.push(new RegExp(compiled));
          } catch {
            // ignore uncompilable JS regex
          }
          const id = normalized.symToInt.get(key);
          if (id !== undefined) extraTerminalIds.add(id);
          return;
        }
        for (const c of obj.children) collectExtraTokens(c, visited);
        return;
      }
    }
    if (obj.rule) collectExtraTokens(obj.rule, visited);
    if (obj.arg) collectExtraTokens(obj.arg, visited);
    if (obj.child) collectExtraTokens(obj.child, visited);
    if (obj.children) {
      for (const c of obj.children) collectExtraTokens(c, visited);
    }
    if (obj.args) {
      for (const c of obj.args) collectExtraTokens(c, visited);
    }
  };

  if (normalized.extras) {
    for (const rule of normalized.extras) {
      collectExtraTokens(rule, new Set<string>());
    }
  }
  for (const mappedInt of extraTerminalIds) {
    lexerCode += `  store<u8>(is_extra_token + <u32>${mappedInt}, 1);\n`;
  }
  lexerCode += `}\n`;

  lexerCode += `export let inputEncoding: u8 = 1;
`;
  lexerCode += `export function setInputEncoding(enc: u8): void { inputEncoding = enc == 2 ? 2 : 1; }

// Internal decode helpers (pos and inputLength are in UTF-16 code units, 1:1 with JS string indices)
@inline
export function peekChar(pos: u32): i32 {
    if (pos >= inputLength) return 0;
    let buf: usize = getInputBuffer() + ((pos as usize) << 1);
    let b0: u32 = load<u16>(buf);
    if (b0 >= 0xD800 && b0 <= 0xDBFF && pos + 1 < inputLength) {
        let b1: u32 = load<u16>(buf + 2);
        if (b1 >= 0xDC00 && b1 <= 0xDFFF) {
            return ((b0 - 0xD800) << 10) + (b1 - 0xDC00) + 0x10000;
        }
    }
    return b0;
}

@inline
export function peekCharLen(pos: u32): u32 {
    if (pos >= inputLength) return 0;
    let buf: usize = getInputBuffer() + ((pos as usize) << 1);
    let b0: u32 = load<u16>(buf);
    if (b0 >= 0xD800 && b0 <= 0xDBFF && pos + 1 < inputLength) {
        let b1: u32 = load<u16>(buf + 2);
        if (b1 >= 0xDC00 && b1 <= 0xDFFF) return 2;
    }
    return 1;
}

@inline
export function peekPrevChar(pos: u32): i32 {
    if (pos == 0 || pos > inputLength) return 0;
    let buf: usize = getInputBuffer();
    let b0: u32 = load<u16>(buf + (((pos - 1) as usize) << 1));
    if (b0 >= 0xDC00 && b0 <= 0xDFFF && pos >= 2) {
        let b1: u32 = load<u16>(buf + (((pos - 2) as usize) << 1));
        if (b1 >= 0xD800 && b1 <= 0xDBFF) {
            return ((b1 - 0xD800) << 10) + (b0 - 0xDC00) + 0x10000;
        }
    }
    return b0;
}

@inline
export function peekPrevCharLen(pos: u32): u32 {
    if (pos == 0 || pos > inputLength) return 0;
    let buf: usize = getInputBuffer();
    let b0: u32 = load<u16>(buf + (((pos - 1) as usize) << 1));
    if (b0 >= 0xDC00 && b0 <= 0xDFFF && pos >= 2) {
        let b1: u32 = load<u16>(buf + (((pos - 2) as usize) << 1));
        if (b1 >= 0xD800 && b1 <= 0xDBFF) return 2;
    }
    return 1;
}
`;
  lexerCode += `export let inputLength: u32 = 0;
`;
  lexerCode += `export function setInputLength(len: u32): void { inputLength = len; }
`;

  lexerCode += `export let lexLen: u32 = 0;
export function setLexLen(val: u32): void { lexLen = val; }
`;
  lexerCode += `export let lexPos: u32 = 0;
export function setLexPos(val: u32): void { lexPos = val; }
`;
  lexerCode += `export let srcLexLen: u32 = 0;
`;
  lexerCode += `export let srcLexPos: u32 = 0;
export function setSrcLexPos(val: u32): void { srcLexPos = val; }
`;
  lexerCode += `export let currentScannerState: u32 = 0; // Semantic Lexer Hack State
export function setCurrentScannerState(val: u32): void { currentScannerState = val; }

`;

  lexerCode += `export function getLexLen(): u32 { return lexLen; }\n`;
  lexerCode += `export function lex(pos: u32): i32 {\n`;
  lexerCode += `  lexLen = 0;\n`;
  lexerCode += `  lexPos = pos;\n`;
  lexerCode += `  srcLexPos = pos;\n`;
  lexerCode += `  srcLexLen = 0;\n`;
  lexerCode += `  if (lexPos >= inputLength) { return 1023; } // EOF\n`;

  const scannerRunAfterExtras = !!(
    grammar.scanner &&
    typeof grammar.scanner === "object" &&
    "runAfterExtras" in grammar.scanner &&
    (grammar.scanner as { runAfterExtras?: boolean }).runAfterExtras
  );

  const emitExternalScannerBlock = (rewindExpr: string): string => {
    let block = `  // --- External Scanner --- \n`;
    block += `  scanMarkedEnd = false;\n`;
    block += `  let extToken = scanExternal(lexPos, currentScannerState);\n`;
    block += `  if (extToken != 0) {\n`;
    block += `    lexLen = srcLexLen;\n`;
    block += `    lexPos = srcLexPos + lexLen;\n`;
    block += `    scanMarkedEnd = false;\n`;
    block += `    return extToken;\n`;
    block += `  } else {\n`;
    block += `    lexPos = ${rewindExpr};\n`;
    block += `    srcLexPos = ${rewindExpr};\n`;
    block += `    lexLen = 0;\n`;
    block += `    srcLexLen = 0;\n`;
    block += `    scanMarkedEnd = false;\n`;
    block += `  }\n\n`;
    return block;
  };

  // Inject External Scanner before extras by default (for scanners inspecting leading whitespace/newlines)
  if (grammar.scanner && !scannerRunAfterExtras) {
    lexerCode += emitExternalScannerBlock("pos");
  }

  // Determine which whitespace code points are actually matched by declared `extras`
  // so line-oriented grammars (e.g. `extras: () => [/[ \t]+/]`) do not have `\n`/`\r` silently eaten.
  const extraMatchesChar = (ch: string): boolean => {
    for (const pat of extraTokenPatterns) {
      if (typeof pat === "string") {
        if (pat.startsWith("/") && pat.lastIndexOf("/") > 0) {
          const lastSlash = pat.lastIndexOf("/");
          try {
            if (new RegExp("^(?:" + pat.slice(1, lastSlash) + ")$", pat.slice(lastSlash + 1)).test(ch)) return true;
          } catch {
            // ignore
          }
        } else if (pat === ch) {
          return true;
        }
      } else {
        try {
          if (new RegExp("^(?:" + pat.source + ")$", pat.flags).test(ch)) return true;
        } catch {
          // ignore
        }
      }
    }
    return false;
  };

  const wsSkipCodePoints: number[] = [];
  if (extraMatchesChar(" ")) wsSkipCodePoints.push(32, 0xfeff);
  if (extraMatchesChar("\t")) wsSkipCodePoints.push(9);
  if (extraMatchesChar("\n")) wsSkipCodePoints.push(10);
  if (extraMatchesChar("\r")) wsSkipCodePoints.push(13);
  const hasWhitespaceExtra = wsSkipCodePoints.length > 0;

  const sp = (
    grammar as LanguageOptions & {
      primitives?: {
        nestedComment?: { open: string; close: string };
        lineComment?: string;
        escapedIdent?: { quote: string; escape?: string };
        stringLiteral?: { delim: string; escapes?: Record<string, number> };
        multiWordKeywords?: string[];
        layout?: { indent: string; dedent: string };
      };
    }
  ).primitives;

  // Python-style indentation layout scanner state (emitted only when `primitives.layout` is configured)
  const layoutIndentId = sp?.layout
    ? (normalized.symToInt.get(sp.layout.indent) ?? normalized.symToInt.get(`"${sp.layout.indent}"`))
    : undefined;
  const layoutDedentId = sp?.layout
    ? (normalized.symToInt.get(sp.layout.dedent) ?? normalized.symToInt.get(`"${sp.layout.dedent}"`))
    : undefined;
  const hasLayoutPrimitive = layoutIndentId !== undefined && layoutDedentId !== undefined;
  if (hasLayoutPrimitive) {
    const indentEnum = idToEnumName.get(layoutIndentId!) ?? `T_${layoutIndentId}`;
    const dedentEnum = idToEnumName.get(layoutDedentId!) ?? `T_${layoutDedentId}`;
    lexerGlobals += `// Indentation Layout Scanner State\n`;
    lexerGlobals += `const layoutIndentStack: StaticArray<u32> = new StaticArray<u32>(64);\n`;
    lexerGlobals += `export let layoutIndentTop: i32 = 0;\n`;
    lexerGlobals += `export let layoutPendingDedents: i32 = 0;\n`;
    lexerGlobals += `export let layoutAtLineStart: bool = true;\n`;
    lexerGlobals += `export function resetLayoutScanner(): void { layoutIndentTop = 0; layoutPendingDedents = 0; layoutAtLineStart = true; unchecked(layoutIndentStack[0] = 0); }\n\n`;

    lexerCode += `  // --- Indentation Layout Primitive (INDENT / DEDENT) ---\n`;
    lexerCode += `  if (pos == 0) { resetLayoutScanner(); }\n`;
    lexerCode += `  if (layoutPendingDedents > 0) {\n`;
    lexerCode += `    layoutPendingDedents--;\n`;
    lexerCode += `    lexLen = 0; srcLexLen = 0;\n`;
    lexerCode += `    return SyntaxType.${dedentEnum};\n`;
    lexerCode += `  }\n`;
    lexerCode += `  if (lexPos >= inputLength) {\n`;
    lexerCode += `    if (layoutIndentTop > 0) {\n`;
    lexerCode += `      layoutIndentTop--;\n`;
    lexerCode += `      lexLen = 0; srcLexLen = 0;\n`;
    lexerCode += `      return SyntaxType.${dedentEnum};\n`;
    lexerCode += `    }\n`;
    lexerCode += `    return 1023;\n`;
    lexerCode += `  }\n`;
    lexerCode += `  if (pos > 0 && peekPrevChar(pos) == 10) { layoutAtLineStart = true; }\n`;
    lexerCode += `  if (layoutAtLineStart) {\n`;
    lexerCode += `    let scanP = lexPos;\n`;
    lexerCode += `    let col: u32 = 0;\n`;
    lexerCode += `    while (scanP < inputLength) {\n`;
    lexerCode += `      let ch = peekChar(scanP);\n`;
    lexerCode += `      if (ch == 32) { col++; scanP += peekCharLen(scanP); }\n`;
    lexerCode += `      else if (ch == 9) { col += 4; scanP += peekCharLen(scanP); }\n`;
    lexerCode += `      else if (ch == 10 || ch == 13) { col = 0; scanP += peekCharLen(scanP); }\n`;
    lexerCode += `      else { break; }\n`;
    lexerCode += `    }\n`;
    lexerCode += `    if (scanP < inputLength) {\n`;
    lexerCode += `      let curIndent = unchecked(layoutIndentStack[layoutIndentTop]);\n`;
    lexerCode += `      layoutAtLineStart = false;\n`;
    lexerCode += `      if (col > curIndent && layoutIndentTop < 63) {\n`;
    lexerCode += `        layoutIndentTop++;\n`;
    lexerCode += `        unchecked(layoutIndentStack[layoutIndentTop] = col);\n`;
    lexerCode += `        lexPos = scanP; srcLexPos = scanP; lexLen = 0; srcLexLen = 0;\n`;
    lexerCode += `        return SyntaxType.${indentEnum};\n`;
    lexerCode += `      } else if (col < curIndent) {\n`;
    lexerCode += `        let popped: i32 = 0;\n`;
    lexerCode += `        while (layoutIndentTop > 0 && unchecked(layoutIndentStack[layoutIndentTop]) > col) {\n`;
    lexerCode += `          layoutIndentTop--;\n`;
    lexerCode += `          popped++;\n`;
    lexerCode += `        }\n`;
    lexerCode += `        if (popped > 0) {\n`;
    lexerCode += `          layoutPendingDedents = popped - 1;\n`;
    lexerCode += `          lexPos = scanP; srcLexPos = scanP; lexLen = 0; srcLexLen = 0;\n`;
    lexerCode += `          return SyntaxType.${dedentEnum};\n`;
    lexerCode += `        }\n`;
    lexerCode += `      }\n`;
    lexerCode += `    }\n`;
    lexerCode += `  }\n`;
  }

  const hasComments = sp && (sp.nestedComment || sp.lineComment);

  if (hasWhitespaceExtra || hasComments) {
    // Skip whitespace and comments (scanner primitives aware)
    lexerCode += `  // Skip extra tokens`;
    lexerCode += `\n`;

    lexerCode += `  while (lexPos < inputLength) {\n`;
    lexerCode += `    let c: i32 = peekChar(lexPos);\n`;
    lexerCode += `    let charLen: u32 = peekCharLen(lexPos);\n`;

    if (hasWhitespaceExtra) {
      const wsCond = wsSkipCodePoints.map((cp) => (cp === 0xfeff ? "c == 0xFEFF" : `c == ${cp}`)).join(" || ");
      lexerCode += `    if (${wsCond}) {\n`;
      lexerCode += `      lexPos += charLen;\n`;
      lexerCode += `      continue;\n`;
      lexerCode += `    }\n`;
    }

    // Task 1.3: Line comment scanner
    if (sp && sp.lineComment) {
      const lc = sp.lineComment;
      const lcCps = toCodePoints(lc);
      if (lcCps.length === 2) {
        lexerCode += `    // Line comment: ${lc}\n`;
        lexerCode += `    let c2_lc = lexPos + charLen < inputLength ? peekChar(lexPos + charLen) : 0;\n`;
        lexerCode += `    if (c == ${lcCps[0]} && c2_lc == ${lcCps[1]}) {\n`;
        lexerCode += `      lexPos += charLen + peekCharLen(lexPos + charLen);\n`;
        lexerCode += `      while (lexPos < inputLength && peekChar(lexPos) != 10) lexPos += peekCharLen(lexPos);\n`;
        lexerCode += `      if (lexPos < inputLength) lexPos += peekCharLen(lexPos); // skip newline\n`;
        lexerCode += `      continue;\n`;
        lexerCode += `    }\n`;
      } else if (lcCps.length === 1) {
        lexerCode += `    if (c == ${lcCps[0]}) {\n`;
        lexerCode += `      lexPos += charLen;\n`;
        lexerCode += `      while (lexPos < inputLength && peekChar(lexPos) != 10) lexPos += peekCharLen(lexPos);\n`;
        lexerCode += `      if (lexPos < inputLength) lexPos += peekCharLen(lexPos);\n`;
        lexerCode += `      continue;\n`;
        lexerCode += `    }\n`;
      }
    }

    // Task 1.2: Nested comment scanner
    if (sp && sp.nestedComment) {
      const nc = sp.nestedComment;
      const oCps = toCodePoints(nc.open);
      const cCps = toCodePoints(nc.close);
      const o0 = oCps[0];
      const o1 = oCps.length > 1 ? oCps[1] : 0;
      const c0 = cCps[0];
      const c1 = cCps.length > 1 ? cCps[1] : 0;
      lexerCode += `    // Nested block comment: ${nc.open} ... ${nc.close}\n`;
      lexerCode += `    let c2_nc = lexPos + charLen < inputLength ? peekChar(lexPos + charLen) : 0;\n`;
      lexerCode += `    if (c == ${o0} && c2_nc == ${o1}) {\n`;
      lexerCode += `      lexPos += charLen + peekCharLen(lexPos + charLen);\n`;
      lexerCode += `      let commentDepth: u32 = 1;\n`;
      lexerCode += `      while (lexPos < inputLength && commentDepth > 0) {\n`;
      lexerCode += `        let cc = peekChar(lexPos);\n`;
      lexerCode += `        let ccLen = peekCharLen(lexPos);\n`;
      lexerCode += `        let cn = lexPos + ccLen < inputLength ? peekChar(lexPos + ccLen) : 0;\n`;
      lexerCode += `        let cnLen = lexPos + ccLen < inputLength ? peekCharLen(lexPos + ccLen) : 0;\n`;
      lexerCode += `        if (cc == ${o0} && cn == ${o1}) { commentDepth++; lexPos += ccLen + cnLen; }\n`;
      lexerCode += `        else if (cc == ${c0} && cn == ${c1}) { commentDepth--; lexPos += ccLen + cnLen; }\n`;
      lexerCode += `        else { lexPos += ccLen; }\n`;
      lexerCode += `      }\n`;
      lexerCode += `      continue;\n`;
      lexerCode += `    }\n`;
    }
    lexerCode += `    break;\n`;
    lexerCode += `  }\n`;
  }

  lexerCode += `  srcLexPos = lexPos;\n`;
  if (normalized.immediateTerminals.size > 0) {
    lexerCode += `  let skippedExtras: bool = lexPos != pos;\n`;
  }
  lexerCode += `  if (lexPos >= inputLength) return 1023; // EOF\n`;
  if (grammar.scanner && scannerRunAfterExtras) {
    lexerCode += `  let postExtrasPos: u32 = lexPos;\n`;
    lexerCode += emitExternalScannerBlock("postExtrasPos");
  }

  lexerCode += `  // --- Lexical State Machine (DFA) ---\n`;
  lexerCode += `  let char0: i32 = peekChar(lexPos);\n`;
  lexerCode += `  let char0Len: u32 = peekCharLen(lexPos);\n\n`;

  // --- Scanner Primitives: Priority Token Matchers ---

  // Task 1.4: Escaped identifier scanner (e.g., Modelica Q-IDENT: 'name with spaces')
  if (sp && sp.escapedIdent) {
    const ei = sp.escapedIdent;
    const q = ei.quote.codePointAt(0)!;
    const esc = ei.escape ? ei.escape.codePointAt(0)! : -1;
    lexerCode += `  // Escaped identifier: ${ei.quote}...${ei.quote}\n`;
    lexerCode += `  if (char0 == ${q}) {\n`;
    lexerCode += `    let peek = lexPos + char0Len;\n`;
    lexerCode += `    let hasClosingQuote: bool = false;\n`;
    lexerCode += `    while (peek < inputLength) {\n`;
    lexerCode += `      let ch = peekChar(peek);\n`;
    lexerCode += `      let chLen = peekCharLen(peek);\n`;
    lexerCode += `      if (ch == 10 || ch == 13) break;\n`;
    if (esc >= 0) {
      lexerCode += `      if (ch == ${esc} && peek + chLen < inputLength) { peek += chLen + peekCharLen(peek + chLen); continue; }\n`;
    }
    lexerCode += `      if (ch == ${q}) { peek += chLen; hasClosingQuote = true; break; }\n`;
    lexerCode += `      peek += chLen;\n`;
    lexerCode += `    }\n`;
    lexerCode += `    if (hasClosingQuote) {\n`;
    lexerCode += `      lexLen = peek - lexPos;\n`;
    lexerCode += `      srcLexLen = lexLen;\n`;
    // Emit as IDENT token type — find it from existing regex tokens
    let identTokenStr = "ERROR";
    const wordKey = wordName ? [...regexTokens.keys()].find((k) => k === wordName) : undefined;
    const identKey = wordKey ?? findRegexTokenAccepting("x");
    const identSymId = identKey !== undefined ? normalized.symToInt.get(identKey) : undefined;
    if (identSymId !== undefined) identTokenStr = idToEnumName.get(identSymId) ?? "T_" + identSymId;
    lexerCode += `      return SyntaxType.${identTokenStr}; // escaped identifier\n`;
    lexerCode += `    }\n`;
    lexerCode += `  }\n`;
  }

  // Task 1.5: String literal with escape sequences
  if (sp && sp.stringLiteral) {
    const sl = sp.stringLiteral;
    const d = sl.delim.codePointAt(0)!;
    const escapeLeaders = new Set<number>([92]); // backslash by default
    if (sl.escapes) {
      for (const escSeq of Object.keys(sl.escapes)) {
        if (escSeq.length > 0) escapeLeaders.add(escSeq.codePointAt(0)!);
      }
    }
    const escCond = Array.from(escapeLeaders)
      .map((cp) => `ch == ${cp}`)
      .join(" || ");
    lexerCode += `  // String literal with escapes: ${sl.delim}...${sl.delim}\n`;
    lexerCode += `  if (char0 == ${d}) {\n`;
    lexerCode += `    let peek = lexPos + char0Len;\n`;
    lexerCode += `    while (peek < inputLength) {\n`;
    lexerCode += `      let ch = peekChar(peek);\n`;
    lexerCode += `      let chLen = peekCharLen(peek);\n`;
    lexerCode += `      if ((${escCond}) && peek + chLen < inputLength) { peek += chLen + peekCharLen(peek + chLen); continue; } // escape\n`;
    lexerCode += `      if (ch == ${d}) { peek += chLen; break; }\n`;
    lexerCode += `      peek += chLen;\n`;
    lexerCode += `    }\n`;
    lexerCode += `    lexLen = peek - lexPos;\n`;
    lexerCode += `    srcLexLen = lexLen;\n`;
    let strTokenStr = "ERROR";
    const strKey = findRegexTokenAccepting(`${sl.delim}a${sl.delim}`);
    const strSymId = strKey !== undefined ? normalized.symToInt.get(strKey) : undefined;
    if (strSymId !== undefined) strTokenStr = idToEnumName.get(strSymId) ?? "T_" + strSymId;
    // Fallback: if there is a 'string' token, use it
    const fallbackStrId = normalized.symToInt.get("string");
    if (strTokenStr === "ERROR" && fallbackStrId !== undefined) {
      strTokenStr = idToEnumName.get(fallbackStrId) ?? "T_" + fallbackStrId;
    }
    lexerCode += `    return SyntaxType.${strTokenStr}; // string with escapes\n`;
    lexerCode += `  }\n`;
  }

  // 1. String Literals
  lexerCode += `  // --- String Literals ---\n`;
  lexerCode += `  let literalToken: i32 = 0;\n`;
  lexerCode += `  let literalLen: u32 = 0;\n`;
  const keywordTokens = new Map<string, string>();
  const stringEntries = Array.from(stringTokens.entries());
  stringEntries.sort((a, b) => b[1].length - a[1].length);
  const stringBranchesByChar0 = new Map<number, string>();
  const isWordCodePoint = (cp: number): boolean =>
    (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp === 95;

  // Build word-continuation character predicate derived from `wordRegex` when available
  const extraWordCps: number[] = [];
  if (wordRegex) {
    for (const ch of ["-", "$", "!", "?", "@", "'"]) {
      if (wordRegex.test("a" + ch)) {
        extraWordCps.push(ch.codePointAt(0)!);
      }
    }
  }
  const wordCharExpr = (v: string): string => {
    const extra = extraWordCps.map((cp) => ` || ${v} == ${cp}`).join("");
    return `((${v} >= 65 && ${v} <= 90) || (${v} >= 97 && ${v} <= 122) || (${v} >= 48 && ${v} <= 57) || ${v} == 95${extra})`;
  };

  for (const [key, val] of stringEntries) {
    const mappedInt = normalized.symToInt.get(`"${val}"`);
    if (!mappedInt) continue;
    const safeName = idToEnumName.get(mappedInt) ?? "T_" + mappedInt;
    const isImmediate = normalized.immediateTerminals.has(`"${val}"`);

    const isWord = wordRegex ? wordRegex.test(val) : false;

    // Determine if this literal is a reserved keyword
    let isReserved = false;
    for (const reservedTokens of normalized.reservedKeywords.values()) {
      // reservedTokens contains strings with quotes like '"end"'
      if (reservedTokens.has(`"${val}"`) || reservedTokens.has(val)) {
        isReserved = true;
        break;
      }
    }

    if (grammar.word && isWord && !isReserved && !isImmediate) {
      // Tree-sitter style keyword extraction: defer this literal to the identifier fallback!
      keywordTokens.set(val, key);
      continue;
    }

    const endsInWord = /[a-zA-Z0-9_]$/.test(val);
    const immediateGuard = isImmediate ? "!skippedExtras && " : "";
    let wordBoundaryCheck = "";
    if (isWord || endsInWord) {
      wordBoundaryCheck = `
        let isBoundary = ${isImmediate ? "!skippedExtras" : "true"};
        if (isBoundary && cPos < inputLength) {
            let nextChar = peekChar(cPos);
            if (${wordCharExpr("nextChar")}) {
                isBoundary = false;
            }
        }
        if (isBoundary) {
            let matchLen: u32 = <u32>(cPos - lexPos);
            if (expected_tokens == 0 || load<u8>(expected_tokens + <u32>SyntaxType.${safeName}) == 1) {
                literalToken = SyntaxType.${safeName};
                literalLen = matchLen;
                break;
            } else if (literalToken == 0) {
                literalToken = SyntaxType.${safeName};
                literalLen = matchLen;
            }
        }
      `;
    } else {
      wordBoundaryCheck = `
        if (${immediateGuard}true) {
            let matchLen: u32 = <u32>(cPos - lexPos);
            if (expected_tokens == 0 || load<u8>(expected_tokens + <u32>SyntaxType.${safeName}) == 1) {
                literalToken = SyntaxType.${safeName};
                literalLen = matchLen;
                break;
            } else if (literalToken == 0) {
                literalToken = SyntaxType.${safeName};
                literalLen = matchLen;
            }
        }
      `;
    }

    const cps = toCodePoints(val);
    if (cps.length === 0) continue;

    let branchCode = "";
    if (cps.length === 1) {
      branchCode += `      {\n`;
      branchCode += `        let cPos = lexPos + char0Len;\n`;
      branchCode += wordBoundaryCheck;
      branchCode += `      }\n`;
    } else {
      branchCode += `      {\n`;
      branchCode += `        let cPos = lexPos + char0Len;\n`;
      branchCode += `        let sMatch = true;\n`;
      for (let i = 1; i < cps.length; i++) {
        if (
          cps[i] === 32 &&
          hasWhitespaceExtra &&
          i + 1 < cps.length &&
          isWordCodePoint(cps[i - 1]!) &&
          isWordCodePoint(cps[i + 1]!)
        ) {
          branchCode += `        if (sMatch && cPos < inputLength && (peekChar(cPos) == 32 || peekChar(cPos) == 9)) { while (cPos < inputLength && (peekChar(cPos) == 32 || peekChar(cPos) == 9)) { cPos += peekCharLen(cPos); } } else { sMatch = false; }\n`;
        } else {
          branchCode += `        if (sMatch && cPos < inputLength && peekChar(cPos) == ${cps[i]}) { cPos += peekCharLen(cPos); } else { sMatch = false; }\n`;
        }
      }
      branchCode += `        if (sMatch) {\n`;
      branchCode += wordBoundaryCheck;
      branchCode += `        }\n`;
      branchCode += `      }\n`;
    }

    stringBranchesByChar0.set(cps[0]!, (stringBranchesByChar0.get(cps[0]!) || "") + branchCode);
  }

  if (stringBranchesByChar0.size > 0) {
    lexerCode += `  switch (char0) {\n`;
    for (const [cp0, branches] of stringBranchesByChar0.entries()) {
      lexerCode += `    case ${cp0}: {\n`;
      lexerCode += branches;
      lexerCode += `      break;\n`;
      lexerCode += `    }\n`;
    }
    lexerCode += `  }\n`;
  }

  // 2. Generic Regex DFA Fallback
  lexerCode += `\n  // --- Regex DFA Patterns ---\n`;
  const regexList: { pattern: string; tokenName: string; flags?: string }[] = [];
  for (const [key, val] of regexTokens.entries()) {
    const mappedInt = normalized.symToInt.get(key);
    if (!mappedInt) continue;

    const safeName = idToEnumName.get(mappedInt) ?? "T_" + mappedInt;

    let patternStr = val;
    let flagsStr = "";
    if (val.startsWith("/") && val.lastIndexOf("/") > 0) {
      const lastSlash = val.lastIndexOf("/");
      patternStr = val.substring(1, lastSlash);
      flagsStr = val.substring(lastSlash + 1);
    }
    regexList.push({ pattern: patternStr, tokenName: safeName, flags: flagsStr });
  }

  const immediateEnumNames = new Set<string>();
  for (const immSym of normalized.immediateTerminals) {
    const immId = normalized.symToInt.get(immSym);
    if (immId !== undefined) {
      immediateEnumNames.add(idToEnumName.get(immId) ?? "T_" + immId);
    }
  }

  if (regexList.length > 0) {
    const dfa = compileRegexToDFA(regexList);

    lexerCode += `  let dfaState = 0;\n`;
    lexerCode += `  let dfaLexLen: u32 = 0;\n`;
    lexerCode += `  let lastAcceptingState = -1;\n`;
    lexerCode += `  let lastAcceptingLen: u32 = 0;\n`;

    const dfaClassRanges = (dfa as unknown as { classRanges: Array<{ s: number; e: number; c: number }> }).classRanges;
    lexerGlobals += `  // DFA Transitions\n`;
    lexerGlobals += `  const classRangesS: StaticArray<i32> = [${dfaClassRanges.map((r) => r.s).join(",")}];\n`;
    lexerGlobals += `  const classRangesE: StaticArray<i32> = [${dfaClassRanges.map((r) => r.e).join(",")}];\n`;
    lexerGlobals += `  const classRangesC: StaticArray<i32> = [${dfaClassRanges.map((r) => r.c).join(",")}];\n`;
    lexerGlobals += `  const dfaTable: StaticArray<i32> = [${dfa.table.join(",")}];\n`;

    lexerCode += `  let nextState = -1;\n`;
    lexerCode += `  while (lexPos + dfaLexLen < inputLength) {\n`;
    lexerCode += `    let c: i32 = peekChar(lexPos + dfaLexLen);\n`;
    lexerCode += `    let charLen: u32 = peekCharLen(lexPos + dfaLexLen);\n`;
    lexerCode += `    let cls = -1;\n`;
    lexerCode += `    let l = 0, r = ${dfaClassRanges.length - 1};\n`;
    lexerCode += `    while (l <= r) {\n`;
    lexerCode += `      let m = (l + r) >> 1;\n`;
    lexerCode += `      if (c < classRangesS[m]) r = m - 1;\n`;
    lexerCode += `      else if (c > classRangesE[m]) l = m + 1;\n`;
    lexerCode += `      else { cls = classRangesC[m]; break; }\n`;
    lexerCode += `    }\n`;
    lexerCode += `    if (cls === -1) cls = 0;\n`;
    lexerCode += `    nextState = unchecked(dfaTable[dfaState * ${dfa.numClasses} + cls]);\n`;
    lexerCode += `    if (nextState === -1) break;\n`;
    lexerCode += `    dfaState = nextState;\n`;
    lexerCode += `    dfaLexLen += charLen;\n`;

    lexerCode += `    // Check accepting\n`;
    lexerCode += `    switch(dfaState) {\n`;
    const regularAcceptStates: number[] = [];
    const immediateOnlyAcceptStates: number[] = [];
    for (let s = 0; s < dfa.numStates; s++) {
      const acc = dfa.accepts[s];
      if (!acc) continue;
      if (immediateEnumNames.size > 0 && acc.every((tName) => immediateEnumNames.has(tName))) {
        immediateOnlyAcceptStates.push(s);
      } else {
        regularAcceptStates.push(s);
      }
    }
    if (regularAcceptStates.length > 0) {
      for (const s of regularAcceptStates) {
        lexerCode += `      case ${s}:\n`;
      }
      lexerCode += `        lastAcceptingState = dfaState;\n`;
      lexerCode += `        lastAcceptingLen = dfaLexLen;\n`;
      lexerCode += `        break;\n`;
    }
    if (immediateOnlyAcceptStates.length > 0) {
      for (const s of immediateOnlyAcceptStates) {
        lexerCode += `      case ${s}:\n`;
      }
      lexerCode += `        if (!skippedExtras) {\n`;
      lexerCode += `          lastAcceptingState = dfaState;\n`;
      lexerCode += `          lastAcceptingLen = dfaLexLen;\n`;
      lexerCode += `        }\n`;
      lexerCode += `        break;\n`;
    }
    lexerCode += `    }\n`;
    lexerCode += `  }\n`;

    lexerCode += `  // --- Decision: String Literal vs Regex DFA Maximal Munch ---\n`;
    lexerCode += `  if (literalLen > 0 && literalLen >= lastAcceptingLen) {\n`;
    lexerCode += `    let preferRegex = false;\n`;
    lexerCode += `    if (literalLen == lastAcceptingLen && expected_tokens != 0) {\n`;
    lexerCode += `      if (load<u8>(expected_tokens + <u32>literalToken) == 0 && lastAcceptingState != -1) {\n`;
    lexerCode += `        switch (lastAcceptingState) {\n`;
    for (let s = 0; s < dfa.numStates; s++) {
      if (dfa.accepts[s]) {
        const tokenNames = dfa.accepts[s]!;
        const conds = tokenNames
          .map((tName) => {
            const base = `load<u8>(expected_tokens + <u32>SyntaxType.${tName}) == 1`;
            return immediateEnumNames.has(tName) ? `(!skippedExtras && ${base})` : base;
          })
          .join(" || ");
        lexerCode += `          case ${s}:\n`;
        lexerCode += `            if (${conds}) preferRegex = true;\n`;
        lexerCode += `            break;\n`;
      }
    }
    lexerCode += `        }\n`;
    lexerCode += `      }\n`;
    lexerCode += `    }\n`;
    lexerCode += `    if (!preferRegex) {\n`;
    lexerCode += `      lexLen = literalLen;\n`;
    lexerCode += `      srcLexLen = lexLen;\n`;
    lexerCode += `      return literalToken;\n`;
    lexerCode += `    }\n`;
    lexerCode += `  }\n\n`;
    lexerCode += `  if (lastAcceptingState !== -1) {\n`;
    lexerCode += `    lexLen = lastAcceptingLen;\n`;
    lexerCode += `    srcLexLen = lexLen;\n`;
    lexerCode += `    switch(lastAcceptingState) {\n`;
    for (let s = 0; s < dfa.numStates; s++) {
      if (dfa.accepts[s]) {
        const tokenNames = dfa.accepts[s]!;
        lexerCode += `      case ${s}: {\n`;

        const tokenName = tokenNames[0]!;

        let isWordToken = false;
        if (wordName) {
          const wordSymInt = normalized.symToInt.get(wordName);
          if (
            tokenName.toUpperCase() === wordName.toUpperCase() ||
            tokenName === wordName ||
            (wordSymInt !== undefined && tokenName === "T_" + wordSymInt)
          ) {
            isWordToken = true;
          } else if (grammar.rules?.[wordName]) {
            const dummy$ = new Proxy({}, { get: (_t, p: string) => ({ type: "SYMBOL", value: p }) });
            const wRule = toRule(grammar.rules[wordName]!(dummy$ as never));
            const checkWordRule = (r: unknown): boolean => {
              if (!r || typeof r !== "object") return false;
              const obj = r as LexerRuleMeta & { child?: unknown };
              if (obj.type === "TOKEN" && obj.value) {
                const strVal = String(obj.value);
                const mappedInt = normalized.symToInt.get(strVal);
                if (mappedInt !== undefined && "T_" + mappedInt === tokenName) return true;
                if (strVal.toUpperCase() === tokenName.toUpperCase() || strVal === tokenName || obj.name === tokenName)
                  return true;
              }
              const children = (r as { children?: unknown[] }).children;
              if (children) {
                for (const child of children) {
                  if (checkWordRule(child)) return true;
                }
              }
              return false;
            };
            if (checkWordRule(wRule)) {
              isWordToken = true;
            }
          }
        }

        if (isWordToken) {
          if (sp && sp.multiWordKeywords && sp.multiWordKeywords.length > 0) {
            lexerCode += `        // Multi-word keyword lookahead\n`;
            lexerCode += `        let mwkToken = checkMultiWordKeyword(lexPos, lexLen);\n`;
            lexerCode += `        if (mwkToken != 0) { return mwkToken; }\n`;
          }
          if (keywordTokens.size > 0) {
            lexerCode += `        // Keyword extraction optimization (bucketed by length & first code point)\n`;
            const kwByLen = new Map<number, { kw: string; kwTokenInt: number | undefined; kwCps: number[] }[]>();
            for (const [kw, _] of keywordTokens.entries()) {
              const kwTokenInt = normalized.symToInt.get(`"${kw}"`);
              const kwCps = toCodePoints(kw);
              if (kwCps.length === 0) continue;
              let bucket = kwByLen.get(kw.length);
              if (!bucket) {
                bucket = [];
                kwByLen.set(kw.length, bucket);
              }
              bucket.push({ kw, kwTokenInt, kwCps });
            }
            lexerCode += `        switch (lexLen) {\n`;
            for (const [len, bucket] of kwByLen.entries()) {
              lexerCode += `          case ${len}: {\n`;
              lexerCode += `            let firstCp = peekChar(lexPos);\n`;
              lexerCode += `            let kwMatch = false;\n`;
              lexerCode += `            let cPos: u32 = 0;\n`;
              for (const { kwTokenInt, kwCps } of bucket) {
                lexerCode += `            if (firstCp == ${kwCps[0]}) {\n`;
                lexerCode += `              kwMatch = true; cPos = lexPos + peekCharLen(lexPos);\n`;
                for (let i = 1; i < kwCps.length; i++) {
                  lexerCode += `              if (kwMatch && peekChar(cPos) == ${kwCps[i]}) { cPos += peekCharLen(cPos); } else { kwMatch = false; }\n`;
                }
                lexerCode += `              if (kwMatch && (cPos - lexPos == lexLen)) {\n`;
                lexerCode += `                if (expected_tokens != 0) {\n`;
                lexerCode += `                  if (load<u8>(expected_tokens + <u32>SyntaxType.T_${kwTokenInt}) == 1) return SyntaxType.T_${kwTokenInt};\n`;
                lexerCode += `                  if (load<u8>(expected_tokens + <u32>SyntaxType.${tokenName}) == 0) return SyntaxType.T_${kwTokenInt};\n`;
                lexerCode += `                } else {\n`;
                lexerCode += `                  return SyntaxType.T_${kwTokenInt};\n`;
                lexerCode += `                }\n`;
                lexerCode += `              }\n`;
                lexerCode += `            }\n`;
              }
              lexerCode += `            break;\n`;
              lexerCode += `          }\n`;
            }
            lexerCode += `        }\n`;
          }
        }

        if (tokenNames.length > 1) {
          lexerCode += `        // Lexical tie-breaking\n`;
          for (const tName of tokenNames) {
            const immPrefix = immediateEnumNames.has(tName) ? "!skippedExtras && " : "";
            lexerCode += `        if (${immPrefix}expected_tokens != 0 && load<u8>(expected_tokens + <u32>SyntaxType.${tName}) == 1) return SyntaxType.${tName};\n`;
          }
        }

        // Reserved keywords overriding (global wordsets always override; contextual wordsets override when expected)
        if (isWordToken && normalized.reservedKeywords.size > 0) {
          const reservedEntries = new Map<
            string,
            { kwTokenInt: number; isGlobal: boolean; rtCps: number[]; len: number }
          >();
          for (const [wsName, reservedSet] of normalized.reservedKeywords.entries()) {
            const isGlobal = wsName === "global" || !normalized.usedReservedWordsets.has(wsName);
            for (const rt of reservedSet) {
              const rtVal = rt.startsWith('"') && rt.endsWith('"') ? rt.slice(1, -1) : rt;
              const kwTokenInt = normalized.symToInt.get(rt) ?? normalized.symToInt.get(`"${rtVal}"`);
              if (kwTokenInt === undefined) continue;
              const rtCps = toCodePoints(rtVal);
              if (rtCps.length === 0) continue;
              const prev = reservedEntries.get(rtVal);
              if (!prev || (isGlobal && !prev.isGlobal)) {
                reservedEntries.set(rtVal, { kwTokenInt, isGlobal, rtCps, len: rtVal.length });
              }
            }
          }
          if (reservedEntries.size > 0) {
            lexerCode += `        // Reserved keywords override (bucketed by length & first code point)\n`;
            const rtByLen = new Map<number, { kwTokenInt: number; isGlobal: boolean; rtCps: number[] }[]>();
            for (const entry of reservedEntries.values()) {
              let bucket = rtByLen.get(entry.len);
              if (!bucket) {
                bucket = [];
                rtByLen.set(entry.len, bucket);
              }
              bucket.push(entry);
            }
            lexerCode += `        switch (lexLen) {\n`;
            for (const [len, bucket] of rtByLen.entries()) {
              lexerCode += `          case ${len}: {\n`;
              lexerCode += `            let firstCp2 = peekChar(lexPos);\n`;
              lexerCode += `            let kwMatch2 = false;\n`;
              lexerCode += `            let cPos2: u32 = 0;\n`;
              for (const { kwTokenInt, isGlobal, rtCps } of bucket) {
                const rtEnum = idToEnumName.get(kwTokenInt) ?? `T_${kwTokenInt}`;
                lexerCode += `            if (firstCp2 == ${rtCps[0]}) {\n`;
                lexerCode += `              kwMatch2 = true; cPos2 = lexPos + peekCharLen(lexPos);\n`;
                for (let i = 1; i < rtCps.length; i++) {
                  lexerCode += `              if (kwMatch2 && peekChar(cPos2) == ${rtCps[i]}) { cPos2 += peekCharLen(cPos2); } else { kwMatch2 = false; }\n`;
                }
                lexerCode += `              if (kwMatch2 && (cPos2 - lexPos == lexLen)) {\n`;
                if (isGlobal) {
                  lexerCode += `                return SyntaxType.${rtEnum};\n`;
                } else {
                  lexerCode += `                if (expected_tokens == 0 || load<u8>(expected_tokens + <u32>SyntaxType.${rtEnum}) == 1) return SyntaxType.${rtEnum};\n`;
                }
                lexerCode += `              }\n`;
                lexerCode += `            }\n`;
              }
              lexerCode += `            break;\n`;
              lexerCode += `          }\n`;
            }
            lexerCode += `        }\n`;
          }
        }

        if (immediateEnumNames.has(tokenName)) {
          const fallbackNonImm = tokenNames.find((tName) => !immediateEnumNames.has(tName));
          if (fallbackNonImm) {
            lexerCode += `        return skippedExtras ? SyntaxType.${fallbackNonImm} : SyntaxType.${tokenName};\n`;
          } else {
            lexerCode += `        return SyntaxType.${tokenName};\n`;
          }
        } else {
          lexerCode += `        return SyntaxType.${tokenName};\n`;
        }
        lexerCode += `      }\n`;
      }
    }
    lexerCode += `    }\n`;
    lexerCode += `  }\n`;
  }

  lexerCode += `  if (literalLen > 0) {\n`;
  lexerCode += `    lexLen = literalLen;\n`;
  lexerCode += `    srcLexLen = lexLen;\n`;
  lexerCode += `    return literalToken;\n`;
  lexerCode += `  }\n`;

  // Task 1.6: Multi-word keyword speculative lookahead
  // After identifier matching, check if ident + space + next word forms a multi-word keyword
  let helpers = "";
  if (sp && sp.multiWordKeywords && sp.multiWordKeywords.length > 0) {
    const validMwkEntries: { mwk: string; firstWord: string; restWords: string; tokenInt: number }[] = [];
    const firstWordLens = new Set<number>();
    for (const mwk of sp.multiWordKeywords) {
      const words = mwk.split(/\s+/);
      if (words.length < 2) continue;
      const firstWord = words[0]!;
      const restWords = words.slice(1).join(" ");
      const tokenInt = normalized.symToInt.get(`"${mwk}"`) ?? normalized.symToInt.get(mwk);
      if (tokenInt) {
        validMwkEntries.push({ mwk, firstWord, restWords, tokenInt });
        firstWordLens.add(firstWord.length);
      }
    }
    helpers += `\n  // --- Multi-Word Keyword Lookahead ---\n`;
    helpers += `  // After matching an identifier, speculatively check for multi-word keywords\n`;
    helpers += `function checkMultiWordKeyword(startPos: u32, identLen: u32): i32 {\n`;
    if (firstWordLens.size > 0) {
      const lenCheck = Array.from(firstWordLens)
        .map((l) => `identLen != ${l}`)
        .join(" && ");
      helpers += `  if (${lenCheck}) return 0;\n`;
    }
    helpers += `  let afterIdent = startPos + identLen;\n`;
    helpers += `  // Skip whitespace between words\n`;
    helpers += `  let wsPos = afterIdent;\n`;
    helpers += `  while (wsPos < inputLength) { let ch = peekChar(wsPos); if (ch == 32 || ch == 9) { wsPos += peekCharLen(wsPos); } else { break; } }\n`;
    helpers += `  if (wsPos == afterIdent) return 0; // No whitespace = not multi-word\n`;

    for (const { mwk, firstWord, restWords, tokenInt } of validMwkEntries) {
      helpers += `  // "${mwk}"\n`;
      helpers += `  if (identLen == ${firstWord.length}) {\n`;
      helpers += `    let mMatch = true;\n`;
      helpers += `    let mPos = startPos;\n`;
      const firstCps = toCodePoints(firstWord);
      for (let i = 0; i < firstCps.length; i++) {
        helpers += `    if (mMatch && peekChar(mPos) == ${firstCps[i]}) { mPos += peekCharLen(mPos); } else { mMatch = false; }\n`;
      }
      helpers += `    if (mMatch && (mPos - startPos == identLen)) {\n`;
      helpers += `      let rPos = wsPos;\n`;
      const restCps = toCodePoints(restWords);
      for (let i = 0; i < restCps.length; i++) {
        helpers += `      if (mMatch && peekChar(rPos) == ${restCps[i]}) { rPos += peekCharLen(rPos); } else { mMatch = false; }\n`;
      }
      helpers += `      if (mMatch && rPos <= inputLength) {\n`;
      helpers += `        let afterCh = rPos < inputLength ? peekChar(rPos) : 0;\n`;
      helpers += `        if (afterCh == 0 || !${wordCharExpr("afterCh")}) {\n`;
      helpers += `          lexLen = <u32>(rPos - startPos);\n`;
      helpers += `          srcLexLen = lexLen;\n`;
      helpers += `          return SyntaxType.T_${tokenInt};\n`;
      helpers += `        }\n`;
      helpers += `      }\n`;
      helpers += `    }\n`;
      helpers += `  }\n`;
    }
    helpers += `  return 0;\n`;
    helpers += `}\n`;
  }
  lexerCode += `
  lexLen = peekCharLen(lexPos);
  if (lexLen == 0) lexLen = 1; // Fail-safe
  srcLexLen = lexLen;
  return SyntaxType.ERROR;
}
`;
  lexerCode += helpers;

  if (grammar.scanner) {
    lexerCode += `
// --- External Scanner Helper Primitives ---
export let scanMarkedEnd: bool = false;

export function scanAdvance(skip: boolean = false): void {
  let chLen = peekCharLen(lexPos);
  lexPos += chLen;
  if (skip) {
    srcLexPos = lexPos;
    lexLen = 0;
    srcLexLen = 0;
    scanMarkedEnd = false;
  } else {
    lexLen += chLen;
    if (!scanMarkedEnd) {
      srcLexLen = lexLen;
    }
  }
}

export function scanMarkEnd(): void {
  srcLexLen = lexLen;
  scanMarkedEnd = true;
}

export function scanSkipWhitespace(): void {
  while (lexPos < inputLength) {
    let c = peekChar(lexPos);
    if (c == 32 || c == 9 || c == 10 || c == 13 || c == 0xFEFF) {
      lexPos += peekCharLen(lexPos);
    } else {
      break;
    }
  }
  srcLexPos = lexPos;
  lexLen = 0;
  srcLexLen = 0;
  scanMarkedEnd = false;
}

export function scanIsExpected(tok: u32): boolean {
  if (tok > (MAX_TERMINAL_ID as u32)) return false;
  if (expected_tokens == 0) return true;
  return load<u8>(expected_tokens + tok) == 1;
}

export function scanIsEof(): boolean {
  return lexPos >= inputLength;
}

// --- External Scanner Custom Logic ---
`;
    let rawScanner: unknown = grammar.scanner;
    if (
      rawScanner &&
      typeof rawScanner === "object" &&
      "scan" in rawScanner &&
      typeof (rawScanner as { scan?: unknown }).scan === "function"
    ) {
      rawScanner = (rawScanner as { scan: unknown }).scan;
    }
    const dummy$ = new Proxy({}, { get: (_, prop) => ({ type: "SYMBOL", value: String(prop) }) });
    let scannerFn: unknown = rawScanner;
    try {
      if (typeof rawScanner === "function" && rawScanner.length === 1) {
        const evaluated = (rawScanner as (d: unknown) => unknown)(dummy$);
        if (typeof evaluated === "function") {
          scannerFn = evaluated;
        }
      }
    } catch {
      scannerFn = rawScanner;
    }
    const extNames = new Set<string>();
    if (grammar.externals) {
      const dummy$ = new Proxy({}, { get: (_, prop) => ({ type: "SYMBOL", value: String(prop) }) });
      const extRules = grammar.externals(dummy$ as never);
      for (const ext of extRules) {
        if (ext && ext.value) extNames.add(String(ext.value));
      }
    }
    const transpileRes = transpileQuery(scannerFn, {
      context: "scanner",
      rules: grammar.rules,
      externals: extNames,
    });
    lexerCode += `export function scanExternal(currentPos: u32, scannerState: u32): i32 {\n  currentScannerState = scannerState;\n${transpileRes.body}\n  return 0;\n}\n`;
  }

  lexerCode += `
@inline
export function saveLexerAuxState(): u64 {
  let state: u64 = 0;
${grammar.scanner ? "  if (scanMarkedEnd) state |= 1;\n" : ""}${hasLayoutPrimitive ? "  state |= ((<u64>(layoutIndentTop & 0xff)) << 8) | ((<u64>(layoutPendingDedents & 0xff)) << 16) | (layoutAtLineStart ? (<u64>1 << 24) : 0);\n" : ""}  return state;
}

@inline
export function restoreLexerAuxState(saved: u64): void {
${grammar.scanner ? "  scanMarkedEnd = (saved & 1) != 0;\n" : ""}${hasLayoutPrimitive ? "  layoutIndentTop = <i32>((saved >> 8) & 0xff);\n  layoutPendingDedents = <i32>((saved >> 16) & 0xff);\n  layoutAtLineStart = ((saved >> 24) & 1) != 0;\n" : ""}}

export function peekToken(pos: u32): i32 {
  let savedLexPos = lexPos;
  let savedLexLen = lexLen;
  let savedSrcLexPos = srcLexPos;
  let savedSrcLexLen = srcLexLen;
  let savedScannerState = currentScannerState;
  let savedAux = saveLexerAuxState();

  let tok = lex(pos);

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  srcLexLen = savedSrcLexLen;
  currentScannerState = savedScannerState;
  restoreLexerAuxState(savedAux);
  return tok;
}
`;

  return lexerGlobals + lexerCode;
}
