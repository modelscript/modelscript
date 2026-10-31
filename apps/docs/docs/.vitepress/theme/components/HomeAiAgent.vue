<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import type { IconName } from "../data/icons";
import mcpData from "../data/mcp-tools.generated.json";
import {
  executeScenarioLive,
  parsePromptIntent,
  type LiveFileEdit,
  type LiveScenarioResult,
  type LiveToolCallResult,
} from "../util/mcp-wasm-runner";
import MsIcon from "./MsIcon.vue";

interface AgentScenario {
  id: string;
  badge: string;
  icon: IconName;
  title: string;
  prompt: string;
  summary: string;
  activeFile: string;
  activeSymbol: string;
  thoughtProcess: string;
  calls: LiveToolCallResult[];
  fileEdit: LiveFileEdit;
  verdict: string;
  assistantSummary: string;
}

const scenarios: AgentScenario[] = [
  {
    id: "synthesize",
    badge: "Closed-Loop Synthesis",
    icon: "sparkles",
    title: "Autonomous controller tuning with STL proofs",
    prompt:
      "Tune the DC motor PID gains in Actuator.mo so step overshoot stays below 4% and settling time is under 0.35s.",
    summary:
      "The agent invokes sensitivity-guided parameter synthesis over the DAE arena until every Signal Temporal Logic (STL) requirement holds.",
    activeFile: "Actuator.mo",
    activeSymbol: "model DCMotorPID",
    thoughtProcess:
      "Flattening Actuator.DCMotorPID to linear DAE arena (18 equations), computing forward sensitivities d(y)/d(Kp,Ki,Kd), and shaping loop bandwidth for overshoot < 4% and Ts < 0.35s.",
    calls: [
      {
        tool: "modelica_flatten",
        args: '{ "className": "Actuator.DCMotorPID", "includeMetrics": true }',
        resultTitle: "Arena DAE lowered · 18 states/algebraics · 18 equations [Balanced]",
        metrics: [
          { label: "Index reduction", value: "Index-1 ODE", status: "info" },
          { label: "BLT blocks", value: "6×6 torn", status: "info" },
        ],
      },
      {
        tool: "modelscript_closed_loop_synthesize",
        args: '{\n  "className": "Actuator.DCMotorPID", "tunableParameters": ["Kp", "Ki", "Kd"],\n  "maxOvershootPct": 4, "maxSettlingS": 0.35, "tEnd": 1\n}',
        resultTitle: "Converged in 4 sensitivity iterations (SUNDIALS CVODE + Forward AD)",
        metrics: [
          { label: "Overshoot", value: "2.8% (< 4.0%)", status: "pass" },
          { label: "Settling time", value: "0.29s (< 0.35s)", status: "pass" },
          { label: "STL robustness ρ", value: "+0.062 PASS", status: "pass" },
        ],
      },
    ],
    fileEdit: {
      action: "Edited",
      file: "Actuator.mo",
      added: 3,
      deleted: 3,
    },
    verdict: "Verified patch applied: Kp = 14.2, Ki = 38.5, Kd = 0.84",
    assistantSummary:
      "Tuned <strong>Actuator.DCMotorPID</strong> in <code>Actuator.mo</code> to <strong>Kp = 14.2</strong>, <strong>Ki = 38.5</strong>, <strong>Kd = 0.84</strong>. Step overshoot is <strong>2.8%</strong> (limit &lt; 4.0%) and 2% settling time is <strong>0.29s</strong> (&rho; = +0.062).",
  },
  {
    id: "tgg",
    badge: "Cross-Domain Digital Thread",
    icon: "link",
    title: "SysML v2 ↔ Modelica bidirectional reconciliation",
    prompt:
      "Check whether BrakeSystem.mo satisfies the SysML v2 architecture constraints and reconcile any parameter drift.",
    summary:
      "Triple Graph Grammar (TGG) rules inspect correspondence links across architecture and physics models, resolving conflicts with AST-level precision.",
    activeFile: "BrakeSystem.mo ↔ BrakeSystem.sysml",
    activeSymbol: "part def BrakeSystem",
    thoughtProcess:
      "Running OWL 2 / QUDV consistency check across BrakeSystem.sysml and BrakeSystem.mo, then executing TGG Critical Pair Analysis (CPA) on slot BrakeActuator.maxPressure (18.5 MPa).",
    calls: [
      {
        tool: "validate_system_consistency",
        args: '{ "sysmlPath": "BrakeSystem.sysml", "modelicaPath": "BrakeSystem.mo" }',
        resultTitle: "1 parameter divergence detected on slot BrakeActuator.maxPressure",
        metrics: [
          { label: "Port topology", value: "12 / 12 matched", status: "pass" },
          { label: "SI units", value: "Pa ≡ N/m² (1.85e+7)", status: "pass" },
        ],
      },
      {
        tool: "tgg_reconcile_slot",
        args: '{ "slotId": "BrakeActuator.maxPressure", "authority": "sysml", "valueMpa": 18.5 }',
        resultTitle: "Propagated authoritative SysML v2 constraint (18.5 MPa) into Modelica binding",
        metrics: [
          { label: "CPA conflicts", value: "0 remaining", status: "pass" },
          { label: "RTM status", value: "@satisfies valid", status: "pass" },
        ],
      },
    ],
    fileEdit: {
      action: "Edited",
      file: "BrakeSystem.mo",
      added: 2,
      deleted: 2,
    },
    verdict: "Synchronized BrakeSystem.sysml ↔ BrakeSystem.mo (18.5 MPa) with 100% RTM coverage",
    assistantSummary:
      "Reconciled <code>BrakeActuator.maxPressure</code> to <strong>18.5 MPa</strong> (1.85e+7 Pa) across <code>BrakeSystem.sysml</code> and <code>BrakeSystem.mo</code> with <strong>0 CPA conflicts</strong> and <strong>12/12</strong> ports matched.",
  },
  {
    id: "grid",
    badge: "Grid Compliance · EMT",
    icon: "zap",
    title: "Automated IEEE 2800 ride-through verification",
    prompt:
      "Run EMT lint checks and verify IEEE Std 2800 LVRT compliance on SolarPlant_250MW.pscx for a 0.15 pu fault.",
    summary:
      "AI agents execute fixed-step nodal admittance EMT simulations and evaluate standard ride-through envelopes without a desktop license.",
    activeFile: "SolarPlant_250MW.pscx",
    activeSymbol: "substation POI_250MW",
    thoughtProcess:
      "Linting 42-bus PSCAD network against M6001–M6011 EMT rules and running 20 μs Dommel companion-circuit simulation for a 0.15 pu bolted fault (150 ms).",
    calls: [
      {
        tool: "pscad_lint",
        args: '{ "fileName": "SolarPlant_250MW.pscx" }',
        resultTitle: "Checked 11 EMT static rules (M6001–M6011) across 42 buses",
        metrics: [
          { label: "Diagnostics", value: "0 errors, 0 warnings", status: "pass" },
          { label: "Step ratio", value: "20 μs validated", status: "info" },
        ],
      },
      {
        tool: "pscad_verify_ieee2800",
        args: '{\n  "fileName": "SolarPlant_250MW.pscx", "retainedVoltagePu": 0.15,\n  "faultMs": 150, "tStop": 3, "stepUs": 20\n}',
        resultTitle: "IEEE Std 2800-2022 Clause 7.2 LVRT (0.15 pu sag, Iq = 0.86 pu)",
        metrics: [
          { label: "LVRT envelope", value: "No trip (3.0s)", status: "pass" },
          { label: "Reactive response", value: "tr = 28 ms (≤ 30 ms)", status: "pass" },
          { label: "Post-fault recovery", value: "96.4% at 0.5s", status: "pass" },
        ],
      },
    ],
    fileEdit: {
      action: "Created",
      file: "IEEE2800_LVRT_Report.json",
      added: 48,
      deleted: 0,
    },
    verdict: "Compliance report generated · All IEEE 2800 ride-through criteria satisfied (0.15 pu fault)",
    assistantSummary:
      "Verified <strong>SolarPlant_250MW.pscx</strong> under a <strong>0.15 pu</strong> voltage sag: zero momentary cessation, reactive current step response <strong>tr = 28 ms</strong> (&le; 30 ms), and <strong>96.4%</strong> post-fault active power recovery.",
  },
  {
    id: "cad",
    badge: "3D CAD · FEA Sizing",
    icon: "cube",
    title: "Generative CSG/STEP sizing with FEA stress gates",
    prompt:
      "Size the Al 6061-T6 ActuatorBracket.scad ribs and fillets for a 4.2 kN load with safety factor ≥ 1.5 and ≥ 2.0 mm BVH housing clearance.",
    summary:
      "Couples parametric CSG/STEP solid geometry with tetrahedral FEA von Mises stress analysis and 3D BVH collision detection in a single MCP call.",
    activeFile: "ActuatorBracket.scad",
    activeSymbol: "module ActuatorBracket",
    thoughtProcess:
      "Meshing parametric OpenSCAD/STEP solid for 4.20 kN load, solving tetrahedral FEA von Mises stress against Al 6061-T6 allowable (184 MPa), and checking 3D BVH housing clearance.",
    calls: [
      {
        tool: "cad_fea_closed_loop_size",
        args: '{\n  "partName": "ActuatorBracket", "materialYieldMpa": 276,\n  "minSafetyFactor": 1.5, "appliedLoadN": 4200, "minClearanceMm": 2\n}',
        resultTitle: "3D CSG/STEP ↔ Tetrahedral FEA Sizing (ActuatorBracket)",
        metrics: [
          { label: "Peak von Mises", value: "160.1 MPa (≤ 184 MPa)", status: "pass" },
          { label: "Safety Factor", value: "1.72x (Req ≥ 1.5x)", status: "pass" },
          { label: "BVH Clearance", value: "3.45 mm (0 collisions)", status: "pass" },
        ],
      },
    ],
    fileEdit: {
      action: "Edited",
      file: "ActuatorBracket.scad",
      added: 4,
      deleted: 4,
    },
    verdict: "Structural FEA & 3D BVH clearance certified: rib_thickness_mm = 3.12, fillet_radius_mm = 1.85",
    assistantSummary:
      "Sized <code>ActuatorBracket.scad</code> for <strong>4.20 kN</strong> load: <strong>rib_thickness_mm = 3.12</strong>, <strong>fillet_radius_mm = 1.85</strong>, yielding peak von Mises stress <strong>160.1 MPa</strong> (<strong>1.72x</strong> safety factor) and <strong>3.45 mm</strong> BVH clearance.",
  },
  {
    id: "safety",
    badge: "ISO 26262 B2B · Formal MC/DC",
    icon: "shield",
    title: "Legacy CAE migration & IC3/SOS + MC/DC proofs",
    prompt:
      "Migrate ServoActuator.slx to Modelica + SysML v2, verify ISO 26262 B2B trajectory parity, and prove unbounded IC3/SOS safety with MC/DC vectors.",
    summary:
      "Transpiles legacy Simulink/SPICE/Adams models, certifies back-to-back trajectory equivalence, and proves IC3/PDR invariants with 100% MC/DC test coverage.",
    activeFile: "ServoActuator.slx → ServoActuator.mo",
    activeSymbol: "model ServoActuator",
    thoughtProcess:
      "Transpiling Simulink block diagram ServoActuator.slx to balanced Modelica + SysML v2, running ISO 26262 Part 6 B2B trajectory equivalence (tol ≤ 1e-4), and proving unbounded IC3/SOS safety.",
    calls: [
      {
        tool: "polyglot_migrate_and_verify_b2b",
        args: '{ "sourceFormat": "simulink", "modelName": "ServoActuator", "tolerance": 0.0001 }',
        resultTitle: "Legacy SIMULINK → Modelica/SysML v2 B2B Certification",
        metrics: [
          { label: "B2B Trajectory Δ", value: "8.4e-6 (≤ 1e-4)", status: "pass" },
          { label: "ISO 26262 Part 6", value: "ASIL-D Certified", status: "pass" },
        ],
      },
      {
        tool: "formal_verify_safety_and_mcdc",
        args: '{ "modelName": "ServoActuator", "safetyProperty": "abs(pitch_angle_deg) <= 35.0" }',
        resultTitle: "IC3/PDR Invariant, SOS Barrier & DO-178C MC/DC Proof (ServoActuator)",
        metrics: [
          { label: "IC3/PDR Invariant", value: "Inductive (7 Frames)", status: "pass" },
          { label: "SOS Barrier B(x)", value: "LMI Feasible (+0.184)", status: "pass" },
          { label: "MC/DC Coverage", value: "100.0% (4 vectors)", status: "pass" },
        ],
      },
    ],
    fileEdit: {
      action: "Created",
      file: "ServoActuator.mo",
      added: 84,
      deleted: 0,
    },
    verdict: "ISO 26262 ASIL-D & DO-178C DAL-A proof bundle generated with C99 SHA-256 parity",
    assistantSummary:
      "Migrated <code>ServoActuator.slx</code> to <code>ServoActuator.mo</code> with B2B trajectory &Delta; = 8.4e-6 (&le; 1e-4), proved inductive IC3/PDR safety for <code>abs(pitch_angle_deg) &lt;= 35.0</code>, and generated <strong>4/4 (100%)</strong> DO-178C MC/DC test vectors.",
  },
];

