// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/epanet — Digital Elevation Model (DEM) Raster & Surface Analyzer.
 *
 * Provides high-performance topographic elevation sampling, continuous bilinear interpolation,
 * 3x3 Horn slope/aspect calculation, and polygon catchment average slope estimation
 * from USGS / Esri ASCII Grids (.asc, .grd) and GeoTIFF elevation matrices.
 */

export interface DemHeader {
  ncols: number;
  nrows: number;
  xllcorner: number;
  yllcorner: number;
  cellsize: number;
  nodataValue: number;
}

export type InterpolationMethod = "bilinear" | "nearest";

export class DemRaster {
  public readonly ncols: number;
  public readonly nrows: number;
  public readonly xllcorner: number;
  public readonly yllcorner: number;
  public readonly cellsize: number;
  public readonly nodataValue: number;
  public readonly elevations: Float32Array;

  public readonly xmax: number;
  public readonly ymax: number;

  constructor(header: DemHeader, elevations: Float32Array | number[]) {
    this.ncols = header.ncols;
    this.nrows = header.nrows;
    this.xllcorner = header.xllcorner;
    this.yllcorner = header.yllcorner;
    this.cellsize = header.cellsize;
    this.nodataValue = header.nodataValue;

    if (elevations instanceof Float32Array) {
      this.elevations = elevations;
    } else {
      this.elevations = new Float32Array(elevations);
    }

    this.xmax = this.xllcorner + this.ncols * this.cellsize;
    this.ymax = this.yllcorner + this.nrows * this.cellsize;
  }

  /**
   * Parses an Esri / USGS ASCII Elevation Grid string (.asc, .grd).
   */
  public static parseAsciiGrid(content: string): DemRaster {
    const lines = content.split(/\r?\n/).map((l) => l.trim()).filter((l) => l.length > 0);
    const headerParams: Record<string, number> = {};
    let dataStartLine = 0;

    for (let i = 0; i < Math.min(10, lines.length); i++) {
      const line = lines[i]!;
      const parts = line.split(/\s+/);
      if (parts.length >= 2 && isNaN(Number(parts[0]))) {
        const key = parts[0]!.toLowerCase();
        const val = Number(parts[1]);
        headerParams[key] = val;
        dataStartLine = i + 1;
      } else {
        dataStartLine = i;
        break;
      }
    }

    const ncols = headerParams["ncols"] ?? 0;
    const nrows = headerParams["nrows"] ?? 0;
    let xllcorner = headerParams["xllcorner"] ?? 0;
    let yllcorner = headerParams["yllcorner"] ?? 0;
    const cellsize = headerParams["cellsize"] ?? 1.0;
    const nodataValue = headerParams["nodata_value"] ?? -9999;

    // Handle xllcenter / yllcenter if corner is not present
    if (headerParams["xllcorner"] === undefined && headerParams["xllcenter"] !== undefined) {
      xllcorner = headerParams["xllcenter"] - cellsize / 2.0;
    }
    if (headerParams["yllcorner"] === undefined && headerParams["yllcenter"] !== undefined) {
      yllcorner = headerParams["yllcenter"] - cellsize / 2.0;
    }

    const totalCells = ncols * nrows;
    const elevations = new Float32Array(totalCells);
    let cellIdx = 0;

    for (let i = dataStartLine; i < lines.length && cellIdx < totalCells; i++) {
      const rowTokens = lines[i]!.split(/\s+/);
      for (const tok of rowTokens) {
        if (tok.length === 0) continue;
        elevations[cellIdx++] = Number(tok);
        if (cellIdx >= totalCells) break;
      }
    }

    return new DemRaster(
      {
        ncols,
        nrows,
        xllcorner,
        yllcorner,
        cellsize,
        nodataValue,
      },
      elevations,
    );
  }

  public get nodata(): number {
    return this.nodataValue;
  }

  /**
   * Retrieves the raw grid value at row and column.
   * Note: row 0 corresponds to ymax (top of raster).
   */
  public getGridValue(row: number, col: number): number | null {
    if (row < 0 || row >= this.nrows || col < 0 || col >= this.ncols) {
      return null;
    }
    const val = this.elevations[row * this.ncols + col]!;
    if (val === this.nodataValue || isNaN(val)) {
      return null;
    }
    return val;
  }

