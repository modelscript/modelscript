import {
  createZipArchive,
  defaultContainerToolkit,
  extractContainerArchive,
  extractXmlAttr,
  extractXmlTags,
  matchPath,
  parseXmlSimple,
  readZipEntries,
  readZipEntry,
  readZipTextEntry,
} from "../src/runtime/wasm_container.js";

describe("Container & Archive Toolkit", () => {
  describe("ZIP Archive Operations", () => {
    it("creates, inspects, and extracts in-memory ZIP archives", () => {
      const files = {
        "SystemStructure.ssd": `<ssd:SystemStructureDescription name="TestSystem" version="1.0">
  <ssd:System name="TestSystem">
    <ssd:Connectors>
      <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
      <ssd:Connector name="y" kind="output"><ssc:Real /></ssd:Connector>
    </ssd:Connectors>
  </ssd:System>
</ssd:SystemStructureDescription>`,
        "resources/config.ssv": `<ssv:ParameterSet name="params"><ssv:Parameter name="k"><ssv:Real value="42.0" /></ssv:Parameter></ssv:ParameterSet>`,
        "binaries/dummy.bin": new Uint8Array([1, 2, 3, 4, 5]),
      };

      const zipBytes = createZipArchive(files);
      expect(zipBytes).toBeInstanceOf(Uint8Array);
      expect(zipBytes.length).toBeGreaterThan(0);

      // Read entries
      const entries = readZipEntries(zipBytes);
      expect(entries.length).toBe(3);
      const names = entries.map((e) => e.name);
      expect(names).toContain("SystemStructure.ssd");
      expect(names).toContain("resources/config.ssv");
      expect(names).toContain("binaries/dummy.bin");

      // Read text entry
      const ssdText = readZipTextEntry(zipBytes, "SystemStructure.ssd");
      expect(ssdText).toContain('name="TestSystem"');

      // Read binary entry
      const bin = readZipEntry(zipBytes, "binaries/dummy.bin");
      expect(bin).toEqual(new Uint8Array([1, 2, 3, 4, 5]));

      // Read non-existent entry
      expect(readZipEntry(zipBytes, "nonexistent.txt")).toBeNull();
    });
  });

  describe("XML Extraction Primitives", () => {
    const xml = `<ssd:SystemStructureDescription name="RobotArm" version="1.0" description="A 3-DOF Arm">
  <ssd:System name="Subsystem">
    <ssd:Connector name="in1" kind="input" />
    <ssd:Connector name="out1" kind="output" />
  </ssd:System>
</ssd:SystemStructureDescription>`;

    it("extracts attributes accurately without DOM parser", () => {
      expect(extractXmlAttr(xml, "ssd:SystemStructureDescription", "name")).toBe("RobotArm");
      expect(extractXmlAttr(xml, "ssd:SystemStructureDescription", "version")).toBe("1.0");
      expect(extractXmlAttr(xml, "ssd:SystemStructureDescription", "description")).toBe("A 3-DOF Arm");
      expect(extractXmlAttr(xml, "ssd:System", "name")).toBe("Subsystem");
      expect(extractXmlAttr(xml, "ssd:NonExistent", "name")).toBeNull();
    });

    it("extracts tags and bodies", () => {
      const tags = extractXmlTags(xml, "ssd:Connector");
      expect(tags.length).toBe(2);
      expect(tags[0].attrs).toContain('name="in1"');
      expect(tags[1].attrs).toContain('name="out1"');
    });

    it("parses root XML tag to key-value structure", () => {
      const parsed = parseXmlSimple(xml);
      expect(parsed["@tag"]).toBe("ssd:SystemStructureDescription");
      expect(parsed["name"]).toBe("RobotArm");
      expect(parsed["version"]).toBe("1.0");
    });
  });

  describe("Path & Glob Matching", () => {
    it("matches wildcards and exact paths", () => {
      expect(matchPath("resources/model.fmu", "resources/**/*.fmu")).toBe(true);
      expect(matchPath("resources/sub/deep/model.fmu", "resources/**/*.fmu")).toBe(true);
      expect(matchPath("binaries/win64/test.dll", "binaries/**")).toBe(true);
      expect(matchPath("package.mo", "**/*.mo")).toBe(true);
      expect(matchPath("doc/manual.pdf", "**/*.mo")).toBe(false);
      expect(matchPath("SystemStructure.ssd", /SystemStructure\.ssd$/)).toBe(true);
    });
  });

  describe("extractContainerArchive with Custom Extractor", () => {
    it("processes container with custom extraction lambda", async () => {
      const zipBytes = createZipArchive({
        "SystemStructure.ssd": `<ssd:SystemStructureDescription name="Demo"><ssd:System name="Demo"/></ssd:SystemStructureDescription>`,
        "resources/motor.fmu": new Uint8Array([10, 20, 30]),
      });

      const declaration = {
        extensions: [".ssp"],
        extract: (data: Uint8Array, toolkit: typeof defaultContainerToolkit) => {
          const ssd = toolkit.zip.readText(data, "SystemStructure.ssd");
          if (!ssd) return null;
          return {
            manifest: { path: "SystemStructure.ssd", content: ssd, language: "ssp" },
            entries: toolkit.zip.entries(data).map((e) => ({
              path: e.name,
              read: () => toolkit.zip.read(data, e.name),
              action: e.name.endsWith(".fmu") ? ("extract_nested" as const) : ("mount_vfs" as const),
            })),
            metadata: { customFlag: true },
          };
        },
      };

      const result = await extractContainerArchive(zipBytes, declaration);
      expect(result).not.toBeNull();
      expect(result?.manifest?.path).toBe("SystemStructure.ssd");
      expect(result?.manifest?.content).toContain("Demo");
      expect(result?.entries?.length).toBe(2);
      expect(result?.metadata?.customFlag).toBe(true);
    });
  });
});
