// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/sedml — Zero-Regex SED-ML Level 1 Version 3 & Version 4 Parser and Serializer.
 *
 * Implements a pure character-by-character XML scanner and Content MathML AST builder for:
 * - <sedML> root containers
 * - <listOfSimulations>: <uniformTimeCourse>, <oneStep>, <steadyState>, and <algorithm kisaoID="...">
 * - <listOfModels>: <model>, <changeAttribute>, <computeChange>, <addXML>, <changeXML>, <removeXML>
 * - <listOfTasks>: <task> and <repeatedTask> (<listOfRanges>, <listOfChanges>, <listOfSubTasks>)
 * - <listOfDataGenerators>: <dataGenerator>, <listOfVariables>, <listOfParameters>, <math>
 * - <listOfOutputs>: <plot2D>, <plot3D>, and <report>
 */

import type {
  SedmlAlgorithm,
  SedmlAlgorithmParameter,
  SedmlChange,
  SedmlCurve,
  SedmlDataGenerator,
  SedmlDataSet,
  SedmlDocument,
  SedmlModel,
  SedmlOutput,
  SedmlParameter,
  SedmlRange,
  SedmlRangeSpec,
  SedmlSetValue,
  SedmlSimulation,
  SedmlSubTask,
  SedmlTask,
  SedmlVariable,
} from "../types.js";

// ============================================================================
// Character Classification & XML Entity Helpers (Zero-Regex)
// ============================================================================

function isWhitespace(ch: string): boolean {
  return ch === " " || ch === "\t" || ch === "\n" || ch === "\r";
}

function isNameChar(ch: string): boolean {
  if (!ch) return false;
  const code = ch.charCodeAt(0);
  return (
    (code >= 65 && code <= 90) || // A-Z
    (code >= 97 && code <= 122) || // a-z
    (code >= 48 && code <= 57) || // 0-9
    ch === "_" ||
    ch === "-" ||
    ch === ":" ||
    ch === "."
  );
}

function stripLocalName(tagName: string): string {
  const trimmed = tagName.trim();
  const colonIdx = trimmed.indexOf(":");
  if (colonIdx >= 0 && colonIdx + 1 < trimmed.length) {
    return trimmed.slice(colonIdx + 1);
  }
  return trimmed;
}

function decodeXmlEntities(raw: string): string {
  if (!raw.includes("&")) return raw;
  return raw
    .replaceAll("&lt;", "<")
    .replaceAll("&gt;", ">")
    .replaceAll("&quot;", '"')
    .replaceAll("&apos;", "'")
    .replaceAll("&amp;", "&");
}

function escapeXmlAttr(raw: string): string {
  return raw.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;").replaceAll('"', "&quot;");
}

function escapeXmlText(raw: string): string {
  return raw.replaceAll("&", "&amp;").replaceAll("<", "&lt;").replaceAll(">", "&gt;");
}

function computeLineColRange(source: string, startOffset: number, endOffset: number): SedmlRange {
  let line = 1;
  let col = 1;
  let startLine = 1;
  let startCol = 1;
  let endLine = 1;
  let endCol = 1;

  const clampedStart = Math.max(0, Math.min(startOffset, source.length));
  const clampedEnd = Math.max(clampedStart, Math.min(endOffset, source.length));

  for (let i = 0; i <= clampedEnd && i < source.length; i++) {
    if (i === clampedStart) {
      startLine = line;
      startCol = col;
    }
    if (i === clampedEnd) {
      endLine = line;
      endCol = col;
      break;
    }
    if (source[i] === "\n") {
      line++;
      col = 1;
    } else {
      col++;
    }
  }
  if (clampedEnd === source.length) {
    endLine = line;
    endCol = col;
  }

  return {
    startLine,
    startColumn: startCol,
    endLine: endLine >= startLine ? endLine : startLine,
    endColumn: endCol,
    startOffset: clampedStart,
    endOffset: clampedEnd,
  };
}

// ============================================================================
// Zero-Regex Character-by-Character XML Scanner
// ============================================================================

interface XmlNode {
  tagName: string;
  localName: string;
  attributes: Map<string, string>;
  children: XmlNode[];
  text: string;
  startOffset: number;
  endOffset: number;
}

