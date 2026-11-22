// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Clean-room OMG UML 2.5 Standard Profile & Primitive Types.
 *
 * Encodes public OMG UML 2.5 specification primitives and standard stereotypes
 * without bundling any proprietary vendor profile binaries.
 */

export interface PrimitiveTypeSpec {
  name: string;
  sysml2Type: string;
  modelicaType: string;
  isNumeric: boolean;
}

export const OMG_UML_PRIMITIVES: Readonly<Record<string, PrimitiveTypeSpec>> = {
  Real: { name: "Real", sysml2Type: "ScalarValues::Real", modelicaType: "Real", isNumeric: true },
  Integer: { name: "Integer", sysml2Type: "ScalarValues::Integer", modelicaType: "Integer", isNumeric: true },
  Boolean: { name: "Boolean", sysml2Type: "ScalarValues::Boolean", modelicaType: "Boolean", isNumeric: false },
  String: { name: "String", sysml2Type: "ScalarValues::String", modelicaType: "String", isNumeric: false },
  UnlimitedNatural: {
    name: "UnlimitedNatural",
    sysml2Type: "ScalarValues::Natural",
    modelicaType: "Integer",
    isNumeric: true,
  },
  Complex: { name: "Complex", sysml2Type: "ScalarValues::Complex", modelicaType: "Complex", isNumeric: true },
  Number: { name: "Number", sysml2Type: "ScalarValues::Number", modelicaType: "Real", isNumeric: true },
};

export interface StandardStereotypeSpec {
  name: string;
  profile: "UML" | "SysML" | "MD_Customization";
  superStereotype?: string | undefined;
  metaclass: string;
  compartmentHint?: string | undefined;
}

export const OMG_UML_STANDARD_STEREOTYPES: readonly StandardStereotypeSpec[] = [
  { name: "Auxiliary", profile: "UML", metaclass: "Class" },
  { name: "Focus", profile: "UML", metaclass: "Class" },
  { name: "Metaclass", profile: "UML", metaclass: "Class" },
  { name: "Refine", profile: "UML", metaclass: "Abstraction" },
  { name: "Trace", profile: "UML", metaclass: "Abstraction" },
  { name: "Derive", profile: "UML", metaclass: "Abstraction" },
  { name: "Instantiate", profile: "UML", metaclass: "Usage" },
  { name: "Realization", profile: "UML", metaclass: "Classifier" },
  { name: "Specification", profile: "UML", metaclass: "Classifier" },
  { name: "Subsystem", profile: "UML", metaclass: "Component" },
];

export function lookupUmlPrimitive(name: string): PrimitiveTypeSpec | undefined {
  const exact = OMG_UML_PRIMITIVES[name];
  if (exact) return exact;
  const lower = name.toLowerCase();
  for (const [key, spec] of Object.entries(OMG_UML_PRIMITIVES)) {
    if (key.toLowerCase() === lower) return spec;
  }
  return undefined;
}
