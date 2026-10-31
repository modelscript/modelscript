// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/reqif — Lossless WebAssembly XML ReqIF Parser & Serializer.
 *
 * Parses standard OMG ReqIF 1.2 / 1.1 / 1.0 (ISO/IEC 17506) XML files into
 * typed ReqIfDocument structures using @modelscript/dsl/xml.
 *
 * Preserves 1-indexed source line/column positions, XHTML bodies,
 * typed attribute values, and hierarchical specification structures with ZERO regex.
 */

import { parseXml, type XmlAttribute, type XmlElement } from "@modelscript/dsl/xml";
import { defaultContainerToolkit } from "@modelscript/runtime";
import type {
  AsilLevel,
  ContractComparator,
  ReqIfAttributeDefinition,
  ReqIfAttributeValue,
  ReqIfContract,
  ReqIfDataType,
  ReqIfDataTypeKind,
  ReqIfDocument,
  ReqIfEnumValue,
  ReqIfHeader,
  ReqIfRelationKind,
  ReqIfSpecHierarchy,
  ReqIfSpecification,
  ReqIfSpecObject,
  ReqIfSpecRelation,
  ReqIfSpecType,
  ReqIfSpecTypeKind,
  SourceSpan,
} from "../types.js";

function localName(tag: string): string {
  const idx = tag.indexOf(":");
  return idx >= 0 ? tag.slice(idx + 1) : tag;
}

function matchTag(element: XmlElement, expected: string): boolean {
  return localName(element.name).toUpperCase() === expected.toUpperCase();
}

function getAttr(element: XmlElement, name: string): string | undefined {
  const target = name.toUpperCase();
  const attr = element.attributes.find((a: XmlAttribute) => localName(a.name).toUpperCase() === target);
  return attr?.value;
}

function getChild(element: XmlElement | null | undefined, expectedName: string): XmlElement | undefined {
  if (!element) return undefined;
  return element.children.find((c: XmlElement) => matchTag(c, expectedName));
}

function getChildRefText(
  parent: XmlElement | null | undefined,
  wrapperTag: string,
  refTag: string,
): string | undefined {
  const wrapper = getChild(parent, wrapperTag);
  if (!wrapper) return undefined;
  const ref = getChild(wrapper, refTag);
  return ref ? ref.text.trim() : undefined;
}

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPosition(offset: number, lineStarts: number[]): { line: number; col: number } {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >> 1;
    if ((lineStarts[mid] ?? 0) <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const lineIdx = low - 1;
  const line = lineIdx + 1;
  const col = offset - (lineStarts[lineIdx] ?? 0) + 1;
  return { line, col };
}

function createSpan(startOffset: number, endOffset: number, lineStarts: number[]): SourceSpan {
  const start = offsetToPosition(startOffset, lineStarts);
  const end = offsetToPosition(endOffset, lineStarts);
  return {
    startLine: start.line,
    startCol: start.col,
    endLine: end.line,
    endCol: end.col,
    startOffset,
    endOffset,
  };
}

interface ParsedAtomicClause {
  variable: string;
  lhsExpr: string;
  comparator: ContractComparator;
  limitValue: number;
  unit?: string | undefined;
  formulaText: string;
}

/**
 * Normalize natural-language relational phrases (e.g. "shall not exceed", "is at least", "exceeds")
 * into symbolic comparators (`<=`, `>=`, `<`, `>`, `==`).
 */
function normalizeVerbalComparators(clause: string): string {
  return clause
    .replace(/\b(?:shall|must|should|may|can|will)\s+not\s+exceed\b/gi, " <= ")
    .replace(/\b(?:does|do)\s+not\s+exceed\b/gi, " <= ")
    .replace(
      /\b(?:is|are|be|remain|stay|maintained)\s+(?:less\s+than\s+or\s+equal\s+to|at\s+most|no\s+more\s+than|below\s+or\s+equal\s+to)\b/gi,
      " <= ",
    )
    .replace(
      /\b(?:is|are|be|remain|stay|maintained)\s+(?:greater\s+than\s+or\s+equal\s+to|at\s+least|no\s+less\s+than|above\s+or\s+equal\s+to)\b/gi,
      " >= ",
    )
    .replace(/\b(?:is|are|be|remain|stay)\s+(?:less\s+than|below|under)\b/gi, " < ")
    .replace(/\b(?:is|are|be|remain|stay)\s+(?:greater\s+than|above|over)\b/gi, " > ")
    .replace(/\b(?:drops\s+below|falls\s+below)\b/gi, " < ")
    .replace(/\b(?:exceeds|exceed)\b/gi, " > ")
    .replace(/\b(?:is\s+equal\s+to|equals)\b/gi, " == ");
}

const PROSE_STOP_WORDS =
  /\b(?:while|when|where|if|then|the|a|an|system|subsystem|vehicle|controller|powertrain|inverter|motor|battery|module|unit|must\s+be|shall\s+be|should\s+be|may\s+reach|can\s+be|is\s+less\s+than\s+or\s+equal\s+to|shall|must|should|may|can|will|maintain|maintains|ensure|ensures|set|sets|limit|limits|keep|keeps|deliver|delivers|provide|provides|achieve|achieves|have|has|is|are|be|to|reach|of|under|at|in|during|normal|operation)\b/gi;

/**
 * Parse a single atomic comparison (or linear-arithmetic comparison) from a clause fragment.
 */
function parseAtomicComparison(fragment: string): ParsedAtomicClause | undefined {
  const verbNormalized = normalizeVerbalComparators(fragment);
  const compMatch =
    /^(.*?)\s*(<=|<|>=|>|==|!=)\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z%][a-zA-Z0-9_*/%^.-]*)?/i.exec(
      verbNormalized,
    );
  if (!compMatch) return undefined;

  const rawLhs = (compMatch[1] ?? "").trim();
  const comp = (compMatch[2] ?? "==") as ContractComparator;
  const num = parseFloat(compMatch[3] ?? "");
  if (Number.isNaN(num)) return undefined;

  // Avoid treating logical connectives like `and`, `or`, `within` as units
  let rawUnit = compMatch[4]?.trim();
  if (rawUnit && /^(?:and|or|implies|within|when|while|then|if|asil)\b/i.test(rawUnit)) {
    rawUnit = undefined;
  }

  // Check if rawLhs is a multi-term linear arithmetic expression (e.g. `2*x + y` or `motor_power + aux_power`)
  if (/[+\-*/]/.test(rawLhs)) {
    const cleanedArith = rawLhs.replace(PROSE_STOP_WORDS, " ").replace(/\s+/g, " ").trim();
    const idTokens = cleanedArith.match(/[a-zA-Z_][a-zA-Z0-9_.]*/g) ?? [];
    const primaryVar = idTokens[0] ?? cleanedArith;
    if (!primaryVar) return undefined;
    return {
      variable: primaryVar,
      lhsExpr: cleanedArith,
      comparator: comp,
      limitValue: num,
      unit: rawUnit || undefined,
      formulaText: `${cleanedArith} ${comp} ${num}`,
    };
  }

  const cleanedPrefix = rawLhs.replace(PROSE_STOP_WORDS, " ").trim();
  const tokens = cleanedPrefix.split(/\s+/).filter(Boolean);
  const varName = tokens[tokens.length - 1]?.replace(/[^a-zA-Z0-9_.]/g, "");
  if (!varName || !/^[a-zA-Z_]/.test(varName)) return undefined;

  return {
    variable: varName,
    lhsExpr: varName,
    comparator: comp,
    limitValue: num,
    unit: rawUnit || undefined,
    formulaText: `${varName} ${comp} ${num}`,
  };
}

