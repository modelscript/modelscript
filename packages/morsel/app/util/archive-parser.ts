import { inflateRaw } from "pako";
import { parseSsd } from "./ssp-parser";

/**
 * Extract a file from a ZIP archive by name.
 * Supports STORED (method 0) and DEFLATED (method 8) entries.
 */
export function extractFromZip(zipData: Uint8Array, targetName: string): Uint8Array | null {
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData[i] === 0x50 && zipData[i + 1] === 0x4b && zipData[i + 2] === 0x05 && zipData[i + 3] === 0x06) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const view = new DataView(zipData.buffer, zipData.byteOffset, zipData.byteLength);
  const cdOffset = view.getUint32(eocdOffset + 16, true);
  const cdSize = view.getUint32(eocdOffset + 12, true);
  const cdEnd = cdOffset + cdSize;

  let pos = cdOffset;
  while (pos < cdEnd) {
    if (view.getUint32(pos, true) !== 0x02014b50) break;
    const compressionMethod = view.getUint16(pos + 10, true);
    const compressedSize = view.getUint32(pos + 20, true);
    const fileNameLength = view.getUint16(pos + 28, true);
    const extraLength = view.getUint16(pos + 30, true);
    const commentLength = view.getUint16(pos + 32, true);
    const localHeaderOffset = view.getUint32(pos + 42, true);
    const fileName = new TextDecoder().decode(zipData.subarray(pos + 46, pos + 46 + fileNameLength));

    if (fileName === targetName) {
      if (view.getUint32(localHeaderOffset, true) !== 0x04034b50) return null;
      const localFileNameLen = view.getUint16(localHeaderOffset + 26, true);
      const localExtraLen = view.getUint16(localHeaderOffset + 28, true);
      const dataStart = localHeaderOffset + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        return zipData.subarray(dataStart, dataStart + compressedSize);
      } else if (compressionMethod === 8) {
        try {
          return inflateRaw(zipData.subarray(dataStart, dataStart + compressedSize));
        } catch {
          return null;
        }
      }
      return null;
    }
    pos += 46 + fileNameLength + extraLength + commentLength;
  }
  return null;
}

export function sspBytesToModelica(name: string, sspBytes: Uint8Array): string {
  try {
    const xmlData = extractFromZip(sspBytes, "SystemStructure.ssd");
    if (!xmlData) return `// Error: SystemStructure.ssd not found in ${name}.ssp\n`;
    const xml = new TextDecoder().decode(xmlData);
    const ssp = parseSsd(xml);
    return generateModelicaSspBlock(ssp);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `// Error reading ${name}.ssp: ${msg}\n`;
  }
}

function generateModelicaSspBlock(ssp: any): string {
  const lines: string[] = [];
  lines.push("// ── System Structure and Parameterization (SSP) ────────────────────");
  lines.push("// This is a readonly view of the SSP archive contents.");
  lines.push("");

  if (ssp.description) lines.push(`model ${ssp.name} "${ssp.description}"`);
  else lines.push(`model ${ssp.name}`);

  if (ssp.components.length > 0) {
    lines.push("");
    lines.push("  // ── Component Types ──");
    for (const comp of ssp.components) {
      lines.push(`  ${comp.source ? `/* ${comp.source} */ ` : ""}block ${comp.name}_type`);

      const inputs = comp.connectors.filter((c: any) => c.kind === "input");
      const outputs = comp.connectors.filter((c: any) => c.kind === "output" || c.kind === "inout");

      let i = 0;
      for (const conn of inputs) {
        const y = 100 - ((i + 1) * 200) / (inputs.length + 1);
        lines.push(
          `    input ${conn.type} ${conn.name} annotation(Placement(transformation(extent={{-110, ${Math.round(y) - 10}}, {-90, ${Math.round(y) + 10}}})));`,
        );
        i++;
      }

      let j = 0;
      for (const conn of outputs) {
        const causality = conn.kind === "inout" ? "inout" : "output";
        const y = 100 - ((j + 1) * 200) / (outputs.length + 1);
        lines.push(
          `    ${causality} ${conn.type} ${conn.name} annotation(Placement(transformation(extent={{90, ${Math.round(y) - 10}}, {110, ${Math.round(y) + 10}}})));`,
        );
        j++;
      }

      lines.push(`    annotation(`);
      lines.push(
        `      Icon(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}), graphics = {Rectangle(extent = {{-100, 100}, {100, -100}}, lineColor = {0, 0, 0}, fillColor = {255, 230, 204}, fillPattern = FillPattern.Solid), Text(extent = {{-100, 24}, {100, -24}}, textString = "${comp.name}")}),`,
      );
      lines.push(`      Diagram(coordinateSystem(preserveAspectRatio = false, extent = {{-100, -100}, {100, 100}}))`);
      lines.push(`    );`);
      lines.push(`  end ${comp.name}_type;`);
      lines.push("");
    }

    lines.push("  // ── Component Instances ──");
    let xOffset = -60;
    for (const comp of ssp.components) {
      lines.push(
        `  ${comp.name}_type ${comp.name} annotation(Placement(transformation(extent={{${xOffset}, -20}, {${xOffset + 40}, 20}})));`,
      );
      xOffset += 60;
    }
    lines.push("");
  }

  if (ssp.parameterBindings.length > 0) {
    lines.push("  // ── Parameter Bindings ──");
    for (const pb of ssp.parameterBindings) {
      if (pb.source) lines.push(`  // Binding set from: ${pb.source}`);
      else lines.push(`  // Parameter Binding`);

      for (const p of pb.values) {
        lines.push(`  parameter ${p.type} ${p.name} = ${p.value};`);
      }
    }
    lines.push("");
  }

  if (ssp.connections.length > 0) {
    lines.push("equation");
    lines.push("  // ── Connections ──");
    for (const conn of ssp.connections) {
      lines.push(`  connect(${conn.startElement}.${conn.startConnector}, ${conn.endElement}.${conn.endConnector});`);
    }
  }

  lines.push(`end ${ssp.name};`);
  lines.push("");
  return lines.join("\n");
}

