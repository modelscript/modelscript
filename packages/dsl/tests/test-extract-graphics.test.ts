import assert from "node:assert";
import { describe, it } from "node:test";
import { def, extractGraphicsConfig, seq } from "../src/index.js";

describe("DSL Graphics Hook Extractor", () => {
  it("should extract graphics config from def rules", () => {
    const fakeLanguage = {
      rules: {
        BlockDef: ($: any) =>
          def({
            syntax: seq("block", "def"),
            graphics: () => ({
              role: "node",
              node: {
                shape: "rect",
                attrs: { body: { fill: "#e8f5e9", stroke: "#4caf50" } },
              },
            }),
          }),
        ConnectUsage: ($: any) =>
          def({
            syntax: seq("connect"),
            graphics: () => ({
              role: "edge",
              edge: {
                attrs: { line: { stroke: "#2196f3" } },
              },
            }),
          }),
        PlainRule: ($: any) => seq("plain"),
      },
    };

    const configs = extractGraphicsConfig(fakeLanguage);
    assert(configs, "configs should be defined");
    assert(configs["BlockDef"], "BlockDef should be defined");
    assert.strictEqual(configs["BlockDef"].role, "node");
    assert.strictEqual(configs["BlockDef"].node.attrs.body.fill, "#e8f5e9");
    assert(configs["ConnectUsage"], "ConnectUsage should be defined");
    assert.strictEqual(configs["ConnectUsage"].role, "edge");
    assert.strictEqual(configs["PlainRule"], undefined);
  });

  it("should extract top-level visual config if present", () => {
    const fakeLangWithVisual = {
      visual: {
        entities: {
          CustomPart: { role: "node", node: { shape: "rect" } },
        },
        connections: {
          CustomLink: { role: "edge", edge: { shape: "edge" } },
        },
      },
      rules: {},
    };

    const configs = extractGraphicsConfig(fakeLangWithVisual);
    assert(configs["CustomPart"], "CustomPart should be defined");
    assert(configs["CustomLink"], "CustomLink should be defined");
  });
});
