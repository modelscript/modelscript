// SPDX-License-Identifier: AGPL-3.0-or-later

import { generateParquetBuffer } from "@modelscript/editor/internal/binary-export.js";

export interface ExportableSimulationData {
  t: number[];
  y: number[][];
  states: string[];
  comtrade?: { cfg: string; dat: string };
  pscadOut?: { inf: string; out: { suffix: string; content: string }[] };
  pscadPsout?: Uint8Array | string;
  projectName?: string;
}

export interface WebviewPostMessageLike {
  postMessage: (msg: unknown) => void;
}

export function bytesToBase64(bytes: Uint8Array): string {
  let binary = "";
  const chunkSize = 0x8000;
  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, Math.min(i + chunkSize, bytes.length)));
  }
  return btoa(binary);
}

export function decodePsoutBytes(pscadPsout: Uint8Array | string | Record<string, number>): Uint8Array {
  if (typeof pscadPsout === "string") {
    const binary = atob(pscadPsout);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return bytes;
  }
  if (pscadPsout instanceof Uint8Array) {
    return pscadPsout;
  }
  return new Uint8Array(Object.values(pscadPsout));
}

export function formatDelimitedTable(
  data: Pick<ExportableSimulationData, "t" | "y" | "states">,
  hiddenVars: ReadonlySet<string>,
  delimiter: string,
): string {
  const { t, y, states } = data;
  const visibleIndices: number[] = [];
  for (let vi = 0; vi < states.length; vi++) {
    if (!hiddenVars.has(states[vi])) visibleIndices.push(vi);
  }
  const headers = ["time", ...visibleIndices.map((vi) => states[vi])];
  const rows: string[] = [headers.join(delimiter)];
  for (let i = 0; i < t.length; i++) {
    const rowVals = [t[i].toString()];
    for (const vi of visibleIndices) {
      const val = y[i]?.[vi];
      rowVals.push(val !== undefined && isFinite(val) ? val.toString() : "");
    }
    rows.push(rowVals.join(delimiter));
  }
  return rows.join("\n");
}

export function buildVisibleRecords(
  data: Pick<ExportableSimulationData, "t" | "y" | "states"> | null,
  hiddenVars: ReadonlySet<string>,
): { columns: string[]; records: Record<string, number | string>[] } | null {
  if (!data || data.t.length === 0) return null;
  const { t, y, states } = data;
  const visibleIndices: number[] = [];
  for (let vi = 0; vi < states.length; vi++) {
    if (!hiddenVars.has(states[vi])) visibleIndices.push(vi);
  }
  const indices = visibleIndices.length > 0 ? visibleIndices : states.map((_, idx) => idx);
  const columns = ["time", ...indices.map((vi) => states[vi])];
  const records: Record<string, number | string>[] = new Array(t.length);
  for (let i = 0; i < t.length; i++) {
    const row: Record<string, number | string> = { time: t[i] };
    for (const vi of indices) {
      const val = y[i]?.[vi];
      row[states[vi]] = val !== undefined && isFinite(val) ? val : 0;
    }
    records[i] = row;
  }
  return { columns, records };
}

