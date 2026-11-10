// SPDX-License-Identifier: AGPL-3.0-or-later

/**
 * @modelscript/ampl — Pure TypeScript/Node Excel (.xlsx) Table Driver (`table ... IN/OUT "EXCEL" ...`).
 */

import { createRequire } from "node:module";
import path from "node:path";

const require = createRequire(import.meta.url);

function getAdmZipClass(): any {
  try {
    return require("adm-zip");
  } catch (err) {
    throw new Error(
      `Excel (.xlsx) driver requires 'adm-zip'. Error: ${err instanceof Error ? err.message : String(err)}`,
    );
  }
}

/**
 * Converts a 0-indexed column number to Excel column letters (0 -> A, 1 -> B, ..., 26 -> AA).
 */
function colIndexToLetters(idx: number): string {
  let s = "";
  let n = idx;
  while (n >= 0) {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  }
  return s;
}

/**
 * Reads row records from an Excel .xlsx workbook.
 */
export function readExcelTableRows(
  xlsxFilePath: string,
  baseDir?: string,
): Record<string, string | number>[] {
  const AdmZip = getAdmZipClass();
  const absPath = baseDir ? path.resolve(baseDir, xlsxFilePath) : path.resolve(xlsxFilePath);
  const zip = new AdmZip(absPath);

  // Read shared strings if present
  const sharedStrings: string[] = [];
  const sstEntry = zip.getEntry("xl/sharedStrings.xml");
  if (sstEntry) {
    const sstXml = zip.readAsText(sstEntry);
    const siMatches = sstXml.matchAll(/<si>(.*?)<\/si>/gs);
    for (const match of siMatches) {
      const tMatch = /<t[^>]*>(.*?)<\/t>/s.exec(match[1]!);
      sharedStrings.push(tMatch ? tMatch[1]! : "");
    }
  }

  // Read sheet1.xml
  const sheetEntry =
    zip.getEntry("xl/worksheets/sheet1.xml") ??
    zip.getEntries().find((e: any) => e.entryName.startsWith("xl/worksheets/sheet") && e.entryName.endsWith(".xml"));

  if (!sheetEntry) {
    return [];
  }

  const sheetXml = zip.readAsText(sheetEntry);
  const rowMatches = sheetXml.matchAll(/<row[^>]*>(.*?)<\/row>/gs);

  const rawRows: string[][] = [];

  for (const rMatch of rowMatches) {
    const rowContent = rMatch[1]!;
    const cMatches = rowContent.matchAll(/<c\s+r="([A-Z]+)\d+"([^>]*)>(.*?)<\/c>/gs);
    const rowCells: string[] = [];

    for (const cMatch of cMatches) {
      const attrs = cMatch[2]!;
      const body = cMatch[3]!;
      const isString = attrs.includes('t="s"');
      const isInline = attrs.includes('t="inlineStr"');

      let val = "";
      if (isInline) {
        const tM = /<t[^>]*>(.*?)<\/t>/s.exec(body);
        val = tM ? tM[1]! : "";
      } else {
        const vM = /<v>(.*?)<\/v>/s.exec(body);
        if (vM) {
          const rawV = vM[1]!;
          if (isString) {
            const strIdx = Number.parseInt(rawV, 10);
            val = sharedStrings[strIdx] ?? rawV;
          } else {
            val = rawV;
          }
        }
      }
      rowCells.push(val);
    }
    if (rowCells.length > 0) {
      rawRows.push(rowCells);
    }
  }

  if (rawRows.length < 2) return [];

  const headers = rawRows[0]!;
  const rows: Record<string, string | number>[] = [];

  for (let r = 1; r < rawRows.length; r++) {
    const rCells = rawRows[r]!;
    const rowObj: Record<string, string | number> = {};
    for (let c = 0; c < headers.length; c++) {
      const h = headers[c]!;
      const raw = rCells[c] ?? "";
      const num = Number(raw);
      rowObj[h] = raw !== "" && Number.isFinite(num) && !Number.isNaN(num) ? num : raw;
    }
    rows.push(rowObj);
  }

  return rows;
}

