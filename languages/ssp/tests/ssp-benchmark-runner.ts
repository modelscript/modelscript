// SPDX-License-Identifier: AGPL-3.0-or-later

import type { BenchmarkCaseResult, LanguageBenchmarkAdapter } from "@modelscript/runtime/benchmark";
import { lintSsd } from "../src/linter.js";
import { sspToModelicaBlock } from "../src/projection.js";
import { parseSsd } from "../src/ssd-parser.js";

const QUARTER_TRUCK_SSD = `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="QuarterTruck" version="1.0">
  <ssd:System name="QuarterTruck">
    <ssd:Connectors>
      <ssd:Connector name="road_profile" kind="input"><ssc:Real unit="m" /></ssd:Connector>
      <ssd:Connector name="chassis_accel" kind="output"><ssc:Real unit="m/s2" /></ssd:Connector>
    </ssd:Connectors>
    <ssd:Elements>
      <ssd:Component name="Chassis" source="resources/Chassis.fmu">
        <ssd:Connectors>
          <ssd:Connector name="f_suspension" kind="input"><ssc:Real unit="N" /></ssd:Connector>
          <ssd:Connector name="a_chassis" kind="output"><ssc:Real unit="m/s2" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
      <ssd:Component name="Wheel" source="resources/Wheel.fmu">
        <ssd:Connectors>
          <ssd:Connector name="road_profile" kind="input"><ssc:Real unit="m" /></ssd:Connector>
          <ssd:Connector name="z_wheel" kind="output"><ssc:Real unit="m" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>
    </ssd:Elements>
    <ssd:Connections>
      <ssd:Connection startElement="QuarterTruck" startConnector="road_profile" endElement="Wheel" endConnector="road_profile" />
      <ssd:Connection startElement="Chassis" startConnector="a_chassis" endElement="QuarterTruck" endConnector="chassis_accel" />
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>`;

export const sspBenchmarkAdapter: LanguageBenchmarkAdapter = {
  slug: "ssp",
  referenceTool: "Modelica Association SSP 1.0 QuarterTruck",
  defaultTolerance: 0,
  metricKind: "exact",
  async runCases(): Promise<BenchmarkCaseResult[]> {
    const t0 = performance.now();
    const system = parseSsd(QUARTER_TRUCK_SSD);
    const diags = lintSsd(QUARTER_TRUCK_SSD);
    const mo = sspToModelicaBlock(QUARTER_TRUCK_SSD);
    const d1 = performance.now() - t0;

    return [
      {
        id: "ssp-quartertruck-ssd-modelica",
        name: "SSP 1.0 QuarterTruck Topology Lint & Modelica Projection",
        scale: "standard",
        referenceTool: "Modelica Association SSP 1.0 QuarterTruck",
        metricKind: "exact",
        threshold: 0,
        measuredError: diags.length,
        passed: diags.length === 0 && mo.includes("block QuarterTruck"),
        durationMs: d1,
        details: `components=${system.components.length}, connections=${system.connections.length}, diags=${diags.length}`,
      },
    ];
  },
};