// ── State Machine: Playback Mode vs. Live Interactive Mode ──
const active = ref(0);
const isInteractiveMode = ref(false);
const isPausedOnHover = ref(false);

/**
 * In Live Mode (`isInteractiveMode === true`), `livePhase` tracks the exact chat lifecycle:
 * - "prefilled": Results are cleared; the scenario prompt is moved down into `#input` waiting for the user to click Send.
 * - "running": The user clicked Send; `#input` cleared, `.msg.user` appeared, and tool calls are executing step-by-step.
 * - "completed": Live execution finished; all tool trace cards, file edit diff, verdict banner, and response summary are shown.
 */
const livePhase = ref<"prefilled" | "running" | "completed">("prefilled");
const isRunning = ref(false);
const visibleCallCount = ref(0);
const runningToolName = ref<string | null>(null);
const runningStepNumber = ref(1);

const progressPct = ref(0);
const progressText = ref("");
const selectedProvider = ref<"wasm" | "webgpu" | "ollama" | "hosted-mcp">("wasm");

// In Playback Mode, the prompt is already sent at the top, so `inputPrompt` at the bottom starts empty.
const inputPrompt = ref("");
const displayedPrompt = ref(scenarios[0].prompt);
const liveResults = ref<Record<string, LiveScenarioResult>>({});

const inputTextareaRef = ref<HTMLTextAreaElement | null>(null);
const messagesContainerRef = ref<HTMLDivElement | null>(null);

const userOverrides = ref<Record<string, Record<string, number | string>>>({
  synthesize: { targetOvershootPct: 4.0, settlingTimeLimitS: 0.35 },
  tgg: { pressureMpa: 18.5, authority: "sysml" },
  grid: { faultSagPu: 0.15, faultDurationMs: 150 },
  cad: { appliedLoadN: 4200, minSafetyFactor: 1.5, minClearanceMm: 2.0 },
  safety: { tolerance: 1e-4, maxPitchDeg: 35.0 },
});

// ── MCP Installation Config Tabs (100% accurate per client) ──
type McpClientTabId = "vscode" | "claude-code" | "cursor" | "vscode-ext";
interface McpClientConfigOption {
  id: McpClientTabId;
  label: string;
  fileHint: string;
  isJson: boolean;
  code: string;
  secondaryCmd?: string;
}

const mcpClientOptions: McpClientConfigOption[] = [
  {
    id: "vscode",
    label: "VS Code",
    fileHint: ".vscode/mcp.json (or CLI)",
    isJson: true,
    code: `{\n  "servers": {\n    "modelscript": {\n      "type": "stdio",\n      "command": "npx",\n      "args": ["-y", "@modelscript/mcp"]\n    }\n  }\n}`,
    secondaryCmd: `code --add-mcp '{"name":"modelscript","command":"npx","args":["-y","@modelscript/mcp"]}'`,
  },
  {
    id: "claude-code",
    label: "Claude Code",
    fileHint: "Terminal CLI",
    isJson: false,
    code: "claude mcp add modelscript -- npx -y @modelscript/mcp",
  },
  {
    id: "cursor",
    label: "Cursor / Windsurf",
    fileHint: ".cursor/mcp.json · claude_desktop_config.json",
    isJson: true,
    code: `{\n  "mcpServers": {\n    "modelscript": {\n      "command": "npx",\n      "args": ["-y", "@modelscript/mcp"]\n    }\n  }\n}`,
  },
  {
    id: "vscode-ext",
    label: "IDE Extension",
    fileHint: "Built-in @modelscript Chat & LM Tools",
    isJson: false,
    code: "code --install-extension modelscript.modelscript",
  },
];

const selectedMcpClient = ref<McpClientTabId>("vscode");
const copied = ref(false);
const copiedSecondary = ref(false);

const activeMcpClientOption = computed(
  () => mcpClientOptions.find((o) => o.id === selectedMcpClient.value) ?? mcpClientOptions[0],
);

let timer: ReturnType<typeof setInterval> | undefined;
let activeRunId = 0;

function autoResizeInput(): void {
  const el = inputTextareaRef.value;
  if (!el) return;
  if (!inputPrompt.value) {
    el.style.height = "28px";
    return;
  }
  el.style.height = "28px";
  el.style.height = `${Math.min(el.scrollHeight, 96)}px`;
}

watch(inputPrompt, () => {
  nextTick(() => autoResizeInput());
});

function startPlaybackTimer(): void {
  if (timer) clearInterval(timer);
  if (typeof window !== "undefined" && window.matchMedia("(prefers-reduced-motion: reduce)").matches) {
    return;
  }
  timer = setInterval(() => {
    if (!isInteractiveMode.value && !isPausedOnHover.value && !isRunning.value) {
      active.value = (active.value + 1) % scenarios.length;
      displayedPrompt.value = scenarios[active.value].prompt;
      inputPrompt.value = "";
    }
  }, 6500);
}

/**
 * Transitions from Playback Mode into Live Mode:
 * 1. Stops the automatic playback carousel.
 * 2. Clears the sent message and trace results from `#messages` (`livePhase = "prefilled"`).
 * 3. Moves the prompt from the top `.msg.user` bubble down into `#input` prefilled for the user to click Send.
 */
function enterLiveMode(prefillPrompt?: string, focusInput = true): void {
  activeRunId++;
  isRunning.value = false;
  progressPct.value = 0;
  progressText.value = "";
  runningToolName.value = null;
  visibleCallCount.value = 0;

  isInteractiveMode.value = true;
  livePhase.value = "prefilled";
  if (timer) clearInterval(timer);

  const targetPrompt = prefillPrompt ?? scenarios[active.value].prompt;
  inputPrompt.value = targetPrompt;

  nextTick(() => {
    autoResizeInput();
    if (focusInput && inputTextareaRef.value) {
      inputTextareaRef.value.focus();
    }
  });
}

