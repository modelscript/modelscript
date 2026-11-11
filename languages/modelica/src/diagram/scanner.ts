// SPDX-License-Identifier: AGPL-3.0-or-later

import { Position, Range, TextEdit } from "vscode-languageserver-types";
import type { ModelicaClassInstance } from "./types.js";

export type CompositionSectionKind =
  | "public"
  | "protected"
  | "initial_equation"
  | "equation"
  | "initial_algorithm"
  | "algorithm"
  | "external";

export interface ScannedSection {
  kind: CompositionSectionKind;
  keywordOffset: number;
  headerEndOffset: number;
  endOffset: number;
  startLine: number;
  endLine: number;
}

export interface ScannedClassAnnotation {
  keywordOffset: number;
  openParenOffset: number;
  closeParenOffset: number;
  statementEndOffset: number;
  startLine: number;
  endLine: number;
  isStrandedBeforeBodyElements: boolean;
}

export interface ScannedComponentDecl {
  name: string;
  typeName: string;
  clauseStartOffset: number;
  clauseEndOffset: number;
  declStartOffset: number;
  declEndOffset: number;
  identStartOffset: number;
  identEndOffset: number;
  subscriptsEndOffset: number | null;
  modOpenParenOffset: number | null;
  modCloseParenOffset: number | null;
  modEndOffset: number | null;
  descriptionStartOffset: number | null;
  descriptionEndOffset: number | null;
  annotationKeywordOffset: number | null;
  annotationOpenParenOffset: number | null;
  annotationCloseParenOffset: number | null;
  hasSemicolon: boolean;
  isSoleDeclarator: boolean;
  startLine: number;
  endLine: number;
}

export interface ScannedConnectStmt {
  source: string;
  target: string;
  lhsStartOffset: number;
  lhsEndOffset: number;
  rhsStartOffset: number;
  rhsEndOffset: number;
  startOffset: number;
  closeConnectParenOffset: number;
  annotationKeywordOffset: number | null;
  annotationOpenParenOffset: number | null;
  annotationCloseParenOffset: number | null;
  statementEndOffset: number;
  hasSemicolon: boolean;
  startLine: number;
  endLine: number;
}

export interface ScannedClassLayout {
  className: string;
  headerStartOffset: number;
  headerEndOffset: number;
  endKeywordOffset: number;
  endStatementEndOffset: number;
  startLine: number;
  endLine: number;
  lineStarts: number[];
  maskedText: string;
  sections: ScannedSection[];
  classAnnotations: ScannedClassAnnotation[];
  components: ScannedComponentDecl[];
  connects: ScannedConnectStmt[];
}

/**
 * Replaces the interior of comments (`//`, `/* ... * /`), string literals (`"..."`),
 * and quoted identifiers (`'...'`) with spaces while preserving exact character offsets
 * and every newline `\n`. Opening and closing quotes (`""`, `''`) remain intact.
 */
export function maskModelicaCommentsAndStrings(text: string): string {
  const len = text.length;
  const out = new Array<string>(len);
  let i = 0;

  while (i < len) {
    const ch = text[i]!;
    const next = i + 1 < len ? text[i + 1] : "";

    // Line comment //
    if (ch === "/" && next === "/") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < len && text[i] !== "\n") {
        out[i] = text[i] === "\r" ? "\r" : " ";
        i++;
      }
      continue;
    }

    // Block comment /* ... */
    if (ch === "/" && next === "*") {
      out[i] = " ";
      out[i + 1] = " ";
      i += 2;
      while (i < len) {
        if (text[i] === "*" && i + 1 < len && text[i + 1] === "/") {
          out[i] = " ";
          out[i + 1] = " ";
          i += 2;
          break;
        }
        out[i] = text[i] === "\n" ? "\n" : text[i] === "\r" ? "\r" : " ";
        i++;
      }
      continue;
    }

    // String literal "..." or quoted identifier '...'
    if (ch === '"' || ch === "'") {
      const quote = ch;
      out[i] = quote;
      i++;
      while (i < len) {
        const c = text[i]!;
        if (c === "\\" && i + 1 < len) {
          out[i] = " ";
          out[i + 1] = text[i + 1] === "\n" ? "\n" : " ";
          i += 2;
          continue;
        }
        if (c === quote) {
          out[i] = quote;
          i++;
          break;
        }
        out[i] = c === "\n" ? "\n" : c === "\r" ? "\r" : " ";
        i++;
      }
      continue;
    }

    out[i] = ch;
    i++;
  }

  return out.join("");
}

export function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === "\n") {
      starts.push(i + 1);
    }
  }
  return starts;
}

export function offsetToPosition(lineStarts: number[], offset: number): Position {
  const clamped = Math.max(0, offset);
  let lo = 0;
  let hi = lineStarts.length - 1;
  while (lo <= hi) {
    const mid = (lo + hi) >>> 1;
    if (lineStarts[mid]! <= clamped) {
      lo = mid + 1;
    } else {
      hi = mid - 1;
    }
  }
  const line = Math.max(0, hi);
  return Position.create(line, clamped - lineStarts[line]!);
}

export function positionToOffset(lineStarts: number[], textLength: number, line: number, character: number): number {
  if (line < 0) return 0;
  if (line >= lineStarts.length) return textLength;
  return Math.min(textLength, lineStarts[line]! + Math.max(0, character));
}

/**
 * Finds the matching closing delimiter (`)`, `}`, `]`) on comment/string-masked text.
 * Returns `-1` if unbalanced before `limitOffset`.
 */
export function findBalancedClose(
  maskedText: string,
  openOffset: number,
  limitOffset: number = maskedText.length,
): number {
  const openCh = maskedText[openOffset];
  if (openCh !== "(" && openCh !== "{" && openCh !== "[") return -1;
  const stack: string[] = [openCh === "(" ? ")" : openCh === "{" ? "}" : "]"];
  for (let i = openOffset + 1; i < limitOffset; i++) {
    const c = maskedText[i];
    if (c === "(") stack.push(")");
    else if (c === "{") stack.push("}");
    else if (c === "[") stack.push("]");
    else if (c === ")" || c === "}" || c === "]") {
      if (stack[stack.length - 1] === c) {
        stack.pop();
        if (stack.length === 0) return i;
      }
    }
  }
  return -1;
}

interface LexToken {
  kind: "word" | "string" | "qident" | "punct";
  text: string;
  start: number;
  end: number;
}

