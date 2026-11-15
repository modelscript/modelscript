// SPDX-License-Identifier: AGPL-3.0-or-later

import { createWasmParserSync as createModelicaParserSync } from "@modelscript/modelica/parser";
import { collectCstNodes, extractCstLeafNodes, type CstNodeLike } from "@modelscript/runtime";
import { createWasmParserSync as createStepParserSync } from "@modelscript/step/parser";
import { createWasmParserSync as createSysml2ParserSync } from "@modelscript/sysml2/parser";
import { createRequire } from "node:module";
import type { ModelScriptCstNode } from "../queries.js";

export interface ModelicaComponentInfo {
  name: string;
  type: string;
  value?: number | undefined;
  properties: Record<string, unknown>;
}

export interface PolyglotParameterInfo {
  name: string;
  type: string;
  value?: number | string | boolean | undefined;
  unit?: string | undefined;
}

export interface PolyglotVariableInfo {
  name: string;
  type: string;
  variability?: "continuous" | "discrete" | "parameter" | "constant" | undefined;
  causality?: "input" | "output" | "local" | undefined;
  start?: number | undefined;
  unit?: string | undefined;
}

export interface PolyglotEquationInfo {
  lhs: string;
  rhs: string;
  kind: "equality" | "connect" | "constraint";
  rawText: string;
}

export interface PolyglotPortInfo {
  name: string;
  type: string;
  direction?: "in" | "out" | "inout" | "flow" | undefined;
  properties: Record<string, unknown>;
}

export interface PolyglotModel {
  name: string;
  language: "modelica" | "sysml2" | "step";
  components: ModelicaComponentInfo[];
  parameters: PolyglotParameterInfo[];
  variables: PolyglotVariableInfo[];
  equations: PolyglotEquationInfo[];
  ports: PolyglotPortInfo[];
}

const require = createRequire(import.meta.url);
let cachedModelicaParser: ReturnType<typeof createModelicaParserSync>["parser"] | undefined;
let cachedSysml2Parser: ReturnType<typeof createSysml2ParserSync>["parser"] | undefined;
let cachedStepParser: ReturnType<typeof createStepParserSync>["parser"] | undefined;

function getModelicaParser() {
  if (!cachedModelicaParser) {
    cachedModelicaParser = createModelicaParserSync(require.resolve("@modelscript/modelica/parser.wasm")).parser;
  }
  return cachedModelicaParser;
}

function getSysml2Parser() {
  if (!cachedSysml2Parser) {
    cachedSysml2Parser = createSysml2ParserSync(require.resolve("@modelscript/sysml2/parser.wasm")).parser;
  }
  return cachedSysml2Parser;
}

function getStepParser() {
  if (!cachedStepParser) {
    cachedStepParser = createStepParserSync(require.resolve("@modelscript/step/parser.wasm")).parser;
  }
  return cachedStepParser;
}

const MODELICA_PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);
const MODELICA_PORT_KEYWORDS = ["pin", "port", "flange", "connector", "terminal"];
const STEP_FILE_EXTENSIONS = [".step", ".stp", ".p21"];
const POLYGLOT_LANG_NAMES = new Set(["modelica", "sysml2", "sysml", "step"]);
const POLYGLOT_EXTENSIONS = [".mo", ".sysml", ".step", ".stp", ".p21"];
const SYSML_CONSTRAINT_OPS = ["==", "<=", ">=", "<", ">", "="];

interface ModifierProps {
  unit?: string | undefined;
  start?: number | undefined;
  [key: string]: unknown;
}

function getChildren(node: CstNodeLike): readonly CstNodeLike[] {
  return node.namedChildren ?? node.children ?? [];
}

function findDirectChild(node: CstNodeLike, ...types: string[]): CstNodeLike | undefined {
  return getChildren(node).find((c) => types.includes(c.type));
}

function parseTreeRoot(
  providedRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
  parseFn: (src: string) => unknown,
): CstNodeLike | undefined {
  if (providedRoot) return providedRoot as unknown as CstNodeLike;
  if (!sourceText.trim()) return undefined;
  const tree = parseFn(sourceText) as { rootNode?: CstNodeLike } | CstNodeLike | null | undefined;
  if (!tree) return undefined;
  return ("rootNode" in tree && tree.rootNode ? tree.rootNode : tree) as CstNodeLike;
}