function scanXmlNodes(source: string): XmlNode[] {
  const roots: XmlNode[] = [];
  const stack: XmlNode[] = [];
  const n = source.length;
  let i = 0;

  while (i < n) {
    const lt = source.indexOf("<", i);
    if (lt < 0) {
      const top = stack[stack.length - 1];
      if (top) {
        top.text += decodeXmlEntities(source.slice(i));
      }
      break;
    }

    if (lt > i) {
      const top = stack[stack.length - 1];
      if (top) {
        top.text += decodeXmlEntities(source.slice(i, lt));
      }
    }

    i = lt;

    // XML comment <!-- ... -->
    if (source.startsWith("<!--", i)) {
      const endComment = source.indexOf("-->", i + 4);
      i = endComment >= 0 ? endComment + 3 : n;
      continue;
    }

    // CDATA section <![CDATA[ ... ]]>
    if (source.startsWith("<![CDATA[", i)) {
      const endCdata = source.indexOf("]]>", i + 9);
      const cdataText = endCdata >= 0 ? source.slice(i + 9, endCdata) : source.slice(i + 9);
      const top = stack[stack.length - 1];
      if (top) {
        top.text += cdataText;
      }
      i = endCdata >= 0 ? endCdata + 3 : n;
      continue;
    }

    // Processing instruction <? ... ?>
    if (source.startsWith("<?", i)) {
      const endPi = source.indexOf("?>", i + 2);
      i = endPi >= 0 ? endPi + 2 : n;
      continue;
    }

    // DOCTYPE or other declaration <! ... >
    if (source.startsWith("<!", i)) {
      const endDecl = source.indexOf(">", i + 2);
      i = endDecl >= 0 ? endDecl + 1 : n;
      continue;
    }

    // Closing tag </tag>
    if (source.startsWith("</", i)) {
      const gt = source.indexOf(">", i + 2);
      const endPos = gt >= 0 ? gt + 1 : n;
      const closeRaw = gt >= 0 ? source.slice(i + 2, gt).trim() : "";
      const closeLocal = stripLocalName(closeRaw).toLowerCase();

      if (stack.length > 0) {
        let matchIdx = stack.length - 1;
        while (matchIdx >= 0 && stack[matchIdx]?.localName.toLowerCase() !== closeLocal) {
          matchIdx--;
        }
        if (matchIdx >= 0) {
          while (stack.length > matchIdx) {
            const popped = stack.pop();
            if (popped) {
              popped.endOffset = endPos;
            }
          }
        } else {
          const popped = stack.pop();
          if (popped) {
            popped.endOffset = endPos;
          }
        }
      }
      i = endPos;
      continue;
    }

    // Opening tag <tag attr="val" ...> or <tag ... />
    const tagStart = i;
    i++; // skip '<'
    while (i < n && isWhitespace(source[i] ?? "")) i++;

    let tagName = "";
    while (i < n && isNameChar(source[i] ?? "")) {
      tagName += source[i] ?? "";
      i++;
    }

    if (!tagName) {
      throw new Error(`Malformed XML tag at offset ${tagStart}`);
    }

    const attributes = new Map<string, string>();
    let selfClosing = false;

    while (i < n) {
      while (i < n && isWhitespace(source[i] ?? "")) i++;
      const ch = source[i];
      if (!ch || ch === ">") {
        if (ch === ">") i++;
        break;
      }
      if (ch === "/" && source[i + 1] === ">") {
        selfClosing = true;
        i += 2;
        break;
      }

      let attrName = "";
      while (i < n && isNameChar(source[i] ?? "")) {
        attrName += source[i] ?? "";
        i++;
      }
      if (!attrName) {
        i++;
        continue;
      }

      while (i < n && isWhitespace(source[i] ?? "")) i++;
      let attrVal = "";
      if (source[i] === "=") {
        i++;
        while (i < n && isWhitespace(source[i] ?? "")) i++;
        const quote = source[i];
        if (quote === '"' || quote === "'") {
          i++;
          const valStart = i;
          while (i < n && source[i] !== quote) i++;
          attrVal = decodeXmlEntities(source.slice(valStart, i));
          if (source[i] === quote) i++;
        } else {
          const valStart = i;
          while (i < n && !isWhitespace(source[i] ?? "") && source[i] !== ">" && source[i] !== "/") {
            i++;
          }
          attrVal = decodeXmlEntities(source.slice(valStart, i));
        }
      }

      attributes.set(attrName, attrVal);
      const colonIdx = attrName.indexOf(":");
      if (colonIdx >= 0 && colonIdx + 1 < attrName.length) {
        attributes.set(attrName.slice(colonIdx + 1), attrVal);
      }
    }

    const node: XmlNode = {
      tagName,
      localName: stripLocalName(tagName),
      attributes,
      children: [],
      text: "",
      startOffset: tagStart,
      endOffset: i,
    };

    const parent = stack[stack.length - 1];
    if (parent) {
      parent.children.push(node);
    } else {
      roots.push(node);
    }

    if (!selfClosing) {
      stack.push(node);
    }
  }

  return roots;
}

function getAttr(node: XmlNode, name: string): string | undefined {
  const direct = node.attributes.get(name);
  if (direct !== undefined) return direct;
  const target = name.toLowerCase();
  for (const [k, v] of node.attributes) {
    if (k.toLowerCase() === target) return v;
  }
  return undefined;
}

function getNumAttr(node: XmlNode, name: string, defaultValue?: number): number | undefined {
  const raw = getAttr(node, name);
  if (raw === undefined || raw.trim() === "") return defaultValue;
  const num = Number(raw);
  return Number.isNaN(num) ? defaultValue : num;
}

function getBoolAttr(node: XmlNode, name: string, defaultValue = false): boolean {
  const raw = getAttr(node, name)?.trim().toLowerCase();
  if (raw === "true" || raw === "1") return true;
  if (raw === "false" || raw === "0") return false;
  return defaultValue;
}

function findChild(node: XmlNode, localName: string): XmlNode | undefined {
  const target = localName.toLowerCase();
  return node.children.find((c) => c.localName.toLowerCase() === target);
}

function findChildren(node: XmlNode, localName: string): XmlNode[] {
  const target = localName.toLowerCase();
  return node.children.filter((c) => c.localName.toLowerCase() === target);
}

// ============================================================================
// Content MathML to Infix Converter (Zero-Regex)
// ============================================================================

