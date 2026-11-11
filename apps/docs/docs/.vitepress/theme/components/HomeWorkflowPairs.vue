<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref } from "vue";
import type { IconName } from "../data/icons";
import {
  compileTargetToSource,
  compileWorkflowPair,
  inspectPairSemanticEnvelope,
  type WorkflowConflictStrategy,
  type WorkflowEnvelopeInfo,
} from "../util/workflow-compiler";
import {
  highlightWorkflowCode,
  lintWorkflowCode,
  type WorkflowDiagnostic,
} from "../util/workflow-highlighter";
import type { WorkflowMonacoInstance } from "../util/workflow-monaco";
import MsIcon from "./MsIcon.vue";

interface WorkflowPair {
  id: string;
  sourceFmt: string;
  targetFmt: string;
  domain: string;
  accent: string;
  icon: IconName;
  title: string;
  description: string;
  command: string;
  sourceFileName: string;
  sourceLang: string;
  sourceCode: string;
  targetFileName: string;
  targetLang: string;
  targetCode: string;
  bidirectional?: boolean;
  badges: string[];
  docLink: string;
}

const pairs: WorkflowPair[] = [
  {
    id: "reqif-sysml",
    sourceFmt: "ReqIF",
    targetFmt: "SysML v2",
    domain: "Requirements & Architecture",
    accent: "#6366f1",
    icon: "layers",
    title: "Requirements Contracts to SysML v2 Architecture",
    description:
      "Translate OMG ReqIF 1.2 requirement hierarchies from DOORS, Polarion, and Teamcenter directly into textual SysML v2 requirement definitions and satisfaction relations.",
    command: "msx reqif to-sysml Specs.reqif --out=Specs.sysml",
    sourceFileName: "Specs.reqif",
    sourceLang: "xml",
    sourceCode: `<SPEC-OBJECT IDENTIFIER="REQ-BRAKE-01" LONG-NAME="Braking Distance">
  <VALUES>
    <ATTRIBUTE-VALUE-STRING>
      <THE-VALUE>Vehicle braking_distance must be &lt;= 35 m. ASIL-D.</THE-VALUE>
    </ATTRIBUTE-VALUE-STRING>
  </VALUES>
</SPEC-OBJECT>`,
    targetFileName: "Specs.sysml",
    targetLang: "sysml",
    targetCode: `requirement def REQ_BRAKE_01_Def {
  doc /* Vehicle braking_distance must be <= 35 m. ASIL-D. */
  attribute asilLevel : String = "ASIL-D";
  attribute braking_distance : Scalar;
  require constraint { braking_distance <= 35 }
}
requirement REQ_BRAKE_01 : REQ_BRAKE_01_Def;`,
    bidirectional: true,
    badges: ["OMG ReqIF 1.2", "DOORS & Polarion", "SysML v2 RequirementDef", "Lossless Relations"],
    docLink: "/languages/reqif",
  },
  {
    id: "simulink-modelica",
    sourceFmt: "Simulink",
    targetFmt: "Modelica",
    domain: "Controls & Automotive",
    accent: "#0284c7",
    icon: "workflow",
    title: "Proprietary Block Diagrams to Open DAEs",
    description:
      "Liberate vendor-locked MathWorks Simulink block diagrams into open, portable Modelica equations. Retain discrete states, continuous transfer functions, and bus routing without runtime license servers.",
    command: "msx simulink to-modelica SuspensionControl.slx --out=Suspension.mo",
    sourceFileName: "SuspensionControl.slx (blockDiagram.xml)",
    sourceLang: "xml",
    sourceCode: `<System Name="SuspensionControl">
  <Block BlockType="Inport" Name="DamperError"/>
  <Block BlockType="DiscreteFilter" Name="LeadLag">
    <P Name="Numerator">[0.1, -0.09]</P>
    <P Name="Denominator">[1.0, -0.95]</P>
    <P Name="SampleTime">0.001</P>
  </Block>
  <Block BlockType="Outport" Name="ActuatorCmd"/>
  <Line><P Name="Src">DamperError#out:1</P><P Name="Dst">LeadLag#in:1</P></Line>
  <Line><P Name="Src">LeadLag#out:1</P><P Name="Dst">ActuatorCmd#in:1</P></Line>
</System>`,
    targetFileName: "Suspension.mo",
    targetLang: "modelica",
    targetCode: `model SuspensionControl
  Modelica.Blocks.Interfaces.RealInput DamperError;
  Modelica.Blocks.Discrete.TransferFunction LeadLag(b={0.1, -0.09}, a={1, -0.95}, samplePeriod=0.001);
  Modelica.Blocks.Interfaces.RealOutput ActuatorCmd;
equation
  connect(DamperError.y, LeadLag.u);
  connect(LeadLag.y, ActuatorCmd.inPort);
end SuspensionControl;`,
    bidirectional: true,
    badges: ["Zero License Server", "Deterministic DAE", "Lossless AST Lowering", "SUNDIALS Solvers"],
    docLink: "/languages/simulink",
  },
  {
    id: "autosar-sysml",
    sourceFmt: "AUTOSAR",
    targetFmt: "SysML v2",
    domain: "Automotive & Embedded",
    accent: "#10b981",
    icon: "cpu",
    title: "ECU Software Components to Virtual Vehicles",
    description:
      "Extract AUTOSAR Classic and Adaptive XML software components, client-server interfaces, and runnables into SysML v2 internal block diagrams for end-to-end hardware-in-the-loop (HIL) integration.",
    command: "msx autosar to-sysml SteeringController.arxml --out=Steering.sysml",
    sourceFileName: "SteeringController.arxml",
    sourceLang: "xml",
    sourceCode: `<APPLICATION-SW-COMPONENT-TYPE>
  <SHORT-NAME>SteeringController</SHORT-NAME>
  <PORTS>
    <R-PORT-PROTOTYPE><SHORT-NAME>WheelAngleReq</SHORT-NAME></R-PORT-PROTOTYPE>
    <P-PORT-PROTOTYPE><SHORT-NAME>MotorTorqueCmd</SHORT-NAME></P-PORT-PROTOTYPE>
  </PORTS>
  <INTERNAL-BEHAVIORS>
    <SWC-INTERNAL-BEHAVIOR>
      <SHORT-NAME>Steering_IB</SHORT-NAME>
      <RUNNABLES>
        <RUNNABLE-ENTITY><SHORT-NAME>RE_ComputeTorque</SHORT-NAME></RUNNABLE-ENTITY>
      </RUNNABLES>
    </SWC-INTERNAL-BEHAVIOR>
  </INTERNAL-BEHAVIORS>
</APPLICATION-SW-COMPONENT-TYPE>`,
    targetFileName: "Steering.sysml",
    targetLang: "sysml",
    targetCode: `package AutosarArchitecture {
  part def SteeringController {
    in port WheelAngleReq;
    out port MotorTorqueCmd;
    action RE_ComputeTorque;
  }
}`,
    bidirectional: true,
    badges: ["ISO 26262 ASIL-D", "ARXML Metamodel", "HIL Interoperability", "Client-Server Sync"],
    docLink: "/languages/autosar",
  },
  {
    id: "urdf-modelica",
    sourceFmt: "URDF",
    targetFmt: "Modelica",
    domain: "Robotics & Spatial",
    accent: "#f59e0b",
    icon: "bot",
    title: "Kinematic Trees to Multi-Body Dynamics",
    description:
      "Project robot kinematics, joint limits, and inertia tensors from ROS URDF into analytical Modelica.Mechanics.MultiBody models and Recursive Newton-Euler (RNEA) inverse dynamics.",
    command: "msx urdf to-modelica Arm6DOF.urdf --out=Arm6DOF.mo",
    sourceFileName: "Arm6DOF.urdf",
    sourceLang: "xml",
    sourceCode: `<robot name="Arm6DOF">
  <link name="upper_arm"><inertial><mass value="4.2"/></inertial></link>
  <link name="forearm"><inertial><mass value="2.1"/></inertial></link>
  <joint name="elbow_flex" type="revolute">
    <parent link="upper_arm"/>
    <child link="forearm"/>
    <axis xyz="0 1 0"/>
    <limit lower="-2.09" upper="2.09" effort="150" velocity="3.14"/>
  </joint>
</robot>`,
    targetFileName: "Arm6DOF.mo",
    targetLang: "modelica",
    targetCode: `  Parts.Body upper_arm(m = 4.2, I_11 = 0.42, I_22 = 0.42, I_33 = 0.42);
  Parts.Body forearm(m = 2.1, I_11 = 0.21, I_22 = 0.21, I_33 = 0.21);
  Joints.Revolute elbow_flex(n = {0, 1, 0});
equation
  connect(world.frame_b, upper_arm.frame_a);
  connect(upper_arm.frame_b, elbow_flex.frame_a);
  connect(elbow_flex.frame_b, forearm.frame_a);`,
    bidirectional: true,
    badges: ["RNEA Inverse Dynamics", "MultiBody Projection", "ROS/ROS2 Kinematics", "OpenUSD Export Ready"],
    docLink: "/languages/urdf",
  },
  {
    id: "pscad-ieee",
    sourceFmt: "PSCAD",
    targetFmt: "IEEE 2800",
    domain: "Power & Renewables",
    accent: "#ec4899",
    icon: "zap",
    title: "Power Grid EMT to Grid-Code Compliance",
    description:
      "Simulate PSCAD electromagnetic transient (EMT) circuit schemes and automate IEEE 2800-2022 Clause 7.2 Low-Voltage Ride-Through (LVRT) compliance checks on solar and wind interconnection plants.",
    command: "msx pscad verify-ieee2800 SolarPlant_250MW.pscx --tstop 0.25 --step 20us",
    sourceFileName: "SolarPlant_250MW.pscx",
    sourceLang: "xml",
    sourceCode: `<project name="SolarPlant_250MW" version="5.0">
  <Bus name="POI" id="B1" vbase="34.5"/>
  <Component name="PV_Array_Inverter" defn="ibr" id="4521">
    <param name="V_nom" value="34.5"/>
    <param name="P_rated" value="250.0"/>
    <param name="LVRT_mode" value="IEEE2800_Standard"/>
  </Component>
</project>`,
    targetFileName: "IEEE 2800-2022 Clause 7.2 Report",
    targetLang: "text",
    targetCode: `IEEE 2800-2022 Interconnection Verification Report for 'SolarPlant_250MW':
  Overall Result: [PASS]
  • [PASS] Clause 5.3.2 (Low-Voltage Ride-Through (LVRT)): No trip or cessation [Limit: Continuous operation during 0.05 pu sag]
  • [PASS] Clause 5.4.1 (Reactive Current Injection Step Response): T_step <= 50 ms [Limit: Fast reactive current injection (T_90% <= 50 ms)]
  • [PASS] Clause 7.2.2.3.5 (Post-Fault Active Power Recovery): I_post / I_pre = 100.0% [Limit: >= 90.0% recovery within 1.0 s of fault clearing]`,
    bidirectional: true,
    badges: ["IEEE 2800-2022", "Clause 7.2 LVRT", "Microsecond EMT Solver", "Modelica & SSP Export"],
    docLink: "/languages/pscad",
  },
  {
    id: "sysml-ssp",
    sourceFmt: "SysML v2 & Modelica",
    targetFmt: "FMI 3.0 & SSP",
    domain: "Simulation Exchange",
    accent: "#8b5cf6",
    icon: "cube",
    title: "Multi-Domain Models to Zero-Install Containers",
    description:
      "Compile multi-physics Modelica models into FMI 3.0 Co-Simulation FMUs with embedded WebAssembly binaries and export SysML v2 architectures into Prostep SSP (SystemStructure.ssd) archives.",
    command: "msx fmu DC_Motor motor.mo --fmi-version 3 --type cs --wasm --output DC_Motor.fmu",
    sourceFileName: "motor.mo",
    sourceLang: "modelica",
    sourceCode: `model DC_Motor
  parameter Real R = 0.5 "Armature resistance (Ohm)";
  parameter Real Ke = 0.08 "Back-EMF constant (V.s/rad)";
  input Real v_in;
  output Real omega(start = 0.0);
equation
  der(omega) = (Ke * (v_in - Ke * omega) / R - 0.01 * omega) / 0.002;
end DC_Motor;`,
    targetFileName: "DC_Motor.fmu (modelDescription.xml)",
    targetLang: "xml",
    targetCode: `<fmiModelDescription fmiVersion="3.0" modelName="DC_Motor">
  <CoSimulation modelIdentifier="DC_Motor"
                canHandleVariableCommunicationStepSize="true"/>
  <ModelVariables>
    <Float64 name="v_in" valueReference="2" causality="input" variability="continuous" start="0"/>
    <Float64 name="omega" valueReference="3" causality="output" variability="continuous" initial="calculated" start="0" derivative="4"/>
  </ModelVariables>
</fmiModelDescription>`,
    bidirectional: true,
    badges: ["FMI 2.0 / 3.0", "Prostep SSP 1.0", "Embedded WebAssembly", "Air-Gapped Container"],
    docLink: "/languages/ssp",
  },
];

