import type { DiffConfig, GraphicsConfig, I18nConfig, IndexerHook, RefHook } from "@modelscript/compiler";

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
      endIdentifier: "classSpecifier.endIdentifier",
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
    metadataFieldPaths: {
      modification: "declaration.modification",
      description: "description",
      conditionAttribute: "conditionAttribute.condition",
      typeSpecifier: "parent.typeSpecifier",
      causality: "parent.causality",
      variability: "parent.variability",
    },
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
  {
    ruleName: "FunctionCall",
    kind: "Unknown",
    namePath: "name",
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

export const i18nConfig: Record<string, I18nConfig> = {
  ClassDefinition: {
    scope: (self) => {
      const spec = self.childForFieldName("classSpecifier");
      return spec?.childForFieldName("identifier")?.text ?? null;
    },
    extract: (db, self) => {
      const results = [];
      const spec = self.childForFieldName("classSpecifier");
      const nameNode = spec?.childForFieldName("identifier");
      if (nameNode?.text) {
        results.push({ msgid: nameNode.text });
      }
      const descNode = spec?.childForFieldName("description");
      if (descNode) {
        const parts = [];
        for (const child of descNode.children) {
          if (child.text && child.text !== "+") {
            parts.push(child.text);
          }
        }
        const desc = parts.map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)).join(" ");
        if (desc) {
          results.push({ msgid: desc });
        }
      }
      const ann = self.childForFieldName("annotationClause");
      if (ann) {
        const classMod = ann.childForFieldName("classModification");
        if (classMod) {
          for (const arg of classMod.children) {
            if (arg.type === "ElementModification") {
              const argName = arg.childForFieldName("name")?.text;
              if (argName === "Documentation") {
                const mod = arg.childForFieldName("modification")?.childForFieldName("classModification");
                if (mod) {
                  for (const docArg of mod.children) {
                    if (docArg.type === "ElementModification") {
                      const docArgName = docArg.childForFieldName("name")?.text;
                      if (docArgName === "info" || docArgName === "revisions") {
                        const val = docArg
                          .childForFieldName("modification")
                          ?.childForFieldName("modificationExpression")
                          ?.childForFieldName("expression");
                        if (val && val.text) {
                          results.push({ msgid: val.text });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      if (spec && spec.type === "ShortClassSpecifier") {
        const enumNode = spec.childForFieldName("enumeration");
        if (enumNode) {
          for (const child of spec.children) {
            if (child.type === "EnumerationLiteral") {
              const litName = child.childForFieldName("identifier")?.text;
              if (litName) {
                results.push({ msgid: litName });
              }
              const litDesc = child.childForFieldName("description");
              if (litDesc) {
                const parts = [];
                for (const sChild of litDesc.children) {
                  if (sChild.text && sChild.text !== "+") {
                    parts.push(sChild.text);
                  }
                }
                const desc = parts.map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)).join(" ");
                if (desc) {
                  results.push({ msgid: desc });
                }
              }
            }
          }
        }
      }
      return results;
    },
  },
  ComponentDeclaration: {
    extract: (db, self) => {
      const results = [];
      const decl = self.childForFieldName("declaration");
      const nameNode = decl?.childForFieldName("identifier");
      if (nameNode?.text) {
        results.push({ msgid: nameNode.text });
      }
      const descNode = self.childForFieldName("description");
      if (descNode) {
        const parts = [];
        for (const child of descNode.children) {
          if (child.text && child.text !== "+") {
            parts.push(child.text);
          }
        }
        const desc = parts.map((s) => (s.startsWith('"') && s.endsWith('"') ? s.slice(1, -1) : s)).join(" ");
        if (desc) {
          results.push({ msgid: desc });
        }
      }
      const ann = self.childForFieldName("annotationClause");
      if (ann) {
        const classMod = ann.childForFieldName("classModification");
        if (classMod) {
          for (const arg of classMod.children) {
            if (arg.type === "ElementModification") {
              const argName = arg.childForFieldName("name")?.text;
              if (argName === "Dialog") {
                const mod = arg.childForFieldName("modification")?.childForFieldName("classModification");
                if (mod) {
                  for (const dialogArg of mod.children) {
                    if (dialogArg.type === "ElementModification") {
                      const dArgName = dialogArg.childForFieldName("name")?.text;
                      if (dArgName === "tab" || dArgName === "group") {
                        const val = dialogArg
                          .childForFieldName("modification")
                          ?.childForFieldName("modificationExpression")
                          ?.childForFieldName("expression");
                        if (val && val.text) {
                          results.push({ msgid: val.text });
                        }
                      }
                    }
                  }
                }
              }
            }
          }
        }
      }
      return results;
    },
  },
  FunctionCall: {
    extract: (db, self) => {
      const funcRef = self.childForFieldName("functionReference");
      if (funcRef && funcRef.text === "Text") {
        const args = self.childForFieldName("functionCallArguments");
        if (args) {
          for (const child of args.children) {
            if (child.type === "NamedArgument") {
              const name = child.childForFieldName("identifier")?.text;
              if (name === "textString") {
                const val = child.childForFieldName("argument")?.childForFieldName("expression");
                if (val && val.text) {
                  return { msgid: val.text };
                }
              }
            } else if (child.type === "NamedArguments") {
              for (const sub of child.children) {
                if (sub.type === "NamedArgument") {
                  const name = sub.childForFieldName("identifier")?.text;
                  if (name === "textString") {
                    const val = sub.childForFieldName("argument")?.childForFieldName("expression");
                    if (val && val.text) {
                      return { msgid: val.text };
                    }
                  }
                }
              }
            }
          }
        }
      }
      return null;
    },
  },
};
