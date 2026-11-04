// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/antimony — Zero-Regex Character-by-Character Lexer, Recursive-Descent Parser,
 * and Canonical Serializer for Antimony (.ant) Reaction Network Models.
 */

import type {
  AntimonyCompartment,
  AntimonyDocument,
  AntimonyEventAssignment,
  AntimonyFunctionDefinition,
  AntimonyModule,
  AntimonyParameter,
  AntimonyRange,
  AntimonyReaction,
  AntimonySpecies,
  AntimonySpeciesReference,
  AntimonySubmodel,
} from "../types.js";

type TokenKind =
  | "IDENT"
  | "NUMBER"
  | "STRING"
  | "PRIME"
  | "DOLLAR"
  | "ARROW_REV"
  | "ARROW_IRREV"
  | "COLON_EQ"
  | "COLON"
  | "EQ"
  | "SEMI"
  | "COMMA"
  | "NEWLINE"
  | "LPAREN"
  | "RPAREN"
  | "PLUS"
  | "MINUS"
  | "STAR"
  | "SLASH"
  | "CARET"
  | "OP"
  | "EOF";

interface Token {
  kind: TokenKind;
  value: string;
  line: number;
  column: number;
  endLine: number;
  endColumn: number;
  startOffset: number;
  endOffset: number;
}

function isDigitChar(ch: string): boolean {
  return ch >= "0" && ch <= "9";
}

