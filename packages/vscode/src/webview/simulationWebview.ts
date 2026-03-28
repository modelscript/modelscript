// SPDX-License-Identifier: AGPL-3.0-or-later
//
// Simulation results chart webview.
// Receives simulation data via postMessage and renders a time-series chart
// using Canvas2D with VS Code theme-aware colors.
//
// Supports two modes:
// 1. Batch mode: static data from a completed simulation
// 2. Live mode: streaming data from MQTT broker via WebSocket

interface SimulationData {
  t: number[];
  y: number[][];
  states: string[];
}

const COLORS = [
  "#0969da",
  "#2da44e",
  "#bf3989",
  "#db6d28",
  "#8250df",
  "#218bff",
  "#a371f7",
  "#3fb950",
  "#e34c26",
  "#f0883e",
  "#56d364",
  "#79c0ff",
  "#d2a8ff",
  "#ffa657",
];

let currentData: SimulationData | null = null;
let isDark = true;
const hiddenVars = new Set<string>();

// ── Live mode state ──
let isLiveMode = false;
let livePaused = false;
let liveWs: WebSocket | null = null;
const RING_BUFFER_SIZE = 500;

/** Ring buffer per variable for live mode */
interface LiveBuffer {
  times: number[];
  values: Map<string, number[]>; // variable name → value ring buffer
  head: number; // next write position
  count: number; // current count (up to RING_BUFFER_SIZE)
  variableNames: string[];
}

let liveBuffer: LiveBuffer | null = null;
let animFrameId: number | null = null;

/* eslint-disable @typescript-eslint/no-non-null-assertion */
const canvas = document.getElementById("canvas") as HTMLCanvasElement;
const ctx = canvas.getContext("2d")!;
const legendEl = document.getElementById("legend")!;
const placeholderEl = document.getElementById("placeholder")!;
const tooltipEl = document.getElementById("tooltip")!;
const containerEl = document.getElementById("chart-container")!;
const toolbarEl = document.getElementById("toolbar")!;
const liveStatusEl = document.getElementById("live-status")!;
const liveStatusTextEl = document.getElementById("live-status-text")!;
const btnPause = document.getElementById("btn-pause")!;
const btnClear = document.getElementById("btn-clear")!;
/* eslint-enable @typescript-eslint/no-non-null-assertion */

// ── Toolbar buttons ──

btnPause?.addEventListener("click", () => {
  livePaused = !livePaused;
  if (btnPause) btnPause.textContent = livePaused ? "▶ Resume" : "⏸ Pause";
});

btnClear?.addEventListener("click", () => {
  if (liveBuffer) {
    liveBuffer.times = [];
    liveBuffer.values = new Map();
    for (const name of liveBuffer.variableNames) {
      liveBuffer.values.set(name, []);
    }
    liveBuffer.head = 0;
    liveBuffer.count = 0;
  }
});

// Handle messages from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "simulationData") {
    // Batch mode
    isLiveMode = false;
    currentData = msg.data;
    isDark = msg.isDark;
    hiddenVars.clear();
    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.remove("visible");
    stopLiveLoop();
    buildLegend();
    draw();
  } else if (msg.type === "liveMode") {
    // Live MQTT streaming mode
    isLiveMode = true;
    isDark = msg.isDark;
    currentData = null;
    hiddenVars.clear();
    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible");
    connectMqttWs(
      msg.mqttWsUrl as string,
      msg.sessionId as string | undefined,
      msg.participantId as string | undefined,
    );
  }
});

// Resize handling
const resizeObserver = new ResizeObserver(() => {
  if (currentData || (isLiveMode && liveBuffer)) draw();
});
resizeObserver.observe(canvas);

// ── Live mode: MQTT over WebSocket ──

function setLiveStatus(state: "disconnected" | "connecting" | "connected" | "error", text: string): void {
  liveStatusEl.className = `status-indicator ${state}`;
  liveStatusTextEl.textContent = text;
}

function connectMqttWs(wsUrl: string, sessionId?: string, participantId?: string): void {
  // Close existing connection
  if (liveWs) {
    liveWs.close();
    liveWs = null;
  }

  setLiveStatus("connecting", "Connecting…");

  // Initialize empty live buffer
  liveBuffer = {
    times: [],
    values: new Map(),
    head: 0,
    count: 0,
    variableNames: [],
  };

  // Connect via simple WebSocket — the MQTT broker exposes a WebSocket interface on port 9001
  // We use the raw MQTT protocol over WebSocket
  try {
    const ws = new WebSocket(wsUrl, "mqtt");
    ws.binaryType = "arraybuffer";
    liveWs = ws;

    ws.onopen = () => {
      setLiveStatus("connecting", "Authenticating…");
      // Send MQTT CONNECT packet
      sendMqttConnect(ws);
    };

    ws.onmessage = (event) => {
      handleMqttPacket(event.data as ArrayBuffer, sessionId, participantId);
    };

    ws.onerror = () => {
      setLiveStatus("error", "Connection error");
    };

    ws.onclose = () => {
      setLiveStatus("disconnected", "Disconnected");
      stopLiveLoop();
    };
  } catch (e) {
    setLiveStatus("error", `Failed: ${e}`);
  }
}

