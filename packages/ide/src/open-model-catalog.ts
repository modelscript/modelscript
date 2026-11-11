// SPDX-License-Identifier: AGPL-3.0-or-later

import type { HubDomainId } from "./component-hub-catalog.js";

export interface HubOpenModelItem {
  id: string;
  title: string;
  /** Optional canonical library FQN (resolved via getClassLocation / getClassSource / getDiagramPreviewSvgs when mounted). */
  fqn?: string | undefined;
  dialect: string;
  dialectLabel: string;
  category: Exclude<HubDomainId, "all">;
  packageName: string;
  packageVersion: string;
  /** True if package is mounted by default (e.g. Modelica Standard Library / SysML stdlib). */
  bundledByDefault?: boolean | undefined;
  summary: string;
  nodeCount: number;
  edgeCount: number;
  keywords: string[];
  /** Multi-node connected schematic diagram SVG (`viewBox="0 0 280 156"`), upgraded live via `getDiagramPreviewSvgs`. */
  diagramSvg: string;
  /** Self-contained runnable source fallback so opening works instantaneously in memfs/workspace. */
  fallbackCode: string;
  suggestedFilename: string;
}

const DIAG_ATTRS =
  'xmlns="http://www.w3.org/2000/svg" viewBox="0 0 280 156" width="100%" height="100%" preserveAspectRatio="xMidYMid meet" fill="none"';