function tokenizeMasked(rawText: string, maskedText: string, startOffset = 0, endOffset = rawText.length): LexToken[] {
  const tokens: LexToken[] = [];
  let i = startOffset;
  while (i < endOffset) {
    const ch = maskedText[i]!;
    if (ch <= " ") {
      i++;
      continue;
    }
    if ((ch >= "a" && ch <= "z") || (ch >= "A" && ch <= "Z") || ch === "_" || (ch >= "0" && ch <= "9")) {
      const s = i;
      i++;
      while (i < endOffset) {
        const c = maskedText[i]!;
        if ((c >= "a" && c <= "z") || (c >= "A" && c <= "Z") || (c >= "0" && c <= "9") || c === "_") {
          i++;
        } else {
          break;
        }
      }
      tokens.push({ kind: "word", text: rawText.slice(s, i), start: s, end: i });
      continue;
    }
    if (ch === '"' || ch === "'") {
      const quote = ch;
      const s = i;
      i++;
      while (i < endOffset && maskedText[i] !== quote) {
        i++;
      }
      if (i < endOffset) i++;
      tokens.push({
        kind: quote === '"' ? "string" : "qident",
        text: rawText.slice(s, i),
        start: s,
        end: i,
      });
      continue;
    }
    tokens.push({ kind: "punct", text: ch, start: i, end: i + 1 });
    i++;
  }
  return tokens;
}

const CLASS_KEYWORDS = new Set(["model", "class", "block", "connector", "record", "package", "type", "function"]);

const CLASS_PREFIX_WORDS = new Set(["encapsulated", "partial", "expandable", "impure", "pure"]);

const CONTROL_END_TARGETS = new Set(["if", "for", "while", "when"]);

const COMPONENT_PREFIXES = new Set([
  "flow",
  "stream",
  "discrete",
  "parameter",
  "constant",
  "input",
  "output",
  "inner",
  "outer",
  "replaceable",
  "redeclare",
  "final",
  "each",
]);

const NON_COMPONENT_STARTERS = new Set([
  "import",
  "extends",
  "within",
  "public",
  "protected",
  "initial",
  "equation",
  "algorithm",
  "external",
  "annotation",
  "end",
  "if",
  "for",
  "when",
  "while",
  "connect",
  "return",
  "break",
]);

function isIdentToken(tok: LexToken | undefined): boolean {
  if (!tok) return false;
  if (tok.kind === "qident") return true;
  if (tok.kind !== "word") return false;
  const first = tok.text[0]!;
  return (first >= "a" && first <= "z") || (first >= "A" && first <= "Z") || first === "_";
}

function isAtLineStart(maskedText: string, offset: number): boolean {
  for (let i = offset - 1; i >= 0; i--) {
    const c = maskedText[i]!;
    if (c === "\n") return true;
    if (c !== " " && c !== "\t" && c !== "\r") return false;
  }
  return true;
}

interface ClassSpanCandidate {
  name: string;
  compositeName: string;
  headerStartTokIdx: number;
  bodyStartTokIdx: number;
  endKeywordTokIdx: number;
  endStmtLastTokIdx: number;
  headerStartOffset: number;
  headerEndOffset: number;
  endKeywordOffset: number;
  endStatementEndOffset: number;
}

/**
 * Scans a Modelica source document (even in the presence of syntax errors, incomplete
 * equations, unclosed parentheses, or misplaced class annotations) and extracts the exact
 * composition structure, sections, standalone class annotations, components, and connect statements.
 */
