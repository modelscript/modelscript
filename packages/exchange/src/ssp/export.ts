// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP archive exporter.
 *
 * Generates an `.ssp` archive (ZIP) from a `CoSimSession`, containing
 * a `SystemStructure.ssd` file describing the system and its connections,
 * plus the participant FMU files under `resources/`.
 */

import { deflateRawSync } from "zlib";
import type { CoSimSession } from "../cosim/session.js";
import type { SspParameterValue, SspSystem } from "./types.js";

/** Options for SSP export. */
export interface SspExportOptions {
  /** SSP version string. Default: "1.0". */
  version?: string;
  /** System description text. */
  description?: string;
}

/**
 * Export an SspSystem to an SSP archive buffer directly from the system model.
 *
 * @param system       The SspSystem specification
 * @param fmuArchives  Map of participant ID or relative path → raw FMU archive bytes
 * @param options      Optional export settings
 * @returns Buffer containing the .ssp ZIP archive
 */
export function exportSspFromSystem(
  system: SspSystem,
  fmuArchives: Map<string, Buffer | Uint8Array>,
  options?: SspExportOptions,
): Buffer {
  if (options?.version) system.version = options.version;
  if (options?.description) system.description = options.description;

  const ssdXml = generateSsdFromSystem(system);
  const files = new Map<string, Buffer | Uint8Array>();
  files.set("SystemStructure.ssd", Buffer.from(ssdXml, "utf-8"));

  // Check if any parameter bindings reference external .ssv files and have inline values
  if (system.parameterBindings) {
    for (const pb of system.parameterBindings) {
      if (pb.source && pb.values && pb.values.length > 0) {
        const ssvXml = generateSsv(pb.values, pb.prefix ?? "parameters");
        files.set(pb.source, Buffer.from(ssvXml, "utf-8"));
      }
    }
  }

  // Add FMU resources
  for (const [name, fmuData] of fmuArchives) {
    const path = name.startsWith("resources/") ? name : `resources/${name.endsWith(".fmu") ? name : `${name}.fmu`}`;
    files.set(path, fmuData);
  }

  return buildZip(files);
}

/**
 * Export a CoSimSession to an SSP archive buffer.
 *
 * @param session      The session to export
 * @param fmuArchives  Map of participant ID → raw FMU archive bytes
 * @param options      Optional export settings
 * @returns Buffer containing the .ssp ZIP archive
 */
export function exportSsp(
  session: CoSimSession,
  fmuArchives: Map<string, Buffer | Uint8Array>,
  options?: SspExportOptions,
): Buffer {
  const version = options?.version ?? "1.0";
  const description = options?.description ?? "";

  // Generate the SystemStructure.ssd XML
  const ssdXml = generateSsd(session, version, description);

  // Build the ZIP archive
  const files = new Map<string, Buffer | Uint8Array>();
  files.set("SystemStructure.ssd", Buffer.from(ssdXml, "utf-8"));

  // Add FMU resources
  for (const [participantId, fmuData] of fmuArchives) {
    files.set(`resources/${participantId}.fmu`, fmuData);
  }

  return buildZip(files);
}

// ── SSD XML Generation ──────────────────────────────────────────────