function splitWhitespaceTokens(text: string): string[] {
  const tokens: string[] = [];
  let cur = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (ch.trim() === "") {
      if (cur) {
        tokens.push(cur);
        cur = "";
      }
    } else {
      cur += ch;
    }
  }
  if (cur) tokens.push(cur);
  return tokens;
}

function stripTrailingSemicolon(text: string): string {
  const trimmed = text.trim();
  return trimmed.endsWith(";") ? trimmed.slice(0, -1).trimEnd() : trimmed;
}

function stripLeadingChars(text: string, chars: string): string {
  let idx = 0;
  while (idx < text.length) {
    const ch = text[idx]!;
    if (chars.includes(ch) || ch.trim() === "") {
      idx++;
    } else {
      break;
    }
  }
  return text.slice(idx).trim();
}

function stripOuter(text: string, open: string, close: string): string {
  const trimmed = text.trim();
  if (trimmed.length >= open.length + close.length && trimmed.startsWith(open) && trimmed.endsWith(close)) {
    return trimmed.slice(open.length, trimmed.length - close.length).trim();
  }
  return trimmed;
}

function unquoteDoubleString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith('"') && trimmed.endsWith('"')) {
    return trimmed.slice(1, -1);
  }
  return trimmed;
}

function unquoteStepString(raw: string): string {
  const trimmed = raw.trim();
  if (trimmed.length >= 2 && trimmed.startsWith("'") && trimmed.endsWith("'")) {
    return trimmed.slice(1, -1).split("''").join("'");
  }
  return trimmed;
}

function parseNumberStrict(raw: string): number | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  const first = t[0]!;
  const startsNumeric = (first >= "0" && first <= "9") || first === "." || first === "+" || first === "-";
  if (!startsNumeric) return undefined;
  const n = Number(t);
  return !Number.isNaN(n) && Number.isFinite(n) ? n : undefined;
}

function parseTypedLiteral(raw: string): number | string | boolean | undefined {
  const t = raw.trim();
  if (!t) return undefined;
  if (t.length >= 2 && t.startsWith('"') && t.endsWith('"')) {
    return t.slice(1, -1);
  }
  if (t === "true") return true;
  if (t === "false") return false;
  const num = parseNumberStrict(t);
  if (num !== undefined) return num;
  return t;
}

function isModelicaPortType(typeName: string): boolean {
  const lower = typeName.toLowerCase();
  return MODELICA_PORT_KEYWORDS.some((kw) => lower.includes(kw));
}

function stripStepFileExtension(name: string): string {
  const lower = name.toLowerCase();
  for (const ext of STEP_FILE_EXTENSIONS) {
    if (lower.endsWith(ext)) {
      return name.slice(0, -ext.length);
    }
  }
  return name;
}

function extractModelicaModifiersFromNode(modNode: CstNodeLike | undefined): ModifierProps {
  const props: ModifierProps = {};
  if (!modNode) return props;

  const elemMods = collectCstNodes(modNode, ["element_modification", "ElementModification"]);
  for (const elemMod of elemMods) {
    const keyNode = findDirectChild(elemMod, "name", "Name", "identifier", "Identifier");
    const key = keyNode?.text?.trim();
    if (!key) continue;

    const valMod = findDirectChild(elemMod, "modification", "Modification");
    if (!valMod) continue;

    const modExpr = findDirectChild(valMod, "modification_expression", "ModificationExpression");
    const rawVal = modExpr ? stripLeadingChars(modExpr.text, "=") : stripLeadingChars(valMod.text, "=");
    const parsed = parseTypedLiteral(rawVal);
    if (parsed !== undefined) {
      props[key] = parsed;
    }
  }
  return props;
}

function extractLeadingSysmlDirection(node: CstNodeLike): "in" | "out" | "inout" | undefined {
  const leaves = extractCstLeafNodes(node);
  for (const leaf of leaves) {
    const tok = leaf.text.trim();
    if (tok === "in" || tok === "out" || tok === "inout") return tok;
    if (tok === "attribute" || tok === "port" || tok === "part") break;
  }
  return undefined;
}

