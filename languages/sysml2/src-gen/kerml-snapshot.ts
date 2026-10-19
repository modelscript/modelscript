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
    "startOffset": 555,
    "endOffset": 943,
    "fieldRanges": {
      "name": {
        "startOffset": 563,
        "endOffset": 575
      },
      "declaredName": {
        "startOffset": 563,
        "endOffset": 575
      }
    },
    "exports": [
      "package ScalarValues {\n    abstract attribute def Real;\n    abstract attribute def Integer;\n    abstract attribute def Boolean;\n    abstract attribute def String;\n    abstract attribute def Natural :> Integer;\n    abstract attribute def Positive :> Integer;\n    abstract attribute def UnlimitedNatural :> Natural;\n    abstract attribute def Complex;\n    abstract attribute def Rational;\n}"
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
    "startOffset": 582,
    "endOffset": 610,
    "fieldRanges": {
      "name": {
        "startOffset": 605,
        "endOffset": 609
      },
      "declaredName": {
        "startOffset": 605,
        "endOffset": 609
      }
    },
    "exports": [
      "abstract attribute def Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
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
    "startOffset": 615,
    "endOffset": 646,
    "fieldRanges": {
      "name": {
        "startOffset": 638,
        "endOffset": 645
      },
      "declaredName": {
        "startOffset": 638,
        "endOffset": 645
      }
    },
    "exports": [
      "abstract attribute def Integer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
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
    "startOffset": 651,
    "endOffset": 682,
    "fieldRanges": {
      "name": {
        "startOffset": 674,
        "endOffset": 681
      },
      "declaredName": {
        "startOffset": 674,
        "endOffset": 681
      }
    },
    "exports": [
      "abstract attribute def Boolean;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
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
    "startOffset": 687,
    "endOffset": 717,
    "fieldRanges": {
      "name": {
        "startOffset": 710,
        "endOffset": 716
      },
      "declaredName": {
        "startOffset": 710,
        "endOffset": 716
      }
    },
    "exports": [
      "abstract attribute def String;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
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
    "startOffset": 722,
    "endOffset": 764,
    "fieldRanges": {
      "name": {
        "startOffset": 745,
        "endOffset": 752
      },
      "declaredName": {
        "startOffset": 745,
        "endOffset": 752
      }
    },
    "exports": [
      "abstract attribute def Natural :> Integer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Integer"
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
    "startOffset": 756,
    "endOffset": 763,
    "fieldRanges": {
      "name": {
        "startOffset": 756,
        "endOffset": 763
      },
      "superclassifier": {
        "startOffset": 756,
        "endOffset": 763
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
    "startOffset": 769,
    "endOffset": 812,
    "fieldRanges": {
      "name": {
        "startOffset": 792,
        "endOffset": 800
      },
      "declaredName": {
        "startOffset": 792,
        "endOffset": 800
      }
    },
    "exports": [
      "abstract attribute def Positive :> Integer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Integer"
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
    "startOffset": 804,
    "endOffset": 811,
    "fieldRanges": {
      "name": {
        "startOffset": 804,
        "endOffset": 811
      },
      "superclassifier": {
        "startOffset": 804,
        "endOffset": 811
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 10,
    "kind": "Definition",
    "name": "UnlimitedNatural",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 817,
    "endOffset": 868,
    "fieldRanges": {
      "name": {
        "startOffset": 840,
        "endOffset": 856
      },
      "declaredName": {
        "startOffset": 840,
        "endOffset": 856
      }
    },
    "exports": [
      "abstract attribute def UnlimitedNatural :> Natural;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Natural"
    }
  },
  {
    "id": 11,
    "kind": "Reference",
    "name": "Natural",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 10,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 860,
    "endOffset": 867,
    "fieldRanges": {
      "name": {
        "startOffset": 860,
        "endOffset": 867
      },
      "superclassifier": {
        "startOffset": 860,
        "endOffset": 867
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 12,
    "kind": "Definition",
    "name": "Complex",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 873,
    "endOffset": 904,
    "fieldRanges": {
      "name": {
        "startOffset": 896,
        "endOffset": 903
      },
      "declaredName": {
        "startOffset": 896,
        "endOffset": 903
      }
    },
    "exports": [
      "abstract attribute def Complex;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 13,
    "kind": "Definition",
    "name": "Rational",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 1,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 909,
    "endOffset": 941,
    "fieldRanges": {
      "name": {
        "startOffset": 932,
        "endOffset": 940
      },
      "declaredName": {
        "startOffset": 932,
        "endOffset": 940
      }
    },
    "exports": [
      "abstract attribute def Rational;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 14,
    "kind": "Package",
    "name": "Base",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 945,
    "endOffset": 1733,
    "fieldRanges": {
      "name": {
        "startOffset": 953,
        "endOffset": 957
      },
      "declaredName": {
        "startOffset": 953,
        "endOffset": 957
      }
    },
    "exports": [
      "package Base {\n    abstract item def Anything;\n    abstract item def Element :> Anything;\n    abstract item def Feature :> Element;\n    abstract item def Type :> Element;\n    abstract item def Classifier :> Type;\n    abstract item def DataType :> Classifier;\n    abstract item def Class :> Classifier;\n    abstract item def Structure :> Class;\n    abstract item def Behavior :> Class;\n    abstract item def Occurrence :> Class;\n    abstract item def Life :> Occurrence;\n    abstract item def Snapshot :> Occurrence;\n    abstract item def Link :> Relationship;\n    abstract item def Relationship :> Element;\n    abstract item def Association :> Classifier;\n    abstract item def Connector :> Feature;\n    abstract item def Interface :> Feature;\n    abstract item def Metadata :> Feature;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 15,
    "kind": "Definition",
    "name": "Anything",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 964,
    "endOffset": 991,
    "fieldRanges": {
      "name": {
        "startOffset": 982,
        "endOffset": 990
      },
      "declaredName": {
        "startOffset": 982,
        "endOffset": 990
      }
    },
    "exports": [
      "abstract item def Anything;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 16,
    "kind": "Definition",
    "name": "Element",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 996,
    "endOffset": 1034,
    "fieldRanges": {
      "name": {
        "startOffset": 1014,
        "endOffset": 1021
      },
      "declaredName": {
        "startOffset": 1014,
        "endOffset": 1021
      }
    },
    "exports": [
      "abstract item def Element :> Anything;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Anything"
    }
  },
  {
    "id": 17,
    "kind": "Reference",
    "name": "Anything",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 16,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1025,
    "endOffset": 1033,
    "fieldRanges": {
      "name": {
        "startOffset": 1025,
        "endOffset": 1033
      },
      "superclassifier": {
        "startOffset": 1025,
        "endOffset": 1033
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 18,
    "kind": "Definition",
    "name": "Feature",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1039,
    "endOffset": 1076,
    "fieldRanges": {
      "name": {
        "startOffset": 1057,
        "endOffset": 1064
      },
      "declaredName": {
        "startOffset": 1057,
        "endOffset": 1064
      }
    },
    "exports": [
      "abstract item def Feature :> Element;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Element"
    }
  },
  {
    "id": 19,
    "kind": "Reference",
    "name": "Element",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 18,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1068,
    "endOffset": 1075,
    "fieldRanges": {
      "name": {
        "startOffset": 1068,
        "endOffset": 1075
      },
      "superclassifier": {
        "startOffset": 1068,
        "endOffset": 1075
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 20,
    "kind": "Definition",
    "name": "Type",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1081,
    "endOffset": 1115,
    "fieldRanges": {
      "name": {
        "startOffset": 1099,
        "endOffset": 1103
      },
      "declaredName": {
        "startOffset": 1099,
        "endOffset": 1103
      }
    },
    "exports": [
      "abstract item def Type :> Element;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Element"
    }
  },
  {
    "id": 21,
    "kind": "Reference",
    "name": "Element",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 20,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1107,
    "endOffset": 1114,
    "fieldRanges": {
      "name": {
        "startOffset": 1107,
        "endOffset": 1114
      },
      "superclassifier": {
        "startOffset": 1107,
        "endOffset": 1114
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 22,
    "kind": "Definition",
    "name": "Classifier",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1120,
    "endOffset": 1157,
    "fieldRanges": {
      "name": {
        "startOffset": 1138,
        "endOffset": 1148
      },
      "declaredName": {
        "startOffset": 1138,
        "endOffset": 1148
      }
    },
    "exports": [
      "abstract item def Classifier :> Type;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Type"
    }
  },
  {
    "id": 23,
    "kind": "Reference",
    "name": "Type",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 22,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1152,
    "endOffset": 1156,
    "fieldRanges": {
      "name": {
        "startOffset": 1152,
        "endOffset": 1156
      },
      "superclassifier": {
        "startOffset": 1152,
        "endOffset": 1156
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 24,
    "kind": "Definition",
    "name": "DataType",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1162,
    "endOffset": 1203,
    "fieldRanges": {
      "name": {
        "startOffset": 1180,
        "endOffset": 1188
      },
      "declaredName": {
        "startOffset": 1180,
        "endOffset": 1188
      }
    },
    "exports": [
      "abstract item def DataType :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Classifier"
    }
  },
  {
    "id": 25,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 24,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1192,
    "endOffset": 1202,
    "fieldRanges": {
      "name": {
        "startOffset": 1192,
        "endOffset": 1202
      },
      "superclassifier": {
        "startOffset": 1192,
        "endOffset": 1202
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 26,
    "kind": "Definition",
    "name": "Class",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1208,
    "endOffset": 1246,
    "fieldRanges": {
      "name": {
        "startOffset": 1226,
        "endOffset": 1231
      },
      "declaredName": {
        "startOffset": 1226,
        "endOffset": 1231
      }
    },
    "exports": [
      "abstract item def Class :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Classifier"
    }
  },
  {
    "id": 27,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 26,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1235,
    "endOffset": 1245,
    "fieldRanges": {
      "name": {
        "startOffset": 1235,
        "endOffset": 1245
      },
      "superclassifier": {
        "startOffset": 1235,
        "endOffset": 1245
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 28,
    "kind": "Definition",
    "name": "Structure",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1251,
    "endOffset": 1288,
    "fieldRanges": {
      "name": {
        "startOffset": 1269,
        "endOffset": 1278
      },
      "declaredName": {
        "startOffset": 1269,
        "endOffset": 1278
      }
    },
    "exports": [
      "abstract item def Structure :> Class;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Class"
    }
  },
  {
    "id": 29,
    "kind": "Reference",
    "name": "Class",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 28,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1282,
    "endOffset": 1287,
    "fieldRanges": {
      "name": {
        "startOffset": 1282,
        "endOffset": 1287
      },
      "superclassifier": {
        "startOffset": 1282,
        "endOffset": 1287
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 30,
    "kind": "Definition",
    "name": "Behavior",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1293,
    "endOffset": 1329,
    "fieldRanges": {
      "name": {
        "startOffset": 1311,
        "endOffset": 1319
      },
      "declaredName": {
        "startOffset": 1311,
        "endOffset": 1319
      }
    },
    "exports": [
      "abstract item def Behavior :> Class;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Class"
    }
  },
  {
    "id": 31,
    "kind": "Reference",
    "name": "Class",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 30,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1323,
    "endOffset": 1328,
    "fieldRanges": {
      "name": {
        "startOffset": 1323,
        "endOffset": 1328
      },
      "superclassifier": {
        "startOffset": 1323,
        "endOffset": 1328
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 32,
    "kind": "Definition",
    "name": "Occurrence",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1334,
    "endOffset": 1372,
    "fieldRanges": {
      "name": {
        "startOffset": 1352,
        "endOffset": 1362
      },
      "declaredName": {
        "startOffset": 1352,
        "endOffset": 1362
      }
    },
    "exports": [
      "abstract item def Occurrence :> Class;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Class"
    }
  },
  {
    "id": 33,
    "kind": "Reference",
    "name": "Class",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 32,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1366,
    "endOffset": 1371,
    "fieldRanges": {
      "name": {
        "startOffset": 1366,
        "endOffset": 1371
      },
      "superclassifier": {
        "startOffset": 1366,
        "endOffset": 1371
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 34,
    "kind": "Definition",
    "name": "Life",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1377,
    "endOffset": 1414,
    "fieldRanges": {
      "name": {
        "startOffset": 1395,
        "endOffset": 1399
      },
      "declaredName": {
        "startOffset": 1395,
        "endOffset": 1399
      }
    },
    "exports": [
      "abstract item def Life :> Occurrence;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Occurrence"
    }
  },
  {
    "id": 35,
    "kind": "Reference",
    "name": "Occurrence",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 34,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1403,
    "endOffset": 1413,
    "fieldRanges": {
      "name": {
        "startOffset": 1403,
        "endOffset": 1413
      },
      "superclassifier": {
        "startOffset": 1403,
        "endOffset": 1413
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 36,
    "kind": "Definition",
    "name": "Snapshot",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1419,
    "endOffset": 1460,
    "fieldRanges": {
      "name": {
        "startOffset": 1437,
        "endOffset": 1445
      },
      "declaredName": {
        "startOffset": 1437,
        "endOffset": 1445
      }
    },
    "exports": [
      "abstract item def Snapshot :> Occurrence;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Occurrence"
    }
  },
  {
    "id": 37,
    "kind": "Reference",
    "name": "Occurrence",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 36,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1449,
    "endOffset": 1459,
    "fieldRanges": {
      "name": {
        "startOffset": 1449,
        "endOffset": 1459
      },
      "superclassifier": {
        "startOffset": 1449,
        "endOffset": 1459
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 38,
    "kind": "Definition",
    "name": "Link",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1465,
    "endOffset": 1504,
    "fieldRanges": {
      "name": {
        "startOffset": 1483,
        "endOffset": 1487
      },
      "declaredName": {
        "startOffset": 1483,
        "endOffset": 1487
      }
    },
    "exports": [
      "abstract item def Link :> Relationship;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Relationship"
    }
  },
  {
    "id": 39,
    "kind": "Reference",
    "name": "Relationship",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 38,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1491,
    "endOffset": 1503,
    "fieldRanges": {
      "name": {
        "startOffset": 1491,
        "endOffset": 1503
      },
      "superclassifier": {
        "startOffset": 1491,
        "endOffset": 1503
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 40,
    "kind": "Definition",
    "name": "Relationship",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1509,
    "endOffset": 1551,
    "fieldRanges": {
      "name": {
        "startOffset": 1527,
        "endOffset": 1539
      },
      "declaredName": {
        "startOffset": 1527,
        "endOffset": 1539
      }
    },
    "exports": [
      "abstract item def Relationship :> Element;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Element"
    }
  },
  {
    "id": 41,
    "kind": "Reference",
    "name": "Element",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 40,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1543,
    "endOffset": 1550,
    "fieldRanges": {
      "name": {
        "startOffset": 1543,
        "endOffset": 1550
      },
      "superclassifier": {
        "startOffset": 1543,
        "endOffset": 1550
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 42,
    "kind": "Definition",
    "name": "Association",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1556,
    "endOffset": 1600,
    "fieldRanges": {
      "name": {
        "startOffset": 1574,
        "endOffset": 1585
      },
      "declaredName": {
        "startOffset": 1574,
        "endOffset": 1585
      }
    },
    "exports": [
      "abstract item def Association :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Classifier"
    }
  },
  {
    "id": 43,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 42,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1589,
    "endOffset": 1599,
    "fieldRanges": {
      "name": {
        "startOffset": 1589,
        "endOffset": 1599
      },
      "superclassifier": {
        "startOffset": 1589,
        "endOffset": 1599
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 44,
    "kind": "Definition",
    "name": "Connector",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1605,
    "endOffset": 1644,
    "fieldRanges": {
      "name": {
        "startOffset": 1623,
        "endOffset": 1632
      },
      "declaredName": {
        "startOffset": 1623,
        "endOffset": 1632
      }
    },
    "exports": [
      "abstract item def Connector :> Feature;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Feature"
    }
  },
  {
    "id": 45,
    "kind": "Reference",
    "name": "Feature",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 44,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1636,
    "endOffset": 1643,
    "fieldRanges": {
      "name": {
        "startOffset": 1636,
        "endOffset": 1643
      },
      "superclassifier": {
        "startOffset": 1636,
        "endOffset": 1643
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 46,
    "kind": "Definition",
    "name": "Interface",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1649,
    "endOffset": 1688,
    "fieldRanges": {
      "name": {
        "startOffset": 1667,
        "endOffset": 1676
      },
      "declaredName": {
        "startOffset": 1667,
        "endOffset": 1676
      }
    },
    "exports": [
      "abstract item def Interface :> Feature;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Feature"
    }
  },
  {
    "id": 47,
    "kind": "Reference",
    "name": "Feature",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 46,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1680,
    "endOffset": 1687,
    "fieldRanges": {
      "name": {
        "startOffset": 1680,
        "endOffset": 1687
      },
      "superclassifier": {
        "startOffset": 1680,
        "endOffset": 1687
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 48,
    "kind": "Definition",
    "name": "Metadata",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 14,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1693,
    "endOffset": 1731,
    "fieldRanges": {
      "name": {
        "startOffset": 1711,
        "endOffset": 1719
      },
      "declaredName": {
        "startOffset": 1711,
        "endOffset": 1719
      }
    },
    "exports": [
      "abstract item def Metadata :> Feature;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Feature"
    }
  },
  {
    "id": 49,
    "kind": "Reference",
    "name": "Feature",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 48,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1723,
    "endOffset": 1730,
    "fieldRanges": {
      "name": {
        "startOffset": 1723,
        "endOffset": 1730
      },
      "superclassifier": {
        "startOffset": 1723,
        "endOffset": 1730
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 50,
    "kind": "Package",
    "name": "CoreTypes",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1735,
    "endOffset": 2139,
    "fieldRanges": {
      "name": {
        "startOffset": 1743,
        "endOffset": 1752
      },
      "declaredName": {
        "startOffset": 1743,
        "endOffset": 1752
      }
    },
    "exports": [
      "package CoreTypes {\n    import Base::*;\n\n    abstract part def Part :> Structure;\n    abstract item def Item :> Structure;\n    abstract port def Port :> Feature;\n    abstract action def Action :> Behavior;\n    abstract state def State :> Behavior;\n    abstract constraint def Constraint :> Behavior;\n    abstract calc def Calculation :> Behavior;\n    abstract requirement def Requirement :> Constraint;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 51,
    "kind": "Import",
    "name": "Base",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1759,
    "endOffset": 1773,
    "fieldRanges": {
      "name": {
        "startOffset": 1766,
        "endOffset": 1770
      },
      "importedNamespace": {
        "startOffset": 1766,
        "endOffset": 1770
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
    "id": 52,
    "kind": "Definition",
    "name": "Part",
    "ruleName": "PartDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1780,
    "endOffset": 1816,
    "fieldRanges": {
      "name": {
        "startOffset": 1798,
        "endOffset": 1802
      },
      "declaredName": {
        "startOffset": 1798,
        "endOffset": 1802
      }
    },
    "exports": [
      "abstract part def Part :> Structure;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Structure"
    }
  },
  {
    "id": 53,
    "kind": "Reference",
    "name": "Structure",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 52,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1806,
    "endOffset": 1815,
    "fieldRanges": {
      "name": {
        "startOffset": 1806,
        "endOffset": 1815
      },
      "superclassifier": {
        "startOffset": 1806,
        "endOffset": 1815
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 54,
    "kind": "Definition",
    "name": "Item",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1821,
    "endOffset": 1857,
    "fieldRanges": {
      "name": {
        "startOffset": 1839,
        "endOffset": 1843
      },
      "declaredName": {
        "startOffset": 1839,
        "endOffset": 1843
      }
    },
    "exports": [
      "abstract item def Item :> Structure;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Structure"
    }
  },
  {
    "id": 55,
    "kind": "Reference",
    "name": "Structure",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 54,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1847,
    "endOffset": 1856,
    "fieldRanges": {
      "name": {
        "startOffset": 1847,
        "endOffset": 1856
      },
      "superclassifier": {
        "startOffset": 1847,
        "endOffset": 1856
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 56,
    "kind": "Definition",
    "name": "Port",
    "ruleName": "PortDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1862,
    "endOffset": 1896,
    "fieldRanges": {
      "name": {
        "startOffset": 1880,
        "endOffset": 1884
      },
      "declaredName": {
        "startOffset": 1880,
        "endOffset": 1884
      }
    },
    "exports": [
      "abstract port def Port :> Feature;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Feature"
    }
  },
  {
    "id": 57,
    "kind": "Reference",
    "name": "Feature",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 56,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1888,
    "endOffset": 1895,
    "fieldRanges": {
      "name": {
        "startOffset": 1888,
        "endOffset": 1895
      },
      "superclassifier": {
        "startOffset": 1888,
        "endOffset": 1895
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 58,
    "kind": "Definition",
    "name": "Action",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1901,
    "endOffset": 1940,
    "fieldRanges": {
      "name": {
        "startOffset": 1921,
        "endOffset": 1927
      },
      "declaredName": {
        "startOffset": 1921,
        "endOffset": 1927
      }
    },
    "exports": [
      "abstract action def Action :> Behavior;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 59,
    "kind": "Reference",
    "name": "Behavior",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 58,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1931,
    "endOffset": 1939,
    "fieldRanges": {
      "name": {
        "startOffset": 1931,
        "endOffset": 1939
      },
      "superclassifier": {
        "startOffset": 1931,
        "endOffset": 1939
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 60,
    "kind": "Definition",
    "name": "State",
    "ruleName": "StateDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1945,
    "endOffset": 1982,
    "fieldRanges": {
      "name": {
        "startOffset": 1964,
        "endOffset": 1969
      },
      "declaredName": {
        "startOffset": 1964,
        "endOffset": 1969
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "isParallel": null
    }
  },
  {
    "id": 61,
    "kind": "Reference",
    "name": "Behavior",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 60,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1973,
    "endOffset": 1981,
    "fieldRanges": {
      "name": {
        "startOffset": 1973,
        "endOffset": 1981
      },
      "superclassifier": {
        "startOffset": 1973,
        "endOffset": 1981
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 62,
    "kind": "Definition",
    "name": "Constraint",
    "ruleName": "ConstraintDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 1987,
    "endOffset": 2034,
    "fieldRanges": {
      "name": {
        "startOffset": 2011,
        "endOffset": 2021
      },
      "declaredName": {
        "startOffset": 2011,
        "endOffset": 2021
      }
    },
    "exports": [
      "abstract constraint def Constraint :> Behavior;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 63,
    "kind": "Reference",
    "name": "Behavior",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 62,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2025,
    "endOffset": 2033,
    "fieldRanges": {
      "name": {
        "startOffset": 2025,
        "endOffset": 2033
      },
      "superclassifier": {
        "startOffset": 2025,
        "endOffset": 2033
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 64,
    "kind": "Definition",
    "name": "Calculation",
    "ruleName": "CalculationDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2039,
    "endOffset": 2081,
    "fieldRanges": {
      "name": {
        "startOffset": 2057,
        "endOffset": 2068
      },
      "declaredName": {
        "startOffset": 2057,
        "endOffset": 2068
      }
    },
    "exports": [
      "abstract calc def Calculation :> Behavior;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 65,
    "kind": "Reference",
    "name": "Behavior",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 64,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2072,
    "endOffset": 2080,
    "fieldRanges": {
      "name": {
        "startOffset": 2072,
        "endOffset": 2080
      },
      "superclassifier": {
        "startOffset": 2072,
        "endOffset": 2080
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 66,
    "kind": "Definition",
    "name": "Requirement",
    "ruleName": "RequirementDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 50,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2086,
    "endOffset": 2137,
    "fieldRanges": {
      "name": {
        "startOffset": 2111,
        "endOffset": 2122
      },
      "declaredName": {
        "startOffset": 2111,
        "endOffset": 2122
      }
    },
    "exports": [
      "abstract requirement def Requirement :> Constraint;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 67,
    "kind": "Reference",
    "name": "Constraint",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 66,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2126,
    "endOffset": 2136,
    "fieldRanges": {
      "name": {
        "startOffset": 2126,
        "endOffset": 2136
      },
      "superclassifier": {
        "startOffset": 2126,
        "endOffset": 2136
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 68,
    "kind": "Package",
    "name": "Collections",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2141,
    "endOffset": 2427,
    "fieldRanges": {
      "name": {
        "startOffset": 2149,
        "endOffset": 2160
      },
      "declaredName": {
        "startOffset": 2149,
        "endOffset": 2160
      }
    },
    "exports": [
      "package Collections {\n    import Base::*;\n\n    abstract item def Collection;\n    abstract item def List :> Collection;\n    abstract item def Set :> Collection;\n    abstract item def Bag :> Collection;\n    abstract item def Array :> Collection;\n    abstract item def Map :> Collection;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 69,
    "kind": "Import",
    "name": "Base",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2167,
    "endOffset": 2181,
    "fieldRanges": {
      "name": {
        "startOffset": 2174,
        "endOffset": 2178
      },
      "importedNamespace": {
        "startOffset": 2174,
        "endOffset": 2178
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
    "id": 70,
    "kind": "Definition",
    "name": "Collection",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2188,
    "endOffset": 2217,
    "fieldRanges": {
      "name": {
        "startOffset": 2206,
        "endOffset": 2216
      },
      "declaredName": {
        "startOffset": 2206,
        "endOffset": 2216
      }
    },
    "exports": [
      "abstract item def Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 71,
    "kind": "Definition",
    "name": "List",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2222,
    "endOffset": 2259,
    "fieldRanges": {
      "name": {
        "startOffset": 2240,
        "endOffset": 2244
      },
      "declaredName": {
        "startOffset": 2240,
        "endOffset": 2244
      }
    },
    "exports": [
      "abstract item def List :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Collection"
    }
  },
  {
    "id": 72,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 71,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2248,
    "endOffset": 2258,
    "fieldRanges": {
      "name": {
        "startOffset": 2248,
        "endOffset": 2258
      },
      "superclassifier": {
        "startOffset": 2248,
        "endOffset": 2258
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 73,
    "kind": "Definition",
    "name": "Set",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2264,
    "endOffset": 2300,
    "fieldRanges": {
      "name": {
        "startOffset": 2282,
        "endOffset": 2285
      },
      "declaredName": {
        "startOffset": 2282,
        "endOffset": 2285
      }
    },
    "exports": [
      "abstract item def Set :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Collection"
    }
  },
  {
    "id": 74,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 73,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2289,
    "endOffset": 2299,
    "fieldRanges": {
      "name": {
        "startOffset": 2289,
        "endOffset": 2299
      },
      "superclassifier": {
        "startOffset": 2289,
        "endOffset": 2299
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 75,
    "kind": "Definition",
    "name": "Bag",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2305,
    "endOffset": 2341,
    "fieldRanges": {
      "name": {
        "startOffset": 2323,
        "endOffset": 2326
      },
      "declaredName": {
        "startOffset": 2323,
        "endOffset": 2326
      }
    },
    "exports": [
      "abstract item def Bag :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Collection"
    }
  },
  {
    "id": 76,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 75,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2330,
    "endOffset": 2340,
    "fieldRanges": {
      "name": {
        "startOffset": 2330,
        "endOffset": 2340
      },
      "superclassifier": {
        "startOffset": 2330,
        "endOffset": 2340
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 77,
    "kind": "Definition",
    "name": "Array",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2346,
    "endOffset": 2384,
    "fieldRanges": {
      "name": {
        "startOffset": 2364,
        "endOffset": 2369
      },
      "declaredName": {
        "startOffset": 2364,
        "endOffset": 2369
      }
    },
    "exports": [
      "abstract item def Array :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Collection"
    }
  },
  {
    "id": 78,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 77,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2373,
    "endOffset": 2383,
    "fieldRanges": {
      "name": {
        "startOffset": 2373,
        "endOffset": 2383
      },
      "superclassifier": {
        "startOffset": 2373,
        "endOffset": 2383
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 79,
    "kind": "Definition",
    "name": "Map",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 68,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2389,
    "endOffset": 2425,
    "fieldRanges": {
      "name": {
        "startOffset": 2407,
        "endOffset": 2410
      },
      "declaredName": {
        "startOffset": 2407,
        "endOffset": 2410
      }
    },
    "exports": [
      "abstract item def Map :> Collection;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Collection"
    }
  },
  {
    "id": 80,
    "kind": "Reference",
    "name": "Collection",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 79,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2414,
    "endOffset": 2424,
    "fieldRanges": {
      "name": {
        "startOffset": 2414,
        "endOffset": 2424
      },
      "superclassifier": {
        "startOffset": 2414,
        "endOffset": 2424
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 81,
    "kind": "Package",
    "name": "Control",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2429,
    "endOffset": 2686,
    "fieldRanges": {
      "name": {
        "startOffset": 2437,
        "endOffset": 2444
      },
      "declaredName": {
        "startOffset": 2437,
        "endOffset": 2444
      }
    },
    "exports": [
      "package Control {\n    abstract action def ControlNode;\n    abstract action def MergeNode :> ControlNode;\n    abstract action def DecisionNode :> ControlNode;\n    abstract action def ForkNode :> ControlNode;\n    abstract action def JoinNode :> ControlNode;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 82,
    "kind": "Definition",
    "name": "ControlNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 81,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2451,
    "endOffset": 2483,
    "fieldRanges": {
      "name": {
        "startOffset": 2471,
        "endOffset": 2482
      },
      "declaredName": {
        "startOffset": 2471,
        "endOffset": 2482
      }
    },
    "exports": [
      "abstract action def ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 83,
    "kind": "Definition",
    "name": "MergeNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 81,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2488,
    "endOffset": 2533,
    "fieldRanges": {
      "name": {
        "startOffset": 2508,
        "endOffset": 2517
      },
      "declaredName": {
        "startOffset": 2508,
        "endOffset": 2517
      }
    },
    "exports": [
      "abstract action def MergeNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 84,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 83,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2521,
    "endOffset": 2532,
    "fieldRanges": {
      "name": {
        "startOffset": 2521,
        "endOffset": 2532
      },
      "superclassifier": {
        "startOffset": 2521,
        "endOffset": 2532
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 85,
    "kind": "Definition",
    "name": "DecisionNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 81,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2538,
    "endOffset": 2586,
    "fieldRanges": {
      "name": {
        "startOffset": 2558,
        "endOffset": 2570
      },
      "declaredName": {
        "startOffset": 2558,
        "endOffset": 2570
      }
    },
    "exports": [
      "abstract action def DecisionNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 86,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 85,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2574,
    "endOffset": 2585,
    "fieldRanges": {
      "name": {
        "startOffset": 2574,
        "endOffset": 2585
      },
      "superclassifier": {
        "startOffset": 2574,
        "endOffset": 2585
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 87,
    "kind": "Definition",
    "name": "ForkNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 81,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2591,
    "endOffset": 2635,
    "fieldRanges": {
      "name": {
        "startOffset": 2611,
        "endOffset": 2619
      },
      "declaredName": {
        "startOffset": 2611,
        "endOffset": 2619
      }
    },
    "exports": [
      "abstract action def ForkNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 88,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 87,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2623,
    "endOffset": 2634,
    "fieldRanges": {
      "name": {
        "startOffset": 2623,
        "endOffset": 2634
      },
      "superclassifier": {
        "startOffset": 2623,
        "endOffset": 2634
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 89,
    "kind": "Definition",
    "name": "JoinNode",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 81,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2640,
    "endOffset": 2684,
    "fieldRanges": {
      "name": {
        "startOffset": 2660,
        "endOffset": 2668
      },
      "declaredName": {
        "startOffset": 2660,
        "endOffset": 2668
      }
    },
    "exports": [
      "abstract action def JoinNode :> ControlNode;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 90,
    "kind": "Reference",
    "name": "ControlNode",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 89,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2672,
    "endOffset": 2683,
    "fieldRanges": {
      "name": {
        "startOffset": 2672,
        "endOffset": 2683
      },
      "superclassifier": {
        "startOffset": 2672,
        "endOffset": 2683
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 91,
    "kind": "Package",
    "name": "Transfers",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2688,
    "endOffset": 2845,
    "fieldRanges": {
      "name": {
        "startOffset": 2696,
        "endOffset": 2705
      },
      "declaredName": {
        "startOffset": 2696,
        "endOffset": 2705
      }
    },
    "exports": [
      "package Transfers {\n    import Base::*;\n\n    abstract item def Transfer;\n    abstract item def Flow :> Transfer;\n    abstract item def Message :> Transfer;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 92,
    "kind": "Import",
    "name": "Base",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 91,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2712,
    "endOffset": 2726,
    "fieldRanges": {
      "name": {
        "startOffset": 2719,
        "endOffset": 2723
      },
      "importedNamespace": {
        "startOffset": 2719,
        "endOffset": 2723
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
    "id": 93,
    "kind": "Definition",
    "name": "Transfer",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 91,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2733,
    "endOffset": 2760,
    "fieldRanges": {
      "name": {
        "startOffset": 2751,
        "endOffset": 2759
      },
      "declaredName": {
        "startOffset": 2751,
        "endOffset": 2759
      }
    },
    "exports": [
      "abstract item def Transfer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 94,
    "kind": "Definition",
    "name": "Flow",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 91,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2765,
    "endOffset": 2800,
    "fieldRanges": {
      "name": {
        "startOffset": 2783,
        "endOffset": 2787
      },
      "declaredName": {
        "startOffset": 2783,
        "endOffset": 2787
      }
    },
    "exports": [
      "abstract item def Flow :> Transfer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Transfer"
    }
  },
  {
    "id": 95,
    "kind": "Reference",
    "name": "Transfer",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 94,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2791,
    "endOffset": 2799,
    "fieldRanges": {
      "name": {
        "startOffset": 2791,
        "endOffset": 2799
      },
      "superclassifier": {
        "startOffset": 2791,
        "endOffset": 2799
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 96,
    "kind": "Definition",
    "name": "Message",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 91,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2805,
    "endOffset": 2843,
    "fieldRanges": {
      "name": {
        "startOffset": 2823,
        "endOffset": 2830
      },
      "declaredName": {
        "startOffset": 2823,
        "endOffset": 2830
      }
    },
    "exports": [
      "abstract item def Message :> Transfer;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Transfer"
    }
  },
  {
    "id": 97,
    "kind": "Reference",
    "name": "Transfer",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 96,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2834,
    "endOffset": 2842,
    "fieldRanges": {
      "name": {
        "startOffset": 2834,
        "endOffset": 2842
      },
      "superclassifier": {
        "startOffset": 2834,
        "endOffset": 2842
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 98,
    "kind": "Package",
    "name": "Performances",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2847,
    "endOffset": 3009,
    "fieldRanges": {
      "name": {
        "startOffset": 2855,
        "endOffset": 2867
      },
      "declaredName": {
        "startOffset": 2855,
        "endOffset": 2867
      }
    },
    "exports": [
      "package Performances {\n    abstract action def Performance;\n    abstract action def Evaluation :> Performance;\n    abstract action def Execution :> Performance;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 99,
    "kind": "Definition",
    "name": "Performance",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 98,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2874,
    "endOffset": 2906,
    "fieldRanges": {
      "name": {
        "startOffset": 2894,
        "endOffset": 2905
      },
      "declaredName": {
        "startOffset": 2894,
        "endOffset": 2905
      }
    },
    "exports": [
      "abstract action def Performance;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 100,
    "kind": "Definition",
    "name": "Evaluation",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 98,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2911,
    "endOffset": 2957,
    "fieldRanges": {
      "name": {
        "startOffset": 2931,
        "endOffset": 2941
      },
      "declaredName": {
        "startOffset": 2931,
        "endOffset": 2941
      }
    },
    "exports": [
      "abstract action def Evaluation :> Performance;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 101,
    "kind": "Reference",
    "name": "Performance",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 100,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2945,
    "endOffset": 2956,
    "fieldRanges": {
      "name": {
        "startOffset": 2945,
        "endOffset": 2956
      },
      "superclassifier": {
        "startOffset": 2945,
        "endOffset": 2956
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 102,
    "kind": "Definition",
    "name": "Execution",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 98,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2962,
    "endOffset": 3007,
    "fieldRanges": {
      "name": {
        "startOffset": 2982,
        "endOffset": 2991
      },
      "declaredName": {
        "startOffset": 2982,
        "endOffset": 2991
      }
    },
    "exports": [
      "abstract action def Execution :> Performance;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 103,
    "kind": "Reference",
    "name": "Performance",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 102,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 2995,
    "endOffset": 3006,
    "fieldRanges": {
      "name": {
        "startOffset": 2995,
        "endOffset": 3006
      },
      "superclassifier": {
        "startOffset": 2995,
        "endOffset": 3006
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 104,
    "kind": "Package",
    "name": "ISQ",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3011,
    "endOffset": 7763,
    "fieldRanges": {
      "name": {
        "startOffset": 3019,
        "endOffset": 3022
      },
      "declaredName": {
        "startOffset": 3019,
        "endOffset": 3022
      }
    },
    "exports": [
      "package ISQ {\n    import ScalarValues::*;\n\n    /* ── ISO/IEC 80000-3 Space and Time ── */\n    abstract attribute def Time :> Real;\n    abstract attribute def Duration :> Time;\n    abstract attribute def Period :> Time;\n    abstract attribute def Length :> Real;\n    abstract attribute def Width :> Length;\n    abstract attribute def Height :> Length;\n    abstract attribute def Distance :> Length;\n    abstract attribute def Position :> Length;\n    abstract attribute def Displacement :> Length;\n    abstract attribute def Radius :> Length;\n    abstract attribute def Diameter :> Length;\n    abstract attribute def Thickness :> Length;\n    abstract attribute def Area :> Real;\n    abstract attribute def Volume :> Real;\n    abstract attribute def Angle :> Real;\n    abstract attribute def SolidAngle :> Real;\n    abstract attribute def Velocity :> Real;\n    abstract attribute def LinearVelocity :> Velocity;\n    abstract attribute def Speed :> Velocity;\n    abstract attribute def AngularVelocity :> Real;\n    abstract attribute def Acceleration :> Real;\n    abstract attribute def LinearAcceleration :> Acceleration;\n    abstract attribute def AngularAcceleration :> Real;\n    abstract attribute def GravitationalAcceleration :> Acceleration;\n    abstract attribute def Frequency :> Real;\n    abstract attribute def RotationalFrequency :> Frequency;\n\n    /* ── ISO/IEC 80000-4 Mechanics ── */\n    abstract attribute def Mass :> Real;\n    abstract attribute def MassDensity :> Real;\n    abstract attribute def SpecificVolume :> Real;\n    abstract attribute def Momentum :> Real;\n    abstract attribute def AngularMomentum :> Real;\n    abstract attribute def MomentOfInertia :> Real;\n    abstract attribute def Force :> Real;\n    abstract attribute def Weight :> Force;\n    abstract attribute def Torque :> Real;\n    abstract attribute def MomentOfForce :> Torque;\n    abstract attribute def Pressure :> Real;\n    abstract attribute def Stress :> Pressure;\n    abstract attribute def NormalStress :> Stress;\n    abstract attribute def ShearStress :> Stress;\n    abstract attribute def Strain :> Real;\n    abstract attribute def Work :> Real;\n    abstract attribute def Energy :> Real;\n    abstract attribute def KineticEnergy :> Energy;\n    abstract attribute def PotentialEnergy :> Energy;\n    abstract attribute def Power :> Real;\n    abstract attribute def Efficiency :> Real;\n\n    /* ── Fluid Dynamics ── */\n    abstract attribute def DynamicViscosity :> Real;\n    abstract attribute def KinematicViscosity :> Real;\n    abstract attribute def SurfaceTension :> Real;\n    abstract attribute def VolumeFlowRate :> Real;\n    abstract attribute def MassFlowRate :> Real;\n    abstract attribute def ReynoldsNumber :> Real;\n    abstract attribute def MachNumber :> Real;\n\n    /* ── ISO/IEC 80000-5 Thermodynamics ── */\n    abstract attribute def ThermodynamicTemperature :> Real;\n    abstract attribute def CelsiusTemperature :> Real;\n    abstract attribute def Heat :> Energy;\n    abstract attribute def HeatFlowRate :> Power;\n    abstract attribute def ThermalConductivity :> Real;\n    abstract attribute def HeatCapacity :> Real;\n    abstract attribute def SpecificHeatCapacity :> Real;\n    abstract attribute def Entropy :> Real;\n    abstract attribute def Enthalpy :> Energy;\n    abstract attribute def InternalEnergy :> Energy;\n\n    /* ── ISO/IEC 80000-6 Electromagnetism ── */\n    abstract attribute def ElectricCurrent :> Real;\n    abstract attribute def ElectricCharge :> Real;\n    abstract attribute def Voltage :> Real;\n    abstract attribute def ElectricPotential :> Voltage;\n    abstract attribute def ElectromotiveForce :> Voltage;\n    abstract attribute def ElectricFieldStrength :> Real;\n    abstract attribute def ElectricFlux :> Real;\n    abstract attribute def ElectricResistance :> Real;\n    abstract attribute def Conductance :> Real;\n    abstract attribute def Resistivity :> Real;\n    abstract attribute def Conductivity :> Real;\n    abstract attribute def Capacitance :> Real;\n    abstract attribute def Permittivity :> Real;\n    abstract attribute def MagneticFlux :> Real;\n    abstract attribute def MagneticFluxDensity :> Real;\n    abstract attribute def MagneticFieldStrength :> Real;\n    abstract attribute def Permeability :> Real;\n    abstract attribute def Inductance :> Real;\n    abstract attribute def Impedance :> Real;\n    abstract attribute def Reactance :> Real;\n\n    /* ── ISO/IEC 80000-7/9 Light and Chemistry ── */\n    abstract attribute def AmountOfSubstance :> Real;\n    abstract attribute def MolarMass :> Real;\n    abstract attribute def LuminousIntensity :> Real;\n    abstract attribute def LuminousFlux :> Real;\n    abstract attribute def Illuminance :> Real;\n    abstract attribute def Luminance :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 105,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3029,
    "endOffset": 3051,
    "fieldRanges": {
      "name": {
        "startOffset": 3036,
        "endOffset": 3048
      },
      "importedNamespace": {
        "startOffset": 3036,
        "endOffset": 3048
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
    "id": 106,
    "kind": "Definition",
    "name": "Time",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3105,
    "endOffset": 3141,
    "fieldRanges": {
      "name": {
        "startOffset": 3128,
        "endOffset": 3132
      },
      "declaredName": {
        "startOffset": 3128,
        "endOffset": 3132
      }
    },
    "exports": [
      "abstract attribute def Time :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 107,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 106,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3136,
    "endOffset": 3140,
    "fieldRanges": {
      "name": {
        "startOffset": 3136,
        "endOffset": 3140
      },
      "superclassifier": {
        "startOffset": 3136,
        "endOffset": 3140
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 108,
    "kind": "Definition",
    "name": "Duration",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3146,
    "endOffset": 3186,
    "fieldRanges": {
      "name": {
        "startOffset": 3169,
        "endOffset": 3177
      },
      "declaredName": {
        "startOffset": 3169,
        "endOffset": 3177
      }
    },
    "exports": [
      "abstract attribute def Duration :> Time;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Time"
    }
  },
  {
    "id": 109,
    "kind": "Reference",
    "name": "Time",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 108,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3181,
    "endOffset": 3185,
    "fieldRanges": {
      "name": {
        "startOffset": 3181,
        "endOffset": 3185
      },
      "superclassifier": {
        "startOffset": 3181,
        "endOffset": 3185
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 110,
    "kind": "Definition",
    "name": "Period",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3191,
    "endOffset": 3229,
    "fieldRanges": {
      "name": {
        "startOffset": 3214,
        "endOffset": 3220
      },
      "declaredName": {
        "startOffset": 3214,
        "endOffset": 3220
      }
    },
    "exports": [
      "abstract attribute def Period :> Time;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Time"
    }
  },
  {
    "id": 111,
    "kind": "Reference",
    "name": "Time",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 110,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3224,
    "endOffset": 3228,
    "fieldRanges": {
      "name": {
        "startOffset": 3224,
        "endOffset": 3228
      },
      "superclassifier": {
        "startOffset": 3224,
        "endOffset": 3228
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 112,
    "kind": "Definition",
    "name": "Length",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3234,
    "endOffset": 3272,
    "fieldRanges": {
      "name": {
        "startOffset": 3257,
        "endOffset": 3263
      },
      "declaredName": {
        "startOffset": 3257,
        "endOffset": 3263
      }
    },
    "exports": [
      "abstract attribute def Length :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 113,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 112,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3267,
    "endOffset": 3271,
    "fieldRanges": {
      "name": {
        "startOffset": 3267,
        "endOffset": 3271
      },
      "superclassifier": {
        "startOffset": 3267,
        "endOffset": 3271
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 114,
    "kind": "Definition",
    "name": "Width",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3277,
    "endOffset": 3316,
    "fieldRanges": {
      "name": {
        "startOffset": 3300,
        "endOffset": 3305
      },
      "declaredName": {
        "startOffset": 3300,
        "endOffset": 3305
      }
    },
    "exports": [
      "abstract attribute def Width :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 115,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 114,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3309,
    "endOffset": 3315,
    "fieldRanges": {
      "name": {
        "startOffset": 3309,
        "endOffset": 3315
      },
      "superclassifier": {
        "startOffset": 3309,
        "endOffset": 3315
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 116,
    "kind": "Definition",
    "name": "Height",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3321,
    "endOffset": 3361,
    "fieldRanges": {
      "name": {
        "startOffset": 3344,
        "endOffset": 3350
      },
      "declaredName": {
        "startOffset": 3344,
        "endOffset": 3350
      }
    },
    "exports": [
      "abstract attribute def Height :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 117,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 116,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3354,
    "endOffset": 3360,
    "fieldRanges": {
      "name": {
        "startOffset": 3354,
        "endOffset": 3360
      },
      "superclassifier": {
        "startOffset": 3354,
        "endOffset": 3360
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 118,
    "kind": "Definition",
    "name": "Distance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3366,
    "endOffset": 3408,
    "fieldRanges": {
      "name": {
        "startOffset": 3389,
        "endOffset": 3397
      },
      "declaredName": {
        "startOffset": 3389,
        "endOffset": 3397
      }
    },
    "exports": [
      "abstract attribute def Distance :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 119,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 118,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3401,
    "endOffset": 3407,
    "fieldRanges": {
      "name": {
        "startOffset": 3401,
        "endOffset": 3407
      },
      "superclassifier": {
        "startOffset": 3401,
        "endOffset": 3407
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 120,
    "kind": "Definition",
    "name": "Position",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3413,
    "endOffset": 3455,
    "fieldRanges": {
      "name": {
        "startOffset": 3436,
        "endOffset": 3444
      },
      "declaredName": {
        "startOffset": 3436,
        "endOffset": 3444
      }
    },
    "exports": [
      "abstract attribute def Position :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 121,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 120,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3448,
    "endOffset": 3454,
    "fieldRanges": {
      "name": {
        "startOffset": 3448,
        "endOffset": 3454
      },
      "superclassifier": {
        "startOffset": 3448,
        "endOffset": 3454
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 122,
    "kind": "Definition",
    "name": "Displacement",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3460,
    "endOffset": 3506,
    "fieldRanges": {
      "name": {
        "startOffset": 3483,
        "endOffset": 3495
      },
      "declaredName": {
        "startOffset": 3483,
        "endOffset": 3495
      }
    },
    "exports": [
      "abstract attribute def Displacement :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 123,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 122,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3499,
    "endOffset": 3505,
    "fieldRanges": {
      "name": {
        "startOffset": 3499,
        "endOffset": 3505
      },
      "superclassifier": {
        "startOffset": 3499,
        "endOffset": 3505
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 124,
    "kind": "Definition",
    "name": "Radius",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3511,
    "endOffset": 3551,
    "fieldRanges": {
      "name": {
        "startOffset": 3534,
        "endOffset": 3540
      },
      "declaredName": {
        "startOffset": 3534,
        "endOffset": 3540
      }
    },
    "exports": [
      "abstract attribute def Radius :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 125,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 124,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3544,
    "endOffset": 3550,
    "fieldRanges": {
      "name": {
        "startOffset": 3544,
        "endOffset": 3550
      },
      "superclassifier": {
        "startOffset": 3544,
        "endOffset": 3550
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 126,
    "kind": "Definition",
    "name": "Diameter",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3556,
    "endOffset": 3598,
    "fieldRanges": {
      "name": {
        "startOffset": 3579,
        "endOffset": 3587
      },
      "declaredName": {
        "startOffset": 3579,
        "endOffset": 3587
      }
    },
    "exports": [
      "abstract attribute def Diameter :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 127,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 126,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3591,
    "endOffset": 3597,
    "fieldRanges": {
      "name": {
        "startOffset": 3591,
        "endOffset": 3597
      },
      "superclassifier": {
        "startOffset": 3591,
        "endOffset": 3597
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 128,
    "kind": "Definition",
    "name": "Thickness",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3603,
    "endOffset": 3646,
    "fieldRanges": {
      "name": {
        "startOffset": 3626,
        "endOffset": 3635
      },
      "declaredName": {
        "startOffset": 3626,
        "endOffset": 3635
      }
    },
    "exports": [
      "abstract attribute def Thickness :> Length;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Length"
    }
  },
  {
    "id": 129,
    "kind": "Reference",
    "name": "Length",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 128,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3639,
    "endOffset": 3645,
    "fieldRanges": {
      "name": {
        "startOffset": 3639,
        "endOffset": 3645
      },
      "superclassifier": {
        "startOffset": 3639,
        "endOffset": 3645
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 130,
    "kind": "Definition",
    "name": "Area",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3651,
    "endOffset": 3687,
    "fieldRanges": {
      "name": {
        "startOffset": 3674,
        "endOffset": 3678
      },
      "declaredName": {
        "startOffset": 3674,
        "endOffset": 3678
      }
    },
    "exports": [
      "abstract attribute def Area :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 131,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 130,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3682,
    "endOffset": 3686,
    "fieldRanges": {
      "name": {
        "startOffset": 3682,
        "endOffset": 3686
      },
      "superclassifier": {
        "startOffset": 3682,
        "endOffset": 3686
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 132,
    "kind": "Definition",
    "name": "Volume",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3692,
    "endOffset": 3730,
    "fieldRanges": {
      "name": {
        "startOffset": 3715,
        "endOffset": 3721
      },
      "declaredName": {
        "startOffset": 3715,
        "endOffset": 3721
      }
    },
    "exports": [
      "abstract attribute def Volume :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 133,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 132,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3725,
    "endOffset": 3729,
    "fieldRanges": {
      "name": {
        "startOffset": 3725,
        "endOffset": 3729
      },
      "superclassifier": {
        "startOffset": 3725,
        "endOffset": 3729
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 134,
    "kind": "Definition",
    "name": "Angle",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3735,
    "endOffset": 3772,
    "fieldRanges": {
      "name": {
        "startOffset": 3758,
        "endOffset": 3763
      },
      "declaredName": {
        "startOffset": 3758,
        "endOffset": 3763
      }
    },
    "exports": [
      "abstract attribute def Angle :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 135,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 134,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3767,
    "endOffset": 3771,
    "fieldRanges": {
      "name": {
        "startOffset": 3767,
        "endOffset": 3771
      },
      "superclassifier": {
        "startOffset": 3767,
        "endOffset": 3771
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 136,
    "kind": "Definition",
    "name": "SolidAngle",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3777,
    "endOffset": 3819,
    "fieldRanges": {
      "name": {
        "startOffset": 3800,
        "endOffset": 3810
      },
      "declaredName": {
        "startOffset": 3800,
        "endOffset": 3810
      }
    },
    "exports": [
      "abstract attribute def SolidAngle :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 137,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 136,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3814,
    "endOffset": 3818,
    "fieldRanges": {
      "name": {
        "startOffset": 3814,
        "endOffset": 3818
      },
      "superclassifier": {
        "startOffset": 3814,
        "endOffset": 3818
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 138,
    "kind": "Definition",
    "name": "Velocity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3824,
    "endOffset": 3864,
    "fieldRanges": {
      "name": {
        "startOffset": 3847,
        "endOffset": 3855
      },
      "declaredName": {
        "startOffset": 3847,
        "endOffset": 3855
      }
    },
    "exports": [
      "abstract attribute def Velocity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 139,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 138,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3859,
    "endOffset": 3863,
    "fieldRanges": {
      "name": {
        "startOffset": 3859,
        "endOffset": 3863
      },
      "superclassifier": {
        "startOffset": 3859,
        "endOffset": 3863
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 140,
    "kind": "Definition",
    "name": "LinearVelocity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3869,
    "endOffset": 3919,
    "fieldRanges": {
      "name": {
        "startOffset": 3892,
        "endOffset": 3906
      },
      "declaredName": {
        "startOffset": 3892,
        "endOffset": 3906
      }
    },
    "exports": [
      "abstract attribute def LinearVelocity :> Velocity;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Velocity"
    }
  },
  {
    "id": 141,
    "kind": "Reference",
    "name": "Velocity",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 140,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3910,
    "endOffset": 3918,
    "fieldRanges": {
      "name": {
        "startOffset": 3910,
        "endOffset": 3918
      },
      "superclassifier": {
        "startOffset": 3910,
        "endOffset": 3918
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 142,
    "kind": "Definition",
    "name": "Speed",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3924,
    "endOffset": 3965,
    "fieldRanges": {
      "name": {
        "startOffset": 3947,
        "endOffset": 3952
      },
      "declaredName": {
        "startOffset": 3947,
        "endOffset": 3952
      }
    },
    "exports": [
      "abstract attribute def Speed :> Velocity;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Velocity"
    }
  },
  {
    "id": 143,
    "kind": "Reference",
    "name": "Velocity",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 142,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3956,
    "endOffset": 3964,
    "fieldRanges": {
      "name": {
        "startOffset": 3956,
        "endOffset": 3964
      },
      "superclassifier": {
        "startOffset": 3956,
        "endOffset": 3964
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 144,
    "kind": "Definition",
    "name": "AngularVelocity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 3970,
    "endOffset": 4017,
    "fieldRanges": {
      "name": {
        "startOffset": 3993,
        "endOffset": 4008
      },
      "declaredName": {
        "startOffset": 3993,
        "endOffset": 4008
      }
    },
    "exports": [
      "abstract attribute def AngularVelocity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 145,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 144,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4012,
    "endOffset": 4016,
    "fieldRanges": {
      "name": {
        "startOffset": 4012,
        "endOffset": 4016
      },
      "superclassifier": {
        "startOffset": 4012,
        "endOffset": 4016
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 146,
    "kind": "Definition",
    "name": "Acceleration",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4022,
    "endOffset": 4066,
    "fieldRanges": {
      "name": {
        "startOffset": 4045,
        "endOffset": 4057
      },
      "declaredName": {
        "startOffset": 4045,
        "endOffset": 4057
      }
    },
    "exports": [
      "abstract attribute def Acceleration :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 147,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 146,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4061,
    "endOffset": 4065,
    "fieldRanges": {
      "name": {
        "startOffset": 4061,
        "endOffset": 4065
      },
      "superclassifier": {
        "startOffset": 4061,
        "endOffset": 4065
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 148,
    "kind": "Definition",
    "name": "LinearAcceleration",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4071,
    "endOffset": 4129,
    "fieldRanges": {
      "name": {
        "startOffset": 4094,
        "endOffset": 4112
      },
      "declaredName": {
        "startOffset": 4094,
        "endOffset": 4112
      }
    },
    "exports": [
      "abstract attribute def LinearAcceleration :> Acceleration;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Acceleration"
    }
  },
  {
    "id": 149,
    "kind": "Reference",
    "name": "Acceleration",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 148,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4116,
    "endOffset": 4128,
    "fieldRanges": {
      "name": {
        "startOffset": 4116,
        "endOffset": 4128
      },
      "superclassifier": {
        "startOffset": 4116,
        "endOffset": 4128
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 150,
    "kind": "Definition",
    "name": "AngularAcceleration",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4134,
    "endOffset": 4185,
    "fieldRanges": {
      "name": {
        "startOffset": 4157,
        "endOffset": 4176
      },
      "declaredName": {
        "startOffset": 4157,
        "endOffset": 4176
      }
    },
    "exports": [
      "abstract attribute def AngularAcceleration :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 151,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 150,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4180,
    "endOffset": 4184,
    "fieldRanges": {
      "name": {
        "startOffset": 4180,
        "endOffset": 4184
      },
      "superclassifier": {
        "startOffset": 4180,
        "endOffset": 4184
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 152,
    "kind": "Definition",
    "name": "GravitationalAcceleration",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4190,
    "endOffset": 4255,
    "fieldRanges": {
      "name": {
        "startOffset": 4213,
        "endOffset": 4238
      },
      "declaredName": {
        "startOffset": 4213,
        "endOffset": 4238
      }
    },
    "exports": [
      "abstract attribute def GravitationalAcceleration :> Acceleration;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Acceleration"
    }
  },
  {
    "id": 153,
    "kind": "Reference",
    "name": "Acceleration",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 152,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4242,
    "endOffset": 4254,
    "fieldRanges": {
      "name": {
        "startOffset": 4242,
        "endOffset": 4254
      },
      "superclassifier": {
        "startOffset": 4242,
        "endOffset": 4254
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 154,
    "kind": "Definition",
    "name": "Frequency",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4260,
    "endOffset": 4301,
    "fieldRanges": {
      "name": {
        "startOffset": 4283,
        "endOffset": 4292
      },
      "declaredName": {
        "startOffset": 4283,
        "endOffset": 4292
      }
    },
    "exports": [
      "abstract attribute def Frequency :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 155,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 154,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4296,
    "endOffset": 4300,
    "fieldRanges": {
      "name": {
        "startOffset": 4296,
        "endOffset": 4300
      },
      "superclassifier": {
        "startOffset": 4296,
        "endOffset": 4300
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 156,
    "kind": "Definition",
    "name": "RotationalFrequency",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4306,
    "endOffset": 4362,
    "fieldRanges": {
      "name": {
        "startOffset": 4329,
        "endOffset": 4348
      },
      "declaredName": {
        "startOffset": 4329,
        "endOffset": 4348
      }
    },
    "exports": [
      "abstract attribute def RotationalFrequency :> Frequency;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Frequency"
    }
  },
  {
    "id": 157,
    "kind": "Reference",
    "name": "Frequency",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 156,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4352,
    "endOffset": 4361,
    "fieldRanges": {
      "name": {
        "startOffset": 4352,
        "endOffset": 4361
      },
      "superclassifier": {
        "startOffset": 4352,
        "endOffset": 4361
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 158,
    "kind": "Definition",
    "name": "Mass",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4410,
    "endOffset": 4446,
    "fieldRanges": {
      "name": {
        "startOffset": 4433,
        "endOffset": 4437
      },
      "declaredName": {
        "startOffset": 4433,
        "endOffset": 4437
      }
    },
    "exports": [
      "abstract attribute def Mass :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 159,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 158,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4441,
    "endOffset": 4445,
    "fieldRanges": {
      "name": {
        "startOffset": 4441,
        "endOffset": 4445
      },
      "superclassifier": {
        "startOffset": 4441,
        "endOffset": 4445
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 160,
    "kind": "Definition",
    "name": "MassDensity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4451,
    "endOffset": 4494,
    "fieldRanges": {
      "name": {
        "startOffset": 4474,
        "endOffset": 4485
      },
      "declaredName": {
        "startOffset": 4474,
        "endOffset": 4485
      }
    },
    "exports": [
      "abstract attribute def MassDensity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 161,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 160,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4489,
    "endOffset": 4493,
    "fieldRanges": {
      "name": {
        "startOffset": 4489,
        "endOffset": 4493
      },
      "superclassifier": {
        "startOffset": 4489,
        "endOffset": 4493
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 162,
    "kind": "Definition",
    "name": "SpecificVolume",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4499,
    "endOffset": 4545,
    "fieldRanges": {
      "name": {
        "startOffset": 4522,
        "endOffset": 4536
      },
      "declaredName": {
        "startOffset": 4522,
        "endOffset": 4536
      }
    },
    "exports": [
      "abstract attribute def SpecificVolume :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 163,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 162,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4540,
    "endOffset": 4544,
    "fieldRanges": {
      "name": {
        "startOffset": 4540,
        "endOffset": 4544
      },
      "superclassifier": {
        "startOffset": 4540,
        "endOffset": 4544
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 164,
    "kind": "Definition",
    "name": "Momentum",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4550,
    "endOffset": 4590,
    "fieldRanges": {
      "name": {
        "startOffset": 4573,
        "endOffset": 4581
      },
      "declaredName": {
        "startOffset": 4573,
        "endOffset": 4581
      }
    },
    "exports": [
      "abstract attribute def Momentum :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 165,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 164,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4585,
    "endOffset": 4589,
    "fieldRanges": {
      "name": {
        "startOffset": 4585,
        "endOffset": 4589
      },
      "superclassifier": {
        "startOffset": 4585,
        "endOffset": 4589
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 166,
    "kind": "Definition",
    "name": "AngularMomentum",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4595,
    "endOffset": 4642,
    "fieldRanges": {
      "name": {
        "startOffset": 4618,
        "endOffset": 4633
      },
      "declaredName": {
        "startOffset": 4618,
        "endOffset": 4633
      }
    },
    "exports": [
      "abstract attribute def AngularMomentum :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 167,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 166,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4637,
    "endOffset": 4641,
    "fieldRanges": {
      "name": {
        "startOffset": 4637,
        "endOffset": 4641
      },
      "superclassifier": {
        "startOffset": 4637,
        "endOffset": 4641
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 168,
    "kind": "Definition",
    "name": "MomentOfInertia",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4647,
    "endOffset": 4694,
    "fieldRanges": {
      "name": {
        "startOffset": 4670,
        "endOffset": 4685
      },
      "declaredName": {
        "startOffset": 4670,
        "endOffset": 4685
      }
    },
    "exports": [
      "abstract attribute def MomentOfInertia :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 169,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 168,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4689,
    "endOffset": 4693,
    "fieldRanges": {
      "name": {
        "startOffset": 4689,
        "endOffset": 4693
      },
      "superclassifier": {
        "startOffset": 4689,
        "endOffset": 4693
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 170,
    "kind": "Definition",
    "name": "Force",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4699,
    "endOffset": 4736,
    "fieldRanges": {
      "name": {
        "startOffset": 4722,
        "endOffset": 4727
      },
      "declaredName": {
        "startOffset": 4722,
        "endOffset": 4727
      }
    },
    "exports": [
      "abstract attribute def Force :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 171,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 170,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4731,
    "endOffset": 4735,
    "fieldRanges": {
      "name": {
        "startOffset": 4731,
        "endOffset": 4735
      },
      "superclassifier": {
        "startOffset": 4731,
        "endOffset": 4735
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 172,
    "kind": "Definition",
    "name": "Weight",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4741,
    "endOffset": 4780,
    "fieldRanges": {
      "name": {
        "startOffset": 4764,
        "endOffset": 4770
      },
      "declaredName": {
        "startOffset": 4764,
        "endOffset": 4770
      }
    },
    "exports": [
      "abstract attribute def Weight :> Force;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Force"
    }
  },
  {
    "id": 173,
    "kind": "Reference",
    "name": "Force",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 172,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4774,
    "endOffset": 4779,
    "fieldRanges": {
      "name": {
        "startOffset": 4774,
        "endOffset": 4779
      },
      "superclassifier": {
        "startOffset": 4774,
        "endOffset": 4779
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 174,
    "kind": "Definition",
    "name": "Torque",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4785,
    "endOffset": 4823,
    "fieldRanges": {
      "name": {
        "startOffset": 4808,
        "endOffset": 4814
      },
      "declaredName": {
        "startOffset": 4808,
        "endOffset": 4814
      }
    },
    "exports": [
      "abstract attribute def Torque :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 175,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 174,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4818,
    "endOffset": 4822,
    "fieldRanges": {
      "name": {
        "startOffset": 4818,
        "endOffset": 4822
      },
      "superclassifier": {
        "startOffset": 4818,
        "endOffset": 4822
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 176,
    "kind": "Definition",
    "name": "MomentOfForce",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4828,
    "endOffset": 4875,
    "fieldRanges": {
      "name": {
        "startOffset": 4851,
        "endOffset": 4864
      },
      "declaredName": {
        "startOffset": 4851,
        "endOffset": 4864
      }
    },
    "exports": [
      "abstract attribute def MomentOfForce :> Torque;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Torque"
    }
  },
  {
    "id": 177,
    "kind": "Reference",
    "name": "Torque",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 176,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4868,
    "endOffset": 4874,
    "fieldRanges": {
      "name": {
        "startOffset": 4868,
        "endOffset": 4874
      },
      "superclassifier": {
        "startOffset": 4868,
        "endOffset": 4874
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 178,
    "kind": "Definition",
    "name": "Pressure",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4880,
    "endOffset": 4920,
    "fieldRanges": {
      "name": {
        "startOffset": 4903,
        "endOffset": 4911
      },
      "declaredName": {
        "startOffset": 4903,
        "endOffset": 4911
      }
    },
    "exports": [
      "abstract attribute def Pressure :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 179,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 178,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4915,
    "endOffset": 4919,
    "fieldRanges": {
      "name": {
        "startOffset": 4915,
        "endOffset": 4919
      },
      "superclassifier": {
        "startOffset": 4915,
        "endOffset": 4919
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 180,
    "kind": "Definition",
    "name": "Stress",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4925,
    "endOffset": 4967,
    "fieldRanges": {
      "name": {
        "startOffset": 4948,
        "endOffset": 4954
      },
      "declaredName": {
        "startOffset": 4948,
        "endOffset": 4954
      }
    },
    "exports": [
      "abstract attribute def Stress :> Pressure;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pressure"
    }
  },
  {
    "id": 181,
    "kind": "Reference",
    "name": "Pressure",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 180,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4958,
    "endOffset": 4966,
    "fieldRanges": {
      "name": {
        "startOffset": 4958,
        "endOffset": 4966
      },
      "superclassifier": {
        "startOffset": 4958,
        "endOffset": 4966
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 182,
    "kind": "Definition",
    "name": "NormalStress",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 4972,
    "endOffset": 5018,
    "fieldRanges": {
      "name": {
        "startOffset": 4995,
        "endOffset": 5007
      },
      "declaredName": {
        "startOffset": 4995,
        "endOffset": 5007
      }
    },
    "exports": [
      "abstract attribute def NormalStress :> Stress;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Stress"
    }
  },
  {
    "id": 183,
    "kind": "Reference",
    "name": "Stress",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 182,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5011,
    "endOffset": 5017,
    "fieldRanges": {
      "name": {
        "startOffset": 5011,
        "endOffset": 5017
      },
      "superclassifier": {
        "startOffset": 5011,
        "endOffset": 5017
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 184,
    "kind": "Definition",
    "name": "ShearStress",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5023,
    "endOffset": 5068,
    "fieldRanges": {
      "name": {
        "startOffset": 5046,
        "endOffset": 5057
      },
      "declaredName": {
        "startOffset": 5046,
        "endOffset": 5057
      }
    },
    "exports": [
      "abstract attribute def ShearStress :> Stress;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Stress"
    }
  },
  {
    "id": 185,
    "kind": "Reference",
    "name": "Stress",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 184,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5061,
    "endOffset": 5067,
    "fieldRanges": {
      "name": {
        "startOffset": 5061,
        "endOffset": 5067
      },
      "superclassifier": {
        "startOffset": 5061,
        "endOffset": 5067
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 186,
    "kind": "Definition",
    "name": "Strain",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5073,
    "endOffset": 5111,
    "fieldRanges": {
      "name": {
        "startOffset": 5096,
        "endOffset": 5102
      },
      "declaredName": {
        "startOffset": 5096,
        "endOffset": 5102
      }
    },
    "exports": [
      "abstract attribute def Strain :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 187,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 186,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5106,
    "endOffset": 5110,
    "fieldRanges": {
      "name": {
        "startOffset": 5106,
        "endOffset": 5110
      },
      "superclassifier": {
        "startOffset": 5106,
        "endOffset": 5110
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 188,
    "kind": "Definition",
    "name": "Work",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5116,
    "endOffset": 5152,
    "fieldRanges": {
      "name": {
        "startOffset": 5139,
        "endOffset": 5143
      },
      "declaredName": {
        "startOffset": 5139,
        "endOffset": 5143
      }
    },
    "exports": [
      "abstract attribute def Work :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 189,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 188,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5147,
    "endOffset": 5151,
    "fieldRanges": {
      "name": {
        "startOffset": 5147,
        "endOffset": 5151
      },
      "superclassifier": {
        "startOffset": 5147,
        "endOffset": 5151
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 190,
    "kind": "Definition",
    "name": "Energy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5157,
    "endOffset": 5195,
    "fieldRanges": {
      "name": {
        "startOffset": 5180,
        "endOffset": 5186
      },
      "declaredName": {
        "startOffset": 5180,
        "endOffset": 5186
      }
    },
    "exports": [
      "abstract attribute def Energy :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 191,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 190,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5190,
    "endOffset": 5194,
    "fieldRanges": {
      "name": {
        "startOffset": 5190,
        "endOffset": 5194
      },
      "superclassifier": {
        "startOffset": 5190,
        "endOffset": 5194
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 192,
    "kind": "Definition",
    "name": "KineticEnergy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5200,
    "endOffset": 5247,
    "fieldRanges": {
      "name": {
        "startOffset": 5223,
        "endOffset": 5236
      },
      "declaredName": {
        "startOffset": 5223,
        "endOffset": 5236
      }
    },
    "exports": [
      "abstract attribute def KineticEnergy :> Energy;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Energy"
    }
  },
  {
    "id": 193,
    "kind": "Reference",
    "name": "Energy",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 192,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5240,
    "endOffset": 5246,
    "fieldRanges": {
      "name": {
        "startOffset": 5240,
        "endOffset": 5246
      },
      "superclassifier": {
        "startOffset": 5240,
        "endOffset": 5246
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 194,
    "kind": "Definition",
    "name": "PotentialEnergy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5252,
    "endOffset": 5301,
    "fieldRanges": {
      "name": {
        "startOffset": 5275,
        "endOffset": 5290
      },
      "declaredName": {
        "startOffset": 5275,
        "endOffset": 5290
      }
    },
    "exports": [
      "abstract attribute def PotentialEnergy :> Energy;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Energy"
    }
  },
  {
    "id": 195,
    "kind": "Reference",
    "name": "Energy",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 194,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5294,
    "endOffset": 5300,
    "fieldRanges": {
      "name": {
        "startOffset": 5294,
        "endOffset": 5300
      },
      "superclassifier": {
        "startOffset": 5294,
        "endOffset": 5300
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 196,
    "kind": "Definition",
    "name": "Power",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5306,
    "endOffset": 5343,
    "fieldRanges": {
      "name": {
        "startOffset": 5329,
        "endOffset": 5334
      },
      "declaredName": {
        "startOffset": 5329,
        "endOffset": 5334
      }
    },
    "exports": [
      "abstract attribute def Power :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 197,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 196,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5338,
    "endOffset": 5342,
    "fieldRanges": {
      "name": {
        "startOffset": 5338,
        "endOffset": 5342
      },
      "superclassifier": {
        "startOffset": 5338,
        "endOffset": 5342
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 198,
    "kind": "Definition",
    "name": "Efficiency",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5348,
    "endOffset": 5390,
    "fieldRanges": {
      "name": {
        "startOffset": 5371,
        "endOffset": 5381
      },
      "declaredName": {
        "startOffset": 5371,
        "endOffset": 5381
      }
    },
    "exports": [
      "abstract attribute def Efficiency :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 199,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 198,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5385,
    "endOffset": 5389,
    "fieldRanges": {
      "name": {
        "startOffset": 5385,
        "endOffset": 5389
      },
      "superclassifier": {
        "startOffset": 5385,
        "endOffset": 5389
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 200,
    "kind": "Definition",
    "name": "DynamicViscosity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5427,
    "endOffset": 5475,
    "fieldRanges": {
      "name": {
        "startOffset": 5450,
        "endOffset": 5466
      },
      "declaredName": {
        "startOffset": 5450,
        "endOffset": 5466
      }
    },
    "exports": [
      "abstract attribute def DynamicViscosity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 201,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 200,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5470,
    "endOffset": 5474,
    "fieldRanges": {
      "name": {
        "startOffset": 5470,
        "endOffset": 5474
      },
      "superclassifier": {
        "startOffset": 5470,
        "endOffset": 5474
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 202,
    "kind": "Definition",
    "name": "KinematicViscosity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5480,
    "endOffset": 5530,
    "fieldRanges": {
      "name": {
        "startOffset": 5503,
        "endOffset": 5521
      },
      "declaredName": {
        "startOffset": 5503,
        "endOffset": 5521
      }
    },
    "exports": [
      "abstract attribute def KinematicViscosity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 203,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 202,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5525,
    "endOffset": 5529,
    "fieldRanges": {
      "name": {
        "startOffset": 5525,
        "endOffset": 5529
      },
      "superclassifier": {
        "startOffset": 5525,
        "endOffset": 5529
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 204,
    "kind": "Definition",
    "name": "SurfaceTension",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5535,
    "endOffset": 5581,
    "fieldRanges": {
      "name": {
        "startOffset": 5558,
        "endOffset": 5572
      },
      "declaredName": {
        "startOffset": 5558,
        "endOffset": 5572
      }
    },
    "exports": [
      "abstract attribute def SurfaceTension :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 205,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 204,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5576,
    "endOffset": 5580,
    "fieldRanges": {
      "name": {
        "startOffset": 5576,
        "endOffset": 5580
      },
      "superclassifier": {
        "startOffset": 5576,
        "endOffset": 5580
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 206,
    "kind": "Definition",
    "name": "VolumeFlowRate",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5586,
    "endOffset": 5632,
    "fieldRanges": {
      "name": {
        "startOffset": 5609,
        "endOffset": 5623
      },
      "declaredName": {
        "startOffset": 5609,
        "endOffset": 5623
      }
    },
    "exports": [
      "abstract attribute def VolumeFlowRate :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 207,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 206,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5627,
    "endOffset": 5631,
    "fieldRanges": {
      "name": {
        "startOffset": 5627,
        "endOffset": 5631
      },
      "superclassifier": {
        "startOffset": 5627,
        "endOffset": 5631
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 208,
    "kind": "Definition",
    "name": "MassFlowRate",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5637,
    "endOffset": 5681,
    "fieldRanges": {
      "name": {
        "startOffset": 5660,
        "endOffset": 5672
      },
      "declaredName": {
        "startOffset": 5660,
        "endOffset": 5672
      }
    },
    "exports": [
      "abstract attribute def MassFlowRate :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 209,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 208,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5676,
    "endOffset": 5680,
    "fieldRanges": {
      "name": {
        "startOffset": 5676,
        "endOffset": 5680
      },
      "superclassifier": {
        "startOffset": 5676,
        "endOffset": 5680
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 210,
    "kind": "Definition",
    "name": "ReynoldsNumber",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5686,
    "endOffset": 5732,
    "fieldRanges": {
      "name": {
        "startOffset": 5709,
        "endOffset": 5723
      },
      "declaredName": {
        "startOffset": 5709,
        "endOffset": 5723
      }
    },
    "exports": [
      "abstract attribute def ReynoldsNumber :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 211,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 210,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5727,
    "endOffset": 5731,
    "fieldRanges": {
      "name": {
        "startOffset": 5727,
        "endOffset": 5731
      },
      "superclassifier": {
        "startOffset": 5727,
        "endOffset": 5731
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 212,
    "kind": "Definition",
    "name": "MachNumber",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5737,
    "endOffset": 5779,
    "fieldRanges": {
      "name": {
        "startOffset": 5760,
        "endOffset": 5770
      },
      "declaredName": {
        "startOffset": 5760,
        "endOffset": 5770
      }
    },
    "exports": [
      "abstract attribute def MachNumber :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 213,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 212,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5774,
    "endOffset": 5778,
    "fieldRanges": {
      "name": {
        "startOffset": 5774,
        "endOffset": 5778
      },
      "superclassifier": {
        "startOffset": 5774,
        "endOffset": 5778
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 214,
    "kind": "Definition",
    "name": "ThermodynamicTemperature",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5832,
    "endOffset": 5888,
    "fieldRanges": {
      "name": {
        "startOffset": 5855,
        "endOffset": 5879
      },
      "declaredName": {
        "startOffset": 5855,
        "endOffset": 5879
      }
    },
    "exports": [
      "abstract attribute def ThermodynamicTemperature :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 215,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 214,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5883,
    "endOffset": 5887,
    "fieldRanges": {
      "name": {
        "startOffset": 5883,
        "endOffset": 5887
      },
      "superclassifier": {
        "startOffset": 5883,
        "endOffset": 5887
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 216,
    "kind": "Definition",
    "name": "CelsiusTemperature",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5893,
    "endOffset": 5943,
    "fieldRanges": {
      "name": {
        "startOffset": 5916,
        "endOffset": 5934
      },
      "declaredName": {
        "startOffset": 5916,
        "endOffset": 5934
      }
    },
    "exports": [
      "abstract attribute def CelsiusTemperature :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 217,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 216,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5938,
    "endOffset": 5942,
    "fieldRanges": {
      "name": {
        "startOffset": 5938,
        "endOffset": 5942
      },
      "superclassifier": {
        "startOffset": 5938,
        "endOffset": 5942
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 218,
    "kind": "Definition",
    "name": "Heat",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5948,
    "endOffset": 5986,
    "fieldRanges": {
      "name": {
        "startOffset": 5971,
        "endOffset": 5975
      },
      "declaredName": {
        "startOffset": 5971,
        "endOffset": 5975
      }
    },
    "exports": [
      "abstract attribute def Heat :> Energy;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Energy"
    }
  },
  {
    "id": 219,
    "kind": "Reference",
    "name": "Energy",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 218,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5979,
    "endOffset": 5985,
    "fieldRanges": {
      "name": {
        "startOffset": 5979,
        "endOffset": 5985
      },
      "superclassifier": {
        "startOffset": 5979,
        "endOffset": 5985
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 220,
    "kind": "Definition",
    "name": "HeatFlowRate",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 5991,
    "endOffset": 6036,
    "fieldRanges": {
      "name": {
        "startOffset": 6014,
        "endOffset": 6026
      },
      "declaredName": {
        "startOffset": 6014,
        "endOffset": 6026
      }
    },
    "exports": [
      "abstract attribute def HeatFlowRate :> Power;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Power"
    }
  },
  {
    "id": 221,
    "kind": "Reference",
    "name": "Power",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 220,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6030,
    "endOffset": 6035,
    "fieldRanges": {
      "name": {
        "startOffset": 6030,
        "endOffset": 6035
      },
      "superclassifier": {
        "startOffset": 6030,
        "endOffset": 6035
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 222,
    "kind": "Definition",
    "name": "ThermalConductivity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6041,
    "endOffset": 6092,
    "fieldRanges": {
      "name": {
        "startOffset": 6064,
        "endOffset": 6083
      },
      "declaredName": {
        "startOffset": 6064,
        "endOffset": 6083
      }
    },
    "exports": [
      "abstract attribute def ThermalConductivity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 223,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 222,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6087,
    "endOffset": 6091,
    "fieldRanges": {
      "name": {
        "startOffset": 6087,
        "endOffset": 6091
      },
      "superclassifier": {
        "startOffset": 6087,
        "endOffset": 6091
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 224,
    "kind": "Definition",
    "name": "HeatCapacity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6097,
    "endOffset": 6141,
    "fieldRanges": {
      "name": {
        "startOffset": 6120,
        "endOffset": 6132
      },
      "declaredName": {
        "startOffset": 6120,
        "endOffset": 6132
      }
    },
    "exports": [
      "abstract attribute def HeatCapacity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 225,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 224,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6136,
    "endOffset": 6140,
    "fieldRanges": {
      "name": {
        "startOffset": 6136,
        "endOffset": 6140
      },
      "superclassifier": {
        "startOffset": 6136,
        "endOffset": 6140
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 226,
    "kind": "Definition",
    "name": "SpecificHeatCapacity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6146,
    "endOffset": 6198,
    "fieldRanges": {
      "name": {
        "startOffset": 6169,
        "endOffset": 6189
      },
      "declaredName": {
        "startOffset": 6169,
        "endOffset": 6189
      }
    },
    "exports": [
      "abstract attribute def SpecificHeatCapacity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 227,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 226,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6193,
    "endOffset": 6197,
    "fieldRanges": {
      "name": {
        "startOffset": 6193,
        "endOffset": 6197
      },
      "superclassifier": {
        "startOffset": 6193,
        "endOffset": 6197
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 228,
    "kind": "Definition",
    "name": "Entropy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6203,
    "endOffset": 6242,
    "fieldRanges": {
      "name": {
        "startOffset": 6226,
        "endOffset": 6233
      },
      "declaredName": {
        "startOffset": 6226,
        "endOffset": 6233
      }
    },
    "exports": [
      "abstract attribute def Entropy :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 229,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 228,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6237,
    "endOffset": 6241,
    "fieldRanges": {
      "name": {
        "startOffset": 6237,
        "endOffset": 6241
      },
      "superclassifier": {
        "startOffset": 6237,
        "endOffset": 6241
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 230,
    "kind": "Definition",
    "name": "Enthalpy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6247,
    "endOffset": 6289,
    "fieldRanges": {
      "name": {
        "startOffset": 6270,
        "endOffset": 6278
      },
      "declaredName": {
        "startOffset": 6270,
        "endOffset": 6278
      }
    },
    "exports": [
      "abstract attribute def Enthalpy :> Energy;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Energy"
    }
  },
  {
    "id": 231,
    "kind": "Reference",
    "name": "Energy",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 230,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6282,
    "endOffset": 6288,
    "fieldRanges": {
      "name": {
        "startOffset": 6282,
        "endOffset": 6288
      },
      "superclassifier": {
        "startOffset": 6282,
        "endOffset": 6288
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 232,
    "kind": "Definition",
    "name": "InternalEnergy",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6294,
    "endOffset": 6342,
    "fieldRanges": {
      "name": {
        "startOffset": 6317,
        "endOffset": 6331
      },
      "declaredName": {
        "startOffset": 6317,
        "endOffset": 6331
      }
    },
    "exports": [
      "abstract attribute def InternalEnergy :> Energy;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Energy"
    }
  },
  {
    "id": 233,
    "kind": "Reference",
    "name": "Energy",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 232,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6335,
    "endOffset": 6341,
    "fieldRanges": {
      "name": {
        "startOffset": 6335,
        "endOffset": 6341
      },
      "superclassifier": {
        "startOffset": 6335,
        "endOffset": 6341
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 234,
    "kind": "Definition",
    "name": "ElectricCurrent",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6397,
    "endOffset": 6444,
    "fieldRanges": {
      "name": {
        "startOffset": 6420,
        "endOffset": 6435
      },
      "declaredName": {
        "startOffset": 6420,
        "endOffset": 6435
      }
    },
    "exports": [
      "abstract attribute def ElectricCurrent :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 235,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 234,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6439,
    "endOffset": 6443,
    "fieldRanges": {
      "name": {
        "startOffset": 6439,
        "endOffset": 6443
      },
      "superclassifier": {
        "startOffset": 6439,
        "endOffset": 6443
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 236,
    "kind": "Definition",
    "name": "ElectricCharge",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6449,
    "endOffset": 6495,
    "fieldRanges": {
      "name": {
        "startOffset": 6472,
        "endOffset": 6486
      },
      "declaredName": {
        "startOffset": 6472,
        "endOffset": 6486
      }
    },
    "exports": [
      "abstract attribute def ElectricCharge :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 237,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 236,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6490,
    "endOffset": 6494,
    "fieldRanges": {
      "name": {
        "startOffset": 6490,
        "endOffset": 6494
      },
      "superclassifier": {
        "startOffset": 6490,
        "endOffset": 6494
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 238,
    "kind": "Definition",
    "name": "Voltage",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6500,
    "endOffset": 6539,
    "fieldRanges": {
      "name": {
        "startOffset": 6523,
        "endOffset": 6530
      },
      "declaredName": {
        "startOffset": 6523,
        "endOffset": 6530
      }
    },
    "exports": [
      "abstract attribute def Voltage :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 239,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 238,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6534,
    "endOffset": 6538,
    "fieldRanges": {
      "name": {
        "startOffset": 6534,
        "endOffset": 6538
      },
      "superclassifier": {
        "startOffset": 6534,
        "endOffset": 6538
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 240,
    "kind": "Definition",
    "name": "ElectricPotential",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6544,
    "endOffset": 6596,
    "fieldRanges": {
      "name": {
        "startOffset": 6567,
        "endOffset": 6584
      },
      "declaredName": {
        "startOffset": 6567,
        "endOffset": 6584
      }
    },
    "exports": [
      "abstract attribute def ElectricPotential :> Voltage;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Voltage"
    }
  },
  {
    "id": 241,
    "kind": "Reference",
    "name": "Voltage",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 240,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6588,
    "endOffset": 6595,
    "fieldRanges": {
      "name": {
        "startOffset": 6588,
        "endOffset": 6595
      },
      "superclassifier": {
        "startOffset": 6588,
        "endOffset": 6595
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 242,
    "kind": "Definition",
    "name": "ElectromotiveForce",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6601,
    "endOffset": 6654,
    "fieldRanges": {
      "name": {
        "startOffset": 6624,
        "endOffset": 6642
      },
      "declaredName": {
        "startOffset": 6624,
        "endOffset": 6642
      }
    },
    "exports": [
      "abstract attribute def ElectromotiveForce :> Voltage;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Voltage"
    }
  },
  {
    "id": 243,
    "kind": "Reference",
    "name": "Voltage",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 242,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6646,
    "endOffset": 6653,
    "fieldRanges": {
      "name": {
        "startOffset": 6646,
        "endOffset": 6653
      },
      "superclassifier": {
        "startOffset": 6646,
        "endOffset": 6653
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 244,
    "kind": "Definition",
    "name": "ElectricFieldStrength",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6659,
    "endOffset": 6712,
    "fieldRanges": {
      "name": {
        "startOffset": 6682,
        "endOffset": 6703
      },
      "declaredName": {
        "startOffset": 6682,
        "endOffset": 6703
      }
    },
    "exports": [
      "abstract attribute def ElectricFieldStrength :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 245,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 244,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6707,
    "endOffset": 6711,
    "fieldRanges": {
      "name": {
        "startOffset": 6707,
        "endOffset": 6711
      },
      "superclassifier": {
        "startOffset": 6707,
        "endOffset": 6711
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 246,
    "kind": "Definition",
    "name": "ElectricFlux",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6717,
    "endOffset": 6761,
    "fieldRanges": {
      "name": {
        "startOffset": 6740,
        "endOffset": 6752
      },
      "declaredName": {
        "startOffset": 6740,
        "endOffset": 6752
      }
    },
    "exports": [
      "abstract attribute def ElectricFlux :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 247,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 246,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6756,
    "endOffset": 6760,
    "fieldRanges": {
      "name": {
        "startOffset": 6756,
        "endOffset": 6760
      },
      "superclassifier": {
        "startOffset": 6756,
        "endOffset": 6760
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 248,
    "kind": "Definition",
    "name": "ElectricResistance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6766,
    "endOffset": 6816,
    "fieldRanges": {
      "name": {
        "startOffset": 6789,
        "endOffset": 6807
      },
      "declaredName": {
        "startOffset": 6789,
        "endOffset": 6807
      }
    },
    "exports": [
      "abstract attribute def ElectricResistance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 249,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 248,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6811,
    "endOffset": 6815,
    "fieldRanges": {
      "name": {
        "startOffset": 6811,
        "endOffset": 6815
      },
      "superclassifier": {
        "startOffset": 6811,
        "endOffset": 6815
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 250,
    "kind": "Definition",
    "name": "Conductance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6821,
    "endOffset": 6864,
    "fieldRanges": {
      "name": {
        "startOffset": 6844,
        "endOffset": 6855
      },
      "declaredName": {
        "startOffset": 6844,
        "endOffset": 6855
      }
    },
    "exports": [
      "abstract attribute def Conductance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 251,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 250,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6859,
    "endOffset": 6863,
    "fieldRanges": {
      "name": {
        "startOffset": 6859,
        "endOffset": 6863
      },
      "superclassifier": {
        "startOffset": 6859,
        "endOffset": 6863
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 252,
    "kind": "Definition",
    "name": "Resistivity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6869,
    "endOffset": 6912,
    "fieldRanges": {
      "name": {
        "startOffset": 6892,
        "endOffset": 6903
      },
      "declaredName": {
        "startOffset": 6892,
        "endOffset": 6903
      }
    },
    "exports": [
      "abstract attribute def Resistivity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 253,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 252,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6907,
    "endOffset": 6911,
    "fieldRanges": {
      "name": {
        "startOffset": 6907,
        "endOffset": 6911
      },
      "superclassifier": {
        "startOffset": 6907,
        "endOffset": 6911
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 254,
    "kind": "Definition",
    "name": "Conductivity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6917,
    "endOffset": 6961,
    "fieldRanges": {
      "name": {
        "startOffset": 6940,
        "endOffset": 6952
      },
      "declaredName": {
        "startOffset": 6940,
        "endOffset": 6952
      }
    },
    "exports": [
      "abstract attribute def Conductivity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 255,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 254,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6956,
    "endOffset": 6960,
    "fieldRanges": {
      "name": {
        "startOffset": 6956,
        "endOffset": 6960
      },
      "superclassifier": {
        "startOffset": 6956,
        "endOffset": 6960
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 256,
    "kind": "Definition",
    "name": "Capacitance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 6966,
    "endOffset": 7009,
    "fieldRanges": {
      "name": {
        "startOffset": 6989,
        "endOffset": 7000
      },
      "declaredName": {
        "startOffset": 6989,
        "endOffset": 7000
      }
    },
    "exports": [
      "abstract attribute def Capacitance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 257,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 256,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7004,
    "endOffset": 7008,
    "fieldRanges": {
      "name": {
        "startOffset": 7004,
        "endOffset": 7008
      },
      "superclassifier": {
        "startOffset": 7004,
        "endOffset": 7008
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 258,
    "kind": "Definition",
    "name": "Permittivity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7014,
    "endOffset": 7058,
    "fieldRanges": {
      "name": {
        "startOffset": 7037,
        "endOffset": 7049
      },
      "declaredName": {
        "startOffset": 7037,
        "endOffset": 7049
      }
    },
    "exports": [
      "abstract attribute def Permittivity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 259,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 258,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7053,
    "endOffset": 7057,
    "fieldRanges": {
      "name": {
        "startOffset": 7053,
        "endOffset": 7057
      },
      "superclassifier": {
        "startOffset": 7053,
        "endOffset": 7057
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 260,
    "kind": "Definition",
    "name": "MagneticFlux",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7063,
    "endOffset": 7107,
    "fieldRanges": {
      "name": {
        "startOffset": 7086,
        "endOffset": 7098
      },
      "declaredName": {
        "startOffset": 7086,
        "endOffset": 7098
      }
    },
    "exports": [
      "abstract attribute def MagneticFlux :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 261,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 260,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7102,
    "endOffset": 7106,
    "fieldRanges": {
      "name": {
        "startOffset": 7102,
        "endOffset": 7106
      },
      "superclassifier": {
        "startOffset": 7102,
        "endOffset": 7106
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 262,
    "kind": "Definition",
    "name": "MagneticFluxDensity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7112,
    "endOffset": 7163,
    "fieldRanges": {
      "name": {
        "startOffset": 7135,
        "endOffset": 7154
      },
      "declaredName": {
        "startOffset": 7135,
        "endOffset": 7154
      }
    },
    "exports": [
      "abstract attribute def MagneticFluxDensity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 263,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 262,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7158,
    "endOffset": 7162,
    "fieldRanges": {
      "name": {
        "startOffset": 7158,
        "endOffset": 7162
      },
      "superclassifier": {
        "startOffset": 7158,
        "endOffset": 7162
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 264,
    "kind": "Definition",
    "name": "MagneticFieldStrength",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7168,
    "endOffset": 7221,
    "fieldRanges": {
      "name": {
        "startOffset": 7191,
        "endOffset": 7212
      },
      "declaredName": {
        "startOffset": 7191,
        "endOffset": 7212
      }
    },
    "exports": [
      "abstract attribute def MagneticFieldStrength :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 265,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 264,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7216,
    "endOffset": 7220,
    "fieldRanges": {
      "name": {
        "startOffset": 7216,
        "endOffset": 7220
      },
      "superclassifier": {
        "startOffset": 7216,
        "endOffset": 7220
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 266,
    "kind": "Definition",
    "name": "Permeability",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7226,
    "endOffset": 7270,
    "fieldRanges": {
      "name": {
        "startOffset": 7249,
        "endOffset": 7261
      },
      "declaredName": {
        "startOffset": 7249,
        "endOffset": 7261
      }
    },
    "exports": [
      "abstract attribute def Permeability :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 267,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 266,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7265,
    "endOffset": 7269,
    "fieldRanges": {
      "name": {
        "startOffset": 7265,
        "endOffset": 7269
      },
      "superclassifier": {
        "startOffset": 7265,
        "endOffset": 7269
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 268,
    "kind": "Definition",
    "name": "Inductance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7275,
    "endOffset": 7317,
    "fieldRanges": {
      "name": {
        "startOffset": 7298,
        "endOffset": 7308
      },
      "declaredName": {
        "startOffset": 7298,
        "endOffset": 7308
      }
    },
    "exports": [
      "abstract attribute def Inductance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 269,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 268,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7312,
    "endOffset": 7316,
    "fieldRanges": {
      "name": {
        "startOffset": 7312,
        "endOffset": 7316
      },
      "superclassifier": {
        "startOffset": 7312,
        "endOffset": 7316
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 270,
    "kind": "Definition",
    "name": "Impedance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7322,
    "endOffset": 7363,
    "fieldRanges": {
      "name": {
        "startOffset": 7345,
        "endOffset": 7354
      },
      "declaredName": {
        "startOffset": 7345,
        "endOffset": 7354
      }
    },
    "exports": [
      "abstract attribute def Impedance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 271,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 270,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7358,
    "endOffset": 7362,
    "fieldRanges": {
      "name": {
        "startOffset": 7358,
        "endOffset": 7362
      },
      "superclassifier": {
        "startOffset": 7358,
        "endOffset": 7362
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 272,
    "kind": "Definition",
    "name": "Reactance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7368,
    "endOffset": 7409,
    "fieldRanges": {
      "name": {
        "startOffset": 7391,
        "endOffset": 7400
      },
      "declaredName": {
        "startOffset": 7391,
        "endOffset": 7400
      }
    },
    "exports": [
      "abstract attribute def Reactance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 273,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 272,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7404,
    "endOffset": 7408,
    "fieldRanges": {
      "name": {
        "startOffset": 7404,
        "endOffset": 7408
      },
      "superclassifier": {
        "startOffset": 7404,
        "endOffset": 7408
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 274,
    "kind": "Definition",
    "name": "AmountOfSubstance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7469,
    "endOffset": 7518,
    "fieldRanges": {
      "name": {
        "startOffset": 7492,
        "endOffset": 7509
      },
      "declaredName": {
        "startOffset": 7492,
        "endOffset": 7509
      }
    },
    "exports": [
      "abstract attribute def AmountOfSubstance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 275,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 274,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7513,
    "endOffset": 7517,
    "fieldRanges": {
      "name": {
        "startOffset": 7513,
        "endOffset": 7517
      },
      "superclassifier": {
        "startOffset": 7513,
        "endOffset": 7517
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 276,
    "kind": "Definition",
    "name": "MolarMass",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7523,
    "endOffset": 7564,
    "fieldRanges": {
      "name": {
        "startOffset": 7546,
        "endOffset": 7555
      },
      "declaredName": {
        "startOffset": 7546,
        "endOffset": 7555
      }
    },
    "exports": [
      "abstract attribute def MolarMass :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 277,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 276,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7559,
    "endOffset": 7563,
    "fieldRanges": {
      "name": {
        "startOffset": 7559,
        "endOffset": 7563
      },
      "superclassifier": {
        "startOffset": 7559,
        "endOffset": 7563
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 278,
    "kind": "Definition",
    "name": "LuminousIntensity",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7569,
    "endOffset": 7618,
    "fieldRanges": {
      "name": {
        "startOffset": 7592,
        "endOffset": 7609
      },
      "declaredName": {
        "startOffset": 7592,
        "endOffset": 7609
      }
    },
    "exports": [
      "abstract attribute def LuminousIntensity :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 279,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 278,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7613,
    "endOffset": 7617,
    "fieldRanges": {
      "name": {
        "startOffset": 7613,
        "endOffset": 7617
      },
      "superclassifier": {
        "startOffset": 7613,
        "endOffset": 7617
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 280,
    "kind": "Definition",
    "name": "LuminousFlux",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7623,
    "endOffset": 7667,
    "fieldRanges": {
      "name": {
        "startOffset": 7646,
        "endOffset": 7658
      },
      "declaredName": {
        "startOffset": 7646,
        "endOffset": 7658
      }
    },
    "exports": [
      "abstract attribute def LuminousFlux :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 281,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 280,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7662,
    "endOffset": 7666,
    "fieldRanges": {
      "name": {
        "startOffset": 7662,
        "endOffset": 7666
      },
      "superclassifier": {
        "startOffset": 7662,
        "endOffset": 7666
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 282,
    "kind": "Definition",
    "name": "Illuminance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7672,
    "endOffset": 7715,
    "fieldRanges": {
      "name": {
        "startOffset": 7695,
        "endOffset": 7706
      },
      "declaredName": {
        "startOffset": 7695,
        "endOffset": 7706
      }
    },
    "exports": [
      "abstract attribute def Illuminance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 283,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 282,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7710,
    "endOffset": 7714,
    "fieldRanges": {
      "name": {
        "startOffset": 7710,
        "endOffset": 7714
      },
      "superclassifier": {
        "startOffset": 7710,
        "endOffset": 7714
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 284,
    "kind": "Definition",
    "name": "Luminance",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 104,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7720,
    "endOffset": 7761,
    "fieldRanges": {
      "name": {
        "startOffset": 7743,
        "endOffset": 7752
      },
      "declaredName": {
        "startOffset": 7743,
        "endOffset": 7752
      }
    },
    "exports": [
      "abstract attribute def Luminance :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 285,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 284,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7756,
    "endOffset": 7760,
    "fieldRanges": {
      "name": {
        "startOffset": 7756,
        "endOffset": 7760
      },
      "superclassifier": {
        "startOffset": 7756,
        "endOffset": 7760
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 286,
    "kind": "Package",
    "name": "SIBaseUnits",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7765,
    "endOffset": 8118,
    "fieldRanges": {
      "name": {
        "startOffset": 7773,
        "endOffset": 7784
      },
      "declaredName": {
        "startOffset": 7773,
        "endOffset": 7784
      }
    },
    "exports": [
      "package SIBaseUnits {\n    import ScalarValues::*;\n\n    abstract attribute def Second :> Real;\n    abstract attribute def Kilogram :> Real;\n    abstract attribute def Metre :> Real;\n    abstract attribute def Ampere :> Real;\n    abstract attribute def Kelvin :> Real;\n    abstract attribute def Mole :> Real;\n    abstract attribute def Candela :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 287,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7791,
    "endOffset": 7813,
    "fieldRanges": {
      "name": {
        "startOffset": 7798,
        "endOffset": 7810
      },
      "importedNamespace": {
        "startOffset": 7798,
        "endOffset": 7810
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
    "id": 288,
    "kind": "Definition",
    "name": "Second",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7820,
    "endOffset": 7858,
    "fieldRanges": {
      "name": {
        "startOffset": 7843,
        "endOffset": 7849
      },
      "declaredName": {
        "startOffset": 7843,
        "endOffset": 7849
      }
    },
    "exports": [
      "abstract attribute def Second :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 289,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 288,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7853,
    "endOffset": 7857,
    "fieldRanges": {
      "name": {
        "startOffset": 7853,
        "endOffset": 7857
      },
      "superclassifier": {
        "startOffset": 7853,
        "endOffset": 7857
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 290,
    "kind": "Definition",
    "name": "Kilogram",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7863,
    "endOffset": 7903,
    "fieldRanges": {
      "name": {
        "startOffset": 7886,
        "endOffset": 7894
      },
      "declaredName": {
        "startOffset": 7886,
        "endOffset": 7894
      }
    },
    "exports": [
      "abstract attribute def Kilogram :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 291,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 290,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7898,
    "endOffset": 7902,
    "fieldRanges": {
      "name": {
        "startOffset": 7898,
        "endOffset": 7902
      },
      "superclassifier": {
        "startOffset": 7898,
        "endOffset": 7902
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 292,
    "kind": "Definition",
    "name": "Metre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7908,
    "endOffset": 7945,
    "fieldRanges": {
      "name": {
        "startOffset": 7931,
        "endOffset": 7936
      },
      "declaredName": {
        "startOffset": 7931,
        "endOffset": 7936
      }
    },
    "exports": [
      "abstract attribute def Metre :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 293,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 292,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7940,
    "endOffset": 7944,
    "fieldRanges": {
      "name": {
        "startOffset": 7940,
        "endOffset": 7944
      },
      "superclassifier": {
        "startOffset": 7940,
        "endOffset": 7944
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 294,
    "kind": "Definition",
    "name": "Ampere",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7950,
    "endOffset": 7988,
    "fieldRanges": {
      "name": {
        "startOffset": 7973,
        "endOffset": 7979
      },
      "declaredName": {
        "startOffset": 7973,
        "endOffset": 7979
      }
    },
    "exports": [
      "abstract attribute def Ampere :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 295,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 294,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7983,
    "endOffset": 7987,
    "fieldRanges": {
      "name": {
        "startOffset": 7983,
        "endOffset": 7987
      },
      "superclassifier": {
        "startOffset": 7983,
        "endOffset": 7987
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 296,
    "kind": "Definition",
    "name": "Kelvin",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 7993,
    "endOffset": 8031,
    "fieldRanges": {
      "name": {
        "startOffset": 8016,
        "endOffset": 8022
      },
      "declaredName": {
        "startOffset": 8016,
        "endOffset": 8022
      }
    },
    "exports": [
      "abstract attribute def Kelvin :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 297,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 296,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8026,
    "endOffset": 8030,
    "fieldRanges": {
      "name": {
        "startOffset": 8026,
        "endOffset": 8030
      },
      "superclassifier": {
        "startOffset": 8026,
        "endOffset": 8030
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 298,
    "kind": "Definition",
    "name": "Mole",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8036,
    "endOffset": 8072,
    "fieldRanges": {
      "name": {
        "startOffset": 8059,
        "endOffset": 8063
      },
      "declaredName": {
        "startOffset": 8059,
        "endOffset": 8063
      }
    },
    "exports": [
      "abstract attribute def Mole :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 299,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 298,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8067,
    "endOffset": 8071,
    "fieldRanges": {
      "name": {
        "startOffset": 8067,
        "endOffset": 8071
      },
      "superclassifier": {
        "startOffset": 8067,
        "endOffset": 8071
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 300,
    "kind": "Definition",
    "name": "Candela",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 286,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8077,
    "endOffset": 8116,
    "fieldRanges": {
      "name": {
        "startOffset": 8100,
        "endOffset": 8107
      },
      "declaredName": {
        "startOffset": 8100,
        "endOffset": 8107
      }
    },
    "exports": [
      "abstract attribute def Candela :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 301,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 300,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8111,
    "endOffset": 8115,
    "fieldRanges": {
      "name": {
        "startOffset": 8111,
        "endOffset": 8115
      },
      "superclassifier": {
        "startOffset": 8111,
        "endOffset": 8115
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 302,
    "kind": "Package",
    "name": "SIDerivedUnits",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8120,
    "endOffset": 9117,
    "fieldRanges": {
      "name": {
        "startOffset": 8128,
        "endOffset": 8142
      },
      "declaredName": {
        "startOffset": 8128,
        "endOffset": 8142
      }
    },
    "exports": [
      "package SIDerivedUnits {\n    import ScalarValues::*;\n\n    abstract attribute def Newton :> Real;\n    abstract attribute def Pascal :> Real;\n    abstract attribute def Joule :> Real;\n    abstract attribute def Watt :> Real;\n    abstract attribute def Volt :> Real;\n    abstract attribute def Coulomb :> Real;\n    abstract attribute def Ohm :> Real;\n    abstract attribute def Siemens :> Real;\n    abstract attribute def Farad :> Real;\n    abstract attribute def Henry :> Real;\n    abstract attribute def Weber :> Real;\n    abstract attribute def Tesla :> Real;\n    abstract attribute def Hertz :> Real;\n    abstract attribute def Radian :> Real;\n    abstract attribute def Steradian :> Real;\n    abstract attribute def Lumen :> Real;\n    abstract attribute def Lux :> Real;\n    abstract attribute def Becquerel :> Real;\n    abstract attribute def Gray :> Real;\n    abstract attribute def Sievert :> Real;\n    abstract attribute def Katal :> Real;\n    abstract attribute def DegreeCelsius :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 303,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8149,
    "endOffset": 8171,
    "fieldRanges": {
      "name": {
        "startOffset": 8156,
        "endOffset": 8168
      },
      "importedNamespace": {
        "startOffset": 8156,
        "endOffset": 8168
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
    "id": 304,
    "kind": "Definition",
    "name": "Newton",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8178,
    "endOffset": 8216,
    "fieldRanges": {
      "name": {
        "startOffset": 8201,
        "endOffset": 8207
      },
      "declaredName": {
        "startOffset": 8201,
        "endOffset": 8207
      }
    },
    "exports": [
      "abstract attribute def Newton :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 305,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 304,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8211,
    "endOffset": 8215,
    "fieldRanges": {
      "name": {
        "startOffset": 8211,
        "endOffset": 8215
      },
      "superclassifier": {
        "startOffset": 8211,
        "endOffset": 8215
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 306,
    "kind": "Definition",
    "name": "Pascal",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8221,
    "endOffset": 8259,
    "fieldRanges": {
      "name": {
        "startOffset": 8244,
        "endOffset": 8250
      },
      "declaredName": {
        "startOffset": 8244,
        "endOffset": 8250
      }
    },
    "exports": [
      "abstract attribute def Pascal :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 307,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 306,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8254,
    "endOffset": 8258,
    "fieldRanges": {
      "name": {
        "startOffset": 8254,
        "endOffset": 8258
      },
      "superclassifier": {
        "startOffset": 8254,
        "endOffset": 8258
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 308,
    "kind": "Definition",
    "name": "Joule",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8264,
    "endOffset": 8301,
    "fieldRanges": {
      "name": {
        "startOffset": 8287,
        "endOffset": 8292
      },
      "declaredName": {
        "startOffset": 8287,
        "endOffset": 8292
      }
    },
    "exports": [
      "abstract attribute def Joule :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 309,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 308,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8296,
    "endOffset": 8300,
    "fieldRanges": {
      "name": {
        "startOffset": 8296,
        "endOffset": 8300
      },
      "superclassifier": {
        "startOffset": 8296,
        "endOffset": 8300
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 310,
    "kind": "Definition",
    "name": "Watt",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8306,
    "endOffset": 8342,
    "fieldRanges": {
      "name": {
        "startOffset": 8329,
        "endOffset": 8333
      },
      "declaredName": {
        "startOffset": 8329,
        "endOffset": 8333
      }
    },
    "exports": [
      "abstract attribute def Watt :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 311,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 310,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8337,
    "endOffset": 8341,
    "fieldRanges": {
      "name": {
        "startOffset": 8337,
        "endOffset": 8341
      },
      "superclassifier": {
        "startOffset": 8337,
        "endOffset": 8341
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 312,
    "kind": "Definition",
    "name": "Volt",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8347,
    "endOffset": 8383,
    "fieldRanges": {
      "name": {
        "startOffset": 8370,
        "endOffset": 8374
      },
      "declaredName": {
        "startOffset": 8370,
        "endOffset": 8374
      }
    },
    "exports": [
      "abstract attribute def Volt :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 313,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 312,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8378,
    "endOffset": 8382,
    "fieldRanges": {
      "name": {
        "startOffset": 8378,
        "endOffset": 8382
      },
      "superclassifier": {
        "startOffset": 8378,
        "endOffset": 8382
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 314,
    "kind": "Definition",
    "name": "Coulomb",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8388,
    "endOffset": 8427,
    "fieldRanges": {
      "name": {
        "startOffset": 8411,
        "endOffset": 8418
      },
      "declaredName": {
        "startOffset": 8411,
        "endOffset": 8418
      }
    },
    "exports": [
      "abstract attribute def Coulomb :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 315,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 314,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8422,
    "endOffset": 8426,
    "fieldRanges": {
      "name": {
        "startOffset": 8422,
        "endOffset": 8426
      },
      "superclassifier": {
        "startOffset": 8422,
        "endOffset": 8426
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 316,
    "kind": "Definition",
    "name": "Ohm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8432,
    "endOffset": 8467,
    "fieldRanges": {
      "name": {
        "startOffset": 8455,
        "endOffset": 8458
      },
      "declaredName": {
        "startOffset": 8455,
        "endOffset": 8458
      }
    },
    "exports": [
      "abstract attribute def Ohm :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 317,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 316,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8462,
    "endOffset": 8466,
    "fieldRanges": {
      "name": {
        "startOffset": 8462,
        "endOffset": 8466
      },
      "superclassifier": {
        "startOffset": 8462,
        "endOffset": 8466
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 318,
    "kind": "Definition",
    "name": "Siemens",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8472,
    "endOffset": 8511,
    "fieldRanges": {
      "name": {
        "startOffset": 8495,
        "endOffset": 8502
      },
      "declaredName": {
        "startOffset": 8495,
        "endOffset": 8502
      }
    },
    "exports": [
      "abstract attribute def Siemens :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 319,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 318,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8506,
    "endOffset": 8510,
    "fieldRanges": {
      "name": {
        "startOffset": 8506,
        "endOffset": 8510
      },
      "superclassifier": {
        "startOffset": 8506,
        "endOffset": 8510
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 320,
    "kind": "Definition",
    "name": "Farad",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8516,
    "endOffset": 8553,
    "fieldRanges": {
      "name": {
        "startOffset": 8539,
        "endOffset": 8544
      },
      "declaredName": {
        "startOffset": 8539,
        "endOffset": 8544
      }
    },
    "exports": [
      "abstract attribute def Farad :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 321,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 320,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8548,
    "endOffset": 8552,
    "fieldRanges": {
      "name": {
        "startOffset": 8548,
        "endOffset": 8552
      },
      "superclassifier": {
        "startOffset": 8548,
        "endOffset": 8552
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 322,
    "kind": "Definition",
    "name": "Henry",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8558,
    "endOffset": 8595,
    "fieldRanges": {
      "name": {
        "startOffset": 8581,
        "endOffset": 8586
      },
      "declaredName": {
        "startOffset": 8581,
        "endOffset": 8586
      }
    },
    "exports": [
      "abstract attribute def Henry :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 323,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 322,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8590,
    "endOffset": 8594,
    "fieldRanges": {
      "name": {
        "startOffset": 8590,
        "endOffset": 8594
      },
      "superclassifier": {
        "startOffset": 8590,
        "endOffset": 8594
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 324,
    "kind": "Definition",
    "name": "Weber",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8600,
    "endOffset": 8637,
    "fieldRanges": {
      "name": {
        "startOffset": 8623,
        "endOffset": 8628
      },
      "declaredName": {
        "startOffset": 8623,
        "endOffset": 8628
      }
    },
    "exports": [
      "abstract attribute def Weber :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 325,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 324,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8632,
    "endOffset": 8636,
    "fieldRanges": {
      "name": {
        "startOffset": 8632,
        "endOffset": 8636
      },
      "superclassifier": {
        "startOffset": 8632,
        "endOffset": 8636
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 326,
    "kind": "Definition",
    "name": "Tesla",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8642,
    "endOffset": 8679,
    "fieldRanges": {
      "name": {
        "startOffset": 8665,
        "endOffset": 8670
      },
      "declaredName": {
        "startOffset": 8665,
        "endOffset": 8670
      }
    },
    "exports": [
      "abstract attribute def Tesla :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 327,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 326,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8674,
    "endOffset": 8678,
    "fieldRanges": {
      "name": {
        "startOffset": 8674,
        "endOffset": 8678
      },
      "superclassifier": {
        "startOffset": 8674,
        "endOffset": 8678
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 328,
    "kind": "Definition",
    "name": "Hertz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8684,
    "endOffset": 8721,
    "fieldRanges": {
      "name": {
        "startOffset": 8707,
        "endOffset": 8712
      },
      "declaredName": {
        "startOffset": 8707,
        "endOffset": 8712
      }
    },
    "exports": [
      "abstract attribute def Hertz :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 329,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 328,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8716,
    "endOffset": 8720,
    "fieldRanges": {
      "name": {
        "startOffset": 8716,
        "endOffset": 8720
      },
      "superclassifier": {
        "startOffset": 8716,
        "endOffset": 8720
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 330,
    "kind": "Definition",
    "name": "Radian",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8726,
    "endOffset": 8764,
    "fieldRanges": {
      "name": {
        "startOffset": 8749,
        "endOffset": 8755
      },
      "declaredName": {
        "startOffset": 8749,
        "endOffset": 8755
      }
    },
    "exports": [
      "abstract attribute def Radian :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 331,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 330,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8759,
    "endOffset": 8763,
    "fieldRanges": {
      "name": {
        "startOffset": 8759,
        "endOffset": 8763
      },
      "superclassifier": {
        "startOffset": 8759,
        "endOffset": 8763
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 332,
    "kind": "Definition",
    "name": "Steradian",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8769,
    "endOffset": 8810,
    "fieldRanges": {
      "name": {
        "startOffset": 8792,
        "endOffset": 8801
      },
      "declaredName": {
        "startOffset": 8792,
        "endOffset": 8801
      }
    },
    "exports": [
      "abstract attribute def Steradian :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 333,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 332,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8805,
    "endOffset": 8809,
    "fieldRanges": {
      "name": {
        "startOffset": 8805,
        "endOffset": 8809
      },
      "superclassifier": {
        "startOffset": 8805,
        "endOffset": 8809
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 334,
    "kind": "Definition",
    "name": "Lumen",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8815,
    "endOffset": 8852,
    "fieldRanges": {
      "name": {
        "startOffset": 8838,
        "endOffset": 8843
      },
      "declaredName": {
        "startOffset": 8838,
        "endOffset": 8843
      }
    },
    "exports": [
      "abstract attribute def Lumen :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 335,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 334,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8847,
    "endOffset": 8851,
    "fieldRanges": {
      "name": {
        "startOffset": 8847,
        "endOffset": 8851
      },
      "superclassifier": {
        "startOffset": 8847,
        "endOffset": 8851
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 336,
    "kind": "Definition",
    "name": "Lux",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8857,
    "endOffset": 8892,
    "fieldRanges": {
      "name": {
        "startOffset": 8880,
        "endOffset": 8883
      },
      "declaredName": {
        "startOffset": 8880,
        "endOffset": 8883
      }
    },
    "exports": [
      "abstract attribute def Lux :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 337,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 336,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8887,
    "endOffset": 8891,
    "fieldRanges": {
      "name": {
        "startOffset": 8887,
        "endOffset": 8891
      },
      "superclassifier": {
        "startOffset": 8887,
        "endOffset": 8891
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 338,
    "kind": "Definition",
    "name": "Becquerel",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8897,
    "endOffset": 8938,
    "fieldRanges": {
      "name": {
        "startOffset": 8920,
        "endOffset": 8929
      },
      "declaredName": {
        "startOffset": 8920,
        "endOffset": 8929
      }
    },
    "exports": [
      "abstract attribute def Becquerel :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 339,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 338,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8933,
    "endOffset": 8937,
    "fieldRanges": {
      "name": {
        "startOffset": 8933,
        "endOffset": 8937
      },
      "superclassifier": {
        "startOffset": 8933,
        "endOffset": 8937
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 340,
    "kind": "Definition",
    "name": "Gray",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8943,
    "endOffset": 8979,
    "fieldRanges": {
      "name": {
        "startOffset": 8966,
        "endOffset": 8970
      },
      "declaredName": {
        "startOffset": 8966,
        "endOffset": 8970
      }
    },
    "exports": [
      "abstract attribute def Gray :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 341,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 340,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8974,
    "endOffset": 8978,
    "fieldRanges": {
      "name": {
        "startOffset": 8974,
        "endOffset": 8978
      },
      "superclassifier": {
        "startOffset": 8974,
        "endOffset": 8978
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 342,
    "kind": "Definition",
    "name": "Sievert",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 8984,
    "endOffset": 9023,
    "fieldRanges": {
      "name": {
        "startOffset": 9007,
        "endOffset": 9014
      },
      "declaredName": {
        "startOffset": 9007,
        "endOffset": 9014
      }
    },
    "exports": [
      "abstract attribute def Sievert :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 343,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 342,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9018,
    "endOffset": 9022,
    "fieldRanges": {
      "name": {
        "startOffset": 9018,
        "endOffset": 9022
      },
      "superclassifier": {
        "startOffset": 9018,
        "endOffset": 9022
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 344,
    "kind": "Definition",
    "name": "Katal",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9028,
    "endOffset": 9065,
    "fieldRanges": {
      "name": {
        "startOffset": 9051,
        "endOffset": 9056
      },
      "declaredName": {
        "startOffset": 9051,
        "endOffset": 9056
      }
    },
    "exports": [
      "abstract attribute def Katal :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 345,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 344,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9060,
    "endOffset": 9064,
    "fieldRanges": {
      "name": {
        "startOffset": 9060,
        "endOffset": 9064
      },
      "superclassifier": {
        "startOffset": 9060,
        "endOffset": 9064
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 346,
    "kind": "Definition",
    "name": "DegreeCelsius",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 302,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9070,
    "endOffset": 9115,
    "fieldRanges": {
      "name": {
        "startOffset": 9093,
        "endOffset": 9106
      },
      "declaredName": {
        "startOffset": 9093,
        "endOffset": 9106
      }
    },
    "exports": [
      "abstract attribute def DegreeCelsius :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 347,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 346,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9110,
    "endOffset": 9114,
    "fieldRanges": {
      "name": {
        "startOffset": 9110,
        "endOffset": 9114
      },
      "superclassifier": {
        "startOffset": 9110,
        "endOffset": 9114
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 348,
    "kind": "Package",
    "name": "SI",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9119,
    "endOffset": 13074,
    "fieldRanges": {
      "name": {
        "startOffset": 9127,
        "endOffset": 9129
      },
      "declaredName": {
        "startOffset": 9127,
        "endOffset": 9129
      }
    },
    "exports": [
      "package SI {\n    import ScalarValues::*;\n    import SIBaseUnits::*;\n    import SIDerivedUnits::*;\n\n    /* Base Unit Symbols */\n    abstract attribute def s :> Second;\n    abstract attribute def kg :> Kilogram;\n    abstract attribute def m :> Metre;\n    abstract attribute def A :> Ampere;\n    abstract attribute def K :> Kelvin;\n    abstract attribute def mol :> Mole;\n    abstract attribute def cd :> Candela;\n\n    /* Scaled and Derived Unit Symbols */\n    abstract attribute def g :> Real;\n    abstract attribute def mg :> Real;\n    abstract attribute def mm :> Real;\n    abstract attribute def cm :> Real;\n    abstract attribute def km :> Real;\n    abstract attribute def N :> Newton;\n    abstract attribute def kN :> Real;\n    abstract attribute def Pa :> Pascal;\n    abstract attribute def kPa :> Real;\n    abstract attribute def MPa :> Real;\n    abstract attribute def bar :> Real;\n    abstract attribute def J :> Joule;\n    abstract attribute def kJ :> Real;\n    abstract attribute def MJ :> Real;\n    abstract attribute def W :> Watt;\n    abstract attribute def kW :> Real;\n    abstract attribute def MW :> Real;\n    abstract attribute def V :> Volt;\n    abstract attribute def mV :> Real;\n    abstract attribute def kV :> Real;\n    abstract attribute def C :> Coulomb;\n    abstract attribute def ohm :> Ohm;\n    abstract attribute def kOhm :> Real;\n    abstract attribute def MOhm :> Real;\n    abstract attribute def F :> Farad;\n    abstract attribute def uF :> Real;\n    abstract attribute def nF :> Real;\n    abstract attribute def pF :> Real;\n    abstract attribute def H :> Henry;\n    abstract attribute def mH :> Real;\n    abstract attribute def uH :> Real;\n    abstract attribute def Hz :> Hertz;\n    abstract attribute def kHz :> Real;\n    abstract attribute def MHz :> Real;\n    abstract attribute def GHz :> Real;\n    abstract attribute def rad :> Radian;\n    abstract attribute def sr :> Steradian;\n    abstract attribute def kat :> Katal;\n    abstract attribute def deg :> Real;\n    abstract attribute def degC :> DegreeCelsius;\n\n    /* Scaled Full Unit Names */\n    abstract attribute def Millimetre :> Metre;\n    abstract attribute def Centimetre :> Metre;\n    abstract attribute def Kilometre :> Metre;\n    abstract attribute def Gram :> Real;\n    abstract attribute def Milligram :> Real;\n    abstract attribute def Millisecond :> Second;\n    abstract attribute def Minute :> Real;\n    abstract attribute def Hour :> Real;\n    abstract attribute def Day :> Real;\n    abstract attribute def Kilowatt :> Watt;\n    abstract attribute def Megawatt :> Watt;\n    abstract attribute def Kilojoule :> Joule;\n    abstract attribute def Megajoule :> Joule;\n    abstract attribute def Kilopascal :> Pascal;\n    abstract attribute def Megapascal :> Pascal;\n    abstract attribute def Bar :> Real;\n    abstract attribute def Litre :> Real;\n    abstract attribute def Millilitre :> Real;\n\n    /* Prefixes */\n    abstract attribute def Yotta :> Real;\n    abstract attribute def Zetta :> Real;\n    abstract attribute def Exa :> Real;\n    abstract attribute def Peta :> Real;\n    abstract attribute def Tera :> Real;\n    abstract attribute def Giga :> Real;\n    abstract attribute def Mega :> Real;\n    abstract attribute def Kilo :> Real;\n    abstract attribute def Hecto :> Real;\n    abstract attribute def Deca :> Real;\n    abstract attribute def Deci :> Real;\n    abstract attribute def Centi :> Real;\n    abstract attribute def Milli :> Real;\n    abstract attribute def Micro :> Real;\n    abstract attribute def Nano :> Real;\n    abstract attribute def Pico :> Real;\n    abstract attribute def Femto :> Real;\n    abstract attribute def Atto :> Real;\n\n    abstract attribute def kilo :> Kilo;\n    abstract attribute def mega :> Mega;\n    abstract attribute def giga :> Giga;\n    abstract attribute def milli :> Milli;\n    abstract attribute def micro :> Micro;\n    abstract attribute def nano :> Nano;\n    abstract attribute def pico :> Pico;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 349,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9136,
    "endOffset": 9158,
    "fieldRanges": {
      "name": {
        "startOffset": 9143,
        "endOffset": 9155
      },
      "importedNamespace": {
        "startOffset": 9143,
        "endOffset": 9155
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
    "id": 350,
    "kind": "Import",
    "name": "SIBaseUnits",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9164,
    "endOffset": 9185,
    "fieldRanges": {
      "name": {
        "startOffset": 9171,
        "endOffset": 9182
      },
      "importedNamespace": {
        "startOffset": 9171,
        "endOffset": 9182
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
    "id": 351,
    "kind": "Import",
    "name": "SIDerivedUnits",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9191,
    "endOffset": 9215,
    "fieldRanges": {
      "name": {
        "startOffset": 9198,
        "endOffset": 9212
      },
      "importedNamespace": {
        "startOffset": 9198,
        "endOffset": 9212
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
    "id": 352,
    "kind": "Definition",
    "name": "s",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9250,
    "endOffset": 9285,
    "fieldRanges": {
      "name": {
        "startOffset": 9273,
        "endOffset": 9274
      },
      "declaredName": {
        "startOffset": 9273,
        "endOffset": 9274
      }
    },
    "exports": [
      "abstract attribute def s :> Second;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Second"
    }
  },
  {
    "id": 353,
    "kind": "Reference",
    "name": "Second",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 352,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9278,
    "endOffset": 9284,
    "fieldRanges": {
      "name": {
        "startOffset": 9278,
        "endOffset": 9284
      },
      "superclassifier": {
        "startOffset": 9278,
        "endOffset": 9284
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 354,
    "kind": "Definition",
    "name": "kg",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9290,
    "endOffset": 9328,
    "fieldRanges": {
      "name": {
        "startOffset": 9313,
        "endOffset": 9315
      },
      "declaredName": {
        "startOffset": 9313,
        "endOffset": 9315
      }
    },
    "exports": [
      "abstract attribute def kg :> Kilogram;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Kilogram"
    }
  },
  {
    "id": 355,
    "kind": "Reference",
    "name": "Kilogram",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 354,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9319,
    "endOffset": 9327,
    "fieldRanges": {
      "name": {
        "startOffset": 9319,
        "endOffset": 9327
      },
      "superclassifier": {
        "startOffset": 9319,
        "endOffset": 9327
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 356,
    "kind": "Definition",
    "name": "m",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9333,
    "endOffset": 9367,
    "fieldRanges": {
      "name": {
        "startOffset": 9356,
        "endOffset": 9357
      },
      "declaredName": {
        "startOffset": 9356,
        "endOffset": 9357
      }
    },
    "exports": [
      "abstract attribute def m :> Metre;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Metre"
    }
  },
  {
    "id": 357,
    "kind": "Reference",
    "name": "Metre",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 356,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9361,
    "endOffset": 9366,
    "fieldRanges": {
      "name": {
        "startOffset": 9361,
        "endOffset": 9366
      },
      "superclassifier": {
        "startOffset": 9361,
        "endOffset": 9366
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 358,
    "kind": "Definition",
    "name": "A",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9372,
    "endOffset": 9407,
    "fieldRanges": {
      "name": {
        "startOffset": 9395,
        "endOffset": 9396
      },
      "declaredName": {
        "startOffset": 9395,
        "endOffset": 9396
      }
    },
    "exports": [
      "abstract attribute def A :> Ampere;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Ampere"
    }
  },
  {
    "id": 359,
    "kind": "Reference",
    "name": "Ampere",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 358,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9400,
    "endOffset": 9406,
    "fieldRanges": {
      "name": {
        "startOffset": 9400,
        "endOffset": 9406
      },
      "superclassifier": {
        "startOffset": 9400,
        "endOffset": 9406
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 360,
    "kind": "Definition",
    "name": "K",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9412,
    "endOffset": 9447,
    "fieldRanges": {
      "name": {
        "startOffset": 9435,
        "endOffset": 9436
      },
      "declaredName": {
        "startOffset": 9435,
        "endOffset": 9436
      }
    },
    "exports": [
      "abstract attribute def K :> Kelvin;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Kelvin"
    }
  },
  {
    "id": 361,
    "kind": "Reference",
    "name": "Kelvin",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 360,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9440,
    "endOffset": 9446,
    "fieldRanges": {
      "name": {
        "startOffset": 9440,
        "endOffset": 9446
      },
      "superclassifier": {
        "startOffset": 9440,
        "endOffset": 9446
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 362,
    "kind": "Definition",
    "name": "mol",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9452,
    "endOffset": 9487,
    "fieldRanges": {
      "name": {
        "startOffset": 9475,
        "endOffset": 9478
      },
      "declaredName": {
        "startOffset": 9475,
        "endOffset": 9478
      }
    },
    "exports": [
      "abstract attribute def mol :> Mole;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Mole"
    }
  },
  {
    "id": 363,
    "kind": "Reference",
    "name": "Mole",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 362,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9482,
    "endOffset": 9486,
    "fieldRanges": {
      "name": {
        "startOffset": 9482,
        "endOffset": 9486
      },
      "superclassifier": {
        "startOffset": 9482,
        "endOffset": 9486
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 364,
    "kind": "Definition",
    "name": "cd",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9492,
    "endOffset": 9529,
    "fieldRanges": {
      "name": {
        "startOffset": 9515,
        "endOffset": 9517
      },
      "declaredName": {
        "startOffset": 9515,
        "endOffset": 9517
      }
    },
    "exports": [
      "abstract attribute def cd :> Candela;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Candela"
    }
  },
  {
    "id": 365,
    "kind": "Reference",
    "name": "Candela",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 364,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9521,
    "endOffset": 9528,
    "fieldRanges": {
      "name": {
        "startOffset": 9521,
        "endOffset": 9528
      },
      "superclassifier": {
        "startOffset": 9521,
        "endOffset": 9528
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 366,
    "kind": "Definition",
    "name": "g",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9577,
    "endOffset": 9610,
    "fieldRanges": {
      "name": {
        "startOffset": 9600,
        "endOffset": 9601
      },
      "declaredName": {
        "startOffset": 9600,
        "endOffset": 9601
      }
    },
    "exports": [
      "abstract attribute def g :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 367,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 366,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9605,
    "endOffset": 9609,
    "fieldRanges": {
      "name": {
        "startOffset": 9605,
        "endOffset": 9609
      },
      "superclassifier": {
        "startOffset": 9605,
        "endOffset": 9609
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 368,
    "kind": "Definition",
    "name": "mg",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9615,
    "endOffset": 9649,
    "fieldRanges": {
      "name": {
        "startOffset": 9638,
        "endOffset": 9640
      },
      "declaredName": {
        "startOffset": 9638,
        "endOffset": 9640
      }
    },
    "exports": [
      "abstract attribute def mg :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 369,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 368,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9644,
    "endOffset": 9648,
    "fieldRanges": {
      "name": {
        "startOffset": 9644,
        "endOffset": 9648
      },
      "superclassifier": {
        "startOffset": 9644,
        "endOffset": 9648
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 370,
    "kind": "Definition",
    "name": "mm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9654,
    "endOffset": 9688,
    "fieldRanges": {
      "name": {
        "startOffset": 9677,
        "endOffset": 9679
      },
      "declaredName": {
        "startOffset": 9677,
        "endOffset": 9679
      }
    },
    "exports": [
      "abstract attribute def mm :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 371,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 370,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9683,
    "endOffset": 9687,
    "fieldRanges": {
      "name": {
        "startOffset": 9683,
        "endOffset": 9687
      },
      "superclassifier": {
        "startOffset": 9683,
        "endOffset": 9687
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 372,
    "kind": "Definition",
    "name": "cm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9693,
    "endOffset": 9727,
    "fieldRanges": {
      "name": {
        "startOffset": 9716,
        "endOffset": 9718
      },
      "declaredName": {
        "startOffset": 9716,
        "endOffset": 9718
      }
    },
    "exports": [
      "abstract attribute def cm :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 373,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 372,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9722,
    "endOffset": 9726,
    "fieldRanges": {
      "name": {
        "startOffset": 9722,
        "endOffset": 9726
      },
      "superclassifier": {
        "startOffset": 9722,
        "endOffset": 9726
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 374,
    "kind": "Definition",
    "name": "km",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9732,
    "endOffset": 9766,
    "fieldRanges": {
      "name": {
        "startOffset": 9755,
        "endOffset": 9757
      },
      "declaredName": {
        "startOffset": 9755,
        "endOffset": 9757
      }
    },
    "exports": [
      "abstract attribute def km :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 375,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 374,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9761,
    "endOffset": 9765,
    "fieldRanges": {
      "name": {
        "startOffset": 9761,
        "endOffset": 9765
      },
      "superclassifier": {
        "startOffset": 9761,
        "endOffset": 9765
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 376,
    "kind": "Definition",
    "name": "N",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9771,
    "endOffset": 9806,
    "fieldRanges": {
      "name": {
        "startOffset": 9794,
        "endOffset": 9795
      },
      "declaredName": {
        "startOffset": 9794,
        "endOffset": 9795
      }
    },
    "exports": [
      "abstract attribute def N :> Newton;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Newton"
    }
  },
  {
    "id": 377,
    "kind": "Reference",
    "name": "Newton",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 376,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9799,
    "endOffset": 9805,
    "fieldRanges": {
      "name": {
        "startOffset": 9799,
        "endOffset": 9805
      },
      "superclassifier": {
        "startOffset": 9799,
        "endOffset": 9805
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 378,
    "kind": "Definition",
    "name": "kN",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9811,
    "endOffset": 9845,
    "fieldRanges": {
      "name": {
        "startOffset": 9834,
        "endOffset": 9836
      },
      "declaredName": {
        "startOffset": 9834,
        "endOffset": 9836
      }
    },
    "exports": [
      "abstract attribute def kN :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 379,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 378,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9840,
    "endOffset": 9844,
    "fieldRanges": {
      "name": {
        "startOffset": 9840,
        "endOffset": 9844
      },
      "superclassifier": {
        "startOffset": 9840,
        "endOffset": 9844
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 380,
    "kind": "Definition",
    "name": "Pa",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9850,
    "endOffset": 9886,
    "fieldRanges": {
      "name": {
        "startOffset": 9873,
        "endOffset": 9875
      },
      "declaredName": {
        "startOffset": 9873,
        "endOffset": 9875
      }
    },
    "exports": [
      "abstract attribute def Pa :> Pascal;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pascal"
    }
  },
  {
    "id": 381,
    "kind": "Reference",
    "name": "Pascal",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 380,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9879,
    "endOffset": 9885,
    "fieldRanges": {
      "name": {
        "startOffset": 9879,
        "endOffset": 9885
      },
      "superclassifier": {
        "startOffset": 9879,
        "endOffset": 9885
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 382,
    "kind": "Definition",
    "name": "kPa",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9891,
    "endOffset": 9926,
    "fieldRanges": {
      "name": {
        "startOffset": 9914,
        "endOffset": 9917
      },
      "declaredName": {
        "startOffset": 9914,
        "endOffset": 9917
      }
    },
    "exports": [
      "abstract attribute def kPa :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 383,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 382,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9921,
    "endOffset": 9925,
    "fieldRanges": {
      "name": {
        "startOffset": 9921,
        "endOffset": 9925
      },
      "superclassifier": {
        "startOffset": 9921,
        "endOffset": 9925
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 384,
    "kind": "Definition",
    "name": "MPa",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9931,
    "endOffset": 9966,
    "fieldRanges": {
      "name": {
        "startOffset": 9954,
        "endOffset": 9957
      },
      "declaredName": {
        "startOffset": 9954,
        "endOffset": 9957
      }
    },
    "exports": [
      "abstract attribute def MPa :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 385,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 384,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9961,
    "endOffset": 9965,
    "fieldRanges": {
      "name": {
        "startOffset": 9961,
        "endOffset": 9965
      },
      "superclassifier": {
        "startOffset": 9961,
        "endOffset": 9965
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 386,
    "kind": "Definition",
    "name": "bar",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 9971,
    "endOffset": 10006,
    "fieldRanges": {
      "name": {
        "startOffset": 9994,
        "endOffset": 9997
      },
      "declaredName": {
        "startOffset": 9994,
        "endOffset": 9997
      }
    },
    "exports": [
      "abstract attribute def bar :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 387,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 386,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10001,
    "endOffset": 10005,
    "fieldRanges": {
      "name": {
        "startOffset": 10001,
        "endOffset": 10005
      },
      "superclassifier": {
        "startOffset": 10001,
        "endOffset": 10005
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 388,
    "kind": "Definition",
    "name": "J",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10011,
    "endOffset": 10045,
    "fieldRanges": {
      "name": {
        "startOffset": 10034,
        "endOffset": 10035
      },
      "declaredName": {
        "startOffset": 10034,
        "endOffset": 10035
      }
    },
    "exports": [
      "abstract attribute def J :> Joule;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Joule"
    }
  },
  {
    "id": 389,
    "kind": "Reference",
    "name": "Joule",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 388,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10039,
    "endOffset": 10044,
    "fieldRanges": {
      "name": {
        "startOffset": 10039,
        "endOffset": 10044
      },
      "superclassifier": {
        "startOffset": 10039,
        "endOffset": 10044
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 390,
    "kind": "Definition",
    "name": "kJ",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10050,
    "endOffset": 10084,
    "fieldRanges": {
      "name": {
        "startOffset": 10073,
        "endOffset": 10075
      },
      "declaredName": {
        "startOffset": 10073,
        "endOffset": 10075
      }
    },
    "exports": [
      "abstract attribute def kJ :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 391,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 390,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10079,
    "endOffset": 10083,
    "fieldRanges": {
      "name": {
        "startOffset": 10079,
        "endOffset": 10083
      },
      "superclassifier": {
        "startOffset": 10079,
        "endOffset": 10083
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 392,
    "kind": "Definition",
    "name": "MJ",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10089,
    "endOffset": 10123,
    "fieldRanges": {
      "name": {
        "startOffset": 10112,
        "endOffset": 10114
      },
      "declaredName": {
        "startOffset": 10112,
        "endOffset": 10114
      }
    },
    "exports": [
      "abstract attribute def MJ :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 393,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 392,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10118,
    "endOffset": 10122,
    "fieldRanges": {
      "name": {
        "startOffset": 10118,
        "endOffset": 10122
      },
      "superclassifier": {
        "startOffset": 10118,
        "endOffset": 10122
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 394,
    "kind": "Definition",
    "name": "W",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10128,
    "endOffset": 10161,
    "fieldRanges": {
      "name": {
        "startOffset": 10151,
        "endOffset": 10152
      },
      "declaredName": {
        "startOffset": 10151,
        "endOffset": 10152
      }
    },
    "exports": [
      "abstract attribute def W :> Watt;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Watt"
    }
  },
  {
    "id": 395,
    "kind": "Reference",
    "name": "Watt",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 394,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10156,
    "endOffset": 10160,
    "fieldRanges": {
      "name": {
        "startOffset": 10156,
        "endOffset": 10160
      },
      "superclassifier": {
        "startOffset": 10156,
        "endOffset": 10160
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 396,
    "kind": "Definition",
    "name": "kW",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10166,
    "endOffset": 10200,
    "fieldRanges": {
      "name": {
        "startOffset": 10189,
        "endOffset": 10191
      },
      "declaredName": {
        "startOffset": 10189,
        "endOffset": 10191
      }
    },
    "exports": [
      "abstract attribute def kW :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 397,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 396,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10195,
    "endOffset": 10199,
    "fieldRanges": {
      "name": {
        "startOffset": 10195,
        "endOffset": 10199
      },
      "superclassifier": {
        "startOffset": 10195,
        "endOffset": 10199
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 398,
    "kind": "Definition",
    "name": "MW",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10205,
    "endOffset": 10239,
    "fieldRanges": {
      "name": {
        "startOffset": 10228,
        "endOffset": 10230
      },
      "declaredName": {
        "startOffset": 10228,
        "endOffset": 10230
      }
    },
    "exports": [
      "abstract attribute def MW :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 399,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 398,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10234,
    "endOffset": 10238,
    "fieldRanges": {
      "name": {
        "startOffset": 10234,
        "endOffset": 10238
      },
      "superclassifier": {
        "startOffset": 10234,
        "endOffset": 10238
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 400,
    "kind": "Definition",
    "name": "V",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10244,
    "endOffset": 10277,
    "fieldRanges": {
      "name": {
        "startOffset": 10267,
        "endOffset": 10268
      },
      "declaredName": {
        "startOffset": 10267,
        "endOffset": 10268
      }
    },
    "exports": [
      "abstract attribute def V :> Volt;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Volt"
    }
  },
  {
    "id": 401,
    "kind": "Reference",
    "name": "Volt",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 400,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10272,
    "endOffset": 10276,
    "fieldRanges": {
      "name": {
        "startOffset": 10272,
        "endOffset": 10276
      },
      "superclassifier": {
        "startOffset": 10272,
        "endOffset": 10276
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 402,
    "kind": "Definition",
    "name": "mV",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10282,
    "endOffset": 10316,
    "fieldRanges": {
      "name": {
        "startOffset": 10305,
        "endOffset": 10307
      },
      "declaredName": {
        "startOffset": 10305,
        "endOffset": 10307
      }
    },
    "exports": [
      "abstract attribute def mV :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 403,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 402,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10311,
    "endOffset": 10315,
    "fieldRanges": {
      "name": {
        "startOffset": 10311,
        "endOffset": 10315
      },
      "superclassifier": {
        "startOffset": 10311,
        "endOffset": 10315
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 404,
    "kind": "Definition",
    "name": "kV",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10321,
    "endOffset": 10355,
    "fieldRanges": {
      "name": {
        "startOffset": 10344,
        "endOffset": 10346
      },
      "declaredName": {
        "startOffset": 10344,
        "endOffset": 10346
      }
    },
    "exports": [
      "abstract attribute def kV :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 405,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 404,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10350,
    "endOffset": 10354,
    "fieldRanges": {
      "name": {
        "startOffset": 10350,
        "endOffset": 10354
      },
      "superclassifier": {
        "startOffset": 10350,
        "endOffset": 10354
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 406,
    "kind": "Definition",
    "name": "C",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10360,
    "endOffset": 10396,
    "fieldRanges": {
      "name": {
        "startOffset": 10383,
        "endOffset": 10384
      },
      "declaredName": {
        "startOffset": 10383,
        "endOffset": 10384
      }
    },
    "exports": [
      "abstract attribute def C :> Coulomb;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Coulomb"
    }
  },
  {
    "id": 407,
    "kind": "Reference",
    "name": "Coulomb",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 406,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10388,
    "endOffset": 10395,
    "fieldRanges": {
      "name": {
        "startOffset": 10388,
        "endOffset": 10395
      },
      "superclassifier": {
        "startOffset": 10388,
        "endOffset": 10395
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 408,
    "kind": "Definition",
    "name": "ohm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10401,
    "endOffset": 10435,
    "fieldRanges": {
      "name": {
        "startOffset": 10424,
        "endOffset": 10427
      },
      "declaredName": {
        "startOffset": 10424,
        "endOffset": 10427
      }
    },
    "exports": [
      "abstract attribute def ohm :> Ohm;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Ohm"
    }
  },
  {
    "id": 409,
    "kind": "Reference",
    "name": "Ohm",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 408,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10431,
    "endOffset": 10434,
    "fieldRanges": {
      "name": {
        "startOffset": 10431,
        "endOffset": 10434
      },
      "superclassifier": {
        "startOffset": 10431,
        "endOffset": 10434
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 410,
    "kind": "Definition",
    "name": "kOhm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10440,
    "endOffset": 10476,
    "fieldRanges": {
      "name": {
        "startOffset": 10463,
        "endOffset": 10467
      },
      "declaredName": {
        "startOffset": 10463,
        "endOffset": 10467
      }
    },
    "exports": [
      "abstract attribute def kOhm :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 411,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 410,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10471,
    "endOffset": 10475,
    "fieldRanges": {
      "name": {
        "startOffset": 10471,
        "endOffset": 10475
      },
      "superclassifier": {
        "startOffset": 10471,
        "endOffset": 10475
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 412,
    "kind": "Definition",
    "name": "MOhm",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10481,
    "endOffset": 10517,
    "fieldRanges": {
      "name": {
        "startOffset": 10504,
        "endOffset": 10508
      },
      "declaredName": {
        "startOffset": 10504,
        "endOffset": 10508
      }
    },
    "exports": [
      "abstract attribute def MOhm :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 413,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 412,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10512,
    "endOffset": 10516,
    "fieldRanges": {
      "name": {
        "startOffset": 10512,
        "endOffset": 10516
      },
      "superclassifier": {
        "startOffset": 10512,
        "endOffset": 10516
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 414,
    "kind": "Definition",
    "name": "F",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10522,
    "endOffset": 10556,
    "fieldRanges": {
      "name": {
        "startOffset": 10545,
        "endOffset": 10546
      },
      "declaredName": {
        "startOffset": 10545,
        "endOffset": 10546
      }
    },
    "exports": [
      "abstract attribute def F :> Farad;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Farad"
    }
  },
  {
    "id": 415,
    "kind": "Reference",
    "name": "Farad",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 414,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10550,
    "endOffset": 10555,
    "fieldRanges": {
      "name": {
        "startOffset": 10550,
        "endOffset": 10555
      },
      "superclassifier": {
        "startOffset": 10550,
        "endOffset": 10555
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 416,
    "kind": "Definition",
    "name": "uF",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10561,
    "endOffset": 10595,
    "fieldRanges": {
      "name": {
        "startOffset": 10584,
        "endOffset": 10586
      },
      "declaredName": {
        "startOffset": 10584,
        "endOffset": 10586
      }
    },
    "exports": [
      "abstract attribute def uF :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 417,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 416,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10590,
    "endOffset": 10594,
    "fieldRanges": {
      "name": {
        "startOffset": 10590,
        "endOffset": 10594
      },
      "superclassifier": {
        "startOffset": 10590,
        "endOffset": 10594
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 418,
    "kind": "Definition",
    "name": "nF",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10600,
    "endOffset": 10634,
    "fieldRanges": {
      "name": {
        "startOffset": 10623,
        "endOffset": 10625
      },
      "declaredName": {
        "startOffset": 10623,
        "endOffset": 10625
      }
    },
    "exports": [
      "abstract attribute def nF :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 419,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 418,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10629,
    "endOffset": 10633,
    "fieldRanges": {
      "name": {
        "startOffset": 10629,
        "endOffset": 10633
      },
      "superclassifier": {
        "startOffset": 10629,
        "endOffset": 10633
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 420,
    "kind": "Definition",
    "name": "pF",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10639,
    "endOffset": 10673,
    "fieldRanges": {
      "name": {
        "startOffset": 10662,
        "endOffset": 10664
      },
      "declaredName": {
        "startOffset": 10662,
        "endOffset": 10664
      }
    },
    "exports": [
      "abstract attribute def pF :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 421,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 420,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10668,
    "endOffset": 10672,
    "fieldRanges": {
      "name": {
        "startOffset": 10668,
        "endOffset": 10672
      },
      "superclassifier": {
        "startOffset": 10668,
        "endOffset": 10672
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 422,
    "kind": "Definition",
    "name": "H",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10678,
    "endOffset": 10712,
    "fieldRanges": {
      "name": {
        "startOffset": 10701,
        "endOffset": 10702
      },
      "declaredName": {
        "startOffset": 10701,
        "endOffset": 10702
      }
    },
    "exports": [
      "abstract attribute def H :> Henry;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Henry"
    }
  },
  {
    "id": 423,
    "kind": "Reference",
    "name": "Henry",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 422,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10706,
    "endOffset": 10711,
    "fieldRanges": {
      "name": {
        "startOffset": 10706,
        "endOffset": 10711
      },
      "superclassifier": {
        "startOffset": 10706,
        "endOffset": 10711
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 424,
    "kind": "Definition",
    "name": "mH",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10717,
    "endOffset": 10751,
    "fieldRanges": {
      "name": {
        "startOffset": 10740,
        "endOffset": 10742
      },
      "declaredName": {
        "startOffset": 10740,
        "endOffset": 10742
      }
    },
    "exports": [
      "abstract attribute def mH :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 425,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 424,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10746,
    "endOffset": 10750,
    "fieldRanges": {
      "name": {
        "startOffset": 10746,
        "endOffset": 10750
      },
      "superclassifier": {
        "startOffset": 10746,
        "endOffset": 10750
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 426,
    "kind": "Definition",
    "name": "uH",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10756,
    "endOffset": 10790,
    "fieldRanges": {
      "name": {
        "startOffset": 10779,
        "endOffset": 10781
      },
      "declaredName": {
        "startOffset": 10779,
        "endOffset": 10781
      }
    },
    "exports": [
      "abstract attribute def uH :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 427,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 426,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10785,
    "endOffset": 10789,
    "fieldRanges": {
      "name": {
        "startOffset": 10785,
        "endOffset": 10789
      },
      "superclassifier": {
        "startOffset": 10785,
        "endOffset": 10789
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 428,
    "kind": "Definition",
    "name": "Hz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10795,
    "endOffset": 10830,
    "fieldRanges": {
      "name": {
        "startOffset": 10818,
        "endOffset": 10820
      },
      "declaredName": {
        "startOffset": 10818,
        "endOffset": 10820
      }
    },
    "exports": [
      "abstract attribute def Hz :> Hertz;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Hertz"
    }
  },
  {
    "id": 429,
    "kind": "Reference",
    "name": "Hertz",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 428,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10824,
    "endOffset": 10829,
    "fieldRanges": {
      "name": {
        "startOffset": 10824,
        "endOffset": 10829
      },
      "superclassifier": {
        "startOffset": 10824,
        "endOffset": 10829
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 430,
    "kind": "Definition",
    "name": "kHz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10835,
    "endOffset": 10870,
    "fieldRanges": {
      "name": {
        "startOffset": 10858,
        "endOffset": 10861
      },
      "declaredName": {
        "startOffset": 10858,
        "endOffset": 10861
      }
    },
    "exports": [
      "abstract attribute def kHz :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 431,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 430,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10865,
    "endOffset": 10869,
    "fieldRanges": {
      "name": {
        "startOffset": 10865,
        "endOffset": 10869
      },
      "superclassifier": {
        "startOffset": 10865,
        "endOffset": 10869
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 432,
    "kind": "Definition",
    "name": "MHz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10875,
    "endOffset": 10910,
    "fieldRanges": {
      "name": {
        "startOffset": 10898,
        "endOffset": 10901
      },
      "declaredName": {
        "startOffset": 10898,
        "endOffset": 10901
      }
    },
    "exports": [
      "abstract attribute def MHz :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 433,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 432,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10905,
    "endOffset": 10909,
    "fieldRanges": {
      "name": {
        "startOffset": 10905,
        "endOffset": 10909
      },
      "superclassifier": {
        "startOffset": 10905,
        "endOffset": 10909
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 434,
    "kind": "Definition",
    "name": "GHz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10915,
    "endOffset": 10950,
    "fieldRanges": {
      "name": {
        "startOffset": 10938,
        "endOffset": 10941
      },
      "declaredName": {
        "startOffset": 10938,
        "endOffset": 10941
      }
    },
    "exports": [
      "abstract attribute def GHz :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 435,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 434,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10945,
    "endOffset": 10949,
    "fieldRanges": {
      "name": {
        "startOffset": 10945,
        "endOffset": 10949
      },
      "superclassifier": {
        "startOffset": 10945,
        "endOffset": 10949
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 436,
    "kind": "Definition",
    "name": "rad",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10955,
    "endOffset": 10992,
    "fieldRanges": {
      "name": {
        "startOffset": 10978,
        "endOffset": 10981
      },
      "declaredName": {
        "startOffset": 10978,
        "endOffset": 10981
      }
    },
    "exports": [
      "abstract attribute def rad :> Radian;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Radian"
    }
  },
  {
    "id": 437,
    "kind": "Reference",
    "name": "Radian",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 436,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10985,
    "endOffset": 10991,
    "fieldRanges": {
      "name": {
        "startOffset": 10985,
        "endOffset": 10991
      },
      "superclassifier": {
        "startOffset": 10985,
        "endOffset": 10991
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 438,
    "kind": "Definition",
    "name": "sr",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 10997,
    "endOffset": 11036,
    "fieldRanges": {
      "name": {
        "startOffset": 11020,
        "endOffset": 11022
      },
      "declaredName": {
        "startOffset": 11020,
        "endOffset": 11022
      }
    },
    "exports": [
      "abstract attribute def sr :> Steradian;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Steradian"
    }
  },
  {
    "id": 439,
    "kind": "Reference",
    "name": "Steradian",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 438,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11026,
    "endOffset": 11035,
    "fieldRanges": {
      "name": {
        "startOffset": 11026,
        "endOffset": 11035
      },
      "superclassifier": {
        "startOffset": 11026,
        "endOffset": 11035
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 440,
    "kind": "Definition",
    "name": "kat",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11041,
    "endOffset": 11077,
    "fieldRanges": {
      "name": {
        "startOffset": 11064,
        "endOffset": 11067
      },
      "declaredName": {
        "startOffset": 11064,
        "endOffset": 11067
      }
    },
    "exports": [
      "abstract attribute def kat :> Katal;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Katal"
    }
  },
  {
    "id": 441,
    "kind": "Reference",
    "name": "Katal",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 440,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11071,
    "endOffset": 11076,
    "fieldRanges": {
      "name": {
        "startOffset": 11071,
        "endOffset": 11076
      },
      "superclassifier": {
        "startOffset": 11071,
        "endOffset": 11076
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 442,
    "kind": "Definition",
    "name": "deg",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11082,
    "endOffset": 11117,
    "fieldRanges": {
      "name": {
        "startOffset": 11105,
        "endOffset": 11108
      },
      "declaredName": {
        "startOffset": 11105,
        "endOffset": 11108
      }
    },
    "exports": [
      "abstract attribute def deg :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 443,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 442,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11112,
    "endOffset": 11116,
    "fieldRanges": {
      "name": {
        "startOffset": 11112,
        "endOffset": 11116
      },
      "superclassifier": {
        "startOffset": 11112,
        "endOffset": 11116
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 444,
    "kind": "Definition",
    "name": "degC",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11122,
    "endOffset": 11167,
    "fieldRanges": {
      "name": {
        "startOffset": 11145,
        "endOffset": 11149
      },
      "declaredName": {
        "startOffset": 11145,
        "endOffset": 11149
      }
    },
    "exports": [
      "abstract attribute def degC :> DegreeCelsius;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "DegreeCelsius"
    }
  },
  {
    "id": 445,
    "kind": "Reference",
    "name": "DegreeCelsius",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 444,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11153,
    "endOffset": 11166,
    "fieldRanges": {
      "name": {
        "startOffset": 11153,
        "endOffset": 11166
      },
      "superclassifier": {
        "startOffset": 11153,
        "endOffset": 11166
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 446,
    "kind": "Definition",
    "name": "Millimetre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11206,
    "endOffset": 11249,
    "fieldRanges": {
      "name": {
        "startOffset": 11229,
        "endOffset": 11239
      },
      "declaredName": {
        "startOffset": 11229,
        "endOffset": 11239
      }
    },
    "exports": [
      "abstract attribute def Millimetre :> Metre;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Metre"
    }
  },
  {
    "id": 447,
    "kind": "Reference",
    "name": "Metre",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 446,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11243,
    "endOffset": 11248,
    "fieldRanges": {
      "name": {
        "startOffset": 11243,
        "endOffset": 11248
      },
      "superclassifier": {
        "startOffset": 11243,
        "endOffset": 11248
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 448,
    "kind": "Definition",
    "name": "Centimetre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11254,
    "endOffset": 11297,
    "fieldRanges": {
      "name": {
        "startOffset": 11277,
        "endOffset": 11287
      },
      "declaredName": {
        "startOffset": 11277,
        "endOffset": 11287
      }
    },
    "exports": [
      "abstract attribute def Centimetre :> Metre;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Metre"
    }
  },
  {
    "id": 449,
    "kind": "Reference",
    "name": "Metre",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 448,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11291,
    "endOffset": 11296,
    "fieldRanges": {
      "name": {
        "startOffset": 11291,
        "endOffset": 11296
      },
      "superclassifier": {
        "startOffset": 11291,
        "endOffset": 11296
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 450,
    "kind": "Definition",
    "name": "Kilometre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11302,
    "endOffset": 11344,
    "fieldRanges": {
      "name": {
        "startOffset": 11325,
        "endOffset": 11334
      },
      "declaredName": {
        "startOffset": 11325,
        "endOffset": 11334
      }
    },
    "exports": [
      "abstract attribute def Kilometre :> Metre;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Metre"
    }
  },
  {
    "id": 451,
    "kind": "Reference",
    "name": "Metre",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 450,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11338,
    "endOffset": 11343,
    "fieldRanges": {
      "name": {
        "startOffset": 11338,
        "endOffset": 11343
      },
      "superclassifier": {
        "startOffset": 11338,
        "endOffset": 11343
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 452,
    "kind": "Definition",
    "name": "Gram",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11349,
    "endOffset": 11385,
    "fieldRanges": {
      "name": {
        "startOffset": 11372,
        "endOffset": 11376
      },
      "declaredName": {
        "startOffset": 11372,
        "endOffset": 11376
      }
    },
    "exports": [
      "abstract attribute def Gram :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 453,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 452,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11380,
    "endOffset": 11384,
    "fieldRanges": {
      "name": {
        "startOffset": 11380,
        "endOffset": 11384
      },
      "superclassifier": {
        "startOffset": 11380,
        "endOffset": 11384
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 454,
    "kind": "Definition",
    "name": "Milligram",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11390,
    "endOffset": 11431,
    "fieldRanges": {
      "name": {
        "startOffset": 11413,
        "endOffset": 11422
      },
      "declaredName": {
        "startOffset": 11413,
        "endOffset": 11422
      }
    },
    "exports": [
      "abstract attribute def Milligram :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 455,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 454,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11426,
    "endOffset": 11430,
    "fieldRanges": {
      "name": {
        "startOffset": 11426,
        "endOffset": 11430
      },
      "superclassifier": {
        "startOffset": 11426,
        "endOffset": 11430
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 456,
    "kind": "Definition",
    "name": "Millisecond",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11436,
    "endOffset": 11481,
    "fieldRanges": {
      "name": {
        "startOffset": 11459,
        "endOffset": 11470
      },
      "declaredName": {
        "startOffset": 11459,
        "endOffset": 11470
      }
    },
    "exports": [
      "abstract attribute def Millisecond :> Second;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Second"
    }
  },
  {
    "id": 457,
    "kind": "Reference",
    "name": "Second",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 456,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11474,
    "endOffset": 11480,
    "fieldRanges": {
      "name": {
        "startOffset": 11474,
        "endOffset": 11480
      },
      "superclassifier": {
        "startOffset": 11474,
        "endOffset": 11480
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 458,
    "kind": "Definition",
    "name": "Minute",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11486,
    "endOffset": 11524,
    "fieldRanges": {
      "name": {
        "startOffset": 11509,
        "endOffset": 11515
      },
      "declaredName": {
        "startOffset": 11509,
        "endOffset": 11515
      }
    },
    "exports": [
      "abstract attribute def Minute :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 459,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 458,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11519,
    "endOffset": 11523,
    "fieldRanges": {
      "name": {
        "startOffset": 11519,
        "endOffset": 11523
      },
      "superclassifier": {
        "startOffset": 11519,
        "endOffset": 11523
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 460,
    "kind": "Definition",
    "name": "Hour",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11529,
    "endOffset": 11565,
    "fieldRanges": {
      "name": {
        "startOffset": 11552,
        "endOffset": 11556
      },
      "declaredName": {
        "startOffset": 11552,
        "endOffset": 11556
      }
    },
    "exports": [
      "abstract attribute def Hour :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 461,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 460,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11560,
    "endOffset": 11564,
    "fieldRanges": {
      "name": {
        "startOffset": 11560,
        "endOffset": 11564
      },
      "superclassifier": {
        "startOffset": 11560,
        "endOffset": 11564
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 462,
    "kind": "Definition",
    "name": "Day",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11570,
    "endOffset": 11605,
    "fieldRanges": {
      "name": {
        "startOffset": 11593,
        "endOffset": 11596
      },
      "declaredName": {
        "startOffset": 11593,
        "endOffset": 11596
      }
    },
    "exports": [
      "abstract attribute def Day :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 463,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 462,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11600,
    "endOffset": 11604,
    "fieldRanges": {
      "name": {
        "startOffset": 11600,
        "endOffset": 11604
      },
      "superclassifier": {
        "startOffset": 11600,
        "endOffset": 11604
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 464,
    "kind": "Definition",
    "name": "Kilowatt",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11610,
    "endOffset": 11650,
    "fieldRanges": {
      "name": {
        "startOffset": 11633,
        "endOffset": 11641
      },
      "declaredName": {
        "startOffset": 11633,
        "endOffset": 11641
      }
    },
    "exports": [
      "abstract attribute def Kilowatt :> Watt;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Watt"
    }
  },
  {
    "id": 465,
    "kind": "Reference",
    "name": "Watt",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 464,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11645,
    "endOffset": 11649,
    "fieldRanges": {
      "name": {
        "startOffset": 11645,
        "endOffset": 11649
      },
      "superclassifier": {
        "startOffset": 11645,
        "endOffset": 11649
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 466,
    "kind": "Definition",
    "name": "Megawatt",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11655,
    "endOffset": 11695,
    "fieldRanges": {
      "name": {
        "startOffset": 11678,
        "endOffset": 11686
      },
      "declaredName": {
        "startOffset": 11678,
        "endOffset": 11686
      }
    },
    "exports": [
      "abstract attribute def Megawatt :> Watt;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Watt"
    }
  },
  {
    "id": 467,
    "kind": "Reference",
    "name": "Watt",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 466,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11690,
    "endOffset": 11694,
    "fieldRanges": {
      "name": {
        "startOffset": 11690,
        "endOffset": 11694
      },
      "superclassifier": {
        "startOffset": 11690,
        "endOffset": 11694
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 468,
    "kind": "Definition",
    "name": "Kilojoule",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11700,
    "endOffset": 11742,
    "fieldRanges": {
      "name": {
        "startOffset": 11723,
        "endOffset": 11732
      },
      "declaredName": {
        "startOffset": 11723,
        "endOffset": 11732
      }
    },
    "exports": [
      "abstract attribute def Kilojoule :> Joule;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Joule"
    }
  },
  {
    "id": 469,
    "kind": "Reference",
    "name": "Joule",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 468,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11736,
    "endOffset": 11741,
    "fieldRanges": {
      "name": {
        "startOffset": 11736,
        "endOffset": 11741
      },
      "superclassifier": {
        "startOffset": 11736,
        "endOffset": 11741
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 470,
    "kind": "Definition",
    "name": "Megajoule",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11747,
    "endOffset": 11789,
    "fieldRanges": {
      "name": {
        "startOffset": 11770,
        "endOffset": 11779
      },
      "declaredName": {
        "startOffset": 11770,
        "endOffset": 11779
      }
    },
    "exports": [
      "abstract attribute def Megajoule :> Joule;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Joule"
    }
  },
  {
    "id": 471,
    "kind": "Reference",
    "name": "Joule",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 470,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11783,
    "endOffset": 11788,
    "fieldRanges": {
      "name": {
        "startOffset": 11783,
        "endOffset": 11788
      },
      "superclassifier": {
        "startOffset": 11783,
        "endOffset": 11788
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 472,
    "kind": "Definition",
    "name": "Kilopascal",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11794,
    "endOffset": 11838,
    "fieldRanges": {
      "name": {
        "startOffset": 11817,
        "endOffset": 11827
      },
      "declaredName": {
        "startOffset": 11817,
        "endOffset": 11827
      }
    },
    "exports": [
      "abstract attribute def Kilopascal :> Pascal;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pascal"
    }
  },
  {
    "id": 473,
    "kind": "Reference",
    "name": "Pascal",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 472,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11831,
    "endOffset": 11837,
    "fieldRanges": {
      "name": {
        "startOffset": 11831,
        "endOffset": 11837
      },
      "superclassifier": {
        "startOffset": 11831,
        "endOffset": 11837
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 474,
    "kind": "Definition",
    "name": "Megapascal",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11843,
    "endOffset": 11887,
    "fieldRanges": {
      "name": {
        "startOffset": 11866,
        "endOffset": 11876
      },
      "declaredName": {
        "startOffset": 11866,
        "endOffset": 11876
      }
    },
    "exports": [
      "abstract attribute def Megapascal :> Pascal;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pascal"
    }
  },
  {
    "id": 475,
    "kind": "Reference",
    "name": "Pascal",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 474,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11880,
    "endOffset": 11886,
    "fieldRanges": {
      "name": {
        "startOffset": 11880,
        "endOffset": 11886
      },
      "superclassifier": {
        "startOffset": 11880,
        "endOffset": 11886
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 476,
    "kind": "Definition",
    "name": "Bar",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11892,
    "endOffset": 11927,
    "fieldRanges": {
      "name": {
        "startOffset": 11915,
        "endOffset": 11918
      },
      "declaredName": {
        "startOffset": 11915,
        "endOffset": 11918
      }
    },
    "exports": [
      "abstract attribute def Bar :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 477,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 476,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11922,
    "endOffset": 11926,
    "fieldRanges": {
      "name": {
        "startOffset": 11922,
        "endOffset": 11926
      },
      "superclassifier": {
        "startOffset": 11922,
        "endOffset": 11926
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 478,
    "kind": "Definition",
    "name": "Litre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11932,
    "endOffset": 11969,
    "fieldRanges": {
      "name": {
        "startOffset": 11955,
        "endOffset": 11960
      },
      "declaredName": {
        "startOffset": 11955,
        "endOffset": 11960
      }
    },
    "exports": [
      "abstract attribute def Litre :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 479,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 478,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11964,
    "endOffset": 11968,
    "fieldRanges": {
      "name": {
        "startOffset": 11964,
        "endOffset": 11968
      },
      "superclassifier": {
        "startOffset": 11964,
        "endOffset": 11968
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 480,
    "kind": "Definition",
    "name": "Millilitre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 11974,
    "endOffset": 12016,
    "fieldRanges": {
      "name": {
        "startOffset": 11997,
        "endOffset": 12007
      },
      "declaredName": {
        "startOffset": 11997,
        "endOffset": 12007
      }
    },
    "exports": [
      "abstract attribute def Millilitre :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 481,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 480,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12011,
    "endOffset": 12015,
    "fieldRanges": {
      "name": {
        "startOffset": 12011,
        "endOffset": 12015
      },
      "superclassifier": {
        "startOffset": 12011,
        "endOffset": 12015
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 482,
    "kind": "Definition",
    "name": "Yotta",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12041,
    "endOffset": 12078,
    "fieldRanges": {
      "name": {
        "startOffset": 12064,
        "endOffset": 12069
      },
      "declaredName": {
        "startOffset": 12064,
        "endOffset": 12069
      }
    },
    "exports": [
      "abstract attribute def Yotta :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 483,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 482,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12073,
    "endOffset": 12077,
    "fieldRanges": {
      "name": {
        "startOffset": 12073,
        "endOffset": 12077
      },
      "superclassifier": {
        "startOffset": 12073,
        "endOffset": 12077
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 484,
    "kind": "Definition",
    "name": "Zetta",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12083,
    "endOffset": 12120,
    "fieldRanges": {
      "name": {
        "startOffset": 12106,
        "endOffset": 12111
      },
      "declaredName": {
        "startOffset": 12106,
        "endOffset": 12111
      }
    },
    "exports": [
      "abstract attribute def Zetta :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 485,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 484,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12115,
    "endOffset": 12119,
    "fieldRanges": {
      "name": {
        "startOffset": 12115,
        "endOffset": 12119
      },
      "superclassifier": {
        "startOffset": 12115,
        "endOffset": 12119
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 486,
    "kind": "Definition",
    "name": "Exa",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12125,
    "endOffset": 12160,
    "fieldRanges": {
      "name": {
        "startOffset": 12148,
        "endOffset": 12151
      },
      "declaredName": {
        "startOffset": 12148,
        "endOffset": 12151
      }
    },
    "exports": [
      "abstract attribute def Exa :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 487,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 486,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12155,
    "endOffset": 12159,
    "fieldRanges": {
      "name": {
        "startOffset": 12155,
        "endOffset": 12159
      },
      "superclassifier": {
        "startOffset": 12155,
        "endOffset": 12159
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 488,
    "kind": "Definition",
    "name": "Peta",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12165,
    "endOffset": 12201,
    "fieldRanges": {
      "name": {
        "startOffset": 12188,
        "endOffset": 12192
      },
      "declaredName": {
        "startOffset": 12188,
        "endOffset": 12192
      }
    },
    "exports": [
      "abstract attribute def Peta :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 489,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 488,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12196,
    "endOffset": 12200,
    "fieldRanges": {
      "name": {
        "startOffset": 12196,
        "endOffset": 12200
      },
      "superclassifier": {
        "startOffset": 12196,
        "endOffset": 12200
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 490,
    "kind": "Definition",
    "name": "Tera",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12206,
    "endOffset": 12242,
    "fieldRanges": {
      "name": {
        "startOffset": 12229,
        "endOffset": 12233
      },
      "declaredName": {
        "startOffset": 12229,
        "endOffset": 12233
      }
    },
    "exports": [
      "abstract attribute def Tera :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 491,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 490,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12237,
    "endOffset": 12241,
    "fieldRanges": {
      "name": {
        "startOffset": 12237,
        "endOffset": 12241
      },
      "superclassifier": {
        "startOffset": 12237,
        "endOffset": 12241
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 492,
    "kind": "Definition",
    "name": "Giga",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12247,
    "endOffset": 12283,
    "fieldRanges": {
      "name": {
        "startOffset": 12270,
        "endOffset": 12274
      },
      "declaredName": {
        "startOffset": 12270,
        "endOffset": 12274
      }
    },
    "exports": [
      "abstract attribute def Giga :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 493,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 492,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12278,
    "endOffset": 12282,
    "fieldRanges": {
      "name": {
        "startOffset": 12278,
        "endOffset": 12282
      },
      "superclassifier": {
        "startOffset": 12278,
        "endOffset": 12282
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 494,
    "kind": "Definition",
    "name": "Mega",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12288,
    "endOffset": 12324,
    "fieldRanges": {
      "name": {
        "startOffset": 12311,
        "endOffset": 12315
      },
      "declaredName": {
        "startOffset": 12311,
        "endOffset": 12315
      }
    },
    "exports": [
      "abstract attribute def Mega :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 495,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 494,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12319,
    "endOffset": 12323,
    "fieldRanges": {
      "name": {
        "startOffset": 12319,
        "endOffset": 12323
      },
      "superclassifier": {
        "startOffset": 12319,
        "endOffset": 12323
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 496,
    "kind": "Definition",
    "name": "Kilo",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12329,
    "endOffset": 12365,
    "fieldRanges": {
      "name": {
        "startOffset": 12352,
        "endOffset": 12356
      },
      "declaredName": {
        "startOffset": 12352,
        "endOffset": 12356
      }
    },
    "exports": [
      "abstract attribute def Kilo :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 497,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 496,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12360,
    "endOffset": 12364,
    "fieldRanges": {
      "name": {
        "startOffset": 12360,
        "endOffset": 12364
      },
      "superclassifier": {
        "startOffset": 12360,
        "endOffset": 12364
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 498,
    "kind": "Definition",
    "name": "Hecto",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12370,
    "endOffset": 12407,
    "fieldRanges": {
      "name": {
        "startOffset": 12393,
        "endOffset": 12398
      },
      "declaredName": {
        "startOffset": 12393,
        "endOffset": 12398
      }
    },
    "exports": [
      "abstract attribute def Hecto :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 499,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 498,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12402,
    "endOffset": 12406,
    "fieldRanges": {
      "name": {
        "startOffset": 12402,
        "endOffset": 12406
      },
      "superclassifier": {
        "startOffset": 12402,
        "endOffset": 12406
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 500,
    "kind": "Definition",
    "name": "Deca",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12412,
    "endOffset": 12448,
    "fieldRanges": {
      "name": {
        "startOffset": 12435,
        "endOffset": 12439
      },
      "declaredName": {
        "startOffset": 12435,
        "endOffset": 12439
      }
    },
    "exports": [
      "abstract attribute def Deca :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 501,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 500,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12443,
    "endOffset": 12447,
    "fieldRanges": {
      "name": {
        "startOffset": 12443,
        "endOffset": 12447
      },
      "superclassifier": {
        "startOffset": 12443,
        "endOffset": 12447
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 502,
    "kind": "Definition",
    "name": "Deci",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12453,
    "endOffset": 12489,
    "fieldRanges": {
      "name": {
        "startOffset": 12476,
        "endOffset": 12480
      },
      "declaredName": {
        "startOffset": 12476,
        "endOffset": 12480
      }
    },
    "exports": [
      "abstract attribute def Deci :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 503,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 502,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12484,
    "endOffset": 12488,
    "fieldRanges": {
      "name": {
        "startOffset": 12484,
        "endOffset": 12488
      },
      "superclassifier": {
        "startOffset": 12484,
        "endOffset": 12488
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 504,
    "kind": "Definition",
    "name": "Centi",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12494,
    "endOffset": 12531,
    "fieldRanges": {
      "name": {
        "startOffset": 12517,
        "endOffset": 12522
      },
      "declaredName": {
        "startOffset": 12517,
        "endOffset": 12522
      }
    },
    "exports": [
      "abstract attribute def Centi :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 505,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 504,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12526,
    "endOffset": 12530,
    "fieldRanges": {
      "name": {
        "startOffset": 12526,
        "endOffset": 12530
      },
      "superclassifier": {
        "startOffset": 12526,
        "endOffset": 12530
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 506,
    "kind": "Definition",
    "name": "Milli",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12536,
    "endOffset": 12573,
    "fieldRanges": {
      "name": {
        "startOffset": 12559,
        "endOffset": 12564
      },
      "declaredName": {
        "startOffset": 12559,
        "endOffset": 12564
      }
    },
    "exports": [
      "abstract attribute def Milli :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 507,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 506,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12568,
    "endOffset": 12572,
    "fieldRanges": {
      "name": {
        "startOffset": 12568,
        "endOffset": 12572
      },
      "superclassifier": {
        "startOffset": 12568,
        "endOffset": 12572
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 508,
    "kind": "Definition",
    "name": "Micro",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12578,
    "endOffset": 12615,
    "fieldRanges": {
      "name": {
        "startOffset": 12601,
        "endOffset": 12606
      },
      "declaredName": {
        "startOffset": 12601,
        "endOffset": 12606
      }
    },
    "exports": [
      "abstract attribute def Micro :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 509,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 508,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12610,
    "endOffset": 12614,
    "fieldRanges": {
      "name": {
        "startOffset": 12610,
        "endOffset": 12614
      },
      "superclassifier": {
        "startOffset": 12610,
        "endOffset": 12614
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 510,
    "kind": "Definition",
    "name": "Nano",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12620,
    "endOffset": 12656,
    "fieldRanges": {
      "name": {
        "startOffset": 12643,
        "endOffset": 12647
      },
      "declaredName": {
        "startOffset": 12643,
        "endOffset": 12647
      }
    },
    "exports": [
      "abstract attribute def Nano :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 511,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 510,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12651,
    "endOffset": 12655,
    "fieldRanges": {
      "name": {
        "startOffset": 12651,
        "endOffset": 12655
      },
      "superclassifier": {
        "startOffset": 12651,
        "endOffset": 12655
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 512,
    "kind": "Definition",
    "name": "Pico",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12661,
    "endOffset": 12697,
    "fieldRanges": {
      "name": {
        "startOffset": 12684,
        "endOffset": 12688
      },
      "declaredName": {
        "startOffset": 12684,
        "endOffset": 12688
      }
    },
    "exports": [
      "abstract attribute def Pico :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 513,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 512,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12692,
    "endOffset": 12696,
    "fieldRanges": {
      "name": {
        "startOffset": 12692,
        "endOffset": 12696
      },
      "superclassifier": {
        "startOffset": 12692,
        "endOffset": 12696
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 514,
    "kind": "Definition",
    "name": "Femto",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12702,
    "endOffset": 12739,
    "fieldRanges": {
      "name": {
        "startOffset": 12725,
        "endOffset": 12730
      },
      "declaredName": {
        "startOffset": 12725,
        "endOffset": 12730
      }
    },
    "exports": [
      "abstract attribute def Femto :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 515,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 514,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12734,
    "endOffset": 12738,
    "fieldRanges": {
      "name": {
        "startOffset": 12734,
        "endOffset": 12738
      },
      "superclassifier": {
        "startOffset": 12734,
        "endOffset": 12738
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 516,
    "kind": "Definition",
    "name": "Atto",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12744,
    "endOffset": 12780,
    "fieldRanges": {
      "name": {
        "startOffset": 12767,
        "endOffset": 12771
      },
      "declaredName": {
        "startOffset": 12767,
        "endOffset": 12771
      }
    },
    "exports": [
      "abstract attribute def Atto :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 517,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 516,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12775,
    "endOffset": 12779,
    "fieldRanges": {
      "name": {
        "startOffset": 12775,
        "endOffset": 12779
      },
      "superclassifier": {
        "startOffset": 12775,
        "endOffset": 12779
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 518,
    "kind": "Definition",
    "name": "kilo",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12786,
    "endOffset": 12822,
    "fieldRanges": {
      "name": {
        "startOffset": 12809,
        "endOffset": 12813
      },
      "declaredName": {
        "startOffset": 12809,
        "endOffset": 12813
      }
    },
    "exports": [
      "abstract attribute def kilo :> Kilo;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Kilo"
    }
  },
  {
    "id": 519,
    "kind": "Reference",
    "name": "Kilo",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 518,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12817,
    "endOffset": 12821,
    "fieldRanges": {
      "name": {
        "startOffset": 12817,
        "endOffset": 12821
      },
      "superclassifier": {
        "startOffset": 12817,
        "endOffset": 12821
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 520,
    "kind": "Definition",
    "name": "mega",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12827,
    "endOffset": 12863,
    "fieldRanges": {
      "name": {
        "startOffset": 12850,
        "endOffset": 12854
      },
      "declaredName": {
        "startOffset": 12850,
        "endOffset": 12854
      }
    },
    "exports": [
      "abstract attribute def mega :> Mega;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Mega"
    }
  },
  {
    "id": 521,
    "kind": "Reference",
    "name": "Mega",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 520,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12858,
    "endOffset": 12862,
    "fieldRanges": {
      "name": {
        "startOffset": 12858,
        "endOffset": 12862
      },
      "superclassifier": {
        "startOffset": 12858,
        "endOffset": 12862
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 522,
    "kind": "Definition",
    "name": "giga",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12868,
    "endOffset": 12904,
    "fieldRanges": {
      "name": {
        "startOffset": 12891,
        "endOffset": 12895
      },
      "declaredName": {
        "startOffset": 12891,
        "endOffset": 12895
      }
    },
    "exports": [
      "abstract attribute def giga :> Giga;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Giga"
    }
  },
  {
    "id": 523,
    "kind": "Reference",
    "name": "Giga",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 522,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12899,
    "endOffset": 12903,
    "fieldRanges": {
      "name": {
        "startOffset": 12899,
        "endOffset": 12903
      },
      "superclassifier": {
        "startOffset": 12899,
        "endOffset": 12903
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 524,
    "kind": "Definition",
    "name": "milli",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12909,
    "endOffset": 12947,
    "fieldRanges": {
      "name": {
        "startOffset": 12932,
        "endOffset": 12937
      },
      "declaredName": {
        "startOffset": 12932,
        "endOffset": 12937
      }
    },
    "exports": [
      "abstract attribute def milli :> Milli;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Milli"
    }
  },
  {
    "id": 525,
    "kind": "Reference",
    "name": "Milli",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 524,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12941,
    "endOffset": 12946,
    "fieldRanges": {
      "name": {
        "startOffset": 12941,
        "endOffset": 12946
      },
      "superclassifier": {
        "startOffset": 12941,
        "endOffset": 12946
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 526,
    "kind": "Definition",
    "name": "micro",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12952,
    "endOffset": 12990,
    "fieldRanges": {
      "name": {
        "startOffset": 12975,
        "endOffset": 12980
      },
      "declaredName": {
        "startOffset": 12975,
        "endOffset": 12980
      }
    },
    "exports": [
      "abstract attribute def micro :> Micro;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Micro"
    }
  },
  {
    "id": 527,
    "kind": "Reference",
    "name": "Micro",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 526,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12984,
    "endOffset": 12989,
    "fieldRanges": {
      "name": {
        "startOffset": 12984,
        "endOffset": 12989
      },
      "superclassifier": {
        "startOffset": 12984,
        "endOffset": 12989
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 528,
    "kind": "Definition",
    "name": "nano",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 12995,
    "endOffset": 13031,
    "fieldRanges": {
      "name": {
        "startOffset": 13018,
        "endOffset": 13022
      },
      "declaredName": {
        "startOffset": 13018,
        "endOffset": 13022
      }
    },
    "exports": [
      "abstract attribute def nano :> Nano;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Nano"
    }
  },
  {
    "id": 529,
    "kind": "Reference",
    "name": "Nano",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 528,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13026,
    "endOffset": 13030,
    "fieldRanges": {
      "name": {
        "startOffset": 13026,
        "endOffset": 13030
      },
      "superclassifier": {
        "startOffset": 13026,
        "endOffset": 13030
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 530,
    "kind": "Definition",
    "name": "pico",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 348,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13036,
    "endOffset": 13072,
    "fieldRanges": {
      "name": {
        "startOffset": 13059,
        "endOffset": 13063
      },
      "declaredName": {
        "startOffset": 13059,
        "endOffset": 13063
      }
    },
    "exports": [
      "abstract attribute def pico :> Pico;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pico"
    }
  },
  {
    "id": 531,
    "kind": "Reference",
    "name": "Pico",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 530,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13067,
    "endOffset": 13071,
    "fieldRanges": {
      "name": {
        "startOffset": 13067,
        "endOffset": 13071
      },
      "superclassifier": {
        "startOffset": 13067,
        "endOffset": 13071
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 532,
    "kind": "Package",
    "name": "USCustomaryUnits",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13076,
    "endOffset": 15019,
    "fieldRanges": {
      "name": {
        "startOffset": 13084,
        "endOffset": 13100
      },
      "declaredName": {
        "startOffset": 13084,
        "endOffset": 13100
      }
    },
    "exports": [
      "package USCustomaryUnits {\n    import ScalarValues::*;\n\n    /* Length & Area */\n    abstract attribute def Inch :> Real;\n    abstract attribute def Foot :> Real;\n    abstract attribute def Yard :> Real;\n    abstract attribute def Mile :> Real;\n    abstract attribute def NauticalMile :> Real;\n    abstract attribute def SquareFoot :> Real;\n    abstract attribute def Acre :> Real;\n\n    abstract attribute def inch :> Inch;\n    abstract attribute def ft :> Foot;\n    abstract attribute def yd :> Yard;\n    abstract attribute def mi :> Mile;\n\n    /* Mass and Force */\n    abstract attribute def Ounce :> Real;\n    abstract attribute def Pound :> Real;\n    abstract attribute def PoundMass :> Pound;\n    abstract attribute def PoundForce :> Real;\n    abstract attribute def Slug :> Real;\n    abstract attribute def Ton :> Real;\n\n    abstract attribute def oz :> Ounce;\n    abstract attribute def lb :> Pound;\n    abstract attribute def lbf :> PoundForce;\n\n    /* Volume */\n    abstract attribute def Gallon :> Real;\n    abstract attribute def Quart :> Real;\n    abstract attribute def Pint :> Real;\n    abstract attribute def Cup :> Real;\n    abstract attribute def FluidOunce :> Real;\n    abstract attribute def gal :> Gallon;\n\n    /* Pressure */\n    abstract attribute def PoundPerSquareInch :> Real;\n    abstract attribute def psi :> PoundPerSquareInch;\n    abstract attribute def ksi :> Real;\n\n    /* Energy, Power & Speed */\n    abstract attribute def BritishThermalUnit :> Real;\n    abstract attribute def Btu :> BritishThermalUnit;\n    abstract attribute def FootPound :> Real;\n    abstract attribute def Horsepower :> Real;\n    abstract attribute def hp :> Horsepower;\n    abstract attribute def MilePerHour :> Real;\n    abstract attribute def mph :> MilePerHour;\n\n    /* Temperature */\n    abstract attribute def DegreeFahrenheit :> Real;\n    abstract attribute def degF :> DegreeFahrenheit;\n    abstract attribute def Rankine :> Real;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 533,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13107,
    "endOffset": 13129,
    "fieldRanges": {
      "name": {
        "startOffset": 13114,
        "endOffset": 13126
      },
      "importedNamespace": {
        "startOffset": 13114,
        "endOffset": 13126
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
    "id": 534,
    "kind": "Definition",
    "name": "Inch",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13160,
    "endOffset": 13196,
    "fieldRanges": {
      "name": {
        "startOffset": 13183,
        "endOffset": 13187
      },
      "declaredName": {
        "startOffset": 13183,
        "endOffset": 13187
      }
    },
    "exports": [
      "abstract attribute def Inch :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 535,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 534,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13191,
    "endOffset": 13195,
    "fieldRanges": {
      "name": {
        "startOffset": 13191,
        "endOffset": 13195
      },
      "superclassifier": {
        "startOffset": 13191,
        "endOffset": 13195
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 536,
    "kind": "Definition",
    "name": "Foot",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13201,
    "endOffset": 13237,
    "fieldRanges": {
      "name": {
        "startOffset": 13224,
        "endOffset": 13228
      },
      "declaredName": {
        "startOffset": 13224,
        "endOffset": 13228
      }
    },
    "exports": [
      "abstract attribute def Foot :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 537,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 536,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13232,
    "endOffset": 13236,
    "fieldRanges": {
      "name": {
        "startOffset": 13232,
        "endOffset": 13236
      },
      "superclassifier": {
        "startOffset": 13232,
        "endOffset": 13236
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 538,
    "kind": "Definition",
    "name": "Yard",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13242,
    "endOffset": 13278,
    "fieldRanges": {
      "name": {
        "startOffset": 13265,
        "endOffset": 13269
      },
      "declaredName": {
        "startOffset": 13265,
        "endOffset": 13269
      }
    },
    "exports": [
      "abstract attribute def Yard :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 539,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 538,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13273,
    "endOffset": 13277,
    "fieldRanges": {
      "name": {
        "startOffset": 13273,
        "endOffset": 13277
      },
      "superclassifier": {
        "startOffset": 13273,
        "endOffset": 13277
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 540,
    "kind": "Definition",
    "name": "Mile",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13283,
    "endOffset": 13319,
    "fieldRanges": {
      "name": {
        "startOffset": 13306,
        "endOffset": 13310
      },
      "declaredName": {
        "startOffset": 13306,
        "endOffset": 13310
      }
    },
    "exports": [
      "abstract attribute def Mile :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 541,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 540,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13314,
    "endOffset": 13318,
    "fieldRanges": {
      "name": {
        "startOffset": 13314,
        "endOffset": 13318
      },
      "superclassifier": {
        "startOffset": 13314,
        "endOffset": 13318
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 542,
    "kind": "Definition",
    "name": "NauticalMile",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13324,
    "endOffset": 13368,
    "fieldRanges": {
      "name": {
        "startOffset": 13347,
        "endOffset": 13359
      },
      "declaredName": {
        "startOffset": 13347,
        "endOffset": 13359
      }
    },
    "exports": [
      "abstract attribute def NauticalMile :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 543,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 542,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13363,
    "endOffset": 13367,
    "fieldRanges": {
      "name": {
        "startOffset": 13363,
        "endOffset": 13367
      },
      "superclassifier": {
        "startOffset": 13363,
        "endOffset": 13367
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 544,
    "kind": "Definition",
    "name": "SquareFoot",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13373,
    "endOffset": 13415,
    "fieldRanges": {
      "name": {
        "startOffset": 13396,
        "endOffset": 13406
      },
      "declaredName": {
        "startOffset": 13396,
        "endOffset": 13406
      }
    },
    "exports": [
      "abstract attribute def SquareFoot :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 545,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 544,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13410,
    "endOffset": 13414,
    "fieldRanges": {
      "name": {
        "startOffset": 13410,
        "endOffset": 13414
      },
      "superclassifier": {
        "startOffset": 13410,
        "endOffset": 13414
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 546,
    "kind": "Definition",
    "name": "Acre",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13420,
    "endOffset": 13456,
    "fieldRanges": {
      "name": {
        "startOffset": 13443,
        "endOffset": 13447
      },
      "declaredName": {
        "startOffset": 13443,
        "endOffset": 13447
      }
    },
    "exports": [
      "abstract attribute def Acre :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 547,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 546,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13451,
    "endOffset": 13455,
    "fieldRanges": {
      "name": {
        "startOffset": 13451,
        "endOffset": 13455
      },
      "superclassifier": {
        "startOffset": 13451,
        "endOffset": 13455
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 548,
    "kind": "Definition",
    "name": "inch",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13462,
    "endOffset": 13498,
    "fieldRanges": {
      "name": {
        "startOffset": 13485,
        "endOffset": 13489
      },
      "declaredName": {
        "startOffset": 13485,
        "endOffset": 13489
      }
    },
    "exports": [
      "abstract attribute def inch :> Inch;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Inch"
    }
  },
  {
    "id": 549,
    "kind": "Reference",
    "name": "Inch",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 548,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13493,
    "endOffset": 13497,
    "fieldRanges": {
      "name": {
        "startOffset": 13493,
        "endOffset": 13497
      },
      "superclassifier": {
        "startOffset": 13493,
        "endOffset": 13497
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 550,
    "kind": "Definition",
    "name": "ft",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13503,
    "endOffset": 13537,
    "fieldRanges": {
      "name": {
        "startOffset": 13526,
        "endOffset": 13528
      },
      "declaredName": {
        "startOffset": 13526,
        "endOffset": 13528
      }
    },
    "exports": [
      "abstract attribute def ft :> Foot;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Foot"
    }
  },
  {
    "id": 551,
    "kind": "Reference",
    "name": "Foot",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 550,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13532,
    "endOffset": 13536,
    "fieldRanges": {
      "name": {
        "startOffset": 13532,
        "endOffset": 13536
      },
      "superclassifier": {
        "startOffset": 13532,
        "endOffset": 13536
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 552,
    "kind": "Definition",
    "name": "yd",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13542,
    "endOffset": 13576,
    "fieldRanges": {
      "name": {
        "startOffset": 13565,
        "endOffset": 13567
      },
      "declaredName": {
        "startOffset": 13565,
        "endOffset": 13567
      }
    },
    "exports": [
      "abstract attribute def yd :> Yard;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Yard"
    }
  },
  {
    "id": 553,
    "kind": "Reference",
    "name": "Yard",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 552,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13571,
    "endOffset": 13575,
    "fieldRanges": {
      "name": {
        "startOffset": 13571,
        "endOffset": 13575
      },
      "superclassifier": {
        "startOffset": 13571,
        "endOffset": 13575
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 554,
    "kind": "Definition",
    "name": "mi",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13581,
    "endOffset": 13615,
    "fieldRanges": {
      "name": {
        "startOffset": 13604,
        "endOffset": 13606
      },
      "declaredName": {
        "startOffset": 13604,
        "endOffset": 13606
      }
    },
    "exports": [
      "abstract attribute def mi :> Mile;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Mile"
    }
  },
  {
    "id": 555,
    "kind": "Reference",
    "name": "Mile",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 554,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13610,
    "endOffset": 13614,
    "fieldRanges": {
      "name": {
        "startOffset": 13610,
        "endOffset": 13614
      },
      "superclassifier": {
        "startOffset": 13610,
        "endOffset": 13614
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 556,
    "kind": "Definition",
    "name": "Ounce",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13646,
    "endOffset": 13683,
    "fieldRanges": {
      "name": {
        "startOffset": 13669,
        "endOffset": 13674
      },
      "declaredName": {
        "startOffset": 13669,
        "endOffset": 13674
      }
    },
    "exports": [
      "abstract attribute def Ounce :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 557,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 556,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13678,
    "endOffset": 13682,
    "fieldRanges": {
      "name": {
        "startOffset": 13678,
        "endOffset": 13682
      },
      "superclassifier": {
        "startOffset": 13678,
        "endOffset": 13682
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 558,
    "kind": "Definition",
    "name": "Pound",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13688,
    "endOffset": 13725,
    "fieldRanges": {
      "name": {
        "startOffset": 13711,
        "endOffset": 13716
      },
      "declaredName": {
        "startOffset": 13711,
        "endOffset": 13716
      }
    },
    "exports": [
      "abstract attribute def Pound :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 559,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 558,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13720,
    "endOffset": 13724,
    "fieldRanges": {
      "name": {
        "startOffset": 13720,
        "endOffset": 13724
      },
      "superclassifier": {
        "startOffset": 13720,
        "endOffset": 13724
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 560,
    "kind": "Definition",
    "name": "PoundMass",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13730,
    "endOffset": 13772,
    "fieldRanges": {
      "name": {
        "startOffset": 13753,
        "endOffset": 13762
      },
      "declaredName": {
        "startOffset": 13753,
        "endOffset": 13762
      }
    },
    "exports": [
      "abstract attribute def PoundMass :> Pound;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pound"
    }
  },
  {
    "id": 561,
    "kind": "Reference",
    "name": "Pound",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 560,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13766,
    "endOffset": 13771,
    "fieldRanges": {
      "name": {
        "startOffset": 13766,
        "endOffset": 13771
      },
      "superclassifier": {
        "startOffset": 13766,
        "endOffset": 13771
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 562,
    "kind": "Definition",
    "name": "PoundForce",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13777,
    "endOffset": 13819,
    "fieldRanges": {
      "name": {
        "startOffset": 13800,
        "endOffset": 13810
      },
      "declaredName": {
        "startOffset": 13800,
        "endOffset": 13810
      }
    },
    "exports": [
      "abstract attribute def PoundForce :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 563,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 562,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13814,
    "endOffset": 13818,
    "fieldRanges": {
      "name": {
        "startOffset": 13814,
        "endOffset": 13818
      },
      "superclassifier": {
        "startOffset": 13814,
        "endOffset": 13818
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 564,
    "kind": "Definition",
    "name": "Slug",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13824,
    "endOffset": 13860,
    "fieldRanges": {
      "name": {
        "startOffset": 13847,
        "endOffset": 13851
      },
      "declaredName": {
        "startOffset": 13847,
        "endOffset": 13851
      }
    },
    "exports": [
      "abstract attribute def Slug :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 565,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 564,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13855,
    "endOffset": 13859,
    "fieldRanges": {
      "name": {
        "startOffset": 13855,
        "endOffset": 13859
      },
      "superclassifier": {
        "startOffset": 13855,
        "endOffset": 13859
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 566,
    "kind": "Definition",
    "name": "Ton",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13865,
    "endOffset": 13900,
    "fieldRanges": {
      "name": {
        "startOffset": 13888,
        "endOffset": 13891
      },
      "declaredName": {
        "startOffset": 13888,
        "endOffset": 13891
      }
    },
    "exports": [
      "abstract attribute def Ton :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 567,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 566,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13895,
    "endOffset": 13899,
    "fieldRanges": {
      "name": {
        "startOffset": 13895,
        "endOffset": 13899
      },
      "superclassifier": {
        "startOffset": 13895,
        "endOffset": 13899
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 568,
    "kind": "Definition",
    "name": "oz",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13906,
    "endOffset": 13941,
    "fieldRanges": {
      "name": {
        "startOffset": 13929,
        "endOffset": 13931
      },
      "declaredName": {
        "startOffset": 13929,
        "endOffset": 13931
      }
    },
    "exports": [
      "abstract attribute def oz :> Ounce;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Ounce"
    }
  },
  {
    "id": 569,
    "kind": "Reference",
    "name": "Ounce",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 568,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13935,
    "endOffset": 13940,
    "fieldRanges": {
      "name": {
        "startOffset": 13935,
        "endOffset": 13940
      },
      "superclassifier": {
        "startOffset": 13935,
        "endOffset": 13940
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 570,
    "kind": "Definition",
    "name": "lb",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13946,
    "endOffset": 13981,
    "fieldRanges": {
      "name": {
        "startOffset": 13969,
        "endOffset": 13971
      },
      "declaredName": {
        "startOffset": 13969,
        "endOffset": 13971
      }
    },
    "exports": [
      "abstract attribute def lb :> Pound;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Pound"
    }
  },
  {
    "id": 571,
    "kind": "Reference",
    "name": "Pound",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 570,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13975,
    "endOffset": 13980,
    "fieldRanges": {
      "name": {
        "startOffset": 13975,
        "endOffset": 13980
      },
      "superclassifier": {
        "startOffset": 13975,
        "endOffset": 13980
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 572,
    "kind": "Definition",
    "name": "lbf",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 13986,
    "endOffset": 14027,
    "fieldRanges": {
      "name": {
        "startOffset": 14009,
        "endOffset": 14012
      },
      "declaredName": {
        "startOffset": 14009,
        "endOffset": 14012
      }
    },
    "exports": [
      "abstract attribute def lbf :> PoundForce;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "PoundForce"
    }
  },
  {
    "id": 573,
    "kind": "Reference",
    "name": "PoundForce",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 572,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14016,
    "endOffset": 14026,
    "fieldRanges": {
      "name": {
        "startOffset": 14016,
        "endOffset": 14026
      },
      "superclassifier": {
        "startOffset": 14016,
        "endOffset": 14026
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 574,
    "kind": "Definition",
    "name": "Gallon",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14050,
    "endOffset": 14088,
    "fieldRanges": {
      "name": {
        "startOffset": 14073,
        "endOffset": 14079
      },
      "declaredName": {
        "startOffset": 14073,
        "endOffset": 14079
      }
    },
    "exports": [
      "abstract attribute def Gallon :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 575,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 574,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14083,
    "endOffset": 14087,
    "fieldRanges": {
      "name": {
        "startOffset": 14083,
        "endOffset": 14087
      },
      "superclassifier": {
        "startOffset": 14083,
        "endOffset": 14087
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 576,
    "kind": "Definition",
    "name": "Quart",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14093,
    "endOffset": 14130,
    "fieldRanges": {
      "name": {
        "startOffset": 14116,
        "endOffset": 14121
      },
      "declaredName": {
        "startOffset": 14116,
        "endOffset": 14121
      }
    },
    "exports": [
      "abstract attribute def Quart :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 577,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 576,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14125,
    "endOffset": 14129,
    "fieldRanges": {
      "name": {
        "startOffset": 14125,
        "endOffset": 14129
      },
      "superclassifier": {
        "startOffset": 14125,
        "endOffset": 14129
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 578,
    "kind": "Definition",
    "name": "Pint",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14135,
    "endOffset": 14171,
    "fieldRanges": {
      "name": {
        "startOffset": 14158,
        "endOffset": 14162
      },
      "declaredName": {
        "startOffset": 14158,
        "endOffset": 14162
      }
    },
    "exports": [
      "abstract attribute def Pint :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 579,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 578,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14166,
    "endOffset": 14170,
    "fieldRanges": {
      "name": {
        "startOffset": 14166,
        "endOffset": 14170
      },
      "superclassifier": {
        "startOffset": 14166,
        "endOffset": 14170
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 580,
    "kind": "Definition",
    "name": "Cup",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14176,
    "endOffset": 14211,
    "fieldRanges": {
      "name": {
        "startOffset": 14199,
        "endOffset": 14202
      },
      "declaredName": {
        "startOffset": 14199,
        "endOffset": 14202
      }
    },
    "exports": [
      "abstract attribute def Cup :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 581,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 580,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14206,
    "endOffset": 14210,
    "fieldRanges": {
      "name": {
        "startOffset": 14206,
        "endOffset": 14210
      },
      "superclassifier": {
        "startOffset": 14206,
        "endOffset": 14210
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 582,
    "kind": "Definition",
    "name": "FluidOunce",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14216,
    "endOffset": 14258,
    "fieldRanges": {
      "name": {
        "startOffset": 14239,
        "endOffset": 14249
      },
      "declaredName": {
        "startOffset": 14239,
        "endOffset": 14249
      }
    },
    "exports": [
      "abstract attribute def FluidOunce :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 583,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 582,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14253,
    "endOffset": 14257,
    "fieldRanges": {
      "name": {
        "startOffset": 14253,
        "endOffset": 14257
      },
      "superclassifier": {
        "startOffset": 14253,
        "endOffset": 14257
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 584,
    "kind": "Definition",
    "name": "gal",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14263,
    "endOffset": 14300,
    "fieldRanges": {
      "name": {
        "startOffset": 14286,
        "endOffset": 14289
      },
      "declaredName": {
        "startOffset": 14286,
        "endOffset": 14289
      }
    },
    "exports": [
      "abstract attribute def gal :> Gallon;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Gallon"
    }
  },
  {
    "id": 585,
    "kind": "Reference",
    "name": "Gallon",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 584,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14293,
    "endOffset": 14299,
    "fieldRanges": {
      "name": {
        "startOffset": 14293,
        "endOffset": 14299
      },
      "superclassifier": {
        "startOffset": 14293,
        "endOffset": 14299
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 586,
    "kind": "Definition",
    "name": "PoundPerSquareInch",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14325,
    "endOffset": 14375,
    "fieldRanges": {
      "name": {
        "startOffset": 14348,
        "endOffset": 14366
      },
      "declaredName": {
        "startOffset": 14348,
        "endOffset": 14366
      }
    },
    "exports": [
      "abstract attribute def PoundPerSquareInch :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 587,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 586,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14370,
    "endOffset": 14374,
    "fieldRanges": {
      "name": {
        "startOffset": 14370,
        "endOffset": 14374
      },
      "superclassifier": {
        "startOffset": 14370,
        "endOffset": 14374
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 588,
    "kind": "Definition",
    "name": "psi",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14380,
    "endOffset": 14429,
    "fieldRanges": {
      "name": {
        "startOffset": 14403,
        "endOffset": 14406
      },
      "declaredName": {
        "startOffset": 14403,
        "endOffset": 14406
      }
    },
    "exports": [
      "abstract attribute def psi :> PoundPerSquareInch;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "PoundPerSquareInch"
    }
  },
  {
    "id": 589,
    "kind": "Reference",
    "name": "PoundPerSquareInch",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 588,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14410,
    "endOffset": 14428,
    "fieldRanges": {
      "name": {
        "startOffset": 14410,
        "endOffset": 14428
      },
      "superclassifier": {
        "startOffset": 14410,
        "endOffset": 14428
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 590,
    "kind": "Definition",
    "name": "ksi",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14434,
    "endOffset": 14469,
    "fieldRanges": {
      "name": {
        "startOffset": 14457,
        "endOffset": 14460
      },
      "declaredName": {
        "startOffset": 14457,
        "endOffset": 14460
      }
    },
    "exports": [
      "abstract attribute def ksi :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 591,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 590,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14464,
    "endOffset": 14468,
    "fieldRanges": {
      "name": {
        "startOffset": 14464,
        "endOffset": 14468
      },
      "superclassifier": {
        "startOffset": 14464,
        "endOffset": 14468
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 592,
    "kind": "Definition",
    "name": "BritishThermalUnit",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14507,
    "endOffset": 14557,
    "fieldRanges": {
      "name": {
        "startOffset": 14530,
        "endOffset": 14548
      },
      "declaredName": {
        "startOffset": 14530,
        "endOffset": 14548
      }
    },
    "exports": [
      "abstract attribute def BritishThermalUnit :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 593,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 592,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14552,
    "endOffset": 14556,
    "fieldRanges": {
      "name": {
        "startOffset": 14552,
        "endOffset": 14556
      },
      "superclassifier": {
        "startOffset": 14552,
        "endOffset": 14556
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 594,
    "kind": "Definition",
    "name": "Btu",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14562,
    "endOffset": 14611,
    "fieldRanges": {
      "name": {
        "startOffset": 14585,
        "endOffset": 14588
      },
      "declaredName": {
        "startOffset": 14585,
        "endOffset": 14588
      }
    },
    "exports": [
      "abstract attribute def Btu :> BritishThermalUnit;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "BritishThermalUnit"
    }
  },
  {
    "id": 595,
    "kind": "Reference",
    "name": "BritishThermalUnit",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 594,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14592,
    "endOffset": 14610,
    "fieldRanges": {
      "name": {
        "startOffset": 14592,
        "endOffset": 14610
      },
      "superclassifier": {
        "startOffset": 14592,
        "endOffset": 14610
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 596,
    "kind": "Definition",
    "name": "FootPound",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14616,
    "endOffset": 14657,
    "fieldRanges": {
      "name": {
        "startOffset": 14639,
        "endOffset": 14648
      },
      "declaredName": {
        "startOffset": 14639,
        "endOffset": 14648
      }
    },
    "exports": [
      "abstract attribute def FootPound :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 597,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 596,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14652,
    "endOffset": 14656,
    "fieldRanges": {
      "name": {
        "startOffset": 14652,
        "endOffset": 14656
      },
      "superclassifier": {
        "startOffset": 14652,
        "endOffset": 14656
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 598,
    "kind": "Definition",
    "name": "Horsepower",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14662,
    "endOffset": 14704,
    "fieldRanges": {
      "name": {
        "startOffset": 14685,
        "endOffset": 14695
      },
      "declaredName": {
        "startOffset": 14685,
        "endOffset": 14695
      }
    },
    "exports": [
      "abstract attribute def Horsepower :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 599,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 598,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14699,
    "endOffset": 14703,
    "fieldRanges": {
      "name": {
        "startOffset": 14699,
        "endOffset": 14703
      },
      "superclassifier": {
        "startOffset": 14699,
        "endOffset": 14703
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 600,
    "kind": "Definition",
    "name": "hp",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14709,
    "endOffset": 14749,
    "fieldRanges": {
      "name": {
        "startOffset": 14732,
        "endOffset": 14734
      },
      "declaredName": {
        "startOffset": 14732,
        "endOffset": 14734
      }
    },
    "exports": [
      "abstract attribute def hp :> Horsepower;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Horsepower"
    }
  },
  {
    "id": 601,
    "kind": "Reference",
    "name": "Horsepower",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 600,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14738,
    "endOffset": 14748,
    "fieldRanges": {
      "name": {
        "startOffset": 14738,
        "endOffset": 14748
      },
      "superclassifier": {
        "startOffset": 14738,
        "endOffset": 14748
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 602,
    "kind": "Definition",
    "name": "MilePerHour",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14754,
    "endOffset": 14797,
    "fieldRanges": {
      "name": {
        "startOffset": 14777,
        "endOffset": 14788
      },
      "declaredName": {
        "startOffset": 14777,
        "endOffset": 14788
      }
    },
    "exports": [
      "abstract attribute def MilePerHour :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 603,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 602,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14792,
    "endOffset": 14796,
    "fieldRanges": {
      "name": {
        "startOffset": 14792,
        "endOffset": 14796
      },
      "superclassifier": {
        "startOffset": 14792,
        "endOffset": 14796
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 604,
    "kind": "Definition",
    "name": "mph",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14802,
    "endOffset": 14844,
    "fieldRanges": {
      "name": {
        "startOffset": 14825,
        "endOffset": 14828
      },
      "declaredName": {
        "startOffset": 14825,
        "endOffset": 14828
      }
    },
    "exports": [
      "abstract attribute def mph :> MilePerHour;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "MilePerHour"
    }
  },
  {
    "id": 605,
    "kind": "Reference",
    "name": "MilePerHour",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 604,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14832,
    "endOffset": 14843,
    "fieldRanges": {
      "name": {
        "startOffset": 14832,
        "endOffset": 14843
      },
      "superclassifier": {
        "startOffset": 14832,
        "endOffset": 14843
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 606,
    "kind": "Definition",
    "name": "DegreeFahrenheit",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14872,
    "endOffset": 14920,
    "fieldRanges": {
      "name": {
        "startOffset": 14895,
        "endOffset": 14911
      },
      "declaredName": {
        "startOffset": 14895,
        "endOffset": 14911
      }
    },
    "exports": [
      "abstract attribute def DegreeFahrenheit :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 607,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 606,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14915,
    "endOffset": 14919,
    "fieldRanges": {
      "name": {
        "startOffset": 14915,
        "endOffset": 14919
      },
      "superclassifier": {
        "startOffset": 14915,
        "endOffset": 14919
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 608,
    "kind": "Definition",
    "name": "degF",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14925,
    "endOffset": 14973,
    "fieldRanges": {
      "name": {
        "startOffset": 14948,
        "endOffset": 14952
      },
      "declaredName": {
        "startOffset": 14948,
        "endOffset": 14952
      }
    },
    "exports": [
      "abstract attribute def degF :> DegreeFahrenheit;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "DegreeFahrenheit"
    }
  },
  {
    "id": 609,
    "kind": "Reference",
    "name": "DegreeFahrenheit",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 608,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14956,
    "endOffset": 14972,
    "fieldRanges": {
      "name": {
        "startOffset": 14956,
        "endOffset": 14972
      },
      "superclassifier": {
        "startOffset": 14956,
        "endOffset": 14972
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 610,
    "kind": "Definition",
    "name": "Rankine",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 532,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 14978,
    "endOffset": 15017,
    "fieldRanges": {
      "name": {
        "startOffset": 15001,
        "endOffset": 15008
      },
      "declaredName": {
        "startOffset": 15001,
        "endOffset": 15008
      }
    },
    "exports": [
      "abstract attribute def Rankine :> Real;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Real"
    }
  },
  {
    "id": 611,
    "kind": "Reference",
    "name": "Real",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 610,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15012,
    "endOffset": 15016,
    "fieldRanges": {
      "name": {
        "startOffset": 15012,
        "endOffset": 15016
      },
      "superclassifier": {
        "startOffset": 15012,
        "endOffset": 15016
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 612,
    "kind": "Package",
    "name": "CauseAndEffect",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15021,
    "endOffset": 15621,
    "fieldRanges": {
      "name": {
        "startOffset": 15029,
        "endOffset": 15043
      },
      "declaredName": {
        "startOffset": 15029,
        "endOffset": 15043
      }
    },
    "exports": [
      "package CauseAndEffect {\n    import Base::*;\n    import CoreTypes::*;\n\n    abstract item def Cause;\n    abstract item def Effect;\n    abstract item def Causation :> Relationship;\n    abstract item def CausalConnection :> Relationship;\n    abstract item def Hazard :> Classifier;\n    abstract item def FailureMode :> Classifier;\n    abstract item def Fault :> Classifier;\n    abstract item def HazardousEvent;\n    abstract item def Risk;\n    abstract item def HazardousState;\n    abstract item def Mitigation;\n    abstract item def SafetyCase;\n    abstract item def SafetyRequirement :> Requirement;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 613,
    "kind": "Import",
    "name": "Base",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15050,
    "endOffset": 15064,
    "fieldRanges": {
      "name": {
        "startOffset": 15057,
        "endOffset": 15061
      },
      "importedNamespace": {
        "startOffset": 15057,
        "endOffset": 15061
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
    "id": 614,
    "kind": "Import",
    "name": "CoreTypes",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15070,
    "endOffset": 15089,
    "fieldRanges": {
      "name": {
        "startOffset": 15077,
        "endOffset": 15086
      },
      "importedNamespace": {
        "startOffset": 15077,
        "endOffset": 15086
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
    "id": 615,
    "kind": "Definition",
    "name": "Cause",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15096,
    "endOffset": 15120,
    "fieldRanges": {
      "name": {
        "startOffset": 15114,
        "endOffset": 15119
      },
      "declaredName": {
        "startOffset": 15114,
        "endOffset": 15119
      }
    },
    "exports": [
      "abstract item def Cause;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 616,
    "kind": "Definition",
    "name": "Effect",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15125,
    "endOffset": 15150,
    "fieldRanges": {
      "name": {
        "startOffset": 15143,
        "endOffset": 15149
      },
      "declaredName": {
        "startOffset": 15143,
        "endOffset": 15149
      }
    },
    "exports": [
      "abstract item def Effect;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 617,
    "kind": "Definition",
    "name": "Causation",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15155,
    "endOffset": 15199,
    "fieldRanges": {
      "name": {
        "startOffset": 15173,
        "endOffset": 15182
      },
      "declaredName": {
        "startOffset": 15173,
        "endOffset": 15182
      }
    },
    "exports": [
      "abstract item def Causation :> Relationship;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Relationship"
    }
  },
  {
    "id": 618,
    "kind": "Reference",
    "name": "Relationship",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 617,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15186,
    "endOffset": 15198,
    "fieldRanges": {
      "name": {
        "startOffset": 15186,
        "endOffset": 15198
      },
      "superclassifier": {
        "startOffset": 15186,
        "endOffset": 15198
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 619,
    "kind": "Definition",
    "name": "CausalConnection",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15204,
    "endOffset": 15255,
    "fieldRanges": {
      "name": {
        "startOffset": 15222,
        "endOffset": 15238
      },
      "declaredName": {
        "startOffset": 15222,
        "endOffset": 15238
      }
    },
    "exports": [
      "abstract item def CausalConnection :> Relationship;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Relationship"
    }
  },
  {
    "id": 620,
    "kind": "Reference",
    "name": "Relationship",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 619,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15242,
    "endOffset": 15254,
    "fieldRanges": {
      "name": {
        "startOffset": 15242,
        "endOffset": 15254
      },
      "superclassifier": {
        "startOffset": 15242,
        "endOffset": 15254
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 621,
    "kind": "Definition",
    "name": "Hazard",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15260,
    "endOffset": 15299,
    "fieldRanges": {
      "name": {
        "startOffset": 15278,
        "endOffset": 15284
      },
      "declaredName": {
        "startOffset": 15278,
        "endOffset": 15284
      }
    },
    "exports": [
      "abstract item def Hazard :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Classifier"
    }
  },
  {
    "id": 622,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 621,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15288,
    "endOffset": 15298,
    "fieldRanges": {
      "name": {
        "startOffset": 15288,
        "endOffset": 15298
      },
      "superclassifier": {
        "startOffset": 15288,
        "endOffset": 15298
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 623,
    "kind": "Definition",
    "name": "FailureMode",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15304,
    "endOffset": 15348,
    "fieldRanges": {
      "name": {
        "startOffset": 15322,
        "endOffset": 15333
      },
      "declaredName": {
        "startOffset": 15322,
        "endOffset": 15333
      }
    },
    "exports": [
      "abstract item def FailureMode :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Classifier"
    }
  },
  {
    "id": 624,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 623,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15337,
    "endOffset": 15347,
    "fieldRanges": {
      "name": {
        "startOffset": 15337,
        "endOffset": 15347
      },
      "superclassifier": {
        "startOffset": 15337,
        "endOffset": 15347
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 625,
    "kind": "Definition",
    "name": "Fault",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15353,
    "endOffset": 15391,
    "fieldRanges": {
      "name": {
        "startOffset": 15371,
        "endOffset": 15376
      },
      "declaredName": {
        "startOffset": 15371,
        "endOffset": 15376
      }
    },
    "exports": [
      "abstract item def Fault :> Classifier;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Classifier"
    }
  },
  {
    "id": 626,
    "kind": "Reference",
    "name": "Classifier",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 625,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15380,
    "endOffset": 15390,
    "fieldRanges": {
      "name": {
        "startOffset": 15380,
        "endOffset": 15390
      },
      "superclassifier": {
        "startOffset": 15380,
        "endOffset": 15390
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 627,
    "kind": "Definition",
    "name": "HazardousEvent",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15396,
    "endOffset": 15429,
    "fieldRanges": {
      "name": {
        "startOffset": 15414,
        "endOffset": 15428
      },
      "declaredName": {
        "startOffset": 15414,
        "endOffset": 15428
      }
    },
    "exports": [
      "abstract item def HazardousEvent;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 628,
    "kind": "Definition",
    "name": "Risk",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15434,
    "endOffset": 15457,
    "fieldRanges": {
      "name": {
        "startOffset": 15452,
        "endOffset": 15456
      },
      "declaredName": {
        "startOffset": 15452,
        "endOffset": 15456
      }
    },
    "exports": [
      "abstract item def Risk;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 629,
    "kind": "Definition",
    "name": "HazardousState",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15462,
    "endOffset": 15495,
    "fieldRanges": {
      "name": {
        "startOffset": 15480,
        "endOffset": 15494
      },
      "declaredName": {
        "startOffset": 15480,
        "endOffset": 15494
      }
    },
    "exports": [
      "abstract item def HazardousState;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 630,
    "kind": "Definition",
    "name": "Mitigation",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15500,
    "endOffset": 15529,
    "fieldRanges": {
      "name": {
        "startOffset": 15518,
        "endOffset": 15528
      },
      "declaredName": {
        "startOffset": 15518,
        "endOffset": 15528
      }
    },
    "exports": [
      "abstract item def Mitigation;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 631,
    "kind": "Definition",
    "name": "SafetyCase",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15534,
    "endOffset": 15563,
    "fieldRanges": {
      "name": {
        "startOffset": 15552,
        "endOffset": 15562
      },
      "declaredName": {
        "startOffset": 15552,
        "endOffset": 15562
      }
    },
    "exports": [
      "abstract item def SafetyCase;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 632,
    "kind": "Definition",
    "name": "SafetyRequirement",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 612,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15568,
    "endOffset": 15619,
    "fieldRanges": {
      "name": {
        "startOffset": 15586,
        "endOffset": 15603
      },
      "declaredName": {
        "startOffset": 15586,
        "endOffset": 15603
      }
    },
    "exports": [
      "abstract item def SafetyRequirement :> Requirement;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Requirement"
    }
  },
  {
    "id": 633,
    "kind": "Reference",
    "name": "Requirement",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 632,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15607,
    "endOffset": 15618,
    "fieldRanges": {
      "name": {
        "startOffset": 15607,
        "endOffset": 15618
      },
      "superclassifier": {
        "startOffset": 15607,
        "endOffset": 15618
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 634,
    "kind": "Package",
    "name": "SpatialFrames",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15623,
    "endOffset": 16513,
    "fieldRanges": {
      "name": {
        "startOffset": 15631,
        "endOffset": 15644
      },
      "declaredName": {
        "startOffset": 15631,
        "endOffset": 15644
      }
    },
    "exports": [
      "package SpatialFrames {\n    import Base::*;\n    import ScalarValues::*;\n\n    abstract item def SpatialFrame;\n    abstract item def WorldFrame :> SpatialFrame;\n    abstract item def CoordinateFrame :> SpatialFrame;\n    abstract item def CartesianFrame :> CoordinateFrame;\n    abstract item def Cartesian3DFrame :> CartesianFrame;\n    abstract item def Cartesian2DFrame :> CartesianFrame;\n    abstract item def CylindricalFrame :> CoordinateFrame;\n    abstract item def SphericalFrame :> CoordinateFrame;\n\n    abstract attribute def PositionVector;\n    abstract attribute def OrientationVector;\n    abstract attribute def Orientation;\n    abstract attribute def DisplacementVector;\n    abstract attribute def RotationMatrix;\n    abstract attribute def Quaternion;\n    abstract attribute def Transform;\n    abstract attribute def Transform3D :> Transform;\n    abstract attribute def Point3D;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 635,
    "kind": "Import",
    "name": "Base",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15651,
    "endOffset": 15665,
    "fieldRanges": {
      "name": {
        "startOffset": 15658,
        "endOffset": 15662
      },
      "importedNamespace": {
        "startOffset": 15658,
        "endOffset": 15662
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
    "id": 636,
    "kind": "Import",
    "name": "ScalarValues",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15671,
    "endOffset": 15693,
    "fieldRanges": {
      "name": {
        "startOffset": 15678,
        "endOffset": 15690
      },
      "importedNamespace": {
        "startOffset": 15678,
        "endOffset": 15690
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
    "id": 637,
    "kind": "Definition",
    "name": "SpatialFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15700,
    "endOffset": 15731,
    "fieldRanges": {
      "name": {
        "startOffset": 15718,
        "endOffset": 15730
      },
      "declaredName": {
        "startOffset": 15718,
        "endOffset": 15730
      }
    },
    "exports": [
      "abstract item def SpatialFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 638,
    "kind": "Definition",
    "name": "WorldFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15736,
    "endOffset": 15781,
    "fieldRanges": {
      "name": {
        "startOffset": 15754,
        "endOffset": 15764
      },
      "declaredName": {
        "startOffset": 15754,
        "endOffset": 15764
      }
    },
    "exports": [
      "abstract item def WorldFrame :> SpatialFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "SpatialFrame"
    }
  },
  {
    "id": 639,
    "kind": "Reference",
    "name": "SpatialFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 638,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15768,
    "endOffset": 15780,
    "fieldRanges": {
      "name": {
        "startOffset": 15768,
        "endOffset": 15780
      },
      "superclassifier": {
        "startOffset": 15768,
        "endOffset": 15780
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 640,
    "kind": "Definition",
    "name": "CoordinateFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15786,
    "endOffset": 15836,
    "fieldRanges": {
      "name": {
        "startOffset": 15804,
        "endOffset": 15819
      },
      "declaredName": {
        "startOffset": 15804,
        "endOffset": 15819
      }
    },
    "exports": [
      "abstract item def CoordinateFrame :> SpatialFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "SpatialFrame"
    }
  },
  {
    "id": 641,
    "kind": "Reference",
    "name": "SpatialFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 640,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15823,
    "endOffset": 15835,
    "fieldRanges": {
      "name": {
        "startOffset": 15823,
        "endOffset": 15835
      },
      "superclassifier": {
        "startOffset": 15823,
        "endOffset": 15835
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 642,
    "kind": "Definition",
    "name": "CartesianFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15841,
    "endOffset": 15893,
    "fieldRanges": {
      "name": {
        "startOffset": 15859,
        "endOffset": 15873
      },
      "declaredName": {
        "startOffset": 15859,
        "endOffset": 15873
      }
    },
    "exports": [
      "abstract item def CartesianFrame :> CoordinateFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "CoordinateFrame"
    }
  },
  {
    "id": 643,
    "kind": "Reference",
    "name": "CoordinateFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 642,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15877,
    "endOffset": 15892,
    "fieldRanges": {
      "name": {
        "startOffset": 15877,
        "endOffset": 15892
      },
      "superclassifier": {
        "startOffset": 15877,
        "endOffset": 15892
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 644,
    "kind": "Definition",
    "name": "Cartesian3DFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15898,
    "endOffset": 15951,
    "fieldRanges": {
      "name": {
        "startOffset": 15916,
        "endOffset": 15932
      },
      "declaredName": {
        "startOffset": 15916,
        "endOffset": 15932
      }
    },
    "exports": [
      "abstract item def Cartesian3DFrame :> CartesianFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "CartesianFrame"
    }
  },
  {
    "id": 645,
    "kind": "Reference",
    "name": "CartesianFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 644,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15936,
    "endOffset": 15950,
    "fieldRanges": {
      "name": {
        "startOffset": 15936,
        "endOffset": 15950
      },
      "superclassifier": {
        "startOffset": 15936,
        "endOffset": 15950
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 646,
    "kind": "Definition",
    "name": "Cartesian2DFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15956,
    "endOffset": 16009,
    "fieldRanges": {
      "name": {
        "startOffset": 15974,
        "endOffset": 15990
      },
      "declaredName": {
        "startOffset": 15974,
        "endOffset": 15990
      }
    },
    "exports": [
      "abstract item def Cartesian2DFrame :> CartesianFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "CartesianFrame"
    }
  },
  {
    "id": 647,
    "kind": "Reference",
    "name": "CartesianFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 646,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 15994,
    "endOffset": 16008,
    "fieldRanges": {
      "name": {
        "startOffset": 15994,
        "endOffset": 16008
      },
      "superclassifier": {
        "startOffset": 15994,
        "endOffset": 16008
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 648,
    "kind": "Definition",
    "name": "CylindricalFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16014,
    "endOffset": 16068,
    "fieldRanges": {
      "name": {
        "startOffset": 16032,
        "endOffset": 16048
      },
      "declaredName": {
        "startOffset": 16032,
        "endOffset": 16048
      }
    },
    "exports": [
      "abstract item def CylindricalFrame :> CoordinateFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "CoordinateFrame"
    }
  },
  {
    "id": 649,
    "kind": "Reference",
    "name": "CoordinateFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 648,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16052,
    "endOffset": 16067,
    "fieldRanges": {
      "name": {
        "startOffset": 16052,
        "endOffset": 16067
      },
      "superclassifier": {
        "startOffset": 16052,
        "endOffset": 16067
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 650,
    "kind": "Definition",
    "name": "SphericalFrame",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16073,
    "endOffset": 16125,
    "fieldRanges": {
      "name": {
        "startOffset": 16091,
        "endOffset": 16105
      },
      "declaredName": {
        "startOffset": 16091,
        "endOffset": 16105
      }
    },
    "exports": [
      "abstract item def SphericalFrame :> CoordinateFrame;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "CoordinateFrame"
    }
  },
  {
    "id": 651,
    "kind": "Reference",
    "name": "CoordinateFrame",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 650,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16109,
    "endOffset": 16124,
    "fieldRanges": {
      "name": {
        "startOffset": 16109,
        "endOffset": 16124
      },
      "superclassifier": {
        "startOffset": 16109,
        "endOffset": 16124
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 652,
    "kind": "Definition",
    "name": "PositionVector",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16131,
    "endOffset": 16169,
    "fieldRanges": {
      "name": {
        "startOffset": 16154,
        "endOffset": 16168
      },
      "declaredName": {
        "startOffset": 16154,
        "endOffset": 16168
      }
    },
    "exports": [
      "abstract attribute def PositionVector;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 653,
    "kind": "Definition",
    "name": "OrientationVector",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16174,
    "endOffset": 16215,
    "fieldRanges": {
      "name": {
        "startOffset": 16197,
        "endOffset": 16214
      },
      "declaredName": {
        "startOffset": 16197,
        "endOffset": 16214
      }
    },
    "exports": [
      "abstract attribute def OrientationVector;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 654,
    "kind": "Definition",
    "name": "Orientation",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16220,
    "endOffset": 16255,
    "fieldRanges": {
      "name": {
        "startOffset": 16243,
        "endOffset": 16254
      },
      "declaredName": {
        "startOffset": 16243,
        "endOffset": 16254
      }
    },
    "exports": [
      "abstract attribute def Orientation;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 655,
    "kind": "Definition",
    "name": "DisplacementVector",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16260,
    "endOffset": 16302,
    "fieldRanges": {
      "name": {
        "startOffset": 16283,
        "endOffset": 16301
      },
      "declaredName": {
        "startOffset": 16283,
        "endOffset": 16301
      }
    },
    "exports": [
      "abstract attribute def DisplacementVector;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 656,
    "kind": "Definition",
    "name": "RotationMatrix",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16307,
    "endOffset": 16345,
    "fieldRanges": {
      "name": {
        "startOffset": 16330,
        "endOffset": 16344
      },
      "declaredName": {
        "startOffset": 16330,
        "endOffset": 16344
      }
    },
    "exports": [
      "abstract attribute def RotationMatrix;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 657,
    "kind": "Definition",
    "name": "Quaternion",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16350,
    "endOffset": 16384,
    "fieldRanges": {
      "name": {
        "startOffset": 16373,
        "endOffset": 16383
      },
      "declaredName": {
        "startOffset": 16373,
        "endOffset": 16383
      }
    },
    "exports": [
      "abstract attribute def Quaternion;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 658,
    "kind": "Definition",
    "name": "Transform",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16389,
    "endOffset": 16422,
    "fieldRanges": {
      "name": {
        "startOffset": 16412,
        "endOffset": 16421
      },
      "declaredName": {
        "startOffset": 16412,
        "endOffset": 16421
      }
    },
    "exports": [
      "abstract attribute def Transform;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 659,
    "kind": "Definition",
    "name": "Transform3D",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16427,
    "endOffset": 16475,
    "fieldRanges": {
      "name": {
        "startOffset": 16450,
        "endOffset": 16461
      },
      "declaredName": {
        "startOffset": 16450,
        "endOffset": 16461
      }
    },
    "exports": [
      "abstract attribute def Transform3D :> Transform;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": "Transform"
    }
  },
  {
    "id": 660,
    "kind": "Reference",
    "name": "Transform",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 659,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16465,
    "endOffset": 16474,
    "fieldRanges": {
      "name": {
        "startOffset": 16465,
        "endOffset": 16474
      },
      "superclassifier": {
        "startOffset": 16465,
        "endOffset": 16474
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 661,
    "kind": "Definition",
    "name": "Point3D",
    "ruleName": "AttributeDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 634,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16480,
    "endOffset": 16511,
    "fieldRanges": {
      "name": {
        "startOffset": 16503,
        "endOffset": 16510
      },
      "declaredName": {
        "startOffset": 16503,
        "endOffset": 16510
      }
    },
    "exports": [
      "abstract attribute def Point3D;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 662,
    "kind": "Package",
    "name": "StateMachines",
    "ruleName": "Package",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": null,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16515,
    "endOffset": 16866,
    "fieldRanges": {
      "name": {
        "startOffset": 16523,
        "endOffset": 16536
      },
      "declaredName": {
        "startOffset": 16523,
        "endOffset": 16536
      }
    },
    "exports": [
      "package StateMachines {\n    import Base::*;\n    import CoreTypes::*;\n\n    abstract state def StateDefinition :> State;\n    abstract item def Transition;\n    abstract item def Trigger;\n    abstract item def Guard;\n    abstract action def EntryAction :> Action;\n    abstract action def ExitAction :> Action;\n    abstract action def DoAction :> Action;\n}"
    ],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 663,
    "kind": "Import",
    "name": "Base",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16543,
    "endOffset": 16557,
    "fieldRanges": {
      "name": {
        "startOffset": 16550,
        "endOffset": 16554
      },
      "importedNamespace": {
        "startOffset": 16550,
        "endOffset": 16554
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
    "id": 664,
    "kind": "Import",
    "name": "CoreTypes",
    "ruleName": "NamespaceImport",
    "namePath": "importedNamespace",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16563,
    "endOffset": 16582,
    "fieldRanges": {
      "name": {
        "startOffset": 16570,
        "endOffset": 16579
      },
      "importedNamespace": {
        "startOffset": 16570,
        "endOffset": 16579
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
    "id": 665,
    "kind": "Definition",
    "name": "StateDefinition",
    "ruleName": "StateDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16589,
    "endOffset": 16633,
    "fieldRanges": {
      "name": {
        "startOffset": 16608,
        "endOffset": 16623
      },
      "declaredName": {
        "startOffset": 16608,
        "endOffset": 16623
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "isParallel": null
    }
  },
  {
    "id": 666,
    "kind": "Reference",
    "name": "State",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 665,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16627,
    "endOffset": 16632,
    "fieldRanges": {
      "name": {
        "startOffset": 16627,
        "endOffset": 16632
      },
      "superclassifier": {
        "startOffset": 16627,
        "endOffset": 16632
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 667,
    "kind": "Definition",
    "name": "Transition",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16638,
    "endOffset": 16667,
    "fieldRanges": {
      "name": {
        "startOffset": 16656,
        "endOffset": 16666
      },
      "declaredName": {
        "startOffset": 16656,
        "endOffset": 16666
      }
    },
    "exports": [
      "abstract item def Transition;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 668,
    "kind": "Definition",
    "name": "Trigger",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16672,
    "endOffset": 16698,
    "fieldRanges": {
      "name": {
        "startOffset": 16690,
        "endOffset": 16697
      },
      "declaredName": {
        "startOffset": 16690,
        "endOffset": 16697
      }
    },
    "exports": [
      "abstract item def Trigger;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 669,
    "kind": "Definition",
    "name": "Guard",
    "ruleName": "ItemDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16703,
    "endOffset": 16727,
    "fieldRanges": {
      "name": {
        "startOffset": 16721,
        "endOffset": 16726
      },
      "declaredName": {
        "startOffset": 16721,
        "endOffset": 16726
      }
    },
    "exports": [
      "abstract item def Guard;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 670,
    "kind": "Definition",
    "name": "EntryAction",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16732,
    "endOffset": 16774,
    "fieldRanges": {
      "name": {
        "startOffset": 16752,
        "endOffset": 16763
      },
      "declaredName": {
        "startOffset": 16752,
        "endOffset": 16763
      }
    },
    "exports": [
      "abstract action def EntryAction :> Action;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 671,
    "kind": "Reference",
    "name": "Action",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 670,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16767,
    "endOffset": 16773,
    "fieldRanges": {
      "name": {
        "startOffset": 16767,
        "endOffset": 16773
      },
      "superclassifier": {
        "startOffset": 16767,
        "endOffset": 16773
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 672,
    "kind": "Definition",
    "name": "ExitAction",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16779,
    "endOffset": 16820,
    "fieldRanges": {
      "name": {
        "startOffset": 16799,
        "endOffset": 16809
      },
      "declaredName": {
        "startOffset": 16799,
        "endOffset": 16809
      }
    },
    "exports": [
      "abstract action def ExitAction :> Action;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 673,
    "kind": "Reference",
    "name": "Action",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 672,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16813,
    "endOffset": 16819,
    "fieldRanges": {
      "name": {
        "startOffset": 16813,
        "endOffset": 16819
      },
      "superclassifier": {
        "startOffset": 16813,
        "endOffset": 16819
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  },
  {
    "id": 674,
    "kind": "Definition",
    "name": "DoAction",
    "ruleName": "ActionDefinition",
    "namePath": "declaredName",
    "fieldName": null,
    "parentId": 662,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16825,
    "endOffset": 16864,
    "fieldRanges": {
      "name": {
        "startOffset": 16845,
        "endOffset": 16853
      },
      "declaredName": {
        "startOffset": 16845,
        "endOffset": 16853
      }
    },
    "exports": [
      "abstract action def DoAction :> Action;"
    ],
    "inherits": [],
    "metadata": {
      "isAbstract": "abstract",
      "isVariation": null,
      "shortName": null
    }
  },
  {
    "id": 675,
    "kind": "Reference",
    "name": "Action",
    "ruleName": "OwnedSubclassification",
    "namePath": "superclassifier",
    "fieldName": null,
    "parentId": 674,
    "resourceId": "sysml2://stdlib/KerML.sysml",
    "startOffset": 16857,
    "endOffset": 16863,
    "fieldRanges": {
      "name": {
        "startOffset": 16857,
        "endOffset": 16863
      },
      "superclassifier": {
        "startOffset": 16857,
        "endOffset": 16863
      }
    },
    "exports": [],
    "inherits": [],
    "metadata": {}
  }
];
