import { describe, expect, it } from "vitest";
import { extractIndexerHooks, serializeIndexerConfig } from "../src/generators/indexer.js";

describe("generate/indexer", () => {
  it("extracts indexer hooks correctly", () => {
    // Mock language config
    const mock$ = {};
    const mockConfig = {
      name: "MockLang",
      rules: {
        TestDef: () => ({
          type: "def",
          options: {
            symbol: (self: Record<string, string | boolean>) => ({
              kind: "Class",
              name: self.name,
              exports: [self.innerVar],
              inherits: [self.baseClass],
              attributes: { isAbstract: self.isAbstract },
            }),
          },
        }),
        TestRef: () => ({
          type: "ref",
          options: {
            name: (self: Record<string, string>) => self.TargetClass,
          },
        }),
      },
    };

    const hooks = extractIndexerHooks(mockConfig, mock$);

    expect(hooks).toHaveLength(2);

    expect(hooks[0]).toEqual({
      ruleName: "TestDef",
      kind: "Class",
      namePath: "name", // mocked scope path extraction
      exportPaths: ["innerVar"], // mocked extractScopePath simply returns 'name' in our mock setup unless we fully mock it, but extractScopePath works on AST objects.
      inheritPaths: ["baseClass"],
      metadataFieldPaths: { isAbstract: "isAbstract" },
    });

    expect(hooks[1]).toEqual({
      ruleName: "TestRef",
      kind: "Reference",
      namePath: "TargetClass",
      exportPaths: [],
      inheritPaths: [],
      metadataFieldPaths: {},
    });
  });

  it("serializes indexer config correctly", () => {
    const hooks = [
      {
        ruleName: "MyRule",
        kind: "Function",
        namePath: "id",
        exportPaths: ["body"],
        inheritPaths: [],
        metadataFieldPaths: {},
      },
    ];

    const result = serializeIndexerConfig(hooks as unknown[]);
    expect(result).toContain('import type { IndexerHook } from "@modelscript/compiler";');
    expect(result).toContain('ruleName: "MyRule"');
    expect(result).toContain('kind: "Function"');
    expect(result).toContain('namePath: "id"');
  });
});
