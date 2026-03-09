// SPDX-License-Identifier: AGPL-3.0-or-later

import { ModelicaEntity, ModelicaLibrary } from "./model.js";
import {
  ModelicaAnnotationClauseSyntaxNode,
  ModelicaClassDefinitionSyntaxNode,
  ModelicaComponentClauseSyntaxNode,
  ModelicaComponentDeclarationSyntaxNode,
  ModelicaElementModificationSyntaxNode,
  ModelicaShortClassSpecifierSyntaxNode,
  ModelicaStoredDefinitionSyntaxNode,
  ModelicaStringLiteralSyntaxNode,
  type ModelicaClassModificationSyntaxNode,
  type ModelicaExpressionSyntaxNode,
  type ModelicaSyntaxNode,
} from "./syntax.js";

interface PotEntry {
  msgid: string;
  msgctxt: string;
  locations: Set<string>;
}

/**
 * Extracts translatable strings from Modelica source files by walking the
 * syntax tree (AST) directly, without instantiating classes. This is
 * significantly faster than the model-based visitor pattern because it avoids
 * resolving extends, imports, creating component instances, etc.
 */
export class I18nExtractor {
  private entries = new Map<string, PotEntry>();

  private addEntry(msgid: string | null | undefined, msgctxt: string, sourceFile: string, line?: number) {
    if (!msgid) return;

    const key = `${msgctxt}\x04${msgid}`;
    let entry = this.entries.get(key);
    if (!entry) {
      entry = {
        msgid,
        msgctxt,
        locations: new Set(),
      };
      this.entries.set(key, entry);
    }

    if (line != null) {
      entry.locations.add(`${sourceFile}:${line}`);
    }
  }

  /**
   * Find a named modification argument (e.g., "info", "tab", "textString")
   * within a classModification's arguments.
   */
  private findModificationByName(
    classModification: ModelicaClassModificationSyntaxNode | null | undefined,
    name: string,
  ): ModelicaElementModificationSyntaxNode | null {
    if (!classModification) return null;
    for (const arg of classModification.modificationArguments) {
      if (arg instanceof ModelicaElementModificationSyntaxNode) {
        const argName = arg.name?.parts?.[0]?.text;
        if (argName === name) return arg;
      }
    }
    return null;
  }

  /**
   * Extract a string value from a modification expression, e.g.:
   *   annotation(Documentation(info="some string"))
   * The "info" modification has a modificationExpression whose expression is a StringLiteral.
   */
  private getStringValue(mod: ModelicaElementModificationSyntaxNode | null): string | null {
    if (!mod) return null;
    const expr = mod.modification?.modificationExpression?.expression;
    if (expr instanceof ModelicaStringLiteralSyntaxNode) {
      return expr.text;
    }
    return null;
  }

  /**
   * Get the line number from a syntax node for source location tracking.
   */
  private getLine(node: ModelicaSyntaxNode | null | undefined): number | undefined {
    return node?.concreteSyntaxNode?.startPosition?.row != null
      ? node.concreteSyntaxNode.startPosition.row + 1
      : undefined;
  }

  /**
   * Extract the "array" of graphics modifications from an Icon or Diagram annotation.
   * In Modelica, graphics is specified as:
   *   Icon(graphics={Text(textString="..."), ...})
   * The graphics value is an array expression whose elements we can walk.
   */
  private extractTextStringsFromGraphics(
    annotation: ModelicaAnnotationClauseSyntaxNode | null | undefined,
    layerName: string,
    msgctxt: string,
    sourceFile: string,
  ) {
    if (!annotation?.classModification) return;
    const layerMod = this.findModificationByName(annotation.classModification, layerName);
    if (!layerMod) return;

    // The graphics are inside the layer's classModification, e.g.:
    // Icon(graphics={Text(...), Rectangle(...)})
    const graphicsMod = this.findModificationByName(layerMod.modification?.classModification, "graphics");
    if (!graphicsMod) return;

    // The graphics value is an expression like {Text(...), Rectangle(...)}.
    // The individual graphic elements are function calls or class instantiations.
    // In practice, the concrete syntax is like:
    //   graphics = {Text(textString="...", ...), Rectangle(...)}
    // We need to walk the expression to find function calls with name "Text"
    // and extract their "textString" named argument.
    // The expression is an array concatenation with elements.
    this.extractTextFromExpression(graphicsMod.modification?.modificationExpression?.expression, msgctxt, sourceFile);
  }

