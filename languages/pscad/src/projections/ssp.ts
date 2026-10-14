// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * System Structure and Parameterization (SSP) Projection for PSCAD.
 *
 * Translates multi-vendor PSCAD projects containing FMU instances into
 * standardized SystemStructure.ssd XML archives for distributed co-simulation.
 */

import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import type { PscxProject } from "../types.js";

/**
 * Translates a PSCAD project into an SSP SystemStructure.ssd XML string.
 */
export function pscadToSsd(project: PscxProject): string {
  const netlist = extractEmtNetlist(project);
  const sysName = project.name.replace(/[^a-zA-Z0-9_]/g, "_");

  const componentsXml: string[] = [];
  const connectionsXml: string[] = [];

  // 1. Declare Grid Substation Network as Master Participant
  componentsXml.push(`      <ssd:Component name="GridPassiveNetwork" source="resources/GridNetwork.fmu">
        <ssd:Connectors>
${Array.from(netlist.buses.values())
  .map(
    (b) =>
      `          <ssd:Connector name="${b.id}_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>\n` +
      `          <ssd:Connector name="${b.id}_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>`,
  )
  .join("\n")}
        </ssd:Connectors>
      </ssd:Component>`);

  // 2. Declare Inverter FMU Instances
  for (const fmu of netlist.fmuInstances) {
    componentsXml.push(`      <ssd:Component name="${fmu.name}" source="${fmu.fmuPath}">
        <ssd:Connectors>
          <ssd:Connector name="v_poi" kind="input"><ssc:Real unit="kV" /></ssd:Connector>
          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>
          <ssd:Connector name="p_mw" kind="parameter"><ssc:Real value="${fmu.ratedMva * 0.9}" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>`);

    // Connect FMU to its Point of Interconnection (POI) bus on the grid
    connectionsXml.push(
      `      <ssd:Connection startElement="GridPassiveNetwork" startConnector="${fmu.busConnection}_v" endElement="${fmu.name}" endConnector="v_poi" />`,
    );
    connectionsXml.push(
      `      <ssd:Connection startElement="${fmu.name}" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="${fmu.busConnection}_i" />`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="${sysName}"
                                version="1.0"
                                description="Multi-Vendor IBR Grid System generated from PSCAD project ${project.name}">
  <ssd:System name="${sysName}">
    <ssd:Elements>
${componentsXml.join("\n")}
    </ssd:Elements>
    <ssd:Connections>
${connectionsXml.join("\n")}
    </ssd:Connections>
  </ssd:System>
</ssd:SystemStructureDescription>
`;
}