// ── Minimal MQTT Protocol Handling ──
// We implement just enough MQTT 3.1.1 protocol to CONNECT, SUBSCRIBE, and receive PUBLISH

function sendMqttConnect(ws: WebSocket): void {
  const clientId = `vscode-sim-${Math.random().toString(36).slice(2, 8)}`;
  const clientIdBytes = new TextEncoder().encode(clientId);

  // CONNECT packet
  const protocolName = new TextEncoder().encode("MQTT");
  const remainingLength =
    2 +
    protocolName.length + // protocol name (length-prefixed)
    1 + // protocol level (4 = 3.1.1)
    1 + // connect flags
    2 + // keep alive
    2 +
    clientIdBytes.length; // client ID (length-prefixed)

  const buf = new Uint8Array(2 + remainingLength);
  let pos = 0;

  // Fixed header: CONNECT (0x10)
  buf[pos++] = 0x10;
  buf[pos++] = remainingLength;

  // Protocol name
  buf[pos++] = 0;
  buf[pos++] = protocolName.length;
  buf.set(protocolName, pos);
  pos += protocolName.length;

  // Protocol level: 4 (MQTT 3.1.1)
  buf[pos++] = 4;

  // Connect flags: Clean Session
  buf[pos++] = 0x02;

  // Keep alive: 60 seconds
  buf[pos++] = 0;
  buf[pos++] = 60;

  // Client ID
  buf[pos++] = (clientIdBytes.length >> 8) & 0xff;
  buf[pos++] = clientIdBytes.length & 0xff;
  buf.set(clientIdBytes, pos);

  ws.send(buf.buffer);
}

function sendMqttSubscribe(ws: WebSocket, topic: string): void {
  const topicBytes = new TextEncoder().encode(topic);
  const remainingLength = 2 + 2 + topicBytes.length + 1; // packet ID + topic + QoS

  const buf = new Uint8Array(2 + remainingLength);
  let pos = 0;

  // Fixed header: SUBSCRIBE (0x82)
  buf[pos++] = 0x82;
  buf[pos++] = remainingLength;

  // Packet Identifier
  buf[pos++] = 0;
  buf[pos++] = 1;

  // Topic filter
  buf[pos++] = (topicBytes.length >> 8) & 0xff;
  buf[pos++] = topicBytes.length & 0xff;
  buf.set(topicBytes, pos);
  pos += topicBytes.length;

  // QoS: 0
  buf[pos] = 0;

  ws.send(buf.buffer);
}

function handleMqttPacket(data: ArrayBuffer, sessionId?: string, participantId?: string): void {
  const view = new Uint8Array(data);
  if (view.length === 0) return;

  const packetType = (view[0] >> 4) & 0x0f;

  switch (packetType) {
    case 2: {
      // CONNACK
      setLiveStatus("connected", "Connected");

      // Subscribe to variable data topics
      if (liveWs) {
        if (sessionId && participantId) {
          // Subscribe to a specific participant
          sendMqttSubscribe(liveWs, `modelscript/site/+/area/+/line/${sessionId}/cell/${participantId}/data/#`);
        } else if (sessionId) {
          // Subscribe to all participants in a session
          sendMqttSubscribe(liveWs, `modelscript/site/+/area/+/line/${sessionId}/cell/+/data/#`);
        } else {
          // Subscribe to all data topics
          sendMqttSubscribe(liveWs, "modelscript/site/+/area/+/line/+/cell/+/data/#");
        }
      }

      // Start the animation loop
      startLiveLoop();
      break;
    }

    case 3: {
      // PUBLISH
      const buf = view;
      let pos = 1;

      // Decode remaining length
      let remaining = 0;
      let multiplier = 1;
      let byte: number;
      do {
        byte = buf[pos++];
        remaining += (byte & 0x7f) * multiplier;
        multiplier *= 128;
      } while (byte & 0x80);

      // Topic length
      const topicLen = (buf[pos] << 8) | buf[pos + 1];
      pos += 2;

      // Topic
      const topicBytes = buf.slice(pos, pos + topicLen);
      const topic = new TextDecoder().decode(topicBytes);
      pos += topicLen;

      // Payload
      const payloadBytes = buf.slice(pos, pos + remaining - 2 - topicLen);
      const payload = new TextDecoder().decode(payloadBytes);

      handleLiveData(topic, payload);
      break;
    }

    case 13: {
      // PINGRESP — send PINGREQ periodically
      break;
    }
  }
}

