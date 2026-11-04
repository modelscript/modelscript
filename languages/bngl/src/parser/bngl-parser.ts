// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/bngl — Zero-Regex Character-by-Character BioNetGen (.bngl) Parser & Serializer.
 *
 * Parses 'begin model ... end model', 'parameters', 'compartments', 'molecule types',
 * 'seed species', 'observables', 'functions', 'reaction rules', complex graphs with
 * site states (~U, ~P) and bond labels (!1, !+, !?), and simulation actions.
 */

import type {
  BnglAction,
  BnglCompartment,
  BnglComplexPattern,
  BnglComponentState,
  BnglDocument,
  BnglFunction,
  BnglModel,
  BnglMoleculeInstance,
  BnglMoleculeType,
  BnglObservable,
  BnglObservableType,
  BnglParameter,
  BnglRange,
  BnglReactionRule,
  BnglSeedSpecies,
  BnglSiteDef,
} from "../types.js";

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\r" || ch === "\n";
}

function isDigit(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlpha(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNum(ch: string): boolean {
  return isAlpha(ch) || isDigit(ch);
}

interface LogicalLine {
  text: string;
  range: BnglRange;
}

/**
 * Strips '#' comments and joins backslash-continued lines into logical lines with source ranges.
 */
function extractLogicalLines(source: string): LogicalLine[] {
  const result: LogicalLine[] = [];
  const n = source.length;
  let pos = 0;
  let line = 1;
  let col = 1;

  let accText = "";
  let startLine = 1;
  let startCol = 1;
  let startOffset = 0;
  let hasStart = false;

  while (pos < n) {
    const lineStartOffset = pos;
    const lineStartNum = line;
    const lineStartCol = col;

    let rawContent = "";
    while (pos < n && source[pos] !== "\n") {
      const ch = source[pos] ?? "";
      if (ch === "#") {
        while (pos < n && source[pos] !== "\n") {
          pos++;
          col++;
        }
        break;
      }
      if (ch !== "\r") {
        rawContent += ch;
      }
      pos++;
      col++;
    }

    const lineEndOffset = pos;
    const lineEndNum = line;
    const lineEndCol = col;

    if (pos < n && source[pos] === "\n") {
      pos++;
      line++;
      col = 1;
    }

    const trimmedRight = rawContent.trimEnd();
    if (!hasStart && trimmedRight.trim().length > 0) {
      hasStart = true;
      startLine = lineStartNum;
      startCol = lineStartCol;
      startOffset = lineStartOffset;
    }

    if (trimmedRight.endsWith("\\")) {
      const withoutSlash = trimmedRight.slice(0, trimmedRight.length - 1);
      accText += (accText.length > 0 ? " " : "") + withoutSlash.trim();
      continue;
    }

    accText += (accText.length > 0 ? " " : "") + trimmedRight.trim();
    const finalTrimmed = accText.trim();

    if (finalTrimmed.length > 0) {
      // Split by ';' outside parentheses/braces if multiple statements on one line
      const subStatements = splitTopLevelByChar(finalTrimmed, ";");
      for (const stmt of subStatements) {
        const sTrim = stmt.trim();
        if (sTrim.length > 0) {
          result.push({
            text: sTrim,
            range: {
              startLine: hasStart ? startLine : lineStartNum,
              startColumn: hasStart ? startCol : lineStartCol,
              endLine: lineEndNum,
              endColumn: lineEndCol,
              startOffset: hasStart ? startOffset : lineStartOffset,
              endOffset: lineEndOffset,
            },
          });
        }
      }
    }

    accText = "";
    hasStart = false;
  }

  if (accText.trim().length > 0) {
    result.push({
      text: accText.trim(),
      range: {
        startLine,
        startColumn: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: n,
      },
    });
  }

  return result;
}

/**
 * Splits a string by a delimiter character only at nesting depth 0 (outside (), {}, []).
 */
function splitTopLevelByChar(input: string, delimiter: string): string[] {
  const parts: string[] = [];
  let current = "";
  let depth = 0;
  let inQuotes = false;
  let quoteChar = "";

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (inQuotes) {
      current += ch;
      if (ch === quoteChar && input[i - 1] !== "\\") {
        inQuotes = false;
      }
      continue;
    }
    if (ch === '"' || ch === "'") {
      inQuotes = true;
      quoteChar = ch;
      current += ch;
      continue;
    }
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth === 0 && ch === delimiter) {
      parts.push(current);
      current = "";
      continue;
    }
    current += ch;
  }
  parts.push(current);
  return parts;
}

/**
 * Splits a string by whitespace at nesting depth 0.
 */
