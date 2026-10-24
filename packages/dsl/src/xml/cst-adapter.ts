// SPDX-License-Identifier: AGPL-3.0-or-later

import type { Point, SyntaxNode, Tree, TreeCursor } from "../utils/cst-facade.js";
import type { XmlDocument, XmlElement } from "./types.js";

function computeLineStarts(text: string): number[] {
  const starts = [0];
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) {
      starts.push(i + 1);
    }
  }
  return starts;
}

function offsetToPoint(lineStarts: number[], offset: number): Point {
  let low = 0;
  let high = lineStarts.length - 1;
  while (low <= high) {
    const mid = (low + high) >>> 1;
    if (lineStarts[mid]! <= offset) {
      low = mid + 1;
    } else {
      high = mid - 1;
    }
  }
  const row = Math.max(0, low - 1);
  return {
    row: row,
    column: offset - lineStarts[row]!,
  };
}

let nextNodeId = 1;

/**
 * High-performance CST Node adapter wrapping XmlElement to conform to ModelScript's SyntaxNode.
 */
export class XmlCstNode implements SyntaxNode {
  readonly id: number;
  readonly typeId: number = 1;
  readonly grammarId: number = 1;
  readonly tree: Tree;
  readonly element: XmlElement;
  readonly source: string;
  readonly lineStarts: number[];
  readonly parent: XmlCstNode | null;
  private _children: XmlCstNode[] | null = null;

  constructor(element: XmlElement, source: string, tree: Tree, lineStarts: number[], parent: XmlCstNode | null = null) {
    this.id = nextNodeId++;
    this.element = element;
    this.source = source;
    this.tree = tree;
    this.lineStarts = lineStarts;
    this.parent = parent;
  }

  get type(): string {
    return this.element.name;
  }

  get grammarType(): string {
    return this.element.name;
  }

  readonly isNamed = true;
  readonly isMissing = false;
  readonly isExtra = false;
  readonly hasChanges = false;
  readonly hasError = false;
  readonly isError = false;
  readonly parseState = 0;
  readonly nextParseState = 0;

  get startIndex(): number {
    return this.element.start;
  }

  get endIndex(): number {
    return this.element.end;
  }

  get startPosition(): Point {
    return offsetToPoint(this.lineStarts, this.element.start);
  }

  get endPosition(): Point {
    return offsetToPoint(this.lineStarts, this.element.end);
  }

  get text(): string {
    return this.source.slice(this.element.start, this.element.end);
  }

  get children(): XmlCstNode[] {
    if (!this._children) {
      this._children = this.element.children.map(
        (c) => new XmlCstNode(c, this.source, this.tree, this.lineStarts, this),
      );
    }
    return this._children;
  }

  get namedChildren(): XmlCstNode[] {
    return this.children;
  }

  get childCount(): number {
    return this.element.children.length;
  }

  get namedChildCount(): number {
    return this.childCount;
  }

  get firstChild(): XmlCstNode | null {
    return this.children[0] ?? null;
  }

  get firstNamedChild(): XmlCstNode | null {
    return this.firstChild;
  }

  get lastChild(): XmlCstNode | null {
    const ch = this.children;
    return ch.length > 0 ? ch[ch.length - 1]! : null;
  }

  get lastNamedChild(): XmlCstNode | null {
    return this.lastChild;
  }

