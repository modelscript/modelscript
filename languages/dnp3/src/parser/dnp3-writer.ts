// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * IEEE 1815 / DNP3 SCADA Device Profile XML Serializer.
 */

import type { Dnp3DeviceProfile } from "../types.js";

/**
 * Serializes a Dnp3DeviceProfile to IEEE 1815 XML format.
 */
export function writeDnp3Xml(profile: Dnp3DeviceProfile): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<DNP3DeviceProfile xmlns="http://www.dnp.org/DNP3/DeviceProfile/2010" id="${profile.id}">`);
  lines.push(`  <DeviceIdentity>`);
  lines.push(`    <Vendor>${profile.vendor}</Vendor>`);
  lines.push(`    <DeviceName>${profile.deviceName}</DeviceName>`);
  lines.push(`    <Version>${profile.version}</Version>`);
  lines.push(`  </DeviceIdentity>`);
  lines.push(`  <CommunicationSettings>`);
  lines.push(`    <OutstationAddress>${profile.outstationAddress}</OutstationAddress>`);
  lines.push(`    <MasterAddress>${profile.masterAddress}</MasterAddress>`);
  lines.push(`  </CommunicationSettings>`);
  lines.push(`  <DNP3PointList>`);

  // Binary Inputs
  if (profile.binaryInputs.length > 0) {
    lines.push(`    <BinaryInputs>`);
    for (const bi of profile.binaryInputs) {
      lines.push(
        `      <BinaryInput index="${bi.index}" name="${bi.name}" class="${bi.eventClass}"${
          bi.normalState !== undefined ? ` normalState="${bi.normalState}"` : ""
        }/>`,
      );
    }
    lines.push(`    </BinaryInputs>`);
  }

  // Binary Outputs
  if (profile.binaryOutputs.length > 0) {
    lines.push(`    <BinaryOutputs>`);
    for (const bo of profile.binaryOutputs) {
      lines.push(`      <BinaryOutput index="${bo.index}" name="${bo.name}"/>`);
    }
    lines.push(`    </BinaryOutputs>`);
  }

  // Analog Inputs
  if (profile.analogInputs.length > 0) {
    lines.push(`    <AnalogInputs>`);
    for (const ai of profile.analogInputs) {
      const minAttr = ai.minVal !== undefined ? ` min="${ai.minVal}"` : "";
      const maxAttr = ai.maxVal !== undefined ? ` max="${ai.maxVal}"` : "";
      lines.push(
        `      <AnalogInput index="${ai.index}" name="${ai.name}" class="${ai.eventClass}" deadband="${ai.deadband}" mult="${ai.scalingMultiplier}" offset="${ai.scalingOffset}" units="${ai.units}"${minAttr}${maxAttr}/>`,
      );
    }
    lines.push(`    </AnalogInputs>`);
  }

  // Analog Outputs
  if (profile.analogOutputs.length > 0) {
    lines.push(`    <AnalogOutputs>`);
    for (const ao of profile.analogOutputs) {
      const unitAttr = ao.units ? ` units="${ao.units}"` : "";
      const minAttr = ao.minVal !== undefined ? ` min="${ao.minVal}"` : "";
      const maxAttr = ao.maxVal !== undefined ? ` max="${ao.maxVal}"` : "";
      lines.push(`      <AnalogOutput index="${ao.index}" name="${ao.name}"${unitAttr}${minAttr}${maxAttr}/>`);
    }
    lines.push(`    </AnalogOutputs>`);
  }

  // Counters
  if (profile.counters.length > 0) {
    lines.push(`    <Counters>`);
    for (const ctr of profile.counters) {
      const unitAttr = ctr.units ? ` units="${ctr.units}"` : "";
      lines.push(`      <Counter index="${ctr.index}" name="${ctr.name}" class="${ctr.eventClass}"${unitAttr}/>`);
    }
    lines.push(`    </Counters>`);
  }

  lines.push(`  </DNP3PointList>`);
  lines.push(`</DNP3DeviceProfile>`);
  return lines.join("\n") + "\n";
}
