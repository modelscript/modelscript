// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * Dataset Artifact Handler
 *
 * Handles tabular data files (CSV, TSV, JSON) bundled with ModelScript packages.
 * Commonly used for:
 *   - Simulation reference data
 *   - Calibration datasets
 *   - Parameter tables
 *   - Test vectors
 *
 * At publish time, extracts:
 *   - Column names and inferred types
 *   - Row count
 *   - File format
 *   - Basic statistics (min, max, mean for numeric columns)
 *
 * The Web UI viewer renders an interactive data table with sorting and filtering.
 */

import crypto from "node:crypto";
import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

/** Column metadata for a dataset (compatible with Frictionless Table Schema Field). */
export interface DatasetColumn {
  name: string;
  type: "number" | "string" | "boolean";
  unit?: string | undefined;
  min?: number | undefined;
  max?: number | undefined;
  mean?: number | undefined;
  unique?: number | undefined;
}

/** Dataset-specific metadata (compatible with Frictionless Data Package Resource). */
export interface DatasetDetails {
  name?: string | undefined;
  profile?: string | undefined;
  format: "csv" | "tsv" | "json" | "parquet" | "arrow" | "hdf5" | "mat";
  mediatype?: string | undefined;
  bytes?: number | undefined;
  hash?: string | undefined;
  storage?: "inline" | "cas" | "s3" | undefined;
  columns: DatasetColumn[];
  schema?: { fields: DatasetColumn[] } | undefined;
  rowCount: number;
  hasHeader: boolean;
  delimiter: string;
  previewRows: string[][];
}

function parseHeaderNameAndUnit(rawHeader: string): { name: string; unit?: string | undefined } {
  const trimmed = rawHeader.trim();
  const bracketMatch = trimmed.match(/^(.+?)\s*\[([^\]]+)\]\s*$/);
  if (bracketMatch?.[1] && bracketMatch[2]) {
    return { name: bracketMatch[1].trim(), unit: bracketMatch[2].trim() };
  }
  const parenMatch = trimmed.match(/^(.+?)\s*\(([^)]+)\)\s*$/);
  if (parenMatch?.[1] && parenMatch[2]) {
    return { name: parenMatch[1].trim(), unit: parenMatch[2].trim() };
  }
  return { name: trimmed };
}