function handleLiveData(topic: string, payload: string): void {
  if (!liveBuffer) return;

  // Parse topic: .../cell/{participantId}/data/{variableName}
  const dataMatch = topic.match(/\/cell\/([^/]+)\/data\/(.+)$/);
  if (!dataMatch?.[1] || !dataMatch[2]) return;

  const participantId = dataMatch[1];
  const variableName = dataMatch[2];

  if (variableName === "_batch") {
    // Batched update — JSON object of { variable: value }
    try {
      const batch = JSON.parse(payload) as Record<string, number>;
      const now = performance.now() / 1000; // use browser time as x-axis
      for (const [name, value] of Object.entries(batch)) {
        const key = `${participantId}/${name}`;
        addLivePoint(key, now, value);
      }
    } catch {
      // Malformed batch
    }
  } else {
    const value = parseFloat(payload);
    if (!isNaN(value)) {
      const key = `${participantId}/${variableName}`;
      const now = performance.now() / 1000;
      addLivePoint(key, now, value);
    }
  }
}

function addLivePoint(variableKey: string, time: number, value: number): void {
  if (!liveBuffer) return;

  // Register new variable if needed
  if (!liveBuffer.values.has(variableKey)) {
    liveBuffer.variableNames.push(variableKey);
    liveBuffer.values.set(variableKey, []);
    // Rebuild legend
    buildLiveLegend();
  }

  // Add time point
  liveBuffer.times.push(time);

  // Add value to the variable's ring buffer
  const vals = liveBuffer.values.get(variableKey);
  if (!vals) return;
  vals.push(value);

  // Fill other variables with NaN at this time step (if they didn't publish)
  for (const [key, arr] of liveBuffer.values) {
    if (key !== variableKey && arr.length < liveBuffer.times.length) {
      arr.push(NaN);
    }
  }

  // Trim ring buffer
  while (liveBuffer.times.length > RING_BUFFER_SIZE) {
    liveBuffer.times.shift();
    for (const [, arr] of liveBuffer.values) {
      arr.shift();
    }
  }

  liveBuffer.count = liveBuffer.times.length;
}

// ── Live animation loop ──

function startLiveLoop(): void {
  if (animFrameId !== null) return;
  const loop = () => {
    if (!livePaused) drawLive();
    animFrameId = requestAnimationFrame(loop);
  };
  animFrameId = requestAnimationFrame(loop);
}

function stopLiveLoop(): void {
  if (animFrameId !== null) {
    cancelAnimationFrame(animFrameId);
    animFrameId = null;
  }
}

// ── Live legend ──

function buildLiveLegend(): void {
  if (!liveBuffer) return;
  legendEl.innerHTML = "";
  liveBuffer.variableNames.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "legend-item";

    const swatch = document.createElement("div");
    swatch.className = "legend-swatch";
    swatch.style.background = COLORS[i % COLORS.length];

    const label = document.createElement("span");
    label.textContent = name;

    item.appendChild(swatch);
    item.appendChild(label);

    item.addEventListener("click", () => {
      if (hiddenVars.has(name)) {
        hiddenVars.delete(name);
        item.classList.remove("hidden");
      } else {
        hiddenVars.add(name);
        item.classList.add("hidden");
      }
    });

    legendEl.appendChild(item);
  });
}

// ── Live drawing ──

