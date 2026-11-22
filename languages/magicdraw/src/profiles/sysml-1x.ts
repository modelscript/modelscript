// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room OMG SysML 1.6 Profile & MD_Customization_for_SysML Compartment Semantics.
 *
 * Implements stereotype inheritance, classifier kind resolution, and UML Property
 * compartment classification (parts, references, values, constraints, flowProperties)
 * directly from the public OMG SysML 1.6 specification.
 */

import type {
  StereotypeApplication,
  SysmlPropertyCompartment,
  UmlClassifierKind,
  UmlRelationshipKind,
} from "../types.js";
import type { StandardStereotypeSpec } from "./uml-standard.js";

export const OMG_SYSML_1X_STEREOTYPES: readonly StandardStereotypeSpec[] = [
  // Blocks & Structure
  { name: "Block", profile: "SysML", metaclass: "Class" },
  { name: "InterfaceBlock", profile: "SysML", superStereotype: "Block", metaclass: "Class" },
  { name: "ConstraintBlock", profile: "SysML", superStereotype: "Block", metaclass: "Class" },
  { name: "ValueType", profile: "SysML", metaclass: "DataType" },
  { name: "ProxyPort", profile: "SysML", metaclass: "Port" },
  { name: "FullPort", profile: "SysML", metaclass: "Port" },
  { name: "FlowPort", profile: "SysML", metaclass: "Port" },
  { name: "FlowProperty", profile: "SysML", metaclass: "Property", compartmentHint: "flowProperties" },
  { name: "FlowSpecification", profile: "SysML", metaclass: "Interface" },
  { name: "ItemFlow", profile: "SysML", metaclass: "InformationFlow" },
  { name: "BindingConnector", profile: "SysML", metaclass: "Connector" },
  { name: "NestedConnectorEnd", profile: "SysML", metaclass: "ConnectorEnd" },
  { name: "ParticipantProperty", profile: "SysML", metaclass: "Property" },
  { name: "DirectedFeature", profile: "SysML", metaclass: "Feature" },

  // Requirements & Traceability
  { name: "AbstractRequirement", profile: "SysML", metaclass: "NamedElement" },
  { name: "Requirement", profile: "SysML", superStereotype: "AbstractRequirement", metaclass: "Class" },
  { name: "ExtendedRequirement", profile: "SysML", superStereotype: "Requirement", metaclass: "Class" },
  { name: "FunctionalRequirement", profile: "SysML", superStereotype: "ExtendedRequirement", metaclass: "Class" },
  { name: "InterfaceRequirement", profile: "SysML", superStereotype: "ExtendedRequirement", metaclass: "Class" },
  { name: "PerformanceRequirement", profile: "SysML", superStereotype: "ExtendedRequirement", metaclass: "Class" },
  { name: "PhysicalRequirement", profile: "SysML", superStereotype: "ExtendedRequirement", metaclass: "Class" },
  { name: "DesignConstraint", profile: "SysML", superStereotype: "ExtendedRequirement", metaclass: "Class" },
  { name: "BusinessRequirement", profile: "SysML", superStereotype: "Requirement", metaclass: "Class" },
  { name: "UsabilityRequirement", profile: "SysML", superStereotype: "Requirement", metaclass: "Class" },
  { name: "Satisfy", profile: "SysML", superStereotype: "Trace", metaclass: "Abstraction" },
  { name: "Verify", profile: "SysML", superStereotype: "Trace", metaclass: "Abstraction" },
  { name: "DeriveReqt", profile: "SysML", superStereotype: "Trace", metaclass: "Abstraction" },
  { name: "Copy", profile: "SysML", superStereotype: "Trace", metaclass: "Abstraction" },
  { name: "TestCase", profile: "SysML", metaclass: "Behavior" },

  // Allocation
  { name: "Allocate", profile: "SysML", metaclass: "Abstraction" },
  { name: "Allocated", profile: "SysML", metaclass: "NamedElement" },
  { name: "AllocateActivityPartition", profile: "SysML", metaclass: "ActivityPartition" },

  // MD_Customization_for_SysML clean-room property classification equivalents
  { name: "PartProperty", profile: "MD_Customization", metaclass: "Property", compartmentHint: "parts" },
  { name: "ReferenceProperty", profile: "MD_Customization", metaclass: "Property", compartmentHint: "references" },
  { name: "ValueProperty", profile: "MD_Customization", metaclass: "Property", compartmentHint: "values" },
  { name: "ConstraintProperty", profile: "MD_Customization", metaclass: "Property", compartmentHint: "constraints" },
  { name: "ConstraintParameter", profile: "MD_Customization", metaclass: "Property", compartmentHint: "constraints" },
  { name: "SharedProperty", profile: "MD_Customization", metaclass: "Property", compartmentHint: "references" },
];