const activeIndex = ref(0);
const interacted = ref(false);
const paused = ref(false);
const copied = ref(false);
const tabRefs = ref<HTMLButtonElement[]>([]);
let timer: ReturnType<typeof setInterval> | undefined;

const current = ref<WorkflowPair>(pairs[0]!);
const liveSourceCode = ref<string>(pairs[0]!.sourceCode);
const liveTargetCode = ref<string>(pairs[0]!.targetCode);
const compileError = ref<string | null>(null);
const compileElapsedMs = ref<number>(0.2);
const conflictStrategy = ref<WorkflowConflictStrategy>("target-wins");
const showEnvelopeInspector = ref<boolean>(false);
const envelopeInfo = ref<WorkflowEnvelopeInfo>(inspectPairSemanticEnvelope(pairs[0]!.id, "target-wins", 0));

// Two-Prong Editor State: Prong 1 (Read-Only Pre-Computed Syntax + Semantic Tokens) -> Prong 2 (Live Monaco)
const monacoActive = ref<boolean>(false);
const monacoLoading = ref<boolean>(false);
const sourceMonacoContainer = ref<HTMLElement | null>(null);
const targetMonacoContainer = ref<HTMLElement | null>(null);
let sourceMonaco: WorkflowMonacoInstance | null = null;
let targetMonaco: WorkflowMonacoInstance | null = null;
let themeObserver: MutationObserver | null = null;

const strategies: { id: WorkflowConflictStrategy; label: string; hint: string }[] = [
  { id: "target-wins", label: "Target Wins", hint: "Target edits overwrite source properties" },
  { id: "source-wins", label: "Source Wins", hint: "Source baseline retains authority on conflicts" },
  { id: "physics-simplex", label: "Physics Simplex", hint: "Bounded consensus within physical feasibility envelope" },
];

// Per-pair edited state cache so switching tabs preserves user edits
const pairSourceState = new Map<string, string>();
const pairTargetState = new Map<string, string>();

const isModified = computed(() => {
  return (
    liveSourceCode.value !== current.value.sourceCode ||
    liveTargetCode.value !== current.value.targetCode
  );
});

const highlightedSourceLines = computed(() =>
  highlightWorkflowCode(liveSourceCode.value, current.value.sourceLang),
);

const highlightedTargetLines = computed(() =>
  highlightWorkflowCode(liveTargetCode.value, current.value.targetLang),
);

const sourceDiagnostics = computed<WorkflowDiagnostic[]>(() =>
  lintWorkflowCode(current.value.id, "source", liveSourceCode.value),
);

const targetDiagnostics = computed<WorkflowDiagnostic[]>(() =>
  lintWorkflowCode(current.value.id, "target", liveTargetCode.value),
);

const allDiagnostics = computed(() => [
  ...sourceDiagnostics.value.map((d) => ({ ...d, pane: current.value.sourceFmt })),
  ...targetDiagnostics.value.map((d) => ({ ...d, pane: current.value.targetFmt })),
]);

function isSyntaxOrStructuralError(d: WorkflowDiagnostic): boolean {
  return (
    d.severity === "error" &&
    !d.code.startsWith("TGG-PHYS-") &&
    d.code !== "M3001"
  );
}

