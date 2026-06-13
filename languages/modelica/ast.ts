/* eslint-disable @typescript-eslint/no-explicit-any */
import {
  ModelicaBinaryOperator,
  ModelicaCausality,
  ModelicaClassKind,
  ModelicaFlow,
  ModelicaPurity,
  ModelicaUnaryOperator,
  ModelicaVariability,
  ModelicaVisibility,
} from "./types.js";
export {
  ModelicaBinaryOperator,
  ModelicaCausality,
  ModelicaClassKind,
  ModelicaFlow,
  ModelicaPurity,
  ModelicaUnaryOperator,
  ModelicaVariability,
  ModelicaVisibility,
};
// SPDX-License-Identifier: AGPL-3.0-or-later

/* eslint-disable @typescript-eslint/no-empty-function, @typescript-eslint/no-unused-vars */

import type { JSONValue, Point, SyntaxNode, Triple, Writer } from "@modelscript/utils";
import { toEnum } from "@modelscript/utils";

export interface IModelicaSyntaxNode {
  "@type": string;
  toJSON: JSONValue;
  toRDF: Triple[];
}

export abstract class ModelicaSyntaxNode implements IModelicaSyntaxNode {
  declare readonly _typeTag: number;
  static #nextId = 0;
  #id: number;
  #parent: WeakRef<ModelicaSyntaxNode> | null;
  "@type": string;
  sourceRange: {
    startRow: number;
    startCol: number;
    endRow: number;
    endCol: number;
    startIndex: number;
    endIndex: number;
  } | null;
  nodeText?: string;

  protected _cst: SyntaxNode | null;
  protected _astFallback: IModelicaSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSyntaxNode | null,
    type?: string | null,
  ) {
    this.#id = ModelicaSyntaxNode.#nextId++;
    if (parent) this.#parent = new WeakRef(parent);
    else this.#parent = null;
    this["@type"] = type ?? this.constructor.name.substring(8, this.constructor.name.length - 10);
    this._cst = concreteSyntaxNode ?? null;
    this._astFallback = abstractSyntaxNode ?? null;

    if (concreteSyntaxNode && concreteSyntaxNode.type != this["@type"])
      throw new Error(`Expected concrete syntax node of type "${this["@type"]}", got "${concreteSyntaxNode.type}"`);
    if (abstractSyntaxNode && abstractSyntaxNode["@type"] != this["@type"])
      throw new Error(`Expected abstract syntax node of type "${this["@type"]}", got "${abstractSyntaxNode["@type"]}"`);
    if (concreteSyntaxNode) {
      this.sourceRange = {
        startRow: concreteSyntaxNode.startPosition.row,
        startCol: concreteSyntaxNode.startPosition.column,
        endRow: concreteSyntaxNode.endPosition.row,
        endCol: concreteSyntaxNode.endPosition.column,
        startIndex: concreteSyntaxNode.startIndex,
        endIndex: concreteSyntaxNode.endIndex,
      };
      this.nodeText = concreteSyntaxNode.text;
    } else {
      this.sourceRange = null;
    }
  }

  abstract accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R;

  get startPosition(): Point {
    return this.sourceRange
      ? { row: this.sourceRange.startRow, column: this.sourceRange.startCol }
      : { row: 0, column: 0 };
  }

  get endPosition(): Point {
    return this.sourceRange ? { row: this.sourceRange.endRow, column: this.sourceRange.endCol } : { row: 0, column: 0 };
  }

  get startIndex(): number {
    return this.sourceRange?.startIndex ?? 0;
  }

  get endIndex(): number {
    return this.sourceRange?.endIndex ?? 0;
  }

  get parent(): ModelicaSyntaxNode | null {
    return this.#parent?.deref() ?? null;
  }

  get toJSON(): JSONValue {
    const json: Record<string, JSONValue> = { "@type": this["@type"] };
    const keys = new Set<string>(Object.keys(this));
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== ModelicaSyntaxNode.prototype && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key !== "constructor") keys.add(key);
      }
      proto = Object.getPrototypeOf(proto);
    }
    for (const key of keys) {
      if (key === "@type" || key.startsWith("_") || key === "parent") continue;
      const value = (this as Record<string, unknown>)[key];
      if (value instanceof ModelicaSyntaxNode) {
        json[key] = value.toJSON;
      } else if (Array.isArray(value)) {
        json[key] = value.map((v) => (v instanceof ModelicaSyntaxNode ? v.toJSON : (v as JSONValue)));
      } else {
        json[key] = value as JSONValue;
      }
    }
    return json;
  }

  get toRDF(): Triple[] {
    const id = `_:node_${this.#id}`;
    const triples: Triple[] = [{ s: id, p: "rdf:type", o: `modelica:${this["@type"]}` }];
    const keys = new Set<string>(Object.keys(this));
    let proto = Object.getPrototypeOf(this);
    while (proto && proto !== ModelicaSyntaxNode.prototype && proto !== Object.prototype) {
      for (const key of Object.getOwnPropertyNames(proto)) {
        if (key !== "constructor") keys.add(key);
      }
      proto = Object.getPrototypeOf(proto);
    }
    for (const key of keys) {
      if (key === "@type" || key.startsWith("_") || key === "parent") continue;
      const value = (this as Record<string, unknown>)[key];
      if (value instanceof ModelicaSyntaxNode) {
        const valueId = `_:node_${(value as ModelicaSyntaxNode).#id ?? Math.random().toString(36).substring(2, 9)}`;
        triples.push({ s: id, p: `modelica:${key}`, o: valueId });
        triples.push(...value.toRDF);
      } else if (Array.isArray(value)) {
        for (const v of value) {
          if (v instanceof ModelicaSyntaxNode) {
            const vId = `_:node_${(v as ModelicaSyntaxNode).#id ?? Math.random().toString(36).substring(2, 9)}`;
            triples.push({ s: id, p: `modelica:${key}`, o: vId });
            triples.push(...v.toRDF);
          } else {
            triples.push({ s: id, p: `modelica:${key}`, o: v as string | number | boolean | null });
          }
        }
      } else {
        triples.push({ s: id, p: `modelica:${key}`, o: value as string | number | boolean | null });
      }
    }
    return triples;
  }

  static new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSyntaxNode | null,
  ): ModelicaSyntaxNode | null {
    const type = concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"];
    switch (type) {
      case ModelicaStoredDefinitionSyntaxNode.type:
        return new ModelicaStoredDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStoredDefinitionSyntaxNode,
        );
      case ModelicaWithinDirectiveSyntaxNode.type:
        return new ModelicaWithinDirectiveSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWithinDirectiveSyntaxNode,
        );
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassDefinitionSyntaxNode,
        );
      case ModelicaClassPrefixesSyntaxNode.type:
        return new ModelicaClassPrefixesSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassPrefixesSyntaxNode,
        );
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
        );
      case ModelicaShortClassSpecifierSyntaxNode.type:
        return new ModelicaShortClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaShortClassSpecifierSyntaxNode,
        );
      case ModelicaDerClassSpecifierSyntaxNode.type:
        return new ModelicaDerClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDerClassSpecifierSyntaxNode,
        );
      case ModelicaEnumerationLiteralSyntaxNode.type:
        return new ModelicaEnumerationLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEnumerationLiteralSyntaxNode,
        );
      case ModelicaExternalFunctionClauseSyntaxNode.type:
        return new ModelicaExternalFunctionClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExternalFunctionClauseSyntaxNode,
        );
      case ModelicaLanguageSpecificationSyntaxNode.type:
        return new ModelicaLanguageSpecificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLanguageSpecificationSyntaxNode,
        );
      case ModelicaExternalFunctionCallSyntaxNode.type:
        return new ModelicaExternalFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExternalFunctionCallSyntaxNode,
        );
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
        );
      case "Initial" + ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
          "Initial" + ModelicaElementSectionSyntaxNode.type,
          ModelicaVisibility.PUBLIC,
        );
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExtendsClauseSyntaxNode,
        );
      case ModelicaConstrainingClauseSyntaxNode.type:
        return new ModelicaConstrainingClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConstrainingClauseSyntaxNode,
        );
      case ModelicaClassOrInheritanceModificationSyntaxNode.type:
        return new ModelicaClassOrInheritanceModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassOrInheritanceModificationSyntaxNode,
        );
      case ModelicaInheritanceModificationSyntaxNode.type:
        return new ModelicaInheritanceModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaInheritanceModificationSyntaxNode,
        );
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClauseSyntaxNode,
        );
      case ModelicaElementAnnotationSyntaxNode.type:
        return new ModelicaElementAnnotationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementAnnotationSyntaxNode,
        );
      case ModelicaComponentDeclarationSyntaxNode.type:
        return new ModelicaComponentDeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentDeclarationSyntaxNode,
        );
      case ModelicaConditionAttributeSyntaxNode.type:
        return new ModelicaConditionAttributeSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConditionAttributeSyntaxNode,
        );
      case ModelicaDeclarationSyntaxNode.type:
        return new ModelicaDeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDeclarationSyntaxNode,
        );
      case ModelicaModificationSyntaxNode.type:
        return new ModelicaModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaModificationSyntaxNode,
        );
      case ModelicaModificationExpressionSyntaxNode.type:
        return new ModelicaModificationExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaModificationExpressionSyntaxNode,
        );
      case ModelicaClassModificationSyntaxNode.type:
        return new ModelicaClassModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassModificationSyntaxNode,
        );
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementModificationSyntaxNode,
        );
      case ModelicaElementRedeclarationSyntaxNode.type:
        return new ModelicaElementRedeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementRedeclarationSyntaxNode,
        );
      case ModelicaComponentClause1SyntaxNode.type:
        return new ModelicaComponentClause1SyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClause1SyntaxNode,
        );
      case ModelicaComponentDeclaration1SyntaxNode.type:
        return new ModelicaComponentDeclaration1SyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentDeclaration1SyntaxNode,
        );
      case ModelicaShortClassDefinitionSyntaxNode.type:
        return new ModelicaShortClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaShortClassDefinitionSyntaxNode,
        );
      case ModelicaEquationSectionSyntaxNode.type:
        return new ModelicaEquationSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEquationSectionSyntaxNode,
        );
      case ModelicaAlgorithmSectionSyntaxNode.type:
        return new ModelicaAlgorithmSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAlgorithmSectionSyntaxNode,
        );
      case ModelicaSimpleAssignmentStatementSyntaxNode.type:
        return new ModelicaSimpleAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleAssignmentStatementSyntaxNode,
        );
      case ModelicaProcedureCallStatementSyntaxNode.type:
        return new ModelicaProcedureCallStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaProcedureCallStatementSyntaxNode,
        );
      case ModelicaComplexAssignmentStatementSyntaxNode.type:
        return new ModelicaComplexAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComplexAssignmentStatementSyntaxNode,
        );
      case ModelicaSimpleEquationSyntaxNode.type:
        return new ModelicaSimpleEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleEquationSyntaxNode,
        );
      case ModelicaSpecialEquationSyntaxNode.type:
        return new ModelicaSpecialEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSpecialEquationSyntaxNode,
        );
      case ModelicaIfEquationSyntaxNode.type:
        return new ModelicaIfEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfEquationSyntaxNode,
        );
      case ModelicaElseIfEquationClauseSyntaxNode.type:
        return new ModelicaElseIfEquationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseIfEquationClauseSyntaxNode,
        );
      case ModelicaIfStatementSyntaxNode.type:
        return new ModelicaIfStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfStatementSyntaxNode,
        );
      case ModelicaElseIfStatementClauseSyntaxNode.type:
        return new ModelicaElseIfStatementClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseIfStatementClauseSyntaxNode,
        );
      case ModelicaForEquationSyntaxNode.type:
        return new ModelicaForEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForEquationSyntaxNode,
        );
      case ModelicaForStatementSyntaxNode.type:
        return new ModelicaForStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForStatementSyntaxNode,
        );
      case ModelicaForIndexSyntaxNode.type:
        return new ModelicaForIndexSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForIndexSyntaxNode,
        );
      case ModelicaWhileStatementSyntaxNode.type:
        return new ModelicaWhileStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhileStatementSyntaxNode,
        );
      case ModelicaWhenEquationSyntaxNode.type:
        return new ModelicaWhenEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenEquationSyntaxNode,
        );
      case ModelicaElseWhenEquationClauseSyntaxNode.type:
        return new ModelicaElseWhenEquationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseWhenEquationClauseSyntaxNode,
        );
      case ModelicaWhenStatementSyntaxNode.type:
        return new ModelicaWhenStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenStatementSyntaxNode,
        );
      case ModelicaElseWhenStatementClauseSyntaxNode.type:
        return new ModelicaElseWhenStatementClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseWhenStatementClauseSyntaxNode,
        );
      case ModelicaConnectEquationSyntaxNode.type:
        return new ModelicaConnectEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConnectEquationSyntaxNode,
        );
      case ModelicaBreakStatementSyntaxNode.type:
        return new ModelicaBreakStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBreakStatementSyntaxNode,
        );
      case ModelicaReturnStatementSyntaxNode.type:
        return new ModelicaReturnStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaReturnStatementSyntaxNode,
        );
      case ModelicaIfElseExpressionSyntaxNode.type:
        return new ModelicaIfElseExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfElseExpressionSyntaxNode,
        );
      case ModelicaElseIfExpressionClauseSyntaxNode.type:
        return new ModelicaElseIfExpressionClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElseIfExpressionClauseSyntaxNode,
        );
      case ModelicaRangeExpressionSyntaxNode.type:
        return new ModelicaRangeExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaRangeExpressionSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaTypeSpecifierSyntaxNode.type:
        return new ModelicaTypeSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaTypeSpecifierSyntaxNode,
        );
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode as IModelicaNameSyntaxNode);
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaComponentReferencePartSyntaxNode.type:
        return new ModelicaComponentReferencePartSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferencePartSyntaxNode,
        );
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaFunctionCallArgumentsSyntaxNode.type:
        return new ModelicaFunctionCallArgumentsSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallArgumentsSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaComprehensionClauseSyntaxNode.type:
        return new ModelicaComprehensionClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComprehensionClauseSyntaxNode,
        );
      case ModelicaNamedArgumentSyntaxNode.type:
        return new ModelicaNamedArgumentSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaNamedArgumentSyntaxNode,
        );
      case ModelicaFunctionArgumentSyntaxNode.type:
        return new ModelicaFunctionArgumentSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionArgumentSyntaxNode,
        );
      case ModelicaFunctionPartialApplicationSyntaxNode.type:
        return new ModelicaFunctionPartialApplicationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionPartialApplicationSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaExpressionListSyntaxNode.type:
        return new ModelicaExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExpressionListSyntaxNode,
        );
      case ModelicaArraySubscriptsSyntaxNode.type:
        return new ModelicaArraySubscriptsSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArraySubscriptsSyntaxNode,
        );
      case ModelicaSubscriptSyntaxNode.type:
        return new ModelicaSubscriptSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSubscriptSyntaxNode,
        );
      case ModelicaDescriptionSyntaxNode.type:
        return new ModelicaDescriptionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDescriptionSyntaxNode,
        );
      case ModelicaAnnotationClauseSyntaxNode.type:
        return new ModelicaAnnotationClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAnnotationClauseSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIdentifierSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }

  static newArray<T extends ModelicaSyntaxNode>(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNodeArray?: SyntaxNode[],
    abstractSyntaxNodeArray?: IModelicaSyntaxNode[],
  ): T[] {
    const nodes: T[] = [];
    const length = Math.max(concreteSyntaxNodeArray?.length ?? 0, abstractSyntaxNodeArray?.length ?? 0);
    for (let i = 0; i < length; i++) {
      const node = this.new(parent, concreteSyntaxNodeArray?.[i] ?? null, abstractSyntaxNodeArray?.[i] ?? null) as T;
      if (node) nodes.push(node);
    }
    return nodes;
  }

  static get type(): string {
    return this.name.substring(8, this.name.length - 10);
  }
}

export interface IModelicaStoredDefinitionSyntaxNode extends IModelicaSyntaxNode {
  classDefinitions: IModelicaClassDefinitionSyntaxNode[];
  componentClauses: IModelicaComponentClauseSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
  withinDirective: IModelicaWithinDirectiveSyntaxNode | null;
}

export class ModelicaStoredDefinitionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaStoredDefinitionSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitStoredDefinition(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStoredDefinitionSyntaxNode | null,
  ): ModelicaStoredDefinitionSyntaxNode | null {
    const type = concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"];
    switch (type) {
      case ModelicaStoredDefinitionSyntaxNode.type:
        return new ModelicaStoredDefinitionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get withinDirective(): ModelicaWithinDirectiveSyntaxNode | null {
    return ModelicaWithinDirectiveSyntaxNode.new(
      this,
      this._cst?.childForFieldName("withinDirective"),
      (this._astFallback as IModelicaStoredDefinitionSyntaxNode)?.withinDirective,
    );
  }

  get classDefinitions(): ModelicaClassDefinitionSyntaxNode[] {
    return ModelicaClassDefinitionSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("classDefinition"),
      (this._astFallback as IModelicaStoredDefinitionSyntaxNode)?.classDefinitions,
    );
  }

  get componentClauses(): ModelicaComponentClauseSyntaxNode[] {
    return ModelicaComponentClauseSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("componentClause"),
      (this._astFallback as IModelicaStoredDefinitionSyntaxNode)?.componentClauses,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaStoredDefinitionSyntaxNode)?.statements,
    );
  }
}

export interface IModelicaWithinDirectiveSyntaxNode extends IModelicaSyntaxNode {
  packageName: IModelicaNameSyntaxNode | null;
}

export class ModelicaWithinDirectiveSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaWithinDirectiveSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWithinDirective(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWithinDirectiveSyntaxNode | null,
  ): ModelicaWithinDirectiveSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWithinDirectiveSyntaxNode.type:
        return new ModelicaWithinDirectiveSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get packageName(): ModelicaNameSyntaxNode | null {
    return ModelicaNameSyntaxNode.new(
      this,
      this._cst?.childForFieldName("packageName"),
      (this._astFallback as IModelicaWithinDirectiveSyntaxNode)?.packageName,
    );
  }
}

export type IModelicaElementSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaElementSyntaxNode extends ModelicaSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSyntaxNode | null,
  ): ModelicaElementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaClassDefinitionSyntaxNode,
        );
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaExtendsClauseSyntaxNode,
        );
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentClauseSyntaxNode,
        );
      case ModelicaElementAnnotationSyntaxNode.type:
        return new ModelicaElementAnnotationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementAnnotationSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaClassDefinitionSyntaxNode extends IModelicaElementSyntaxNode {
  classPrefixes: IModelicaClassPrefixesSyntaxNode | null;
  classSpecifier: IModelicaClassSpecifierSyntaxNode | null;
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
  encapsulated: boolean;
  final: boolean;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;
}

export class ModelicaClassDefinitionSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaClassDefinitionSyntaxNode
{
  encapsulated: boolean;
  final: boolean;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassDefinitionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.encapsulated =
      abstractSyntaxNode?.encapsulated ?? concreteSyntaxNode?.childForFieldName("encapsulated") != null;
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.inner = abstractSyntaxNode?.inner ?? concreteSyntaxNode?.childForFieldName("inner") != null;
    this.outer = abstractSyntaxNode?.outer ?? concreteSyntaxNode?.childForFieldName("outer") != null;
    this.redeclare = abstractSyntaxNode?.redeclare ?? concreteSyntaxNode?.childForFieldName("redeclare") != null;
    this.replaceable = abstractSyntaxNode?.replaceable ?? concreteSyntaxNode?.childForFieldName("replaceable") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassDefinition(this, argument);
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return this.classSpecifier?.annotationClause ?? null;
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const elements = this.classSpecifier?.elements ?? [];
    return (function* () {
      yield* elements;
    })();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const equations = this.classSpecifier?.equations ?? [];
    return (function* () {
      yield* equations;
    })();
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.classSpecifier?.identifier ?? null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassDefinitionSyntaxNode | null,
  ): ModelicaClassDefinitionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassDefinitionSyntaxNode.type:
        return new ModelicaClassDefinitionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get sections(): IterableIterator<ModelicaSectionSyntaxNode> {
    const sections = this.classSpecifier?.sections ?? [];
    return (function* () {
      yield* sections;
    })();
  }

  get classPrefixes(): ModelicaClassPrefixesSyntaxNode | null {
    return ModelicaClassPrefixesSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classPrefixes"),
      (this._astFallback as IModelicaClassDefinitionSyntaxNode)?.classPrefixes,
    );
  }

  get classSpecifier(): ModelicaClassSpecifierSyntaxNode | null {
    return ModelicaClassSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classSpecifier"),
      (this._astFallback as IModelicaClassDefinitionSyntaxNode)?.classSpecifier,
    );
  }

  get constrainingClause(): ModelicaConstrainingClauseSyntaxNode | null {
    return ModelicaConstrainingClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("constrainingClause"),
      (this._astFallback as IModelicaClassDefinitionSyntaxNode)?.constrainingClause,
    );
  }
}

