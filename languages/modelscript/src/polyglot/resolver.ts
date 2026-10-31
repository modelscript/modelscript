// SPDX-License-Identifier: AGPL-3.0-or-later

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

const MODELICA_PRIMITIVE_TYPES = new Set(["Real", "Integer", "Boolean", "String"]);
const MODELICA_KEYWORDS = new Set([
  "model",
  "class",
  "package",
  "record",
  "block",
  "connector",
  "type",
  "function",
  "end",
  "equation",
  "initial",
  "algorithm",
  "annotation",
  "extends",
  "import",
  "within",
  "public",
  "protected",
  "connect",
  "der",
  "if",
  "then",
  "else",
  "elseif",
  "for",
  "loop",
  "when",
  "elsewhen",
  "while",
  "return",
]);

interface ModifierProps {
  unit?: string | undefined;
  start?: number | undefined;
  [key: string]: unknown;
}

function parseModifierProps(modStr: string | undefined): ModifierProps {
  const props: ModifierProps = {};
  if (!modStr) return props;
  const inner = modStr.trim().replace(/^\(|\)$/g, "");
  const pairRegex =
    /([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(?:"([^"]*)"|([+-]?\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)|(true|false)|([A-Za-z_][A-Za-z0-9_.]*))/g;
  let m: RegExpExecArray | null;
  while ((m = pairRegex.exec(inner)) !== null) {
    const key = m[1]!;
    if (m[2] !== undefined) props[key] = m[2];
    else if (m[3] !== undefined) props[key] = parseFloat(m[3]);
    else if (m[4] !== undefined) props[key] = m[4] === "true";
    else if (m[5] !== undefined) props[key] = m[5];
  }
  return props;
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

  function walk(node: ModelScriptCstNode | null | undefined): void {
    if (!node) return;

    if (node.type === "class_definition" || node.type === "model_clause") {
      const idNode = node.childForFieldName?.("name") || node.childForFieldName?.("identifier");
      if (idNode?.text) modelName = idNode.text;
    }

    if (node.type === "component_clause" || node.type === "ComponentClause") {
      const prefixNode = node.childForFieldName?.("type_prefix");
      const prefixText = prefixNode?.text ?? "";
      const typeNode = node.childForFieldName?.("type_specifier") || node.children?.[0];
      const typeName = typeNode ? typeNode.text : "UnknownType";

      for (let i = 0; i < node.childCount; i++) {
        const c = node.child(i);
        if (
          c &&
          (c.type === "component_declaration" || c.type === "ComponentDeclaration" || c.type === "declaration")
        ) {
          const id = c.childForFieldName?.("identifier") || c.childForFieldName?.("name");
          const name = id ? id.text : "unnamed";

          let val: number | undefined;
          const match = c.text.match(/=\s*([+-]?[0-9]+(?:\.[0-9]+)?(?:[eE][+-]?[0-9]+)?)/);
          if (match?.[1]) {
            val = parseFloat(match[1]);
          }
          const modMatch = c.text.match(/\(([^)]*)\)/);
          const modProps = parseModifierProps(modMatch?.[1]);

          components.push({
            name,
            type: typeName,
            value: val,
            properties: { rawText: c.text, ...modProps },
          });

          if (/\b(?:parameter|constant)\b/.test(prefixText)) {
            parameters.push({
              name,
              type: typeName,
              value: val,
              unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
            });
          } else if (/\b(?:input|output|flow)\b/.test(prefixText) || /Pin|Port|Flange|Connector/i.test(typeName)) {
            ports.push({
              name,
              type: typeName,
              direction: /\binput\b/.test(prefixText)
                ? "in"
                : /\boutput\b/.test(prefixText)
                  ? "out"
                  : /\bflow\b/.test(prefixText)
                    ? "flow"
                    : "inout",
              properties: modProps,
            });
          } else {
            variables.push({
              name,
              type: typeName,
              variability: /\bdiscrete\b/.test(prefixText) ? "discrete" : "continuous",
              causality: "local",
              start: typeof modProps.start === "number" ? modProps.start : val,
              unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
            });
          }
        }
      }
    }

    for (let i = 0; i < node.childCount; i++) {
      walk(node.child(i));
    }
  }

  walk(modelicaTreeRoot);

  // Extract model name from source text if not found in CST
  if (modelName === "AnonymousModel" && sourceText) {
    const headerMatch = sourceText.match(/\b(?:model|class|block|connector|record|package)\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (headerMatch?.[1]) {
      modelName = headerMatch[1];
    }
  }

  // Split sourceText into declaration area and equation section(s)
  const cleanSource = sourceText.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const eqSectionMatch = cleanSource.match(
    /\bequation\b([\s\S]*?)(?:\b(?:algorithm|initial\s+equation|initial\s+algorithm|end\s+[A-Za-z0-9_]+)\b|$)/,
  );
  const declSection = eqSectionMatch ? cleanSource.slice(0, eqSectionMatch.index) : cleanSource;
  const eqSection = eqSectionMatch?.[1] ?? "";

  if (components.length === 0 && declSection) {
    const stmtLines = declSection
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);

    for (const rawLine of stmtLines) {
      // Strip leading model/class header if attached to the first declaration
      const line = rawLine
        .replace(
          /^(?:(?:partial|encapsulated|expandable)\s+)*(?:model|class|block|connector|record|package)\s+[A-Za-z_][A-Za-z0-9_]*(?:\s+"[^"]*")?\s*/,
          "",
        )
        .trim();
      if (!line) continue;

      const declMatch = line.match(
        /^(?:(parameter|constant|discrete|flow|stream|input|output)\s+)*([A-Za-z_][A-Za-z0-9_.]*)\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\([^)]*\))?\s*(?:=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|"[^"]*"|true|false))?/,
      );
      if (!declMatch) continue;

      const prefix = declMatch[1] ?? "";
      const typeName = declMatch[2]!;
      const compName = declMatch[3]!;
      const modStr = declMatch[4];
      const rawVal = declMatch[5];

      if (MODELICA_KEYWORDS.has(typeName) || MODELICA_KEYWORDS.has(compName)) continue;

      const modProps = parseModifierProps(modStr);
      const numVal = rawVal !== undefined && /^[+-]?(?:\d|\.)/.test(rawVal) ? parseFloat(rawVal) : undefined;

      components.push({
        type: typeName,
        name: compName,
        value: numVal,
        properties: modProps,
      });

      if (prefix === "parameter" || prefix === "constant") {
        parameters.push({
          name: compName,
          type: typeName,
          value:
            numVal !== undefined
              ? numVal
              : rawVal === "true"
                ? true
                : rawVal === "false"
                  ? false
                  : rawVal?.replace(/^"|"$/g, ""),
          unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
        });
      } else if (
        prefix === "input" ||
        prefix === "output" ||
        prefix === "flow" ||
        /Pin|Port|Flange|Connector|Terminal/i.test(typeName)
      ) {
        ports.push({
          name: compName,
          type: typeName,
          direction: prefix === "input" ? "in" : prefix === "output" ? "out" : prefix === "flow" ? "flow" : "inout",
          properties: modProps,
        });
        if (MODELICA_PRIMITIVE_TYPES.has(typeName)) {
          variables.push({
            name: compName,
            type: typeName,
            variability: "continuous",
            causality: prefix === "input" ? "input" : prefix === "output" ? "output" : "local",
            start: typeof modProps.start === "number" ? modProps.start : numVal,
            unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
          });
        }
      } else {
        variables.push({
          name: compName,
          type: typeName,
          variability: prefix === "discrete" ? "discrete" : "continuous",
          causality: "local",
          start: typeof modProps.start === "number" ? modProps.start : numVal,
          unit: typeof modProps.unit === "string" ? modProps.unit : undefined,
        });
      }
    }
  }

  // Extract equations from equation section
  if (eqSection) {
    const eqStmts = eqSection
      .split(";")
      .map((s) => s.trim())
      .filter(Boolean);
    for (const stmt of eqStmts) {
      if (stmt.startsWith("annotation")) continue;
      const connMatch = stmt.match(/^connect\s*\(\s*([^,]+?)\s*,\s*([^)]+?)\s*\)/);
      if (connMatch) {
        equations.push({
          lhs: connMatch[1]!.trim(),
          rhs: connMatch[2]!.trim(),
          kind: "connect",
          rawText: stmt,
        });
        continue;
      }
      const eqIdx = stmt.indexOf("=");
      if (eqIdx > 0) {
        equations.push({
          lhs: stmt.slice(0, eqIdx).trim(),
          rhs: stmt.slice(eqIdx + 1).trim(),
          kind: "equality",
          rawText: stmt,
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

/**
 * Extracts structured parameters, variables, ports, part usages, and constraints/connections
 * from a SysML v2 (`.sysml`) model.
 */
export function extractSysML2Model(
  _sysmlTreeRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
): PolyglotModel {
  const components: ModelicaComponentInfo[] = [];
  const parameters: PolyglotParameterInfo[] = [];
  const variables: PolyglotVariableInfo[] = [];
  const equations: PolyglotEquationInfo[] = [];
  const ports: PolyglotPortInfo[] = [];

  const clean = sourceText.replace(/\/\/[^\n]*/g, "").replace(/\/\*[\s\S]*?\*\//g, "");
  const nameMatch = clean.match(/\b(?:package|part\s+def|part)\s+([A-Za-z_][A-Za-z0-9_]*)/);
  const modelName = nameMatch?.[1] ?? "AnonymousSysMLModel";

  // 1. Extract attribute declarations: `attribute mass : Real = 1200 [kg];` or `in attribute v : Real;`
  const attrRegex =
    /\b(?:(in|out|inout)\s+)?attribute\s+([A-Za-z_][A-Za-z0-9_]*)\s*(?::>?|:)\s*([A-Za-z_][A-Za-z0-9_:]*)(?:\s*\[([^\]]+)\])?(?:\s*=\s*([+-]?(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?|"[^"]*"|true|false))?/g;
  let m: RegExpExecArray | null;
  while ((m = attrRegex.exec(clean)) !== null) {
    const dir = m[1];
    const attrName = m[2]!;
    const attrType = m[3]!;
    const unit = m[4]?.trim();
    const rawVal = m[5];
    const numVal = rawVal !== undefined && /^[+-]?(?:\d|\.)/.test(rawVal) ? parseFloat(rawVal) : undefined;

    components.push({
      name: attrName,
      type: attrType,
      value: numVal,
      properties: { ...(unit ? { unit } : {}), ...(dir ? { direction: dir } : {}) },
    });

    if (rawVal !== undefined && !dir) {
      parameters.push({
        name: attrName,
        type: attrType,
        value: numVal ?? rawVal.replace(/^"|"$/g, ""),
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

  // 2. Extract port declarations: `in port p_in : PowerPort;` or `port fuelPort : FuelInterface;`
  const portRegex =
    /\b(?:(in|out|inout)\s+)?port\s+(?!def\b)([A-Za-z_][A-Za-z0-9_]*)\s*(?::>?|:)\s*([A-Za-z_][A-Za-z0-9_:.~]*)/g;
  while ((m = portRegex.exec(clean)) !== null) {
    const dir = (m[1] as "in" | "out" | "inout" | undefined) ?? "inout";
    const portName = m[2]!;
    const portType = m[3]!;
    ports.push({
      name: portName,
      type: portType,
      direction: dir,
      properties: {},
    });
    components.push({
      name: portName,
      type: portType,
      properties: { kind: "port", direction: dir },
    });
  }

  // 3. Extract part usages: `part engine : Engine;`
  const partRegex = /\bpart\s+(?!def\b)([A-Za-z_][A-Za-z0-9_]*)\s*(?::>?|:)\s*([A-Za-z_][A-Za-z0-9_:.]*)/g;
  while ((m = partRegex.exec(clean)) !== null) {
    const partName = m[1]!;
    const partType = m[2]!;
    components.push({
      name: partName,
      type: partType,
      properties: { kind: "part" },
    });
  }

  // 4. Extract connect / bind / constraint equations
  const connRegex = /\bconnect\s+([A-Za-z0-9_.]+)\s+to\s+([A-Za-z0-9_.]+)/g;
  while ((m = connRegex.exec(clean)) !== null) {
    equations.push({
      lhs: m[1]!,
      rhs: m[2]!,
      kind: "connect",
      rawText: m[0],
    });
  }

  const bindRegex = /\bbind\s+([A-Za-z0-9_.]+)\s*=\s*([A-Za-z0-9_.]+)/g;
  while ((m = bindRegex.exec(clean)) !== null) {
    equations.push({
      lhs: m[1]!,
      rhs: m[2]!,
      kind: "connect",
      rawText: m[0],
    });
  }

  const constraintBlockRegex = /\bconstraint(?:\s+[A-Za-z_][A-Za-z0-9_]*)?\s*\{([^}]*)\}/g;
  while ((m = constraintBlockRegex.exec(clean)) !== null) {
    const body = m[1]!.trim().replace(/;$/, "").trim();
    const opMatch = body.match(/^(.*?)(==|<=|>=|<|>|=)(.*)$/);
    if (opMatch) {
      equations.push({
        lhs: opMatch[1]!.trim(),
        rhs: opMatch[3]!.trim(),
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

/**
 * Extracts structured geometric/product entities, parameters, ports (placements/mates),
 * and assembly relationships from an ISO 10303-21 STEP (`.step` / `.stp`) file.
 */
export function extractStepModel(
  _stepTreeRoot: ModelScriptCstNode | null | undefined,
  sourceText: string,
): PolyglotModel {
  const components: ModelicaComponentInfo[] = [];
  const parameters: PolyglotParameterInfo[] = [];
  const variables: PolyglotVariableInfo[] = [];
  const equations: PolyglotEquationInfo[] = [];
  const ports: PolyglotPortInfo[] = [];

  let modelName = "AnonymousStepModel";
  const fileMatch = sourceText.match(/FILE_NAME\s*\(\s*'([^']+)'/i);
  if (fileMatch?.[1]) {
    modelName = fileMatch[1].replace(/\.(?:step|stp|p21)$/i, "");
  }

  const entityRegex = /#(\d+)\s*=\s*([A-Z0-9_]+)\s*\(([\s\S]*?)\)\s*;/g;
  let m: RegExpExecArray | null;
  while ((m = entityRegex.exec(sourceText)) !== null) {
    const id = `#${m[1]}`;
    const entityType = m[2]!;
    const argsRaw = m[3]!.trim();

    const labelMatch = argsRaw.match(/^'([^']*)'/);
    const label = labelMatch?.[1] || id;
    const nums = [...argsRaw.matchAll(/[+-]?(?:\d+\.\d*|\.\d+|\d+)(?:[eE][+-]?\d+)?/g)]
      .filter((nm) => !argsRaw.slice(0, nm.index).endsWith("#"))
      .map((nm) => parseFloat(nm[0]));
    const firstNum = nums[0];

    if (entityType === "PRODUCT" && labelMatch?.[1] && modelName === "AnonymousStepModel") {
      modelName = labelMatch[1];
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
      const refs = [...argsRaw.matchAll(/#\d+/g)].map((r) => r[0]);
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
  const firstIsLangOrPath =
    !sourceOrPath.includes("\n") &&
    (/^(?:modelica|sysml2|sysml|step)$/i.test(sourceOrPath.trim()) ||
      /\.(?:mo|sysml|step|stp|p21)$/i.test(sourceOrPath.trim()));
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
