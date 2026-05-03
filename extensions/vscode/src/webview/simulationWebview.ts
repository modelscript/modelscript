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
  sweepResults?: { value: number; y: number[][] }[];
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
const seenVars = new Set<string>();

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
const treeViewEl = document.getElementById("tree-view")!;
const placeholderEl = document.getElementById("placeholder")!;
const tooltipEl = document.getElementById("tooltip")!;
const containerEl = document.getElementById("chart-container")!;
const toolbarEl = document.getElementById("toolbar")!;
const liveStatusEl = document.getElementById("live-status")!;
const liveStatusTextEl = document.getElementById("live-status-text")!;
const btnPause = document.getElementById("btn-pause")!;
const btnClear = document.getElementById("btn-clear")!;
const btnResetView = document.getElementById("btn-reset-view")!;
const checkboxSmooth = document.getElementById("checkbox-smooth") as HTMLInputElement;

function escapeHtmlSim(unsafe: string): string {
  if (!unsafe) return "";
  return unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");
}

const vscodeApi = (window as typeof window & { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } })
  .acquireVsCodeApi
  ? (window as typeof window & { acquireVsCodeApi?: () => { postMessage: (msg: unknown) => void } }).acquireVsCodeApi!()
  : null;

// Settings & Parameters DOM elements
const paramsSection = document.getElementById("params-section")!;
const settingsSection = document.getElementById("settings-section")!;
const parametersView = document.getElementById("parameters-view")!;
const btnSimulate = document.getElementById("btn-simulate")!;
const tStartInput = document.getElementById("st-start") as HTMLInputElement;
const tStopInput = document.getElementById("st-stop") as HTMLInputElement;
const intervalInput = document.getElementById("st-interval") as HTMLInputElement;
const toleranceInput = document.getElementById("st-tolerance") as HTMLInputElement;

let currentParameters: Record<string, HTMLInputElement> = {};
/* eslint-enable @typescript-eslint/no-non-null-assertion */

let currentInterpolation = "smooth";
checkboxSmooth?.addEventListener("change", (e) => {
  currentInterpolation = (e.target as HTMLInputElement).checked ? "smooth" : "linear";
  if (isLiveMode) {
    drawLive();
  } else {
    draw();
  }
});

// ── Viewport Panning & Zooming ──
let customBounds: { tMin: number; tMax: number; yMin: number; yMax: number } | null = null;
let isDragging = false;
let dragStartX = 0;
let dragStartY = 0;
let baseBounds: { tMin: number; tMax: number; yMin: number; yMax: number } | null = null;
let hoverIndex: number | null = null;

