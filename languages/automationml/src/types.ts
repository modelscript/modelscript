// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/automationml — Domain types for IEC 62714 AutomationML (CAEX 2.15 / 3.0).
 *
 * Covers the complete CAEX metamodel:
 * - InstanceHierarchy & InternalElement trees
 * - Product-Process-Resource (PPR) connector roles
 * - 6-DOF kinematic Frame attributes (x, y, z, rx, ry, rz)
 * - ExternalInterface ports (Signal, PLCopenXML, COLLADA, FMU, Order, Energy)
 * - InternalLink topological connections (RefPartnerSideA / RefPartnerSideB)
 * - SystemUnitClassLib, RoleClassLib, InterfaceClassLib, AttributeTypeLib
 */

export interface AmlSourceRange {
  startOffset: number;
  endOffset: number;
  startLine: number;
  startColumn: number;
  endLine: number;
  endColumn: number;
}

export type AmlDiagnosticSeverity = "error" | "warning" | "info";

export interface AmlDiagnostic {
  code: string;
  rule: string;
  severity: AmlDiagnosticSeverity;
  message: string;
  range: AmlSourceRange;
}

export type AmlSchemaVersion = "2.15" | "3.0";

export type AmlPprCategory = "Product" | "Process" | "Resource" | "Structure";

export type AmlPortDirection = "In" | "Out" | "InOut";

export type AmlInterfaceCategory = "Signal" | "PLCopenXML" | "COLLADA" | "FMU" | "Order" | "Energy";

export interface AmlFrame {
  x: number;
  y: number;
  z: number;
  rx: number;
  ry: number;
  rz: number;
  range?: AmlSourceRange | undefined;
}

export interface AmlAttribute {
  name: string;
  dataType?: string | undefined;
  unit?: string | undefined;
  value?: string | number | boolean | undefined;
  defaultValue?: string | number | boolean | undefined;
  description?: string | undefined;
  subAttributes?: AmlAttribute[] | undefined;
  range: AmlSourceRange;
}

export interface AmlExternalInterface {
  id: string;
  name: string;
  refBaseClassPath: string;
  direction: AmlPortDirection;
  dataType?: string | undefined;
  refUri?: string | undefined;
  category: AmlInterfaceCategory;
  attributes?: AmlAttribute[] | undefined;
  range: AmlSourceRange;
}

export interface AmlInternalLink {
  name: string;
  refPartnerSideA: string;
  refPartnerSideB: string;
  range: AmlSourceRange;
}

export interface AmlRoleRequirement {
  refBaseRoleClassPath: string;
  requiredInterfaces: string[];
  requiredAttributes: string[];
  range: AmlSourceRange;
}

export interface AmlInternalElement {
  id: string;
  name: string;
  refBaseSystemUnitPath?: string | undefined;
  roleRequirements: AmlRoleRequirement[];
  pprCategory?: AmlPprCategory | undefined;
  frame?: AmlFrame | undefined;
  attributes: AmlAttribute[];
  interfaces: AmlExternalInterface[];
  internalLinks: AmlInternalLink[];
  children: AmlInternalElement[];
  range: AmlSourceRange;
}

export interface AmlInstanceHierarchy {
  name: string;
  version?: string | undefined;
  elements: AmlInternalElement[];
  range: AmlSourceRange;
}

export interface AmlSystemUnitClass {
  id?: string | undefined;
  name: string;
  refBaseClassPath?: string | undefined;
  supportedRoleClassPaths: string[];
  attributes: AmlAttribute[];
  interfaces: AmlExternalInterface[];
  internalElements: AmlInternalElement[];
  internalLinks: AmlInternalLink[];
  children: AmlSystemUnitClass[];
  range: AmlSourceRange;
}

export interface AmlSystemUnitClassLib {
  name: string;
  version?: string | undefined;
  classes: AmlSystemUnitClass[];
  range: AmlSourceRange;
}

export interface AmlRoleClass {
  name: string;
  refBaseClassPath?: string | undefined;
  pprCategory?: AmlPprCategory | undefined;
  attributes: AmlAttribute[];
  interfaces: AmlExternalInterface[];
  children: AmlRoleClass[];
  range: AmlSourceRange;
}

export interface AmlRoleClassLib {
  name: string;
  version?: string | undefined;
  classes: AmlRoleClass[];
  range: AmlSourceRange;
}

export interface AmlInterfaceClass {
  name: string;
  refBaseClassPath?: string | undefined;
  category?: AmlInterfaceCategory | undefined;
  direction?: AmlPortDirection | undefined;
  attributes: AmlAttribute[];
  children: AmlInterfaceClass[];
  range: AmlSourceRange;
}

export interface AmlInterfaceClassLib {
  name: string;
  version?: string | undefined;
  classes: AmlInterfaceClass[];
  range: AmlSourceRange;
}

export interface AmlAttributeType {
  name: string;
  dataType?: string | undefined;
  unit?: string | undefined;
  defaultValue?: string | number | boolean | undefined;
  refBaseClassPath?: string | undefined;
  children: AmlAttributeType[];
  range: AmlSourceRange;
}

export interface AmlAttributeTypeLib {
  name: string;
  version?: string | undefined;
  types: AmlAttributeType[];
  range: AmlSourceRange;
}

export interface AmlDocument {
  fileName: string;
  schemaVersion: AmlSchemaVersion;
  instanceHierarchies: AmlInstanceHierarchy[];
  systemUnitClassLibs: AmlSystemUnitClassLib[];
  roleClassLibs: AmlRoleClassLib[];
  interfaceClassLibs: AmlInterfaceClassLib[];
  attributeTypeLibs: AmlAttributeTypeLib[];
  range?: AmlSourceRange | undefined;
}