function splitTopLevelByWhitespace(input: string): string[] {
  const tokens: string[] = [];
  let current = "";
  let depth = 0;

  for (let i = 0; i < input.length; i++) {
    const ch = input[i] ?? "";
    if (ch === "(" || ch === "{" || ch === "[") {
      depth++;
      current += ch;
      continue;
    }
    if (ch === ")" || ch === "}" || ch === "]") {
      depth = Math.max(0, depth - 1);
      current += ch;
      continue;
    }
    if (depth === 0 && isWhitespace(ch)) {
      if (current.length > 0) {
        tokens.push(current);
        current = "";
      }
      continue;
    }
    current += ch;
  }
  if (current.length > 0) {
    tokens.push(current);
  }
  return tokens;
}

/**
 * Checks if a string consists solely of ASCII digits.
 */
function isPureIntegerString(str: string): boolean {
  if (str.length === 0) return false;
  for (let i = 0; i < str.length; i++) {
    if (!isDigit(str[i] ?? "")) return false;
  }
  return true;
}

/**
 * Evaluates a numeric or parameter arithmetic expression without eval or regex.
 */
export function evaluateBnglNumericExpr(expr: string, params: Map<string, BnglParameter>): number {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return 0.0;

  const direct = Number(trimmed);
  if (!Number.isNaN(direct)) return direct;

  // Tokenize simple math expression
  const tokens: string[] = [];
  let i = 0;
  const n = trimmed.length;
  while (i < n) {
    const ch = trimmed[i] ?? "";
    if (isWhitespace(ch)) {
      i++;
      continue;
    }
    if (isDigit(ch) || (ch === "." && isDigit(trimmed[i + 1] ?? ""))) {
      let numStr = "";
      while (i < n && isDigit(trimmed[i] ?? "")) {
        numStr += trimmed[i] ?? "";
        i++;
      }
      if (i < n && trimmed[i] === ".") {
        numStr += ".";
        i++;
        while (i < n && isDigit(trimmed[i] ?? "")) {
          numStr += trimmed[i] ?? "";
          i++;
        }
      }
      if (i < n && (trimmed[i] === "e" || trimmed[i] === "E")) {
        const next = trimmed[i + 1] ?? "";
        const next2 = trimmed[i + 2] ?? "";
        if (isDigit(next) || ((next === "+" || next === "-") && isDigit(next2))) {
          numStr += trimmed[i] ?? "";
          i++;
          if (trimmed[i] === "+" || trimmed[i] === "-") {
            numStr += trimmed[i] ?? "";
            i++;
          }
          while (i < n && isDigit(trimmed[i] ?? "")) {
            numStr += trimmed[i] ?? "";
            i++;
          }
        }
      }
      tokens.push(numStr);
      continue;
    }
    if (isAlpha(ch)) {
      let idStr = "";
      while (i < n && isAlphaNum(trimmed[i] ?? "")) {
        idStr += trimmed[i] ?? "";
        i++;
      }
      tokens.push(idStr);
      continue;
    }
    if ("+-*/^()".includes(ch)) {
      tokens.push(ch);
      i++;
      continue;
    }
    i++;
  }

  let pos = 0;
  const peek = (): string | undefined => tokens[pos];
  const consume = (): string => tokens[pos++] ?? "";

  const parseAddSub = (): number => {
    let left = parseMulDiv();
    while (peek() === "+" || peek() === "-") {
      const op = consume();
      const right = parseMulDiv();
      left = op === "+" ? left + right : left - right;
    }
    return left;
  };

  const parseMulDiv = (): number => {
    let left = parsePow();
    while (peek() === "*" || peek() === "/") {
      const op = consume();
      const right = parsePow();
      left = op === "*" ? left * right : right !== 0 ? left / right : 0;
    }
    return left;
  };

  const parsePow = (): number => {
    const base = parseUnary();
    if (peek() === "^") {
      consume();
      const exp = parsePow();
      return Math.pow(base, exp);
    }
    return base;
  };

  const parseUnary = (): number => {
    if (peek() === "-") {
      consume();
      return -parseUnary();
    }
    if (peek() === "+") {
      consume();
      return parseUnary();
    }
    return parsePrimary();
  };

  const parsePrimary = (): number => {
    const tok = peek();
    if (!tok) return 0;
    if (tok === "(") {
      consume();
      const val = parseAddSub();
      if (peek() === ")") consume();
      return val;
    }
    const num = Number(tok);
    if (!Number.isNaN(num)) {
      consume();
      return num;
    }
    const id = consume();
    if (peek() === "(") {
      consume();
      const arg = parseAddSub();
      if (peek() === ")") consume();
      const lower = id.toLowerCase();
      if (lower === "exp") return Math.exp(arg);
      if (lower === "log" || lower === "ln") return Math.log(Math.max(1e-15, arg));
      if (lower === "sqrt") return Math.sqrt(Math.max(0, arg));
      if (lower === "sin") return Math.sin(arg);
      if (lower === "cos") return Math.cos(arg);
      if (lower === "abs") return Math.abs(arg);
      return arg;
    }
    if (id.toLowerCase() === "pi") return Math.PI;
    if (id.toLowerCase() === "e") return Math.E;
    const p = params.get(id);
    return p ? p.value : 0;
  };

  return parseAddSub();
}

