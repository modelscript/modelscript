/**
 * Unified tree-sitter type definitions.
 *
 * This module defines the intersection of types shared between the native
 * `tree-sitter@0.25.0` and `web-tree-sitter@0.26.7` packages so that the
 * core compiler can work with both backends without runtime dependencies
 * on either.
 */

export interface Edit {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: Point;
  oldEndPosition: Point;
  newEndPosition: Point;
}

export interface Parser {
  parse(input: string, oldTree?: Tree | null, options?: unknown): Tree;
  reset(): void;
  getIncludedRanges(): Range[];
}

export interface Point {
  row: number;
  column: number;
}

export interface Range {
  startIndex: number;
  endIndex: number;
  startPosition: Point;
  endPosition: Point;
}

export interface SyntaxNode {
  tree: Tree;
  id: number;
  typeId: number;
  grammarId: number;
  type: string;
  grammarType: string;
  isNamed: boolean;
  isMissing: boolean;
  isExtra: boolean;
  hasChanges: boolean;
  hasError: boolean;
  isError: boolean;
  text: string;
  parseState: number;
  nextParseState: number;
  startPosition: Point;
  endPosition: Point;
  startIndex: number;
  endIndex: number;
  parent: SyntaxNode | null;
  children: SyntaxNode[];
  namedChildren: SyntaxNode[];
  childCount: number;
  namedChildCount: number;
  firstChild: SyntaxNode | null;
  firstNamedChild: SyntaxNode | null;
  lastChild: SyntaxNode | null;
  lastNamedChild: SyntaxNode | null;
  nextSibling: SyntaxNode | null;
  nextNamedSibling: SyntaxNode | null;
  previousSibling: SyntaxNode | null;
  previousNamedSibling: SyntaxNode | null;
  descendantCount: number;

  toString(): string;
  child(index: number): SyntaxNode | null;
  namedChild(index: number): SyntaxNode | null;
  childForFieldName(fieldName: string): SyntaxNode | null;
  childForFieldId(fieldId: number): SyntaxNode | null;
  fieldNameForChild(childIndex: number): string | null;
  fieldNameForNamedChild(namedChildIndex: number): string | null;
  childrenForFieldName(fieldName: string): SyntaxNode[];
  childrenForFieldId(fieldId: number): SyntaxNode[];
  firstChildForIndex(index: number): SyntaxNode | null;
  firstNamedChildForIndex(index: number): SyntaxNode | null;

  /**
   * Get the immediate child that contains the given descendant node.
   * Note that this can return the descendant itself if it is an immediate child.
   */
  childWithDescendant(descendant: SyntaxNode): SyntaxNode | null;

  /**
   * Find the closest ancestor of the current node that matches the given type(s).
   * Available in native tree-sitter ≥0.25.0.
   */
  closest?(types: string | string[]): SyntaxNode | null;

  /**
   * Check if this node is equal to another node.
   * Available in web-tree-sitter ≥0.26.0.
   */
  equals?(other: SyntaxNode): boolean;

  descendantForIndex(startIndex: number, endIndex?: number): SyntaxNode;
  namedDescendantForIndex(startIndex: number, endIndex?: number): SyntaxNode;
  descendantForPosition(startPosition: Point, endPosition?: Point): SyntaxNode;
  namedDescendantForPosition(startPosition: Point, endPosition?: Point): SyntaxNode;
  descendantsOfType(types: string | string[], startPosition?: Point, endPosition?: Point): SyntaxNode[];

  walk(): TreeCursor;
}

export interface Tree {
  readonly rootNode: SyntaxNode;

  rootNodeWithOffset(offsetBytes: number, offsetExtent: Point): SyntaxNode;
  edit(edit: Edit): Tree;
  walk(): TreeCursor;
  getChangedRanges(other: Tree): Range[];
  getIncludedRanges(): Range[];
  getText(node: SyntaxNode): string;
  getEditedRange(): Range;
  printDotGraph(fd?: number): void;
}

export interface TreeCursor {
  nodeType: string;
  nodeTypeId: number;
  nodeStateId: number;
  nodeText: string;
  nodeIsNamed: boolean;
  nodeIsMissing: boolean;
  startPosition: Point;
  endPosition: Point;
  startIndex: number;
  endIndex: number;
  readonly currentNode: SyntaxNode;
  readonly currentFieldName: string;
  readonly currentFieldId: number;
  readonly currentDepth: number;
  readonly currentDescendantIndex: number;

  reset(node: SyntaxNode): void;
  resetTo(cursor: TreeCursor): void;
  gotoParent(): boolean;
  gotoFirstChild(): boolean;
  gotoLastChild(): boolean;
  gotoFirstChildForIndex(goalIndex: number): boolean;
  gotoFirstChildForPosition(goalPosition: Point): boolean;
  gotoNextSibling(): boolean;
  gotoPreviousSibling(): boolean;
  gotoDescendant(goalDescendantIndex: number): void;
}

export interface QueryCapture {
  name: string;
  node: SyntaxNode;
}

export interface QueryMatch {
  pattern: number;
  captures: QueryCapture[];
}

export interface QueryOptions {
  startPosition?: Point;
  endPosition?: Point;
  startIndex?: number;
  endIndex?: number;
  matchLimit?: number;
  maxStartDepth?: number;
}

export interface LookaheadIterator {
  readonly currentTypeId: number;
  readonly currentType: string;
  reset(language: unknown, stateId: number): boolean;
  resetState(stateId: number): boolean;
}
