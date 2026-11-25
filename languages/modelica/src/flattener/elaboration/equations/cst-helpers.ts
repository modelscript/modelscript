// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import { AnnotationEvaluator } from "../../../diagram/annotation-evaluator.js";
import {
  extractFunctionCallArgExprNodesCst,
  firstAsciiToken,
  isAsciiDigitsOnly,
  isAsciiIdentifier,
  parseStandaloneExpressionCst,
  stripAsciiWhitespace,
  type CstNodeLike,
} from "../../expressions/cst-utils.js";

export function isCstNode(
  kind: { is(node: SyntaxNode | null | undefined): boolean },
  node: SyntaxNode | null | undefined,
): boolean {
  return kind.is(node);
}

function isAlnumOrUnderscoreCharCode(c: number): boolean {
  return (c >= 48 && c <= 57) || (c >= 65 && c <= 90) || (c >= 97 && c <= 122) || c === 95;
}

export function formatPlusOperatorSpacing(text: string): string {
  let out = "";
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]!;
    if (
      ch === "+" &&
      i > 0 &&
      i + 1 < text.length &&
      isAlnumOrUnderscoreCharCode(text.charCodeAt(i - 1)) &&
      isAlnumOrUnderscoreCharCode(text.charCodeAt(i + 1))
    ) {
      out += " + ";
    } else {
      out += ch;
    }
  }
  return out;
}

export function findDirectOrWrappedFunctionCallNode(node: CstNodeLike | null | undefined): CstNodeLike | null {
  let cur: CstNodeLike | null | undefined = node;
  for (let depth = 0; depth < 12 && cur; depth++) {
    if (cur.type === "function_call") return cur;
    const ch: CstNodeLike[] = cur.children || [];
    const fcChild = ch.find((c) => c.type === "function_call");
    if (fcChild && ch.every((c) => c === fcChild || c.text === ";" || c.type === ";")) {
      return fcChild;
    }
    const meaningful = ch.filter((c) => c.type !== ";" && c.text?.trim() !== ";");
    if (meaningful.length === 1) {
      cur = meaningful[0];
      continue;
    }
    for (let i = 0; i + 1 < ch.length; i++) {
      if (
        (ch[i]?.type === "component_reference" || ch[i]?.type === "name" || ch[i]?.type === "identifier") &&
        ch[i + 1]?.type === "function_call_args"
      ) {
        return cur;
      }
    }
    break;
  }
  return null;
}

export function getFunctionCallInfoCst(
  node: CstNodeLike | null | undefined,
): { callee: string; args: SyntaxNode[] } | null {
  if (!node) return null;
  let callNode = findDirectOrWrappedFunctionCallNode(node);
  if (!callNode) {
    let txt = (node.text ?? "").trim();
    if (txt.endsWith(";")) txt = txt.slice(0, -1).trim();
    if (txt.includes("(")) {
      const parsed = parseStandaloneExpressionCst(txt);
      if (parsed) callNode = findDirectOrWrappedFunctionCallNode(parsed);
    }
  }
  if (!callNode) return null;
  const ch: CstNodeLike[] = callNode.children || [];
  const calleeNode =
    callNode.childForFieldName?.("name") ??
    callNode.childForFieldName?.("callee") ??
    ch.find((c) => c.type === "component_reference" || c.type === "name" || c.type === "identifier");
  const callee = stripAsciiWhitespace(calleeNode?.text ?? "");
  if (!callee) return null;
  const args = extractFunctionCallArgExprNodesCst(callNode as SyntaxNode);
  return { callee, args };
}

export function isNamedFunctionCallCst(
  node: CstNodeLike | null | undefined,
  allowedCallees: readonly string[],
): boolean {
  const info = getFunctionCallInfoCst(node);
  return info !== null && allowedCallees.includes(info.callee);
}

export function isReinitCallNode(sNode: CstNodeLike | null | undefined): boolean {
  if (!sNode) return false;
  if (getFunctionCallInfoCst(sNode)?.callee === "reinit") return true;
  const txt = (sNode.text ?? "").trimStart();
  if (firstAsciiToken(txt) !== "reinit") return false;
  return txt.slice("reinit".length).trimStart().startsWith("(");
}

export function formatQualifiedIntArgCallFromCst(
  stmtText: string,
  fnCall: CstNodeLike | null | undefined,
  rootClassName?: string,
): string {
  const info = getFunctionCallInfoCst(fnCall);
  if (!info || !isAsciiIdentifier(info.callee) || info.args.length !== 1) return stmtText;
  const argText = info.args[0]?.text?.trim() ?? "";
  if (!isAsciiDigitsOnly(argText)) return stmtText;
  const qual = rootClassName ? `${rootClassName}.${info.callee}` : info.callee;
  const formattedFn = `${qual}(${Number(argText).toFixed(1)})`;
  const rawCall = (fnCall?.text ?? "").trim();
  return rawCall && stmtText.includes(rawCall) ? stmtText.replace(rawCall, formattedFn) : stmtText;
}

const commandLineOptionCstCache = new WeakMap<object, Map<string, boolean>>();

export function hasCommandLineOptionInCst(rootNode: CstNodeLike | null | undefined, optionName: string): boolean {
  if (!rootNode) return false;
  let byOpt = commandLineOptionCstCache.get(rootNode as object);
  const cached = byOpt?.get(optionName);
  if (cached !== undefined) return cached;
  if (rootNode.text && !rootNode.text.includes(optionName)) {
    if (!byOpt) {
      byOpt = new Map();
      commandLineOptionCstCache.set(rootNode as object, byOpt);
    }
    byOpt.set(optionName, false);
    return false;
  }
  let found = false;
  const stack: CstNodeLike[] = [rootNode];
  while (stack.length > 0) {
    const cur = stack.pop();
    if (!cur) continue;
    if (cur.type === "annotation_clause") {
      const modStack: CstNodeLike[] = [cur];
      while (modStack.length > 0) {
        const mNode = modStack.pop();
        if (!mNode) continue;
        if (mNode.type === "element_modification") {
          const nameNode =
            mNode.childForFieldName?.("name") ??
            (mNode.children || []).find((c) => c.type === "name" || c.type === "identifier");
          if (nameNode?.text?.trim() === "__OpenModelica_commandLineOptions") {
            const modNode =
              mNode.childForFieldName?.("modification") ??
              (mNode.children || []).find((c) => c.type === "modification");
            if (modNode?.text?.includes(optionName)) {
              found = true;
              break;
            }
          }
        }
        for (const ch of mNode.children || []) {
          modStack.push(ch);
        }
      }
      if (found) break;
      continue;
    }
    const children = cur.children || [];
    for (let i = children.length - 1; i >= 0; i--) {
      if (children[i]) stack.push(children[i]!);
    }
  }
  if (!byOpt) {
    byOpt = new Map();
    commandLineOptionCstCache.set(rootNode as object, byOpt);
  }
  byOpt.set(optionName, found);
  return found;
}

export const sharedAnnotationEvaluator = new AnnotationEvaluator();