export interface IModelicaClassPrefixesSyntaxNode extends IModelicaSyntaxNode {
  classKind: ModelicaClassKind | null;
  partial: boolean;
  purity: ModelicaPurity | null;
}

export class ModelicaClassPrefixesSyntaxNode extends ModelicaSyntaxNode implements IModelicaClassPrefixesSyntaxNode {
  classKind: ModelicaClassKind | null;
  partial: boolean;
  purity: ModelicaPurity | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassPrefixesSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.partial = abstractSyntaxNode?.partial ?? concreteSyntaxNode?.childForFieldName("partial") != null;
    this.purity =
      abstractSyntaxNode?.purity ??
      toEnum(ModelicaPurity, concreteSyntaxNode?.childForFieldName("purity")?.text) ??
      null;
    if (abstractSyntaxNode?.classKind) {
      this.classKind = abstractSyntaxNode.classKind;
    } else if (!concreteSyntaxNode || concreteSyntaxNode.childForFieldName("class")) {
      this.classKind = ModelicaClassKind.CLASS;
    } else if (concreteSyntaxNode.childForFieldName("model")) {
      this.classKind = ModelicaClassKind.MODEL;
    } else if (concreteSyntaxNode.childForFieldName("record")) {
      this.classKind = concreteSyntaxNode.childForFieldName("operator")
        ? ModelicaClassKind.OPERATOR_RECORD
        : ModelicaClassKind.RECORD;
    } else if (concreteSyntaxNode.childForFieldName("block")) {
      this.classKind = ModelicaClassKind.BLOCK;
    } else if (concreteSyntaxNode.childForFieldName("connector")) {
      this.classKind =
        concreteSyntaxNode.childForFieldName("expandable") || concreteSyntaxNode.text.includes("expandable")
          ? ModelicaClassKind.EXPANDABLE_CONNECTOR
          : ModelicaClassKind.CONNECTOR;
    } else if (concreteSyntaxNode.childForFieldName("type")) {
      this.classKind = ModelicaClassKind.TYPE;
    } else if (concreteSyntaxNode.childForFieldName("package")) {
      this.classKind = ModelicaClassKind.PACKAGE;
    } else if (concreteSyntaxNode.childForFieldName("function")) {
      this.classKind = concreteSyntaxNode.childForFieldName("operator")
        ? ModelicaClassKind.OPERATOR_FUNCTION
        : ModelicaClassKind.FUNCTION;
    } else if (concreteSyntaxNode.childForFieldName("operator")) {
      this.classKind = ModelicaClassKind.OPERATOR;
    } else if (concreteSyntaxNode.childForFieldName("optimization")) {
      this.classKind = ModelicaClassKind.OPTIMIZATION;
    } else if (concreteSyntaxNode.childForFieldName("shape")) {
      this.classKind = ModelicaClassKind.SHAPE;
    } else if (concreteSyntaxNode.childForFieldName("field")) {
      this.classKind = ModelicaClassKind.FIELD;
    } else if (concreteSyntaxNode.childForFieldName("process")) {
      this.classKind = ModelicaClassKind.PROCESS;
    } else if (concreteSyntaxNode.childForFieldName("study")) {
      this.classKind = ModelicaClassKind.STUDY;
    } else {
      this.classKind = ModelicaClassKind.CLASS;
    }
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassPrefixes(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassPrefixesSyntaxNode | null,
  ): ModelicaClassPrefixesSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassPrefixesSyntaxNode.type:
        return new ModelicaClassPrefixesSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaClassSpecifierSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export abstract class ModelicaClassSpecifierSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassSpecifierSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;
  identifier: ModelicaIdentifierSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.identifier = ModelicaIdentifierSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("identifier"),
      abstractSyntaxNode?.identifier,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    return (function* () {})();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    return (function* () {})();
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassSpecifierSyntaxNode | null,
  ): ModelicaClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDerClassSpecifierSyntaxNode.type:
        return new ModelicaDerClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaDerClassSpecifierSyntaxNode,
        );
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaLongClassSpecifierSyntaxNode,
        );
      case ModelicaShortClassSpecifierSyntaxNode.type:
        return new ModelicaShortClassSpecifierSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaShortClassSpecifierSyntaxNode,
        );
      default:
        return null;
    }
  }

  abstract get sections(): ModelicaSectionSyntaxNode[];
}

export interface IModelicaLongClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
  endIdentifier: IModelicaIdentifierSyntaxNode | null;
  extends: boolean;
  externalFunctionClause: IModelicaExternalFunctionClauseSyntaxNode | null;
  sections: IModelicaSectionSyntaxNode[];
}

export class ModelicaLongClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaLongClassSpecifierSyntaxNode
{
  extends: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLongClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.extends = abstractSyntaxNode?.extends ?? concreteSyntaxNode?.childForFieldName("extends") != null;
  }

  /**
   * Dynamically collects all class-level annotation clauses in source order:
   *  - ElementAnnotation entries from element sections
   *  - Section-level annotationClauses from equation/algorithm sections
   *  - The specifier's own annotationClause
   */
  get classAnnotationClauses(): IterableIterator<ModelicaAnnotationClauseSyntaxNode> {
    const sections = this.sections;
    const specifierClause = this.annotationClause;
    return (function* () {
      for (const section of sections) {
        if (section instanceof ModelicaElementSectionSyntaxNode) {
          for (const element of section.elements) {
            if (element instanceof ModelicaElementAnnotationSyntaxNode && element.annotationClause) {
              yield element.annotationClause;
            }
          }
        } else if (
          (section instanceof ModelicaEquationSectionSyntaxNode ||
            section instanceof ModelicaAlgorithmSectionSyntaxNode) &&
          section.annotationClause
        ) {
          yield section.annotationClause;
        }
      }
      if (specifierClause) yield specifierClause;
    })();
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLongClassSpecifier(this, argument);
  }

  override get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const sections = this.sections;
    return (function* () {
      for (const section of sections) {
        if (section instanceof ModelicaElementSectionSyntaxNode) yield* section.elements;
      }
    })();
  }

  override get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const sections = this.sections;
    return (function* () {
      for (const section of sections) {
        if (section instanceof ModelicaEquationSectionSyntaxNode) yield* section.equations;
      }
    })();
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLongClassSpecifierSyntaxNode | null,
  ): ModelicaLongClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaLongClassSpecifierSyntaxNode.type:
        return new ModelicaLongClassSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get classModification(): ModelicaClassModificationSyntaxNode | null {
    return ModelicaClassModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classModification"),
      (this._astFallback as IModelicaLongClassSpecifierSyntaxNode)?.classModification,
    );
  }

  get sections(): ModelicaSectionSyntaxNode[] {
    return ModelicaSectionSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("section"),
      (this._astFallback as IModelicaLongClassSpecifierSyntaxNode)?.sections,
    );
  }

  get externalFunctionClause(): ModelicaExternalFunctionClauseSyntaxNode | null {
    return ModelicaExternalFunctionClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("externalFunctionClause"),
      (this._astFallback as IModelicaLongClassSpecifierSyntaxNode)?.externalFunctionClause,
    );
  }

  get endIdentifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("endIdentifier"),
      (this._astFallback as IModelicaLongClassSpecifierSyntaxNode)?.endIdentifier,
    );
  }
}

export interface IModelicaShortClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  causality: ModelicaCausality | null;
  classModification: IModelicaClassModificationSyntaxNode | null;
  enumeration: boolean;
  enumerationLiterals: IModelicaEnumerationLiteralSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
  unspecifiedEnumeration: boolean;
}

export class ModelicaShortClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaShortClassSpecifierSyntaxNode
{
  causality: ModelicaCausality | null;
  enumeration: boolean;
  unspecifiedEnumeration: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.causality =
      abstractSyntaxNode?.causality ??
      toEnum(ModelicaCausality, concreteSyntaxNode?.childForFieldName("causality")?.text) ??
      null;
    this.enumeration = abstractSyntaxNode?.enumeration ?? concreteSyntaxNode?.childForFieldName("enumeration") != null;
    this.unspecifiedEnumeration =
      abstractSyntaxNode?.unspecifiedEnumeration ??
      concreteSyntaxNode?.childForFieldName("unspecifiedEnumeration") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitShortClassSpecifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassSpecifierSyntaxNode | null,
  ): ModelicaShortClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaShortClassSpecifierSyntaxNode.type:
        return new ModelicaShortClassSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  override get sections(): ModelicaSectionSyntaxNode[] {
    return [];
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaShortClassSpecifierSyntaxNode)?.typeSpecifier,
    );
  }

  get arraySubscripts(): ModelicaArraySubscriptsSyntaxNode | null {
    return ModelicaArraySubscriptsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("arraySubscripts"),
      (this._astFallback as IModelicaShortClassSpecifierSyntaxNode)?.arraySubscripts,
    );
  }

  get classModification(): ModelicaClassModificationSyntaxNode | null {
    return ModelicaClassModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classModification"),
      (this._astFallback as IModelicaShortClassSpecifierSyntaxNode)?.classModification,
    );
  }

  get enumerationLiterals(): ModelicaEnumerationLiteralSyntaxNode[] {
    return ModelicaEnumerationLiteralSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("enumerationLiteral"),
      (this._astFallback as IModelicaShortClassSpecifierSyntaxNode)?.enumerationLiterals,
    );
  }
}

export interface IModelicaDerClassSpecifierSyntaxNode extends IModelicaClassSpecifierSyntaxNode {
  inputs: IModelicaIdentifierSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaDerClassSpecifierSyntaxNode
  extends ModelicaClassSpecifierSyntaxNode
  implements IModelicaDerClassSpecifierSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDerClassSpecifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDerClassSpecifierSyntaxNode | null,
  ): ModelicaDerClassSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDerClassSpecifierSyntaxNode.type:
        return new ModelicaDerClassSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get sections(): ModelicaSectionSyntaxNode[] {
    return [];
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaDerClassSpecifierSyntaxNode)?.typeSpecifier,
    );
  }

  get inputs(): ModelicaIdentifierSyntaxNode[] {
    return ModelicaDescriptionSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("input"),
      (this._astFallback as IModelicaDerClassSpecifierSyntaxNode)?.inputs,
    );
  }
}

export interface IModelicaEnumerationLiteralSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaEnumerationLiteralSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaEnumerationLiteralSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEnumerationLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEnumerationLiteralSyntaxNode | null,
  ): ModelicaEnumerationLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaEnumerationLiteralSyntaxNode.type:
        return new ModelicaEnumerationLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaEnumerationLiteralSyntaxNode)?.identifier,
    );
  }

  get description(): ModelicaDescriptionSyntaxNode | null {
    return ModelicaDescriptionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("description"),
      (this._astFallback as IModelicaEnumerationLiteralSyntaxNode)?.description,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaEnumerationLiteralSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaExternalFunctionClauseSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  externalFunctionCall: IModelicaExternalFunctionCallSyntaxNode | null;
  languageSpecification: IModelicaLanguageSpecificationSyntaxNode | null;
}

export class ModelicaExternalFunctionClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaExternalFunctionClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExternalFunctionClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExternalFunctionClauseSyntaxNode | null,
  ): ModelicaExternalFunctionClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExternalFunctionClauseSyntaxNode.type:
        return new ModelicaExternalFunctionClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get languageSpecification(): ModelicaLanguageSpecificationSyntaxNode | null {
    return ModelicaLanguageSpecificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("languageSpecification"),
      (this._astFallback as IModelicaExternalFunctionClauseSyntaxNode)?.languageSpecification,
    );
  }

  get externalFunctionCall(): ModelicaExternalFunctionCallSyntaxNode | null {
    return ModelicaExternalFunctionCallSyntaxNode.new(
      this,
      this._cst?.childForFieldName("externalFunctionCall"),
      (this._astFallback as IModelicaExternalFunctionClauseSyntaxNode)?.externalFunctionCall,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaExternalFunctionClauseSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaLanguageSpecificationSyntaxNode extends IModelicaSyntaxNode {
  language: IModelicaStringLiteralSyntaxNode | null;
}

export class ModelicaLanguageSpecificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaLanguageSpecificationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitLanguageSpecification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLanguageSpecificationSyntaxNode | null,
  ): ModelicaLanguageSpecificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaLanguageSpecificationSyntaxNode.type:
        return new ModelicaLanguageSpecificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get language(): ModelicaStringLiteralSyntaxNode | null {
    return ModelicaStringLiteralSyntaxNode.new(
      this,
      this._cst?.childForFieldName("language"),
      (this._astFallback as IModelicaLanguageSpecificationSyntaxNode)?.language,
    );
  }
}

export interface IModelicaExternalFunctionCallSyntaxNode extends IModelicaSyntaxNode {
  arguments: IModelicaExpressionListSyntaxNode | null;
  functionName: IModelicaIdentifierSyntaxNode | null;
  output: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaExternalFunctionCallSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaExternalFunctionCallSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExternalFunctionCall(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExternalFunctionCallSyntaxNode | null,
  ): ModelicaExternalFunctionCallSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExternalFunctionCallSyntaxNode.type:
        return new ModelicaExternalFunctionCallSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get output(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("output"),
      (this._astFallback as IModelicaExternalFunctionCallSyntaxNode)?.output,
    );
  }

  get functionName(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionName"),
      (this._astFallback as IModelicaExternalFunctionCallSyntaxNode)?.functionName,
    );
  }

  get arguments(): ModelicaExpressionListSyntaxNode | null {
    return ModelicaExpressionListSyntaxNode.new(
      this,
      this._cst?.childForFieldName("arguments"),
      (this._astFallback as IModelicaExternalFunctionCallSyntaxNode)?.arguments,
    );
  }
}

export type IModelicaSectionSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaSectionSyntaxNode extends ModelicaSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSectionSyntaxNode | null,
  ): ModelicaSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
        );
      case "Initial" + ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementSectionSyntaxNode,
          "Initial" + ModelicaElementSectionSyntaxNode.type,
          ModelicaVisibility.PUBLIC,
        );
      case ModelicaEquationSectionSyntaxNode.type:
      case "ConstraintSection":
      case "constraint_section":
        return new ModelicaEquationSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEquationSectionSyntaxNode,
        );
      case ModelicaAlgorithmSectionSyntaxNode.type:
        return new ModelicaAlgorithmSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaAlgorithmSectionSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaElementSectionSyntaxNode extends IModelicaSectionSyntaxNode {
  elements: IModelicaElementSyntaxNode[];
  visibility: ModelicaVisibility | null;
}

export class ModelicaElementSectionSyntaxNode
  extends ModelicaSectionSyntaxNode
  implements IModelicaElementSectionSyntaxNode
{
  visibility: ModelicaVisibility | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSectionSyntaxNode | null,
    type?: string | null,
    visibility?: ModelicaVisibility | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, type);
    this.visibility =
      visibility ??
      abstractSyntaxNode?.visibility ??
      toEnum(ModelicaVisibility, concreteSyntaxNode?.childForFieldName("visibility")?.text) ??
      null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementSection(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementSectionSyntaxNode | null,
  ): ModelicaElementSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      case "Initial" + ModelicaElementSectionSyntaxNode.type:
        return new ModelicaElementSectionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode,
          "Initial" + ModelicaElementSectionSyntaxNode.type,
          ModelicaVisibility.PUBLIC,
        );
      default:
        return null;
    }
  }

  get elements(): ModelicaElementSyntaxNode[] {
    return ModelicaElementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("element"),
      (this._astFallback as IModelicaElementSectionSyntaxNode)?.elements,
    );
  }
}

export interface IModelicaElementAnnotationSyntaxNode extends IModelicaElementSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
}

export class ModelicaElementAnnotationSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaElementAnnotationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementAnnotation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementAnnotationSyntaxNode | null,
  ): ModelicaElementAnnotationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementAnnotationSyntaxNode.type:
        return new ModelicaElementAnnotationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.namedChildren?.find((c) => c.type === "AnnotationClause"),
      (this._astFallback as IModelicaElementAnnotationSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaImportClauseSyntaxNode extends IModelicaElementSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  packageName: IModelicaNameSyntaxNode | null;
}

export abstract class ModelicaImportClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaImportClauseSyntaxNode
{
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;
  packageName: ModelicaNameSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaImportClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.packageName = ModelicaNameSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("packageName"),
      abstractSyntaxNode?.packageName,
    );
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaImportClauseSyntaxNode | null,
  ): ModelicaImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleImportClauseSyntaxNode,
        );
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaCompoundImportClauseSyntaxNode,
        );
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnqualifiedImportClauseSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaSimpleImportClauseSyntaxNode extends IModelicaImportClauseSyntaxNode {
  shortName: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaSimpleImportClauseSyntaxNode
  extends ModelicaImportClauseSyntaxNode
  implements IModelicaSimpleImportClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleImportClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleImportClauseSyntaxNode | null,
  ): ModelicaSimpleImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleImportClauseSyntaxNode.type:
        return new ModelicaSimpleImportClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get shortName(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("shortName"),
      (this._astFallback as IModelicaSimpleImportClauseSyntaxNode)?.shortName,
    );
  }
}

export interface IModelicaCompoundImportClauseSyntaxNode extends IModelicaImportClauseSyntaxNode {
  importNames: IModelicaIdentifierSyntaxNode[];
}

export class ModelicaCompoundImportClauseSyntaxNode
  extends ModelicaImportClauseSyntaxNode
  implements IModelicaCompoundImportClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitCompoundImportClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaCompoundImportClauseSyntaxNode | null,
  ): ModelicaCompoundImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaCompoundImportClauseSyntaxNode.type:
        return new ModelicaCompoundImportClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get importNames(): ModelicaIdentifierSyntaxNode[] {
    return ModelicaIdentifierSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("importName"),
      (this._astFallback as IModelicaCompoundImportClauseSyntaxNode)?.importNames,
    );
  }
}

export type IModelicaUnqualifiedImportClauseSyntaxNode = IModelicaImportClauseSyntaxNode;

export class ModelicaUnqualifiedImportClauseSyntaxNode
  extends ModelicaImportClauseSyntaxNode
  implements IModelicaUnqualifiedImportClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnqualifiedImportClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnqualifiedImportClauseSyntaxNode | null,
  ): ModelicaUnqualifiedImportClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnqualifiedImportClauseSyntaxNode.type:
        return new ModelicaUnqualifiedImportClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaExtendsClauseSyntaxNode extends IModelicaElementSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  classOrInheritanceModification: IModelicaClassOrInheritanceModificationSyntaxNode | null;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaExtendsClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaExtendsClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExtendsClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExtendsClauseSyntaxNode | null,
  ): ModelicaExtendsClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExtendsClauseSyntaxNode.type:
        return new ModelicaExtendsClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaExtendsClauseSyntaxNode)?.typeSpecifier,
    );
  }

  get classOrInheritanceModification(): ModelicaClassOrInheritanceModificationSyntaxNode | null {
    return ModelicaClassOrInheritanceModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classOrInheritanceModification"),
      (this._astFallback as IModelicaExtendsClauseSyntaxNode)?.classOrInheritanceModification,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaExtendsClauseSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaConstrainingClauseSyntaxNode extends IModelicaSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaConstrainingClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaConstrainingClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConstrainingClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConstrainingClauseSyntaxNode | null,
  ): ModelicaConstrainingClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaConstrainingClauseSyntaxNode.type:
        return new ModelicaConstrainingClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaConstrainingClauseSyntaxNode)?.typeSpecifier,
    );
  }

  get classModification(): ModelicaClassModificationSyntaxNode | null {
    return ModelicaClassModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classModification"),
      (this._astFallback as IModelicaConstrainingClauseSyntaxNode)?.classModification,
    );
  }

  get description(): ModelicaDescriptionSyntaxNode | null {
    return ModelicaDescriptionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("description"),
      (this._astFallback as IModelicaConstrainingClauseSyntaxNode)?.description,
    );
  }
}