/**
 * Parses a single molecule type declaration such as 'R(l,Y~U~P)'.
 */
export function parseMoleculeTypeDef(raw: string, range?: BnglRange): BnglMoleculeType {
  let text = raw.trim();
  // Strip optional leading index e.g. '1 R(l,Y~U~P)'
  const spaceIdx = text.indexOf(" ");
  if (spaceIdx > 0) {
    const firstWord = text.slice(0, spaceIdx).trim();
    if (isPureIntegerString(firstWord)) {
      text = text.slice(spaceIdx + 1).trim();
    }
  }

  const openParen = text.indexOf("(");
  const closeParen = text.lastIndexOf(")");
  if (openParen < 0) {
    return {
      name: text.trim(),
      sites: [],
      range,
    };
  }

  const name = text.slice(0, openParen).trim();
  const inside = closeParen > openParen ? text.slice(openParen + 1, closeParen).trim() : "";

  const sites: BnglSiteDef[] = [];
  if (inside.length > 0) {
    const rawSites = splitTopLevelByChar(inside, ",");
    for (const rawSite of rawSites) {
      const sTrim = rawSite.trim();
      if (sTrim.length === 0) continue;
      const tildeParts = splitTopLevelByChar(sTrim, "~");
      const siteName = (tildeParts[0] ?? "").trim();
      const allowedStates: string[] = [];
      for (let i = 1; i < tildeParts.length; i++) {
        const st = (tildeParts[i] ?? "").trim();
        if (st.length > 0) {
          allowedStates.push(st);
        }
      }
      if (siteName.length > 0) {
        sites.push({ name: siteName, allowedStates, range });
      }
    }
  }

  return { name, sites, range };
}

/**
 * Parses a single component state specification inside a molecule instance, e.g. 'l!1', 'Y~U', 's~P!2'.
 */
function parseComponentSpec(raw: string, range?: BnglRange): BnglComponentState {
  const s = raw.trim();
  let name = "";
  let state: string | undefined;
  let bond: string | undefined;

  let i = 0;
  const n = s.length;
  while (i < n && s[i] !== "~" && s[i] !== "!") {
    name += s[i] ?? "";
    i++;
  }
  name = name.trim();

  while (i < n) {
    const marker = s[i];
    if (marker === "~") {
      i++;
      let st = "";
      while (i < n && s[i] !== "!" && s[i] !== "~") {
        st += s[i] ?? "";
        i++;
      }
      state = st.trim();
    } else if (marker === "!") {
      i++;
      let bd = "";
      while (i < n && s[i] !== "~" && s[i] !== "!") {
        bd += s[i] ?? "";
        i++;
      }
      bond = bd.trim();
    } else {
      i++;
    }
  }

  return {
    name,
    state: state && state.length > 0 ? state : undefined,
    bond: bond && bond.length > 0 ? bond : undefined,
    range,
  };
}

/**
 * Parses a single molecule instance such as 'R(l!1,Y~U)'.
 */
function parseMoleculeInstance(raw: string, range?: BnglRange): BnglMoleculeInstance {
  let text = raw.trim();
  let compartment: string | undefined;

  // Check prefix '@Comp:'
  if (text.startsWith("@")) {
    const colonIdx = text.indexOf(":");
    if (colonIdx > 1) {
      compartment = text.slice(1, colonIdx).trim();
      text = text.slice(colonIdx + 1).trim();
    }
  }

  // Check suffix '@Comp' after ')'
  const closeParen = text.lastIndexOf(")");
  if (closeParen >= 0 && closeParen + 1 < text.length) {
    const tail = text.slice(closeParen + 1).trim();
    if (tail.startsWith("@") && tail.length > 1) {
      compartment = tail.slice(1).trim();
      text = text.slice(0, closeParen + 1).trim();
    }
  } else if (closeParen < 0) {
    const atIdx = text.indexOf("@");
    if (atIdx > 0) {
      compartment = text.slice(atIdx + 1).trim();
      text = text.slice(0, atIdx).trim();
    }
  }

  const openParen = text.indexOf("(");
  const endParen = text.lastIndexOf(")");
  if (openParen < 0) {
    return {
      name: text.trim(),
      components: [],
      compartment,
      range,
    };
  }

  const name = text.slice(0, openParen).trim();
  const inside = endParen > openParen ? text.slice(openParen + 1, endParen).trim() : "";
  const components: BnglComponentState[] = [];

  if (inside.length > 0) {
    const specs = splitTopLevelByChar(inside, ",");
    for (const spec of specs) {
      if (spec.trim().length > 0) {
        components.push(parseComponentSpec(spec, range));
      }
    }
  }

  return {
    name,
    components,
    compartment,
    range,
  };
}

