// SPDX-License-Identifier: AGPL-3.0-or-later
/**
 * Formal SysML v2 Requirement & Cross-Domain Binding Engine
 *
 * Bridges formal SysML v2 `requirement def` constraints with Modelica DAE
 * state variables and the `SemanticTheoryCoordinator` via native WebAssembly
 * GLR Concrete Syntax Tree (CST) traversal (`@modelscript/dsl`).
 */

import { createWasmParserSync, type SyntaxNode, type TreeSitterParser } from "@modelscript/dsl/bindings";
import type { BoundRequirement } from "../analysis/wasm_zonotope_reach.js";
import { SemanticTheoryCoordinator } from "./theory_coordinator.js";

export type { BoundRequirement };

export interface SysmlRequirement {
  /** Requirement definition identifier (e.g., "FlightCeilingRequirement") */
  id: string;
  /** Short requirement identifier if declared via `<'REQ-ID'>` */
  shortId?: string | undefined;
  /** Enclosing SysML v2 package name if present */
  packageName?: string | undefined;
  /** Subject type or component name if declared via `subject x : Type;` */
  subjectName?: string | undefined;
  /** Subject instance variable name if declared via `subject x : Type;` */
  subjectVarName?: string | undefined;
  /** Constrained attribute identifier (e.g., "v_climb") */
  targetAttribute: string;
  /** Comparison operator */
  operator: "<=" | ">=" | "<" | ">";
  /** Evaluated numeric threshold */
  limitValue: number;
  /** Evaluated numeric attributes in scope for this requirement */
  attributes?: Record<string, number> | undefined;
}

let cachedSysmlParser: TreeSitterParser | null = null;
let cachedModelicaParser: TreeSitterParser | null = null;

/**
 * Registers pre-initialized WebAssembly GLR parser instances (e.g., from browser
 * async initialization) for synchronous CST requirement and annotation extraction.
 */
export function registerRequirementBinderParsers(parsers: {
  sysmlParser?: TreeSitterParser | null | undefined;
  modelicaParser?: TreeSitterParser | null | undefined;
}): void {
  if (parsers.sysmlParser) cachedSysmlParser = parsers.sysmlParser;
  if (parsers.modelicaParser) cachedModelicaParser = parsers.modelicaParser;
}

function loadWasmLanguageParserNodeSync(langDirName: "sysml2" | "modelica"): TreeSitterParser | null {
  try {
    const candidateRels = [
      `../../../../languages/${langDirName}/dist/parser.wasm`,
      `../../../../languages/${langDirName}/.cache/parser.wasm`,
      `../../../../languages/${langDirName}/parser.wasm`,
    ];
    let wasmPath = decodeURIComponent(new URL(candidateRels[0]!, import.meta.url).pathname);
    const bindingsUrl = new URL(`../../../../languages/${langDirName}/src-gen/bindings.js`, import.meta.url);
    const bindingsPath = decodeURIComponent(bindingsUrl.pathname);

    if (typeof process !== "undefined" && typeof (process as any).getBuiltinModule === "function") {
      try {
        const fsMod = (process as any).getBuiltinModule("node:fs");
        if (fsMod && typeof fsMod.existsSync === "function") {
          for (const rel of candidateRels) {
            const p = decodeURIComponent(new URL(rel, import.meta.url).pathname);
            if (fsMod.existsSync(p)) {
              wasmPath = p;
              break;
            }
          }
        }

        const modBuiltin = (process as any).getBuiltinModule("node:module");
        if (modBuiltin && typeof modBuiltin.createRequire === "function") {
          const req = modBuiltin.createRequire(import.meta.url);
          const bindingsMod = req(bindingsPath);
          if (bindingsMod && typeof bindingsMod.createWasmParserSync === "function") {
            return bindingsMod.createWasmParserSync(wasmPath).parser as TreeSitterParser;
          }
        }
      } catch {
        // Fallback to reading SYNTAX_NAMES and FIELD_NAMES from bindings.js below
      }

      const fsMod = (process as any).getBuiltinModule("node:fs");
      if (fsMod && typeof fsMod.readFileSync === "function") {
        const bindingsSrc = String(fsMod.readFileSync(bindingsPath, "utf8"));
        let syntaxNames: string[] | undefined;
        let fieldNames: Record<string, number> | undefined;

        const synAnchor = bindingsSrc.indexOf("export const SYNTAX_NAMES =");
        if (synAnchor !== -1) {
          const arrStart = bindingsSrc.indexOf("[", synAnchor);
          const arrEnd = bindingsSrc.indexOf('] !== "undefined"', arrStart);
          if (arrStart !== -1 && arrEnd !== -1) {
            syntaxNames = JSON.parse(bindingsSrc.slice(arrStart, arrEnd + 1)) as string[];
          }
        }

        const fieldAnchor = bindingsSrc.indexOf("export const FIELD_NAMES =");
        if (fieldAnchor !== -1) {
          const objStart = bindingsSrc.indexOf("{", fieldAnchor);
          const objEnd = bindingsSrc.indexOf('} !== "undefined"', objStart);
          if (objStart !== -1 && objEnd !== -1) {
            fieldNames = JSON.parse(bindingsSrc.slice(objStart, objEnd + 1)) as Record<string, number>;
          }
        }

        return createWasmParserSync(wasmPath, { syntaxNames, fieldNames }).parser;
      }
    }
  } catch {
    return null;
  }
  return null;
}

