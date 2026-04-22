/* eslint-disable */
import { describe, expect, it } from "vitest";
import { extractClassSpecs, generateAstClasses } from "../src/generate-ast-classes.js";
import type { QueryDB, SpecializationArgs, SymbolEntry } from "../src/runtime.js";
import type { SemanticVisitor } from "../src/semantic-node.js";
import { GenericNode, SemanticNode } from "../src/semantic-node.js";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function makeEntry(
  id: number,
  kind: string,
  name: string,
  opts: {
    parentId?: number | null;
    metadata?: Record<string, unknown>;
  } = {},
): SymbolEntry {
  return {
    id,
    kind,
    name,
    ruleName: kind.toLowerCase() + "_def",
    namePath: "name",
    startByte: id * 100,
    endByte: id * 100 + 50,
    parentId: opts.parentId ?? null,
    exports: [],
    inherits: [],
    metadata: opts.metadata ?? {},
    fieldName: null,
  };
}

function makeDb(entries: SymbolEntry[]): QueryDB {
  const byId = new Map(entries.map((e) => [e.id, e]));
  const db: QueryDB = {
    symbol(id: number) {
      return byId.get(id) ?? undefined;
    },
    childrenOf(id) {
      return entries.filter((e) => e.parentId === id);
    },
    childrenOfField: (id: number, fieldName: string) => {
      const children = db.childrenOf(id);
      return children.filter((c) => c.fieldName === fieldName);
    },
    exportsOf: (id: number) => db.childrenOf(id),
    parentOf: (id: number) => {
      const s = db.symbol(id);
      if (!s || s.parentId === null) return undefined;
      return db.symbol(s.parentId);
    },
    allEntries: () => {
      const entries: SymbolEntry[] = [];
      for (let i = 1; i <= 3; i++) {
        const s = db.symbol(i);
        if (s) entries.push(s);
      }
      return entries;
    },
    query<T>(_name: string, _id: number): T {
      return [] as unknown as T;
    },
    byName(name) {
      return entries.filter((e) => e.name === name);
    },
    queryWith<T>() {
      return [] as unknown as T;
    },
    specialize(_baseId, args) {
      return -args.hash.length; // synthetic virtual ID
    },
    argsOf() {
      return null;
    },
    baseOf() {
      return null;
    },
    evaluate() {
      return null;
    },
    cstText() {
      return null;
    },
    cstNode() {
      return null;
    },
  };
  return db;
}

// ---------------------------------------------------------------------------
// Concrete subclass for testing (simulates what the generator produces)
// ---------------------------------------------------------------------------

class TestClassNode extends SemanticNode {
  get kind(): string {
    return "Class";
  }
  get variability(): string | null {
    return this.attribute("variability") as string | null;
  }

  get name(): string {
    return this.entry.name;
  }

  accept<R, A>(visitor: SemanticVisitor<R, A>, arg?: A): R {
    return visitor.visitNode(this, arg);
  }
}

// ---------------------------------------------------------------------------
// Tests: SemanticNode base class
// ---------------------------------------------------------------------------

describe("SemanticNode", () => {
  const entries = [
    makeEntry(1, "Package", "Electrical", {
      metadata: { classKind: "package" },
    }),
    makeEntry(2, "Class", "Analog", {
      parentId: 1,
      metadata: { classKind: "model" },
    }),
    makeEntry(3, "Component", "R", {
      parentId: 2,
      metadata: { variability: "parameter" },
    }),
  ];
  const db = makeDb(entries);

  it("exposes basic identity properties", () => {
    const node = new TestClassNode(entries[1]!, db);
    expect(node.id).toBe(2);
    expect(node.name).toBe("Analog");
    expect(node.kind).toBe("Class");
    expect(node.ruleName).toBe("class_def");
    expect(node.startByte).toBe(200);
    expect(node.endByte).toBe(250);
  });

  it("attribute() reads attributes", () => {
    const node = new TestClassNode(entries[1]!, db);
    expect(node.attribute("classKind")).toBe("model");
    expect(node.attribute("nonexistent")).toBeNull();
  });

  it("parentEntry navigates up", () => {
    const node = new TestClassNode(entries[1]!, db);
    expect(node.parentEntry?.name).toBe("Electrical");

    const root = new TestClassNode(entries[0]!, db);
    expect(root.parentEntry).toBeNull();
  });

  it("childEntries navigates down", () => {
    const node = new TestClassNode(entries[1]!, db);
    const children = node.childEntries;
    expect(children.length).toBe(1);
    expect(children[0].name).toBe("R");
  });

  it("compositeName walks the full parent chain", () => {
    const leaf = new TestClassNode(entries[2]!, db);
    expect(leaf.compositeName).toBe("Electrical.Analog.R");

    const root = new TestClassNode(entries[0]!, db);
    expect(root.compositeName).toBe("Electrical");
  });

  it("toJSON serializes correctly", () => {
    const node = new TestClassNode(entries[1]!, db);
    const json = node.toJSON();
    expect(json["@type"]).toBe("Class");
    expect(json.name).toBe("Analog");
    expect(json.id).toBe(2);
    expect((json.metadata as Record<string, unknown>).classKind).toBe("model");
  });

  it("hash includes kind + name + metadata", () => {
    const node = new TestClassNode(entries[1]!, db);
    const h = node.hash;
    expect(h).toContain("Class");
    expect(h).toContain("Analog");
    expect(h).toContain("model");
  });

  it("specialize delegates to db.specialize", () => {
    const node = new TestClassNode(entries[1]!, db);
    const args: SpecializationArgs<string> = { data: "R=100", hash: "abc" };
    const vid = node.specialize(args);
    expect(vid).toBe(-3); // -(hash.length)
  });

  it("GenericNode works as fallback", () => {
    const node = new GenericNode(entries[2]!, db);
    expect(node.kind).toBe("Component");
    expect(node.name).toBe("R");
  });
});

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
    expect(output).toContain("import type { QueryDB, SymbolEntry, SpecializationArgs }");
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
    expect(output).toContain('this.query<SymbolEntry[]>("members")');
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