export interface IModelicaClassOrInheritanceModificationSyntaxNode extends IModelicaSyntaxNode {
  modificationArgumentOrInheritanceModifications: (
    | IModelicaModificationArgumentSyntaxNode
    | IModelicaInheritanceModificationSyntaxNode
  )[];
}

export class ModelicaClassOrInheritanceModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassOrInheritanceModificationSyntaxNode
{
  modificationArgumentOrInheritanceModifications: (
    | ModelicaModificationArgumentSyntaxNode
    | ModelicaInheritanceModificationSyntaxNode
  )[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassOrInheritanceModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.modificationArgumentOrInheritanceModifications = [];
    const concreteSyntaxNodeArray =
      concreteSyntaxNode?.childrenForFieldName("modificationArgumentOrInheritanceModification") ?? [];
    const abstractSyntaxNodeArray = abstractSyntaxNode?.modificationArgumentOrInheritanceModifications ?? [];
    const length = Math.max(concreteSyntaxNodeArray?.length ?? 0, abstractSyntaxNodeArray?.length ?? 0);
    for (let i = 0; i < length; i++) {
      const node = ModelicaSyntaxNode.new(
        parent,
        concreteSyntaxNodeArray?.[i] ?? null,
        abstractSyntaxNodeArray?.[i] ?? null,
      );
      if (
        node instanceof ModelicaModificationArgumentSyntaxNode ||
        node instanceof ModelicaInheritanceModificationSyntaxNode
      )
        this.modificationArgumentOrInheritanceModifications.push(node);
    }
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassOrInheritanceModification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassOrInheritanceModificationSyntaxNode | null,
  ): ModelicaClassOrInheritanceModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassOrInheritanceModificationSyntaxNode.type:
        return new ModelicaClassOrInheritanceModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaInheritanceModificationSyntaxNode extends IModelicaSyntaxNode {
  connectEquation: IModelicaConnectEquationSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaInheritanceModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaInheritanceModificationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitInheritanceModification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaInheritanceModificationSyntaxNode | null,
  ): ModelicaInheritanceModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaInheritanceModificationSyntaxNode.type:
        return new ModelicaInheritanceModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get connectEquation(): ModelicaConnectEquationSyntaxNode | null {
    return ModelicaConnectEquationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("connectEquation"),
      (this._astFallback as IModelicaInheritanceModificationSyntaxNode)?.connectEquation,
    );
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaInheritanceModificationSyntaxNode)?.identifier,
    );
  }
}

export interface IModelicaComponentClauseSyntaxNode extends IModelicaElementSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  componentDeclarations: IModelicaComponentDeclarationSyntaxNode[];
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
  causality: ModelicaCausality | null;
  final: boolean;
  flow: ModelicaFlow | null;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
  variability: ModelicaVariability | null;
}

export class ModelicaComponentClauseSyntaxNode
  extends ModelicaElementSyntaxNode
  implements IModelicaComponentClauseSyntaxNode
{
  causality: ModelicaCausality | null;
  final: boolean;
  flow: ModelicaFlow | null;
  inner: boolean;
  outer: boolean;
  redeclare: boolean;
  replaceable: boolean;
  variability: ModelicaVariability | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClauseSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.inner = abstractSyntaxNode?.inner ?? concreteSyntaxNode?.childForFieldName("inner") != null;
    this.outer = abstractSyntaxNode?.outer ?? concreteSyntaxNode?.childForFieldName("outer") != null;
    this.redeclare = abstractSyntaxNode?.redeclare ?? concreteSyntaxNode?.childForFieldName("redeclare") != null;
    this.replaceable = abstractSyntaxNode?.replaceable ?? concreteSyntaxNode?.childForFieldName("replaceable") != null;
    this.flow =
      abstractSyntaxNode?.flow ?? toEnum(ModelicaFlow, concreteSyntaxNode?.childForFieldName("flow")?.text) ?? null;
    this.variability =
      abstractSyntaxNode?.variability ??
      toEnum(ModelicaVariability, concreteSyntaxNode?.childForFieldName("variability")?.text) ??
      null;
    this.causality =
      abstractSyntaxNode?.causality ??
      toEnum(ModelicaCausality, concreteSyntaxNode?.childForFieldName("causality")?.text) ??
      null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClauseSyntaxNode | null,
  ): ModelicaComponentClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentClauseSyntaxNode.type:
        return new ModelicaComponentClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaComponentClauseSyntaxNode)?.typeSpecifier,
    );
  }

  get arraySubscripts(): ModelicaArraySubscriptsSyntaxNode | null {
    return ModelicaArraySubscriptsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("arraySubscripts"),
      (this._astFallback as IModelicaComponentClauseSyntaxNode)?.arraySubscripts,
    );
  }

  get componentDeclarations(): ModelicaComponentDeclarationSyntaxNode[] {
    return ModelicaComponentDeclarationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("componentDeclaration"),
      (this._astFallback as IModelicaComponentClauseSyntaxNode)?.componentDeclarations,
    );
  }

  get constrainingClause(): ModelicaConstrainingClauseSyntaxNode | null {
    return ModelicaConstrainingClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("constrainingClause"),
      (this._astFallback as IModelicaComponentClauseSyntaxNode)?.constrainingClause,
    );
  }
}

export interface IModelicaComponentDeclarationSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  conditionAttribute: IModelicaConditionAttributeSyntaxNode | null;
  declaration: IModelicaDeclarationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export class ModelicaComponentDeclarationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentDeclarationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentDeclaration(this, argument);
  }

  get arraySubscripts(): IterableIterator<ModelicaSubscriptSyntaxNode> {
    const declaration = this.declaration ?? null;
    const componentClause = this.parent ?? null;
    return (function* () {
      yield* declaration?.arraySubscripts?.subscripts ?? [];
      yield* componentClause?.arraySubscripts?.subscripts ?? [];
    })();
  }

  override get parent(): ModelicaComponentClauseSyntaxNode | null {
    return super.parent as ModelicaComponentClauseSyntaxNode | null;
  }

  static override new(
    parent: ModelicaComponentClauseSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclarationSyntaxNode | null,
  ): ModelicaComponentDeclarationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentDeclarationSyntaxNode.type:
        return new ModelicaComponentDeclarationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get declaration(): ModelicaDeclarationSyntaxNode | null {
    return ModelicaDeclarationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("declaration"),
      (this._astFallback as IModelicaComponentDeclarationSyntaxNode)?.declaration,
    );
  }

  get conditionAttribute(): ModelicaConditionAttributeSyntaxNode | null {
    return ModelicaConditionAttributeSyntaxNode.new(
      this,
      this._cst?.childForFieldName("conditionAttribute"),
      (this._astFallback as IModelicaComponentDeclarationSyntaxNode)?.conditionAttribute,
    );
  }

  get description(): ModelicaDescriptionSyntaxNode | null {
    return ModelicaDescriptionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("description"),
      (this._astFallback as IModelicaComponentDeclarationSyntaxNode)?.description,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaComponentDeclarationSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaConditionAttributeSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaConditionAttributeSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaConditionAttributeSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConditionAttribute(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConditionAttributeSyntaxNode | null,
  ): ModelicaConditionAttributeSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaConditionAttributeSyntaxNode.type:
        return new ModelicaConditionAttributeSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaConditionAttributeSyntaxNode)?.condition,
    );
  }
}

export interface IModelicaDeclarationSyntaxNode extends IModelicaSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
  modification: IModelicaModificationSyntaxNode | null;
}

export class ModelicaDeclarationSyntaxNode extends ModelicaSyntaxNode implements IModelicaDeclarationSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDeclaration(this, argument);
  }

  static override new(
    parent: ModelicaComponentDeclarationSyntaxNode | ModelicaComponentDeclaration1SyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDeclarationSyntaxNode | null,
  ): ModelicaDeclarationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDeclarationSyntaxNode.type:
        return new ModelicaDeclarationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaDeclarationSyntaxNode)?.identifier,
    );
  }

  get arraySubscripts(): ModelicaArraySubscriptsSyntaxNode | null {
    return ModelicaArraySubscriptsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("arraySubscripts"),
      (this._astFallback as IModelicaDeclarationSyntaxNode)?.arraySubscripts,
    );
  }

  get modification(): ModelicaModificationSyntaxNode | null {
    return ModelicaModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("modification"),
      (this._astFallback as IModelicaDeclarationSyntaxNode)?.modification,
    );
  }
}

export interface IModelicaModificationSyntaxNode extends IModelicaSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
  modificationExpression: IModelicaModificationExpressionSyntaxNode | null;
  annotationClause: IModelicaModificationSyntaxNode | null;
}

export class ModelicaModificationSyntaxNode extends ModelicaSyntaxNode implements IModelicaModificationSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitModification(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationSyntaxNode | null,
  ): ModelicaModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaModificationSyntaxNode.type:
        return new ModelicaModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get classModification(): ModelicaClassModificationSyntaxNode | null {
    return ModelicaClassModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classModification"),
      (this._astFallback as IModelicaModificationSyntaxNode)?.classModification,
    );
  }

  get modificationExpression(): ModelicaModificationExpressionSyntaxNode | null {
    return ModelicaModificationExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("modificationExpression"),
      (this._astFallback as IModelicaModificationSyntaxNode)?.modificationExpression,
    );
  }

  get annotationClause(): ModelicaModificationSyntaxNode | null {
    return ModelicaModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaModificationSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaModificationExpressionSyntaxNode extends IModelicaSyntaxNode {
  break: boolean;
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaModificationExpressionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaModificationExpressionSyntaxNode
{
  break: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.break = abstractSyntaxNode?.break ?? concreteSyntaxNode?.childForFieldName("break") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitModificationExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationExpressionSyntaxNode | null,
  ): ModelicaModificationExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaModificationExpressionSyntaxNode.type:
        return new ModelicaModificationExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression") ?? this._cst?.firstNamedChild,
      (this._astFallback as IModelicaModificationExpressionSyntaxNode)?.expression,
    );
  }
}

export interface IModelicaClassModificationSyntaxNode extends IModelicaSyntaxNode {
  modificationArguments: IModelicaModificationArgumentSyntaxNode[];
}

export class ModelicaClassModificationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaClassModificationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitClassModification(this, argument);
  }

  hasModificationArgument(name: string): boolean {
    const nameComponents = name.split(".");
    if (nameComponents.length === 0) return false;
    for (const modificationArgument of this.modificationArguments) {
      if (modificationArgument instanceof ModelicaElementModificationSyntaxNode) {
        const length = modificationArgument.name?.parts?.length ?? 0;
        if (length === 0 || length > nameComponents.length) continue;
        let match = true;
        for (let i = 0; i < length; i++) {
          if (modificationArgument.name?.parts?.[i]?.text !== nameComponents[i]) {
            match = false;
            break;
          }
        }
        if (match) {
          if (nameComponents.length === length) {
            return true;
          } else if (nameComponents.length > length) {
            name = nameComponents.slice(length).join(".");
            if (modificationArgument.modification?.classModification?.hasModificationArgument(name)) return true;
          }
        }
      }
    }
    return false;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaClassModificationSyntaxNode | null,
  ): ModelicaClassModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaClassModificationSyntaxNode.type:
        return new ModelicaClassModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get modificationArguments(): ModelicaModificationArgumentSyntaxNode[] {
    return ModelicaModificationArgumentSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("modificationArgument"),
      (this._astFallback as IModelicaClassModificationSyntaxNode)?.modificationArguments,
    );
  }
}

export type IModelicaModificationArgumentSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaModificationArgumentSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaModificationArgumentSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaModificationArgumentSyntaxNode | null,
  ): ModelicaModificationArgumentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementModificationSyntaxNode,
        );
      case ModelicaElementRedeclarationSyntaxNode.type:
        return new ModelicaElementRedeclarationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaElementRedeclarationSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaElementModificationSyntaxNode extends IModelicaModificationArgumentSyntaxNode {
  description: IModelicaDescriptionSyntaxNode | null;
  each: boolean;
  final: boolean;
  modification: IModelicaModificationSyntaxNode | null;
  name: IModelicaNameSyntaxNode | null;
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
}

export class ModelicaElementModificationSyntaxNode
  extends ModelicaModificationArgumentSyntaxNode
  implements IModelicaElementModificationSyntaxNode
{
  each: boolean;
  final: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementModificationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.each = abstractSyntaxNode?.each ?? concreteSyntaxNode?.childForFieldName("each") != null;
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementModification(this, argument);
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.name?.parts?.[0] ?? null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementModificationSyntaxNode | null,
  ): ModelicaElementModificationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementModificationSyntaxNode.type:
        return new ModelicaElementModificationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get name(): ModelicaNameSyntaxNode | null {
    return ModelicaNameSyntaxNode.new(
      this,
      this._cst?.childForFieldName("name"),
      (this._astFallback as IModelicaElementModificationSyntaxNode)?.name,
    );
  }

  get modification(): ModelicaModificationSyntaxNode | null {
    return ModelicaModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("modification"),
      (this._astFallback as IModelicaElementModificationSyntaxNode)?.modification,
    );
  }

  get description(): ModelicaDescriptionSyntaxNode | null {
    return ModelicaDescriptionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("description"),
      (this._astFallback as IModelicaElementModificationSyntaxNode)?.description,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaElementModificationSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaElementRedeclarationSyntaxNode extends IModelicaModificationArgumentSyntaxNode {
  componentClause: IModelicaComponentClause1SyntaxNode | null;
  each: boolean;
  final: boolean;
  redeclare: boolean;
  replaceable: boolean;
  shortClassDefinition: IModelicaShortClassDefinitionSyntaxNode | null;
}

export class ModelicaElementRedeclarationSyntaxNode
  extends ModelicaModificationArgumentSyntaxNode
  implements IModelicaElementRedeclarationSyntaxNode
{
  each: boolean;
  final: boolean;
  redeclare: boolean;
  replaceable: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementRedeclarationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.redeclare = abstractSyntaxNode?.redeclare ?? concreteSyntaxNode?.childForFieldName("redeclare") != null;
    this.each = abstractSyntaxNode?.each ?? concreteSyntaxNode?.childForFieldName("each") != null;
    this.final = abstractSyntaxNode?.final ?? concreteSyntaxNode?.childForFieldName("final") != null;
    this.replaceable = abstractSyntaxNode?.replaceable ?? concreteSyntaxNode?.childForFieldName("replaceable") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElementRedeclaration(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElementRedeclarationSyntaxNode | null,
  ): ModelicaElementRedeclarationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElementRedeclarationSyntaxNode.type:
        return new ModelicaElementRedeclarationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get shortClassDefinition(): ModelicaShortClassDefinitionSyntaxNode | null {
    return ModelicaShortClassDefinitionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classDefinition"),
      (this._astFallback as IModelicaElementRedeclarationSyntaxNode)?.shortClassDefinition,
    );
  }

  get componentClause(): ModelicaComponentClause1SyntaxNode | null {
    return ModelicaComponentClause1SyntaxNode.new(
      this,
      this._cst?.childForFieldName("componentClause"),
      (this._astFallback as IModelicaElementRedeclarationSyntaxNode)?.componentClause,
    );
  }
}

export interface IModelicaComponentClause1SyntaxNode extends IModelicaSyntaxNode {
  causality: ModelicaCausality | null;
  componentDeclaration: IModelicaComponentDeclaration1SyntaxNode | null;
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
  flow: ModelicaFlow | null;
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
  variability: ModelicaVariability | null;
}

export class ModelicaComponentClause1SyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentClause1SyntaxNode
{
  causality: ModelicaCausality | null;
  flow: ModelicaFlow | null;
  variability: ModelicaVariability | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClause1SyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.flow =
      abstractSyntaxNode?.flow ?? toEnum(ModelicaFlow, concreteSyntaxNode?.childForFieldName("flow")?.text) ?? null;
    this.variability =
      abstractSyntaxNode?.variability ??
      toEnum(ModelicaVariability, concreteSyntaxNode?.childForFieldName("variability")?.text) ??
      null;
    this.causality =
      abstractSyntaxNode?.causality ??
      toEnum(ModelicaCausality, concreteSyntaxNode?.childForFieldName("causality")?.text) ??
      null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentClause1(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentClause1SyntaxNode | null,
  ): ModelicaComponentClause1SyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentClause1SyntaxNode.type:
        return new ModelicaComponentClause1SyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaComponentClause1SyntaxNode)?.typeSpecifier,
    );
  }

  get componentDeclaration(): ModelicaComponentDeclaration1SyntaxNode | null {
    return ModelicaComponentDeclaration1SyntaxNode.new(
      this,
      this._cst?.childForFieldName("componentDeclaration"),
      (this._astFallback as IModelicaComponentClause1SyntaxNode)?.componentDeclaration,
    );
  }

  get constrainingClause(): ModelicaConstrainingClauseSyntaxNode | null {
    return ModelicaConstrainingClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("constrainingClause"),
      (this._astFallback as IModelicaComponentClause1SyntaxNode)?.constrainingClause,
    );
  }
}

export interface IModelicaComponentDeclaration1SyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  declaration: IModelicaDeclarationSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export class ModelicaComponentDeclaration1SyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentDeclaration1SyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentDeclaration1(this, argument);
  }

  get arraySubscripts(): IterableIterator<ModelicaSubscriptSyntaxNode> {
    return (function* () {})();
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentDeclaration1SyntaxNode | null,
  ): ModelicaComponentDeclaration1SyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentDeclaration1SyntaxNode.type:
        return new ModelicaComponentDeclaration1SyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  override get parent(): ModelicaComponentClause1SyntaxNode | null {
    return super.parent as ModelicaComponentClause1SyntaxNode | null;
  }

  get declaration(): ModelicaDeclarationSyntaxNode | null {
    return ModelicaDeclarationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("declaration"),
      (this._astFallback as IModelicaComponentDeclaration1SyntaxNode)?.declaration,
    );
  }

  get description(): ModelicaDescriptionSyntaxNode | null {
    return ModelicaDescriptionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("description"),
      (this._astFallback as IModelicaComponentDeclaration1SyntaxNode)?.description,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaComponentDeclaration1SyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaShortClassDefinitionSyntaxNode extends IModelicaSyntaxNode {
  classPrefixes: IModelicaClassPrefixesSyntaxNode | null;
  classSpecifier: IModelicaShortClassSpecifierSyntaxNode | null;
  constrainingClause: IModelicaConstrainingClauseSyntaxNode | null;
}

export class ModelicaShortClassDefinitionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaShortClassDefinitionSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitShortClassDefinition(this, argument);
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return this.classSpecifier?.annotationClause ?? null;
  }

  get elements(): IterableIterator<ModelicaElementSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier) yield* classSpecifier.elements;
    })();
  }

  get equations(): IterableIterator<ModelicaEquationSyntaxNode> {
    const classSpecifier = this.classSpecifier;
    return (function* () {
      if (classSpecifier) yield* classSpecifier.equations;
    })();
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return this.classSpecifier?.identifier ?? null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaShortClassDefinitionSyntaxNode | null,
  ): ModelicaShortClassDefinitionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaShortClassDefinitionSyntaxNode.type:
        return new ModelicaShortClassDefinitionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get sections(): ModelicaSectionSyntaxNode[] {
    return this.classSpecifier?.sections ?? [];
  }

  get classPrefixes(): ModelicaClassPrefixesSyntaxNode | null {
    return ModelicaClassPrefixesSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classPrefixes"),
      (this._astFallback as IModelicaShortClassDefinitionSyntaxNode)?.classPrefixes,
    );
  }

  get classSpecifier(): ModelicaShortClassSpecifierSyntaxNode | null {
    return ModelicaShortClassSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classSpecifier"),
      (this._astFallback as IModelicaShortClassDefinitionSyntaxNode)?.classSpecifier,
    );
  }

  get constrainingClause(): ModelicaConstrainingClauseSyntaxNode | null {
    return ModelicaConstrainingClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("constrainingClause"),
      (this._astFallback as IModelicaShortClassDefinitionSyntaxNode)?.classSpecifier,
    );
  }
}