function extractSysmlQualifiedType(typeNode: CstNodeLike | undefined): string {
  if (!typeNode) return "";
  const qn = collectCstNodes(typeNode, ["QualifiedName"])[0];
  if (qn?.text?.trim()) {
    const raw = qn.text.trim();
    return typeNode.text.trimStart().includes("~") && !raw.startsWith("~") ? `~${raw}` : raw;
  }
  return stripLeadingChars(typeNode.text, ":>");
}

/**
 * Extracts structured parameters, variables, equations, ports, and component declarations
 * from a Modelica (`.mo`) CST root node and/or source text.
 */
export function extractModelicaModel(
  modelicaTreeRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
): PolyglotModel {
  const components: ModelicaComponentInfo[] = [];
  const parameters: PolyglotParameterInfo[] = [];
  const variables: PolyglotVariableInfo[] = [];
  const equations: PolyglotEquationInfo[] = [];
  const ports: PolyglotPortInfo[] = [];
  let modelName = "AnonymousModel";

  const root = parseTreeRoot(modelicaTreeRoot, sourceText, (src) => getModelicaParser().parse(src));
  if (!root) {
    return { name: modelName, language: "modelica", components, parameters, variables, equations, ports };
  }

  const classDef = collectCstNodes(root, ["class_definition", "ClassDefinition", "model_clause"])[0];
  if (classDef) {
    const fieldName =
      (classDef as ModelScriptCstNode).childForFieldName?.("name")?.text?.trim() ||
      (classDef as ModelScriptCstNode).childForFieldName?.("identifier")?.text?.trim();
    if (fieldName) {
      modelName = fieldName;
    } else {
      const spec =
        collectCstNodes(classDef, [
          "long_class_specifier",
          "LongClassSpecifier",
          "short_class_specifier",
          "ShortClassSpecifier",
        ])[0] ?? classDef;
      const idNode = findDirectChild(spec, "identifier", "Identifier");
      if (idNode?.text?.trim()) {
        modelName = idNode.text.trim();
      }
    }
  }

  const compClauses = collectCstNodes(root, ["component_clause", "ComponentClause"]);
  for (const clause of compClauses) {
    const prefixNode =
      (clause as ModelScriptCstNode).childForFieldName?.("type_prefix") ??
      findDirectChild(clause, "type_prefix", "TypePrefix");
    const prefixTokens = new Set(splitWhitespaceTokens(prefixNode?.text ?? ""));

    const typeNode =
      (clause as ModelScriptCstNode).childForFieldName?.("type_specifier") ??
      findDirectChild(clause, "type_specifier", "TypeSpecifier");
    const typeName = typeNode?.text?.trim() || "UnknownType";

    let compDecls = collectCstNodes(clause, ["component_declaration", "ComponentDeclaration"]);
    if (compDecls.length === 0) {
      compDecls = getChildren(clause).filter((c) => c.type === "declaration" || c.type === "Declaration");
    }

    for (const compDecl of compDecls) {
      const decl = findDirectChild(compDecl, "declaration", "Declaration") ?? compDecl;
      const idNode =
        (decl as ModelScriptCstNode).childForFieldName?.("identifier") ??
        (decl as ModelScriptCstNode).childForFieldName?.("name") ??
        findDirectChild(decl, "identifier", "Identifier") ??
        findDirectChild(compDecl, "identifier", "Identifier");
      const name = idNode?.text?.trim() || "unnamed";

      const modNode =
        (decl as ModelScriptCstNode).childForFieldName?.("modification") ??
        findDirectChild(decl, "modification", "Modification") ??
        findDirectChild(compDecl, "modification", "Modification");

      const directModExpr = modNode
        ? findDirectChild(modNode, "modification_expression", "ModificationExpression")
        : undefined;
      const rawAssign = directModExpr ? stripLeadingChars(directModExpr.text, "=") : undefined;
      const numVal = rawAssign !== undefined ? parseNumberStrict(rawAssign) : undefined;
      const typedAssign = rawAssign !== undefined ? parseTypedLiteral(rawAssign) : undefined;
      const modProps = extractModelicaModifiersFromNode(modNode);

      components.push({
        name,
        type: typeName,
        value: numVal,
        properties: { rawText: compDecl.text, ...modProps },
      });

      if (prefixTokens.has("parameter") || prefixTokens.has("constant")) {
        parameters.push({
          name,
          type: typeName,
          value: typedAssign,
          unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
        });
      } else if (
        prefixTokens.has("input") ||
        prefixTokens.has("output") ||
        prefixTokens.has("flow") ||
        isModelicaPortType(typeName)
      ) {
        const direction = prefixTokens.has("input")
          ? "in"
          : prefixTokens.has("output")
            ? "out"
            : prefixTokens.has("flow")
              ? "flow"
              : "inout";
        ports.push({
          name,
          type: typeName,
          direction,
          properties: modProps,
        });
        if (MODELICA_PRIMITIVE_TYPES.has(typeName)) {
          variables.push({
            name,
            type: typeName,
            variability: "continuous",
            causality: direction === "in" ? "input" : direction === "out" ? "output" : "local",
            start: typeof modProps.start === "number" ? modProps.start : numVal,
            unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
          });
        }
      } else {
        variables.push({
          name,
          type: typeName,
          variability: prefixTokens.has("discrete") ? "discrete" : "continuous",
          causality: "local",
          start: typeof modProps.start === "number" ? modProps.start : numVal,
          unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
        });
      }
    }
  }

  const connectEqs = collectCstNodes(root, ["connect_equation", "connect_clause", "ConnectEquation", "ConnectClause"]);
  for (const connEq of connectEqs) {
    const directRefs = getChildren(connEq).filter(
      (c) => c.type === "component_reference" || c.type === "ComponentReference",
    );
    const refs =
      directRefs.length >= 2 ? directRefs : collectCstNodes(connEq, ["component_reference", "ComponentReference"]);
    if (refs.length >= 2) {
      equations.push({
        lhs: refs[0]!.text.trim(),
        rhs: refs[1]!.text.trim(),
        kind: "connect",
        rawText: stripTrailingSemicolon(connEq.text),
      });
    }
  }

  const simpleEqs = collectCstNodes(root, ["simple_equation", "equality_equation", "SimpleEquation"]);
  for (const eq of simpleEqs) {
    const lhsNode =
      (eq as ModelScriptCstNode).childForFieldName?.("lhs") ??
      (eq as ModelScriptCstNode).childForFieldName?.("left") ??
      findDirectChild(eq, "lhs_expression", "LhsExpression");
    const rhsNode =
      (eq as ModelScriptCstNode).childForFieldName?.("rhs") ??
      (eq as ModelScriptCstNode).childForFieldName?.("right") ??
      findDirectChild(eq, "expression", "Expression");
    const rawText = stripTrailingSemicolon(eq.text);
    if (lhsNode && rhsNode) {
      equations.push({
        lhs: lhsNode.text.trim(),
        rhs: rhsNode.text.trim(),
        kind: "equality",
        rawText,
      });
    } else {
      const eqIdx = rawText.indexOf("=");
      if (eqIdx > 0) {
        equations.push({
          lhs: rawText.slice(0, eqIdx).trim(),
          rhs: rawText.slice(eqIdx + 1).trim(),
          kind: "equality",
          rawText,
        });
      }
    }
  }

  return {
    name: modelName,
    language: "modelica",
    components,
    parameters,
    variables,
    equations,
    ports,
  };
}