function drawLive(): void {
  if (!liveBuffer || liveBuffer.count === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;

  const fgColor = isDark ? "#ccc" : "#333";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";

  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  const times = liveBuffer.times;
  const tMin = times[0];
  const tMax = times[times.length - 1];

  let yMin = Infinity;
  let yMax = -Infinity;

  for (const [name, vals] of liveBuffer.values) {
    if (hiddenVars.has(name)) continue;
    for (const v of vals) {
      if (isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }

  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad;
  yMax += yPad;

  const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin || 1)) * plotW;
  const yScale = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  ctx.clearRect(0, 0, w, h);

  // Grid
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const xTicks = niceTicksFor(tMin, tMax, 8);
  const yTicks = niceTicksFor(yMin, yMax, 6);

  ctx.beginPath();
  for (const xt of xTicks) {
    const x = xScale(xt);
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
  }
  for (const yt of yTicks) {
    const yy = yScale(yt);
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(margin.left + plotW, yy);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = axisColor;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // Labels
  ctx.fillStyle = fgColor;
  ctx.font = "11px var(--vscode-editor-font-family, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const xt of xTicks) ctx.fillText(formatTick(xt), xScale(xt), margin.top + plotH + 6);
  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const yt of yTicks) ctx.fillText(formatTick(yt), margin.left - 6, yScale(yt));

  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px var(--vscode-font-family, sans-serif)";
  ctx.fillText("Time (s)", margin.left + plotW / 2, margin.top + plotH + 24);

  // Clip
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  // Draw lines
  let vi = 0;
  for (const [name, vals] of liveBuffer.values) {
    if (hiddenVars.has(name)) {
      vi++;
      continue;
    }

    ctx.strokeStyle = COLORS[vi % COLORS.length];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < vals.length; i++) {
      const val = vals[i];
      if (!isFinite(val)) continue;
      const px = xScale(times[i]);
      const py = yScale(val);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
    vi++;
  }

  ctx.restore();
}

// ── Batch mode legend & drawing ──

function buildLegend() {
  if (!currentData) return;
  legendEl.innerHTML = "";
  currentData.states.forEach((name, i) => {
    const item = document.createElement("div");
    item.className = "legend-item";
    item.dataset.var = name;

    const swatch = document.createElement("div");
    swatch.className = "legend-swatch";
    swatch.style.background = COLORS[i % COLORS.length];

    const label = document.createElement("span");
    label.textContent = name;

    item.appendChild(swatch);
    item.appendChild(label);

    item.addEventListener("click", () => {
      if (hiddenVars.has(name)) {
        hiddenVars.delete(name);
        item.classList.remove("hidden");
      } else {
        hiddenVars.add(name);
        item.classList.add("hidden");
      }
      draw();
    });

    legendEl.appendChild(item);
  });
}

function draw() {
  if (!currentData || currentData.t.length === 0) return;

  const dpr = window.devicePixelRatio || 1;
  const rect = canvas.getBoundingClientRect();
  canvas.width = rect.width * dpr;
  canvas.height = rect.height * dpr;
  ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

  const w = rect.width;
  const h = rect.height;

  // Colors
  const fgColor = isDark ? "#ccc" : "#333";
  const gridColor = isDark ? "rgba(255,255,255,0.08)" : "rgba(0,0,0,0.08)";
  const axisColor = isDark ? "rgba(255,255,255,0.2)" : "rgba(0,0,0,0.2)";

  // Margins
  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = w - margin.left - margin.right;
  const plotH = h - margin.top - margin.bottom;

  if (plotW <= 0 || plotH <= 0) return;

  // Data ranges
  const { t, y, states } = currentData;
  const tMin = t[0];
  const tMax = t[t.length - 1];

  let yMin = Infinity;
  let yMax = -Infinity;
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;
    for (let i = 0; i < t.length; i++) {
      const v = y[i]?.[vi];
      if (v !== undefined && isFinite(v)) {
        if (v < yMin) yMin = v;
        if (v > yMax) yMax = v;
      }
    }
  }

  // Handle case where all vars are hidden or flat
  if (!isFinite(yMin) || !isFinite(yMax)) {
    yMin = 0;
    yMax = 1;
  }
  if (yMin === yMax) {
    yMin -= 1;
    yMax += 1;
  }

  // Add 5% padding
  const yPad = (yMax - yMin) * 0.05;
  yMin -= yPad;
  yMax += yPad;

  // Coordinate transform
  const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin)) * plotW;
  const yScale = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin)) * plotH;

  // Clear
  ctx.clearRect(0, 0, w, h);

  // Grid lines
  ctx.strokeStyle = gridColor;
  ctx.lineWidth = 1;
  const xTicks = niceTicksFor(tMin, tMax, 8);
  const yTicks = niceTicksFor(yMin, yMax, 6);

  ctx.beginPath();
  for (const xt of xTicks) {
    const x = xScale(xt);
    ctx.moveTo(x, margin.top);
    ctx.lineTo(x, margin.top + plotH);
  }
  for (const yt of yTicks) {
    const yy = yScale(yt);
    ctx.moveTo(margin.left, yy);
    ctx.lineTo(margin.left + plotW, yy);
  }
  ctx.stroke();

  // Axes
  ctx.strokeStyle = axisColor;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(margin.left, margin.top);
  ctx.lineTo(margin.left, margin.top + plotH);
  ctx.lineTo(margin.left + plotW, margin.top + plotH);
  ctx.stroke();

  // Tick labels
  ctx.fillStyle = fgColor;
  ctx.font = "11px var(--vscode-editor-font-family, monospace)";
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  for (const xt of xTicks) {
    ctx.fillText(formatTick(xt), xScale(xt), margin.top + plotH + 6);
  }

  ctx.textAlign = "right";
  ctx.textBaseline = "middle";
  for (const yt of yTicks) {
    ctx.fillText(formatTick(yt), margin.left - 6, yScale(yt));
  }

  // X axis label
  ctx.textAlign = "center";
  ctx.textBaseline = "top";
  ctx.font = "12px var(--vscode-font-family, sans-serif)";
  ctx.fillText("Time (s)", margin.left + plotW / 2, margin.top + plotH + 24);

  // Clip to plot area
  ctx.save();
  ctx.beginPath();
  ctx.rect(margin.left, margin.top, plotW, plotH);
  ctx.clip();

  // Draw lines
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;

    ctx.strokeStyle = COLORS[vi % COLORS.length];
    ctx.lineWidth = 1.5;
    ctx.lineJoin = "round";
    ctx.beginPath();

    let started = false;
    for (let i = 0; i < t.length; i++) {
      const val = y[i]?.[vi];
      if (val === undefined || !isFinite(val)) continue;
      const px = xScale(t[i]);
      const py = yScale(val);
      if (!started) {
        ctx.moveTo(px, py);
        started = true;
      } else {
        ctx.lineTo(px, py);
      }
    }
    ctx.stroke();
  }

  ctx.restore();
}