function generateSsd(session: CoSimSession, version: string, description: string): string {
  const lines: string[] = [];

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<ssd:SystemStructureDescription`);
  lines.push(`  xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"`);
  lines.push(`  xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"`);
  lines.push(`  xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"`);
  lines.push(`  version="${escapeXml(version)}"`);
  lines.push(
    `  name="${escapeXml(session.sessionId)}"${description ? ` description="${escapeXml(description)}"` : ""}>`,
  );

  // System element
  lines.push(`  <ssd:System name="${escapeXml(session.sessionId)}">`);

  // Elements (components)
  lines.push(`    <ssd:Elements>`);
  for (const [id, participant] of session.participants) {
    lines.push(
      `      <ssd:Component name="${escapeXml(id)}" type="application/x-fmu-sharedlibrary" source="resources/${escapeXml(id)}.fmu">`,
    );

    // Connectors from participant metadata
    const meta = participant.metadata;
    const inputs = meta.variables.filter((v) => v.causality === "input");
    const outputs = meta.variables.filter((v) => v.causality === "output");

    if (inputs.length > 0 || outputs.length > 0) {
      lines.push(`        <ssd:Connectors>`);

      for (const input of inputs) {
        lines.push(`          <ssd:Connector name="${escapeXml(input.name)}" kind="input">`);
        lines.push(`            <ssc:Real />`);
        lines.push(`          </ssd:Connector>`);
      }

      for (const output of outputs) {
        lines.push(`          <ssd:Connector name="${escapeXml(output.name)}" kind="output">`);
        lines.push(`            <ssc:Real />`);
        lines.push(`          </ssd:Connector>`);
      }

      lines.push(`        </ssd:Connectors>`);
    }

    lines.push(`      </ssd:Component>`);
  }
  lines.push(`    </ssd:Elements>`);

  // Connections
  const couplings = session.coupling.getAll();
  if (couplings.length > 0) {
    lines.push(`    <ssd:Connections>`);
    for (const coupling of couplings) {
      lines.push(
        `      <ssd:Connection` +
          ` startElement="${escapeXml(coupling.from.participantId)}"` +
          ` startConnector="${escapeXml(coupling.from.variableName)}"` +
          ` endElement="${escapeXml(coupling.to.participantId)}"` +
          ` endConnector="${escapeXml(coupling.to.variableName)}" />`,
      );
    }
    lines.push(`    </ssd:Connections>`);
  }

  lines.push(`  </ssd:System>`);

  // Default experiment
  lines.push(
    `  <ssd:DefaultExperiment startTime="${session.experiment.startTime}" stopTime="${session.experiment.stopTime}" />`,
  );

  lines.push(`</ssd:SystemStructureDescription>`);

  return lines.join("\n") + "\n";
}

/**
 * Generate SystemStructure.ssd XML string directly from an SspSystem specification.
 */