export function fmuBytesToModelica(name: string, fmuBytes: Uint8Array): string {
  try {
    const xmlData = extractFromZip(fmuBytes, "modelDescription.xml");
    if (!xmlData) return `// Error: modelDescription.xml not found in ${name}.fmu\n`;
    const xml = new TextDecoder().decode(xmlData);
    const fmu = parseModelDescription(xml);
    return generateModelicaFmuBlock(fmu);
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return `// Error reading ${name}.fmu: ${msg}\n`;
  }
}

function parseModelDescription(xml: string) {
  const attr = (s: string, name: string): string => s.match(new RegExp(`\\b${name}\\s*=\\s*"([^"]*)"`))?.[1] ?? "";

  const headerMatch = xml.match(/<fmiModelDescription([^>]*)>/);
  const header = headerMatch?.[1] ?? "";
  const modelName = attr(header, "modelName") || "FMU";
  const description = attr(header, "description");
  const guid = attr(header, "guid");
  const generationTool = attr(header, "generationTool");

  const variables = [];
  const scalarRegex =
    /<ScalarVariable\b([^>]*)\/?>([\s\S]*?)(?:<\/ScalarVariable>|(?=<ScalarVariable|<\/ModelVariables))/g;
  let match: RegExpExecArray | null;

  while ((match = scalarRegex.exec(xml)) !== null) {
    const headerAttrs = match[1] ?? "";
    const body = match[0] ?? "";
    const name = attr(headerAttrs, "name");
    if (!name) continue;

    const causality = attr(headerAttrs, "causality") || "local";
    const typeMatch = body.match(/<(Real|Integer|Boolean|String)\b([^>]*)/);
    const type = typeMatch?.[1] ?? "Real";
    const typeAttrs = typeMatch?.[2] ?? "";
    const start = attr(typeAttrs, "start") || undefined;
    const unit = attr(typeAttrs, "unit") || undefined;

    variables.push({ name, causality, type, description: attr(headerAttrs, "description"), start, unit });
  }

  return { modelName, description, guid, generationTool, variables };
}

function generateModelicaFmuBlock(fmu: any): string {
  const lines: string[] = [];
  lines.push("// ── FMU 2.0 Model Description ──────────────────────────────────────");
  lines.push("// This is a readonly view of the FMU archive contents.");
  lines.push(`// GUID: ${fmu.guid}`);
  if (fmu.generationTool) lines.push(`// Generated by: ${fmu.generationTool}`);
  lines.push("");

  if (fmu.description) lines.push(`block ${fmu.modelName} "${fmu.description}"`);
  else lines.push(`block ${fmu.modelName}`);

  const inputs = fmu.variables.filter((v: any) => v.causality === "input");
  const outputs = fmu.variables.filter((v: any) => v.causality === "output");
  const params = fmu.variables.filter((v: any) => v.causality === "parameter" || v.causality === "calculatedParameter");

  for (const v of params) {
    const startStr = v.start !== undefined ? ` = ${v.start}` : "";
    const unitStr = v.unit ? ` /* ${v.unit} */` : "";
    const descStr = v.description ? ` "${v.description}"` : "";
    lines.push(`  parameter ${v.type} ${v.name}${startStr}${descStr};${unitStr}`);
  }

  if (inputs.length > 0 && params.length > 0) lines.push("");
  for (const v of inputs) {
    const startStr = v.start !== undefined ? `(start = ${v.start})` : "";
    const descStr = v.description ? ` "${v.description}"` : "";
    lines.push(`  input ${v.type} ${v.name}${startStr}${descStr};`);
  }

  if (outputs.length > 0 && (inputs.length > 0 || params.length > 0)) lines.push("");
  for (const v of outputs) {
    const startStr = v.start !== undefined ? `(start = ${v.start})` : "";
    const descStr = v.description ? ` "${v.description}"` : "";
    lines.push(`  output ${v.type} ${v.name}${startStr}${descStr};`);
  }

  lines.push(`end ${fmu.modelName};`);
  lines.push("");
  return lines.join("\n");
}