/**
 * Parses a BNGL complex pattern such as 'L(r!1).R(l!1,Y~U)' or '@EC:L(r)'.
 */
export function parseComplexPattern(raw: string, range?: BnglRange): BnglComplexPattern {
  let text = raw.trim();
  let isConstant = false;
  let compartment: string | undefined;
  let stoichiometry: number | undefined;

  if (text.startsWith("$")) {
    isConstant = true;
    text = text.slice(1).trim();
  }

  // Check leading stoichiometry like '2 L(r)'
  const spaceTokens = splitTopLevelByWhitespace(text);
  if (spaceTokens.length === 2 && isPureIntegerString(spaceTokens[0] ?? "")) {
    stoichiometry = Number(spaceTokens[0]);
    text = (spaceTokens[1] ?? "").trim();
    if (text.startsWith("$")) {
      isConstant = true;
      text = text.slice(1).trim();
    }
  }

  // Check complex-level compartment prefix '@EC:L(r).R(l)'
  if (text.startsWith("@")) {
    const colonIdx = text.indexOf(":");
    if (colonIdx > 1) {
      compartment = text.slice(1, colonIdx).trim();
      text = text.slice(colonIdx + 1).trim();
    }
  }

  // Split by '.' outside parentheses
  const molStrings = splitTopLevelByChar(text, ".");
  const molecules: BnglMoleculeInstance[] = [];

  for (const mStr of molStrings) {
    const trimmedMol = mStr.trim();
    if (trimmedMol.length === 0 || trimmedMol === "0" || trimmedMol === "Trash") {
      continue;
    }
    const inst = parseMoleculeInstance(trimmedMol, range);
    if (inst.compartment && !compartment) {
      compartment = inst.compartment;
    }
    molecules.push(inst);
  }

  return {
    molecules,
    compartment,
    stoichiometry,
    isConstant: isConstant ? true : undefined,
    raw: raw.trim(),
    range,
  };
}

/**
 * Serializes a BnglComplexPattern back into canonical BNGL string syntax.
 */
export function serializeComplexPattern(pattern: BnglComplexPattern): string {
  if (pattern.molecules.length === 0) {
    return "0";
  }
  const prefix = (pattern.isConstant ? "$" : "") + (pattern.compartment ? `@${pattern.compartment}:` : "");
  const molParts = pattern.molecules.map((m) => {
    const compStr = m.components
      .map((c) => {
        let s = c.name;
        if (c.state !== undefined) s += `~${c.state}`;
        if (c.bond !== undefined) s += `!${c.bond}`;
        return s;
      })
      .join(",");
    return `${m.name}(${compStr})`;
  });
  const body = `${prefix}${molParts.join(".")}`;
  if (pattern.stoichiometry !== undefined && pattern.stoichiometry !== 1) {
    return `${pattern.stoichiometry} ${body}`;
  }
  return body;
}

const RULE_MODIFIER_KEYWORDS = new Set(["DeleteMolecules", "MoveConnected", "TotalRate"]);

/**
 * Parses a single reaction rule line from 'begin reaction rules'.
 */