/**
 * Transitions back to Playback Mode:
 * Clears the bottom input and displays the active scenario's completed trace in `#messages`.
 */
function enterPlaybackMode(): void {
  activeRunId++;
  isRunning.value = false;
  progressPct.value = 0;
  progressText.value = "";
  runningToolName.value = null;

  isInteractiveMode.value = false;
  inputPrompt.value = "";
  displayedPrompt.value = scenarios[active.value].prompt;
  startPlaybackTimer();
}

function formatSimpleMarkdown(text: string): string {
  return text
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\$([^$]+)\$/g, '<span class="math-inline">$1</span>');
}

/**
 * Executes a prompt live in the in-browser WebAssembly kernel with step-by-step ReAct tool trace progression.
 */
async function executePromptLive(promptText: string, explicitScenarioId?: string): Promise<void> {
  const runId = ++activeRunId;
  isInteractiveMode.value = true;
  if (timer) clearInterval(timer);

  const trimmed = promptText.trim() || scenarios[active.value].prompt;

  // 1. Move prompt from input box up to the sent .msg.user bubble and clear input immediately (VS Code parity)
  displayedPrompt.value = trimmed;
  inputPrompt.value = "";
  livePhase.value = "running";
  isRunning.value = true;
  visibleCallCount.value = 0;

  nextTick(() => {
    autoResizeInput();
    if (messagesContainerRef.value) {
      messagesContainerRef.value.scrollTop = 0;
    }
  });

  // 2. Parse prompt intent & parameter overrides
  const currentScenario = scenarios[active.value];
  const parsedIntent = parsePromptIntent(trimmed, explicitScenarioId ?? currentScenario.id);
  const matchedIdx = scenarios.findIndex((s) => s.id === parsedIntent.scenarioId);
  if (matchedIdx !== -1 && !explicitScenarioId) {
    active.value = matchedIdx;
  }

  const targetScenario = scenarios[active.value];
  if (!userOverrides.value[targetScenario.id]) {
    userOverrides.value[targetScenario.id] = {};
  }
  Object.assign(userOverrides.value[targetScenario.id], parsedIntent.overrides);

  // 3. Compute live numerical solution
  const res = await executeScenarioLive(targetScenario.id, userOverrides.value[targetScenario.id] || {});
  if (runId !== activeRunId) return;
  liveResults.value[targetScenario.id] = res;

  // 4. Step-by-step tool trace execution (mirrors VS Code chat-webview.ts ReAct loop)
  const totalCalls = res.calls.length;
  runningStepNumber.value = 1;
  runningToolName.value = res.calls[0]?.tool ?? "modelscript_closed_loop_synthesize";
  progressPct.value = 24;
  progressText.value = `Calling ${runningToolName.value} in WASM linear arena...`;

  await new Promise((r) => setTimeout(r, 210));
  if (runId !== activeRunId) return;

  visibleCallCount.value = 1;

  if (totalCalls > 1) {
    runningStepNumber.value = 2;
    runningToolName.value = res.calls[1]?.tool ?? null;
    progressPct.value = 68;
    progressText.value =
      targetScenario.id === "synthesize"
        ? "Solving SUNDIALS CVODE forward sensitivities & STL robustness ρ..."
        : targetScenario.id === "grid"
          ? "Fixed-step 20 μs nodal admittance EMT ride-through check..."
          : targetScenario.id === "safety"
            ? "Proving unbounded IC3/PDR safety & DO-178C MC/DC vectors..."
            : "Propagating authoritative TGG constraint & checking CPA conflicts...";

    await new Promise((r) => setTimeout(r, 230));
    if (runId !== activeRunId) return;
    visibleCallCount.value = totalCalls;
  }

  runningToolName.value = null;
  progressPct.value = 100;
  progressText.value = `Certified proof synthesized in ${res.durationMs}ms!`;
  livePhase.value = "completed";
  isRunning.value = false;

  setTimeout(() => {
    if (runId === activeRunId) {
      progressPct.value = 0;
      progressText.value = "";
    }
  }, 600);
}

function buildScenarioPrompt(scenarioId: string): string {
  const ov = userOverrides.value[scenarioId] || {};
  if (scenarioId === "synthesize") {
    const os = Number(ov["targetOvershootPct"] ?? 4.0);
    const ts = Number(ov["settlingTimeLimitS"] ?? 0.35);
    return `Tune the DC motor PID gains in Actuator.mo so step overshoot stays below ${os}% and settling time is under ${ts}s.`;
  } else if (scenarioId === "tgg") {
    const p = Number(ov["pressureMpa"] ?? 18.5);
    return `Check whether BrakeSystem.mo satisfies the SysML v2 architecture constraints and reconcile slot BrakeActuator.maxPressure to ${p.toFixed(1)} MPa.`;
  } else if (scenarioId === "grid") {
    const sag = Number(ov["faultSagPu"] ?? 0.15);
    return `Run EMT lint checks and verify IEEE Std 2800 LVRT compliance on SolarPlant_250MW.pscx for a ${sag.toFixed(2)} pu fault.`;
  } else if (scenarioId === "cad") {
    const loadKn = (Number(ov["appliedLoadN"] ?? 4200) / 1000).toFixed(1);
    const fos = Number(ov["minSafetyFactor"] ?? 1.5).toFixed(1);
    return `Size the Al 6061-T6 ActuatorBracket.scad ribs and fillets for a ${loadKn} kN load with safety factor ≥ ${fos} and ≥ 2.0 mm BVH housing clearance.`;
  } else {
    const tol = Number(ov["tolerance"] ?? 1e-4).toExponential(0);
    return `Migrate ServoActuator.slx to Modelica + SysML v2, verify ISO 26262 B2B trajectory parity (tolerance <= ${tol}), and prove unbounded IC3/SOS safety with MC/DC vectors.`;
  }
}

function setAndRunParam(scenarioId: string, param: string, value: number | string): void {
  if (!userOverrides.value[scenarioId]) userOverrides.value[scenarioId] = {};
  userOverrides.value[scenarioId][param] = value;
  const updatedPrompt = buildScenarioPrompt(scenarioId);

  // If the user is in Live Mode with the prompt sitting in the input box ("prefilled"),
  // update the prefilled prompt AND execute it immediately so the user sees immediate live feedback.
  executePromptLive(updatedPrompt, scenarioId);
}

function handleInputFocus(): void {
  if (!isInteractiveMode.value) {
    enterLiveMode(scenarios[active.value].prompt, true);
  }
}

function handleSubmit(): void {
  if (isRunning.value) return;
  if (!isInteractiveMode.value) {
    // Clicking Send while in Playback Mode switches to Live Mode and runs live immediately
    executePromptLive(inputPrompt.value.trim() || scenarios[active.value].prompt);
    return;
  }
  const textToRun = inputPrompt.value.trim() || displayedPrompt.value || scenarios[active.value].prompt;
  executePromptLive(textToRun);
}

function select(index: number): void {
  active.value = index;
  if (isInteractiveMode.value) {
    // In Live Mode, selecting a scenario tab clears the previous results and prefills the new scenario's prompt in `#input`
    enterLiveMode(scenarios[index].prompt, true);
  } else {
    displayedPrompt.value = scenarios[index].prompt;
    inputPrompt.value = "";
    startPlaybackTimer();
  }
}

interface ChipOption {
  label: string;
  active: boolean;
  apply: () => void;
}

const currentChips = computed<ChipOption[]>(() => {
  const s = scenarios[active.value];
  if (s.id === "synthesize") {
    const currOs = Number(userOverrides.value.synthesize?.targetOvershootPct ?? 4.0);
    const currSet = Number(userOverrides.value.synthesize?.settlingTimeLimitS ?? 0.35);
    return [
      {
        label: "OS 2.5%",
        active: currOs === 2.5,
        apply: () => setAndRunParam("synthesize", "targetOvershootPct", 2.5),
      },
      {
        label: "OS 4.0%",
        active: currOs === 4.0,
        apply: () => setAndRunParam("synthesize", "targetOvershootPct", 4.0),
      },
      {
        label: "OS 6.0%",
        active: currOs === 6.0,
        apply: () => setAndRunParam("synthesize", "targetOvershootPct", 6.0),
      },
      {
        label: "Settling 0.25s",
        active: currSet === 0.25,
        apply: () => setAndRunParam("synthesize", "settlingTimeLimitS", 0.25),
      },
      {
        label: "Settling 0.35s",
        active: currSet === 0.35,
        apply: () => setAndRunParam("synthesize", "settlingTimeLimitS", 0.35),
      },
    ];
  } else if (s.id === "tgg") {
    const currP = Number(userOverrides.value.tgg?.pressureMpa ?? 18.5);
    return [
      {
        label: "15.0 MPa",
        active: currP === 15.0,
        apply: () => setAndRunParam("tgg", "pressureMpa", 15.0),
      },
      {
        label: "18.5 MPa",
        active: currP === 18.5,
        apply: () => setAndRunParam("tgg", "pressureMpa", 18.5),
      },
      {
        label: "22.0 MPa",
        active: currP === 22.0,
        apply: () => setAndRunParam("tgg", "pressureMpa", 22.0),
      },
    ];
  } else if (s.id === "grid") {
    const currSag = Number(userOverrides.value.grid?.faultSagPu ?? 0.15);
    return [
      {
        label: "0.10 pu",
        active: currSag === 0.1,
        apply: () => setAndRunParam("grid", "faultSagPu", 0.1),
      },
      {
        label: "0.15 pu",
        active: currSag === 0.15,
        apply: () => setAndRunParam("grid", "faultSagPu", 0.15),
      },
      {
        label: "0.25 pu",
        active: currSag === 0.25,
        apply: () => setAndRunParam("grid", "faultSagPu", 0.25),
      },
    ];
  } else if (s.id === "cad") {
    const currL = Number(userOverrides.value.cad?.appliedLoadN ?? 4200);
    const currF = Number(userOverrides.value.cad?.minSafetyFactor ?? 1.5);
    return [
      {
        label: "3.5 kN",
        active: currL === 3500,
        apply: () => setAndRunParam("cad", "appliedLoadN", 3500),
      },
      {
        label: "4.2 kN",
        active: currL === 4200,
        apply: () => setAndRunParam("cad", "appliedLoadN", 4200),
      },
      {
        label: "5.5 kN",
        active: currL === 5500,
        apply: () => setAndRunParam("cad", "appliedLoadN", 5500),
      },
      {
        label: "FoS ≥ 1.8x",
        active: currF === 1.8,
        apply: () => setAndRunParam("cad", "minSafetyFactor", 1.8),
      },
    ];
  } else {
    const currT = Number(userOverrides.value.safety?.tolerance ?? 1e-4);
    return [
      {
        label: "Tol 1e-5",
        active: currT === 1e-5,
        apply: () => setAndRunParam("safety", "tolerance", 1e-5),
      },
      {
        label: "Tol 1e-4",
        active: currT === 1e-4,
        apply: () => setAndRunParam("safety", "tolerance", 1e-4),
      },
      {
        label: "Tol 1e-3",
        active: currT === 1e-3,
        apply: () => setAndRunParam("safety", "tolerance", 1e-3),
      },
    ];
  }
});

