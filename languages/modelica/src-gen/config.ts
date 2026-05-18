import type { DiffConfig, GraphicsConfig, IndexerHook, RefHook } from "@modelscript/compiler";

export const INDEXER_HOOKS: IndexerHook[] = [
  {
    ruleName: "ClassDefinition",
    kind: "Class",
    namePath: "classSpecifier.identifier",
    exportPaths: ["classSpecifier.identifier"],
    inheritPaths: ["classSpecifier.identifier"],
    metadataFieldPaths: {
      classPrefixes: "classPrefixes",
      redeclare: "redeclare",
      final: "final",
      inner: "inner",
      outer: "outer",
      replaceable: "replaceable",
      encapsulated: "encapsulated",
      annotationClause: "classSpecifier.annotationClause",
    },
  },
  {
    ruleName: "EnumerationLiteral",
    kind: "EnumerationLiteral",
    namePath: "identifier",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "SimpleImportClause",
    kind: "Import",
    namePath: "packageName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { shortName: "shortName", packageName: "packageName" },
  },
  {
    ruleName: "CompoundImportClause",
    kind: "Import",
    namePath: "packageName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { packageName: "packageName" },
  },
  {
    ruleName: "UnqualifiedImportClause",
    kind: "Import",
    namePath: "packageName",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { packageName: "packageName" },
  },
  {
    ruleName: "ExtendsClause",
    kind: "Extends",
    namePath: "typeSpecifier",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { typeSpecifier: "typeSpecifier" },
  },
  {
    ruleName: "ComponentDeclaration",
    kind: "Component",
    namePath: "declaration.identifier",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { modification: "declaration.modification", description: "description" },
  },
  {
    ruleName: "ShortClassDefinition",
    kind: "Class",
    namePath: "classSpecifier.identifier",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { classPrefixes: "classPrefixes", enumeration: "classSpecifier.enumeration" },
  },
  {
    ruleName: "ConnectEquation",
    kind: "ConnectEquation",
    namePath: "componentReference1",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: { ref1: "componentReference1", ref2: "componentReference2" },
  },
  {
    ruleName: "TypeSpecifier",
    kind: "Reference",
    namePath: "name",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
  {
    ruleName: "ComponentReference",
    kind: "Reference",
    namePath: "part",
    exportPaths: [],
    inheritPaths: [],
    metadataFieldPaths: {},
  },
];

export const REF_HOOKS: RefHook[] = [
  {
    ruleName: "ExtendsClause",
    namePath: "typeSpecifier",
    targetKinds: ["Class"],
    resolve: "qualified",
  },
  {
    ruleName: "TypeSpecifier",
    namePath: "name",
    targetKinds: ["Class"],
    resolve: "qualified",
  },
  {
    ruleName: "ComponentReference",
    namePath: "part",
    targetKinds: ["Component", "Class"],
    resolve: "qualified",
  },
];

export const graphicsConfig: Record<string, GraphicsConfig> = {
  ClassDefinition: {
    role: "node",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "header",
        },
        {
          tagName: "line",
          selector: "separator",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e3f2fd",
          stroke: "#1565c0",
          strokeWidth: 2,
          rx: 4,
          ry: 4,
        },
        header: {
          text: "{{classPrefixes}}",
          fill: "#1565c0",
          fontSize: 10,
          textAnchor: "middle",
          refX: 0.5,
          refY: 14,
        },
        separator: {
          x1: 0,
          y1: 24,
          x2: "100%",
          y2: 24,
          stroke: "#1565c0",
          strokeWidth: 1,
        },
        label: {
          text: "{{name}}",
          fill: "#0d47a1",
          fontSize: 14,
          fontWeight: "bold",
          textAnchor: "middle",
          refX: 0.5,
          refY: 40,
        },
      },
      size: {
        width: 200,
        height: 60,
      },
      ports: {
        groups: {
          in: {
            position: "left",
            attrs: {
              circle: {
                r: 5,
                fill: "#43a047",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
          out: {
            position: "right",
            attrs: {
              circle: {
                r: 5,
                fill: "#ef6c00",
                stroke: "#fff",
                strokeWidth: 1.5,
              },
            },
          },
        },
      },
      portQuery: "components",
    },
  },
  ExtendsClause: {
    role: "edge",
    edge: {
      shape: "edge",
      attrs: {
        line: {
          stroke: "#7b1fa2",
          strokeWidth: 1.5,
          strokeDasharray: "6 3",
          targetMarker: {
            name: "block",
            size: 10,
          },
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "??extends??",
              fill: "#7b1fa2",
              fontSize: 11,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
  ComponentDeclaration: {
    role: "port-owner",
    node: {
      shape: "rect",
      markup: [
        {
          tagName: "rect",
          selector: "body",
        },
        {
          tagName: "text",
          selector: "label",
        },
      ],
      attrs: {
        body: {
          fill: "#e8f5e9",
          stroke: "#43a047",
          strokeWidth: 1.5,
          rx: 2,
          ry: 2,
        },
        label: {
          text: "{{name}}",
          fill: "#1b5e20",
          fontSize: 11,
          textAnchor: "middle",
          refX: 0.5,
          refY: 0.5,
        },
      },
      size: {
        width: 120,
        height: 30,
      },
    },
  },
  ConnectEquation: {
    role: "edge",
    edge: {
      shape: "edge",
      source: "componentReference1",
      target: "componentReference2",
      attrs: {
        line: {
          stroke: "#c62828",
          strokeWidth: 2,
          targetMarker: "classic",
        },
      },
      labels: [
        {
          attrs: {
            text: {
              text: "connect",
              fill: "#c62828",
              fontSize: 10,
            },
            rect: {
              fill: "#fff",
              stroke: "none",
              rx: 3,
              ry: 3,
            },
          },
          position: {
            distance: 0.5,
            offset: 0,
          },
        },
      ],
      router: "manhattan",
      connector: "rounded",
    },
  },
};

export const diffConfig: Record<string, DiffConfig> = {
  ComponentDeclaration: {
    ignore: ["annotationClause", "description"],
    minor: ["visibility"],
    breaking: ["typeSpecifier", "causality", "isParameter"],
  },
};
