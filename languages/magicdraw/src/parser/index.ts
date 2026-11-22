// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/magicdraw — Unified Entry Point for `.mdzip`, `.mdxml`, and `.xmi`.
 */

import { defaultContainerToolkit } from "@modelscript/runtime";
import type { MagicDrawDocument } from "../types.js";
import { extractMdzipArchive, extractMdzipBinaries, tryDecodeZipString } from "./mdzip-archive.js";
import { parseMagicDrawXmi, type ParseMagicDrawOptions } from "./xmi-parser.js";

export * from "./mdzip-archive.js";
export * from "./module-resolver.js";
export * from "./wasm-loader.js";
export * from "./xmi-parser.js";

/**
 * Parses either a binary `.mdzip` archive (`Uint8Array`), a base64/binary-encoded `.mdzip` string,
 * or raw `.mdxml` / `.xmi` XML text.
 */
export function parseMagicDraw(input: string | Uint8Array, options?: ParseMagicDrawOptions): MagicDrawDocument {
  const zipBytes = input instanceof Uint8Array ? input : tryDecodeZipString(input);
  if (zipBytes) {
    const extracted = extractMdzipArchive(zipBytes);
    if (extracted.metadata.status !== "ok") {
      return {
        metadata: extracted.metadata,
        packages: new Map(),
        classifiers: new Map(),
        stateMachines: new Map(),
        activities: new Map(),
        interactions: new Map(),
        relationships: [],
        stereotypes: [],
        diagrams: [],
        elementsById: new Map(),
        duplicateIds: [],
        unresolvedHrefs: [],
        orphanStereotypes: [],
      };
    }

    const readBinaryEntry = (entryName: string): string | undefined =>
      defaultContainerToolkit.zip.readText(zipBytes, entryName) ?? undefined;
    const readBinaryBytes = (entryName: string): Uint8Array | null =>
      defaultContainerToolkit.zip.read(zipBytes, entryName) ?? null;

    // If a split `.shared_model` exists, parse it first so primary model hrefs/refs can resolve against it
    const sharedDoc = extracted.sharedModelXml
      ? parseMagicDrawXmi(extracted.sharedModelXml, {
          ...options,
          metadata: { ...extracted.metadata, ...options?.metadata },
          readBinaryEntry,
        })
      : undefined;

    const primaryDoc = parseMagicDrawXmi(extracted.xmlText, {
      ...options,
      metadata: { ...extracted.metadata, ...options?.metadata },
      readBinaryEntry,
      externalResolver: (href) => {
        const frag = href.includes("#") ? href.slice(href.indexOf("#") + 1) : href;
        const sharedEl = sharedDoc?.elementsById.get(frag);
        if (sharedEl) {
          const sharedCls = sharedDoc?.classifiers.get(frag);
          return {
            name: sharedEl.name,
            id: sharedEl.id,
            ...(sharedCls?.unit !== undefined ? { unit: sharedCls.unit } : {}),
            isPrimitive: sharedCls?.kind === "DataType",
          };
        }
        return options?.externalResolver?.(href);
      },
    });

    if (sharedDoc) {
      for (const [k, v] of sharedDoc.packages) {
        if (!primaryDoc.packages.has(k)) primaryDoc.packages.set(k, v);
      }
      for (const [k, v] of sharedDoc.classifiers) {
        if (!primaryDoc.classifiers.has(k)) primaryDoc.classifiers.set(k, v);
      }
      for (const [k, v] of sharedDoc.stateMachines) {
        if (!primaryDoc.stateMachines.has(k)) primaryDoc.stateMachines.set(k, v);
      }
      for (const [k, v] of sharedDoc.activities) {
        if (!primaryDoc.activities.has(k)) primaryDoc.activities.set(k, v);
      }
      for (const [k, v] of sharedDoc.interactions) {
        if (!primaryDoc.interactions.has(k)) primaryDoc.interactions.set(k, v);
      }
      for (const [k, v] of sharedDoc.elementsById) {
        if (!primaryDoc.elementsById.has(k)) primaryDoc.elementsById.set(k, v);
      }
      primaryDoc.relationships.push(...sharedDoc.relationships);
      primaryDoc.stereotypes.push(...sharedDoc.stereotypes);
      primaryDoc.diagrams.push(...sharedDoc.diagrams);
    }

    primaryDoc.readBinaryBytes = readBinaryBytes;
    primaryDoc.binaries = extractMdzipBinaries(zipBytes, { includeDiagramViews: false });

    return primaryDoc;
  }

  return parseMagicDrawXmi(input as string, options);
}