function syncMonacoDiagnostics(): void {
  if (sourceMonaco) {
    sourceMonaco.setDiagnostics(sourceDiagnostics.value);
  }
  if (targetMonaco) {
    targetMonaco.setDiagnostics(targetDiagnostics.value);
  }
}

function runForwardCompile(): void {
  pairSourceState.set(current.value.id, liveSourceCode.value);
  const syntaxErr = sourceDiagnostics.value.find(isSyntaxOrStructuralError);
  if (syntaxErr) {
    compileError.value = `[${syntaxErr.code}] (Line ${syntaxErr.startLine}:${syntaxErr.startCol}) ${syntaxErr.message}`;
    syncMonacoDiagnostics();
    return;
  }

  const res = compileWorkflowPair(current.value.id, liveSourceCode.value, conflictStrategy.value);
  compileElapsedMs.value = res.elapsedMs;
  if (res.envelopeInfo) {
    envelopeInfo.value = res.envelopeInfo;
  }
  if (res.error) {
    compileError.value = res.error;
  } else {
    const physErr = sourceDiagnostics.value.find((d) => d.severity === "error");
    compileError.value = physErr
      ? `[${physErr.code}] (Line ${physErr.startLine}:${physErr.startCol}) ${physErr.message}`
      : null;
    liveTargetCode.value = res.code;
    pairTargetState.set(current.value.id, res.code);
    if (targetMonaco) {
      targetMonaco.setValue(res.code);
    }
  }
  syncMonacoDiagnostics();
}

function onSourceCodeEdited(val: string): void {
  interacted.value = true;
  if (timer) clearInterval(timer);
  liveSourceCode.value = val;
  runForwardCompile();
}

function onTargetCodeEdited(val: string): void {
  if (!current.value.bidirectional) return;
  interacted.value = true;
  if (timer) clearInterval(timer);
  liveTargetCode.value = val;
  pairTargetState.set(current.value.id, val);

  const syntaxErr = targetDiagnostics.value.find(isSyntaxOrStructuralError);
  if (syntaxErr) {
    compileError.value = `[${syntaxErr.code}] (Line ${syntaxErr.startLine}:${syntaxErr.startCol}) ${syntaxErr.message}`;
    syncMonacoDiagnostics();
    return;
  }

  const res = compileTargetToSource(current.value.id, val, liveSourceCode.value, conflictStrategy.value);
  compileElapsedMs.value = res.elapsedMs;
  if (res.envelopeInfo) {
    envelopeInfo.value = res.envelopeInfo;
  }
  if (res.error) {
    compileError.value = res.error;
  } else {
    const physErr = targetDiagnostics.value.find((d) => d.severity === "error");
    compileError.value = physErr
      ? `[${physErr.code}] (Line ${physErr.startLine}:${physErr.startCol}) ${physErr.message}`
      : null;
    liveSourceCode.value = res.code;
    pairSourceState.set(current.value.id, res.code);
    if (sourceMonaco) {
      sourceMonaco.setValue(res.code);
    }
  }
  syncMonacoDiagnostics();
}

async function activateMonacoEditors(focusSide: "source" | "target" = "source"): Promise<void> {
  interacted.value = true;
  if (timer) clearInterval(timer);
  if (monacoActive.value || monacoLoading.value) {
    if (focusSide === "source") sourceMonaco?.focus();
    else targetMonaco?.focus();
    return;
  }

  monacoLoading.value = true;
  monacoActive.value = true;
  await nextTick();

  try {
    const { mountWorkflowMonacoPane } = await import("../util/workflow-monaco");
    const isDark =
      typeof document !== "undefined" && document.documentElement.classList.contains("dark");

    if (sourceMonacoContainer.value && !sourceMonaco) {
      sourceMonaco = await mountWorkflowMonacoPane({
        container: sourceMonacoContainer.value,
        initialCode: liveSourceCode.value,
        lang: current.value.sourceLang,
        isDark,
        ariaLabel: `Editable ${current.value.sourceFmt} source code (${current.value.sourceFileName})`,
        onChange: (nextCode) => onSourceCodeEdited(nextCode),
      });
    }

    if (targetMonacoContainer.value && !targetMonaco) {
      targetMonaco = await mountWorkflowMonacoPane({
        container: targetMonacoContainer.value,
        initialCode: liveTargetCode.value,
        lang: current.value.targetLang,
        readOnly: !current.value.bidirectional,
        isDark,
        ariaLabel: `Editable ${current.value.targetFmt} target code (${current.value.targetFileName})`,
        onChange: (nextCode) => onTargetCodeEdited(nextCode),
      });
    }

    syncMonacoDiagnostics();

    if (typeof document !== "undefined" && !themeObserver) {
      themeObserver = new MutationObserver(() => {
        const dark = document.documentElement.classList.contains("dark");
        sourceMonaco?.setTheme(dark);
        targetMonaco?.setTheme(dark);
      });
      themeObserver.observe(document.documentElement, {
        attributes: true,
        attributeFilter: ["class"],
      });
    }

    if (focusSide === "source") sourceMonaco?.focus();
    else targetMonaco?.focus();
  } finally {
    monacoLoading.value = false;
  }
}

function setConflictStrategy(nextStrategy: WorkflowConflictStrategy): void {
  interacted.value = true;
  if (timer) clearInterval(timer);
  conflictStrategy.value = nextStrategy;
  if (liveTargetCode.value !== current.value.targetCode) {
    const res = compileTargetToSource(
      current.value.id,
      liveTargetCode.value,
      current.value.sourceCode,
      nextStrategy,
    );
    compileElapsedMs.value = res.elapsedMs;
    if (res.envelopeInfo) {
      envelopeInfo.value = res.envelopeInfo;
    }
    if (!res.error) {
      compileError.value = null;
      liveSourceCode.value = res.code;
      pairSourceState.set(current.value.id, res.code);
      sourceMonaco?.setValue(res.code);
    }
  } else {
    envelopeInfo.value = inspectPairSemanticEnvelope(current.value.id, nextStrategy, 0);
  }
  syncMonacoDiagnostics();
}

function resetCurrentPair(): void {
  const p = current.value;
  pairSourceState.delete(p.id);
  pairTargetState.delete(p.id);
  liveSourceCode.value = p.sourceCode;
  liveTargetCode.value = p.targetCode;
  compileError.value = null;
  sourceMonaco?.setValue(p.sourceCode);
  targetMonaco?.setValue(p.targetCode);
  runForwardCompile();
}

function loadPairState(p: WorkflowPair): void {
  current.value = p;
  liveSourceCode.value = pairSourceState.get(p.id) ?? p.sourceCode;
  liveTargetCode.value = pairTargetState.get(p.id) ?? p.targetCode;
  compileError.value = null;
  envelopeInfo.value = inspectPairSemanticEnvelope(p.id, conflictStrategy.value, 0);
  if (!pairTargetState.has(p.id)) {
    const res = compileWorkflowPair(p.id, liveSourceCode.value, conflictStrategy.value);
    compileElapsedMs.value = res.elapsedMs;
    if (res.envelopeInfo) {
      envelopeInfo.value = res.envelopeInfo;
    }
    if (!res.error && res.code) {
      liveTargetCode.value = res.code;
    }
  }
  if (sourceMonaco) {
    sourceMonaco.setLanguage(p.sourceLang);
    sourceMonaco.setValue(liveSourceCode.value);
  }
  if (targetMonaco) {
    targetMonaco.setLanguage(p.targetLang);
    targetMonaco.setValue(liveTargetCode.value);
  }
  syncMonacoDiagnostics();
}

function selectPair(index: number): void {
  activeIndex.value = index;
  loadPairState(pairs[index]!);
  interacted.value = true;
  if (timer) clearInterval(timer);
}