function mathMlToInfix(elem: XmlNode): string {
  const name = elem.localName.toLowerCase();

  if (name === "math") {
    if (elem.children.length === 0) return elem.text.trim();
    return elem.children.map(mathMlToInfix).join(" ").trim();
  }

  if (name === "ci" || name === "cn" || name === "csymbol") {
    const trimmed = elem.text.trim();
    if (trimmed) return trimmed;
    const defUrl = getAttr(elem, "definitionURL") ?? "";
    if (defUrl.toLowerCase().includes("time")) return "time";
    return "";
  }

  if (name === "true") return "1";
  if (name === "false") return "0";
  if (name === "pi") return "pi";
  if (name === "exponentiale") return "e";

  if (name === "piecewise") {
    const pieces = findChildren(elem, "piece");
    const otherwiseElem = findChild(elem, "otherwise");
    const defaultExpr = otherwiseElem && otherwiseElem.children[0] ? mathMlToInfix(otherwiseElem.children[0]) : "0";
    let result = defaultExpr;
    for (let idx = pieces.length - 1; idx >= 0; idx--) {
      const p = pieces[idx];
      if (p && p.children.length >= 2 && p.children[0] && p.children[1]) {
        const valExpr = mathMlToInfix(p.children[0]);
        const condExpr = mathMlToInfix(p.children[1]);
        result = `(${condExpr} ? ${valExpr} : ${result})`;
      }
    }
    return result;
  }

  if (name === "apply") {
    const opElem = elem.children[0];
    if (!opElem) return "";
    const op = opElem.localName.toLowerCase();
    const args = elem.children.slice(1).map(mathMlToInfix);

    switch (op) {
      case "plus":
        return args.length > 0 ? `(${args.join(" + ")})` : "0";
      case "times":
        return args.length > 0 ? `(${args.join(" * ")})` : "1";
      case "minus":
        if (args.length === 1) return `(-${args[0]})`;
        return args.length === 2 ? `(${args[0]} - ${args[1]})` : `(${args.join(" - ")})`;
      case "divide":
        return args.length === 2 ? `(${args[0]} / ${args[1]})` : args.join(" / ");
      case "power":
        return args.length === 2 ? `(${args[0]} ^ ${args[1]})` : args.join(" ^ ");
      case "root":
        return `sqrt(${args[0] ?? "0"})`;
      case "exp":
        return `exp(${args[0] ?? "0"})`;
      case "ln":
        return `ln(${args[0] ?? "1"})`;
      case "log":
        if (args.length === 2) return `(ln(${args[1]}) / ln(${args[0]}))`;
        return `log(${args[0] ?? "1"})`;
      case "abs":
        return `abs(${args[0] ?? "0"})`;
      case "floor":
        return `floor(${args[0] ?? "0"})`;
      case "ceiling":
      case "ceil":
        return `ceil(${args[0] ?? "0"})`;
      case "sin":
      case "cos":
      case "tan":
      case "asin":
      case "acos":
      case "atan":
      case "sinh":
      case "cosh":
      case "tanh":
      case "min":
      case "max":
        return `${op}(${args.join(", ")})`;
      case "gt":
        return `(${args[0] ?? "0"} > ${args[1] ?? "0"})`;
      case "lt":
        return `(${args[0] ?? "0"} < ${args[1] ?? "0"})`;
      case "geq":
        return `(${args[0] ?? "0"} >= ${args[1] ?? "0"})`;
      case "leq":
        return `(${args[0] ?? "0"} <= ${args[1] ?? "0"})`;
      case "eq":
        return `(${args[0] ?? "0"} == ${args[1] ?? "0"})`;
      case "neq":
        return `(${args[0] ?? "0"} != ${args[1] ?? "0"})`;
      case "and":
        return args.length > 0 ? `(${args.join(" && ")})` : "1";
      case "or":
        return args.length > 0 ? `(${args.join(" || ")})` : "0";
      case "not":
        return `(!(${args[0] ?? "0"}))`;
      case "ci":
      case "csymbol": {
        const fnName = opElem.text.trim() || op;
        return `${fnName}(${args.join(", ")})`;
      }
      default:
        return `${op}(${args.join(", ")})`;
    }
  }

  if (elem.children.length > 0) {
    return elem.children.map(mathMlToInfix).join(" ").trim();
  }

  return elem.text.trim();
}

function extractMathFromNode(node: XmlNode): string {
  const attrMath = getAttr(node, "math") ?? getAttr(node, "formula");
  if (attrMath && attrMath.trim().length > 0) return attrMath.trim();
  const mathChild = findChild(node, "math");
  if (mathChild) return mathMlToInfix(mathChild);
  const formulaChild = findChild(node, "formula");
  if (formulaChild) return formulaChild.text.trim();
  return node.text.trim();
}

// ============================================================================
// SED-ML Element Parsers
// ============================================================================

function parseVariablesList(parentNode: XmlNode, source: string): SedmlVariable[] {
  const listNode = findChild(parentNode, "listOfVariables") ?? parentNode;
  const vars: SedmlVariable[] = [];
  for (const vElem of findChildren(listNode, "variable")) {
    const id = getAttr(vElem, "id") ?? "";
    vars.push({
      id,
      name: getAttr(vElem, "name"),
      target: getAttr(vElem, "target"),
      symbol: getAttr(vElem, "symbol"),
      taskReference: getAttr(vElem, "taskReference"),
      modelReference: getAttr(vElem, "modelReference"),
      range: computeLineColRange(source, vElem.startOffset, vElem.endOffset),
    });
  }
  return vars;
}

