import { createWasmParser } from "@modelscript/language";
import assert from "node:assert";
import nodeFs from "node:fs";
import path from "node:path";
import { describe, it } from "node:test";
import { fileURLToPath } from "node:url";
import { Context } from "../context.js";
import { extractCSGTopology } from "../src/csg.js";
import { NodeFileSystem } from "./node-filesystem.js";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const modelicaWasm = path.resolve(__dirname, "../dist/parser.wasm");
const { parser } = await createWasmParser(modelicaWasm);
Context.registerParser(".mo", parser as any);

describe("CSG Topology Extraction", () => {
  it("should extract stock and milling operations with parameter modifications", async () => {
    const fs = new NodeFileSystem();
    const context = new Context(fs);

    const tempFile = path.join(__dirname, "Machining.mo");
    nodeFs.writeFileSync(
      tempFile,
      `
      package Machining
        model Stock
          parameter Real width = 100;
          parameter Real length = 150;
          parameter Real height = 50;
        end Stock;

        model MillingOperation
          parameter Real tool_diameter = 10;
          parameter Real depth_of_cut = 5;
        end MillingOperation;

        model MachinedPart
          Stock stock(width = 120, length = 200, height = 40);
          MillingOperation cut1(tool_diameter = 12, depth_of_cut = 8);
        end MachinedPart;
      end Machining;
    `,
    );

    try {
      await context.addLibrary(tempFile);
      const graph = extractCSGTopology(context, "Machining.MachinedPart");

      assert.ok(graph);
      assert.strictEqual(graph.nodes.length, 2);

      assert.deepStrictEqual(graph.nodes[0], {
        type: "Stock",
        uuid: "stock",
        parameters: {
          width: 120,
          length: 200,
          height: 40,
        },
      });

      assert.deepStrictEqual(graph.nodes[1], {
        type: "MillingOperation",
        uuid: "cut1",
        parameters: {
          tool_diameter: 12,
          depth_of_cut: 8,
        },
      });
    } finally {
      nodeFs.rmSync(tempFile, { force: true });
    }
  });
});
