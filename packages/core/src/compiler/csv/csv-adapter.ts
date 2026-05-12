// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * CSV Polyglot Adapter
 *
 * Transcompiles a CSV file into a Modelica package containing constant arrays.
 * This allows CSV data to be indexed by the polyglot WorkspaceIndex and imported
 * directly into Modelica models as if it were code.
 */
export function parseCsvToModelica(csvText: string, modelName: string): string {
  const lines = csvText.split(/\r?\n/).filter((l) => l.trim().length > 0);
  if (lines.length < 2) {
    return `package ${modelName}\nend ${modelName};`;
  }

  // Detect delimiter from first line (comma, semicolon, tab)
  const headerLine = lines[0] as string;
  const delimiter = headerLine.includes("\t") ? "\t" : headerLine.includes(";") ? ";" : ",";
  const headers = headerLine.split(delimiter).map((h) => h.trim().replace(/[^a-zA-Z0-9_]/g, "_"));
  const numCols = headers.length;

  const data: number[][] = [];
  for (let i = 1; i < lines.length; i++) {
    const parts = (lines[i] as string).split(delimiter);
    const row = parts.map((p) => parseFloat(p.trim()));
    if (row.length === numCols && !row.some(isNaN)) {
      data.push(row);
    }
  }

  const numRows = data.length;
  let mo = `package ${modelName}\n`;
  mo += `  // Auto-generated from CSV data\n`;
  mo += `  constant Integer numRows = ${numRows};\n`;
  mo += `  constant Integer numCols = ${numCols};\n\n`;

  // Provide the full 2D matrix
  mo += `  constant Real values[${numRows}, ${numCols}] = {\n`;
  for (let r = 0; r < numRows; r++) {
    mo += `    {${(data[r] as number[]).join(", ")}}${r < numRows - 1 ? "," : ""}\n`;
  }
  mo += `  };\n\n`;

  // Provide convenient 1D arrays for each column
  for (let c = 0; c < numCols; c++) {
    const colName = headers[c] || `col${c}`;
    const colData = data.map((row) => row[c]);
    mo += `  constant Real ${colName}[${numRows}] = {${colData.join(", ")}};\n`;
  }

  mo += `end ${modelName};\n`;
  return mo;
}
