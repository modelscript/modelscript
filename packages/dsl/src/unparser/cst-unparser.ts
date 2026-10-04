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

    const startIns = insertions.filter((ins) => ins.position === "start");
    const endIns = insertions.filter((ins) => !ins.position || ins.position === "end");
    const relBefore = new Map<SyntaxNode, ChildInsertion[]>();
    const relAfter = new Map<SyntaxNode, ChildInsertion[]>();

    for (const ins of insertions) {
      if (ins.position === "before" || ins.position === "after") {
        const refNode =
          typeof ins.referenceChild === "function"
            ? (target.children.find(ins.referenceChild) ?? null)
            : (ins.referenceChild ?? null);
        if (refNode) {
          const map = ins.position === "before" ? relBefore : relAfter;
          if (!map.has(refNode)) map.set(refNode, []);
          map.get(refNode)!.push(ins);
        }
      }
    }

    // Walk all immediate children in order
    for (let cIdx = 0; cIdx < target.children.length; cIdx++) {
      const child = target.children[cIdx]!;

      // Start insertions before first child
      if (cIdx === 0 && startIns.length > 0) {
        if (child.startIndex > cursor) {
          result += sourceCode.substring(cursor, child.startIndex);
          cursor = child.startIndex;
        }
        for (const ins of startIns) {
          result += ins.content + (ins.separator ?? "\n  ");
        }
      }

      // If this child is a closing delimiter ('}' or 'end') and we have endIns:
      const isClosingChild =
        child.text === "}" ||
        child.type === "}" ||
        child.type === "end" ||
        child.text === "end" ||
        child.text?.startsWith("end ");
      if (isClosingChild && endIns.length > 0) {
        for (const ins of endIns) {
          result += (ins.separator ?? "\n  ") + ins.content;
        }
        endIns.length = 0; // consumed
      }

      if (child.startIndex > cursor) {
        // Append verbatim trivia between previous child and this child
        result += sourceCode.substring(cursor, child.startIndex);
      }

      // 'before' insertions
      if (relBefore.has(child)) {
        for (const ins of relBefore.get(child)!) {
          result += ins.content + (ins.separator ?? "\n  ");
        }
      }

      if (delSet.has(child)) {
        // Skip deleted child
        cursor = child.endIndex;
      } else if (replacements.has(child)) {
        result += replacements.get(child)!;
        cursor = child.endIndex;
      } else {
        // Untouched child: emit verbatim from source
        result += sourceCode.substring(child.startIndex, child.endIndex);
        cursor = child.endIndex;
      }

      // 'after' insertions
      if (relAfter.has(child)) {
        for (const ins of relAfter.get(child)!) {
          result += (ins.separator ?? "\n  ") + ins.content;
        }
      }
    }

    // Handle end insertions before closing delimiter
    if (cursor < target.endIndex) {
      const remainingTrivia = sourceCode.substring(cursor, target.endIndex);
      if (endIns.length > 0) {
        const closeBraceIdx = remainingTrivia.lastIndexOf("}");
        const closeEndIdx = remainingTrivia.search(/\bend\s+[A-Za-z_]/);
        const splitIdx = closeBraceIdx !== -1 ? closeBraceIdx : closeEndIdx;

        if (splitIdx !== -1) {
          result += remainingTrivia.substring(0, splitIdx);
          for (const ins of endIns) {
            result += (ins.separator ?? "\n  ") + ins.content;
          }
          result += (insSeparator(endIns) ?? "\n") + remainingTrivia.substring(splitIdx).trimStart();
        } else {
          for (const ins of endIns) {
            result += (ins.separator ?? "\n  ") + ins.content;
          }
          result += remainingTrivia;
        }
      } else {
        result += remainingTrivia;
      }
    } else if (endIns.length > 0) {
      for (const ins of endIns) {
        result += (ins.separator ?? "\n  ") + ins.content;
      }
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
   * Synchronizes changes from a PolyglotNode into an existing target source file.
   * If a target parser is available, it constructs a surgical CST patch that updates
   * attributes and inserts new definitions while preserving comments, annotations,
   * and unmanaged code blocks.
   */
  static syncTargetSource(
    targetSource: string,
    sourceNode: any,
    targetLang: string,
    targetParser?: any,
  ): UnparseResult {
    if (!targetSource || targetSource.trim().length === 0 || !targetParser) {
      return {
        text: targetSource,
        edit: {
          range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } },
          newText: targetSource,
        },
        startIndex: 0,
        endIndex: 0,
      };
    }

    try {
      const tree = targetParser.parse(targetSource);
      const root = tree.rootNode;
      if (!root) {
        return {
          text: targetSource,
          edit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: targetSource },
          startIndex: 0,
          endIndex: 0,
        };
      }

      function findNodes(node: any, predicate: (n: any) => boolean, results: any[] = []): any[] {
        if (!node) return results;
        if (predicate(node)) results.push(node);
        for (const c of node.children || []) findNodes(c, predicate, results);
        return results;
      }

      interface TextPatch {
        startIndex: number;
        endIndex: number;
        newText: string;
      }

      function applyPatches(source: string, patches: TextPatch[]): string {
        const sorted = [...patches].sort((a, b) => b.startIndex - a.startIndex);
        let res = source;
        for (const p of sorted) {
          res = res.substring(0, p.startIndex) + p.newText + res.substring(p.endIndex);
        }
        return res;
      }

      const patches: TextPatch[] = [];

      if (targetLang === "sysml2" || targetLang === "sysml") {
        const defNodes = findNodes(
          root,
          (n) =>
            n.type === "PartDefinition" ||
            n.type === "ItemDefinition" ||
            n.type === "PackageDeclaration" ||
            n.text?.startsWith("part def") ||
            n.text?.startsWith("item def"),
        );
        const def =
          defNodes.find((d) => {
            const nameNode = findNodes(d, (n) => n.type === "Name" || n.type === "ID")[0];
            return nameNode && nameNode.text.trim() === sourceNode.name;
          }) ||
          defNodes[0] ||
          root;

        const existingAttrs = new Map<string, any>();
        const attrNodes = findNodes(def, (n) => n.type === "AttributeUsage" || n.text?.startsWith("attribute "));
        for (const a of attrNodes) {
          const nameNode = findNodes(a, (n) => n.type === "Name" || n.type === "ID")[0];
          const name = nameNode ? nameNode.text.trim() : a.text.match(/\battribute\s+([A-Za-z_]\w*)/)?.[1];
          if (name) existingAttrs.set(name, a);
        }

        const existingPorts = new Map<string, any>();
        const portNodes = findNodes(def, (n) => n.type === "PortUsage" || n.text?.startsWith("port "));
        for (const p of portNodes) {
          const nameNode = findNodes(p, (n) => n.type === "Name" || n.type === "ID")[0];
          const name = nameNode ? nameNode.text.trim() : p.text.match(/\bport\s+(?:~)?([A-Za-z_]\w*)/)?.[1];
          if (name) existingPorts.set(name, p);
        }

        const existingParts = new Map<string, any>();
        const partNodes = findNodes(def, (n) => n.type === "PartUsage" || n.text?.startsWith("part "));
        for (const p of partNodes) {
          const nameNode = findNodes(p, (n) => n.type === "Name" || n.type === "ID")[0];
          const name = nameNode ? nameNode.text.trim() : p.text.match(/\bpart\s+([A-Za-z_]\w*)/)?.[1];
          if (name) existingParts.set(name, p);
        }

        // Determine insertion offset: before closing brace of definition
        let insertOffset = def.endIndex;
        const closeBrace = findNodes(def, (n) => n.text === "}" || n.type === "}")[0];
        if (closeBrace) {
          insertOffset = closeBrace.startIndex;
        } else if (def.text && def.text.includes("}")) {
          insertOffset = def.startIndex + def.text.lastIndexOf("}");
        }

        const insertions: string[] = [];

        if (sourceNode.attributes) {
          for (const attr of sourceNode.attributes) {
            const existing = existingAttrs.get(attr.name);
            const valStr = attr.value !== undefined ? ` = ${attr.value}` : "";
            const expectedDecl = `attribute ${attr.name} : ${attr.type}${valStr};`;
            if (existing) {
              const featVal = findNodes(existing, (n) => n.type === "FeatureValue")[0];
              if (featVal && attr.value !== undefined) {
                patches.push({
                  startIndex: featVal.startIndex,
                  endIndex: featVal.endIndex,
                  newText: `= ${attr.value}`,
                });
              } else if (existing.text.trim() !== expectedDecl.trim()) {
                patches.push({
                  startIndex: existing.startIndex,
                  endIndex: existing.endIndex,
                  newText: expectedDecl,
                });
              }
            } else {
              insertions.push(`  attribute ${attr.name} : ${attr.type}${valStr};`);
            }
          }
        }

        if (sourceNode.ports) {
          for (const port of sourceNode.ports) {
            if (!existingPorts.has(port.name)) {
              const conjStr = port.isConjugated ? "~" : "";
              insertions.push(`  port ${conjStr}${port.name} : ${port.type};`);
            }
          }
        }

        if (sourceNode.components) {
          for (const comp of sourceNode.components) {
            if (!existingParts.has(comp.name)) {
              const dimStr = comp.dimensions || comp.multiplicity ? `[${comp.dimensions || comp.multiplicity}]` : "";
              insertions.push(`  part ${comp.name} : ${comp.typeSpecifier}${dimStr};`);
            }
          }
        }

        if (insertions.length > 0) {
          patches.push({
            startIndex: insertOffset,
            endIndex: insertOffset,
            newText: insertions.join("\n") + "\n",
          });
        }
      } else if (targetLang === "modelica") {
        const defNodes = findNodes(
          root,
          (n) => n.type === "class_definition" || n.text?.startsWith("model ") || n.text?.startsWith("block "),
        );
        const def =
          defNodes.find((d) => {
            const idNode = findNodes(d, (n) => n.type === "identifier")[0];
            return idNode && idNode.text.trim() === sourceNode.name;
          }) ||
          defNodes[0] ||
          root;

        const existingVars = new Map<string, any>();
        const compDecls = findNodes(
          def,
          (n) =>
            n.type === "component_declaration" ||
            n.text?.includes("parameter ") ||
            (n.text?.includes(";") && !n.text?.startsWith("model ") && !n.text?.startsWith("extends ")),
        );
        for (const cd of compDecls) {
          const idNode = findNodes(cd, (n) => n.type === "identifier")[0];
          const name = idNode ? idNode.text.trim() : cd.text.match(/\b([A-Za-z_]\w*)\s*(?:=|[;])/)?.[1];
          if (name && !name.startsWith("model") && !name.startsWith("extends") && !name.startsWith("equation")) {
            existingVars.set(name, cd);
          }
        }

        // Determine insertion offset: before closing "end" of definition
        let insertOffset = def.endIndex;
        const endNode = findNodes(def, (n) => n.type === "end" || n.text === "end")[0];
        if (endNode) {
          insertOffset = endNode.startIndex;
        } else if (def.text && /\bend\s+[A-Za-z_]/.test(def.text)) {
          const match = def.text.search(/\bend\s+[A-Za-z_]/);
          if (match !== -1) insertOffset = def.startIndex + match;
        }

        const insertions: string[] = [];

        if (sourceNode.attributes) {
          for (const attr of sourceNode.attributes) {
            const existing = existingVars.get(attr.name);
            const valStr = attr.value !== undefined ? ` = ${attr.value}` : "";
            const expectedDecl = `parameter ${attr.type} ${attr.name}${valStr};`;
            if (existing) {
              const modNode = findNodes(existing, (n) => n.type === "modification")[0];
              if (modNode && attr.value !== undefined) {
                patches.push({
                  startIndex: modNode.startIndex,
                  endIndex: modNode.endIndex,
                  newText: `= ${attr.value}`,
                });
              } else if (existing.text.trim() !== expectedDecl.trim()) {
                patches.push({
                  startIndex: existing.startIndex,
                  endIndex: existing.endIndex,
                  newText: expectedDecl,
                });
              }
            } else {
              insertions.push(`  parameter ${attr.type} ${attr.name}${valStr};`);
            }
          }
        }

        if (sourceNode.ports) {
          for (const port of sourceNode.ports) {
            if (!existingVars.has(port.name)) {
              insertions.push(`  ${port.type} ${port.name};`);
            }
          }
        }

        if (sourceNode.components) {
          for (const comp of sourceNode.components) {
            if (!existingVars.has(comp.name)) {
              const dimStr = comp.dimensions || comp.multiplicity ? `[${comp.dimensions || comp.multiplicity}]` : "";
              insertions.push(`  ${comp.typeSpecifier} ${comp.name}${dimStr};`);
            }
          }
        }

        if (insertions.length > 0) {
          patches.push({
            startIndex: insertOffset,
            endIndex: insertOffset,
            newText: insertions.join("\n") + "\n",
          });
        }
      }

      if (patches.length > 0) {
        const fullText = applyPatches(targetSource, patches);
        return {
          text: fullText,
          edit: {
            range: {
              start: { line: 0, character: 0 },
              end: this.offsetToPosition(targetSource, targetSource.length),
            },
            newText: fullText,
          },
          startIndex: 0,
          endIndex: targetSource.length,
        };
      }
    } catch {
      // Fallback
    }

    return {
      text: targetSource,
      edit: { range: { start: { line: 0, character: 0 }, end: { line: 0, character: 0 } }, newText: targetSource },
      startIndex: 0,
      endIndex: 0,
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

function insSeparator(insertions: ChildInsertion[]): string {
  return insertions[0]?.separator ?? "\n  ";
}