export function scanModelicaClassLayout(
  docText: string,
  targetClassName?: string,
  hintStartLine?: number,
): ScannedClassLayout | null {
  const maskedText = maskModelicaCommentsAndStrings(docText);
  const lineStarts = computeLineStarts(docText);
  const tokens = tokenizeMasked(docText, maskedText);
  if (tokens.length === 0) return null;

  const candidates: ClassSpanCandidate[] = [];
  const openStack: {
    name: string;
    compositeName: string;
    headerStartTokIdx: number;
    bodyStartTokIdx: number;
    headerStartOffset: number;
    headerEndOffset: number;
  }[] = [];

  let idx = 0;
  let parenDepth = 0;

  while (idx < tokens.length) {
    const tok = tokens[idx]!;

    if (tok.kind === "punct") {
      if (tok.text === "(" || tok.text === "{" || tok.text === "[") parenDepth++;
      else if (tok.text === ")" || tok.text === "}" || tok.text === "]") {
        if (parenDepth > 0) parenDepth--;
      }
      idx++;
      continue;
    }

    // Recover unclosed parens if we hit `end <ClassName>;` at the start of a line
    const atLineStart = isAtLineStart(maskedText, tok.start);

    if (tok.kind === "word" && tok.text === "end" && (parenDepth === 0 || atLineStart)) {
      const nextTok = tokens[idx + 1];
      if (nextTok && nextTok.kind === "word" && CONTROL_END_TARGETS.has(nextTok.text)) {
        idx += 2;
        continue;
      }
      if (openStack.length > 0) {
        parenDepth = 0;
        let matchStackIdx = openStack.length - 1;
        if (isIdentToken(nextTok)) {
          for (let s = openStack.length - 1; s >= 0; s--) {
            if (openStack[s]!.name === nextTok!.text) {
              matchStackIdx = s;
              break;
            }
          }
        }
        while (openStack.length > matchStackIdx) {
          const opened = openStack.pop()!;
          let endLastIdx = idx;
          if (isIdentToken(nextTok) && nextTok!.text === opened.name) {
            endLastIdx = idx + 1;
          }
          if (tokens[endLastIdx + 1]?.text === ";") {
            endLastIdx++;
          }
          candidates.push({
            name: opened.name,
            compositeName: opened.compositeName,
            headerStartTokIdx: opened.headerStartTokIdx,
            bodyStartTokIdx: opened.bodyStartTokIdx,
            endKeywordTokIdx: idx,
            endStmtLastTokIdx: endLastIdx,
            headerStartOffset: opened.headerStartOffset,
            headerEndOffset: opened.headerEndOffset,
            endKeywordOffset: tok.start,
            endStatementEndOffset: tokens[endLastIdx]!.end,
          });
        }
        idx = (candidates[candidates.length - 1]?.endStmtLastTokIdx ?? idx) + 1;
        continue;
      }
    }

    // Check for long class definition start
    if (tok.kind === "word" && (parenDepth === 0 || atLineStart)) {
      let kwIdx = idx;
      // Skip class prefixes (`encapsulated`, `partial`, `expandable`, `redeclare`, `replaceable`, `final`, `inner`, `outer`)
      const prevWord = idx > 0 ? tokens[idx - 1] : undefined;
      const isPrecededByPrefix =
        prevWord?.kind === "word" && (CLASS_PREFIX_WORDS.has(prevWord.text) || COMPONENT_PREFIXES.has(prevWord.text));

      let isClassKw = false;
      if (CLASS_KEYWORDS.has(tok.text)) {
        isClassKw = true;
      } else if (tok.text === "operator") {
        const afterOp = tokens[idx + 1];
        if (afterOp?.kind === "word" && (afterOp.text === "record" || afterOp.text === "function")) {
          kwIdx = idx + 1;
          isClassKw = true;
        } else if (isIdentToken(afterOp)) {
          isClassKw = true;
        }
      }

      if (isClassKw && isIdentToken(tokens[kwIdx + 1])) {
        let headerStartIdx = idx;
        if (isPrecededByPrefix) {
          while (
            headerStartIdx > 0 &&
            tokens[headerStartIdx - 1]?.kind === "word" &&
            (CLASS_PREFIX_WORDS.has(tokens[headerStartIdx - 1]!.text) ||
              COMPONENT_PREFIXES.has(tokens[headerStartIdx - 1]!.text))
          ) {
            headerStartIdx--;
          }
        }
        const nameTok = tokens[kwIdx + 1]!;
        const afterNameTok = tokens[kwIdx + 2];

        // Short class specifier (`type Voltage = Real(...);` or `model A = B;`) or extends class specifier (`model A(...) ... end A;`)
        const isShortClass = afterNameTok?.text === "=";
        if (!isShortClass) {
          parenDepth = 0;
          let headerEndTokIdx = kwIdx + 1;
          // `extends` class specifier: `redeclare model extends Foo(...) "desc"` -> Wait: handled if nameTok === "extends"
          if (nameTok.text === "extends" && isIdentToken(afterNameTok)) {
            headerEndTokIdx = kwIdx + 2;
          }
          const actualName =
            nameTok.text === "extends" && isIdentToken(afterNameTok) ? afterNameTok!.text : nameTok.text;
          // Optional class modification on `model extends Foo(...)`
          if (tokens[headerEndTokIdx + 1]?.text === "(") {
            const closeOff = findBalancedClose(maskedText, tokens[headerEndTokIdx + 1]!.start);
            if (closeOff !== -1) {
              while (headerEndTokIdx + 1 < tokens.length && tokens[headerEndTokIdx + 1]!.end <= closeOff + 1) {
                headerEndTokIdx++;
              }
            }
          }
          // Optional description string `"..."` (may concatenate `"..." + "..."`)
          while (tokens[headerEndTokIdx + 1]?.kind === "string") {
            headerEndTokIdx++;
            if (tokens[headerEndTokIdx + 1]?.text === "+" && tokens[headerEndTokIdx + 2]?.kind === "string") {
              headerEndTokIdx++;
            } else {
              break;
            }
          }

          const parentComposite = openStack.length > 0 ? openStack[openStack.length - 1]!.compositeName : "";
          const compositeName = parentComposite ? `${parentComposite}.${actualName}` : actualName;
          openStack.push({
            name: actualName,
            compositeName,
            headerStartTokIdx: headerStartIdx,
            bodyStartTokIdx: headerEndTokIdx + 1,
            headerStartOffset: tokens[headerStartIdx]!.start,
            headerEndOffset: tokens[headerEndTokIdx]!.end,
          });
          idx = headerEndTokIdx + 1;
          continue;
        }
      }
    }

    idx++;
  }

  // If unclosed class definitions remain on openStack (e.g. missing `end Model;` due to syntax error at EOF),
  // synthesize candidates ending at EOF so diagram editing still works!
  while (openStack.length > 0) {
    const opened = openStack.pop()!;
    const lastTokIdx = tokens.length - 1;
    candidates.push({
      name: opened.name,
      compositeName: opened.compositeName,
      headerStartTokIdx: opened.headerStartTokIdx,
      bodyStartTokIdx: opened.bodyStartTokIdx,
      endKeywordTokIdx: tokens.length,
      endStmtLastTokIdx: lastTokIdx,
      headerStartOffset: opened.headerStartOffset,
      headerEndOffset: opened.headerEndOffset,
      endKeywordOffset: docText.length,
      endStatementEndOffset: docText.length,
    });
  }

  if (candidates.length === 0) return null;

  // Pick target class candidate
  let chosen: ClassSpanCandidate | undefined;
  if (targetClassName) {
    const simpleTarget = targetClassName.split(".").pop()!;
    chosen =
      candidates.find((c) => c.compositeName === targetClassName) ??
      candidates.find((c) => c.compositeName.endsWith(`.${targetClassName}`)) ??
      candidates.find((c) => c.name === targetClassName) ??
      candidates.find((c) => c.name === simpleTarget);
  }
  if (!chosen && hintStartLine !== undefined) {
    chosen = candidates.find((c) => offsetToPosition(lineStarts, c.headerStartOffset).line === hintStartLine);
  }
  if (!chosen) {
    // Outermost class starts earliest (`headerStartOffset` minimum)
    chosen = candidates.reduce((best, cur) => (cur.headerStartOffset < best.headerStartOffset ? cur : best));
  }

  // Build ranges of nested classes strictly inside `chosen` so we skip them completely
  const nestedSpans = candidates
    .filter(
      (c) =>
        c !== chosen &&
        c.headerStartTokIdx >= chosen!.bodyStartTokIdx &&
        c.endStmtLastTokIdx < chosen!.endKeywordTokIdx,
    )
    .sort((a, b) => a.headerStartTokIdx - b.headerStartTokIdx);

  const sections: ScannedSection[] = [];
  const classAnnotations: ScannedClassAnnotation[] = [];
  const components: ScannedComponentDecl[] = [];
  const connects: ScannedConnectStmt[] = [];

  let currentSection: CompositionSectionKind | "initial_public" = "initial_public";
  let bodyElementSeenAfterAnnotationIndex = -1;

  const advancePastCloseOffset = (fromIdx: number, closeOffset: number): number => {
    let k = fromIdx;
    while (k < chosen!.endKeywordTokIdx && tokens[k]!.start <= closeOffset) {
      k++;
    }
    return k;
  };

  let tIdx = chosen.bodyStartTokIdx;
  while (tIdx < chosen.endKeywordTokIdx) {
    // Skip nested class definitions cleanly
    const nested = nestedSpans.find((ns) => tIdx >= ns.headerStartTokIdx && tIdx <= ns.endStmtLastTokIdx);
    if (nested) {
      if (classAnnotations.length > 0) {
        bodyElementSeenAfterAnnotationIndex = classAnnotations.length - 1;
      }
      tIdx = nested.endStmtLastTokIdx + 1;
      continue;
    }

    const tok = tokens[tIdx]!;

    // Stray punctuation (e.g. extra `;`)
    if (tok.kind === "punct") {
      tIdx++;
      continue;
    }

    // 1. Check section headers
    if (tok.kind === "word") {
      let matchedSection: CompositionSectionKind | null = null;
      let headerLastTokIdx = tIdx;

      if (tok.text === "public") {
        matchedSection = "public";
      } else if (tok.text === "protected") {
        matchedSection = "protected";
      } else if (tok.text === "equation") {
        matchedSection = "equation";
      } else if (tok.text === "algorithm") {
        matchedSection = "algorithm";
      } else if (tok.text === "initial" && tokens[tIdx + 1]?.kind === "word") {
        if (tokens[tIdx + 1]!.text === "equation") {
          matchedSection = "initial_equation";
          headerLastTokIdx = tIdx + 1;
        } else if (tokens[tIdx + 1]!.text === "algorithm") {
          matchedSection = "initial_algorithm";
          headerLastTokIdx = tIdx + 1;
        }
      } else if (tok.text === "external") {
        matchedSection = "external";
      }

      if (matchedSection) {
        if (sections.length > 0) {
          const prevSec = sections[sections.length - 1]!;
          prevSec.endOffset = tok.start;
          prevSec.endLine = offsetToPosition(lineStarts, tok.start).line;
        }
        if (classAnnotations.length > 0) {
          bodyElementSeenAfterAnnotationIndex = classAnnotations.length - 1;
        }
        currentSection = matchedSection;
        const secEntry: ScannedSection = {
          kind: matchedSection,
          keywordOffset: tok.start,
          headerEndOffset: tokens[headerLastTokIdx]!.end,
          endOffset: chosen.endKeywordOffset,
          startLine: offsetToPosition(lineStarts, tok.start).line,
          endLine: offsetToPosition(lineStarts, chosen.endKeywordOffset).line,
        };
        sections.push(secEntry);

        if (matchedSection === "external") {
          // Consume external clause up to `;`
          let k = headerLastTokIdx + 1;
          while (k < chosen.endKeywordTokIdx) {
            const kt = tokens[k]!;
            if (kt.text === "(") {
              const closeOff = findBalancedClose(maskedText, kt.start, chosen.endKeywordOffset);
              if (closeOff !== -1) {
                k = advancePastCloseOffset(k, closeOff);
                continue;
              }
            }
            if (kt.text === ";") {
              secEntry.endOffset = kt.end;
              secEntry.endLine = offsetToPosition(lineStarts, kt.end).line;
              k++;
              break;
            }
            k++;
          }
          tIdx = k;
          continue;
        }

        tIdx = headerLastTokIdx + 1;
        continue;
      }
    }

    // 2. Standalone class-level `annotation(...)` clause!
    if (tok.kind === "word" && tok.text === "annotation" && tokens[tIdx + 1]?.text === "(") {
      const openParenOff = tokens[tIdx + 1]!.start;
      const closeParenOff = findBalancedClose(maskedText, openParenOff, chosen.endKeywordOffset);
      if (closeParenOff !== -1) {
        let nextIdx = advancePastCloseOffset(tIdx + 1, closeParenOff);
        let stmtEndOff = closeParenOff + 1;
        if (tokens[nextIdx]?.text === ";") {
          stmtEndOff = tokens[nextIdx]!.end;
          nextIdx++;
        }
        if (sections.length > 0) {
          const prevSec = sections[sections.length - 1]!;
          if (prevSec.endOffset > tok.start) {
            prevSec.endOffset = tok.start;
            prevSec.endLine = offsetToPosition(lineStarts, tok.start).line;
          }
        }
        classAnnotations.push({
          keywordOffset: tok.start,
          openParenOffset: openParenOff,
          closeParenOffset: closeParenOff,
          statementEndOffset: stmtEndOff,
          startLine: offsetToPosition(lineStarts, tok.start).line,
          endLine: offsetToPosition(lineStarts, stmtEndOff).line,
          isStrandedBeforeBodyElements: false,
        });
        tIdx = nextIdx;
        continue;
      }
    }

    // 3. `connect(lhs, rhs) ... ;` statement!
    if (tok.kind === "word" && tok.text === "connect" && tokens[tIdx + 1]?.text === "(") {
      if (classAnnotations.length > 0) {
        bodyElementSeenAfterAnnotationIndex = classAnnotations.length - 1;
      }
      const openParenOff = tokens[tIdx + 1]!.start;
      const closeParenOff = findBalancedClose(maskedText, openParenOff, chosen.endKeywordOffset);
      if (closeParenOff !== -1) {
        // Find top-level comma inside connect(lhs, rhs)
        let commaOff = -1;
        let d = 0;
        for (let p = openParenOff + 1; p < closeParenOff; p++) {
          const ch = maskedText[p];
          if (ch === "(" || ch === "{" || ch === "[") d++;
          else if (ch === ")" || ch === "}" || ch === "]") {
            if (d > 0) d--;
          } else if (ch === "," && d === 0) {
            commaOff = p;
            break;
          }
        }
        let nextIdx = advancePastCloseOffset(tIdx + 1, closeParenOff);
        // Optional description string `"..."`
        if (tokens[nextIdx]?.kind === "string") {
          nextIdx++;
        }
        // Optional trailing `annotation(...)`
        let annKwOff: number | null = null;
        let annOpenOff: number | null = null;
        let annCloseOff: number | null = null;
        if (
          tokens[nextIdx]?.kind === "word" &&
          tokens[nextIdx]!.text === "annotation" &&
          tokens[nextIdx + 1]?.text === "("
        ) {
          const aOpen = tokens[nextIdx + 1]!.start;
          const aClose = findBalancedClose(maskedText, aOpen, chosen.endKeywordOffset);
          if (aClose !== -1) {
            annKwOff = tokens[nextIdx]!.start;
            annOpenOff = aOpen;
            annCloseOff = aClose;
            nextIdx = advancePastCloseOffset(nextIdx + 1, aClose);
          }
        }
        let stmtEndOff = annCloseOff !== null ? annCloseOff + 1 : closeParenOff + 1;
        let hasSemi = false;
        if (tokens[nextIdx]?.text === ";") {
          stmtEndOff = tokens[nextIdx]!.end;
          hasSemi = true;
          nextIdx++;
        }

        if (commaOff !== -1) {
          let lhsStart = openParenOff + 1;
          while (lhsStart < commaOff && maskedText[lhsStart]! <= " ") lhsStart++;
          let lhsEnd = commaOff;
          while (lhsEnd > lhsStart && maskedText[lhsEnd - 1]! <= " ") lhsEnd--;

          let rhsStart = commaOff + 1;
          while (rhsStart < closeParenOff && maskedText[rhsStart]! <= " ") rhsStart++;
          let rhsEnd = closeParenOff;
          while (rhsEnd > rhsStart && maskedText[rhsEnd - 1]! <= " ") rhsEnd--;

          const normRef = (s: string) => s.replace(/\s*\.\s*/g, ".").trim();
          connects.push({
            source: normRef(docText.slice(lhsStart, lhsEnd)),
            target: normRef(docText.slice(rhsStart, rhsEnd)),
            lhsStartOffset: lhsStart,
            lhsEndOffset: lhsEnd,
            rhsStartOffset: rhsStart,
            rhsEndOffset: rhsEnd,
            startOffset: tok.start,
            closeConnectParenOffset: closeParenOff,
            annotationKeywordOffset: annKwOff,
            annotationOpenParenOffset: annOpenOff,
            annotationCloseParenOffset: annCloseOff,
            statementEndOffset: stmtEndOff,
            hasSemicolon: hasSemi,
            startLine: offsetToPosition(lineStarts, tok.start).line,
            endLine: offsetToPosition(lineStarts, stmtEndOff).line,
          });
        }
        tIdx = nextIdx;
        continue;
      }
    }

    // 4. Component declarations in declaration sections (`initial_public`, `public`, `protected`)
    const inDeclarationSection =
      currentSection === "initial_public" || currentSection === "public" || currentSection === "protected";

    if (inDeclarationSection && tok.kind === "word" && !NON_COMPONENT_STARTERS.has(tok.text)) {
      const parsedClause = tryParseComponentClause(
        tokens,
        tIdx,
        chosen.endKeywordTokIdx,
        docText,
        maskedText,
        lineStarts,
      );
      if (parsedClause) {
        if (classAnnotations.length > 0) {
          bodyElementSeenAfterAnnotationIndex = classAnnotations.length - 1;
        }
        components.push(...parsedClause.decls);
        tIdx = parsedClause.nextTokIdx;
        continue;
      }
    }

    // 5. Generic statement skip (equations, algorithms, imports, extends, or broken syntax lines)
    if (classAnnotations.length > 0 && tok.kind === "word" && tok.text !== "within" && tok.text !== "import") {
      bodyElementSeenAfterAnnotationIndex = classAnnotations.length - 1;
    }
    let k = tIdx + 1;
    while (k < chosen.endKeywordTokIdx) {
      const kt = tokens[k]!;
      if (kt.text === "(" || kt.text === "{" || kt.text === "[") {
        const closeOff = findBalancedClose(maskedText, kt.start, chosen.endKeywordOffset);
        if (closeOff !== -1) {
          k = advancePastCloseOffset(k, closeOff);
          continue;
        }
      }
      if (kt.text === ";") {
        k++;
        break;
      }
      // Syntax-error recovery: stop before a line-leading section keyword or `connect(` or `annotation(`
      if (
        isAtLineStart(maskedText, kt.start) &&
        kt.kind === "word" &&
        (kt.text === "public" ||
          kt.text === "protected" ||
          kt.text === "initial" ||
          kt.text === "equation" ||
          kt.text === "algorithm" ||
          kt.text === "external" ||
          (kt.text === "annotation" && tokens[k + 1]?.text === "(") ||
          (kt.text === "connect" && tokens[k + 1]?.text === "("))
      ) {
        break;
      }
      k++;
    }
    tIdx = k;
  }

  for (let a = 0; a <= bodyElementSeenAfterAnnotationIndex; a++) {
    if (classAnnotations[a]) {
      classAnnotations[a]!.isStrandedBeforeBodyElements = true;
    }
  }

  return {
    className: chosen.name,
    headerStartOffset: chosen.headerStartOffset,
    headerEndOffset: chosen.headerEndOffset,
    endKeywordOffset: chosen.endKeywordOffset,
    endStatementEndOffset: chosen.endStatementEndOffset,
    startLine: offsetToPosition(lineStarts, chosen.headerStartOffset).line,
    endLine: offsetToPosition(lineStarts, chosen.endStatementEndOffset).line,
    lineStarts,
    maskedText,
    sections,
    classAnnotations,
    components,
    connects,
  };
}