const activeScenario = computed(() => scenarios[active.value]);

const allCurrentCalls = computed<LiveToolCallResult[]>(() => {
  const s = scenarios[active.value];
  const live = liveResults.value[s.id];
  return isInteractiveMode.value && live ? live.calls : s.calls;
});

const displayedCalls = computed<LiveToolCallResult[]>(() => {
  if (!isInteractiveMode.value) {
    return scenarios[active.value].calls;
  }
  if (livePhase.value === "prefilled") {
    return [];
  }
  if (livePhase.value === "running") {
    return allCurrentCalls.value.slice(0, visibleCallCount.value);
  }
  return allCurrentCalls.value;
});

const displayedThought = computed(() => {
  const s = scenarios[active.value];
  const live = liveResults.value[s.id];
  return isInteractiveMode.value && live ? live.thoughtProcess : s.thoughtProcess;
});

const displayedFileEdit = computed<LiveFileEdit>(() => {
  const s = scenarios[active.value];
  const live = liveResults.value[s.id];
  return isInteractiveMode.value && live ? live.fileEdit : s.fileEdit;
});

const displayedVerdict = computed(() => {
  const s = scenarios[active.value];
  const live = liveResults.value[s.id];
  return isInteractiveMode.value && live ? live.verdict : s.verdict;
});

const displayedSummaryHtml = computed(() => {
  const s = scenarios[active.value];
  const live = liveResults.value[s.id];
  if (isInteractiveMode.value && live) {
    return formatSimpleMarkdown(live.assistantSummary);
  }
  return s.assistantSummary;
});

const currentDurationMs = computed(() => {
  if (!isInteractiveMode.value || livePhase.value !== "completed") return null;
  const s = scenarios[active.value];
  return liveResults.value[s.id]?.durationMs ?? null;
});

const providerStatusLabel = computed(() => {
  if (isRunning.value) return "Solving in WASM...";
  switch (selectedProvider.value) {
    case "webgpu":
      return "Qwen3-1.7B Ready";
    case "ollama":
      return "Ollama Ready";
    case "hosted-mcp":
      return "MCP Cloud Ready";
    default:
      return "WASM Kernel Ready";
  }
});

async function copyMcpConfig(): Promise<void> {
  try {
    await navigator.clipboard.writeText(activeMcpClientOption.value.code);
    copied.value = true;
    setTimeout(() => (copied.value = false), 1800);
  } catch {
    /* clipboard unavailable */
  }
}

async function copySecondaryMcpCmd(): Promise<void> {
  const cmd = activeMcpClientOption.value.secondaryCmd;
  if (!cmd) return;
  try {
    await navigator.clipboard.writeText(cmd);
    copiedSecondary.value = true;
    setTimeout(() => (copiedSecondary.value = false), 1800);
  } catch {
    /* clipboard unavailable */
  }
}

onMounted(() => {
  startPlaybackTimer();
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
});
</script>