export function getSysmlWasmParser(): TreeSitterParser | null {
  if (!cachedSysmlParser) {
    cachedSysmlParser = loadWasmLanguageParserNodeSync("sysml2");
  }
  return cachedSysmlParser;
}

export function getModelicaWasmParser(): TreeSitterParser | null {
  if (!cachedModelicaParser) {
    cachedModelicaParser = loadWasmLanguageParserNodeSync("modelica");
  }
  return cachedModelicaParser;
}

function unquoteSysmlName(raw: string): string {
  const trimmed = raw.trim();
  if ((trimmed.startsWith("'") && trimmed.endsWith("'")) || (trimmed.startsWith('"') && trimmed.endsWith('"'))) {
    return trimmed.slice(1, -1).trim();
  }
  return trimmed;
}

function extractSysmlIdentification(node: SyntaxNode): {
  declaredName: string;
  declaredShortName?: string | undefined;
} {
  const shortNode = node.childForFieldName("declaredShortName");
  const nameNode = node.childForFieldName("declaredName");
  const shortText = shortNode ? unquoteSysmlName(shortNode.text) : undefined;
  const nameText = nameNode ? unquoteSysmlName(nameNode.text) : undefined;

  if (nameText) {
    return { declaredName: nameText, declaredShortName: shortText };
  }

  // Inspect direct Name children before body if field names were merged in grammar rules
  let sawShortBracket = false;
  let fallbackShort: string | undefined = shortText;
  let fallbackName = "";
  for (let i = 0; i < node.childCount; i++) {
    const ch = node.child(i);
    if (!ch) continue;
    const t = ch.type;
    if (t === "{" || t === ";" || t === "PackageBody" || t === "_RequirementBody" || t === "_DefinitionBody") {
      break;
    }
    if (t === "<" || ch.text === "<") {
      sawShortBracket = true;
      continue;
    }
    if (t === ">" || ch.text === ">") {
      sawShortBracket = false;
      continue;
    }
    if (t === "Name") {
      if (sawShortBracket && !fallbackShort) {
        fallbackShort = unquoteSysmlName(ch.text);
      } else if (!sawShortBracket && !fallbackName) {
        fallbackName = unquoteSysmlName(ch.text);
      }
    }
  }

  return {
    declaredName: fallbackName || fallbackShort || "",
    declaredShortName: fallbackShort,
  };
}

