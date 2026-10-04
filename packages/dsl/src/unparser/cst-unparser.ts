// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Point, SyntaxNode } from "../utils/cst-facade.js";
import type {
  ChildDeletion,
  ChildInsertion,
  CstPatch,
  CstTextEdit,
  UnparseOptions,
  UnparsePosition,
  UnparseRange,
  UnparseResult,
} from "./types.js";

/**
 * Converts a CST Point ({ row, column }) to an LSP UnparsePosition ({ line, character }).
 */
export function pointToPosition(point: Point): UnparsePosition {
  return {
    line: point.row,
    character: point.column,
  };
}

/**
 * Converts a SyntaxNode's start and end positions to an LSP UnparseRange.
 */
export function nodeToRange(node: SyntaxNode): UnparseRange {
  return {
    start: pointToPosition(node.startPosition),
    end: pointToPosition(node.endPosition),
  };
}

/**
 * Creates an LSP-compatible replacement TextEdit for a SyntaxNode.
 */
export function createReplaceEdit(node: SyntaxNode, newText: string): CstTextEdit {
  return {
    range: nodeToRange(node),
    newText,
  };
}

/**
 * Creates an LSP-compatible insertion TextEdit at a Point or Position.
 */
export function createInsertEdit(pointOrPos: Point | UnparsePosition, text: string): CstTextEdit {
  const pos: UnparsePosition = "row" in pointOrPos ? pointToPosition(pointOrPos) : pointOrPos;
  return {
    range: { start: pos, end: pos },
    newText: text,
  };
}

/**
 * Creates an LSP-compatible deletion TextEdit for a SyntaxNode.
 */
export function createDeleteEdit(node: SyntaxNode): CstTextEdit {
  return {
    range: nodeToRange(node),
    newText: "",
  };
}

/**
 * Generalized Concrete Syntax Tree (CST) Unparser and Surgical Patch Engine.
 */
export class CstUnparser {
  /**
   * Unparses a CST node to its source code representation.
   * If verbatimCleanNodes is true (default), returns the exact source text of the node.
   */
  static unparseNode(node: SyntaxNode, options?: UnparseOptions): string {
    if (!node) return "";
    const verbatim = options?.verbatimCleanNodes ?? true;
    if (verbatim && typeof node.text === "string" && node.text.length > 0) {
      return node.text;
    }
    // Fallback: concatenate child texts or return node text
    if (node.children && node.children.length > 0) {
      return node.children.map((c) => CstUnparser.unparseNode(c, options)).join("");
    }
    return node.text ?? "";
  }

  /**
   * Applies a declarative patch to a CST node and returns a surgical, minimal TextEdit.
   */
  static patchAndUnparse(patch: CstPatch, options?: UnparseOptions): UnparseResult {
    const target = patch.target;
    if (!target) {
      throw new Error("[CstUnparser.patchAndUnparse] target node is required.");
    }

    const sourceCode = (target.tree as any)?.sourceCode ?? target.tree?.rootNode?.text ?? "";

    // 1. Direct Node Replacement
    if (patch.replaceText !== undefined) {
      const edit = createReplaceEdit(target, patch.replaceText);
      return {
        text: patch.replaceText,
        edit,
        startIndex: target.startIndex,
        endIndex: target.endIndex,
      };
    }

    // Collect child replacements (including any fields resolved via childForFieldName)
    const childReplacements = new Map<SyntaxNode, string>(patch.replaceChildren ?? []);
    if (patch.fields) {
      for (const [fieldName, val] of Object.entries(patch.fields)) {
        const fieldNode = target.childForFieldName(fieldName);
        if (fieldNode) {
          childReplacements.set(fieldNode, val);
        }
      }
    }

    // 2. Single Child Replacement Fast-Path (Maximally surgical)
    if (
      childReplacements.size === 1 &&
      (!patch.insertChildren || patch.insertChildren.length === 0) &&
      (!patch.deleteChildren || patch.deleteChildren.length === 0)
    ) {
      const [singleChild, newChildText] = Array.from(childReplacements.entries())[0]!;
      const edit = createReplaceEdit(singleChild, newChildText);
      return {
        text: newChildText,
        edit,
        startIndex: singleChild.startIndex,
        endIndex: singleChild.endIndex,
      };
    }

    // 3. Child Deletions Only Fast-Path
    if (
      patch.deleteChildren &&
      patch.deleteChildren.length > 0 &&
      childReplacements.size === 0 &&
      (!patch.insertChildren || patch.insertChildren.length === 0)
    ) {
      return this.handleChildDeletions(target, patch.deleteChildren, sourceCode);
    }

    // 4. Child Insertions Only Fast-Path
    if (
      patch.insertChildren &&
      patch.insertChildren.length > 0 &&
      childReplacements.size === 0 &&
      (!patch.deleteChildren || patch.deleteChildren.length === 0)
    ) {
      return this.handleChildInsertions(target, patch.insertChildren, sourceCode, options);
    }

    // 5. Complex Multi-Mutation: Reconstruct target node text with hybrid verbatim slicing
    return this.reconstructNodeWithPatches(
      target,
      childReplacements,
      patch.insertChildren ?? [],
      patch.deleteChildren ?? [],
      sourceCode,
    );
  }

