// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SysML v2 / KerML In-Memory AST Node Definitions for Programmatic Model Construction.
 */

export type SysMLNodeKind =
  | "package"
  | "part_def"
  | "port_def"
  | "item_def"
  | "requirement_def"
  | "constraint_def"
  | "action_def"
  | "state_def"
  | "calc_def"
  | "part_usage"
  | "port_usage"
  | "item_usage"
  | "attribute_usage"
  | "connection"
  | "requirement_usage"
  | "constraint_usage"
  | "import"
  | "doc";

export interface SysMLBaseNode {
  kind: SysMLNodeKind;
  id?: string | undefined;
  doc?: string[] | undefined;
}

export interface ImportNode extends SysMLBaseNode {
  kind: "import";
  path: string;
  isAll?: boolean | undefined;
  isPrivate?: boolean | undefined;
}

export interface DocNode extends SysMLBaseNode {
  kind: "doc";
  text: string;
}

export interface AttributeUsageNode extends SysMLBaseNode {
  kind: "attribute_usage";
  name: string;
  type?: string | undefined;
  value?: string | number | boolean | undefined;
  unit?: string | undefined;
  isParameter?: boolean | undefined;
  isConstant?: boolean | undefined;
}

export interface PortUsageNode extends SysMLBaseNode {
  kind: "port_usage";
  name: string;
  type?: string | undefined;
  direction?: "in" | "out" | "inout" | undefined;
  isConjugated?: boolean | undefined;
}

export interface ConnectionNode extends SysMLBaseNode {
  kind: "connection";
  name?: string | undefined;
  fromPort: string;
  toPort: string;
}

export interface ConstraintUsageNode extends SysMLBaseNode {
  kind: "constraint_usage";
  name?: string | undefined;
  expr: string;
}

export interface RequirementUsageNode extends SysMLBaseNode {
  kind: "requirement_usage";
  name: string;
  type?: string | undefined;
  text?: string | undefined;
  assume?: string[] | undefined;
  guarantee?: string[] | undefined;
}

export type SysMLMemberNode =
  | PartUsageNode
  | PortUsageNode
  | ItemUsageNode
  | AttributeUsageNode
  | ConnectionNode
  | RequirementUsageNode
  | ConstraintUsageNode
  | DocNode
  | ImportNode
  | PartDefNode
  | PortDefNode
  | ItemDefNode
  | RequirementDefNode
  | ConstraintDefNode
  | ActionDefNode
  | StateDefNode
  | CalcDefNode;

export interface PartUsageNode extends SysMLBaseNode {
  kind: "part_usage";
  name: string;
  type?: string | undefined;
  multiplicity?: string | undefined;
  members: SysMLMemberNode[];
}

export interface ItemUsageNode extends SysMLBaseNode {
  kind: "item_usage";
  name: string;
  type?: string | undefined;
  members: SysMLMemberNode[];
}

export interface DefinitionNodeBase extends SysMLBaseNode {
  name: string;
  isAbstract?: boolean | undefined;
  superTypes?: string[] | undefined;
  members: SysMLMemberNode[];
}

export interface PartDefNode extends DefinitionNodeBase {
  kind: "part_def";
}

export interface PortDefNode extends DefinitionNodeBase {
  kind: "port_def";
}

export interface ItemDefNode extends DefinitionNodeBase {
  kind: "item_def";
}

export interface RequirementDefNode extends DefinitionNodeBase {
  kind: "requirement_def";
  text?: string | undefined;
  assume?: string[] | undefined;
  guarantee?: string[] | undefined;
}

export interface ConstraintDefNode extends DefinitionNodeBase {
  kind: "constraint_def";
  expr?: string | undefined;
}

export interface ActionDefNode extends DefinitionNodeBase {
  kind: "action_def";
}

export interface StateDefNode extends DefinitionNodeBase {
  kind: "state_def";
}

export interface CalcDefNode extends DefinitionNodeBase {
  kind: "calc_def";
  returnType?: string | undefined;
  calcExpr?: string | undefined;
}

export type SysMLDefinitionNode =
  | PartDefNode
  | PortDefNode
  | ItemDefNode
  | RequirementDefNode
  | ConstraintDefNode
  | ActionDefNode
  | StateDefNode
  | CalcDefNode;

export interface PackageNode extends SysMLBaseNode {
  kind: "package";
  name: string;
  imports: ImportNode[];
  members: (SysMLDefinitionNode | PackageNode | DocNode)[];
}

export type SysMLRootNode = PackageNode | SysMLDefinitionNode;