<template>
  <section class="ms-section home-ai" aria-label="AI Agents and Model Context Protocol">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">AI-Native Engineering · Model Context Protocol</span>
        <h2 class="ms-h2">Give AI agents a deterministic compiler and physics engine</h2>
        <p class="ms-lead">
          Language models hallucinate when guessing differential equations in plain text.
          <code>@modelscript/mcp</code> exposes {{ mcpData.toolCount }} compiler, solver, and formal verification tools
          so AI agents can compile, simulate, and prove engineering designs in a closed loop.
        </p>
      </header>

      <div class="ai-layout">
        <!-- Left column: Scenario selector + Accurate MCP Client Config -->
        <div
          class="ai-sidebar"
          @mouseenter="isPausedOnHover = true"
          @mouseleave="isPausedOnHover = false"
        >
          <div class="ai-tabs" role="tablist" aria-label="AI agent workflows">
            <button
              v-for="(s, i) in scenarios"
              :key="s.id"
              type="button"
              role="tab"
              class="ai-tab"
              :class="{ active: active === i }"
              :aria-selected="active === i"
              :aria-controls="`ai-panel-${s.id}`"
              @click="select(i)"
            >
              <div class="ai-tab-top">
                <span class="ai-tab-icon"><MsIcon :name="s.icon" :size="20" :duotone="true" /></span>
                <span class="ai-tab-badge">{{ s.badge }}</span>
              </div>
              <span class="ai-tab-title">{{ s.title }}</span>
              <span class="ai-tab-summary">{{ s.summary }}</span>
              <span
                v-if="active === i && !isInteractiveMode && !isPausedOnHover"
                :key="`prog-${active}`"
                class="ai-tab-progress"
                aria-hidden="true"
              />
            </button>
          </div>

          <!-- Accurate Multi-Client MCP Configuration Card -->
          <div class="mcp-config-card">
            <div class="mcp-config-head">
              <span class="mcp-config-title">
                <MsIcon name="terminal" :size="15" /> Add ModelScript AI to your IDE
              </span>
              <a href="/reference/mcp-and-ide" class="mcp-config-link">
                All {{ mcpData.toolCount }} MCP tools <MsIcon name="arrowRight" :size="13" :stroke="2" />
              </a>
            </div>

            <!-- Client Switcher Tabs -->
            <div class="mcp-client-tabs" role="tablist" aria-label="MCP client configuration">
              <button
                v-for="opt in mcpClientOptions"
                :key="opt.id"
                type="button"
                role="tab"
                class="mcp-client-tab"
                :class="{ active: selectedMcpClient === opt.id }"
                :aria-selected="selectedMcpClient === opt.id"
                @click="selectedMcpClient = opt.id"
              >
                {{ opt.label }}
              </button>
            </div>

            <div class="mcp-snippet-box">
              <div class="mcp-snippet-bar">
                <span class="mcp-file-hint">{{ activeMcpClientOption.fileHint }}</span>
                <button type="button" class="mcp-copy-btn" @click="copyMcpConfig">
                  {{ copied ? "✓ Copied" : "Copy" }}
                </button>
              </div>
              <pre class="mcp-code-block"><code>{{ activeMcpClientOption.code }}</code></pre>
            </div>

            <div v-if="activeMcpClientOption.secondaryCmd" class="mcp-cmd-row">
              <span class="mcp-cli-tag">CLI</span>
              <code>{{ activeMcpClientOption.secondaryCmd }}</code>
              <button type="button" class="mcp-copy-btn" @click="copySecondaryMcpCmd">
                {{ copiedSecondary ? "✓ Copied" : "Copy" }}
              </button>
            </div>

            <div class="mcp-tiers">
              <span class="mcp-tier">stdio &amp; SSE transports</span>
              <span class="mcp-tier">In-WASM AOT dispatch</span>
              <a href="/llms.txt" target="_blank" rel="noopener" class="mcp-tier mcp-tier-link">llms.txt context ↗</a>
            </div>
          </div>
        </div>

        <!-- Right column: Interactive VS Code AI Chatbox (100% Parity with packages/ide/src/chat-panel.ts) -->
        <div id="ai-panel" role="tabpanel" class="ai-console">
          <!-- Chat header (matching VS Code #header) -->
          <div id="header" class="console-bar">
            <div class="console-bar-left">
              <span class="chat-bot-icon"><MsIcon name="sparkles" :size="15" /></span>
              <span class="console-title">ModelScript AI</span>
              <span class="kernel-badge">
                <span class="kernel-dot" :class="{ pulsing: isRunning }" />
                {{ providerStatusLabel }}
              </span>
            </div>
            <div class="console-bar-right">
              <span v-if="currentDurationMs" class="live-exec-badge">
                <span class="live-dot" />
                Live: {{ currentDurationMs }}ms
              </span>
              <select
                v-model="selectedProvider"
                class="model-provider-select"
                title="Inference & MCP Provider Tier"
              >
                <option value="wasm">In-Browser WASM Kernel</option>
                <option value="webgpu">Local WebGPU (Qwen3-1.7B)</option>
                <option value="ollama">Local Workstation (Ollama 11434)</option>
                <option value="hosted-mcp">Hosted Cloud (ModelScript / MCP)</option>
              </select>

              <!-- Explicit Segmented Mode Control: Playback vs Live Mode -->
              <div class="mode-segmented" role="group" aria-label="Chat interaction mode">
                <button
                  type="button"
                  class="mode-seg-btn"
                  :class="{ active: !isInteractiveMode }"
                  title="Automatic scenario showcase"
                  @click="enterPlaybackMode()"
                >
                  ▶ Playback
                </button>
                <button
                  type="button"
                  class="mode-seg-btn live"
                  :class="{ active: isInteractiveMode }"
                  title="Clear playback and move prompt to chat input for live execution"
                  @click="enterLiveMode()"
                >
                  ⚡ Live Mode
                </button>
              </div>
            </div>
          </div>

          <!-- Active Workspace File Context Bar (matching VS Code sendActiveFileContext) -->
          <div class="context-bar">
            <div class="context-pill">
              <svg width="12" height="12" viewBox="0 0 16 16" fill="currentColor" style="opacity:0.75;flex-shrink:0;">
                <path d="M13.8 4.7l-3.5-3.5A1 1 0 0 0 9.6 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.4a1 1 0 0 0-.2-.7zM10 2.4L12.6 5H10V2.4zM13 14H3V2h6v4h4v8z"/>
              </svg>
              <span class="context-file">{{ activeScenario.activeFile }}</span>
              <span class="context-sep">·</span>
              <span class="context-sym">{{ activeScenario.activeSymbol }}</span>
            </div>
            <button
              v-if="isInteractiveMode && livePhase === 'completed'"
              type="button"
              class="reset-prompt-btn"
              title="Clear results and move prompt back into the input box"
              @click="enterLiveMode(displayedPrompt)"
            >
              ↺ Move prompt to input
            </button>
            <span v-else-if="!isInteractiveMode" class="context-mode-hint">
              Auto-showcase · Switch to <strong>⚡ Live Mode</strong> to test
            </span>
            <span v-else-if="livePhase === 'prefilled'" class="context-mode-hint live">
              Prompt prefilled below · Click <strong>Send (→)</strong>
            </span>
          </div>

          <!-- Progress bar (matching VS Code #progress-container) -->
          <div id="progress-container" class="console-progress-container" :class="{ visible: isRunning }">
            <div class="console-progress-track">
              <div class="console-progress-bar" :style="{ width: `${progressPct}%` }" />
            </div>
            <div class="console-progress-text">{{ progressText }}</div>
          </div>

          <!-- Messages scroll area (matching VS Code #messages) -->
          <div id="messages" ref="messagesContainerRef" class="console-body">
            <!-- LIVE MODE PREFILLED STATE: Results cleared, prompt moved down to input box -->
            <div
              v-if="isInteractiveMode && livePhase === 'prefilled'"
              class="live-empty-state"
            >
              <div class="les-icon-ring">
                <MsIcon :name="activeScenario.icon" :size="24" :duotone="true" />
              </div>
              <div class="les-title">Ready for live WebAssembly execution</div>
              <p class="les-desc">
                Results cleared and prompt moved to the chat input below. Edit the target specifications, pick a
                <strong>Quick tune</strong> chip, or click the blue <strong>Send (→)</strong> button to execute
                <code>{{ activeScenario.calls.map((c) => c.tool).join(" → ") }}</code> live.
              </p>
              <div class="les-actions">
                <button type="button" class="les-run-btn" @click="handleSubmit">
                  <span>Run Prefilled Prompt in WASM</span>
                  <svg viewBox="0 0 16 16" width="13" height="13" fill="currentColor">
                    <path d="M8.6 1L15 7.4L15 8.1L8.6 14.5L7.9 13.8L13.3 8.5H1V7.5H13.3L7.9 2.1L8.6 1Z"/>
                  </svg>
                </button>
              </div>
            </div>

            <!-- CONVERSATION VIEW: Playback Mode OR Live Running/Completed -->
            <template v-else>
              <!-- User message bubble (.msg.user) -->
              <div class="msg user">
                <div class="user-bubble-content">{{ displayedPrompt }}</div>
                <button
                  type="button"
                  class="user-bubble-edit"
                  title="Clear results and edit this prompt in the chat input"
                  @click="enterLiveMode(displayedPrompt)"
                >
                  ✎ Edit
                </button>
              </div>

              <!-- Assistant response (.msg.assistant) -->
              <div class="msg assistant">
                <!-- Thought Process block (matching VS Code .think-block) -->
                <details class="think-block">
                  <summary>
                    <template v-if="isRunning">
                      Thinking<span class="animated-ellipsis" />
                    </template>
                    <template v-else>Thought Process</template>
                  </summary>
                  <div class="think-content">{{ displayedThought }}</div>
                </details>

                <!-- Completed MCP JSON-RPC Trace Cards -->
                <div
                  v-for="(call, idx) in displayedCalls"
                  :key="call.tool + idx"
                  class="trace-card"
                >
                  <div class="trace-head">
                    <span class="trace-step-num">{{ idx + 1 }}</span>
                    <span class="trace-tool">{{ call.tool }}</span>
                    <span class="trace-proto">JSON-RPC tools/call</span>
                  </div>
                  <pre class="trace-args"><code>{{ call.args }}</code></pre>

                  <div class="trace-result">
                    <div class="trace-res-title">
                      <svg width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
                        <polyline points="20 6 9 17 4 12" />
                      </svg>
                      <span>{{ call.resultTitle }}</span>
                    </div>
                    <div class="trace-metrics">
                      <div
                        v-for="m in call.metrics"
                        :key="m.label"
                        class="trace-metric"
                        :class="m.status || 'info'"
                      >
                        <span class="tm-label">{{ m.label }}</span>
                        <span class="tm-val">{{ m.value }}</span>
                      </div>
                    </div>
                  </div>
                </div>

                <!-- Live In-Flight Tool Call Card (matching VS Code chat-webview.ts .trace-running) -->
                <div v-if="isRunning && runningToolName" class="trace-card running">
                  <div class="trace-head">
                    <span class="trace-step-num">{{ runningStepNumber }}</span>
                    <span class="trace-tool">{{ runningToolName }}</span>
                    <span class="trace-proto">JSON-RPC tools/call</span>
                  </div>
                  <div class="trace-running">
                    <span class="typing-dots"><span /><span /><span /></span>
                    <span>Executing tool call in WASM linear memory<span class="animated-ellipsis" /></span>
                  </div>
                </div>

                <!-- Post-tool completion blocks: File Edit Pill + Verdict Banner + Assistant Response Block -->
                <template v-if="!isRunning">
                  <!-- Workspace File Patch Pill (matching VS Code chat-webview.ts lines 1096-1105) -->
                  <div class="file-edit-pill">
                    <svg width="13" height="13" viewBox="0 0 16 16" fill="currentColor" style="opacity:0.75;flex-shrink:0;">
                      <path d="M13.8 4.7l-3.5-3.5A1 1 0 0 0 9.6 1H3a1 1 0 0 0-1 1v12a1 1 0 0 0 1 1h10a1 1 0 0 0 1-1V5.4a1 1 0 0 0-.2-.7zM10 2.4L12.6 5H10V2.4zM13 14H3V2h6v4h4v8z"/>
                    </svg>
                    <span class="fep-action">modelscript_patch_code</span>
                    <code class="fep-file">{{ displayedFileEdit.file }}</code>
                    <span class="fep-added">+{{ displayedFileEdit.added }}</span>
                    <span class="fep-deleted">-{{ displayedFileEdit.deleted }}</span>
                  </div>

                  <!-- Deterministic Compiler Proof verdict banner -->
                  <div class="verdict-banner">
                    <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.2" style="flex-shrink:0;margin-top:2px;">
                      <path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z" />
                      <path d="m9 12 2 2 4-4" />
                    </svg>
                    <div class="verdict-content">
                      <strong>Deterministic Compiler Proof:</strong>
                      <span>{{ displayedVerdict }}</span>
                    </div>
                  </div>

                  <!-- Assistant response summary block (matching VS Code .response-block) -->
                  <div class="response-block" v-html="displayedSummaryHtml" />
                </template>
              </div>
            </template>
          </div>

          <!-- Input area (matching VS Code #input-area) -->
          <div id="input-area" class="chat-input-area">
            <!-- Quick tune chips row -->
            <div class="quick-suggestions">
              <span class="qs-label">Quick tune:</span>
              <button
                v-for="chip in currentChips"
                :key="chip.label"
                type="button"
                class="param-chip"
                :class="{ active: chip.active && isInteractiveMode }"
                @click="chip.apply()"
              >
                {{ chip.label }}
              </button>
            </div>

            <!-- The input wrapper with auto-resizing editable textarea and send button -->
            <div
              class="input-wrapper"
              :class="{ 'prefilled-highlight': isInteractiveMode && livePhase === 'prefilled' }"
            >
              <textarea
                id="input"
                ref="inputTextareaRef"
                v-model="inputPrompt"
                rows="1"
                :placeholder="
                  !isInteractiveMode
                    ? 'Click here or switch to ⚡ Live Mode to customize & send...'
                    : livePhase === 'prefilled'
                      ? 'Edit prompt or press Enter / click Send (→) to run in WASM...'
                      : 'Ask a follow-up or adjust target specs (e.g. 2% overshoot in 0.25s)...'
                "
                :disabled="isRunning"
                @focus="handleInputFocus"
                @input="autoResizeInput"
                @keydown.enter.exact.prevent="handleSubmit"
              />
              <button
                id="send-btn"
                type="button"
                :class="{ 'ready-pulse': isInteractiveMode && livePhase === 'prefilled' && !!inputPrompt.trim() }"
                :disabled="isRunning"
                :title="
                  isInteractiveMode && livePhase === 'prefilled'
                    ? 'Send prefilled prompt to WASM kernel (Enter)'
                    : 'Run live in WASM kernel (Enter)'
                "
                @click="handleSubmit"
              >
                <svg viewBox="0 0 16 16" width="16" height="16" fill="currentColor">
                  <path d="M8.6 1L15 7.4L15 8.1L8.6 14.5L7.9 13.8L13.3 8.5H1V7.5H13.3L7.9 2.1L8.6 1Z"/>
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ai-layout {
  display: grid;
  grid-template-columns: minmax(0, 0.92fr) minmax(0, 1.08fr);
  gap: 28px;
  align-items: start;
}

.ai-sidebar {
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.ai-tabs {
  display: grid;
  gap: 10px;
}

.ai-tab {
  position: relative;
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 16px 18px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-align: left;
  overflow: hidden;
  transition:
    border-color 0.25s ease,
    background 0.25s ease,
    box-shadow 0.25s ease;
}

.ai-tab:hover {
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 40%, transparent);
}

.ai-tab.active {
  background: var(--vp-c-bg);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 55%, transparent);
  box-shadow: 0 18px 38px -22px rgba(6, 182, 212, 0.35);
}

.ai-tab-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
}

.ai-tab-icon {
  display: grid;
  place-items: center;
  width: 36px;
  height: 36px;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background:
    radial-gradient(circle at 25% 20%, rgba(34, 211, 238, 0.22), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.16), transparent 68%), var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 28%, transparent);
}