function onKeydown(e: KeyboardEvent, index: number): void {
  let next = index;
  if (e.key === "ArrowRight" || e.key === "ArrowDown") {
    next = (index + 1) % pairs.length;
  } else if (e.key === "ArrowLeft" || e.key === "ArrowUp") {
    next = (index - 1 + pairs.length) % pairs.length;
  } else if (e.key === "Home") {
    next = 0;
  } else if (e.key === "End") {
    next = pairs.length - 1;
  } else {
    return;
  }
  e.preventDefault();
  selectPair(next);
  tabRefs.value[next]?.focus();
}

async function copyCommand(): Promise<void> {
  try {
    await navigator.clipboard.writeText(current.value.command);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 1800);
  } catch {
    /* clipboard fallback */
  }
}

onMounted(() => {
  runForwardCompile();
  if (window.matchMedia("(prefers-reduced-motion: reduce)").matches) return;
  timer = setInterval(() => {
    if (!interacted.value && !paused.value && !monacoActive.value) {
      activeIndex.value = (activeIndex.value + 1) % pairs.length;
      loadPairState(pairs[activeIndex.value]!);
    }
  }, 6500);
});

onBeforeUnmount(() => {
  if (timer) clearInterval(timer);
  themeObserver?.disconnect();
  sourceMonaco?.dispose();
  targetMonaco?.dispose();
});
</script>

