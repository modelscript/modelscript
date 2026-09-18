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
    "name": "ScalarValues",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 56,
    "endByte": 316,
    "exports": [
      "package ScalarValues {\n    abstract attribute def Real;\n    abstract attribute def Integer;\n    abstract attribute def Boolean;\n    abstract attribute def String;\n    abstract attribute def Natural :> Integer;\n    abstract attribute def Positive :> Integer;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 2,
    "kind": "Definition",
    "name": "Real",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 84,
    "endByte": 112,
    "exports": [
      "abstract attribute def Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 3,
    "kind": "Definition",
    "name": "Integer",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 117,
    "endByte": 148,
    "exports": [
      "abstract attribute def Integer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 4,
    "kind": "Definition",
    "name": "Boolean",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 153,
    "endByte": 184,
    "exports": [
      "abstract attribute def Boolean;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 5,
    "kind": "Definition",
    "name": "String",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 189,
    "endByte": 219,
    "exports": [
      "abstract attribute def String;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 6,
    "kind": "Definition",
    "name": "Natural",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 224,
    "endByte": 266,
    "exports": [
      "abstract attribute def Natural :> Integer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 7,
    "kind": "Reference",
    "name": "Integer",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 6,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 257,
    "endByte": 265,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 8,
    "kind": "Definition",
    "name": "Positive",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 271,
    "endByte": 314,
    "exports": [
      "abstract attribute def Positive :> Integer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 9,
    "kind": "Reference",
    "name": "Integer",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 8,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 305,
    "endByte": 313,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 10,
    "kind": "Package",
    "name": "ISQ",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 316,
    "endByte": 1265,
    "exports": [
      "package ISQ {\n    import ScalarValues::*;\n\n    /* SI Base Quantities */\n    abstract attribute def Time :> Real;\n    abstract attribute def Mass :> Real;\n    abstract attribute def Length :> Real;\n    abstract attribute def ElectricCurrent :> Real;\n    abstract attribute def ThermodynamicTemperature :> Real;\n    abstract attribute def AmountOfSubstance :> Real;\n    abstract attribute def LuminousIntensity :> Real;\n\n    /* SI Derived Quantities */\n    abstract attribute def Area :> Real;\n    abstract attribute def Volume :> Real;\n    abstract attribute def Velocity :> Real;\n    abstract attribute def Acceleration :> Real;\n    abstract attribute def Force :> Real;\n    abstract attribute def Pressure :> Real;\n    abstract attribute def Energy :> Real;\n    abstract attribute def Power :> Real;\n    abstract attribute def Voltage :> Real;\n    abstract attribute def ElectricResistance :> Real;\n    abstract attribute def Frequency :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 11,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 331,
    "endByte": 358,
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
    "name": "Time",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 394,
    "endByte": 430,
    "exports": [
      "abstract attribute def Time :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 13,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 12,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 424,
    "endByte": 429,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 14,
    "kind": "Definition",
    "name": "Mass",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 435,
    "endByte": 471,
    "exports": [
      "abstract attribute def Mass :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 15,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 465,
    "endByte": 470,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 16,
    "kind": "Definition",
    "name": "Length",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 476,
    "endByte": 514,
    "exports": [
      "abstract attribute def Length :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 17,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 16,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 508,
    "endByte": 513,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 18,
    "kind": "Definition",
    "name": "ElectricCurrent",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 519,
    "endByte": 566,
    "exports": [
      "abstract attribute def ElectricCurrent :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 19,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 18,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 560,
    "endByte": 565,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 20,
    "kind": "Definition",
    "name": "ThermodynamicTemperature",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 571,
    "endByte": 627,
    "exports": [
      "abstract attribute def ThermodynamicTemperature :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 21,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 20,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 621,
    "endByte": 626,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 22,
    "kind": "Definition",
    "name": "AmountOfSubstance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 632,
    "endByte": 681,
    "exports": [
      "abstract attribute def AmountOfSubstance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 23,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 22,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 675,
    "endByte": 680,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 24,
    "kind": "Definition",
    "name": "LuminousIntensity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 686,
    "endByte": 735,
    "exports": [
      "abstract attribute def LuminousIntensity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 25,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 24,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 729,
    "endByte": 734,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 26,
    "kind": "Definition",
    "name": "Area",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 773,
    "endByte": 809,
    "exports": [
      "abstract attribute def Area :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 27,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 26,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 803,
    "endByte": 808,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 28,
    "kind": "Definition",
    "name": "Volume",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 814,
    "endByte": 852,
    "exports": [
      "abstract attribute def Volume :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 29,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 28,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 846,
    "endByte": 851,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 30,
    "kind": "Definition",
    "name": "Velocity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 857,
    "endByte": 897,
    "exports": [
      "abstract attribute def Velocity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 31,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 30,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 891,
    "endByte": 896,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 32,
    "kind": "Definition",
    "name": "Acceleration",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 902,
    "endByte": 946,
    "exports": [
      "abstract attribute def Acceleration :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 33,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 32,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 940,
    "endByte": 945,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 34,
    "kind": "Definition",
    "name": "Force",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 951,
    "endByte": 988,
    "exports": [
      "abstract attribute def Force :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 35,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 34,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 982,
    "endByte": 987,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 36,
    "kind": "Definition",
    "name": "Pressure",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 993,
    "endByte": 1033,
    "exports": [
      "abstract attribute def Pressure :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 37,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 36,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1027,
    "endByte": 1032,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 38,
    "kind": "Definition",
    "name": "Energy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1038,
    "endByte": 1076,
    "exports": [
      "abstract attribute def Energy :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 39,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 38,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1070,
    "endByte": 1075,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 40,
    "kind": "Definition",
    "name": "Power",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1081,
    "endByte": 1118,
    "exports": [
      "abstract attribute def Power :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 41,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 40,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1112,
    "endByte": 1117,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 42,
    "kind": "Definition",
    "name": "Voltage",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1123,
    "endByte": 1162,
    "exports": [
      "abstract attribute def Voltage :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 43,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 42,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1156,
    "endByte": 1161,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 44,
    "kind": "Definition",
    "name": "ElectricResistance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1167,
    "endByte": 1217,
    "exports": [
      "abstract attribute def ElectricResistance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 45,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 44,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1211,
    "endByte": 1216,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 46,
    "kind": "Definition",
    "name": "Frequency",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1222,
    "endByte": 1263,
    "exports": [
      "abstract attribute def Frequency :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 47,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 46,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1257,
    "endByte": 1262,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 48,
    "kind": "Package",
    "name": "SIBaseUnits",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1265,
    "endByte": 1619,
    "exports": [
      "package SIBaseUnits {\n    import ScalarValues::*;\n    abstract attribute def Second :> Real;\n    abstract attribute def Kilogram :> Real;\n    abstract attribute def Metre :> Real;\n    abstract attribute def Ampere :> Real;\n    abstract attribute def Kelvin :> Real;\n    abstract attribute def Mole :> Real;\n    abstract attribute def Candela :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 49,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1288,
    "endByte": 1315,
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
    "name": "Second",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1321,
    "endByte": 1359,
    "exports": [
      "abstract attribute def Second :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 51,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1353,
    "endByte": 1358,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 52,
    "kind": "Definition",
    "name": "Kilogram",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1364,
    "endByte": 1404,
    "exports": [
      "abstract attribute def Kilogram :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 53,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 52,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1398,
    "endByte": 1403,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 54,
    "kind": "Definition",
    "name": "Metre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1409,
    "endByte": 1446,
    "exports": [
      "abstract attribute def Metre :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 55,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 54,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1440,
    "endByte": 1445,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 56,
    "kind": "Definition",
    "name": "Ampere",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1451,
    "endByte": 1489,
    "exports": [
      "abstract attribute def Ampere :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 57,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 56,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1483,
    "endByte": 1488,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 58,
    "kind": "Definition",
    "name": "Kelvin",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1494,
    "endByte": 1532,
    "exports": [
      "abstract attribute def Kelvin :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 59,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 58,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1526,
    "endByte": 1531,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 60,
    "kind": "Definition",
    "name": "Mole",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1537,
    "endByte": 1573,
    "exports": [
      "abstract attribute def Mole :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 61,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 60,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1567,
    "endByte": 1572,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 62,
    "kind": "Definition",
    "name": "Candela",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1578,
    "endByte": 1617,
    "exports": [
      "abstract attribute def Candela :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 63,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 62,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1611,
    "endByte": 1616,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 64,
    "kind": "Package",
    "name": "SIDerivedUnits",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1619,
    "endByte": 1967,
    "exports": [
      "package SIDerivedUnits {\n    import ScalarValues::*;\n    abstract attribute def Newton :> Real;\n    abstract attribute def Pascal :> Real;\n    abstract attribute def Joule :> Real;\n    abstract attribute def Watt :> Real;\n    abstract attribute def Volt :> Real;\n    abstract attribute def Ohm :> Real;\n    abstract attribute def Hertz :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 65,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1645,
    "endByte": 1672,
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
    "name": "Newton",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1678,
    "endByte": 1716,
    "exports": [
      "abstract attribute def Newton :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 67,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 66,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1710,
    "endByte": 1715,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 68,
    "kind": "Definition",
    "name": "Pascal",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1721,
    "endByte": 1759,
    "exports": [
      "abstract attribute def Pascal :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 69,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1753,
    "endByte": 1758,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 70,
    "kind": "Definition",
    "name": "Joule",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1764,
    "endByte": 1801,
    "exports": [
      "abstract attribute def Joule :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 71,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 70,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1795,
    "endByte": 1800,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 72,
    "kind": "Definition",
    "name": "Watt",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1806,
    "endByte": 1842,
    "exports": [
      "abstract attribute def Watt :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 73,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 72,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1836,
    "endByte": 1841,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 74,
    "kind": "Definition",
    "name": "Volt",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1847,
    "endByte": 1883,
    "exports": [
      "abstract attribute def Volt :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 75,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 74,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1877,
    "endByte": 1882,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 76,
    "kind": "Definition",
    "name": "Ohm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1888,
    "endByte": 1923,
    "exports": [
      "abstract attribute def Ohm :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 77,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 76,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1917,
    "endByte": 1922,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 78,
    "kind": "Definition",
    "name": "Hertz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1928,
    "endByte": 1965,
    "exports": [
      "abstract attribute def Hertz :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 79,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 78,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1959,
    "endByte": 1964,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 80,
    "kind": "Package",
    "name": "Collections",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1967,
    "endByte": 2109,
    "exports": [
      "package Collections {\n    abstract item def Collection;\n    abstract item def List :> Collection;\n    abstract item def Set :> Collection;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 81,
    "kind": "Definition",
    "name": "Collection",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 80,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 1995,
    "endByte": 2024,
    "exports": [
      "abstract item def Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 82,
    "kind": "Definition",
    "name": "List",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 80,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2029,
    "endByte": 2066,
    "exports": [
      "abstract item def List :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 83,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 82,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2054,
    "endByte": 2065,
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 84,
    "kind": "Definition",
    "name": "Set",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 80,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2071,
    "endByte": 2107,
    "exports": [
      "abstract item def Set :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
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
    "startByte": 2095,
    "endByte": 2106,
    "exports": [],
    "inherits": [],
    "metadata": {}
  }
];
