// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SyntaxNode } from "../utils/cst-facade.js";

/**
 * 0-indexed text position matching Language Server Protocol (LSP).
 */
export interface UnparsePosition {
  line: number;
  character: number;
}

/**
 * Text range matching Language Server Protocol (LSP).
 */
export interface UnparseRange {
  start: UnparsePosition;
  end: UnparsePosition;
}

/**
 * Text replacement matching Language Server Protocol (LSP) TextEdit.
 */
export interface CstTextEdit {
  range: UnparseRange;
  newText: string;
}

/**
 * Result of unparsing or patching a CST node.
 */
export interface UnparseResult {
  /** The unparsed source code text for the targeted node/subtree */
  text: string;
  /** Surgical LSP-compatible TextEdit that applies this change to the source file */
  edit: CstTextEdit;
  /** Start character offset in the source document */
  startIndex: number;
  /** End character offset in the source document */
  endIndex: number;
}

/**
 * Child insertion options for list and block nodes.
 */
export interface ChildInsertion {
  /** Text content or sub-patch to insert */
  content: string;
  /** Position to insert: 'start' (first child), 'end' (last child), or relative to an existing child */
  position?: "start" | "end" | "before" | "after" | undefined;
  /** Reference child node or predicate to insert before/after */
  referenceChild?: SyntaxNode | ((child: SyntaxNode) => boolean) | undefined;
  /** Separator token to use if in a delimited list (default: ", " for argument lists, "\n" for statement blocks) */
  separator?: string | undefined;
}

/**
 * Child deletion descriptor.
 */
export interface ChildDeletion {
  /** Child node to delete or predicate finding the child */
  target: SyntaxNode | ((child: SyntaxNode) => boolean);
  /** Whether to cleanly consume adjacent delimiters (e.g. leading or trailing comma). Default: true */
  cleanAdjacentDelimiter?: boolean | undefined;
}

/**
 * Declarative patch applied to a SyntaxNode or its subtree.
 */
export interface CstPatch {
  /**
   * The CST node being modified, replaced, or acting as the parent context.
   */
  target: SyntaxNode;

  /**
   * Complete replacement text for the target node.
   * If provided, the target node's entire span [target.startIndex, target.endIndex] is replaced by this text.
   */
  replaceText?: string | undefined;

  /**
   * Specific child nodes to replace (maps child SyntaxNode to new replacement text).
   */
  replaceChildren?: Map<SyntaxNode, string> | undefined;

  /**
   * Child nodes to insert into this node's child list.
   */
  insertChildren?: ChildInsertion[] | undefined;

  /**
   * Child nodes to delete from this node.
   */
  deleteChildren?: (SyntaxNode | ChildDeletion)[] | undefined;

  /**
   * Field replacements (maps grammar field names to new string values).
   */
  fields?: Record<string, string> | undefined;
}

/**
 * Configuration options for unparsing.
 */
export interface UnparseOptions {
  /**
   * Indentation size in spaces (default: 2).
   */
  indentSize?: number | undefined;

  /**
   * Base indentation level (number of indents) to apply (default: inferred from target line).
   */
  baseIndentLevel?: number | undefined;

  /**
   * When true, unmodified clean nodes are emitted verbatim from the input buffer.
   * Default: true.
   */
  verbatimCleanNodes?: boolean | undefined;

  /**
   * Newline delimiter to use ('\n' or '\r\n'). Default: '\n'.
   */
  newline?: string | undefined;
}