function splitSysmlConstraintExpression(body: string): { lhs: string; rhs: string } | undefined {
  for (const op of SYSML_CONSTRAINT_OPS) {
    const idx = body.indexOf(op);
    if (idx > 0) {
      return {
        lhs: body.slice(0, idx).trim(),
        rhs: body.slice(idx + op.length).trim(),
      };
    }
  }
  return undefined;
}

/**
 * Extracts structured parameters, variables, ports, part usages, and constraints/connections
 * from a SysML v2 (`.sysml`) CST root node and/or source text.
 */
export function extractSysML2Model(
  sysmlTreeRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
): PolyglotModel {
  const components: ModelicaComponentInfo[] = [];
  const parameters: PolyglotParameterInfo[] = [];
  const variables: PolyglotVariableInfo[] = [];
  const equations: PolyglotEquationInfo[] = [];
  const ports: PolyglotPortInfo[] = [];
  let modelName = "AnonymousSysMLModel";

  const root = parseTreeRoot(sysmlTreeRoot, sourceText, (src) => getSysml2Parser().parse(src));
  if (!root) {
    return { name: modelName, language: "sysml2", components, parameters, variables, equations, ports };
  }

  const headerContainer = collectCstNodes(root, ["Package", "PartDefinition", "PartDef", "PartUsage"])[0];
  if (headerContainer) {
    const headerNameNode =
      (headerContainer as ModelScriptCstNode).childForFieldName?.("name") ??
      (headerContainer as ModelScriptCstNode).childForFieldName?.("id") ??
      findDirectChild(headerContainer, "Name");
    if (headerNameNode?.text?.trim()) {
      modelName = headerNameNode.text.trim();
    }
  }

  const attrUsages = collectCstNodes(root, ["AttributeUsage", "AttributeDeclaration"]);
  for (const au of attrUsages) {
    const nameNode = (au as ModelScriptCstNode).childForFieldName?.("name") ?? findDirectChild(au, "Name");
    const typeNode =
      (au as ModelScriptCstNode).childForFieldName?.("type") ??
      (au as ModelScriptCstNode).childForFieldName?.("typeName") ??
      findDirectChild(au, "FeatureTyping");
    const valNode =
      (au as ModelScriptCstNode).childForFieldName?.("value") ??
      (au as ModelScriptCstNode).childForFieldName?.("defaultValue") ??
      findDirectChild(au, "FeatureValue");
    const dirNode = (au as ModelScriptCstNode).childForFieldName?.("direction");

    const attrName = nameNode?.text?.trim();
    const attrType = typeNode ? extractSysmlQualifiedType(typeNode) : "Real";
    if (!attrName || !attrType) continue;

    const dir = (dirNode?.text?.trim() as "in" | "out" | "inout" | undefined) ?? extractLeadingSysmlDirection(au);
    const multNode = findDirectChild(au, "OwnedMultiplicity") ?? collectCstNodes(au, ["BracketExpression"])[0];
    let unit = multNode ? stripOuter(multNode.text, "[", "]") : undefined;

    let rawVal: string | undefined;
    if (valNode) {
      const exprNode = findDirectChild(valNode, "OwnedExpression") ?? collectCstNodes(valNode, ["OwnedExpression"])[0];
      rawVal = stripLeadingChars((exprNode ?? valNode).text, "=:");
      if (!unit && rawVal.includes("[") && rawVal.endsWith("]")) {
        const openBracket = rawVal.lastIndexOf("[");
        if (openBracket > 0) {
          unit = rawVal.slice(openBracket + 1, -1).trim();
          rawVal = rawVal.slice(0, openBracket).trim();
        }
      }
    }

    const numVal = rawVal !== undefined ? parseNumberStrict(rawVal) : undefined;
    components.push({
      name: attrName,
      type: attrType,
      value: numVal,
      properties: { ...(unit ? { unit } : {}), ...(dir ? { direction: dir } : {}) },
    });

    if (rawVal !== undefined && !dir) {
      const parsedVal =
        numVal !== undefined
          ? numVal
          : rawVal === "true"
            ? true
            : rawVal === "false"
              ? false
              : unquoteDoubleString(rawVal);
      parameters.push({
        name: attrName,
        type: attrType,
        value: parsedVal,
        unit,
      });
    } else {
      variables.push({
        name: attrName,
        type: attrType,
        variability: "continuous",
        causality: dir === "in" ? "input" : dir === "out" ? "output" : "local",
        start: numVal,
        unit,
      });
    }
  }

  const portUsages = collectCstNodes(root, ["PortUsage", "PortDeclaration"]);
  for (const pu of portUsages) {
    const featureTypings = getChildren(pu).filter((c) => c.type === "FeatureTyping");
    const nameNode = (pu as ModelScriptCstNode).childForFieldName?.("name") ?? findDirectChild(pu, "Name");
    const typeNode =
      (pu as ModelScriptCstNode).childForFieldName?.("type") ??
      (pu as ModelScriptCstNode).childForFieldName?.("typeName") ??
      featureTypings[featureTypings.length - 1];

    const portName =
      nameNode?.text?.trim() ?? (featureTypings.length >= 2 ? stripLeadingChars(featureTypings[0]!.text, ":~") : "");
    const portType = typeNode ? extractSysmlQualifiedType(typeNode) : "";
    if (!portName || !portType) continue;

    const dir =
      ((pu as ModelScriptCstNode).childForFieldName?.("direction")?.text?.trim() as
        | "in"
        | "out"
        | "inout"
        | undefined) ??
      extractLeadingSysmlDirection(pu) ??
      "inout";
    ports.push({ name: portName, type: portType, direction: dir, properties: {} });
    components.push({ name: portName, type: portType, properties: { kind: "port", direction: dir } });
  }

  const partUsages = collectCstNodes(root, ["PartUsage"]);
  for (const part of partUsages) {
    const partName = findDirectChild(part, "Name")?.text?.trim();
    const typeNode = findDirectChild(part, "FeatureTyping");
    const partType = typeNode ? extractSysmlQualifiedType(typeNode) : "";
    if (!partName || !partType) continue;
    components.push({
      name: partName,
      type: partType,
      properties: { kind: "part" },
    });
  }

  const connUsages = collectCstNodes(root, ["ConnectionUsage"]);
  for (const cu of connUsages) {
    const endMembers = collectCstNodes(cu, ["ConnectorEndMember"]);
    if (endMembers.length >= 2) {
      equations.push({
        lhs: endMembers[0]!.text.trim(),
        rhs: endMembers[1]!.text.trim(),
        kind: "connect",
        rawText: stripTrailingSemicolon(cu.text),
      });
    }
  }

  const bindUsages = collectCstNodes(root, ["BindingConnectorAsUsage"]);
  for (const bu of bindUsages) {
    const endMembers = collectCstNodes(bu, ["ConnectorEndMember"]);
    if (endMembers.length >= 2) {
      equations.push({
        lhs: endMembers[0]!.text.trim(),
        rhs: endMembers[1]!.text.trim(),
        kind: "connect",
        rawText: stripTrailingSemicolon(bu.text),
      });
    } else {
      const leaves = extractCstLeafNodes(bu);
      const eqPos = leaves.findIndex((l) => l.text.trim() === "=");
      if (eqPos > 0) {
        const lhsTokens = leaves.slice(0, eqPos).filter((l) => l.text.trim() !== "bind");
        const rhsTokens = leaves.slice(eqPos + 1).filter((l) => l.text.trim() !== ";");
        const lhs = lhsTokens
          .map((t) => t.text)
          .join("")
          .trim();
        const rhs = rhsTokens
          .map((t) => t.text)
          .join("")
          .trim();
        if (lhs && rhs) {
          equations.push({
            lhs,
            rhs,
            kind: "connect",
            rawText: stripTrailingSemicolon(bu.text),
          });
        }
      }
    }
  }

  const constraintUsages = collectCstNodes(root, ["ConstraintUsage", "AssertConstraintUsage"]);
  for (const cu of constraintUsages) {
    const exprNode =
      collectCstNodes(cu, ["RelationalExpression", "EqualityExpression", "OwnedExpression"])[0] ??
      collectCstNodes(cu, ["ResultExpressionMember"])[0];
    let body = exprNode?.text?.trim() ?? "";
    if (!body) {
      const braceIdx = cu.text.indexOf("{");
      const closeIdx = cu.text.lastIndexOf("}");
      if (braceIdx !== -1 && closeIdx > braceIdx) {
        body = cu.text.slice(braceIdx + 1, closeIdx);
      }
    }
    body = stripTrailingSemicolon(body);
    if (!body) continue;

    const split = splitSysmlConstraintExpression(body);
    if (split) {
      equations.push({
        lhs: split.lhs,
        rhs: split.rhs,
        kind: "constraint",
        rawText: body,
      });
    }
  }

  return {
    name: modelName,
    language: "sysml2",
    components,
    parameters,
    variables,
    equations,
    ports,
  };
}