export const HUB_CURATED_OPEN_MODELS: HubOpenModelItem[] = [
  // ── ELECTRICAL ──────────────────────────────────────────────────────
  {
    id: "chua-circuit",
    title: "Chua's Chaotic Circuit",
    fqn: "Modelica.Electrical.Analog.Examples.ChuaCircuit",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "electrical",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "Canonical autonomous chaotic oscillator combining linear LC resonator stages with a piecewise-linear negative-resistance Chua diode.",
    nodeCount: 6,
    edgeCount: 8,
    keywords: ["chua", "chaos", "attractor", "oscillator", "nonlinear", "rlc", "analog", "circuit"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <path d="M36 34 H234 M36 118 H234" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="36" y1="34" x2="36" y2="54" stroke="#2563eb" stroke-width="1.8"/>
      <path d="M36 54 A7 6 0 0 1 36 66 A7 6 0 0 1 36 78 A7 6 0 0 1 36 90 A7 6 0 0 1 36 102" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="36" y1="102" x2="36" y2="118" stroke="#2563eb" stroke-width="1.8"/>
      <text x="14" y="81" font-size="9.5" font-weight="600" fill="#475569" font-family="Inter,sans-serif">L</text>
      <rect x="74" y="26" width="38" height="16" rx="2" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.8"/>
      <text x="86" y="37" font-size="9" font-weight="700" fill="#1e3a8a" font-family="Inter,sans-serif">G</text>
      <line x1="60" y1="34" x2="60" y2="70" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="49" y1="70" x2="71" y2="70" stroke="#1d4ed8" stroke-width="2.3"/>
      <line x1="49" y1="78" x2="71" y2="78" stroke="#1d4ed8" stroke-width="2.3"/>
      <line x1="60" y1="78" x2="60" y2="118" stroke="#2563eb" stroke-width="1.8"/>
      <text x="66" y="94" font-size="9" font-weight="600" fill="#475569" font-family="Inter,sans-serif">C2</text>
      <line x1="154" y1="34" x2="154" y2="70" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="143" y1="70" x2="165" y2="70" stroke="#1d4ed8" stroke-width="2.3"/>
      <line x1="143" y1="78" x2="165" y2="78" stroke="#1d4ed8" stroke-width="2.3"/>
      <line x1="154" y1="78" x2="154" y2="118" stroke="#2563eb" stroke-width="1.8"/>
      <text x="160" y="94" font-size="9" font-weight="600" fill="#475569" font-family="Inter,sans-serif">C1</text>
      <rect x="216" y="54" width="36" height="44" rx="4" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.9"/>
      <path d="M222 86 L229 80 L239 72 L246 66" stroke="#dc2626" stroke-width="2" stroke-linecap="round"/>
      <text x="226" y="48" font-size="9" font-weight="700" fill="#1e3a8a" font-family="Inter,sans-serif">Nr</text>
      <line x1="234" y1="34" x2="234" y2="54" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="234" y1="98" x2="234" y2="118" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="135" y1="118" x2="135" y2="132" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="123" y1="132" x2="147" y2="132" stroke="#1e293b" stroke-width="2"/>
      <line x1="127" y1="137" x2="143" y2="137" stroke="#1e293b" stroke-width="1.7"/>
      <line x1="131" y1="142" x2="139" y2="142" stroke="#1e293b" stroke-width="1.5"/>
      <circle cx="60" cy="34" r="2.8" fill="#2563eb"/><circle cx="154" cy="34" r="2.8" fill="#2563eb"/>
      <circle cx="60" cy="118" r="2.8" fill="#2563eb"/><circle cx="154" cy="118" r="2.8" fill="#2563eb"/><circle cx="135" cy="118" r="2.8" fill="#2563eb"/>
    </svg>`,
    suggestedFilename: "ChuaCircuit.mo",
    fallbackCode: `model ChuaCircuit "Chua's chaotic autonomous RLC circuit"
  Modelica.Electrical.Analog.Basic.Inductor L(L = 18) annotation(Placement(transformation(extent={{-80,-12},{-60,8}})));
  Modelica.Electrical.Analog.Basic.Resistor Ro(R = 12.5e-3) annotation(Placement(transformation(extent={{-80,-44},{-60,-24}})));
  Modelica.Electrical.Analog.Basic.Conductor G(G = 0.565) annotation(Placement(transformation(extent={{-28,24},{-8,44}})));
  Modelica.Electrical.Analog.Basic.Capacitor C1(C = 10, v(start = 4, fixed = true)) annotation(Placement(transformation(extent={{18,-12},{38,8}})));
  Modelica.Electrical.Analog.Basic.Capacitor C2(C = 100) annotation(Placement(transformation(extent={{-46,-12},{-26,8}})));
  Modelica.Electrical.Analog.Examples.Utilities.NonlinearResistor Nr(
    Ga = -0.757576,
    Gb = -0.409091,
    Ve = 1
  ) annotation(Placement(transformation(extent={{58,-12},{78,8}})));
  Modelica.Electrical.Analog.Basic.Ground Gnd annotation(Placement(transformation(extent={{-12,-66},{8,-46}})));
equation
  connect(L.p, G.p) annotation(Line(points={{-70,8},{-70,34},{-28,34}}, color={0,0,255}));
  connect(C2.p, G.p) annotation(Line(points={{-36,8},{-36,34},{-28,34}}, color={0,0,255}));
  connect(G.n, C1.p) annotation(Line(points={{-8,34},{28,34},{28,8}}, color={0,0,255}));
  connect(Nr.p, C1.p) annotation(Line(points={{68,8},{68,34},{28,34}}, color={0,0,255}));
  connect(L.n, Ro.p) annotation(Line(points={{-70,-12},{-70,-24}}, color={0,0,255}));
  connect(Ro.n, Gnd.p) annotation(Line(points={{-70,-44},{-70,-46},{-2,-46}}, color={0,0,255}));
  connect(C2.n, Gnd.p) annotation(Line(points={{-36,-12},{-36,-46},{-2,-46}}, color={0,0,255}));
  connect(C1.n, Gnd.p) annotation(Line(points={{28,-12},{28,-46},{-2,-46}}, color={0,0,255}));
  connect(Nr.n, Gnd.p) annotation(Line(points={{68,-12},{68,-46},{-2,-46}}, color={0,0,255}));
  annotation(experiment(StopTime = 500, Interval = 0.5));
end ChuaCircuit;
`,
  },

  {
    id: "cauer-lowpass",
    title: "Cauer Low-Pass Ladder Filter",
    fqn: "Modelica.Electrical.Analog.Examples.CauerLowPassAnalog",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "electrical",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "5th-order elliptic LC ladder filter with transmission zeros, source/termination resistors, and step-response excitation.",
    nodeCount: 11,
    edgeCount: 14,
    keywords: ["cauer", "elliptic", "filter", "lowpass", "lc", "ladder", "analog", "rf"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <circle cx="34" cy="78" r="14" fill="#eff6ff" stroke="#1d4ed8" stroke-width="1.8"/>
      <path d="M27 81 H33 V73 H41" stroke="#2563eb" stroke-width="1.6"/>
      <line x1="34" y1="64" x2="34" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="34" y1="92" x2="34" y2="122" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="34" y1="38" x2="56" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <rect x="56" y="31" width="28" height="14" rx="2" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.7"/>
      <text x="64" y="41" font-size="8.5" font-weight="700" fill="#1e3a8a">R1</text>
      <line x1="84" y1="38" x2="108" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <path d="M108 38 A5 5 0 0 1 118 38 A5 5 0 0 1 128 38 A5 5 0 0 1 138 38" stroke="#1d4ed8" stroke-width="2"/>
      <text x="116" y="28" font-size="8.5" font-weight="600" fill="#475569">L1</text>
      <line x1="138" y1="38" x2="168" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <path d="M168 38 A5 5 0 0 1 178 38 A5 5 0 0 1 188 38 A5 5 0 0 1 198 38" stroke="#1d4ed8" stroke-width="2"/>
      <text x="176" y="28" font-size="8.5" font-weight="600" fill="#475569">L2</text>
      <line x1="198" y1="38" x2="242" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="96" y1="38" x2="96" y2="74" stroke="#2563eb" stroke-width="1.7"/>
      <line x1="87" y1="74" x2="105" y2="74" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="87" y1="81" x2="105" y2="81" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="96" y1="81" x2="96" y2="122" stroke="#2563eb" stroke-width="1.7"/>
      <line x1="153" y1="38" x2="153" y2="74" stroke="#2563eb" stroke-width="1.7"/>
      <line x1="144" y1="74" x2="162" y2="74" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="144" y1="81" x2="162" y2="81" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="153" y1="81" x2="153" y2="122" stroke="#2563eb" stroke-width="1.7"/>
      <line x1="210" y1="38" x2="210" y2="74" stroke="#2563eb" stroke-width="1.7"/>
      <line x1="201" y1="74" x2="219" y2="74" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="201" y1="81" x2="219" y2="81" stroke="#1d4ed8" stroke-width="2.1"/>
      <line x1="210" y1="81" x2="210" y2="122" stroke="#2563eb" stroke-width="1.7"/>
      <rect x="235" y="64" width="14" height="32" rx="2" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.7"/>
      <line x1="242" y1="38" x2="242" y2="64" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="242" y1="96" x2="242" y2="122" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="34" y1="122" x2="242" y2="122" stroke="#2563eb" stroke-width="1.8"/>
      <circle cx="96" cy="38" r="2.6" fill="#2563eb"/><circle cx="153" cy="38" r="2.6" fill="#2563eb"/><circle cx="210" cy="38" r="2.6" fill="#2563eb"/>
      <circle cx="96" cy="122" r="2.6" fill="#2563eb"/><circle cx="153" cy="122" r="2.6" fill="#2563eb"/><circle cx="210" cy="122" r="2.6" fill="#2563eb"/>
    </svg>`,
    suggestedFilename: "CauerLowPassAnalog.mo",
    fallbackCode: `model CauerLowPassAnalog "5th-order elliptic Cauer low-pass LC ladder filter"
  Modelica.Electrical.Analog.Sources.StepVoltage V(V = 1, startTime = 1) annotation(Placement(transformation(extent={{-92,-10},{-72,10}}, rotation=270)));
  Modelica.Electrical.Analog.Basic.Resistor R1(R = 1) annotation(Placement(transformation(extent={{-60,24},{-40,44}})));
  Modelica.Electrical.Analog.Basic.Capacitor C1(C = 1.072) annotation(Placement(transformation(extent={{-42,-10},{-22,10}}, rotation=270)));
  Modelica.Electrical.Analog.Basic.Inductor L1(L = 1.304) annotation(Placement(transformation(extent={{-18,24},{2,44}})));
  Modelica.Electrical.Analog.Basic.Capacitor C3(C = 1.682) annotation(Placement(transformation(extent={{4,-10},{24,10}}, rotation=270)));
  Modelica.Electrical.Analog.Basic.Inductor L2(L = 0.8586) annotation(Placement(transformation(extent={{28,24},{48,44}})));
  Modelica.Electrical.Analog.Basic.Capacitor C5(C = 0.7262) annotation(Placement(transformation(extent={{48,-10},{68,10}}, rotation=270)));
  Modelica.Electrical.Analog.Basic.Resistor R2(R = 1) annotation(Placement(transformation(extent={{74,-10},{94,10}}, rotation=270)));
  Modelica.Electrical.Analog.Basic.Ground G annotation(Placement(transformation(extent={{-10,-56},{10,-36}})));
equation
  connect(V.n, R1.p) annotation(Line(points={{-82,10},{-82,34},{-60,34}}, color={0,0,255}));
  connect(R1.n, L1.p) annotation(Line(points={{-40,34},{-18,34}}, color={0,0,255}));
  connect(R1.n, C1.p) annotation(Line(points={{-40,34},{-32,34},{-32,10}}, color={0,0,255}));
  connect(L1.n, L2.p) annotation(Line(points={{2,34},{28,34}}, color={0,0,255}));
  connect(L1.n, C3.p) annotation(Line(points={{2,34},{14,34},{14,10}}, color={0,0,255}));
  connect(L2.n, C5.p) annotation(Line(points={{48,34},{58,34},{58,10}}, color={0,0,255}));
  connect(L2.n, R2.p) annotation(Line(points={{48,34},{84,34},{84,10}}, color={0,0,255}));
  connect(V.p, G.p) annotation(Line(points={{-82,-10},{-82,-36},{0,-36}}, color={0,0,255}));
  connect(C1.n, G.p) annotation(Line(points={{-32,-10},{-32,-36},{0,-36}}, color={0,0,255}));
  connect(C3.n, G.p) annotation(Line(points={{14,-10},{14,-36},{0,-36}}, color={0,0,255}));
  connect(C5.n, G.p) annotation(Line(points={{58,-10},{58,-36},{0,-36}}, color={0,0,255}));
  connect(R2.n, G.p) annotation(Line(points={{84,-10},{84,-36},{0,-36}}, color={0,0,255}));
  annotation(experiment(StopTime = 60));
end CauerLowPassAnalog;
`,
  },

  {
    id: "spice-active-clamp",
    title: "SPICE NMOS Clamp & Op-Amp Buffer",
    fqn: "SPICE.Examples.ActiveClampStage",
    dialect: "modelica",
    dialectLabel: "SPICE · Modelica",
    category: "electrical",
    packageName: "SPICE-Standard",
    packageVersion: "1.0.0",
    bundledByDefault: false,
    summary:
      "Mixed semiconductor switching stage combining an enhancement-mode NMOS switch, 1N4148 clamping diode, and unity-gain LM741 buffer.",
    nodeCount: 3,
    edgeCount: 3,
    keywords: ["spice", "nmos", "mosfet", "1n4148", "lm741", "opamp", "clamp", "semiconductor"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="34" y="64" width="46" height="44" rx="5" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="48" y1="74" x2="48" y2="98" stroke="#1e293b" stroke-width="2.2"/>
      <line x1="54" y1="72" x2="54" y2="100" stroke="#1e293b" stroke-width="2" stroke-dasharray="4 2"/>
      <line x1="54" y1="77" x2="70" y2="77" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="54" y1="95" x2="70" y2="95" stroke="#2563eb" stroke-width="1.8"/>
      <text x="38" y="57" font-size="8.5" font-weight="700" fill="#475569">nmos1</text>
      <line x1="80" y1="77" x2="128" y2="77" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="112" y1="77" x2="112" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="112" y1="38" x2="128" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <polygon points="128,28 148,38 128,48" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.8"/>
      <line x1="148" y1="28" x2="148" y2="48" stroke="#1d4ed8" stroke-width="2.4"/>
      <line x1="148" y1="38" x2="168" y2="38" stroke="#2563eb" stroke-width="1.8"/>
      <text x="122" y="21" font-size="8.5" font-weight="700" fill="#475569">1N4148</text>
      <line x1="128" y1="77" x2="178" y2="88" stroke="#2563eb" stroke-width="1.8"/>
      <polygon points="178,56 234,80 178,104" fill="#eff6ff" stroke="#1d4ed8" stroke-width="2"/>
      <text x="184" y="74" font-size="11" font-weight="700" fill="#dc2626">-</text>
      <text x="183" y="92" font-size="10" font-weight="700" fill="#2563eb">+</text>
      <text x="186" y="117" font-size="8.5" font-weight="700" fill="#475569">LM741</text>
      <path d="M234 80 H252 V46 H164 V70 H178" stroke="#2563eb" stroke-width="1.7"/>
      <circle cx="112" cy="77" r="2.8" fill="#2563eb"/><circle cx="244" cy="80" r="2.8" fill="#2563eb"/>
    </svg>`,
    suggestedFilename: "ActiveClampStage.mo",
    fallbackCode: `within SPICE.Examples;

model ActiveClampStage "NMOS switching stage with 1N4148 clamp diode and LM741 buffer"
  SPICE.Semiconductors.MOSFET_NMOS nmos1(Vth = 1.5) annotation(Placement(transformation(extent={{-68,-14},{-42,14}})));
  SPICE.Semiconductors.Diode1N4148 clampDiode annotation(Placement(transformation(extent={{-10,14},{14,34}})));
  SPICE.OpAmps.LM741 bufferAmp annotation(Placement(transformation(extent={{44,-14},{74,14}})));
equation
  nmos1.s.v = 0;
  nmos1.g.v = 3.3 * sin(62.83 * time);
  clampDiode.n.v = 5.0;
  connect(nmos1.d, clampDiode.p) annotation(Line(points={{-42,8},{-24,8},{-24,24},{-10,24}}, color={37,99,235}));
  connect(nmos1.d, bufferAmp.in_p) annotation(Line(points={{-42,8},{44,-6}}, color={37,99,235}));
  connect(bufferAmp.out, bufferAmp.in_n) annotation(Line(points={{74,0},{86,0},{86,26},{32,26},{32,6},{44,6}}, color={37,99,235}));
end ActiveClampStage;
`,
  },

  // ── MECHANICS ───────────────────────────────────────────────────────
  {
    id: "rotational-drivetrain",
    title: "Compliant Rotational Drivetrain",
    fqn: "Modelica.Mechanics.Rotational.Examples.First",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "mechanics",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "Sine-driven motor torque driving primary inertia through an ideal gear stage, torsional spring-damper shaft, and load flywheel.",
    nodeCount: 7,
    edgeCount: 6,
    keywords: ["rotational", "drivetrain", "gearbox", "inertia", "spring", "damper", "torque", "shaft"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="18" y="66" width="24" height="24" rx="3" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.7"/>
      <path d="M22 78 Q26 68 30 78 T38 78" stroke="#0284c7" stroke-width="1.6"/>
      <line x1="42" y1="78" x2="58" y2="78" stroke="#0369a1" stroke-width="1.8"/>
      <circle cx="70" cy="78" r="12" fill="#f1f5f9" stroke="#334155" stroke-width="2"/>
      <path d="M65 73 A7 7 0 0 1 75 73" stroke="#0891b2" stroke-width="1.8"/>
      <text x="58" y="103" font-size="8" font-weight="600" fill="#475569">torque</text>
      <line x1="82" y1="78" x2="98" y2="78" stroke="#475569" stroke-width="2.4"/>
      <rect x="98" y="60" width="24" height="36" rx="2" fill="#cbd5e1" stroke="#334155" stroke-width="2"/>
      <text x="104" y="54" font-size="8.5" font-weight="700" fill="#334155">J1</text>
      <line x1="122" y1="78" x2="140" y2="78" stroke="#475569" stroke-width="2.4"/>
      <circle cx="148" cy="70" r="8" fill="#e2e8f0" stroke="#1e293b" stroke-width="1.9"/>
      <circle cx="148" cy="87" r="10" fill="#e2e8f0" stroke="#1e293b" stroke-width="1.9"/>
      <text x="138" y="110" font-size="8" font-weight="600" fill="#475569">gear</text>
      <line x1="158" y1="78" x2="174" y2="78" stroke="#475569" stroke-width="2.4"/>
      <path d="M174 78 L180 68 L187 88 L194 68 L201 88 L207 78" stroke="#0891b2" stroke-width="2" stroke-linejoin="round"/>
      <text x="176" y="58" font-size="8" font-weight="600" fill="#475569">spring</text>
      <line x1="207" y1="78" x2="226" y2="78" stroke="#475569" stroke-width="2.4"/>
      <rect x="226" y="56" width="28" height="44" rx="2" fill="#cbd5e1" stroke="#334155" stroke-width="2"/>
      <text x="234" y="50" font-size="8.5" font-weight="700" fill="#334155">J2</text>
    </svg>`,
    suggestedFilename: "RotationalDrivetrain.mo",
    fallbackCode: `model RotationalDrivetrain "Compliant rotational drivetrain with gear ratio and load inertia"
  Modelica.Blocks.Sources.Sine sine(amplitude = 10, f = 2) annotation(Placement(transformation(extent={{-90,-10},{-70,10}})));
  Modelica.Mechanics.Rotational.Sources.Torque torque(useSupport = false) annotation(Placement(transformation(extent={{-54,-10},{-34,10}})));
  Modelica.Mechanics.Rotational.Components.Inertia inertia1(J = 0.1) annotation(Placement(transformation(extent={{-18,-10},{2,10}})));
  Modelica.Mechanics.Rotational.Components.IdealGear gear(ratio = 2, useSupport = false) annotation(Placement(transformation(extent={{18,-10},{38,10}})));
  Modelica.Mechanics.Rotational.Components.SpringDamper shaft(c = 1e4, d = 12) annotation(Placement(transformation(extent={{52,-10},{72,10}})));
  Modelica.Mechanics.Rotational.Components.Inertia load(J = 0.4) annotation(Placement(transformation(extent={{86,-10},{106,10}})));
equation
  connect(sine.y, torque.tau) annotation(Line(points={{-69,0},{-56,0}}, color={0,0,127}));
  connect(torque.flange, inertia1.flange_a) annotation(Line(points={{-34,0},{-18,0}}, color={0,0,0}));
  connect(inertia1.flange_b, gear.flange_a) annotation(Line(points={{2,0},{18,0}}, color={0,0,0}));
  connect(gear.flange_b, shaft.flange_a) annotation(Line(points={{38,0},{52,0}}, color={0,0,0}));
  connect(shaft.flange_b, load.flange_a) annotation(Line(points={{72,0},{86,0}}, color={0,0,0}));
  annotation(experiment(StopTime = 3.0));
end RotationalDrivetrain;
`,
  },

  {
    id: "translational-oscillator",
    title: "Translational Mass-Spring-Damper",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "mechanics",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "1D translational vibration benchmark with fixed ground anchor, parallel spring-damper suspension, sliding mass, and step force.",
    nodeCount: 5,
    edgeCount: 5,
    keywords: ["mass", "spring", "damper", "oscillator", "translational", "vibration", "suspension"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <line x1="34" y1="46" x2="34" y2="110" stroke="#1e293b" stroke-width="3"/>
      <line x1="34" y1="54" x2="22" y2="64" stroke="#64748b" stroke-width="1.8"/>
      <line x1="34" y1="70" x2="22" y2="80" stroke="#64748b" stroke-width="1.8"/>
      <line x1="34" y1="86" x2="22" y2="96" stroke="#64748b" stroke-width="1.8"/>
      <line x1="34" y1="102" x2="22" y2="112" stroke="#64748b" stroke-width="1.8"/>
      <line x1="34" y1="78" x2="64" y2="78" stroke="#0f766e" stroke-width="2"/>
      <line x1="64" y1="56" x2="64" y2="100" stroke="#0f766e" stroke-width="2"/>
      <path d="M64 56 H80 L86 46 L94 66 L102 46 L110 66 L118 46 L124 56 H144" stroke="#0891b2" stroke-width="2" stroke-linejoin="round"/>
      <line x1="64" y1="100" x2="92" y2="100" stroke="#0f766e" stroke-width="2"/>
      <path d="M92 91 H112 V109 H92" stroke="#1e293b" stroke-width="2"/>
      <line x1="104" y1="94" x2="104" y2="106" stroke="#0891b2" stroke-width="2.4"/>
      <line x1="104" y1="100" x2="144" y2="100" stroke="#0f766e" stroke-width="2"/>
      <line x1="144" y1="56" x2="144" y2="100" stroke="#0f766e" stroke-width="2"/>
      <line x1="144" y1="78" x2="168" y2="78" stroke="#0f766e" stroke-width="2"/>
      <rect x="168" y="54" width="52" height="48" rx="4" fill="#ccfbf1" stroke="#0f766e" stroke-width="2.1"/>
      <text x="181" y="82" font-size="10.5" font-weight="700" fill="#134e4a">m = 2kg</text>
      <path d="M254 78 H224" stroke="#dc2626" stroke-width="2.2"/>
      <polygon points="222,78 231,73 231,83" fill="#dc2626"/>
      <text x="234" y="68" font-size="9" font-weight="700" fill="#dc2626">F(t)</text>
    </svg>`,
    suggestedFilename: "MassSpringDamper.mo",
    fallbackCode: `model MassSpringDamper "Translational mass-spring-damper oscillator under step excitation"
  Modelica.Mechanics.Translational.Components.Fixed fixed annotation(Placement(transformation(extent={{-84,-10},{-64,10}})));
  Modelica.Mechanics.Translational.Components.SpringDamper suspension(c = 250, d = 8, s_rel0 = 0) annotation(Placement(transformation(extent={{-36,-10},{-16,10}})));
  Modelica.Mechanics.Translational.Components.Mass mass(m = 2.0, s(start = 0.0, fixed = true), v(start = 0.0, fixed = true)) annotation(Placement(transformation(extent={{16,-10},{36,10}})));
  Modelica.Blocks.Sources.Step forceStep(height = 25, startTime = 0.2) annotation(Placement(transformation(extent={{86,-10},{66,10}})));
  Modelica.Mechanics.Translational.Sources.Force force(useSupport = false) annotation(Placement(transformation(extent={{60,-10},{40,10}})));
equation
  connect(fixed.flange, suspension.flange_a) annotation(Line(points={{-64,0},{-36,0}}, color={0,127,0}));
  connect(suspension.flange_b, mass.flange_a) annotation(Line(points={{-16,0},{16,0}}, color={0,127,0}));
  connect(forceStep.y, force.f) annotation(Line(points={{65,0},{62,0}}, color={0,0,127}));
  connect(force.flange, mass.flange_b) annotation(Line(points={{40,0},{36,0}}, color={0,127,0}));
  annotation(experiment(StopTime = 4.0));
end MassSpringDamper;
`,
  },

  // ── CONTROL ─────────────────────────────────────────────────────────
  {
    id: "pid-speed-controller",
    title: "PID Closed-Loop Speed Control",
    fqn: "Modelica.Blocks.Examples.PID_Controller",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "control",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "Anti-windup LimPID controller regulating a rotational drive with kinematic profile setpoint, load torque disturbance, and speed feedback.",
    nodeCount: 7,
    edgeCount: 8,
    keywords: ["pid", "limpid", "controller", "feedback", "servo", "blocks", "speed", "anti-windup"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="18" y="56" width="32" height="28" rx="3" fill="#ede9fe" stroke="#6d28d9" stroke-width="1.8"/>
      <path d="M23 77 L30 64 H45" stroke="#6d28d9" stroke-width="1.8"/>
      <text x="20" y="49" font-size="8" font-weight="600" fill="#475569">ref</text>
      <line x1="50" y1="70" x2="78" y2="70" stroke="#1e3a8a" stroke-width="1.8"/>
      <rect x="78" y="52" width="46" height="36" rx="4" fill="#eff6ff" stroke="#1d4ed8" stroke-width="2"/>
      <text x="86" y="74" font-size="10.5" font-weight="700" fill="#1e3a8a">LimPID</text>
      <line x1="124" y1="70" x2="150" y2="70" stroke="#1e3a8a" stroke-width="1.8"/>
      <circle cx="162" cy="70" r="12" fill="#f1f5f9" stroke="#334155" stroke-width="1.9"/>
      <text x="157" y="74" font-size="10" font-weight="700" fill="#334155">τ</text>
      <line x1="174" y1="70" x2="196" y2="70" stroke="#334155" stroke-width="2.2"/>
      <rect x="196" y="54" width="26" height="32" rx="2" fill="#cbd5e1" stroke="#334155" stroke-width="1.9"/>
      <text x="204" y="48" font-size="8.5" font-weight="700" fill="#334155">J</text>
      <line x1="222" y1="70" x2="244" y2="70" stroke="#334155" stroke-width="2.2"/>
      <circle cx="254" cy="70" r="10" fill="#e0f2fe" stroke="#0284c7" stroke-width="1.8"/>
      <text x="250" y="73" font-size="8.5" font-weight="700" fill="#0369a1">ω</text>
      <path d="M254 80 V120 H101 V88" stroke="#1e3a8a" stroke-width="1.7" stroke-dasharray="4 2"/>
      <polygon points="101,88 97,95 105,95" fill="#1e3a8a"/>
    </svg>`,
    suggestedFilename: "PID_Controller.mo",
    fallbackCode: `model PID_Controller "Closed-loop anti-windup LimPID rotational speed controller"
  Modelica.Blocks.Sources.Step setpoint(height = 100, startTime = 0.1) annotation(Placement(transformation(extent={{-90,10},{-70,30}})));
  Modelica.Blocks.Continuous.LimPID pid(
    controllerType = Modelica.Blocks.Types.SimpleController.PID,
    k = 2.0,
    Ti = 0.1,
    Td = 0.01,
    yMax = 12
  ) annotation(Placement(transformation(extent={{-42,10},{-18,34}})));
  Modelica.Mechanics.Rotational.Sources.Torque drive(useSupport = false) annotation(Placement(transformation(extent={{8,12},{28,32}})));
  Modelica.Mechanics.Rotational.Components.Inertia rotor(J = 0.05) annotation(Placement(transformation(extent={{44,12},{64,32}})));
  Modelica.Mechanics.Rotational.Sensors.SpeedSensor speedSensor annotation(Placement(transformation(extent={{78,12},{98,32}})));
equation
  connect(setpoint.y, pid.u_s) annotation(Line(points={{-69,20},{-44,22}}, color={0,0,127}));
  connect(pid.y, drive.tau) annotation(Line(points={{-17,22},{6,22}}, color={0,0,127}));
  connect(drive.flange, rotor.flange_a) annotation(Line(points={{28,22},{44,22}}, color={0,0,0}));
  connect(rotor.flange_b, speedSensor.flange) annotation(Line(points={{64,22},{78,22}}, color={0,0,0}));
  connect(speedSensor.w, pid.u_m) annotation(Line(points={{88,11},{88,-24},{-30,-24},{-30,8}}, color={0,0,127}));
  annotation(experiment(StopTime = 2.5));
end PID_Controller;
`,
  },

  {
    id: "cascade-servo-loop",
    title: "Cascade PI Transfer-Function Loop",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "control",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "Classical block-diagram control loop with step command, error junction, PI compensator, second-order plant transfer function, and unity feedback.",
    nodeCount: 4,
    edgeCount: 5,
    keywords: ["transfer", "function", "pi", "feedback", "block", "bode", "step", "control"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="20" y="58" width="32" height="28" rx="3" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8"/>
      <path d="M25 79 H34 V65 H46" stroke="#2563eb" stroke-width="1.8"/>
      <line x1="52" y1="72" x2="78" y2="72" stroke="#1e3a8a" stroke-width="1.8"/>
      <circle cx="88" cy="72" r="10" fill="#f8fafc" stroke="#1e3a8a" stroke-width="1.8"/>
      <text x="81" y="75" font-size="10" font-weight="700" fill="#1e3a8a">+</text>
      <text x="89" y="81" font-size="10" font-weight="700" fill="#dc2626">-</text>
      <line x1="98" y1="72" x2="122" y2="72" stroke="#1e3a8a" stroke-width="1.8"/>
      <rect x="122" y="54" width="44" height="36" rx="4" fill="#dbeafe" stroke="#1d4ed8" stroke-width="1.9"/>
      <text x="135" y="76" font-size="11" font-weight="700" fill="#1e3a8a">PI(s)</text>
      <line x1="166" y1="72" x2="192" y2="72" stroke="#1e3a8a" stroke-width="1.8"/>
      <rect x="192" y="52" width="60" height="40" rx="4" fill="#ede9fe" stroke="#6d28d9" stroke-width="1.9"/>
      <text x="202" y="69" font-size="9.5" font-weight="700" fill="#4c1d95">1 / (s²+2s+1)</text>
      <line x1="198" y1="74" x2="246" y2="74" stroke="#6d28d9" stroke-width="1.1"/>
      <text x="210" y="86" font-size="8.5" fill="#4c1d95">Plant</text>
      <path d="M252 72 H264 V120 H88 V82" stroke="#1e3a8a" stroke-width="1.8"/>
      <polygon points="88,82 84,89 92,89" fill="#1e3a8a"/>
    </svg>`,
    suggestedFilename: "ServoControlLoop.mo",
    fallbackCode: `model ServoControlLoop "Unity-feedback PI control of a second-order linear plant"
  Modelica.Blocks.Sources.Step command(height = 1.0, startTime = 0.2) annotation(Placement(transformation(extent={{-88,0},{-68,20}})));
  Modelica.Blocks.Math.Feedback errorSum annotation(Placement(transformation(extent={{-46,0},{-26,20}})));
  Modelica.Blocks.Continuous.PI controller(k = 3.5, T = 0.6) annotation(Placement(transformation(extent={{-8,0},{14,22}})));
  Modelica.Blocks.Continuous.TransferFunction plant(b = {1}, a = {0.25, 0.8, 1}) annotation(Placement(transformation(extent={{38,-2},{68,24}})));
equation
  connect(command.y, errorSum.u1) annotation(Line(points={{-67,10},{-44,10}}, color={0,0,127}));
  connect(errorSum.y, controller.u) annotation(Line(points={{-27,10},{-10,11}}, color={0,0,127}));
  connect(controller.y, plant.u) annotation(Line(points={{15,11},{36,11}}, color={0,0,127}));
  connect(plant.y, errorSum.u2) annotation(Line(points={{70,11},{84,11},{84,-28},{-36,-28},{-36,2}}, color={0,0,127}));
  annotation(experiment(StopTime = 6.0));
end ServoControlLoop;
`,
  },

  // ── FLUIDS & THERMAL ────────────────────────────────────────────────
  {
    id: "two-masses-thermal",
    title: "Two-Mass Thermal Conduction",
    fqn: "Modelica.Thermal.HeatTransfer.Examples.TwoMasses",
    dialect: "modelica",
    dialectLabel: "Modelica",
    category: "fluids-thermal",
    packageName: "Modelica",
    packageVersion: "4.1.0",
    bundledByDefault: true,
    summary:
      "Transient thermal equilibration between high-temperature and low-temperature heat capacitors linked across a calibrated thermal conductor.",
    nodeCount: 5,
    edgeCount: 4,
    keywords: ["thermal", "heat", "conduction", "temperature", "capacitor", "sensor", "equilibration"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="34" y="54" width="48" height="44" rx="5" fill="#fee2e2" stroke="#dc2626" stroke-width="2"/>
      <text x="43" y="74" font-size="9.5" font-weight="700" fill="#991b1b">mass1</text>
      <text x="41" y="88" font-size="8.5" fill="#b91c1c">373.15 K</text>
      <line x1="82" y1="76" x2="114" y2="76" stroke="#dc2626" stroke-width="2.2"/>
      <rect x="114" y="62" width="52" height="28" rx="3" fill="#ffedd5" stroke="#ea580c" stroke-width="2"/>
      <path d="M122 76 H158 M148 70 L158 76 L148 82" stroke="#ea580c" stroke-width="1.8"/>
      <text x="116" y="54" font-size="8.5" font-weight="600" fill="#9a3412">conduction</text>
      <line x1="166" y1="76" x2="198" y2="76" stroke="#dc2626" stroke-width="2.2"/>
      <rect x="198" y="54" width="48" height="44" rx="5" fill="#dbeafe" stroke="#2563eb" stroke-width="2"/>
      <text x="207" y="74" font-size="9.5" font-weight="700" fill="#1e3a8a">mass2</text>
      <text x="205" y="88" font-size="8.5" fill="#1d4ed8">273.15 K</text>
      <line x1="58" y1="98" x2="58" y2="124" stroke="#dc2626" stroke-width="1.6"/>
      <circle cx="58" cy="132" r="8" fill="#fef2f2" stroke="#dc2626" stroke-width="1.6"/>
      <text x="53" y="135" font-size="8" font-weight="700" fill="#991b1b">T1</text>
      <line x1="222" y1="98" x2="222" y2="124" stroke="#2563eb" stroke-width="1.6"/>
      <circle cx="222" cy="132" r="8" fill="#eff6ff" stroke="#2563eb" stroke-width="1.6"/>
      <text x="217" y="135" font-size="8" font-weight="700" fill="#1e3a8a">T2</text>
    </svg>`,
    suggestedFilename: "TwoMasses.mo",
    fallbackCode: `model TwoMasses "Simple transient heat conduction between two thermal masses"
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass1(C = 15, T(start = 373.15, fixed = true)) annotation(Placement(transformation(extent={{-64,-10},{-44,10}})));
  Modelica.Thermal.HeatTransfer.Components.ThermalConductor conduction(G = 10) annotation(Placement(transformation(extent={{-10,-10},{10,10}})));
  Modelica.Thermal.HeatTransfer.Components.HeatCapacitor mass2(C = 15, T(start = 273.15, fixed = true)) annotation(Placement(transformation(extent={{44,-10},{64,10}})));
  Modelica.Thermal.HeatTransfer.Sensors.TemperatureSensor Tsensor1 annotation(Placement(transformation(extent={{-64,-48},{-44,-28}})));
  Modelica.Thermal.HeatTransfer.Sensors.TemperatureSensor Tsensor2 annotation(Placement(transformation(extent={{44,-48},{64,-28}})));
equation
  connect(mass1.port, conduction.port_a) annotation(Line(points={{-54,-10},{-54,0},{-10,0}}, color={191,0,0}));
  connect(conduction.port_b, mass2.port) annotation(Line(points={{10,0},{54,0},{54,-10}}, color={191,0,0}));
  connect(mass1.port, Tsensor1.port) annotation(Line(points={{-54,-10},{-54,-38}}, color={191,0,0}));
  connect(mass2.port, Tsensor2.port) annotation(Line(points={{54,-10},{54,-38}}, color={191,0,0}));
  annotation(experiment(StopTime = 5.0));
end TwoMasses;
`,
  },

  {
    id: "buildings-hydronic-loop",
    title: "Hydronic HVAC Heating Loop",
    fqn: "Buildings.Examples.HydronicHeatingLoop",
    dialect: "modelica",
    dialectLabel: "Buildings · Modelica",
    category: "fluids-thermal",
    packageName: "Buildings",
    packageVersion: "11.0.0",
    bundledByDefault: false,
    summary:
      "Closed hydronic HVAC loop from LBNL Buildings featuring a flow-controlled circulation pump, equal-percentage valve, and zone mixing volume.",
    nodeCount: 3,
    edgeCount: 3,
    keywords: ["buildings", "hvac", "hydronic", "pump", "valve", "mixing", "fluid", "district"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <path d="M48 54 H216 V86 M236 96 H256 V128 H28 V54 H48" stroke="#0284c7" stroke-width="2.2"/>
      <circle cx="66" cy="54" r="16" fill="#e0f2fe" stroke="#0369a1" stroke-width="2"/>
      <polygon points="60,44 76,54 60,64" fill="#0284c7"/>
      <text x="52" y="31" font-size="8.5" font-weight="700" fill="#0369a1">pump</text>
      <polygon points="126,43 142,54 126,65" fill="#bae6fd" stroke="#0f172a" stroke-width="1.7"/>
      <polygon points="158,43 142,54 158,65" fill="#bae6fd" stroke="#0f172a" stroke-width="1.7"/>
      <line x1="142" y1="54" x2="142" y2="36" stroke="#0f172a" stroke-width="1.8"/>
      <path d="M133 36 A9 7 0 0 1 151 36 Z" fill="#94a3b8" stroke="#0f172a" stroke-width="1.5"/>
      <text x="130" y="24" font-size="8.5" font-weight="700" fill="#0369a1">valve</text>
      <rect x="196" y="72" width="40" height="42" rx="4" fill="#e0f2fe" stroke="#0369a1" stroke-width="2"/>
      <path d="M198 92 Q207 88 216 92 T234 92 V112 H198 Z" fill="#38bdf8" opacity="0.45"/>
      <text x="194" y="65" font-size="8.5" font-weight="700" fill="#0369a1">zoneTank</text>
    </svg>`,
    suggestedFilename: "HydronicHeatingLoop.mo",
    fallbackCode: `within Buildings.Examples;

model HydronicHeatingLoop "Closed hydronic circulation loop with pump, modulating valve & thermal zone volume"
  Buildings.Fluid.Movers.FlowControlled_m_flow pump(m_flow_nominal = 1.2) annotation(Placement(transformation(extent={{-75,15},{-51,39}})));
  Buildings.Fluid.Actuators.TwoWayEqualPercentage valve(kFixed = 0.6) annotation(Placement(transformation(extent={{-12,15},{12,39}})));
  Buildings.Fluid.MixingVolumes.MixingVolume zoneTank(V = 2.5, T_start = 294.15) annotation(Placement(transformation(extent={{52,-12},{80,18}})));
equation
  pump.port_a.p = 101325;
  connect(pump.port_b, valve.port_a) annotation(Line(points={{-51,27},{-12,27}}, color={2,132,199}));
  connect(valve.port_b, zoneTank.port_a) annotation(Line(points={{12,27},{52,27},{52,3}}, color={2,132,199}));
  connect(zoneTank.port_b, pump.port_a) annotation(Line(points={{80,3},{92,3},{92,-30},{-88,-30},{-88,27},{-75,27}}, color={2,132,199}));
end HydronicHeatingLoop;
`,
  },

  {
    id: "epanet-municipal-loop",
    title: "EPANET Municipal Water Network",
    dialect: "epanet",
    dialectLabel: "EPANET",
    category: "fluids-thermal",
    packageName: "EPANET-Benchmark-Networks",
    packageVersion: "2.2.0",
    bundledByDefault: false,
    summary:
      "Pressurized municipal water distribution network with clearwell reservoir, booster pump station, elevated storage tank, and looped demand nodes.",
    nodeCount: 6,
    edgeCount: 6,
    keywords: ["epanet", "water", "hydraulic", "pipe", "reservoir", "tank", "pump", "municipal"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="18" y="64" width="28" height="24" rx="2" fill="#bae6fd" stroke="#0369a1" stroke-width="1.9"/>
      <text x="16" y="57" font-size="8" font-weight="700" fill="#0369a1">Res-1</text>
      <line x1="46" y1="76" x2="80" y2="76" stroke="#0284c7" stroke-width="2.2"/>
      <circle cx="92" cy="76" r="11" fill="#e0f2fe" stroke="#0369a1" stroke-width="1.9"/>
      <polygon points="88,70 99,76 88,82" fill="#0284c7"/>
      <line x1="103" y1="76" x2="142" y2="76" stroke="#0284c7" stroke-width="2.2"/>
      <line x1="142" y1="76" x2="142" y2="38" stroke="#0284c7" stroke-width="2.2"/>
      <rect x="128" y="18" width="28" height="20" rx="3" fill="#e0f2fe" stroke="#0369a1" stroke-width="1.9"/>
      <text x="160" y="31" font-size="8" font-weight="700" fill="#0369a1">Tank-T1</text>
      <path d="M142 76 L192 48 L244 76 L192 108 Z" stroke="#0284c7" stroke-width="2.1" fill="none"/>
      <circle cx="142" cy="76" r="5" fill="#0284c7"/><circle cx="192" cy="48" r="5" fill="#0284c7"/>
      <circle cx="244" cy="76" r="5" fill="#0284c7"/><circle cx="192" cy="108" r="5" fill="#0284c7"/>
      <text x="184" y="40" font-size="8" font-weight="600" fill="#475569">J2</text>
      <text x="248" y="79" font-size="8" font-weight="600" fill="#475569">J3</text>
      <text x="184" y="124" font-size="8" font-weight="600" fill="#475569">J4</text>
    </svg>`,
    suggestedFilename: "MunicipalLoop.epanet.inp",
    fallbackCode: `[TITLE]
EPANET Municipal Looped Water Distribution Benchmark

[JUNCTIONS]
;ID      Elev    Demand
 J1      110     0
 J2      125     45
 J3      120     65
 J4      118     50

[RESERVOIRS]
;ID      Head
 R1      105

[TANKS]
;ID      Elevation  InitLevel  MinLevel  MaxLevel  Diameter  MinVol
 T1      145        4.0        1.0       8.0       15.0      0

[PIPES]
;ID      Node1   Node2   Length  Diameter  Roughness  MinorLoss  Status
 P1      J1      T1      350     300       120        0          Open
 P2      J1      J2      600     250       115        0          Open
 P3      J2      J3      500     200       115        0          Open
 P4      J1      J4      550     250       115        0          Open
 P5      J4      J3      480     200       115        0          Open

[PUMPS]
;ID      Node1   Node2   Parameters
 PMP1    R1      J1      POWER 55

[TIMES]
 Duration 24:00
 Hydraulic Timestep 1:00

[END]
`,
  },

  // ── POWER GRIDS ─────────────────────────────────────────────────────
  {
    id: "ieee-13-bus-feeder",
    title: "IEEE 13-Node Distribution Feeder",
    dialect: "opendss",
    dialectLabel: "OpenDSS",
    category: "power-grids",
    packageName: "IEEE-Test-Feeders",
    packageVersion: "1.0.0",
    bundledByDefault: false,
    summary:
      "Unbalanced 4.16 kV IEEE benchmark distribution feeder with substation regulator, inline step-down transformer, shunt capacitor bank, and spot loads.",
    nodeCount: 7,
    edgeCount: 6,
    keywords: ["ieee", "13-bus", "opendss", "feeder", "distribution", "grid", "unbalanced", "4.16kv"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <circle cx="32" cy="42" r="12" fill="#fef3c7" stroke="#d97706" stroke-width="2"/>
      <path d="M26 42 Q29 35 32 42 T38 42" stroke="#b45309" stroke-width="1.7"/>
      <text x="16" y="24" font-size="8" font-weight="700" fill="#92400e">Sub 650</text>
      <line x1="44" y1="42" x2="126" y2="42" stroke="#d97706" stroke-width="2.4"/>
      <line x1="126" y1="24" x2="126" y2="128" stroke="#1e293b" stroke-width="3.2"/>
      <text x="132" y="30" font-size="8.5" font-weight="700" fill="#334155">Bus 632</text>
      <line x1="126" y1="58" x2="178" y2="58" stroke="#0284c7" stroke-width="2"/>
      <circle cx="186" cy="58" r="8" fill="none" stroke="#0284c7" stroke-width="1.9"/>
      <circle cx="196" cy="58" r="8" fill="none" stroke="#0284c7" stroke-width="1.9"/>
      <line x1="204" y1="58" x2="246" y2="58" stroke="#0284c7" stroke-width="2"/>
      <text x="176" y="44" font-size="8" font-weight="600" fill="#0369a1">XFM-1 (634)</text>
      <line x1="126" y1="98" x2="232" y2="98" stroke="#d97706" stroke-width="2.2"/>
      <line x1="232" y1="84" x2="232" y2="128" stroke="#1e293b" stroke-width="3.2"/>
      <text x="206" y="80" font-size="8.5" font-weight="700" fill="#334155">Bus 671</text>
      <line x1="68" y1="98" x2="126" y2="98" stroke="#059669" stroke-width="2"/>
      <polygon points="56,92 68,98 56,104" fill="#10b981"/>
      <text x="34" y="116" font-size="8" font-weight="600" fill="#065f46">Cap 675</text>
    </svg>`,
    suggestedFilename: "IEEE13Node.dss",
    fallbackCode: `Clear
New Circuit.IEEE13Nodeckt basekv=115 pu=1.0001 phases=3 bus1=SourceBus Angle=30

New Transformer.Sub Phases=3 Windings=2 XHL=8
~ wdg=1 bus=SourceBus conn=delta kv=115 kva=5000
~ wdg=2 bus=650 conn=wye kv=4.16 kva=5000

New Line.650632 Phases=3 Bus1=650.1.2.3 Bus2=632.1.2.3 Length=2000 units=ft r1=0.186 x1=0.501
New Transformer.XFM1 Phases=3 Windings=2 XHL=2
~ wdg=1 bus=632 conn=wye kv=4.16 kva=500
~ wdg=2 bus=634 conn=wye kv=0.48 kva=500

New Line.632671 Phases=3 Bus1=632.1.2.3 Length=2000 units=ft r1=0.186 x1=0.501
New Load.671 Bus1=671.1.2.3 Phases=3 Conn=Delta Model=1 kV=4.16 kW=1155 kvar=660
New Load.634 Bus1=634.1.2.3 Phases=3 Conn=Wye Model=1 kV=0.48 kW=400 kvar=290
New Capacitor.Cap675 Bus1=671 phases=3 kVAR=600 kV=4.16

Set Voltagebases=[115, 4.16, 0.48]
Calcvoltagebases
Solve
`,
  },

  {
    id: "psse-smib-stability",
    title: "WECC Generator Transient Stability",
    dialect: "psse",
    dialectLabel: "PSS/E RAW",
    category: "power-grids",
    packageName: "PSSE-Standard-Dynamics",
    packageVersion: "1.0.0",
    bundledByDefault: false,
    summary:
      "Single-machine infinite-bus (SMIB) 230 kV transmission corridor benchmark for GENROU rotor-angle swing and step-up transformer analysis.",
    nodeCount: 4,
    edgeCount: 4,
    keywords: ["psse", "wecc", "genrou", "synchronous", "generator", "transmission", "230kv", "stability"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <circle cx="42" cy="78" r="18" fill="#fef3c7" stroke="#d97706" stroke-width="2.1"/>
      <path d="M32 78 Q37 66 42 78 T52 78" stroke="#b45309" stroke-width="2"/>
      <text x="22" y="52" font-size="8.5" font-weight="700" fill="#92400e">GENROU</text>
      <line x1="60" y1="78" x2="90" y2="78" stroke="#334155" stroke-width="2.2"/>
      <line x1="90" y1="54" x2="90" y2="102" stroke="#0f172a" stroke-width="3.2"/>
      <line x1="90" y1="78" x2="112" y2="78" stroke="#334155" stroke-width="2"/>
      <circle cx="122" cy="78" r="10" fill="none" stroke="#2563eb" stroke-width="2"/>
      <circle cx="135" cy="78" r="10" fill="none" stroke="#2563eb" stroke-width="2"/>
      <line x1="145" y1="78" x2="166" y2="78" stroke="#334155" stroke-width="2"/>
      <line x1="166" y1="50" x2="166" y2="106" stroke="#0f172a" stroke-width="3.2"/>
      <path d="M166 64 H228 M166 92 H228" stroke="#0284c7" stroke-width="2.2"/>
      <text x="174" y="46" font-size="8" font-weight="600" fill="#0369a1">2x 230 kV</text>
      <line x1="228" y1="50" x2="228" y2="106" stroke="#0f172a" stroke-width="3.2"/>
      <circle cx="252" cy="78" r="12" fill="#e0f2fe" stroke="#0284c7" stroke-width="2"/>
      <line x1="228" y1="78" x2="240" y2="78" stroke="#334155" stroke-width="2"/>
      <text x="234" y="118" font-size="8" font-weight="700" fill="#0369a1">Inf Bus</text>
    </svg>`,
    suggestedFilename: "WECC_SMIB.raw",
    fallbackCode: `0, 100.00, 33, 0, 1, 60.00     / WECC SMIB 230kV Benchmark
     1,'GEN_BUS     ',  20.0000,2,   1,   1,   1,1.03000,   4.2000
     2,'HV_SEND     ', 230.0000,1,   1,   1,   1,1.01800,   2.1000
     3,'INF_BUS     ', 230.0000,3,   1,   1,   1,1.00000,   0.0000
0 / END OF BUS DATA, BEGIN LOAD DATA
     2,'1 ',1,   1,   1,    120.000,     35.000,      0.000,      0.000,      0.000,      0.000,   1,1,0
0 / END OF LOAD DATA, BEGIN FIXED SHUNT DATA
0 / END OF FIXED SHUNT DATA, BEGIN GENERATOR DATA
     1,'1 ',   450.000,   110.000,   300.000,  -150.000,1.03000,     0,   555.000, 0.00000, 0.20000, 0.0,0.0,1.0,1, 100.0,   500.0,    50.0,1,1.0
     3,'1 ',  -328.000,   -65.000,  9999.000, -9999.000,1.00000,     0,  9999.000, 0.00000, 0.00010, 0.0,0.0,1.0,1, 100.0,  9999.0, -9999.0,1,1.0
0 / END OF GENERATOR DATA, BEGIN BRANCH DATA
     2,     3,'1 ', 0.00500, 0.05500, 0.08000,   600.00,   600.00,   650.00, 0.0,0.0,0.0,0.0,1,1,   0.0,1,1.0
     2,     3,'2 ', 0.00500, 0.05500, 0.08000,   600.00,   600.00,   650.00, 0.0,0.0,0.0,0.0,1,1,   0.0,1,1.0
0 / END OF BRANCH DATA, BEGIN TRANSFORMER DATA
     1,     2,     0,'1 ',1,1,1, 0.0, 0.0,2,'STEPUP      ',1,   1,1.0
 0.00150, 0.08500,   100.00
1.00000,  20.000,   0.000,   600.00,   600.00,   650.00, 0,      0, 1.10000, 0.90000, 1.10000, 0.90000,  33, 0, 0.0, 0.0
1.00000, 230.000
0 / END OF TRANSFORMER DATA
Q
`,
  },

  // ── ROBOTICS & CAD ──────────────────────────────────────────────────
  {
    id: "planar-double-pendulum",
    title: "Planar Double Pendulum",
    fqn: "PlanarMechanics.Examples.DoublePendulum",
    dialect: "modelica",
    dialectLabel: "PlanarMechanics",
    category: "robotics-cad",
    packageName: "PlanarMechanics",
    packageVersion: "1.6.1",
    bundledByDefault: false,
    summary:
      "Coupled 2-DOF planar kinematic chain composed of fixed ground frame, two revolute pin joints, and two cylindrical rigid-body links.",
    nodeCount: 5,
    edgeCount: 4,
    keywords: ["planar", "pendulum", "multibody", "revolute", "joint", "kinematics", "link"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <line x1="22" y1="88" x2="48" y2="88" stroke="#1e293b" stroke-width="2.6"/>
      <line x1="26" y1="88" x2="20" y2="98" stroke="#64748b" stroke-width="1.6"/>
      <line x1="35" y1="88" x2="29" y2="98" stroke="#64748b" stroke-width="1.6"/>
      <line x1="44" y1="88" x2="38" y2="98" stroke="#64748b" stroke-width="1.6"/>
      <line x1="35" y1="88" x2="35" y2="74" stroke="#2563eb" stroke-width="2.2"/>
      <line x1="35" y1="74" x2="66" y2="74" stroke="#2563eb" stroke-width="2.2"/>
      <circle cx="78" cy="74" r="11" fill="#e0f2fe" stroke="#0369a1" stroke-width="2"/>
      <circle cx="78" cy="74" r="3.5" fill="#2563eb"/>
      <text x="67" y="56" font-size="8.5" font-weight="700" fill="#475569">rev1</text>
      <line x1="89" y1="74" x2="108" y2="74" stroke="#2563eb" stroke-width="2.2"/>
      <rect x="108" y="65" width="44" height="18" rx="9" fill="#dbeafe" stroke="#1e3a8a" stroke-width="2"/>
      <text x="118" y="57" font-size="8.5" font-weight="700" fill="#1e3a8a">link1</text>
      <line x1="152" y1="74" x2="174" y2="74" stroke="#2563eb" stroke-width="2.2"/>
      <circle cx="186" cy="74" r="11" fill="#e0f2fe" stroke="#0369a1" stroke-width="2"/>
      <circle cx="186" cy="74" r="3.5" fill="#2563eb"/>
      <text x="175" y="56" font-size="8.5" font-weight="700" fill="#475569">rev2</text>
      <line x1="197" y1="74" x2="216" y2="74" stroke="#2563eb" stroke-width="2.2"/>
      <rect x="216" y="65" width="44" height="18" rx="9" fill="#dbeafe" stroke="#1e3a8a" stroke-width="2"/>
      <text x="226" y="57" font-size="8.5" font-weight="700" fill="#1e3a8a">link2</text>
    </svg>`,
    suggestedFilename: "DoublePendulum.mo",
    fallbackCode: `within PlanarMechanics.Examples;

model DoublePendulum "Coupled two-link planar pendulum under gravity"
  PlanarMechanics.Parts.Fixed fixed(r = {0, 0}) annotation(Placement(transformation(extent={{-90,-10},{-70,10}})));
  PlanarMechanics.Joints.Revolute rev1(phi(start = 0.6)) annotation(Placement(transformation(extent={{-46,-10},{-26,10}})));
  PlanarMechanics.Parts.BodyCylinder link1(m = 1.2, length = 0.5) annotation(Placement(transformation(extent={{-4,-10},{20,10}})));
  PlanarMechanics.Joints.Revolute rev2(phi(start = -0.4)) annotation(Placement(transformation(extent={{42,-10},{62,10}})));
  PlanarMechanics.Parts.BodyCylinder link2(m = 0.8, length = 0.4) annotation(Placement(transformation(extent={{82,-10},{106,10}})));
equation
  connect(fixed.frame_b, rev1.frame_a) annotation(Line(points={{-70,0},{-46,0}}, color={37,99,235}));
  connect(rev1.frame_b, link1.frame_a) annotation(Line(points={{-26,0},{-4,0}}, color={37,99,235}));
  connect(link1.frame_b, rev2.frame_a) annotation(Line(points={{20,0},{42,0}}, color={37,99,235}));
  connect(rev2.frame_b, link2.frame_a) annotation(Line(points={{62,0},{82,0}}, color={37,99,235}));
end DoublePendulum;
`,
  },

  {
    id: "ur5-manipulator-urdf",
    title: "UR5 6-DOF Collaborative Robot",
    dialect: "urdf",
    dialectLabel: "URDF",
    category: "robotics-cad",
    packageName: "Standard-Robots",
    packageVersion: "1.0.0",
    bundledByDefault: false,
    summary:
      "Serial articulated manipulator kinematic tree defining base, shoulder, upper-arm, forearm, and wrist revolute joints with inertial properties.",
    nodeCount: 5,
    edgeCount: 4,
    keywords: ["urdf", "robot", "ur5", "manipulator", "articulated", "kinematics", "6dof", "arm"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="26" y="108" width="44" height="16" rx="3" fill="#cbd5e1" stroke="#334155" stroke-width="2"/>
      <line x1="48" y1="108" x2="48" y2="82" stroke="#475569" stroke-width="5" stroke-linecap="round"/>
      <circle cx="48" cy="82" r="9" fill="#dbeafe" stroke="#1d4ed8" stroke-width="2"/>
      <line x1="48" y1="82" x2="112" y2="42" stroke="#2563eb" stroke-width="6" stroke-linecap="round"/>
      <circle cx="112" cy="42" r="9" fill="#dbeafe" stroke="#1d4ed8" stroke-width="2"/>
      <line x1="112" y1="42" x2="188" y2="56" stroke="#0891b2" stroke-width="5" stroke-linecap="round"/>
      <circle cx="188" cy="56" r="8" fill="#e0f2fe" stroke="#0369a1" stroke-width="2"/>
      <line x1="188" y1="56" x2="232" y2="84" stroke="#0284c7" stroke-width="4" stroke-linecap="round"/>
      <path d="M232 84 L248 76 M232 84 L246 96" stroke="#1e293b" stroke-width="2.4" stroke-linecap="round"/>
      <text x="64" y="100" font-size="8.5" font-weight="600" fill="#475569">shoulder</text>
      <text x="134" y="34" font-size="8.5" font-weight="600" fill="#475569">elbow</text>
      <text x="206" y="50" font-size="8.5" font-weight="600" fill="#475569">wrist</text>
    </svg>`,
    suggestedFilename: "ur5_arm.urdf",
    fallbackCode: `<?xml version="1.0"?>
<robot name="ur5_collaborative_arm">
  <link name="base_link">
    <visual><geometry><cylinder length="0.08" radius="0.075"/></geometry></visual>
    <inertial><mass value="4.0"/><inertia ixx="0.0044" ixy="0" ixz="0" iyy="0.0044" iyz="0" izz="0.0072"/></inertial>
  </link>
  <link name="shoulder_link">
    <visual><geometry><cylinder length="0.14" radius="0.06"/></geometry></visual>
    <inertial><mass value="3.7"/><inertia ixx="0.0102" ixy="0" ixz="0" iyy="0.0102" iyz="0" izz="0.0066"/></inertial>
  </link>
  <link name="upper_arm_link">
    <visual><geometry><cylinder length="0.425" radius="0.05"/></geometry></visual>
    <inertial><mass value="8.39"/><inertia ixx="0.1338" ixy="0" ixz="0" iyy="0.1338" iyz="0" izz="0.0151"/></inertial>
  </link>
  <link name="forearm_link">
    <visual><geometry><cylinder length="0.392" radius="0.04"/></geometry></visual>
    <inertial><mass value="2.27"/><inertia ixx="0.0312" ixy="0" ixz="0" iyy="0.0312" iyz="0" izz="0.0040"/></inertial>
  </link>
  <link name="wrist_link">
    <visual><geometry><sphere radius="0.04"/></geometry></visual>
    <inertial><mass value="1.22"/><inertia ixx="0.0025" ixy="0" ixz="0" iyy="0.0025" iyz="0" izz="0.0022"/></inertial>
  </link>

  <joint name="shoulder_pan_joint" type="revolute">
    <parent link="base_link"/><child link="shoulder_link"/>
    <origin xyz="0 0 0.089" rpy="0 0 0"/><axis xyz="0 0 1"/>
    <limit lower="-6.28" upper="6.28" effort="150" velocity="3.15"/>
  </joint>
  <joint name="shoulder_lift_joint" type="revolute">
    <parent link="shoulder_link"/><child link="upper_arm_link"/>
    <origin xyz="0 0.135 0" rpy="0 1.5708 0"/><axis xyz="0 1 0"/>
    <limit lower="-6.28" upper="6.28" effort="150" velocity="3.15"/>
  </joint>
  <joint name="elbow_joint" type="revolute">
    <parent link="upper_arm_link"/><child link="forearm_link"/>
    <origin xyz="0 -0.119 0.425" rpy="0 0 0"/><axis xyz="0 1 0"/>
    <limit lower="-3.14" upper="3.14" effort="150" velocity="3.15"/>
  </joint>
  <joint name="wrist_1_joint" type="revolute">
    <parent link="forearm_link"/><child link="wrist_link"/>
    <origin xyz="0 0 0.392" rpy="0 1.5708 0"/><axis xyz="0 1 0"/>
    <limit lower="-6.28" upper="6.28" effort="28" velocity="3.2"/>
  </joint>
</robot>
`,
  },

  // ── SYSTEMS & ARCHITECTURE ──────────────────────────────────────────
  {
    id: "sysml2-ev-architecture",
    title: "SysML v2 Electric Vehicle Powertrain",
    dialect: "sysml2",
    dialectLabel: "SysML v2",
    category: "systems",
    packageName: "SysML",
    packageVersion: "2.0.0",
    bundledByDefault: true,
    summary:
      "Internal Block Diagram (IBD) architecture connecting HV BatteryPack, SiC Inverter, TractionMotor, Gearbox, and VehicleControlUnit.",
    nodeCount: 5,
    edgeCount: 5,
    keywords: ["sysml", "sysml2", "architecture", "ev", "vehicle", "battery", "inverter", "mbse", "ibd"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="12" y="14" width="256" height="128" rx="6" fill="none" stroke="#94a3b8" stroke-width="1.3" stroke-dasharray="5 3"/>
      <text x="20" y="27" font-size="8.5" font-weight="700" fill="#64748b">«part def» ElectricPowertrain</text>
      <rect x="24" y="46" width="60" height="36" rx="4" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8"/>
      <text x="31" y="62" font-size="8" font-weight="600" fill="#64748b">«part»</text>
      <text x="31" y="74" font-size="9" font-weight="700" fill="#1e3a8a">battery</text>
      <rect x="112" y="46" width="60" height="36" rx="4" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8"/>
      <text x="119" y="62" font-size="8" font-weight="600" fill="#64748b">«part»</text>
      <text x="119" y="74" font-size="9" font-weight="700" fill="#1e3a8a">inverter</text>
      <rect x="198" y="46" width="58" height="36" rx="4" fill="#ecfeff" stroke="#0891b2" stroke-width="1.8"/>
      <text x="205" y="62" font-size="8" font-weight="600" fill="#64748b">«part»</text>
      <text x="205" y="74" font-size="9" font-weight="700" fill="#155e75">motor</text>
      <rect x="68" y="98" width="68" height="32" rx="4" fill="#f5f3ff" stroke="#7c3aed" stroke-width="1.7"/>
      <text x="80" y="118" font-size="9" font-weight="700" fill="#5b21b6">vcuCtrl</text>
      <rect x="196" y="98" width="60" height="32" rx="4" fill="#f1f5f9" stroke="#475569" stroke-width="1.7"/>
      <text x="206" y="118" font-size="9" font-weight="700" fill="#334155">axleDrive</text>
      <line x1="84" y1="64" x2="112" y2="64" stroke="#2563eb" stroke-width="1.9"/>
      <line x1="172" y1="64" x2="198" y2="64" stroke="#2563eb" stroke-width="1.9"/>
      <line x1="227" y1="82" x2="227" y2="98" stroke="#0891b2" stroke-width="1.9"/>
      <path d="M102 98 V90 H142 V82" stroke="#7c3aed" stroke-width="1.6" stroke-dasharray="3 2"/>
    </svg>`,
    suggestedFilename: "ElectricPowertrain.sysml",
    fallbackCode: `package ElectricPowertrainPkg {
  port def DcPowerPort {
    attribute voltage_V : Real;
    attribute current_A : Real;
  }

  port def AcPhasePort {
    attribute torqueCmd_Nm : Real;
  }

  port def MechanicalShaftPort {
    attribute torque_Nm : Real;
    attribute speed_rpm : Real;
  }

  part def BatteryPack {
    attribute capacity_kWh : Real = 82.0;
    out port dcOut : DcPowerPort;
  }

  part def SiCInverter {
    attribute efficiency : Real = 0.985;
    in port dcIn : DcPowerPort;
    out port acOut : AcPhasePort;
  }

  part def TractionMotor {
    attribute peakPower_kW : Real = 220.0;
    in port phaseIn : AcPhasePort;
    out port shaftOut : MechanicalShaftPort;
  }

  part def ReductionGearbox {
    attribute ratio : Real = 9.05;
    in port shaftIn : MechanicalShaftPort;
  }

  part def ElectricPowertrain {
    part battery : BatteryPack;
    part inverter : SiCInverter;
    part motor : TractionMotor;
    part gearbox : ReductionGearbox;

    connect battery.dcOut to inverter.dcIn;
    connect inverter.acOut to motor.phaseIn;
    connect motor.shaftOut to gearbox.shaftIn;
  }
}
`,
  },

  {
    id: "autosar-cruise-swc",
    title: "AUTOSAR Adaptive Cruise SWC",
    fqn: "AUTOSAR.ApplicationSwComponentType",
    dialect: "modelica",
    dialectLabel: "AUTOSAR · Modelica",
    category: "systems",
    packageName: "AUTOSAR-Metamodels",
    packageVersion: "4.4.0",
    bundledByDefault: false,
    summary:
      "AUTOSAR Atomic Application Software Component architecture wiring radar speed receiver ports into longitudinal torque-request provider ports.",
    nodeCount: 3,
    edgeCount: 2,
    keywords: ["autosar", "swc", "automotive", "ecu", "cruise", "torque", "port", "software"],
    diagramSvg: `<svg ${DIAG_ATTRS}>
      <rect x="20" y="60" width="48" height="36" rx="4" fill="#eff6ff" stroke="#2563eb" stroke-width="1.8"/>
      <text x="27" y="81" font-size="8.5" font-weight="700" fill="#1e3a8a">RadarSpd</text>
      <line x1="68" y1="78" x2="98" y2="78" stroke="#2563eb" stroke-width="1.9"/>
      <rect x="98" y="44" width="88" height="68" rx="6" fill="#f5f3ff" stroke="#6d28d9" stroke-width="2"/>
      <text x="116" y="64" font-size="8" font-weight="600" fill="#6d28d9">«ApplicationSWC»</text>
      <text x="110" y="82" font-size="9.5" font-weight="700" fill="#3b0764">CruiseControl</text>
      <rect x="93" y="73" width="10" height="10" fill="#ede9fe" stroke="#6d28d9" stroke-width="1.6"/>
      <rect x="181" y="73" width="10" height="10" fill="#ede9fe" stroke="#6d28d9" stroke-width="1.6"/>
      <line x1="191" y1="78" x2="216" y2="78" stroke="#6d28d9" stroke-width="1.9"/>
      <rect x="216" y="60" width="46" height="36" rx="4" fill="#ecfeff" stroke="#0891b2" stroke-width="1.8"/>
      <text x="223" y="81" font-size="8.5" font-weight="700" fill="#155e75">TrqAct</text>
    </svg>`,
    suggestedFilename: "CruiseSwcDemo.mo",
    fallbackCode: `model CruiseSwcDemo "AUTOSAR longitudinal cruise software component harness"
  Modelica.Blocks.Sources.Ramp speedRamp(height = 18, duration = 4, startTime = 0.5) annotation(Placement(transformation(extent={{-82,-10},{-62,10}})));
  AUTOSAR.ApplicationSwComponentType cruiseSwc annotation(Placement(transformation(extent={{-14,-14},{16,14}})));
equation
  connect(speedRamp.y, cruiseSwc.RPort_VehicleSpeed) annotation(Line(points={{-61,0},{-14,0}}, color={0,0,127}));
  annotation(experiment(StopTime = 6.0));
end CruiseSwcDemo;
`,
  },
];

export function inferHubModelDomain(fqnOrName: string, dialect = "modelica"): Exclude<HubDomainId, "all"> {
  const lower = `${fqnOrName} ${dialect}`.toLowerCase();
  if (lower.includes("sysml") || lower.includes("autosar") || lower.includes("owl") || lower.includes("ssp")) {
    return "systems";
  }
  if (lower.includes("opendss") || lower.includes("psse") || lower.includes("pscad") || lower.includes("ieee")) {
    return "power-grids";
  }
  if (lower.includes("urdf") || lower.includes("planar") || lower.includes("multibody") || lower.includes("step")) {
    return "robotics-cad";
  }
  if (
    lower.includes("fluid") ||
    lower.includes("thermal") ||
    lower.includes("heat") ||
    lower.includes("building") ||
    lower.includes("epanet") ||
    lower.includes("swmm")
  ) {
    return "fluids-thermal";
  }
  if (lower.includes("block") || lower.includes("control") || lower.includes("pid") || lower.includes("stategraph")) {
    return "control";
  }
  if (lower.includes("mechanic") || lower.includes("rotational") || lower.includes("translational")) {
    return "mechanics";
  }
  return "electrical";
}

export function buildHubEquationFallbackSvg(title: string, subtitle: string, isDark = true): string {
  const safeTitle = title.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 28);
  const safeSub = subtitle.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").slice(0, 38);
  const bg = isDark ? "#0f172a" : "#f8fafc";
  const box = isDark ? "#1e293b" : "#ffffff";
  const border = isDark ? "#334155" : "#cbd5e1";
  const text = isDark ? "#e2e8f0" : "#1e293b";
  const muted = isDark ? "#94a3b8" : "#64748b";
  const accent = isDark ? "#60a5fa" : "#2563eb";
  return `<svg ${DIAG_ATTRS}>
    <rect x="0" y="0" width="280" height="156" fill="${bg}"/>
    <rect x="36" y="28" width="208" height="100" rx="8" fill="${box}" stroke="${border}" stroke-width="1.5"/>
    <path d="M54 54 H116 M54 74 H178 M54 94 H146" stroke="${border}" stroke-width="2" stroke-linecap="round"/>
    <text x="196" y="64" font-size="16" font-weight="700" fill="${accent}" font-family="Georgia,serif" font-style="italic">∂x/∂t</text>
    <text x="54" y="114" font-size="10" font-weight="700" fill="${text}" font-family="Inter,sans-serif">${safeTitle}</text>
    <text x="140" y="18" text-anchor="middle" font-size="8.5" font-weight="600" fill="${muted}" font-family="Inter,sans-serif">${safeSub}</text>
  </svg>`;
}