export interface IModelicaEquationSectionSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  equations: IModelicaEquationSyntaxNode[];
  initial: boolean;
  isConstraint: boolean;
}

export class ModelicaEquationSectionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaEquationSectionSyntaxNode
{
  initial: boolean;
  isConstraint: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSectionSyntaxNode | null,
  ) {
    const cstType = concreteSyntaxNode?.type ?? "";
    const isConstraintCST = cstType === "ConstraintSection" || cstType === "constraint_section";
    // Pass the CST type as an override so the base class validation accepts ConstraintSection nodes
    super(parent, concreteSyntaxNode, abstractSyntaxNode, isConstraintCST ? cstType : null);
    this.initial = abstractSyntaxNode?.initial ?? concreteSyntaxNode?.childForFieldName("initial") != null;
    this.isConstraint = abstractSyntaxNode?.isConstraint ?? isConstraintCST;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEquationSection(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSectionSyntaxNode | null,
  ): ModelicaEquationSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaEquationSectionSyntaxNode.type:
      case "ConstraintSection":
      case "constraint_section":
        return new ModelicaEquationSectionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get equations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("equation"),
      (this._astFallback as IModelicaEquationSectionSyntaxNode)?.equations,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaEquationSectionSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaAlgorithmSectionSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  initial: boolean;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaAlgorithmSectionSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaAlgorithmSectionSyntaxNode
{
  initial: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAlgorithmSectionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.initial = abstractSyntaxNode?.initial ?? concreteSyntaxNode?.childForFieldName("initial") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitAlgorithmSection(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAlgorithmSectionSyntaxNode | null,
  ): ModelicaAlgorithmSectionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaAlgorithmSectionSyntaxNode.type:
        return new ModelicaAlgorithmSectionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaAlgorithmSectionSyntaxNode)?.statements,
    );
  }

  get annotationClause(): ModelicaAnnotationClauseSyntaxNode | null {
    return ModelicaAnnotationClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("annotationClause"),
      (this._astFallback as IModelicaAlgorithmSectionSyntaxNode)?.annotationClause,
    );
  }
}

export interface IModelicaEquationSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export abstract class ModelicaEquationSyntaxNode extends ModelicaSyntaxNode implements IModelicaEquationSyntaxNode {
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEquationSyntaxNode | null,
  ): ModelicaEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleEquationSyntaxNode.type:
        return new ModelicaSimpleEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleEquationSyntaxNode,
        );
      case ModelicaSpecialEquationSyntaxNode.type:
        return new ModelicaSpecialEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSpecialEquationSyntaxNode,
        );
      case ModelicaIfEquationSyntaxNode.type:
        return new ModelicaIfEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfEquationSyntaxNode,
        );
      case ModelicaForEquationSyntaxNode.type:
        return new ModelicaForEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForEquationSyntaxNode,
        );
      case ModelicaConnectEquationSyntaxNode.type:
        return new ModelicaConnectEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaConnectEquationSyntaxNode,
        );
      case ModelicaWhenEquationSyntaxNode.type:
        return new ModelicaWhenEquationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenEquationSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaStatementSyntaxNode extends IModelicaSyntaxNode {
  annotationClause: IModelicaAnnotationClauseSyntaxNode | null;
  description: IModelicaDescriptionSyntaxNode | null;
}

export abstract class ModelicaStatementSyntaxNode extends ModelicaSyntaxNode implements IModelicaStatementSyntaxNode {
  annotationClause: ModelicaAnnotationClauseSyntaxNode | null;
  description: ModelicaDescriptionSyntaxNode | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStatementSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.description = ModelicaDescriptionSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("description"),
      abstractSyntaxNode?.description,
    );
    this.annotationClause = ModelicaAnnotationClauseSyntaxNode.new(
      this,
      concreteSyntaxNode?.childForFieldName("annotationClause"),
      abstractSyntaxNode?.annotationClause,
    );
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStatementSyntaxNode | null,
  ): ModelicaStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleAssignmentStatementSyntaxNode.type:
        return new ModelicaSimpleAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaSimpleAssignmentStatementSyntaxNode,
        );
      case ModelicaProcedureCallStatementSyntaxNode.type:
        return new ModelicaProcedureCallStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaProcedureCallStatementSyntaxNode,
        );
      case ModelicaComplexAssignmentStatementSyntaxNode.type:
        return new ModelicaComplexAssignmentStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComplexAssignmentStatementSyntaxNode,
        );
      case ModelicaBreakStatementSyntaxNode.type:
        return new ModelicaBreakStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBreakStatementSyntaxNode,
        );
      case ModelicaReturnStatementSyntaxNode.type:
        return new ModelicaReturnStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaReturnStatementSyntaxNode,
        );
      case ModelicaIfStatementSyntaxNode.type:
        return new ModelicaIfStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfStatementSyntaxNode,
        );
      case ModelicaForStatementSyntaxNode.type:
        return new ModelicaForStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaForStatementSyntaxNode,
        );
      case ModelicaWhileStatementSyntaxNode.type:
        return new ModelicaWhileStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhileStatementSyntaxNode,
        );
      case ModelicaWhenStatementSyntaxNode.type:
        return new ModelicaWhenStatementSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaWhenStatementSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaSimpleAssignmentStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  source: IModelicaExpressionSyntaxNode | null;
  target: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaSimpleAssignmentStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaSimpleAssignmentStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleAssignmentStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleAssignmentStatementSyntaxNode | null,
  ): ModelicaSimpleAssignmentStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleAssignmentStatementSyntaxNode.type:
        return new ModelicaSimpleAssignmentStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get target(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("target"),
      (this._astFallback as IModelicaSimpleAssignmentStatementSyntaxNode)?.target,
    );
  }

  get source(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("source"),
      (this._astFallback as IModelicaSimpleAssignmentStatementSyntaxNode)?.source,
    );
  }
}

export interface IModelicaProcedureCallStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaProcedureCallStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaProcedureCallStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitProcedureCallStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaProcedureCallStatementSyntaxNode | null,
  ): ModelicaProcedureCallStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaProcedureCallStatementSyntaxNode.type:
        return new ModelicaProcedureCallStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get functionReference(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionReference"),
      (this._astFallback as IModelicaProcedureCallStatementSyntaxNode)?.functionReference,
    );
  }

  get functionCallArguments(): ModelicaFunctionCallArgumentsSyntaxNode | null {
    return ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionCallArguments"),
      (this._astFallback as IModelicaProcedureCallStatementSyntaxNode)?.functionCallArguments,
    );
  }
}

export interface IModelicaComplexAssignmentStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
  outputExpressionList: IModelicaOutputExpressionListSyntaxNode | null;
}

export class ModelicaComplexAssignmentStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaComplexAssignmentStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComplexAssignmentStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComplexAssignmentStatementSyntaxNode | null,
  ): ModelicaComplexAssignmentStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComplexAssignmentStatementSyntaxNode.type:
        return new ModelicaComplexAssignmentStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get outputExpressionList(): ModelicaOutputExpressionListSyntaxNode | null {
    return ModelicaOutputExpressionListSyntaxNode.new(
      this,
      this._cst?.childForFieldName("outputExpressionList"),
      (this._astFallback as IModelicaComplexAssignmentStatementSyntaxNode)?.outputExpressionList,
    );
  }

  get functionReference(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionReference"),
      (this._astFallback as IModelicaComplexAssignmentStatementSyntaxNode)?.functionReference,
    );
  }

  get functionCallArguments(): ModelicaFunctionCallArgumentsSyntaxNode | null {
    return ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionCallArguments"),
      (this._astFallback as IModelicaComplexAssignmentStatementSyntaxNode)?.functionCallArguments,
    );
  }
}

export interface IModelicaSimpleEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  expression1: IModelicaSimpleExpressionSyntaxNode | null;
  operator: string;
  expression2: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaSimpleEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaSimpleEquationSyntaxNode
{
  operator: string;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleEquationSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.operator = abstractSyntaxNode?.operator ?? concreteSyntaxNode?.childForFieldName("operator")?.text ?? "=";
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSimpleEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleEquationSyntaxNode | null,
  ): ModelicaSimpleEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSimpleEquationSyntaxNode.type:
        return new ModelicaSimpleEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expression1(): ModelicaSimpleExpressionSyntaxNode | null {
    return ModelicaSimpleExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression1"),
      (this._astFallback as IModelicaSimpleEquationSyntaxNode)?.expression1,
    );
  }

  get expression2(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression2"),
      (this._astFallback as IModelicaSimpleEquationSyntaxNode)?.expression2,
    );
  }
}

export interface IModelicaSpecialEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaSpecialEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaSpecialEquationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSpecialEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSpecialEquationSyntaxNode | null,
  ): ModelicaSpecialEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSpecialEquationSyntaxNode.type:
        return new ModelicaSpecialEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get functionReference(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionReference"),
      (this._astFallback as IModelicaSpecialEquationSyntaxNode)?.functionReference,
    );
  }

  get functionCallArguments(): ModelicaFunctionCallArgumentsSyntaxNode | null {
    return ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionCallArguments"),
      (this._astFallback as IModelicaSpecialEquationSyntaxNode)?.functionCallArguments,
    );
  }
}

export interface IModelicaIfEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseEquations: IModelicaEquationSyntaxNode[];
  elseIfEquationClauses: IModelicaElseIfEquationClauseSyntaxNode[];
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaIfEquationSyntaxNode extends ModelicaEquationSyntaxNode implements IModelicaIfEquationSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfEquationSyntaxNode | null,
  ): ModelicaIfEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfEquationSyntaxNode.type:
        return new ModelicaIfEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaIfEquationSyntaxNode)?.condition,
    );
  }

  get equations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("equation"),
      (this._astFallback as IModelicaIfEquationSyntaxNode)?.equations,
    );
  }

  get elseIfEquationClauses(): ModelicaElseIfEquationClauseSyntaxNode[] {
    return ModelicaElseIfEquationClauseSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseIfEquationClause"),
      (this._astFallback as IModelicaIfEquationSyntaxNode)?.elseIfEquationClauses,
    );
  }

  get elseEquations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseEquation"),
      (this._astFallback as IModelicaIfEquationSyntaxNode)?.elseEquations,
    );
  }
}

export interface IModelicaElseIfEquationClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaElseIfEquationClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseIfEquationClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfEquationClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfEquationClauseSyntaxNode | null,
  ): ModelicaElseIfEquationClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseIfEquationClauseSyntaxNode.type:
        return new ModelicaElseIfEquationClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaElseIfEquationClauseSyntaxNode)?.condition,
    );
  }

  get equations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("equation"),
      (this._astFallback as IModelicaElseIfEquationClauseSyntaxNode)?.equations,
    );
  }
}

export interface IModelicaIfStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseStatements: IModelicaStatementSyntaxNode[];
  elseIfStatementClauses: IModelicaElseIfStatementClauseSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaIfStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaIfStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfStatementSyntaxNode | null,
  ): ModelicaIfStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfStatementSyntaxNode.type:
        return new ModelicaIfStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaIfStatementSyntaxNode)?.condition,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaIfStatementSyntaxNode)?.statements,
    );
  }

  get elseIfStatementClauses(): ModelicaElseIfStatementClauseSyntaxNode[] {
    return ModelicaElseIfStatementClauseSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseIfStatementClause"),
      (this._astFallback as IModelicaIfStatementSyntaxNode)?.elseIfStatementClauses,
    );
  }

  get elseStatements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseStatement"),
      (this._astFallback as IModelicaIfStatementSyntaxNode)?.elseStatements,
    );
  }
}

export interface IModelicaElseIfStatementClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaElseIfStatementClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseIfStatementClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfStatementClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfStatementClauseSyntaxNode | null,
  ): ModelicaElseIfStatementClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseIfStatementClauseSyntaxNode.type:
        return new ModelicaElseIfStatementClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaElseIfStatementClauseSyntaxNode)?.condition,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaElseIfStatementClauseSyntaxNode)?.statements,
    );
  }
}

export interface IModelicaForEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  equations: IModelicaEquationSyntaxNode[];
  forIndexes: IModelicaForIndexSyntaxNode[];
}

export class ModelicaForEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaForEquationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForEquationSyntaxNode | null,
  ): ModelicaForEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaForEquationSyntaxNode.type:
        return new ModelicaForEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get forIndexes(): ModelicaForIndexSyntaxNode[] {
    return ModelicaForIndexSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("forIndex"),
      (this._astFallback as IModelicaForEquationSyntaxNode)?.forIndexes,
    );
  }

  get equations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("equation"),
      (this._astFallback as IModelicaForEquationSyntaxNode)?.equations,
    );
  }
}

export interface IModelicaForStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  forIndexes: IModelicaForIndexSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaForStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaForStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForStatementSyntaxNode | null,
  ): ModelicaForStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaForStatementSyntaxNode.type:
        return new ModelicaForStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get forIndexes(): ModelicaForIndexSyntaxNode[] {
    return ModelicaForIndexSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("forIndex"),
      (this._astFallback as IModelicaForStatementSyntaxNode)?.forIndexes,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaForStatementSyntaxNode)?.statements,
    );
  }
}

export interface IModelicaForIndexSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaForIndexSyntaxNode extends ModelicaSyntaxNode implements IModelicaForIndexSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitForIndex(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaForIndexSyntaxNode | null,
  ): ModelicaForIndexSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaForIndexSyntaxNode.type:
        return new ModelicaForIndexSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression"),
      (this._astFallback as IModelicaForIndexSyntaxNode)?.expression,
    );
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaForIndexSyntaxNode)?.identifier,
    );
  }
}

export interface IModelicaWhileStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaWhileStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaWhileStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhileStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhileStatementSyntaxNode | null,
  ): ModelicaWhileStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWhileStatementSyntaxNode.type:
        return new ModelicaWhileStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaWhileStatementSyntaxNode)?.condition,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaWhileStatementSyntaxNode)?.statements,
    );
  }
}

export interface IModelicaWhenEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseWhenEquationClauses: IModelicaElseWhenEquationClauseSyntaxNode[];
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaWhenEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaWhenEquationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhenEquationSyntaxNode | null,
  ): ModelicaWhenEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWhenEquationSyntaxNode.type:
        return new ModelicaWhenEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaWhenEquationSyntaxNode)?.condition,
    );
  }

  get equations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("equation"),
      (this._astFallback as IModelicaWhenEquationSyntaxNode)?.equations,
    );
  }

  get elseWhenEquationClauses(): ModelicaElseWhenEquationClauseSyntaxNode[] {
    return ModelicaElseWhenEquationClauseSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseWhenEquationClause"),
      (this._astFallback as IModelicaWhenEquationSyntaxNode)?.elseWhenEquationClauses,
    );
  }
}

export interface IModelicaElseWhenEquationClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  equations: IModelicaEquationSyntaxNode[];
}

export class ModelicaElseWhenEquationClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseWhenEquationClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseWhenEquationClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseWhenEquationClauseSyntaxNode | null,
  ): ModelicaElseWhenEquationClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseWhenEquationClauseSyntaxNode.type:
        return new ModelicaElseWhenEquationClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaElseWhenEquationClauseSyntaxNode)?.condition,
    );
  }

  get equations(): ModelicaEquationSyntaxNode[] {
    return ModelicaEquationSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("equation"),
      (this._astFallback as IModelicaElseWhenEquationClauseSyntaxNode)?.equations,
    );
  }
}

export interface IModelicaWhenStatementSyntaxNode extends IModelicaStatementSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseWhenStatementClauses: IModelicaElseWhenStatementClauseSyntaxNode[];
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaWhenStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaWhenStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitWhenStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaWhenStatementSyntaxNode | null,
  ): ModelicaWhenStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaWhenStatementSyntaxNode.type:
        return new ModelicaWhenStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaWhenStatementSyntaxNode)?.condition,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaWhenStatementSyntaxNode)?.statements,
    );
  }

  get elseWhenStatementClauses(): ModelicaElseWhenStatementClauseSyntaxNode[] {
    return ModelicaElseWhenStatementClauseSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseWhenStatementClause"),
      (this._astFallback as IModelicaWhenStatementSyntaxNode)?.elseWhenStatementClauses,
    );
  }
}

export interface IModelicaElseWhenStatementClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  statements: IModelicaStatementSyntaxNode[];
}

export class ModelicaElseWhenStatementClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseWhenStatementClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseWhenStatementClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseWhenStatementClauseSyntaxNode | null,
  ): ModelicaElseWhenStatementClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseWhenStatementClauseSyntaxNode.type:
        return new ModelicaElseWhenStatementClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaElseWhenStatementClauseSyntaxNode)?.condition,
    );
  }

  get statements(): ModelicaStatementSyntaxNode[] {
    return ModelicaStatementSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("statement"),
      (this._astFallback as IModelicaElseWhenStatementClauseSyntaxNode)?.statements,
    );
  }
}

export interface IModelicaConnectEquationSyntaxNode extends IModelicaEquationSyntaxNode {
  componentReference1: IModelicaComponentReferenceSyntaxNode | null;
  componentReference2: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaConnectEquationSyntaxNode
  extends ModelicaEquationSyntaxNode
  implements IModelicaConnectEquationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitConnectEquation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaConnectEquationSyntaxNode | null,
  ): ModelicaConnectEquationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaConnectEquationSyntaxNode.type:
        return new ModelicaConnectEquationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get componentReference1(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("componentReference1"),
      (this._astFallback as IModelicaConnectEquationSyntaxNode)?.componentReference1,
    );
  }

  get componentReference2(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("componentReference2"),
      (this._astFallback as IModelicaConnectEquationSyntaxNode)?.componentReference2,
    );
  }
}

export type IModelicaBreakStatementSyntaxNode = IModelicaStatementSyntaxNode;

export class ModelicaBreakStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaBreakStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBreakStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBreakStatementSyntaxNode | null,
  ): ModelicaBreakStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBreakStatementSyntaxNode.type:
        return new ModelicaBreakStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaReturnStatementSyntaxNode = IModelicaStatementSyntaxNode;

export class ModelicaReturnStatementSyntaxNode
  extends ModelicaStatementSyntaxNode
  implements IModelicaReturnStatementSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitReturnStatement(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaReturnStatementSyntaxNode | null,
  ): ModelicaReturnStatementSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaReturnStatementSyntaxNode.type:
        return new ModelicaReturnStatementSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaExpressionSyntaxNode = IModelicaSyntaxNode;

export abstract class ModelicaExpressionSyntaxNode extends ModelicaSyntaxNode implements IModelicaExpressionSyntaxNode {
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExpressionSyntaxNode | null,
  ): ModelicaExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfElseExpressionSyntaxNode.type:
        return new ModelicaIfElseExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaIfElseExpressionSyntaxNode,
        );
      case ModelicaRangeExpressionSyntaxNode.type:
        return new ModelicaRangeExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaRangeExpressionSyntaxNode,
        );
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaIfElseExpressionSyntaxNode extends IModelicaExpressionSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  elseIfExpressionClauses: IModelicaElseIfExpressionClauseSyntaxNode[];
  elseExpression: IModelicaExpressionSyntaxNode | null;
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaIfElseExpressionSyntaxNode
  extends ModelicaExpressionSyntaxNode
  implements IModelicaIfElseExpressionSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIfElseExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIfElseExpressionSyntaxNode | null,
  ): ModelicaIfElseExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIfElseExpressionSyntaxNode.type:
        return new ModelicaIfElseExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaIfElseExpressionSyntaxNode)?.condition,
    );
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression"),
      (this._astFallback as IModelicaIfElseExpressionSyntaxNode)?.expression,
    );
  }

  get elseIfExpressionClauses(): ModelicaElseIfExpressionClauseSyntaxNode[] {
    return ModelicaElseIfExpressionClauseSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("elseIfExpressionClause"),
      (this._astFallback as IModelicaIfElseExpressionSyntaxNode)?.elseIfExpressionClauses,
    );
  }

  get elseExpression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("elseExpression"),
      (this._astFallback as IModelicaIfElseExpressionSyntaxNode)?.elseExpression,
    );
  }
}