/**
 * Parse a clause that may contain multiple conjunctions (`and`, `&&`, `, and`) or disjunctions (`or`, `||`)
 * into a list of parsed atoms and a combined boolean formula string.
 */
function parseMultiAtomClause(clauseText: string):
  | {
      atoms: ParsedAtomicClause[];
      formula: string;
    }
  | undefined {
  const parts: { text: string; opBefore?: "&&" | "||" | undefined }[] = [];
  const splitRegex = /\s*(?:&&|\band\b|;|\|\||\bor\b)\s*/gi;
  let lastIdx = 0;
  let prevOp: "&&" | "||" | undefined;
  let m: RegExpExecArray | null;

  while ((m = splitRegex.exec(clauseText)) !== null) {
    const seg = clauseText.slice(lastIdx, m.index).trim();
    if (seg) {
      parts.push({ text: seg, opBefore: prevOp });
    }
    const rawConn = m[0].trim().toLowerCase();
    prevOp = rawConn === "||" || rawConn === "or" ? "||" : "&&";
    lastIdx = m.index + m[0].length;
  }
  const tail = clauseText.slice(lastIdx).trim();
  if (tail) {
    parts.push({ text: tail, opBefore: prevOp });
  }

  const atoms: ParsedAtomicClause[] = [];
  let formula = "";
  for (const part of parts) {
    const atom = parseAtomicComparison(part.text);
    if (!atom) continue;
    if (atoms.length > 0) {
      formula += ` ${part.opBefore ?? "&&"} ${atom.formulaText}`;
    } else {
      formula = atom.formulaText;
    }
    atoms.push(atom);
  }

  if (atoms.length === 0) return undefined;
  return { atoms, formula };
}

/**
 * Attempt to parse structured EARS (Easy Approach to Requirements Syntax) templates
 * and conditional `If <cond> then <response>` requirements:
 * - `While <precondition>, when <trigger>, the <system> shall <response> [within <duration>]`
 * - `While <precondition>, the <system> shall <response> [within <duration>]`
 * - `When <trigger>, the <system> shall <response> [within <duration>]`
 * - `If <condition>, then [the <system> shall] <response> [within <duration>]`
 * - `The <system> shall <response> within <duration>`
 */