function parseParametersList(parentNode: XmlNode, source: string): SedmlParameter[] {
  const listNode = findChild(parentNode, "listOfParameters") ?? parentNode;
  const params: SedmlParameter[] = [];
  for (const pElem of findChildren(listNode, "parameter")) {
    const id = getAttr(pElem, "id") ?? "";
    params.push({
      id,
      name: getAttr(pElem, "name"),
      value: getNumAttr(pElem, "value", 0.0) ?? 0.0,
      range: computeLineColRange(source, pElem.startOffset, pElem.endOffset),
    });
  }
  return params;
}

function parseAlgorithm(simNode: XmlNode, source: string): SedmlAlgorithm | undefined {
  const algNode = findChild(simNode, "algorithm");
  if (!algNode) {
    const inlineKisao = getAttr(simNode, "kisaoID");
    if (inlineKisao !== undefined) {
      return {
        kisaoID: inlineKisao,
        parameters: [],
        range: computeLineColRange(source, simNode.startOffset, simNode.endOffset),
      };
    }
    return undefined;
  }

  const kisaoID = getAttr(algNode, "kisaoID") ?? "";
  const name = getAttr(algNode, "name");
  const parameters: SedmlAlgorithmParameter[] = [];
  const listOfAlgParams = findChild(algNode, "listOfAlgorithmParameters") ?? algNode;

  for (const apNode of findChildren(listOfAlgParams, "algorithmParameter")) {
    parameters.push({
      kisaoID: getAttr(apNode, "kisaoID") ?? "",
      name: getAttr(apNode, "name"),
      value: getAttr(apNode, "value") ?? "",
      range: computeLineColRange(source, apNode.startOffset, apNode.endOffset),
    });
  }

  return {
    kisaoID,
    name,
    parameters,
    range: computeLineColRange(source, algNode.startOffset, algNode.endOffset),
  };
}

function parseSimulationNode(simNode: XmlNode, source: string): SedmlSimulation | undefined {
  const tag = simNode.localName.toLowerCase();
  const id = getAttr(simNode, "id") ?? "";
  const name = getAttr(simNode, "name");
  const algorithm = parseAlgorithm(simNode, source);
  const range = computeLineColRange(source, simNode.startOffset, simNode.endOffset);

  if (tag === "uniformtimecourse") {
    const initialTime = getNumAttr(simNode, "initialTime", 0.0);
    const outputStartTime = getNumAttr(simNode, "outputStartTime", initialTime ?? 0.0);
    const outputEndTime = getNumAttr(simNode, "outputEndTime", 10.0);
    const numberOfSteps = getNumAttr(simNode, "numberOfSteps") ?? getNumAttr(simNode, "numberOfPoints", 100) ?? 100;

    return {
      id,
      name,
      type: "uniformTimeCourse",
      initialTime,
      outputStartTime,
      outputEndTime,
      numberOfSteps,
      algorithm,
      range,
    };
  }

  if (tag === "onestep") {
    return {
      id,
      name,
      type: "oneStep",
      step: getNumAttr(simNode, "step", 0.1) ?? 0.1,
      algorithm,
      range,
    };
  }

  if (tag === "steadystate") {
    return {
      id,
      name,
      type: "steadyState",
      algorithm,
      range,
    };
  }

  return undefined;
}

function parseModelNode(modelNode: XmlNode, source: string): SedmlModel {
  const id = getAttr(modelNode, "id") ?? "";
  const name = getAttr(modelNode, "name");
  const language = getAttr(modelNode, "language") ?? "urn:sedml:language:sbml";
  const src = getAttr(modelNode, "source") ?? "";
  const changes: SedmlChange[] = [];

  const listOfChanges = findChild(modelNode, "listOfChanges") ?? modelNode;
  for (const chNode of listOfChanges.children) {
    const chTag = chNode.localName.toLowerCase();
    const chRange = computeLineColRange(source, chNode.startOffset, chNode.endOffset);

    if (chTag === "changeattribute") {
      changes.push({
        type: "changeAttribute",
        target: getAttr(chNode, "target") ?? "",
        newValue: getAttr(chNode, "newValue") ?? "",
        range: chRange,
      });
    } else if (chTag === "computechange") {
      changes.push({
        type: "computeChange",
        target: getAttr(chNode, "target") ?? "",
        math: extractMathFromNode(chNode),
        variables: parseVariablesList(chNode, source),
        parameters: parseParametersList(chNode, source),
        range: chRange,
      });
    } else if (chTag === "addxml") {
      changes.push({
        type: "addXML",
        target: getAttr(chNode, "target") ?? "",
        range: chRange,
      });
    } else if (chTag === "changexml") {
      changes.push({
        type: "changeXML",
        target: getAttr(chNode, "target") ?? "",
        newValue: getAttr(chNode, "newValue"),
        range: chRange,
      });
    } else if (chTag === "removexml") {
      changes.push({
        type: "removeXML",
        target: getAttr(chNode, "target") ?? "",
        range: chRange,
      });
    }
  }

  return {
    id,
    name,
    language,
    source: src,
    changes,
    range: computeLineColRange(source, modelNode.startOffset, modelNode.endOffset),
  };
}