function parseReactionRuleLine(lineText: string, ruleIndex: number, range: BnglRange): BnglReactionRule | null {
  let text = lineText.trim();
  if (text.length === 0) return null;

  let ruleId = `R${ruleIndex}`;
  let ruleName: string | undefined;

  // Check for 'RuleName: ...' at top level before any '(' or '->'
  const arrowPos = text.indexOf("->");
  const colonPos = text.indexOf(":");
  const firstParen = text.indexOf("(");

  if (
    colonPos > 0 &&
    (arrowPos < 0 || colonPos < arrowPos) &&
    (firstParen < 0 || colonPos < firstParen) &&
    !text.startsWith("@")
  ) {
    const candidateName = text.slice(0, colonPos).trim();
    if (candidateName.length > 0 && !candidateName.includes(" ")) {
      ruleId = candidateName;
      ruleName = candidateName;
      text = text.slice(colonPos + 1).trim();
    }
  } else {
    // Check for leading numeric index e.g. '1 L(r) + R(l) -> ...'
    const firstSpace = text.indexOf(" ");
    if (firstSpace > 0) {
      const firstTok = text.slice(0, firstSpace).trim();
      const afterFirst = text.slice(firstSpace + 1).trim();
      if (isPureIntegerString(firstTok) && !afterFirst.startsWith("+") && !afterFirst.startsWith("-")) {
        ruleId = `R${firstTok}`;
        text = afterFirst;
      }
    }
  }

  // Locate '<->' or '->' at depth 0
  let arrowStart = -1;
  let arrowLen = 0;
  let reversible = false;
  let depth = 0;

  for (let i = 0; i < text.length; i++) {
    const ch = text[i] ?? "";
    if (ch === "(" || ch === "{" || ch === "[") depth++;
    else if (ch === ")" || ch === "}" || ch === "]") depth = Math.max(0, depth - 1);
    else if (depth === 0) {
      if (ch === "<" && text[i + 1] === "-" && text[i + 2] === ">") {
        arrowStart = i;
        arrowLen = 3;
        reversible = true;
        break;
      }
      if (ch === "-" && text[i + 1] === ">") {
        arrowStart = i;
        arrowLen = 2;
        reversible = false;
        break;
      }
    }
  }

  if (arrowStart < 0) return null;

  const lhsText = text.slice(0, arrowStart).trim();
  const rhsAndRates = text.slice(arrowStart + arrowLen).trim();

  // Parse reactants on LHS
  const reactantParts = splitTopLevelByChar(lhsText, "+");
  const reactants: BnglComplexPattern[] = [];
  for (const rPart of reactantParts) {
    const rTrim = rPart.trim();
    if (rTrim.length === 0 || rTrim === "0" || rTrim === "Trash") continue;
    reactants.push(parseComplexPattern(rTrim, range));
  }

  // Separate products from rate constants on RHS using top-level whitespace tokens
  const rhsTokens = splitTopLevelByWhitespace(rhsAndRates);
  const productTokens: string[] = [];
  let rateStartIdx = rhsTokens.length;

  let i = 0;
  while (i < rhsTokens.length) {
    const tok = rhsTokens[i] ?? "";
    if (tok === "+") {
      productTokens.push(tok);
      i++;
      continue;
    }

    // If first product token or immediately following a '+', it belongs to products
    const prevTok = productTokens[productTokens.length - 1];
    if (productTokens.length === 0 || prevTok === "+") {
      if (isPureIntegerString(tok) && tok !== "0" && i + 1 < rhsTokens.length) {
        const nextTok = rhsTokens[i + 1] ?? "";
        if (nextTok !== "+" && nextTok.includes("(")) {
          productTokens.push(`${tok} ${nextTok}`);
          i += 2;
          continue;
        }
      }
      productTokens.push(tok);
      i++;
      continue;
    }

    // Otherwise we have reached the rate expression(s)
    rateStartIdx = i;
    break;
  }

  const rhsProductsStr = productTokens.join(" ");
  const productParts = splitTopLevelByChar(rhsProductsStr, "+");
  const products: BnglComplexPattern[] = [];
  for (const pPart of productParts) {
    const pTrim = pPart.trim();
    if (pTrim.length === 0 || pTrim === "0" || pTrim === "Trash") continue;
    products.push(parseComplexPattern(pTrim, range));
  }

  // Extract modifiers and rate expressions from remaining tokens
  const remainingTokens = rhsTokens.slice(rateStartIdx);
  const modifiers: string[] = [];
  const rateTokens: string[] = [];

  for (const rTok of remainingTokens) {
    if (RULE_MODIFIER_KEYWORDS.has(rTok)) {
      modifiers.push(rTok);
    } else {
      rateTokens.push(rTok);
    }
  }

  const ratesStr = rateTokens.join(" ").trim();
  const rateParts = splitTopLevelByChar(ratesStr, ",");
  const forwardRate = (rateParts[0] ?? "").trim();
  const reverseRateRaw = rateParts.length > 1 ? (rateParts[1] ?? "").trim() : undefined;
  const reverseRate = reverseRateRaw !== undefined && reverseRateRaw.length > 0 ? reverseRateRaw : undefined;

  return {
    id: ruleId,
    name: ruleName,
    reactants,
    products,
    reversible,
    forwardRate,
    reverseRate,
    modifiers: modifiers.length > 0 ? modifiers : undefined,
    range,
  };
}

/**
 * Parses an action call such as 'generate_network({overwrite=>1})' or 'simulate({method=>"ode",t_end=>100,n_steps=>100})'.
 */
function parseActionLine(lineText: string, range: BnglRange): BnglAction | null {
  const openParen = lineText.indexOf("(");
  const closeParen = lineText.lastIndexOf(")");
  if (openParen <= 0 || closeParen < openParen) return null;

  const command = lineText.slice(0, openParen).trim();
  if (command.length === 0 || command.includes(" ")) return null;

  let inside = lineText.slice(openParen + 1, closeParen).trim();
  if (inside.startsWith("{") && inside.endsWith("}")) {
    inside = inside.slice(1, inside.length - 1).trim();
  }

  const args: Record<string, string | number | boolean> = {};
  if (inside.length > 0) {
    const pairs = splitTopLevelByChar(inside, ",");
    for (const pair of pairs) {
      const pTrim = pair.trim();
      if (pTrim.length === 0) continue;

      let key = "";
      let valStr = "";
      const arrowIdx = pTrim.indexOf("=>");
      if (arrowIdx > 0) {
        key = pTrim.slice(0, arrowIdx).trim();
        valStr = pTrim.slice(arrowIdx + 2).trim();
      } else {
        const eqIdx = pTrim.indexOf("=");
        if (eqIdx > 0) {
          key = pTrim.slice(0, eqIdx).trim();
          valStr = pTrim.slice(eqIdx + 1).trim();
        }
      }

      if (key.length > 0) {
        if ((valStr.startsWith('"') && valStr.endsWith('"')) || (valStr.startsWith("'") && valStr.endsWith("'"))) {
          args[key] = valStr.slice(1, valStr.length - 1);
        } else if (valStr === "true") {
          args[key] = true;
        } else if (valStr === "false") {
          args[key] = false;
        } else {
          const num = Number(valStr);
          args[key] = !Number.isNaN(num) && valStr.length > 0 ? num : valStr;
        }
      }
    }
  }

  return { command, args, range };
}

