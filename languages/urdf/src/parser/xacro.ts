// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/urdf — ROS Xacro (XML Macro) Expansion Preprocessor.
 *
 * Expands <xacro:property>, ${expression} variable substitutions and basic math,
 * and <xacro:macro name="..." params="..."> macro instantiations into pure URDF XML.
 */

import { parseXml, type XmlDocument, type XmlElement } from "@modelscript/dsl/xml";

/**
 * Evaluates basic math expressions inside ${...} in Xacro attributes:
 * Supports +, -, *, /, parenthesis, numbers, pi, and variable lookups.
 */
export function evaluateXacroExpr(expr: string, properties: Map<string, number | string>): number {
  const trimmed = expr.trim();
  if (!trimmed) return 0;

  // Substitute known properties
  let evaluated = trimmed;
  for (const [key, val] of properties.entries()) {
    if (typeof val === "number") {
      evaluated = replaceToken(evaluated, key, String(val));
    }
  }
  evaluated = replaceToken(evaluated, "pi", String(Math.PI));
  evaluated = replaceToken(evaluated, "PI", String(Math.PI));

  // Simple recursive descent expression evaluator
  let pos = 0;

  function parseExpression(): number {
    let res = parseTerm();
    while (pos < evaluated.length) {
      const ch = evaluated[pos];
      if (ch === "+") {
        pos++;
        res += parseTerm();
      } else if (ch === "-") {
        pos++;
        res -= parseTerm();
      } else {
        break;
      }
    }
    return res;
  }

  function parseTerm(): number {
    let res = parseFactor();
    while (pos < evaluated.length) {
      const ch = evaluated[pos];
      if (ch === "*") {
        pos++;
        res *= parseFactor();
      } else if (ch === "/") {
        pos++;
        const denom = parseFactor();
        res = denom !== 0 ? res / denom : 0;
      } else {
        break;
      }
    }
    return res;
  }

  function parseFactor(): number {
    skipWhitespace();
    if (pos >= evaluated.length) return 0;

    const ch = evaluated[pos];
    if (ch === "+") {
      pos++;
      return parseFactor();
    }
    if (ch === "-") {
      pos++;
      return -parseFactor();
    }
    if (ch === "(") {
      pos++;
      const res = parseExpression();
      skipWhitespace();
      if (evaluated[pos] === ")") pos++;
      return res;
    }

    // Number literal
    let numStr = "";
    while (pos < evaluated.length) {
      const c = evaluated[pos];
      if (c !== undefined && ((c >= "0" && c <= "9") || c === "." || c === "e" || c === "E")) {
        numStr += c;
        pos++;
      } else {
        break;
      }
    }

    const val = Number.parseFloat(numStr);
    return Number.isNaN(val) ? 0 : val;
  }

  function skipWhitespace(): void {
    while (pos < evaluated.length && (evaluated[pos] === " " || evaluated[pos] === "\t")) {
      pos++;
    }
  }

  return parseExpression();
}

function replaceToken(text: string, token: string, replacement: string): string {
  let result = "";
  let i = 0;
  while (i < text.length) {
    if (text.startsWith(token, i)) {
      // Ensure boundary
      const before = i > 0 ? text[i - 1] : " ";
      const after = i + token.length < text.length ? text[i + token.length] : " ";
      const isWordBefore = before !== undefined && /[a-zA-Z0-9_]/.test(before);
      const isWordAfter = after !== undefined && /[a-zA-Z0-9_]/.test(after);

      if (!isWordBefore && !isWordAfter) {
        result += replacement;
        i += token.length;
        continue;
      }
    }
    result += text[i];
    i++;
  }
  return result;
}

interface XacroMacroDef {
  name: string;
  params: string[];
  element: XmlElement;
}

/**
 * Expands Xacro properties and macros within an XML string, returning expanded URDF XML text.
 */