function tryParseComponentClause(
  tokens: LexToken[],
  startIdx: number,
  endBoundIdx: number,
  docText: string,
  maskedText: string,
  lineStarts: number[],
): { decls: ScannedComponentDecl[]; nextTokIdx: number } | null {
  const clauseStartOffset = tokens[startIdx]!.start;
  const endBoundOffset = endBoundIdx < tokens.length ? tokens[endBoundIdx]!.start : docText.length;

  const advancePast = (fromIdx: number, closeOffset: number): number => {
    let k = fromIdx;
    while (k < endBoundIdx && tokens[k]!.start <= closeOffset) k++;
    return k;
  };

  let idx = startIdx;
  // Optional prefixes
  while (idx < endBoundIdx && tokens[idx]!.kind === "word" && COMPONENT_PREFIXES.has(tokens[idx]!.text)) {
    idx++;
  }

  // Handle `redeclare model ...` or short class `type Foo = ...`
  if (idx < endBoundIdx && tokens[idx]!.kind === "word" && CLASS_KEYWORDS.has(tokens[idx]!.text)) {
    return null;
  }

  // Parse TypeSpecifier: optional leading `.` + Ident (`.` Ident)*
  const typeStartIdx = idx;
  if (tokens[idx]?.text === ".") idx++;
  if (!isIdentToken(tokens[idx])) return null;
  idx++;
  while (tokens[idx]?.text === "." && isIdentToken(tokens[idx + 1])) {
    idx += 2;
  }
  const typeEndOffset = tokens[idx - 1]!.end;
  const typeName = docText.slice(tokens[typeStartIdx]!.start, typeEndOffset).replace(/\s+/g, "");

  // Optional type array subscripts `[...]`
  if (tokens[idx]?.text === "[") {
    const closeSub = findBalancedClose(maskedText, tokens[idx]!.start, endBoundOffset);
    if (closeSub === -1) return null;
    idx = advancePast(idx, closeSub);
  }

  // Must be followed by component identifier!
  if (!isIdentToken(tokens[idx]) || NON_COMPONENT_STARTERS.has(tokens[idx]!.text)) {
    return null;
  }

  const rawDecls: Omit<ScannedComponentDecl, "clauseEndOffset" | "hasSemicolon" | "isSoleDeclarator" | "endLine">[] =
    [];

  while (idx < endBoundIdx && isIdentToken(tokens[idx])) {
    const identTok = tokens[idx]!;
    const declStartOffset = rawDecls.length === 0 ? clauseStartOffset : identTok.start;
    idx++;

    let subscriptsEndOffset: number | null = null;
    if (tokens[idx]?.text === "[") {
      const closeSub = findBalancedClose(maskedText, tokens[idx]!.start, endBoundOffset);
      if (closeSub !== -1) {
        subscriptsEndOffset = closeSub + 1;
        idx = advancePast(idx, closeSub);
      }
    }

    let modOpenParenOffset: number | null = null;
    let modCloseParenOffset: number | null = null;
    let modEndOffset: number | null = null;

    if (tokens[idx]?.text === "(") {
      const openOff = tokens[idx]!.start;
      const closeOff = findBalancedClose(maskedText, openOff, endBoundOffset);
      if (closeOff !== -1) {
        modOpenParenOffset = openOff;
        modCloseParenOffset = closeOff;
        modEndOffset = closeOff + 1;
        idx = advancePast(idx, closeOff);
      }
    }

    // Optional `= expr` or `:= expr` binding on modification
    if (tokens[idx]?.text === "=" || (tokens[idx]?.text === ":" && tokens[idx + 1]?.text === "=")) {
      if (tokens[idx]!.text === ":") idx += 2;
      else idx += 1;
      while (idx < endBoundIdx) {
        const bt = tokens[idx]!;
        if (bt.text === "(" || bt.text === "{" || bt.text === "[") {
          const closeOff = findBalancedClose(maskedText, bt.start, endBoundOffset);
          if (closeOff !== -1) {
            modEndOffset = closeOff + 1;
            idx = advancePast(idx, closeOff);
            continue;
          }
        }
        if (
          bt.text === ";" ||
          bt.text === "," ||
          bt.kind === "string" ||
          (bt.kind === "word" && (bt.text === "if" || bt.text === "annotation")) ||
          (isAtLineStart(maskedText, bt.start) && bt.kind === "word" && NON_COMPONENT_STARTERS.has(bt.text))
        ) {
          break;
        }
        modEndOffset = bt.end;
        idx++;
      }
    }

    // Optional conditional attribute `if expr` (Modelica grammar allows `if` before description/annotation)
    const consumeIfCondition = () => {
      if (
        tokens[idx]?.kind === "word" &&
        tokens[idx]!.text === "if" &&
        !isAtLineStart(maskedText, tokens[idx]!.start)
      ) {
        idx++;
        while (idx < endBoundIdx) {
          const ct = tokens[idx]!;
          if (ct.text === "(" || ct.text === "{" || ct.text === "[") {
            const closeOff = findBalancedClose(maskedText, ct.start, endBoundOffset);
            if (closeOff !== -1) {
              idx = advancePast(idx, closeOff);
              continue;
            }
          }
          if (
            ct.text === ";" ||
            ct.text === "," ||
            ct.kind === "string" ||
            (ct.kind === "word" && ct.text === "annotation") ||
            (isAtLineStart(maskedText, ct.start) && ct.kind === "word" && NON_COMPONENT_STARTERS.has(ct.text))
          ) {
            break;
          }
          idx++;
        }
      }
    };

    consumeIfCondition();

    // Optional description string `"..."` (possibly `"..." + "..."`)
    let descriptionStartOffset: number | null = null;
    let descriptionEndOffset: number | null = null;
    if (tokens[idx]?.kind === "string") {
      descriptionStartOffset = tokens[idx]!.start;
      descriptionEndOffset = tokens[idx]!.end;
      idx++;
      while (tokens[idx]?.text === "+" && tokens[idx + 1]?.kind === "string") {
        descriptionEndOffset = tokens[idx + 1]!.end;
        idx += 2;
      }
    }

    consumeIfCondition();

    // Optional `annotation(...)`
    let annotationKeywordOffset: number | null = null;
    let annotationOpenParenOffset: number | null = null;
    let annotationCloseParenOffset: number | null = null;
    if (tokens[idx]?.kind === "word" && tokens[idx]!.text === "annotation" && tokens[idx + 1]?.text === "(") {
      const aOpen = tokens[idx + 1]!.start;
      const aClose = findBalancedClose(maskedText, aOpen, endBoundOffset);
      if (aClose !== -1) {
        annotationKeywordOffset = tokens[idx]!.start;
        annotationOpenParenOffset = aOpen;
        annotationCloseParenOffset = aClose;
        idx = advancePast(idx + 1, aClose);
      }
    }

    const lastDeclElemEnd =
      annotationCloseParenOffset !== null
        ? annotationCloseParenOffset + 1
        : (descriptionEndOffset ?? modEndOffset ?? subscriptsEndOffset ?? identTok.end);

    rawDecls.push({
      name: identTok.text,
      typeName,
      clauseStartOffset,
      declStartOffset,
      declEndOffset: lastDeclElemEnd,
      identStartOffset: identTok.start,
      identEndOffset: identTok.end,
      subscriptsEndOffset,
      modOpenParenOffset,
      modCloseParenOffset,
      modEndOffset,
      descriptionStartOffset,
      descriptionEndOffset,
      annotationKeywordOffset,
      annotationOpenParenOffset,
      annotationCloseParenOffset,
      startLine: offsetToPosition(lineStarts, declStartOffset).line,
    });

    if (tokens[idx]?.text === ",") {
      idx++;
      continue;
    }
    break;
  }

  if (rawDecls.length === 0) return null;

  // Optional clause-level `constrainedby ...` before `;`
  if (tokens[idx]?.kind === "word" && tokens[idx]!.text === "constrainedby") {
    idx++;
    while (idx < endBoundIdx) {
      const ct = tokens[idx]!;
      if (ct.text === "(" || ct.text === "{" || ct.text === "[") {
        const closeOff = findBalancedClose(maskedText, ct.start, endBoundOffset);
        if (closeOff !== -1) {
          idx = advancePast(idx, closeOff);
          continue;
        }
      }
      if (ct.text === ";") break;
      if (isAtLineStart(maskedText, ct.start) && ct.kind === "word" && NON_COMPONENT_STARTERS.has(ct.text)) break;
      idx++;
    }
  }

  let hasSemicolon = false;
  let clauseEndOffset = rawDecls[rawDecls.length - 1]!.declEndOffset;
  if (tokens[idx]?.text === ";") {
    hasSemicolon = true;
    clauseEndOffset = tokens[idx]!.end;
    idx++;
  }

  const isSoleDeclarator = rawDecls.length === 1;
  const decls: ScannedComponentDecl[] = rawDecls.map((d, i) => {
    const endOff = i === rawDecls.length - 1 && isSoleDeclarator ? clauseEndOffset : d.declEndOffset;
    return {
      ...d,
      clauseEndOffset,
      hasSemicolon,
      isSoleDeclarator,
      endLine: offsetToPosition(lineStarts, endOff).line,
    };
  });

  return { decls, nextTokIdx: idx };
}