export class DatasetArtifactHandler implements ArtifactHandler {
  readonly type = "dataset";
  readonly displayName = "Engineering Dataset";
  readonly extensions = [".csv", ".tsv", ".parquet", ".arrow", ".h5", ".hdf5"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();
      const sha256 = crypto.createHash("sha256").update(fileBuffer).digest("hex");
      const hash = `sha256:${sha256}`;
      const bytes = fileBuffer.length;
      const resourceName =
        filePath
          .split("/")
          .pop()
          ?.replace(/\.[^.]+$/, "")
          .toLowerCase()
          .replace(/[^a-z0-9_-]+/g, "-") || "dataset";

      if (ext === ".parquet" || ext === ".arrow" || ext === ".h5" || ext === ".hdf5" || ext === ".mat") {
        const format: DatasetDetails["format"] =
          ext === ".parquet" ? "parquet" : ext === ".arrow" ? "arrow" : ext === ".mat" ? "mat" : "hdf5";
        const mediatype =
          format === "parquet"
            ? "application/vnd.apache.parquet"
            : format === "arrow"
              ? "application/vnd.apache.arrow.file"
              : "application/x-hdf5";
        const details: DatasetDetails = {
          name: resourceName,
          profile: "tabular-data-resource",
          format,
          mediatype,
          bytes,
          hash,
          storage: "inline",
          columns: [],
          schema: { fields: [] },
          rowCount: 0,
          hasHeader: true,
          delimiter: ",",
          previewRows: [],
        };
        return {
          type: "dataset",
          path: filePath,
          description: `${format.toUpperCase()} binary dataset (${bytes.toLocaleString()} bytes)`,
          mimeType: mediatype,
          size: bytes,
          details: details as unknown as Record<string, unknown>,
        };
      }

      const content = fileBuffer.toString("utf-8");

      const format: "csv" | "tsv" | "json" = ext === ".tsv" ? "tsv" : "csv";
      const delimiter = format === "tsv" ? "\t" : ",";

      const lines = content.split(/\r?\n/).filter((l) => l.trim().length > 0);
      if (lines.length === 0) return null;

      // Parse header
      const headerLine = lines[0] ?? "";
      if (!headerLine) return null;
      const headers = this.parseCsvLine(headerLine, delimiter);

      // Detect if first row is a header (heuristic: all non-numeric)
      const hasHeader = headers.every((h) => isNaN(Number(h)));

      const dataLines = hasHeader ? lines.slice(1) : lines;
      const columns: DatasetColumn[] = [];
      const previewRows: string[][] = [];

      // Parse first few rows for type detection and preview
      const sampleSize = Math.min(dataLines.length, 100);
      const parsedRows: string[][] = [];

      for (let i = 0; i < sampleSize; i++) {
        const line = dataLines[i] ?? "";
        if (!line) continue;
        const row = this.parseCsvLine(line, delimiter);
        parsedRows.push(row);
        if (i < 5) previewRows.push(row);
      }

      // Infer column types, physical units, and compute basic stats
      const colCount = hasHeader ? headers.length : (parsedRows[0]?.length ?? 0);
      for (let col = 0; col < colCount; col++) {
        const rawColName = hasHeader ? (headers[col] ?? `column_${col}`) : `column_${col}`;
        const { name: colName, unit } = parseHeaderNameAndUnit(rawColName);
        const values = parsedRows.map((row) => row[col]).filter((v) => v !== undefined && v !== "");

        const numericValues = values.map(Number).filter((n) => !isNaN(n));
        const isNumeric = numericValues.length > values.length * 0.8;

        if (isNumeric && numericValues.length > 0) {
          const min = Math.min(...numericValues);
          const max = Math.max(...numericValues);
          const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

          columns.push({ name: colName || `column_${col}`, type: "number", unit, min, max, mean });
        } else {
          const uniqueValues = new Set(values);
          columns.push({ name: colName || `column_${col}`, type: "string", unit, unique: uniqueValues.size });
        }
      }

      const mediatype = format === "tsv" ? "text/tab-separated-values" : "text/csv";
      const details: DatasetDetails = {
        name: resourceName,
        profile: "tabular-data-resource",
        format,
        mediatype,
        bytes,
        hash,
        storage: "inline",
        columns,
        schema: { fields: columns },
        rowCount: dataLines.length,
        hasHeader,
        delimiter,
        previewRows,
      };

      return {
        type: "dataset",
        path: filePath,
        description: `${format.toUpperCase()} dataset with ${columns.length} columns and ${dataLines.length} rows`,
        mimeType: mediatype,
        size: bytes,
        details: details as unknown as Record<string, unknown>,
      };
    } catch (err) {
      console.error(`[DatasetArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact["path"]) {
      errors.push("Dataset artifact must have a 'path' field");
    } else {
      const p = artifact["path"] as string;
      const validExts = [".csv", ".tsv", ".json", ".parquet", ".arrow", ".h5", ".hdf5", ".mat"];
      if (!validExts.some((ext) => p.toLowerCase().endsWith(ext))) {
        errors.push(`Dataset path must end with ${validExts.join(", ")}, got: "${p}"`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    const details = metadata.details as unknown as DatasetDetails;
    const cols = details.columns ?? details.schema?.fields ?? [];
    const rowCount = details.rowCount ?? 0;

    return {
      viewer: "dataset-table",
      label: rowCount > 0 ? `Dataset (${rowCount} rows)` : `Dataset (${(details.format || "csv").toUpperCase()})`,
      icon: "table",
      config: {
        name: details.name,
        profile: details.profile ?? "tabular-data-resource",
        columns: cols,
        schema: details.schema ?? { fields: cols },
        rowCount,
        format: details.format,
        mediatype: details.mediatype,
        bytes: details.bytes,
        hash: details.hash,
        storage: details.storage ?? "inline",
        previewRows: details.previewRows ?? [],
        hasHeader: details.hasHeader ?? true,
      },
    };
  }

  /**
   * Parse a single CSV/TSV line, handling quoted fields.
   */
  private parseCsvLine(line: string, delimiter: string): string[] {
    const result: string[] = [];
    let current = "";
    let inQuotes = false;

    for (let i = 0; i < line.length; i++) {
      const ch = line[i];

      if (ch === '"') {
        if (inQuotes && i + 1 < line.length && line[i + 1] === '"') {
          current += '"';
          i++;
        } else {
          inQuotes = !inQuotes;
        }
      } else if (ch === delimiter && !inQuotes) {
        result.push(current.trim());
        current = "";
      } else {
        current += ch;
      }
    }

    result.push(current.trim());
    return result;
  }
}
