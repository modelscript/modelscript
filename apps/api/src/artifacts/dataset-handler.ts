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

import type { ArtifactHandler, ArtifactMetadata, ArtifactViewDescriptor } from "./registry.js";

/** Column metadata for a dataset. */
export interface DatasetColumn {
  name: string;
  type: "number" | "string" | "boolean";
  min?: number;
  max?: number;
  mean?: number;
  unique?: number;
}

/** Dataset-specific metadata. */
export interface DatasetDetails {
  format: "csv" | "tsv" | "json";
  columns: DatasetColumn[];
  rowCount: number;
  hasHeader: boolean;
  delimiter: string;
  previewRows: string[][];
}

export class DatasetArtifactHandler implements ArtifactHandler {
  readonly type = "dataset";
  readonly displayName = "Tabular Dataset";
  readonly extensions = [".csv", ".tsv"];

  async extractMetadata(fileBuffer: Buffer, filePath: string): Promise<ArtifactMetadata | null> {
    try {
      const content = fileBuffer.toString("utf-8");
      const ext = filePath.substring(filePath.lastIndexOf(".")).toLowerCase();

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

      // Infer column types and compute basic stats
      const colCount = hasHeader ? headers.length : (parsedRows[0]?.length ?? 0);
      for (let col = 0; col < colCount; col++) {
        const colName = hasHeader ? headers[col] : `column_${col}`;
        const values = parsedRows.map((row) => row[col]).filter((v) => v !== undefined && v !== "");

        const numericValues = values.map(Number).filter((n) => !isNaN(n));
        const isNumeric = numericValues.length > values.length * 0.8;

        if (isNumeric && numericValues.length > 0) {
          const min = Math.min(...numericValues);
          const max = Math.max(...numericValues);
          const mean = numericValues.reduce((a, b) => a + b, 0) / numericValues.length;

          columns.push({ name: colName ?? `column_${col}`, type: "number", min, max, mean });
        } else {
          const uniqueValues = new Set(values);
          columns.push({ name: colName ?? `column_${col}`, type: "string", unique: uniqueValues.size });
        }
      }

      const details: DatasetDetails = {
        format,
        columns,
        rowCount: dataLines.length,
        hasHeader,
        delimiter,
        previewRows,
      };

      return {
        type: "dataset",
        path: filePath,
        description: `${format.toUpperCase()} dataset with ${columns.length} columns and ${dataLines.length} rows`,
        mimeType: format === "tsv" ? "text/tab-separated-values" : "text/csv",
        size: fileBuffer.length,
        details: details as unknown as Record<string, unknown>,
      };
    } catch (err) {
      console.error(`[DatasetArtifactHandler] Failed to extract metadata from ${filePath}:`, err);
      return null;
    }
  }

  validate(artifact: Record<string, unknown>): string[] {
    const errors: string[] = [];

    if (!artifact.path) {
      errors.push("Dataset artifact must have a 'path' field");
    } else {
      const p = artifact.path as string;
      const validExts = [".csv", ".tsv", ".json"];
      if (!validExts.some((ext) => p.toLowerCase().endsWith(ext))) {
        errors.push(`Dataset path must end with ${validExts.join(", ")}, got: "${p}"`);
      }
    }

    return errors;
  }

  getViewDescriptor(metadata: ArtifactMetadata): ArtifactViewDescriptor | null {
    const details = metadata.details as unknown as DatasetDetails;

    return {
      viewer: "dataset-table",
      label: `Dataset (${details.rowCount} rows)`,
      icon: "table",
      config: {
        columns: details.columns,
        rowCount: details.rowCount,
        format: details.format,
        previewRows: details.previewRows,
        hasHeader: details.hasHeader,
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