/**
 * Parses a BioNetGen (.bngl) source document into a structured BnglDocument AST.
 */
export function parseBngl(source: string, sourceFile?: string): BnglDocument {
  const logicalLines = extractLogicalLines(source);

  let modelId = "BioNetGenModel";
  if (sourceFile) {
    const slashIdx = Math.max(sourceFile.lastIndexOf("/"), sourceFile.lastIndexOf("\\"));
    const base = slashIdx >= 0 ? sourceFile.slice(slashIdx + 1) : sourceFile;
    const dotIdx = base.lastIndexOf(".");
    const clean = dotIdx > 0 ? base.slice(0, dotIdx) : base;
    if (clean.length > 0) {
      modelId = clean;
    }
  }

  const parameters = new Map<string, BnglParameter>();
  const compartments = new Map<string, BnglCompartment>();
  const functions = new Map<string, BnglFunction>();
  const moleculeTypes = new Map<string, BnglMoleculeType>();
  const seedSpecies: BnglSeedSpecies[] = [];
  const observables = new Map<string, BnglObservable>();
  const observableList: BnglObservable[] = [];
  const reactionRules = new Map<string, BnglReactionRule>();
  const reactionRuleList: BnglReactionRule[] = [];
  const actions: BnglAction[] = [];

  type BlockKind =
    | "none"
    | "model"
    | "parameters"
    | "compartments"
    | "molecule_types"
    | "seed_species"
    | "observables"
    | "functions"
    | "reaction_rules"
    | "actions";

  let currentBlock: BlockKind = "none";
  let ruleCounter = 1;
  let seedCounter = 1;

  for (const lineObj of logicalLines) {
    const text = lineObj.text.trim();
    const lower = text.toLowerCase();

    // Check 'begin <block>'
    if (lower.startsWith("begin ")) {
      const blockName = lower.slice(6).trim();
      if (blockName === "model" || blockName.startsWith("model ")) {
        const customName = text.slice(6).trim().slice(5).trim();
        if (customName.length > 0) {
          modelId = customName;
        }
        currentBlock = "model";
      } else if (blockName === "parameters") {
        currentBlock = "parameters";
      } else if (blockName === "compartments") {
        currentBlock = "compartments";
      } else if (blockName === "molecule types" || blockName === "molecule_types") {
        currentBlock = "molecule_types";
      } else if (blockName === "seed species" || blockName === "seed_species" || blockName === "species") {
        currentBlock = "seed_species";
      } else if (blockName === "observables") {
        currentBlock = "observables";
      } else if (blockName === "functions") {
        currentBlock = "functions";
      } else if (blockName === "reaction rules" || blockName === "reaction_rules") {
        currentBlock = "reaction_rules";
      } else if (blockName === "actions") {
        currentBlock = "actions";
      }
      continue;
    }

    // Check 'end <block>'
    if (lower === "end" || lower.startsWith("end ")) {
      const endName = lower.slice(3).trim();
      if (endName === "model") {
        currentBlock = "none";
      } else {
        currentBlock = "model";
      }
      continue;
    }

    if (currentBlock === "parameters") {
      let pText = text;
      const eqIdx = pText.indexOf("=");
      if (eqIdx > 0) {
        const left = pText.slice(0, eqIdx).trim();
        const right = pText.slice(eqIdx + 1).trim();
        const leftTokens = splitTopLevelByWhitespace(left);
        const paramId =
          leftTokens.length >= 2 && isPureIntegerString(leftTokens[0] ?? "")
            ? (leftTokens[1] ?? "")
            : (leftTokens[0] ?? "");
        if (paramId.length > 0) {
          const val = evaluateBnglNumericExpr(right, parameters);
          parameters.set(paramId, {
            id: paramId,
            value: val,
            expression: right,
            range: lineObj.range,
          });
        }
      } else {
        const toks = splitTopLevelByWhitespace(pText);
        let idx = 0;
        if (toks.length >= 3 && isPureIntegerString(toks[0] ?? "")) {
          idx = 1;
        }
        const paramId = toks[idx] ?? "";
        const exprStr = toks
          .slice(idx + 1)
          .join(" ")
          .trim();
        if (paramId.length > 0 && exprStr.length > 0) {
          const val = evaluateBnglNumericExpr(exprStr, parameters);
          parameters.set(paramId, {
            id: paramId,
            value: val,
            expression: exprStr,
            range: lineObj.range,
          });
        }
      }
      continue;
    }

    if (currentBlock === "compartments") {
      const toks = splitTopLevelByWhitespace(text);
      let idx = 0;
      if (toks.length >= 4 && isPureIntegerString(toks[0] ?? "")) {
        idx = 1;
      }
      const compId = toks[idx] ?? "";
      const dim = Number(toks[idx + 1] ?? "3");
      const sizeExpr = toks[idx + 2] ?? "1.0";
      const parent = toks[idx + 3];
      if (compId.length > 0) {
        compartments.set(compId, {
          id: compId,
          dimensions: Number.isNaN(dim) ? 3 : dim,
          size: evaluateBnglNumericExpr(sizeExpr, parameters),
          parent: parent && parent.length > 0 ? parent : undefined,
          range: lineObj.range,
        });
      }
      continue;
    }

    if (currentBlock === "molecule_types") {
      const molDef = parseMoleculeTypeDef(text, lineObj.range);
      if (molDef.name.length > 0) {
        moleculeTypes.set(molDef.name, molDef);
      }
      continue;
    }

    if (currentBlock === "seed_species") {
      const toks = splitTopLevelByWhitespace(text);
      let idx = 0;
      if (toks.length >= 3 && isPureIntegerString(toks[0] ?? "")) {
        idx = 1;
      }
      const patternStr = toks[idx] ?? "";
      const concExpr = toks
        .slice(idx + 1)
        .join(" ")
        .trim();
      if (patternStr.length > 0) {
        const pattern = parseComplexPattern(patternStr, lineObj.range);
        const concVal = concExpr.length > 0 ? evaluateBnglNumericExpr(concExpr, parameters) : 0.0;
        seedSpecies.push({
          id: `S${seedCounter++}`,
          pattern,
          initialConcentration: concVal,
          concentrationExpression: concExpr.length > 0 ? concExpr : undefined,
          constant: Boolean(pattern.isConstant),
          compartment: pattern.compartment,
          range: lineObj.range,
        });
      }
      continue;
    }

    if (currentBlock === "observables") {
      const toks = splitTopLevelByWhitespace(text);
      let idx = 0;
      if (toks.length >= 4 && isPureIntegerString(toks[0] ?? "")) {
        idx = 1;
      }
      const firstWord = toks[idx] ?? "";
      let obsType: BnglObservableType = "Molecules";
      let nameIdx = idx;
      if (firstWord === "Molecules" || firstWord === "Species") {
        obsType = firstWord;
        nameIdx = idx + 1;
      }
      const obsName = toks[nameIdx] ?? "";
      const patternTokens = toks.slice(nameIdx + 1);
      const patterns: BnglComplexPattern[] = [];

      for (const pTok of patternTokens) {
        const commaSplit = splitTopLevelByChar(pTok, ",");
        for (const sub of commaSplit) {
          if (sub.trim().length > 0) {
            patterns.push(parseComplexPattern(sub.trim(), lineObj.range));
          }
        }
      }

      if (obsName.length > 0) {
        const obs: BnglObservable = {
          name: obsName,
          type: obsType,
          patterns,
          range: lineObj.range,
        };
        observables.set(obsName, obs);
        observableList.push(obs);
      }
      continue;
    }

    if (currentBlock === "functions") {
      const eqIdx = text.indexOf("=");
      if (eqIdx > 0) {
        const lhs = text.slice(0, eqIdx).trim();
        const rhs = text.slice(eqIdx + 1).trim();
        const openP = lhs.indexOf("(");
        const closeP = lhs.lastIndexOf(")");
        const fnId = openP > 0 ? lhs.slice(0, openP).trim() : lhs;
        const args =
          openP > 0 && closeP > openP
            ? splitTopLevelByChar(lhs.slice(openP + 1, closeP), ",")
                .map((a) => a.trim())
                .filter((a) => a.length > 0)
            : [];
        functions.set(fnId, {
          id: fnId,
          arguments: args,
          expression: rhs,
          range: lineObj.range,
        });
      }
      continue;
    }

    if (currentBlock === "reaction_rules") {
      const rule = parseReactionRuleLine(text, ruleCounter++, lineObj.range);
      if (rule) {
        reactionRules.set(rule.id, rule);
        reactionRuleList.push(rule);
      }
      continue;
    }

    // Top-level or 'actions' block
    const act = parseActionLine(text, lineObj.range);
    if (act) {
      actions.push(act);
    }
  }

  const modelRange: BnglRange =
    logicalLines.length > 0
      ? {
          startLine: logicalLines[0]?.range.startLine ?? 1,
          startColumn: logicalLines[0]?.range.startColumn ?? 1,
          endLine: logicalLines[logicalLines.length - 1]?.range.endLine ?? 1,
          endColumn: logicalLines[logicalLines.length - 1]?.range.endColumn ?? 1,
          startOffset: logicalLines[0]?.range.startOffset ?? 0,
          endOffset: logicalLines[logicalLines.length - 1]?.range.endOffset ?? source.length,
        }
      : {
          startLine: 1,
          startColumn: 1,
          endLine: 1,
          endColumn: 1,
          startOffset: 0,
          endOffset: source.length,
        };

  const model: BnglModel = {
    id: modelId,
    name: modelId,
    parameters,
    compartments,
    functions,
    moleculeTypes,
    seedSpecies,
    observables,
    observableList,
    reactionRules,
    reactionRuleList,
    actions,
    range: modelRange,
  };

  return {
    model,
    actions,
    sourceFile,
  };
}