function parseStepTreeWithNormalization(
  stepTreeRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
): CstNodeLike | undefined {
  if (stepTreeRoot) return stepTreeRoot as unknown as CstNodeLike;
  if (!sourceText.trim()) return undefined;
  const parser = getStepParser();
  let tree = parser.parse(sourceText);
  let root = tree ? ((tree.rootNode ?? tree) as unknown as CstNodeLike) : undefined;
  const instances = root ? collectCstNodes(root, ["EntityInstance", "entity_instance", "simple_entity_instance"]) : [];
  if (instances.length === 0 && sourceText.includes("#")) {
    const upper = sourceText.toUpperCase();
    let normalized = sourceText;
    if (!upper.includes("ISO-10303-21")) {
      normalized = `ISO-10303-21;\nHEADER;\nENDSEC;\nDATA;\n${sourceText}\nENDSEC;\nEND-ISO-10303-21;\n`;
    } else if (upper.includes("DATA;") && !upper.includes("HEADER;")) {
      const dataIdx = upper.indexOf("DATA;");
      normalized = `${sourceText.slice(0, dataIdx)}HEADER;\nENDSEC;\n${sourceText.slice(dataIdx)}`;
    }
    if (normalized !== sourceText) {
      tree = parser.parse(normalized);
      root = tree ? ((tree.rootNode ?? tree) as unknown as CstNodeLike) : undefined;
    }
  }
  return root;
}

