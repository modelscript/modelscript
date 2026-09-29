// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated pre-compiled KerML standard library snapshot.
// DO NOT EDIT DIRECTLY. Regenerated during build.

/* eslint-disable */
import type { SymbolEntry } from "@modelscript/runtime";

export const KERML_STDLIB_URI = "sysml2://stdlib/KerML.sysml";

export const kermlStdlibEntries: SymbolEntry[] = [
  {
    "id": 1,
    "kind": "Package",
    "name": "sML v2 / Ker",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 0,
    "endByte": 260,
    "exports": [
      "/**\n * SysML v2 / KerML standard library foundation.\n */\npackage ScalarValues {\n    abstract attribute def Real;\n    abstract attribute def Integer;\n    abstract attribute def Boolean;\n    abstract attribute def String;\n    abstract attribute def Natural :> In"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 2,
    "kind": "Definition",
    "name": ".\n *",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 28,
    "endByte": 56,
    "exports": [
      "dard library foundation.\n */"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "dard lib",
      "isVariation": null
    }
  },
  {
    "id": 3,
    "kind": "Definition",
    "name": "abstrac",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 61,
    "endByte": 92,
    "exports": [
      "age ScalarValues {\n    abstract"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "age Scal",
      "isVariation": null
    }
  },
  {
    "id": 4,
    "kind": "Definition",
    "name": "tract a",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 97,
    "endByte": 128,
    "exports": [
      "ibute def Real;\n    abstract at"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ibute de",
      "isVariation": null
    }
  },
  {
    "id": 5,
    "kind": "Definition",
    "name": "tract",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 133,
    "endByte": 163,
    "exports": [
      "te def Integer;\n    abstract a"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "te def I",
      "isVariation": null
    }
  },
  {
    "id": 6,
    "kind": "Definition",
    "name": "stract",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 168,
    "endByte": 210,
    "exports": [
      "ute def Boolean;\n    abstract attribute de"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ute def",
      "isVariation": null
    }
  },
  {
    "id": 7,
    "kind": "Reference",
    "name": "ibute d",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 6,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 202,
    "endByte": 209,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 8,
    "kind": "Definition",
    "name": "bute def",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 215,
    "endByte": 258,
    "exports": [
      "ing;\n    abstract attribute def Natural :>"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ing;",
      "isVariation": null
    }
  },
  {
    "id": 9,
    "kind": "Reference",
    "name": "ural :>",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 8,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 250,
    "endByte": 257,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 10,
    "kind": "Package",
    "name": "ab",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 260,
    "endByte": 1146,
    "exports": [
      "teger;\n    abstract attribute def Positive :> Integer;\n}\n\npackage ISQ {\n    import ScalarValues::*;\n\n    /* SI Base Quantities */\n    abstract attribute def Time :> Real;\n    abstract attribute def Mass :> Real;\n    abstract attribute def Length :> Real;\n    abstract attribute def ElectricCurrent :> Real;\n    abstract attribute def ThermodynamicTemperature :> Real;\n    abstract attribute def AmountOfSubstance :> Real;\n    abstract attribute def LuminousIntensity :> Real;\n\n    /* SI Derived Quantities */\n    abstract attribute def Area :> Real;\n    abstract attribute def Volume :> Real;\n    abstract attribute def Velocity :> Real;\n    abstract attribute def Acceleration :> Real;\n    abstract attribute def Force :> Real;\n    abstract attribute def Pressure :> Real;\n    abstract attribute def Energy :> Real;\n    abstract attribute def Power :> Real;\n    abstract attribute def"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 11,
    "kind": "Import",
    "name": "te def Posit",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 275,
    "endByte": 302,
    "exports": [],
    "inherits": [],
    "metadata": {
      "isImportAll": null,
      "isRecursive": null
    }
  },
  {
    "id": 12,
    "kind": "Definition",
    "name": "AttributeDefinition",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 308,
    "endByte": 344,
    "exports": [
      "teger;\n}\n\npackage ISQ {\n    import S"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "teger;\n}",
      "isVariation": null
    }
  },
  {
    "id": 13,
    "kind": "Reference",
    "name": "ort",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 12,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 339,
    "endByte": 343,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 14,
    "kind": "Definition",
    "name": "ase",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 349,
    "endByte": 385,
    "exports": [
      "Values::*;\n\n    /* SI Base Quantitie"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "Values::",
      "isVariation": null
    }
  },
  {
    "id": 15,
    "kind": "Reference",
    "name": "titi",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 380,
    "endByte": 384,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 16,
    "kind": "Definition",
    "name": "def Ti",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 390,
    "endByte": 428,
    "exports": [
      "abstract attribute def Time :> Rea"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abst",
      "isVariation": null
    }
  },
  {
    "id": 17,
    "kind": "Reference",
    "name": "> Re",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 16,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 423,
    "endByte": 427,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 18,
    "kind": "Definition",
    "name": "f Mass :> Real;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 433,
    "endByte": 480,
    "exports": [
      "abstract attribute def Mass :> Real;\n    abst"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstra",
      "isVariation": null
    }
  },
  {
    "id": 19,
    "kind": "Reference",
    "name": "abs",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 18,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 475,
    "endByte": 479,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 20,
    "kind": "Definition",
    "name": "Real;\n    abstract attr",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 485,
    "endByte": 541,
    "exports": [
      "attribute def Length :> Real;\n    abstract attribute def"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "attribut",
      "isVariation": null
    }
  },
  {
    "id": 21,
    "kind": "Reference",
    "name": "e de",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 20,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 536,
    "endByte": 540,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 22,
    "kind": "Definition",
    "name": "abstract attrib",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 546,
    "endByte": 595,
    "exports": [
      "tricCurrent :> Real;\n    abstract attribute def T"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "tricCurr",
      "isVariation": null
    }
  },
  {
    "id": 23,
    "kind": "Reference",
    "name": "def",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 22,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 590,
    "endByte": 594,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 24,
    "kind": "Definition",
    "name": "eal;\n    abstract",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 600,
    "endByte": 649,
    "exports": [
      "dynamicTemperature :> Real;\n    abstract attribut"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "dynamicT",
      "isVariation": null
    }
  },
  {
    "id": 25,
    "kind": "Reference",
    "name": "ribu",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 24,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 644,
    "endByte": 648,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 26,
    "kind": "Definition",
    "name": "eal;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 654,
    "endByte": 690,
    "exports": [
      "AmountOfSubstance :> Real;\n    abst"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "AmountO",
      "isVariation": null
    }
  },
  {
    "id": 27,
    "kind": "Reference",
    "name": "abs",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 26,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 685,
    "endByte": 689,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 28,
    "kind": "Definition",
    "name": "ntensi",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 695,
    "endByte": 733,
    "exports": [
      "attribute def LuminousIntensity :> Rea"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "attribut",
      "isVariation": null
    }
  },
  {
    "id": 29,
    "kind": "Reference",
    "name": "> Re",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 28,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 728,
    "endByte": 732,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 30,
    "kind": "Definition",
    "name": "ties */",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 738,
    "endByte": 778,
    "exports": [
      "/* SI Derived Quantities */\n    abstr"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "/* SI",
      "isVariation": null
    }
  },
  {
    "id": 31,
    "kind": "Reference",
    "name": "abst",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 30,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 773,
    "endByte": 777,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 32,
    "kind": "Definition",
    "name": "al;\n    abst",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 783,
    "endByte": 827,
    "exports": [
      "ttribute def Area :> Real;\n    abstract attr"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ttribute",
      "isVariation": null
    }
  },
  {
    "id": 33,
    "kind": "Reference",
    "name": "att",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 32,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 822,
    "endByte": 826,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 34,
    "kind": "Definition",
    "name": "abs",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 832,
    "endByte": 869,
    "exports": [
      "def Volume :> Real;\n    abstract att"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "def Vol",
      "isVariation": null
    }
  },
  {
    "id": 35,
    "kind": "Reference",
    "name": "t at",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 34,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 864,
    "endByte": 868,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 36,
    "kind": "Definition",
    "name": "abs",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 874,
    "endByte": 914,
    "exports": [
      "e def Velocity :> Real;\n    abstract att"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "e def Ve",
      "isVariation": null
    }
  },
  {
    "id": 37,
    "kind": "Reference",
    "name": "t at",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 36,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 909,
    "endByte": 913,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 38,
    "kind": "Definition",
    "name": "eal;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 919,
    "endByte": 957,
    "exports": [
      "e def Acceleration :> Real;\n    abstra"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "e def Ac",
      "isVariation": null
    }
  },
  {
    "id": 39,
    "kind": "Reference",
    "name": "bstr",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 38,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 952,
    "endByte": 956,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 40,
    "kind": "Definition",
    "name": "al;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 962,
    "endByte": 999,
    "exports": [
      "tribute def Force :> Real;\n    abstra"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "tribute",
      "isVariation": null
    }
  },
  {
    "id": 41,
    "kind": "Reference",
    "name": "bstr",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 40,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 994,
    "endByte": 998,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 42,
    "kind": "Definition",
    "name": "Real;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1004,
    "endByte": 1043,
    "exports": [
      "tribute def Pressure :> Real;\n    abstr"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "tribute",
      "isVariation": null
    }
  },
  {
    "id": 43,
    "kind": "Reference",
    "name": "abst",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 42,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1038,
    "endByte": 1042,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 44,
    "kind": "Definition",
    "name": "Real;\n    abstract",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1048,
    "endByte": 1098,
    "exports": [
      "ttribute def Energy :> Real;\n    abstract attribut"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ttribute",
      "isVariation": null
    }
  },
  {
    "id": 45,
    "kind": "Reference",
    "name": "ribu",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 44,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1093,
    "endByte": 1097,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 46,
    "kind": "Definition",
    "name": "tract att",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1103,
    "endByte": 1144,
    "exports": [
      "Power :> Real;\n    abstract attribute de"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "Power :",
      "isVariation": null
    }
  },
  {
    "id": 47,
    "kind": "Reference",
    "name": "te d",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 46,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1139,
    "endByte": 1143,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 48,
    "kind": "Package",
    "name": "Real;",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1146,
    "endByte": 1500,
    "exports": [
      "Voltage :> Real;\n    abstract attribute def ElectricResistance :> Real;\n    abstract attribute def Frequency :> Real;\n}\n\npackage SIBaseUnits {\n    import ScalarValues::*;\n    abstract attribute def Second :> Real;\n    abstract attribute def Kilogram :> Real;\n    abstract attribute def Metre :> Real;\n    abstract attribute def Ampere :> Real;\n    abstra"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 49,
    "kind": "Import",
    "name": "bute def Ele",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1169,
    "endByte": 1196,
    "exports": [],
    "inherits": [],
    "metadata": {
      "isImportAll": null,
      "isRecursive": null
    }
  },
  {
    "id": 50,
    "kind": "Definition",
    "name": "tract",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1202,
    "endByte": 1240,
    "exports": [
      "stance :> Real;\n    abstract attribute"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "stance :",
      "isVariation": null
    }
  },
  {
    "id": 51,
    "kind": "Reference",
    "name": "ibut",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1235,
    "endByte": 1239,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 52,
    "kind": "Definition",
    "name": "ackage S",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1245,
    "endByte": 1285,
    "exports": [
      "Frequency :> Real;\n}\n\npackage SIBaseUnit"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "Frequenc",
      "isVariation": null
    }
  },
  {
    "id": 53,
    "kind": "Reference",
    "name": "eUni",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 52,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1280,
    "endByte": 1284,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 54,
    "kind": "Definition",
    "name": ":*;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1290,
    "endByte": 1327,
    "exports": [
      "import ScalarValues::*;\n    abstra"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "impor",
      "isVariation": null
    }
  },
  {
    "id": 55,
    "kind": "Reference",
    "name": "bstr",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 54,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1322,
    "endByte": 1326,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 56,
    "kind": "Definition",
    "name": "eal;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1332,
    "endByte": 1370,
    "exports": [
      "tribute def Second :> Real;\n    abstra"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "tribute",
      "isVariation": null
    }
  },
  {
    "id": 57,
    "kind": "Reference",
    "name": "bstr",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 56,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1365,
    "endByte": 1369,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 58,
    "kind": "Definition",
    "name": "Real;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1375,
    "endByte": 1413,
    "exports": [
      "tribute def Kilogram :> Real;\n    abst"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "tribute",
      "isVariation": null
    }
  },
  {
    "id": 59,
    "kind": "Reference",
    "name": "abs",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 58,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1408,
    "endByte": 1412,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 60,
    "kind": "Definition",
    "name": "Real",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1418,
    "endByte": 1454,
    "exports": [
      "attribute def Metre :> Real;\n    abs"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "attribut",
      "isVariation": null
    }
  },
  {
    "id": 61,
    "kind": "Reference",
    "name": "ab",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 60,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1449,
    "endByte": 1453,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 62,
    "kind": "Definition",
    "name": "> Real;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1459,
    "endByte": 1498,
    "exports": [
      "attribute def Ampere :> Real;\n    abst"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "attribu",
      "isVariation": null
    }
  },
  {
    "id": 63,
    "kind": "Reference",
    "name": "abs",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 62,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1493,
    "endByte": 1497,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 64,
    "kind": "Package",
    "name": "te def Kelvin",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1500,
    "endByte": 1848,
    "exports": [
      "ct attribute def Kelvin :> Real;\n    abstract attribute def Mole :> Real;\n    abstract attribute def Candela :> Real;\n}\n\npackage SIDerivedUnits {\n    import ScalarValues::*;\n    abstract attribute def Newton :> Real;\n    abstract attribute def Pascal :> Real;\n    abstract attribute def Joule :> Real;\n    abstract attribute def Watt :> Real;\n    a"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 65,
    "kind": "Import",
    "name": "bstract attr",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1526,
    "endByte": 1553,
    "exports": [],
    "inherits": [],
    "metadata": {
      "isImportAll": null,
      "isRecursive": null
    }
  },
  {
    "id": 66,
    "kind": "Definition",
    "name": "ract a",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1559,
    "endByte": 1597,
    "exports": [
      "Mole :> Real;\n    abstract attribute"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "Mole :>",
      "isVariation": null
    }
  },
  {
    "id": 67,
    "kind": "Reference",
    "name": "bute",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 66,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1592,
    "endByte": 1596,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 68,
    "kind": "Definition",
    "name": "age SI",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1602,
    "endByte": 1640,
    "exports": [
      "andela :> Real;\n}\n\npackage SIDerivedUn"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "andela :",
      "isVariation": null
    }
  },
  {
    "id": 69,
    "kind": "Reference",
    "name": "vedU",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1635,
    "endByte": 1639,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 70,
    "kind": "Definition",
    "name": "s::*;",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1645,
    "endByte": 1682,
    "exports": [
      "import ScalarValues::*;\n    abst"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "imp",
      "isVariation": null
    }
  },
  {
    "id": 71,
    "kind": "Reference",
    "name": "abs",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 70,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1677,
    "endByte": 1681,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 72,
    "kind": "Definition",
    "name": "Rea",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1687,
    "endByte": 1723,
    "exports": [
      "attribute def Newton :> Real;\n    ab"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "attribut",
      "isVariation": null
    }
  },
  {
    "id": 73,
    "kind": "Reference",
    "name": "a",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 72,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1718,
    "endByte": 1722,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 74,
    "kind": "Definition",
    "name": ":> R",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1728,
    "endByte": 1764,
    "exports": [
      "t attribute def Pascal :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "t attrib",
      "isVariation": null
    }
  },
  {
    "id": 75,
    "kind": "Reference",
    "name": "OwnedSubclassification",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 74,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1759,
    "endByte": 1763,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 76,
    "kind": "Definition",
    "name": ":>",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1769,
    "endByte": 1804,
    "exports": [
      "act attribute def Joule :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "act attr",
      "isVariation": null
    }
  },
  {
    "id": 77,
    "kind": "Reference",
    "name": "l;",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 76,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1799,
    "endByte": 1803,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 78,
    "kind": "Definition",
    "name": "t :>",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1809,
    "endByte": 1846,
    "exports": [
      "tract attribute def Watt :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "tract at",
      "isVariation": null
    }
  },
  {
    "id": 79,
    "kind": "Reference",
    "name": ";",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 78,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1841,
    "endByte": 1845,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 80,
    "kind": "Package",
    "name": "tribute def",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1848,
    "endByte": 1990,
    "exports": [
      "bstract attribute def Volt :> Real;\n    abstract attribute def Ohm :> Real;\n    abstract attribute def Hertz :> Real;\n}\n\npackage Collections {"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 81,
    "kind": "Definition",
    "name": "ct attribu",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 80,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1876,
    "endByte": 1905,
    "exports": [
      "> Real;\n    abstract attribut"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "> Real;",
      "isVariation": null
    }
  },
  {
    "id": 82,
    "kind": "Definition",
    "name": "abst",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 80,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1910,
    "endByte": 1947,
    "exports": [
      "Ohm :> Real;\n    abstract attribute"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "Ohm :>",
      "isVariation": null
    }
  },
  {
    "id": 83,
    "kind": "Reference",
    "name": "attribute",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 82,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1936,
    "endByte": 1946,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 84,
    "kind": "Definition",
    "name": "ack",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 80,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1952,
    "endByte": 1988,
    "exports": [
      "ertz :> Real;\n}\n\npackage Collections"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ertz :>",
      "isVariation": null
    }
  },
  {
    "id": 85,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 84,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1977,
    "endByte": 1987,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 86,
    "kind": "Package",
    "name": "act",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1990,
    "endByte": 2378,
    "exports": [
      "abstract item def Collection;\n    abstract item def List :> Collection;\n    abstract item def Set :> Collection;\n}\n\npackage Base {\n    abstract item def Anything;\n    abstract item def Element :> Anything;\n    abstract item def Feature :> Element;\n    abstract item def Type :> Element;\n    abstract item def Classifier :> Type;\n    abstract item def DataType :> Classifier;\n    abst"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 87,
    "kind": "Definition",
    "name": "abstract",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2011,
    "endByte": 2038,
    "exports": [
      "f Collection;\n    abstract"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "f Collec",
      "isVariation": null
    }
  },
  {
    "id": 88,
    "kind": "Definition",
    "name": "tion;",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2043,
    "endByte": 2081,
    "exports": [
      "def List :> Collection;\n    abstract i"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "def List",
      "isVariation": null
    }
  },
  {
    "id": 89,
    "kind": "Reference",
    "name": "bstract",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 88,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2072,
    "endByte": 2080,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 90,
    "kind": "Definition",
    "name": "on;\n}",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2086,
    "endByte": 2123,
    "exports": [
      "ef Set :> Collection;\n}\n\npackage Base"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ef Set :",
      "isVariation": null
    }
  },
  {
    "id": 91,
    "kind": "Reference",
    "name": "age Bas",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 90,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2115,
    "endByte": 2122,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 92,
    "kind": "Definition",
    "name": "f An",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2128,
    "endByte": 2162,
    "exports": [
      "abstract item def Anything;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstra",
      "isVariation": null
    }
  },
  {
    "id": 93,
    "kind": "Reference",
    "name": "ng;",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 92,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2154,
    "endByte": 2161,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 94,
    "kind": "Definition",
    "name": "nt :> Anyt",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2167,
    "endByte": 2204,
    "exports": [
      "act item def Element :> Anything;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "act item",
      "isVariation": null
    }
  },
  {
    "id": 95,
    "kind": "Reference",
    "name": ";",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 94,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2199,
    "endByte": 2203,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 96,
    "kind": "Definition",
    "name": "ure :> E",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2209,
    "endByte": 2250,
    "exports": [
      "ract item def Feature :> Element;\n    abs"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ract ite",
      "isVariation": null
    }
  },
  {
    "id": 97,
    "kind": "Reference",
    "name": "nt;\n    ab",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 96,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2239,
    "endByte": 2249,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 98,
    "kind": "Definition",
    "name": "Eleme",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2255,
    "endByte": 2293,
    "exports": [
      "item def Type :> Element;\n    abstrac"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "item de",
      "isVariation": null
    }
  },
  {
    "id": 99,
    "kind": "Reference",
    "name": "abstra",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 98,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2282,
    "endByte": 2292,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 100,
    "kind": "Definition",
    "name": "> Type;",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2298,
    "endByte": 2335,
    "exports": [
      "m def Classifier :> Type;\n    abstrac"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "m def Cl",
      "isVariation": null
    }
  },
  {
    "id": 101,
    "kind": "Reference",
    "name": "bstra",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 100,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2329,
    "endByte": 2334,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 102,
    "kind": "Definition",
    "name": "Classifi",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2340,
    "endByte": 2376,
    "exports": [
      "m def DataType :> Classifier;\n    ab"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "m def Da",
      "isVariation": null
    }
  },
  {
    "id": 103,
    "kind": "Reference",
    "name": "a",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 102,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2370,
    "endByte": 2375,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 104,
    "kind": "Package",
    "name": "def Cla",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2378,
    "endByte": 2637,
    "exports": [
      "ract item def Class :> Classifier;\n    abstract item def Structure :> Class;\n    abstract item def Behavior :> Class;\n}\n\npackage Control {\n    abstract action def ControlNode;\n    abstract action def MergeNode :> ControlNode;\n    abstract action def DecisionN"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 105,
    "kind": "Definition",
    "name": "act item de",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2402,
    "endByte": 2434,
    "exports": [
      "lassifier;\n    abstract item def"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "lassifie",
      "isVariation": null
    }
  },
  {
    "id": 106,
    "kind": "Definition",
    "name": "abstract",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2439,
    "endByte": 2484,
    "exports": [
      "cture :> Class;\n    abstract item def Behavio"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "cture :>",
      "isVariation": null
    }
  },
  {
    "id": 107,
    "kind": "Reference",
    "name": "def Behavi",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 106,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2472,
    "endByte": 2483,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 108,
    "kind": "Definition",
    "name": "ntrol {",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2489,
    "endByte": 2537,
    "exports": [
      "Class;\n}\n\npackage Control {\n    abstract action"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "Class;\n}",
      "isVariation": null
    }
  },
  {
    "id": 109,
    "kind": "Reference",
    "name": "ract action",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 108,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2525,
    "endByte": 2536,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 110,
    "kind": "Definition",
    "name": "ract act",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2542,
    "endByte": 2586,
    "exports": [
      "ontrolNode;\n    abstract action def MergeNod"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ontrolNo",
      "isVariation": null
    }
  },
  {
    "id": 111,
    "kind": "Reference",
    "name": "def MergeNo",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 110,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2574,
    "endByte": 2585,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 112,
    "kind": "Definition",
    "name": "tract ac",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2591,
    "endByte": 2635,
    "exports": [
      "ControlNode;\n    abstract action def Decisio"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ControlN",
      "isVariation": null
    }
  },
  {
    "id": 113,
    "kind": "Reference",
    "name": "def Decisi",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 112,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2623,
    "endByte": 2634,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 114,
    "kind": "Package",
    "name": "trolNode;",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2637,
    "endByte": 2775,
    "exports": [
      "ode :> ControlNode;\n    abstract action def ForkNode :> ControlNode;\n    abstract action def JoinNode :> ControlNode;\n}\n\npackage Transfers"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 115,
    "kind": "Definition",
    "name": "ForkNode",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2663,
    "endByte": 2690,
    "exports": [
      "stract action def ForkNode"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "stract a",
      "isVariation": null
    }
  },
  {
    "id": 116,
    "kind": "Definition",
    "name": "trac",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2695,
    "endByte": 2730,
    "exports": [
      "ntrolNode;\n    abstract action def"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ntrolNod",
      "isVariation": null
    }
  },
  {
    "id": 117,
    "kind": "Reference",
    "name": "tion def",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 116,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2721,
    "endByte": 2729,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 118,
    "kind": "Definition",
    "name": ";\n}\n\npa",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2735,
    "endByte": 2773,
    "exports": [
      "ode :> ControlNode;\n}\n\npackage Transfe"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ode :> C",
      "isVariation": null
    }
  },
  {
    "id": 119,
    "kind": "Reference",
    "name": "e Transf",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 118,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2764,
    "endByte": 2772,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 120,
    "kind": "Package",
    "name": "tract item d",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2775,
    "endByte": 2939,
    "exports": [
      "{\n    abstract item def Transfer;\n    abstract item def Flow :> Transfer;\n    abstract item def Message :> Transfer;\n}\n\npackage Performances {\n    abstract action"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 121,
    "kind": "Definition",
    "name": "tem def Flo",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2804,
    "endByte": 2836,
    "exports": [
      "sfer;\n    abstract item def Flow"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "sfer;",
      "isVariation": null
    }
  },
  {
    "id": 122,
    "kind": "Definition",
    "name": "t item def",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2841,
    "endByte": 2887,
    "exports": [
      "ransfer;\n    abstract item def Message :> Tran"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "ransfer;",
      "isVariation": null
    }
  },
  {
    "id": 123,
    "kind": "Reference",
    "name": "sage :> Tra",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 122,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2875,
    "endByte": 2886,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 124,
    "kind": "Definition",
    "name": "nces {",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2892,
    "endByte": 2937,
    "exports": [
      "}\n\npackage Performances {\n    abstract actio"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "}\n\npack",
      "isVariation": null
    }
  },
  {
    "id": 125,
    "kind": "Reference",
    "name": "stract acti",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 124,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2925,
    "endByte": 2936,
    "exports": [],
    "inherits": [],
    "metadata": {}
  }
];
