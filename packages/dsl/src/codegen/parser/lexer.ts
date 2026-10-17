// SPDX-License-Identifier: AGPL-3.0-or-later

import { compileRegexToDFA } from "../../dsl/automata.js";
import { NormalizedGrammar } from "../../dsl/grammar.js";
import type { LanguageOptions, Rule } from "../../dsl/language.js";
import { toRule } from "../../dsl/language.js";
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

export function generateLexer(grammar: LanguageOptions<any>, normalized: NormalizedGrammar): string {
  // Extract all token patterns from the grammar rules
  const stringTokens = new Map<string, string>();
  const regexTokens = new Map<string, string>();

  function extractTokens(rule: Rule<any>) {
    if (!rule) return;
    if (
      typeof rule === "string" ||
      rule instanceof RegExp ||
      Object.prototype.toString.call(rule) === "[object RegExp]"
    ) {
      rule = { type: "TOKEN", value: rule } as any;
    }
    const ruleType = (rule.type || "").toUpperCase();
    const ruleValue = rule.value !== undefined ? rule.value : (rule as any).arg;
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
    const children =
      rule.children ||
      (rule as any).args ||
      ((rule as any).arg ? [(rule as any).arg] : []) ||
      ((rule as any).rule ? [(rule as any).rule] : []);
    if (children) {
      for (const child of children) {
        extractTokens(child);
      }
    }
    if ((rule as any).rule) {
      extractTokens((rule as any).rule);
    }
  }

  for (const ruleName in grammar.rules) {
    const dummy$ = new Proxy(
      {},
      {
        get: (target, prop: string) => ({ type: "SYMBOL", value: prop }),
      },
    );
    const rule = toRule(grammar.rules[ruleName](dummy$ as any));
    extractTokens(rule);
  }

  if (normalized.extras) {
    for (const rule of normalized.extras) {
      extractTokens(rule);
    }
  }

  let wordRegex: RegExp | null = null;
  let wordName: string | null = null;

  if (grammar.word) {
    const dummy$ = new Proxy({}, { get: (t, p: string) => ({ type: "SYMBOL", value: p }) });
    let wResult = grammar.word;
    if (typeof grammar.word === "function") wResult = (grammar as any).word(dummy$ as any);
    const wordRule = toRule(wResult as any);
    if (wordRule.type === "SYMBOL") {
      wordName = wordRule.value as string;
    } else {
      wordName = (wordRule as any).name || (wordRule as any).value?.toString();
    }
  }

  if (wordName && grammar.rules[wordName]) {
    const dummy$ = new Proxy({}, { get: (target, prop: string) => ({ type: "SYMBOL", value: prop }) });
    let rule = toRule(grammar.rules[wordName](dummy$ as any));
    let rType = (rule.type || "").toUpperCase();
    if (rType === "DEF" || rType === "REF") {
      rule =
        (rule as any).rule ||
        ((rule as any).args ? (rule as any).args[0] : null) ||
        (rule.children ? rule.children[0] : null) ||
        (rule as any).arg ||
        rule;
      rType = (rule.type || "").toUpperCase();
    }
    if (rType === "TOKEN" && rule.value) {
      let patternStr = "";
      if (rule.value instanceof RegExp || Object.prototype.toString.call(rule.value) === "[object RegExp]") {
        patternStr = rule.value.source;
      } else if (typeof rule.value === "string" && rule.value.startsWith("/") && rule.value.lastIndexOf("/") > 0) {
        patternStr = rule.value.substring(1, rule.value.lastIndexOf("/"));
      }
      if (patternStr) {
        wordRegex = new RegExp("^(" + patternStr + ")$");
      }
    }

    if (!wordRegex) {
      console.log("lexer.ts: Falling back to generic wordRegex extraction for", wordName);
      // Hardcode common identifier patterns if it's a complex rule
      wordRegex = new RegExp("^([a-zA-Z_][a-zA-Z0-9_]*)$");
    }
  }

  // Force IDENT into regexTokens if it's missing so the DFA generates it!
  if (wordName && !grammar.rules[wordName] && !regexTokens.has(wordName)) {
    // Inject generic word pattern only if wordName is not already a rule in the grammar
    regexTokens.set(wordName, "/[_a-zA-Z][_a-zA-Z0-9]*/");
  }
  console.log("lexer.ts: wordRegex is", wordRegex);

  console.log("lexer.ts: stringTokens size =", stringTokens.size, Array.from(stringTokens.keys()));
  let lexerGlobals = `// DFA Lexer State Machine\n`;
  lexerGlobals += `// Extracted ${stringTokens.size} string literals and ${regexTokens.size} regex patterns\n\n`;

  let lexerCode = ``;

  lexerCode += `\nexport let is_extra_token: usize = 0;\n`;
  lexerCode += `export function initExtras(): void {\n`;
  lexerCode += `  if (is_extra_token == 0) {\n    let extraCap: u32 = ((MAX_TERMINAL_ID as u32) + 1) > 2048 ? ((MAX_TERMINAL_ID as u32) + 1) : 2048;\n    is_extra_token = atomicChunkAlloc(extraCap);\n    memory.fill(is_extra_token, 0, extraCap);\n  }\n`;
  if (normalized.extras) {
    for (const rule of normalized.extras) {
      const rType = (rule.type || "").toUpperCase();
      if (rType === "TOKEN") {
        const ruleVal =
          (rule as any).value !== undefined ? (rule as any).value : (rule as any).child || (rule as any).children;
        let val = ruleVal ? ruleVal.toString() : "";
        if (typeof (rule as any).value === "string") val = `"${(rule as any).value}"`;
        const mappedInt =
          normalized.symToInt.get(val) ??
          ((rule as any).name ? normalized.symToInt.get((rule as any).name) : undefined);
        if (mappedInt !== undefined) {
          lexerCode += `  store<u8>(is_extra_token + <u32>${mappedInt}, 1);\n`;
        }
      } else if (rType === "SYMBOL") {
        const symName = (rule as any).name || (rule as any).value;
        // Find evaluated rule that corresponds to this symbol
        const evalRule = normalized.evaluatedRules[symName];
        if (evalRule && evalRule.type === "TOKEN") {
          const ruleVal =
            (evalRule as any).value !== undefined
              ? (evalRule as any).value
              : (evalRule as any).child || (evalRule as any).children;
          let val = ruleVal ? ruleVal.toString() : symName;
          if (typeof (evalRule as any).value === "string") val = `"${(evalRule as any).value}"`;
          const mappedInt = normalized.symToInt.get(val) ?? normalized.symToInt.get(symName);
          if (mappedInt !== undefined) {
            lexerCode += `  store<u8>(is_extra_token + <u32>${mappedInt}, 1);\n`;
          }
        } else {
          // If the symbol resolves to a regex, symToInt will have the symName or regex string
          const mappedInt = normalized.symToInt.get(symName);
          if (mappedInt !== undefined) {
            lexerCode += `  store<u8>(is_extra_token + <u32>${mappedInt}, 1);\n`;
          }
        }
      }
    }
  }
  lexerCode += `}\n`;

  lexerCode += `export let inputEncoding: u8 = 1;
`;
  lexerCode += `export function setInputEncoding(enc: u8): void { inputEncoding = 1; }

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

  // Inject External Scanner Custom State/Functions
  if (grammar.scanner) {
    lexerCode += `  // --- External Scanner --- \n`;
    lexerCode += `  let extToken = scanExternal(lexPos, currentScannerState);\n`;
    lexerCode += `  if (extToken != 0) {\n`;
    lexerCode += `    if (srcLexLen > 0) {\n      lexLen = srcLexLen;\n      lexPos = srcLexPos + lexLen;\n    }\n`;
    lexerCode += `    return extToken;\n`;
    lexerCode += `  }\n\n`;
  }

  let hasWhitespaceExtra = false;
  if (normalized.extras && normalized.extras.length > 0) {
    hasWhitespaceExtra = true;
  }

  const sp = (grammar as any).primitives;
  const hasComments = sp && (sp.nestedComment || sp.lineComment);

  if (hasWhitespaceExtra || hasComments) {
    // Skip whitespace and comments (scanner primitives aware)
    lexerCode += `  // Skip extra tokens`;
    lexerCode += `\n`;

    lexerCode += `  while (lexPos < inputLength) {\n`;
    lexerCode += `    let c: i32 = peekChar(lexPos);\n`;
    lexerCode += `    let charLen: u32 = peekCharLen(lexPos);\n`;

    if (hasWhitespaceExtra) {
      lexerCode += `    if (c == 32 || c == 9 || c == 10 || c == 13 || c == 0xFEFF) {\n`;
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
  lexerCode += `  if (lexPos >= inputLength) return 1023; // EOF\n`;

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
    lexerCode += `    while (peek < inputLength) {\n`;
    lexerCode += `      let ch = peekChar(peek);\n`;
    lexerCode += `      let chLen = peekCharLen(peek);\n`;
    if (esc >= 0) {
      lexerCode += `      if (ch == ${esc} && peek + chLen < inputLength) { peek += chLen + peekCharLen(peek + chLen); continue; }\n`;
    }
    lexerCode += `      if (ch == ${q}) { peek += chLen; break; }\n`;
    lexerCode += `      peek += chLen;\n`;
    lexerCode += `    }\n`;
    lexerCode += `    lexLen = peek - lexPos;\n`;
    lexerCode += `    srcLexLen = lexLen;\n`;
    // Emit as IDENT token type — find it from existing regex tokens
    let identTokenStr = "ERROR";
    for (const [key, val] of regexTokens.entries()) {
      if (val.includes("[a-zA-Z")) {
        identTokenStr = "T_" + normalized.symToInt.get(key);
        break;
      }
    }
    lexerCode += `    return SyntaxType.${identTokenStr}; // escaped identifier\n`;
    lexerCode += `  }\n`;
  }

  // Task 1.5: String literal with escape sequences
  if (sp && sp.stringLiteral) {
    const sl = sp.stringLiteral;
    const d = sl.delim.codePointAt(0)!;
    lexerCode += `  // String literal with escapes: ${sl.delim}...${sl.delim}\n`;
    lexerCode += `  if (char0 == ${d}) {\n`;
    lexerCode += `    let peek = lexPos + char0Len;\n`;
    lexerCode += `    while (peek < inputLength) {\n`;
    lexerCode += `      let ch = peekChar(peek);\n`;
    lexerCode += `      let chLen = peekCharLen(peek);\n`;
    lexerCode += `      if (ch == 92 && peek + chLen < inputLength) { peek += chLen + peekCharLen(peek + chLen); continue; } // backslash escape\n`;
    lexerCode += `      if (ch == ${d}) { peek += chLen; break; }\n`;
    lexerCode += `      peek += chLen;\n`;
    lexerCode += `    }\n`;
    lexerCode += `    lexLen = peek - lexPos;\n`;
    lexerCode += `    srcLexLen = lexLen;\n`;
    let strTokenStr = "ERROR";
    for (const [key, val] of regexTokens.entries()) {
      if (val.includes('"[^"]*"')) {
        strTokenStr = "T_" + normalized.symToInt.get(key);
        break;
      }
    }
    // Fallback: if there is a 'string' token, use it
    if (strTokenStr === "ERROR" && normalized.symToInt.has("string")) {
      strTokenStr = "T_" + normalized.symToInt.get("string");
    }
    lexerCode += `    return SyntaxType.${strTokenStr}; // string with escapes\n`;
    lexerCode += `  }\n`;
  }

  // 1. String Literals (existing)
  // 1. String Literals (existing)
  // 1. String Literals (existing)
  lexerCode += `  // --- String Literals ---\n`;
  const keywordTokens = new Map<string, string>();
  const stringEntries = Array.from(stringTokens.entries());
  stringEntries.sort((a, b) => b[1].length - a[1].length);
  const stringBranchesByChar0 = new Map<number, string>();
  const isWordCodePoint = (cp: number): boolean =>
    (cp >= 65 && cp <= 90) || (cp >= 97 && cp <= 122) || (cp >= 48 && cp <= 57) || cp === 95;

  for (const [key, val] of stringEntries) {
    const mappedInt = normalized.symToInt.get(`"${val}"`);
    if (!mappedInt) continue;
    const safeName = "T_" + mappedInt;

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

    if (grammar.word && isWord && !isReserved) {
      // Tree-sitter style keyword extraction: defer this literal to the identifier fallback!
      keywordTokens.set(val, key);
      continue;
    }

    const endsInWord = /[a-zA-Z0-9_]$/.test(val);
    let wordBoundaryCheck = "";
    if (isWord || endsInWord) {
      wordBoundaryCheck = `
        let isBoundary = true;
        if (cPos < inputLength) {
            let nextChar = peekChar(cPos);
            if ((nextChar >= 65 && nextChar <= 90) || (nextChar >= 97 && nextChar <= 122) || (nextChar >= 48 && nextChar <= 57) || nextChar == 95) {
                isBoundary = false;
            }
        }
        if (isBoundary) {
            lexLen = cPos - lexPos;
            return SyntaxType.${safeName};
        }
      `;
    } else {
      wordBoundaryCheck = `
        lexLen = cPos - lexPos;
        return SyntaxType.${safeName};
      `;
    }

    const cps = toCodePoints(val);
    if (cps.length === 0) continue;

    let branchCode = "";
    if (cps.length === 1) {
      if (val === "/") {
        branchCode += `      if (!(lexPos + char0Len < inputLength && (peekChar(lexPos + char0Len) == 42 || peekChar(lexPos + char0Len) == 47))) {\n`;
        branchCode += `        let cPos = lexPos + char0Len;\n`;
        branchCode += wordBoundaryCheck;
        branchCode += `      }\n`;
      } else if (val === "'") {
        branchCode += `      {\n`;
        branchCode += `        let hasClosingQuote: bool = false;\n`;
        branchCode += `        let scanPos: u32 = lexPos + char0Len;\n`;
        branchCode += `        while (scanPos < inputLength) {\n`;
        branchCode += `          let sc: i32 = peekChar(scanPos);\n`;
        branchCode += `          if (sc == 92) {\n`;
        branchCode += `            scanPos += peekCharLen(scanPos);\n`;
        branchCode += `            if (scanPos < inputLength) scanPos += peekCharLen(scanPos);\n`;
        branchCode += `            continue;\n`;
        branchCode += `          }\n`;
        branchCode += `          if (sc == 39) { hasClosingQuote = true; break; }\n`;
        branchCode += `          if (sc == 10 || sc == 13 || sc == 59) break;\n`;
        branchCode += `          scanPos += peekCharLen(scanPos);\n`;
        branchCode += `        }\n`;
        branchCode += `        if (!hasClosingQuote) {\n`;
        branchCode += `          let cPos = lexPos + char0Len;\n`;
        branchCode += wordBoundaryCheck;
        branchCode += `        }\n`;
        branchCode += `      }\n`;
      } else if (
        val === "." &&
        Array.from(regexTokens.values()).some((r) => r.includes("\\.\\d") || r.includes("\\.[0-9]"))
      ) {
        branchCode += `      if (!(lexPos + char0Len < inputLength && peekChar(lexPos + char0Len) >= 48 && peekChar(lexPos + char0Len) <= 57)) {\n`;
        branchCode += `        let cPos = lexPos + char0Len;\n`;
        branchCode += wordBoundaryCheck;
        branchCode += `      }\n`;
      } else {
        branchCode += `      {\n`;
        branchCode += `        let cPos = lexPos + char0Len;\n`;
        branchCode += wordBoundaryCheck;
        branchCode += `      }\n`;
      }
    } else {
      branchCode += `      {\n`;
      branchCode += `        let cPos = lexPos + char0Len;\n`;
      branchCode += `        let sMatch = true;\n`;
      for (let i = 1; i < cps.length; i++) {
        if (
          cps[i] === 32 &&
          hasWhitespaceExtra &&
          i + 1 < cps.length &&
          isWordCodePoint(cps[i - 1]) &&
          isWordCodePoint(cps[i + 1])
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

    stringBranchesByChar0.set(cps[0], (stringBranchesByChar0.get(cps[0]) || "") + branchCode);
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
  const regexList: { pattern: string; tokenName: string }[] = [];
  for (const [key, val] of regexTokens.entries()) {
    const mappedInt = normalized.symToInt.get(key);
    if (!mappedInt) continue;

    // FIND THE ORIGINAL SYMBOL NAME!
    let symName = "";
    for (const [sym, id] of normalized.symToInt.entries()) {
      if (id === mappedInt) {
        symName = sym;
        break;
      }
    }

    let safeName = symName.replace(/[^a-zA-Z0-9]/g, "_");
    if (symName.startsWith('"') || symName.startsWith("/")) {
      safeName = "T_" + mappedInt;
    } else {
      safeName = safeName.toUpperCase();
    }

    let patternStr = val;
    if (val.startsWith("/") && val.lastIndexOf("/") > 0) {
      patternStr = val.substring(1, val.lastIndexOf("/"));
    }
    regexList.push({ pattern: patternStr, tokenName: safeName });
  }

  console.log(
    "lexer.ts: regexList size =",
    regexList.length,
    regexList.map((r) => r.tokenName + "=" + r.pattern),
  );

  if (regexList.length > 0) {
    const dfa = compileRegexToDFA(regexList);

    lexerCode += `  let dfaState = 0;\n`;
    lexerCode += `  let dfaLexLen = 0;\n`;
    lexerCode += `  let lastAcceptingState = -1;\n`;
    lexerCode += `  let lastAcceptingLen = 0;\n`;

    lexerGlobals += `  // DFA Transitions\n`;
    lexerGlobals += `  const classRangesS: StaticArray<i32> = [${(dfa as any).classRanges.map((r: any) => r.s).join(",")}];\n`;
    lexerGlobals += `  const classRangesE: StaticArray<i32> = [${(dfa as any).classRanges.map((r: any) => r.e).join(",")}];\n`;
    lexerGlobals += `  const classRangesC: StaticArray<i32> = [${(dfa as any).classRanges.map((r: any) => r.c).join(",")}];\n`;
    lexerGlobals += `  const dfaTable: StaticArray<i32> = [${dfa.table.join(",")}];\n`;

    lexerCode += `  let nextState = -1;\n`;
    lexerCode += `  while (lexPos + dfaLexLen < inputLength) {\n`;
    lexerCode += `    let c: i32 = peekChar(lexPos + dfaLexLen);\n`;
    lexerCode += `    let charLen: u32 = peekCharLen(lexPos + dfaLexLen);\n`;
    lexerCode += `    let cls = -1;\n`;
    lexerCode += `    let l = 0, r = ${(dfa as any).classRanges.length - 1};\n`;
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
    let hasAcceptingStates = false;
    for (let s = 0; s < dfa.numStates; s++) {
      if (dfa.accepts[s]) {
        lexerCode += `      case ${s}:\n`;
        hasAcceptingStates = true;
      }
    }
    if (hasAcceptingStates) {
      lexerCode += `        lastAcceptingState = dfaState;\n`;
      lexerCode += `        lastAcceptingLen = dfaLexLen;\n`;
      lexerCode += `        // console.log("Accepted state " + lastAcceptingState.toString() + " len " + lastAcceptingLen.toString());\n`;
      lexerCode += `        break;\n`;
    }
    lexerCode += `    }\n`;
    lexerCode += `  }\n`;

    lexerCode += `  // console.log("Final lastAcceptingState " + lastAcceptingState.toString() + " len " + lastAcceptingLen.toString());\n`;
    lexerCode += `  if (lastAcceptingState !== -1) {\n`;
    lexerCode += `    lexLen = lastAcceptingLen;\n`;
    lexerCode += `    switch(lastAcceptingState) {\n`;
    for (let s = 0; s < dfa.numStates; s++) {
      if (dfa.accepts[s]) {
        console.log(`lexer.ts: State ${s} accepts`, dfa.accepts[s]);
        const tokenNames = dfa.accepts[s]!;
        lexerCode += `      case ${s}: {\n`;

        const tokenName = tokenNames[0];

        let isWordToken = false;
        if (wordName) {
          const wordSymInt = normalized.symToInt.get(wordName);
          if (
            tokenName.toUpperCase() === wordName.toUpperCase() ||
            tokenName === wordName ||
            (wordSymInt !== undefined && tokenName === "T_" + wordSymInt)
          ) {
            isWordToken = true;
          } else {
            const dummy$ = new Proxy({}, { get: (t, p: string) => ({ type: "SYMBOL", value: p }) });
            const wRule = toRule(grammar.rules[wordName](dummy$ as any));
            const checkWordRule = (r: any): boolean => {
              if (!r) return false;
              if (r.type === "TOKEN" && r.value) {
                const strVal = r.value.toString();
                const mappedInt = normalized.symToInt.get(strVal);
                if (mappedInt !== undefined && "T_" + mappedInt === tokenName) return true;
                if (
                  strVal.toUpperCase() === tokenName.toUpperCase() ||
                  strVal === tokenName ||
                  (r as any).name === tokenName
                )
                  return true;
              }
              if (r.children) {
                for (const child of r.children) {
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
          console.log("lexer.ts: Injecting " + keywordTokens.size + " keywords into DFA state " + tokenName);
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
                lexerCode += `                if (load<u8>(expected_tokens + <u32>SyntaxType.T_${kwTokenInt}) == 1) return SyntaxType.T_${kwTokenInt};\n`;
                lexerCode += `                if (load<u8>(expected_tokens + <u32>SyntaxType.${tokenName}) == 0) return SyntaxType.T_${kwTokenInt};\n`;
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
            lexerCode += `        if (load<u8>(expected_tokens + <u32>SyntaxType.${tName}) == 1) return SyntaxType.${tName};\n`;
          }
        }

        // Reserved keywords overriding
        let reservedKey = "";
        for (const [key, _] of normalized.reservedKeywords.entries()) {
          const kwTokenInt = normalized.symToInt.get(key);
          if ("T_" + kwTokenInt === tokenName) {
            reservedKey = key;
            break;
          }
        }

        if (reservedKey) {
          const reservedTokens = normalized.reservedKeywords.get(reservedKey)!;
          if (reservedTokens.size > 0) {
            lexerCode += `        // Reserved keywords override (bucketed by length & first code point)\n`;
            const rtByLen = new Map<number, { kwTokenInt: number | undefined; rtCps: number[] }[]>();
            for (const rt of reservedTokens) {
              const rtVal = rt.startsWith('"') ? rt.slice(1, -1) : rt;
              const kwTokenInt = normalized.symToInt.get(rt);
              const rtCps = toCodePoints(rtVal);
              if (rtCps.length === 0) continue;
              let bucket = rtByLen.get(rtVal.length);
              if (!bucket) {
                bucket = [];
                rtByLen.set(rtVal.length, bucket);
              }
              bucket.push({ kwTokenInt, rtCps });
            }
            lexerCode += `        switch (lexLen) {\n`;
            for (const [len, bucket] of rtByLen.entries()) {
              lexerCode += `          case ${len}: {\n`;
              lexerCode += `            let firstCp2 = peekChar(lexPos);\n`;
              lexerCode += `            let kwMatch2 = false;\n`;
              lexerCode += `            let cPos2: u32 = 0;\n`;
              for (const { kwTokenInt, rtCps } of bucket) {
                lexerCode += `            if (firstCp2 == ${rtCps[0]}) {\n`;
                lexerCode += `              kwMatch2 = true; cPos2 = lexPos + peekCharLen(lexPos);\n`;
                for (let i = 1; i < rtCps.length; i++) {
                  lexerCode += `              if (kwMatch2 && peekChar(cPos2) == ${rtCps[i]}) { cPos2 += peekCharLen(cPos2); } else { kwMatch2 = false; }\n`;
                }
                lexerCode += `              if (kwMatch2 && (cPos2 - lexPos == lexLen)) {\n`;
                lexerCode += `                return SyntaxType.T_${kwTokenInt};\n`;
                lexerCode += `              }\n`;
                lexerCode += `            }\n`;
              }
              lexerCode += `            break;\n`;
              lexerCode += `          }\n`;
            }
            lexerCode += `        }\n`;
          }
        }

        lexerCode += `        return SyntaxType.${tokenName};\n`;
        lexerCode += `      }\n`;
      }
    }
    lexerCode += `    }\n`;
    lexerCode += `  }\n`;
  }

  // Task 1.6: Multi-word keyword speculative lookahead
  // After identifier matching, check if ident + space + next word forms a multi-word keyword
  let helpers = "";
  if (sp && sp.multiWordKeywords && sp.multiWordKeywords.length > 0) {
    const validMwkEntries: { mwk: string; firstWord: string; restWords: string; tokenInt: number }[] = [];
    const firstWordLens = new Set<number>();
    for (const mwk of sp.multiWordKeywords) {
      const words = mwk.split(/\s+/);
      if (words.length < 2) continue;
      const firstWord = words[0];
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
      helpers += `        if (afterCh == 0 || !((afterCh >= 65 && afterCh <= 90) || (afterCh >= 97 && afterCh <= 122) || afterCh == 95 || (afterCh >= 48 && afterCh <= 57))) {\n`;
      helpers += `          lexLen = <u32>(rPos - startPos);\n`;
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
  return SyntaxType.ERROR;
}
`;
  lexerCode += helpers;

  if (grammar.scanner) {
    lexerCode += `
// --- External Scanner Helper Primitives ---
export function scanAdvance(skip: boolean = false): void {
  let chLen = peekCharLen(lexPos);
  lexPos += chLen;
  if (skip) {
    srcLexPos = lexPos;
    lexLen = 0;
    srcLexLen = 0;
  } else {
    lexLen += chLen;
    srcLexLen = lexLen;
  }
}

export function scanMarkEnd(): void {
  srcLexLen = lexLen;
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
}

export function scanIsExpected(tok: u32): boolean {
  if (tok > (MAX_TERMINAL_ID as u32)) return false;
  return load<u8>(expected_tokens + tok) == 1;
}

export function scanIsEof(): boolean {
  return lexPos >= inputLength;
}

// --- External Scanner Custom Logic ---
`;
    let rawScanner: any = grammar.scanner;
    if (typeof rawScanner?.scan === "function") {
      rawScanner = rawScanner.scan;
    }
    const dummy$ = new Proxy({}, { get: (_, prop) => ({ type: "SYMBOL", value: String(prop) }) });
    let scannerFn: any = rawScanner;
    try {
      if (typeof rawScanner === "function" && rawScanner.length === 1) {
        const evaluated = rawScanner(dummy$);
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
      const extRules = grammar.externals(dummy$ as any);
      for (const ext of extRules) {
        if (ext && ext.value) extNames.add(ext.value);
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
export function peekToken(pos: u32): i32 {
  let savedLexPos = lexPos;
  let savedLexLen = lexLen;
  let savedSrcLexPos = srcLexPos;
  let savedSrcLexLen = srcLexLen;
  let savedScannerState = currentScannerState;

  let tok = lex(pos);

  lexPos = savedLexPos;
  lexLen = savedLexLen;
  srcLexPos = savedSrcLexPos;
  srcLexLen = savedSrcLexLen;
  currentScannerState = savedScannerState;

  return tok;
}
`;

  return lexerGlobals + lexerCode;
}