function parseStepParameterLeaves(paramNode: CstNodeLike): {
  firstString: string | undefined;
  nums: number[];
  refs: string[];
} {
  let firstString: string | undefined;
  const nums: number[] = [];
  const refs: string[] = [];
  const leaves = extractCstLeafNodes(paramNode);
  let pendingSign = "";

  for (const leaf of leaves) {
    const text = leaf.text ?? "";
    if (leaf.type === "STRING") {
      pendingSign = "";
      if (firstString === undefined) {
        firstString = unquoteStepString(text);
      }
      continue;
    }
    if (leaf.type === "ENTITY_INSTANCE_NAME") {
      pendingSign = "";
      const ref = text.trim();
      if (ref.startsWith("#")) refs.push(ref);
      continue;
    }
    if (text === "-" || text === "+") {
      pendingSign = text;
      continue;
    }
    if (leaf.type === "REAL" || leaf.type === "INTEGER") {
      const val = Number(pendingSign + text.trim());
      pendingSign = "";
      if (!Number.isNaN(val)) {
        nums.push(val);
      }
      continue;
    }
    pendingSign = "";
  }

  return { firstString, nums, refs };
}

/**
 * Extracts structured geometric/product entities, parameters, ports (placements/mates),
 * and assembly relationships from an ISO 10303-21 STEP (`.step` / `.stp`) CST root node and/or source text.
 */
