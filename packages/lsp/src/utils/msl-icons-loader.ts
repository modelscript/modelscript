// SPDX-License-Identifier: AGPL-3.0-or-later

import { gunzipSync, strFromU8, unzipSync } from "fflate";
import { iconCache } from "../handlers/treeHandler.js";

let mslIconsPromise: Promise<number> | null = null;

/**
 * Pads the viewBox of an SVG icon by 2.5% if it has a non-padded coordinate system
 * (e.g. standard Modelica extents like [-100, -100, 100, 100]), ensuring that outer
 * boundary strokes and rounded rectangle corner arcs (like Modelica.Icons.Package rx=25)
 * are never clipped by the SVG viewport boundary.
 */
export function padIconViewBox(svg: string): string {
  if (!svg || !svg.includes("<svg") || svg.includes('data-viewbox-padded="true"')) return svg;
  const vbMatch = svg.match(/viewBox\s*=\s*(["'])([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\s+([-\d.]+)\1/);
  if (!vbMatch) return svg;

  const quote = vbMatch[1];
  const vx = parseFloat(vbMatch[2]!);
  const vy = parseFloat(vbMatch[3]!);
  const vw = parseFloat(vbMatch[4]!);
  const vh = parseFloat(vbMatch[5]!);

  if (isNaN(vx) || isNaN(vy) || isNaN(vw) || isNaN(vh) || vw <= 0 || vh <= 0) return svg;
  if (vx >= 0 && vy >= 0) return svg;

  const padX = vw * 0.025;
  const padY = vh * 0.025;
  const newVx = +(vx - padX).toFixed(2);
  const newVy = +(vy - padY).toFixed(2);
  const newVw = +(vw + padX * 2).toFixed(2);
  const newVh = +(vh + padY * 2).toFixed(2);

  return svg.replace(
    vbMatch[0],
    `data-viewbox-padded="true" viewBox=${quote}${newVx} ${newVy} ${newVw} ${newVh}${quote}`,
  );
}

/**
 * Loads pre-baked MSL icons into iconCache.
 * Idempotent: caches the in-flight or completed promise so it runs at most once.
 */
export function loadPrebakedMslIcons(serverDistBase?: string): Promise<number> {
  if (!mslIconsPromise) {
    mslIconsPromise = doLoadPrebakedMslIcons(serverDistBase)
      .then((count) => {
        if (count === 0) {
          mslIconsPromise = null;
        }
        return count;
      })
      .catch((err) => {
        mslIconsPromise = null;
        throw err;
      });
  }
  return mslIconsPromise;
}

async function doLoadPrebakedMslIcons(serverDistBase?: string): Promise<number> {
  // If iconCache already has MSL icons, skip
  if (iconCache.has("Modelica.Electrical.Analog.Basic.Resistor")) {
    return iconCache.size;
  }

  // Node.js environment
  if (typeof process !== "undefined" && process.versions?.node) {
    try {
      const fs = await import("node:fs");
      const path = await import("node:path");
      const { fileURLToPath } = await import("node:url");

      let currentDir = "";
      try {
        currentDir = path.dirname(fileURLToPath(import.meta.url));
      } catch {
        currentDir = process.cwd();
      }

      const candidatePaths = [
        path.resolve(currentDir, "../assets/msl-icons.json.gz"),
        path.resolve(currentDir, "../../assets/msl-icons.json.gz"),
        path.resolve(currentDir, "msl-icons.json.gz"),
        path.resolve(process.cwd(), "packages/lsp/assets/msl-icons.json.gz"),
        path.resolve(process.cwd(), "packages/lsp/dist/msl-icons.json.gz"),
        path.resolve(process.cwd(), "data/libraries/Modelica/4.1.0/lsp-bundle.zip"),
      ];

      for (const p of candidatePaths) {
        if (fs.existsSync(p)) {
          const buf = fs.readFileSync(p);
          let jsonBytes: Uint8Array | null = null;

          if (p.endsWith(".zip")) {
            const unzipped = unzipSync(new Uint8Array(buf));
            if (unzipped["icons.json"]) {
              jsonBytes = unzipped["icons.json"];
            }
          } else {
            jsonBytes = gunzipSync(new Uint8Array(buf));
          }

          if (jsonBytes) {
            const text = strFromU8(jsonBytes);
            const icons = JSON.parse(text) as Record<string, string>;
            let count = 0;
            for (const [name, svg] of Object.entries(icons)) {
              if (svg) {
                iconCache.set(name, padIconViewBox(svg));
                count++;
              }
            }
            return count;
          }
        }
      }
    } catch {
      // Fall through to network / fetch fallback
    }
  }

  // Browser / Network environment
  if (typeof fetch === "function") {
    try {
      const globalBase = (globalThis as any).serverDistBase?.replace(/\/$/, "");
      const base =
        serverDistBase &&
        (serverDistBase.startsWith("http://") ||
          serverDistBase.startsWith("https://") ||
          serverDistBase.startsWith("/"))
          ? serverDistBase.replace(/\/$/, "")
          : globalBase || "";
      const fetchUrls = [
        `${base}/msl-icons.json.gz`,
        `${base}/assets/msl-icons.json.gz`,
        "msl-icons.json.gz",
        "/lsp/server/dist/msl-icons.json.gz",
      ];

      for (const url of fetchUrls) {
        try {
          const res = await fetch(url);
          if (res.ok) {
            const buf = await res.arrayBuffer();
            const decompressed = gunzipSync(new Uint8Array(buf));
            const text = strFromU8(decompressed);
            const icons = JSON.parse(text) as Record<string, string>;
            let count = 0;
            for (const [name, svg] of Object.entries(icons)) {
              if (svg) {
                iconCache.set(name, padIconViewBox(svg));
                count++;
              }
            }
            return count;
          }
        } catch {
          // try next url
        }
      }
    } catch {
      // Ignore network errors
    }
  }

  return 0;
}