  /**
   * Walk an expression tree to find Text(...) function calls and extract textString.
   * The graphics array contains FunctionCall expressions like Text(textString="...", ...).
   */
  private extractTextFromExpression(
    expr: ModelicaExpressionSyntaxNode | null | undefined,
    msgctxt: string,
    sourceFile: string,
  ) {
    if (!expr) return;
    // Walk all descendants looking for function calls named "Text"
    const concreteNode = expr.concreteSyntaxNode;
    if (!concreteNode) return;

    // Use tree-sitter to find all function_call nodes within the expression
    this.walkConcreteSyntaxForText(concreteNode, msgctxt, sourceFile);
  }

  /**
   * Walk the concrete tree-sitter syntax tree to find Text(...) function calls.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private walkConcreteSyntaxForText(node: any, msgctxt: string, sourceFile: string) {
    if (!node) return;

    // Check if this node is a function_call or similar with "Text" as the function name
    if (node.type === "function_call" || node.type === "component_reference") {
      // Look for Text(...) pattern - the function name child
      const nameNode = node.childForFieldName?.("functionReference") ?? node.childForFieldName?.("name");
      if (nameNode?.text === "Text") {
        // Find the textString named argument in the function call arguments
        const argsNode = node.childForFieldName?.("functionCallArguments");
        if (argsNode) {
          this.extractTextStringFromArgs(argsNode, msgctxt, sourceFile);
        }
      }
    }

    // Recurse into children
    for (let i = 0; i < (node.childCount ?? 0); i++) {
      this.walkConcreteSyntaxForText(node.child(i), msgctxt, sourceFile);
    }
  }

  /**
   * Extract textString from function call arguments for a Text(...) call.
   */
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  private extractTextStringFromArgs(argsNode: any, msgctxt: string, sourceFile: string) {
    // Walk all named_argument nodes looking for textString
    for (let i = 0; i < (argsNode.childCount ?? 0); i++) {
      const child = argsNode.child(i);
      if (child?.type === "named_argument") {
        const nameChild = child.childForFieldName?.("name");
        if (nameChild?.text === "textString") {
          const exprChild = child.childForFieldName?.("expression");
          if (exprChild?.type === "STRING") {
            const text = exprChild.text;
            if (text) {
              // Strip surrounding quotes
              const unquoted = text.substring(1, text.length - 1).replace(/""/g, '"');
              this.addEntry(unquoted, msgctxt, sourceFile, exprChild.startPosition?.row + 1);
            }
          }
        }
      }
      // Recurse for nested structures
      this.extractTextStringFromArgs(child, msgctxt, sourceFile);
    }
  }

  /**
   * Extract translatable strings from a class definition AST node.
   */
  private extractFromClassDefinition(
    classDef: ModelicaClassDefinitionSyntaxNode,
    parentQualifiedName: string,
    sourceFile: string,
  ) {
    const name = classDef.identifier?.text;
    if (!name) return;

    const qualifiedName = parentQualifiedName ? `${parentQualifiedName}.${name}` : name;
    const line = this.getLine(classDef);

    // Extract class name
    this.addEntry(name, qualifiedName, sourceFile, line);

    // Extract description
    const classSpecifier = classDef.classSpecifier;
    if (classSpecifier) {
      const descStrings = classSpecifier.description?.strings;
      if (descStrings) {
        const desc = descStrings.map((s) => s.text ?? "").join(" ");
        if (desc) this.addEntry(desc, qualifiedName, sourceFile, line);
      }
    }

    // Extract annotation strings
    const annotation = classDef.annotationClause;
    if (annotation?.classModification) {
      // Documentation(info="...", revisions="...")
      const docMod = this.findModificationByName(annotation.classModification, "Documentation");
      if (docMod?.modification?.classModification) {
        const infoMod = this.findModificationByName(docMod.modification.classModification, "info");
        const infoText = this.getStringValue(infoMod);
        if (infoText) this.addEntry(infoText, qualifiedName, sourceFile, this.getLine(infoMod));

        const revisionsMod = this.findModificationByName(docMod.modification.classModification, "revisions");
        const revisionsText = this.getStringValue(revisionsMod);
        if (revisionsText) this.addEntry(revisionsText, qualifiedName, sourceFile, this.getLine(revisionsMod));
      }

      // Icon/Diagram Text graphics
      this.extractTextStringsFromGraphics(annotation, "Icon", qualifiedName, sourceFile);
      this.extractTextStringsFromGraphics(annotation, "Diagram", qualifiedName, sourceFile);
    }

    // Extract enumeration literals
    if (classSpecifier instanceof ModelicaShortClassSpecifierSyntaxNode && classSpecifier.enumeration) {
      for (const literal of classSpecifier.enumerationLiterals) {
        if (literal.identifier?.text) {
          this.addEntry(literal.identifier.text, qualifiedName, sourceFile, this.getLine(literal));
        }
        if (literal.description?.strings) {
          const desc = literal.description.strings.map((s) => s.text ?? "").join(" ");
          if (desc) this.addEntry(desc, qualifiedName, sourceFile, this.getLine(literal));
        }
      }
    }

    // Walk nested elements (component declarations and nested classes)
    for (const element of classDef.elements) {
      if (element instanceof ModelicaClassDefinitionSyntaxNode) {
        this.extractFromClassDefinition(element, qualifiedName, sourceFile);
      } else if (element instanceof ModelicaComponentClauseSyntaxNode) {
        this.extractFromComponentClause(element, qualifiedName, sourceFile);
      }
    }
  }

