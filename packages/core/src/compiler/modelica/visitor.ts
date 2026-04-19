// SPDX-License-Identifier: AGPL-3.0-or-later
/* eslint-disable @typescript-eslint/no-unused-vars */

/**
 * Standalone visitor interface and base class for the Modelica model tree.
 *
 * Extracted from model.ts so that the polyglot flattener (and other consumers)
 * can implement the visitor pattern without depending on the full legacy model
 * class hierarchy.
 *
 * The visitor methods accept "any" types to avoid circular dependencies between
 * the visitor definition and the concrete node classes. Consumers that need
 * type-safe access should narrow the types at the call site.
 */

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type AnyNode = any;

/**
 * The Modelica model visitor interface.
 *
 * Each method receives a specific model node and an optional argument.
 * Implementations override the methods they care about.
 */
export interface IModelicaModelVisitor<R, A> {
  visitArrayClassInstance(node: AnyNode, argument?: A): R;
  visitBooleanClassInstance(node: AnyNode, argument?: A): R;
  visitClockClassInstance(node: AnyNode, argument?: A): R;
  visitClassInstance(node: AnyNode, argument?: A): R;
  visitComponentInstance(node: AnyNode, argument?: A): R;
  visitEntity(node: AnyNode, argument?: A): R;
  visitExtendsClassInstance(node: AnyNode, argument?: A): R;
  visitIntegerClassInstance(node: AnyNode, argument?: A): R;
  visitLibrary(node: AnyNode, argument?: A): R;
  visitRealClassInstance(node: AnyNode, argument?: A): R;
  visitStringClassInstance(node: AnyNode, argument?: A): R;
  visitExpressionClassInstance(node: AnyNode, argument?: A): R;
}

/**
 * Abstract base class providing default visitor implementations.
 *
 * The default behavior for most methods is to iterate over the node's
 * `elements` and recursively visit each child. Predefined type visitors
 * (Boolean, Integer, Real, String, Clock, Expression) are no-ops by default.
 */
export abstract class ModelicaModelVisitor<A> implements IModelicaModelVisitor<void, A> {
  visitArrayClassInstance(node: AnyNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitBooleanClassInstance(_node: AnyNode, _argument?: A): void {
    /* no-op */
  }

  visitClockClassInstance(_node: AnyNode, _argument?: A): void {
    /* no-op */
  }

  visitClassInstance(node: AnyNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitComponentInstance(node: AnyNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitEntity(node: AnyNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitExtendsClassInstance(node: AnyNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitIntegerClassInstance(_node: AnyNode, _argument?: A): void {
    /* no-op */
  }

  visitLibrary(node: AnyNode, argument?: A): void {
    for (const element of node.elements) element.accept(this, argument);
  }

  visitRealClassInstance(_node: AnyNode, _argument?: A): void {
    /* no-op */
  }

  visitStringClassInstance(_node: AnyNode, _argument?: A): void {
    /* no-op */
  }

  visitExpressionClassInstance(_node: AnyNode, _argument?: A): void {
    /* no-op */
  }
}
