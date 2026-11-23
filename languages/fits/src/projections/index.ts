// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/fits — Projections to CSV, JSON Metadata, CCSDS Observation Metadata & SVG Preview.
 */

import { computeImageStatistics } from "../solver/photometry.js";
import { extractWcsFromHeader, pixelToWorld } from "../solver/wcs.js";
import type { FitsDocument, FitsHdu, FitsWcsParams, ImageStatistics } from "../types.js";

function csvEscape(value: unknown): string {
  const s = value === null || value === undefined ? "" : String(value);
  if (s.includes(",") || s.includes('"') || s.includes("\n")) {
    return `"${s.replace(/"/g, '""')}"`;
  }
  return s;
}

/**
 * Projects a FITS HDU to CSV:
 * - For `TABLE`/`BINTABLE` HDUs: exports tabular columns & rows.
 * - For `PRIMARY`/`IMAGE` HDUs with 2D pixel data: exports pixel coordinates `(x, y, value)` (plus `ra_deg, dec_deg` if WCS is present).
 * - For header-only HDUs: exports header cards `(keyword, value, comment)`.
 */
export function fitsToCsv(doc: FitsDocument, hduIndex = 0): string {
  const hdu = doc.hdus[hduIndex] ?? doc.hdus[0];
  if (!hdu) return "";

  if (hdu.table && hdu.table.columns.length > 0) {
    const headers = hdu.table.columns.map((c) => csvEscape(c.name)).join(",");
    const lines = [headers];
    for (const row of hdu.table.rows) {
      lines.push(hdu.table.columns.map((c) => csvEscape(row[c.name])).join(","));
    }
    return lines.join("\n") + "\n";
  }

  if (hdu.image && hdu.image.axes.length >= 2 && hdu.image.data.length > 0) {
    const width = hdu.image.axes[0]!;
    const height = hdu.image.axes[1]!;
    const wcs = extractWcsFromHeader(hdu.header);
    const lines = [wcs ? "x,y,value,ra_deg,dec_deg" : "x,y,value"];
    for (let y = 0; y < height; y++) {
      for (let x = 0; x < width; x++) {
        const val = hdu.image.data[y * width + x] ?? 0;
        if (wcs) {
          const sky = pixelToWorld(wcs, { x: x + 1, y: y + 1 });
          lines.push(`${x + 1},${y + 1},${val},${sky.raDeg.toFixed(6)},${sky.decDeg.toFixed(6)}`);
        } else {
          lines.push(`${x + 1},${y + 1},${val}`);
        }
      }
    }
    return lines.join("\n") + "\n";
  }

  const lines = ["keyword,value,comment"];
  for (const card of hdu.header.cards) {
    if (card.keyword === "" || card.keyword === "END") continue;
    lines.push([csvEscape(card.keyword), csvEscape(card.value), csvEscape(card.comment)].join(","));
  }
  return lines.join("\n") + "\n";
}

export interface FitsHduMetadataJson {
  index: number;
  kind: string;
  name: string;
  cardCount: number;
  keywords: Record<string, boolean | number | string | [number, number] | null>;
  wcs?: FitsWcsParams | undefined;
  imageShape?: number[] | undefined;
  statistics?: ImageStatistics | undefined;
  tableSummary?: { rowCount: number; columns: string[] } | undefined;
}

export interface FitsMetadataJson {
  uri?: string | undefined;
  isBinary: boolean;
  binaryByteLength?: number | undefined;
  hduCount: number;
  hdus: FitsHduMetadataJson[];
}

/**
 * Projects a `FitsDocument` to structured JSON metadata including parsed keywords,
 * WCS parameters, image statistics, and table column summaries.
 */
export function fitsToJsonMetadata(doc: FitsDocument): FitsMetadataJson {
  const hdus: FitsHduMetadataJson[] = doc.hdus.map((hdu: FitsHdu) => {
    const keywords: Record<string, boolean | number | string | [number, number] | null> = {};
    for (const [k, card] of Object.entries(hdu.header.keywords)) {
      keywords[k] = card.value;
    }
    const wcs = extractWcsFromHeader(hdu.header);
    const statistics = hdu.image && hdu.image.data.length > 0 ? computeImageStatistics(hdu.image.data) : undefined;
    const tableSummary = hdu.table
      ? { rowCount: hdu.table.rowCount, columns: hdu.table.columns.map((c) => c.name) }
      : undefined;

    return {
      index: hdu.index,
      kind: hdu.kind,
      name: hdu.name ?? `HDU_${hdu.index}`,
      cardCount: hdu.header.cards.length,
      keywords,
      wcs,
      imageShape: hdu.image?.axes,
      statistics,
      tableSummary,
    };
  });

  return {
    uri: doc.uri,
    isBinary: doc.isBinary,
    binaryByteLength: doc.binaryByteLength,
    hduCount: doc.hdus.length,
    hdus,
  };
}

/**
 * Projects FITS observation & WCS astrometry metadata into a CCSDS KVN Tracking/Observation
 * metadata block (interoperable with `@modelscript/ccsds`).
 */