  /**
   * Handles deletion of one or more child nodes with clean delimiter handling (e.g. commas).
   */
  private static handleChildDeletions(
    target: SyntaxNode,
    deletions: (SyntaxNode | ChildDeletion)[],
    sourceCode: string,
  ): UnparseResult {
    // If single deletion:
    const firstDel = deletions[0]!;
    const delTarget =
      typeof firstDel === "object" && "target" in firstDel
        ? typeof firstDel.target === "function"
          ? (target.children.find(firstDel.target) ?? null)
          : firstDel.target
        : (firstDel as SyntaxNode);

    if (!delTarget) {
      return {
        text: target.text,
        edit: { range: nodeToRange(target), newText: target.text },
        startIndex: target.startIndex,
        endIndex: target.endIndex,
      };
    }

    let delStart = delTarget.startIndex;
    let delEnd = delTarget.endIndex;

    const cleanDelimiter =
      typeof firstDel === "object" && "cleanAdjacentDelimiter" in firstDel
        ? (firstDel.cleanAdjacentDelimiter ?? true)
        : true;

    if (cleanDelimiter && sourceCode.length > 0) {
      // Check for trailing delimiter (e.g. comma followed by optional spaces)
      let after = sourceCode.substring(delEnd);
      const trailingCommaMatch = after.match(/^\s*,[ \t]*/);
      if (trailingCommaMatch) {
        delEnd += trailingCommaMatch[0].length;
      } else {
        // If no trailing comma, check for leading delimiter (e.g. leading comma before this child)
        const before = sourceCode.substring(target.startIndex, delStart);
        const leadingCommaMatch = before.match(/,[ \t]*$/);
        if (leadingCommaMatch) {
          delStart = target.startIndex + (before.length - leadingCommaMatch[0].length);
        }
      }
    }

    // Compute range from delStart to delEnd
    const startPos = this.offsetToPosition(sourceCode, delStart, target.startPosition);
    const endPos = this.offsetToPosition(sourceCode, delEnd, target.startPosition);

    const edit: CstTextEdit = {
      range: { start: startPos, end: endPos },
      newText: "",
    };

    return {
      text: "",
      edit,
      startIndex: delStart,
      endIndex: delEnd,
    };
  }