function parseTaskNode(taskNode: XmlNode, source: string): SedmlTask | undefined {
  const tag = taskNode.localName.toLowerCase();
  const id = getAttr(taskNode, "id") ?? "";
  const name = getAttr(taskNode, "name");
  const range = computeLineColRange(source, taskNode.startOffset, taskNode.endOffset);

  if (tag === "task") {
    return {
      id,
      name,
      type: "task",
      modelReference: getAttr(taskNode, "modelReference"),
      simulationReference: getAttr(taskNode, "simulationReference"),
      range,
    };
  }

  if (tag === "repeatedtask") {
    const rangeId = getAttr(taskNode, "range");
    const resetModel = getBoolAttr(taskNode, "resetModel", true);
    const ranges: SedmlRangeSpec[] = [];
    const taskChanges: SedmlSetValue[] = [];
    const subTasks: SedmlSubTask[] = [];

    const listOfRanges = findChild(taskNode, "listOfRanges");
    if (listOfRanges) {
      for (const rNode of listOfRanges.children) {
        const rTag = rNode.localName.toLowerCase();
        const rRange = computeLineColRange(source, rNode.startOffset, rNode.endOffset);
        if (rTag === "uniformrange") {
          const scaleAttr = getAttr(rNode, "type")?.toLowerCase();
          ranges.push({
            id: getAttr(rNode, "id") ?? "",
            type: "uniformRange",
            start: getNumAttr(rNode, "start", 0.0),
            end: getNumAttr(rNode, "end", 1.0),
            numberOfSteps: getNumAttr(rNode, "numberOfSteps") ?? getNumAttr(rNode, "numberOfPoints", 10) ?? 10,
            scale: scaleAttr === "log" ? "log" : "linear",
            range: rRange,
          });
        } else if (rTag === "vectorrange") {
          const values: number[] = [];
          for (const valNode of findChildren(rNode, "value")) {
            const num = Number(valNode.text.trim());
            if (!Number.isNaN(num)) values.push(num);
          }
          ranges.push({
            id: getAttr(rNode, "id") ?? "",
            type: "vectorRange",
            values,
            range: rRange,
          });
        } else if (rTag === "functionalrange") {
          ranges.push({
            id: getAttr(rNode, "id") ?? "",
            type: "functionalRange",
            math: extractMathFromNode(rNode),
            range: rRange,
          });
        }
      }
    }

    const listOfChanges = findChild(taskNode, "listOfChanges");
    if (listOfChanges) {
      for (const svNode of findChildren(listOfChanges, "setValue")) {
        taskChanges.push({
          modelReference: getAttr(svNode, "modelReference") ?? "",
          target: getAttr(svNode, "target") ?? "",
          rangeReference: getAttr(svNode, "range"),
          symbol: getAttr(svNode, "symbol"),
          math: extractMathFromNode(svNode),
          range: computeLineColRange(source, svNode.startOffset, svNode.endOffset),
        });
      }
    }

    const listOfSubTasks = findChild(taskNode, "listOfSubTasks");
    if (listOfSubTasks) {
      for (const stNode of findChildren(listOfSubTasks, "subTask")) {
        subTasks.push({
          task: getAttr(stNode, "task") ?? "",
          order: getNumAttr(stNode, "order", 1) ?? 1,
          range: computeLineColRange(source, stNode.startOffset, stNode.endOffset),
        });
      }
    }

    return {
      id,
      name,
      type: "repeatedTask",
      rangeId,
      resetModel,
      ranges,
      taskChanges,
      subTasks,
      range,
    };
  }

  return undefined;
}

function parseDataGeneratorNode(dgNode: XmlNode, source: string): SedmlDataGenerator {
  return {
    id: getAttr(dgNode, "id") ?? "",
    name: getAttr(dgNode, "name"),
    variables: parseVariablesList(dgNode, source),
    parameters: parseParametersList(dgNode, source),
    math: extractMathFromNode(dgNode),
    range: computeLineColRange(source, dgNode.startOffset, dgNode.endOffset),
  };
}

function parseOutputNode(outNode: XmlNode, source: string): SedmlOutput | undefined {
  const tag = outNode.localName.toLowerCase();
  const id = getAttr(outNode, "id") ?? "";
  const name = getAttr(outNode, "name");
  const range = computeLineColRange(source, outNode.startOffset, outNode.endOffset);

  if (tag === "plot2d" || tag === "plot3d") {
    const curves: SedmlCurve[] = [];
    const listOfCurves = findChild(outNode, "listOfCurves") ?? findChild(outNode, "listOfSurfaces") ?? outNode;
    for (const cNode of [...findChildren(listOfCurves, "curve"), ...findChildren(listOfCurves, "surface")]) {
      curves.push({
        id: getAttr(cNode, "id") ?? "",
        name: getAttr(cNode, "name"),
        logX: getBoolAttr(cNode, "logX", false),
        logY: getBoolAttr(cNode, "logY", false),
        logZ: getAttr(cNode, "logZ") !== undefined ? getBoolAttr(cNode, "logZ", false) : undefined,
        xDataReference: getAttr(cNode, "xDataReference") ?? "",
        yDataReference: getAttr(cNode, "yDataReference") ?? "",
        zDataReference: getAttr(cNode, "zDataReference"),
        style: getAttr(cNode, "style"),
        range: computeLineColRange(source, cNode.startOffset, cNode.endOffset),
      });
    }
    return {
      id,
      name,
      type: tag === "plot3d" ? "plot3D" : "plot2D",
      curves,
      dataSets: [],
      range,
    };
  }

  if (tag === "report") {
    const dataSets: SedmlDataSet[] = [];
    const listOfDataSets = findChild(outNode, "listOfDataSets") ?? outNode;
    for (const dsNode of findChildren(listOfDataSets, "dataSet")) {
      const dsId = getAttr(dsNode, "id") ?? "";
      dataSets.push({
        id: dsId,
        name: getAttr(dsNode, "name"),
        label: getAttr(dsNode, "label") ?? dsId,
        dataReference: getAttr(dsNode, "dataReference") ?? "",
        range: computeLineColRange(source, dsNode.startOffset, dsNode.endOffset),
      });
    }
    return {
      id,
      name,
      type: "report",
      curves: [],
      dataSets,
      range,
    };
  }

  return undefined;
}