export function fitsToCcsdsMetadata(doc: FitsDocument, hduIndex = 0): string {
  const hdu = doc.hdus[hduIndex] ?? doc.hdus[0];
  const kw = hdu?.header.keywords ?? {};
  const objectName = typeof kw["OBJECT"]?.value === "string" ? kw["OBJECT"]!.value : (hdu?.name ?? "FITS_TARGET");
  const dateObs = typeof kw["DATE-OBS"]?.value === "string" ? kw["DATE-OBS"]!.value : "2026-01-01T00:00:00.000";
  const origin = typeof kw["ORIGIN"]?.value === "string" ? kw["ORIGIN"]!.value : "MODELSCRIPT_FITS";
  const telescope = typeof kw["TELESCOP"]?.value === "string" ? kw["TELESCOP"]!.value : "UNKNOWN_TELESCOPE";
  const wcs = hdu ? extractWcsFromHeader(hdu.header) : undefined;

  const lines = [
    "CCSDS_TDM_VERS = 2.0",
    `CREATION_DATE = ${dateObs}`,
    `ORIGINATOR = ${origin}`,
    "",
    "META_START",
    "TIME_SYSTEM = UTC",
    `PARTICIPANT_1 = ${telescope}`,
    `PARTICIPANT_2 = ${objectName}`,
    "ANGLE_TYPE = RADEC",
    `REFERENCE_FRAME = ${wcs?.equinox === 1950 ? "B1950" : "EME2000"}`,
    "META_STOP",
    "",
    "DATA_START",
  ];

  if (wcs) {
    lines.push(`ANGLE_1 = ${dateObs} ${wcs.crval1.toFixed(6)}`);
    lines.push(`ANGLE_2 = ${dateObs} ${wcs.crval2.toFixed(6)}`);
  } else {
    lines.push(`COMMENT No WCS astrometry keywords found in HDU #${hduIndex}`);
  }
  lines.push("DATA_STOP");
  return lines.join("\n") + "\n";
}

/**
 * Projects a FITS 2D image HDU (or header summary if no image payload is present)
 * into a self-contained SVG visualization with optional WCS RA/Dec crosshair reticle.
 */
export function fitsToSvg(doc: FitsDocument, hduIndex = 0, canvasSize = 256): string {
  const hdu = doc.hdus[hduIndex] ?? doc.hdus[0];
  if (!hdu) {
    return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}" width="${canvasSize}" height="${canvasSize}"><rect width="100%" height="100%" fill="#0f172a"/></svg>`;
  }

  const wcs = extractWcsFromHeader(hdu.header);
  const title =
    typeof hdu.header.keywords["OBJECT"]?.value === "string"
      ? hdu.header.keywords["OBJECT"]!.value
      : (hdu.name ?? `HDU_${hdu.index}`);

  const parts: string[] = [
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${canvasSize} ${canvasSize}" width="${canvasSize}" height="${canvasSize}">`,
    `<rect width="${canvasSize}" height="${canvasSize}" fill="#0b1120"/>`,
  ];

  if (hdu.image && hdu.image.axes.length >= 2 && hdu.image.data.length > 0) {
    const imgW = hdu.image.axes[0]!;
    const imgH = hdu.image.axes[1]!;
    const stats = computeImageStatistics(hdu.image.data);
    const span = stats.max > stats.min ? stats.max - stats.min : 1.0;

    // Downsample grid to at most 32x32 SVG cells for lightweight deterministic rendering
    const cols = Math.min(imgW, 32);
    const rows = Math.min(imgH, 32);
    const cellW = canvasSize / cols;
    const cellH = canvasSize / rows;

    for (let r = 0; r < rows; r++) {
      const srcY = Math.min(imgH - 1, Math.floor(((rows - 1 - r) * imgH) / rows));
      for (let c = 0; c < cols; c++) {
        const srcX = Math.min(imgW - 1, Math.floor((c * imgW) / cols));
        const val = hdu.image.data[srcY * imgW + srcX] ?? stats.min;
        const norm = Math.max(0, Math.min(1, (val - stats.min) / span));
        const lum = Math.round(norm * 255);
        const hex = lum.toString(16).padStart(2, "0");
        parts.push(
          `<rect x="${(c * cellW).toFixed(2)}" y="${(r * cellH).toFixed(2)}" width="${(cellW + 0.5).toFixed(2)}" height="${(cellH + 0.5).toFixed(2)}" fill="#${hex}${hex}${hex}"/>`,
        );
      }
    }
  }

  // WCS reticle overlay at image center
  const mid = canvasSize / 2;
  parts.push(
    `<line x1="${mid - 14}" y1="${mid}" x2="${mid + 14}" y2="${mid}" stroke="#38bdf8" stroke-width="1.2"/>`,
    `<line x1="${mid}" y1="${mid - 14}" x2="${mid}" y2="${mid + 14}" stroke="#38bdf8" stroke-width="1.2"/>`,
    `<circle cx="${mid}" cy="${mid}" r="8" fill="none" stroke="#38bdf8" stroke-width="1"/>`,
    `<rect x="6" y="6" width="${canvasSize - 12}" height="24" rx="4" fill="#0f172a" fill-opacity="0.78"/>`,
    `<text x="12" y="21" font-family="monospace" font-size="10" fill="#f8fafc">${title}${wcs ? ` (${wcs.projection} RA=${wcs.crval1.toFixed(2)} Dec=${wcs.crval2.toFixed(2)})` : ""}</text>`,
    "</svg>",
  );

  return parts.join("");
}