  /**
   * Handles insertion of child content into a parent list or block node.
   */
  private static handleChildInsertions(
    target: SyntaxNode,
    insertions: ChildInsertion[],
    sourceCode: string,
    _options?: UnparseOptions,
  ): UnparseResult {
    const firstIns = insertions[0]!;
    const content = firstIns.content;
    const pos = firstIns.position ?? "end";
    const separator = firstIns.separator ?? ", ";

    // Inspect target's named children or arguments
    const namedKids = target.namedChildren ?? target.children.filter((c) => c.isNamed);

    if (namedKids.length === 0) {
      // Empty parent node: look for opening delimiter like '(' or '{'
      let insertOffset = target.startIndex;
      const targetText = target.text;
      const openParen = targetText.indexOf("(");
      const openBrace = targetText.indexOf("{");
      const openIdx = openParen !== -1 ? openParen : openBrace;

      if (openIdx !== -1) {
        insertOffset = target.startIndex + openIdx + 1;
      } else {
        insertOffset = target.endIndex;
      }

      const insertPos = this.offsetToPosition(sourceCode, insertOffset, target.startPosition);
      const edit: CstTextEdit = {
        range: { start: insertPos, end: insertPos },
        newText: content,
      };

      return {
        text: content,
        edit,
        startIndex: insertOffset,
        endIndex: insertOffset,
      };
    }

    if (pos === "start") {
      const firstChild = namedKids[0]!;
      const insertOffset = firstChild.startIndex;
      const insertPos = pointToPosition(firstChild.startPosition);
      const newText = `${content}${separator}`;
      const edit: CstTextEdit = {
        range: { start: insertPos, end: insertPos },
        newText,
      };
      return {
        text: newText,
        edit,
        startIndex: insertOffset,
        endIndex: insertOffset,
      };
    }

    if (pos === "end") {
      const lastChild = namedKids[namedKids.length - 1]!;
      const insertOffset = lastChild.endIndex;
      const insertPos = pointToPosition(lastChild.endPosition);
      const newText = `${separator}${content}`;
      const edit: CstTextEdit = {
        range: { start: insertPos, end: insertPos },
        newText,
      };
      return {
        text: newText,
        edit,
        startIndex: insertOffset,
        endIndex: insertOffset,
      };
    }

    // Relative to referenceChild
    if (firstIns.referenceChild) {
      const refNode =
        typeof firstIns.referenceChild === "function"
          ? (namedKids.find(firstIns.referenceChild) ?? null)
          : firstIns.referenceChild;

      if (refNode) {
        if (pos === "before") {
          const insertOffset = refNode.startIndex;
          const insertPos = pointToPosition(refNode.startPosition);
          const newText = `${content}${separator}`;
          const edit: CstTextEdit = {
            range: { start: insertPos, end: insertPos },
            newText,
          };
          return {
            text: newText,
            edit,
            startIndex: insertOffset,
            endIndex: insertOffset,
          };
        } else {
          // 'after'
          const insertOffset = refNode.endIndex;
          const insertPos = pointToPosition(refNode.endPosition);
          const newText = `${separator}${content}`;
          const edit: CstTextEdit = {
            range: { start: insertPos, end: insertPos },
            newText,
          };
          return {
            text: newText,
            edit,
            startIndex: insertOffset,
            endIndex: insertOffset,
          };
        }
      }
    }

    // Fallback: append at target.endIndex
    const insertPos = pointToPosition(target.endPosition);
    return {
      text: content,
      edit: { range: { start: insertPos, end: insertPos }, newText: content },
      startIndex: target.endIndex,
      endIndex: target.endIndex,
    };
  }

  /**
   * Multi-patch reconstruction preserving verbatim trivia between unchanged child nodes.
   */
  private static reconstructNodeWithPatches(
    target: SyntaxNode,
    replacements: Map<SyntaxNode, string>,
    insertions: ChildInsertion[],
    deletions: (SyntaxNode | ChildDeletion)[],
    sourceCode: string,
  ): UnparseResult {
    let result = "";
    let cursor = target.startIndex;

    const delSet = new Set<SyntaxNode>();
    for (const d of deletions) {
      const n =
        typeof d === "object" && "target" in d
          ? typeof d.target === "function"
            ? target.children.find(d.target)
            : d.target
          : (d as SyntaxNode);
      if (n) delSet.add(n);
    }

    // Walk all immediate children in order
    for (const child of target.children) {
      if (child.startIndex > cursor) {
        // Append verbatim trivia between previous child and this child
        result += sourceCode.substring(cursor, child.startIndex);
      }

      if (delSet.has(child)) {
        // Skip deleted child
        cursor = child.endIndex;
        continue;
      }

      if (replacements.has(child)) {
        result += replacements.get(child)!;
        cursor = child.endIndex;
        continue;
      }

      // Untouched child: emit verbatim from source
      result += sourceCode.substring(child.startIndex, child.endIndex);
      cursor = child.endIndex;
    }

    if (cursor < target.endIndex) {
      result += sourceCode.substring(cursor, target.endIndex);
    }

    const edit = createReplaceEdit(target, result);
    return {
      text: result,
      edit,
      startIndex: target.startIndex,
      endIndex: target.endIndex,
    };
  }

  /**
   * Helper to convert an absolute character offset into a { line, character } position.
   */
  private static offsetToPosition(source: string, offset: number, _hintPoint?: Point): UnparsePosition {
    let line = 0;
    let character = 0;
    for (let i = 0; i < offset && i < source.length; i++) {
      if (source[i] === "\n") {
        line++;
        character = 0;
      } else {
        character++;
      }
    }
    return { line, character };
  }
}