// Tooltip on mousemove
canvas.addEventListener("mousemove", (e) => {
  if (!currentData || currentData.t.length === 0) return;

  const rect = canvas.getBoundingClientRect();
  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;
  const mx = e.clientX - rect.left;
  const my = e.clientY - rect.top;

  if (mx < margin.left || mx > margin.left + plotW || my < margin.top || my > margin.top + plotH) {
    tooltipEl.style.display = "none";
    return;
  }

  const { t, y, states } = currentData;
  const tMin = t[0];
  const tMax = t[t.length - 1];
  const tVal = tMin + ((mx - margin.left) / plotW) * (tMax - tMin);

  // Find nearest time index
  let closest = 0;
  let minDist = Infinity;
  for (let i = 0; i < t.length; i++) {
    const d = Math.abs(t[i] - tVal);
    if (d < minDist) {
      minDist = d;
      closest = i;
    }
  }

  let html = `<div style="margin-bottom:4px;font-weight:600">t = ${t[closest].toFixed(4)}s</div>`;
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;
    const val = y[closest]?.[vi];
    const color = COLORS[vi % COLORS.length];
    html += `<div><span style="color:${color}">●</span> ${states[vi]}: ${val !== undefined ? val.toFixed(6) : "N/A"}</div>`;
  }

  tooltipEl.innerHTML = html;
  tooltipEl.style.display = "block";

  // Position tooltip
  let tx = e.clientX - rect.left + 12;
  let ty = e.clientY - rect.top - 12;
  const tw = tooltipEl.offsetWidth;
  const th = tooltipEl.offsetHeight;
  if (tx + tw > rect.width - 8) tx = e.clientX - rect.left - tw - 12;
  if (ty + th > rect.height - 8) ty = e.clientY - rect.top - th - 12;
  tooltipEl.style.left = tx + "px";
  tooltipEl.style.top = ty + "px";
});

canvas.addEventListener("mouseleave", () => {
  tooltipEl.style.display = "none";
});

// Utility: nice tick values
function niceTicksFor(min: number, max: number, targetCount: number): number[] {
  const range = max - min;
  if (range <= 0) return [min];
  const rawStep = range / targetCount;
  const mag = Math.pow(10, Math.floor(Math.log10(rawStep)));
  const normalized = rawStep / mag;

  let niceStep: number;
  if (normalized <= 1.5) niceStep = 1;
  else if (normalized <= 3) niceStep = 2;
  else if (normalized <= 7) niceStep = 5;
  else niceStep = 10;
  niceStep *= mag;

  const ticks: number[] = [];
  const start = Math.ceil(min / niceStep) * niceStep;
  for (let v = start; v <= max + niceStep * 0.01; v += niceStep) {
    ticks.push(v);
  }
  return ticks;
}

function formatTick(v: number): string {
  if (Math.abs(v) < 1e-10) return "0";
  if (Math.abs(v) >= 1000 || (Math.abs(v) < 0.01 && v !== 0)) {
    return v.toExponential(1);
  }
  // Remove trailing zeros
  return parseFloat(v.toPrecision(4)).toString();
}
