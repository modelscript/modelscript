import { compileRegexToDFA } from "../automata.js";
import type { LanguageOptions, Rule } from "../dsl.js";
import { toRule } from "../dsl.js";
import { NormalizedGrammar } from "../grammar.js";

export function generateLexer(grammar: LanguageOptions<any>, normalized: NormalizedGrammar): string {
  // Extract all token patterns from the grammar rules
  const stringTokens = new Map<string, string>();
  const regexTokens = new Map<string, string>();

  function extractTokens(rule: Rule<any>) {
    if (!rule) return;
    if (typeof rule === "string" || rule instanceof RegExp) {
      rule = { type: "TOKEN", value: rule } as any;
    }
    const ruleType = (rule.type || "").toUpperCase();
    const ruleValue = rule.value !== undefined ? rule.value : (rule as any).arg;
    if (ruleType === "TOKEN" && ruleValue) {
      const isRegex =
        ruleValue instanceof RegExp ||
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
    const wordRule = toRule(wResult);
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
      if (rule.value instanceof RegExp) {
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
  if (wordName && !regexTokens.has(wordName)) {
    // Inject generic word pattern
    regexTokens.set(wordName, "/[_a-zA-Z][_a-zA-Z0-9]*/");
  }

  console.log("lexer.ts: wordRegex is", wordRegex);

  console.log("lexer.ts: stringTokens size =", stringTokens.size, Array.from(stringTokens.keys()));
  let lexerGlobals = `// DFA Lexer State Machine\n`;
  lexerGlobals += `// Extracted ${stringTokens.size} string literals and ${regexTokens.size} regex patterns\n\n`;

  let lexerCode = ``;

  lexerCode += `\nexport let is_extra_token: usize = 0;\n`;
  lexerCode += `export function initExtras(): void {\n`;
  lexerCode += `  if (is_extra_token == 0) {\n    is_extra_token = atomicChunkAlloc(2048);\n    memory.fill(is_extra_token, 0, 2048);\n  }\n`;
  if (normalized.extras) {
    for (const rule of normalized.extras) {
      const rType = (rule.type || "").toUpperCase();
      if (rType === "TOKEN") {
        let val = rule.value.toString();
        if (typeof rule.value === "string") val = `"${rule.value}"`;
        const mappedInt = normalized.symToInt.get(val);
        if (mappedInt !== undefined) {
          lexerCode += `  store<u8>(is_extra_token + <u32>SyntaxType.T_${mappedInt}, 1);\n`;
        }
      }
    }
  }
  lexerCode += `}\n`;

  lexerCode += `export let inputEncoding: u8 = 0;
`;
  lexerCode += `export function setInputEncoding(enc: u8): void { inputEncoding = enc; }

// Internal decode helpers
export function peekChar(pos: u32): i32 {
    if (inputEncoding == 0) {
        let b0 = load<u8>(getInputBuffer() + pos);
        if (b0 >= 0xC0) {
            if (b0 >= 0xF0 && pos + 3 < inputLength) {
                return ((b0 & 0x07) << 18) | ((load<u8>(getInputBuffer() + pos + 1) & 0x3F) << 12) | ((load<u8>(getInputBuffer() + pos + 2) & 0x3F) << 6) | (load<u8>(getInputBuffer() + pos + 3) & 0x3F);
            } else if (b0 >= 0xE0 && pos + 2 < inputLength) {
                return ((b0 & 0x0F) << 12) | ((load<u8>(getInputBuffer() + pos + 1) & 0x3F) << 6) | (load<u8>(getInputBuffer() + pos + 2) & 0x3F);
            } else if (pos + 1 < inputLength) {
                return ((b0 & 0x1F) << 6) | (load<u8>(getInputBuffer() + pos + 1) & 0x3F);
            }
        }
        return b0;
    } else if (inputEncoding == 1) {
        let b0 = load<u16>(getInputBuffer() + pos);
        if (b0 >= 0xD800 && b0 <= 0xDBFF && pos + 2 < inputLength) {
            let b1 = load<u16>(getInputBuffer() + pos + 2);
            return ((b0 - 0xD800) << 10) + (b1 - 0xDC00) + 0x10000;
        }
        return b0;
    } else if (inputEncoding == 2) {
        let b0 = bswap<u16>(load<u16>(getInputBuffer() + pos)) >> 16;
        if (b0 >= 0xD800 && b0 <= 0xDBFF && pos + 2 < inputLength) {
            let b1 = bswap<u16>(load<u16>(getInputBuffer() + pos + 2)) >> 16;
            return ((b0 - 0xD800) << 10) + (b1 - 0xDC00) + 0x10000;
        }
        return b0;
    } else if (inputEncoding == 3) {
        return load<u32>(getInputBuffer() + pos);
    } else if (inputEncoding == 4) {
        return bswap<u32>(load<u32>(getInputBuffer() + pos));
    }
    return 0;
}

export function peekCharLen(pos: u32): u32 {
    if (inputEncoding == 0) {
        let b0 = load<u8>(getInputBuffer() + pos);
        if (b0 >= 0xF0) return 4;
        if (b0 >= 0xE0) return 3;
        if (b0 >= 0xC0) return 2;
        return 1;
    } else if (inputEncoding == 1) {
        let b0 = load<u16>(getInputBuffer() + pos);
        if (b0 >= 0xD800 && b0 <= 0xDBFF) return 4;
        return 2;
    } else if (inputEncoding == 2) {
        let b0 = bswap<u16>(load<u16>(getInputBuffer() + pos)) >> 16;
        if (b0 >= 0xD800 && b0 <= 0xDBFF) return 4;
        return 2;
    }
    return 4;
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
  lexerCode += `  if (lexPos >= inputLength) { srcLexPos = lexPos; return 1023; } // EOF
`;

  // Inject External Scanner Custom State/Functions
  if (grammar.scanner) {
    lexerCode += `  // --- External Scanner --- 
`;
    lexerCode += `  let extToken = scanExternal(lexPos, currentScannerState);
`;
    lexerCode += `  if (extToken != 0) return extToken;

`;
  }

  let hasWhitespaceExtra = false;
  if (normalized.extras) {
    for (const rule of normalized.extras) {
      if (rule.type === "TOKEN") {
        let val = rule.value.toString();
        if (
          val === "/\\s/" ||
          val === "/\\s+/" ||
          val === "/[\\s]/" ||
          val === "/[\\s]+/" ||
          val === "/[ \\t\\n\\r]+/" ||
          val === "/[ \\t\\n\\r]/"
        ) {
          hasWhitespaceExtra = true;
        }
      }
    }
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
      lexerCode += `    if (c == 32 || c == 9 || c == 10 || c == 13) {\n`;
      lexerCode += `      lexPos += charLen;\n`;
      lexerCode += `      continue;\n`;
      lexerCode += `    }\n`;
    }

    // Task 1.3: Line comment scanner
    if (sp && sp.lineComment) {
      const lc = sp.lineComment;
      if (lc.length === 2) {
        lexerCode += `    // Line comment: ${lc}\n`;
        lexerCode += `    let c2_lc = lexPos + charLen < inputLength ? peekChar(lexPos + charLen) : 0;\n`;
        lexerCode += `    if (c == ${lc.charCodeAt(0)} && c2_lc == ${lc.charCodeAt(1)}) {\n`;
        lexerCode += `      lexPos += charLen + peekCharLen(lexPos + charLen);\n`;
        lexerCode += `      while (lexPos < inputLength && peekChar(lexPos) != 10) lexPos += peekCharLen(lexPos);\n`;
        lexerCode += `      if (lexPos < inputLength) lexPos += peekCharLen(lexPos); // skip newline\n`;
        lexerCode += `      continue;\n`;
        lexerCode += `    }\n`;
      } else if (lc.length === 1) {
        lexerCode += `    if (c == ${lc.charCodeAt(0)}) {\n`;
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
      const o0 = nc.open.charCodeAt(0);
      const o1 = nc.open.charCodeAt(1);
      const c0 = nc.close.charCodeAt(0);
      const c1 = nc.close.charCodeAt(1);
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
  lexerCode += `  if (lexPos >= inputLength) return 1023; // EOF\n\n`;

  lexerCode += `  let char0: i32 = peekChar(lexPos);\n`;
  lexerCode += `  let char0Len: u32 = peekCharLen(lexPos);\n\n`;

  // --- Scanner Primitives: Priority Token Matchers ---

  // Task 1.4: Escaped identifier scanner (e.g., Modelica Q-IDENT: 'name with spaces')
  if (sp && sp.escapedIdent) {
    const ei = sp.escapedIdent;
    const q = ei.quote.charCodeAt(0);
    const esc = ei.escape ? ei.escape.charCodeAt(0) : -1;
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
    const d = sl.delim.charCodeAt(0);
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
  for (const [key, val] of stringEntries) {
    const mappedInt = normalized.symToInt.get(`"${val}"`);
    if (!mappedInt) continue;
    const safeName = "T_" + mappedInt;

    const isWord = wordRegex ? wordRegex.test(val) : false;
    if (val === "model") {
      console.log(`lexer.ts: Debug 'model': mappedInt=${mappedInt}, isWord=${isWord}, hasWord=${!!grammar.word}`);
    }

    // Determine if this literal is a reserved keyword
    let isReserved = false;
    for (const reservedTokens of normalized.reservedKeywords.values()) {
      // reservedTokens contains strings with quotes like '"end"'
      if (reservedTokens.has(`"${val}"`) || reservedTokens.has(val)) {
        isReserved = true;
        break;
      }
    }
    if (val === "model") {
      console.log(`lexer.ts: Debug 'model': isReserved=${isReserved}`);
    }

    if (grammar.word && isWord && !isReserved) {
      // Tree-sitter style keyword extraction: defer this literal to the identifier fallback!
      keywordTokens.set(val, key);
      console.log("lexer.ts: keywordTokens added:", val, "size:", keywordTokens.size);
      continue;
    }

    let wordBoundaryCheck = "";
    if (isWord) {
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

    if (val.length === 1) {
      lexerCode += `  if (char0 == ${val.charCodeAt(0)}) {\n`;
      lexerCode += `    let cPos = lexPos + char0Len;\n`;
      lexerCode += wordBoundaryCheck;
      lexerCode += `  }\n`;
    } else {
      lexerCode += `  if (char0 == ${val.charCodeAt(0)}) {\n`;
      lexerCode += `    let cPos = lexPos + char0Len;\n`;
      lexerCode += `    let sMatch = true;\n`;
      for (let i = 1; i < val.length; i++) {
        lexerCode += `    if (sMatch && cPos < inputLength && peekChar(cPos) == ${val.charCodeAt(i)}) { cPos += peekCharLen(cPos); } else { sMatch = false; }\n`;
      }
      lexerCode += `    if (sMatch) {\n`;
      lexerCode += wordBoundaryCheck;
      lexerCode += `    }\n`;
      lexerCode += `  }\n`;
    }
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
          if (tokenName === wordName) {
            isWordToken = true;
          } else {
            const dummy$ = new Proxy({}, { get: (t, p: string) => ({ type: "SYMBOL", value: p }) });
            const wRule = toRule(grammar.rules[wordName](dummy$ as any));
            const wKey = wRule.value?.toString() || "";
            const wTokenInt = normalized.symToInt.get(wKey);
            let wTokenStr = "T_" + wTokenInt;
            if (wKey === wordName) wTokenStr = wordName;
            if (wTokenStr === tokenName) isWordToken = true;
          }
        }

        if (isWordToken) {
          console.log("lexer.ts: Injecting " + keywordTokens.size + " keywords into DFA state " + tokenName);
          if (sp && sp.multiWordKeywords && sp.multiWordKeywords.length > 0) {
            lexerCode += `        // Multi-word keyword lookahead\n`;
            lexerCode += `        let mwkToken = checkMultiWordKeyword(lexPos, lexLen);\n`;
            lexerCode += `        if (mwkToken != 0) { return mwkToken; }\n`;
          }
          lexerCode += `        // Keyword extraction optimization\n`;
          lexerCode += `        let kwMatch = false;\n`;
          lexerCode += `        let cPos = lexPos;\n`;
          for (const [kw, _] of keywordTokens.entries()) {
            const kwTokenInt = normalized.symToInt.get(`"${kw}"`);
            lexerCode += `        kwMatch = true; cPos = lexPos;\n`;
            for (let i = 0; i < kw.length; i++) {
              lexerCode += `        if (kwMatch && peekChar(cPos) == ${kw.charCodeAt(i)}) { cPos += peekCharLen(cPos); } else { kwMatch = false; }\n`;
            }
            lexerCode += `        if (kwMatch && (cPos - lexPos == lexLen)) {\n`;
            lexerCode += `           if (load<u8>(expected_tokens + <u32>SyntaxType.T_${kwTokenInt}) == 1) return SyntaxType.T_${kwTokenInt};\n`;
            lexerCode += `           if (load<u8>(expected_tokens + <u32>SyntaxType.${tokenName}) == 0) return SyntaxType.T_${kwTokenInt};\n`;
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
          lexerCode += `        // Reserved keywords override\n`;
          lexerCode += `        let kwMatch2 = false;\n`;
          lexerCode += `        let cPos2 = lexPos;\n`;
          const reservedTokens = normalized.reservedKeywords.get(reservedKey)!;
          for (const rt of reservedTokens) {
            const rtVal = rt.startsWith('"') ? rt.slice(1, -1) : rt;
            const kwTokenInt = normalized.symToInt.get(rt);
            lexerCode += `        kwMatch2 = true; cPos2 = lexPos;\n`;
            for (let i = 0; i < rtVal.length; i++) {
              lexerCode += `        if (kwMatch2 && peekChar(cPos2) == ${rtVal.charCodeAt(i)}) { cPos2 += peekCharLen(cPos2); } else { kwMatch2 = false; }\n`;
            }
            lexerCode += `        if (kwMatch2 && (cPos2 - lexPos == lexLen)) {\n`;
            lexerCode += `           return SyntaxType.T_${kwTokenInt};\n`;
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
    helpers += `
  // --- Multi-Word Keyword Lookahead ---
`;
    helpers += `  // After matching an identifier, speculatively check for multi-word keywords
`;
    // Generate a post-ident check function
    helpers += `function checkMultiWordKeyword(startPos: u32, identLen: u32): i32 {
`;
    helpers += `  let afterIdent = startPos + identLen;
`;
    helpers += `  // Skip whitespace between words
`;
    helpers += `  let wsPos = afterIdent;
`;
    helpers += `  while (wsPos < inputLength) { let ch = peekChar(wsPos); if (ch == 32 || ch == 9) { wsPos += peekCharLen(wsPos); } else { break; } }\n`;
    helpers += `  if (wsPos == afterIdent) return 0; // No whitespace = not multi-word\n`;

    for (const mwk of sp.multiWordKeywords) {
      const words = mwk.split(/\s+/);
      if (words.length < 2) continue;
      const firstWord = words[0];
      const restWords = words.slice(1).join(" ");

      const tokenInt = normalized.symToInt.get(`"${mwk}"`);
      if (tokenInt) {
        helpers += `  // "${mwk}"\n`;
        helpers += `  {\n`;
        helpers += `    let mMatch = true;\n`;
        helpers += `    let mPos = startPos;\n`;
        for (let i = 0; i < firstWord.length; i++) {
          helpers += `    if (mMatch && peekChar(mPos) == ${firstWord.charCodeAt(i)}) { mPos += peekCharLen(mPos); } else { mMatch = false; }\n`;
        }
        helpers += `    if (mMatch && (mPos - startPos == identLen)) {\n`;
        helpers += `      let rPos = wsPos;\n`;
        for (let i = 0; i < restWords.length; i++) {
          helpers += `      if (mMatch && peekChar(rPos) == ${restWords.charCodeAt(i)}) { rPos += peekCharLen(rPos); } else { mMatch = false; }\n`;
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
    }
    helpers += `  return 0;
`;
    helpers += `}
`;
  }
  lexerCode += `
  lexLen = peekCharLen(lexPos);
  if (lexLen == 0) lexLen = 2; // Fail-safe
  return SyntaxType.ERROR;
}
`;
  lexerCode += helpers;

  if (grammar.scanner) {
    lexerCode += `
// External Scanner Custom Code
`;
    let scannerStr = grammar.scanner.toString();
    let bodyCode = "";

    // Fallback regex to extract the body of a function or arrow function
    const blockMatch = scannerStr.match(/^[^{]*\{([\s\S]*)\}\s*$/);
    if (blockMatch) {
      bodyCode = blockMatch[1].trim();
    } else {
      const arrowMatch = scannerStr.match(/^[^=]*=>\s*(.*)$/);
      if (arrowMatch) {
        bodyCode = "return " + arrowMatch[1] + ";";
      }
    }

    if (bodyCode) {
      lexerCode += `function scanExternal(currentPos: u32, scannerState: u32): i32 {\n${bodyCode}\n}\n`;
    } else {
      lexerCode += scannerStr + "\n";
    }
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
