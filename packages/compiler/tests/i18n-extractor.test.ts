import { i18nConfig } from "@modelscript/modelica/indexer_config";
import Modelica from "@modelscript/modelica/parser";
import Parser from "tree-sitter";
import { describe, expect, it } from "vitest";
import { I18nExtractor, type TSNode } from "../src/i18n-extractor.js";

describe("I18nExtractor", () => {
  it("extracts all translatable strings from Modelica source using language.ts schema", () => {
    const parser = new Parser();
    parser.setLanguage(Modelica);

    const source = `
model MyModel "Model description"
  parameter Real x "x parameter" annotation(Dialog(tab="General", group="Parameters"));
  annotation(
    Icon(graphics={Text(textString="Icon text")})
  );
end MyModel;

type MyEnum = enumeration(
  Literal1 "First literal",
  Literal2 "Second literal"
);
`;

    const tree = parser.parse(source);
    const extractor = new I18nExtractor(i18nConfig);
    extractor.extract(tree.rootNode as unknown as TSNode, "test.mo");

    const entries = Array.from(extractor.getEntries().values());

    // 1. Class MyModel name
    expect(entries.some((e) => e.msgid === "MyModel" && e.msgctxt === "MyModel")).toBe(true);

    // 2. Class MyModel description
    expect(entries.some((e) => e.msgid === "Model description" && e.msgctxt === "MyModel")).toBe(true);

    // 3. Component x name (under MyModel context)
    expect(entries.some((e) => e.msgid === "x" && e.msgctxt === "MyModel")).toBe(true);

    // 4. Component x description (under MyModel context)
    expect(entries.some((e) => e.msgid === "x parameter" && e.msgctxt === "MyModel")).toBe(true);

    // 5. Component x Dialog tab and group (under MyModel context)
    expect(entries.some((e) => e.msgid === "General" && e.msgctxt === "MyModel")).toBe(true);
    expect(entries.some((e) => e.msgid === "Parameters" && e.msgctxt === "MyModel")).toBe(true);

    // 6. Graphics Text function call textString (under MyModel context)
    expect(entries.some((e) => e.msgid === "Icon text" && e.msgctxt === "MyModel")).toBe(true);

    // 7. Enumeration Literals and descriptions (under MyEnum context)
    expect(entries.some((e) => e.msgid === "MyEnum" && e.msgctxt === "MyEnum")).toBe(true);
    expect(entries.some((e) => e.msgid === "Literal1" && e.msgctxt === "MyEnum")).toBe(true);
    expect(entries.some((e) => e.msgid === "First literal" && e.msgctxt === "MyEnum")).toBe(true);
    expect(entries.some((e) => e.msgid === "Literal2" && e.msgctxt === "MyEnum")).toBe(true);
    expect(entries.some((e) => e.msgid === "Second literal" && e.msgctxt === "MyEnum")).toBe(true);

    // Generate POT and check formatting
    const pot = extractor.generatePot();
    expect(pot).toContain('msgctxt "MyModel"');
    expect(pot).toContain('msgid "MyModel"');
    expect(pot).toContain('msgid "Model description"');
    expect(pot).toContain('msgid "Icon text"');
  });
});
