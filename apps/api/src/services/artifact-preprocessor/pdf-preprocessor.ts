// SPDX-License-Identifier: AGPL-3.0-or-later

import { execFileSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import type { PreprocessResult } from "./types.js";

/**
 * Extract PDF page count, metadata, and render a first-page PNG thumbnail.
 * Uses Poppler (`pdfinfo` + `pdftoppm`) with a MuPDF (`mutool`) and binary buffer fallback.
 */
export function preprocessPdfFile(
  safeFilePath: string,
  originalFilename: string,
  resolvedDir: string,
): PreprocessResult {
  const result: PreprocessResult = {};
  const safeFilename = path.basename(safeFilePath);
  const thumbFilename = `${safeFilename}.thumb.png`;
  const thumbPath = path.resolve(resolvedDir, thumbFilename);
  const metaPath = path.resolve(resolvedDir, `${safeFilename}.meta.json`);

  let fileSize = 0;
  try {
    fileSize = fs.statSync(safeFilePath).size;
  } catch {
    return result;
  }

  let pageCount: number | undefined;
  let pdfTitle: string | undefined;
  let pdfAuthor: string | undefined;
  let pageSize: string | undefined;

  // Read cached metadata if already extracted
  if (fs.existsSync(metaPath)) {
    try {
      const cached = JSON.parse(fs.readFileSync(metaPath, "utf-8")) as Record<string, unknown>;
      if (typeof cached["pageCount"] === "number" && cached["pageCount"] > 0) {
        pageCount = cached["pageCount"];
      }
      if (typeof cached["pdfTitle"] === "string" && cached["pdfTitle"].trim()) {
        pdfTitle = cached["pdfTitle"].trim();
      }
      if (typeof cached["pdfAuthor"] === "string" && cached["pdfAuthor"].trim()) {
        pdfAuthor = cached["pdfAuthor"].trim();
      }
      if (typeof cached["pageSize"] === "string" && cached["pageSize"].trim()) {
        pageSize = cached["pageSize"].trim();
      }
    } catch {
      // Recompute below
    }
  }

  if (pageCount === undefined) {
    try {
      const infoOut = execFileSync("pdfinfo", [safeFilePath], {
        encoding: "utf-8",
        timeout: 5000,
        stdio: ["ignore", "pipe", "ignore"],
      });
      for (const rawLine of infoOut.split(/\r?\n/)) {
        const colonIdx = rawLine.indexOf(":");
        if (colonIdx <= 0) continue;
        const key = rawLine.slice(0, colonIdx).trim().toLowerCase();
        const val = rawLine.slice(colonIdx + 1).trim();
        if (!val) continue;
        if (key === "pages") {
          const n = parseInt(val, 10);
          if (Number.isFinite(n) && n > 0) pageCount = n;
        } else if (key === "title") {
          if (val.toLowerCase() !== "untitled" && !/^microsoft word\b/i.test(val)) {
            pdfTitle = val;
          }
        } else if (key === "author") {
          pdfAuthor = val;
        } else if (key === "page size") {
          pageSize = val;
        }
      }
    } catch {
      // Fallback: scan raw PDF bytes for /Type /Page or /Count
      try {
        const rawBuf = fs.readFileSync(safeFilePath);
        const latin1 = rawBuf.toString("latin1");
        const pageMatches = latin1.match(/\/Type\s*\/Page\b(?!s)/g);
        if (pageMatches && pageMatches.length > 0) {
          pageCount = pageMatches.length;
        } else {
          const countMatches = Array.from(latin1.matchAll(/\/Count\s+(\d+)/g)).map((m) => parseInt(m[1]!, 10));
          const maxCount = countMatches.length > 0 ? Math.max(...countMatches.filter((n) => Number.isFinite(n))) : 0;
          if (maxCount > 0) pageCount = maxCount;
        }
      } catch {
        // Ignore fallback error
      }
    }
  }

  // Generate first-page PNG thumbnail if not yet on disk
  if (!fs.existsSync(thumbPath) && thumbPath.startsWith(resolvedDir + path.sep)) {
    const outPrefix = path.resolve(resolvedDir, `${safeFilename}.thumb`);
    try {
      execFileSync(
        "pdftoppm",
        ["-png", "-f", "1", "-l", "1", "-scale-to", "1024", "-singlefile", safeFilePath, outPrefix],
        {
          timeout: 10000,
          stdio: "ignore",
        },
      );
    } catch {
      try {
        execFileSync("mutool", ["draw", "-o", thumbPath, "-r", "150", safeFilePath, "1"], {
          timeout: 10000,
          stdio: "ignore",
        });
      } catch {
        // Both CLI renderers unavailable or failed
      }
    }
  }

  const hasThumb = fs.existsSync(thumbPath);
  const thumbnailUrl = hasThumb ? `/api/v1/storage/uploads/${thumbFilename}` : undefined;

  const metaPayload: Record<string, unknown> = {
    ...(pageCount !== undefined ? { pageCount } : {}),
    ...(fileSize > 0 ? { fileSize } : {}),
    ...(pdfTitle ? { pdfTitle } : {}),
    ...(pdfAuthor ? { pdfAuthor } : {}),
    ...(pageSize ? { pageSize } : {}),
    ...(thumbnailUrl ? { thumbnailUrl } : {}),
  };

  if (metaPath.startsWith(resolvedDir + path.sep)) {
    try {
      fs.writeFileSync(metaPath, JSON.stringify(metaPayload), "utf-8");
    } catch {
      // Ignore cache write error
    }
  }

  if (thumbnailUrl) {
    result.thumbnailUrl = thumbnailUrl;
  }
  result.metadata = metaPayload;
  result.viewConfigAdditions = {
    title: originalFilename || path.parse(safeFilename).name,
    ...metaPayload,
  };

  return result;
}
