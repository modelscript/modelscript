// SPDX-License-Identifier: AGPL-3.0-or-later

import type { DAEBuilder, DaeDiagnosticRange } from "@modelscript/runtime";
import type { SyntaxNode } from "../../../../src-gen/bindings.js";
import type { FlatteningState, SourceSpan } from "../../support/state.js";
import type { ComponentModArgData, FlattenerHostLike } from "../../types.js";
import {
  isAsciiIdentContinue,
  isAsciiIdentStart,
  isAsciiWhitespaceCode,
  stripOuterDoubleQuotes,
} from "../cst-utils.js";
import type {
  DaeExtMetadataLike,
  LowererDaeExt,
  LowererFlattenerExt,
  LowererFlatteningState,
  ModArgLike,
} from "./types.js";

export function asDaeExt(dae: DAEBuilder): LowererDaeExt {
  return dae as LowererDaeExt;
}

export function asFlattenerExt(flattener: FlattenerHostLike | undefined): LowererFlattenerExt | undefined {
  return flattener as unknown as LowererFlattenerExt | undefined;
}

export function asStateExt(state: FlatteningState): LowererFlatteningState {
  return state as LowererFlatteningState;
}

export function getDaeExtMeta(dae: DAEBuilder): DaeExtMetadataLike | undefined {
  return dae.extensionMetadata as DaeExtMetadataLike | undefined;
}

export function getModArgs(
  mods: { args?: readonly ComponentModArgData[] | undefined } | null | undefined,
): readonly ModArgLike[] | undefined {
  return mods?.args as readonly ModArgLike[] | undefined;
}

export function findLastItem<T>(arr: readonly T[] | undefined, predicate: (item: T) => boolean): T | undefined {
  if (!arr) return undefined;
  for (let i = arr.length - 1; i >= 0; i--) {
    const item = arr[i]!;
    if (predicate(item)) return item;
  }
  return undefined;
}

export function toDiagnosticRange(span: SourceSpan | undefined): DaeDiagnosticRange | undefined {
  if (!span) return undefined;
  return {
    startOffset: span.startOffset,
    endOffset: span.endOffset,
    startPosition: span.startPosition as { row: number; column: number } | undefined,
    endPosition: span.endPosition as { row: number; column: number } | undefined,
  };
}

export function collectCstIdentifiers(root: SyntaxNode | null | undefined): string[] {
  const result: string[] = [];
  if (!root) return result;
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "identifier") {
      const name = cur.text?.trim() ?? "";
      if (name.length > 0) result.push(name);
    }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const c = cur.child(i);
      if (c) stack.push(c);
    }
  }
  return result;
}

export function cstHasTokenText(root: SyntaxNode | null | undefined, tokenText: string): boolean {
  if (!root) return false;
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (
      cur.type === tokenText ||
      stripOuterDoubleQuotes(cur.type ?? "") === tokenText ||
      (cur.childCount === 0 && (cur.text?.trim() ?? "") === tokenText)
    ) {
      return true;
    }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const c = cur.child(i);
      if (c) stack.push(c);
    }
  }
  return false;
}

export function cstHasDerCall(root: SyntaxNode | null | undefined): boolean {
  if (!root) return false;
  const stack: SyntaxNode[] = [root];
  while (stack.length > 0) {
    const cur = stack.pop()!;
    if (cur.type === "der") return true;
    if (
      (cur.type === "primary" || cur.type === "lhs_primary" || cur.type === "function_call") &&
      stripOuterDoubleQuotes(cur.child(0)?.text?.trim() ?? cur.child(0)?.type ?? "") === "der"
    ) {
      return true;
    }
    for (let i = cur.childCount - 1; i >= 0; i--) {
      const c = cur.child(i);
      if (c) stack.push(c);
    }
  }
  return false;
}

export function readLeadingAsciiIdentifier(text: string): string {
  if (text.length === 0 || !isAsciiIdentStart(text.charCodeAt(0))) return "";
  let end = 1;
  while (end < text.length && isAsciiIdentContinue(text.charCodeAt(end))) {
    end++;
  }
  return text.slice(0, end);
}

export function extractExternalBuiltinCall(externalDecl: string): { fnName: string; hasNonEmptyArg: boolean } | null {
  let inQuote = false;
  let i = 0;
  while (i < externalDecl.length) {
    const code = externalDecl.charCodeAt(i);
    if (inQuote) {
      if (code === 92 /* '\\' */) {
        i += 2;
        continue;
      }
      if (code === 34 /* '"' */) inQuote = false;
      i++;
      continue;
    }
    if (code === 34 /* '"' */) {
      inQuote = true;
      i++;
      continue;
    }
    if (code === 61 /* '=' */) {
      let j = i + 1;
      while (j < externalDecl.length && isAsciiWhitespaceCode(externalDecl.charCodeAt(j))) j++;
      const nameStart = j;
      while (j < externalDecl.length && isAsciiIdentContinue(externalDecl.charCodeAt(j))) j++;
      if (j > nameStart) {
        const fnName = externalDecl.slice(nameStart, j);
        while (j < externalDecl.length && isAsciiWhitespaceCode(externalDecl.charCodeAt(j))) j++;
        if (j < externalDecl.length && externalDecl.charCodeAt(j) === 40 /* '(' */) {
          let k = j + 1;
          let hasNonEmptyArg = false;
          let foundClose = false;
          while (k < externalDecl.length) {
            const innerCode = externalDecl.charCodeAt(k);
            if (innerCode === 41 /* ')' */) {
              foundClose = true;
              break;
            }
            if (!isAsciiWhitespaceCode(innerCode)) hasNonEmptyArg = true;
            k++;
          }
          if (foundClose) {
            return { fnName, hasNonEmptyArg };
          }
        }
      }
    }
    i++;
  }
  return null;
}