export interface IModelicaElseIfExpressionClauseSyntaxNode extends IModelicaSyntaxNode {
  condition: IModelicaExpressionSyntaxNode | null;
  expression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaElseIfExpressionClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaElseIfExpressionClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitElseIfExpressionClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaElseIfExpressionClauseSyntaxNode | null,
  ): ModelicaElseIfExpressionClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaElseIfExpressionClauseSyntaxNode.type:
        return new ModelicaElseIfExpressionClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get condition(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("condition"),
      (this._astFallback as IModelicaElseIfExpressionClauseSyntaxNode)?.condition,
    );
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression"),
      (this._astFallback as IModelicaElseIfExpressionClauseSyntaxNode)?.expression,
    );
  }
}

export interface IModelicaRangeExpressionSyntaxNode extends IModelicaExpressionSyntaxNode {
  startExpression: IModelicaExpressionSyntaxNode | null;
  stepExpression: IModelicaExpressionSyntaxNode | null;
  stopExpression: IModelicaExpressionSyntaxNode | null;
}

export class ModelicaRangeExpressionSyntaxNode
  extends ModelicaExpressionSyntaxNode
  implements IModelicaRangeExpressionSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitRangeExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaRangeExpressionSyntaxNode | null,
  ): ModelicaRangeExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaRangeExpressionSyntaxNode.type:
        return new ModelicaRangeExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get startExpression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("startExpression"),
      (this._astFallback as IModelicaRangeExpressionSyntaxNode)?.startExpression,
    );
  }

  get stepExpression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("stepExpression"),
      (this._astFallback as IModelicaRangeExpressionSyntaxNode)?.stepExpression,
    );
  }

  get stopExpression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("stopExpression"),
      (this._astFallback as IModelicaRangeExpressionSyntaxNode)?.stopExpression,
    );
  }
}

export type IModelicaSimpleExpressionSyntaxNode = IModelicaExpressionSyntaxNode;

export abstract class ModelicaSimpleExpressionSyntaxNode
  extends ModelicaExpressionSyntaxNode
  implements IModelicaSimpleExpressionSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSimpleExpressionSyntaxNode | null,
  ): ModelicaSimpleExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnaryExpressionSyntaxNode,
        );
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBinaryExpressionSyntaxNode,
        );
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaUnaryExpressionSyntaxNode extends IModelicaSimpleExpressionSyntaxNode {
  operand: IModelicaSimpleExpressionSyntaxNode | null;
  operator: ModelicaUnaryOperator | null;
}

export class ModelicaUnaryExpressionSyntaxNode
  extends ModelicaSimpleExpressionSyntaxNode
  implements IModelicaUnaryExpressionSyntaxNode
{
  operator: ModelicaUnaryOperator | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnaryExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.operator =
      abstractSyntaxNode?.operator ??
      toEnum(ModelicaUnaryOperator, concreteSyntaxNode?.childForFieldName("operator")?.text) ??
      null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnaryExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnaryExpressionSyntaxNode | null,
  ): ModelicaUnaryExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnaryExpressionSyntaxNode.type:
        return new ModelicaUnaryExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get operand(): ModelicaSimpleExpressionSyntaxNode | null {
    return ModelicaSimpleExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("operand"),
      (this._astFallback as IModelicaUnaryExpressionSyntaxNode)?.operand,
    );
  }
}

export interface IModelicaBinaryExpressionSyntaxNode extends IModelicaSimpleExpressionSyntaxNode {
  operand1: IModelicaSimpleExpressionSyntaxNode | null;
  operand2: IModelicaSimpleExpressionSyntaxNode | null;
  operator: ModelicaBinaryOperator | null;
}

export class ModelicaBinaryExpressionSyntaxNode
  extends ModelicaSimpleExpressionSyntaxNode
  implements IModelicaBinaryExpressionSyntaxNode
{
  operator: ModelicaBinaryOperator | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBinaryExpressionSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.operator =
      abstractSyntaxNode?.operator ??
      toEnum(ModelicaBinaryOperator, concreteSyntaxNode?.childForFieldName("operator")?.text) ??
      null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBinaryExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBinaryExpressionSyntaxNode | null,
  ): ModelicaBinaryExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBinaryExpressionSyntaxNode.type:
        return new ModelicaBinaryExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get operand1(): ModelicaSimpleExpressionSyntaxNode | null {
    return ModelicaSimpleExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("operand1"),
      (this._astFallback as IModelicaBinaryExpressionSyntaxNode)?.operand1,
    );
  }

  get operand2(): ModelicaSimpleExpressionSyntaxNode | null {
    return ModelicaSimpleExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("operand2"),
      (this._astFallback as IModelicaBinaryExpressionSyntaxNode)?.operand2,
    );
  }
}

export type IModelicaPrimaryExpressionSyntaxNode = IModelicaSimpleExpressionSyntaxNode;

export abstract class ModelicaPrimaryExpressionSyntaxNode
  extends ModelicaSimpleExpressionSyntaxNode
  implements IModelicaPrimaryExpressionSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaPrimaryExpressionSyntaxNode | null,
  ): ModelicaPrimaryExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaFunctionCallSyntaxNode,
        );
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaComponentReferenceSyntaxNode,
        );
      case ModelicaMemberAccessExpressionSyntaxNode.type:
        return new ModelicaMemberAccessExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaMemberAccessExpressionSyntaxNode,
        );
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaOutputExpressionListSyntaxNode,
        );
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConcatenationSyntaxNode,
        );
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaArrayConstructorSyntaxNode,
        );
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaEndExpressionSyntaxNode,
        );
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export type IModelicaEndExpressionSyntaxNode = IModelicaPrimaryExpressionSyntaxNode;

export class ModelicaEndExpressionSyntaxNode extends ModelicaSyntaxNode implements IModelicaEndExpressionSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitEndExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaEndExpressionSyntaxNode | null,
  ): ModelicaEndExpressionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaEndExpressionSyntaxNode.type:
        return new ModelicaEndExpressionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export type IModelicaLiteralSyntaxNode = IModelicaPrimaryExpressionSyntaxNode;

export abstract class ModelicaLiteralSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaLiteralSyntaxNode
{
  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaLiteralSyntaxNode | null,
  ): ModelicaLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaBooleanLiteralSyntaxNode,
        );
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaStringLiteralSyntaxNode,
        );
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedIntegerLiteralSyntaxNode,
        );
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(
          parent,
          concreteSyntaxNode,
          abstractSyntaxNode as IModelicaUnsignedRealLiteralSyntaxNode,
        );
      default:
        return null;
    }
  }
}

export interface IModelicaTypeSpecifierSyntaxNode extends IModelicaSyntaxNode {
  global: boolean;
  name: IModelicaNameSyntaxNode | null;
}

export class ModelicaTypeSpecifierSyntaxNode extends ModelicaSyntaxNode implements IModelicaTypeSpecifierSyntaxNode {
  global: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaTypeSpecifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.global = abstractSyntaxNode?.global ?? concreteSyntaxNode?.childForFieldName("global") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitTypeSpecifier(this, argument);
  }

  get text(): string | null {
    const prefix = this.global ? "." : "";
    const nameParts = this.name?.parts?.map((p) => p.text).join(".");
    return nameParts ? prefix + nameParts : null;
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaTypeSpecifierSyntaxNode | null,
  ): ModelicaTypeSpecifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaTypeSpecifierSyntaxNode.type:
        return new ModelicaTypeSpecifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get name(): ModelicaNameSyntaxNode | null {
    return ModelicaNameSyntaxNode.new(
      this,
      this._cst?.childForFieldName("name"),
      (this._astFallback as IModelicaTypeSpecifierSyntaxNode)?.name,
    );
  }
}

export interface IModelicaNameSyntaxNode extends IModelicaSyntaxNode {
  parts: IModelicaIdentifierSyntaxNode[];
}

export class ModelicaNameSyntaxNode extends ModelicaSyntaxNode implements IModelicaNameSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitName(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNameSyntaxNode | null,
  ): ModelicaNameSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaNameSyntaxNode.type:
        return new ModelicaNameSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get parts(): ModelicaIdentifierSyntaxNode[] {
    return ModelicaIdentifierSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("part"),
      (this._astFallback as IModelicaNameSyntaxNode)?.parts,
    );
  }
}

export interface IModelicaComponentReferenceSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  global: boolean;
  parts: IModelicaComponentReferencePartSyntaxNode[];
}

export class ModelicaComponentReferenceSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaComponentReferenceSyntaxNode
{
  global: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.global = abstractSyntaxNode?.global ?? concreteSyntaxNode?.childForFieldName("global") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReference(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferenceSyntaxNode | null,
  ): ModelicaComponentReferenceSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentReferenceSyntaxNode.type:
        return new ModelicaComponentReferenceSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        //console.log("ERROR", concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]);
        return null;
    }
  }

  get parts(): ModelicaComponentReferencePartSyntaxNode[] {
    return ModelicaComponentReferencePartSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("part"),
      (this._astFallback as IModelicaComponentReferenceSyntaxNode)?.parts,
    );
  }
}

export interface IModelicaComponentReferencePartSyntaxNode extends IModelicaSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaComponentReferencePartSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComponentReferencePartSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComponentReferencePart(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComponentReferencePartSyntaxNode | null,
  ): ModelicaComponentReferencePartSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComponentReferencePartSyntaxNode.type:
        return new ModelicaComponentReferencePartSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaComponentReferencePartSyntaxNode)?.identifier,
    );
  }

  get arraySubscripts(): ModelicaArraySubscriptsSyntaxNode | null {
    return ModelicaArraySubscriptsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("arraySubscripts"),
      (this._astFallback as IModelicaComponentReferencePartSyntaxNode)?.arraySubscripts,
    );
  }
}

export interface IModelicaFunctionCallSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  functionCallArguments: IModelicaFunctionCallArgumentsSyntaxNode | null;
  functionReference: IModelicaComponentReferenceSyntaxNode | null;
}

export class ModelicaFunctionCallSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaFunctionCallSyntaxNode
{
  /** Raw text of the function reference (handles keyword functions like der/initial/pure) */
  functionReferenceName: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    const funcRefNode = concreteSyntaxNode?.childForFieldName("functionReference");
    this.functionReferenceName = funcRefNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCall(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallSyntaxNode | null,
  ): ModelicaFunctionCallSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionCallSyntaxNode.type:
        return new ModelicaFunctionCallSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get functionReference(): ModelicaComponentReferenceSyntaxNode | null {
    return ModelicaComponentReferenceSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionReference"),
      (this._astFallback as IModelicaFunctionCallSyntaxNode)?.functionReference,
    );
  }

  get functionCallArguments(): ModelicaFunctionCallArgumentsSyntaxNode | null {
    return ModelicaFunctionCallArgumentsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionCallArguments"),
      (this._astFallback as IModelicaFunctionCallSyntaxNode)?.functionCallArguments,
    );
  }
}

export interface IModelicaFunctionCallArgumentsSyntaxNode extends IModelicaSyntaxNode {
  arguments: IModelicaFunctionArgumentSyntaxNode[];
  comprehensionClause: IModelicaComprehensionClauseSyntaxNode | null;
  namedArguments: IModelicaNamedArgumentSyntaxNode[];
}

export class ModelicaFunctionCallArgumentsSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaFunctionCallArgumentsSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionCallArguments(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionCallArgumentsSyntaxNode | null,
  ): ModelicaFunctionCallArgumentsSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionCallArgumentsSyntaxNode.type:
        return new ModelicaFunctionCallArgumentsSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get comprehensionClause(): ModelicaComprehensionClauseSyntaxNode | null {
    return ModelicaComprehensionClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("comprehensionClause"),
      (this._astFallback as IModelicaFunctionCallArgumentsSyntaxNode)?.comprehensionClause,
    );
  }

  get arguments(): ModelicaFunctionArgumentSyntaxNode[] {
    return ModelicaFunctionArgumentSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("argument"),
      (this._astFallback as IModelicaFunctionCallArgumentsSyntaxNode)?.arguments,
    );
  }

  get namedArguments(): ModelicaNamedArgumentSyntaxNode[] {
    return ModelicaNamedArgumentSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("namedArgument"),
      (this._astFallback as IModelicaFunctionCallArgumentsSyntaxNode)?.namedArguments,
    );
  }
}

export interface IModelicaArrayConcatenationSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  expressionLists: IModelicaExpressionListSyntaxNode[];
}

export class ModelicaArrayConcatenationSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaArrayConcatenationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayConcatenation(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArrayConcatenationSyntaxNode | null,
  ): ModelicaArrayConcatenationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaArrayConcatenationSyntaxNode.type:
        return new ModelicaArrayConcatenationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expressionLists(): ModelicaExpressionListSyntaxNode[] {
    return ModelicaExpressionListSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("expressionList"),
      (this._astFallback as IModelicaArrayConcatenationSyntaxNode)?.expressionLists,
    );
  }
}

export interface IModelicaArrayConstructorSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  comprehensionClause: IModelicaComprehensionClauseSyntaxNode | null;
  expressionList: IModelicaExpressionListSyntaxNode | null;
}

export class ModelicaArrayConstructorSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaArrayConstructorSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArrayConstructor(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArrayConstructorSyntaxNode | null,
  ): ModelicaArrayConstructorSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaArrayConstructorSyntaxNode.type:
        return new ModelicaArrayConstructorSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get comprehensionClause(): ModelicaComprehensionClauseSyntaxNode | null {
    return ModelicaComprehensionClauseSyntaxNode.new(
      this,
      this._cst?.childForFieldName("comprehensionClause"),
      (this._astFallback as IModelicaArrayConstructorSyntaxNode)?.comprehensionClause,
    );
  }

  get expressionList(): ModelicaExpressionListSyntaxNode | null {
    return ModelicaExpressionListSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expressionList"),
      (this._astFallback as IModelicaArrayConstructorSyntaxNode)?.expressionList,
    );
  }
}

export interface IModelicaComprehensionClauseSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  forIndexes: IModelicaForIndexSyntaxNode[];
}

export class ModelicaComprehensionClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaComprehensionClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitComprehensionClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaComprehensionClauseSyntaxNode | null,
  ): ModelicaComprehensionClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaComprehensionClauseSyntaxNode.type:
        return new ModelicaComprehensionClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression"),
      (this._astFallback as IModelicaComprehensionClauseSyntaxNode)?.expression,
    );
  }

  get forIndexes(): ModelicaForIndexSyntaxNode[] {
    return ModelicaForIndexSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("forIndex"),
      (this._astFallback as IModelicaComprehensionClauseSyntaxNode)?.forIndexes,
    );
  }
}

export interface IModelicaNamedArgumentSyntaxNode extends IModelicaSyntaxNode {
  argument: IModelicaFunctionArgumentSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
}

export class ModelicaNamedArgumentSyntaxNode extends ModelicaSyntaxNode implements IModelicaNamedArgumentSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitNamedArgument(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaNamedArgumentSyntaxNode | null,
  ): ModelicaNamedArgumentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaNamedArgumentSyntaxNode.type:
        return new ModelicaNamedArgumentSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaNamedArgumentSyntaxNode)?.identifier,
    );
  }

  get argument(): ModelicaFunctionArgumentSyntaxNode | null {
    return ModelicaFunctionArgumentSyntaxNode.new(
      this,
      this._cst?.childForFieldName("argument"),
      (this._astFallback as IModelicaNamedArgumentSyntaxNode)?.argument,
    );
  }
}

export interface IModelicaFunctionArgumentSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  functionPartialApplication: IModelicaFunctionPartialApplicationSyntaxNode | null;
}

export class ModelicaFunctionArgumentSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaFunctionArgumentSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionArgument(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionArgumentSyntaxNode | null,
  ): ModelicaFunctionArgumentSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionArgumentSyntaxNode.type:
        return new ModelicaFunctionArgumentSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression"),
      (this._astFallback as IModelicaFunctionArgumentSyntaxNode)?.expression,
    );
  }

  get functionPartialApplication(): ModelicaFunctionPartialApplicationSyntaxNode | null {
    return ModelicaFunctionPartialApplicationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("functionPartialApplication"),
      (this._astFallback as IModelicaFunctionArgumentSyntaxNode)?.functionPartialApplication,
    );
  }
}

export interface IModelicaFunctionPartialApplicationSyntaxNode extends IModelicaSyntaxNode {
  namedArguments: IModelicaNamedArgumentSyntaxNode[];
  typeSpecifier: IModelicaTypeSpecifierSyntaxNode | null;
}

export class ModelicaFunctionPartialApplicationSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaFunctionPartialApplicationSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitFunctionPartialApplication(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionPartialApplicationSyntaxNode | null,
  ): ModelicaFunctionPartialApplicationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionPartialApplicationSyntaxNode.type:
        return new ModelicaFunctionPartialApplicationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get typeSpecifier(): ModelicaTypeSpecifierSyntaxNode | null {
    return ModelicaTypeSpecifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("typeSpecifier"),
      (this._astFallback as IModelicaFunctionPartialApplicationSyntaxNode)?.typeSpecifier,
    );
  }

  get namedArguments(): ModelicaNamedArgumentSyntaxNode[] {
    return ModelicaNamedArgumentSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("namedArgument"),
      (this._astFallback as IModelicaFunctionPartialApplicationSyntaxNode)?.namedArguments,
    );
  }
}

export interface IModelicaMemberAccessExpressionSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  arraySubscripts: IModelicaArraySubscriptsSyntaxNode | null;
  identifier: IModelicaIdentifierSyntaxNode | null;
  outputExpressionList: IModelicaOutputExpressionListSyntaxNode | null;
}

export class ModelicaMemberAccessExpressionSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaMemberAccessExpressionSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitMemberAccessExpression(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaFunctionPartialApplicationSyntaxNode | null,
  ): ModelicaFunctionPartialApplicationSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaFunctionPartialApplicationSyntaxNode.type:
        return new ModelicaFunctionPartialApplicationSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get outputExpressionList(): ModelicaOutputExpressionListSyntaxNode | null {
    return ModelicaOutputExpressionListSyntaxNode.new(
      this,
      this._cst?.childForFieldName("outputExpressionList"),
      (this._astFallback as IModelicaMemberAccessExpressionSyntaxNode)?.outputExpressionList,
    );
  }

  get arraySubscripts(): ModelicaArraySubscriptsSyntaxNode | null {
    return ModelicaArraySubscriptsSyntaxNode.new(
      this,
      this._cst?.childForFieldName("arraySubscripts"),
      (this._astFallback as IModelicaMemberAccessExpressionSyntaxNode)?.arraySubscripts,
    );
  }

  get identifier(): ModelicaIdentifierSyntaxNode | null {
    return ModelicaIdentifierSyntaxNode.new(
      this,
      this._cst?.childForFieldName("identifier"),
      (this._astFallback as IModelicaMemberAccessExpressionSyntaxNode)?.identifier,
    );
  }
}

export interface IModelicaOutputExpressionListSyntaxNode extends IModelicaPrimaryExpressionSyntaxNode {
  outputs: (IModelicaExpressionSyntaxNode | null)[];
}

export class ModelicaOutputExpressionListSyntaxNode
  extends ModelicaPrimaryExpressionSyntaxNode
  implements IModelicaOutputExpressionListSyntaxNode
{
  outputs: (ModelicaExpressionSyntaxNode | null)[];

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaOutputExpressionListSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.outputs = [];
    if (abstractSyntaxNode?.outputs) {
      for (const output of abstractSyntaxNode.outputs) {
        this.outputs.push(output as ModelicaExpressionSyntaxNode | null);
      }
    } else {
      const cursor = concreteSyntaxNode?.walk();
      let blank = true;
      if (cursor != null) {
        if (cursor.gotoFirstChild()) {
          do {
            if (cursor.currentFieldName === "output") {
              this.outputs.push(ModelicaExpressionSyntaxNode.new(this, cursor.currentNode));
              blank = false;
            } else if (cursor.nodeType === ",") {
              if (blank) this.outputs.push(null);
              blank = true;
            }
          } while (cursor.gotoNextSibling());
          if (blank && this.outputs.length > 0) this.outputs.push(null);
        }
      }
    }
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitOutputExpressionList(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaOutputExpressionListSyntaxNode | null,
  ): ModelicaOutputExpressionListSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaOutputExpressionListSyntaxNode.type:
        return new ModelicaOutputExpressionListSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }
}