function parseStructuredEarsOrCompoundContract(normalized: string): ReqIfContract | undefined {
  // Strip trailing ASIL tag or period
  let body = normalized
    .replace(/\bASIL[- ]?[ABCD]\b\.?/gi, "")
    .replace(/\bQM\b\.?/gi, "")
    .trim();
  body = body.replace(/\.$/, "").trim();

  // Extract optional trailing `within <duration>` timing bound
  let durationAtom: ParsedAtomicClause | undefined;
  const withinMatch =
    /\bwithin\s+(?:([a-zA-Z_][a-zA-Z0-9_]*)\s*(?:<=|<)\s*)?([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z%][a-zA-Z0-9_/%^]*)?\s*$/i.exec(
      body,
    );
  if (withinMatch) {
    const durVar = withinMatch[1] || "response_time";
    const durVal = parseFloat(withinMatch[2] ?? "");
    const durUnit = withinMatch[3]?.trim();
    if (!Number.isNaN(durVal)) {
      durationAtom = {
        variable: durVar,
        lhsExpr: durVar,
        comparator: "<=",
        limitValue: durVal,
        unit: durUnit || undefined,
        formulaText: `${durVar} <= ${durVal}`,
      };
      body = body.slice(0, withinMatch.index).trim().replace(/,$/, "").trim();
    }
  }

  // 1. Complex EARS: While <pre>, when <trig>, [the <sys>] shall <resp>
  const complexEarsMatch = /^while\s+(.+?),\s*when\s+(.+?),\s*(?:the\s+.+?\s+)?(?:shall|must|should)\s+(.+)$/i.exec(
    body,
  );
  if (complexEarsMatch) {
    const preMatch = complexEarsMatch[1];
    const trigMatch = complexEarsMatch[2];
    const respMatch = complexEarsMatch[3];
    if (preMatch && trigMatch && respMatch) {
      const pre = parseMultiAtomClause(preMatch);
      const trig = parseMultiAtomClause(trigMatch);
      const resp = parseMultiAtomClause(respMatch);
      if (resp && resp.atoms.length > 0) {
        const totalAntecedentAtoms = (pre?.atoms.length ?? 0) + (trig?.atoms.length ?? 0);
        const antecedentParts = [pre?.formula, trig?.formula].filter(Boolean);
        const totalConsequentAtoms = resp.atoms.length + (durationAtom ? 1 : 0);
        const consequentParts = [resp.formula, durationAtom?.formulaText].filter(Boolean);
        const antecedent = totalAntecedentAtoms > 1 ? `(${antecedentParts.join(" && ")})` : antecedentParts[0];
        const consequent =
          totalConsequentAtoms > 1 ? `(${consequentParts.join(" && ")})` : (consequentParts[0] ?? resp.formula);
        const primary = resp.atoms[0];
        if (primary) {
          return {
            variable: primary.variable,
            comparator: primary.comparator,
            limitValue: primary.limitValue,
            unit: primary.unit,
            expression: antecedent ? `${antecedent} => ${consequent}` : consequent,
          };
        }
      }
    }
  }

  // 2. State-driven or Event-driven EARS: (While|When|Where) <cond>, [the <sys>] shall <resp>
  const singleGuardEarsMatch = /^(?:while|when|where)\s+(.+?),\s*(?:the\s+.+?\s+)?(?:shall|must|should)\s+(.+)$/i.exec(
    body,
  );
  if (singleGuardEarsMatch) {
    const gMatch = singleGuardEarsMatch[1];
    const rMatch = singleGuardEarsMatch[2];
    if (gMatch && rMatch) {
      const guard = parseMultiAtomClause(gMatch);
      const resp = parseMultiAtomClause(rMatch);
      if (guard && resp && resp.atoms.length > 0) {
        const antecedent = guard.atoms.length > 1 ? `(${guard.formula})` : guard.formula;
        const totalConsequentAtoms = resp.atoms.length + (durationAtom ? 1 : 0);
        const consequentParts = [resp.formula, durationAtom?.formulaText].filter(Boolean);
        const consequent =
          totalConsequentAtoms > 1 ? `(${consequentParts.join(" && ")})` : (consequentParts[0] ?? resp.formula);
        const primary = resp.atoms[0];
        if (primary) {
          return {
            variable: primary.variable,
            comparator: primary.comparator,
            limitValue: primary.limitValue,
            unit: primary.unit,
            expression: `${antecedent} => ${consequent}`,
          };
        }
      }
    }
  }

  // 3. Conditional / Unwanted Behavior: If <cond>, then <resp> (or If <cond> then <resp>)
  const ifThenMatch = /^if\s+(.+?)(?:,\s*then|\s+then|,\s*(?:the\s+.+?\s+)?(?:shall|must|should))\s+(.+)$/i.exec(body);
  if (ifThenMatch) {
    const condMatch = ifThenMatch[1];
    const respMatch = ifThenMatch[2];
    if (condMatch && respMatch) {
      const cond = parseMultiAtomClause(condMatch);
      const resp = parseMultiAtomClause(respMatch);
      if (cond && resp && resp.atoms.length > 0) {
        const antecedent = cond.atoms.length > 1 ? `(${cond.formula})` : cond.formula;
        const totalConsequentAtoms = resp.atoms.length + (durationAtom ? 1 : 0);
        const consequentParts = [resp.formula, durationAtom?.formulaText].filter(Boolean);
        const consequent =
          totalConsequentAtoms > 1 ? `(${consequentParts.join(" && ")})` : (consequentParts[0] ?? resp.formula);
        const primary = resp.atoms[0];
        if (primary) {
          return {
            variable: primary.variable,
            comparator: primary.comparator,
            limitValue: primary.limitValue,
            unit: primary.unit,
            expression: `${antecedent} => ${consequent}`,
          };
        }
      }
    }
  }

  // If the expression already uses symbolic negation `!(...)` or parenthesized boolean groups, let symbolic parser handle it
  if (/(?:!\s*\(|\)\s*\|\||\)\s*&&)/.test(body)) {
    return undefined;
  }

  // 4. Symbolic implication `A => B` or `A -> B` or `A implies B`
  const symImpliesMatch = /^(.+?)\s*(?:=>|->|\bimplies\b)\s*(.+)$/i.exec(body);
  if (symImpliesMatch) {
    const lMatch = symImpliesMatch[1];
    const rMatch = symImpliesMatch[2];
    if (lMatch && rMatch) {
      const left = parseMultiAtomClause(lMatch);
      const right = parseMultiAtomClause(rMatch);
      if (left && right && right.atoms.length > 0) {
        const antecedent = left.atoms.length > 1 ? `(${left.formula})` : left.formula;
        const totalConsequentAtoms = right.atoms.length + (durationAtom ? 1 : 0);
        const consequentParts = [right.formula, durationAtom?.formulaText].filter(Boolean);
        const consequent =
          totalConsequentAtoms > 1 ? `(${consequentParts.join(" && ")})` : (consequentParts[0] ?? right.formula);
        const primary = right.atoms[0];
        if (primary) {
          return {
            variable: primary.variable,
            comparator: primary.comparator,
            limitValue: primary.limitValue,
            unit: primary.unit,
            expression: `${antecedent} => ${consequent}`,
          };
        }
      }
    }
  }

  // 5. Multi-clause conjunction/disjunction or Ubiquitous EARS with `within <duration>`
  const multi = parseMultiAtomClause(body);
  if (multi && (multi.atoms.length > 1 || durationAtom)) {
    const primary = multi.atoms[0];
    if (primary) {
      const formulaParts = [multi.formula, durationAtom?.formulaText].filter(Boolean);
      return {
        variable: primary.variable,
        comparator: primary.comparator,
        limitValue: primary.limitValue,
        unit: primary.unit,
        expression: formulaParts.length > 1 ? `(${formulaParts.join(" && ")})` : multi.formula,
      };
    }
  }

  return undefined;
}

/**
 * Extracts formal numeric or compound EARS contract bounds from requirement text or attributes.
 * Examples:
 * - "Speed must be <= 120 km/h"
 * - "@contract: 2*x + y <= 100 && x >= 10"
 * - "While battery_soc >= 20 %, when throttle >= 80 %, the powertrain shall maintain torque >= 240 N*m within 50 ms"
 * - "If speed >= 100 km/h and fault == 0, then brake_force >= 5000 N"
 */
export function extractFormalContract(text: string): ReqIfContract | undefined {
  if (!text) return undefined;
  const normalized = text
    .replace(/<\/?[a-zA-Z][^<>]*>/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .trim();

  const explicitMatch = /(?:@contract\s*:|\[\s*contract\s*:)\s*([^\]]+?)(?:\]|$)/i.exec(normalized);
  const explicitExpr = explicitMatch?.[1]?.trim().replace(/\.$/, "").trim();

  if (!explicitExpr) {
    const earsOrCompound = parseStructuredEarsOrCompoundContract(normalized);
    if (earsOrCompound) {
      return earsOrCompound;
    }
  }

  const targetText = normalizeVerbalComparators(explicitExpr ?? normalized);
  const pattern =
    /([a-zA-Z_][a-zA-Z0-9_.\s]*?)\s*(<=|<|>=|>|==|!=)\s*([-+]?[0-9]*\.?[0-9]+(?:[eE][-+]?[0-9]+)?)\s*([a-zA-Z%][a-zA-Z0-9_*/%^]*)?/i;
  const match = pattern.exec(targetText);
  if (!match) return undefined;

  let rawPrefix = (match[1] ?? "").trim();
  rawPrefix = rawPrefix.replace(PROSE_STOP_WORDS, " ").trim();
  const tokens = rawPrefix.split(/\s+/).filter(Boolean);
  const varName = tokens[tokens.length - 1];
  if (!varName) return undefined;

  const comp = (match[2] ?? "==") as ContractComparator;
  const num = parseFloat(match[3] ?? "");
  let unit = match[4]?.trim();
  if (unit && /^(?:and|or|implies|within|when|while|then|if|asil|at|under|in)\b/i.test(unit)) {
    unit = undefined;
  }

  if (isNaN(num)) return undefined;

  return {
    variable: varName,
    comparator: comp,
    limitValue: num,
    unit: unit || undefined,
    expression:
      explicitExpr ??
      (/(?:&&|\|\||=>|->|\bimplies\b|\band\b|\bor\b|[+\-*/])/.test(normalized)
        ? normalized
        : `${varName} ${comp} ${num}`),
  };
}

