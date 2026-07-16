import { LspFacade } from "./bindings.js";

export interface Point {
  row: number;
  column: number;
}

/**
 * A Tree-sitter compatible facade for a ModelScript AST Node.
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

  get type(): string {
    if (this._cachedTypeId === 0) return "ERROR";
    let name = this.tree.facade.syntaxNames[this._cachedTypeId] || `node_${this._cachedTypeId}`;
    if (name.startsWith("T_")) name = name.substring(2);
    return name;
  }

  get text(): string {
    return this.tree.sourceCode.substring(this.startIndex, this.endIndex);
  }

  get startIndex(): number {
    return this._startOffset + this._cachedPad;
  }

  get endIndex(): number {
    return this.startIndex + this._cachedLen;
  }

  get startPosition(): Point {
    return this.tree.offsetToPoint(this.startIndex);
  }

  get endPosition(): Point {
    return this.tree.offsetToPoint(this.endIndex);
  }

  get children(): SyntaxNode[] {
    const mem32 = this.tree.mem32;
    const kids: SyntaxNode[] = [];
    let childOffset = this._startOffset;
    if (this.ptr === 0) return kids; // Synthetic nodes have no children
    let childPtr = mem32[(this.ptr + 8) / 4];

    while (childPtr !== 0) {
      const typeFlags = mem32[childPtr / 4];
      const typeId = typeFlags & 0x03ff;
      const envHashPadding = mem32[(childPtr + 4) / 4];
      const rawPad = typeFlags >>> 19;
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
      childPtr = mem32[(childPtr + 12) / 4];
    }
    return kids;
  }

  get firstChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[0] : null;
  }

  get lastChild(): SyntaxNode | null {
    const kids = this.children;
    return kids.length > 0 ? kids[kids.length - 1] : null;
  }

  get nextSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx >= 0 && idx < siblings.length - 1) {
      return siblings[idx + 1];
    }
    return null;
  }

  get previousSibling(): SyntaxNode | null {
    if (!this.parent) return null;
    const siblings = this.parent.children;
    const idx = siblings.findIndex((s) => s.ptr === this.ptr && s.startIndex === this.startIndex);
    if (idx > 0) {
      return siblings[idx - 1];
    }
    return null;
  }

  get childCount(): number {
    return this.children.length;
  }

  child(index: number): SyntaxNode | null {
    const kids = this.children;
    if (index >= 0 && index < kids.length) return kids[index];
    return null;
  }

  isMissing(): boolean {
    return this._cachedLen === 0 && this._cachedTypeId !== 0;
  }

  isNamed(): boolean {
    const t = this.type;
    return !t.startsWith('"') && !t.startsWith("_");
  }

  hasError(): boolean {
    if (this._cachedTypeId === 0) return true;
    for (const kid of this.children) {
      if (kid.hasError()) return true;
    }
    return false;
  }

  walk(): TreeCursor {
    return new TreeCursor(this);
  }
}

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

  get startPosition(): Point {
    return this.current.startPosition;
  }

  get endPosition(): Point {
    return this.current.endPosition;
  }

  gotoFirstChild(): boolean {
    const kids = this.current.children;
    if (kids.length === 0) return false;

    this.stack.push({ node: this.current, childIndex: 0 });
    this.current = kids[0];
    return true;
  }

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

  gotoParent(): boolean {
    if (this.stack.length === 0) return false;
    const parentFrame = this.stack.pop()!;
    this.current = parentFrame.node;
    return true;
  }
}

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

  get rootNode(): SyntaxNode {
    if (!this.rootPtr) throw new Error("Null root pointer");

    const typeFlags = this.mem32[this.rootPtr / 4];
    const typeId = typeFlags & 0x03ff;
    const envHashPadding = this.mem32[(this.rootPtr + 4) / 4];
    const rawPad = typeFlags >>> 19;
    const isFat = (envHashPadding >>> 23) & 1;
    const pad =
      isFat && this.facade.exports.getFatPaddingPtr
        ? this.mem32[this.facade.exports.getFatPaddingPtr(rawPad) / 4]
        : rawPad;
    const len = envHashPadding & 0x007fffff;

    return new SyntaxNode(this, this.rootPtr, 0, null, pad, len, typeId);
  }

  walk(): TreeCursor {
    return this.rootNode.walk();
  }

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
