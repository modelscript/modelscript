export type Point = {
    row: number;
    column: number;
};

export type Range = {
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
};

export type Edit = {
    startIndex: number;
    oldEndIndex: number;
    newEndIndex: number;
    startPosition: Point;
    oldEndPosition: Point;
    newEndPosition: Point;
};

export interface SyntaxNode {
    tree: Tree;
    type: string;
    text: string;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;
    parent: SyntaxNode | null;
    children: Array<SyntaxNode>;
    namedChildren: Array<SyntaxNode>;
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

    hasChanges(): boolean;
    hasError(): boolean;
    isMissing(): boolean;
    toString(): string;
    child(index: number): SyntaxNode | null;
    namedChild(index: number): SyntaxNode | null;

    walk(): TreeCursor;
}

export interface TreeCursor {
    nodeType: string;
    nodeText: string;
    nodeIsNamed: boolean;
    nodeIsMissing: boolean;
    startPosition: Point;
    endPosition: Point;
    startIndex: number;
    endIndex: number;

    reset(node: SyntaxNode): void;
    gotoParent(): boolean;
    gotoFirstChild(): boolean;
    gotoFirstChildForIndex(index: number): boolean;
    gotoNextSibling(): boolean;
}

export interface Tree {
    readonly rootNode: SyntaxNode;

    edit(delta: Edit): Tree;
    walk(): TreeCursor;
    getChangedRanges(other: Tree): Range[];
    getEditedRange(other: Tree): Range;
}

export function currentFieldName(cursor: any) {
    return typeof cursor.currentFieldName === 'function' ? cursor.currentFieldName.bind(cursor)() : cursor.currentFieldName;
}

export function currentNode(cursor: any) {
    return typeof cursor.currentNode === 'function' ? cursor.currentNode.bind(cursor)() : cursor.currentNode;
}

export function childForFieldName(syntaxNode: SyntaxNode, fieldName: string): SyntaxNode | null {
    return childrenForFieldName(syntaxNode, fieldName).next().value ?? null;
}

export function* childrenForFieldName(syntaxNode: SyntaxNode, fieldName: string): IterableIterator<SyntaxNode> {
    const cursor = syntaxNode.walk();
    if (cursor.gotoFirstChild()) {
        do {
            if (currentFieldName(cursor) === fieldName)
                yield currentNode(cursor);
        } while (cursor.gotoNextSibling());
    }
}