<template>
  <section
    class="ms-section home-workflow-pairs"
    aria-label="Polyglot Workflow Pairs"
    @mouseenter="paused = true"
    @mouseleave="paused = false"
    @focusin="paused = true"
    @focusout="paused = false"
  >
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">Polyglot Interoperability</span>
        <h2 class="ms-h2">Connect Any Two Engineering Worlds</h2>
        <p class="ms-lead">
          ModelScript eliminates vendor silos with lossless cross-compiler projections. Edit any source model below to
          compile, project, and verify live in your browser across architecture, multi-physics, embedded software, and
          power grids.
        </p>
      </header>

      <!-- Pair Selectors Tablist -->
      <div class="pairs-selector" role="tablist" aria-label="Polyglot workflow pairs">
        <button
          v-for="(p, i) in pairs"
          :key="p.id"
          :id="`workflow-tab-${p.id}`"
          :ref="(el) => { if (el) tabRefs[i] = el as HTMLButtonElement }"
          type="button"
          role="tab"
          class="pair-pill"
          :class="{ active: activeIndex === i, running: activeIndex === i && !interacted && !paused }"
          :aria-selected="activeIndex === i"
          :aria-controls="`workflow-panel-${p.id}`"
          :tabindex="activeIndex === i ? 0 : -1"
          :style="{ '--pair-accent': p.accent }"
          @click="selectPair(i)"
          @keydown="onKeydown($event, i)"
        >
          <span class="pair-pill-domain">{{ p.domain }}</span>
          <div class="pair-pill-bridge">
            <span class="pill-fmt">{{ p.sourceFmt }}</span>
            <span class="pill-arrow"><MsIcon name="arrowRight" :size="12" :stroke="2.5" /></span>
            <span class="pill-fmt">{{ p.targetFmt }}</span>
          </div>
          <span v-if="activeIndex === i && !interacted" class="pair-pill-progress" aria-hidden="true" />
        </button>
      </div>

      <!-- Live Workflow Showcase Panel -->
      <div
        :id="`workflow-panel-${current.id}`"
        role="tabpanel"
        :aria-labelledby="`workflow-tab-${current.id}`"
        class="showcase-card"
        :style="{ '--active-accent': current.accent }"
      >
        <div class="card-glow" aria-hidden="true" />

        <!-- Header: Title, Tags & Docs Link -->
        <div class="card-header">
          <div class="header-left">
            <div class="pair-badge-group">
              <span class="badge-icon"><MsIcon :name="current.icon" :size="20" :duotone="true" /></span>
              <span class="badge-domain">{{ current.domain }}</span>
              <span class="bridge-tag">
                {{ current.sourceFmt }}
                <span class="arrow-icon">{{ current.bidirectional ? "↔" : "→" }}</span>
                {{ current.targetFmt }}
              </span>
              <span class="live-compiler-pill">
                <span class="live-dot" />
                {{ monacoActive ? "Monaco LSP + TGG Lints Active" : "Pre-Computed Semantic Tokens" }}
              </span>
            </div>
            <h3 class="card-title">{{ current.title }}</h3>
          </div>
          <div class="header-actions">
            <button
              v-if="!monacoActive"
              type="button"
              class="activate-monaco-header-btn"
              title="Load interactive Monaco Editor with semantic tokens, hover cards, and live compiler lints"
              @click="activateMonacoEditors('source')"
            >
              <MsIcon name="code" :size="14" />
              <span>Activate Live Monaco Editor</span>
            </button>
            <button
              v-if="isModified"
              type="button"
              class="reset-btn"
              title="Reset snippet to default example"
              @click="resetCurrentPair"
            >
              Reset Example
            </button>
            <a :href="current.docLink" class="docs-link">
              Explore {{ current.sourceFmt }}
              <MsIcon name="arrowRight" :size="14" :stroke="2" />
            </a>
          </div>
        </div>

        <p class="card-description">{{ current.description }}</p>

        <!-- Semantic Envelope & Conflict Resolution Policy Bar -->
        <div class="envelope-toolbar" role="region" aria-label="TGG Semantic Envelope and Conflict Policy">
          <div class="envelope-status-group">
            <span class="envelope-status-pill">
              <MsIcon name="check" :size="12" :stroke="2.5" />
              {{ envelopeInfo.losslessnessStatus }}
            </span>
            <span class="envelope-metric">
              {{ envelopeInfo.ruleCount }} declarative <code>tggRule</code>s
            </span>
            <span class="envelope-metric">
              {{ envelopeInfo.complementFields.length }} shadow complement fields
            </span>
            <span v-if="envelopeInfo.reconciledCount > 0" class="envelope-reconciled-pill">
              {{ envelopeInfo.reconciledCount }} delta{{ envelopeInfo.reconciledCount === 1 ? "" : "s" }} reconciled
            </span>
          </div>

          <div class="envelope-controls-group">
            <div class="strategy-selector" role="group" aria-label="Conflict reconciliation policy">
              <span class="strategy-label">Policy:</span>
              <button
                v-for="s in strategies"
                :key="s.id"
                type="button"
                class="strategy-btn"
                :class="{ active: conflictStrategy === s.id }"
                :title="s.hint"
                @click="setConflictStrategy(s.id)"
              >
                {{ s.label }}
              </button>
            </div>
            <button
              type="button"
              class="inspect-envelope-btn"
              :aria-expanded="showEnvelopeInspector"
              @click="showEnvelopeInspector = !showEnvelopeInspector"
            >
              <MsIcon name="layers" :size="13" />
              <span>{{ showEnvelopeInspector ? "Hide TGG Envelope" : "Inspect TGG Envelope" }}</span>
            </button>
          </div>
        </div>

        <!-- Collapsible Declarative TGG Semantic Envelope Inspector -->
        <div v-if="showEnvelopeInspector" class="envelope-inspector">
          <div class="inspector-head">
            <strong>Declarative TGG Semantic Envelope (`bwd(fwd(s), c) == s`)</strong>
            <span>
              Shared attributes map bijectively; out-of-envelope domain fields are preserved in the shadow complement fiber (<code>tggComplement</code>).
            </span>
          </div>
          <div class="inspector-rules-grid">
            <div v-for="r in envelopeInfo.rules" :key="r.name" class="inspector-rule-card">
              <div class="rule-card-top">
                <code class="rule-name">{{ r.name }}</code>
                <span class="rule-lossless-tag">{{ r.status }}</span>
              </div>
              <div class="rule-pattern-bridge">
                <code>{{ r.sourceKind }}</code>
                <span class="rule-arrow">↔</span>
                <code>{{ r.targetKind }}</code>
              </div>
              <div v-if="r.mappedVars.length" class="rule-meta-row">
                <span class="meta-key">Envelope:</span>
                <code>{{ r.mappedVars.join(", ") }}</code>
              </div>
              <div v-if="r.invertibleLaws.length" class="rule-meta-row">
                <span class="meta-key">Invertible:</span>
                <code>{{ r.invertibleLaws.join(" ; ") }}</code>
              </div>
              <div v-if="r.physicsBounds.length" class="rule-meta-row">
                <span class="meta-key">Physics Bounds:</span>
                <code>{{ r.physicsBounds.join(", ") }}</code>
              </div>
              <div v-if="r.complementFields.length" class="rule-meta-row">
                <span class="meta-key">Complement Fiber:</span>
                <code>[{{ r.complementFields.join(", ") }}]</code>
              </div>
            </div>
          </div>
        </div>

        <!-- Split Projection Two-Prong Editor View -->
        <div class="projection-wrapper">
          <div class="projection-grid">
            <!-- Left: Source File Pane -->
            <div
              class="code-pane source-pane"
              :class="{ 'pane-has-error': sourceDiagnostics.some((d) => d.severity === 'error') }"
            >
              <div class="pane-bar">
                <div class="pane-bar-left">
                  <span class="pane-tag source-tag">Source: {{ current.sourceFmt }}</span>
                  <span class="file-name">{{ current.sourceFileName }}</span>
                </div>
                <div class="pane-bar-right">
                  <span
                    v-if="sourceDiagnostics.length > 0"
                    class="diag-count-badge"
                    :class="sourceDiagnostics.some((d) => d.severity === 'error') ? 'is-error' : 'is-warn'"
                  >
                    {{ sourceDiagnostics.length }} {{ sourceDiagnostics.length === 1 ? "lint" : "lints" }}
                  </span>
                  <span class="editable-badge">
                    {{ monacoActive ? "Monaco Live ↔" : "Syntax + Semantic" }}
                  </span>
                </div>
              </div>

              <!-- Prong 1: Pre-Computed Read-Only Syntax + Semantic Token View -->
              <div
                v-if="!monacoActive"
                class="editor-body static-semantic-view"
                role="button"
                tabindex="0"
                :aria-label="`Click to activate live Monaco editor for ${current.sourceFmt} (${current.sourceFileName})`"
                @click="activateMonacoEditors('source')"
                @keydown.enter.prevent="activateMonacoEditors('source')"
                @keydown.space.prevent="activateMonacoEditors('source')"
              >
                <div class="pane-code semantic-code">
                  <div
                    v-for="(lineHtml, idx) in highlightedSourceLines"
                    :key="idx"
                    class="code-line"
                  >
                    <span class="line-num" aria-hidden="true">{{ idx + 1 }}</span>
                    <span class="line-text" v-html="lineHtml || '&nbsp;'" />
                  </div>
                </div>

                <!-- Translucent Interactive Activation Overlay -->
                <div class="editor-activation-overlay">
                  <div class="overlay-glass-pill">
                    <span class="overlay-icon"><MsIcon name="code" :size="15" /></span>
                    <div class="overlay-text">
                      <span class="overlay-title">Click to Edit Live in Monaco</span>
                      <span class="overlay-sub">Semantic Tokens · Hover Cards · Compiler &amp; TGG Lints</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Prong 2: Full Browser Monaco Editor Container -->
              <div v-else class="editor-body monaco-editor-body">
                <div v-if="monacoLoading" class="monaco-loading-overlay">
                  <span>Loading Monaco Editor &amp; Semantic Tokenizer…</span>
                </div>
                <div ref="sourceMonacoContainer" class="monaco-mount-node" />
              </div>
            </div>

            <!-- Middle: Live Compiler Bridge Indicator -->
            <div class="bridge-indicator">
              <div class="bridge-line" aria-hidden="true" />
              <button
                type="button"
                class="bridge-pill"
                :class="{ 'has-error': Boolean(compileError) || allDiagnostics.some((d) => d.severity === 'error') }"
                title="Run live in-browser compiler projection"
                @click="runForwardCompile"
              >
                <MsIcon name="workflow" :size="18" :duotone="true" />
                <span>msx compile</span>
                <span class="compile-latency">{{ compileError ? "syntax err" : `${compileElapsedMs} ms` }}</span>
              </button>
              <div class="bridge-line" aria-hidden="true" />
            </div>

            <!-- Right: Target File Pane -->
            <div
              class="code-pane target-pane"
              :class="{
                'pane-has-error':
                  Boolean(compileError) || targetDiagnostics.some((d) => d.severity === 'error'),
              }"
            >
              <div class="pane-bar">
                <div class="pane-bar-left">
                  <span class="pane-tag target-tag">Target: {{ current.targetFmt }}</span>
                  <span class="file-name">{{ current.targetFileName }}</span>
                </div>
                <div class="pane-bar-right">
                  <span
                    v-if="targetDiagnostics.length > 0"
                    class="diag-count-badge"
                    :class="targetDiagnostics.some((d) => d.severity === 'error') ? 'is-error' : 'is-warn'"
                  >
                    {{ targetDiagnostics.length }} {{ targetDiagnostics.length === 1 ? "lint" : "lints" }}
                  </span>
                  <span v-if="current.bidirectional" class="editable-badge bidirectional-badge">
                    {{ monacoActive ? "Bidirectional Monaco ↔" : "Bidirectional ↔" }}
                  </span>
                  <span v-else class="live-output-badge">Live Output</span>
                </div>
              </div>

              <div v-if="compileError" class="compile-error-banner" role="alert">
                <strong>Diagnostic:</strong> {{ compileError }}
              </div>

              <!-- Prong 1: Pre-Computed Read-Only Syntax + Semantic Token View -->
              <div
                v-if="!monacoActive"
                class="editor-body static-semantic-view"
                role="button"
                tabindex="0"
                :aria-label="`Click to activate live bidirectional Monaco editor for ${current.targetFmt} (${current.targetFileName})`"
                @click="activateMonacoEditors('target')"
                @keydown.enter.prevent="activateMonacoEditors('target')"
                @keydown.space.prevent="activateMonacoEditors('target')"
              >
                <div class="pane-code semantic-code">
                  <div
                    v-for="(lineHtml, idx) in highlightedTargetLines"
                    :key="idx"
                    class="code-line"
                  >
                    <span class="line-num" aria-hidden="true">{{ idx + 1 }}</span>
                    <span class="line-text" v-html="lineHtml || '&nbsp;'" />
                  </div>
                </div>

                <!-- Translucent Interactive Activation Overlay -->
                <div class="editor-activation-overlay">
                  <div class="overlay-glass-pill">
                    <span class="overlay-icon"><MsIcon name="sparkles" :size="15" /></span>
                    <div class="overlay-text">
                      <span class="overlay-title">Click to Edit Target &amp; Sync Backward ↔</span>
                      <span class="overlay-sub">Bidirectional TGG · Physics Simplex · Live Lints</span>
                    </div>
                  </div>
                </div>
              </div>

              <!-- Prong 2: Full Browser Monaco Editor Container -->
              <div v-else class="editor-body monaco-editor-body">
                <div v-if="monacoLoading" class="monaco-loading-overlay">
                  <span>Loading Monaco Editor &amp; Semantic Tokenizer…</span>
                </div>
                <div ref="targetMonacoContainer" class="monaco-mount-node" />
              </div>
            </div>
          </div>

          <!-- Semantic Token Legend & Live Diagnostics Bar -->
          <div class="semantic-status-strip">
            <div class="semantic-legend-items" aria-label="Semantic token color legend">
              <span class="legend-title">Semantic Tokens:</span>
              <span class="legend-chip"><i class="dot dot-class" />Class / Def</span>
              <span class="legend-chip"><i class="dot dot-param" />Envelope Param</span>
              <span class="legend-chip"><i class="dot dot-port" />Connector / Port</span>
              <span class="legend-chip"><i class="dot dot-state" />State <code>der(x)</code></span>
              <span class="legend-chip"><i class="dot dot-comp" />Subsystem / Action</span>
            </div>
            <div class="diagnostics-summary">
              <span v-if="allDiagnostics.length === 0" class="diag-ok-pill">
                <MsIcon name="check" :size="12" :stroke="2.5" />
                0 Compiler &amp; Physical Envelope Lints
              </span>
              <span v-else class="diag-active-pill">
                {{ allDiagnostics.length }} Active Diagnostic{{ allDiagnostics.length === 1 ? "" : "s" }}
              </span>
            </div>
          </div>

          <!-- Live Compiler & TGG Physical Envelope Diagnostics Tray (when lints exist) -->
          <div v-if="allDiagnostics.length > 0" class="live-diagnostics-tray" role="region" aria-label="Live compiler and TGG envelope diagnostics">
            <div
              v-for="(d, idx) in allDiagnostics"
              :key="`${d.code}-${idx}`"
              class="diag-item"
              :class="`diag-${d.severity}`"
            >
              <span class="diag-badge">{{ d.code }}</span>
              <span class="diag-loc">{{ d.pane }}:{{ d.startLine }}:{{ d.startCol }}</span>
              <span class="diag-msg">{{ d.message }}</span>
            </div>
          </div>
        </div>

        <!-- Terminal Command Bar with Copy Button -->
        <div class="terminal-bar">
          <div class="terminal-prefix">
            <MsIcon name="terminal" :size="16" />
            <span class="t-prompt">$</span>
          </div>
          <code class="terminal-command">{{ current.command }}</code>
          <button
            type="button"
            class="copy-btn"
            :class="{ copied }"
            :aria-label="copied ? 'Copied to clipboard' : 'Copy command'"
            @click="copyCommand"
          >
            <MsIcon :name="copied ? 'check' : 'copy'" :size="15" />
            <span class="copy-label">{{ copied ? "Copied" : "Copy" }}</span>
          </button>
        </div>

        <!-- Badges Strip -->
        <div class="badges-strip">
          <span v-for="b in current.badges" :key="b" class="feature-badge">
            <MsIcon name="check" :size="13" :stroke="2.5" class="badge-check" />
            {{ b }}
          </span>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-workflow-pairs {
  position: relative;
  z-index: 1;
}