/**
 * Extracts ASIL level from requirement text or attributes.
 */
export function extractAsilLevel(text: string): AsilLevel | undefined {
  if (/\bASIL[- ]?D\b/i.test(text)) return "ASIL-D";
  if (/\bASIL[- ]?C\b/i.test(text)) return "ASIL-C";
  if (/\bASIL[- ]?B\b/i.test(text)) return "ASIL-B";
  if (/\bASIL[- ]?A\b/i.test(text)) return "ASIL-A";
  if (/\bQM\b/i.test(text)) return "QM";
  return undefined;
}

/**
 * Parses a ReqIF XML document into a strongly-typed ReqIfDocument.
 */
export function parseReqIf(xmlContent: string): ReqIfDocument {
  const doc = parseXml(xmlContent);
  if (!doc.root) {
    throw new Error("ReqIF XML document has no root element");
  }

  const root = doc.root;
  if (!matchTag(root, "REQ-IF")) {
    throw new Error(`Expected <REQ-IF> root element, found <${root.name}>`);
  }

  const lineStarts = computeLineStarts(xmlContent);

  // 1. Header
  let headerEl = getChild(root, "THE-HEADER") || getChild(root, "REQ-IF-HEADER");
  if (headerEl && getChild(headerEl, "REQ-IF-HEADER")) {
    headerEl = getChild(headerEl, "REQ-IF-HEADER");
  }

  const header: ReqIfHeader = {
    identifier:
      (headerEl && (getAttr(headerEl, "IDENTIFIER") || getChild(headerEl, "IDENTIFIER")?.text.trim())) ||
      "REQIF-HEADER-01",
    reqIfVersion:
      (headerEl && (getAttr(headerEl, "REQ-IF-VERSION") || getChild(headerEl, "REQ-IF-VERSION")?.text.trim())) || "1.0",
    title:
      (headerEl &&
        (getChild(headerEl, "TITLE")?.text.trim() || getAttr(headerEl, "TITLE") || getAttr(headerEl, "LONG-NAME"))) ||
      "Imported Requirements Specification",
    creationTime: headerEl
      ? getChild(headerEl, "CREATION-TIME")?.text.trim() || getAttr(headerEl, "CREATION-TIME")
      : undefined,
    repositoryId: headerEl
      ? getChild(headerEl, "REPOSITORY-ID")?.text.trim() || getAttr(headerEl, "REPOSITORY-ID")
      : undefined,
    reqIfToolId: headerEl
      ? getChild(headerEl, "REQ-IF-TOOL-ID")?.text.trim() || getAttr(headerEl, "REQ-IF-TOOL-ID")
      : undefined,
    sourceToolId: headerEl
      ? getChild(headerEl, "SOURCE-TOOL-ID")?.text.trim() || getAttr(headerEl, "SOURCE-TOOL-ID")
      : undefined,
    comment: headerEl ? getChild(headerEl, "COMMENT")?.text.trim() || getAttr(headerEl, "COMMENT") : undefined,
  };

  let coreContent = getChild(root, "CORE-CONTENT") || root;
  const nestedReqIfContent = coreContent ? getChild(coreContent, "REQ-IF-CONTENT") : undefined;
  if (nestedReqIfContent) {
    coreContent = nestedReqIfContent;
  }

  const seenIdentifiers = new Set<string>();
  const duplicateIdentifiers: Array<{ id: string; span?: SourceSpan | undefined }> = [];

  function recordIdentifier(id: string, el: XmlElement): void {
    if (seenIdentifiers.has(id)) {
      duplicateIdentifiers.push({ id, span: createSpan(el.start, el.end, lineStarts) });
    } else {
      seenIdentifiers.add(id);
    }
  }

  // 2. Data Types
  const dataTypes = new Map<string, ReqIfDataType>();
  const dataTypesContainer = getChild(coreContent, "DATATYPES") || getChild(coreContent, "DATATYPE-DEFINITIONS");
  if (dataTypesContainer) {
    for (const dtEl of dataTypesContainer.children) {
      const rawTag = localName(dtEl.name).toUpperCase();
      let kind: ReqIfDataTypeKind = "STRING";
      if (rawTag.includes("INTEGER")) kind = "INTEGER";
      else if (rawTag.includes("REAL")) kind = "REAL";
      else if (rawTag.includes("BOOLEAN")) kind = "BOOLEAN";
      else if (rawTag.includes("ENUM")) kind = "ENUMERATION";
      else if (rawTag.includes("XHTML")) kind = "XHTML";
      else if (rawTag.includes("DATE")) kind = "DATE";

      const id = getAttr(dtEl, "IDENTIFIER") || `DT-${dataTypes.size + 1}`;
      const longName = getAttr(dtEl, "LONG-NAME");
      const minStr = getAttr(dtEl, "MIN") ?? getChild(dtEl, "MIN")?.text.trim();
      const maxStr = getAttr(dtEl, "MAX") ?? getChild(dtEl, "MAX")?.text.trim();
      const min = minStr !== undefined && minStr !== "" && !isNaN(Number(minStr)) ? Number(minStr) : undefined;
      const max = maxStr !== undefined && maxStr !== "" && !isNaN(Number(maxStr)) ? Number(maxStr) : undefined;

      const enumValues: ReqIfEnumValue[] = [];
      const specifiedValues = getChild(dtEl, "SPECIFIED-VALUES");
      if (specifiedValues) {
        for (const enumEl of specifiedValues.children) {
          const enumId = getAttr(enumEl, "IDENTIFIER") || `ENUM-${enumValues.length + 1}`;
          const enumName = getAttr(enumEl, "LONG-NAME") || enumId;
          const keyStr = getAttr(enumEl, "KEY");
          enumValues.push({
            identifier: enumId,
            longName: enumName,
            key: keyStr ? parseInt(keyStr, 10) : undefined,
          });
        }
      }

      dataTypes.set(id, {
        identifier: id,
        longName,
        kind,
        enumValues: enumValues.length > 0 ? enumValues : undefined,
        min,
        max,
      });
    }
  }

  // 3. Spec Types
  const specTypes = new Map<string, ReqIfSpecType>();
  const specTypesContainer = getChild(coreContent, "SPEC-TYPES");
  if (specTypesContainer) {
    for (const stEl of specTypesContainer.children) {
      const rawTag = localName(stEl.name).toUpperCase();
      let kind: ReqIfSpecTypeKind = "SPEC-OBJECT-TYPE";
      if (rawTag.includes("SPECIFICATION-TYPE")) kind = "SPECIFICATION-TYPE";
      else if (rawTag.includes("SPEC-RELATION-TYPE")) kind = "SPEC-RELATION-TYPE";
      else if (rawTag.includes("RELATION-GROUP-TYPE")) kind = "RELATION-GROUP-TYPE";

      const id = getAttr(stEl, "IDENTIFIER") || `ST-${specTypes.size + 1}`;
      recordIdentifier(id, stEl);
      const longName = getAttr(stEl, "LONG-NAME");

      const attributeDefinitions = new Map<string, ReqIfAttributeDefinition>();
      const specAttributes = getChild(stEl, "SPEC-ATTRIBUTES");
      if (specAttributes) {
        for (const attrDefEl of specAttributes.children) {
          const attrId = getAttr(attrDefEl, "IDENTIFIER") || `AD-${attributeDefinitions.size + 1}`;
          const attrName = getAttr(attrDefEl, "LONG-NAME") || attrId;
          const isMandatory = getAttr(attrDefEl, "IS-MANDATORY") === "true";

          const attrTag = localName(attrDefEl.name).toUpperCase();
          let attrKind: ReqIfDataTypeKind = "STRING";
          if (attrTag.includes("INTEGER")) attrKind = "INTEGER";
          else if (attrTag.includes("REAL")) attrKind = "REAL";
          else if (attrTag.includes("BOOLEAN")) attrKind = "BOOLEAN";
          else if (attrTag.includes("ENUM")) attrKind = "ENUMERATION";
          else if (attrTag.includes("XHTML")) attrKind = "XHTML";
          else if (attrTag.includes("DATE")) attrKind = "DATE";

          let typeRef = "";
          const typeWrapper = getChild(attrDefEl, "TYPE");
          const firstTypeChild = typeWrapper?.children[0];
          if (firstTypeChild) {
            typeRef = firstTypeChild.text.trim();
          }

          let defaultValue: string | number | boolean | undefined;
          const defValEl = getChild(attrDefEl, "DEFAULT-VALUE");
          if (defValEl) {
            const valChild = defValEl.children[0];
            if (valChild) {
              const theVal = getAttr(valChild, "THE-VALUE") || getChild(valChild, "THE-VALUE")?.text.trim();
              if (theVal !== undefined) {
                if (attrKind === "REAL" || attrKind === "INTEGER") defaultValue = parseFloat(theVal);
                else if (attrKind === "BOOLEAN") defaultValue = theVal.toLowerCase() === "true";
                else defaultValue = theVal;
              }
            }
          }

          attributeDefinitions.set(attrId, {
            identifier: attrId,
            longName: attrName,
            dataTypeRef: typeRef,
            kind: attrKind,
            defaultValue,
            isMandatory,
          });
        }
      }

      specTypes.set(id, {
        identifier: id,
        longName,
        kind,
        attributeDefinitions,
      });
    }
  }

  // 4. Spec Objects (Requirements)
  const specObjects = new Map<string, ReqIfSpecObject>();
  const specObjectsContainer = getChild(coreContent, "SPEC-OBJECTS");
  if (specObjectsContainer) {
    for (const soEl of specObjectsContainer.children) {
      if (!matchTag(soEl, "SPEC-OBJECT")) continue;

      const id = getAttr(soEl, "IDENTIFIER") || `REQ-${specObjects.size + 1}`;
      recordIdentifier(id, soEl);
      const longName = getAttr(soEl, "LONG-NAME");
      const lastChange = getAttr(soEl, "LAST-CHANGE");
      const typeRef = getChildRefText(soEl, "TYPE", "SPEC-OBJECT-TYPE-REF");
      const span = createSpan(soEl.start, soEl.end, lineStarts);

      const attributes = new Map<string, ReqIfAttributeValue>();
      let requirementText = "";

      const valuesContainer = getChild(soEl, "VALUES");
      if (valuesContainer) {
        for (const valEl of valuesContainer.children) {
          const valTag = localName(valEl.name).toUpperCase();
          let kind: ReqIfDataTypeKind = "STRING";
          if (valTag.includes("INTEGER")) kind = "INTEGER";
          else if (valTag.includes("REAL")) kind = "REAL";
          else if (valTag.includes("BOOLEAN")) kind = "BOOLEAN";
          else if (valTag.includes("ENUM")) kind = "ENUMERATION";
          else if (valTag.includes("XHTML")) kind = "XHTML";
          else if (valTag.includes("DATE")) kind = "DATE";

          let defRef = "";
          const defWrapper = getChild(valEl, "DEFINITION");
          const firstDefChild = defWrapper?.children[0];
          if (firstDefChild) {
            defRef = firstDefChild.text.trim();
          }

          let rawValue: string | number | boolean = "";
          if (kind === "ENUMERATION") {
            const valsEl = getChild(valEl, "VALUES");
            const firstValChild = valsEl?.children[0];
            if (firstValChild) {
              rawValue = firstValChild.text.trim();
            } else {
              rawValue = getAttr(valEl, "THE-VALUE") ?? "";
            }
          } else {
            const directAttr = getAttr(valEl, "THE-VALUE");
            if (directAttr !== undefined) {
              rawValue = directAttr;
            } else {
              const theValEl = getChild(valEl, "THE-VALUE");
              if (theValEl) {
                rawValue = theValEl.text.trim();
              }
            }
          }

          let parsedValue: string | number | boolean = rawValue;
          const rawStr = String(rawValue).trim();
          if (kind === "INTEGER") {
            if (/^[-+]?\d+$/.test(rawStr)) {
              parsedValue = parseInt(rawStr, 10);
            }
          } else if (kind === "REAL") {
            if (/^[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?$/.test(rawStr)) {
              parsedValue = parseFloat(rawStr);
            }
          } else if (kind === "BOOLEAN") {
            const lower = rawStr.toLowerCase();
            if (lower === "true" || lower === "1") {
              parsedValue = true;
            } else if (lower === "false" || lower === "0") {
              parsedValue = false;
            }
          }

          const attrSpan = createSpan(valEl.start, valEl.end, lineStarts);

          let attrName = defRef;
          const st = typeRef ? specTypes.get(typeRef) : undefined;
          if (st) {
            const ad = st.attributeDefinitions.get(defRef);
            if (ad?.longName) attrName = ad.longName;
          }

          const attrKey = defRef || attrName || `ReqIF.Text`;
          attributes.set(attrKey, {
            definitionRef: defRef,
            name: attrName || "ReqIF.Text",
            kind,
            value: parsedValue,
            span: attrSpan,
          });

          // Check if this attribute represents the requirement text
          const lowerName = (attrName || defRef).toLowerCase();
          if (
            lowerName.includes("text") ||
            lowerName.includes("description") ||
            lowerName.includes("summary") ||
            lowerName === "reqif.text" ||
            lowerName === "requirement text" ||
            !attrName ||
            !requirementText
          ) {
            if (typeof parsedValue === "string" && parsedValue.trim().length > 0) {
              requirementText = parsedValue.trim();
            }
          }
        }
      }

      if (!requirementText) {
        for (const attr of attributes.values()) {
          if (typeof attr.value === "string" && attr.value.trim().length > 0) {
            requirementText = attr.value.trim();
            break;
          }
        }
      }

      if (!requirementText) {
        requirementText = longName || id;
      }

      const contract = extractFormalContract(requirementText);

      // Extract ASIL level from explicit attribute, VALUES, or requirement text/title
      let asil = extractAsilLevel(`${longName || ""} ${requirementText}`);
      const explicitAsilAttr = getAttr(soEl, "ASIL") || getAttr(soEl, "ASIL-LEVEL");
      if (explicitAsilAttr) {
        const parsedAsil = extractAsilLevel(explicitAsilAttr);
        if (parsedAsil) asil = parsedAsil;
      }
      for (const attr of attributes.values()) {
        const keyLower = `${attr.definitionRef} ${attr.name}`.toLowerCase();
        if (keyLower.includes("asil") || keyLower.includes("safety")) {
          const parsedAsil = extractAsilLevel(String(attr.value));
          if (parsedAsil) asil = parsedAsil;
        }
      }

      // Extract Status from explicit attribute or VALUES
      let status: ReqIfSpecObject["status"] | undefined;
      const rawStatus =
        getAttr(soEl, "STATUS") ||
        getChild(soEl, "STATUS")?.text.trim() ||
        (() => {
          for (const attr of attributes.values()) {
            const keyLower = `${attr.definitionRef} ${attr.name}`.toLowerCase();
            if (keyLower.includes("status") || keyLower.includes("state")) {
              return String(attr.value).trim();
            }
          }
          return undefined;
        })();
      if (rawStatus) {
        const normStatus = rawStatus.toLowerCase();
        if (normStatus.includes("verif")) status = "Verified";
        else if (normStatus.includes("approv")) status = "Approved";
        else if (normStatus.includes("review")) status = "Review";
        else if (normStatus.includes("violat") || normStatus.includes("fail")) status = "Violated";
        else if (normStatus.includes("draft") || normStatus.includes("new")) status = "Draft";
      }

      specObjects.set(id, {
        identifier: id,
        longName,
        lastChange,
        typeRef,
        attributes,
        text: requirementText,
        span,
        contract,
        asilLevel: asil,
        status,
      });
    }
  }

  // 5. Spec Relations
  const specRelations: ReqIfSpecRelation[] = [];
  const specRelationsContainer = getChild(coreContent, "SPEC-RELATIONS");
  if (specRelationsContainer) {
    for (const srEl of specRelationsContainer.children) {
      if (!matchTag(srEl, "SPEC-RELATION")) continue;

      const id = getAttr(srEl, "IDENTIFIER") || `REL-${specRelations.length + 1}`;
      recordIdentifier(id, srEl);
      const longName = getAttr(srEl, "LONG-NAME");
      const typeRef = getChildRefText(srEl, "TYPE", "SPEC-RELATION-TYPE-REF") || getAttr(srEl, "TYPE");
      const sourceId =
        getChildRefText(srEl, "SOURCE", "SPEC-OBJECT-REF") ||
        getChild(srEl, "SOURCE")?.text.trim() ||
        getAttr(srEl, "SOURCE") ||
        getAttr(srEl, "SOURCE-REF") ||
        "";
      const targetId =
        getChildRefText(srEl, "TARGET", "SPEC-OBJECT-REF") ||
        getChild(srEl, "TARGET")?.text.trim() ||
        getAttr(srEl, "TARGET") ||
        getAttr(srEl, "TARGET-REF") ||
        "";
      const span = createSpan(srEl.start, srEl.end, lineStarts);

      let relationType: ReqIfRelationKind = "satisfies";
      const candidateType = (getAttr(srEl, "RELATION-TYPE") || longName || typeRef || "").toLowerCase();
      if (candidateType.includes("verif")) relationType = "verifies";
      else if (candidateType.includes("refin")) relationType = "refines";
      else if (candidateType.includes("allocat")) relationType = "allocates";
      else if (candidateType.includes("conflict")) relationType = "conflicts";
      else if (candidateType.includes("deriv")) relationType = "derives";

      specRelations.push({
        identifier: id,
        longName,
        typeRef,
        relationType,
        sourceId,
        targetId,
        span,
      });
    }
  }

  // 6. Specifications & Hierarchies
  function parseHierarchy(hEl: XmlElement): ReqIfSpecHierarchy {
    const id = getAttr(hEl, "IDENTIFIER") || `HIER-${Math.random().toString(36).slice(2, 8)}`;
    const objectRef =
      getChildRefText(hEl, "OBJECT", "SPEC-OBJECT-REF") || getAttr(hEl, "OBJECT-REF") || getAttr(hEl, "OBJECT") || "";
    const span = createSpan(hEl.start, hEl.end, lineStarts);

    const children: ReqIfSpecHierarchy[] = [];
    const childrenContainer = getChild(hEl, "CHILDREN");
    if (childrenContainer) {
      for (const childEl of childrenContainer.children) {
        if (matchTag(childEl, "SPEC-HIERARCHY")) {
          children.push(parseHierarchy(childEl));
        }
      }
    }

    return {
      identifier: id,
      objectRef,
      children,
      span,
    };
  }

  const specifications: ReqIfSpecification[] = [];
  const specificationsContainer = getChild(coreContent, "SPECIFICATIONS");
  if (specificationsContainer) {
    for (const specEl of specificationsContainer.children) {
      if (!matchTag(specEl, "SPECIFICATION")) continue;

      const id = getAttr(specEl, "IDENTIFIER") || `SPEC-${specifications.length + 1}`;
      const longName = getAttr(specEl, "LONG-NAME");
      const lastChange = getAttr(specEl, "LAST-CHANGE");
      const typeRef = getChildRefText(specEl, "TYPE", "SPECIFICATION-TYPE-REF");
      const span = createSpan(specEl.start, specEl.end, lineStarts);

      const children: ReqIfSpecHierarchy[] = [];
      const childrenContainer = getChild(specEl, "CHILDREN");
      if (childrenContainer) {
        for (const childEl of childrenContainer.children) {
          if (matchTag(childEl, "SPEC-HIERARCHY")) {
            children.push(parseHierarchy(childEl));
          }
        }
      }

      specifications.push({
        identifier: id,
        longName,
        lastChange,
        typeRef,
        children,
        span,
      });
    }
  }

  return {
    header,
    dataTypes,
    specTypes,
    specObjects,
    specRelations,
    specifications,
    duplicateIdentifiers: duplicateIdentifiers.length > 0 ? duplicateIdentifiers : undefined,
    rawXml: xmlContent,
  };
}

/**
 * Serializes a ReqIfDocument back to standard OMG ReqIF 1.2 XML.
 */
export function serializeReqIf(doc: ReqIfDocument): string {
  const parts: string[] = [];
  parts.push('<?xml version="1.0" encoding="UTF-8"?>');
  parts.push(
    '<REQ-IF xmlns="http://www.omg.org/spec/ReqIF/20110401/reqif.xsd" xmlns:xhtml="http://www.w3.org/1999/xhtml">',
  );

  // Header
  parts.push("  <THE-HEADER>");
  parts.push(`    <REQ-IF-HEADER IDENTIFIER="${doc.header.identifier}">`);
  parts.push(`      <REQ-IF-VERSION>${doc.header.reqIfVersion}</REQ-IF-VERSION>`);
  parts.push(`      <TITLE>${escapeXml(doc.header.title)}</TITLE>`);
  if (doc.header.creationTime) parts.push(`      <CREATION-TIME>${doc.header.creationTime}</CREATION-TIME>`);
  if (doc.header.repositoryId) parts.push(`      <REPOSITORY-ID>${doc.header.repositoryId}</REPOSITORY-ID>`);
  if (doc.header.reqIfToolId) parts.push(`      <REQ-IF-TOOL-ID>${doc.header.reqIfToolId}</REQ-IF-TOOL-ID>`);
  if (doc.header.comment) parts.push(`      <COMMENT>${escapeXml(doc.header.comment)}</COMMENT>`);
  parts.push("    </REQ-IF-HEADER>");
  parts.push("  </THE-HEADER>");

  parts.push("  <CORE-CONTENT>");
  parts.push("    <REQ-IF-CONTENT>");

  // Data Types
  parts.push("      <DATATYPES>");
  for (const dt of doc.dataTypes.values()) {
    const tagName = `DATATYPE-DEFINITION-${dt.kind}`;
    parts.push(
      `        <${tagName} IDENTIFIER="${dt.identifier}" LONG-NAME="${escapeXml(dt.longName || dt.identifier)}">`,
    );
    if (dt.enumValues && dt.enumValues.length > 0) {
      parts.push("          <SPECIFIED-VALUES>");
      for (const ev of dt.enumValues) {
        parts.push(
          `            <ENUM-VALUE IDENTIFIER="${ev.identifier}" LONG-NAME="${escapeXml(ev.longName || ev.identifier)}"${ev.key !== undefined ? ` KEY="${ev.key}"` : ""} />`,
        );
      }
      parts.push("          </SPECIFIED-VALUES>");
    }
    parts.push(`        </${tagName}>`);
  }
  parts.push("      </DATATYPES>");

  // Spec Types
  parts.push("      <SPEC-TYPES>");
  for (const st of doc.specTypes.values()) {
    parts.push(
      `        <${st.kind} IDENTIFIER="${st.identifier}" LONG-NAME="${escapeXml(st.longName || st.identifier)}">`,
    );
    if (st.attributeDefinitions.size > 0) {
      parts.push("          <SPEC-ATTRIBUTES>");
      for (const ad of st.attributeDefinitions.values()) {
        const tagName = `ATTRIBUTE-DEFINITION-${ad.kind}`;
        parts.push(
          `            <${tagName} IDENTIFIER="${ad.identifier}" LONG-NAME="${escapeXml(ad.longName || ad.identifier)}"${ad.isMandatory ? ' IS-MANDATORY="true"' : ""}>`,
        );
        if (ad.dataTypeRef) {
          parts.push("              <TYPE>");
          parts.push(
            `                <DATATYPE-DEFINITION-${ad.kind}-REF>${ad.dataTypeRef}</DATATYPE-DEFINITION-${ad.kind}-REF>`,
          );
          parts.push("              </TYPE>");
        }
        parts.push(`            </${tagName}>`);
      }
      parts.push("          </SPEC-ATTRIBUTES>");
    }
    parts.push(`        </${st.kind}>`);
  }
  parts.push("      </SPEC-TYPES>");

  // Spec Objects
  parts.push("      <SPEC-OBJECTS>");
  for (const so of doc.specObjects.values()) {
    const statusAttr = so.status ? ` STATUS="${escapeXml(so.status)}"` : "";
    const asilAttr = so.asilLevel ? ` ASIL="${escapeXml(so.asilLevel)}"` : "";
    parts.push(
      `        <SPEC-OBJECT IDENTIFIER="${so.identifier}" LONG-NAME="${escapeXml(so.longName || so.identifier)}"${asilAttr}${statusAttr}>`,
    );
    if (so.typeRef) {
      parts.push("          <TYPE>");
      parts.push(`            <SPEC-OBJECT-TYPE-REF>${so.typeRef}</SPEC-OBJECT-TYPE-REF>`);
      parts.push("          </TYPE>");
    }
    if (so.attributes.size > 0) {
      parts.push("          <VALUES>");
      for (const attr of so.attributes.values()) {
        const tagName = `ATTRIBUTE-VALUE-${attr.kind}`;
        parts.push(`            <${tagName}>`);
        if (attr.definitionRef) {
          parts.push("              <DEFINITION>");
          parts.push(
            `                <ATTRIBUTE-DEFINITION-${attr.kind}-REF>${attr.definitionRef}</ATTRIBUTE-DEFINITION-${attr.kind}-REF>`,
          );
          parts.push("              </DEFINITION>");
        }
        if (attr.kind === "ENUMERATION") {
          parts.push("              <VALUES>");
          parts.push(`                <ENUM-VALUE-REF>${String(attr.value)}</ENUM-VALUE-REF>`);
          parts.push("              </VALUES>");
        } else {
          parts.push(`              <THE-VALUE>${escapeXml(String(attr.value))}</THE-VALUE>`);
        }
        parts.push(`            </${tagName}>`);
      }
      parts.push("          </VALUES>");
    } else if (so.text) {
      parts.push("          <VALUES>");
      parts.push("            <ATTRIBUTE-VALUE-STRING>");
      parts.push(`              <THE-VALUE>${escapeXml(so.text)}</THE-VALUE>`);
      parts.push("            </ATTRIBUTE-VALUE-STRING>");
      parts.push("          </VALUES>");
    }
    parts.push("        </SPEC-OBJECT>");
  }
  parts.push("      </SPEC-OBJECTS>");

  // Spec Relations
  if (doc.specRelations.length > 0) {
    parts.push("      <SPEC-RELATIONS>");
    for (const rel of doc.specRelations) {
      parts.push(
        `        <SPEC-RELATION IDENTIFIER="${rel.identifier}" LONG-NAME="${escapeXml(rel.longName || rel.relationType)}">`,
      );
      if (rel.typeRef) {
        parts.push("          <TYPE>");
        parts.push(`            <SPEC-RELATION-TYPE-REF>${rel.typeRef}</SPEC-RELATION-TYPE-REF>`);
        parts.push("          </TYPE>");
      }
      parts.push("          <SOURCE>");
      parts.push(`            <SPEC-OBJECT-REF>${rel.sourceId}</SPEC-OBJECT-REF>`);
      parts.push("          </SOURCE>");
      parts.push("          <TARGET>");
      parts.push(`            <SPEC-OBJECT-REF>${rel.targetId}</SPEC-OBJECT-REF>`);
      parts.push("          </TARGET>");
      parts.push("        </SPEC-RELATION>");
    }
    parts.push("      </SPEC-RELATIONS>");
  }

  // Specifications
  if (doc.specifications.length > 0) {
    parts.push("      <SPECIFICATIONS>");
    for (const spec of doc.specifications) {
      parts.push(
        `        <SPECIFICATION IDENTIFIER="${spec.identifier}" LONG-NAME="${escapeXml(spec.longName || spec.identifier)}">`,
      );
      if (spec.typeRef) {
        parts.push("          <TYPE>");
        parts.push(`            <SPECIFICATION-TYPE-REF>${spec.typeRef}</SPECIFICATION-TYPE-REF>`);
        parts.push("          </TYPE>");
      }
      if (spec.children.length > 0) {
        parts.push("          <CHILDREN>");
        for (const h of spec.children) {
          serializeHierarchy(h, parts, "            ");
        }
        parts.push("          </CHILDREN>");
      }
      parts.push("        </SPECIFICATION>");
    }
    parts.push("      </SPECIFICATIONS>");
  }

  parts.push("    </REQ-IF-CONTENT>");
  parts.push("  </CORE-CONTENT>");
  parts.push("</REQ-IF>");

  return parts.join("\n");
}

function serializeHierarchy(h: ReqIfSpecHierarchy, parts: string[], indent: string) {
  parts.push(`${indent}<SPEC-HIERARCHY IDENTIFIER="${h.identifier}">`);
  parts.push(`${indent}  <OBJECT>`);
  parts.push(`${indent}    <SPEC-OBJECT-REF>${h.objectRef}</SPEC-OBJECT-REF>`);
  parts.push(`${indent}  </OBJECT>`);
  if (h.children.length > 0) {
    parts.push(`${indent}  <CHILDREN>`);
    for (const child of h.children) {
      serializeHierarchy(child, parts, indent + "    ");
    }
    parts.push(`${indent}  </CHILDREN>`);
  }
  parts.push(`${indent}</SPEC-HIERARCHY>`);
}

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Result of unpacking and parsing a `.reqifz` ZIP container archive.
 */
export interface ReqIfzBundleResult {
  /** All parsed `.reqif` documents discovered inside the `.reqifz` archive. */
  documents: ReqIfDocument[];
  /** Primary (first) `.reqif` document in the bundle. */
  primaryDocument: ReqIfDocument;
  /** Paths of all `.reqif` XML files in the bundle. */
  reqIfPaths: string[];
  /** Paths of supplementary attachment files (images, OLE objects, PDFs, etc.) in the bundle. */
  attachmentPaths: string[];
  /** Raw entry manifest of all files inside the `.reqifz` archive. */
  entries: Array<{ path: string; size: number }>;
}

/**
 * Extracts and parses a `.reqifz` ZIP bundle into its constituent `ReqIfDocument` models
 * and supplementary attachment paths.
 */
export function extractReqIfzBundle(data: Uint8Array): ReqIfzBundleResult {
  const zip = defaultContainerToolkit.zip;
  const rawEntries = zip.entries(data);
  const documents: ReqIfDocument[] = [];
  const reqIfPaths: string[] = [];
  const attachmentPaths: string[] = [];

  for (const entry of rawEntries) {
    const lower = entry.name.toLowerCase();
    if (lower.endsWith(".reqif")) {
      const xmlText = zip.readText(data, entry.name);
      if (xmlText) {
        reqIfPaths.push(entry.name);
        documents.push(parseReqIf(xmlText));
      }
    } else {
      attachmentPaths.push(entry.name);
    }
  }

  // Fallback: if no file ended with `.reqif`, check `.xml` files containing `<REQ-IF`
  if (documents.length === 0) {
    for (const entry of rawEntries) {
      if (entry.name.toLowerCase().endsWith(".xml")) {
        const xmlText = zip.readText(data, entry.name);
        if (xmlText && /<REQ-IF\b/i.test(xmlText)) {
          reqIfPaths.push(entry.name);
          documents.push(parseReqIf(xmlText));
        }
      }
    }
  }

  const primaryDocument = documents[0];
  if (!primaryDocument) {
    throw new Error("No valid .reqif specification document found inside .reqifz archive");
  }

  return {
    documents,
    primaryDocument,
    reqIfPaths,
    attachmentPaths,
    entries: rawEntries.map((e) => ({ path: e.name, size: e.size })),
  };
}