  get nextSibling(): XmlCstNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.indexOf(this);
    return idx >= 0 && idx < siblings.length - 1 ? siblings[idx + 1]! : null;
  }

  get nextNamedSibling(): XmlCstNode | null {
    return this.nextSibling;
  }

  get previousSibling(): XmlCstNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.indexOf(this);
    return idx > 0 ? siblings[idx - 1]! : null;
  }

  get previousNamedSibling(): XmlCstNode | null {
    return this.previousSibling;
  }

  get descendantCount(): number {
    let count = 0;
    for (const c of this.children) {
      count += 1 + c.descendantCount;
    }
    return count;
  }

  attr(name: string): string | undefined {
    const lower = name.toLowerCase();
    return this.element.attributes.find((a) => a.name.toLowerCase() === lower)?.value;
  }

  child(index: number): XmlCstNode | null {
    return this.children[index] ?? null;
  }

  namedChild(index: number): XmlCstNode | null {
    return this.child(index);
  }

  childForFieldName(fieldName: string): XmlCstNode | null {
    const lower = fieldName.toLowerCase();
    return this.children.find((c) => c.type.toLowerCase() === lower) ?? null;
  }

  childForFieldId(_fieldId: number): XmlCstNode | null {
    return null;
  }

  fieldNameForChild(childIndex: number): string | null {
    const ch = this.child(childIndex);
    return ch ? ch.type : null;
  }

  fieldNameForNamedChild(namedChildIndex: number): string | null {
    return this.fieldNameForChild(namedChildIndex);
  }

  childrenForFieldName(fieldName: string): XmlCstNode[] {
    const lower = fieldName.toLowerCase();
    return this.children.filter((c) => c.type.toLowerCase() === lower);
  }

  childrenForFieldId(_fieldId: number): XmlCstNode[] {
    return [];
  }

  firstChildForIndex(index: number): XmlCstNode | null {
    return this.children.find((c) => c.startIndex >= index) ?? null;
  }

  firstNamedChildForIndex(index: number): XmlCstNode | null {
    return this.firstChildForIndex(index);
  }

  childWithDescendant(descendant: SyntaxNode): XmlCstNode | null {
    for (const c of this.children) {
      if (c === descendant || (c.startIndex <= descendant.startIndex && c.endIndex >= descendant.endIndex)) {
        return c;
      }
    }
    return null;
  }

  closest(types: string | string[]): XmlCstNode | null {
    const matchTypes = Array.isArray(types) ? types.map((t) => t.toLowerCase()) : [types.toLowerCase()];
    if (matchTypes.includes(this.type.toLowerCase())) return this;
    let node = this.parent;
    while (node) {
      if (matchTypes.includes(node.type.toLowerCase())) return node;
      node = node.parent;
    }
    return null;
  }

  equals(other: SyntaxNode): boolean {
    return other instanceof XmlCstNode && other.element === this.element;
  }

  descendantForIndex(startIndex: number, endIndex = startIndex): XmlCstNode {
    for (const c of this.children) {
      if (c.startIndex <= startIndex && c.endIndex >= endIndex) {
        return c.descendantForIndex(startIndex, endIndex);
      }
    }
    return this;
  }

  namedDescendantForIndex(startIndex: number, endIndex = startIndex): XmlCstNode {
    return this.descendantForIndex(startIndex, endIndex);
  }

  descendantForPosition(startPosition: Point, endPosition = startPosition): XmlCstNode {
    for (const c of this.children) {
      const s = c.startPosition;
      const e = c.endPosition;
      const insideStart =
        s.row < startPosition.row || (s.row === startPosition.row && s.column <= startPosition.column);
      const insideEnd = e.row > endPosition.row || (e.row === endPosition.row && e.column >= endPosition.column);
      if (insideStart && insideEnd) {
        return c.descendantForPosition(startPosition, endPosition);
      }
    }
    return this;
  }

  namedDescendantForPosition(startPosition: Point, endPosition = startPosition): XmlCstNode {
    return this.descendantForPosition(startPosition, endPosition);
  }

  descendantsOfType(types: string | string[], _startPosition?: Point, _endPosition?: Point): XmlCstNode[] {
    const matchTypes = Array.isArray(types) ? types.map((t) => t.toLowerCase()) : [types.toLowerCase()];
    const result: XmlCstNode[] = [];
    const traverse = (n: XmlCstNode) => {
      if (matchTypes.includes(n.type.toLowerCase())) {
        result.push(n);
      }
      for (const c of n.children) traverse(c);
    };
    for (const c of this.children) traverse(c);
    return result;
  }

  walk(): TreeCursor {
    return new XmlTreeCursor(this);
  }

  toString(): string {
    return `(${this.type} [${this.startIndex}, ${this.endIndex}])`;
  }
}

