// SPDX-License-Identifier: AGPL-3.0-or-later

function escapeXml(str: string): string {
  return String(str).replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
}

export function buildClientTelemetrySvg(
  headers: string[],
  rows: (string | number)[][],
  fallbackTitle: string,
): string | null {
  if (headers.length === 0 || rows.length === 0) return null;

  // Identify numeric columns
  const numericColIndices: number[] = [];
  const sampleRowCount = Math.min(rows.length, 40);

  for (let c = 0; c < headers.length; c++) {
    let numericCount = 0;
    for (let r = 0; r < sampleRowCount; r++) {
      const raw = rows[r]?.[c];
      if (raw !== undefined && raw !== null && raw !== "") {
        const n = Number(raw);
        if (Number.isFinite(n)) {
          numericCount++;
        }
      }
    }
    if (numericCount / sampleRowCount >= 0.5) {
      numericColIndices.push(c);
    }
  }

  if (numericColIndices.length === 0) return null;

  const firstHeader = (headers[numericColIndices[0]!] || "").toLowerCase();
  const isFirstTimeOrIndex = /^(time|t|date|step|index|id|epoch|timestamp|sample|s)\b/i.test(firstHeader);

  let seriesIndices: number[] = [];
  if (isFirstTimeOrIndex && numericColIndices.length > 1) {
    seriesIndices = numericColIndices.slice(1, 5);
  } else {
    seriesIndices = numericColIndices.slice(0, 4);
  }

  if (seriesIndices.length === 0) return null;

  const width = 680;
  const height = 360;
  const padX = 56;
  const padTop = 68;
  const padBot = 42;
  const plotW = width - padX * 2;
  const plotH = height - padTop - padBot;
  const palette = ["#38bdf8", "#34d399", "#f43f5e", "#f59e0b", "#a855f7"];

  const maxPts = 150;
  const step = Math.max(1, Math.floor(rows.length / maxPts));
  const sampledRows: number[][] = [];
  for (let i = 0; i < rows.length; i += step) {
    sampledRows.push(rows[i]!.map((cell) => Number(cell)));
  }

  const polylines: string[] = [];
  const legendItems: string[] = [];

  seriesIndices.forEach((colIdx, sIdx) => {
    const color = palette[sIdx % palette.length]!;
    const vals = sampledRows
      .map((r) => r[colIdx])
      .filter((v): v is number => typeof v === "number" && Number.isFinite(v));
    if (vals.length === 0) return;

    const minV = Math.min(...vals);
    const maxV = Math.max(...vals);
    const span = Math.max(1e-6, maxV - minV);
    const pts = vals.map((v, i) => {
      const x = +(padX + (i / Math.max(1, vals.length - 1)) * plotW).toFixed(1);
      const y = +(padTop + plotH - ((v - minV) / span) * plotH).toFixed(1);
      return `${x},${y}`;
    });
    polylines.push(
      `<polyline fill="none" stroke="${color}" stroke-width="2.2" stroke-linecap="round" stroke-linejoin="round" points="${pts.join(" ")}" />`,
    );
    const rawLabel = headers[colIdx] || `col_${colIdx}`;
    const label = escapeXml(rawLabel.length > 18 ? `${rawLabel.slice(0, 17)}…` : rawLabel);
    const lx = padX + sIdx * 145;
    legendItems.push(
      `<rect x="${lx}" y="${height - 24}" width="10" height="10" rx="2" fill="${color}" /><text x="${lx + 15}" y="${height - 15}" fill="#cbd5e1" font-family="monospace" font-size="10">${label}</text>`,
    );
  });

  if (polylines.length === 0) return null;

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${width} ${height}" width="100%" height="100%">
    <rect width="${width}" height="${height}" rx="8" fill="#0d1117"/>
    <text x="24" y="28" fill="#e6edf3" font-family="monospace" font-size="12" font-weight="bold">CSV TELEMETRY // ${escapeXml(fallbackTitle)}</text>
    <text x="24" y="46" fill="#38bdf8" font-family="monospace" font-size="11">Channels: ${headers.length} | Samples: ${rows.length} | Normalized Multi-Trace Overlay</text>
    <rect x="${padX}" y="${padTop}" width="${plotW}" height="${plotH}" rx="4" fill="rgba(15, 23, 42, 0.65)" stroke="#1e293b" stroke-width="1"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.25}" x2="${padX + plotW}" y2="${padTop + plotH * 0.25}" stroke="#1e293b" stroke-dasharray="4 4"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.5}" x2="${padX + plotW}" y2="${padTop + plotH * 0.5}" stroke="#1e293b" stroke-dasharray="4 4"/>
    <line x1="${padX}" y1="${padTop + plotH * 0.75}" x2="${padX + plotW}" y2="${padTop + plotH * 0.75}" stroke="#1e293b" stroke-dasharray="4 4"/>
    ${polylines.join("\n    ")}
    ${legendItems.join("\n    ")}
  </svg>`;
}