export interface IModelicaExpressionListSyntaxNode extends IModelicaSyntaxNode {
  expressions: IModelicaExpressionSyntaxNode[];
}

export class ModelicaExpressionListSyntaxNode extends ModelicaSyntaxNode implements IModelicaExpressionListSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitExpressionList(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaExpressionListSyntaxNode | null,
  ): ModelicaExpressionListSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaExpressionListSyntaxNode.type:
        return new ModelicaExpressionListSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expressions(): ModelicaExpressionSyntaxNode[] {
    return ModelicaExpressionSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("expression"),
      (this._astFallback as IModelicaExpressionListSyntaxNode)?.expressions,
    );
  }
}

export interface IModelicaArraySubscriptsSyntaxNode extends IModelicaSyntaxNode {
  subscripts: IModelicaSubscriptSyntaxNode[];
}

export class ModelicaArraySubscriptsSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaArraySubscriptsSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitArraySubscripts(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaArraySubscriptsSyntaxNode | null,
  ): ModelicaArraySubscriptsSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaArraySubscriptsSyntaxNode.type:
        return new ModelicaArraySubscriptsSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get subscripts(): ModelicaSubscriptSyntaxNode[] {
    return ModelicaSubscriptSyntaxNode.newArray(
      this,
      this._cst?.childrenForFieldName("subscript"),
      (this._astFallback as IModelicaArraySubscriptsSyntaxNode)?.subscripts,
    );
  }
}

export interface IModelicaSubscriptSyntaxNode extends IModelicaSyntaxNode {
  expression: IModelicaExpressionSyntaxNode | null;
  flexible: boolean;
}

export class ModelicaSubscriptSyntaxNode extends ModelicaSyntaxNode implements IModelicaSubscriptSyntaxNode {
  flexible: boolean;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSubscriptSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode);
    this.flexible = abstractSyntaxNode?.flexible ?? concreteSyntaxNode?.childForFieldName("flexible") != null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitSubscript(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaSubscriptSyntaxNode | null,
  ): ModelicaSubscriptSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaSubscriptSyntaxNode.type:
        return new ModelicaSubscriptSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get expression(): ModelicaExpressionSyntaxNode | null {
    return ModelicaExpressionSyntaxNode.new(
      this,
      this._cst?.childForFieldName("expression"),
      (this._astFallback as IModelicaSubscriptSyntaxNode)?.expression,
    );
  }
}

export interface IModelicaDescriptionSyntaxNode extends IModelicaSyntaxNode {
  strings: IModelicaStringLiteralSyntaxNode[];
}

export class ModelicaDescriptionSyntaxNode extends ModelicaSyntaxNode implements IModelicaDescriptionSyntaxNode {
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitDescription(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaDescriptionSyntaxNode | null,
  ): ModelicaDescriptionSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaDescriptionSyntaxNode.type:
        return new ModelicaDescriptionSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get strings(): ModelicaStringLiteralSyntaxNode[] {
    return ModelicaStringLiteralSyntaxNode.newArray(
      this,
      this._cst?.children ?? [],
      (this._astFallback as IModelicaDescriptionSyntaxNode)?.strings,
    );
  }
}

export interface IModelicaAnnotationClauseSyntaxNode extends IModelicaSyntaxNode {
  classModification: IModelicaClassModificationSyntaxNode | null;
}

export class ModelicaAnnotationClauseSyntaxNode
  extends ModelicaSyntaxNode
  implements IModelicaAnnotationClauseSyntaxNode
{
  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitAnnotationClause(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaAnnotationClauseSyntaxNode | null,
  ): ModelicaAnnotationClauseSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaAnnotationClauseSyntaxNode.type:
        return new ModelicaAnnotationClauseSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  get classModification(): ModelicaClassModificationSyntaxNode | null {
    return ModelicaClassModificationSyntaxNode.new(
      this,
      this._cst?.childForFieldName("classModification"),
      (this._astFallback as IModelicaAnnotationClauseSyntaxNode)?.classModification,
    );
  }
}

export interface IModelicaBooleanLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaBooleanLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaBooleanLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBooleanLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaBooleanLiteralSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitBooleanLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaBooleanLiteralSyntaxNode | null,
  ): ModelicaBooleanLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaBooleanLiteralSyntaxNode.type:
        return new ModelicaBooleanLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "BOOLEAN";
  }

  get value(): boolean {
    return this.text === "true";
  }
}

export interface IModelicaIdentifierSyntaxNode extends IModelicaSyntaxNode {
  text: string | null;
}

export class ModelicaIdentifierSyntaxNode extends ModelicaSyntaxNode implements IModelicaIdentifierSyntaxNode {
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIdentifierSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaIdentifierSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitIdentifier(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaIdentifierSyntaxNode | null,
  ): ModelicaIdentifierSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaIdentifierSyntaxNode.type:
        return new ModelicaIdentifierSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "IDENT";
  }
}

export interface IModelicaStringLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaStringLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaStringLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStringLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaStringLiteralSyntaxNode.type);
    const text =
      abstractSyntaxNode?.text ?? concreteSyntaxNode?.text?.substring(1, concreteSyntaxNode?.text?.length - 1) ?? null;
    this.text = text?.replace(/""/g, '"')?.replace(/\\"/g, '"') ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitStringLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaStringLiteralSyntaxNode | null,
  ): ModelicaStringLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaStringLiteralSyntaxNode.type:
        return new ModelicaStringLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "STRING";
  }
}

export interface IModelicaUnsignedIntegerLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaUnsignedIntegerLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaUnsignedIntegerLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedIntegerLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaUnsignedIntegerLiteralSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnsignedIntegerLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedIntegerLiteralSyntaxNode | null,
  ): ModelicaUnsignedIntegerLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnsignedIntegerLiteralSyntaxNode.type:
        return new ModelicaUnsignedIntegerLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "UNSIGNED_INTEGER";
  }

  get value(): number {
    if (!this.text) return Number.NaN;
    return parseFloat(this.text);
  }
}

export interface IModelicaUnsignedRealLiteralSyntaxNode extends IModelicaLiteralSyntaxNode {
  text: string | null;
}

export class ModelicaUnsignedRealLiteralSyntaxNode
  extends ModelicaLiteralSyntaxNode
  implements IModelicaUnsignedRealLiteralSyntaxNode
{
  text: string | null;

  constructor(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedRealLiteralSyntaxNode | null,
  ) {
    super(parent, concreteSyntaxNode, abstractSyntaxNode, ModelicaUnsignedRealLiteralSyntaxNode.type);
    this.text = abstractSyntaxNode?.text ?? concreteSyntaxNode?.text ?? null;
  }

  override accept<R, A>(visitor: IModelicaSyntaxVisitor<R, A>, argument?: A): R {
    return visitor.visitUnsignedRealLiteral(this, argument);
  }

  static override new(
    parent: ModelicaSyntaxNode | null,
    concreteSyntaxNode?: SyntaxNode | null,
    abstractSyntaxNode?: IModelicaUnsignedRealLiteralSyntaxNode | null,
  ): ModelicaUnsignedRealLiteralSyntaxNode | null {
    switch (concreteSyntaxNode?.type ?? abstractSyntaxNode?.["@type"]) {
      case ModelicaUnsignedRealLiteralSyntaxNode.type:
        return new ModelicaUnsignedRealLiteralSyntaxNode(parent, concreteSyntaxNode, abstractSyntaxNode);
      default:
        return null;
    }
  }

  static override get type(): string {
    return "UNSIGNED_REAL";
  }

  get value(): number {
    if (!this.text) return Number.NaN;
    return parseFloat(this.text);
  }
}

export interface IModelicaSyntaxVisitor<R, A> {
  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R;
  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R;
  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R;
  visitClassPrefixes(node: ModelicaClassPrefixesSyntaxNode, argument?: A): R;
  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R;
  visitShortClassSpecifier(node: ModelicaShortClassSpecifierSyntaxNode, argument?: A): R;
  visitDerClassSpecifier(node: ModelicaDerClassSpecifierSyntaxNode, argument?: A): R;
  visitEnumerationLiteral(node: ModelicaEnumerationLiteralSyntaxNode, argument?: A): R;
  visitExternalFunctionClause(node: ModelicaExternalFunctionClauseSyntaxNode, argument?: A): R;
  visitLanguageSpecification(node: ModelicaLanguageSpecificationSyntaxNode, argument?: A): R;
  visitExternalFunctionCall(node: ModelicaExternalFunctionCallSyntaxNode, argument?: A): R;
  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R;
  visitElementAnnotation(node: ModelicaElementAnnotationSyntaxNode, argument?: A): R;
  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, argument?: A): R;
  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, argument?: A): R;
  visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, argument?: A): R;
  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, argument?: A): R;
  visitConstrainingClause(node: ModelicaConstrainingClauseSyntaxNode, argument?: A): R;
  visitClassOrInheritanceModification(node: ModelicaClassOrInheritanceModificationSyntaxNode, argument?: A): R;
  visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, argument?: A): R;
  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R;
  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R;
  visitConditionAttribute(node: ModelicaConditionAttributeSyntaxNode, argument?: A): R;
  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R;
  visitModification(node: ModelicaModificationSyntaxNode, argument?: A): R;
  visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, argument?: A): R;
  visitClassModification(node: ModelicaClassModificationSyntaxNode, argument?: A): R;
  visitElementModification(node: ModelicaElementModificationSyntaxNode, argument?: A): R;
  visitElementRedeclaration(node: ModelicaElementRedeclarationSyntaxNode, argument?: A): R;
  visitComponentClause1(node: ModelicaComponentClause1SyntaxNode, argument?: A): R;
  visitComponentDeclaration1(node: ModelicaComponentDeclaration1SyntaxNode, argument?: A): R;
  visitShortClassDefinition(node: ModelicaShortClassDefinitionSyntaxNode, argument?: A): R;
  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, argument?: A): R;
  visitAlgorithmSection(node: ModelicaAlgorithmSectionSyntaxNode, argument?: A): R;
  visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, argument?: A): R;
  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, argument?: A): R;
  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, argument?: A): R;
  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, argument?: A): R;
  visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, argument?: A): R;
  visitIfEquation(node: ModelicaIfEquationSyntaxNode, argument?: A): R;
  visitElseIfEquationClause(node: ModelicaElseIfEquationClauseSyntaxNode, argument?: A): R;
  visitIfStatement(node: ModelicaIfStatementSyntaxNode, argument?: A): R;
  visitElseIfStatementClause(node: ModelicaElseIfStatementClauseSyntaxNode, argument?: A): R;
  visitForEquation(node: ModelicaForEquationSyntaxNode, argument?: A): R;
  visitForStatement(node: ModelicaForStatementSyntaxNode, argument?: A): R;
  visitForIndex(node: ModelicaForIndexSyntaxNode, argument?: A): R;
  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, argument?: A): R;
  visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, argument?: A): R;
  visitElseWhenEquationClause(node: ModelicaElseWhenEquationClauseSyntaxNode, argument?: A): R;
  visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, argument?: A): R;
  visitElseWhenStatementClause(node: ModelicaElseWhenStatementClauseSyntaxNode, argument?: A): R;
  visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, argument?: A): R;
  visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, argument?: A): R;
  visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, argument?: A): R;
  visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, argument?: A): R;
  visitElseIfExpressionClause(node: ModelicaElseIfExpressionClauseSyntaxNode, argument?: A): R;
  visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, argument?: A): R;
  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, argument?: A): R;
  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, argument?: A): R;
  visitEndExpression(node: ModelicaEndExpressionSyntaxNode, argument?: A): R;
  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R;
  visitName(node: ModelicaNameSyntaxNode, argument?: A): R;
  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, argument?: A): R;
  visitComponentReferencePart(node: ModelicaComponentReferencePartSyntaxNode, argument?: A): R;
  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, argument?: A): R;
  visitFunctionCallArguments(node: ModelicaFunctionCallArgumentsSyntaxNode, argument?: A): R;
  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, argument?: A): R;
  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, argument?: A): R;
  visitComprehensionClause(node: ModelicaComprehensionClauseSyntaxNode, argument?: A): R;
  visitNamedArgument(node: ModelicaNamedArgumentSyntaxNode, argument?: A): R;
  visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, argument?: A): R;
  visitFunctionPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode, argument?: A): R;
  visitMemberAccessExpression(node: ModelicaMemberAccessExpressionSyntaxNode, argument?: A): R;
  visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, argument?: A): R;
  visitExpressionList(node: ModelicaExpressionListSyntaxNode, argument?: A): R;
  visitArraySubscripts(node: ModelicaArraySubscriptsSyntaxNode, argument?: A): R;
  visitSubscript(node: ModelicaSubscriptSyntaxNode, argument?: A): R;
  visitDescription(node: ModelicaDescriptionSyntaxNode, argument?: A): R;
  visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, argument?: A): R;
  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, argument?: A): R;
  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R;
  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, argument?: A): R;
  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, argument?: A): R;
  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, argument?: A): R;
}

export abstract class ModelicaSyntaxVisitor<R, A> implements IModelicaSyntaxVisitor<R | null, A> {
  visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, argument?: A): R | null {
    node.withinDirective?.accept(this, argument);
    for (const classDefinition of node.classDefinitions) classDefinition.accept(this, argument);
    return null;
  }

  visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    return null;
  }

  visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, argument?: A): R | null {
    node.classPrefixes?.accept(this, argument);
    node.classSpecifier?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitClassPrefixes(node: ModelicaClassPrefixesSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.description?.accept(this, argument);
    for (const section of node.sections) section.accept(this, argument);
    node.externalFunctionClause?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    node.endIdentifier?.accept(this, argument);
    return null;
  }

  visitShortClassSpecifier(node: ModelicaShortClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.classModification?.accept(this, argument);
    for (const enumerationLiteral of node.enumerationLiterals) enumerationLiteral.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitDerClassSpecifier(node: ModelicaDerClassSpecifierSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.typeSpecifier?.accept(this, argument);
    for (const input of node.inputs) input.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitEnumerationLiteral(node: ModelicaEnumerationLiteralSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitExternalFunctionClause(node: ModelicaExternalFunctionClauseSyntaxNode, argument?: A): R | null {
    node.languageSpecification?.accept(this, argument);
    node.externalFunctionCall?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitLanguageSpecification(node: ModelicaLanguageSpecificationSyntaxNode, argument?: A): R | null {
    node.language?.accept(this, argument);
    return null;
  }

  visitExternalFunctionCall(node: ModelicaExternalFunctionCallSyntaxNode, argument?: A): R | null {
    node.output?.accept(this, argument);
    node.functionName?.accept(this, argument);
    node.arguments?.accept(this, argument);
    return null;
  }

  visitElementSection(node: ModelicaElementSectionSyntaxNode, argument?: A): R | null {
    for (const element of node.elements) element.accept(this, argument);
    return null;
  }

  visitElementAnnotation(node: ModelicaElementAnnotationSyntaxNode, argument?: A): R | null {
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, argument?: A): R | null {
    node.shortName?.accept(this, argument);
    node.packageName?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    for (const importName of node.importNames) importName.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, argument?: A): R | null {
    node.packageName?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.classOrInheritanceModification?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConstrainingClause(node: ModelicaConstrainingClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.classModification?.accept(this, argument);
    node.description?.accept(this, argument);
    return null;
  }

  visitClassOrInheritanceModification(node: ModelicaClassOrInheritanceModificationSyntaxNode, argument?: A): R | null {
    for (const modificationArgumentOrInheritanceModification of node.modificationArgumentOrInheritanceModifications)
      modificationArgumentOrInheritanceModification.accept(this, argument);
    return null;
  }

  visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, argument?: A): R | null {
    node.connectEquation?.accept(this, argument);
    node.identifier?.accept(this, argument);
    return null;
  }

  visitComponentClause(node: ModelicaComponentClauseSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    for (const componentDeclaration of node.componentDeclarations) componentDeclaration?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    node.conditionAttribute?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitConditionAttribute(node: ModelicaConditionAttributeSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    return null;
  }

  visitDeclaration(node: ModelicaDeclarationSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.modification?.accept(this, argument);
    return null;
  }

  visitModification(node: ModelicaModificationSyntaxNode, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    node.modificationExpression?.accept(this, argument);
    return null;
  }

  visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    return null;
  }

  visitClassModification(node: ModelicaClassModificationSyntaxNode, argument?: A): R | null {
    for (const modificationArgument of node.modificationArguments) modificationArgument.accept(this, argument);
    return null;
  }

  visitElementModification(node: ModelicaElementModificationSyntaxNode, argument?: A): R | null {
    node.name?.accept(this, argument);
    node.modification?.accept(this, argument);
    node.description?.accept(this, argument);
    return null;
  }

  visitElementRedeclaration(node: ModelicaElementRedeclarationSyntaxNode, argument?: A): R | null {
    node.shortClassDefinition?.accept(this, argument);
    node.componentClause?.accept(this, argument);
    return null;
  }

  visitComponentClause1(node: ModelicaComponentClause1SyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    node.componentDeclaration?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitComponentDeclaration1(node: ModelicaComponentDeclaration1SyntaxNode, argument?: A): R | null {
    node.declaration?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitShortClassDefinition(node: ModelicaShortClassDefinitionSyntaxNode, argument?: A): R | null {
    node.classPrefixes?.accept(this, argument);
    node.classSpecifier?.accept(this, argument);
    node.constrainingClause?.accept(this, argument);
    return null;
  }

  visitEquationSection(node: ModelicaEquationSectionSyntaxNode, argument?: A): R | null {
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitAlgorithmSection(node: ModelicaAlgorithmSectionSyntaxNode, argument?: A): R | null {
    for (const statement of node.statements) statement.accept(this, argument);
    return null;
  }

  visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, argument?: A): R | null {
    node.target?.accept(this, argument);
    node.source?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, argument?: A): R | null {
    node.outputExpressionList?.accept(this, argument);
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, argument?: A): R | null {
    node.expression1?.accept(this, argument);
    node.expression2?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitIfEquation(node: ModelicaIfEquationSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    for (const elseIfEquationClause of node.elseIfEquationClauses) elseIfEquationClause.accept(this, argument);
    for (const elseEquation of node.elseEquations) elseEquation.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseIfEquationClause(node: ModelicaElseIfEquationClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitIfStatement(node: ModelicaIfStatementSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    for (const elseIfStatementClause of node.elseIfStatementClauses) elseIfStatementClause.accept(this, argument);
    for (const elseStatement of node.elseStatements) elseStatement.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseIfStatementClause(node: ModelicaElseIfStatementClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement?.accept(this, argument);
    return null;
  }

  visitForEquation(node: ModelicaForEquationSyntaxNode, argument?: A): R | null {
    for (const forIndex of node.forIndexes) forIndex.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitForStatement(node: ModelicaForStatementSyntaxNode, argument?: A): R | null {
    for (const forIndex of node.forIndexes) forIndex.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitForIndex(node: ModelicaForIndexSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    for (const elseWhenEquationClause of node.elseWhenEquationClauses) elseWhenEquationClause.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseWhenEquationClause(node: ModelicaElseWhenEquationClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const equation of node.equations) equation.accept(this, argument);
    return null;
  }

  visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    for (const elseWhenStatementClause of node.elseWhenStatementClauses) elseWhenStatementClause.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitElseWhenStatementClause(node: ModelicaElseWhenStatementClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    for (const statement of node.statements) statement.accept(this, argument);
    return null;
  }

  visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, argument?: A): R | null {
    node.componentReference1?.accept(this, argument);
    node.componentReference2?.accept(this, argument);
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, argument?: A): R | null {
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, argument?: A): R | null {
    node.description?.accept(this, argument);
    node.annotationClause?.accept(this, argument);
    return null;
  }

  visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    node.expression?.accept(this, argument);
    for (const elseIfExpressionClause of node.elseIfExpressionClauses) elseIfExpressionClause.accept(this, argument);
    node.elseExpression?.accept(this, argument);
    return null;
  }

  visitElseIfExpressionClause(node: ModelicaElseIfExpressionClauseSyntaxNode, argument?: A): R | null {
    node.condition?.accept(this, argument);
    node.expression?.accept(this, argument);
    return null;
  }

  visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, argument?: A): R | null {
    node.startExpression?.accept(this, argument);
    node.stepExpression?.accept(this, argument);
    node.stopExpression?.accept(this, argument);
    return null;
  }

  visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, argument?: A): R | null {
    node.operand?.accept(this, argument);
    return null;
  }

  visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, argument?: A): R | null {
    node.operand1?.accept(this, argument);
    node.operand2?.accept(this, argument);
    return null;
  }

  visitEndExpression(node: ModelicaEndExpressionSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, argument?: A): R | null {
    node.name?.accept(this, argument);
    return null;
  }

  visitName(node: ModelicaNameSyntaxNode, argument?: A): R | null {
    for (const part of node.parts) part.accept(this, argument);
    return null;
  }

  visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, argument?: A): R | null {
    for (const part of node.parts) part.accept(this, argument);
    return null;
  }

  visitComponentReferencePart(node: ModelicaComponentReferencePartSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    return null;
  }

  visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, argument?: A): R | null {
    node.functionReference?.accept(this, argument);
    node.functionCallArguments?.accept(this, argument);
    return null;
  }

  visitFunctionCallArguments(node: ModelicaFunctionCallArgumentsSyntaxNode, argument?: A): R | null {
    node.comprehensionClause?.accept(this, argument);
    for (const arg of node.arguments) arg.accept(this, argument);
    for (const namedArgument of node.namedArguments) namedArgument.accept(this, argument);
    return null;
  }

  visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, argument?: A): R | null {
    for (const expressionList of node.expressionLists) expressionList.accept(this, argument);
    return null;
  }

  visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, argument?: A): R | null {
    node.comprehensionClause?.accept(this, argument);
    node.expressionList?.accept(this, argument);
    return null;
  }

  visitComprehensionClause(node: ModelicaComprehensionClauseSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    for (const forIndex of node.forIndexes) forIndex.accept(this, argument);
    return null;
  }

  visitNamedArgument(node: ModelicaNamedArgumentSyntaxNode, argument?: A): R | null {
    node.identifier?.accept(this, argument);
    node.argument?.accept(this, argument);
    return null;
  }

  visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    node.functionPartialApplication?.accept(this, argument);
    return null;
  }

  visitFunctionPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode, argument?: A): R | null {
    node.typeSpecifier?.accept(this, argument);
    for (const namedArgument of node.namedArguments) namedArgument.accept(this, argument);
    return null;
  }

  visitMemberAccessExpression(node: ModelicaMemberAccessExpressionSyntaxNode, argument?: A): R | null {
    node.outputExpressionList?.accept(this, argument);
    node.arraySubscripts?.accept(this, argument);
    node.identifier?.accept(this, argument);
    return null;
  }

  visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, argument?: A): R | null {
    for (const output of node.outputs) output?.accept(this, argument);
    return null;
  }

  visitExpressionList(node: ModelicaExpressionListSyntaxNode, argument?: A): R | null {
    for (const expression of node.expressions) expression.accept(this, argument);
    return null;
  }

  visitArraySubscripts(node: ModelicaArraySubscriptsSyntaxNode, argument?: A): R | null {
    for (const subscript of node.subscripts) subscript.accept(this, argument);
    return null;
  }

  visitSubscript(node: ModelicaSubscriptSyntaxNode, argument?: A): R | null {
    node.expression?.accept(this, argument);
    return null;
  }

  visitDescription(node: ModelicaDescriptionSyntaxNode, argument?: A): R | null {
    for (const string of node.strings) string.accept(this, argument);
    return null;
  }

  visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, argument?: A): R | null {
    node.classModification?.accept(this, argument);
    return null;
  }

  visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitIdentifier(node: ModelicaIdentifierSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }

  visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, argument?: A): R | null {
    return null;
  }
}