/* Pair Tabs */
.pairs-selector {
  display: grid;
  grid-template-columns: repeat(6, 1fr);
  gap: 10px;
  margin-bottom: 24px;
}

.pair-pill {
  display: flex;
  flex-direction: column;
  align-items: flex-start;
  padding: 12px 14px;
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  cursor: pointer;
  text-align: left;
  transition: all 0.2s ease;
  position: relative;
  overflow: hidden;
}

.pair-pill:hover {
  background: var(--ms-surface-hover);
  border-color: color-mix(in srgb, var(--pair-accent) 40%, var(--vp-c-border));
  transform: translateY(-1px);
}

.pair-pill.active {
  background: var(--vp-c-bg);
  border-color: var(--pair-accent);
  box-shadow: 0 4px 16px -4px color-mix(in srgb, var(--pair-accent) 25%, transparent);
}

.pair-pill.active::before {
  content: "";
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  height: 3px;
  background: var(--pair-accent);
}

.pair-pill-domain {
  font-size: 11px;
  font-weight: 500;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-3);
  margin-bottom: 4px;
}

.pair-pill.active .pair-pill-domain {
  color: var(--pair-accent);
}

.pair-pill-bridge {
  display: flex;
  align-items: center;
  gap: 5px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.pill-arrow {
  color: var(--vp-c-text-3);
  display: flex;
  align-items: center;
}

.pair-pill.active .pill-arrow {
  color: var(--pair-accent);
}

.pair-pill-progress {
  position: absolute;
  left: 0;
  bottom: 0;
  height: 2px;
  background: var(--pair-accent);
  opacity: 0.7;
  animation: workflow-progress 6.5s linear forwards;
}

.pair-pill:not(.running) .pair-pill-progress {
  animation-play-state: paused;
}

@keyframes workflow-progress {
  from {
    width: 0%;
  }
  to {
    width: 100%;
  }
}

/* Showcase Card */
.showcase-card {
  position: relative;
  border-radius: 20px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  padding: 32px;
  box-shadow:
    0 1px 3px rgba(0, 0, 0, 0.04),
    0 12px 36px -12px rgba(0, 0, 0, 0.08);
  overflow: hidden;
}

.card-glow {
  position: absolute;
  top: 0;
  right: 15%;
  width: 320px;
  height: 200px;
  background: radial-gradient(ellipse at center, color-mix(in srgb, var(--active-accent) 18%, transparent) 0%, transparent 70%);
  pointer-events: none;
  filter: blur(28px);
}

.card-header {
  display: flex;
  justify-content: space-between;
  align-items: flex-start;
  gap: 16px;
  margin-bottom: 12px;
}

.header-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.pair-badge-group {
  display: flex;
  align-items: center;
  flex-wrap: wrap;
  gap: 10px;
  margin-bottom: 8px;
}

.badge-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--active-accent) 12%, transparent);
  color: var(--active-accent);
}

.badge-domain {
  font-size: 12px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.06em;
  color: var(--active-accent);
}

.bridge-tag {
  font-size: 12px;
  font-weight: 600;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  padding: 2px 8px;
  border-radius: 6px;
  color: var(--vp-c-text-2);
}

.live-compiler-pill {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  font-weight: 600;
  padding: 2px 8px;
  border-radius: 999px;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  color: #10b981;
}

.live-dot {
  width: 6px;
  height: 6px;
  border-radius: 50%;
  background: #10b981;
  box-shadow: 0 0 6px #10b981;
}

.arrow-icon {
  margin: 0 4px;
  color: var(--active-accent);
}

.card-title {
  font-size: 22px;
  font-weight: 700;
  letter-spacing: -0.015em;
  color: var(--vp-c-text-1);
  margin: 0;
}

.activate-monaco-header-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 600;
  color: var(--active-accent);
  padding: 6px 12px;
  border-radius: 8px;
  background: color-mix(in srgb, var(--active-accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--active-accent) 35%, transparent);
  cursor: pointer;
  transition: all 0.15s ease;
}

.activate-monaco-header-btn:hover {
  background: color-mix(in srgb, var(--active-accent) 20%, transparent);
  border-color: var(--active-accent);
  transform: translateY(-1px);
}

.reset-btn {
  display: inline-flex;
  align-items: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  padding: 6px 11px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  cursor: pointer;
  transition: all 0.15s ease;
}

.reset-btn:hover {
  color: var(--vp-c-text-1);
  border-color: var(--active-accent);
}

.docs-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  white-space: nowrap;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  transition: all 0.2s ease;
}

.docs-link:hover {
  background: var(--ms-surface-hover);
  border-color: var(--vp-c-brand-1);
  transform: translateX(2px);
}

.card-description {
  font-size: 14.5px;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 24px;
  max-width: 860px;
}

/* Projection Wrapper & Grid */
.projection-wrapper {
  margin-bottom: 20px;
}

.projection-grid {
  display: grid;
  grid-template-columns: minmax(0, 1fr) auto minmax(0, 1fr);
  gap: 16px;
  align-items: stretch;
  margin-bottom: 10px;
}

.code-pane {
  background: var(--vp-c-bg-alt);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  overflow: hidden;
  display: flex;
  flex-direction: column;
  min-width: 0;
  width: 100%;
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}

.code-pane:focus-within {
  border-color: var(--active-accent);
  box-shadow: 0 0 0 2px color-mix(in srgb, var(--active-accent) 20%, transparent);
}

.code-pane.pane-has-error {
  border-color: rgba(245, 158, 11, 0.55);
}

.pane-bar {
  display: flex;
  justify-content: space-between;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
  border-radius: 11px 11px 0 0;
  font-size: 12px;
}

.pane-bar-left,
.pane-bar-right {
  display: flex;
  align-items: center;
  gap: 8px;
  min-width: 0;
}

.pane-tag {
  font-weight: 600;
  font-size: 11px;
  padding: 2px 7px;
  border-radius: 5px;
  white-space: nowrap;
}

.source-tag {
  background: color-mix(in srgb, var(--active-accent) 15%, transparent);
  color: var(--active-accent);
}

.target-tag {
  background: rgba(16, 185, 129, 0.15);
  color: #10b981;
}

.file-name {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-text-3);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.diag-count-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 999px;
  white-space: nowrap;
}

.diag-count-badge.is-error {
  background: rgba(239, 68, 68, 0.15);
  color: #f87171;
  border: 1px solid rgba(239, 68, 68, 0.35);
}