// ── Lightweight Annotation Parsers for Syntax-Error Fallback ──

function parseNumberPair(text: string): [number, number] | null {
  const m = text.match(/\{\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*,\s*(-?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)\s*\}/);
  if (!m) return null;
  return [Number(m[1]), Number(m[2])];
}

function parseExtentMatrix(text: string): [[number, number], [number, number]] | null {
  const m = text.match(
    /extent\s*=\s*\{\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}\s*,\s*\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}\s*\}/,
  );
  if (!m) return null;
  return [
    [Number(m[1]), Number(m[2])],
    [Number(m[3]), Number(m[4])],
  ];
}

function parseDiagramAnnotationFromSlice(annSlice: string): any | null {
  const masked = maskModelicaCommentsAndStrings(annSlice);
  const diagMatch = masked.match(/\bDiagram\s*\(/);
  if (!diagMatch || diagMatch.index === undefined) return null;
  const openParen = diagMatch.index + diagMatch[0].length - 1;
  const closeParen = findBalancedClose(masked, openParen);
  if (closeParen === -1) return null;
  const diagBody = annSlice.slice(openParen + 1, closeParen);

  const extent = parseExtentMatrix(diagBody) ?? [
    [-100, -100],
    [100, 100],
  ];
  const parMatch = diagBody.match(/preserveAspectRatio\s*=\s*(true|false)/);
  const scaleMatch = diagBody.match(/initialScale\s*=\s*(-?\d+(?:\.\d+)?)/);
  const gridMatch = diagBody.match(/grid\s*=\s*(\{[^}]+\})/);
  const grid = gridMatch ? parseNumberPair(gridMatch[1]!) : undefined;

  return {
    "@type": "Diagram",
    coordinateSystem: {
      "@type": "coordinateSystem",
      extent,
      ...(parMatch ? { preserveAspectRatio: parMatch[1] === "true" } : {}),
      ...(scaleMatch ? { initialScale: Number(scaleMatch[1]) } : {}),
      ...(grid ? { grid } : {}),
    },
  };
}