function calculateDefaultBounds(): { tMin: number; tMax: number; yMin: number; yMax: number } | null {
  if (isLiveMode && liveBuffer && liveBuffer.count > 0) {
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
    return { tMin, tMax, yMin: yMin - yPad, yMax: yMax + yPad };
  } else if (!isLiveMode && currentData && currentData.t.length > 0) {
    const { t, y, states, sweepResults } = currentData;
    const tMin = t[0];
    const tMax = t[t.length - 1];
    let yMin = Infinity;
    let yMax = -Infinity;
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      for (let i = 0; i < t.length; i++) {
        if (sweepResults) {
          for (const sweepResult of sweepResults) {
            const v = sweepResult.y[i]?.[vi];
            if (v !== undefined && isFinite(v)) {
              if (v < yMin) yMin = v;
              if (v > yMax) yMax = v;
            }
          }
        } else {
          const v = y[i]?.[vi];
          if (v !== undefined && isFinite(v)) {
            if (v < yMin) yMin = v;
            if (v > yMax) yMax = v;
          }
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
    return { tMin, tMax, yMin: yMin - yPad, yMax: yMax + yPad };
  }
  return null;
}

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

btnResetView?.addEventListener("click", () => {
  customBounds = null;
  if (isLiveMode) drawLive();
  else draw();
});

// Handle messages from extension
window.addEventListener("message", (event) => {
  const msg = event.data;
  if (msg.type === "simulationData") {
    // Batch mode
    isLiveMode = false;
    currentData = msg.data;
    isDark = msg.isDark;

    msg.data.states.forEach((state: string) => {
      if (!seenVars.has(state)) {
        hiddenVars.add(state);
        seenVars.add(state);
      }
    });

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible");
    toolbarEl.classList.remove("live-mode");
    stopLiveLoop();
    buildTreeView(msg.data.states);

    // Fill in Parameters
    if (msg.data.parameters && msg.data.parameters.length > 0) {
      paramsSection.style.display = "flex";
      parametersView.innerHTML = "";
      currentParameters = {};

      msg.data.parameters.forEach(
        (p: { name: string; description?: string; defaultValue: number; type: string; unit?: string }) => {
          const row = document.createElement("div");
          row.className = "settings-row";

          const label = document.createElement("label");
          label.textContent = p.name + (p.unit ? ` [${p.unit}]` : "");
          label.title = p.description || p.name;

          const input = document.createElement("input");
          input.type = "number";
          input.step = "any";
          input.value = typeof p.defaultValue === "number" ? p.defaultValue.toString() : "";

          row.appendChild(label);
          row.appendChild(input);
          parametersView.appendChild(row);
          currentParameters[p.name] = input;
        },
      );
    } else {
      paramsSection.style.display = "none";
    }

    // Fill in Experiment Settings
    settingsSection.style.display = "flex";
    const exp = msg.data.experiment || {};
    tStartInput.value = (exp.startTime ?? 0).toString();
    tStopInput.value = (exp.stopTime ?? 10).toString();
    intervalInput.value = (exp.interval ?? ((exp.stopTime ?? 10) - (exp.startTime ?? 0)) / 500).toString();
    toleranceInput.value = (exp.tolerance ?? 1e-4).toString();

    draw();
  } else if (msg.type === "liveMode") {
    // Live MQTT streaming mode
    isLiveMode = true;
    isDark = msg.isDark;
    currentData = null;

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible", "live-mode");
    connectMqttWs(
      msg.mqttWsUrl as string,
      msg.sessionId as string | undefined,
      msg.participantId as string | undefined,
    );
  } else if (msg.type === "liveLocalMode") {
    // Live mode via extension host postMessage (browser-local broker)
    isLiveMode = true;
    isDark = msg.isDark;
    currentData = null;

    placeholderEl.style.display = "none";
    containerEl.style.display = "flex";
    toolbarEl.classList.add("visible", "live-mode");
    setLiveStatus("connected", "Local mode");
    // Initialize empty live buffer (no WebSocket needed)
    liveBuffer = {
      times: [],
      values: new Map(),
      head: 0,
      count: 0,
      variableNames: [],
    };
    startLiveLoop();
  } else if (msg.type === "liveDataPoint") {
    // Data point from extension host (browser-local broker relay)
    if (isLiveMode && liveBuffer && !livePaused) {
      const variable = msg.variable as string;
      const time = msg.time as number;
      const value = msg.value as number;
      addLivePoint(variable, time, value);
    }
  }
});

// Resize handling
const resizeObserver = new ResizeObserver(() => {
  if (currentData || (isLiveMode && liveBuffer)) draw();
});
resizeObserver.observe(containerEl); // Observe the chart container instead of canvas directly

btnSimulate?.addEventListener("click", () => {
  if (!vscodeApi) return;
  const parameterOverrides: Record<string, number> = {};
  for (const [name, input] of Object.entries(currentParameters)) {
    if (input.value !== "") {
      const val = parseFloat(input.value);
      if (!isNaN(val)) {
        parameterOverrides[name] = val;
      }
    }
  }

  vscodeApi.postMessage({
    type: "simulateRequest",
    payload: {
      startTime: tStartInput.value ? parseFloat(tStartInput.value) : undefined,
      stopTime: tStopInput.value ? parseFloat(tStopInput.value) : undefined,
      interval: intervalInput.value ? parseFloat(intervalInput.value) : undefined,
      tolerance: toleranceInput.value ? parseFloat(toleranceInput.value) : undefined,
      parameterOverrides,
    },
  });
});

// ── Chart Interaction Events ──

canvas.addEventListener("wheel", (e) => {
  e.preventDefault();
  if (!currentData && (!isLiveMode || !liveBuffer)) return;

  const rect = canvas.getBoundingClientRect();
  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;

  let bounds = customBounds;
  if (!bounds) {
    bounds = calculateDefaultBounds();
    if (!bounds) return;
  }

  const x = e.clientX - rect.left - margin.left;
  const y = e.clientY - rect.top - margin.top;

  // Only zoom if hovering within plot rect
  if (x < 0 || x > plotW || y < 0 || y > plotH) return;

  const rx = x / plotW;
  const ry = 1 - y / plotH;

  const tRange = bounds.tMax - bounds.tMin;
  const yRange = bounds.yMax - bounds.yMin;

  const tPointer = bounds.tMin + rx * tRange;
  const yPointer = bounds.yMin + ry * yRange;

  const zoomFactor = Math.pow(1.001, e.deltaY);

  const newTRange = tRange * zoomFactor;
  const newYRange = yRange * zoomFactor;

  if (newTRange < 1e-12 || newYRange < 1e-12) return;

  customBounds = {
    tMin: tPointer - rx * newTRange,
    tMax: tPointer + (1 - rx) * newTRange,
    yMin: yPointer - ry * newYRange,
    yMax: yPointer + (1 - ry) * newYRange,
  };

  if (isLiveMode) drawLive();
  else draw();
});

canvas.addEventListener("pointerdown", (e) => {
  if (e.button !== 0) return;
  isDragging = true;
  dragStartX = e.clientX;
  dragStartY = e.clientY;

  baseBounds = customBounds || calculateDefaultBounds();
  canvas.setPointerCapture(e.pointerId);
});

canvas.addEventListener("pointermove", (e) => {
  if (!isDragging || !baseBounds) return;

  const rect = canvas.getBoundingClientRect();
  const margin = { top: 16, right: 24, bottom: 40, left: 64 };
  const plotW = rect.width - margin.left - margin.right;
  const plotH = rect.height - margin.top - margin.bottom;
  if (plotW <= 0 || plotH <= 0) return;

  const dx = e.clientX - dragStartX;
  const dy = e.clientY - dragStartY;

  const tRange = baseBounds.tMax - baseBounds.tMin;
  const yRange = baseBounds.yMax - baseBounds.yMin;

  const dt = -(dx / plotW) * tRange;
  const dyScaled = (dy / plotH) * yRange;

  customBounds = {
    tMin: baseBounds.tMin + dt,
    tMax: baseBounds.tMax + dt,
    yMin: baseBounds.yMin + dyScaled,
    yMax: baseBounds.yMax + dyScaled,
  };

  if (isLiveMode) drawLive();
  else draw();
});

canvas.addEventListener("pointerup", (e) => {
  isDragging = false;
  canvas.releasePointerCapture(e.pointerId);
});
canvas.addEventListener("pointercancel", (e) => {
  isDragging = false;
  canvas.releasePointerCapture(e.pointerId);
});

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
    if (!seenVars.has(variableKey)) {
      hiddenVars.add(variableKey);
      seenVars.add(variableKey);
    }
    // Rebuild tree
    buildTreeView(liveBuffer.variableNames);
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

// ── Tree View ──

interface TreeNode {
  name: string;
  fullName: string;
  children: Map<string, TreeNode>;
  isVariable: boolean;
  colorIndex?: number;
}

function buildTreeView(variables: string[]): void {
  const root: TreeNode = { name: "", fullName: "", children: new Map(), isVariable: false };

  variables.forEach((variable, i) => {
    const isDer = variable.startsWith("der(") && variable.endsWith(")");
    const innerVar = isDer ? variable.slice(4, -1) : variable;
    const originalParts = innerVar.split(".");

    let current = root;
    let prefix = "";

    for (let j = 0; j < originalParts.length; j++) {
      const isLeaf = j === originalParts.length - 1;
      const basePart = originalParts[j];

      const part = isLeaf && isDer ? `der(${basePart})` : basePart;
      prefix = prefix ? `${prefix}.${basePart}` : basePart;
      const fullName = isLeaf ? variable : prefix;

      if (!current.children.has(part)) {
        current.children.set(part, {
          name: part,
          fullName: fullName,
          children: new Map(),
          isVariable: isLeaf,
          colorIndex: isLeaf ? i : undefined,
        });
      }
      current = current.children.get(part) as TreeNode;
    }
  });

  treeViewEl.innerHTML = "";

  function renderNode(node: TreeNode, parentEl: HTMLElement) {
    const li = document.createElement("li");
    li.className = "tree-node";

    const item = document.createElement("div");
    item.className = "tree-item";

    const hasChildren = node.children.size > 0;
    const caret = document.createElement("span");
    caret.className = "tree-caret " + (hasChildren ? "expanded" : "empty");
    item.appendChild(caret);

    if (node.isVariable) {
      const checkbox = document.createElement("input");
      checkbox.type = "checkbox";
      checkbox.className = "tree-checkbox";
      checkbox.checked = !hiddenVars.has(node.fullName);

      const swatch = document.createElement("div");
      swatch.style.width = "10px";
      swatch.style.height = "10px";
      swatch.style.borderRadius = "2px";
      swatch.style.marginRight = "6px";
      if (node.colorIndex !== undefined) {
        swatch.style.background = COLORS[node.colorIndex % COLORS.length];
      }

      item.appendChild(checkbox);
      item.appendChild(swatch);

      checkbox.addEventListener("click", (e) => {
        e.stopPropagation();
        if (checkbox.checked) {
          hiddenVars.delete(node.fullName);
        } else {
          hiddenVars.add(node.fullName);
        }
        customBounds = null;
        if (isLiveMode) drawLive();
        else draw();
      });

      // Clicking the row toggles the checkbox
      item.addEventListener("click", (e) => {
        if ((e.target as HTMLElement).tagName !== "INPUT") {
          checkbox.click();
        }
      });
    }

    const label = document.createElement("span");
    label.className = "tree-label";
    label.textContent = node.name;
    label.title = node.fullName;
    item.appendChild(label);

    li.appendChild(item);

    if (hasChildren) {
      const childrenUl = document.createElement("ul");
      childrenUl.className = "tree-children expanded";

      item.addEventListener("click", (e) => {
        if (node.isVariable && (e.target as HTMLElement).tagName === "INPUT") return;
        const isExpanded = childrenUl.classList.contains("expanded");
        if (isExpanded) {
          childrenUl.classList.remove("expanded");
          caret.classList.remove("expanded");
        } else {
          childrenUl.classList.add("expanded");
          caret.classList.add("expanded");
        }
      });

      const childNodes = Array.from(node.children.values()).sort((a, b) => {
        if (a.children.size > 0 && b.children.size === 0) return -1;
        if (a.children.size === 0 && b.children.size > 0) return 1;
        return a.name.localeCompare(b.name);
      });

      for (const child of childNodes) {
        renderNode(child, childrenUl);
      }
      li.appendChild(childrenUl);
    }

    parentEl.appendChild(li);
  }

  const sortedRoots = Array.from(root.children.values()).sort((a, b) => {
    if (a.children.size > 0 && b.children.size === 0) return -1;
    if (a.children.size === 0 && b.children.size > 0) return 1;
    return a.name.localeCompare(b.name);
  });

  for (const child of sortedRoots) {
    renderNode(child, treeViewEl);
  }
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
  const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
  const { tMin, tMax, yMin, yMax } = bounds;

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

    const pts: { x: number; y: number }[] = [];
    for (let i = 0; i < vals.length; i++) {
      const val = vals[i];
      if (!isFinite(val)) continue;
      pts.push({ x: xScale(times[i]), y: yScale(val) });
    }

    if (currentInterpolation === "smooth") {
      drawSmoothSpline(ctx, pts);
    } else {
      let prevPy = 0;
      let started = false;
      for (const pt of pts) {
        if (!started) {
          ctx.moveTo(pt.x, pt.y);
          started = true;
        } else {
          if (currentInterpolation === "step-after") {
            ctx.lineTo(pt.x, prevPy);
          }
          ctx.lineTo(pt.x, pt.y);
        }
        prevPy = pt.y;
      }
    }
    ctx.stroke();
    vi++;
  }

  ctx.restore();
}

// ── Helper ──
function drawSmoothSpline(ctx: CanvasRenderingContext2D, pts: { x: number; y: number }[]) {
  if (pts.length === 0) return;
  ctx.moveTo(pts[0].x, pts[0].y);
  if (pts.length === 1) return;

  const tension = 0.25;
  for (let i = 0; i < pts.length - 1; i++) {
    const p1 = pts[i];
    const p2 = pts[i + 1];

    if (Math.abs(p2.x - p1.x) < 0.1) {
      ctx.lineTo(p2.x, p2.y);
      continue;
    }

    let p0 = i > 0 ? pts[i - 1] : p1;
    if (Math.abs(p1.x - p0.x) < 0.1) p0 = p1;

    let p3 = i < pts.length - 2 ? pts[i + 2] : p2;
    if (Math.abs(p3.x - p2.x) < 0.1) p3 = p2;

    const t1x = (p2.x - p0.x) * tension;
    const t1y = (p2.y - p0.y) * tension;
    const t2x = (p3.x - p1.x) * tension;
    const t2y = (p3.y - p1.y) * tension;

    ctx.bezierCurveTo(p1.x + t1x / 3, p1.y + t1y / 3, p2.x - t2x / 3, p2.y - t2y / 3, p2.x, p2.y);
  }
}

// ── Batch mode drawing ──

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
  const bounds = customBounds || calculateDefaultBounds() || { tMin: 0, tMax: 1, yMin: 0, yMax: 1 };
  const { tMin, tMax, yMin, yMax } = bounds;

  // Coordinate transform
  const xScale = (v: number) => margin.left + ((v - tMin) / (tMax - tMin || 1)) * plotW;
  const yScale = (v: number) => margin.top + plotH - ((v - yMin) / (yMax - yMin || 1)) * plotH;

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
  const { sweepResults } = currentData;
  const sweepCount = sweepResults ? sweepResults.length : 1;
  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;

    for (let si = 0; si < sweepCount; si++) {
      ctx.strokeStyle = COLORS[(vi * sweepCount + si) % COLORS.length];
      ctx.lineWidth = 1.5;
      ctx.lineJoin = "round";
      ctx.beginPath();

      const pts: { x: number; y: number }[] = [];
      for (let i = 0; i < t.length; i++) {
        const val = sweepResults ? sweepResults[si].y[i]?.[vi] : y[i]?.[vi];
        if (val === undefined || !isFinite(val)) continue;
        pts.push({ x: xScale(t[i]), y: yScale(val) });
      }

      if (currentInterpolation === "smooth") {
        drawSmoothSpline(ctx, pts);
      } else {
        let prevPy = 0;
        let started = false;
        for (const pt of pts) {
          if (!started) {
            ctx.moveTo(pt.x, pt.y);
            started = true;
          } else {
            if (currentInterpolation === "step-after") {
              ctx.lineTo(pt.x, prevPy);
            }
            ctx.lineTo(pt.x, pt.y);
          }
          prevPy = pt.y;
        }
      }
      ctx.stroke();
    }
  }

  ctx.restore();

  // Draw hover tracer
  if (hoverIndex !== null && hoverIndex < t.length) {
    const hx = xScale(t[hoverIndex]);

    // Vertical line
    ctx.strokeStyle = axisColor;
    ctx.setLineDash([4, 4]);
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(hx, margin.top);
    ctx.lineTo(hx, margin.top + plotH);
    ctx.stroke();
    ctx.setLineDash([]);

    // Circles
    for (let vi = 0; vi < states.length; vi++) {
      if (hiddenVars.has(states[vi])) continue;
      const val = y[hoverIndex]?.[vi];
      if (val === undefined || !isFinite(val)) continue;

      const hy = yScale(val);
      if (hy >= margin.top && hy <= margin.top + plotH) {
        ctx.fillStyle = isDark ? "#2d2d2d" : "#ffffff";
        ctx.strokeStyle = COLORS[vi % COLORS.length];
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(hx, hy, 4, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      }
    }
  }
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
    if (hoverIndex !== null) {
      hoverIndex = null;
      draw();
    }
    return;
  }

  const { t, y, states } = currentData;
  const bounds = customBounds || calculateDefaultBounds() || { tMin: t[0], tMax: t[t.length - 1], yMin: 0, yMax: 1 };
  const { tMin, tMax } = bounds;
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
  const { sweepResults } = currentData;
  const sweepCount = sweepResults ? sweepResults.length : 1;

  for (let vi = 0; vi < states.length; vi++) {
    if (hiddenVars.has(states[vi])) continue;

    for (let si = 0; si < sweepCount; si++) {
      const val = sweepResults ? sweepResults[si].y[closest]?.[vi] : y[closest]?.[vi];
      const color = COLORS[(vi * sweepCount + si) % COLORS.length];
      const baseName = escapeHtmlSim(states[vi]);
      const safeName = sweepResults ? `${baseName} (${sweepResults[si].value})` : baseName;
      html += `<div><span style="color:${color}">●</span> ${safeName}: ${val !== undefined ? val.toFixed(6) : "N/A"}</div>`;
    }
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

  if (hoverIndex !== closest) {
    hoverIndex = closest;
    draw();
  }
});

canvas.addEventListener("mouseleave", () => {
  tooltipEl.style.display = "none";
  if (hoverIndex !== null) {
    hoverIndex = null;
    draw();
  }
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