export function generateSsdFromSystem(system: SspSystem): string {
  const lines: string[] = [];
  const version = system.version || "1.0";
  const description = system.description ? ` description="${escapeXml(system.description)}"` : "";

  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<ssd:SystemStructureDescription`);
  lines.push(`  xmlns:ssd="http://ssp-standard.org/SSP1/SystemStructureDescription"`);
  lines.push(`  xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"`);
  lines.push(`  xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"`);
  lines.push(`  version="${escapeXml(version)}"`);
  lines.push(`  name="${escapeXml(system.name)}"${description}>`);

  lines.push(`  <ssd:System name="${escapeXml(system.name)}">`);

  // System-level boundary connectors
  if (system.connectors && system.connectors.length > 0) {
    lines.push(`    <ssd:Connectors>`);
    for (const conn of system.connectors) {
      lines.push(`      <ssd:Connector name="${escapeXml(conn.name)}" kind="${escapeXml(conn.kind)}">`);
      lines.push(`        <ssc:${conn.type ?? "Real"} />`);
      lines.push(`      </ssd:Connector>`);
    }
    lines.push(`    </ssd:Connectors>`);
  }

  // Elements (components)
  lines.push(`    <ssd:Elements>`);
  for (const comp of system.components) {
    const compType = comp.type ?? "application/x-fmu-sharedlibrary";
    lines.push(
      `      <ssd:Component name="${escapeXml(comp.name)}" type="${escapeXml(compType)}" source="${escapeXml(comp.source)}">`,
    );

    if (comp.connectors && comp.connectors.length > 0) {
      lines.push(`        <ssd:Connectors>`);
      for (const conn of comp.connectors) {
        lines.push(`          <ssd:Connector name="${escapeXml(conn.name)}" kind="${escapeXml(conn.kind)}">`);
        lines.push(`            <ssc:${conn.type ?? "Real"} />`);
        lines.push(`          </ssd:Connector>`);
      }
      lines.push(`        </ssd:Connectors>`);
    }

    lines.push(`      </ssd:Component>`);
  }
  lines.push(`    </ssd:Elements>`);

  // Connections
  if (system.connections && system.connections.length > 0) {
    lines.push(`    <ssd:Connections>`);
    for (const c of system.connections) {
      lines.push(
        `      <ssd:Connection` +
          ` startElement="${escapeXml(c.startElement)}"` +
          ` startConnector="${escapeXml(c.startConnector)}"` +
          ` endElement="${escapeXml(c.endElement)}"` +
          ` endConnector="${escapeXml(c.endConnector)}" />`,
      );
    }
    lines.push(`    </ssd:Connections>`);
  }

  // Parameter bindings
  if (system.parameterBindings && system.parameterBindings.length > 0) {
    lines.push(`    <ssd:ParameterBindings>`);
    for (const pb of system.parameterBindings) {
      const prefixAttr = pb.prefix ? ` prefix="${escapeXml(pb.prefix)}"` : "";
      if (pb.source) {
        lines.push(`      <ssd:ParameterBinding${prefixAttr} source="${escapeXml(pb.source)}" />`);
      } else if (pb.values && pb.values.length > 0) {
        lines.push(`      <ssd:ParameterBinding${prefixAttr}>`);
        lines.push(`        <ssd:ParameterValues>`);
        for (const pv of pb.values) {
          lines.push(`          <ssv:Parameter name="${escapeXml(pv.name)}">`);
          lines.push(`            <ssv:${pv.type} value="${pv.value}" />`);
          lines.push(`          </ssv:Parameter>`);
        }
        lines.push(`        </ssd:ParameterValues>`);
        lines.push(`      </ssd:ParameterBinding>`);
      }
    }
    lines.push(`    </ssd:ParameterBindings>`);
  }

  lines.push(`  </ssd:System>`);

  // Default experiment
  if (system.defaultExperiment) {
    const start = system.defaultExperiment.startTime ?? 0;
    const stop = system.defaultExperiment.stopTime ?? 1;
    lines.push(`  <ssd:DefaultExperiment startTime="${start}" stopTime="${stop}" />`);
  }

  lines.push(`</ssd:SystemStructureDescription>`);
  return lines.join("\n") + "\n";
}

/**
 * Generate SSV (System Structure Parameter Values) XML string from parameter values.
 */
export function generateSsv(parameters: SspParameterValue[], name = "parameters"): string {
  const lines: string[] = [];
  lines.push(`<?xml version="1.0" encoding="UTF-8"?>`);
  lines.push(`<ssv:ParameterSet`);
  lines.push(`  xmlns:ssv="http://ssp-standard.org/SSP1/SystemStructureParameterValues"`);
  lines.push(`  xmlns:ssc="http://ssp-standard.org/SSP1/SystemStructureCommon"`);
  lines.push(`  version="1.0"`);
  lines.push(`  name="${escapeXml(name)}">`);
  lines.push(`  <ssv:Parameters>`);
  for (const p of parameters) {
    lines.push(`    <ssv:Parameter name="${escapeXml(p.name)}">`);
    lines.push(`      <ssv:${p.type} value="${p.value}" />`);
    lines.push(`    </ssv:Parameter>`);
  }
  lines.push(`  </ssv:Parameters>`);
  lines.push(`</ssv:ParameterSet>`);
  return lines.join("\n") + "\n";
}

// ── ZIP builder ─────────────────────────────────────────────────────

/**
 * Build a ZIP archive from a map of filename → content.
 *
 * Minimal ZIP builder generating DEFLATED entries with a proper central
 * directory. Compatible with standard ZIP tools.
 */
