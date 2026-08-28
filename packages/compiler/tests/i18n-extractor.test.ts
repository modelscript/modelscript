import { i18nConfig } from "@modelscript/modelica/indexer_config";
import { describe, expect, it } from "vitest";
import { I18nExtractor, type TSNode } from "../src/i18n-extractor.js";

function makeNode(type: string, text: string, fields: Record<string, TSNode> = {}, children: TSNode[] = []): TSNode {
  return {
    type,
    text,
    startPosition: { row: 0, column: 0 },
    endPosition: { row: 0, column: text.length },
    children,
    childForFieldName(name: string) {
      return fields[name] ?? null;
    },
  };
}

describe("I18nExtractor", () => {
  it("extracts all translatable strings from Modelica AST using language schema", () => {
    const idNode = makeNode("identifier", "MyModel");
    const descPartNode = makeNode("string_literal", '"Model description"');
    const descNode = makeNode("description", '"Model description"', {}, [descPartNode]);
    const specNode = makeNode("ClassSpecifier", "MyModel", {
      identifier: idNode,
      description: descNode,
    });
    const classNode = makeNode("ClassDefinition", "model MyModel ... end MyModel;", {
      classSpecifier: specNode,
    });

    const root = makeNode("StoredDefinition", "", {}, [classNode]);

    const extractor = new I18nExtractor(i18nConfig);
    extractor.extract(root, "test.mo");

    const entries = Array.from(extractor.getEntries().values());

    // 1. Class MyModel name
    expect(entries.some((e) => e.msgid === "MyModel" && e.msgctxt === "MyModel")).toBe(true);

    // 2. Class MyModel description
    expect(entries.some((e) => e.msgid === "Model description" && e.msgctxt === "MyModel")).toBe(true);

    // Generate POT and check formatting
    const pot = extractor.generatePot();
    expect(pot).toContain('msgctxt "MyModel"');
    expect(pot).toContain('msgid "MyModel"');
    expect(pot).toContain('msgid "Model description"');
  });
});
