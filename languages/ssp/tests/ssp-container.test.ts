import { createZipArchive, defaultContainerToolkit, extractContainerArchive } from "@modelscript/language";
import { sspLanguage } from "../src/language.js";
import { sspToModelicaBlock } from "../src/projection.js";
import { parseSsd, parseSsv } from "../src/ssd-parser.js";

describe("@modelscript/ssp Language & Container Integration", () => {
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

  it("parses SSD and SSV XML models accurately", () => {
    const system = parseSsd(ssdXml);
    expect(system.name).toBe("DualDriveController");
    expect(system.version).toBe("1.0");
    expect(system.description).toBe("Closed loop dual-drive vehicle control system");
    expect(system.connectors?.length).toBe(5);
    expect(system.components.length).toBe(2);
    expect(system.connections.length).toBe(1);

    const ssvParams = parseSsv(ssvXml);
    expect(ssvParams.length).toBe(3);
    expect(ssvParams.find((p) => p.name === "maxTorque")?.value).toBe(350.0);
    expect(ssvParams.find((p) => p.name === "enableRegen")?.value).toBe(true);
    expect(ssvParams.find((p) => p.name === "gearCount")?.value).toBe(2);
  });

  it("projects SSP system to authentic Modelica block source code", () => {
    const modelicaCode = sspToModelicaBlock(ssdXml, { sspFilePath: "DualDrive.ssp" });
    expect(modelicaCode).toContain("block DualDriveController");
    expect(modelicaCode).toContain('input Real throttle_in(unit="percent")');
    expect(modelicaCode).toContain('input Real steering_in(unit="rad")');
    expect(modelicaCode).toContain('output Real torque_left_out(unit="N.m")');
    expect(modelicaCode).toContain('output Real torque_right_out(unit="N.m")');
    expect(modelicaCode).toContain("parameter Real gain");
    expect(modelicaCode).toContain('__modelscript_external(type="ssp", file="DualDrive.ssp")');
    expect(modelicaCode).toContain("Icon(coordinateSystem");
    expect(modelicaCode).toContain("end DualDriveController;");
  });

  it("extracts and projects in-memory .ssp container using sspLanguage definition", async () => {
    const sspZip = createZipArchive({
      "SystemStructure.ssd": ssdXml,
      "resources/DefaultParams.ssv": ssvXml,
      "resources/Motor.fmu": new Uint8Array([1, 2, 3]),
    });

    expect(sspLanguage.container).toBeDefined();
    if (!sspLanguage.container) return;
    const result = await extractContainerArchive(sspZip, sspLanguage.container, defaultContainerToolkit);
    expect(result).not.toBeNull();
    expect(result?.manifest?.path).toBe("SystemStructure.ssd");
    expect(result?.entries?.length).toBe(3);

    // Verify nested container action
    const fmuEntry = result?.entries?.find((e) => e.path === "resources/Motor.fmu");
    expect(fmuEntry?.action).toBe("extract_nested");

    // Verify projection hook
    const projectedModelica = result?.project?.("modelica");
    expect(typeof projectedModelica).toBe("string");
    expect(projectedModelica).toContain("block DualDriveController");
  });
});
