// SPDX-License-Identifier: AGPL-3.0-or-later

import { PanelButton } from "@modelscript/design-tokens/panel";
import type { XmlElement } from "@modelscript/dsl/xml";
import React, { useMemo, useState } from "react";
import {
  applySplices,
  buildProjectModel,
  parsePscx,
  planPscadEdits,
  readDefinitionForm,
  type PscadEditOp,
} from "../index.js";
import { parsePscadXmlDocument } from "../parser/wasm-loader.js";

type PortSide = "left" | "right" | "top" | "bottom";
type WizardPort = { name: string; mode: "In" | "Out" | "Electrical"; dim: number; side: PortSide };
type WizardShape = {
  kind: "rect" | "line" | "circle" | "text";
  x: number;
  y: number;
  w?: number;
  h?: number;
  x2?: number;
  y2?: number;
  r?: number;
  text?: string;
};
type WizardParam = {
  name: string;
  label: string;
  type: "Real" | "Integer" | "Text" | "Boolean";
  defaultValue: string;
  unit: string;
  cond: string;
  vis: string;
};

function getXmlAttr(el: XmlElement, name: string): string | undefined {
  const lower = name.toLowerCase();
  return el.attributes.find((a) => a.name.toLowerCase() === lower)?.value;
}

function collectGfxElements(el: XmlElement, out: XmlElement[]): void {
  if (el.name.toLowerCase() === "gfx") {
    out.push(el);
  }
  for (const child of el.children) {
    collectGfxElements(child, out);
  }
}

function findTextParamValue(el: XmlElement): string | undefined {
  if (el.name.toLowerCase() === "param" && getXmlAttr(el, "name")?.toLowerCase() === "text") {
    return getXmlAttr(el, "value") ?? "";
  }
  for (const child of el.children) {
    const found = findTextParamValue(child);
    if (found !== undefined) return found;
  }
  return undefined;
}

function parseGfxShapes(graphicsXml?: string): WizardShape[] {
  if (!graphicsXml) return [];
  const doc = parsePscadXmlDocument(graphicsXml);
  if (!doc.root) return [];
  const gfxElements: XmlElement[] = [];
  collectGfxElements(doc.root, gfxElements);
  const shapes: WizardShape[] = [];
  for (const gfx of gfxElements) {
    const getA = (k: string): string | undefined => getXmlAttr(gfx, k);
    const cls = (getA("classid") ?? "").toLowerCase();
    if (cls.includes("rectangle")) {
      shapes.push({
        kind: "rect",
        x: parseFloat(getA("x") ?? "-28") || 0,
        y: parseFloat(getA("y") ?? "-20") || 0,
        w: parseFloat(getA("w") ?? "56") || 40,
        h: parseFloat(getA("h") ?? "40") || 32,
      });
    } else if (cls.includes("line")) {
      shapes.push({
        kind: "line",
        x: parseFloat(getA("x1") ?? getA("x") ?? "-20") || 0,
        y: parseFloat(getA("y1") ?? getA("y") ?? "0") || 0,
        x2: parseFloat(getA("x2") ?? "20") || 20,
        y2: parseFloat(getA("y2") ?? "0") || 0,
      });
    } else if (cls.includes("ellipse") || cls.includes("circle")) {
      shapes.push({
        kind: "circle",
        x: parseFloat(getA("x") ?? "0") || 0,
        y: parseFloat(getA("y") ?? "0") || 0,
        r: (parseFloat(getA("w") ?? "24") || 24) / 2,
      });
    } else if (cls.includes("text")) {
      shapes.push({
        kind: "text",
        x: parseFloat(getA("x") ?? "0") || 0,
        y: parseFloat(getA("y") ?? "4") || 0,
        text: findTextParamValue(gfx) ?? "",
      });
    }
  }
  return shapes;
}

function cycleSide(side: PortSide): PortSide {
  if (side === "left") return "top";
  if (side === "top") return "right";
  if (side === "right") return "bottom";
  return "left";
}

