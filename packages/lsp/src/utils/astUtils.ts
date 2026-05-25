/* eslint-disable @typescript-eslint/no-explicit-any */
import { Scope } from "@modelscript/compiler";
import {
  ModelicaClassInstance,
  ModelicaComponentInstance,
  ModelicaElement,
  ModelicaElement as ModelicaNamedElement,
} from "@modelscript/modelica/semantic-model";
import { Node as SyntaxNode } from "web-tree-sitter";

export function isClassInstance(obj: any): obj is ModelicaClassInstance {
  return obj && "classKind" in obj;
}

/**
 * Compute the position (row, column) at a given byte index in a string.
 */
export function indexToPoint(text: string, index: number): { row: number; column: number } {
  let row = 0;
  let lastNewline = -1;
  for (let i = 0; i < index; i++) {
    if (text[i] === "\n") {
      row++;
      lastNewline = i;
    }
  }
  return { row, column: index - lastNewline - 1 };
}

/**
 * Compute a tree-sitter Edit by finding the common prefix and suffix between
 * old and new text. This is O(n) but practically near-instant since we stop
 * at the first/last differing character.
 */
export function computeTreeEdit(
  oldText: string,
  newText: string,
): {
  startIndex: number;
  oldEndIndex: number;
  newEndIndex: number;
  startPosition: { row: number; column: number };
  oldEndPosition: { row: number; column: number };
  newEndPosition: { row: number; column: number };
} {
  // Find common prefix
  const minLen = Math.min(oldText.length, newText.length);
  let prefixLen = 0;
  while (prefixLen < minLen && oldText[prefixLen] === newText[prefixLen]) {
    prefixLen++;
  }

  // Find common suffix (not overlapping with prefix)
  let oldSuffix = oldText.length;
  let newSuffix = newText.length;
  while (oldSuffix > prefixLen && newSuffix > prefixLen && oldText[oldSuffix - 1] === newText[newSuffix - 1]) {
    oldSuffix--;
    newSuffix--;
  }

  return {
    startIndex: prefixLen,
    oldEndIndex: oldSuffix,
    newEndIndex: newSuffix,
    startPosition: indexToPoint(oldText, prefixLen),
    oldEndPosition: indexToPoint(oldText, oldSuffix),
    newEndPosition: indexToPoint(newText, newSuffix),
  };
}

/* Resolve a modification/annotation path element to its named element */
export function resolvePathElement(node: SyntaxNode, scope: Scope): ModelicaNamedElement | null {
  let pathNode: SyntaxNode | null = node;
  const parameterPath: string[] = [];
  let baseElement: ModelicaNamedElement | null = null;
  let foundBase = false;

  while (pathNode) {
    if (pathNode.type === "ElementModification") {
      const nameNode = pathNode.children.find((c: SyntaxNode) => c.type === "Name");
      if (nameNode) {
        parameterPath.unshift(...nameNode.text.split("."));
      }
    } else if (pathNode.type === "NamedArgument") {
      const identNode = pathNode.childForFieldName("identifier");
      if (identNode) {
        parameterPath.unshift(identNode.text);
      }
    }

    // If we hit a FunctionCall, it's a base (potential record constructor)
    if (pathNode.type === "FunctionCall") {
      const refNode = pathNode.children.find((c: SyntaxNode) => c.type === "ComponentReference");
      if (refNode) {
        const funcRef = refNode.text;
        baseElement = scope.resolveName(funcRef.split("."));
        if (!baseElement) {
          const annotationClass = (ModelicaElement as any).annotationClassInstance;
          if (annotationClass) {
            baseElement = annotationClass.resolveSimpleName(funcRef);
            if (!baseElement && funcRef.includes(".")) {
              baseElement = annotationClass.resolveName(funcRef.split("."));
            }
          }
        }
        if (baseElement) {
          foundBase = true;
          break;
        }
      }
    }

    if (pathNode.type === "AnnotationClause") {
      baseElement = (ModelicaElement as any).annotationClassInstance;
      foundBase = true;
      break;
    }

    if (
      pathNode.type === "ComponentClause" ||
      pathNode.type === "ShortClassSpecifier" ||
      pathNode.type === "ExtendsClause"
    ) {
      const typeSpecNode = pathNode.children.find((c: SyntaxNode) => c.type === "TypeSpecifier");
      if (typeSpecNode) {
        baseElement = scope.resolveName(typeSpecNode.text.split("."));
        foundBase = true;
        break;
      }
    }

    pathNode = pathNode.parent;
  }

  if (foundBase && baseElement) {
    return isClassInstance(baseElement)
      ? baseElement.resolveName(parameterPath)
      : baseElement instanceof ModelicaComponentInstance
        ? (baseElement.classInstance?.resolveName(parameterPath) ?? null)
        : null;
  }
  return null;
}

export function nodeRange(node: SyntaxNode): {
  start: { line: number; character: number };
  end: { line: number; character: number };
} {
  return {
    start: { line: node.startPosition.row, character: node.startPosition.column },
    end: { line: node.endPosition.row, character: node.endPosition.column },
  };
}
