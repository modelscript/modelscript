import { LspFacade } from "./bindings.js";

/**
 * Represents a line and column position in the source code.
 */
export interface Point {
  row: number;
  column: number;
}

/**
 * A Tree-sitter compatible facade for a ModelScript AST Node.
 * This class wraps a pointer to the WASM linear memory and lazily decodes
 * the node properties (type, length, padding) on demand, enabling zero-copy
 * traversal of the syntax tree from JavaScript.
 *
 * WARNING: This file must be kept manually in sync with the duplicated version
 * at the bottom of `packages/language/src/bindings/javascript/bindings.ts`.
 */
export class SyntaxNode {
  constructor(
    public readonly tree: Tree,
    public readonly ptr: number,
    public readonly _startOffset: number,
    public readonly parent: SyntaxNode | null,
    public readonly _cachedPad: number,
    public readonly _cachedLen: number,
    public readonly _cachedTypeId: number,
  ) {}

  /**
   * Gets the semantic type name of this node (e.g., 'ModelicaClassDefinition').
   */
  get type(): string {
    if (this._cachedTypeId === 0) return "ERROR";
    let name = this.tree.facade.syntaxNames[this._cachedTypeId] || `node_${this._cachedTypeId}`;
    if (name.startsWith("T_")) name = name.substring(2);
    return name;
  }

  /**
   * Extracts the substring from the original source code corresponding to this node.
   */
  get text(): string {
    return this.tree.sourceCode.substring(this.startIndex, this.endIndex);
  }

  /**
   * The start byte index of the node, excluding its leading invisible padding.
   */
  get startIndex(): number {
    return this._startOffset + this._cachedPad;
  }

  /**
   * The end byte index of the node.
   */
  get endIndex(): number {
    return this.startIndex + this._cachedLen;
  }

  /**
   * Returns true if this node was inserted by the parser to recover from a syntax error.
   */
  isMissing(): boolean {
    if (this.ptr === 0) return false;
    const typeFlags = this.tree.mem32[this.ptr / 4];
    return (typeFlags & 256) !== 0;
  }

  /**
   * The line and column where this node starts.
   */
  get startPosition(): Point {
    return this.tree.offsetToPoint(this.startIndex);
  }

  /**
   * The line and column where this node ends.
   */
  get endPosition(): Point {
    return this.tree.offsetToPoint(this.endIndex);
  }

  /**
   * Returns a list of all child nodes by walking the WASM sibling linked list.
   * Also extracts and synthesizes garbage nodes from padding if the tree contains errors.
   */
  get children(): SyntaxNode[] {
    const mem32 = this.tree.mem32;
    const kids: SyntaxNode[] = [];
    let childOffset = this._startOffset + this._cachedPad;
    if (this.ptr === 0) return kids; // Synthetic nodes have no children
    let childPtr = mem32[(this.ptr + 12) / 4];
    while (childPtr !== 0) {
      const typeFlags = mem32[childPtr / 4];
      const typeId = typeFlags & 0x03ff;
      const envHashPadding = mem32[(childPtr + 4) / 4];
      const rawPad = typeFlags >>> 22;
      const isFat = (envHashPadding >>> 23) & 1;
      const pad =
        isFat && this.tree.facade.exports.getFatPaddingPtr
          ? mem32[this.tree.facade.exports.getFatPaddingPtr(rawPad) / 4]
          : rawPad;
      const len = envHashPadding & 0x007fffff;

      // Extract garbage tokens hidden in padding if this subtree contains errors
      if (pad > 0 && this._cachedTypeId === 0) {
        let inGarbage = false;
        let garbageStart = 0;
        for (let i = 0; i < pad; i++) {
          let charCode = this.tree.sourceCode.charCodeAt(childOffset + i);
          let isWs = charCode === 32 || charCode === 9 || charCode === 10 || charCode === 13;
          if (!isWs && !inGarbage) {
            inGarbage = true;
            garbageStart = i;
          } else if (isWs && inGarbage) {
            inGarbage = false;
            let garbageLen = i - garbageStart;
            kids.push(new SyntaxNode(this.tree, 0, childOffset, this, garbageStart, garbageLen, 0));
          }
        }
        if (inGarbage) {
          let garbageLen = pad - garbageStart;
          kids.push(new SyntaxNode(this.tree, 0, childOffset, this, garbageStart, garbageLen, 0));
        }
      }

      kids.push(new SyntaxNode(this.tree, childPtr, childOffset, this, pad, len, typeId));

      childOffset = childOffset + pad + len;
      childPtr = mem32[(childPtr + 16) / 4];
    }
    return kids;
  }