// ============================================================================
// Public Parse & Serialize API
// ============================================================================

export function parseSedml(source: string, filename?: string): SedmlDocument {
  const roots = scanXmlNodes(source);
  const root = roots[0];

  if (!root || root.localName.toLowerCase() !== "sedml") {
    throw new Error("Invalid SED-ML: root element must be <sedML>");
  }

  const level = getNumAttr(root, "level", 1) ?? 1;
  const version = getNumAttr(root, "version", 4) ?? 4;

  const simulations: SedmlSimulation[] = [];
  const models: SedmlModel[] = [];
  const tasks: SedmlTask[] = [];
  const dataGenerators: SedmlDataGenerator[] = [];
  const outputs: SedmlOutput[] = [];

  // 1. Simulations
  const listOfSimulations = findChild(root, "listOfSimulations");
  if (listOfSimulations) {
    for (const sNode of listOfSimulations.children) {
      const sim = parseSimulationNode(sNode, source);
      if (sim) simulations.push(sim);
    }
  }

  // 2. Models
  const listOfModels = findChild(root, "listOfModels");
  if (listOfModels) {
    for (const mNode of findChildren(listOfModels, "model")) {
      models.push(parseModelNode(mNode, source));
    }
  }

  // 3. Tasks
  const listOfTasks = findChild(root, "listOfTasks");
  if (listOfTasks) {
    for (const tNode of listOfTasks.children) {
      const task = parseTaskNode(tNode, source);
      if (task) tasks.push(task);
    }
  }

  // 4. DataGenerators
  const listOfDataGenerators = findChild(root, "listOfDataGenerators");
  if (listOfDataGenerators) {
    for (const dgNode of findChildren(listOfDataGenerators, "dataGenerator")) {
      dataGenerators.push(parseDataGeneratorNode(dgNode, source));
    }
  }

  // 5. Outputs
  const listOfOutputs = findChild(root, "listOfOutputs");
  if (listOfOutputs) {
    for (const oNode of listOfOutputs.children) {
      const out = parseOutputNode(oNode, source);
      if (out) outputs.push(out);
    }
  }

  return {
    level,
    version,
    simulations,
    models,
    tasks,
    dataGenerators,
    outputs,
    sourceFile: filename,
    range: computeLineColRange(source, root.startOffset, root.endOffset),
  };
}