  /**
   * Extract translatable strings from a component clause.
   */
  private extractFromComponentClause(
    componentClause: ModelicaComponentClauseSyntaxNode,
    parentQualifiedName: string,
    sourceFile: string,
  ) {
    for (const componentDecl of componentClause.componentDeclarations) {
      this.extractFromComponentDeclaration(componentDecl, parentQualifiedName, sourceFile);
    }
  }

  /**
   * Extract translatable strings from a component declaration.
   */
  private extractFromComponentDeclaration(
    componentDecl: ModelicaComponentDeclarationSyntaxNode,
    parentQualifiedName: string,
    sourceFile: string,
  ) {
    const name = componentDecl.declaration?.identifier?.text;
    const line = this.getLine(componentDecl);

    // Extract component name
    if (name) {
      this.addEntry(name, parentQualifiedName, sourceFile, line);
    }

    // Extract component description
    const descStrings = componentDecl.description?.strings;
    if (descStrings) {
      const desc = descStrings.map((s) => s.text ?? "").join(" ");
      if (desc) this.addEntry(desc, parentQualifiedName, sourceFile, line);
    }

    // Extract Dialog annotation (tab, group)
    const annotation = componentDecl.annotationClause;
    if (annotation?.classModification) {
      const dialogMod = this.findModificationByName(annotation.classModification, "Dialog");
      if (dialogMod?.modification?.classModification) {
        const tabMod = this.findModificationByName(dialogMod.modification.classModification, "tab");
        const tabText = this.getStringValue(tabMod);
        if (tabText) this.addEntry(tabText, parentQualifiedName, sourceFile, this.getLine(tabMod));

        const groupMod = this.findModificationByName(dialogMod.modification.classModification, "group");
        const groupText = this.getStringValue(groupMod);
        if (groupText) this.addEntry(groupText, parentQualifiedName, sourceFile, this.getLine(groupMod));
      }
    }
  }

  /**
   * Extract translatable strings from a stored definition (top-level file).
   */
  extractFromStoredDefinition(storedDef: ModelicaStoredDefinitionSyntaxNode | null, sourceFile: string) {
    if (!storedDef) return;

    // Compute within prefix for qualified names
    const withinPrefix = storedDef.withinDirective?.packageName?.parts?.map((p) => p.text).join(".") ?? "";

    for (const classDef of storedDef.classDefinitions) {
      this.extractFromClassDefinition(classDef, withinPrefix, sourceFile);
    }
  }

  /**
   * Extract translatable strings from a library by walking its entities
   * without instantiation.
   */
  extractFromLibrary(library: ModelicaLibrary) {
    const entity = library.entity;
    // Load (parse) without instantiating
    entity.load();
    this.extractFromEntity(entity);
  }

  /**
   * Recursively extract from an entity and its sub-entities.
   */
  private extractFromEntity(entity: ModelicaEntity) {
    // Extract from this entity's stored definition
    this.extractFromStoredDefinition(entity.storedDefinitionSyntaxNode, entity.path);

    // Recursively extract from sub-entities
    for (const subEntity of entity.subEntities) {
      this.extractFromEntity(subEntity);
    }
  }

  generatePot(): string {
    let pot = "";
    pot += `msgid ""\n`;
    pot += `msgstr ""\n`;
    pot += `"Content-Type: text/plain; charset=UTF-8\\n"\n`;
    pot += `"Content-Transfer-Encoding: 8bit\\n"\n`;
    pot += `"Project-Id-Version: \\n"\n`;
    pot += `\n`;

    for (const entry of this.entries.values()) {
      for (const location of entry.locations) {
        pot += `#: ${location}\n`;
      }
      if (entry.msgctxt) {
        pot += `msgctxt ${JSON.stringify(entry.msgctxt)}\n`;
      }
      pot += `msgid ${JSON.stringify(entry.msgid)}\n`;
      pot += `msgstr ""\n`;
      pot += `\n`;
    }

    return pot;
  }
}

// Keep the old visitor for backwards compatibility but mark it as deprecated
export { I18nExtractor as I18nVisitor };
