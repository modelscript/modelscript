// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Projects an IRIG 106 Chapter 9 TMATS model to CCSDS 660.1-G-1 XTCE XML.
 */

import { parseIrig106 } from "../parser/tmats-parser.js";
import { buildCommutatorGrid } from "../solver/commutator.js";
import type { TmatsModel } from "../types.js";

function escapeXml(value: string): string {
  return value
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Exports a TMATS telemetry definition to CCSDS XTCE XML (`<SpaceSystem>`).
 */
export function irig106ToXtce(modelOrSource: TmatsModel | string): string {
  const model = typeof modelOrSource === "string" ? parseIrig106(modelOrSource) : modelOrSource;
  const grid = buildCommutatorGrid(model);
  const spaceSystemName = escapeXml(model.name || "TMATS_SYSTEM");

  const lines: string[] = [
    `<?xml version="1.0" encoding="UTF-8"?>`,
    `<SpaceSystem xmlns="http://www.omg.org/spec/XTCE/20180204" name="${spaceSystemName}">`,
    `  <Header validationStatus="Working" version="${escapeXml(model.general.revisionNumber ?? "1.0")}" date="${escapeXml(model.general.originationDate ?? "1986-01-01")}">`,
    `    <Note>Projected from IRIG 106 Chapter 9 TMATS (${escapeXml(grid.dataLinkName)}, ${grid.bitRateBps} bps, ${grid.minorFrameRateHz.toFixed(4)} Hz minor frame rate)</Note>`,
    `  </Header>`,
    `  <TelemetryMetaData>`,
    `    <ParameterTypeSet>`,
  ];

  // Emit ParameterTypes for every scheduled measurement
  for (const sched of grid.schedules) {
    const conv = model.conversionsByName.get(sched.name);
    const typeName = `${escapeXml(sched.name)}_Type`;
    const units = conv?.engineeringUnits ? escapeXml(conv.engineeringUnits) : "";
    const encoding = conv?.binaryFormat === "TWO" ? "twosComplement" : "unsigned";

    if (conv && conv.conversionType === "COE" && conv.coefficients.length > 0) {
      lines.push(`      <FloatParameterType name="${typeName}" sizeInBits="64">`);
      if (units) {
        lines.push(`        <UnitSet><Unit>${units}</Unit></UnitSet>`);
      }
      lines.push(`        <IntegerDataEncoding sizeInBits="${sched.bitLength}" encoding="${encoding}">`);
      lines.push(`          <DefaultCalibrator>`);
      lines.push(`            <PolynomialCalibrator>`);
      for (let k = 0; k < conv.coefficients.length; k++) {
        lines.push(`              <Term coefficient="${conv.coefficients[k]}" exponent="${k}"/>`);
      }
      lines.push(`            </PolynomialCalibrator>`);
      lines.push(`          </DefaultCalibrator>`);
      lines.push(`        </IntegerDataEncoding>`);
      lines.push(`      </FloatParameterType>`);
    } else {
      lines.push(
        `      <IntegerParameterType name="${typeName}" signed="${encoding === "twosComplement" ? "true" : "false"}">`,
      );
      if (units) {
        lines.push(`        <UnitSet><Unit>${units}</Unit></UnitSet>`);
      }
      lines.push(`        <IntegerDataEncoding sizeInBits="${sched.bitLength}" encoding="${encoding}"/>`);
      lines.push(`      </IntegerParameterType>`);
    }
  }

  lines.push(`    </ParameterTypeSet>`);
  lines.push(`    <ParameterSet>`);
  for (const sched of grid.schedules) {
    const conv = model.conversionsByName.get(sched.name);
    const descAttr = conv?.description ? ` shortDescription="${escapeXml(conv.description)}"` : "";
    lines.push(
      `      <Parameter name="${escapeXml(sched.name)}" parameterTypeRef="${escapeXml(sched.name)}_Type"${descAttr}/>`,
    );
  }
  lines.push(`    </ParameterSet>`);

  // Emit SequenceContainer for the PCM Minor Frame
  lines.push(`    <ContainerSet>`);
  lines.push(
    `      <SequenceContainer name="${escapeXml(grid.dataLinkName)}_MinorFrame" shortDescription="PCM Minor Frame (${grid.wordsPerMinorFrame} words, ${grid.bitsPerMinorFrame} bits, sync ${escapeXml(grid.syncPattern || "NONE")})">`,
  );
  lines.push(`        <EntryList>`);
  for (const sched of grid.schedules) {
    for (const wp of sched.wordPositions) {
      const bitOffset = (wp - 1) * grid.wordLengthBits;
      lines.push(`          <ParameterRefEntry parameterRef="${escapeXml(sched.name)}">`);
      lines.push(
        `            <LocationInContainerInBits referenceLocation="containerStart"><FixedValue>${bitOffset}</FixedValue></LocationInContainerInBits>`,
      );
      lines.push(`          </ParameterRefEntry>`);
    }
  }
  lines.push(`        </EntryList>`);
  lines.push(`      </SequenceContainer>`);
  lines.push(`    </ContainerSet>`);
  lines.push(`  </TelemetryMetaData>`);
  lines.push(`</SpaceSystem>`);

  return lines.join("\n") + "\n";
}
