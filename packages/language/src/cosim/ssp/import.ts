// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * SSP archive importer.
 *
 * Extracts an `.ssp` archive (ZIP) containing a `SystemStructure.ssd` and
 * FMU resources, parses the system structure, stores embedded FMUs via
 * `FmuStorage`, and constructs a fully wired `CoSimSession`.
 */

import { inflateRawSync } from "zlib";
import type { FmuStorage } from "../fmu/storage.js";
import { CoSimSession } from "../session.js";
import { parseSsd, parseSsv } from "./ssd-parser.js";
import type { SspSystem } from "./types.js";

/** Options for SSP import. */
export interface SspImportOptions {
  /** Override session experiment start time. */
  startTime?: number;
  /** Override session experiment stop time. */
  stopTime?: number;
  /** Communication step size. */
  stepSize?: number;
}

/** Result of an SSP import operation. */
export interface SspImportResult {
  /** The created co-simulation session. */
  session: CoSimSession;
  /** Parsed SSP system structure. */
  system: SspSystem;
  /** IDs of stored FMUs (component name → FMU storage ID). */
  fmuIds: Map<string, string>;
  /** Warnings encountered during import. */
  warnings: string[];
}

/**
 * Import an SSP archive into a CoSimSession.
 *
 * @param data       Raw SSP archive bytes (ZIP format)
 * @param storage    FMU storage for persisting embedded FMUs
 * @param options    Optional experiment overrides
 * @returns Import result with the configured session
 */
export function importSsp(data: Buffer, storage: FmuStorage, options?: SspImportOptions): SspImportResult {
  const warnings: string[] = [];
  const fmuIds = new Map<string, string>();

  // 1. Extract SystemStructure.ssd from the ZIP
  const ssdXml = extractFileFromSspZip(data, "SystemStructure.ssd");
  if (!ssdXml) {
    throw new Error("Invalid SSP archive: SystemStructure.ssd not found");
  }

  // 2. Parse the SSD
  const system = parseSsd(ssdXml);

  // 3. Determine experiment parameters
  const startTime = options?.startTime ?? system.defaultExperiment?.startTime ?? 0;
  const stopTime = options?.stopTime ?? system.defaultExperiment?.stopTime ?? 1;
  const stepSize = options?.stepSize ?? 0.01;

  // 4. Create the session
  const sessionId = `ssp-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`;
  const session = new CoSimSession(sessionId, { startTime, stopTime, stepSize });

  // 5. Extract and store embedded FMUs
  for (const component of system.components) {
    if (!component.source) {
      warnings.push(`Component '${component.name}' has no source FMU reference`);
      continue;
    }

    // SSP resources are typically under "resources/" in the archive
    const fmuPath = component.source.startsWith("resources/") ? component.source : `resources/${component.source}`;
    const fmuData = extractBinaryFromSspZip(data, fmuPath);

    if (!fmuData) {
      // Also try without "resources/" prefix
      const altData = extractBinaryFromSspZip(data, component.source);
      if (!altData) {
        warnings.push(`FMU '${component.source}' for component '${component.name}' not found in archive`);
        continue;
      }
      // Store the FMU
      const fmuId = `ssp-${component.name}-${Date.now()}`;
      storage.store(fmuId, component.source, altData);
      fmuIds.set(component.name, fmuId);
    } else {
      const fmuId = `ssp-${component.name}-${Date.now()}`;
      const filename = component.source.split("/").pop() ?? component.source;
      storage.store(fmuId, filename, fmuData);
      fmuIds.set(component.name, fmuId);
    }
  }

  // 6. Add couplings from SSD connections
  // Note: actual participants need to be created by the caller using the stored FMUs.
  // We store the connection info in the session's coupling graph for later participant
  // wiring. Since participants haven't been added yet, we can't call session.addCoupling()
  // directly (it validates participant existence). Instead, return the system structure
  // and let the caller wire things up.

  // 7. Parse parameter bindings (inline SSV values)
  for (const binding of system.parameterBindings) {
    // If binding references an external .ssv file, try to extract it
    if (binding.source && binding.values.length === 0) {
      const ssvPath = binding.source.startsWith("resources/") ? binding.source : `resources/${binding.source}`;
      const ssvXml = extractFileFromSspZip(data, ssvPath) ?? extractFileFromSspZip(data, binding.source);
      if (ssvXml) {
        const values = parseSsv(ssvXml);
        binding.values.push(...values);
      } else {
        warnings.push(`SSV file '${binding.source}' not found in archive`);
      }
    }
  }

  return { session, system, fmuIds, warnings };
}