  /**
   * Gets the first child of the node.
   */
  get firstChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[0] : null;
  }

  /**
   * Gets the last child of the node.
   */
  get lastChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[kids.length - 1] : null;
  }

  /**
   * Gets the next sibling of the node.
   */
  get nextSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }

  /**
   * Gets the previous sibling of the node.
   */
  get previousSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }

  /**
   * Gets the number of children the node has.
   */
  get childCount(): number {
    return this.children.length;
  }

  /**
   * Gets the child at the specified index.
   */
  child(index: number): SyntaxNode | null {
    const kids = this.children;
    if (index >= 0 && index < kids.length) return kids[index];
    return null;
  }

  /**
   * Returns true if the node is a named node.
   */
  isNamed(): boolean {
    const t = this.type;
    return !t.startsWith('"') && !t.startsWith("_");
  }

  /**
   * Returns true if the node or any of its descendants represents a syntax error.
   */
  hasError(): boolean {
    if (this._cachedTypeId === 0) return true;
    for (const kid of this.children) {
      if (kid.hasError()) return true;
    }
    return false;
  }

  /**
   * Creates a stateful TreeCursor for traversing the tree starting at this node.
   */
  walk(): TreeCursor {
    return new TreeCursor(this);
  }
}

/**
 * A Tree-sitter compatible stateful cursor for efficiently walking the syntax tree
 * without instantiating objects for every node.
 *
 * WARNING: This file must be kept manually in sync with the duplicated version
 * at the bottom of `packages/language/src/bindings/javascript/bindings.ts`.
 */
export class TreeCursor {
  private stack: { node: SyntaxNode; childIndex: number }[] = [];
  private current: SyntaxNode;

  constructor(node: SyntaxNode) {
    this.current = node;
  }

  get nodeType(): string {
    return this.current.type;
  }

  get nodeText(): string {
    return this.current.text;
  }

  get currentNode(): SyntaxNode {
    return this.current;
  }

  get startIndex(): number {
    return this.current.startIndex;
  }

  get endIndex(): number {
    return this.current.endIndex;
  }

  isMissing(): boolean {
    return this.current.isMissing();
  }

  get startPosition(): Point {
    return this.current.startPosition;
  }

  get endPosition(): Point {
    return this.current.endPosition;
  }

  /**
   * Moves the cursor to the first child of the current node.
   * Returns true if a child existed, false otherwise.
   */
  gotoFirstChild(): boolean {
    const kids = this.current.children;
    if (kids.length === 0) return false;

    this.stack.push({ node: this.current, childIndex: 0 });
    this.current = kids[0];
    return true;
  }

  /**
   * Moves the cursor to the next sibling of the current node.
   * Returns true if a next sibling existed, false otherwise.
   */
  gotoNextSibling(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack[this.stack.length - 1];
    const siblings = parentFrame.node.children;

    if (parentFrame.childIndex + 1 < siblings.length) {
      parentFrame.childIndex++;
      this.current = siblings[parentFrame.childIndex];
      return true;
    }
    return false;
  }

  /**
   * Moves the cursor to the parent of the current node.
   * Returns true if a parent existed, false otherwise.
   */
  gotoParent(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack.pop()!;
    this.current = parentFrame.node;
    return true;
  }
}

/**
 * Represents the root of a parsed syntax tree.
 *
 * WARNING: This file must be kept manually in sync with the duplicated version
 * at the bottom of `packages/language/src/bindings/javascript/bindings.ts`.
 */
export class Tree {
  public lineStarts: number[];
  public mem32: Uint32Array;

  constructor(
    public readonly facade: LspFacade,
    public readonly rootPtr: number,
    public readonly sourceCode: string,
  ) {
    this.lineStarts = [0];
    for (let i = 0; i < sourceCode.length; i++) {
      if (sourceCode[i] === "\n") this.lineStarts.push(i + 1);
    }
    this.mem32 = new Uint32Array((facade as any).wasmMemory.buffer);
  }

  /**
   * Gets the root node of the syntax tree.
   */
  get rootNode(): SyntaxNode {
    if (!this.rootPtr) throw new Error("Null root pointer");

    const typeFlags = this.mem32[this.rootPtr / 4];
    const typeId = typeFlags & 0x03ff;
    const envHashPadding = this.mem32[(this.rootPtr + 4) / 4];
    const rawPad = typeFlags >>> 22;
    const isFat = (envHashPadding >>> 23) & 1;
    const pad =
      isFat && this.facade.exports.getFatPaddingPtr
        ? this.mem32[this.facade.exports.getFatPaddingPtr(rawPad) / 4]
        : rawPad;
    const len = envHashPadding & 0x007fffff;

    return new SyntaxNode(this, this.rootPtr, 0, null, pad, len, typeId);
  }

  /**
   * Creates a stateful TreeCursor for traversing the tree starting at the root.
   */
  walk(): TreeCursor {
    return this.rootNode.walk();
  }

  /**
   * Converts a linear byte offset into a row and column Point.
   * @param offset The byte offset in the source file.
   */
  offsetToPoint(offset: number): Point {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low <= high) {
      const mid = (low + high) >> 1;
      if (this.lineStarts[mid] <= offset) {
        if (mid === this.lineStarts.length - 1 || this.lineStarts[mid + 1] > offset) {
          return { row: mid, column: offset - this.lineStarts[mid] };
        }
        low = mid + 1;
      } else {
        high = mid - 1;
      }
    }
    return { row: 0, column: offset };
  }
}