.diag-count-badge.is-warn {
  background: rgba(245, 158, 11, 0.15);
  color: #fbbf24;
  border: 1px solid rgba(245, 158, 11, 0.35);
}

.editable-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
  background: color-mix(in srgb, var(--active-accent) 12%, transparent);
  color: var(--active-accent);
  border: 1px solid color-mix(in srgb, var(--active-accent) 30%, transparent);
  white-space: nowrap;
}

.bidirectional-badge {
  background: rgba(16, 185, 129, 0.12);
  color: #10b981;
  border-color: rgba(16, 185, 129, 0.3);
}

.live-output-badge {
  font-size: 10.5px;
  font-weight: 600;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--vp-c-bg);
  color: var(--vp-c-text-3);
  border: 1px solid var(--vp-c-divider);
  white-space: nowrap;
}

.compile-error-banner {
  padding: 6px 12px;
  font-size: 11.5px;
  font-family: var(--vp-font-family-mono);
  background: rgba(245, 158, 11, 0.14);
  color: #f59e0b;
  border-bottom: 1px solid rgba(245, 158, 11, 0.3);
}

.editor-body {
  display: flex;
  flex-direction: column;
  flex: 1;
  position: relative;
  min-height: 196px;
  min-width: 0;
  overflow-y: auto;
  overflow-x: hidden;
  scrollbar-width: thin;
  scrollbar-color: color-mix(in srgb, var(--vp-c-text-3) 30%, transparent) transparent;
}

.editor-body::-webkit-scrollbar {
  width: 6px;
  height: 6px;
}

.editor-body::-webkit-scrollbar-thumb {
  background: color-mix(in srgb, var(--vp-c-text-3) 35%, transparent);
  border-radius: 3px;
}

.editor-body::-webkit-scrollbar-track {
  background: transparent;
}

.static-semantic-view {
  cursor: pointer;
  border-radius: 0 0 11px 11px;
}

.pane-code {
  margin: 0;
  padding: 14px 16px 46px 0;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 1.55;
  color: var(--vp-c-text-1);
  overflow-x: hidden;
  overflow-y: visible;
  flex: 1;
  min-width: 0;
  background: transparent;
}

.code-line {
  display: flex;
  align-items: stretch;
  min-width: 0;
  line-height: 1.55;
}

.line-num {
  flex-shrink: 0;
  width: 38px;
  padding: 0 10px 0 12px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.55;
  color: var(--vp-c-text-3);
  opacity: 0.55;
  user-select: none;
  text-align: right;
  border-right: 1px solid var(--vp-c-divider);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 50%, transparent);
}

.line-text {
  flex: 1;
  min-width: 0;
  padding-left: 12px;
  padding-right: 12px;
  white-space: pre-wrap;
  word-break: break-word;
  overflow-wrap: anywhere;
  font-family: var(--vp-font-family-mono);
  font-size: 12.5px;
  line-height: 1.55;
}

/* Prong 1 Pre-Computed Syntax + Semantic Token Colors (Light & Dark Mode) */
.semantic-code :deep(.tok-keyword) {
  color: #7c3aed;
  font-weight: 600;
}

.semantic-code :deep(.tok-type) {
  color: #0284c7;
}

.semantic-code :deep(.tok-builtin) {
  color: #2563eb;
  font-weight: 600;
}

.semantic-code :deep(.tok-semantic-class) {
  color: #0d9488;
  font-weight: 700;
}

.semantic-code :deep(.tok-semantic-param) {
  color: #c2410c;
}

.semantic-code :deep(.tok-semantic-port) {
  color: #0369a1;
}

.semantic-code :deep(.tok-semantic-state) {
  color: #be185d;
  font-style: italic;
}

.semantic-code :deep(.tok-semantic-component) {
  color: #6d28d9;
}

.semantic-code :deep(.tok-tag) {
  color: #be185d;
  font-weight: 600;
}

.semantic-code :deep(.tok-attr-name) {
  color: #1d4ed8;
}

.semantic-code :deep(.tok-attr-val),
.semantic-code :deep(.tok-string) {
  color: #15803d;
}

.semantic-code :deep(.tok-number) {
  color: #b45309;
}

.semantic-code :deep(.tok-comment) {
  color: #64748b;
  font-style: italic;
}

.semantic-code :deep(.tok-op) {
  color: var(--vp-c-text-3);
}

.semantic-code :deep(.tok-pass) {
  color: #059669;
  font-weight: 700;
}

.semantic-code :deep(.tok-fail) {
  color: #dc2626;
  font-weight: 700;
}

:global(.dark) .semantic-code :deep(.tok-keyword) {
  color: #c084fc;
}

:global(.dark) .semantic-code :deep(.tok-type) {
  color: #38bdf8;
}

:global(.dark) .semantic-code :deep(.tok-builtin) {
  color: #60a5fa;
}

:global(.dark) .semantic-code :deep(.tok-semantic-class) {
  color: #2dd4bf;
}

:global(.dark) .semantic-code :deep(.tok-semantic-param) {
  color: #fb923c;
}

:global(.dark) .semantic-code :deep(.tok-semantic-port) {
  color: #38bdf8;
}

:global(.dark) .semantic-code :deep(.tok-semantic-state) {
  color: #f472b6;
}

:global(.dark) .semantic-code :deep(.tok-semantic-component) {
  color: #a78bfa;
}

:global(.dark) .semantic-code :deep(.tok-tag) {
  color: #f472b6;
}

:global(.dark) .semantic-code :deep(.tok-attr-name) {
  color: #93c5fd;
}

:global(.dark) .semantic-code :deep(.tok-attr-val),
:global(.dark) .semantic-code :deep(.tok-string) {
  color: #86efac;
}

:global(.dark) .semantic-code :deep(.tok-number) {
  color: #fbbf24;
}

:global(.dark) .semantic-code :deep(.tok-comment) {
  color: #64748b;
}

:global(.dark) .semantic-code :deep(.tok-pass) {
  color: #34d399;
}

:global(.dark) .semantic-code :deep(.tok-fail) {
  color: #f87171;
}

/* Translucent Activation Overlay over Prong 1 Static Panes */
.editor-activation-overlay {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: flex-end;
  justify-content: center;
  padding: 10px 14px;
  background: linear-gradient(
    to bottom,
    transparent 35%,
    color-mix(in srgb, var(--vp-c-bg-alt) 78%, transparent) 100%
  );
  transition: background 0.2s ease;
  pointer-events: none;
}

.static-semantic-view:hover .editor-activation-overlay,
.static-semantic-view:focus-visible .editor-activation-overlay {
  background: linear-gradient(
    to bottom,
    color-mix(in srgb, var(--active-accent) 5%, transparent) 0%,
    color-mix(in srgb, var(--vp-c-bg-alt) 88%, transparent) 100%
  );
}

.overlay-glass-pill {
  display: inline-flex;
  align-items: center;
  gap: 9px;
  padding: 6px 13px;
  border-radius: 999px;
  background: color-mix(in srgb, var(--vp-c-bg) 82%, transparent);
  backdrop-filter: blur(10px);
  -webkit-backdrop-filter: blur(10px);
  border: 1px solid color-mix(in srgb, var(--active-accent) 42%, var(--vp-c-border));
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.14);
  transition: transform 0.18s ease, border-color 0.18s ease, box-shadow 0.18s ease;
}

.static-semantic-view:hover .overlay-glass-pill,
.static-semantic-view:focus-visible .overlay-glass-pill {
  transform: translateY(-2px);
  border-color: var(--active-accent);
  box-shadow: 0 6px 20px color-mix(in srgb, var(--active-accent) 25%, transparent);
}

.overlay-icon {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
  background: color-mix(in srgb, var(--active-accent) 16%, transparent);
  color: var(--active-accent);
  flex-shrink: 0;
}

.overlay-text {
  display: flex;
  flex-direction: column;
  line-height: 1.25;
}