export function serializeSedml(doc: SedmlDocument): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(
    `<sedML xmlns="http://sed-ml.org/sed-ml/level${doc.level}/version${doc.version}" level="${doc.level}" version="${doc.version}">`,
  );

  // 1. Simulations
  if (doc.simulations.length > 0) {
    lines.push(`  <listOfSimulations>`);
    for (const sim of doc.simulations) {
      const nameAttr = sim.name ? ` name="${escapeXmlAttr(sim.name)}"` : "";
      if (sim.type === "uniformTimeCourse") {
        const initT = sim.initialTime ?? 0;
        const outStart = sim.outputStartTime ?? 0;
        const outEnd = sim.outputEndTime ?? 10;
        const steps = sim.numberOfSteps ?? 100;
        if (sim.algorithm) {
          lines.push(
            `    <uniformTimeCourse id="${escapeXmlAttr(sim.id)}"${nameAttr} initialTime="${initT}" outputStartTime="${outStart}" outputEndTime="${outEnd}" numberOfSteps="${steps}">`,
          );
          serializeAlgorithm(sim.algorithm, lines, "      ");
          lines.push(`    </uniformTimeCourse>`);
        } else {
          lines.push(
            `    <uniformTimeCourse id="${escapeXmlAttr(sim.id)}"${nameAttr} initialTime="${initT}" outputStartTime="${outStart}" outputEndTime="${outEnd}" numberOfSteps="${steps}"/>`,
          );
        }
      } else if (sim.type === "oneStep") {
        const step = sim.step ?? 0.1;
        if (sim.algorithm) {
          lines.push(`    <oneStep id="${escapeXmlAttr(sim.id)}"${nameAttr} step="${step}">`);
          serializeAlgorithm(sim.algorithm, lines, "      ");
          lines.push(`    </oneStep>`);
        } else {
          lines.push(`    <oneStep id="${escapeXmlAttr(sim.id)}"${nameAttr} step="${step}"/>`);
        }
      } else {
        if (sim.algorithm) {
          lines.push(`    <steadyState id="${escapeXmlAttr(sim.id)}"${nameAttr}>`);
          serializeAlgorithm(sim.algorithm, lines, "      ");
          lines.push(`    </steadyState>`);
        } else {
          lines.push(`    <steadyState id="${escapeXmlAttr(sim.id)}"${nameAttr}/>`);
        }
      }
    }
    lines.push(`  </listOfSimulations>`);
  }

  // 2. Models
  if (doc.models.length > 0) {
    lines.push(`  <listOfModels>`);
    for (const m of doc.models) {
      const nameAttr = m.name ? ` name="${escapeXmlAttr(m.name)}"` : "";
      if (m.changes.length === 0) {
        lines.push(
          `    <model id="${escapeXmlAttr(m.id)}"${nameAttr} language="${escapeXmlAttr(m.language)}" source="${escapeXmlAttr(m.source)}"/>`,
        );
      } else {
        lines.push(
          `    <model id="${escapeXmlAttr(m.id)}"${nameAttr} language="${escapeXmlAttr(m.language)}" source="${escapeXmlAttr(m.source)}">`,
        );
        lines.push(`      <listOfChanges>`);
        for (const ch of m.changes) {
          if (ch.type === "changeAttribute") {
            lines.push(
              `        <changeAttribute target="${escapeXmlAttr(ch.target)}" newValue="${escapeXmlAttr(ch.newValue ?? "")}"/>`,
            );
          } else if (ch.type === "computeChange") {
            lines.push(`        <computeChange target="${escapeXmlAttr(ch.target)}">`);
            if (ch.variables && ch.variables.length > 0) {
              serializeVariablesList(ch.variables, lines, "          ");
            }
            if (ch.parameters && ch.parameters.length > 0) {
              serializeParametersList(ch.parameters, lines, "          ");
            }
            lines.push(
              `          <math xmlns="http://www.w3.org/1998/Math/MathML">${escapeXmlText(ch.math ?? "0")}</math>`,
            );
            lines.push(`        </computeChange>`);
          } else {
            lines.push(`        <${ch.type} target="${escapeXmlAttr(ch.target)}"/>`);
          }
        }
        lines.push(`      </listOfChanges>`);
        lines.push(`    </model>`);
      }
    }
    lines.push(`  </listOfModels>`);
  }

  // 3. Tasks
  if (doc.tasks.length > 0) {
    lines.push(`  <listOfTasks>`);
    for (const t of doc.tasks) {
      const nameAttr = t.name ? ` name="${escapeXmlAttr(t.name)}"` : "";
      if (t.type === "task") {
        const modelAttr = t.modelReference ? ` modelReference="${escapeXmlAttr(t.modelReference)}"` : "";
        const simAttr = t.simulationReference ? ` simulationReference="${escapeXmlAttr(t.simulationReference)}"` : "";
        lines.push(`    <task id="${escapeXmlAttr(t.id)}"${nameAttr}${modelAttr}${simAttr}/>`);
      } else {
        const rangeAttr = t.rangeId ? ` range="${escapeXmlAttr(t.rangeId)}"` : "";
        const resetAttr = t.resetModel !== undefined ? ` resetModel="${t.resetModel}"` : "";
        lines.push(`    <repeatedTask id="${escapeXmlAttr(t.id)}"${nameAttr}${rangeAttr}${resetAttr}>`);
        if (t.ranges && t.ranges.length > 0) {
          lines.push(`      <listOfRanges>`);
          for (const r of t.ranges) {
            if (r.type === "uniformRange") {
              lines.push(
                `        <uniformRange id="${escapeXmlAttr(r.id)}" start="${r.start ?? 0}" end="${r.end ?? 1}" numberOfSteps="${r.numberOfSteps ?? 10}" type="${r.scale ?? "linear"}"/>`,
              );
            } else if (r.type === "vectorRange") {
              lines.push(`        <vectorRange id="${escapeXmlAttr(r.id)}">`);
              for (const val of r.values ?? []) {
                lines.push(`          <value>${val}</value>`);
              }
              lines.push(`        </vectorRange>`);
            } else {
              lines.push(
                `        <functionalRange id="${escapeXmlAttr(r.id)}"><math xmlns="http://www.w3.org/1998/Math/MathML">${escapeXmlText(r.math ?? "0")}</math></functionalRange>`,
              );
            }
          }
          lines.push(`      </listOfRanges>`);
        }
        if (t.taskChanges && t.taskChanges.length > 0) {
          lines.push(`      <listOfChanges>`);
          for (const sv of t.taskChanges) {
            const rAttr = sv.rangeReference ? ` range="${escapeXmlAttr(sv.rangeReference)}"` : "";
            lines.push(
              `        <setValue modelReference="${escapeXmlAttr(sv.modelReference)}" target="${escapeXmlAttr(sv.target)}"${rAttr}><math xmlns="http://www.w3.org/1998/Math/MathML">${escapeXmlText(sv.math)}</math></setValue>`,
            );
          }
          lines.push(`      </listOfChanges>`);
        }
        if (t.subTasks && t.subTasks.length > 0) {
          lines.push(`      <listOfSubTasks>`);
          for (const st of t.subTasks) {
            lines.push(`        <subTask order="${st.order}" task="${escapeXmlAttr(st.task)}"/>`);
          }
          lines.push(`      </listOfSubTasks>`);
        }
        lines.push(`    </repeatedTask>`);
      }
    }
    lines.push(`  </listOfTasks>`);
  }

  // 4. DataGenerators
  if (doc.dataGenerators.length > 0) {
    lines.push(`  <listOfDataGenerators>`);
    for (const dg of doc.dataGenerators) {
      const nameAttr = dg.name ? ` name="${escapeXmlAttr(dg.name)}"` : "";
      lines.push(`    <dataGenerator id="${escapeXmlAttr(dg.id)}"${nameAttr}>`);
      if (dg.variables.length > 0) {
        serializeVariablesList(dg.variables, lines, "      ");
      }
      if (dg.parameters.length > 0) {
        serializeParametersList(dg.parameters, lines, "      ");
      }
      lines.push(`      <math xmlns="http://www.w3.org/1998/Math/MathML">${escapeXmlText(dg.math)}</math>`);
      lines.push(`    </dataGenerator>`);
    }
    lines.push(`  </listOfDataGenerators>`);
  }

  // 5. Outputs
  if (doc.outputs.length > 0) {
    lines.push(`  <listOfOutputs>`);
    for (const out of doc.outputs) {
      const nameAttr = out.name ? ` name="${escapeXmlAttr(out.name)}"` : "";
      if (out.type === "plot2D" || out.type === "plot3D") {
        const tag = out.type === "plot3D" ? "plot3D" : "plot2D";
        const listTag = out.type === "plot3D" ? "listOfSurfaces" : "listOfCurves";
        const itemTag = out.type === "plot3D" ? "surface" : "curve";
        lines.push(`    <${tag} id="${escapeXmlAttr(out.id)}"${nameAttr}>`);
        if (out.curves.length > 0) {
          lines.push(`      <${listTag}>`);
          for (const c of out.curves) {
            const cNameAttr = c.name ? ` name="${escapeXmlAttr(c.name)}"` : "";
            const zAttr = c.zDataReference ? ` zDataReference="${escapeXmlAttr(c.zDataReference)}"` : "";
            const logZAttr = c.logZ !== undefined ? ` logZ="${c.logZ}"` : "";
            lines.push(
              `        <${itemTag} id="${escapeXmlAttr(c.id)}"${cNameAttr} logX="${c.logX}" logY="${c.logY}"${logZAttr} xDataReference="${escapeXmlAttr(c.xDataReference)}" yDataReference="${escapeXmlAttr(c.yDataReference)}"${zAttr}/>`,
            );
          }
          lines.push(`      </${listTag}>`);
        }
        lines.push(`    </${tag}>`);
      } else {
        lines.push(`    <report id="${escapeXmlAttr(out.id)}"${nameAttr}>`);
        if (out.dataSets.length > 0) {
          lines.push(`      <listOfDataSets>`);
          for (const ds of out.dataSets) {
            const dsNameAttr = ds.name ? ` name="${escapeXmlAttr(ds.name)}"` : "";
            lines.push(
              `        <dataSet id="${escapeXmlAttr(ds.id)}"${dsNameAttr} label="${escapeXmlAttr(ds.label)}" dataReference="${escapeXmlAttr(ds.dataReference)}"/>`,
            );
          }
          lines.push(`      </listOfDataSets>`);
        }
        lines.push(`    </report>`);
      }
    }
    lines.push(`  </listOfOutputs>`);
  }

  lines.push(`</sedML>`);
  return lines.join("\n");
}