export function expandXacro(sourceXml: string): string {
  // If no xacro namespace or tags, return original
  if (!sourceXml.includes("xacro:") && !sourceXml.includes("${")) {
    return sourceXml;
  }

  let doc: XmlDocument;
  try {
    doc = parseXml(sourceXml);
  } catch {
    return sourceXml;
  }

  const root = doc.root;
  if (!root) return sourceXml;

  const properties = new Map<string, number | string>();
  const macros = new Map<string, XacroMacroDef>();

  // 1. Pass: Collect top-level properties and macro definitions
  for (const child of root.children) {
    const tag = child.name.toLowerCase();
    if (tag === "xacro:property") {
      const name = getAttribute(child, "name");
      const valStr = getAttribute(child, "value");
      if (name && valStr) {
        const num = Number.parseFloat(valStr);
        properties.set(name, Number.isNaN(num) ? valStr : num);
      }
    } else if (tag === "xacro:macro") {
      const name = getAttribute(child, "name");
      const paramStr = getAttribute(child, "params") ?? "";
      if (name) {
        const params = paramStr
          .split(" ")
          .map((p) => p.trim())
          .filter((p) => Boolean(p));
        macros.set(name, { name, params, element: child });
      }
    }
  }

  // 2. Pass: Expand expressions in attributes and elements
  function serializeElement(el: XmlElement, localProps: Map<string, number | string>): string {
    const tag = el.name;
    const lowerTag = tag.toLowerCase();

    // Skip property and macro definitions from the final output
    if (lowerTag === "xacro:property" || lowerTag === "xacro:macro") {
      return "";
    }

    // Check if this element is an instantiation of a macro: <xacro:macro_name ... />
    let macroName = "";
    if (lowerTag.startsWith("xacro:")) {
      macroName = tag.slice(6);
    } else if (macros.has(tag)) {
      macroName = tag;
    }

    if (macroName && macros.has(macroName)) {
      const macro = macros.get(macroName)!;
      const macroCallProps = new Map(localProps);
      for (const attr of el.attributes) {
        const attrVal = substituteVars(attr.value, localProps);
        const num = Number.parseFloat(attrVal);
        macroCallProps.set(attr.name, Number.isNaN(num) ? attrVal : num);
      }

      // Serialize macro children
      const macroOutput: string[] = [];
      for (const mChild of macro.element.children) {
        const expanded = serializeElement(mChild, macroCallProps);
        if (expanded) macroOutput.push(expanded);
      }
      return macroOutput.join("\n");
    }

    // Regular XML element serialization with substituted attributes
    const attrsStr = el.attributes
      .map((a) => {
        const val = substituteVars(a.value, localProps);
        return `${a.name}="${val}"`;
      })
      .join(" ");

    const openTag = attrsStr ? `<${tag} ${attrsStr}>` : `<${tag}>`;
    const closeTag = `</${tag}>`;

    const childrenStr = el.children
      .map((c) => serializeElement(c, localProps))
      .filter((s) => Boolean(s))
      .join("\n");

    const textContent = substituteVars(el.text?.trim() ?? "", localProps);

    if (!childrenStr && !textContent) {
      return attrsStr ? `<${tag} ${attrsStr} />` : `<${tag} />`;
    }

    if (textContent && !childrenStr) {
      return `${openTag}${textContent}${closeTag}`;
    }

    return `${openTag}\n${childrenStr}\n${closeTag}`;
  }

  function substituteVars(text: string, props: Map<string, number | string>): string {
    let result = text;
    // Replace ${...}
    while (result.includes("${")) {
      const start = result.indexOf("${");
      const end = result.indexOf("}", start);
      if (end === -1) break;

      const inner = result.slice(start + 2, end).trim();
      let replacement = "";
      if (props.has(inner)) {
        replacement = String(props.get(inner));
      } else {
        // Try evaluating as math expression
        const num = evaluateXacroExpr(inner, props);
        replacement = String(num);
      }

      result = result.slice(0, start) + replacement + result.slice(end + 1);
    }
    return result;
  }

  function getAttribute(el: XmlElement, name: string): string | undefined {
    for (const a of el.attributes) {
      if (a.name.toLowerCase() === name.toLowerCase()) {
        return a.value;
      }
    }
    return undefined;
  }

  return serializeElement(root, properties);
}
