// SPDX-License-Identifier: AGPL-3.0-or-later

import type { CustomInspectionTooltipProps } from "../types";

export function CustomInspectionTooltip({
  active,
  payload,
  label,
  xAxisVar,
  minMaxMap,
  isNormalized,
  isComparingBaseline,
  rawData,
}: CustomInspectionTooltipProps) {
  if (!active || !payload || !payload.length) return null;

  const numLabel = typeof label === "number" ? label : Number(label);
  const formattedLabel = `${xAxisVar}: ${isNaN(numLabel) ? label : numLabel.toFixed(4)}${xAxisVar === "time" ? "s" : ""}`;
  const xKey = xAxisVar || "time";
  const rawRow = rawData?.find((r: any) => Math.abs(Number(r[xKey]) - Number(label)) < 1e-6);

  // Group items by base variable name to pair current value with baseline
  const grouped = new Map<string, { current?: any; baseline?: any; color: string }>();

  for (const item of payload) {
    const rawName = String(item.name || item.dataKey || "");
    const isBaseline = rawName.endsWith(" [Baseline]");
    const baseName = isBaseline ? rawName.replace(" [Baseline]", "") : rawName;

    if (!grouped.has(baseName)) {
      grouped.set(baseName, { color: item.color || item.stroke || "#58a6ff" });
    }
    const entry = grouped.get(baseName)!;
    if (isBaseline) {
      entry.baseline = item.value;
    } else {
      entry.current = item.value;
      if (item.color || item.stroke) entry.color = item.color || item.stroke;
    }
  }

  return (
    <div
      style={{
        backgroundColor: "var(--color-canvas-subtle, #161b22)",
        border: "1px solid var(--color-border-default, #30363d)",
        borderRadius: "8px",
        padding: "8px 12px",
        boxShadow: "0 6px 18px rgba(0, 0, 0, 0.4)",
        fontSize: "12px",
        color: "var(--color-fg-default, #e6edf3)",
        minWidth: "190px",
        backdropFilter: "blur(8px)",
      }}
    >
      <div
        style={{
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          borderBottom: "1px solid var(--color-border-muted, #21262d)",
          paddingBottom: "4px",
          marginBottom: "6px",
          fontWeight: 600,
          fontFamily: "var(--font-mono, monospace)",
          color: "var(--color-accent-fg, #58a6ff)",
        }}
      >
        <span>{formattedLabel}</span>
      </div>

      <div style={{ display: "flex", flexDirection: "column", gap: "6px" }}>
        {Array.from(grouped.entries()).map(([name, entry]) => {
          const curVal = entry.current !== undefined ? Number(entry.current) : null;
          const baseVal = entry.baseline !== undefined ? Number(entry.baseline) : null;

          let displayVal = curVal !== null ? (isNormalized ? `${curVal.toFixed(1)}%` : curVal.toFixed(4)) : "—";
          if (isNormalized && curVal !== null) {
            const rawFromRow = rawRow && rawRow[name] !== undefined ? Number(rawRow[name]) : NaN;
            if (!isNaN(rawFromRow)) {
              displayVal = `${rawFromRow.toFixed(4)} (${curVal.toFixed(1)}%)`;
            } else if (minMaxMap[name]) {
              const raw = (curVal / 100) * (minMaxMap[name].max - minMaxMap[name].min) + minMaxMap[name].min;
              displayVal = `${raw.toFixed(4)} (${curVal.toFixed(1)}%)`;
            }
          }

          let deltaStr: string | null = null;
          let deltaPercentStr: string | null = null;
          let isPositiveDelta = false;

          if (curVal !== null && baseVal !== null) {
            const delta = curVal - baseVal;
            isPositiveDelta = delta >= 0;
            deltaStr = `${isPositiveDelta ? "+" : ""}${delta.toFixed(4)}`;
            if (Math.abs(baseVal) > 1e-6) {
              const pct = (delta / Math.abs(baseVal)) * 100;
              deltaPercentStr = `${isPositiveDelta ? "+" : ""}${pct.toFixed(1)}%`;
            }
          }

          return (
            <div
              key={name}
              style={{
                display: "flex",
                flexDirection: "column",
                gap: "2px",
              }}
            >
              <div style={{ display: "flex", alignItems: "center", justifyContent: "space-between", gap: "10px" }}>
                <div style={{ display: "flex", alignItems: "center", gap: "6px" }}>
                  <span
                    style={{
                      width: "8px",
                      height: "8px",
                      borderRadius: "50%",
                      backgroundColor: entry.color,
                      display: "inline-block",
                      flexShrink: 0,
                    }}
                  />
                  <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 500 }}>{name}</span>
                </div>
                <span style={{ fontFamily: "var(--font-mono, monospace)", fontWeight: 600 }}>{displayVal}</span>
              </div>

              {isComparingBaseline && baseVal !== null && deltaStr && (
                <div
                  style={{
                    display: "flex",
                    justifyContent: "space-between",
                    paddingLeft: "14px",
                    fontSize: "11px",
                    color: "var(--color-fg-muted, #8b949e)",
                    fontFamily: "var(--font-mono, monospace)",
                  }}
                >
                  <span>Base: {baseVal.toFixed(4)}</span>
                  <span
                    style={{
                      color: isPositiveDelta ? "var(--color-accent-fg, #58a6ff)" : "var(--color-success-fg, #3fb950)",
                      fontWeight: 600,
                    }}
                  >
                    Δ {deltaStr} {deltaPercentStr ? `(${deltaPercentStr})` : ""}
                  </span>
                </div>
              )}
            </div>
          );
        })}
      </div>
    </div>
  );
}
