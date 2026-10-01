// SPDX-License-Identifier: AGPL-3.0-or-later
// Auto-generated pre-compiled KerML standard library snapshot.
// DO NOT EDIT DIRECTLY. Regenerated during build.

export const KERML_STDLIB_URI = "sysml2://stdlib/KerML.sysml";

export const kermlStdlibEntries = [
  {
    "id": 1,
    "kind": "Package",
    "name": "ScalarValues",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 0,
    "endByte": 316,
    "startOffset": 0,
    "endOffset": 316,
    "fieldRanges": {
      "name": {
        "startByte": 65,
        "endByte": 77,
        "startOffset": 65,
        "endOffset": 77
      },
      "declaredName": {
        "startByte": 65,
        "endByte": 77,
        "startOffset": 65,
        "endOffset": 77
      }
    },
    "exports": [
      "/**\n * SysML v2 / KerML standard library foundation.\n */\npackage ScalarValues {\n    abstract attribute def Real;\n    abstract attribute def Integer;\n    abstract attribute def Boolean;\n    abstract attribute def String;\n    abstract attribute def Natural :> Integer;\n    abstract attribute def Positive :> Integer;\n}"
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
    "startOffset": 84,
    "endOffset": 112,
    "fieldRanges": {
      "name": {
        "startByte": 107,
        "endByte": 111,
        "startOffset": 107,
        "endOffset": 111
      },
      "declaredName": {
        "startByte": 107,
        "endByte": 111,
        "startOffset": 107,
        "endOffset": 111
      }
    },
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
    "startOffset": 117,
    "endOffset": 148,
    "fieldRanges": {
      "name": {
        "startByte": 140,
        "endByte": 147,
        "startOffset": 140,
        "endOffset": 147
      },
      "declaredName": {
        "startByte": 140,
        "endByte": 147,
        "startOffset": 140,
        "endOffset": 147
      }
    },
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
    "startOffset": 153,
    "endOffset": 184,
    "fieldRanges": {
      "name": {
        "startByte": 176,
        "endByte": 183,
        "startOffset": 176,
        "endOffset": 183
      },
      "declaredName": {
        "startByte": 176,
        "endByte": 183,
        "startOffset": 176,
        "endOffset": 183
      }
    },
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
    "startOffset": 189,
    "endOffset": 219,
    "fieldRanges": {
      "name": {
        "startByte": 212,
        "endByte": 218,
        "startOffset": 212,
        "endOffset": 218
      },
      "declaredName": {
        "startByte": 212,
        "endByte": 218,
        "startOffset": 212,
        "endOffset": 218
      }
    },
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
    "startOffset": 224,
    "endOffset": 266,
    "fieldRanges": {
      "name": {
        "startByte": 247,
        "endByte": 254,
        "startOffset": 247,
        "endOffset": 254
      },
      "declaredName": {
        "startByte": 247,
        "endByte": 254,
        "startOffset": 247,
        "endOffset": 254
      }
    },
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
    "startOffset": 257,
    "endOffset": 265,
    "fieldRanges": {
      "name": {
        "startByte": 257,
        "endByte": 265,
        "startOffset": 257,
        "endOffset": 265
      },
      "superclassifier": {
        "startByte": 257,
        "endByte": 265,
        "startOffset": 257,
        "endOffset": 265
      }
    },
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
    "startOffset": 271,
    "endOffset": 314,
    "fieldRanges": {
      "name": {
        "startByte": 294,
        "endByte": 302,
        "startOffset": 294,
        "endOffset": 302
      },
      "declaredName": {
        "startByte": 294,
        "endByte": 302,
        "startOffset": 294,
        "endOffset": 302
      }
    },
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
    "startOffset": 305,
    "endOffset": 313,
    "fieldRanges": {
      "name": {
        "startByte": 305,
        "endByte": 313,
        "startOffset": 305,
        "endOffset": 313
      },
      "superclassifier": {
        "startByte": 305,
        "endByte": 313,
        "startOffset": 305,
        "endOffset": 313
      }
    },
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
    "startOffset": 316,
    "endOffset": 1265,
    "fieldRanges": {
      "name": {
        "startByte": 326,
        "endByte": 329,
        "startOffset": 326,
        "endOffset": 329
      },
      "declaredName": {
        "startByte": 326,
        "endByte": 329,
        "startOffset": 326,
        "endOffset": 329
      }
    },
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
    "startOffset": 331,
    "endOffset": 358,
    "fieldRanges": {
      "name": {
        "startByte": 342,
        "endByte": 355,
        "startOffset": 342,
        "endOffset": 355
      },
      "importedNamespace": {
        "startByte": 342,
        "endByte": 355,
        "startOffset": 342,
        "endOffset": 355
      }
    },
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
    "startOffset": 394,
    "endOffset": 430,
    "fieldRanges": {
      "name": {
        "startByte": 417,
        "endByte": 421,
        "startOffset": 417,
        "endOffset": 421
      },
      "declaredName": {
        "startByte": 417,
        "endByte": 421,
        "startOffset": 417,
        "endOffset": 421
      }
    },
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
    "startOffset": 424,
    "endOffset": 429,
    "fieldRanges": {
      "name": {
        "startByte": 424,
        "endByte": 429,
        "startOffset": 424,
        "endOffset": 429
      },
      "superclassifier": {
        "startByte": 424,
        "endByte": 429,
        "startOffset": 424,
        "endOffset": 429
      }
    },
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
    "startOffset": 435,
    "endOffset": 471,
    "fieldRanges": {
      "name": {
        "startByte": 458,
        "endByte": 462,
        "startOffset": 458,
        "endOffset": 462
      },
      "declaredName": {
        "startByte": 458,
        "endByte": 462,
        "startOffset": 458,
        "endOffset": 462
      }
    },
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
    "startOffset": 465,
    "endOffset": 470,
    "fieldRanges": {
      "name": {
        "startByte": 465,
        "endByte": 470,
        "startOffset": 465,
        "endOffset": 470
      },
      "superclassifier": {
        "startByte": 465,
        "endByte": 470,
        "startOffset": 465,
        "endOffset": 470
      }
    },
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
    "startOffset": 476,
    "endOffset": 514,
    "fieldRanges": {
      "name": {
        "startByte": 499,
        "endByte": 505,
        "startOffset": 499,
        "endOffset": 505
      },
      "declaredName": {
        "startByte": 499,
        "endByte": 505,
        "startOffset": 499,
        "endOffset": 505
      }
    },
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
    "startOffset": 508,
    "endOffset": 513,
    "fieldRanges": {
      "name": {
        "startByte": 508,
        "endByte": 513,
        "startOffset": 508,
        "endOffset": 513
      },
      "superclassifier": {
        "startByte": 508,
        "endByte": 513,
        "startOffset": 508,
        "endOffset": 513
      }
    },
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
    "startOffset": 519,
    "endOffset": 566,
    "fieldRanges": {
      "name": {
        "startByte": 542,
        "endByte": 557,
        "startOffset": 542,
        "endOffset": 557
      },
      "declaredName": {
        "startByte": 542,
        "endByte": 557,
        "startOffset": 542,
        "endOffset": 557
      }
    },
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
    "startOffset": 560,
    "endOffset": 565,
    "fieldRanges": {
      "name": {
        "startByte": 560,
        "endByte": 565,
        "startOffset": 560,
        "endOffset": 565
      },
      "superclassifier": {
        "startByte": 560,
        "endByte": 565,
        "startOffset": 560,
        "endOffset": 565
      }
    },
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
    "startOffset": 571,
    "endOffset": 627,
    "fieldRanges": {
      "name": {
        "startByte": 594,
        "endByte": 618,
        "startOffset": 594,
        "endOffset": 618
      },
      "declaredName": {
        "startByte": 594,
        "endByte": 618,
        "startOffset": 594,
        "endOffset": 618
      }
    },
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
    "startOffset": 621,
    "endOffset": 626,
    "fieldRanges": {
      "name": {
        "startByte": 621,
        "endByte": 626,
        "startOffset": 621,
        "endOffset": 626
      },
      "superclassifier": {
        "startByte": 621,
        "endByte": 626,
        "startOffset": 621,
        "endOffset": 626
      }
    },
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
    "startOffset": 632,
    "endOffset": 681,
    "fieldRanges": {
      "name": {
        "startByte": 655,
        "endByte": 672,
        "startOffset": 655,
        "endOffset": 672
      },
      "declaredName": {
        "startByte": 655,
        "endByte": 672,
        "startOffset": 655,
        "endOffset": 672
      }
    },
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
    "startOffset": 675,
    "endOffset": 680,
    "fieldRanges": {
      "name": {
        "startByte": 675,
        "endByte": 680,
        "startOffset": 675,
        "endOffset": 680
      },
      "superclassifier": {
        "startByte": 675,
        "endByte": 680,
        "startOffset": 675,
        "endOffset": 680
      }
    },
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
    "startOffset": 686,
    "endOffset": 735,
    "fieldRanges": {
      "name": {
        "startByte": 709,
        "endByte": 726,
        "startOffset": 709,
        "endOffset": 726
      },
      "declaredName": {
        "startByte": 709,
        "endByte": 726,
        "startOffset": 709,
        "endOffset": 726
      }
    },
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
    "startOffset": 729,
    "endOffset": 734,
    "fieldRanges": {
      "name": {
        "startByte": 729,
        "endByte": 734,
        "startOffset": 729,
        "endOffset": 734
      },
      "superclassifier": {
        "startByte": 729,
        "endByte": 734,
        "startOffset": 729,
        "endOffset": 734
      }
    },
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
    "startOffset": 773,
    "endOffset": 809,
    "fieldRanges": {
      "name": {
        "startByte": 796,
        "endByte": 800,
        "startOffset": 796,
        "endOffset": 800
      },
      "declaredName": {
        "startByte": 796,
        "endByte": 800,
        "startOffset": 796,
        "endOffset": 800
      }
    },
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
    "startOffset": 803,
    "endOffset": 808,
    "fieldRanges": {
      "name": {
        "startByte": 803,
        "endByte": 808,
        "startOffset": 803,
        "endOffset": 808
      },
      "superclassifier": {
        "startByte": 803,
        "endByte": 808,
        "startOffset": 803,
        "endOffset": 808
      }
    },
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
    "startOffset": 814,
    "endOffset": 852,
    "fieldRanges": {
      "name": {
        "startByte": 837,
        "endByte": 843,
        "startOffset": 837,
        "endOffset": 843
      },
      "declaredName": {
        "startByte": 837,
        "endByte": 843,
        "startOffset": 837,
        "endOffset": 843
      }
    },
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
    "startOffset": 846,
    "endOffset": 851,
    "fieldRanges": {
      "name": {
        "startByte": 846,
        "endByte": 851,
        "startOffset": 846,
        "endOffset": 851
      },
      "superclassifier": {
        "startByte": 846,
        "endByte": 851,
        "startOffset": 846,
        "endOffset": 851
      }
    },
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
    "startOffset": 857,
    "endOffset": 897,
    "fieldRanges": {
      "name": {
        "startByte": 880,
        "endByte": 888,
        "startOffset": 880,
        "endOffset": 888
      },
      "declaredName": {
        "startByte": 880,
        "endByte": 888,
        "startOffset": 880,
        "endOffset": 888
      }
    },
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
    "startOffset": 891,
    "endOffset": 896,
    "fieldRanges": {
      "name": {
        "startByte": 891,
        "endByte": 896,
        "startOffset": 891,
        "endOffset": 896
      },
      "superclassifier": {
        "startByte": 891,
        "endByte": 896,
        "startOffset": 891,
        "endOffset": 896
      }
    },
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
    "startOffset": 902,
    "endOffset": 946,
    "fieldRanges": {
      "name": {
        "startByte": 925,
        "endByte": 937,
        "startOffset": 925,
        "endOffset": 937
      },
      "declaredName": {
        "startByte": 925,
        "endByte": 937,
        "startOffset": 925,
        "endOffset": 937
      }
    },
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
    "startOffset": 940,
    "endOffset": 945,
    "fieldRanges": {
      "name": {
        "startByte": 940,
        "endByte": 945,
        "startOffset": 940,
        "endOffset": 945
      },
      "superclassifier": {
        "startByte": 940,
        "endByte": 945,
        "startOffset": 940,
        "endOffset": 945
      }
    },
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
    "startOffset": 951,
    "endOffset": 988,
    "fieldRanges": {
      "name": {
        "startByte": 974,
        "endByte": 979,
        "startOffset": 974,
        "endOffset": 979
      },
      "declaredName": {
        "startByte": 974,
        "endByte": 979,
        "startOffset": 974,
        "endOffset": 979
      }
    },
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
    "startOffset": 982,
    "endOffset": 987,
    "fieldRanges": {
      "name": {
        "startByte": 982,
        "endByte": 987,
        "startOffset": 982,
        "endOffset": 987
      },
      "superclassifier": {
        "startByte": 982,
        "endByte": 987,
        "startOffset": 982,
        "endOffset": 987
      }
    },
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
    "startOffset": 993,
    "endOffset": 1033,
    "fieldRanges": {
      "name": {
        "startByte": 1016,
        "endByte": 1024,
        "startOffset": 1016,
        "endOffset": 1024
      },
      "declaredName": {
        "startByte": 1016,
        "endByte": 1024,
        "startOffset": 1016,
        "endOffset": 1024
      }
    },
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
    "startOffset": 1027,
    "endOffset": 1032,
    "fieldRanges": {
      "name": {
        "startByte": 1027,
        "endByte": 1032,
        "startOffset": 1027,
        "endOffset": 1032
      },
      "superclassifier": {
        "startByte": 1027,
        "endByte": 1032,
        "startOffset": 1027,
        "endOffset": 1032
      }
    },
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
    "startOffset": 1038,
    "endOffset": 1076,
    "fieldRanges": {
      "name": {
        "startByte": 1061,
        "endByte": 1067,
        "startOffset": 1061,
        "endOffset": 1067
      },
      "declaredName": {
        "startByte": 1061,
        "endByte": 1067,
        "startOffset": 1061,
        "endOffset": 1067
      }
    },
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
    "startOffset": 1070,
    "endOffset": 1075,
    "fieldRanges": {
      "name": {
        "startByte": 1070,
        "endByte": 1075,
        "startOffset": 1070,
        "endOffset": 1075
      },
      "superclassifier": {
        "startByte": 1070,
        "endByte": 1075,
        "startOffset": 1070,
        "endOffset": 1075
      }
    },
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
    "startOffset": 1081,
    "endOffset": 1118,
    "fieldRanges": {
      "name": {
        "startByte": 1104,
        "endByte": 1109,
        "startOffset": 1104,
        "endOffset": 1109
      },
      "declaredName": {
        "startByte": 1104,
        "endByte": 1109,
        "startOffset": 1104,
        "endOffset": 1109
      }
    },
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
    "startOffset": 1112,
    "endOffset": 1117,
    "fieldRanges": {
      "name": {
        "startByte": 1112,
        "endByte": 1117,
        "startOffset": 1112,
        "endOffset": 1117
      },
      "superclassifier": {
        "startByte": 1112,
        "endByte": 1117,
        "startOffset": 1112,
        "endOffset": 1117
      }
    },
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
    "startOffset": 1123,
    "endOffset": 1162,
    "fieldRanges": {
      "name": {
        "startByte": 1146,
        "endByte": 1153,
        "startOffset": 1146,
        "endOffset": 1153
      },
      "declaredName": {
        "startByte": 1146,
        "endByte": 1153,
        "startOffset": 1146,
        "endOffset": 1153
      }
    },
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
    "startOffset": 1156,
    "endOffset": 1161,
    "fieldRanges": {
      "name": {
        "startByte": 1156,
        "endByte": 1161,
        "startOffset": 1156,
        "endOffset": 1161
      },
      "superclassifier": {
        "startByte": 1156,
        "endByte": 1161,
        "startOffset": 1156,
        "endOffset": 1161
      }
    },
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
    "startOffset": 1167,
    "endOffset": 1217,
    "fieldRanges": {
      "name": {
        "startByte": 1190,
        "endByte": 1208,
        "startOffset": 1190,
        "endOffset": 1208
      },
      "declaredName": {
        "startByte": 1190,
        "endByte": 1208,
        "startOffset": 1190,
        "endOffset": 1208
      }
    },
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
    "startOffset": 1211,
    "endOffset": 1216,
    "fieldRanges": {
      "name": {
        "startByte": 1211,
        "endByte": 1216,
        "startOffset": 1211,
        "endOffset": 1216
      },
      "superclassifier": {
        "startByte": 1211,
        "endByte": 1216,
        "startOffset": 1211,
        "endOffset": 1216
      }
    },
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
    "startOffset": 1222,
    "endOffset": 1263,
    "fieldRanges": {
      "name": {
        "startByte": 1245,
        "endByte": 1254,
        "startOffset": 1245,
        "endOffset": 1254
      },
      "declaredName": {
        "startByte": 1245,
        "endByte": 1254,
        "startOffset": 1245,
        "endOffset": 1254
      }
    },
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
    "startOffset": 1257,
    "endOffset": 1262,
    "fieldRanges": {
      "name": {
        "startByte": 1257,
        "endByte": 1262,
        "startOffset": 1257,
        "endOffset": 1262
      },
      "superclassifier": {
        "startByte": 1257,
        "endByte": 1262,
        "startOffset": 1257,
        "endOffset": 1262
      }
    },
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
    "startOffset": 1265,
    "endOffset": 1619,
    "fieldRanges": {
      "name": {
        "startByte": 1275,
        "endByte": 1286,
        "startOffset": 1275,
        "endOffset": 1286
      },
      "declaredName": {
        "startByte": 1275,
        "endByte": 1286,
        "startOffset": 1275,
        "endOffset": 1286
      }
    },
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
    "startOffset": 1288,
    "endOffset": 1315,
    "fieldRanges": {
      "name": {
        "startByte": 1299,
        "endByte": 1312,
        "startOffset": 1299,
        "endOffset": 1312
      },
      "importedNamespace": {
        "startByte": 1299,
        "endByte": 1312,
        "startOffset": 1299,
        "endOffset": 1312
      }
    },
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
    "startOffset": 1321,
    "endOffset": 1359,
    "fieldRanges": {
      "name": {
        "startByte": 1344,
        "endByte": 1350,
        "startOffset": 1344,
        "endOffset": 1350
      },
      "declaredName": {
        "startByte": 1344,
        "endByte": 1350,
        "startOffset": 1344,
        "endOffset": 1350
      }
    },
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
    "startOffset": 1353,
    "endOffset": 1358,
    "fieldRanges": {
      "name": {
        "startByte": 1353,
        "endByte": 1358,
        "startOffset": 1353,
        "endOffset": 1358
      },
      "superclassifier": {
        "startByte": 1353,
        "endByte": 1358,
        "startOffset": 1353,
        "endOffset": 1358
      }
    },
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
    "startOffset": 1364,
    "endOffset": 1404,
    "fieldRanges": {
      "name": {
        "startByte": 1387,
        "endByte": 1395,
        "startOffset": 1387,
        "endOffset": 1395
      },
      "declaredName": {
        "startByte": 1387,
        "endByte": 1395,
        "startOffset": 1387,
        "endOffset": 1395
      }
    },
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
    "startOffset": 1398,
    "endOffset": 1403,
    "fieldRanges": {
      "name": {
        "startByte": 1398,
        "endByte": 1403,
        "startOffset": 1398,
        "endOffset": 1403
      },
      "superclassifier": {
        "startByte": 1398,
        "endByte": 1403,
        "startOffset": 1398,
        "endOffset": 1403
      }
    },
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
    "startOffset": 1409,
    "endOffset": 1446,
    "fieldRanges": {
      "name": {
        "startByte": 1432,
        "endByte": 1437,
        "startOffset": 1432,
        "endOffset": 1437
      },
      "declaredName": {
        "startByte": 1432,
        "endByte": 1437,
        "startOffset": 1432,
        "endOffset": 1437
      }
    },
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
    "startOffset": 1440,
    "endOffset": 1445,
    "fieldRanges": {
      "name": {
        "startByte": 1440,
        "endByte": 1445,
        "startOffset": 1440,
        "endOffset": 1445
      },
      "superclassifier": {
        "startByte": 1440,
        "endByte": 1445,
        "startOffset": 1440,
        "endOffset": 1445
      }
    },
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
    "startOffset": 1451,
    "endOffset": 1489,
    "fieldRanges": {
      "name": {
        "startByte": 1474,
        "endByte": 1480,
        "startOffset": 1474,
        "endOffset": 1480
      },
      "declaredName": {
        "startByte": 1474,
        "endByte": 1480,
        "startOffset": 1474,
        "endOffset": 1480
      }
    },
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
    "startOffset": 1483,
    "endOffset": 1488,
    "fieldRanges": {
      "name": {
        "startByte": 1483,
        "endByte": 1488,
        "startOffset": 1483,
        "endOffset": 1488
      },
      "superclassifier": {
        "startByte": 1483,
        "endByte": 1488,
        "startOffset": 1483,
        "endOffset": 1488
      }
    },
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
    "startOffset": 1494,
    "endOffset": 1532,
    "fieldRanges": {
      "name": {
        "startByte": 1517,
        "endByte": 1523,
        "startOffset": 1517,
        "endOffset": 1523
      },
      "declaredName": {
        "startByte": 1517,
        "endByte": 1523,
        "startOffset": 1517,
        "endOffset": 1523
      }
    },
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
    "startOffset": 1526,
    "endOffset": 1531,
    "fieldRanges": {
      "name": {
        "startByte": 1526,
        "endByte": 1531,
        "startOffset": 1526,
        "endOffset": 1531
      },
      "superclassifier": {
        "startByte": 1526,
        "endByte": 1531,
        "startOffset": 1526,
        "endOffset": 1531
      }
    },
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
    "startOffset": 1537,
    "endOffset": 1573,
    "fieldRanges": {
      "name": {
        "startByte": 1560,
        "endByte": 1564,
        "startOffset": 1560,
        "endOffset": 1564
      },
      "declaredName": {
        "startByte": 1560,
        "endByte": 1564,
        "startOffset": 1560,
        "endOffset": 1564
      }
    },
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
    "startOffset": 1567,
    "endOffset": 1572,
    "fieldRanges": {
      "name": {
        "startByte": 1567,
        "endByte": 1572,
        "startOffset": 1567,
        "endOffset": 1572
      },
      "superclassifier": {
        "startByte": 1567,
        "endByte": 1572,
        "startOffset": 1567,
        "endOffset": 1572
      }
    },
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
    "startOffset": 1578,
    "endOffset": 1617,
    "fieldRanges": {
      "name": {
        "startByte": 1601,
        "endByte": 1608,
        "startOffset": 1601,
        "endOffset": 1608
      },
      "declaredName": {
        "startByte": 1601,
        "endByte": 1608,
        "startOffset": 1601,
        "endOffset": 1608
      }
    },
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
    "startOffset": 1611,
    "endOffset": 1616,
    "fieldRanges": {
      "name": {
        "startByte": 1611,
        "endByte": 1616,
        "startOffset": 1611,
        "endOffset": 1616
      },
      "superclassifier": {
        "startByte": 1611,
        "endByte": 1616,
        "startOffset": 1611,
        "endOffset": 1616
      }
    },
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
    "startOffset": 1619,
    "endOffset": 1967,
    "fieldRanges": {
      "name": {
        "startByte": 1629,
        "endByte": 1643,
        "startOffset": 1629,
        "endOffset": 1643
      },
      "declaredName": {
        "startByte": 1629,
        "endByte": 1643,
        "startOffset": 1629,
        "endOffset": 1643
      }
    },
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
    "startOffset": 1645,
    "endOffset": 1672,
    "fieldRanges": {
      "name": {
        "startByte": 1656,
        "endByte": 1669,
        "startOffset": 1656,
        "endOffset": 1669
      },
      "importedNamespace": {
        "startByte": 1656,
        "endByte": 1669,
        "startOffset": 1656,
        "endOffset": 1669
      }
    },
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
    "startOffset": 1678,
    "endOffset": 1716,
    "fieldRanges": {
      "name": {
        "startByte": 1701,
        "endByte": 1707,
        "startOffset": 1701,
        "endOffset": 1707
      },
      "declaredName": {
        "startByte": 1701,
        "endByte": 1707,
        "startOffset": 1701,
        "endOffset": 1707
      }
    },
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
    "startOffset": 1710,
    "endOffset": 1715,
    "fieldRanges": {
      "name": {
        "startByte": 1710,
        "endByte": 1715,
        "startOffset": 1710,
        "endOffset": 1715
      },
      "superclassifier": {
        "startByte": 1710,
        "endByte": 1715,
        "startOffset": 1710,
        "endOffset": 1715
      }
    },
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
    "startOffset": 1721,
    "endOffset": 1759,
    "fieldRanges": {
      "name": {
        "startByte": 1744,
        "endByte": 1750,
        "startOffset": 1744,
        "endOffset": 1750
      },
      "declaredName": {
        "startByte": 1744,
        "endByte": 1750,
        "startOffset": 1744,
        "endOffset": 1750
      }
    },
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
    "startOffset": 1753,
    "endOffset": 1758,
    "fieldRanges": {
      "name": {
        "startByte": 1753,
        "endByte": 1758,
        "startOffset": 1753,
        "endOffset": 1758
      },
      "superclassifier": {
        "startByte": 1753,
        "endByte": 1758,
        "startOffset": 1753,
        "endOffset": 1758
      }
    },
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
    "startOffset": 1764,
    "endOffset": 1801,
    "fieldRanges": {
      "name": {
        "startByte": 1787,
        "endByte": 1792,
        "startOffset": 1787,
        "endOffset": 1792
      },
      "declaredName": {
        "startByte": 1787,
        "endByte": 1792,
        "startOffset": 1787,
        "endOffset": 1792
      }
    },
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
    "startOffset": 1795,
    "endOffset": 1800,
    "fieldRanges": {
      "name": {
        "startByte": 1795,
        "endByte": 1800,
        "startOffset": 1795,
        "endOffset": 1800
      },
      "superclassifier": {
        "startByte": 1795,
        "endByte": 1800,
        "startOffset": 1795,
        "endOffset": 1800
      }
    },
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
    "startOffset": 1806,
    "endOffset": 1842,
    "fieldRanges": {
      "name": {
        "startByte": 1829,
        "endByte": 1833,
        "startOffset": 1829,
        "endOffset": 1833
      },
      "declaredName": {
        "startByte": 1829,
        "endByte": 1833,
        "startOffset": 1829,
        "endOffset": 1833
      }
    },
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
    "startOffset": 1836,
    "endOffset": 1841,
    "fieldRanges": {
      "name": {
        "startByte": 1836,
        "endByte": 1841,
        "startOffset": 1836,
        "endOffset": 1841
      },
      "superclassifier": {
        "startByte": 1836,
        "endByte": 1841,
        "startOffset": 1836,
        "endOffset": 1841
      }
    },
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
    "startOffset": 1847,
    "endOffset": 1883,
    "fieldRanges": {
      "name": {
        "startByte": 1870,
        "endByte": 1874,
        "startOffset": 1870,
        "endOffset": 1874
      },
      "declaredName": {
        "startByte": 1870,
        "endByte": 1874,
        "startOffset": 1870,
        "endOffset": 1874
      }
    },
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
    "startOffset": 1877,
    "endOffset": 1882,
    "fieldRanges": {
      "name": {
        "startByte": 1877,
        "endByte": 1882,
        "startOffset": 1877,
        "endOffset": 1882
      },
      "superclassifier": {
        "startByte": 1877,
        "endByte": 1882,
        "startOffset": 1877,
        "endOffset": 1882
      }
    },
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
    "startOffset": 1888,
    "endOffset": 1923,
    "fieldRanges": {
      "name": {
        "startByte": 1911,
        "endByte": 1914,
        "startOffset": 1911,
        "endOffset": 1914
      },
      "declaredName": {
        "startByte": 1911,
        "endByte": 1914,
        "startOffset": 1911,
        "endOffset": 1914
      }
    },
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
    "startOffset": 1917,
    "endOffset": 1922,
    "fieldRanges": {
      "name": {
        "startByte": 1917,
        "endByte": 1922,
        "startOffset": 1917,
        "endOffset": 1922
      },
      "superclassifier": {
        "startByte": 1917,
        "endByte": 1922,
        "startOffset": 1917,
        "endOffset": 1922
      }
    },
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
    "startOffset": 1928,
    "endOffset": 1965,
    "fieldRanges": {
      "name": {
        "startByte": 1951,
        "endByte": 1956,
        "startOffset": 1951,
        "endOffset": 1956
      },
      "declaredName": {
        "startByte": 1951,
        "endByte": 1956,
        "startOffset": 1951,
        "endOffset": 1956
      }
    },
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
    "startOffset": 1959,
    "endOffset": 1964,
    "fieldRanges": {
      "name": {
        "startByte": 1959,
        "endByte": 1964,
        "startOffset": 1959,
        "endOffset": 1964
      },
      "superclassifier": {
        "startByte": 1959,
        "endByte": 1964,
        "startOffset": 1959,
        "endOffset": 1964
      }
    },
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
    "startOffset": 1967,
    "endOffset": 2109,
    "fieldRanges": {
      "name": {
        "startByte": 1977,
        "endByte": 1988,
        "startOffset": 1977,
        "endOffset": 1988
      },
      "declaredName": {
        "startByte": 1977,
        "endByte": 1988,
        "startOffset": 1977,
        "endOffset": 1988
      }
    },
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
    "startOffset": 1995,
    "endOffset": 2024,
    "fieldRanges": {
      "name": {
        "startByte": 2013,
        "endByte": 2023,
        "startOffset": 2013,
        "endOffset": 2023
      },
      "declaredName": {
        "startByte": 2013,
        "endByte": 2023,
        "startOffset": 2013,
        "endOffset": 2023
      }
    },
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
    "startOffset": 2029,
    "endOffset": 2066,
    "fieldRanges": {
      "name": {
        "startByte": 2047,
        "endByte": 2051,
        "startOffset": 2047,
        "endOffset": 2051
      },
      "declaredName": {
        "startByte": 2047,
        "endByte": 2051,
        "startOffset": 2047,
        "endOffset": 2051
      }
    },
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
    "startOffset": 2054,
    "endOffset": 2065,
    "fieldRanges": {
      "name": {
        "startByte": 2054,
        "endByte": 2065,
        "startOffset": 2054,
        "endOffset": 2065
      },
      "superclassifier": {
        "startByte": 2054,
        "endByte": 2065,
        "startOffset": 2054,
        "endOffset": 2065
      }
    },
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
    "startOffset": 2071,
    "endOffset": 2107,
    "fieldRanges": {
      "name": {
        "startByte": 2089,
        "endByte": 2092,
        "startOffset": 2089,
        "endOffset": 2092
      },
      "declaredName": {
        "startByte": 2089,
        "endByte": 2092,
        "startOffset": 2089,
        "endOffset": 2092
      }
    },
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
    "startOffset": 2095,
    "endOffset": 2106,
    "fieldRanges": {
      "name": {
        "startByte": 2095,
        "endByte": 2106,
        "startOffset": 2095,
        "endOffset": 2106
      },
      "superclassifier": {
        "startByte": 2095,
        "endByte": 2106,
        "startOffset": 2095,
        "endOffset": 2106
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 86,
    "kind": "Package",
    "name": "Base",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2109,
    "endByte": 2497,
    "startOffset": 2109,
    "endOffset": 2497,
    "fieldRanges": {
      "name": {
        "startByte": 2119,
        "endByte": 2123,
        "startOffset": 2119,
        "endOffset": 2123
      },
      "declaredName": {
        "startByte": 2119,
        "endByte": 2123,
        "startOffset": 2119,
        "endOffset": 2123
      }
    },
    "exports": [
      "package Base {\n    abstract item def Anything;\n    abstract item def Element :> Anything;\n    abstract item def Feature :> Element;\n    abstract item def Type :> Element;\n    abstract item def Classifier :> Type;\n    abstract item def DataType :> Classifier;\n    abstract item def Class :> Classifier;\n    abstract item def Structure :> Class;\n    abstract item def Behavior :> Class;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 87,
    "kind": "Definition",
    "name": "Anything",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2130,
    "endByte": 2157,
    "startOffset": 2130,
    "endOffset": 2157,
    "fieldRanges": {
      "name": {
        "startByte": 2148,
        "endByte": 2156,
        "startOffset": 2148,
        "endOffset": 2156
      },
      "declaredName": {
        "startByte": 2148,
        "endByte": 2156,
        "startOffset": 2148,
        "endOffset": 2156
      }
    },
    "exports": [
      "abstract item def Anything;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 88,
    "kind": "Definition",
    "name": "Element",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2162,
    "endByte": 2200,
    "startOffset": 2162,
    "endOffset": 2200,
    "fieldRanges": {
      "name": {
        "startByte": 2180,
        "endByte": 2187,
        "startOffset": 2180,
        "endOffset": 2187
      },
      "declaredName": {
        "startByte": 2180,
        "endByte": 2187,
        "startOffset": 2180,
        "endOffset": 2187
      }
    },
    "exports": [
      "abstract item def Element :> Anything;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 89,
    "kind": "Reference",
    "name": "Anything",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 88,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2190,
    "endByte": 2199,
    "startOffset": 2190,
    "endOffset": 2199,
    "fieldRanges": {
      "name": {
        "startByte": 2190,
        "endByte": 2199,
        "startOffset": 2190,
        "endOffset": 2199
      },
      "superclassifier": {
        "startByte": 2190,
        "endByte": 2199,
        "startOffset": 2190,
        "endOffset": 2199
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 90,
    "kind": "Definition",
    "name": "Feature",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2205,
    "endByte": 2242,
    "startOffset": 2205,
    "endOffset": 2242,
    "fieldRanges": {
      "name": {
        "startByte": 2223,
        "endByte": 2230,
        "startOffset": 2223,
        "endOffset": 2230
      },
      "declaredName": {
        "startByte": 2223,
        "endByte": 2230,
        "startOffset": 2223,
        "endOffset": 2230
      }
    },
    "exports": [
      "abstract item def Feature :> Element;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 91,
    "kind": "Reference",
    "name": "Element",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 90,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2233,
    "endByte": 2241,
    "startOffset": 2233,
    "endOffset": 2241,
    "fieldRanges": {
      "name": {
        "startByte": 2233,
        "endByte": 2241,
        "startOffset": 2233,
        "endOffset": 2241
      },
      "superclassifier": {
        "startByte": 2233,
        "endByte": 2241,
        "startOffset": 2233,
        "endOffset": 2241
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 92,
    "kind": "Definition",
    "name": "Type",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2247,
    "endByte": 2281,
    "startOffset": 2247,
    "endOffset": 2281,
    "fieldRanges": {
      "name": {
        "startByte": 2265,
        "endByte": 2269,
        "startOffset": 2265,
        "endOffset": 2269
      },
      "declaredName": {
        "startByte": 2265,
        "endByte": 2269,
        "startOffset": 2265,
        "endOffset": 2269
      }
    },
    "exports": [
      "abstract item def Type :> Element;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 93,
    "kind": "Reference",
    "name": "Element",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 92,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2272,
    "endByte": 2280,
    "startOffset": 2272,
    "endOffset": 2280,
    "fieldRanges": {
      "name": {
        "startByte": 2272,
        "endByte": 2280,
        "startOffset": 2272,
        "endOffset": 2280
      },
      "superclassifier": {
        "startByte": 2272,
        "endByte": 2280,
        "startOffset": 2272,
        "endOffset": 2280
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 94,
    "kind": "Definition",
    "name": "Classifier",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2286,
    "endByte": 2323,
    "startOffset": 2286,
    "endOffset": 2323,
    "fieldRanges": {
      "name": {
        "startByte": 2304,
        "endByte": 2314,
        "startOffset": 2304,
        "endOffset": 2314
      },
      "declaredName": {
        "startByte": 2304,
        "endByte": 2314,
        "startOffset": 2304,
        "endOffset": 2314
      }
    },
    "exports": [
      "abstract item def Classifier :> Type;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 95,
    "kind": "Reference",
    "name": "Type",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 94,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2317,
    "endByte": 2322,
    "startOffset": 2317,
    "endOffset": 2322,
    "fieldRanges": {
      "name": {
        "startByte": 2317,
        "endByte": 2322,
        "startOffset": 2317,
        "endOffset": 2322
      },
      "superclassifier": {
        "startByte": 2317,
        "endByte": 2322,
        "startOffset": 2317,
        "endOffset": 2322
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 96,
    "kind": "Definition",
    "name": "DataType",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2328,
    "endByte": 2369,
    "startOffset": 2328,
    "endOffset": 2369,
    "fieldRanges": {
      "name": {
        "startByte": 2346,
        "endByte": 2354,
        "startOffset": 2346,
        "endOffset": 2354
      },
      "declaredName": {
        "startByte": 2346,
        "endByte": 2354,
        "startOffset": 2346,
        "endOffset": 2354
      }
    },
    "exports": [
      "abstract item def DataType :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 97,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 96,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2357,
    "endByte": 2368,
    "startOffset": 2357,
    "endOffset": 2368,
    "fieldRanges": {
      "name": {
        "startByte": 2357,
        "endByte": 2368,
        "startOffset": 2357,
        "endOffset": 2368
      },
      "superclassifier": {
        "startByte": 2357,
        "endByte": 2368,
        "startOffset": 2357,
        "endOffset": 2368
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 98,
    "kind": "Definition",
    "name": "Class",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2374,
    "endByte": 2412,
    "startOffset": 2374,
    "endOffset": 2412,
    "fieldRanges": {
      "name": {
        "startByte": 2392,
        "endByte": 2397,
        "startOffset": 2392,
        "endOffset": 2397
      },
      "declaredName": {
        "startByte": 2392,
        "endByte": 2397,
        "startOffset": 2392,
        "endOffset": 2397
      }
    },
    "exports": [
      "abstract item def Class :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 99,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 98,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2400,
    "endByte": 2411,
    "startOffset": 2400,
    "endOffset": 2411,
    "fieldRanges": {
      "name": {
        "startByte": 2400,
        "endByte": 2411,
        "startOffset": 2400,
        "endOffset": 2411
      },
      "superclassifier": {
        "startByte": 2400,
        "endByte": 2411,
        "startOffset": 2400,
        "endOffset": 2411
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 100,
    "kind": "Definition",
    "name": "Structure",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2417,
    "endByte": 2454,
    "startOffset": 2417,
    "endOffset": 2454,
    "fieldRanges": {
      "name": {
        "startByte": 2435,
        "endByte": 2444,
        "startOffset": 2435,
        "endOffset": 2444
      },
      "declaredName": {
        "startByte": 2435,
        "endByte": 2444,
        "startOffset": 2435,
        "endOffset": 2444
      }
    },
    "exports": [
      "abstract item def Structure :> Class;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 101,
    "kind": "Reference",
    "name": "Class",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 100,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2447,
    "endByte": 2453,
    "startOffset": 2447,
    "endOffset": 2453,
    "fieldRanges": {
      "name": {
        "startByte": 2447,
        "endByte": 2453,
        "startOffset": 2447,
        "endOffset": 2453
      },
      "superclassifier": {
        "startByte": 2447,
        "endByte": 2453,
        "startOffset": 2447,
        "endOffset": 2453
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 102,
    "kind": "Definition",
    "name": "Behavior",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 86,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2459,
    "endByte": 2495,
    "startOffset": 2459,
    "endOffset": 2495,
    "fieldRanges": {
      "name": {
        "startByte": 2477,
        "endByte": 2485,
        "startOffset": 2477,
        "endOffset": 2485
      },
      "declaredName": {
        "startByte": 2477,
        "endByte": 2485,
        "startOffset": 2477,
        "endOffset": 2485
      }
    },
    "exports": [
      "abstract item def Behavior :> Class;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 103,
    "kind": "Reference",
    "name": "Class",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 102,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2488,
    "endByte": 2494,
    "startOffset": 2488,
    "endOffset": 2494,
    "fieldRanges": {
      "name": {
        "startByte": 2488,
        "endByte": 2494,
        "startOffset": 2488,
        "endOffset": 2494
      },
      "superclassifier": {
        "startByte": 2488,
        "endByte": 2494,
        "startOffset": 2488,
        "endOffset": 2494
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 104,
    "kind": "Package",
    "name": "Control",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2497,
    "endByte": 2756,
    "startOffset": 2497,
    "endOffset": 2756,
    "fieldRanges": {
      "name": {
        "startByte": 2507,
        "endByte": 2514,
        "startOffset": 2507,
        "endOffset": 2514
      },
      "declaredName": {
        "startByte": 2507,
        "endByte": 2514,
        "startOffset": 2507,
        "endOffset": 2514
      }
    },
    "exports": [
      "package Control {\n    abstract action def ControlNode;\n    abstract action def MergeNode :> ControlNode;\n    abstract action def DecisionNode :> ControlNode;\n    abstract action def ForkNode :> ControlNode;\n    abstract action def JoinNode :> ControlNode;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 105,
    "kind": "Definition",
    "name": "ControlNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2521,
    "endByte": 2553,
    "startOffset": 2521,
    "endOffset": 2553,
    "fieldRanges": {
      "name": {
        "startByte": 2541,
        "endByte": 2552,
        "startOffset": 2541,
        "endOffset": 2552
      },
      "declaredName": {
        "startByte": 2541,
        "endByte": 2552,
        "startOffset": 2541,
        "endOffset": 2552
      }
    },
    "exports": [
      "abstract action def ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 106,
    "kind": "Definition",
    "name": "MergeNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2558,
    "endByte": 2603,
    "startOffset": 2558,
    "endOffset": 2603,
    "fieldRanges": {
      "name": {
        "startByte": 2578,
        "endByte": 2587,
        "startOffset": 2578,
        "endOffset": 2587
      },
      "declaredName": {
        "startByte": 2578,
        "endByte": 2587,
        "startOffset": 2578,
        "endOffset": 2587
      }
    },
    "exports": [
      "abstract action def MergeNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 107,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 106,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2590,
    "endByte": 2602,
    "startOffset": 2590,
    "endOffset": 2602,
    "fieldRanges": {
      "name": {
        "startByte": 2590,
        "endByte": 2602,
        "startOffset": 2590,
        "endOffset": 2602
      },
      "superclassifier": {
        "startByte": 2590,
        "endByte": 2602,
        "startOffset": 2590,
        "endOffset": 2602
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 108,
    "kind": "Definition",
    "name": "DecisionNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2608,
    "endByte": 2656,
    "startOffset": 2608,
    "endOffset": 2656,
    "fieldRanges": {
      "name": {
        "startByte": 2628,
        "endByte": 2640,
        "startOffset": 2628,
        "endOffset": 2640
      },
      "declaredName": {
        "startByte": 2628,
        "endByte": 2640,
        "startOffset": 2628,
        "endOffset": 2640
      }
    },
    "exports": [
      "abstract action def DecisionNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 109,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 108,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2643,
    "endByte": 2655,
    "startOffset": 2643,
    "endOffset": 2655,
    "fieldRanges": {
      "name": {
        "startByte": 2643,
        "endByte": 2655,
        "startOffset": 2643,
        "endOffset": 2655
      },
      "superclassifier": {
        "startByte": 2643,
        "endByte": 2655,
        "startOffset": 2643,
        "endOffset": 2655
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 110,
    "kind": "Definition",
    "name": "ForkNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2661,
    "endByte": 2705,
    "startOffset": 2661,
    "endOffset": 2705,
    "fieldRanges": {
      "name": {
        "startByte": 2681,
        "endByte": 2689,
        "startOffset": 2681,
        "endOffset": 2689
      },
      "declaredName": {
        "startByte": 2681,
        "endByte": 2689,
        "startOffset": 2681,
        "endOffset": 2689
      }
    },
    "exports": [
      "abstract action def ForkNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 111,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 110,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2692,
    "endByte": 2704,
    "startOffset": 2692,
    "endOffset": 2704,
    "fieldRanges": {
      "name": {
        "startByte": 2692,
        "endByte": 2704,
        "startOffset": 2692,
        "endOffset": 2704
      },
      "superclassifier": {
        "startByte": 2692,
        "endByte": 2704,
        "startOffset": 2692,
        "endOffset": 2704
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 112,
    "kind": "Definition",
    "name": "JoinNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2710,
    "endByte": 2754,
    "startOffset": 2710,
    "endOffset": 2754,
    "fieldRanges": {
      "name": {
        "startByte": 2730,
        "endByte": 2738,
        "startOffset": 2730,
        "endOffset": 2738
      },
      "declaredName": {
        "startByte": 2730,
        "endByte": 2738,
        "startOffset": 2730,
        "endOffset": 2738
      }
    },
    "exports": [
      "abstract action def JoinNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 113,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 112,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2741,
    "endByte": 2753,
    "startOffset": 2741,
    "endOffset": 2753,
    "fieldRanges": {
      "name": {
        "startByte": 2741,
        "endByte": 2753,
        "startOffset": 2741,
        "endOffset": 2753
      },
      "superclassifier": {
        "startByte": 2741,
        "endByte": 2753,
        "startOffset": 2741,
        "endOffset": 2753
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 114,
    "kind": "Package",
    "name": "Transfers",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2756,
    "endByte": 2894,
    "startOffset": 2756,
    "endOffset": 2894,
    "fieldRanges": {
      "name": {
        "startByte": 2766,
        "endByte": 2775,
        "startOffset": 2766,
        "endOffset": 2775
      },
      "declaredName": {
        "startByte": 2766,
        "endByte": 2775,
        "startOffset": 2766,
        "endOffset": 2775
      }
    },
    "exports": [
      "package Transfers {\n    abstract item def Transfer;\n    abstract item def Flow :> Transfer;\n    abstract item def Message :> Transfer;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 115,
    "kind": "Definition",
    "name": "Transfer",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2782,
    "endByte": 2809,
    "startOffset": 2782,
    "endOffset": 2809,
    "fieldRanges": {
      "name": {
        "startByte": 2800,
        "endByte": 2808,
        "startOffset": 2800,
        "endOffset": 2808
      },
      "declaredName": {
        "startByte": 2800,
        "endByte": 2808,
        "startOffset": 2800,
        "endOffset": 2808
      }
    },
    "exports": [
      "abstract item def Transfer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 116,
    "kind": "Definition",
    "name": "Flow",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2814,
    "endByte": 2849,
    "startOffset": 2814,
    "endOffset": 2849,
    "fieldRanges": {
      "name": {
        "startByte": 2832,
        "endByte": 2836,
        "startOffset": 2832,
        "endOffset": 2836
      },
      "declaredName": {
        "startByte": 2832,
        "endByte": 2836,
        "startOffset": 2832,
        "endOffset": 2836
      }
    },
    "exports": [
      "abstract item def Flow :> Transfer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 117,
    "kind": "Reference",
    "name": "Transfer",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 116,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2839,
    "endByte": 2848,
    "startOffset": 2839,
    "endOffset": 2848,
    "fieldRanges": {
      "name": {
        "startByte": 2839,
        "endByte": 2848,
        "startOffset": 2839,
        "endOffset": 2848
      },
      "superclassifier": {
        "startByte": 2839,
        "endByte": 2848,
        "startOffset": 2839,
        "endOffset": 2848
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 118,
    "kind": "Definition",
    "name": "Message",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2854,
    "endByte": 2892,
    "startOffset": 2854,
    "endOffset": 2892,
    "fieldRanges": {
      "name": {
        "startByte": 2872,
        "endByte": 2879,
        "startOffset": 2872,
        "endOffset": 2879
      },
      "declaredName": {
        "startByte": 2872,
        "endByte": 2879,
        "startOffset": 2872,
        "endOffset": 2879
      }
    },
    "exports": [
      "abstract item def Message :> Transfer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 119,
    "kind": "Reference",
    "name": "Transfer",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 118,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2882,
    "endByte": 2891,
    "startOffset": 2882,
    "endOffset": 2891,
    "fieldRanges": {
      "name": {
        "startByte": 2882,
        "endByte": 2891,
        "startOffset": 2882,
        "endOffset": 2891
      },
      "superclassifier": {
        "startByte": 2882,
        "endByte": 2891,
        "startOffset": 2882,
        "endOffset": 2891
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 120,
    "kind": "Package",
    "name": "Performances",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2894,
    "endByte": 3058,
    "startOffset": 2894,
    "endOffset": 3058,
    "fieldRanges": {
      "name": {
        "startByte": 2904,
        "endByte": 2916,
        "startOffset": 2904,
        "endOffset": 2916
      },
      "declaredName": {
        "startByte": 2904,
        "endByte": 2916,
        "startOffset": 2904,
        "endOffset": 2916
      }
    },
    "exports": [
      "package Performances {\n    abstract action def Performance;\n    abstract action def Evaluation :> Performance;\n    abstract action def Execution :> Performance;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 121,
    "kind": "Definition",
    "name": "Performance",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2923,
    "endByte": 2955,
    "startOffset": 2923,
    "endOffset": 2955,
    "fieldRanges": {
      "name": {
        "startByte": 2943,
        "endByte": 2954,
        "startOffset": 2943,
        "endOffset": 2954
      },
      "declaredName": {
        "startByte": 2943,
        "endByte": 2954,
        "startOffset": 2943,
        "endOffset": 2954
      }
    },
    "exports": [
      "abstract action def Performance;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 122,
    "kind": "Definition",
    "name": "Evaluation",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2960,
    "endByte": 3006,
    "startOffset": 2960,
    "endOffset": 3006,
    "fieldRanges": {
      "name": {
        "startByte": 2980,
        "endByte": 2990,
        "startOffset": 2980,
        "endOffset": 2990
      },
      "declaredName": {
        "startByte": 2980,
        "endByte": 2990,
        "startOffset": 2980,
        "endOffset": 2990
      }
    },
    "exports": [
      "abstract action def Evaluation :> Performance;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 123,
    "kind": "Reference",
    "name": "Performance",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 122,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 2993,
    "endByte": 3005,
    "startOffset": 2993,
    "endOffset": 3005,
    "fieldRanges": {
      "name": {
        "startByte": 2993,
        "endByte": 3005,
        "startOffset": 2993,
        "endOffset": 3005
      },
      "superclassifier": {
        "startByte": 2993,
        "endByte": 3005,
        "startOffset": 2993,
        "endOffset": 3005
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 124,
    "kind": "Definition",
    "name": "Execution",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 3011,
    "endByte": 3056,
    "startOffset": 3011,
    "endOffset": 3056,
    "fieldRanges": {
      "name": {
        "startByte": 3031,
        "endByte": 3040,
        "startOffset": 3031,
        "endOffset": 3040
      },
      "declaredName": {
        "startByte": 3031,
        "endByte": 3040,
        "startOffset": 3031,
        "endOffset": 3040
      }
    },
    "exports": [
      "abstract action def Execution :> Performance;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null
    }
  },
  {
    "id": 125,
    "kind": "Reference",
    "name": "Performance",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 124,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startByte": 3043,
    "endByte": 3055,
    "startOffset": 3043,
    "endOffset": 3055,
    "fieldRanges": {
      "name": {
        "startByte": 3043,
        "endByte": 3055,
        "startOffset": 3043,
        "endOffset": 3055
      },
      "superclassifier": {
        "startByte": 3043,
        "endByte": 3055,
        "startOffset": 3043,
        "endOffset": 3055
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  }
];