class XmlTreeCursor implements TreeCursor {
  private current: XmlCstNode;
  readonly nodeStateId = 0;
  readonly currentFieldId = 0;
  readonly currentDepth = 0;
  readonly currentDescendantIndex = 0;

  constructor(node: XmlCstNode) {
    this.current = node;
  }

  get nodeType(): string {
    return this.current.type;
  }

  get nodeTypeId(): number {
    return this.current.typeId;
  }

  get nodeText(): string {
    return this.current.text;
  }

  readonly nodeIsNamed = true;
  readonly nodeIsMissing = false;

  get startPosition(): Point {
    return this.current.startPosition;
  }

  get endPosition(): Point {
    return this.current.endPosition;
  }

  get startIndex(): number {
    return this.current.startIndex;
  }

  get endIndex(): number {
    return this.current.endIndex;
  }

  get currentNode(): SyntaxNode {
    return this.current;
  }

  get currentFieldName(): string {
    return this.current.type;
  }

  reset(node: SyntaxNode): void {
    if (node instanceof XmlCstNode) {
      this.current = node;
    }
  }

  resetTo(cursor: TreeCursor): void {
    this.current = cursor.currentNode as XmlCstNode;
  }

  gotoFirstChild(): boolean {
    const ch = this.current.firstChild;
    if (ch) {
      this.current = ch;
      return true;
    }
    return false;
  }

  gotoLastChild(): boolean {
    const ch = this.current.lastChild;
    if (ch) {
      this.current = ch;
      return true;
    }
    return false;
  }

  gotoParent(): boolean {
    if (this.current.parent) {
      this.current = this.current.parent;
      return true;
    }
    return false;
  }

  gotoNextSibling(): boolean {
    const sib = this.current.nextSibling;
    if (sib) {
      this.current = sib;
      return true;
    }
    return false;
  }

  gotoPreviousSibling(): boolean {
    const sib = this.current.previousSibling;
    if (sib) {
      this.current = sib;
      return true;
    }
    return false;
  }

  gotoFirstChildForIndex(goalIndex: number): boolean {
    const ch = this.current.children.find((c) => c.startIndex <= goalIndex && c.endIndex >= goalIndex);
    if (ch) {
      this.current = ch;
      return true;
    }
    return false;
  }

  gotoFirstChildForPosition(goalPosition: Point): boolean {
    const ch = this.current.children.find((c) => {
      const s = c.startPosition;
      const e = c.endPosition;
      return (
        (s.row < goalPosition.row || (s.row === goalPosition.row && s.column <= goalPosition.column)) &&
        (e.row > goalPosition.row || (e.row === goalPosition.row && e.column >= goalPosition.column))
      );
    });
    if (ch) {
      this.current = ch;
      return true;
    }
    return false;
  }

  gotoDescendant(goalDescendantIndex: number): void {
    const d = this.current.descendantForIndex(goalDescendantIndex);
    if (d) {
      this.current = d;
    }
  }
}

/**
 * Creates a SyntaxNode-compliant Tree facade over an XmlDocument.
 */
export function createXmlCstTree(doc: XmlDocument): Tree {
  const lineStarts = computeLineStarts(doc.source);
  const treeObj: Partial<Tree> = {};

  const rootNode = doc.root ? new XmlCstNode(doc.root, doc.source, treeObj as Tree, lineStarts, null) : null;

  (treeObj as any).rootNode = rootNode;
  (treeObj as any).rootNodeId = rootNode?.id ?? 0;
  (treeObj as any).source = doc.source;
  (treeObj as any).lineStarts = lineStarts;
  (treeObj as any).edit = () => {};
  (treeObj as any).walk = () => rootNode?.walk();

  return treeObj as Tree;
}