export class ModelicaSyntaxPrinter extends ModelicaSyntaxVisitor<void, number> {
  out: Writer;

  constructor(out: Writer) {
    super();
    this.out = out;
  }

  private print(text: string, indent = 0) {
    this.out.write("  ".repeat(indent));
    this.out.write(text);
  }

  private println(text = "", indent = 0) {
    this.out.write("  ".repeat(indent));
    this.out.write(text);
    this.out.write("\n");
  }

  override visitStoredDefinition(node: ModelicaStoredDefinitionSyntaxNode, indent = 0): void {
    node.withinDirective?.accept(this, indent);
    for (const classDefinition of node.classDefinitions) {
      classDefinition.accept(this, indent);
    }
  }

  override visitWithinDirective(node: ModelicaWithinDirectiveSyntaxNode, indent = 0): void {
    this.print("within ", indent);
    node.packageName?.accept(this, indent);
    this.println(";");
  }

  override visitClassDefinition(node: ModelicaClassDefinitionSyntaxNode, indent = 0): void {
    this.print("", indent);
    if (node.redeclare) this.print("redeclare ");
    if (node.final) this.print("final ");
    if (node.inner) this.print("inner ");
    if (node.outer) this.print("outer ");
    if (node.replaceable) this.print("replaceable ");
    if (node.encapsulated) this.print("encapsulated ");
    node.classPrefixes?.accept(this, indent);
    node.classSpecifier?.accept(this, indent);
    node.constrainingClause?.accept(this, indent);
    this.println(";");
  }

  override visitClassPrefixes(node: ModelicaClassPrefixesSyntaxNode, indent = 0): void {
    if (node.partial) this.print("partial ");
    if (node.purity) this.print(node.purity + " ");
    this.print(node.classKind ?? "class");
    this.print(" ");
  }

  override visitLongClassSpecifier(node: ModelicaLongClassSpecifierSyntaxNode, indent = 0): void {
    if (node.extends) this.print("extends ");
    node.identifier?.accept(this, indent);
    node.classModification?.accept(this, indent);
    node.description?.accept(this, indent);
    this.println();
    for (const section of node.sections) {
      section.accept(this, indent + 1);
    }
    node.externalFunctionClause?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.print("end ", indent);
    node.endIdentifier?.accept(this, indent);
  }