/**
 * Serializes a BnglDocument AST back into canonical BioNetGen (.bngl) source text.
 */
export function serializeBngl(doc: BnglDocument): string {
  const m = doc.model;
  const lines: string[] = [];

  lines.push("begin model");

  if (m.parameters.size > 0) {
    lines.push("begin parameters");
    for (const p of m.parameters.values()) {
      lines.push(`  ${p.id} ${p.expression ?? p.value}`);
    }
    lines.push("end parameters");
    lines.push("");
  }

  if (m.compartments.size > 0) {
    lines.push("begin compartments");
    for (const c of m.compartments.values()) {
      const parentStr = c.parent ? ` ${c.parent}` : "";
      lines.push(`  ${c.id} ${c.dimensions} ${c.size}${parentStr}`);
    }
    lines.push("end compartments");
    lines.push("");
  }

  if (m.moleculeTypes.size > 0) {
    lines.push("begin molecule types");
    for (const mt of m.moleculeTypes.values()) {
      const siteStr = mt.sites
        .map((s) => (s.allowedStates.length > 0 ? `${s.name}~${s.allowedStates.join("~")}` : s.name))
        .join(",");
      lines.push(`  ${mt.name}(${siteStr})`);
    }
    lines.push("end molecule types");
    lines.push("");
  }

  if (m.seedSpecies.length > 0) {
    lines.push("begin seed species");
    for (const sp of m.seedSpecies) {
      const patStr = serializeComplexPattern(sp.pattern);
      const concStr = sp.concentrationExpression ?? String(sp.initialConcentration);
      lines.push(`  ${patStr} ${concStr}`);
    }
    lines.push("end seed species");
    lines.push("");
  }

  const obsList = m.observableList ?? Array.from(m.observables.values());
  if (obsList.length > 0) {
    lines.push("begin observables");
    for (const obs of obsList) {
      const patStr = obs.patterns.map((p) => serializeComplexPattern(p)).join(" ");
      lines.push(`  ${obs.type} ${obs.name} ${patStr}`);
    }
    lines.push("end observables");
    lines.push("");
  }

  if (m.functions.size > 0) {
    lines.push("begin functions");
    for (const fn of m.functions.values()) {
      lines.push(`  ${fn.id}(${fn.arguments.join(",")}) = ${fn.expression}`);
    }
    lines.push("end functions");
    lines.push("");
  }

  const rulesList = m.reactionRuleList ?? Array.from(m.reactionRules.values());
  if (rulesList.length > 0) {
    lines.push("begin reaction rules");
    for (const r of rulesList) {
      const lhs = r.reactants.length > 0 ? r.reactants.map((p) => serializeComplexPattern(p)).join(" + ") : "0";
      const rhs = r.products.length > 0 ? r.products.map((p) => serializeComplexPattern(p)).join(" + ") : "0";
      const arrow = r.reversible ? "<->" : "->";
      const rates = r.reversible && r.reverseRate ? `${r.forwardRate}, ${r.reverseRate}` : r.forwardRate;
      const prefix = r.name ? `${r.name}: ` : `${r.id}: `;
      lines.push(`  ${prefix}${lhs} ${arrow} ${rhs} ${rates}`);
    }
    lines.push("end reaction rules");
  }

  lines.push("end model");

  if (doc.actions.length > 0) {
    lines.push("");
    for (const act of doc.actions) {
      const entries = Object.entries(act.args).map(([k, v]) => {
        const formattedVal = typeof v === "string" ? `"${v}"` : String(v);
        return `${k}=>${formattedVal}`;
      });
      lines.push(`${act.command}({${entries.join(",")}})`);
    }
  }

  return lines.join("\n");
}