function buildZip(files: Map<string, Buffer | Uint8Array>): Buffer {
  const localHeaders: Buffer[] = [];
  const centralEntries: Buffer[] = [];
  let offset = 0;

  for (const [name, rawData] of files) {
    const data = Buffer.isBuffer(rawData) ? rawData : Buffer.from(rawData);
    const nameBuffer = Buffer.from(name, "utf-8");
    const compressed = deflateRawSync(data);
    const crc = crc32(data);

    // Local file header (30 + nameLen + compressedLen bytes)
    const localHeader = Buffer.alloc(30 + nameBuffer.length);
    localHeader.writeUInt32LE(0x04034b50, 0); // Local file header signature
    localHeader.writeUInt16LE(20, 4); // Version needed to extract (2.0)
    localHeader.writeUInt16LE(0, 6); // General purpose bit flag
    localHeader.writeUInt16LE(8, 8); // Compression method (DEFLATED)
    localHeader.writeUInt16LE(0, 10); // Last mod file time
    localHeader.writeUInt16LE(0, 12); // Last mod file date
    localHeader.writeUInt32LE(crc, 14); // CRC-32
    localHeader.writeUInt32LE(compressed.length, 18); // Compressed size
    localHeader.writeUInt32LE(data.length, 22); // Uncompressed size
    localHeader.writeUInt16LE(nameBuffer.length, 26); // File name length
    localHeader.writeUInt16LE(0, 28); // Extra field length
    nameBuffer.copy(localHeader, 30);

    localHeaders.push(localHeader, compressed);

    // Central directory entry
    const centralEntry = Buffer.alloc(46 + nameBuffer.length);
    centralEntry.writeUInt32LE(0x02014b50, 0); // Central directory header signature
    centralEntry.writeUInt16LE(20, 4); // Version made by
    centralEntry.writeUInt16LE(20, 6); // Version needed to extract
    centralEntry.writeUInt16LE(0, 8); // General purpose bit flag
    centralEntry.writeUInt16LE(8, 10); // Compression method
    centralEntry.writeUInt16LE(0, 12); // Last mod file time
    centralEntry.writeUInt16LE(0, 14); // Last mod file date
    centralEntry.writeUInt32LE(crc, 16); // CRC-32
    centralEntry.writeUInt32LE(compressed.length, 20); // Compressed size
    centralEntry.writeUInt32LE(data.length, 24); // Uncompressed size
    centralEntry.writeUInt16LE(nameBuffer.length, 28); // File name length
    centralEntry.writeUInt16LE(0, 30); // Extra field length
    centralEntry.writeUInt16LE(0, 32); // File comment length
    centralEntry.writeUInt16LE(0, 34); // Disk number start
    centralEntry.writeUInt16LE(0, 36); // Internal file attributes
    centralEntry.writeUInt32LE(0, 38); // External file attributes
    centralEntry.writeUInt32LE(offset, 42); // Relative offset of local header
    nameBuffer.copy(centralEntry, 46);

    centralEntries.push(centralEntry);

    offset += localHeader.length + compressed.length;
  }

  const cdOffset = offset;
  const cdSize = centralEntries.reduce((sum, e) => sum + e.length, 0);

  // End of central directory record
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0); // EOCD signature
  eocd.writeUInt16LE(0, 4); // Disk number
  eocd.writeUInt16LE(0, 6); // Disk number with CD
  eocd.writeUInt16LE(files.size, 8); // Entries on this disk
  eocd.writeUInt16LE(files.size, 10); // Total entries
  eocd.writeUInt32LE(cdSize, 12); // CD size
  eocd.writeUInt32LE(cdOffset, 16); // CD offset
  eocd.writeUInt16LE(0, 20); // Comment length

  return Buffer.concat([...localHeaders, ...centralEntries, eocd]);
}

// ── Helpers ─────────────────────────────────────────────────────────

function escapeXml(str: string): string {
  return str
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&apos;");
}

/**
 * Compute CRC-32 for a buffer.
 * Standard polynomial 0xEDB88320 (bit-reversed form).
 */
function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let j = 0; j < 8; j++) {
      crc = crc & 1 ? (crc >>> 1) ^ 0xedb88320 : crc >>> 1;
    }
  }
  return (crc ^ 0xffffffff) >>> 0;
}