function portPreviewCoords(
  pt: WizardPort,
  idx: number,
  sameSideCount: number,
  sameSideIdx: number,
): { x: number; y: number } {
  const spread = (sameSideIdx - (sameSideCount - 1) / 2) * 16;
  if (pt.side === "left") return { x: -54, y: Math.round(spread) || (idx === 0 ? 0 : spread) };
  if (pt.side === "right") return { x: 54, y: Math.round(spread) || (idx === 0 ? 0 : spread) };
  if (pt.side === "top") return { x: Math.round(spread), y: -36 };
  return { x: Math.round(spread), y: 36 };
}

export interface PscadComponentWizardModalProps {
  code: string;
  colorMode: "light" | "dark";
  onApplyCode: (nextCode: string) => void;
  onClose: () => void;
}

export const PscadComponentWizardModal: React.FC<PscadComponentWizardModalProps> = ({
  code,
  colorMode,
  onApplyCode,
  onClose,
}) => {
  const existingDefinitions = useMemo(() => {
    try {
      const model = buildProjectModel(code);
      const parsed = parsePscx(code);
      return Array.from(model.definitions.values())
        .filter((d) => d.name.toLowerCase() !== "main")
        .map((d) => ({
          modelDef: d,
          parsedDef: parsed.definitions?.get(d.name),
          form: readDefinitionForm(d),
        }));
    } catch {
      return [];
    }
  }, [code]);

  const [mode, setMode] = useState<"create" | "edit">("create");
  const [selectedExisting, setSelectedExisting] = useState("");
  const [name, setName] = useState("CustomBlock");
  const [description, setDescription] = useState("User-defined PSCAD component");
  const [ports, setPorts] = useState<WizardPort[]>([
    { name: "In1", mode: "In", dim: 1, side: "left" },
    { name: "Out1", mode: "Out", dim: 1, side: "right" },
  ]);
  const [shapes, setShapes] = useState<WizardShape[]>([
    { kind: "rect", x: -40, y: -26, w: 80, h: 52 },
    { kind: "text", x: 0, y: 4, text: "USER" },
  ]);
  const [params, setParams] = useState<WizardParam[]>([
    { name: "K", label: "Gain", type: "Real", defaultValue: "1.0", unit: "", cond: "", vis: "" },
  ]);
  const [dsdyn, setDsdyn] = useState("$Out1 = $K * $In1;");

  const bg = colorMode === "dark" ? "#161b22" : "#ffffff";
  const subBg = colorMode === "dark" ? "#0d1117" : "#f6f8fa";
  const border = colorMode === "dark" ? "1px solid #30363d" : "1px solid #d0d7de";
  const strokeColor = colorMode === "dark" ? "#e6edf3" : "#1f2328";
  const inputStyle: React.CSSProperties = {
    fontSize: 11,
    padding: "4px 8px",
    borderRadius: 6,
    background: subBg,
    color: strokeColor,
    border,
    width: "100%",
    boxSizing: "border-box",
  };
  const selectStyle: React.CSSProperties = {
    fontSize: 11,
    padding: "4px 6px",
    borderRadius: 6,
    background: subBg,
    color: strokeColor,
    border,
  };

  const loadExistingDefinition = (defName: string) => {
    const found = existingDefinitions.find((d) => d.modelDef.name === defName);
    if (!found) return;
    setSelectedExisting(defName);
    setName(found.modelDef.name);
    setDescription(found.parsedDef?.description ?? found.modelDef.name);
    setPorts(
      found.modelDef.ports.map((p) => {
        const side: PortSide =
          Math.abs(p.x) >= Math.abs(p.y) ? (p.x < 0 ? "left" : "right") : p.y < 0 ? "top" : "bottom";
        const ptMode: "In" | "Out" | "Electrical" = p.mode === 2 ? "Out" : p.mode === 1 ? "In" : "Electrical";
        return { name: p.name, mode: ptMode, dim: p.dim || 1, side };
      }),
    );
    const parsedShapes = parseGfxShapes(found.parsedDef?.graphicsXml);
    setShapes(
      parsedShapes.length > 0
        ? parsedShapes
        : [
            { kind: "rect", x: -40, y: -26, w: 80, h: 52 },
            { kind: "text", x: 0, y: 4, text: found.modelDef.name },
          ],
    );
    const loadedParams: WizardParam[] = [];
    for (const cat of found.form?.categories ?? []) {
      for (const p of cat.parameters) {
        const t = p.type === "Integer" || p.type === "Text" || p.type === "Boolean" ? p.type : ("Real" as const);
        loadedParams.push({
          name: p.name,
          label: p.label,
          type: t,
          defaultValue: p.defaultValue,
          unit: p.unit,
          cond: p.cond,
          vis: p.vis,
        });
      }
    }
    setParams(loadedParams);
    setDsdyn(found.parsedDef?.scriptSegments?.get("dsdyn")?.content ?? "");
  };

  const handleSave = () => {
    const cleanName = (mode === "edit" && selectedExisting ? selectedExisting : name).trim() || "CustomBlock";
    const resolvedPorts = ports.map((pt, idx) => {
      const sameSide = ports.filter((other) => other.side === pt.side);
      const sameIdx = sameSide.indexOf(pt);
      const pos = portPreviewCoords(pt, idx, sameSide.length, sameIdx);
      return { name: pt.name, mode: pt.mode, dim: pt.dim, side: pt.side, x: pos.x, y: pos.y };
    });
    const trimmedDsdyn = dsdyn.trim();
    const op: PscadEditOp = {
      type: mode === "edit" && selectedExisting ? "updateDefinition" : "addDefinition",
      name: cleanName,
      description: description.trim(),
      ports: resolvedPorts,
      shapes,
      parameters: params.map((p) => {
        const trimmedCond = p.cond.trim();
        const trimmedVis = p.vis.trim();
        return {
          name: p.name,
          label: p.label,
          type: p.type,
          defaultValue: p.defaultValue,
          unit: p.unit,
          ...(trimmedCond ? { cond: trimmedCond } : {}),
          ...(trimmedVis ? { vis: trimmedVis } : {}),
        };
      }),
      ...(trimmedDsdyn ? { dsdyn: trimmedDsdyn } : {}),
    };
    const plan = planPscadEdits(code, [op]);
    if (plan.splices.length > 0) {
      onApplyCode(applySplices(code, plan.splices));
    }
    onClose();
  };

  return (
    <div
      data-color-mode={colorMode}
      style={{
        position: "fixed",
        inset: 0,
        zIndex: 1000,
        backgroundColor: "rgba(0,0,0,0.55)",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        padding: 16,
      }}
      onClick={onClose}
    >
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: 700,
          maxWidth: "96vw",
          maxHeight: "92vh",
          overflowY: "auto",
          backgroundColor: bg,
          color: strokeColor,
          border,
          borderRadius: 12,
          padding: 18,
          display: "flex",
          flexDirection: "column",
          gap: 12,
          boxShadow: "0 16px 40px rgba(0,0,0,0.35)",
        }}
      >
        <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <span style={{ fontWeight: 700, fontSize: 14 }}>PSCAD Visual Component Workshop (&lt;Definition&gt;)</span>
          <div style={{ display: "flex", alignItems: "center", gap: 6 }}>
            <PanelButton
              variant={mode === "create" ? "primary" : "default"}
              onClick={() => {
                setMode("create");
                setSelectedExisting("");
              }}
            >
              Create New
            </PanelButton>
            {existingDefinitions.length > 0 && (
              <PanelButton
                variant={mode === "edit" ? "primary" : "default"}
                onClick={() => {
                  setMode("edit");
                  const first = selectedExisting || existingDefinitions[0]!.modelDef.name;
                  loadExistingDefinition(first);
                }}
              >
                Edit Existing
              </PanelButton>
            )}
            <PanelButton variant="ghost" onClick={onClose}>
              ✕
            </PanelButton>
          </div>
        </div>

        {mode === "edit" && existingDefinitions.length > 0 && (
          <label style={{ fontSize: 11, display: "flex", alignItems: "center", gap: 8 }}>
            <span style={{ fontWeight: 600 }}>Target &lt;Definition&gt;:</span>
            <select
              value={selectedExisting}
              onChange={(e) => loadExistingDefinition(e.target.value)}
              style={{
                ...selectStyle,
                padding: "4px 8px",
                flex: 1,
              }}
            >
              {existingDefinitions.map((d) => (
                <option key={d.modelDef.name} value={d.modelDef.name}>
                  {d.modelDef.name} ({d.modelDef.ports.length} ports)
                </option>
              ))}
            </select>
          </label>
        )}

        <div style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 8 }}>
          <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
            Definition Name
            <input
              value={name}
              disabled={mode === "edit"}
              onChange={(e) => setName(e.target.value)}
              style={{ ...inputStyle, opacity: mode === "edit" ? 0.6 : 1 }}
            />
          </label>
          <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
            Description
            <input value={description} onChange={(e) => setDescription(e.target.value)} style={inputStyle} />
          </label>
        </div>

        {/* Interactive Vector Symbol & Port Preview */}
        <div
          style={{ display: "grid", gridTemplateColumns: "200px 1fr", gap: 10, border, borderRadius: 8, padding: 10 }}
        >
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Icon Preview (click pin to rotate side)</span>
            <svg
              width={190}
              height={120}
              viewBox="-80 -50 160 100"
              style={{ border, borderRadius: 6, background: subBg }}
              aria-label="Component symbol preview"
            >
              <line x1={-80} y1={0} x2={80} y2={0} stroke="rgba(128,128,128,0.18)" strokeWidth={0.5} />
              <line x1={0} y1={-50} x2={0} y2={50} stroke="rgba(128,128,128,0.18)" strokeWidth={0.5} />
              {shapes.map((s, idx) => {
                if (s.kind === "rect") {
                  return (
                    <rect
                      key={idx}
                      x={s.x}
                      y={s.y}
                      width={s.w ?? 40}
                      height={s.h ?? 32}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  );
                }
                if (s.kind === "line") {
                  return (
                    <line
                      key={idx}
                      x1={s.x}
                      y1={s.y}
                      x2={s.x2 ?? s.x + 20}
                      y2={s.y2 ?? s.y}
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  );
                }
                if (s.kind === "circle") {
                  return (
                    <circle
                      key={idx}
                      cx={s.x}
                      cy={s.y}
                      r={s.r ?? 12}
                      fill="none"
                      stroke={strokeColor}
                      strokeWidth={1.5}
                    />
                  );
                }
                return (
                  <text
                    key={idx}
                    x={s.x}
                    y={s.y}
                    textAnchor="middle"
                    fontSize={9}
                    fill={strokeColor}
                    fontFamily="monospace"
                  >
                    {s.text ?? ""}
                  </text>
                );
              })}
              {ports.map((pt, idx) => {
                const sameSide = ports.filter((other) => other.side === pt.side);
                const sameIdx = sameSide.indexOf(pt);
                const pos = portPreviewCoords(pt, idx, sameSide.length, sameIdx);
                const pinColor = pt.mode === "Out" ? "#3fb950" : pt.mode === "Electrical" ? "#f59e0b" : "#38bdf8";
                return (
                  <g
                    key={idx}
                    style={{ cursor: "pointer" }}
                    onClick={() =>
                      setPorts((prev) => prev.map((x, i) => (i === idx ? { ...x, side: cycleSide(x.side) } : x)))
                    }
                  >
                    <circle cx={pos.x} cy={pos.y} r={3.5} fill={pinColor} />
                    <text
                      x={pt.side === "left" ? pos.x - 5 : pt.side === "right" ? pos.x + 5 : pos.x}
                      y={pt.side === "top" ? pos.y - 5 : pt.side === "bottom" ? pos.y + 9 : pos.y + 2}
                      textAnchor={pt.side === "left" ? "end" : pt.side === "right" ? "start" : "middle"}
                      fontSize={7}
                      fill={pinColor}
                    >
                      {pt.name}
                    </text>
                  </g>
                );
              })}
            </svg>
          </div>

          <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
            <div
              style={{
                display: "flex",
                justifyContent: "space-between",
                alignItems: "center",
                gap: 4,
                flexWrap: "wrap",
              }}
            >
              <span style={{ fontSize: 11, fontWeight: 600 }}>Vector Symbol (&lt;Gfx&gt;)</span>
              <div style={{ display: "flex", gap: 4 }}>
                <PanelButton onClick={() => setShapes((s) => [...s, { kind: "rect", x: -24, y: -16, w: 48, h: 32 }])}>
                  + Rect
                </PanelButton>
                <PanelButton onClick={() => setShapes((s) => [...s, { kind: "line", x: -20, y: 0, x2: 20, y2: 0 }])}>
                  + Line
                </PanelButton>
                <PanelButton onClick={() => setShapes((s) => [...s, { kind: "circle", x: 0, y: 0, r: 12 }])}>
                  + Circle
                </PanelButton>
                <PanelButton
                  onClick={() => setShapes((s) => [...s, { kind: "text", x: 0, y: 4, text: name || "SYM" }])}
                >
                  + Text
                </PanelButton>
              </div>
            </div>
            <div style={{ display: "flex", flexDirection: "column", gap: 4, maxHeight: 110, overflowY: "auto" }}>
              {shapes.map((sh, idx) => (
                <div
                  key={idx}
                  style={{
                    display: "grid",
                    gridTemplateColumns: "56px 1fr 1fr 1fr 1fr auto",
                    gap: 4,
                    alignItems: "center",
                    fontSize: 11,
                  }}
                >
                  <span style={{ fontFamily: "monospace", fontSize: 10 }}>{sh.kind}</span>
                  <input
                    type="number"
                    aria-label="shape x"
                    value={String(sh.x)}
                    style={inputStyle}
                    onChange={(e) =>
                      setShapes((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, x: Number(e.target.value) || 0 } : x)),
                      )
                    }
                  />
                  <input
                    type="number"
                    aria-label="shape y"
                    value={String(sh.y)}
                    style={inputStyle}
                    onChange={(e) =>
                      setShapes((prev) =>
                        prev.map((x, i) => (i === idx ? { ...x, y: Number(e.target.value) || 0 } : x)),
                      )
                    }
                  />
                  {sh.kind === "rect" ? (
                    <>
                      <input
                        type="number"
                        aria-label="shape w"
                        value={String(sh.w ?? 40)}
                        style={inputStyle}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, w: Number(e.target.value) || 10 } : x)),
                          )
                        }
                      />
                      <input
                        type="number"
                        aria-label="shape h"
                        value={String(sh.h ?? 32)}
                        style={inputStyle}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, h: Number(e.target.value) || 10 } : x)),
                          )
                        }
                      />
                    </>
                  ) : sh.kind === "line" ? (
                    <>
                      <input
                        type="number"
                        aria-label="shape x2"
                        value={String(sh.x2 ?? 20)}
                        style={inputStyle}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, x2: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                      <input
                        type="number"
                        aria-label="shape y2"
                        value={String(sh.y2 ?? 0)}
                        style={inputStyle}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) => (i === idx ? { ...x, y2: Number(e.target.value) || 0 } : x)),
                          )
                        }
                      />
                    </>
                  ) : sh.kind === "circle" ? (
                    <>
                      <input
                        type="number"
                        aria-label="circle radius"
                        value={String(sh.r ?? 12)}
                        style={inputStyle}
                        onChange={(e) =>
                          setShapes((prev) =>
                            prev.map((x, i) =>
                              i === idx ? { ...x, r: Math.max(2, Number(e.target.value) || 12) } : x,
                            ),
                          )
                        }
                      />
                      <span />
                    </>
                  ) : (
                    <>
                      <input
                        aria-label="label text"
                        value={sh.text ?? ""}
                        style={inputStyle}
                        onChange={(e) =>
                          setShapes((prev) => prev.map((x, i) => (i === idx ? { ...x, text: e.target.value } : x)))
                        }
                      />
                      <span />
                    </>
                  )}
                  <PanelButton variant="ghost" onClick={() => setShapes((s) => s.filter((_, i) => i !== idx))}>
                    ✕
                  </PanelButton>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Ports with Edge Side */}
        <div style={{ border, borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Ports (&lt;port&gt;)</span>
            <PanelButton
              onClick={() => setPorts((p) => [...p, { name: `P${p.length + 1}`, mode: "In", dim: 1, side: "left" }])}
            >
              + Port
            </PanelButton>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {ports.map((pt, idx) => (
              <div key={idx} style={{ display: "flex", gap: 6, alignItems: "center" }}>
                <input
                  value={pt.name}
                  style={{ ...inputStyle, width: "auto", flex: 1 }}
                  onChange={(e) =>
                    setPorts((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
                <select
                  value={pt.mode}
                  onChange={(e) =>
                    setPorts((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, mode: e.target.value as "In" | "Out" | "Electrical" } : x,
                      ),
                    )
                  }
                  style={selectStyle}
                >
                  <option value="In">In</option>
                  <option value="Out">Out</option>
                  <option value="Electrical">Electrical</option>
                </select>
                <select
                  value={pt.side}
                  aria-label="Port side"
                  onChange={(e) =>
                    setPorts((prev) => prev.map((x, i) => (i === idx ? { ...x, side: e.target.value as PortSide } : x)))
                  }
                  style={selectStyle}
                >
                  <option value="left">Left</option>
                  <option value="right">Right</option>
                  <option value="top">Top</option>
                  <option value="bottom">Bottom</option>
                </select>
                <PanelButton variant="ghost" onClick={() => setPorts((p) => p.filter((_, i) => i !== idx))}>
                  ✕
                </PanelButton>
              </div>
            ))}
          </div>
        </div>

        {/* Form Parameters with Conditional Visibility Rules */}
        <div style={{ border, borderRadius: 8, padding: 10 }}>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: 6 }}>
            <span style={{ fontSize: 11, fontWeight: 600 }}>Parameters (&lt;form&gt; with cond/vis rules)</span>
            <PanelButton
              onClick={() =>
                setParams((p) => [
                  ...p,
                  {
                    name: `P${p.length + 1}`,
                    label: `Param ${p.length + 1}`,
                    type: "Real",
                    defaultValue: "0",
                    unit: "",
                    cond: "",
                    vis: "",
                  },
                ])
              }
            >
              + Param
            </PanelButton>
          </div>
          <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
            {params.map((pm, idx) => (
              <div
                key={idx}
                style={{ display: "grid", gridTemplateColumns: "1fr 0.8fr 74px 60px 1fr 1fr auto", gap: 4 }}
              >
                <input
                  placeholder="Name"
                  value={pm.name}
                  style={inputStyle}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, name: e.target.value } : x)))
                  }
                />
                <input
                  placeholder="Default"
                  value={pm.defaultValue}
                  style={inputStyle}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, defaultValue: e.target.value } : x)))
                  }
                />
                <select
                  value={pm.type}
                  onChange={(e) =>
                    setParams((prev) =>
                      prev.map((x, i) =>
                        i === idx ? { ...x, type: e.target.value as "Real" | "Integer" | "Text" | "Boolean" } : x,
                      ),
                    )
                  }
                  style={selectStyle}
                >
                  <option value="Real">Real</option>
                  <option value="Integer">Integer</option>
                  <option value="Text">Text</option>
                  <option value="Boolean">Boolean</option>
                </select>
                <input
                  placeholder="Unit"
                  value={pm.unit}
                  style={inputStyle}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, unit: e.target.value } : x)))
                  }
                />
                <input
                  placeholder="cond (e.g. Mode==1)"
                  value={pm.cond}
                  style={inputStyle}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, cond: e.target.value } : x)))
                  }
                />
                <input
                  placeholder="vis rule"
                  value={pm.vis}
                  style={inputStyle}
                  onChange={(e) =>
                    setParams((prev) => prev.map((x, i) => (i === idx ? { ...x, vis: e.target.value } : x)))
                  }
                />
                <PanelButton variant="ghost" onClick={() => setParams((p) => p.filter((_, i) => i !== idx))}>
                  ✕
                </PanelButton>
              </div>
            ))}
          </div>
        </div>

        <label style={{ fontSize: 11, display: "flex", flexDirection: "column", gap: 4 }}>
          Dsdyn Equation / Script
          <textarea
            rows={3}
            value={dsdyn}
            onChange={(e) => setDsdyn(e.target.value)}
            style={{ ...inputStyle, fontFamily: "monospace", resize: "vertical" }}
          />
        </label>

        <div style={{ display: "flex", justifyContent: "flex-end", gap: 8 }}>
          <PanelButton onClick={onClose}>Cancel</PanelButton>
          <PanelButton variant="primary" onClick={handleSave}>
            {mode === "edit" && selectedExisting ? "Update <Definition>" : "Insert <Definition>"}
          </PanelButton>
        </div>
      </div>
    </div>
  );
};

export default PscadComponentWizardModal;