  override visitShortClassSpecifier(node: ModelicaShortClassSpecifierSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    this.print(" = ");
    if (node.enumeration) {
      this.print("enumeration (");
      if (node.unspecifiedEnumeration) {
        this.print(":");
      } else {
        let i = 0;
        for (const enumerationLiteral of node.enumerationLiterals) {
          enumerationLiteral.accept(this, indent);
          if (++i < node.enumerationLiterals.length) {
            this.print(", ");
          }
        }
      }
      this.print(")");
    } else {
      if (node.causality) this.print(node.causality + " ");
      node.typeSpecifier?.accept(this, indent);
      node.arraySubscripts?.accept(this, indent);
      node.classModification?.accept(this, indent);
    }
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitDerClassSpecifier(node: ModelicaDerClassSpecifierSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    this.print(" = der(");
    node.typeSpecifier?.accept(this, indent);
    for (const input of node.inputs) {
      this.print(", ");
      input.accept(this, indent);
    }
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitEnumerationLiteral(node: ModelicaEnumerationLiteralSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitExternalFunctionClause(node: ModelicaExternalFunctionClauseSyntaxNode, indent = 0): void {
    this.print("external ");
    node.languageSpecification?.accept(this, indent);
    node.externalFunctionCall?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitLanguageSpecification(node: ModelicaLanguageSpecificationSyntaxNode, indent = 0): void {
    if (node.language?.text) this.print(node.language.text);
  }

  override visitExternalFunctionCall(node: ModelicaExternalFunctionCallSyntaxNode, indent = 0): void {
    if (node.output) {
      node.output.accept(this, indent);
      this.print(" = ");
    }
    node.functionName?.accept(this, indent);
    this.print("(");
    node.arguments?.accept(this, indent);
    this.print(")");
  }

  override visitElementSection(node: ModelicaElementSectionSyntaxNode, indent = 0): void {
    if (node.visibility) {
      this.print("", indent - 1);
      this.println(node.visibility);
    }
    for (const element of node.elements) {
      element.accept(this, indent);
    }
  }

  override visitSimpleImportClause(node: ModelicaSimpleImportClauseSyntaxNode, indent = 0): void {
    this.print("", indent);
    this.print("import ");
    if (node.shortName != null) {
      node.shortName?.accept(this, indent);
      this.print(" = ");
    }
    node.packageName?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitCompoundImportClause(node: ModelicaCompoundImportClauseSyntaxNode, indent = 0): void {
    this.print("import ", indent);
    node.packageName?.accept(this, indent);
    this.print("{");
    let i = 0;
    for (const importName of node.importNames) {
      importName.accept(this, indent);
      if (++i < node.importNames.length) {
        this.print(", ");
      }
    }
    this.print("}");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitUnqualifiedImportClause(node: ModelicaUnqualifiedImportClauseSyntaxNode, indent = 0): void {
    this.print("import ", indent);
    node.packageName?.accept(this, indent);
    this.print(".*");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitExtendsClause(node: ModelicaExtendsClauseSyntaxNode, indent = 0): void {
    this.print("extends ", indent);
    node.typeSpecifier?.accept(this, indent);
    node.classOrInheritanceModification?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitConstrainingClause(node: ModelicaConstrainingClauseSyntaxNode, indent = 0): void {
    this.print("constrainedby ");
    node.typeSpecifier?.accept(this, indent);
    node.classModification?.accept(this, indent);
    node.description?.accept(this, indent);
  }

  override visitClassOrInheritanceModification(
    node: ModelicaClassOrInheritanceModificationSyntaxNode,
    indent = 0,
  ): void {
    this.print("(");
    let i = 0;
    for (const modificationArgumentOrInheritanceModification of node.modificationArgumentOrInheritanceModifications) {
      modificationArgumentOrInheritanceModification.accept(this, indent);
      if (++i < node.modificationArgumentOrInheritanceModifications.length) {
        this.print(", ");
      }
    }
    this.print(")");
  }

  override visitInheritanceModification(node: ModelicaInheritanceModificationSyntaxNode, indent = 0): void {
    this.print("break ");
    if (node.connectEquation) {
      node.connectEquation.accept(this, indent);
    } else {
      node.identifier?.accept(this, indent);
    }
  }

  override visitComponentClause(node: ModelicaComponentClauseSyntaxNode, indent = 0): void {
    this.print("", indent);
    if (node.redeclare) this.print("redeclare ");
    if (node.final) this.print("final ");
    if (node.inner) this.print("inner ");
    if (node.outer) this.print("outer ");
    if (node.replaceable) this.print("replaceable ");
    if (node.flow) this.print(node.flow + " ");
    if (node.variability) this.print(node.variability + " ");
    if (node.causality) this.print(node.causality + " ");
    node.typeSpecifier?.accept(this, indent);
    node.arraySubscripts?.accept(this, indent);
    this.print(" ");
    let i = 0;
    for (const componentDeclaration of node.componentDeclarations) {
      componentDeclaration.accept(this, indent);
      if (++i < node.componentDeclarations.length) {
        this.print(", ");
      }
    }
    node.constrainingClause?.accept(this, indent);
    this.println(";");
  }

  override visitComponentDeclaration(node: ModelicaComponentDeclarationSyntaxNode, indent = 0): void {
    node.declaration?.accept(this, indent);
    node.conditionAttribute?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitConditionAttribute(node: ModelicaConditionAttributeSyntaxNode, indent = 0): void {
    this.print(" if ");
    node.condition?.accept(this, indent);
  }

  override visitDeclaration(node: ModelicaDeclarationSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    node.arraySubscripts?.accept(this, indent);
    node.modification?.accept(this, indent);
  }

  override visitModification(node: ModelicaModificationSyntaxNode, indent = 0): void {
    node.classModification?.accept(this, indent);
    if (node.modificationExpression) {
      this.print(" = ");
      node.modificationExpression.accept(this, indent);
    }
  }

  override visitModificationExpression(node: ModelicaModificationExpressionSyntaxNode, indent = 0): void {
    if (node.break) this.print("break");
    else node.expression?.accept(this, indent);
  }

  override visitClassModification(node: ModelicaClassModificationSyntaxNode, indent = 0): void {
    if (node.modificationArguments.length > 0) {
      this.print("(");
      let i = 0;
      for (const modificationArgument of node.modificationArguments) {
        modificationArgument.accept(this, indent);
        if (++i < node.modificationArguments.length) {
          this.print(", ");
        }
      }
      this.print(")");
    }
  }

  override visitElementModification(node: ModelicaElementModificationSyntaxNode, indent = 0): void {
    if (node.each) this.print("each ");
    if (node.final) this.print("final ");
    node.name?.accept(this, indent);
    node.modification?.accept(this, indent);
    node.description?.accept(this, indent);
  }

  override visitElementRedeclaration(node: ModelicaElementRedeclarationSyntaxNode, indent = 0): void {
    if (node.redeclare) this.print("redeclare ");
    if (node.each) this.print("each ");
    if (node.final) this.print("final ");
    if (node.replaceable) this.print("replaceable ");
    node.shortClassDefinition?.accept(this, indent);
    node.componentClause?.accept(this, indent);
  }

  override visitComponentClause1(node: ModelicaComponentClause1SyntaxNode, indent = 0): void {
    if (node.flow) this.print(node.flow);
    if (node.variability) this.print(node.variability);
    if (node.causality) this.print(node.causality);
    node.typeSpecifier?.accept(this, indent);
    node.componentDeclaration?.accept(this, indent);
    node.constrainingClause?.accept(this, indent);
  }

  override visitComponentDeclaration1(node: ModelicaComponentDeclaration1SyntaxNode, indent = 0): void {
    node.declaration?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
  }

  override visitShortClassDefinition(node: ModelicaShortClassDefinitionSyntaxNode, indent = 0): void {
    node.classPrefixes?.accept(this, indent);
    node.classSpecifier?.accept(this, indent);
    node.constrainingClause?.accept(this, indent);
  }

  override visitEquationSection(node: ModelicaEquationSectionSyntaxNode, indent = 0): void {
    if (node.equations.length > 0) {
      this.println("equation", indent);
      for (const equation of node.equations) {
        equation.accept(this, indent + 1);
      }
    }
  }

  override visitAlgorithmSection(node: ModelicaAlgorithmSectionSyntaxNode, indent = 0): void {
    if (node.statements.length > 0) {
      this.println("algorithm", indent);
      for (const statement of node.statements) {
        statement.accept(this, indent + 1);
      }
    }
  }

  override visitSimpleAssignmentStatement(node: ModelicaSimpleAssignmentStatementSyntaxNode, indent = 0): void {
    node.target?.accept(this, indent);
    this.print(" := ");
    node.source?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitProcedureCallStatement(node: ModelicaProcedureCallStatementSyntaxNode, indent = 0): void {
    node.functionCallArguments?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitComplexAssignmentStatement(node: ModelicaComplexAssignmentStatementSyntaxNode, indent = 0): void {
    node.outputExpressionList?.accept(this, indent);
    this.print(" := ");
    node.functionReference?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitSimpleEquation(node: ModelicaSimpleEquationSyntaxNode, indent = 0): void {
    node.expression1?.accept(this, indent);
    this.print(` ${node.operator} `);
    node.expression2?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitSpecialEquation(node: ModelicaSpecialEquationSyntaxNode, indent = 0): void {
    node.functionReference?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitIfEquation(node: ModelicaIfEquationSyntaxNode, indent = 0): void {
    this.print("if ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const equation of node.equations) equation.accept(this, indent);
    for (const elseIfEquationClause of node.elseIfEquationClauses) elseIfEquationClause.accept(this, indent);
    if (node.elseEquations.length > 0) {
      this.print("else ");
      for (const elseEquation of node.elseEquations) elseEquation.accept(this, indent);
    }
    this.print("end if");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitElseIfEquationClause(node: ModelicaElseIfEquationClauseSyntaxNode, indent = 0): void {
    this.print("elseif ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const equation of node.equations) equation.accept(this, indent);
  }

  override visitIfStatement(node: ModelicaIfStatementSyntaxNode, indent = 0): void {
    this.print("if ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const statement of node.statements) statement.accept(this, indent);
    for (const elseIfStatementClause of node.elseIfStatementClauses) elseIfStatementClause.accept(this, indent);
    if (node.elseStatements.length > 0) {
      this.print("else ");
      for (const elseStatement of node.elseStatements) elseStatement.accept(this, indent);
    }
    this.print("end if");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitElseIfStatementClause(node: ModelicaElseIfStatementClauseSyntaxNode, indent = 0): void {
    this.print("elseif ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const statement of node.statements) statement.accept(this, indent);
  }

  override visitForEquation(node: ModelicaForEquationSyntaxNode, indent = 0): void {
    this.print("for ");
    let i = 0;
    for (const forIndex of node.forIndexes) {
      forIndex.accept(this, indent);
      if (++i < node.forIndexes.length) this.print(", ");
    }
    this.print(" loop ");
    for (const equation of node.equations) equation.accept(this, indent);
    this.print("end for");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitForStatement(node: ModelicaForStatementSyntaxNode, indent = 0): void {
    this.print("for ");
    let i = 0;
    for (const forIndex of node.forIndexes) {
      forIndex.accept(this, indent);
      if (++i < node.forIndexes.length) this.print(", ");
    }
    this.print(" loop ");
    for (const statement of node.statements) statement.accept(this, indent);
    this.print("end for");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitForIndex(node: ModelicaForIndexSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    if (node.expression) {
      this.print(" in ");
      node.expression.accept(this, indent);
    }
  }

  override visitWhileStatement(node: ModelicaWhileStatementSyntaxNode, indent = 0): void {
    this.print("while ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const statement of node.statements) statement.accept(this, indent);
    this.print("end while");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitWhenEquation(node: ModelicaWhenEquationSyntaxNode, indent = 0): void {
    this.print("when ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const equation of node.equations) equation.accept(this, indent);
    for (const elseWhenStatementClause of node.elseWhenEquationClauses) elseWhenStatementClause.accept(this, indent);
    this.print("end when");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitElseWhenEquationClause(node: ModelicaElseWhenEquationClauseSyntaxNode, indent = 0): void {
    this.print("elsewhen ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const equation of node.equations) equation.accept(this, indent);
  }

  override visitWhenStatement(node: ModelicaWhenStatementSyntaxNode, indent = 0): void {
    this.print("when ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const statement of node.statements) statement.accept(this, indent);
    for (const elseWhenStatementClause of node.elseWhenStatementClauses) elseWhenStatementClause.accept(this, indent);
    this.print("end when");
    node.description?.accept(this, indent);
    node.annotationClause?.accept(this, indent);
    this.println(";");
  }

  override visitElseWhenStatementClause(node: ModelicaElseWhenStatementClauseSyntaxNode, indent = 0): void {
    this.print("elsewhen ");
    node.condition?.accept(this, indent);
    this.print("then ");
    for (const statement of node.statements) statement.accept(this, indent);
  }

  override visitConnectEquation(node: ModelicaConnectEquationSyntaxNode, indent = 0): void {
    this.print("connect(", indent);
    node.componentReference1?.accept(this, indent);
    node.componentReference2?.accept(this, indent);
    this.print(")");
    node.annotationClause?.accept(this, indent);
    node.description?.accept(this, indent);
    this.println(";");
  }

  override visitBreakStatement(node: ModelicaBreakStatementSyntaxNode, indent = 0): void {
    this.print("break", indent);
    node.annotationClause?.accept(this, indent);
    node.description?.accept(this, indent);
    this.println(";");
  }

  override visitReturnStatement(node: ModelicaReturnStatementSyntaxNode, indent = 0): void {
    this.print("return", indent);
    node.annotationClause?.accept(this, indent);
    node.description?.accept(this, indent);
    this.println(";");
  }

  override visitIfElseExpression(node: ModelicaIfElseExpressionSyntaxNode, indent = 0): void {
    this.print("if ");
    node.condition?.accept(this, indent);
    this.print(" then ");
    node.expression?.accept(this, indent);
    for (const elseIfExpressionClause of node.elseIfExpressionClauses) elseIfExpressionClause.accept(this, indent);
    this.print(" else ");
    node.elseExpression?.accept(this, indent);
  }

  override visitElseIfExpressionClause(node: ModelicaElseIfExpressionClauseSyntaxNode, indent = 0): void {
    this.print("elseif ");
    node.condition?.accept(this, indent);
    this.print("then ");
    node.expression?.accept(this, indent);
  }

  override visitRangeExpression(node: ModelicaRangeExpressionSyntaxNode, indent = 0): void {
    node.startExpression?.accept(this, indent);
    if (node.stepExpression) {
      this.print(":");
      node.stepExpression.accept(this, indent);
    }
    if (node.stopExpression) {
      this.print(":");
      node.stopExpression.accept(this, indent);
    }
  }

  override visitUnaryExpression(node: ModelicaUnaryExpressionSyntaxNode, indent = 0): void {
    this.print(node.operator ?? "?");
    node.operand?.accept(this, indent);
  }

  override visitBinaryExpression(node: ModelicaBinaryExpressionSyntaxNode, indent = 0): void {
    node.operand1?.accept(this, indent);
    this.print(" " + node.operator + " ");
    node.operand2?.accept(this, indent);
  }

  override visitEndExpression(node: ModelicaEndExpressionSyntaxNode, indent = 0): void {
    this.print("end");
  }

  override visitTypeSpecifier(node: ModelicaTypeSpecifierSyntaxNode, indent = 0): void {
    if (node.global) this.print(".");
    node.name?.accept(this, indent);
  }

  override visitName(node: ModelicaNameSyntaxNode, indent = 0): void {
    let i = 0;
    for (const part of node.parts) {
      part.accept(this, indent);
      if (++i < node.parts.length) this.print(".");
    }
  }

  override visitComponentReference(node: ModelicaComponentReferenceSyntaxNode, indent = 0): void {
    if (node.global) this.print(".");
    let i = 0;
    for (const part of node.parts) {
      part.accept(this, indent);
      if (++i < node.parts.length) this.print(".");
    }
  }

  override visitComponentReferencePart(node: ModelicaComponentReferencePartSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    node.arraySubscripts?.accept(this, indent);
  }

  override visitFunctionCall(node: ModelicaFunctionCallSyntaxNode, indent = 0): void {
    node.functionReference?.accept(this, indent);
    node.functionCallArguments?.accept(this, indent);
  }

  override visitFunctionCallArguments(node: ModelicaFunctionCallArgumentsSyntaxNode, indent = 0): void {
    this.print("(");
    let i = 0;
    for (const positionalArgument of node.arguments) {
      positionalArgument.accept(this, indent);
      if (++i < node.arguments.length) this.print(", ");
    }
    if (node.arguments.length > 0 && node.namedArguments.length > 0) {
      this.print(", ");
    }
    i = 0;
    for (const namedArgument of node.namedArguments) {
      namedArgument.accept(this, indent);
      if (++i < node.namedArguments.length) this.print(", ");
    }
    this.print(")");
  }

  override visitArrayConcatenation(node: ModelicaArrayConcatenationSyntaxNode, indent = 0): void {
    this.print("(");
    let i = 0;
    for (const expressionList of node.expressionLists) {
      expressionList.accept(this, indent);
      if (++i < node.expressionLists.length) this.print("; ");
    }
    this.print(")");
  }

  override visitArrayConstructor(node: ModelicaArrayConstructorSyntaxNode, indent = 0): void {
    this.print("{");
    node.expressionList?.accept(this, indent);
    this.print("}");
  }

  override visitComprehensionClause(node: ModelicaComprehensionClauseSyntaxNode, indent = 0): void {
    node.expression?.accept(this, indent);
    this.print(" for ");
    let i = 0;
    for (const forIndex of node.forIndexes) {
      forIndex.accept(this, indent);
      if (++i < node.forIndexes.length) {
        this.print(", ");
      }
    }
  }

  override visitNamedArgument(node: ModelicaNamedArgumentSyntaxNode, indent = 0): void {
    node.identifier?.accept(this, indent);
    this.print(" = ");
    node.argument?.accept(this, indent);
  }

  override visitFunctionArgument(node: ModelicaFunctionArgumentSyntaxNode, indent = 0): void {
    node.expression?.accept(this, indent);
    node.functionPartialApplication?.accept(this, indent);
  }

  override visitFunctionPartialApplication(node: ModelicaFunctionPartialApplicationSyntaxNode, indent = 0): void {
    this.print("function ");
    node.typeSpecifier?.accept(this, indent);
    this.print("(");
    let i = 0;
    for (const namedArgument of node.namedArguments) {
      namedArgument.accept(this, indent);
      if (++i < node.namedArguments.length) {
        this.print(", ");
      }
    }
    this.print(")");
  }

  override visitMemberAccessExpression(node: ModelicaMemberAccessExpressionSyntaxNode, indent = 0): void {
    node.outputExpressionList?.accept(this, indent);
    if (node.arraySubscripts) {
      node.arraySubscripts.accept(this, indent);
    } else if (node.identifier) {
      this.print(".");
      node.identifier.accept(this, indent);
    }
  }

  override visitOutputExpressionList(node: ModelicaOutputExpressionListSyntaxNode, indent = 0): void {
    this.print("(");
    let i = 0;
    for (const output of node.outputs) {
      output?.accept(this, indent);
      if (++i < node.outputs.length) {
        this.print(", ");
      }
    }
    this.print(")");
  }

  override visitExpressionList(node: ModelicaExpressionListSyntaxNode, indent = 0): void {
    let i = 0;
    for (const expression of node.expressions) {
      expression.accept(this, indent);
      if (++i < node.expressions.length) {
        this.print(", ");
      }
    }
  }

  override visitArraySubscripts(node: ModelicaArraySubscriptsSyntaxNode, indent = 0): void {
    this.print("[");
    let i = 0;
    for (const subscript of node.subscripts) {
      subscript.accept(this, indent);
      if (++i < node.subscripts.length) this.print(", ");
    }
    this.print("]");
  }

  override visitSubscript(node: ModelicaSubscriptSyntaxNode, indent = 0): void {
    if (node.flexible) this.print(":");
    else node.expression?.accept(this, indent);
  }

  override visitDescription(node: ModelicaDescriptionSyntaxNode, indent = 0): void {
    let i = 0;
    for (const string of node.strings) {
      this.print(" ");
      string.accept(this, indent);
      if (++i < node.strings.length) {
        this.print(" +");
      }
    }
  }

  override visitAnnotationClause(node: ModelicaAnnotationClauseSyntaxNode, indent = 0): void {
    this.print("annotation");
    node.classModification?.accept(this, indent);
  }

  override visitBooleanLiteral(node: ModelicaBooleanLiteralSyntaxNode, indent = 0): void {
    this.print(node.text ?? "");
  }

  override visitIdentifier(node: ModelicaIdentifierSyntaxNode, indent = 0): void {
    this.print(node.text ?? "?");
  }

  override visitStringLiteral(node: ModelicaStringLiteralSyntaxNode, indent = 0): void {
    this.print('"');
    this.print(node.text ?? "?");
    this.print('"');
  }

  override visitUnsignedIntegerLiteral(node: ModelicaUnsignedIntegerLiteralSyntaxNode, indent = 0): void {
    this.print(node.text ?? "?");
  }

  override visitUnsignedRealLiteral(node: ModelicaUnsignedRealLiteralSyntaxNode, indent = 0): void {
    this.print(node.text ?? "?");
  }
}

// --- Type Tags ---
export enum AstTag {
  UNKNOWN = 0,
  ModelicaSyntaxNode = 1,
  ModelicaStoredDefinitionSyntaxNode = 2,
  ModelicaWithinDirectiveSyntaxNode = 3,
  ModelicaElementSyntaxNode = 4,
  ModelicaClassDefinitionSyntaxNode = 5,
  ModelicaClassPrefixesSyntaxNode = 6,
  ModelicaClassSpecifierSyntaxNode = 7,
  ModelicaLongClassSpecifierSyntaxNode = 8,
  ModelicaShortClassSpecifierSyntaxNode = 9,
  ModelicaDerClassSpecifierSyntaxNode = 10,
  ModelicaEnumerationLiteralSyntaxNode = 11,
  ModelicaExternalFunctionClauseSyntaxNode = 12,
  ModelicaLanguageSpecificationSyntaxNode = 13,
  ModelicaExternalFunctionCallSyntaxNode = 14,
  ModelicaSectionSyntaxNode = 15,
  ModelicaElementSectionSyntaxNode = 16,
  ModelicaElementAnnotationSyntaxNode = 17,
  ModelicaImportClauseSyntaxNode = 18,
  ModelicaSimpleImportClauseSyntaxNode = 19,
  ModelicaCompoundImportClauseSyntaxNode = 20,
  ModelicaUnqualifiedImportClauseSyntaxNode = 21,
  ModelicaExtendsClauseSyntaxNode = 22,
  ModelicaConstrainingClauseSyntaxNode = 23,
  ModelicaClassOrInheritanceModificationSyntaxNode = 24,
  ModelicaInheritanceModificationSyntaxNode = 25,
  ModelicaComponentClauseSyntaxNode = 26,
  ModelicaComponentDeclarationSyntaxNode = 27,
  ModelicaConditionAttributeSyntaxNode = 28,
  ModelicaDeclarationSyntaxNode = 29,
  ModelicaModificationSyntaxNode = 30,
  ModelicaModificationExpressionSyntaxNode = 31,
  ModelicaClassModificationSyntaxNode = 32,
  ModelicaModificationArgumentSyntaxNode = 33,
  ModelicaElementModificationSyntaxNode = 34,
  ModelicaElementRedeclarationSyntaxNode = 35,
  ModelicaComponentClause1SyntaxNode = 36,
  ModelicaComponentDeclaration1SyntaxNode = 37,
  ModelicaShortClassDefinitionSyntaxNode = 38,
  ModelicaEquationSectionSyntaxNode = 39,
  ModelicaAlgorithmSectionSyntaxNode = 40,
  ModelicaEquationSyntaxNode = 41,
  ModelicaStatementSyntaxNode = 42,
  ModelicaSimpleAssignmentStatementSyntaxNode = 43,
  ModelicaProcedureCallStatementSyntaxNode = 44,
  ModelicaComplexAssignmentStatementSyntaxNode = 45,
  ModelicaSimpleEquationSyntaxNode = 46,
  ModelicaSpecialEquationSyntaxNode = 47,
  ModelicaIfEquationSyntaxNode = 48,
  ModelicaElseIfEquationClauseSyntaxNode = 49,
  ModelicaIfStatementSyntaxNode = 50,
  ModelicaElseIfStatementClauseSyntaxNode = 51,
  ModelicaForEquationSyntaxNode = 52,
  ModelicaForStatementSyntaxNode = 53,
  ModelicaForIndexSyntaxNode = 54,
  ModelicaWhileStatementSyntaxNode = 55,
  ModelicaWhenEquationSyntaxNode = 56,
  ModelicaElseWhenEquationClauseSyntaxNode = 57,
  ModelicaWhenStatementSyntaxNode = 58,
  ModelicaElseWhenStatementClauseSyntaxNode = 59,
  ModelicaConnectEquationSyntaxNode = 60,
  ModelicaBreakStatementSyntaxNode = 61,
  ModelicaReturnStatementSyntaxNode = 62,
  ModelicaExpressionSyntaxNode = 63,
  ModelicaIfElseExpressionSyntaxNode = 64,
  ModelicaElseIfExpressionClauseSyntaxNode = 65,
  ModelicaRangeExpressionSyntaxNode = 66,
  ModelicaSimpleExpressionSyntaxNode = 67,
  ModelicaUnaryExpressionSyntaxNode = 68,
  ModelicaBinaryExpressionSyntaxNode = 69,
  ModelicaPrimaryExpressionSyntaxNode = 70,
  ModelicaEndExpressionSyntaxNode = 71,
  ModelicaLiteralSyntaxNode = 72,
  ModelicaTypeSpecifierSyntaxNode = 73,
  ModelicaNameSyntaxNode = 74,
  ModelicaComponentReferenceSyntaxNode = 75,
  ModelicaComponentReferencePartSyntaxNode = 76,
  ModelicaFunctionCallSyntaxNode = 77,
  ModelicaFunctionCallArgumentsSyntaxNode = 78,
  ModelicaArrayConcatenationSyntaxNode = 79,
  ModelicaArrayConstructorSyntaxNode = 80,
  ModelicaComprehensionClauseSyntaxNode = 81,
  ModelicaNamedArgumentSyntaxNode = 82,
  ModelicaFunctionArgumentSyntaxNode = 83,
  ModelicaFunctionPartialApplicationSyntaxNode = 84,
  ModelicaMemberAccessExpressionSyntaxNode = 85,
  ModelicaOutputExpressionListSyntaxNode = 86,
  ModelicaExpressionListSyntaxNode = 87,
  ModelicaArraySubscriptsSyntaxNode = 88,
  ModelicaSubscriptSyntaxNode = 89,
  ModelicaDescriptionSyntaxNode = 90,
  ModelicaAnnotationClauseSyntaxNode = 91,
  ModelicaBooleanLiteralSyntaxNode = 92,
  ModelicaIdentifierSyntaxNode = 93,
  ModelicaStringLiteralSyntaxNode = 94,
  ModelicaUnsignedIntegerLiteralSyntaxNode = 95,
  ModelicaUnsignedRealLiteralSyntaxNode = 96,
}
(ModelicaSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSyntaxNode;
(ModelicaStoredDefinitionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaStoredDefinitionSyntaxNode;
(ModelicaWithinDirectiveSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaWithinDirectiveSyntaxNode;
(ModelicaElementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElementSyntaxNode;
(ModelicaClassDefinitionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaClassDefinitionSyntaxNode;
(ModelicaClassPrefixesSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaClassPrefixesSyntaxNode;
(ModelicaClassSpecifierSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaClassSpecifierSyntaxNode;
(ModelicaLongClassSpecifierSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaLongClassSpecifierSyntaxNode;
(ModelicaShortClassSpecifierSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaShortClassSpecifierSyntaxNode;
(ModelicaDerClassSpecifierSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaDerClassSpecifierSyntaxNode;
(ModelicaEnumerationLiteralSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaEnumerationLiteralSyntaxNode;
(ModelicaExternalFunctionClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaExternalFunctionClauseSyntaxNode;
(ModelicaLanguageSpecificationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaLanguageSpecificationSyntaxNode;
(ModelicaExternalFunctionCallSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaExternalFunctionCallSyntaxNode;
(ModelicaSectionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSectionSyntaxNode;
(ModelicaElementSectionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElementSectionSyntaxNode;
(ModelicaElementAnnotationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElementAnnotationSyntaxNode;
(ModelicaImportClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaImportClauseSyntaxNode;
(ModelicaSimpleImportClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSimpleImportClauseSyntaxNode;
(ModelicaCompoundImportClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaCompoundImportClauseSyntaxNode;
(ModelicaUnqualifiedImportClauseSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaUnqualifiedImportClauseSyntaxNode;
(ModelicaExtendsClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaExtendsClauseSyntaxNode;
(ModelicaConstrainingClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaConstrainingClauseSyntaxNode;
(ModelicaClassOrInheritanceModificationSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaClassOrInheritanceModificationSyntaxNode;
(ModelicaInheritanceModificationSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaInheritanceModificationSyntaxNode;
(ModelicaComponentClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComponentClauseSyntaxNode;
(ModelicaComponentDeclarationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComponentDeclarationSyntaxNode;
(ModelicaConditionAttributeSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaConditionAttributeSyntaxNode;
(ModelicaDeclarationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaDeclarationSyntaxNode;
(ModelicaModificationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaModificationSyntaxNode;
(ModelicaModificationExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaModificationExpressionSyntaxNode;
(ModelicaClassModificationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaClassModificationSyntaxNode;
(ModelicaModificationArgumentSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaModificationArgumentSyntaxNode;
(ModelicaElementModificationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElementModificationSyntaxNode;
(ModelicaElementRedeclarationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElementRedeclarationSyntaxNode;
(ModelicaComponentClause1SyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComponentClause1SyntaxNode;
(ModelicaComponentDeclaration1SyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComponentDeclaration1SyntaxNode;
(ModelicaShortClassDefinitionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaShortClassDefinitionSyntaxNode;
(ModelicaEquationSectionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaEquationSectionSyntaxNode;
(ModelicaAlgorithmSectionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaAlgorithmSectionSyntaxNode;
(ModelicaEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaEquationSyntaxNode;
(ModelicaStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaStatementSyntaxNode;
(ModelicaSimpleAssignmentStatementSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaSimpleAssignmentStatementSyntaxNode;
(ModelicaProcedureCallStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaProcedureCallStatementSyntaxNode;
(ModelicaComplexAssignmentStatementSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaComplexAssignmentStatementSyntaxNode;
(ModelicaSimpleEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSimpleEquationSyntaxNode;
(ModelicaSpecialEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSpecialEquationSyntaxNode;
(ModelicaIfEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaIfEquationSyntaxNode;
(ModelicaElseIfEquationClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElseIfEquationClauseSyntaxNode;
(ModelicaIfStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaIfStatementSyntaxNode;
(ModelicaElseIfStatementClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElseIfStatementClauseSyntaxNode;
(ModelicaForEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaForEquationSyntaxNode;
(ModelicaForStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaForStatementSyntaxNode;
(ModelicaForIndexSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaForIndexSyntaxNode;
(ModelicaWhileStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaWhileStatementSyntaxNode;
(ModelicaWhenEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaWhenEquationSyntaxNode;
(ModelicaElseWhenEquationClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElseWhenEquationClauseSyntaxNode;
(ModelicaWhenStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaWhenStatementSyntaxNode;
(ModelicaElseWhenStatementClauseSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaElseWhenStatementClauseSyntaxNode;
(ModelicaConnectEquationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaConnectEquationSyntaxNode;
(ModelicaBreakStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaBreakStatementSyntaxNode;
(ModelicaReturnStatementSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaReturnStatementSyntaxNode;
(ModelicaExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaExpressionSyntaxNode;
(ModelicaIfElseExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaIfElseExpressionSyntaxNode;
(ModelicaElseIfExpressionClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaElseIfExpressionClauseSyntaxNode;
(ModelicaRangeExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaRangeExpressionSyntaxNode;
(ModelicaSimpleExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSimpleExpressionSyntaxNode;
(ModelicaUnaryExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaUnaryExpressionSyntaxNode;
(ModelicaBinaryExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaBinaryExpressionSyntaxNode;
(ModelicaPrimaryExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaPrimaryExpressionSyntaxNode;
(ModelicaEndExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaEndExpressionSyntaxNode;
(ModelicaLiteralSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaLiteralSyntaxNode;
(ModelicaTypeSpecifierSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaTypeSpecifierSyntaxNode;
(ModelicaNameSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaNameSyntaxNode;
(ModelicaComponentReferenceSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComponentReferenceSyntaxNode;
(ModelicaComponentReferencePartSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComponentReferencePartSyntaxNode;
(ModelicaFunctionCallSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaFunctionCallSyntaxNode;
(ModelicaFunctionCallArgumentsSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaFunctionCallArgumentsSyntaxNode;
(ModelicaArrayConcatenationSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaArrayConcatenationSyntaxNode;
(ModelicaArrayConstructorSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaArrayConstructorSyntaxNode;
(ModelicaComprehensionClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaComprehensionClauseSyntaxNode;
(ModelicaNamedArgumentSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaNamedArgumentSyntaxNode;
(ModelicaFunctionArgumentSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaFunctionArgumentSyntaxNode;
(ModelicaFunctionPartialApplicationSyntaxNode.prototype as any)._typeTag =
  AstTag.ModelicaFunctionPartialApplicationSyntaxNode;
(ModelicaMemberAccessExpressionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaMemberAccessExpressionSyntaxNode;
(ModelicaOutputExpressionListSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaOutputExpressionListSyntaxNode;
(ModelicaExpressionListSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaExpressionListSyntaxNode;
(ModelicaArraySubscriptsSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaArraySubscriptsSyntaxNode;
(ModelicaSubscriptSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaSubscriptSyntaxNode;
(ModelicaDescriptionSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaDescriptionSyntaxNode;
(ModelicaAnnotationClauseSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaAnnotationClauseSyntaxNode;
(ModelicaBooleanLiteralSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaBooleanLiteralSyntaxNode;
(ModelicaIdentifierSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaIdentifierSyntaxNode;
(ModelicaStringLiteralSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaStringLiteralSyntaxNode;
(ModelicaUnsignedIntegerLiteralSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaUnsignedIntegerLiteralSyntaxNode;
(ModelicaUnsignedRealLiteralSyntaxNode.prototype as any)._typeTag = AstTag.ModelicaUnsignedRealLiteralSyntaxNode;