export function extractStepModel(
  stepTreeRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
): PolyglotModel {
  const components: ModelicaComponentInfo[] = [];
  const parameters: PolyglotParameterInfo[] = [];
  const variables: PolyglotVariableInfo[] = [];
  const equations: PolyglotEquationInfo[] = [];
  const ports: PolyglotPortInfo[] = [];

  let modelName = "AnonymousStepModel";
  const root = parseStepTreeWithNormalization(stepTreeRoot, sourceText);
  if (!root) {
    return { name: modelName, language: "step", components, parameters, variables, equations, ports };
  }

  const headerEntities = collectCstNodes(root, ["HeaderEntity"]);
  for (const hdr of headerEntities) {
    const kwNode = findDirectChild(hdr, "KEYWORD");
    if (kwNode?.text?.trim().toUpperCase() === "FILE_NAME") {
      const firstStrNode = collectCstNodes(hdr, ["STRING"])[0];
      const fileName = firstStrNode ? unquoteStepString(firstStrNode.text).trim() : "";
      if (fileName) {
        modelName = stripStepFileExtension(fileName);
        break;
      }
    }
  }

  const entities = collectCstNodes(root, ["EntityInstance", "entity_instance", "simple_entity_instance"]);
  for (const ent of entities) {
    const idNode = findDirectChild(ent, "ENTITY_INSTANCE_NAME");
    const simpleRec = collectCstNodes(ent, ["SimpleRecord"])[0];
    if (!idNode || !simpleRec) continue;

    const id = idNode.text.trim();
    const kwNode = findDirectChild(simpleRec, "KEYWORD");
    const entityType = kwNode?.text?.trim().toUpperCase() ?? "";
    if (!entityType) continue;

    const paramListNode = findDirectChild(simpleRec, "ParameterList") ?? simpleRec;
    const argsRaw = paramListNode !== simpleRec ? stripOuter(paramListNode.text, "(", ")") : "";
    const { firstString, nums, refs } = parseStepParameterLeaves(paramListNode);
    const label = firstString !== undefined && firstString !== "" ? firstString : id;
    const firstNum = nums[0];

    if (entityType === "PRODUCT" && firstString && modelName === "AnonymousStepModel") {
      modelName = firstString;
    }

    components.push({
      name: label !== id && label !== "" ? label : id,
      type: entityType,
      value: firstNum,
      properties: { stepId: id, rawArgs: argsRaw, values: nums },
    });

    if (
      entityType.includes("MEASURE") ||
      entityType === "CARTESIAN_POINT" ||
      entityType === "CIRCLE" ||
      entityType === "CYLINDRICAL_SURFACE"
    ) {
      parameters.push({
        name: label !== "" ? `${id}_${label}` : id,
        type: entityType,
        value: firstNum,
      });
    } else if (entityType.startsWith("AXIS2_PLACEMENT") || entityType === "CONNECTOR") {
      ports.push({
        name: label !== "" ? label : id,
        type: entityType,
        direction: "inout",
        properties: { stepId: id },
      });
    } else if (
      entityType === "NEXT_ASSEMBLY_USAGE_OCCURRENCE" ||
      entityType === "SHAPE_REPRESENTATION_RELATIONSHIP" ||
      entityType === "ITEM_DEFINED_TRANSFORMATION"
    ) {
      ports.push({
        name: label !== "" ? label : id,
        type: entityType,
        direction: "inout",
        properties: { stepId: id, references: refs },
      });
      if (refs.length >= 2) {
        equations.push({
          lhs: refs[refs.length - 2]!,
          rhs: refs[refs.length - 1]!,
          kind: "connect",
          rawText: `${id} = ${entityType}(${argsRaw})`,
        });
      }
    } else {
      variables.push({
        name: label !== "" ? label : id,
        type: entityType,
        variability: "constant",
        causality: "local",
        start: firstNum,
      });
    }
  }

  return {
    name: modelName,
    language: "step",
    components,
    parameters,
    variables,
    equations,
    ports,
  };
}