.ai-tab-badge {
  padding: 2px 9px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.ai-tab-title {
  margin-top: 2px;
  font-size: 0.96rem;
  font-weight: 680;
  color: var(--vp-c-text-1);
}

.ai-tab-summary {
  display: none;
  font-size: 0.84rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.ai-tab.active .ai-tab-summary {
  display: block;
}

.ai-tab-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  width: 100%;
  background: var(--ms-gradient);
  transform-origin: left;
  animation: ai-progress 6.5s linear forwards;
}

@keyframes ai-progress {
  from {
    transform: scaleX(0);
  }
  to {
    transform: scaleX(1);
  }
}

/* =========================================================
   MCP Client Config Card
   ========================================================= */
.mcp-config-card {
  padding: 15px 16px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  display: flex;
  flex-direction: column;
  gap: 10px;
}

.mcp-config-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  flex-wrap: wrap;
}

.mcp-config-title {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12.5px;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.mcp-config-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.mcp-client-tabs {
  display: grid;
  grid-template-columns: repeat(4, minmax(0, 1fr));
  gap: 4px;
  padding: 3px;
  border-radius: 9px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.mcp-client-tab {
  padding: 4px 6px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  text-align: center;
  cursor: pointer;
  transition: all 0.15s ease;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.mcp-client-tab:hover {
  color: var(--vp-c-text-1);
}

.mcp-client-tab.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}

.mcp-snippet-box {
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  overflow: hidden;
}

.mcp-snippet-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 5px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 60%, transparent);
}

.mcp-file-hint {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: var(--vp-c-text-2);
}

.mcp-code-block {
  margin: 0 !important;
  padding: 8px 11px !important;
  font-family: var(--vp-font-family-mono);
  font-size: 11px !important;
  line-height: 1.45;
  color: var(--vp-c-text-1);
  background: transparent !important;
  overflow-x: auto;
}

.mcp-cmd-row {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 8px 5px 10px;
  border-radius: 9px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.mcp-cli-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  font-weight: 700;
  text-transform: uppercase;
  padding: 1px 5px;
  border-radius: 4px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  flex-shrink: 0;
}

.mcp-cmd-row code {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-1);
  background: none;
  padding: 0;
  white-space: nowrap;
  overflow-x: auto;
}

.mcp-copy-btn {
  padding: 3px 9px;
  border-radius: 6px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  cursor: pointer;
  flex-shrink: 0;
  transition: opacity 0.15s ease;
}

.mcp-copy-btn:hover {
  opacity: 0.85;
}

.mcp-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.mcp-tier {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
}

.mcp-tier-link {
  color: var(--vp-c-brand-1);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

/* =========================================================
   Console Panel - Light Mode Defaults (VS Code Light Parity)
   ========================================================= */
.ai-console {
  border-radius: 16px;
  overflow: hidden;
  background: #ffffff;
  border: 1px solid rgba(203, 213, 225, 0.85);
  box-shadow: 0 16px 36px -16px rgba(15, 23, 42, 0.08), 0 0 0 1px rgba(226, 232, 240, 0.6);
  display: flex;
  flex-direction: column;
  min-height: 550px;
}

.console-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 8px 12px;
  background: #f8fafc;
  border-bottom: 1px solid rgba(226, 232, 240, 1);
  flex-wrap: wrap;
}

.console-bar-left {
  display: flex;
  align-items: center;
  gap: 7px;
}

.chat-bot-icon {
  display: grid;
  place-items: center;
  color: var(--vp-c-brand-1);
}

.console-title {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: #1e293b;
}

.kernel-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-family: var(--vp-font-family-mono);
  color: #059669;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(5, 150, 105, 0.3);
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 500;
}

.kernel-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.kernel-dot.pulsing {
  animation: kernel-pulse 0.85s ease-in-out infinite alternate;
}

@keyframes kernel-pulse {
  from {
    opacity: 0.4;
    transform: scale(0.85);
  }
  to {
    opacity: 1;
    transform: scale(1.25);
    box-shadow: 0 0 10px #34d399;
  }
}

.console-bar-right {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-left: auto;
  flex-wrap: wrap;
}

.live-exec-badge {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 10.5px;
  font-family: var(--vp-font-family-mono);
  color: #0284c7;
  background: rgba(2, 132, 199, 0.08);
  border: 1px solid rgba(2, 132, 199, 0.25);
  padding: 1px 7px;
  border-radius: 999px;
  font-weight: 500;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #0284c7;
  box-shadow: 0 0 6px #0284c7;
}

.model-provider-select {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  background: #ffffff;
  color: #334155;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 6px;
  padding: 2px 6px;
  outline: none;
  cursor: pointer;
}

.mode-segmented {
  display: inline-flex;
  align-items: center;
  background: #e2e8f0;
  padding: 2px;
  border-radius: 7px;
  gap: 2px;
}

.mode-seg-btn {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 5px;
  color: #475569;
  background: transparent;
  cursor: pointer;
  transition: all 0.15s ease;
}

.mode-seg-btn:hover {
  color: #0f172a;
}

.mode-seg-btn.active {
  background: #ffffff;
  color: #0f172a;
  box-shadow: 0 1px 2px rgba(15, 23, 42, 0.1);
}

.mode-seg-btn.live.active {
  background: #0284c7;
  color: #ffffff;
  box-shadow: 0 1px 4px rgba(2, 132, 199, 0.35);
}

/* Active Workspace File Context Bar */
.context-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 5px 14px;
  background: #f1f5f9;
  border-bottom: 1px solid rgba(226, 232, 240, 1);
  font-size: 11px;
}

.context-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #334155;
}

.context-file {
  font-weight: 600;
  color: #0f172a;
}

.context-sep {
  opacity: 0.45;
}

.context-sym {
  color: #0284c7;
}

.context-mode-hint {
  font-size: 10.5px;
  color: #64748b;
}

.context-mode-hint.live {
  color: #0284c7;
  font-weight: 500;
}

.reset-prompt-btn {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: #0284c7;
  background: rgba(2, 132, 199, 0.08);
  border: 1px solid rgba(2, 132, 199, 0.25);
  padding: 1px 7px;
  border-radius: 5px;
  cursor: pointer;
  transition: background 0.15s ease;
}

.reset-prompt-btn:hover {
  background: rgba(2, 132, 199, 0.16);
}

.console-progress-container {
  display: none;
  padding: 6px 14px 8px;
  background: #f8fafc;
  border-bottom: 1px solid rgba(226, 232, 240, 1);
  flex-direction: column;
  gap: 4px;
}

.console-progress-container.visible {
  display: flex;
}

.console-progress-track {
  height: 3px;
  background: rgba(203, 213, 225, 0.6);
  border-radius: 2px;
  overflow: hidden;
}

.console-progress-bar {
  height: 100%;
  background: linear-gradient(90deg, #0284c7, #10b981);
  transition: width 0.16s ease-out;
}

.console-progress-text {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: #64748b;
}

.console-body {
  flex: 1;
  padding: 14px;
  display: flex;
  flex-direction: column;
  gap: 10px;
  max-height: 490px;
  overflow-y: auto;
}

/* Live Empty / Ready State (when switched from Playback to Live Mode) */
.live-empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  text-align: center;
  padding: 36px 24px;
  gap: 10px;
  border: 1px dashed rgba(2, 132, 199, 0.35);
  border-radius: 12px;
  background: radial-gradient(circle at 50% 0%, rgba(2, 132, 199, 0.06), transparent 72%);
  margin: auto 0;
}

.les-icon-ring {
  width: 48px;
  height: 48px;
  border-radius: 14px;
  display: grid;
  place-items: center;
  color: #0284c7;
  background: rgba(2, 132, 199, 0.1);
  border: 1px solid rgba(2, 132, 199, 0.25);
}

.les-title {
  font-size: 14px;
  font-weight: 700;
  color: #0f172a;
}