.overlay-title {
  font-size: 11.5px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.overlay-sub {
  font-size: 10px;
  color: var(--vp-c-text-3);
}

/* Prong 2 Monaco Editor Container */
.monaco-editor-body {
  min-height: 205px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.monaco-mount-node {
  width: 100%;
  height: 205px;
  flex: 1;
}

.monaco-mount-node :deep(.monaco-editor) {
  border-radius: 0 0 11px 11px;
}

.monaco-mount-node :deep(.monaco-editor .suggest-widget),
.monaco-mount-node :deep(.monaco-editor .parameter-hints-widget),
.monaco-mount-node :deep(.monaco-editor .monaco-hover) {
  z-index: 120 !important;
}

.monaco-loading-overlay {
  position: absolute;
  inset: 0;
  z-index: 4;
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, var(--vp-c-bg-alt) 85%, transparent);
  backdrop-filter: blur(4px);
}

/* Semantic Token Legend & Diagnostics Summary Strip */
.semantic-status-strip {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 6px 12px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  font-size: 11px;
}

.semantic-legend-items {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
  color: var(--vp-c-text-2);
}

.legend-title {
  font-weight: 600;
  color: var(--vp-c-text-3);
}

.legend-chip {
  display: inline-flex;
  align-items: center;
  gap: 5px;
}

.legend-chip code {
  font-size: 10px;
  padding: 0 3px;
  border-radius: 3px;
  background: var(--vp-c-bg);
}

.dot {
  width: 7px;
  height: 7px;
  border-radius: 50%;
  display: inline-block;
}

.dot-class {
  background: #2dd4bf;
}

.dot-param {
  background: #fb923c;
}

.dot-port {
  background: #38bdf8;
}

.dot-state {
  background: #f472b6;
}

.dot-comp {
  background: #a78bfa;
}

.diag-ok-pill {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: #10b981;
}

.diag-active-pill {
  font-weight: 700;
  color: #f59e0b;
}

/* Live Compiler & TGG Envelope Diagnostics Tray */
.live-diagnostics-tray {
  margin-top: 8px;
  padding: 8px 12px;
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  border: 1px solid rgba(245, 158, 11, 0.35);
  display: flex;
  flex-direction: column;
  gap: 5px;
}

.diag-item {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 11.5px;
  font-family: var(--vp-font-family-mono);
  line-height: 1.45;
}

.diag-badge {
  font-size: 10px;
  font-weight: 700;
  padding: 1px 6px;
  border-radius: 4px;
  flex-shrink: 0;
}

.diag-error .diag-badge {
  background: rgba(239, 68, 68, 0.16);
  color: #f87171;
}

.diag-warning .diag-badge {
  background: rgba(245, 158, 11, 0.16);
  color: #fbbf24;
}

.diag-loc {
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.diag-msg {
  color: var(--vp-c-text-1);
}

/* Bridge Connector */
.bridge-indicator {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  padding: 0 4px;
}

.bridge-line {
  flex: 1;
  width: 2px;
  background: repeating-linear-gradient(
    to bottom,
    var(--vp-c-divider) 0px,
    var(--vp-c-divider) 4px,
    transparent 4px,
    transparent 8px
  );
}

.bridge-pill {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 3px;
  padding: 8px 8px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.06);
  color: var(--active-accent);
  font-size: 10px;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  white-space: nowrap;
  cursor: pointer;
  transition: all 0.15s ease;
}

.bridge-pill:hover {
  border-color: var(--active-accent);
  transform: scale(1.03);
}

.bridge-pill.has-error {
  border-color: #f59e0b;
  color: #f59e0b;
}

.compile-latency {
  font-size: 9.5px;
  color: #10b981;
  font-weight: 500;
}

.bridge-pill.has-error .compile-latency {
  color: #f59e0b;
}

/* Terminal Bar */
.terminal-bar {
  display: flex;
  align-items: center;
  background: #090d16;
  border: 1px solid rgba(255, 255, 255, 0.08);
  border-radius: 10px;
  padding: 10px 14px;
  gap: 10px;
  margin-bottom: 20px;
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.terminal-prefix {
  display: flex;
  align-items: center;
  gap: 6px;
  color: #64748b;
  flex-shrink: 0;
}

.t-prompt {
  color: #38bdf8;
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  font-size: 13px;
}

.terminal-command {
  flex: 1;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: #e2e8f0;
  overflow-x: auto;
  white-space: nowrap;
}

.copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  border-radius: 6px;
  background: rgba(255, 255, 255, 0.08);
  border: 1px solid rgba(255, 255, 255, 0.12);
  color: #94a3b8;
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: all 0.15s ease;
  flex-shrink: 0;
}

.copy-btn:hover {
  background: rgba(255, 255, 255, 0.15);
  color: #ffffff;
}

.copy-btn.copied {
  background: rgba(16, 185, 129, 0.2);
  border-color: rgba(16, 185, 129, 0.5);
  color: #34d399;
}

/* Badges Strip */
.badges-strip {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.feature-badge {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  padding: 4px 10px;
  border-radius: 6px;
}

.badge-check {
  color: #10b981;
}

/* Semantic Envelope Toolbar & Inspector Drawer */
.envelope-toolbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 8px 12px;
  margin-bottom: 14px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
}

.envelope-status-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.envelope-status-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.03em;
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  border: 1px solid rgba(16, 185, 129, 0.3);
  padding: 3px 8px;
  border-radius: 999px;
}

.envelope-metric {
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.envelope-metric code {
  font-size: 11px;
  padding: 1px 4px;
  border-radius: 4px;
  background: var(--vp-c-bg);
}

.envelope-reconciled-pill {
  font-size: 11px;
  font-weight: 600;
  color: var(--active-accent);
  background: color-mix(in srgb, var(--active-accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--active-accent) 35%, transparent);
  padding: 2px 8px;
  border-radius: 999px;
}

.envelope-controls-group {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.strategy-selector {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  padding: 2px 4px;
  border-radius: 8px;
}

.strategy-label {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  padding: 0 4px;
}

.strategy-btn {
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  padding: 3px 7px;
  border-radius: 6px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.strategy-btn:hover {
  color: var(--vp-c-text-1);
}

.strategy-btn.active {
  color: #ffffff;
  background: var(--active-accent);
}

.inspect-envelope-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  padding: 4px 10px;
  border-radius: 8px;
  cursor: pointer;
  transition: all 0.15s ease;
}

.inspect-envelope-btn:hover {
  border-color: var(--active-accent);
  color: var(--active-accent);
}

.envelope-inspector {
  margin-bottom: 16px;
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--vp-c-bg-soft);
  border: 1px solid color-mix(in srgb, var(--active-accent) 35%, var(--vp-c-border));
}

.inspector-head {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 10px;
  font-size: 12px;
  color: var(--vp-c-text-2);
}

.inspector-head strong {
  color: var(--vp-c-text-1);
}

.inspector-rules-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(260px, 1fr));
  gap: 8px;
}

.inspector-rule-card {
  padding: 8px 10px;
  border-radius: 8px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  font-size: 11px;
}

.rule-card-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 6px;
  margin-bottom: 4px;
}

.rule-name {
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.rule-lossless-tag {
  font-size: 9px;
  font-weight: 700;
  color: #10b981;
  background: rgba(16, 185, 129, 0.12);
  padding: 1px 5px;
  border-radius: 4px;
}

.rule-pattern-bridge {
  display: flex;
  align-items: center;
  gap: 6px;
  margin-bottom: 4px;
  color: var(--active-accent);
}

.rule-meta-row {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  color: var(--vp-c-text-2);
  line-height: 1.4;
}

.meta-key {
  font-weight: 600;
  color: var(--vp-c-text-3);
}

/* Responsive adjustments */
@media (max-width: 1024px) {
  .pairs-selector {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 768px) {
  .pairs-selector {
    grid-template-columns: repeat(2, 1fr);
  }

  .projection-grid {
    grid-template-columns: 1fr;
  }

  .bridge-indicator {
    flex-direction: row;
    padding: 8px 0;
  }

  .bridge-line {
    width: 100%;
    height: 2px;
  }

  .card-header {
    flex-direction: column;
    align-items: flex-start;
  }

  .header-actions {
    width: 100%;
  }

  .docs-link {
    flex: 1;
    justify-content: center;
  }
}

@media (max-width: 480px) {
  .pairs-selector {
    grid-template-columns: repeat(1, 1fr);
  }
}
</style>