/**
 * Evaluates a numeric SysML v2 CST expression node (`LiteralReal`, `LiteralInteger`,
 * `UnaryExpression`, `AdditiveExpression`, `MultiplicativeExpression`,
 * `MeasurementExpression`, or `FeatureReferenceExpression` bound in `attrMap`).
 */
export function evaluateSysmlCstNumericExpr(
  node: SyntaxNode | null | undefined,
  attrMap: ReadonlyMap<string, number>,
): number {
  if (!node) return NaN;
  const type = node.type;

  if (
    type === "LiteralReal" ||
    type === "LiteralInteger" ||
    type === "RealValue" ||
    type === "DECIMAL_VALUE" ||
    type === "EXP_VALUE"
  ) {
    const val = Number(node.text.trim());
    return Number.isFinite(val) ? val : NaN;
  }

  if (type === "MeasurementExpression") {
    // e.g., `12.0 [mm]` — evaluate the quantity expression child before `[`
    const firstNamed = node.firstNamedChild;
    return evaluateSysmlCstNumericExpr(firstNamed, attrMap);
  }

  if (type === "UnaryExpression") {
    const opNode = node.childForFieldName("operator") ?? node.firstChild;
    const operandNode = node.childForFieldName("operand") ?? node.namedChild(node.namedChildCount - 1);
    const val = evaluateSysmlCstNumericExpr(operandNode, attrMap);
    const op = opNode?.text.trim();
    if (op === "-") return -val;
    return val;
  }

  if (type === "AdditiveExpression" || type === "MultiplicativeExpression" || type === "ExponentiationExpression") {
    const operands = node.childrenForFieldName("operand");
    const operators = node.childrenForFieldName("operator");
    if (operands.length >= 2 && operators.length >= 1) {
      let acc = evaluateSysmlCstNumericExpr(operands[0], attrMap);
      for (let i = 0; i < operators.length && i + 1 < operands.length; i++) {
        const rhs = evaluateSysmlCstNumericExpr(operands[i + 1], attrMap);
        const op = operators[i]!.text.trim();
        if (op === "+") acc += rhs;
        else if (op === "-") acc -= rhs;
        else if (op === "*") acc *= rhs;
        else if (op === "/") acc = rhs !== 0 ? acc / rhs : NaN;
        else if (op === "^" || op === "**") acc = Math.pow(acc, rhs);
      }
      return acc;
    }
  }

  if (
    type === "FeatureReferenceExpression" ||
    type === "Name" ||
    type === "QualifiedName" ||
    type === "OwnedFeatureChain"
  ) {
    const raw = unquoteSysmlName(node.text);
    const direct = attrMap.get(raw);
    if (direct !== undefined) return direct;
    const dotTail = raw.split(".").pop()?.trim();
    if (dotTail && attrMap.has(dotTail)) return attrMap.get(dotTail)!;
    const colonTail = raw.split("::").pop()?.trim();
    if (colonTail && attrMap.has(colonTail)) return attrMap.get(colonTail)!;
  }

  if (node.namedChildCount === 1) {
    const childVal = evaluateSysmlCstNumericExpr(node.firstNamedChild, attrMap);
    if (!Number.isNaN(childVal)) return childVal;
  }

  for (let i = 0; i < node.namedChildCount; i++) {
    const ch = node.namedChild(i);
    if (!ch) continue;
    if (
      ch.type === "FeatureValue" ||
      ch.type === "OwnedExpression" ||
      ch.type === "LiteralReal" ||
      ch.type === "LiteralInteger" ||
      ch.type === "UnaryExpression" ||
      ch.type === "AdditiveExpression" ||
      ch.type === "MultiplicativeExpression" ||
      ch.type === "MeasurementExpression" ||
      ch.type === "FeatureReferenceExpression"
    ) {
      const v = evaluateSysmlCstNumericExpr(ch, attrMap);
      if (!Number.isNaN(v)) return v;
    }
  }

  const fallback = Number(node.text.trim());
  return Number.isFinite(fallback) ? fallback : NaN;
}