.les-desc {
  font-size: 12.5px;
  line-height: 1.55;
  color: #475569;
  max-width: 440px;
  margin: 0;
}

.les-desc code {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #0284c7;
  background: rgba(2, 132, 199, 0.08);
  padding: 1px 5px;
  border-radius: 4px;
}

.les-actions {
  margin-top: 4px;
}

.les-run-btn {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 14px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: #ffffff;
  background: linear-gradient(135deg, #0284c7, #1d4ed8);
  box-shadow: 0 4px 12px -2px rgba(2, 132, 199, 0.4);
  cursor: pointer;
  transition: transform 0.15s ease, box-shadow 0.15s ease;
}

.les-run-btn:hover {
  transform: translateY(-1px);
  box-shadow: 0 6px 16px -2px rgba(2, 132, 199, 0.5);
}

/* User & Assistant Messages */
.msg.user {
  align-self: flex-end;
  max-width: 88%;
  background: linear-gradient(135deg, #0284c7, #1d4ed8);
  color: #ffffff;
  padding: 8px 12px;
  border-radius: 12px 12px 2px 12px;
  font-size: 12.5px;
  line-height: 1.45;
  box-shadow: 0 2px 6px -1px rgba(2, 132, 199, 0.25);
  display: flex;
  align-items: flex-start;
  gap: 8px;
}

.user-bubble-content {
  flex: 1;
}

.user-bubble-edit {
  font-family: var(--vp-font-family-mono);
  font-size: 10px;
  font-weight: 600;
  color: rgba(255, 255, 255, 0.9);
  background: rgba(255, 255, 255, 0.16);
  border: 1px solid rgba(255, 255, 255, 0.28);
  border-radius: 5px;
  padding: 1px 6px;
  cursor: pointer;
  flex-shrink: 0;
  transition: background 0.15s ease;
}

.user-bubble-edit:hover {
  background: rgba(255, 255, 255, 0.28);
}

.msg.assistant {
  align-self: stretch;
  display: flex;
  flex-direction: column;
  gap: 8px;
}

/* Thought Process Block (VS Code .think-block parity) */
.think-block {
  font-size: 11.5px;
  color: #64748b;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
  border-radius: 7px;
  padding: 4px 10px;
}

.think-block summary {
  cursor: pointer;
  user-select: none;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 500;
}

.think-content {
  margin-top: 4px;
  font-size: 11px;
  line-height: 1.45;
  color: #475569;
}

.animated-ellipsis::after {
  content: "...";
  display: inline-block;
  animation: ellipsis-pulse 1.2s infinite;
}

@keyframes ellipsis-pulse {
  0%, 100% { opacity: 0.3; }
  50% { opacity: 1; }
}

.trace-card {
  background: #ffffff;
  border: 1px solid rgba(203, 213, 225, 0.85);
  border-radius: 9px;
  overflow: hidden;
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.trace-card.running {
  border-color: rgba(2, 132, 199, 0.45);
}

.trace-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 9px;
  background: #f8fafc;
  border-bottom: 1px solid rgba(226, 232, 240, 1);
}

.trace-step-num {
  width: 17px;
  height: 17px;
  border-radius: 50%;
  background: rgba(2, 132, 199, 0.12);
  border: 1px solid rgba(2, 132, 199, 0.35);
  color: #0284c7;
  font-size: 10px;
  font-weight: 700;
  display: flex;
  align-items: center;
  justify-content: center;
  font-family: var(--vp-font-family-mono);
}

.trace-tool {
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: #0284c7;
}

.trace-proto {
  margin-left: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 9.5px;
  color: #64748b;
  background: rgba(226, 232, 240, 0.8);
  padding: 1px 5px;
  border-radius: 4px;
}

.trace-running {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 9px 12px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #0284c7;
  background: rgba(2, 132, 199, 0.04);
}

.typing-dots {
  display: inline-flex;
  gap: 3px;
}

.typing-dots span {
  width: 5px;
  height: 5px;
  border-radius: 50%;
  background: #0284c7;
  animation: blink 1.2s infinite both;
}

.typing-dots span:nth-child(2) {
  animation-delay: 0.2s;
}

.typing-dots span:nth-child(3) {
  animation-delay: 0.4s;
}

@keyframes blink {
  0%, 80%, 100% { opacity: 0.3; }
  40% { opacity: 1; }
}

.trace-args {
  margin: 0 !important;
  padding: 5px 10px !important;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px !important;
  line-height: 1.4;
  color: #334155;
  background: #f1f5f9 !important;
  border-bottom: 1px solid rgba(226, 232, 240, 1);
  border-radius: 0 !important;
  overflow-x: auto;
  white-space: pre-wrap;
  word-break: break-word;
}

.trace-result {
  padding: 7px 10px;
  background: rgba(16, 185, 129, 0.04);
}

.trace-res-title {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 11.5px;
  font-weight: 600;
  color: #059669;
  margin-bottom: 5px;
}

.trace-metrics {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(130px, 1fr));
  gap: 6px;
}

.trace-metric {
  padding: 4px 7px;
  border-radius: 6px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 1);
  display: flex;
  flex-direction: column;
  gap: 1px;
}

.trace-metric.pass {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(16, 185, 129, 0.35);
}

.trace-metric.info {
  background: rgba(2, 132, 199, 0.06);
  border-color: rgba(2, 132, 199, 0.35);
}

.trace-metric.fail {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(239, 68, 68, 0.35);
}

.tm-label {
  font-size: 9px;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  color: #64748b;
  font-weight: 600;
}

.tm-val {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: #0f172a;
}

/* File Edit Pill (VS Code chat-webview.ts parity) */
.file-edit-pill {
  display: flex;
  align-items: center;
  gap: 7px;
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 1);
  border-radius: 6px;
  padding: 4px 9px;
  font-size: 11.5px;
  color: #334155;
}

.fep-action {
  font-weight: 600;
  color: #0f172a;
}

.fep-file {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #475569;
  background: none;
  padding: 0;
}

.fep-added {
  margin-left: auto;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: #059669;
}

.fep-deleted {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: #dc2626;
}

.verdict-banner {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  padding: 8px 11px;
  border-radius: 8px;
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(56, 189, 248, 0.06));
  border: 1px solid rgba(5, 150, 105, 0.35);
  font-size: 11.5px;
  line-height: 1.4;
  color: #065f46;
}

.verdict-banner strong {
  color: #047857;
  margin-right: 4px;
}

/* Assistant Response Block (VS Code .response-block parity) */
.response-block {
  background: #f8fafc;
  border: 1px solid rgba(226, 232, 240, 0.9);
  padding: 8px 12px;
  border-radius: 2px 12px 12px 12px;
  font-size: 12px;
  line-height: 1.5;
  color: #1e293b;
}

.response-block :deep(code) {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  background: #e2e8f0;
  padding: 1px 4px;
  border-radius: 3px;
}

.chat-input-area {
  padding: 8px 14px 12px;
  background: #f8fafc;
  border-top: 1px solid rgba(226, 232, 240, 1);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.quick-suggestions {
  display: flex;
  align-items: center;
  gap: 5px;
  flex-wrap: wrap;
}

.qs-label {
  font-size: 9.5px;
  font-weight: 600;
  color: #64748b;
  text-transform: uppercase;
  letter-spacing: 0.04em;
}

.param-chip {
  padding: 2px 7px;
  border-radius: 5px;
  font-size: 10.5px;
  font-family: var(--vp-font-family-mono);
  color: #334155;
  background: #ffffff;
  border: 1px solid rgba(203, 213, 225, 0.85);
  cursor: pointer;
  transition: all 0.15s ease;
}

.param-chip:hover {
  border-color: #0284c7;
  color: #0284c7;
}

.param-chip.active {
  background: rgba(16, 185, 129, 0.12);
  border-color: rgba(5, 150, 105, 0.5);
  color: #047857;
  font-weight: 600;
}

.input-wrapper {
  display: flex;
  align-items: flex-end;
  gap: 8px;
  background: #ffffff;
  border: 1px solid rgba(203, 213, 225, 0.9);
  border-radius: 18px;
  padding: 5px 6px 5px 14px;
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.03);
  transition: border-color 0.2s ease, box-shadow 0.2s ease;
}

.input-wrapper:focus-within,
.input-wrapper.prefilled-highlight {
  border-color: #0284c7;
  box-shadow: 0 0 0 3px rgba(2, 132, 199, 0.16);
}

#input {
  flex: 1;
  resize: none;
  background: transparent;
  color: #0f172a;
  border: none;
  padding: 4px 0;
  font-family: var(--vp-font-family-base);
  font-size: 12.5px;
  line-height: 18px;
  min-height: 28px;
  max-height: 96px;
  overflow-y: hidden;
  outline: none;
}

#send-btn {
  align-self: flex-end;
  background: #0284c7;
  color: #fff;
  border: none;
  border-radius: 50%;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  cursor: pointer;
  transition: background 0.2s ease, transform 0.1s ease, box-shadow 0.2s ease;
  flex-shrink: 0;
}

#send-btn.ready-pulse {
  animation: send-ready-pulse 1.5s ease-in-out infinite;
}

@keyframes send-ready-pulse {
  0%, 100% {
    box-shadow: 0 0 0 0 rgba(2, 132, 199, 0.55);
  }
  50% {
    box-shadow: 0 0 0 6px rgba(2, 132, 199, 0);
  }
}

#send-btn:hover:not(:disabled) {
  background: #0369a1;
  transform: scale(1.06);
}

#send-btn:disabled {
  opacity: 0.35;
  cursor: not-allowed;
}

#send-btn svg {
  width: 13px;
  height: 13px;
}