function isAlphaChar(ch: string): boolean {
  return (ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_";
}

function isAlphaNumChar(ch: string): boolean {
  return isAlphaChar(ch) || isDigitChar(ch);
}

function makeRange(first: Token, last: Token): AntimonyRange {
  return {
    startLine: first.line,
    startColumn: first.column,
    endLine: last.endLine,
    endColumn: last.endColumn,
    startOffset: first.startOffset,
    endOffset: last.endOffset,
  };
}

/**
 * Zero-regex character-by-character lexer for Antimony source files.
 */
function tokenizeAntimony(source: string): Token[] {
  const tokens: Token[] = [];
  const n = source.length;
  let pos = 0;
  let line = 1;
  let col = 1;

  const advance = (): string => {
    const ch = source[pos] ?? "";
    pos++;
    if (ch === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
    return ch;
  };

  while (pos < n) {
    const ch = source[pos] ?? "";
    const next = source[pos + 1] ?? "";
    const next2 = source[pos + 2] ?? "";

    // Horizontal whitespace
    if (ch === " " || ch === "\t" || ch === "\r") {
      advance();
      continue;
    }

    // Single-line comment starting with # or double slash
    if (ch === "#" || (ch === "/" && next === "/")) {
      while (pos < n && source[pos] !== "\n") {
        advance();
      }
      continue;
    }

    // Block comment
    if (ch === "/" && next === "*") {
      advance();
      advance();
      while (pos < n) {
        if (source[pos] === "*" && source[pos + 1] === "/") {
          advance();
          advance();
          break;
        }
        advance();
      }
      continue;
    }

    const startOffset = pos;
    const startLine = line;
    const startCol = col;

    // Newline
    if (ch === "\n") {
      advance();
      tokens.push({
        kind: "NEWLINE",
        value: "\n",
        line: startLine,
        column: startCol,
        endLine: startLine,
        endColumn: startCol + 1,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // String literal "..."
    if (ch === '"') {
      advance(); // opening '"'
      let val = "";
      while (pos < n && source[pos] !== '"') {
        if (source[pos] === "\\" && pos + 1 < n) {
          advance();
          val += advance();
        } else {
          val += advance();
        }
      }
      if (pos < n && source[pos] === '"') {
        advance(); // closing '"'
      }
      tokens.push({
        kind: "STRING",
        value: val,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // Multi-character reaction arrows: <->, ->, =>
    if (ch === "<" && next === "-" && next2 === ">") {
      advance();
      advance();
      advance();
      tokens.push({
        kind: "ARROW_REV",
        value: "<->",
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    if (ch === "-" && next === ">") {
      advance();
      advance();
      tokens.push({
        kind: "ARROW_REV",
        value: "->",
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    if (ch === "=" && next === ">") {
      advance();
      advance();
      tokens.push({
        kind: "ARROW_IRREV",
        value: "=>",
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // Assignment rule operator :=
    if (ch === ":" && next === "=") {
      advance();
      advance();
      tokens.push({
        kind: "COLON_EQ",
        value: ":=",
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // Two-character comparison / logical / power operators
    if (
      (ch === ">" && next === "=") ||
      (ch === "<" && next === "=") ||
      (ch === "=" && next === "=") ||
      (ch === "!" && next === "=") ||
      (ch === "&" && next === "&") ||
      (ch === "|" && next === "|")
    ) {
      const val = advance() + advance();
      tokens.push({
        kind: "OP",
        value: val,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    if (ch === "*" && next === "*") {
      advance();
      advance();
      tokens.push({
        kind: "CARET",
        value: "^",
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // Numeric literal
    if (isDigitChar(ch) || (ch === "." && isDigitChar(next))) {
      let numStr = "";
      while (pos < n && isDigitChar(source[pos] ?? "")) {
        numStr += advance();
      }
      if (pos < n && source[pos] === ".") {
        numStr += advance();
        while (pos < n && isDigitChar(source[pos] ?? "")) {
          numStr += advance();
        }
      }
      if (pos < n && (source[pos] === "e" || source[pos] === "E")) {
        const expNext = source[pos + 1] ?? "";
        const expNext2 = source[pos + 2] ?? "";
        if (isDigitChar(expNext) || ((expNext === "+" || expNext === "-") && isDigitChar(expNext2))) {
          numStr += advance(); // 'e' or 'E'
          if (source[pos] === "+" || source[pos] === "-") {
            numStr += advance();
          }
          while (pos < n && isDigitChar(source[pos] ?? "")) {
            numStr += advance();
          }
        }
      }
      tokens.push({
        kind: "NUMBER",
        value: numStr,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // Identifier
    if (isAlphaChar(ch)) {
      let idStr = "";
      while (pos < n && isAlphaNumChar(source[pos] ?? "")) {
        idStr += advance();
      }
      tokens.push({
        kind: "IDENT",
        value: idStr,
        line: startLine,
        column: startCol,
        endLine: line,
        endColumn: col,
        startOffset,
        endOffset: pos,
      });
      continue;
    }

    // Single-character punctuation & operators
    advance();
    let kind: TokenKind = "OP";
    if (ch === "'") kind = "PRIME";
    else if (ch === "$") kind = "DOLLAR";
    else if (ch === ":") kind = "COLON";
    else if (ch === "=") kind = "EQ";
    else if (ch === ";") kind = "SEMI";
    else if (ch === ",") kind = "COMMA";
    else if (ch === "(") kind = "LPAREN";
    else if (ch === ")") kind = "RPAREN";
    else if (ch === "+") kind = "PLUS";
    else if (ch === "-") kind = "MINUS";
    else if (ch === "*") kind = "STAR";
    else if (ch === "/") kind = "SLASH";
    else if (ch === "^") kind = "CARET";

    tokens.push({
      kind,
      value: ch,
      line: startLine,
      column: startCol,
      endLine: line,
      endColumn: col,
      startOffset,
      endOffset: pos,
    });
  }

  tokens.push({
    kind: "EOF",
    value: "",
    line,
    column: col,
    endLine: line,
    endColumn: col,
    startOffset: pos,
    endOffset: pos,
  });

  return tokens;
}

function createEmptyModule(id: string, range?: AntimonyRange): AntimonyModule {
  return {
    id,
    arguments: [],
    compartments: new Map<string, AntimonyCompartment>(),
    species: new Map<string, AntimonySpecies>(),
    parameters: new Map<string, AntimonyParameter>(),
    reactions: new Map<string, AntimonyReaction>(),
    reactionList: [],
    rules: [],
    events: [],
    submodels: [],
    deletions: [],
    displayNames: new Map<string, string>(),
    range,
  };
}

function parseNumericValue(expr: string): number | undefined {
  const trimmed = expr.trim();
  if (trimmed.length === 0) return undefined;
  let i = 0;
  if (trimmed[i] === "+" || trimmed[i] === "-") i++;
  if (i >= trimmed.length) return undefined;
  let hasDigits = false;
  while (i < trimmed.length && isDigitChar(trimmed[i] ?? "")) {
    hasDigits = true;
    i++;
  }
  if (i < trimmed.length && trimmed[i] === ".") {
    i++;
    while (i < trimmed.length && isDigitChar(trimmed[i] ?? "")) {
      hasDigits = true;
      i++;
    }
  }
  if (!hasDigits) return undefined;
  if (i < trimmed.length && (trimmed[i] === "e" || trimmed[i] === "E")) {
    i++;
    if (i < trimmed.length && (trimmed[i] === "+" || trimmed[i] === "-")) i++;
    let expDigits = false;
    while (i < trimmed.length && isDigitChar(trimmed[i] ?? "")) {
      expDigits = true;
      i++;
    }
    if (!expDigits) return undefined;
  }
  if (i !== trimmed.length) return undefined;
  const num = Number(trimmed);
  return Number.isNaN(num) ? undefined : num;
}

const STATEMENT_KEYWORDS = new Set([
  "model",
  "module",
  "function",
  "end",
  "compartment",
  "species",
  "const",
  "var",
  "formula",
  "unit",
  "at",
  "delete",
]);

/**
 * Parses an Antimony (.ant) source document into an AntimonyDocument AST.
 */
export function parseAntimony(source: string, filename?: string): AntimonyDocument {
  const tokens = tokenizeAntimony(source);
  let idx = 0;

  const peek = (offset = 0): Token => {
    const t = tokens[idx + offset];
    return t ?? tokens[tokens.length - 1]!;
  };

  const consume = (): Token => {
    const t = peek();
    if (idx < tokens.length - 1) idx++;
    return t;
  };

  const skipNewlinesAndSemis = (): void => {
    while (peek().kind === "NEWLINE" || peek().kind === "SEMI") {
      consume();
    }
  };

  const skipNewlines = (): void => {
    while (peek().kind === "NEWLINE") {
      consume();
    }
  };

  const modules = new Map<string, AntimonyModule>();
  const functions = new Map<string, AntimonyFunctionDefinition>();
  const topModule = createEmptyModule("__main");
  let lastExplicitModule: AntimonyModule | undefined;

  let autoReactionCounter = 0;
  let autoEventCounter = 0;
  let autoSubmodelCounter = 0;

  const collectClauseTokens = (stopAtComma = false): Token[] => {
    const result: Token[] = [];
    let parenDepth = 0;
    while (peek().kind !== "EOF") {
      const t = peek();
      if (t.kind === "LPAREN") {
        parenDepth++;
        result.push(consume());
        continue;
      }
      if (t.kind === "RPAREN") {
        if (parenDepth > 0) parenDepth--;
        result.push(consume());
        continue;
      }
      if (parenDepth === 0) {
        if (t.kind === "SEMI" || t.kind === "NEWLINE") {
          break;
        }
        if (t.kind === "IDENT" && t.value === "end") {
          break;
        }
        if (stopAtComma && t.kind === "COMMA") {
          break;
        }
      }
      result.push(consume());
    }
    return result;
  };

  const sliceSource = (toks: Token[]): string => {
    if (toks.length === 0) return "";
    const first = toks[0]!;
    const last = toks[toks.length - 1]!;
    return source.slice(first.startOffset, last.endOffset).trim();
  };

  const ensureSpeciesInModule = (
    mod: AntimonyModule,
    speciesId: string,
    boundaryCondition: boolean,
    compartmentId?: string,
    range?: AntimonyRange,
  ): AntimonySpecies => {
    const existing = mod.species.get(speciesId);
    if (existing) {
      if (boundaryCondition) {
        existing.boundaryCondition = true;
      }
      if (compartmentId) {
        existing.compartment = compartmentId;
      }
      return existing;
    }

    // Check if previously declared as a parameter (e.g. `const S = 5` before reaction)
    const existingParam = mod.parameters.get(speciesId);
    const defaultComp =
      compartmentId ?? (mod.compartments.size === 1 ? Array.from(mod.compartments.keys())[0]! : "default_compartment");

    const newSpecies: AntimonySpecies = {
      id: speciesId,
      name: existingParam?.name ?? mod.displayNames?.get(speciesId),
      compartment: defaultComp,
      initialConcentration: existingParam ? existingParam.value : 0.0,
      hasOnlySubstanceUnits: false,
      boundaryCondition,
      constant: existingParam?.isExplicitlyConst ? true : false,
      isExplicitlyConst: existingParam?.isExplicitlyConst,
      range: existingParam?.range ?? range,
    };
    if (existingParam) {
      mod.parameters.delete(speciesId);
    }
    mod.species.set(speciesId, newSpecies);
    return newSpecies;
  };

  const parseParticipantList = (
    partTokens: Token[],
    mod: AntimonyModule,
    rxnCompartment?: string,
  ): AntimonySpeciesReference[] => {
    const refs: AntimonySpeciesReference[] = [];
    if (partTokens.length === 0) return refs;

    // Split by '+' at top level; note that a leading '-' after '+' or at start is a negative stoichiometry
    const groups: Token[][] = [];
    let currentGroup: Token[] = [];
    for (let i = 0; i < partTokens.length; i++) {
      const tok = partTokens[i]!;
      if (tok.kind === "PLUS" && currentGroup.length > 0) {
        groups.push(currentGroup);
        currentGroup = [];
      } else {
        currentGroup.push(tok);
      }
    }
    if (currentGroup.length > 0) {
      groups.push(currentGroup);
    }

    for (const grp of groups) {
      if (grp.length === 0) continue;
      let pIdx = 0;
      let stoich = 1.0;
      let sign = 1.0;

      if (grp[pIdx]?.kind === "MINUS") {
        sign = -1.0;
        pIdx++;
      } else if (grp[pIdx]?.kind === "PLUS") {
        pIdx++;
      }

      if (grp[pIdx]?.kind === "NUMBER") {
        const parsedNum = Number(grp[pIdx]!.value);
        stoich = sign * (Number.isNaN(parsedNum) ? 1.0 : parsedNum);
        pIdx++;
        if (grp[pIdx]?.kind === "STAR") {
          pIdx++;
        }
      } else if (sign < 0) {
        stoich = -1.0;
      }

      let boundary = false;
      if (grp[pIdx]?.kind === "DOLLAR") {
        boundary = true;
        pIdx++;
      }

      const idTok = grp[pIdx];
      if (!idTok || idTok.kind !== "IDENT" || idTok.value === "null") {
        continue;
      }

      const speciesId = idTok.value;
      const refRange = makeRange(grp[0]!, grp[grp.length - 1]!);
      ensureSpeciesInModule(mod, speciesId, boundary, rxnCompartment, refRange);

      refs.push({
        species: speciesId,
        stoichiometry: stoich,
        boundaryCondition: boundary,
        range: refRange,
      });
    }

    return refs;
  };

  const isRateLawClause = (clause: Token[]): boolean => {
    if (clause.length === 0) return false;
    const first = clause[0]!;
    if (first.kind === "IDENT" && STATEMENT_KEYWORDS.has(first.value)) {
      return false;
    }
    for (let i = 0; i < clause.length; i++) {
      const k = clause[i]!.kind;
      if (
        k === "ARROW_REV" ||
        k === "ARROW_IRREV" ||
        k === "COLON" ||
        k === "COLON_EQ" ||
        k === "EQ" ||
        k === "PRIME"
      ) {
        return false;
      }
      if (k === "IDENT" && (clause[i]!.value === "is" || clause[i]!.value === "in")) {
        return false;
      }
    }
    return true;
  };

  const parseDeclarationList = (
    mod: AntimonyModule,
    declType: "compartment" | "species" | "const" | "var" | "formula" | "unit",
    qualifier: "const" | "var" | undefined,
  ): void => {
    while (peek().kind !== "EOF" && peek().kind !== "SEMI" && peek().kind !== "NEWLINE") {
      if (peek().kind === "IDENT" && peek().value === "end") break;
      const itemTokens = collectClauseTokens(true);
      if (peek().kind === "COMMA") {
        consume(); // ','
      }
      if (itemTokens.length === 0) continue;

      let p = 0;
      let hasDollar = false;
      if (itemTokens[p]?.kind === "DOLLAR") {
        hasDollar = true;
        p++;
      }
      const nameTok = itemTokens[p];
      if (!nameTok || nameTok.kind !== "IDENT") continue;
      const id = nameTok.value;
      p++;

      let inComp: string | undefined;
      if (itemTokens[p]?.kind === "IDENT" && itemTokens[p]!.value === "in") {
        p++;
        if (itemTokens[p]?.kind === "IDENT") {
          inComp = itemTokens[p]!.value;
          p++;
        }
      }

      let initExpr: string | undefined;
      if (itemTokens[p]?.kind === "EQ" || itemTokens[p]?.kind === "COLON_EQ") {
        const opKind = itemTokens[p]!.kind;
        p++;
        const rhsTokens = itemTokens.slice(p);
        initExpr = sliceSource(rhsTokens);
        if (opKind === "COLON_EQ" && initExpr.length > 0) {
          mod.rules.push({
            type: "assignment",
            variable: id,
            formula: initExpr,
            range: makeRange(itemTokens[0]!, itemTokens[itemTokens.length - 1]!),
          });
        }
      }

      const itemRange = makeRange(itemTokens[0]!, itemTokens[itemTokens.length - 1]!);
      const numVal = initExpr !== undefined ? parseNumericValue(initExpr) : undefined;

      if (declType === "compartment") {
        const existing = mod.compartments.get(id);
        mod.compartments.set(id, {
          id,
          name: existing?.name ?? mod.displayNames?.get(id),
          size: numVal ?? existing?.size ?? 1.0,
          constant: qualifier === "var" ? false : true,
          range: itemRange,
        });
      } else if (declType === "species") {
        const defaultComp =
          inComp ?? (mod.compartments.size === 1 ? Array.from(mod.compartments.keys())[0]! : "default_compartment");
        const existing = mod.species.get(id);
        const isConst = qualifier === "const";
        mod.species.set(id, {
          id,
          name: existing?.name ?? mod.displayNames?.get(id),
          compartment: inComp ?? existing?.compartment ?? defaultComp,
          initialConcentration: numVal ?? existing?.initialConcentration ?? 0.0,
          hasOnlySubstanceUnits: existing?.hasOnlySubstanceUnits ?? false,
          boundaryCondition: hasDollar || (existing?.boundaryCondition ?? false),
          constant: isConst,
          isExplicitlyConst: isConst ? true : existing?.isExplicitlyConst,
          range: itemRange,
        });
      } else if (declType === "const" || declType === "var" || declType === "formula") {
        const isConst = declType === "const" || qualifier === "const";
        const existingSpecies = mod.species.get(id);
        if (existingSpecies) {
          existingSpecies.constant = isConst;
          if (isConst) existingSpecies.isExplicitlyConst = true;
          if (hasDollar) existingSpecies.boundaryCondition = true;
          if (numVal !== undefined) existingSpecies.initialConcentration = numVal;
        } else if (mod.compartments.has(id)) {
          const comp = mod.compartments.get(id)!;
          comp.constant = isConst;
          if (numVal !== undefined) comp.size = numVal;
        } else {
          const existingParam = mod.parameters.get(id);
          mod.parameters.set(id, {
            id,
            name: existingParam?.name ?? mod.displayNames?.get(id),
            value: numVal ?? existingParam?.value ?? 0.0,
            formula: numVal === undefined && initExpr ? initExpr : existingParam?.formula,
            constant: isConst,
            isExplicitlyConst: isConst ? true : undefined,
            range: itemRange,
          });
          if (declType === "formula" && initExpr && numVal === undefined) {
            mod.rules.push({
              type: "assignment",
              variable: id,
              formula: initExpr,
              range: itemRange,
            });
          }
        }
      }
    }
  };

  const parseEventStatement = (mod: AntimonyModule, stmtTokens: Token[]): void => {
    let p = 0;
    let eventId = `_E${autoEventCounter++}`;

    if (stmtTokens[0]?.kind === "IDENT" && stmtTokens[0]!.value !== "at" && stmtTokens[1]?.kind === "COLON") {
      eventId = stmtTokens[0]!.value;
      p = 2;
    }

    if (stmtTokens[p]?.kind === "IDENT" && stmtTokens[p]!.value === "at") {
      p++;
    }

    // Collect trigger tokens up to ':' at top-level parenDepth == 0
    const trigTokens: Token[] = [];
    let parenDepth = 0;
    while (p < stmtTokens.length) {
      const t = stmtTokens[p]!;
      if (t.kind === "LPAREN") parenDepth++;
      else if (t.kind === "RPAREN" && parenDepth > 0) parenDepth--;
      else if (t.kind === "COLON" && parenDepth === 0) {
        p++; // consume ':'
        break;
      }
      trigTokens.push(t);
      p++;
    }

    // Unwrap outer parentheses of trigger if balanced
    let cleanTrigTokens = trigTokens;
    if (
      cleanTrigTokens.length >= 2 &&
      cleanTrigTokens[0]?.kind === "LPAREN" &&
      cleanTrigTokens[cleanTrigTokens.length - 1]?.kind === "RPAREN"
    ) {
      let depth = 0;
      let balancedOuter = true;
      for (let i = 0; i < cleanTrigTokens.length - 1; i++) {
        if (cleanTrigTokens[i]!.kind === "LPAREN") depth++;
        else if (cleanTrigTokens[i]!.kind === "RPAREN") depth--;
        if (depth === 0) {
          balancedOuter = false;
          break;
        }
      }
      if (balancedOuter) {
        cleanTrigTokens = cleanTrigTokens.slice(1, cleanTrigTokens.length - 1);
      }
    }

    const triggerStr = sliceSource(cleanTrigTokens);

    // Remaining tokens in stmtTokens (plus any comma-separated assignments across same statement)
    const assignments: AntimonyEventAssignment[] = [];
    const assignGroups: Token[][] = [];
    let curGroup: Token[] = [];
    let aDepth = 0;
    for (let i = p; i < stmtTokens.length; i++) {
      const t = stmtTokens[i]!;
      if (t.kind === "LPAREN") aDepth++;
      else if (t.kind === "RPAREN" && aDepth > 0) aDepth--;
      if (t.kind === "COMMA" && aDepth === 0) {
        if (curGroup.length > 0) assignGroups.push(curGroup);
        curGroup = [];
      } else {
        curGroup.push(t);
      }
    }
    if (curGroup.length > 0) assignGroups.push(curGroup);

    for (const grp of assignGroups) {
      if (grp.length >= 3 && grp[0]?.kind === "IDENT" && grp[1]?.kind === "EQ") {
        const variable = grp[0]!.value;
        const formula = sliceSource(grp.slice(2));
        assignments.push({
          variable,
          formula,
          range: makeRange(grp[0]!, grp[grp.length - 1]!),
        });
      }
    }

    const evRange = stmtTokens.length > 0 ? makeRange(stmtTokens[0]!, stmtTokens[stmtTokens.length - 1]!) : undefined;

    mod.events.push({
      id: eventId,
      name: mod.displayNames?.get(eventId),
      trigger: triggerStr,
      assignments,
      range: evRange,
    });
  };

  const parseReactionStatement = (mod: AntimonyModule, firstClause: Token[]): void => {
    let p = 0;
    let rxnId = `_J${autoReactionCounter++}`;
    let rxnCompartment: string | undefined;

    // Optional `<rxnId> [in <compId>] :`
    if (firstClause[0]?.kind === "IDENT") {
      if (firstClause[1]?.kind === "COLON") {
        rxnId = firstClause[0]!.value;
        p = 2;
      } else if (
        firstClause[1]?.kind === "IDENT" &&
        firstClause[1]!.value === "in" &&
        firstClause[2]?.kind === "IDENT" &&
        firstClause[3]?.kind === "COLON"
      ) {
        rxnId = firstClause[0]!.value;
        rxnCompartment = firstClause[2]!.value;
        p = 4;
      }
    }

    // Find arrow token
    let arrowIdx = -1;
    for (let i = p; i < firstClause.length; i++) {
      const k = firstClause[i]!.kind;
      if (k === "ARROW_REV" || k === "ARROW_IRREV") {
        arrowIdx = i;
        break;
      }
    }
    if (arrowIdx === -1) return;

    const arrowTok = firstClause[arrowIdx]!;
    const reversible = arrowTok.kind === "ARROW_REV";
    const reactantTokens = firstClause.slice(p, arrowIdx);

    // Check if products end with `in <compId>`
    let productEndIdx = firstClause.length;
    if (
      firstClause.length >= arrowIdx + 3 &&
      firstClause[firstClause.length - 2]?.kind === "IDENT" &&
      firstClause[firstClause.length - 2]!.value === "in" &&
      firstClause[firstClause.length - 1]?.kind === "IDENT"
    ) {
      rxnCompartment = firstClause[firstClause.length - 1]!.value;
      productEndIdx = firstClause.length - 2;
    }
    const productTokens = firstClause.slice(arrowIdx + 1, productEndIdx);

    const reactants = parseParticipantList(reactantTokens, mod, rxnCompartment);
    const products = parseParticipantList(productTokens, mod, rxnCompartment);

    // Check if a rate law follows after `;`
    let rateLaw = "";
    let lastTok = firstClause[firstClause.length - 1]!;

    if (peek().kind === "SEMI") {
      lastTok = consume(); // consume ';'
      // Look ahead on the same line (or before next statement) to see if there is a rate law
      if (peek().kind !== "NEWLINE" && peek().kind !== "SEMI" && peek().kind !== "EOF") {
        const savedIdx = idx;
        const candidateClause = collectClauseTokens(false);
        if (isRateLawClause(candidateClause)) {
          rateLaw = sliceSource(candidateClause);
          if (candidateClause.length > 0) {
            lastTok = candidateClause[candidateClause.length - 1]!;
          }
          // Check optional trailing `in <comp>`
          if (peek().kind === "SEMI") {
            lastTok = consume();
          }
        } else {
          // Not a rate law (e.g. another statement on the same line); rewind
          idx = savedIdx;
        }
      }
    }

    const rxnRange = makeRange(firstClause[0]!, lastTok);
    const reactionObj: AntimonyReaction = {
      id: rxnId,
      name: mod.displayNames?.get(rxnId),
      reversible,
      compartment: rxnCompartment,
      reactants,
      products,
      modifiers: [],
      rateLaw,
      range: rxnRange,
    };

    mod.reactions.set(rxnId, reactionObj);
    if (!mod.reactionList) {
      mod.reactionList = [];
    }
    mod.reactionList.push(reactionObj);
  };

  const applyDisplayName = (mod: AntimonyModule, targetId: string, displayName: string): void => {
    if (!mod.displayNames) {
      mod.displayNames = new Map<string, string>();
    }
    mod.displayNames.set(targetId, displayName);
    if (mod.id === targetId) mod.name = displayName;
    const comp = mod.compartments.get(targetId);
    if (comp) comp.name = displayName;
    const sp = mod.species.get(targetId);
    if (sp) sp.name = displayName;
    const param = mod.parameters.get(targetId);
    if (param) param.name = displayName;
    const rxn = mod.reactions.get(targetId);
    if (rxn) rxn.name = displayName;
    for (const ev of mod.events) {
      if (ev.id === targetId) ev.name = displayName;
    }
  };

  const parseModuleStatement = (mod: AntimonyModule): void => {
    skipNewlinesAndSemis();
    if (peek().kind === "EOF") return;
    if (peek().kind === "IDENT" && peek().value === "end") return;

    const first = peek();

    // 1. Nested or top-level `function` definition
    if (first.kind === "IDENT" && first.value === "function") {
      parseFunctionBlock();
      return;
    }

    // 2. `model` / `module` block
    if (first.kind === "IDENT" && (first.value === "model" || first.value === "module")) {
      parseModuleBlock();
      return;
    }

    // 3. Declarations: [var | const] [compartment | species | formula | unit]
    if (first.kind === "IDENT") {
      if (
        first.value === "compartment" ||
        first.value === "species" ||
        first.value === "formula" ||
        first.value === "unit"
      ) {
        const declKeyword = consume().value as "compartment" | "species" | "formula" | "unit";
        parseDeclarationList(mod, declKeyword, undefined);
        return;
      }
      if (first.value === "const" || first.value === "var") {
        const qual = consume().value as "const" | "var";
        const second = peek();
        if (
          second.kind === "IDENT" &&
          (second.value === "compartment" || second.value === "species" || second.value === "formula")
        ) {
          const declKeyword = consume().value as "compartment" | "species" | "formula";
          parseDeclarationList(mod, declKeyword, qual);
        } else {
          parseDeclarationList(mod, qual, qual);
        }
        return;
      }
      if (first.value === "delete") {
        consume(); // 'delete'
        while (peek().kind !== "EOF" && peek().kind !== "SEMI" && peek().kind !== "NEWLINE") {
          const item = collectClauseTokens(true);
          if (peek().kind === "COMMA") consume();
          if (item.length > 0 && item[0]?.kind === "IDENT") {
            if (!mod.deletions) mod.deletions = [];
            mod.deletions.push({
              target: item[0]!.value,
              range: makeRange(item[0]!, item[item.length - 1]!),
            });
          }
        }
        return;
      }
    }

    // Collect tokens up to first `;` or `\n` (respecting parentheses)
    const clause = collectClauseTokens(false);
    if (clause.length === 0) {
      if (peek().kind !== "EOF") consume();
      return;
    }

    // 4. Event statement: `at ...` or `E1: at ...`
    if (
      (clause[0]?.kind === "IDENT" && clause[0]!.value === "at") ||
      (clause[0]?.kind === "IDENT" &&
        clause[1]?.kind === "COLON" &&
        clause[2]?.kind === "IDENT" &&
        clause[2]!.value === "at")
    ) {
      parseEventStatement(mod, clause);
      return;
    }

    // 5. Reaction statement: contains `->`, `<->`, or `=>`
    const hasReactionArrow = clause.some((t) => t.kind === "ARROW_REV" || t.kind === "ARROW_IRREV");
    if (hasReactionArrow) {
      parseReactionStatement(mod, clause);
      return;
    }

    // 6. Display name alias: `<id> is "<displayName>"`
    if (
      clause.length >= 3 &&
      clause[0]?.kind === "IDENT" &&
      clause[1]?.kind === "IDENT" &&
      clause[1]!.value === "is" &&
      clause[2]?.kind === "STRING"
    ) {
      applyDisplayName(mod, clause[0]!.value, clause[2]!.value);
      return;
    }

    // 7. Compartment placement: `[$]<id> in <compId>`
    if (
      clause.length === 3 &&
      clause[0]?.kind === "IDENT" &&
      clause[1]?.kind === "IDENT" &&
      clause[1]!.value === "in" &&
      clause[2]?.kind === "IDENT"
    ) {
      ensureSpeciesInModule(mod, clause[0]!.value, false, clause[2]!.value, makeRange(clause[0]!, clause[2]!));
      return;
    }

    // 8. Rate rule: `<id>' = <expr>`
    if (clause.length >= 4 && clause[0]?.kind === "IDENT" && clause[1]?.kind === "PRIME" && clause[2]?.kind === "EQ") {
      const variable = clause[0]!.value;
      const formula = sliceSource(clause.slice(3));
      mod.rules.push({
        type: "rate",
        variable,
        formula,
        range: makeRange(clause[0]!, clause[clause.length - 1]!),
      });
      return;
    }

    // 9. Assignment rule: `[$]<id> := <expr>`
    if (
      clause.length >= 3 &&
      ((clause[0]?.kind === "IDENT" && clause[1]?.kind === "COLON_EQ") ||
        (clause[0]?.kind === "DOLLAR" && clause[1]?.kind === "IDENT" && clause[2]?.kind === "COLON_EQ"))
    ) {
      const hasDollar = clause[0]!.kind === "DOLLAR";
      const idIdx = hasDollar ? 1 : 0;
      const variable = clause[idIdx]!.value;
      const formula = sliceSource(clause.slice(idIdx + 2));
      const ruleRange = makeRange(clause[0]!, clause[clause.length - 1]!);
      if (hasDollar) {
        ensureSpeciesInModule(mod, variable, true, undefined, ruleRange);
      } else if (!mod.species.has(variable) && !mod.compartments.has(variable) && !mod.parameters.has(variable)) {
        mod.parameters.set(variable, {
          id: variable,
          name: mod.displayNames?.get(variable),
          value: 0.0,
          formula,
          constant: false,
          range: ruleRange,
        });
      }
      mod.rules.push({
        type: "assignment",
        variable,
        formula,
        range: ruleRange,
      });
      return;
    }

    // 10. Submodel instantiation: `[<alias> :] <ModuleName>(<args...>)`
    if (
      (clause.length >= 3 &&
        clause[0]?.kind === "IDENT" &&
        clause[1]?.kind === "LPAREN" &&
        clause[clause.length - 1]?.kind === "RPAREN") ||
      (clause.length >= 5 &&
        clause[0]?.kind === "IDENT" &&
        clause[1]?.kind === "COLON" &&
        clause[2]?.kind === "IDENT" &&
        clause[3]?.kind === "LPAREN" &&
        clause[clause.length - 1]?.kind === "RPAREN")
    ) {
      const hasAlias = clause[1]?.kind === "COLON";
      const subId = hasAlias ? clause[0]!.value : `_sub${autoSubmodelCounter++}`;
      const moduleName = hasAlias ? clause[2]!.value : clause[0]!.value;
      const argsStart = hasAlias ? 4 : 2;
      const argsTokens = clause.slice(argsStart, clause.length - 1);
      const args: string[] = [];
      let curArg: Token[] = [];
      for (const tok of argsTokens) {
        if (tok.kind === "COMMA") {
          const s = sliceSource(curArg);
          if (s) args.push(s);
          curArg = [];
        } else {
          curArg.push(tok);
        }
      }
      const lastArg = sliceSource(curArg);
      if (lastArg) args.push(lastArg);

      const subObj: AntimonySubmodel = {
        id: subId,
        moduleName,
        arguments: args,
        range: makeRange(clause[0]!, clause[clause.length - 1]!),
      };
      mod.submodels.push(subObj);
      return;
    }

    // 11. Initial assignment: `[$]<id> [in <compId>] = <expr>`
    if (clause.length >= 3) {
      let p = 0;
      let hasDollar = false;
      if (clause[p]?.kind === "DOLLAR") {
        hasDollar = true;
        p++;
      }
      if (clause[p]?.kind === "IDENT") {
        const variable = clause[p]!.value;
        p++;
        let inComp: string | undefined;
        if (clause[p]?.kind === "IDENT" && clause[p]!.value === "in" && clause[p + 1]?.kind === "IDENT") {
          inComp = clause[p + 1]!.value;
          p += 2;
        }
        if (clause[p]?.kind === "EQ") {
          p++;
          const exprStr = sliceSource(clause.slice(p));
          const numVal = parseNumericValue(exprStr);
          const assignRange = makeRange(clause[0]!, clause[clause.length - 1]!);

          if (hasDollar || inComp !== undefined || mod.species.has(variable)) {
            const sp = ensureSpeciesInModule(mod, variable, hasDollar, inComp, assignRange);
            if (numVal !== undefined) {
              sp.initialConcentration = numVal;
            } else if (exprStr.length > 0) {
              mod.rules.push({
                type: "initial",
                variable,
                formula: exprStr,
                range: assignRange,
              });
            }
          } else if (mod.compartments.has(variable)) {
            const comp = mod.compartments.get(variable)!;
            if (numVal !== undefined) {
              comp.size = numVal;
            }
          } else {
            const existingParam = mod.parameters.get(variable);
            mod.parameters.set(variable, {
              id: variable,
              name: existingParam?.name ?? mod.displayNames?.get(variable),
              value: numVal ?? existingParam?.value ?? 0.0,
              formula: numVal === undefined && exprStr ? exprStr : existingParam?.formula,
              constant: existingParam?.constant ?? true,
              isExplicitlyConst: existingParam?.isExplicitlyConst,
              range: existingParam?.range ?? assignRange,
            });
            if (numVal === undefined && exprStr.length > 0) {
              mod.rules.push({
                type: "initial",
                variable,
                formula: exprStr,
                range: assignRange,
              });
            }
          }
        }
      }
    }
  };

  const parseFunctionBlock = (): void => {
    const startTok = consume(); // 'function'
    if (peek().kind === "STAR") consume();
    const nameTok = peek().kind === "IDENT" ? consume() : startTok;
    const fnId = nameTok.value;
    const args: string[] = [];

    if (peek().kind === "LPAREN") {
      consume(); // '('
      while (peek().kind !== "EOF" && peek().kind !== "RPAREN") {
        if (peek().kind === "IDENT") {
          args.push(consume().value);
        } else {
          consume();
        }
      }
      if (peek().kind === "RPAREN") consume();
    }

    skipNewlinesAndSemis();
    const bodyTokens: Token[] = [];
    while (peek().kind !== "EOF") {
      if (peek().kind === "IDENT" && peek().value === "end") {
        break;
      }
      bodyTokens.push(consume());
    }
    const endTok = peek().kind === "IDENT" && peek().value === "end" ? consume() : nameTok;
    // Filter trailing semicolons or newlines from bodyTokens
    while (
      bodyTokens.length > 0 &&
      (bodyTokens[bodyTokens.length - 1]?.kind === "SEMI" || bodyTokens[bodyTokens.length - 1]?.kind === "NEWLINE")
    ) {
      bodyTokens.pop();
    }
    const body = sliceSource(bodyTokens);
    functions.set(fnId, {
      id: fnId,
      arguments: args,
      body,
      range: makeRange(startTok, endTok),
    });
  };

  const parseModuleBlock = (): void => {
    const startTok = consume(); // 'model' or 'module'
    if (peek().kind === "STAR") consume(); // optional '*' in 'model *Name()'
    const nameTok = peek().kind === "IDENT" ? consume() : startTok;
    const modId = nameTok.value;
    const mod = createEmptyModule(modId);

    if (peek().kind === "LPAREN") {
      consume(); // '('
      while (peek().kind !== "EOF" && peek().kind !== "RPAREN") {
        if (peek().kind === "IDENT") {
          mod.arguments.push(consume().value);
        } else {
          consume();
        }
      }
      if (peek().kind === "RPAREN") consume();
    }

    skipNewlines();
    while (peek().kind !== "EOF") {
      skipNewlinesAndSemis();
      if (peek().kind === "EOF") break;
      if (peek().kind === "IDENT" && peek().value === "end") {
        break;
      }
      parseModuleStatement(mod);
    }

    const endTok = peek().kind === "IDENT" && peek().value === "end" ? consume() : nameTok;
    mod.range = makeRange(startTok, endTok);
    modules.set(modId, mod);
    lastExplicitModule = mod;
  };

  // Main parse loop
  while (peek().kind !== "EOF") {
    skipNewlinesAndSemis();
    if (peek().kind === "EOF") break;
    parseModuleStatement(topModule);
  }

  const hasTopContent =
    topModule.compartments.size > 0 ||
    topModule.species.size > 0 ||
    topModule.parameters.size > 0 ||
    topModule.reactions.size > 0 ||
    topModule.rules.length > 0 ||
    topModule.events.length > 0 ||
    topModule.submodels.length > 0;

  let mainModule: AntimonyModule;
  if (hasTopContent) {
    modules.set(topModule.id, topModule);
    mainModule = topModule;
  } else if (lastExplicitModule) {
    mainModule = lastExplicitModule;
  } else {
    modules.set(topModule.id, topModule);
    mainModule = topModule;
  }

  return {
    mainModule,
    modules,
    functions,
    sourceFile: filename,
  };
}

function serializeSingleModule(mod: AntimonyModule): string {
  const lines: string[] = [];
  const argsStr = mod.arguments.length > 0 ? `(${mod.arguments.join(", ")})` : "()";
  lines.push(`model ${mod.id}${argsStr}`);

  // 1. Compartments
  if (mod.compartments.size > 0) {
    const compNames = Array.from(mod.compartments.keys());
    lines.push(`  compartment ${compNames.join(", ")};`);
    for (const c of mod.compartments.values()) {
      lines.push(`  ${c.id} = ${c.size};`);
    }
  }

  // 2. Species
  if (mod.species.size > 0) {
    for (const s of mod.species.values()) {
      const qual = s.constant ? "const " : "";
      const dollar = s.boundaryCondition ? "$" : "";
      const compClause = s.compartment && s.compartment !== "default_compartment" ? ` in ${s.compartment}` : "";
      lines.push(`  ${qual}species ${dollar}${s.id}${compClause};`);
      if (s.initialConcentration !== undefined) {
        lines.push(`  ${s.id} = ${s.initialConcentration};`);
      } else if (s.initialAmount !== undefined) {
        lines.push(`  ${s.id} = ${s.initialAmount};`);
      }
    }
  }

  // 3. Parameters
  if (mod.parameters.size > 0) {
    for (const p of mod.parameters.values()) {
      const qual = p.constant ? "const" : "var";
      lines.push(`  ${qual} ${p.id} = ${p.value};`);
    }
  }

  // 4. Submodels
  for (const sub of mod.submodels) {
    lines.push(`  ${sub.id}: ${sub.moduleName}(${sub.arguments.join(", ")});`);
  }

  // 5. Reactions
  for (const r of mod.reactions.values()) {
    const formatRef = (ref: AntimonySpeciesReference): string => {
      const dollar = ref.boundaryCondition ? "$" : "";
      const stoichStr = ref.stoichiometry === 1 ? "" : `${ref.stoichiometry} `;
      return `${stoichStr}${dollar}${ref.species}`;
    };
    const lhs = r.reactants.map(formatRef).join(" + ");
    const rhs = r.products.map(formatRef).join(" + ");
    const arrow = r.reversible ? "->" : "=>";
    const ratePart = r.rateLaw ? ` ${r.rateLaw};` : "";
    lines.push(`  ${r.id}: ${lhs} ${arrow} ${rhs};${ratePart}`);
  }

  // 6. Rules
  for (const rule of mod.rules) {
    if (rule.type === "rate") {
      lines.push(`  ${rule.variable}' = ${rule.formula};`);
    } else if (rule.type === "assignment") {
      lines.push(`  ${rule.variable} := ${rule.formula};`);
    } else if (rule.type === "initial") {
      lines.push(`  ${rule.variable} = ${rule.formula};`);
    }
  }

  // 7. Events
  for (const ev of mod.events) {
    const asgnStr = ev.assignments.map((a) => `${a.variable} = ${a.formula}`).join(", ");
    lines.push(`  ${ev.id}: at (${ev.trigger}): ${asgnStr};`);
  }

  // 8. Display names
  if (mod.displayNames) {
    for (const [id, disp] of mod.displayNames) {
      lines.push(`  ${id} is "${disp}";`);
    }
  }

  lines.push(`end`);
  return lines.join("\n");
}

/**
 * Serializes an AntimonyDocument AST into canonical Antimony (.ant) source text.
 */
export function serializeAntimony(doc: AntimonyDocument): string {
  const blocks: string[] = [];

  for (const fn of doc.functions.values()) {
    blocks.push(`function ${fn.id}(${fn.arguments.join(", ")})\n  ${fn.body};\nend`);
  }

  if (doc.modules.size > 0) {
    for (const mod of doc.modules.values()) {
      blocks.push(serializeSingleModule(mod));
    }
  } else {
    blocks.push(serializeSingleModule(doc.mainModule));
  }

  return blocks.join("\n\n");
}