/**
 * Dispatches polyglot model extraction across Modelica (`.mo`), SysML v2 (`.sysml`),
 * and STEP (`.step` / `.stp`) sources.
 */
export function resolvePolyglotModel(
  sourceOrPath: string,
  languageOrSource: string,
  treeRoot?: ModelScriptCstNode | null,
): PolyglotModel {
  const firstTrimmed = sourceOrPath.trim().toLowerCase();
  const firstIsLangOrPath =
    !sourceOrPath.includes("\n") &&
    (POLYGLOT_LANG_NAMES.has(firstTrimmed) || POLYGLOT_EXTENSIONS.some((ext) => firstTrimmed.endsWith(ext)));
  const sourceText = firstIsLangOrPath ? languageOrSource : sourceOrPath;
  const languageOrPath = firstIsLangOrPath ? sourceOrPath : languageOrSource;
  const lower = languageOrPath.toLowerCase().trim();
  if (lower === "sysml2" || lower === "sysml" || lower.endsWith(".sysml")) {
    return extractSysML2Model(treeRoot, sourceText);
  }
  if (lower === "step" || lower.endsWith(".step") || lower.endsWith(".stp") || lower.endsWith(".p21")) {
    return extractStepModel(treeRoot, sourceText);
  }
  return extractModelicaModel(treeRoot, sourceText);
}
