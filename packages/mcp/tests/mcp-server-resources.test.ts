// SPDX-License-Identifier: AGPL-3.0-or-later

import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import expect from "expect";
import { describe, test } from "node:test";
import { createModelScriptMcpServer } from "../src/factory.js";
import { NodeFileSystem } from "../src/filesystem.js";
import { registerResources } from "../src/resources.js";
import type { ServerContext } from "../src/types.js";

describe("MCP Server Factory, Filesystem & Resources Unit Tests", () => {
  describe("NodeFileSystem", () => {
    const fs = new NodeFileSystem();

    test("handles path and file metadata operations correctly", () => {
      expect(fs.basename("/foo/bar/baz.mo")).toBe("baz.mo");
      expect(fs.extname("model.msx")).toBe(".msx");
      expect(fs.join("foo", "bar")).toContain("foo");
      expect(fs.resolve(".").length).toBeGreaterThan(0);
      expect(typeof fs.sep).toBe("string");

      const stat = fs.stat("package.json");
      expect(stat).not.toBeNull();
      expect(stat?.isFile()).toBe(true);

      const nonExistent = fs.stat("non-existent-file-12345.xyz");
      expect(nonExistent).toBeNull();

      const text = fs.read("package.json");
      expect(text).toContain("modelscript");

      const binary = fs.readBinary("package.json");
      expect(binary instanceof Uint8Array).toBe(true);
      expect(binary.length).toBeGreaterThan(0);

      const entries = fs.readdir(".");
      expect(entries.length).toBeGreaterThan(0);
      expect(entries.some((e) => e.name === "package.json")).toBe(true);
    });
  });

  describe("createModelScriptMcpServer Factory", () => {
    test("instantiates McpServer with polyglot tools, resources, and custom options", () => {
      const ctx: ServerContext = { current: null };
      const server = createModelScriptMcpServer(ctx, {
        name: "custom-hub",
        version: "2.0.0",
      });

      expect(server).toBeInstanceOf(McpServer);
      expect(ctx.polyglotHost).toBeDefined();
    });
  });

  describe("Modelica Resources (libraries, classes, class-details)", () => {
    test("handles uninitialized context cleanly across all resource endpoints", async () => {
      const server = new McpServer({ name: "test-resources", version: "1.0.0" });
      const ctx: ServerContext = { current: null };
      registerResources(server, ctx);

      // Extract registered resource handlers
      const serverAny = server as any;
      const registered = serverAny._registeredResources;
      expect(registered).toBeDefined();

      // Test libraries resource
      const libResource = registered["modelica://libraries"];
      expect(libResource).toBeDefined();
      const libResult = await libResource.readCallback(new URL("modelica://libraries"));
      expect(libResult.contents[0].text).toContain("No libraries loaded");

      // Test classes resource
      const classesResource = registered["modelica://classes"];
      expect(classesResource).toBeDefined();
      const classesResult = await classesResource.readCallback(new URL("modelica://classes"));
      expect(classesResult.contents[0].text).toContain("No libraries loaded");

      // Test class-details resource template
      const templateResource = registered["modelica://classes/{name}"];
      expect(templateResource).toBeDefined();
      const detailResult = await templateResource.readCallback(new URL("modelica://classes/Foo"));
      expect(detailResult.contents[0].text).toContain("No libraries loaded");
    });

    test("reads libraries, classes, and class details when context is loaded", async () => {
      const server = new McpServer({ name: "test-resources-loaded", version: "1.0.0" });

      // Mock loaded Context
      const mockClassDetails = {
        name: "Modelica.Electrical.Analog.Basic.Resistor",
        classKind: "model",
        description: "Ideal electrical resistor",
        elements: [
          {
            isComponentInstance: true,
            name: "p",
            classInstance: { name: "PositivePin" },
            description: "Positive pin",
          },
          {
            isComponentInstance: true,
            name: "n",
            type: "NegativePin",
            description: "Negative pin",
          },
          {
            isClassInstance: true,
            name: "InternalState",
            classKind: "record",
          },
        ],
      };

      const mockContext = {
        listLibraries: () => [
          {
            name: "Modelica",
            path: "/msl/package.mo",
            elements: [
              {
                isClassInstance: true,
                name: "Modelica.Electrical.Analog.Basic.Resistor",
                classKind: "model",
              },
            ],
          },
        ],
        classes: [
          {
            name: "CustomInlineModel",
            classKind: "block",
          },
        ],
        query: (name: string) => {
          if (name === "Modelica.Electrical.Analog.Basic.Resistor") {
            return mockClassDetails;
          }
          if (name === "NotAClass") {
            return { isClassInstance: false, kind: "Component" };
          }
          return null;
        },
      };

      const ctx: ServerContext = { current: mockContext as any };
      registerResources(server, ctx);

      const serverAny = server as any;
      const registered = serverAny._registeredResources;

      // Test libraries
      const libResult = await registered["modelica://libraries"].readCallback(new URL("modelica://libraries"));
      const parsedLibs = JSON.parse(libResult.contents[0].text);
      expect(parsedLibs.length).toBe(1);
      expect(parsedLibs[0].name).toBe("Modelica");

      // Test classes list
      const classesResult = await registered["modelica://classes"].readCallback(new URL("modelica://classes"));
      const parsedClasses = JSON.parse(classesResult.contents[0].text);
      expect(parsedClasses.length).toBe(2);
      expect(parsedClasses[0].name).toBe("Modelica.Electrical.Analog.Basic.Resistor");
      expect(parsedClasses[1].name).toBe("CustomInlineModel");

      // Test class details template
      const template = registered["modelica://classes/{name}"];

      // 1. Success case
      const detailResult = await template.readCallback(
        new URL("modelica://classes/Modelica.Electrical.Analog.Basic.Resistor"),
      );
      const parsedDetail = JSON.parse(detailResult.contents[0].text);
      expect(parsedDetail.name).toBe("Modelica.Electrical.Analog.Basic.Resistor");
      expect(parsedDetail.kind).toBe("model");
      expect(parsedDetail.description).toBe("Ideal electrical resistor");
      expect(parsedDetail.components.length).toBe(2);
      expect(parsedDetail.components[0].name).toBe("p");
      expect(parsedDetail.components[0].type).toBe("PositivePin");
      expect(parsedDetail.childClasses.length).toBe(1);
      expect(parsedDetail.childClasses[0].name).toBe("InternalState");

      // 2. Not found case
      const notFoundResult = await template.readCallback(new URL("modelica://classes/NonExistent"));
      expect(notFoundResult.contents[0].text).toContain("Class 'NonExistent' not found");

      // 3. Not a class case
      const notClassResult = await template.readCallback(new URL("modelica://classes/NotAClass"));
      expect(notClassResult.contents[0].text).toContain("'NotAClass' is not a class");
    });
  });
});
