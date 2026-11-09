// SPDX-License-Identifier: AGPL-3.0-or-later

import type { SysmlxDocument } from "../sysmlx-interchange.js";
import type {
  ActionDefNode,
  AttributeUsageNode,
  CalcDefNode,
  ConnectionNode,
  ConstraintDefNode,
  ConstraintUsageNode,
  DocNode,
  ImportNode,
  ItemDefNode,
  ItemUsageNode,
  PackageNode,
  PartDefNode,
  PartUsageNode,
  PortDefNode,
  PortUsageNode,
  RequirementDefNode,
  RequirementUsageNode,
  StateDefNode,
  SysMLMemberNode,
} from "./nodes.js";
import { SysMLPrinter, type SysMLPrintOptions } from "./printer.js";

// ===========================================================================
// Common Member Building Trait
// ===========================================================================

export abstract class ContainerBuilder<TNode> {
  protected members: SysMLMemberNode[] = [];
  protected docstrings: string[] = [];

  public doc(text: string): this {
    this.docstrings.push(text);
    return this;
  }

  public addAttribute(
    name: string,
    type?: string,
    value?: string | number | boolean,
    unit?: string,
    options?: { isParameter?: boolean; isConstant?: boolean },
  ): this {
    const attr: AttributeUsageNode = {
      kind: "attribute_usage",
      name,
      type,
      value,
      unit,
      isParameter: options?.isParameter ?? false,
      isConstant: options?.isConstant ?? false,
    };
    this.members.push(attr);
    return this;
  }

  public addPort(
    name: string,
    type?: string,
    options?: { direction?: "in" | "out" | "inout"; isConjugated?: boolean },
  ): this {
    const port: PortUsageNode = {
      kind: "port_usage",
      name,
      type,
      direction: options?.direction,
      isConjugated: options?.isConjugated ?? false,
    };
    this.members.push(port);
    return this;
  }

  public addPart(name: string, type?: string, configure?: (b: PartUsageBuilder) => void): this {
    const builder = new PartUsageBuilder(name, type);
    if (configure) {
      configure(builder);
    }
    this.members.push(builder.build());
    return this;
  }

  public addItem(name: string, type?: string, configure?: (b: ItemUsageBuilder) => void): this {
    const builder = new ItemUsageBuilder(name, type);
    if (configure) {
      configure(builder);
    }
    this.members.push(builder.build());
    return this;
  }

  public addConnection(fromPort: string, toPort: string, name?: string): this {
    const conn: ConnectionNode = {
      kind: "connection",
      name,
      fromPort,
      toPort,
    };
    this.members.push(conn);
    return this;
  }

  public addConstraint(expr: string, name?: string): this {
    const c: ConstraintUsageNode = {
      kind: "constraint_usage",
      name,
      expr,
    };
    this.members.push(c);
    return this;
  }

  public addRequirement(
    name: string,
    typeOrText?: string,
    options?: { assume?: string[]; guarantee?: string[] },
  ): this {
    const isType = typeOrText && /^[A-Z][a-zA-Z0-9_]*$/.test(typeOrText);
    const req: RequirementUsageNode = {
      kind: "requirement_usage",
      name,
      type: isType ? typeOrText : undefined,
      text: !isType ? typeOrText : undefined,
      assume: options?.assume,
      guarantee: options?.guarantee,
    };
    this.members.push(req);
    return this;
  }

  public abstract build(): TNode;
}

// ===========================================================================
// Usage Builders
// ===========================================================================

export class PartUsageBuilder extends ContainerBuilder<PartUsageNode> {
  private mult?: string | undefined;

  constructor(
    private name: string,
    private type?: string,
  ) {
    super();
  }

  public multiplicity(m: string): this {
    this.mult = m;
    return this;
  }