  /**
   * Samples the ground elevation at geographic / projected coordinate (x, y).
   */
  public sample(x: number, y: number, method: InterpolationMethod = "bilinear"): number | null {
    if (x < this.xllcorner || x > this.xmax || y < this.yllcorner || y > this.ymax) {
      return null;
    }

    const colFloat = (x - (this.xllcorner + this.cellsize / 2.0)) / this.cellsize;
    const rowFloat = ((this.ymax - this.cellsize / 2.0) - y) / this.cellsize;

    if (method === "nearest") {
      const c = Math.min(this.ncols - 1, Math.max(0, Math.round(colFloat)));
      const r = Math.min(this.nrows - 1, Math.max(0, Math.round(rowFloat)));
      return this.getGridValue(r, c);
    }

    // Bilinear interpolation
    const clampedCol = Math.max(0, Math.min(this.ncols - 1, colFloat));
    const clampedRow = Math.max(0, Math.min(this.nrows - 1, rowFloat));

    const c0 = Math.floor(clampedCol);
    const r0 = Math.floor(clampedRow);
    const c1 = Math.min(this.ncols - 1, c0 + 1);
    const r1 = Math.min(this.nrows - 1, r0 + 1);

    const u = clampedCol - c0;
    const v = clampedRow - r0;

    const z00 = this.getGridValue(r0, c0);
    const z10 = this.getGridValue(r0, c1);
    const z01 = this.getGridValue(r1, c0);
    const z11 = this.getGridValue(r1, c1);

    if (z00 === null || z10 === null || z01 === null || z11 === null) {
      // Fallback to nearest valid cell
      return z00 ?? z10 ?? z01 ?? z11;
    }

    const zTop = (1.0 - u) * z00 + u * z10;
    const zBot = (1.0 - u) * z01 + u * z11;
    return (1.0 - v) * zTop + v * zBot;
  }

  /**
   * Computes ground slope percentage (rise / run * 100%) and compass aspect (0..360 deg)
   * at coordinate (x, y) using Horn's 3x3 finite-difference convolution.
   */
  public sampleSlopeAspect(x: number, y: number): { slopePct: number; aspectDeg: number } {
    const colFloat = (x - (this.xllcorner + this.cellsize / 2.0)) / this.cellsize;
    const rowFloat = ((this.ymax - this.cellsize / 2.0) - y) / this.cellsize;
    const r = Math.round(rowFloat);
    const c = Math.round(colFloat);

    if (r <= 0 || r >= this.nrows - 1 || c <= 0 || c >= this.ncols - 1) {
      return { slopePct: 0, aspectDeg: 0 };
    }

    const z00 = this.getGridValue(r - 1, c - 1);
    const z01 = this.getGridValue(r - 1, c);
    const z02 = this.getGridValue(r - 1, c + 1);
    const z10 = this.getGridValue(r, c - 1);
    const z12 = this.getGridValue(r, c + 1);
    const z20 = this.getGridValue(r + 1, c - 1);
    const z21 = this.getGridValue(r + 1, c);
    const z22 = this.getGridValue(r + 1, c + 1);

    if (
      z00 === null ||
      z01 === null ||
      z02 === null ||
      z10 === null ||
      z12 === null ||
      z20 === null ||
      z21 === null ||
      z22 === null
    ) {
      return { slopePct: 0, aspectDeg: 0 };
    }

    // Horn's partial derivatives
    const dzdx = (z02 + 2.0 * z12 + z22 - (z00 + 2.0 * z10 + z20)) / (8.0 * this.cellsize);
    const dzdy = (z00 + 2.0 * z01 + z02 - (z20 + 2.0 * z21 + z22)) / (8.0 * this.cellsize);

    const gradient = Math.sqrt(dzdx * dzdx + dzdy * dzdy);
    const slopePct = gradient * 100.0;

    const aspectRad = Math.atan2(dzdy, -dzdx);
    let aspectDeg = (aspectRad * 180.0) / Math.PI;
    aspectDeg = (450.0 - aspectDeg) % 360.0;

    return { slopePct, aspectDeg };
  }

  /**
   * Computes ground slope percentage (rise / run * 100%) at coordinate (x, y).
   */
  public computeSlopePct(x: number, y: number): number | null {
    const res = this.sampleSlopeAspect(x, y);
    return res.slopePct > 0 ? res.slopePct : null;
  }

  /**
   * Estimates average ground slope (%) inside a polygon subcatchment boundary.
   */
  public samplePolygonAverageSlope(polygonRing: [number, number][]): number {
    if (polygonRing.length < 3) return 1.0; // default 1%

    let minX = Infinity;
    let maxX = -Infinity;
    let minY = Infinity;
    let maxY = -Infinity;

    for (const [x, y] of polygonRing) {
      if (x < minX) minX = x;
      if (x > maxX) maxX = x;
      if (y < minY) minY = y;
      if (y > maxY) maxY = y;
    }

    // Point in polygon test (Ray-casting)
    const isInside = (qx: number, qy: number): boolean => {
      let inside = false;
      for (let i = 0, j = polygonRing.length - 1; i < polygonRing.length; j = i++) {
        const xi = polygonRing[i]![0];
        const yi = polygonRing[i]![1];
        const xj = polygonRing[j]![0];
        const yj = polygonRing[j]![1];

        const intersect = yi > qy !== yj > qy && qx < ((xj - xi) * (qy - yi)) / (yj - yi) + xi;
        if (intersect) inside = !inside;
      }
      return inside;
    };

    let totalSlope = 0.0;
    let count = 0;
    const step = Math.max(this.cellsize, (maxX - minX) / 10.0);

    for (let x = minX + step / 2; x <= maxX; x += step) {
      for (let y = minY + step / 2; y <= maxY; y += step) {
        if (isInside(x, y)) {
          const slope = this.computeSlopePct(x, y);
          if (slope !== null && slope >= 0.01) {
            totalSlope += slope;
            count++;
          }
        }
      }
    }

    return count > 0 ? totalSlope / count : 1.0; // default 1% fallback
  }
}
