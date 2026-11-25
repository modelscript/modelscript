// SPDX-License-Identifier: AGPL-3.0-or-later

import { CheckCircleFillIcon, PlayIcon, UploadIcon, XCircleFillIcon } from "@primer/octicons-react";
import { Button } from "@primer/react";
import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  applyLspTextEditsToString,
  calibrate,
  computeWritebackEdit,
  getModelParameters,
  type CalibrateResult,
} from "../util/lsp-bridge";

export interface AnsatzCalibrationPanelProps {
  projectFiles?: Record<string, string> | undefined;
  activeFileName?: string | undefined;
  activeCode?: string | undefined;
  documentUri?: string | undefined;
  colorMode: "dark" | "light";
  onUpdateProjectFile?: ((fileName: string, content: string) => void) | undefined;
  onCodeChange?: ((nextCode: string) => void) | undefined;
}

interface ParsedParam {
  name: string;
  value: number;
}

function extractDatasetChannels(fileName: string, content: string): { isComtrade: boolean; channels: string[] } {
  const isComtrade = /\.(cff|cfg)($|\?|#)/i.test(fileName) || content.includes("--- file type: CFG ---");
  if (isComtrade) {
    const cfgIdx = content.indexOf("--- file type: CFG ---");
    const cfgBody = cfgIdx >= 0 ? content.slice(cfgIdx).split("\n").slice(1) : content.split("\n");
    const lines = cfgBody.map((l) => l.trim()).filter((l) => l.length > 0 && !l.startsWith("---"));
    if (lines.length >= 2) {
      const counts = lines[1]!.split(",");
      const analogCount = Number.parseInt((counts[1] ?? "0").replace(/[^0-9]/g, ""), 10) || 0;
      const channels: string[] = [];
      for (let i = 0; i < analogCount && i + 2 < lines.length; i++) {
        const parts = lines[i + 2]!.split(",");
        const chName = (parts[1] ?? `ch${i + 1}`).trim();
        if (chName) channels.push(chName);
      }
      return { isComtrade: true, channels };
    }
    return { isComtrade: true, channels: [] };
  }

  // CSV header row
  const firstLine = content.split(/\r?\n/).find((l) => l.trim().length > 0 && !l.trim().startsWith("#")) ?? "";
  const cols = firstLine
    .split(",")
    .map((c) => c.trim().replace(/^["']|["']$/g, ""))
    .filter((c) => c.length > 0 && !/^(t|time|time_s|time_sec)$/i.test(c));
  return { isComtrade: false, channels: cols };
}

const OverlaySvgChart: React.FC<{
  title: string;
  measured?: { t: number[]; y: number[] } | undefined;
  simulated?: { t: number[]; y: number[] } | undefined;
  isDark: boolean;
}> = ({ title, measured, simulated, isDark }) => {
  const width = 420;
  const height = 160;
  const padL = 44;
  const padR = 14;
  const padT = 18;
  const padB = 24;
  const plotW = width - padL - padR;
  const plotH = height - padT - padB;

  const allT = [...(measured?.t ?? []), ...(simulated?.t ?? [])];
  const allY = [...(measured?.y ?? []), ...(simulated?.y ?? [])];
  if (allT.length === 0 || allY.length === 0) return null;

  const tMin = Math.min(...allT);
  const tMax = Math.max(...allT);
  const tSpan = Math.max(tMax - tMin, 1e-9);
  const yMinRaw = Math.min(...allY);
  const yMaxRaw = Math.max(...allY);
  const yPad = Math.max((yMaxRaw - yMinRaw) * 0.08, 1e-4);
  const yMin = yMinRaw - yPad;
  const yMax = yMaxRaw + yPad;
  const ySpan = Math.max(yMax - yMin, 1e-9);

  const toX = (t: number) => padL + ((t - tMin) / tSpan) * plotW;
  const toY = (y: number) => padT + plotH - ((y - yMin) / ySpan) * plotH;

  const buildPath = (series?: { t: number[]; y: number[] }) => {
    if (!series || series.t.length === 0) return "";
    const stride = Math.max(1, Math.floor(series.t.length / 240));
    const pts: string[] = [];
    for (let i = 0; i < series.t.length; i += stride) {
      pts.push(`${pts.length === 0 ? "M" : "L"}${toX(series.t[i]!).toFixed(1)},${toY(series.y[i]!).toFixed(1)}`);
    }
    const last = series.t.length - 1;
    if (last % stride !== 0) {
      pts.push(`L${toX(series.t[last]!).toFixed(1)},${toY(series.y[last]!).toFixed(1)}`);
    }
    return pts.join(" ");
  };

  const gridStroke = isDark ? "rgba(255,255,255,0.08)" : "rgba(15,23,42,0.08)";
  const textFill = isDark ? "#8b949e" : "#57606a";
  const measuredPath = buildPath(measured);
  const simulatedPath = buildPath(simulated);

  return (
    <div
      style={{
        border: `1px solid ${isDark ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.1)"}`,
        borderRadius: 6,
        padding: 8,
        backgroundColor: isDark ? "rgba(255,255,255,0.02)" : "rgba(15,23,42,0.015)",
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 4 }}>
        <span style={{ fontSize: 12, fontWeight: 600 }}>{title}</span>
        <div style={{ display: "flex", gap: 10, fontSize: 11, color: textFill }}>
          <span style={{ color: "#f59e0b" }}>● Measured (COMTRADE/CSV)</span>
          <span style={{ color: "#0ea5e9" }}>━ Calibrated Model</span>
        </div>
      </div>
      <svg viewBox={`0 0 ${width} ${height}`} style={{ width: "100%", height: "auto", display: "block" }}>
        {[0, 0.5, 1].map((frac) => {
          const y = padT + plotH * (1 - frac);
          const val = yMin + ySpan * frac;
          return (
            <g key={frac}>
              <line x1={padL} y1={y} x2={width - padR} y2={y} stroke={gridStroke} strokeDasharray="3,3" />
              <text x={padL - 5} y={y + 3} textAnchor="end" fontSize="9" fill={textFill}>
                {val.toPrecision(3)}
              </text>
            </g>
          );
        })}
        <text x={padL} y={height - 6} fontSize="9" fill={textFill}>
          {tMin.toFixed(2)}s
        </text>
        <text x={width - padR} y={height - 6} textAnchor="end" fontSize="9" fill={textFill}>
          {tMax.toFixed(2)}s
        </text>
        {measuredPath && <path d={measuredPath} fill="none" stroke="#f59e0b" strokeWidth="1.6" strokeDasharray="4,2" />}
        {simulatedPath && <path d={simulatedPath} fill="none" stroke="#0ea5e9" strokeWidth="2" />}
      </svg>
    </div>
  );
};

export const AnsatzCalibrationPanel: React.FC<AnsatzCalibrationPanelProps> = ({
  projectFiles,
  activeFileName,
  activeCode,
  documentUri,
  colorMode,
  onUpdateProjectFile,
  onCodeChange,
}) => {
  const isDark = colorMode === "dark";
  const fileInputRef = useRef<HTMLInputElement | null>(null);

  const modelicaFiles = useMemo(() => {
    const names = Object.keys(projectFiles ?? {}).filter((f) => /\.mo$/i.test(f));
    if (names.length === 0 && activeFileName && /\.mo$/i.test(activeFileName)) {
      return [activeFileName];
    }
    return names;
  }, [projectFiles, activeFileName]);

  const datasetFiles = useMemo(() => {
    return Object.keys(projectFiles ?? {}).filter((f) => /\.(cff|cfg|csv)$/i.test(f));
  }, [projectFiles]);

  const [selectedModelFile, setSelectedModelFile] = useState<string>(modelicaFiles[0] ?? activeFileName ?? "");
  const [selectedDatasetFile, setSelectedDatasetFile] = useState<string>(datasetFiles[0] ?? "");
  const [uploadedDataset, setUploadedDataset] = useState<{ name: string; content: string } | null>(null);
  const [comtradeMode, setComtradeMode] = useState<"raw" | "phasor">("raw");
  const [method, setMethod] = useState<"lm" | "sqp">("lm");
  const [maxIterations, setMaxIterations] = useState<number>(60);
  const [selectedParams, setSelectedParams] = useState<Record<string, boolean>>({});
  const [paramBounds, setParamBounds] = useState<Record<string, { min: string; max: string }>>({});
  const [channelMapping, setChannelMapping] = useState<Record<string, string>>({});
  const [isRunning, setIsRunning] = useState(false);
  const [result, setResult] = useState<CalibrateResult | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [appliedBanner, setAppliedBanner] = useState(false);

  // Sync defaults when workspace files change
  useEffect(() => {
    if (modelicaFiles.length > 0 && !modelicaFiles.includes(selectedModelFile)) {
      setSelectedModelFile(modelicaFiles[0]!);
    }
  }, [modelicaFiles, selectedModelFile]);

  useEffect(() => {
    if (datasetFiles.length > 0 && !datasetFiles.includes(selectedDatasetFile) && !uploadedDataset) {
      setSelectedDatasetFile(datasetFiles[0]!);
    }
  }, [datasetFiles, selectedDatasetFile, uploadedDataset]);

  const modelSource = useMemo(() => {
    if (selectedModelFile && projectFiles?.[selectedModelFile] !== undefined) {
      return projectFiles[selectedModelFile]!;
    }
    return activeCode ?? "";
  }, [selectedModelFile, projectFiles, activeCode]);

  const [parsedParams, setParsedParams] = useState<ParsedParam[]>([]);
  const [modelVars, setModelVars] = useState<string[]>([]);

  useEffect(() => {
    if (!documentUri) return;
    let cancelled = false;
    const basePrefix = documentUri.replace(/\/[^/]+$/, "");
    const targetUri =
      !selectedModelFile || selectedModelFile === activeFileName
        ? documentUri
        : `${basePrefix}/${selectedModelFile.replace(/^\/+/, "")}`;

    void getModelParameters(targetUri)
      .then((res) => {
        if (cancelled) return;
        const vals = res.parameterValues ?? {};
        setParsedParams(
          (res.parameters ?? []).map((name) => ({
            name,
            value: typeof vals[name] === "number" && Number.isFinite(vals[name]) ? vals[name]! : 0,
          })),
        );
        setModelVars(res.variables ?? []);
      })
      .catch(() => {
        if (!cancelled) {
          setParsedParams([]);
          setModelVars([]);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [documentUri, selectedModelFile, activeFileName, modelSource]);

  const datasetContent = useMemo(() => {
    if (uploadedDataset) return uploadedDataset.content;
    if (selectedDatasetFile && projectFiles?.[selectedDatasetFile] !== undefined) {
      return projectFiles[selectedDatasetFile]!;
    }
    return "";
  }, [uploadedDataset, selectedDatasetFile, projectFiles]);

  const datasetName = uploadedDataset?.name ?? selectedDatasetFile;

  const { isComtrade, channels } = useMemo(
    () => (datasetContent ? extractDatasetChannels(datasetName, datasetContent) : { isComtrade: false, channels: [] }),
    [datasetName, datasetContent],
  );

  // Initialize parameter selection and bounds
  useEffect(() => {
    setSelectedParams((prev) => {
      const next: Record<string, boolean> = {};
      for (let i = 0; i < parsedParams.length; i++) {
        const p = parsedParams[i]!;
        next[p.name] = prev[p.name] ?? i < 3;
      }
      return next;
    });
    setParamBounds((prev) => {
      const next: Record<string, { min: string; max: string }> = {};
      for (const p of parsedParams) {
        if (prev[p.name]) {
          next[p.name] = prev[p.name]!;
        } else {
          const lo = p.value > 0 ? Number((p.value * 0.2).toPrecision(3)) : Number((p.value - 5).toPrecision(3));
          const hi = p.value > 0 ? Number((p.value * 5.0).toPrecision(3)) : Number((p.value + 5).toPrecision(3));
          next[p.name] = { min: String(lo), max: String(hi) };
        }
      }
      return next;
    });
  }, [parsedParams]);

  // Auto-map dataset channels to matching Modelica variables
  useEffect(() => {
    setChannelMapping((prev) => {
      const next: Record<string, string> = {};
      for (const ch of channels) {
        if (prev[ch]) {
          next[ch] = prev[ch]!;
        } else {
          const exact = modelVars.find((v) => v.toLowerCase() === ch.toLowerCase());
          next[ch] = exact ?? modelVars[0] ?? ch;
        }
      }
      return next;
    });
  }, [channels, modelVars]);

  const handleFileUpload = useCallback((e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onload = () => {
      setUploadedDataset({ name: file.name, content: String(reader.result ?? "") });
    };
    reader.readAsText(file);
  }, []);

  const handleRunCalibration = useCallback(async () => {
    if (!documentUri) {
      setErrorMsg("No active document URI available for LSP calibration.");
      return;
    }
    const activeParamList = parsedParams.filter((p) => selectedParams[p.name]).map((p) => p.name);
    if (activeParamList.length === 0) {
      setErrorMsg("Select at least one parameter to calibrate.");
      return;
    }
    if (!datasetContent.trim()) {
      setErrorMsg("Select or upload a COMTRADE (.cff) or CSV measurement file.");
      return;
    }

    setIsRunning(true);
    setErrorMsg(null);
    setAppliedBanner(false);
    try {
      const basePrefix = documentUri.replace(/\/[^/]+$/, "");
      const targetUri =
        !selectedModelFile || selectedModelFile === activeFileName
          ? documentUri
          : `${basePrefix}/${selectedModelFile.replace(/^\/+/, "")}`;

      const boundsPayload: Record<string, { min: number; max: number }> = {};
      for (const pName of activeParamList) {
        const b = paramBounds[pName];
        if (b) {
          const min = Number.parseFloat(b.min);
          const max = Number.parseFloat(b.max);
          if (Number.isFinite(min) && Number.isFinite(max) && max > min) {
            boundsPayload[pName] = { min, max };
          }
        }
      }

      const res = await calibrate(targetUri, {
        ...(isComtrade ? { comtradeData: datasetContent, comtradeMode } : { csvData: datasetContent }),
        columnMapping: channelMapping,
        parameters: activeParamList,
        parameterBounds: boundsPayload,
        method,
        maxIterations,
      });

      if (!res.success && res.error) {
        setErrorMsg(res.error);
      }
      setResult(res);
    } catch (err) {
      setErrorMsg(err instanceof Error ? err.message : String(err));
    } finally {
      setIsRunning(false);
    }
  }, [
    documentUri,
    parsedParams,
    selectedParams,
    datasetContent,
    selectedModelFile,
    activeFileName,
    paramBounds,
    isComtrade,
    comtradeMode,
    channelMapping,
    method,
    maxIterations,
  ]);

  const handleApplyParameters = useCallback(async () => {
    if (!result?.parameters || Object.keys(result.parameters).length === 0 || !documentUri) return;
    const basePrefix = documentUri.replace(/\/[^/]+$/, "");
    const targetUri =
      !selectedModelFile || selectedModelFile === activeFileName
        ? documentUri
        : `${basePrefix}/${selectedModelFile.replace(/^\/+/, "")}`;

    const collectedEdits: Array<{
      range: { start: { line: number; character: number }; end: { line: number; character: number } };
      newText: string;
    }> = [];
    for (const [name, val] of Object.entries(result.parameters)) {
      if (!Number.isFinite(val)) continue;
      const formatted = Number(val.toPrecision(6)).toString();
      try {
        const res = await computeWritebackEdit({ documentUri: targetUri, target: name, newValue: formatted });
        const changes = res.workspaceEdit?.changes;
        if (res.success && changes) {
          for (const edits of Object.values(changes)) {
            collectedEdits.push(...edits);
          }
        }
      } catch {
        // Ignore individual writeback failure
      }
    }

    if (collectedEdits.length > 0) {
      const updated = applyLspTextEditsToString(modelSource, collectedEdits);
      if (selectedModelFile && onUpdateProjectFile) {
        onUpdateProjectFile(selectedModelFile, updated);
      } else if (onCodeChange) {
        onCodeChange(updated);
      }
      setAppliedBanner(true);
    }
  }, [result, documentUri, selectedModelFile, activeFileName, modelSource, onUpdateProjectFile, onCodeChange]);

  const borderCol = isDark ? "rgba(255,255,255,0.1)" : "rgba(15,23,42,0.1)";
  const mutedText = isDark ? "#8b949e" : "#57606a";
  const inputStyle: React.CSSProperties = {
    background: isDark ? "#0d1117" : "#ffffff",
    color: isDark ? "#e6edf3" : "#1f2328",
    border: `1px solid ${borderCol}`,
    borderRadius: 5,
    padding: "4px 8px",
    fontSize: 12,
  };

  return (
    <div
      style={{
        flex: 1,
        minHeight: 0,
        overflowY: "auto",
        padding: 16,
        display: "flex",
        flexDirection: "column",
        gap: 14,
        fontSize: 12,
      }}
    >
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: 8 }}>
        <div>
          <div style={{ fontSize: 14, fontWeight: 600 }}>In-Browser Parameter Calibration</div>
          <div style={{ fontSize: 11, color: mutedText }}>
            Fit Modelica parameters to IEEE COMTRADE (.cff) disturbance records or CSV measurements using WASM DAE
            simulation.
          </div>
        </div>
        <Button
          variant="primary"
          size="small"
          leadingVisual={PlayIcon}
          disabled={isRunning || !datasetContent}
          onClick={() => void handleRunCalibration()}
        >
          {isRunning ? "Calibrating…" : "Run Calibration"}
        </Button>
      </div>

      {/* Model + Dataset Selectors */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(auto-fit, minmax(220px, 1fr))",
          gap: 10,
          padding: 10,
          borderRadius: 6,
          border: `1px solid ${borderCol}`,
        }}
      >
        <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 11, color: mutedText }}>Target Modelica Model</span>
          <select value={selectedModelFile} onChange={(e) => setSelectedModelFile(e.target.value)} style={inputStyle}>
            {modelicaFiles.map((f) => (
              <option key={f} value={f}>
                {f}
              </option>
            ))}
          </select>
        </label>

        <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
          <span style={{ fontWeight: 600, fontSize: 11, color: mutedText }}>Measurement Data (.cff / .csv)</span>
          <div style={{ display: "flex", gap: 6 }}>
            <select
              value={uploadedDataset ? "__uploaded__" : selectedDatasetFile}
              onChange={(e) => {
                if (e.target.value !== "__uploaded__") {
                  setUploadedDataset(null);
                  setSelectedDatasetFile(e.target.value);
                }
              }}
              style={{ ...inputStyle, flex: 1 }}
            >
              {uploadedDataset && <option value="__uploaded__">Uploaded: {uploadedDataset.name}</option>}
              {datasetFiles.map((f) => (
                <option key={f} value={f}>
                  {f}
                </option>
              ))}
              {datasetFiles.length === 0 && !uploadedDataset && <option value="">No .cff / .csv in workspace</option>}
            </select>
            <input
              ref={fileInputRef}
              type="file"
              accept=".cff,.cfg,.csv,.txt"
              style={{ display: "none" }}
              onChange={handleFileUpload}
            />
            <Button size="small" leadingVisual={UploadIcon} onClick={() => fileInputRef.current?.click()}>
              Upload
            </Button>
          </div>
        </div>

        {isComtrade && (
          <label style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 11, color: mutedText }}>COMTRADE Signal Extraction</span>
            <select
              value={comtradeMode}
              onChange={(e) => setComtradeMode(e.target.value as "raw" | "phasor")}
              style={inputStyle}
            >
              <option value="raw">Raw / Envelope Channels</option>
              <option value="phasor">Fundamental RMS Phasor (60/50 Hz)</option>
            </select>
          </label>
        )}

        <div style={{ display: "flex", gap: 8 }}>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, flex: 1 }}>
            <span style={{ fontWeight: 600, fontSize: 11, color: mutedText }}>Optimizer</span>
            <select value={method} onChange={(e) => setMethod(e.target.value as "lm" | "sqp")} style={inputStyle}>
              <option value="lm">Levenberg-Marquardt (LM)</option>
              <option value="sqp">SQP (Bounded)</option>
            </select>
          </label>
          <label style={{ display: "flex", flexDirection: "column", gap: 4, width: 84 }}>
            <span style={{ fontWeight: 600, fontSize: 11, color: mutedText }}>Max Iter</span>
            <input
              type="number"
              min={5}
              max={300}
              value={maxIterations}
              onChange={(e) => setMaxIterations(Number.parseInt(e.target.value, 10) || 50)}
              style={inputStyle}
            />
          </label>
        </div>
      </div>

      {/* Channel Mapping + Parameters Grid */}
      <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(260px, 1fr))", gap: 12 }}>
        {/* Parameters to Optimize */}
        <div style={{ border: `1px solid ${borderCol}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Parameters to Calibrate</div>
          {parsedParams.length === 0 ? (
            <div style={{ color: mutedText }}>No `parameter Real` declarations found in {selectedModelFile}.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {parsedParams.map((p) => (
                <div key={p.name} style={{ display: "flex", alignItems: "center", gap: 6 }}>
                  <input
                    type="checkbox"
                    checked={Boolean(selectedParams[p.name])}
                    onChange={(e) => setSelectedParams((prev) => ({ ...prev, [p.name]: e.target.checked }))}
                  />
                  <span style={{ fontFamily: "monospace", minWidth: 80, fontWeight: 600 }}>{p.name}</span>
                  <span style={{ color: mutedText, fontSize: 11, minWidth: 44 }}>= {p.value}</span>
                  <input
                    type="text"
                    aria-label={`${p.name} min`}
                    value={paramBounds[p.name]?.min ?? ""}
                    onChange={(e) =>
                      setParamBounds((prev) => ({
                        ...prev,
                        [p.name]: { min: e.target.value, max: prev[p.name]?.max ?? "" },
                      }))
                    }
                    style={{ ...inputStyle, width: 58, padding: "2px 5px" }}
                    placeholder="min"
                  />
                  <span style={{ color: mutedText }}>..</span>
                  <input
                    type="text"
                    aria-label={`${p.name} max`}
                    value={paramBounds[p.name]?.max ?? ""}
                    onChange={(e) =>
                      setParamBounds((prev) => ({
                        ...prev,
                        [p.name]: { min: prev[p.name]?.min ?? "", max: e.target.value },
                      }))
                    }
                    style={{ ...inputStyle, width: 58, padding: "2px 5px" }}
                    placeholder="max"
                  />
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Channel Mapping */}
        <div style={{ border: `1px solid ${borderCol}`, borderRadius: 6, padding: 10 }}>
          <div style={{ fontWeight: 600, marginBottom: 8 }}>Channel → Model Variable Mapping</div>
          {channels.length === 0 ? (
            <div style={{ color: mutedText }}>Select a COMTRADE (.cff) or CSV file to inspect channels.</div>
          ) : (
            <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
              {channels.map((ch) => (
                <div key={ch} style={{ display: "flex", alignItems: "center", gap: 8 }}>
                  <span style={{ fontFamily: "monospace", minWidth: 90 }}>{ch}</span>
                  <span style={{ color: mutedText }}>→</span>
                  <select
                    value={channelMapping[ch] ?? ""}
                    onChange={(e) => setChannelMapping((prev) => ({ ...prev, [ch]: e.target.value }))}
                    style={{ ...inputStyle, flex: 1 }}
                  >
                    <option value="">(ignore)</option>
                    {modelVars.map((v) => (
                      <option key={v} value={v}>
                        {v}
                      </option>
                    ))}
                    {!modelVars.includes(ch) && <option value={ch}>{ch}</option>}
                  </select>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {errorMsg && (
        <div
          style={{
            display: "flex",
            alignItems: "center",
            gap: 8,
            padding: "8px 12px",
            borderRadius: 6,
            background: isDark ? "rgba(248,81,73,0.12)" : "rgba(207,34,46,0.08)",
            border: `1px solid ${isDark ? "rgba(248,81,73,0.4)" : "rgba(207,34,46,0.3)"}`,
            color: isDark ? "#ff7b72" : "#cf222e",
          }}
        >
          <XCircleFillIcon size={14} />
          <span>{errorMsg}</span>
        </div>
      )}

      {/* Results Section */}
      {result && (
        <div style={{ display: "flex", flexDirection: "column", gap: 12 }}>
          <div
            style={{
              display: "flex",
              justifyContent: "space-between",
              alignItems: "center",
              flexWrap: "wrap",
              gap: 8,
              padding: "8px 12px",
              borderRadius: 6,
              border: `1px solid ${borderCol}`,
              background: isDark ? "rgba(46,160,67,0.1)" : "rgba(31,136,61,0.06)",
            }}
          >
            <div style={{ display: "flex", alignItems: "center", gap: 8 }}>
              <CheckCircleFillIcon size={14} fill={result.success ? "#2da44e" : "#d29922"} />
              <strong>{result.success ? "Calibration Converged" : "Calibration Completed"}</strong>
              <span style={{ color: mutedText }}>
                Residual: <code>{result.residual.toExponential(3)}</code> · Iterations: <code>{result.iterations}</code>
              </span>
            </div>
            <Button size="small" variant="primary" onClick={handleApplyParameters}>
              {appliedBanner ? "Applied to Model ✓" : "Apply Calibrated Parameters"}
            </Button>
          </div>

          {/* Parameter Comparison Table */}
          <table style={{ width: "100%", borderCollapse: "collapse", fontSize: 12 }}>
            <thead>
              <tr style={{ borderBottom: `1px solid ${borderCol}`, textAlign: "left", color: mutedText }}>
                <th style={{ padding: "4px 8px" }}>Parameter</th>
                <th style={{ padding: "4px 8px" }}>Initial</th>
                <th style={{ padding: "4px 8px" }}>Calibrated</th>
                <th style={{ padding: "4px 8px" }}>Delta</th>
              </tr>
            </thead>
            <tbody>
              {Object.entries(result.parameters).map(([pName, optVal]) => {
                const initVal = parsedParams.find((p) => p.name === pName)?.value;
                const deltaPct =
                  initVal !== undefined && Math.abs(initVal) > 1e-12
                    ? `${(((optVal - initVal) / initVal) * 100).toFixed(1)}%`
                    : "—";
                return (
                  <tr key={pName} style={{ borderBottom: `1px solid ${borderCol}` }}>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace", fontWeight: 600 }}>{pName}</td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace" }}>
                      {initVal !== undefined ? initVal.toPrecision(4) : "—"}
                    </td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace", color: "#0ea5e9", fontWeight: 600 }}>
                      {optVal.toPrecision(5)}
                    </td>
                    <td style={{ padding: "4px 8px", fontFamily: "monospace", color: mutedText }}>{deltaPct}</td>
                  </tr>
                );
              })}
            </tbody>
          </table>

          {/* Measured vs Simulated Overlay Charts */}
          <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(320px, 1fr))", gap: 10 }}>
            {Object.entries(result.measured ?? {}).map(([varName, meas]) => {
              const stIdx = result.simulated.states.indexOf(varName);
              const simSeries =
                stIdx >= 0
                  ? {
                      t: result.simulated.t,
                      y: result.simulated.y.map((row) => row[stIdx]!),
                    }
                  : undefined;
              return (
                <OverlaySvgChart
                  key={varName}
                  title={`Trajectory Fit: ${varName}`}
                  measured={meas}
                  simulated={simSeries}
                  isDark={isDark}
                />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
};