function serializeAlgorithm(alg: SedmlAlgorithm, lines: string[], indent: string): void {
  const nameAttr = alg.name ? ` name="${escapeXmlAttr(alg.name)}"` : "";
  if (alg.parameters.length === 0) {
    lines.push(`${indent}<algorithm kisaoID="${escapeXmlAttr(alg.kisaoID)}"${nameAttr}/>`);
  } else {
    lines.push(`${indent}<algorithm kisaoID="${escapeXmlAttr(alg.kisaoID)}"${nameAttr}>`);
    lines.push(`${indent}  <listOfAlgorithmParameters>`);
    for (const ap of alg.parameters) {
      const apName = ap.name ? ` name="${escapeXmlAttr(ap.name)}"` : "";
      lines.push(
        `${indent}    <algorithmParameter kisaoID="${escapeXmlAttr(ap.kisaoID)}"${apName} value="${escapeXmlAttr(ap.value)}"/>`,
      );
    }
    lines.push(`${indent}  </listOfAlgorithmParameters>`);
    lines.push(`${indent}</algorithm>`);
  }
}

function serializeVariablesList(vars: SedmlVariable[], lines: string[], indent: string): void {
  lines.push(`${indent}<listOfVariables>`);
  for (const v of vars) {
    const nameAttr = v.name ? ` name="${escapeXmlAttr(v.name)}"` : "";
    const targetAttr = v.target ? ` target="${escapeXmlAttr(v.target)}"` : "";
    const symAttr = v.symbol ? ` symbol="${escapeXmlAttr(v.symbol)}"` : "";
    const taskAttr = v.taskReference ? ` taskReference="${escapeXmlAttr(v.taskReference)}"` : "";
    const modelAttr = v.modelReference ? ` modelReference="${escapeXmlAttr(v.modelReference)}"` : "";
    lines.push(
      `${indent}  <variable id="${escapeXmlAttr(v.id)}"${nameAttr}${targetAttr}${symAttr}${taskAttr}${modelAttr}/>`,
    );
  }
  lines.push(`${indent}</listOfVariables>`);
}

function serializeParametersList(params: SedmlParameter[], lines: string[], indent: string): void {
  lines.push(`${indent}<listOfParameters>`);
  for (const p of params) {
    const nameAttr = p.name ? ` name="${escapeXmlAttr(p.name)}"` : "";
    lines.push(`${indent}  <parameter id="${escapeXmlAttr(p.id)}"${nameAttr} value="${p.value}"/>`);
  }
  lines.push(`${indent}</listOfParameters>`);
}