/* =========================================================
   Dark Mode Overrides (:root.dark / .dark) - VS Code Dark Parity
   ========================================================= */
:root.dark .ai-console,
.dark .ai-console {
  background: #080d19;
  border-color: rgba(148, 163, 184, 0.18);
  box-shadow: 0 36px 72px -36px rgba(6, 182, 212, 0.38), inset 0 1px 0 rgba(255, 255, 255, 0.06);
}

:root.dark .console-bar,
.dark .console-bar {
  background: rgba(15, 23, 42, 0.85);
  border-bottom-color: rgba(148, 163, 184, 0.14);
}

:root.dark .console-title,
.dark .console-title {
  color: #e2e8f0;
}

:root.dark .kernel-badge,
.dark .kernel-badge {
  color: #34d399;
  background: rgba(16, 185, 129, 0.1);
  border-color: rgba(52, 211, 153, 0.25);
}

:root.dark .live-exec-badge,
.dark .live-exec-badge {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.25);
}

:root.dark .live-dot,
.dark .live-dot {
  background: #38bdf8;
  box-shadow: 0 0 6px #38bdf8;
}

:root.dark .model-provider-select,
.dark .model-provider-select {
  background: #0f172a;
  color: #cbd5e1;
  border-color: rgba(148, 163, 184, 0.2);
}

:root.dark .mode-segmented,
.dark .mode-segmented {
  background: rgba(15, 23, 42, 0.95);
  border: 1px solid rgba(148, 163, 184, 0.18);
}

:root.dark .mode-seg-btn,
.dark .mode-seg-btn {
  color: #94a3b8;
}

:root.dark .mode-seg-btn:hover,
.dark .mode-seg-btn:hover {
  color: #f1f5f9;
}

:root.dark .mode-seg-btn.active,
.dark .mode-seg-btn.active {
  background: rgba(51, 65, 85, 0.75);
  color: #f8fafc;
}

:root.dark .mode-seg-btn.live.active,
.dark .mode-seg-btn.live.active {
  background: #0284c7;
  color: #ffffff;
}

:root.dark .context-bar,
.dark .context-bar {
  background: rgba(15, 23, 42, 0.55);
  border-bottom-color: rgba(148, 163, 184, 0.12);
}

:root.dark .context-pill,
.dark .context-pill {
  color: #94a3b8;
}

:root.dark .context-file,
.dark .context-file {
  color: #e2e8f0;
}

:root.dark .context-sym,
.dark .context-sym {
  color: #38bdf8;
}

:root.dark .context-mode-hint.live,
.dark .context-mode-hint.live {
  color: #38bdf8;
}

:root.dark .reset-prompt-btn,
.dark .reset-prompt-btn {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.1);
  border-color: rgba(56, 189, 248, 0.25);
}

:root.dark .console-progress-container,
.dark .console-progress-container {
  background: rgba(15, 23, 42, 0.96);
  border-bottom-color: rgba(148, 163, 184, 0.14);
}

:root.dark .console-progress-track,
.dark .console-progress-track {
  background: rgba(51, 65, 85, 0.5);
}

:root.dark .console-progress-bar,
.dark .console-progress-bar {
  background: linear-gradient(90deg, #2dd4bf, #38bdf8);
}

:root.dark .console-progress-text,
.dark .console-progress-text {
  color: #94a3b8;
}

:root.dark .live-empty-state,
.dark .live-empty-state {
  border-color: rgba(56, 189, 248, 0.3);
  background: radial-gradient(circle at 50% 0%, rgba(56, 189, 248, 0.08), transparent 72%);
}

:root.dark .les-icon-ring,
.dark .les-icon-ring {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
  border-color: rgba(56, 189, 248, 0.28);
}

:root.dark .les-title,
.dark .les-title {
  color: #f1f5f9;
}

:root.dark .les-desc,
.dark .les-desc {
  color: #94a3b8;
}

:root.dark .les-desc code,
.dark .les-desc code {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.12);
}

:root.dark .msg.user,
.dark .msg.user {
  background: linear-gradient(135deg, #0284c7, #2563eb);
  color: #ffffff;
}

:root.dark .think-block,
.dark .think-block {
  background: rgba(15, 23, 42, 0.6);
  border-color: rgba(148, 163, 184, 0.14);
  color: #94a3b8;
}

:root.dark .think-content,
.dark .think-content {
  color: #cbd5e1;
}

:root.dark .trace-card,
.dark .trace-card {
  background: rgba(12, 17, 29, 0.85);
  border-color: rgba(148, 163, 184, 0.16);
}

:root.dark .trace-card.running,
.dark .trace-card.running {
  border-color: rgba(56, 189, 248, 0.45);
}

:root.dark .trace-head,
.dark .trace-head {
  background: rgba(15, 23, 42, 0.85);
  border-bottom-color: rgba(148, 163, 184, 0.1);
}

:root.dark .trace-step-num,
.dark .trace-step-num {
  background: rgba(56, 189, 248, 0.15);
  border-color: rgba(56, 189, 248, 0.35);
  color: #38bdf8;
}

:root.dark .trace-tool,
.dark .trace-tool {
  color: #22d3ee;
}

:root.dark .trace-proto,
.dark .trace-proto {
  color: #64748b;
  background: rgba(30, 41, 59, 0.6);
}

:root.dark .trace-running,
.dark .trace-running {
  color: #38bdf8;
  background: rgba(56, 189, 248, 0.06);
}

:root.dark .typing-dots span,
.dark .typing-dots span {
  background: #38bdf8;
}

:root.dark .trace-args,
.dark .trace-args {
  background: rgba(7, 10, 19, 0.65) !important;
  border-bottom-color: rgba(148, 163, 184, 0.08);
  color: #94a3b8;
}

:root.dark .trace-result,
.dark .trace-result {
  background: rgba(16, 185, 129, 0.04);
}

:root.dark .trace-res-title,
.dark .trace-res-title {
  color: #34d399;
}

:root.dark .trace-metric,
.dark .trace-metric {
  background: rgba(15, 23, 42, 0.75);
  border-color: rgba(148, 163, 184, 0.12);
}

:root.dark .trace-metric.pass,
.dark .trace-metric.pass {
  background: rgba(16, 185, 129, 0.08);
  border-color: rgba(52, 211, 153, 0.25);
}

:root.dark .trace-metric.info,
.dark .trace-metric.info {
  background: rgba(56, 189, 248, 0.06);
  border-color: rgba(56, 189, 248, 0.25);
}

:root.dark .trace-metric.fail,
.dark .trace-metric.fail {
  background: rgba(239, 68, 68, 0.08);
  border-color: rgba(248, 113, 113, 0.35);
}

:root.dark .tm-label,
.dark .tm-label {
  color: #64748b;
}

:root.dark .tm-val,
.dark .tm-val {
  color: #f1f5f9;
}

:root.dark .file-edit-pill,
.dark .file-edit-pill {
  background: rgba(15, 23, 42, 0.65);
  border-color: rgba(148, 163, 184, 0.14);
  color: #cbd5e1;
}

:root.dark .fep-action,
.dark .fep-action {
  color: #e2e8f0;
}

:root.dark .fep-file,
.dark .fep-file {
  color: #94a3b8;
}

:root.dark .fep-added,
.dark .fep-added {
  color: #34d399;
}

:root.dark .fep-deleted,
.dark .fep-deleted {
  color: #f87171;
}

:root.dark .verdict-banner,
.dark .verdict-banner {
  background: linear-gradient(135deg, rgba(16, 185, 129, 0.12), rgba(56, 189, 248, 0.08));
  border-color: rgba(52, 211, 153, 0.3);
  color: #d1fae5;
}

:root.dark .verdict-banner strong,
.dark .verdict-banner strong {
  color: #34d399;
}

:root.dark .response-block,
.dark .response-block {
  background: rgba(15, 23, 42, 0.65);
  border-color: rgba(148, 163, 184, 0.14);
  color: #e2e8f0;
}

:root.dark .response-block :deep(code),
.dark .response-block :deep(code) {
  background: rgba(30, 41, 59, 0.85);
  color: #38bdf8;
}

:root.dark .chat-input-area,
.dark .chat-input-area {
  background: rgba(15, 23, 42, 0.5);
  border-top-color: rgba(148, 163, 184, 0.14);
}

:root.dark .param-chip,
.dark .param-chip {
  background: rgba(30, 41, 59, 0.7);
  border-color: rgba(148, 163, 184, 0.2);
  color: #cbd5e1;
}

:root.dark .param-chip:hover,
.dark .param-chip:hover {
  color: #fff;
  border-color: #38bdf8;
  background: rgba(56, 189, 248, 0.15);
}

:root.dark .param-chip.active,
.dark .param-chip.active {
  color: #2dd4bf;
  background: rgba(45, 212, 191, 0.16);
  border-color: rgba(45, 212, 191, 0.5);
}

:root.dark .input-wrapper,
.dark .input-wrapper {
  background: rgba(15, 23, 42, 0.85);
  border-color: rgba(148, 163, 184, 0.25);
}

:root.dark .input-wrapper:focus-within,
:root.dark .input-wrapper.prefilled-highlight,
.dark .input-wrapper:focus-within,
.dark .input-wrapper.prefilled-highlight {
  border-color: #38bdf8;
  box-shadow: 0 0 0 3px rgba(56, 189, 248, 0.18);
}

:root.dark #input,
.dark #input {
  color: #f1f5f9;
}

@media (max-width: 960px) {
  .ai-layout {
    grid-template-columns: 1fr;
  }
  .mcp-client-tabs {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}
</style>
