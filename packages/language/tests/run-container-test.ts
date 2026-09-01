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

async function run() {
  console.log("Running Container & Archive Toolkit Verification...");

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
  if (!(zipBytes instanceof Uint8Array) || zipBytes.length === 0) throw new Error("ZIP creation failed");

  const entries = readZipEntries(zipBytes);
  if (entries.length !== 3) throw new Error(`Expected 3 entries, got ${entries.length}`);

  const ssdText = readZipTextEntry(zipBytes, "SystemStructure.ssd");
  if (!ssdText?.includes('name="TestSystem"')) throw new Error("SSD text read failed");

  const bin = readZipEntry(zipBytes, "binaries/dummy.bin");
  if (!bin || bin.length !== 5 || bin[0] !== 1) throw new Error("Binary entry read failed");

  console.log("✓ In-memory ZIP creation, entry scanning, and inflation verified");

  // XML primitives
  const xml = `<ssd:SystemStructureDescription name="RobotArm" version="1.0" description="A 3-DOF Arm">
  <ssd:System name="Subsystem">
    <ssd:Connector name="in1" kind="input" />
    <ssd:Connector name="out1" kind="output" />
  </ssd:System>
</ssd:SystemStructureDescription>`;

  if (extractXmlAttr(xml, "ssd:SystemStructureDescription", "name") !== "RobotArm")
    throw new Error("XML attr extraction failed");
  if (extractXmlTags(xml, "ssd:Connector").length !== 2) throw new Error("XML tag extraction failed");
  const parsed = parseXmlSimple(xml);
  if (parsed["name"] !== "RobotArm") throw new Error("XML simple parse failed");

  console.log("✓ Zero-DOM XML extraction verified");

  // Glob matching
  if (!matchPath("resources/model.fmu", "resources/**/*.fmu")) throw new Error("Glob matching failed");
  if (!matchPath("binaries/win64/test.dll", "binaries/**")) throw new Error("Glob matching failed");
  if (matchPath("doc/manual.pdf", "**/*.mo")) throw new Error("Glob negative matching failed");

  console.log("✓ Path glob pattern matching verified");

  // Extractor lambda
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
  if (!result || result.manifest?.path !== "SystemStructure.ssd" || result.metadata?.customFlag !== true) {
    throw new Error("extractContainerArchive failed");
  }

  console.log("✓ extractContainerArchive with custom lambda verified");
  console.log("ALL CONTAINER TESTS PASSED! ✨");
}

run().catch((e) => {
  console.error("Test failed:", e);
  process.exit(1);
});