/**
 * Serializes row records into a valid standard Microsoft Excel (.xlsx) workbook.
 */
export function writeExcelTableRows(
  xlsxFilePath: string,
  rows: Record<string, string | number>[],
  baseDir?: string,
): Uint8Array {
  const AdmZip = getAdmZipClass();
  const zip = new AdmZip();

  const headers = rows.length > 0 ? Object.keys(rows[0]!) : [];

  let sheetDataXml = "<sheetData>";

  // Header row
  if (headers.length > 0) {
    sheetDataXml += '<row r="1">';
    for (let c = 0; c < headers.length; c++) {
      const cellRef = `${colIndexToLetters(c)}1`;
      const hText = headers[c]!.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
      sheetDataXml += `<c r="${cellRef}" t="inlineStr"><is><t>${hText}</t></is></c>`;
    }
    sheetDataXml += "</row>";
  }

  // Data rows
  for (let r = 0; r < rows.length; r++) {
    const rowIdx = r + 2;
    const row = rows[r]!;
    sheetDataXml += `<row r="${rowIdx}">`;
    for (let c = 0; c < headers.length; c++) {
      const cellRef = `${colIndexToLetters(c)}${rowIdx}`;
      const val = row[headers[c]!];
      if (typeof val === "number") {
        sheetDataXml += `<c r="${cellRef}"><v>${val}</v></c>`;
      } else {
        const text = String(val ?? "")
          .replace(/&/g, "&amp;")
          .replace(/</g, "&lt;")
          .replace(/>/g, "&gt;");
        sheetDataXml += `<c r="${cellRef}" t="inlineStr"><is><t>${text}</t></is></c>`;
      }
    }
    sheetDataXml += "</row>";
  }
  sheetDataXml += "</sheetData>";

  const contentTypesXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types">
  <Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml"/>
  <Default Extension="xml" ContentType="application/xml"/>
  <Override PartName="/xl/workbook.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet.main+xml"/>
  <Override PartName="/xl/worksheets/sheet1.xml" ContentType="application/vnd.openxmlformats-officedocument.spreadsheetml.worksheet+xml"/>
</Types>`;

  const relsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/officeDocument" Target="xl/workbook.xml"/>
</Relationships>`;

  const workbookXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<workbook xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main" xmlns:r="http://schemas.openxmlformats.org/officeDocument/2006/relationships">
  <sheets>
    <sheet name="Sheet1" sheetId="1" r:id="rId1"/>
  </sheets>
</workbook>`;

  const workbookRelsXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships">
  <Relationship Id="rId1" Type="http://schemas.openxmlformats.org/officeDocument/2006/relationships/worksheet" Target="worksheets/sheet1.xml"/>
</Relationships>`;

  const worksheetXml = `<?xml version="1.0" encoding="UTF-8" standalone="yes"?>
<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">
  ${sheetDataXml}
</worksheet>`;

  zip.addFile("[Content_Types].xml", Buffer.from(contentTypesXml, "utf-8"));
  zip.addFile("_rels/.rels", Buffer.from(relsXml, "utf-8"));
  zip.addFile("xl/workbook.xml", Buffer.from(workbookXml, "utf-8"));
  zip.addFile("xl/_rels/workbook.xml.rels", Buffer.from(workbookRelsXml, "utf-8"));
  zip.addFile("xl/worksheets/sheet1.xml", Buffer.from(worksheetXml, "utf-8"));

  const buffer = zip.toBuffer();
  if (xlsxFilePath) {
    const absPath = baseDir ? path.resolve(baseDir, xlsxFilePath) : path.resolve(xlsxFilePath);
    zip.writeZip(absPath);
  }
  return new Uint8Array(buffer);
}