function collectAttributeUsagesFromCst(scopeNode: SyntaxNode, attrMap: Map<string, number>, prefix?: string): void {
  const attrNodes = scopeNode.descendantsOfType(["AttributeUsage"]);
  for (const attrNode of attrNodes) {
    const { declaredName } = extractSysmlIdentification(attrNode);
    if (!declaredName) continue;
    const fvNodes = attrNode.descendantsOfType(["FeatureValue"]);
    if (fvNodes.length === 0) continue;
    const val = evaluateSysmlCstNumericExpr(fvNodes[0], attrMap);
    if (!Number.isNaN(val)) {
      attrMap.set(declaredName, val);
      if (prefix) {
        attrMap.set(`${prefix}.${declaredName}`, val);
      }
    }
  }
}

function evaluateSimpleSysmlArithmetic(expr: string, attrMap: Map<string, number>): number {
  const trimmed = expr.trim();
  const direct = Number(trimmed);
  if (Number.isFinite(direct)) return direct;
  if (attrMap.has(trimmed)) return attrMap.get(trimmed)!;

  const binMatch = trimmed.match(/^([a-zA-Z0-9_.]+|\d+(?:\.\d+)?)\s*([+\-*/])\s*([a-zA-Z0-9_.]+|\d+(?:\.\d+)?)$/);
  if (binMatch) {
    const lhs = evaluateSimpleSysmlArithmetic(binMatch[1]!, attrMap);
    const op = binMatch[2]!;
    const rhs = evaluateSimpleSysmlArithmetic(binMatch[3]!, attrMap);
    if (!Number.isNaN(lhs) && !Number.isNaN(rhs)) {
      if (op === "+") return lhs + rhs;
      if (op === "-") return lhs - rhs;
      if (op === "*") return lhs * rhs;
      if (op === "/") return rhs !== 0 ? lhs / rhs : NaN;
    }
  }
  return NaN;
}