  public build(): PartUsageNode {
    return {
      kind: "part_usage",
      name: this.name,
      type: this.type,
      multiplicity: this.mult,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class ItemUsageBuilder extends ContainerBuilder<ItemUsageNode> {
  constructor(
    private name: string,
    private type?: string,
  ) {
    super();
  }

  public build(): ItemUsageNode {
    return {
      kind: "item_usage",
      name: this.name,
      type: this.type,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

// ===========================================================================
// Definition Builders
// ===========================================================================

export class PartDefBuilder extends ContainerBuilder<PartDefNode> {
  private isAbstractFlag = false;
  private superTypesList: string[] = [];

  constructor(private name: string) {
    super();
  }

  public abstract(): this {
    this.isAbstractFlag = true;
    return this;
  }

  public inherits(superType: string | string[]): this {
    if (Array.isArray(superType)) {
      this.superTypesList.push(...superType);
    } else {
      this.superTypesList.push(superType);
    }
    return this;
  }

  public build(): PartDefNode {
    return {
      kind: "part_def",
      name: this.name,
      isAbstract: this.isAbstractFlag,
      superTypes: this.superTypesList.length > 0 ? this.superTypesList : undefined,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }

  public toSource(options?: SysMLPrintOptions): string {
    return SysMLPrinter.print(this.build(), options);
  }

  public toSysmlx(): SysmlxDocument {
    return SysMLPrinter.toSysmlx(this.build());
  }
}

export class PortDefBuilder extends ContainerBuilder<PortDefNode> {
  private superTypesList: string[] = [];

  constructor(private name: string) {
    super();
  }

  public inherits(superType: string | string[]): this {
    if (Array.isArray(superType)) {
      this.superTypesList.push(...superType);
    } else {
      this.superTypesList.push(superType);
    }
    return this;
  }

  public build(): PortDefNode {
    return {
      kind: "port_def",
      name: this.name,
      superTypes: this.superTypesList.length > 0 ? this.superTypesList : undefined,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class ItemDefBuilder extends ContainerBuilder<ItemDefNode> {
  private superTypesList: string[] = [];

  constructor(private name: string) {
    super();
  }

  public inherits(superType: string | string[]): this {
    if (Array.isArray(superType)) {
      this.superTypesList.push(...superType);
    } else {
      this.superTypesList.push(superType);
    }
    return this;
  }

  public build(): ItemDefNode {
    return {
      kind: "item_def",
      name: this.name,
      superTypes: this.superTypesList.length > 0 ? this.superTypesList : undefined,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class RequirementDefBuilder extends ContainerBuilder<RequirementDefNode> {
  private superTypesList: string[] = [];
  private textContent?: string | undefined;
  private assumes: string[] = [];
  private guarantees: string[] = [];

  constructor(private name: string) {
    super();
  }

  public text(doc: string): this {
    this.textContent = doc;
    return this;
  }

  public assume(expr: string): this {
    this.assumes.push(expr);
    return this;
  }

  public guarantee(expr: string): this {
    this.guarantees.push(expr);
    return this;
  }

  public inherits(superType: string | string[]): this {
    if (Array.isArray(superType)) {
      this.superTypesList.push(...superType);
    } else {
      this.superTypesList.push(superType);
    }
    return this;
  }

  public build(): RequirementDefNode {
    return {
      kind: "requirement_def",
      name: this.name,
      text: this.textContent,
      assume: this.assumes.length > 0 ? this.assumes : undefined,
      guarantee: this.guarantees.length > 0 ? this.guarantees : undefined,
      superTypes: this.superTypesList.length > 0 ? this.superTypesList : undefined,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class ConstraintDefBuilder extends ContainerBuilder<ConstraintDefNode> {
  private exprStr?: string | undefined;

  constructor(private name: string) {
    super();
  }

  public expression(expr: string): this {
    this.exprStr = expr;
    return this;
  }

  public build(): ConstraintDefNode {
    return {
      kind: "constraint_def",
      name: this.name,
      expr: this.exprStr,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class ActionDefBuilder extends ContainerBuilder<ActionDefNode> {
  constructor(private name: string) {
    super();
  }

  public build(): ActionDefNode {
    return {
      kind: "action_def",
      name: this.name,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class StateDefBuilder extends ContainerBuilder<StateDefNode> {
  constructor(private name: string) {
    super();
  }

  public build(): StateDefNode {
    return {
      kind: "state_def",
      name: this.name,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

export class CalcDefBuilder extends ContainerBuilder<CalcDefNode> {
  private retType?: string | undefined;
  private calculationExpr?: string | undefined;

  constructor(private name: string) {
    super();
  }

  public returns(type: string): this {
    this.retType = type;
    return this;
  }

  public expression(expr: string): this {
    this.calculationExpr = expr;
    return this;
  }

  public build(): CalcDefNode {
    return {
      kind: "calc_def",
      name: this.name,
      returnType: this.retType,
      calcExpr: this.calculationExpr,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      members: this.members,
    };
  }
}

// ===========================================================================
// Package Builder (Top-Level)
// ===========================================================================

export class PackageBuilder {
  private imports: ImportNode[] = [];
  private definitions: (
    | PartDefNode
    | PortDefNode
    | ItemDefNode
    | RequirementDefNode
    | ConstraintDefNode
    | ActionDefNode
    | StateDefNode
    | CalcDefNode
    | PackageNode
    | DocNode
  )[] = [];
  private docstrings: string[] = [];

  constructor(private name: string) {}

  public doc(text: string): this {
    this.docstrings.push(text);
    return this;
  }

  public addImport(path: string, options?: { isAll?: boolean; isPrivate?: boolean }): this {
    this.imports.push({
      kind: "import",
      path,
      isAll: options?.isAll ?? true,
      isPrivate: options?.isPrivate ?? true,
    });
    return this;
  }

  public addPartDef(name: string, configure?: (b: PartDefBuilder) => void): this {
    const b = new PartDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addPortDef(name: string, configure?: (b: PortDefBuilder) => void): this {
    const b = new PortDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addItemDef(name: string, configure?: (b: ItemDefBuilder) => void): this {
    const b = new ItemDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addRequirementDef(name: string, configure?: (b: RequirementDefBuilder) => void): this {
    const b = new RequirementDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addConstraintDef(name: string, configure?: (b: ConstraintDefBuilder) => void): this {
    const b = new ConstraintDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addActionDef(name: string, configure?: (b: ActionDefBuilder) => void): this {
    const b = new ActionDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addStateDef(name: string, configure?: (b: StateDefBuilder) => void): this {
    const b = new StateDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addCalcDef(name: string, configure?: (b: CalcDefBuilder) => void): this {
    const b = new CalcDefBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public addPackage(name: string, configure?: (b: PackageBuilder) => void): this {
    const b = new PackageBuilder(name);
    if (configure) configure(b);
    this.definitions.push(b.build());
    return this;
  }

  public build(): PackageNode {
    return {
      kind: "package",
      name: this.name,
      doc: this.docstrings.length > 0 ? this.docstrings : undefined,
      imports: this.imports,
      members: this.definitions,
    };
  }

  public toSource(options?: SysMLPrintOptions): string {
    return SysMLPrinter.print(this.build(), options);
  }

  public toSysmlx(): SysmlxDocument {
    return SysMLPrinter.toSysmlx(this.build());
  }
}

// ===========================================================================
// Entrypoint Factory
// ===========================================================================

export class SysMLBuilder {
  public static package(name: string): PackageBuilder {
    return new PackageBuilder(name);
  }

  public static partDef(name: string): PartDefBuilder {
    return new PartDefBuilder(name);
  }

  public static portDef(name: string): PortDefBuilder {
    return new PortDefBuilder(name);
  }

  public static itemDef(name: string): ItemDefBuilder {
    return new ItemDefBuilder(name);
  }

  public static requirementDef(name: string): RequirementDefBuilder {
    return new RequirementDefBuilder(name);
  }

  public static constraintDef(name: string): ConstraintDefBuilder {
    return new ConstraintDefBuilder(name);
  }

  public static actionDef(name: string): ActionDefBuilder {
    return new ActionDefBuilder(name);
  }

  public static stateDef(name: string): StateDefBuilder {
    return new StateDefBuilder(name);
  }

  public static calcDef(name: string): CalcDefBuilder {
    return new CalcDefBuilder(name);
  }
}
