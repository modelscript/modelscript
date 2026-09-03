/* eslint-disable @typescript-eslint/no-unused-vars, @typescript-eslint/no-explicit-any, @typescript-eslint/no-empty-function */
import type { Edit, Parser, Point, Node as SyntaxNode, Tree } from "web-tree-sitter";

function createSyntheticNode(
  type: string,
  text: string,
  startByte: number,
  endByte: number,
  children: SyntaxNode[] = [],
  fieldNameForChild?: (i: number) => string | null,
): SyntaxNode {
  const node = {
    type,
    text,
    startIndex: startByte,
    endIndex: endByte,
    startPosition: { row: 0, column: startByte },
    endPosition: { row: 0, column: endByte },
    children,
    parent: null as SyntaxNode | null,
    childCount: children.length,
    isNamed: true,
    isMissing: false,
    hasChanges: false,
    hasError: false,
    id: Math.floor(Math.random() * 1000000000),
    child(i: number) {
      return children[i] ?? null;
    },
    childForFieldName(name: string) {
      if (!fieldNameForChild) return null;
      for (let i = 0; i < children.length; i++) {
        if (fieldNameForChild(i) === name) return children[i] ?? null;
      }
      return null;
    },
    fieldNameForChild(i: number) {
      if (fieldNameForChild) return fieldNameForChild(i);
      return null;
    },
    descendantForIndex(start: number, end: number) {
      return node as SyntaxNode;
    },
    walk() {
      throw new Error("Not implemented");
    },
  } as unknown as SyntaxNode;

  for (const child of children) {
    (child as any).parent = node;
  }

  return node;
}

export class MsimParser implements Parser {
  parse(input: string | ((index: number, position?: Point) => string | null), previousTree?: Tree): Tree {
    const text = typeof input === "string" ? input : "";
    let data: any = {};
    try {
      data = JSON.parse(text);
    } catch {
      // Invalid JSON, return empty tree
    }

    const properties = data.exposeProperties || [
      { name: "maxDisplacementZ", type: "Real" },
      { name: "maxVonMisesStress", type: "Real" },
      { name: "maxVelocity", type: "Real" },
      { name: "maxPressure", type: "Real" },
    ];

    const children: SyntaxNode[] = [];

    // We add a synthetic node for each exposed property
    let i = 0;
    for (const prop of properties) {
      const propName = prop.name || `prop${i}`;
      const propType = prop.type || "Real";

      const nameNode = createSyntheticNode("identifier", propName, 0, 0);
      const typeNode = createSyntheticNode("identifier", propType, 0, 0);
      const variabilityNode = createSyntheticNode("identifier", "parameter", 0, 0);

      const propNode = createSyntheticNode(
        "virtual_msim_property",
        propName,
        0,
        0,
        [nameNode, typeNode, variabilityNode],
        (idx) => {
          if (idx === 0) return "name";
          if (idx === 1) return "type";
          if (idx === 2) return "variability";
          return null;
        },
      );
      children.push(propNode);
      i++;
    }

    // A node for the msim class prefixes (so it's recognized as a record)
    const prefixNode = createSyntheticNode("identifier", "record", 0, 0);
    children.push(prefixNode);

    const className = data.className || "AnonymousMsimRecord";

    const classNameNode = createSyntheticNode("identifier", className, 0, 0);
    children.push(classNameNode);

    const rootNode = createSyntheticNode("virtual_msim_record", text, 0, text.length, children, (idx) => {
      if (idx === children.length - 2) return "prefixes";
      if (idx === children.length - 1) return "name";
      return "property";
    });

    const tree: Tree = {
      rootNode,
      edit(edit: Edit) {},
      walk() {
        throw new Error("Not implemented");
      },
      getChangedRanges() {
        return [];
      },
      language: null as any,
      getLanguage() {
        return null as any;
      },
      delete() {},
    } as unknown as Tree;

    return tree;
  }

  getLanguage() {
    return null as any;
  }
  language = null as any;
  getIncludedRanges() {
    return [];
  }
  setLanguage(language: any) {
    return this;
  }
  getLogger() {
    return null as any;
  }
  setLogger(callback: any) {
    return this;
  }
  delete() {}
  setTimeoutMicros(micros: number) {}
  getTimeoutMicros() {
    return 0;
  }
  reset() {}
}
