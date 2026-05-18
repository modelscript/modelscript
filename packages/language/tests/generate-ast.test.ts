/* eslint-disable */
import { describe, expect, it } from "vitest";
import { extractClassSpecs, generateAstClasses } from "../src/generate-ast-classes.js";

// ---------------------------------------------------------------------------
// Tests: Generator — extractClassSpecs
// ---------------------------------------------------------------------------

describe("extractClassSpecs", () => {
  // Minimal language config with ast
  const $ = new Proxy({} as Record<string, any>, {
    get(_, prop) {
      return { type: "sym", name: String(prop) };
    },
  });

  const langConfig = {
    name: "test",
    rules: {
      class_definition: ($: any) => ({
        type: "def",
        rule: {
          type: "seq",
          args: [
            "class",
            { type: "field", name: "name", arg: $.name },
            {
              type: "field",
              name: "body",
              arg: {
                type: "rep",
                arg: {
                  type: "choice",
                  args: [$.class_definition, $.component],
                },
              },
            },
          ],
        },
        options: {
          symbol: () => ({
            kind: "Class",
            metadata: { classKind: {} } as any,
          }),
          queries: {
            members: () => [],
            nestedClasses: () => [],
          },
          model: {
            name: "ClassDefinition",
            specializable: true,
            visitable: true,
            fieldTypes: { body: "SemanticNode" },
            properties: { variability: "string | null" },
            queries: {
              members: "SemanticNode[]",
              nestedClasses: "ClassDefinition[]",
            },
          },
        },
      }),
      component: ($: any) => ({
        type: "def",
        rule: {
          type: "seq",
          args: [{ type: "field", name: "name", arg: $.name }],
        },
        options: {
          symbol: () => ({ kind: "Component" }),
          model: {
            visitable: true,
            mutableProps: {
              causality: "string | null",
              isFinal: "boolean",
            },
          },
        },
      }),
      // Rule without ast — should be skipped
      name: () => ({ type: "seq", args: [] }),
    },
  };

  it("extracts specs only for rules with ast", () => {
    const specs = extractClassSpecs(langConfig, $);
    expect(specs.length).toBe(2);
    expect(specs[0].className).toBe("ClassDefinition");
    expect(specs[1].className).toBe("Component"); // auto PascalCase
  });

  it("extracts fields from rule AST", () => {
    const specs = extractClassSpecs(langConfig, $);
    const classSpec = specs[0];
    expect(classSpec.fields.length).toBe(2);
    expect(classSpec.fields[0].name).toBe("name");
    expect(classSpec.fields[1].name).toBe("body");
    expect(classSpec.fields[1].isList).toBe(true);
  });

  it("extracts query names", () => {
    const specs = extractClassSpecs(langConfig, $);
    expect(specs[0].queryNames).toContain("members");
    expect(specs[0].queryNames).toContain("nestedClasses");
  });

  it("extracts ast config", () => {
    const specs = extractClassSpecs(langConfig, $);
    expect(specs[0].model.specializable).toBe(true);
    expect(specs[0].model.properties?.variability).toBe("string | null");
  });
});

// ---------------------------------------------------------------------------
// Tests: Generator — generateAstClasses output
// ---------------------------------------------------------------------------

describe("generateAstClasses", () => {
  const $ = new Proxy({} as Record<string, any>, {
    get(_, prop) {
      return { type: "sym", name: String(prop) };
    },
  });

  const langConfig = {
    name: "modelica",
    rules: {
      class_definition: ($: any) => ({
        type: "def",
        rule: {
          type: "seq",
          args: [
            "class",
            { type: "field", name: "name", arg: $.name },
            {
              type: "field",
              name: "body",
              arg: { type: "rep", arg: $.class_definition },
            },
          ],
        },
        options: {
          symbol: () => ({ kind: "Class" }),
          queries: { members: () => [], nestedClasses: () => [] },
          model: {
            name: "ClassDefinition",
            specializable: true,
            queries: {
              members: "SemanticNode[]",
            },
          },
        },
      }),
      component: ($: any) => ({
        type: "def",
        rule: {
          type: "seq",
          args: [{ type: "field", name: "name", arg: $.name }],
        },
        options: {
          symbol: () => ({ kind: "Component" }),
          model: { visitable: true },
        },
      }),
    },
  };

  const specs = extractClassSpecs(langConfig, $);
  const output = generateAstClasses(specs, "modelica");

  it("generates import header", () => {
    expect(output).toContain("import type { QueryDB, SymbolEntry, SymbolId, SpecializationArgs }");
    expect(output).toContain("import { SemanticNode, GenericNode }");
  });

  it("generates ClassDefinition class", () => {
    expect(output).toContain("export class ClassDefinition extends SemanticNode");
    expect(output).toContain('readonly kind = "Class";');
  });

  it("generates Component class", () => {
    expect(output).toContain("export class Component extends SemanticNode");
    expect(output).toContain('readonly kind = "Component";');
  });

  it("generates clone method for specializable classes", () => {
    expect(output).toContain("clone<T>(args: SpecializationArgs<T>): ClassDefinition");
  });

  it("generates computed property with wrapWith", () => {
    expect(output).toContain("get members(): SemanticNode[]");
    expect(output).toContain('this.query<SymbolEntry[]>(\"members\")');
    expect(output).toContain("wrapEntry(e, this.db)");
  });

  it("generates remaining queries as SemanticNode[] getters", () => {
    // nestedClasses is not in computed, so it should be auto-generated
    expect(output).toContain("get nestedClasses(): SemanticNode[]");
  });

  it("generates visitor accept methods", () => {
    expect(output).toContain("visitor.visitClassDefinition(this, arg)");
    expect(output).toContain("visitor.visitComponent(this, arg)");
  });

  it("generates visitor interface", () => {
    expect(output).toContain("export interface ModelicaVisitor<R, A = void>");
    expect(output).toContain("visitClassDefinition(node: ClassDefinition, arg?: A): R;");
    expect(output).toContain("visitComponent(node: Component, arg?: A): R;");
  });

  it("generates wrapEntry factory", () => {
    expect(output).toContain("export function wrapEntry(");
    expect(output).toContain('case "Class": return new ClassDefinition(entry, db);');
    expect(output).toContain('case "Component": return new Component(entry, db);');
    expect(output).toContain("default: return new GenericNode(entry, db);");
  });

  it("generates body as list field", () => {
    expect(output).toContain("get body():");
    expect(output).toContain('this.db.childrenOfField(this.id, "body")');
  });
});