const STEREOTYPE_BY_LOWER = new Map<string, StandardStereotypeSpec>();
for (const spec of OMG_SYSML_1X_STEREOTYPES) {
  STEREOTYPE_BY_LOWER.set(spec.name.toLowerCase(), spec);
}

/**
 * Checks whether a stereotype name is or inherits from `ancestorName` in SysML 1.6.
 */
export function isStereotypeKindOf(stereotypeName: string, ancestorName: string): boolean {
  const target = ancestorName.toLowerCase();
  let current: string | undefined = stereotypeName.toLowerCase();
  const visited = new Set<string>();
  while (current && !visited.has(current)) {
    if (current === target) return true;
    visited.add(current);
    const spec = STEREOTYPE_BY_LOWER.get(current);
    current = spec?.superStereotype?.toLowerCase();
  }
  return false;
}

/**
 * Determines the canonical SysML/UML classifier kind from its UML type and applied stereotypes.
 */
export function classifyClassifierKind(
  umlType: string,
  stereotypes: readonly StereotypeApplication[],
): UmlClassifierKind {
  for (const s of stereotypes) {
    if (isStereotypeKindOf(s.name, "Requirement")) return "Requirement";
    if (isStereotypeKindOf(s.name, "ConstraintBlock")) return "ConstraintBlock";
    if (isStereotypeKindOf(s.name, "InterfaceBlock")) return "InterfaceBlock";
    if (isStereotypeKindOf(s.name, "ValueType")) return "ValueType";
    if (isStereotypeKindOf(s.name, "Block")) return "Block";
  }
  const normalized = umlType.replace(/^uml:/i, "");
  switch (normalized) {
    case "Interface":
      return "Interface";
    case "DataType":
    case "PrimitiveType":
      return "DataType";
    case "Enumeration":
      return "Enumeration";
    case "Signal":
      return "Signal";
    default:
      return "Class";
  }
}

/**
 * Classifies a UML Property into its OMG SysML 1.6 / BDD compartment.
 */
export function classifyPropertyCompartment(params: {
  aggregation: "none" | "shared" | "composite";
  stereotypes: readonly StereotypeApplication[];
  targetClassifierKind?: UmlClassifierKind | undefined;
  isPrimitiveType?: boolean | undefined;
}): SysmlPropertyCompartment {
  for (const s of params.stereotypes) {
    const spec = STEREOTYPE_BY_LOWER.get(s.name.toLowerCase());
    if (spec?.compartmentHint) {
      return spec.compartmentHint as SysmlPropertyCompartment;
    }
  }

  if (params.targetClassifierKind === "ConstraintBlock") return "constraints";
  if (
    params.isPrimitiveType ||
    params.targetClassifierKind === "ValueType" ||
    params.targetClassifierKind === "DataType" ||
    params.targetClassifierKind === "Enumeration"
  ) {
    return "values";
  }
  if (params.targetClassifierKind === "Block" || params.targetClassifierKind === "Class") {
    return params.aggregation === "composite" ? "parts" : "references";
  }
  if (params.aggregation === "composite") return "parts";
  return "attributes";
}

/**
 * Maps a SysML/UML relationship stereotype name to a canonical `UmlRelationshipKind`.
 */
export function classifyRelationshipStereotype(
  stereotypes: readonly StereotypeApplication[],
): UmlRelationshipKind | undefined {
  for (const s of stereotypes) {
    const lower = s.name.toLowerCase();
    if (lower === "satisfy") return "satisfy";
    if (lower === "verify") return "verify";
    if (lower === "derivereqt") return "deriveReqt";
    if (lower === "refine") return "refine";
    if (lower === "trace") return "trace";
    if (lower === "copy") return "copy";
    if (lower === "allocate") return "allocate";
  }
  return undefined;
}
