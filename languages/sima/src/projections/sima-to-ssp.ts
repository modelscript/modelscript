// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SystemStructure.ssd (SSP 1.0/2.0) co-simulation projection for SINTEF Ocean SIMO/RIFLEX models.
 * Connects Floater 6-DOF FMU, Mooring Dynamics FMU, and Environmental Waves FMU.
 */

import type { SimaModel } from "../types.js";

export function simaToSsp(model: SimaModel): string {
  const title = model.title || "SIMA_CoSimulation";
  const v = model.vessels[0];
  const vesselName = v?.name || "FloaterHull";

  const xml: string[] = [];
  xml.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  xml.push(`<ssd:SystemStructureDescription xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"`);
  xml.push(`    xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"`);
  xml.push(`    xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"`);
  xml.push(`    name="${title}" version="1.0">`);
  xml.push(`  <ssd:System name="${title}">`);
  xml.push(`    <ssd:Elements>`);

  // 1. Vessel Hull FMU
  xml.push(`      <ssd:Component name="${vesselName}" source="resources/${vesselName}.fmu">`);
  xml.push(`        <ssd:Connectors>`);
  xml.push(`          <ssd:Connector name="surge" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="sway" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="heave" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="roll" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="pitch" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="yaw" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="F_mooring_x" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="F_mooring_y" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="F_mooring_z" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="F_wave_surge" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="F_wave_heave" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`        </ssd:Connectors>`);
  xml.push(`      </ssd:Component>`);

  // 2. Mooring System FMU
  xml.push(`      <ssd:Component name="MooringSystem" source="resources/MooringSystem.fmu">`);
  xml.push(`        <ssd:Connectors>`);
  xml.push(`          <ssd:Connector name="surge_in" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="sway_in" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="heave_in" kind="input"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="Fx_out" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="Fy_out" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="Fz_out" kind="output"><ssc:Real/></ssd:Connector>`);
  for (let i = 0; i < model.lines.length; i++) {
    xml.push(`          <ssd:Connector name="tension_line_${i + 1}" kind="output"><ssc:Real/></ssd:Connector>`);
  }
  xml.push(`        </ssd:Connectors>`);
  xml.push(`      </ssd:Component>`);

  // 3. Environmental Hydrodynamics FMU
  xml.push(`      <ssd:Component name="Environment" source="resources/WaveExcitation.fmu">`);
  xml.push(`        <ssd:Connectors>`);
  xml.push(`          <ssd:Connector name="F_wave_surge_out" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`          <ssd:Connector name="F_wave_heave_out" kind="output"><ssc:Real/></ssd:Connector>`);
  xml.push(`        </ssd:Connectors>`);
  xml.push(`      </ssd:Component>`);

  xml.push(`    </ssd:Elements>`);

  // Connections
  xml.push(`    <ssd:Connections>`);
  xml.push(`      <!-- Floater to Mooring Kinematics -->`);
  xml.push(
    `      <ssd:Connection startElement="${vesselName}" startConnector="surge" endElement="MooringSystem" endConnector="surge_in"/>`,
  );
  xml.push(
    `      <ssd:Connection startElement="${vesselName}" startConnector="sway" endElement="MooringSystem" endConnector="sway_in"/>`,
  );
  xml.push(
    `      <ssd:Connection startElement="${vesselName}" startConnector="heave" endElement="MooringSystem" endConnector="heave_in"/>`,
  );
  xml.push(`      <!-- Mooring Restoring to Floater -->`);
  xml.push(
    `      <ssd:Connection startElement="MooringSystem" startConnector="Fx_out" endElement="${vesselName}" endConnector="F_mooring_x"/>`,
  );
  xml.push(
    `      <ssd:Connection startElement="MooringSystem" startConnector="Fy_out" endElement="${vesselName}" endConnector="F_mooring_y"/>`,
  );
  xml.push(
    `      <ssd:Connection startElement="MooringSystem" startConnector="Fz_out" endElement="${vesselName}" endConnector="F_mooring_z"/>`,
  );
  xml.push(`      <!-- Environmental Excitation to Floater -->`);
  xml.push(
    `      <ssd:Connection startElement="Environment" startConnector="F_wave_surge_out" endElement="${vesselName}" endConnector="F_wave_surge"/>`,
  );
  xml.push(
    `      <ssd:Connection startElement="Environment" startConnector="F_wave_heave_out" endElement="${vesselName}" endConnector="F_wave_heave"/>`,
  );
  xml.push(`    </ssd:Connections>`);
  xml.push(`  </ssd:System>`);
  xml.push(`</ssd:SystemStructureDescription>`);
  xml.push(``);

  return xml.join("\n");
}