function extractRequirementBlocksFromText(
  sysmlText: string,
): { shortId?: string | undefined; id: string; body: string }[] {
  const blocks: { shortId?: string | undefined; id: string; body: string }[] = [];
  const reqStartRegex = /requirement\s+(?:def\s+)?(?:<['"]?([^'">]+)['"]?>\s*)?([a-zA-Z0-9_]+)\s*\{/g;
  let match: RegExpExecArray | null;
  while ((match = reqStartRegex.exec(sysmlText)) !== null) {
    const shortId = match[1];
    const id = match[2]!;
    const startIndex = match.index + match[0].length;
    let depth = 1;
    let endIndex = startIndex;
    for (let i = startIndex; i < sysmlText.length; i++) {
      if (sysmlText[i] === "{") depth++;
      else if (sysmlText[i] === "}") {
        depth--;
        if (depth === 0) {
          endIndex = i;
          break;
        }
      }
    }
    const body = sysmlText.slice(startIndex, endIndex);
    blocks.push({ shortId, id, body });
  }
  return blocks;
}

function parseSysmlRequirementsFallback(sysmlText: string): SysmlRequirement[] {
  const pkgMatch = sysmlText.match(/package\s+([a-zA-Z0-9_]+)/);
  const packageName = pkgMatch ? pkgMatch[1] : undefined;

  const globalAttrs = new Map<string, number>();
  const attrRegex = /attribute\s+([a-zA-Z0-9_]+)\s*(?::\s*[^=;\n]+)?=\s*([^;\n]+);/g;
  let attrMatch: RegExpExecArray | null;
  while ((attrMatch = attrRegex.exec(sysmlText)) !== null) {
    const name = attrMatch[1]!;
    const val = evaluateSimpleSysmlArithmetic(attrMatch[2]!, globalAttrs);
    if (!Number.isNaN(val)) {
      globalAttrs.set(name, val);
    }
  }

  const blocks = extractRequirementBlocksFromText(sysmlText);
  const results: SysmlRequirement[] = [];

  for (const block of blocks) {
    const { shortId, id: reqId, body } = block;

    const localAttrs = new Map<string, number>(globalAttrs);
    const localAttrRegex = /attribute\s+([a-zA-Z0-9_]+)\s*(?::\s*[^=;\n]+)?=\s*([^;\n]+);/g;
    let laMatch: RegExpExecArray | null;
    while ((laMatch = localAttrRegex.exec(body)) !== null) {
      const name = laMatch[1]!;
      const val = evaluateSimpleSysmlArithmetic(laMatch[2]!, localAttrs);
      if (!Number.isNaN(val)) {
        localAttrs.set(name, val);
      }
    }

    let subjectName: string | undefined;
    let subjectVarName: string | undefined;
    const subjMatch = body.match(/subject\s+([a-zA-Z0-9_]+)\s*:\s*([a-zA-Z0-9_]+)/);
    if (subjMatch) {
      subjectVarName = subjMatch[1];
      subjectName = subjMatch[2];
    }

    const constraintBlockMatch = body.match(/require\s+constraint\s*\{([\s\S]*?)\}/);
    if (constraintBlockMatch) {
      const constraintText = constraintBlockMatch[1]!;
      const clauses = constraintText
        .split(/\band\b|[;\n]/)
        .map((c) => c.trim())
        .filter(Boolean);

      for (const clause of clauses) {
        const relMatch = clause.match(/([a-zA-Z0-9_.]+)\s*(<=|>=|<|>)\s*([a-zA-Z0-9_.]+)/);
        if (relMatch) {
          const rawLhs = relMatch[1]!;
          const op = relMatch[2]! as "<=" | ">=" | "<" | ">";
          const rawRhs = relMatch[3]!;

          const lhsParts = rawLhs.split(".");
          const targetAttribute = lhsParts[lhsParts.length - 1]!;
          const explicitVar = lhsParts.length > 1 ? lhsParts[0] : undefined;

          const limitValue = evaluateSimpleSysmlArithmetic(rawRhs, localAttrs);
          if (!Number.isNaN(limitValue)) {
            const attrObj: Record<string, number> = {};
            for (const [k, v] of localAttrs.entries()) {
              if (!k.includes(".")) attrObj[k] = v;
            }

            results.push({
              id: reqId,
              shortId,
              packageName,
              subjectName,
              subjectVarName: subjectVarName ?? explicitVar,
              targetAttribute,
              operator: op,
              limitValue,
              attributes: attrObj,
            });
          }
        }
      }
    }
  }

  return results;
}

/**
 * Parses formal SysML v2 `requirement def` and `requirement` blocks using the
 * native WebAssembly GLR parser (`languages/sysml2/dist/parser.wasm`) to extract
 * numerical safety and operational bounds from the Concrete Syntax Tree (CST).
 */
export function parseSysmlRequirements(sysmlText: string, cstRoot?: SyntaxNode | null): SysmlRequirement[] {
  const rootNode = cstRoot ?? getSysmlWasmParser()?.parse(sysmlText)?.rootNode ?? null;
  if (!rootNode) {
    return parseSysmlRequirementsFallback(sysmlText);
  }

  const requirements: SysmlRequirement[] = [];

  // Package name if enclosed in a top-level Package / LibraryPackage
  const pkgNodes = rootNode.descendantsOfType(["Package", "LibraryPackage"]);
  const packageName =
    pkgNodes.length > 0 ? extractSysmlIdentification(pkgNodes[0]!).declaredName || undefined : undefined;

  // Global/package-level attribute defaults (including part def attributes)
  const globalAttrMap = new Map<string, number>();
  const partDefNodes = rootNode.descendantsOfType(["PartDefinition", "PartUsage"]);
  for (const partNode of partDefNodes) {
    const { declaredName: partName } = extractSysmlIdentification(partNode);
    collectAttributeUsagesFromCst(partNode, globalAttrMap, partName || undefined);
  }
  collectAttributeUsagesFromCst(rootNode, globalAttrMap);

  const reqNodes = rootNode.descendantsOfType(["RequirementDefinition", "RequirementUsage"]);
  for (const reqNode of reqNodes) {
    const { declaredName: reqId, declaredShortName: shortId } = extractSysmlIdentification(reqNode);
    if (!reqId) continue;

    // Local attribute map inherits package/part attributes and overrides with requirement attributes
    const localAttrMap = new Map<string, number>(globalAttrMap);
    collectAttributeUsagesFromCst(reqNode, localAttrMap);

    // Extract `subject <subjectVarName> : <subjectName>;` from SubjectUsage CST node
    let subjectName: string | undefined;
    let subjectVarName: string | undefined;
    const subjectNodes = reqNode.descendantsOfType(["SubjectUsage"]);
    if (subjectNodes.length > 0) {
      const subjNode = subjectNodes[0]!;
      const subjId = extractSysmlIdentification(subjNode);
      if (subjId.declaredName) {
        subjectVarName = subjId.declaredName;
      }
      const typingNodes = subjNode.descendantsOfType(["OwnedFeatureTyping", "FeatureTyping"]);
      if (typingNodes.length > 0) {
        const rawType = typingNodes[0]!.text.replace(/^:\s*/, "").trim();
        if (rawType) {
          subjectName = rawType.split("::").pop()!.trim();
        }
      }
    }

    // Collect plain record of numeric attributes in scope
    const attributesRecord: Record<string, number> = {};
    for (const [k, v] of localAttrMap.entries()) {
      if (!k.includes(".")) {
        attributesRecord[k] = v;
      }
    }

    // Traverse RequirementConstraintMember CST nodes in pre-order
    const constraintMembers = reqNode.descendantsOfType(["RequirementConstraintMember"]);
    for (const memberNode of constraintMembers) {
      const kindNode = memberNode.childForFieldName("constraintKind");
      if (kindNode && kindNode.text.trim() === "assume") {
        continue;
      }

      // Collect pre-order list of CST nodes inside this constraint member
      const preOrderNodes: SyntaxNode[] = [];
      const walkPreOrder = (n: SyntaxNode): void => {
        preOrderNodes.push(n);
        for (let i = 0; i < n.childCount; i++) {
          const ch = n.child(i);
          if (ch) walkPreOrder(ch);
        }
      };
      walkPreOrder(memberNode);

      const consumedNodeIds = new Set<number>();

      for (let idx = 0; idx < preOrderNodes.length; idx++) {
        const cur = preOrderNodes[idx]!;
        if (consumedNodeIds.has(cur.id)) continue;

        if (cur.type === "RelationalExpression") {
          const operands = cur.childrenForFieldName("operand");
          const opNode =
            cur.childForFieldName("operator") ??
            cur.children.find(
              (c: SyntaxNode) =>
                c.type === "RelationalOperator" ||
                c.text === "<=" ||
                c.text === ">=" ||
                c.text === "<" ||
                c.text === ">",
            );
          const lhsNode = operands[0] ?? cur.namedChild(0);
          const rhsNode = operands[1] ?? cur.namedChild(cur.namedChildCount - 1);
          const opText = opNode?.text.trim();
          if (lhsNode && rhsNode && (opText === "<=" || opText === ">=" || opText === "<" || opText === ">")) {
            const lhsNames = lhsNode
              .descendantsOfType(["Name"])
              .map((n: SyntaxNode) => unquoteSysmlName(n.text))
              .filter(Boolean);
            const targetAttribute =
              lhsNames.length > 0
                ? lhsNames[lhsNames.length - 1]!
                : unquoteSysmlName(lhsNode.text.split(".").pop() ?? lhsNode.text);
            const limitValue = evaluateSysmlCstNumericExpr(rhsNode, localAttrMap);
            if (targetAttribute && !Number.isNaN(limitValue)) {
              requirements.push({
                id: reqId,
                shortId,
                packageName,
                subjectName,
                subjectVarName,
                targetAttribute,
                operator: opText,
                limitValue,
                attributes: attributesRecord,
              });
              for (const d of cur.descendantsOfType([
                "RelationalExpression",
                "OwnedFeatureChain",
                "FeatureReferenceExpression",
              ])) {
                consumedNodeIds.add(d.id);
              }
            }
          }
          continue;
        }

        // Handle dotted feature chains (`subject.attr <= expr`) where LR shifts `subject.attr` into OwnedFeatureChain
        if (cur.type === "OwnedFeatureChain") {
          let parentErr: SyntaxNode | null = cur.parent;
          while (parentErr && parentErr.type !== "ERROR") {
            parentErr = parentErr.parent;
          }
          if (!parentErr || parentErr.type !== "ERROR") continue;
          const opTokenNode = parentErr.children.find((c: SyntaxNode) => {
            const t = c.text.trim();
            return t === "<=" || t === ">=" || t === "<" || t === ">";
          });
          const opText = opTokenNode?.text.trim() as "<=" | ">=" | "<" | ">" | undefined;
          if (!opText) continue;

          const lhsNames = cur
            .descendantsOfType(["Name"])
            .map((n: SyntaxNode) => unquoteSysmlName(n.text))
            .filter(Boolean);
          const targetAttribute = lhsNames.length > 0 ? lhsNames[lhsNames.length - 1]! : "";
          if (!targetAttribute) continue;

          // Find the immediately following RHS value expression in pre-order outside `parentErr`
          let rhsNode: SyntaxNode | null = null;
          for (let j = idx + 1; j < preOrderNodes.length; j++) {
            const cand = preOrderNodes[j]!;
            if (cand.startIndex < parentErr.endIndex) continue;
            if (
              cand.type === "AdditiveExpression" ||
              cand.type === "MultiplicativeExpression" ||
              cand.type === "UnaryExpression" ||
              cand.type === "MeasurementExpression" ||
              cand.type === "LiteralReal" ||
              cand.type === "LiteralInteger" ||
              cand.type === "FeatureReferenceExpression"
            ) {
              rhsNode = cand;
              break;
            }
          }

          if (rhsNode) {
            const limitValue = evaluateSysmlCstNumericExpr(rhsNode, localAttrMap);
            if (!Number.isNaN(limitValue)) {
              consumedNodeIds.add(cur.id);
              consumedNodeIds.add(rhsNode.id);
              requirements.push({
                id: reqId,
                shortId,
                packageName,
                subjectName,
                subjectVarName,
                targetAttribute,
                operator: opText,
                limitValue,
                attributes: attributesRecord,
              });
            }
          }
        }
      }
    }
  }

  return requirements.length > 0 ? requirements : parseSysmlRequirementsFallback(sysmlText);
}

/**
 * Extracts `annotation(twin = "...")`, `annotation(counterpart = "...")`, or
 * `annotation(implements = "...")` bindings from a Modelica model source string
 * by traversing its native WebAssembly GLR Concrete Syntax Tree (CST).
 * Returns a map from Modelica variable name -> target path.
 */
export function extractModelicaTwinAnnotations(moText: string, cstRoot?: SyntaxNode | null): Map<string, string> {
  const result = new Map<string, string>();
  const rootNode = cstRoot ?? getModelicaWasmParser()?.parse(moText)?.rootNode ?? null;
  if (!rootNode) {
    return result;
  }

  const compNodes = rootNode.descendantsOfType(["component_declaration", "component_declaration1"]);
  for (const compNode of compNodes) {
    const declNode =
      compNode.childForFieldName("declaration") ??
      compNode.namedChildren.find((c: SyntaxNode) => c.type === "declaration");
    if (!declNode) continue;

    const nameNode = declNode.childForFieldName("name") ?? declNode.firstNamedChild;
    const varName = nameNode?.text.trim();
    if (!varName) continue;

    const modNodes = compNode.descendantsOfType(["element_modification"]);
    for (const modNode of modNodes) {
      const modNameNode = modNode.childForFieldName("name") ?? modNode.firstNamedChild;
      const modKey = modNameNode?.text.trim().toLowerCase();
      if (modKey === "twin" || modKey === "counterpart" || modKey === "implements") {
        const strNodes = modNode.descendantsOfType(["string_literal"]);
        if (strNodes.length > 0) {
          const rawStr = strNodes[0]!.text.trim();
          const unquoted =
            (rawStr.startsWith('"') && rawStr.endsWith('"')) || (rawStr.startsWith("'") && rawStr.endsWith("'"))
              ? rawStr.slice(1, -1)
              : rawStr;
          if (unquoted) {
            result.set(varName, unquoted);
          }
        }
      }
    }
  }

  return result;
}

/**
 * Binds parsed SysML v2 requirements to a Modelica DAE's state vector indices.
 *
 * Matching strategy:
 * 1. Explicit `annotation(twin = "...RequirementId.attrName")` or `annotation(twin = "...attrName")`
 * 2. Direct state variable name match (`stateName === req.targetAttribute` or `stateName === "${req.subjectName}.${req.targetAttribute}"`)
 */
export function bindRequirementsToModelica(
  requirements: SysmlRequirement[],
  stateNames: string[],
  twinAnnotations?: Map<string, string>,
): BoundRequirement[] {
  const bound: BoundRequirement[] = [];

  for (const req of requirements) {
    let matchedIndex = -1;

    // 1. Check explicit twin annotations first
    if (twinAnnotations) {
      for (let i = 0; i < stateNames.length; i++) {
        const sName = stateNames[i]!;
        const twinTarget = twinAnnotations.get(sName);
        if (twinTarget) {
          if (
            twinTarget.endsWith(`${req.id}.${req.targetAttribute}`) ||
            twinTarget.endsWith(`::${req.targetAttribute}`) ||
            twinTarget.endsWith(`.${req.targetAttribute}`)
          ) {
            matchedIndex = i;
            break;
          }
        }
      }
    }

    // 2. Fallback to direct state name / component-qualified state name matching
    if (matchedIndex === -1) {
      for (let i = 0; i < stateNames.length; i++) {
        const sName = stateNames[i]!;
        if (
          sName === req.targetAttribute ||
          sName.endsWith(`.${req.targetAttribute}`) ||
          (req.subjectName && sName.toLowerCase() === `${req.subjectName}.${req.targetAttribute}`.toLowerCase())
        ) {
          matchedIndex = i;
          break;
        }
      }
    }

    if (matchedIndex !== -1) {
      bound.push({
        name: `${req.id}.${req.targetAttribute}`,
        stateIndex: matchedIndex,
        operator: req.operator,
        limitValue: req.limitValue,
      });
    }
  }

  return bound;
}

/**
 * Registers parsed SysML v2 requirements and Modelica twin bindings as formal
 * literal assertions inside a `SemanticTheoryCoordinator`.
 */
export function assertRequirementsToTheoryCoordinator(
  coordinator: SemanticTheoryCoordinator,
  requirements: SysmlRequirement[],
  baseLiteralId = 9000,
): void {
  let litId = baseLiteralId;
  for (const req of requirements) {
    const varName = req.subjectName ? `${req.subjectName}.${req.targetAttribute}` : req.targetAttribute;
    const bounds: [number, number] =
      req.operator === "<=" || req.operator === "<" ? [-Infinity, req.limitValue] : [req.limitValue, Infinity];

    coordinator.assertLiteral({
      id: litId++,
      predicate: "interval",
      args: [varName, bounds[0], bounds[1]],
      domain: "continuous_safety",
      sourceContext: {
        requirementId: req.id,
        operator: req.operator,
        limitValue: req.limitValue,
      },
    });
  }
}