/**
 * Wire a session's couplings from an imported SSP system.
 *
 * Call this after adding participants to the session (using the FMU IDs
 * from the import result). Maps SSP connections to variable couplings.
 *
 * @param session   The session from importSsp
 * @param system    The SSP system from importSsp
 */
export function wireSspCouplings(session: CoSimSession, system: SspSystem): string[] {
  const warnings: string[] = [];

  for (const conn of system.connections) {
    // Map SSP component names to participant IDs
    // By convention, we use the component name as the participant ID
    const fromId = conn.startElement;
    const toId = conn.endElement;

    if (!session.participants.has(fromId)) {
      warnings.push(`Source participant '${fromId}' not found when wiring connection`);
      continue;
    }
    if (!session.participants.has(toId)) {
      warnings.push(`Target participant '${toId}' not found when wiring connection`);
      continue;
    }

    session.addCoupling({
      from: { participantId: fromId, variableName: conn.startConnector },
      to: { participantId: toId, variableName: conn.endConnector },
    });
  }

  return warnings;
}

/**
 * Apply SSP parameter bindings to session participants.
 *
 * @param session The session with participants added
 * @param system  The SSP system with parsed parameter bindings
 */
export function applySspParameters(session: CoSimSession, system: SspSystem): void {
  for (const binding of system.parameterBindings) {
    for (const param of binding.values) {
      // If prefix is set, target that specific component
      if (binding.prefix && session.participants.has(binding.prefix)) {
        session.queueParameterChange(binding.prefix, param.name, param.value);
      }
    }
  }
}

// ── ZIP extraction helpers ──────────────────────────────────────────

/**
 * Extract a text file from a ZIP archive by name.
 * Same algorithm as fmu/storage.ts extractFileFromZip.
 */
function extractFileFromSspZip(zipData: Buffer, targetName: string): string | null {
  const result = extractBinaryFromSspZip(zipData, targetName);
  return result ? result.toString("utf-8") : null;
}

/**
 * Extract a binary file from a ZIP archive by name.
 */
function extractBinaryFromSspZip(zipData: Buffer, targetName: string): Buffer | null {
  // Find End of Central Directory record
  let eocdOffset = -1;
  for (let i = zipData.length - 22; i >= 0; i--) {
    if (zipData.readUInt32LE(i) === 0x06054b50) {
      eocdOffset = i;
      break;
    }
  }
  if (eocdOffset === -1) return null;

  const cdOffset = zipData.readUInt32LE(eocdOffset + 16);
  const cdSize = zipData.readUInt32LE(eocdOffset + 12);
  const cdEnd = cdOffset + cdSize;

  // Scan central directory for the target file
  let pos = cdOffset;
  while (pos < cdEnd) {
    if (zipData.readUInt32LE(pos) !== 0x02014b50) break;

    const compressionMethod = zipData.readUInt16LE(pos + 10);
    const compressedSize = zipData.readUInt32LE(pos + 20);
    const fileNameLength = zipData.readUInt16LE(pos + 28);
    const extraLength = zipData.readUInt16LE(pos + 30);
    const commentLength = zipData.readUInt16LE(pos + 32);
    const localHeaderOffset = zipData.readUInt32LE(pos + 42);
    const fileName = zipData.subarray(pos + 46, pos + 46 + fileNameLength).toString("utf-8");

    if (fileName === targetName) {
      // Read from local file header
      const localPos = localHeaderOffset;
      if (zipData.readUInt32LE(localPos) !== 0x04034b50) return null;

      const localFileNameLen = zipData.readUInt16LE(localPos + 26);
      const localExtraLen = zipData.readUInt16LE(localPos + 28);
      const dataStart = localPos + 30 + localFileNameLen + localExtraLen;

      if (compressionMethod === 0) {
        // Stored (no compression)
        return Buffer.from(zipData.subarray(dataStart, dataStart + compressedSize));
      } else if (compressionMethod === 8) {
        // Deflated
        try {
          return inflateRawSync(zipData.subarray(dataStart, dataStart + compressedSize));
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
