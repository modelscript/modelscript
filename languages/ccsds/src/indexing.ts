// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ccsds — Declarative Multi-File Workspace Indexing.
 *
 * Indexes space mission flight dynamics decks (.oem, .opm, .omm)
 * and satellite telemetry dictionaries (.xtce, .xml) into UnifiedWorkspace.
 */

import type { DslIndexFileContext } from "@modelscript/dsl";
import type { SymbolEntry, SymbolId, UnifiedWorkspace } from "@modelscript/runtime";
import { parseCcsds } from "./parser/index.js";
import type { CcsdsDocument } from "./types.js";

/**
 * Predicate to disambiguate CCSDS / OMG XTCE documents from other XML formats.
 */
export function canIndexCcsds(uri: string, text?: string): boolean {
  const lower = uri.split(/[?#]/)[0]!.toLowerCase();
  if (lower.endsWith(".oem") || lower.endsWith(".opm") || lower.endsWith(".omm") || lower.endsWith(".xtce")) {
    return true;
  }
  if (lower.endsWith(".xml")) {
    if (!text) return true;
    return /<\s*(?:\w+:)?SpaceSystem\b|CCSDS_(?:OEM|OPM|OMM)_VERS\b/i.test(text);
  }
  return false;
}

/**
 * Declarative file indexer for CCSDS astrodynamics and XTCE telemetry documents.
 */
export function indexCcsdsDocument(ctx: DslIndexFileContext): void {
  const doc = parseCcsds(ctx.text, ctx.uri);
  ctx.setParsedModel<CcsdsDocument>(doc);

  const addSym = (
    name: string,
    kind: string,
    parentId: SymbolId | null = null,
    extra?: Record<string, unknown>,
  ): SymbolId =>
    ctx.addSymbol(name, kind, parentId, 0, 0, extra ?? {}, {
      ruleName: `ccsds_${kind}`,
    });

  if (doc.format === "XTCE") {
    const rootId = addSym(doc.name, "space_system", null, {
      format: doc.format,
      parameterCount: doc.parameters.length,
      containerCount: doc.containers.length,
      commandCount: doc.commands.length,
    });

    for (const p of doc.parameters) {
      addSym(p.name, "telemetry_parameter", rootId, {
        paramType: p.paramType,
        bitLength: p.bitLength,
        units: p.units,
      });
    }

    for (const c of doc.containers) {
      addSym(c.name, "telemetry_container", rootId, {
        entryCount: c.entries.length,
      });
    }

    for (const cmd of doc.commands) {
      addSym(cmd.name, "telecommand", rootId, {
        argumentCount: cmd.arguments.length,
      });
    }
  } else {
    const rootId = addSym(doc.metadata.objectName, "spacecraft", null, {
      format: doc.format,
      objectId: doc.metadata.objectId,
      refFrame: doc.metadata.refFrame,
      timeSystem: doc.metadata.timeSystem,
    });

    if (doc.format === "OEM") {
      addSym("EphemerisTrajectory", "ephemeris_track", rootId, {
        pointCount: doc.points.length,
        startTime: doc.metadata.startTime ?? doc.points[0]?.epoch ?? "",
        stopTime: doc.metadata.stopTime ?? doc.points[doc.points.length - 1]?.epoch ?? "",
      });
    } else if (doc.format === "OPM") {
      addSym("StateVector", "state_vector", rootId, {
        epoch: doc.stateVector.epoch,
        position: [doc.stateVector.x, doc.stateVector.y, doc.stateVector.z],
        velocity: [doc.stateVector.vx, doc.stateVector.vy, doc.stateVector.vz],
      });
      if (doc.keplerian) {
        addSym("KeplerianOrbit", "keplerian_elements", rootId, {
          semiMajorAxisKm: doc.keplerian.semiMajorAxisKm,
          eccentricity: doc.keplerian.eccentricity,
          inclinationDeg: doc.keplerian.inclinationDeg,
        });
      }
    } else if (doc.format === "OMM") {
      addSym("MeanKeplerianOrbit", "keplerian_elements", rootId, {
        semiMajorAxisKm: doc.meanElements.semiMajorAxisKm,
        eccentricity: doc.meanElements.eccentricity,
        inclinationDeg: doc.meanElements.inclinationDeg,
      });
    }

    if ("spacecraft" in doc && doc.spacecraft) {
      addSym("SpacecraftProperties", "spacecraft_properties", rootId, {
        massKg: doc.spacecraft.massKg,
        dragAreaM2: doc.spacecraft.dragAreaM2,
      });
    }
  }
}

/**
 * Retrieves the parsed `CcsdsDocument` stored in `UnifiedWorkspace` for `uri`.
 */
export function getCcsdsDocument(workspace: UnifiedWorkspace, uri: string): CcsdsDocument | undefined {
  return workspace.getParsedModel<CcsdsDocument>(uri);
}

/**
 * Finds all indexed CCSDS symbols matching `kind` across `workspace`.
 */
export function findCcsdsSymbolsByType(workspace: UnifiedWorkspace, kind: string): SymbolEntry[] {
  return workspace.getSymbolsForUri().filter((sym) => sym.kind === kind || sym.ruleName === `ccsds_${kind}`);
}
