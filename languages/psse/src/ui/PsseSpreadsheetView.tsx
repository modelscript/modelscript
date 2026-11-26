// SPDX-License-Identifier: AGPL-3.0-or-later

import React, { useEffect, useMemo, useState } from "react";
import {
  applyPsseDiagramWriteback,
  ensurePsseWasmParser,
  isPsseWasmParserReady,
  parseDyr,
  parseRaw,
  resolveDyrModelSchema,
  serializeDyrCase,
  serializePsseRaw,
  updateDyrRecordParameters,
  type PsseCase,
  type PsseDyrCase,
} from "../index.js";

export type SpreadsheetTab =
  "buses" | "generators" | "loads" | "branches" | "transformers" | "shunts" | "areas_dc" | "dyr" | "substations";

export interface PsseSpreadsheetViewProps {
  code: string;
  dyrText: string | null;
  colorMode: "dark" | "light";
  onCodeChange?: ((newCode: string) => void) | undefined;
  onDyrChange?: ((newDyr: string) => void) | undefined;
  onRevealLine?: ((line: number, identifier?: string) => void) | undefined;
}

const PAGE_SIZE = 150;

export const PsseSpreadsheetView: React.FC<PsseSpreadsheetViewProps> = ({
  code,
  dyrText,
  colorMode,
  onCodeChange,
  onDyrChange,
  onRevealLine,
}) => {
  const isDark = colorMode === "dark";
  const borderCol = isDark ? "rgba(255,255,255,0.12)" : "rgba(0,0,0,0.12)";
  const cardBg = isDark ? "rgba(30, 30, 34, 0.75)" : "rgba(255, 255, 255, 0.9)";
  const inputBg = isDark ? "#121214" : "#ffffff";
  const textPrimary = isDark ? "#e6edf3" : "#1f2328";
  const textMuted = isDark ? "#8b949e" : "#59636e";

  const [activeTab, setActiveTab] = useState<SpreadsheetTab>("buses");
  const [search, setSearch] = useState("");
  const [page, setPage] = useState(0);
  const [scaleFactor, setScaleFactor] = useState("1.05");
  const [showPaste, setShowPaste] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [parserReady, setParserReady] = useState<boolean>(() => isPsseWasmParserReady());

  useEffect(() => {
    if (parserReady) return;
    let cancelled = false;
    void ensurePsseWasmParser()
      .then(() => {
        if (!cancelled) setParserReady(true);
      })
      .catch(() => {
        // Handled by fallback message below
      });
    return () => {
      cancelled = true;
    };
  }, [parserReady]);

  const psseCase = useMemo<PsseCase | null>(() => {
    if (!parserReady) return null;
    try {
      return parseRaw(code);
    } catch {
      return null;
    }
  }, [code, parserReady]);

  const dyrCase = useMemo<PsseDyrCase | null>(() => {
    if (!dyrText || !parserReady) return null;
    try {
      return parseDyr(dyrText);
    } catch {
      return null;
    }
  }, [dyrText, parserReady]);

  const commitRaw = (mutator: (draft: PsseCase) => void, msg?: string) => {
    if (!psseCase || !onCodeChange) return;
    const cloned: PsseCase = {
      ...psseCase,
      buses: new Map(Array.from(psseCase.buses.entries()).map(([k, v]) => [k, { ...v }])),
      loads: psseCase.loads.map((l) => ({ ...l })),
      fixedShunts: psseCase.fixedShunts.map((s) => ({ ...s })),
      generators: psseCase.generators.map((g) => ({ ...g })),
      branches: psseCase.branches.map((b) => ({ ...b })),
      transformers: psseCase.transformers.map((t) => ({ ...t })),
      switchedShunts: psseCase.switchedShunts.map((s) => ({ ...s })),
      ...(psseCase.substations
        ? {
            substations: psseCase.substations.map((sub) => ({
              ...sub,
              nodes: sub.nodes.map((n) => ({ ...n })),
              switches: sub.switches.map((sw) => ({ ...sw })),
              terminals: sub.terminals.map((tm) => ({ ...tm })),
            })),
          }
        : {}),
    };
    mutator(cloned);
    onCodeChange(serializePsseRaw(cloned));
    if (msg) setStatusMsg(msg);
  };

  const commitPatch = (cellId: string, changes: Record<string, string | number | boolean>, msg?: string) => {
    if (!onCodeChange) return;
    onCodeChange(applyPsseDiagramWriteback(code, cellId, changes));
    if (msg) setStatusMsg(msg);
  };

  const commitDyr = (mutator: (draft: PsseDyrCase) => PsseDyrCase, msg?: string) => {
    if (!dyrCase || !onDyrChange) return;
    const next = mutator(dyrCase);
    onDyrChange(serializeDyrCase(next));
    if (msg) setStatusMsg(msg);
  };

  const q = search.trim().toLowerCase();

  const busList = useMemo(() => {
    if (!psseCase) return [];
    const arr = Array.from(psseCase.buses.values());
    return q ? arr.filter((b) => String(b.i).includes(q) || b.name.toLowerCase().includes(q)) : arr;
  }, [psseCase, q]);

  const genList = useMemo(() => {
    if (!psseCase) return [];
    return q
      ? psseCase.generators.filter((g) => String(g.i).includes(q) || g.id.toLowerCase().includes(q))
      : psseCase.generators;
  }, [psseCase, q]);

  const loadList = useMemo(() => {
    if (!psseCase) return [];
    return q ? psseCase.loads.filter((l) => String(l.i).includes(q) || l.id.toLowerCase().includes(q)) : psseCase.loads;
  }, [psseCase, q]);

  const branchList = useMemo(() => {
    if (!psseCase) return [];
    return q
      ? psseCase.branches.filter((b) => `${b.i}-${b.j}`.includes(q) || b.ckt.toLowerCase().includes(q))
      : psseCase.branches;
  }, [psseCase, q]);

  const xfmrList = useMemo(() => {
    if (!psseCase) return [];
    return q
      ? psseCase.transformers.filter(
          (t) => `${t.i}-${t.j}`.includes(q) || t.name.toLowerCase().includes(q) || t.ckt.toLowerCase().includes(q),
        )
      : psseCase.transformers;
  }, [psseCase, q]);

  const shuntList = useMemo(() => {
    if (!psseCase) return [];
    return q ? psseCase.fixedShunts.filter((s) => String(s.i).includes(q)) : psseCase.fixedShunts;
  }, [psseCase, q]);

  const dyrList = useMemo(() => {
    if (!dyrCase) return [];
    return q
      ? dyrCase.records.filter((r) => String(r.ibus).includes(q) || r.model.toLowerCase().includes(q))
      : dyrCase.records;
  }, [dyrCase, q]);

  const substationList = useMemo(() => psseCase?.substations ?? [], [psseCase]);

  const currentTotal =
    activeTab === "buses"
      ? busList.length
      : activeTab === "generators"
        ? genList.length
        : activeTab === "loads"
          ? loadList.length
          : activeTab === "branches"
            ? branchList.length
            : activeTab === "transformers"
              ? xfmrList.length
              : activeTab === "shunts"
                ? shuntList.length
                : activeTab === "dyr"
                  ? dyrList.length
                  : substationList.length;

  const totalPages = Math.max(1, Math.ceil(currentTotal / PAGE_SIZE));
  const safePage = Math.min(page, totalPages - 1);
  const startIdx = safePage * PAGE_SIZE;
  const endIdx = startIdx + PAGE_SIZE;

  const cellInputStyle: React.CSSProperties = {
    width: 68,
    padding: "2px 4px",
    fontSize: 11,
    fontFamily: "monospace",
    borderRadius: 3,
    border: `1px solid ${borderCol}`,
    backgroundColor: inputBg,
    color: textPrimary,
  };

  const tabBtnStyle = (active: boolean): React.CSSProperties => ({
    padding: "4px 8px",
    fontSize: 11,
    fontWeight: active ? 700 : 500,
    borderRadius: 4,
    border: `1px solid ${active ? "#58a6ff" : borderCol}`,
    backgroundColor: active ? "rgba(88, 166, 255, 0.14)" : cardBg,
    color: active ? "#58a6ff" : textPrimary,
    cursor: "pointer",
  });

  if (!psseCase) {
    return (
      <div style={{ padding: 12, fontSize: 12, color: textMuted }}>
        Spreadsheet view unavailable: active buffer is not a valid PSS/E `.raw` case.
      </div>
    );
  }

  return (
    <div
      style={{
        padding: 12,
        borderRadius: 8,
        border: `1px solid ${borderCol}`,
        backgroundColor: cardBg,
        display: "flex",
        flexDirection: "column",
        gap: 10,
        fontSize: 11,
      }}
    >
      <div style={{ display: "flex", flexWrap: "wrap", gap: 6, alignItems: "center" }}>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "buses")}
          onClick={() => {
            setActiveTab("buses");
            setPage(0);
          }}
        >
          Buses ({psseCase.buses.size})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "generators")}
          onClick={() => {
            setActiveTab("generators");
            setPage(0);
          }}
        >
          Generators ({psseCase.generators.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "loads")}
          onClick={() => {
            setActiveTab("loads");
            setPage(0);
          }}
        >
          Loads ({psseCase.loads.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "branches")}
          onClick={() => {
            setActiveTab("branches");
            setPage(0);
          }}
        >
          Branches ({psseCase.branches.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "transformers")}
          onClick={() => {
            setActiveTab("transformers");
            setPage(0);
          }}
        >
          Transformers ({psseCase.transformers.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "shunts")}
          onClick={() => {
            setActiveTab("shunts");
            setPage(0);
          }}
        >
          Shunts ({psseCase.fixedShunts.length} + {psseCase.switchedShunts.length})
        </button>
        <button
          type="button"
          style={tabBtnStyle(activeTab === "areas_dc")}
          onClick={() => {
            setActiveTab("areas_dc");
            setPage(0);
          }}
        >
          Areas / DC ({psseCase.areas.length} / {psseCase.twoTerminalDc.length + psseCase.vscDc.length})
        </button>
        {dyrCase && (
          <button
            type="button"
            style={tabBtnStyle(activeTab === "dyr")}
            onClick={() => {
              setActiveTab("dyr");
              setPage(0);
            }}
          >
            DYR Models ({dyrCase.records.length})
          </button>
        )}
        {substationList.length > 0 && (
          <button
            type="button"
            style={tabBtnStyle(activeTab === "substations")}
            onClick={() => {
              setActiveTab("substations");
              setPage(0);
            }}
          >
            Node-Breaker ({substationList.length})
          </button>
        )}
      </div>

      <div style={{ display: "flex", flexWrap: "wrap", gap: 8, alignItems: "center" }}>
        <input
          type="text"
          placeholder="Filter by bus #, name, model..."
          value={search}
          onChange={(e) => {
            setSearch(e.target.value);
            setPage(0);
          }}
          style={{ ...cellInputStyle, width: 190, padding: "4px 6px" }}
        />
        {onCodeChange && activeTab === "buses" && (
          <button
            type="button"
            style={tabBtnStyle(false)}
            onClick={() =>
              commitRaw((draft) => {
                const maxId = Math.max(0, ...Array.from(draft.buses.keys()));
                const nextId = maxId + 1;
                draft.buses.set(nextId, {
                  i: nextId,
                  name: `BUS_${nextId}`,
                  baseKv: 138,
                  ide: 1,
                  area: 1,
                  zone: 1,
                  owner: 1,
                  vm: 1.0,
                  va: 0.0,
                  nvhi: 1.1,
                  nvlo: 0.9,
                  evhi: 1.1,
                  evlo: 0.9,
                });
              }, "Added new PQ bus")
            }
          >
            + Add Bus
          </button>
        )}
        {onCodeChange && activeTab === "loads" && (
          <div style={{ display: "inline-flex", alignItems: "center", gap: 4 }}>
            <input
              type="number"
              step="0.01"
              value={scaleFactor}
              onChange={(e) => setScaleFactor(e.target.value)}
              style={{ ...cellInputStyle, width: 54 }}
            />
            <button
              type="button"
              style={tabBtnStyle(false)}
              onClick={() => {
                const f = Number(scaleFactor);
                if (!Number.isFinite(f) || f <= 0) return;
                commitRaw((draft) => {
                  for (const l of draft.loads) {
                    l.pl = Number((l.pl * f).toFixed(4));
                    l.ql = Number((l.ql * f).toFixed(4));
                  }
                }, `Scaled all loads by ×${f}`);
              }}
            >
              Scale Loads
            </button>
          </div>
        )}
        {onCodeChange && (activeTab === "buses" || activeTab === "loads") && (
          <button type="button" style={tabBtnStyle(showPaste)} onClick={() => setShowPaste((v) => !v)}>
            Paste TSV/CSV
          </button>
        )}
        {statusMsg && <span style={{ color: "#3fb950" }}>{statusMsg}</span>}
        <div style={{ marginLeft: "auto", display: "inline-flex", alignItems: "center", gap: 6, color: textMuted }}>
          <span>
            {currentTotal === 0 ? "0" : `${startIdx + 1}–${Math.min(endIdx, currentTotal)}`} of {currentTotal}
          </span>
          <button
            type="button"
            style={tabBtnStyle(false)}
            disabled={safePage === 0}
            onClick={() => setPage((p) => Math.max(0, p - 1))}
          >
            Prev
          </button>
          <button
            type="button"
            style={tabBtnStyle(false)}
            disabled={safePage >= totalPages - 1}
            onClick={() => setPage((p) => p + 1)}
          >
            Next
          </button>
        </div>
      </div>

      {showPaste && onCodeChange && (
        <div
          style={{
            display: "flex",
            flexDirection: "column",
            gap: 6,
            padding: 8,
            borderRadius: 6,
            border: `1px solid ${borderCol}`,
          }}
        >
          <div style={{ color: textMuted }}>
            Paste rows ({activeTab === "buses" ? "bus, vm, va" : "bus, pl, ql"} — tab or comma separated):
          </div>
          <textarea
            rows={4}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={activeTab === "buses" ? "1, 1.02, 0.0\n2, 1.01, -1.5" : "3, 125.0, 40.0"}
            style={{ ...cellInputStyle, width: "100%", fontFamily: "monospace" }}
          />
          <div style={{ display: "flex", gap: 6 }}>
            <button
              type="button"
              style={tabBtnStyle(true)}
              onClick={() => {
                const linesIn = pasteText
                  .split(/\r?\n/)
                  .map((l) => l.trim())
                  .filter(Boolean);
                let updated = 0;
                commitRaw((draft) => {
                  for (const line of linesIn) {
                    const cols = line.split(/[\t,;]+/).map((s) => Number(s.trim()));
                    if (cols.length >= 2 && Number.isFinite(cols[0])) {
                      if (activeTab === "buses") {
                        const b = draft.buses.get(cols[0]!);
                        if (b) {
                          if (Number.isFinite(cols[1]) && cols[1]! > 0) b.vm = cols[1]!;
                          if (cols[2] !== undefined && Number.isFinite(cols[2])) b.va = cols[2]!;
                          updated++;
                        }
                      } else if (activeTab === "loads") {
                        const l = draft.loads.find((x) => x.i === cols[0]!);
                        if (l) {
                          if (Number.isFinite(cols[1])) l.pl = cols[1]!;
                          if (cols[2] !== undefined && Number.isFinite(cols[2])) l.ql = cols[2]!;
                          updated++;
                        }
                      }
                    }
                  }
                }, `Applied ${updated} pasted ${activeTab} row(s)`);
                setShowPaste(false);
              }}
            >
              Apply Pasted Rows
            </button>
          </div>
        </div>
      )}

      <div style={{ overflowX: "auto", maxHeight: 360 }}>
        {activeTab === "buses" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>Bus</th>
                <th style={{ padding: "4px 6px" }}>Name</th>
                <th style={{ padding: "4px 6px" }}>Base kV</th>
                <th style={{ padding: "4px 6px" }}>Type (IDE)</th>
                <th style={{ padding: "4px 6px" }}>Vm (pu)</th>
                <th style={{ padding: "4px 6px" }}>Va (deg)</th>
                <th style={{ padding: "4px 6px" }}>Area</th>
                {onCodeChange && <th style={{ padding: "4px 6px" }} />}
              </tr>
            </thead>
            <tbody>
              {busList.slice(startIdx, endIdx).map((b) => (
                <tr key={b.i} style={{ borderBottom: `1px solid ${borderCol}` }}>
                  <td
                    style={{ padding: "4px 6px", cursor: b.span?.line ? "pointer" : "default", fontWeight: 700 }}
                    onClick={() => b.span?.line && onRevealLine?.(b.span.line)}
                  >
                    {b.i}
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="text"
                      defaultValue={b.name}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = e.target.value.trim();
                        if (val && val !== b.name) {
                          commitPatch(`bus_${b.i}`, { name: val }, `Updated Bus ${b.i} name`);
                        }
                      }}
                      style={{ ...cellInputStyle, width: 100 }}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="1"
                      defaultValue={b.baseKv}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val > 0 && val !== b.baseKv) {
                          commitPatch(`bus_${b.i}`, { baseKv: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <select
                      value={b.ide}
                      disabled={!onCodeChange}
                      onChange={(e) => {
                        const val = Number(e.target.value);
                        commitPatch(`bus_${b.i}`, { ide: val });
                      }}
                      style={{ ...cellInputStyle, width: 76 }}
                    >
                      <option value={1}>1 (PQ)</option>
                      <option value={2}>2 (PV)</option>
                      <option value={3}>3 (Slack)</option>
                      <option value={4}>4 (Isol)</option>
                    </select>
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.005"
                      defaultValue={b.vm}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val > 0 && val !== b.vm) {
                          commitPatch(`bus_${b.i}`, { vm: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.1"
                      defaultValue={b.va}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== b.va) {
                          commitPatch(`bus_${b.i}`, { va: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>{b.area}</td>
                  {onCodeChange && (
                    <td style={{ padding: "4px 6px" }}>
                      <button
                        type="button"
                        style={{ ...tabBtnStyle(false), color: "#f85149" }}
                        onClick={() =>
                          commitRaw((d) => {
                            d.buses.delete(b.i);
                          }, `Deleted Bus ${b.i}`)
                        }
                      >
                        ×
                      </button>
                    </td>
                  )}
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "generators" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>Bus</th>
                <th style={{ padding: "4px 6px" }}>ID</th>
                <th style={{ padding: "4px 6px" }}>Pg (MW)</th>
                <th style={{ padding: "4px 6px" }}>Qg (MVAr)</th>
                <th style={{ padding: "4px 6px" }}>Qmax</th>
                <th style={{ padding: "4px 6px" }}>Qmin</th>
                <th style={{ padding: "4px 6px" }}>Vs (pu)</th>
                <th style={{ padding: "4px 6px" }}>Stat</th>
              </tr>
            </thead>
            <tbody>
              {genList.slice(startIdx, endIdx).map((g, idx) => (
                <tr key={`${g.i}-${g.id}-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                  <td style={{ padding: "4px 6px" }}>{g.i}</td>
                  <td style={{ padding: "4px 6px" }}>{g.id}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="1"
                      defaultValue={g.pg}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== g.pg) {
                          commitPatch(`gen_${g.i}_${g.id.trim()}`, { pg: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>{g.qg.toFixed(2)}</td>
                  <td style={{ padding: "4px 6px" }}>{g.qt.toFixed(1)}</td>
                  <td style={{ padding: "4px 6px" }}>{g.qb.toFixed(1)}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.005"
                      defaultValue={g.vs}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val > 0 && val !== g.vs) {
                          commitPatch(`gen_${g.i}_${g.id.trim()}`, { vs: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="checkbox"
                      checked={g.stat === 1}
                      disabled={!onCodeChange}
                      onChange={(e) => {
                        const next = e.target.checked ? 1 : 0;
                        commitPatch(`gen_${g.i}_${g.id.trim()}`, { stat: next });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "loads" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>Bus</th>
                <th style={{ padding: "4px 6px" }}>ID</th>
                <th style={{ padding: "4px 6px" }}>Pl (MW)</th>
                <th style={{ padding: "4px 6px" }}>Ql (MVAr)</th>
                <th style={{ padding: "4px 6px" }}>Stat</th>
              </tr>
            </thead>
            <tbody>
              {loadList.slice(startIdx, endIdx).map((l, idx) => (
                <tr key={`${l.i}-${l.id}-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                  <td style={{ padding: "4px 6px" }}>{l.i}</td>
                  <td style={{ padding: "4px 6px" }}>{l.id}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="1"
                      defaultValue={l.pl}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== l.pl) {
                          commitPatch(`load_${l.i}_${l.id.trim()}`, { pl: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="1"
                      defaultValue={l.ql}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== l.ql) {
                          commitPatch(`load_${l.i}_${l.id.trim()}`, { ql: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="checkbox"
                      checked={l.status === 1}
                      disabled={!onCodeChange}
                      onChange={(e) => {
                        const next = e.target.checked ? 1 : 0;
                        commitPatch(`load_${l.i}_${l.id.trim()}`, { status: next });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "branches" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>From</th>
                <th style={{ padding: "4px 6px" }}>To</th>
                <th style={{ padding: "4px 6px" }}>Ckt</th>
                <th style={{ padding: "4px 6px" }}>R (pu)</th>
                <th style={{ padding: "4px 6px" }}>X (pu)</th>
                <th style={{ padding: "4px 6px" }}>B (pu)</th>
                <th style={{ padding: "4px 6px" }}>RateA</th>
                <th style={{ padding: "4px 6px" }}>Stat</th>
              </tr>
            </thead>
            <tbody>
              {branchList.slice(startIdx, endIdx).map((br, idx) => (
                <tr key={`${br.i}-${br.j}-${br.ckt}-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                  <td style={{ padding: "4px 6px" }}>{br.i}</td>
                  <td style={{ padding: "4px 6px" }}>{br.j}</td>
                  <td style={{ padding: "4px 6px" }}>{br.ckt}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.001"
                      defaultValue={br.r}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== br.r) {
                          commitPatch(`branch_${br.i}_${Math.abs(br.j)}_${br.ckt.trim()}`, { r: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.001"
                      defaultValue={br.x}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== br.x) {
                          commitPatch(`branch_${br.i}_${Math.abs(br.j)}_${br.ckt.trim()}`, { x: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>{br.b.toFixed(4)}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="10"
                      defaultValue={br.rateA}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val >= 0 && val !== br.rateA) {
                          commitPatch(`branch_${br.i}_${Math.abs(br.j)}_${br.ckt.trim()}`, { rateA: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="checkbox"
                      checked={br.st === 1}
                      disabled={!onCodeChange}
                      onChange={(e) => {
                        const next = e.target.checked ? 1 : 0;
                        commitPatch(`branch_${br.i}_${Math.abs(br.j)}_${br.ckt.trim()}`, { st: next });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "transformers" && (
          <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                <th style={{ padding: "4px 6px" }}>I-J-K</th>
                <th style={{ padding: "4px 6px" }}>Ckt</th>
                <th style={{ padding: "4px 6px" }}>Name</th>
                <th style={{ padding: "4px 6px" }}>R12</th>
                <th style={{ padding: "4px 6px" }}>X12</th>
                <th style={{ padding: "4px 6px" }}>Tap1</th>
                <th style={{ padding: "4px 6px" }}>Ang1</th>
                <th style={{ padding: "4px 6px" }}>Stat</th>
              </tr>
            </thead>
            <tbody>
              {xfmrList.slice(startIdx, endIdx).map((t, idx) => (
                <tr key={`${t.i}-${t.j}-${t.ckt}-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                  <td style={{ padding: "4px 6px" }}>
                    {t.i}-{t.j}-{t.k}
                  </td>
                  <td style={{ padding: "4px 6px" }}>{t.ckt}</td>
                  <td style={{ padding: "4px 6px" }}>{t.name}</td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.001"
                      defaultValue={t.r12}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== t.r12) {
                          commitPatch(`xfmr_${t.i}_${t.j}_${t.ckt.trim()}`, { r12: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.005"
                      defaultValue={t.x12}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== t.x12) {
                          commitPatch(`xfmr_${t.i}_${t.j}_${t.ckt.trim()}`, { x12: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="0.00625"
                      defaultValue={t.windv1}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val > 0 && val !== t.windv1) {
                          commitPatch(`xfmr_${t.i}_${t.j}_${t.ckt.trim()}`, { windv1: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="number"
                      step="1"
                      defaultValue={t.ang1}
                      disabled={!onCodeChange}
                      onBlur={(e) => {
                        const val = Number(e.target.value);
                        if (Number.isFinite(val) && val !== t.ang1) {
                          commitPatch(`xfmr_${t.i}_${t.j}_${t.ckt.trim()}`, { ang1: val });
                        }
                      }}
                      style={cellInputStyle}
                    />
                  </td>
                  <td style={{ padding: "4px 6px" }}>
                    <input
                      type="checkbox"
                      checked={t.stat === 1}
                      disabled={!onCodeChange}
                      onChange={(e) => {
                        commitPatch(`xfmr_${t.i}_${t.j}_${t.ckt.trim()}`, { stat: e.target.checked ? 1 : 0 });
                      }}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}

        {activeTab === "shunts" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
              <thead>
                <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                  <th style={{ padding: "4px 6px" }}>Fixed Shunt Bus</th>
                  <th style={{ padding: "4px 6px" }}>ID</th>
                  <th style={{ padding: "4px 6px" }}>GL (MW)</th>
                  <th style={{ padding: "4px 6px" }}>BL (MVAr)</th>
                  <th style={{ padding: "4px 6px" }}>Stat</th>
                </tr>
              </thead>
              <tbody>
                {shuntList.slice(startIdx, endIdx).map((s, idx) => (
                  <tr key={`${s.i}-${s.id}-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                    <td style={{ padding: "4px 6px" }}>{s.i}</td>
                    <td style={{ padding: "4px 6px" }}>{s.id}</td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="number"
                        step="1"
                        defaultValue={s.gl}
                        disabled={!onCodeChange}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (Number.isFinite(val) && val !== s.gl) {
                            commitPatch(`shunt_${s.i}_${s.id.trim()}`, { gl: val });
                          }
                        }}
                        style={cellInputStyle}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="number"
                        step="5"
                        defaultValue={s.bl}
                        disabled={!onCodeChange}
                        onBlur={(e) => {
                          const val = Number(e.target.value);
                          if (Number.isFinite(val) && val !== s.bl) {
                            commitPatch(`shunt_${s.i}_${s.id.trim()}`, { bl: val });
                          }
                        }}
                        style={cellInputStyle}
                      />
                    </td>
                    <td style={{ padding: "4px 6px" }}>
                      <input
                        type="checkbox"
                        checked={s.status === 1}
                        disabled={!onCodeChange}
                        onChange={(e) => {
                          commitPatch(`shunt_${s.i}_${s.id.trim()}`, { status: e.target.checked ? 1 : 0 });
                        }}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
            {psseCase.switchedShunts.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px" }}>Sw. Shunt Bus</th>
                    <th style={{ padding: "4px 6px" }}>Mode</th>
                    <th style={{ padding: "4px 6px" }}>Vswhi</th>
                    <th style={{ padding: "4px 6px" }}>Vswlo</th>
                    <th style={{ padding: "4px 6px" }}>Binit (MVAr)</th>
                    <th style={{ padding: "4px 6px" }}>Stat</th>
                  </tr>
                </thead>
                <tbody>
                  {psseCase.switchedShunts.map((ss, idx) => (
                    <tr key={`ss-${ss.i}-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                      <td style={{ padding: "4px 6px" }}>{ss.i}</td>
                      <td style={{ padding: "4px 6px" }}>{ss.modsw}</td>
                      <td style={{ padding: "4px 6px" }}>{ss.vswhi.toFixed(3)}</td>
                      <td style={{ padding: "4px 6px" }}>{ss.vswlo.toFixed(3)}</td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="number"
                          step="5"
                          defaultValue={ss.binit}
                          disabled={!onCodeChange}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val !== ss.binit) {
                              commitRaw((d) => {
                                const target = d.switchedShunts[idx];
                                if (target) target.binit = val;
                              }, `Updated Switched Shunt Bus ${ss.i} Binit=${val}`);
                            }
                          }}
                          style={cellInputStyle}
                        />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="checkbox"
                          checked={ss.stat === 1}
                          disabled={!onCodeChange}
                          onChange={(e) => {
                            const next = e.target.checked ? 1 : 0;
                            commitRaw((d) => {
                              const target = d.switchedShunts[idx];
                              if (target) target.stat = next;
                            });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        )}

        {activeTab === "dyr" && dyrCase && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {dyrList.slice(startIdx, endIdx).map((rec, idx) => {
              const schema = resolveDyrModelSchema(rec.model);
              return (
                <div
                  key={`${rec.ibus}-${rec.model}-${rec.id}-${idx}`}
                  style={{
                    padding: 8,
                    borderRadius: 6,
                    border: `1px solid ${borderCol}`,
                    display: "flex",
                    flexDirection: "column",
                    gap: 6,
                  }}
                >
                  <div style={{ fontWeight: 700, fontFamily: "monospace" }}>
                    Bus {rec.ibus} | {rec.model} (ID &apos;{rec.id}&apos;) [{rec.category}]
                  </div>
                  <div style={{ display: "flex", flexWrap: "wrap", gap: 8 }}>
                    {rec.con.map((val, cIdx) => {
                      const paramMeta = schema?.params[cIdx];
                      const label = paramMeta?.name ?? `CON[${cIdx}]`;
                      return (
                        <label
                          key={cIdx}
                          style={{ display: "inline-flex", alignItems: "center", gap: 4, color: textMuted }}
                        >
                          <span title={paramMeta?.description}>{label}</span>
                          <input
                            type="number"
                            step="0.01"
                            defaultValue={val}
                            disabled={!onDyrChange}
                            onBlur={(e) => {
                              const nextVal = Number(e.target.value);
                              if (!Number.isFinite(nextVal) || nextVal === val) return;
                              commitDyr((draft) => {
                                const updatedRecords = draft.records.map((r) => {
                                  if (r === rec) {
                                    const nextCon = [...r.con];
                                    nextCon[cIdx] = nextVal;
                                    return paramMeta
                                      ? updateDyrRecordParameters({ ...r, con: nextCon }, { [paramMeta.name]: nextVal })
                                      : { ...r, con: nextCon };
                                  }
                                  return r;
                                });
                                return { ...draft, records: updatedRecords };
                              }, `Updated ${rec.model} ${label}=${nextVal}`);
                            }}
                            style={cellInputStyle}
                          />
                        </label>
                      );
                    })}
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {activeTab === "substations" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {substationList.map((sub) => (
              <div key={sub.is} style={{ padding: 8, borderRadius: 6, border: `1px solid ${borderCol}` }}>
                <div style={{ fontWeight: 700, marginBottom: 4 }}>
                  Substation {sub.is}: {sub.name} ({sub.nodes.length} nodes, {sub.switches.length} switches)
                </div>
                <div style={{ display: "flex", flexWrap: "wrap", gap: 6 }}>
                  {sub.switches.map((sw, sIdx) => (
                    <button
                      key={sIdx}
                      type="button"
                      disabled={!onCodeChange}
                      onClick={() =>
                        commitRaw(
                          (d) => {
                            const targetSub = d.substations?.find((s) => s.is === sub.is);
                            const targetSw = targetSub?.switches[sIdx];
                            if (targetSw) {
                              targetSw.status = targetSw.status === 1 ? 0 : 1;
                            }
                          },
                          `Toggled ${sw.name || `SW_${sIdx}`} to ${sw.status === 1 ? "OPEN" : "CLOSED"}`,
                        )
                      }
                      style={{
                        padding: "2px 6px",
                        borderRadius: 4,
                        border: `1px solid ${borderCol}`,
                        backgroundColor: inputBg,
                        color: sw.status === 1 ? "#3fb950" : "#f85149",
                        fontFamily: "monospace",
                        cursor: onCodeChange ? "pointer" : "default",
                      }}
                    >
                      {sw.name || `SW_${sIdx}`} ({sw.ni}–{sw.nj}): {sw.status === 1 ? "CLOSED" : "OPEN"}
                    </button>
                  ))}
                </div>
              </div>
            ))}
          </div>
        )}
        {activeTab === "areas_dc" && (
          <div style={{ display: "flex", flexDirection: "column", gap: 10 }}>
            <div style={{ fontWeight: 600, color: textMuted }}>
              Areas ({psseCase.areas.length}), 2-Terminal DC ({psseCase.twoTerminalDc.length}), VSC DC (
              {psseCase.vscDc.length})
            </div>
            {psseCase.areas.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px" }}>Area</th>
                    <th style={{ padding: "4px 6px" }}>Name</th>
                    <th style={{ padding: "4px 6px" }}>Swing Bus</th>
                    <th style={{ padding: "4px 6px" }}>Pdes (MW)</th>
                    <th style={{ padding: "4px 6px" }}>Ptol (MW)</th>
                  </tr>
                </thead>
                <tbody>
                  {psseCase.areas.map((a, aIdx) => (
                    <tr key={`area-${a.i}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                      <td style={{ padding: "4px 6px" }}>{a.i}</td>
                      <td style={{ padding: "4px 6px" }}>{a.arname}</td>
                      <td style={{ padding: "4px 6px" }}>{a.isw}</td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="number"
                          step="10"
                          defaultValue={a.pdes}
                          disabled={!onCodeChange}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val !== a.pdes) {
                              commitRaw((d) => {
                                const target = d.areas[aIdx];
                                if (target) target.pdes = val;
                              }, `Updated Area ${a.i} Pdes=${val}`);
                            }
                          }}
                          style={cellInputStyle}
                        />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="number"
                          step="1"
                          defaultValue={a.ptol}
                          disabled={!onCodeChange}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val >= 0 && val !== a.ptol) {
                              commitRaw((d) => {
                                const target = d.areas[aIdx];
                                if (target) target.ptol = val;
                              });
                            }
                          }}
                          style={cellInputStyle}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {psseCase.twoTerminalDc.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px" }}>2T-DC Name</th>
                    <th style={{ padding: "4px 6px" }}>Rect Bus</th>
                    <th style={{ padding: "4px 6px" }}>Inv Bus</th>
                    <th style={{ padding: "4px 6px" }}>Setvl (MW/A)</th>
                    <th style={{ padding: "4px 6px" }}>Vschd (kV)</th>
                  </tr>
                </thead>
                <tbody>
                  {psseCase.twoTerminalDc.map((dc, idx) => (
                    <tr key={`dc2t-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                      <td style={{ padding: "4px 6px" }}>{dc.name}</td>
                      <td style={{ padding: "4px 6px" }}>{dc.ipr}</td>
                      <td style={{ padding: "4px 6px" }}>{dc.ipi}</td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="number"
                          step="10"
                          defaultValue={dc.setvl}
                          disabled={!onCodeChange}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val !== dc.setvl) {
                              commitRaw(
                                (d) => {
                                  const target = d.twoTerminalDc[idx];
                                  if (target) target.setvl = val;
                                },
                                `Updated DC ${dc.name ?? idx} Setvl=${val}`,
                              );
                            }
                          }}
                          style={cellInputStyle}
                        />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="number"
                          step="10"
                          defaultValue={dc.vschd}
                          disabled={!onCodeChange}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val > 0 && val !== dc.vschd) {
                              commitRaw((d) => {
                                const target = d.twoTerminalDc[idx];
                                if (target) target.vschd = val;
                              });
                            }
                          }}
                          style={cellInputStyle}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {psseCase.vscDc.length > 0 && (
              <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                <thead>
                  <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                    <th style={{ padding: "4px 6px" }}>VSC-DC Name</th>
                    <th style={{ padding: "4px 6px" }}>Bus 1</th>
                    <th style={{ padding: "4px 6px" }}>Bus 2</th>
                    <th style={{ padding: "4px 6px" }}>Rdc (ohm)</th>
                    <th style={{ padding: "4px 6px" }}>Stat</th>
                  </tr>
                </thead>
                <tbody>
                  {psseCase.vscDc.map((vsc, idx) => (
                    <tr key={`vsc-${idx}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                      <td style={{ padding: "4px 6px" }}>{vsc.name}</td>
                      <td style={{ padding: "4px 6px" }}>{vsc.ibus1}</td>
                      <td style={{ padding: "4px 6px" }}>{vsc.ibus2}</td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="number"
                          step="0.5"
                          defaultValue={vsc.rdc}
                          disabled={!onCodeChange}
                          onBlur={(e) => {
                            const val = Number(e.target.value);
                            if (Number.isFinite(val) && val >= 0 && val !== vsc.rdc) {
                              commitRaw((d) => {
                                const target = d.vscDc[idx];
                                if (target) target.rdc = val;
                              }, `Updated VSC ${vsc.name} Rdc=${val}`);
                            }
                          }}
                          style={cellInputStyle}
                        />
                      </td>
                      <td style={{ padding: "4px 6px" }}>
                        <input
                          type="checkbox"
                          checked={vsc.mdc !== 0}
                          disabled={!onCodeChange}
                          onChange={(e) => {
                            const next = e.target.checked ? 1 : 0;
                            commitRaw((d) => {
                              const target = d.vscDc[idx];
                              if (target) target.mdc = next;
                            });
                          }}
                        />
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
            {(() => {
              const zoneTotals = new Map<number, { buses: number; gen: number; load: number }>();
              for (const b of psseCase.buses.values()) {
                const e = zoneTotals.get(b.zone) ?? { buses: 0, gen: 0, load: 0 };
                e.buses++;
                zoneTotals.set(b.zone, e);
              }
              for (const g of psseCase.generators) {
                if (g.stat !== 1) continue;
                const z = psseCase.buses.get(g.i)?.zone ?? 1;
                const e = zoneTotals.get(z) ?? { buses: 0, gen: 0, load: 0 };
                e.gen += g.pg;
                zoneTotals.set(z, e);
              }
              for (const l of psseCase.loads) {
                if (l.status !== 1) continue;
                const z = psseCase.buses.get(l.i)?.zone ?? 1;
                const e = zoneTotals.get(z) ?? { buses: 0, gen: 0, load: 0 };
                e.load += l.pl;
                zoneTotals.set(z, e);
              }
              if (zoneTotals.size === 0) return null;
              return (
                <table style={{ width: "100%", borderCollapse: "collapse", fontFamily: "monospace" }}>
                  <thead>
                    <tr style={{ borderBottom: `1px solid ${borderCol}`, color: textMuted, textAlign: "left" }}>
                      <th style={{ padding: "4px 6px" }}>Zone</th>
                      <th style={{ padding: "4px 6px" }}>Buses</th>
                      <th style={{ padding: "4px 6px" }}>Gen (MW)</th>
                      <th style={{ padding: "4px 6px" }}>Load (MW)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {Array.from(zoneTotals.entries())
                      .sort((a, b) => a[0] - b[0])
                      .map(([z, t]) => (
                        <tr key={`zone-${z}`} style={{ borderBottom: `1px solid ${borderCol}` }}>
                          <td style={{ padding: "4px 6px" }}>{z}</td>
                          <td style={{ padding: "4px 6px" }}>{t.buses}</td>
                          <td style={{ padding: "4px 6px" }}>{t.gen.toFixed(1)}</td>
                          <td style={{ padding: "4px 6px" }}>{t.load.toFixed(1)}</td>
                        </tr>
                      ))}
                  </tbody>
                </table>
              );
            })()}
          </div>
        )}
      </div>
    </div>
  );
};
