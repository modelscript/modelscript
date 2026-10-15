// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * System Structure and Parameterization (SSP) Projection for PSCAD.
 *
 * Translates multi-vendor PSCAD projects containing FMU instances into
 * standardized SystemStructure.ssd XML archives for distributed co-simulation.
 */

import { extractEmtNetlist } from "../netlist/emt-netlist.js";
import type { PscxProject } from "../types.js";

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Translates a PSCAD project into an SSP SystemStructure.ssd XML string.
 */
export function pscadToSsd(project: PscxProject): string {
  const netlist = extractEmtNetlist(project);
  const sysName = escapeXml(project.name.replace(/[^a-zA-Z0-9_]/g, "_"));
  const safeProjName = escapeXml(project.name);

  const componentsXml: string[] = [];
  const connectionsXml: string[] = [];

  // 1. Declare Grid Substation Network as Master Participant
  componentsXml.push(`      <ssd:Component name="GridPassiveNetwork" source="resources/GridNetwork.fmu">
        <ssd:Connectors>
${Array.from(netlist.buses.values())
  .map((b) => {
    const busId = escapeXml(b.id);
    return (
      `          <ssd:Connector name="${busId}_v" kind="output"><ssc:Real unit="kV" /></ssd:Connector>\n` +
      `          <ssd:Connector name="${busId}_i" kind="input"><ssc:Real unit="A" /></ssd:Connector>`
    );
  })
  .join("\n")}
        </ssd:Connectors>
      </ssd:Component>`);

  // 2. Declare Inverter FMU Instances
  for (const fmu of netlist.fmuInstances) {
    const fmuName = escapeXml(fmu.name);
    const fmuPath = escapeXml(fmu.fmuPath);
    const busConn = escapeXml(fmu.busConnection);
    componentsXml.push(`      <ssd:Component name="${fmuName}" source="${fmuPath}">
        <ssd:Connectors>
          <ssd:Connector name="v_poi" kind="input"><ssc:Real unit="kV" /></ssd:Connector>
          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>
          <ssd:Connector name="p_mw" kind="parameter"><ssc:Real value="${fmu.ratedMva * 0.9}" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>`);

    // Connect FMU to its Point of Interconnection (POI) bus on the grid
    connectionsXml.push(
      `      <ssd:Connection startElement="GridPassiveNetwork" startConnector="${busConn}_v" endElement="${fmuName}" endConnector="v_poi" />`,
    );
    connectionsXml.push(
      `      <ssd:Connection startElement="${fmuName}" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="${busConn}_i" />`,
    );
  }

  // 3. Declare Synchronous & Induction Machines as Co-Simulation Participants
  for (const sm of netlist.synchronousMachines ?? []) {
    const smName = escapeXml(sm.id);
    const busConn = escapeXml(sm.bus);
    componentsXml.push(`      <ssd:Component name="${smName}" source="resources/SyncMachine_6thOrder.fmu">
        <ssd:Connectors>
          <ssd:Connector name="v_term" kind="input"><ssc:Real unit="kV" /></ssd:Connector>
          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>
          <ssd:Connector name="rated_mva" kind="parameter"><ssc:Real value="${sm.ratedMva}" /></ssd:Connector>
          <ssd:Connector name="rated_kv" kind="parameter"><ssc:Real value="${sm.ratedKvLL}" /></ssd:Connector>
          <ssd:Connector name="inertia_h" kind="parameter"><ssc:Real value="${sm.hInertiaSec ?? 3.5}" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>`);
    connectionsXml.push(
      `      <ssd:Connection startElement="GridPassiveNetwork" startConnector="${busConn}_v" endElement="${smName}" endConnector="v_term" />`,
    );
    connectionsXml.push(
      `      <ssd:Connection startElement="${smName}" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="${busConn}_i" />`,
    );
  }

  for (const im of netlist.inductionMachines ?? []) {
    const imName = escapeXml(im.id);
    const busConn = escapeXml(im.bus);
    const fmuSrc =
      im.machineType === "dfig" ? "resources/WindDFIG_5thOrder.fmu" : "resources/InductionMotor_5thOrder.fmu";
    componentsXml.push(`      <ssd:Component name="${imName}" source="${fmuSrc}">
        <ssd:Connectors>
          <ssd:Connector name="v_term" kind="input"><ssc:Real unit="kV" /></ssd:Connector>
          <ssd:Connector name="i_inj" kind="output"><ssc:Real unit="A" /></ssd:Connector>
          <ssd:Connector name="rated_mva" kind="parameter"><ssc:Real value="${im.ratedMva}" /></ssd:Connector>
          <ssd:Connector name="rated_kv" kind="parameter"><ssc:Real value="${im.ratedKvLL}" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>`);
    connectionsXml.push(
      `      <ssd:Connection startElement="GridPassiveNetwork" startConnector="${busConn}_v" endElement="${imName}" endConnector="v_term" />`,
    );
    connectionsXml.push(
      `      <ssd:Connection startElement="${imName}" startConnector="i_inj" endElement="GridPassiveNetwork" endConnector="${busConn}_i" />`,
    );
  }

  // 4. Declare HVDC / FACTS Converter Bridges (VSC PWM, LCC 6-Pulse, MMC Thévenin)
  for (const cb of netlist.converterBridges ?? []) {
    const cbName = escapeXml(cb.id);
    const busConn = escapeXml(cb.acBus);
    componentsXml.push(`      <ssd:Component name="${cbName}" source="resources/Converter_${escapeXml(cb.kind)}.fmu">
        <ssd:Connectors>
          <ssd:Connector name="v_ac" kind="input"><ssc:Real unit="kV" /></ssd:Connector>
          <ssd:Connector name="i_ac" kind="output"><ssc:Real unit="A" /></ssd:Connector>
          <ssd:Connector name="rated_mva" kind="parameter"><ssc:Real value="${cb.ratedMva}" /></ssd:Connector>
          <ssd:Connector name="vdc_kv" kind="parameter"><ssc:Real value="${cb.vDcNominalKv ?? 400.0}" /></ssd:Connector>
        </ssd:Connectors>
      </ssd:Component>`);
    connectionsXml.push(
      `      <ssd:Connection startElement="GridPassiveNetwork" startConnector="${busConn}_v" endElement="${cbName}" endConnector="v_ac" />`,
    );
    connectionsXml.push(
      `      <ssd:Connection startElement="${cbName}" startConnector="i_ac" endElement="GridPassiveNetwork" endConnector="${busConn}_i" />`,
    );
  }

  return `<?xml version="1.0" encoding="UTF-8"?>
<ssd:SystemStructureDescription xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"
                                xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"
                                name="${sysName}"
                                version="1.0"
                                description="Multi-Vendor IBR Grid System generated from PSCAD project ${safeProjName}">
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