function parsePlacementAnnotationFromSlice(annSlice: string): any | null {
  const masked = maskModelicaCommentsAndStrings(annSlice);
  const plMatch = masked.match(/\bPlacement\s*\(/);
  if (!plMatch || plMatch.index === undefined) return null;
  const openParen = plMatch.index + plMatch[0].length - 1;
  const closeParen = findBalancedClose(masked, openParen);
  if (closeParen === -1) return null;
  const plBody = annSlice.slice(openParen + 1, closeParen);

  const extent = parseExtentMatrix(plBody);
  const originMatch = plBody.match(/origin\s*=\s*(\{[^}]+\})/);
  const origin = originMatch ? parseNumberPair(originMatch[1]!) : undefined;
  const rotMatch = plBody.match(/rotation\s*=\s*(-?\d+(?:\.\d+)?)/);

  return {
    "@type": "Placement",
    transformation: {
      "@type": "transformation",
      ...(origin ? { origin } : {}),
      ...(extent ? { extent } : {}),
      ...(rotMatch ? { rotation: Number(rotMatch[1]) } : {}),
    },
  };
}

function parseLineAnnotationFromSlice(annSlice: string): any | null {
  const masked = maskModelicaCommentsAndStrings(annSlice);
  const lnMatch = masked.match(/\bLine\s*\(/);
  if (!lnMatch || lnMatch.index === undefined) return null;
  const openParen = lnMatch.index + lnMatch[0].length - 1;
  const closeParen = findBalancedClose(masked, openParen);
  if (closeParen === -1) return null;
  const lnBody = annSlice.slice(openParen + 1, closeParen);
  const lnMasked = masked.slice(openParen + 1, closeParen);

  let points: [number, number][] | undefined;
  const ptsMatch = lnMasked.match(/\bpoints\s*=\s*\{/);
  if (ptsMatch && ptsMatch.index !== undefined) {
    const braceOpen = ptsMatch.index + ptsMatch[0].length - 1;
    const braceClose = findBalancedClose(lnMasked, braceOpen);
    if (braceClose !== -1) {
      const ptsInner = lnBody.slice(braceOpen + 1, braceClose);
      const pairs = [...ptsInner.matchAll(/\{\s*(-?\d+(?:\.\d+)?)\s*,\s*(-?\d+(?:\.\d+)?)\s*\}/g)];
      points = pairs.map((m) => [Number(m[1]), Number(m[2])]);
    }
  }

  let color: [number, number, number] | undefined;
  const colMatch = lnBody.match(/\bcolor\s*=\s*\{\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\}/);
  if (colMatch) {
    color = [Number(colMatch[1]), Number(colMatch[2]), Number(colMatch[3])];
  }

  return {
    "@type": "Line",
    ...(points ? { points } : {}),
    ...(color ? { color } : {}),
  };
}

/**
 * Synthesizes a `ModelicaClassInstance` directly from `ScannedClassLayout` so diagram-sourced
 * edits work reliably even when the document contains active syntax errors and semantic indexing
 * could not produce a full `classInstance`.
 */
export function buildFallbackClassInstance(docText: string, targetClassName?: string): ModelicaClassInstance | null {
  const layout = scanModelicaClassLayout(docText, targetClassName);
  if (!layout) return null;

  const toNodePos = (off: number) => {
    const p = offsetToPosition(layout.lineStarts, off);
    return { row: p.line, column: p.character };
  };

  const components = layout.components.map((comp) => {
    const annSlice =
      comp.annotationKeywordOffset !== null && comp.annotationCloseParenOffset !== null
        ? docText.slice(comp.annotationKeywordOffset, comp.annotationCloseParenOffset + 1)
        : null;
    const endOff = comp.isSoleDeclarator ? comp.clauseEndOffset : comp.declEndOffset;
    return {
      name: comp.name,
      typeName: comp.typeName,
      cstNode: {
        type: "component_declaration",
        startIndex: comp.declStartOffset,
        endIndex: endOff,
        startPosition: toNodePos(comp.declStartOffset),
        endPosition: toNodePos(endOff),
        text: docText.slice(comp.declStartOffset, endOff),
        parent: {
          type: "component_clause",
          startIndex: comp.clauseStartOffset,
          endIndex: comp.clauseEndOffset,
          startPosition: toNodePos(comp.clauseStartOffset),
          endPosition: toNodePos(comp.clauseEndOffset),
          text: docText.slice(comp.clauseStartOffset, comp.clauseEndOffset),
        },
      },
      annotation: (name: string) => {
        if (name === "Placement" && annSlice) {
          return parsePlacementAnnotationFromSlice(annSlice);
        }
        return null;
      },
    };
  });

  const connectEquations = layout.connects.map((conn) => {
    const annSlice =
      conn.annotationKeywordOffset !== null && conn.annotationCloseParenOffset !== null
        ? docText.slice(conn.annotationKeywordOffset, conn.annotationCloseParenOffset + 1)
        : null;
    return {
      lhs: conn.source,
      rhs: conn.target,
      cstNode: {
        type: "connect_equation",
        startIndex: conn.startOffset,
        endIndex: conn.statementEndOffset,
        startPosition: toNodePos(conn.startOffset),
        endPosition: toNodePos(conn.statementEndOffset),
        text: docText.slice(conn.startOffset, conn.statementEndOffset),
      },
      annotation: (name: string) => {
        if (name === "Line" && annSlice) {
          return parseLineAnnotationFromSlice(annSlice);
        }
        return null;
      },
    };
  });

  return {
    name: layout.className,
    components,
    extendsClassInstances: [],
    connectEquations,
    cstNode: {
      type: "class_definition",
      startIndex: layout.headerStartOffset,
      endIndex: layout.endStatementEndOffset,
      startPosition: toNodePos(layout.headerStartOffset),
      endPosition: toNodePos(layout.endStatementEndOffset),
      text: docText.slice(layout.headerStartOffset, layout.endStatementEndOffset),
    },
    annotation: (name: string) => {
      if (name === "Diagram") {
        for (let i = layout.classAnnotations.length - 1; i >= 0; i--) {
          const ca = layout.classAnnotations[i]!;
          const slice = docText.slice(ca.keywordOffset, ca.closeParenOffset + 1);
          const parsed = parseDiagramAnnotationFromSlice(slice);
          if (parsed) return parsed;
        }
      }
      return null;
    },
  } as unknown as ModelicaClassInstance;
}

/**
 * Relocates any stranded standalone class-level `annotation(...);` clauses (e.g., `annotation(Icon(...), Diagram(...));`
 * placed above component declarations or `equation` sections) to the canonical Modelica position right before
 * `end <ClassName>;`.
 */
export function healStrandedClassAnnotationsInText(docText: string, targetClassName?: string): string {
  const layout = scanModelicaClassLayout(docText, targetClassName);
  if (!layout) return docText;

  const stranded = layout.classAnnotations.filter((ca) => ca.isStrandedBeforeBodyElements);
  if (stranded.length === 0) return docText;
  // Only relocate if `end <ClassName>` actually exists in text
  if (layout.endKeywordOffset >= docText.length) return docText;

  const lines = docText.split("\n");
  const endPos = offsetToPosition(layout.lineStarts, layout.endKeywordOffset);

  const extractedBlocks: string[] = [];
  // Process from bottom to top when removing
  const toRemoveRanges: { startLine: number; endLineExclusive: number }[] = [];

  for (const ca of stranded) {
    const sPos = offsetToPosition(layout.lineStarts, ca.keywordOffset);
    const ePos = offsetToPosition(layout.lineStarts, ca.statementEndOffset);
    const beforeOnStartLine = (lines[sPos.line] ?? "").slice(0, sPos.character).trim();
    const afterOnEndLine = (lines[ePos.line] ?? "").slice(ePos.character).trim();

    // Only auto-relocate clean whole-line class annotations so inline user code/comments on shared lines are never disturbed
    if (beforeOnStartLine !== "" || (afterOnEndLine !== "" && !afterOnEndLine.startsWith("//"))) {
      continue;
    }
    const rawBlockLines = lines.slice(sPos.line, ePos.line + 1);
    let blockText = rawBlockLines.join("\n");
    if (!blockText.trimEnd().endsWith(";")) {
      blockText = blockText.trimEnd() + ";";
    }
    extractedBlocks.push(blockText);
    toRemoveRanges.push({ startLine: sPos.line, endLineExclusive: ePos.line + 1 });
  }

  if (extractedBlocks.length === 0) return docText;

  // Insert right before `end <ClassName>;` line (or before any existing valid bottom class annotation? Put before `end` line!)
  let insertLine = endPos.line;
  const beforeEndOnLine = (lines[endPos.line] ?? "").slice(0, endPos.character).trim();
  if (beforeEndOnLine !== "") {
    return docText;
  }

  // Remove bottom-up, adjusting `insertLine`
  const workingLines = [...lines];
  for (let i = toRemoveRanges.length - 1; i >= 0; i--) {
    const r = toRemoveRanges[i]!;
    const count = r.endLineExclusive - r.startLine;
    workingLines.splice(r.startLine, count);
    if (r.startLine < insertLine) {
      insertLine -= count;
    }
  }

  const toInsertLines = extractedBlocks.join("\n").split("\n");
  workingLines.splice(insertLine, 0, ...toInsertLines);
  return workingLines.join("\n");
}

/**
 * Computes clean, non-overlapping `TextEdit[]` transforming `oldText` into `newText` using
 * Myers/LCS line hunk diffing so multi-action sequential batches never produce overlapping
 * edits, dropped insertions, or duplicated section headers.
 */
export function computeMinimalNonOverlappingEdits(oldText: string, newText: string): TextEdit[] {
  if (oldText === newText) return [];

  const oldLines = oldText.split("\n");
  const newLines = newText.split("\n");

  // Trim identical prefix & suffix lines first (fast path for 99% of edits)
  let prefix = 0;
  const minLen = Math.min(oldLines.length, newLines.length);
  while (prefix < minLen && oldLines[prefix] === newLines[prefix]) {
    prefix++;
  }

  let oldSuffix = oldLines.length;
  let newSuffix = newLines.length;
  while (oldSuffix > prefix && newSuffix > prefix && oldLines[oldSuffix - 1] === newLines[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }

  const midOldCount = oldSuffix - prefix;
  const midNewCount = newSuffix - prefix;

  // For small/medium changed windows, run exact LCS over the window to split independent hunks
  // (e.g. adding a component near top of class AND adding `connect(...)` in `equation` at bottom of class!)
  if (midOldCount > 0 && midNewCount > 0 && midOldCount * midNewCount <= 40000) {
    const dp = new Int32Array((midOldCount + 1) * (midNewCount + 1));
    const stride = midNewCount + 1;
    for (let i = midOldCount - 1; i >= 0; i--) {
      const oLine = oldLines[prefix + i]!;
      for (let j = midNewCount - 1; j >= 0; j--) {
        if (oLine === newLines[prefix + j]) {
          dp[i * stride + j] = dp[(i + 1) * stride + (j + 1)]! + 1;
        } else {
          const down = dp[(i + 1) * stride + j]!;
          const right = dp[i * stride + (j + 1)]!;
          dp[i * stride + j] = down >= right ? down : right;
        }
      }
    }

    const anchors: { oldIdx: number; newIdx: number }[] = [];
    let i = 0;
    let j = 0;
    while (i < midOldCount && j < midNewCount) {
      if (oldLines[prefix + i] === newLines[prefix + j]) {
        anchors.push({ oldIdx: prefix + i, newIdx: prefix + j });
        i++;
        j++;
      } else if (dp[(i + 1) * stride + j]! >= dp[i * stride + (j + 1)]!) {
        i++;
      } else {
        j++;
      }
    }
    anchors.push({ oldIdx: oldSuffix, newIdx: newSuffix });

    const edits: TextEdit[] = [];
    let curOld = prefix;
    let curNew = prefix;
    for (const anchor of anchors) {
      if (curOld < anchor.oldIdx || curNew < anchor.newIdx) {
        edits.push(buildLineSpanEdit(oldLines, newLines, curOld, anchor.oldIdx, curNew, anchor.newIdx));
      }
      curOld = anchor.oldIdx + 1;
      curNew = anchor.newIdx + 1;
    }
    return edits;
  }

  return [buildLineSpanEdit(oldLines, newLines, prefix, oldSuffix, prefix, newSuffix)];
}

function buildLineSpanEdit(
  oldLines: string[],
  newLines: string[],
  oldStart: number,
  oldEnd: number,
  newStart: number,
  newEnd: number,
): TextEdit {
  const replacementLines = newLines.slice(newStart, newEnd);

  // Pure insertion before `oldStart`
  if (oldStart === oldEnd) {
    if (oldStart < oldLines.length) {
      return TextEdit.insert(Position.create(oldStart, 0), replacementLines.join("\n") + "\n");
    }
    const lastLine = Math.max(0, oldLines.length - 1);
    const lastCol = oldLines[lastLine]?.length ?? 0;
    return TextEdit.insert(Position.create(lastLine, lastCol), "\n" + replacementLines.join("\n"));
  }

  // Pure deletion of `[oldStart, oldEnd)`
  if (newStart === newEnd) {
    if (oldEnd < oldLines.length) {
      return TextEdit.del(Range.create(oldStart, 0, oldEnd, 0));
    }
    if (oldStart > 0) {
      const prevLine = oldStart - 1;
      const prevCol = oldLines[prevLine]?.length ?? 0;
      const lastCol = oldLines[oldEnd - 1]?.length ?? 0;
      return TextEdit.del(Range.create(prevLine, prevCol, oldEnd - 1, lastCol));
    }
    const lastCol = oldLines[oldEnd - 1]?.length ?? 0;
    return TextEdit.del(Range.create(0, 0, oldEnd - 1, lastCol));
  }

  // Replacement of `[oldStart, oldEnd)` with `replacementLines`
  if (oldEnd < oldLines.length) {
    return TextEdit.replace(Range.create(oldStart, 0, oldEnd, 0), replacementLines.join("\n") + "\n");
  }
  const endCol = oldLines[oldEnd - 1]?.length ?? 0;
  return TextEdit.replace(Range.create(oldStart, 0, oldEnd - 1, endCol), replacementLines.join("\n"));
}