export function downloadTextFile(filename: string, content: string, mime: string = "text/plain"): void {
  const blob = new Blob([content], { type: `${mime};charset=utf-8;` });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function downloadBinaryFile(filename: string, bytes: Uint8Array, mime: string): void {
  const blob = new Blob([bytes as unknown as BlobPart], { type: mime });
  const url = URL.createObjectURL(blob);
  const a = document.createElement("a");
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

export function exportSimulationCsv(data: ExportableSimulationData | null, hiddenVars: ReadonlySet<string>): void {
  if (!data || data.t.length === 0) return;
  const csvContent = formatDelimitedTable(data, hiddenVars, ",");
  downloadTextFile(`simulation_data_${Date.now()}.csv`, csvContent, "text/csv");
}

export function exportCanvasPng(
  data: ExportableSimulationData | null,
  canvas: HTMLCanvasElement,
  isDark: boolean,
): void {
  if (!data || data.t.length === 0) return;
  const exportCanvas = document.createElement("canvas");
  exportCanvas.width = canvas.width;
  exportCanvas.height = canvas.height;
  const expCtx = exportCanvas.getContext("2d");
  if (!expCtx) return;
  expCtx.fillStyle = isDark ? "#1e1e1e" : "#ffffff";
  expCtx.fillRect(0, 0, exportCanvas.width, exportCanvas.height);
  expCtx.drawImage(canvas, 0, 0);

  const dataUrl = exportCanvas.toDataURL("image/png");
  const a = document.createElement("a");
  a.href = dataUrl;
  a.download = `simulation_chart_${Date.now()}.png`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
}

export async function copySimulationTsvToClipboard(
  data: ExportableSimulationData | null,
  hiddenVars: ReadonlySet<string>,
  btn: HTMLElement,
): Promise<void> {
  if (!data || data.t.length === 0) return;
  const tsvContent = formatDelimitedTable(data, hiddenVars, "\t");
  try {
    await navigator.clipboard.writeText(tsvContent);
    const orig = btn.textContent;
    btn.textContent = "✓ Copied!";
    setTimeout(() => {
      btn.textContent = orig;
    }, 1500);
  } catch (err) {
    console.error("Failed to copy data:", err);
  }
}

export function exportSimulationComtrade(data: ExportableSimulationData | null): void {
  if (!data?.comtrade) return;
  const baseName = data.projectName || "simulation";
  const { cfg, dat } = data.comtrade;
  downloadTextFile(`${baseName}.cfg`, cfg);
  setTimeout(() => {
    downloadTextFile(`${baseName}.dat`, dat);
  }, 100);
}

export function exportSimulationPscadOut(data: ExportableSimulationData | null): void {
  if (!data?.pscadOut) return;
  const baseName = data.projectName || "simulation";
  downloadTextFile(`${baseName}.inf`, data.pscadOut.inf);
  data.pscadOut.out.forEach((outFile, idx) => {
    setTimeout(
      () => {
        downloadTextFile(`${baseName}${outFile.suffix}`, outFile.content);
      },
      (idx + 1) * 100,
    );
  });
}

export function exportSimulationPscadPsout(
  data: ExportableSimulationData | null,
  vscodeApi: WebviewPostMessageLike | null,
): void {
  if (!data?.pscadPsout) return;
  const baseName = data.projectName || "simulation";
  const bytes = decodePsoutBytes(data.pscadPsout);
  if (vscodeApi) {
    vscodeApi.postMessage({
      type: "exportFile",
      filename: `${baseName}.psout`,
      content: bytesToBase64(bytes),
      encoding: "base64",
      mimeType: "application/octet-stream",
    });
    return;
  }
  downloadBinaryFile(`${baseName}.psout`, bytes, "application/octet-stream");
}

export function exportSimulationJson(
  data: ExportableSimulationData | null,
  hiddenVars: ReadonlySet<string>,
  vscodeApi: WebviewPostMessageLike | null,
): void {
  const built = buildVisibleRecords(data, hiddenVars);
  if (!built) return;
  const filename = `${data?.projectName || "simulation_data"}_${Date.now()}.json`;
  const jsonContent = JSON.stringify(built.records, null, 2);
  if (vscodeApi) {
    vscodeApi.postMessage({
      type: "exportFile",
      filename,
      content: jsonContent,
      encoding: "utf8",
      mimeType: "application/json",
    });
    return;
  }
  downloadTextFile(filename, jsonContent, "application/json");
}

export function exportSimulationParquet(
  data: ExportableSimulationData | null,
  hiddenVars: ReadonlySet<string>,
  vscodeApi: WebviewPostMessageLike | null,
): void {
  const built = buildVisibleRecords(data, hiddenVars);
  if (!built) return;
  const filename = `${data?.projectName || "simulation_data"}_${Date.now()}.parquet`;
  const parquetBytes = generateParquetBuffer(built.records, built.columns);
  if (vscodeApi) {
    vscodeApi.postMessage({
      type: "exportFile",
      filename,
      content: bytesToBase64(parquetBytes),
      encoding: "base64",
      mimeType: "application/vnd.apache.parquet",
    });
    return;
  }
  downloadBinaryFile(filename, parquetBytes, "application/vnd.apache.parquet");
}
