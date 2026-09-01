import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/language";
import { sspLanguage } from "../src/language.js";
import { sspToModelicaBlock } from "../src/projection.js";
import { parseSsd, parseSsv } from "../src/ssd-parser.js";

async function main() {
  console.log("Starting @modelscript/ssp and Container Toolkit Verification...");

  const ssdXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="DualDriveController"
                                version="1.0"
                                description="Closed loop dual-drive vehicle control system">
  <ssd:System name="DualDriveController">
    <ssd:Connectors>
      <ssd:Connector name="throttle_in" kind="input">
        <ssc:Real unit="percent" />
      </ssd:Connector>
      <ssd:Connector name="steering_in" kind="input">
        <ssc:Real unit="rad" />
      </ssd:Connector>
      <ssd:Connector name="torque_left_out" kind="output">
        <ssc:Real unit="N.m" />
      </ssd:Connector>
      <ssd:Connector name="torque_right_out" kind="output">
        <ssc:Real unit="N.m" />
      </ssd:Connector>
      <ssd:Connector name="gain" kind="parameter">
        <ssc:Real />
      </ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="MotorLeft" source="resources/Motor.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="tau" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="MotorRight" source="resources/Motor.fmu">
        <ssd:Connectors>
          <ssd:Connector name="u" kind="input"><ssc:Real /></ssd:Connector>
          <ssd:Connector name="tau" kind="output"><ssc:Real /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="MotorLeft" startConnector="tau" endElement="DualDriveController" endConnector="torque_left_out" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

  const ssvXml = `<?xml version="1.0" encoding="UTF-8"?>
<ssv:ParameterSet xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"
                  version="1.0"
                  name="DefaultParams">
  <ssv:Parameters>
    <ssv:Parameter name="maxTorque">
      <ssv:Real value="350.0" />
    </ssv:Parameter>
    <ssv:Parameter name="enableRegen">
      <ssv:Boolean value="true" />
    </ssv:Parameter>
    <ssv:Parameter name="gearCount">
      <ssv:Integer value="2" />
    </ssv:Parameter>
  </ssv:Parameters>
</ssv:ParameterSet>`;

  // 1. Test SSD / SSV Parsing
  const system = parseSsd(ssdXml);
  if (system.name !== "DualDriveController") throw new Error(`Unexpected system name: ${system.name}`);
  if (system.connectors?.length !== 5) throw new Error(`Unexpected connector count: ${system.connectors?.length}`);
  if (system.components.length !== 2) throw new Error(`Unexpected component count: ${system.components.length}`);

  const ssvParams = parseSsv(ssvXml);
  if (ssvParams.length !== 3) throw new Error(`Unexpected ssv param count: ${ssvParams.length}`);
  const maxTorque = ssvParams.find((p) => p.name === "maxTorque");
  if (maxTorque?.value !== 350.0) throw new Error(`Unexpected maxTorque: ${maxTorque?.value}`);
  console.log("✓ SSD and SSV parser tests passed");

  // 2. Test Modelica Projection
  const modelicaBlock = sspToModelicaBlock(ssdXml, { sspFilePath: "DualDrive.ssp" });
  if (!modelicaBlock.includes("block DualDriveController")) throw new Error("Modelica block name missing");
  if (!modelicaBlock.includes('input Real throttle_in(unit="percent")')) throw new Error("Input throttle_in missing");
  if (!modelicaBlock.includes('output Real torque_left_out(unit="N.m")'))
    throw new Error("Output torque_left_out missing");
  if (!modelicaBlock.includes('__modelscript_external(type="ssp", file="DualDrive.ssp")'))
    throw new Error("External annotation missing");
  console.log("✓ Modelica Block Projection test passed");
  console.log("--- Generated Modelica Block ---");
  console.log(modelicaBlock);
  console.log("--------------------------------");

  // 3. Test Container Extraction & In-Memory ZIP Pipeline
  const sspZip = createZipArchive({
    "SystemStructure.ssd": ssdXml,
    "resources/DefaultParams.ssv": ssvXml,
    "resources/Motor.fmu": new Uint8Array([1, 2, 3, 4, 5]),
  });
  if (!sspLanguage.container) throw new Error("Missing sspLanguage container definition");
  const extractResult = await extractContainerArchive(sspZip, sspLanguage.container, defaultContainerToolkit);
  if (!extractResult) throw new Error("Container extraction returned null");
  if (extractResult.manifest?.path !== "SystemStructure.ssd") throw new Error("Manifest path mismatch");
  if (extractResult.entries?.length !== 3) throw new Error("Entry count mismatch");

  const fmuEntry = extractResult.entries.find((e) => e.path === "resources/Motor.fmu");
  if (fmuEntry?.action !== "extract_nested") throw new Error("Nested FMU action mismatch");

  const projected = extractResult.project?.("modelica");
  if (!projected || !projected.includes("block DualDriveController"))
    throw new Error("Projection from container failed");
  console.log("✓ Container extraction & projection test passed");

  console.log("ALL TESTS PASSED SUCCESSFULLY! ✨");
}

main().catch((err) => {
  console.error("Test failed:", err);
  process.exit(1);
});
