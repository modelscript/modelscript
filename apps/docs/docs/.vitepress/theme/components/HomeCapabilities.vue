<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { IconName } from "../data/icons";
import { type Tone, toneStyle } from "../data/tones";
import MsIcon from "./MsIcon.vue";

type DiagramId = "glr" | "salsa" | "arena" | "solvers" | "optimization" | "tgg" | "verification" | "hil";

interface Capability {
  id: DiagramId;
  icon: IconName;
  /** Primary hue = subject of the schematic; accent hue = the one insight it highlights. */
  tone: Tone;
  badge: string;
  title: string;
  body: string;
  link: string;
}

const capabilities: Capability[] = [
  {
    id: "glr",
    icon: "code",
    tone: ["indigo", "amber"],
    badge: "SPPF · WASM",
    title: "Incremental GLR parsing",
    body: "A native WebAssembly GLR parser generator with incremental reparsing, fast enough to run on every keystroke in the IDE.",
    link: "/architecture/glr-parser",
  },
  {
    id: "salsa",
    icon: "database",
    tone: ["cyan", "amber"],
    badge: "Memoized DAG",
    title: "Salsa query engine",
    body: "Memoized, dependency-tracked semantic queries recompute only what changed across multi-file workspaces.",
    link: "/architecture/salsa-queries",
  },
  {
    id: "arena",
    icon: "cube",
    tone: ["teal", "indigo"],
    badge: "SoA Linear Memory",
    title: "Arena DAE flattening",
    body: "Hierarchical models are lowered straight into a struct-of-arrays DAE arena in linear memory, with no intermediate AST.",
    link: "/architecture/dae-arena",
  },
  {
    id: "solvers",
    icon: "activity",
    tone: ["indigo", "amber"],
    badge: "BLT · Tearing · IDA",
    title: "Structural analysis & solvers",
    body: "Pantelides index reduction, Tarjan BLT, and Cellier–Elmqvist tearing, plus SUNDIALS, BDF, and Rosenbrock integrators.",
    link: "/algorithms/pantelides",
  },
  {
    id: "optimization",
    icon: "target",
    tone: ["teal", "amber"],
    badge: "Collocation · NLP",
    title: "Optimization",
    body: "Direct collocation for optimal control and parameter estimation, with bounds, constraints, and custom objectives.",
    link: "/algorithms/optimization",
  },
  {
    id: "tgg",
    icon: "link",
    tone: ["indigo", "cyan"],
    badge: "Bi-directional Sync",
    title: "Triple graph grammars",
    body: "Bidirectional synchronization links SysML v2, Modelica, STEP, and domain formats into one hypergraph.",
    link: "/architecture/tgg",
  },
  {
    id: "verification",
    icon: "shield",
    tone: ["emerald", "rose"],
    badge: "SMT · CHC / IC3",
    title: "Formal verification",
    body: "Nelson–Oppen theory combination, CHC/IC3, and abstract interpretation prove properties of hybrid systems.",
    link: "/algorithms/verification-chc",
  },
  {
    id: "hil",
    icon: "gauge",
    tone: ["violet", "amber"],
    badge: "Deterministic Δt",
    title: "SIL & real-time HIL",
    body: "Deterministic WebAssembly runtimes for software-in-the-loop and hardware-in-the-loop execution.",
    link: "/architecture/hil-wasm-runtime",
  },
];

/* ── BLT schematic: one sparse incidence pattern, shown scrambled and then BLT-permuted ── */
/** (equation, variable) incidences in BLT order: blocks {0}, {1,2,3}, {4,5}; column 3 is the tearing variable. */
const bltEntries: ReadonlyArray<readonly [number, number]> = [
  [0, 0],
  [1, 0],
  [1, 1],
  [1, 3],
  [2, 1],
  [2, 2],
  [3, 2],
  [3, 3],
  [4, 0],
  [4, 2],
  [4, 4],
  [4, 5],
  [5, 3],
  [5, 4],
  [5, 5],
];
const bltBlockOf = [0, 1, 1, 1, 2, 2];
const TEAR_COL = 3;
/** Arbitrary row/column permutation used for the unsorted "before" matrix. */
const scrambleRow = [1, 3, 5, 0, 4, 2];
const scrambleCol = [2, 4, 0, 3, 5, 1];
const bltScrambled = bltEntries.map(([r, c]) => ({ r: scrambleRow[r], c: scrambleCol[c] }));
const bltSorted = bltEntries.map(([r, c]) => ({
  r,
  c,
  kind: bltBlockOf[r] !== bltBlockOf[c] ? "off" : c === TEAR_COL ? "tear" : "block",
}));

/* ── Collocation schematic: 4 mesh intervals, 3-stage Radau IIA (τ = 0.155, 0.645, 1) ── */
const knots = [16, 68, 120, 172, 224];
const stateY = (x: number) => 26 + 54 * Math.exp(-(x - 16) / 40);
const statePath = (() => {
  const pts: string[] = [];
  for (let x = 16; x <= 224; x += 4) pts.push(`${x} ${stateY(x).toFixed(1)}`);
  return `M${pts.join(" L")}`;
})();
const radauInterior = knots.slice(0, -1).flatMap((a, k) =>
  [0.155, 0.645].map((tau) => {
    const x = a + tau * (knots[k + 1] - a);
    return { x: +x.toFixed(1), y: +stateY(x).toFixed(1) };
  }),
);
const meshKnots = knots.map((x) => ({ x, y: +stateY(x).toFixed(1) }));
</script>

<template>
  <section class="ms-section ms-section-alt home-caps">
    <div class="ms-container">
      <header class="ms-section-head">
        <span class="ms-eyebrow">Under the hood</span>
        <h2 class="ms-h2">Compiler-grade engineering, documented in the open</h2>
        <p class="ms-lead">
          Every algorithm is documented in the architecture and algorithms catalog, so you can read exactly how your
          models are compiled and solved.
        </p>
      </header>

      <div class="caps-grid">
        <a v-for="c in capabilities" :key="c.title" :href="c.link" class="cap" :style="toneStyle(c.tone)">
          <div class="ms-schematic cap-schematic" aria-hidden="true">
            <svg viewBox="0 0 240 110" fill="none" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round">
              <!-- 1. Incremental GLR: edit re-parses one region; reused subtree stays; SPPF packs 2 derivations -->
              <template v-if="c.id === 'glr'">
                <g class="sx-ink">
                  <path d="M120 16 L60 44 M60 44 L36 86 M60 44 L78 86" />
                </g>
                <path class="sx-p" d="M120 16 L165 40 M165 40 L146 60 M165 40 L184 60" stroke-width="1.6" />
                <path class="sx-p" d="M146 60 L120 86 M146 60 L162 86 M146 60 L204 86" stroke-opacity="0.85" />
                <path class="sx-p" d="M184 60 L120 86 M184 60 L162 86 M184 60 L204 86" stroke-dasharray="3 2.5" />
                <circle class="sx-pf" cx="120" cy="16" r="5" />
                <circle class="sx-ink-f" cx="60" cy="44" r="4.5" />
                <circle class="sx-pf" cx="165" cy="40" r="5.5" stroke-width="1.6" />
                <polygon class="sx-pd" points="146,55 151,60 146,65 141,60" />
                <polygon class="sx-pd" points="184,55 189,60 184,65 179,60" />
                <rect class="sx-ink-f" x="18" y="86" width="36" height="14" rx="3" />
                <rect class="sx-ink-f" x="60" y="86" width="36" height="14" rx="3" />
                <rect class="sx-ink-f" x="102" y="86" width="36" height="14" rx="3" />
                <rect class="sx-af sx-glow" x="144" y="86" width="36" height="14" rx="3" stroke-width="1.6" />
                <rect class="sx-ink-f" x="186" y="86" width="36" height="14" rx="3" />
                <text class="sx-mono sx-ta" x="162" y="96" text-anchor="middle">edit</text>
                <text class="sx-label" x="14" y="47">reused</text>
                <text class="sx-label sx-tp" x="228" y="43" text-anchor="end">2 parses</text>
              </template>

              <!-- 2. Salsa: edit re-runs parse → index; index result unchanged ⇒ early cutoff, DAE stays cached -->
              <template v-else-if="c.id === 'salsa'">
                <path class="sx-a" d="M56 32 H72" stroke-width="1.6" />
                <path class="sx-ink" d="M56 78 H72" />
                <path class="sx-p" d="M120 32 C128 32 128 50 136 50" stroke-width="1.6" />
                <path class="sx-ink" d="M120 78 C128 78 128 60 136 60" />
                <path class="sx-ink" d="M180 55 H190" stroke-dasharray="2 2" />
                <rect class="sx-af sx-glow" x="12" y="22" width="44" height="20" rx="4" />
                <text class="sx-mono sx-ta" x="34" y="35.5" text-anchor="middle">A.mo</text>
                <rect class="sx-ink-f" x="12" y="68" width="44" height="20" rx="4" />
                <text class="sx-mono" x="34" y="81.5" text-anchor="middle">B.mo</text>
                <rect class="sx-pf" x="72" y="22" width="48" height="20" rx="4" />
                <text class="sx-mono sx-tp" x="96" y="35.5" text-anchor="middle">parse</text>
                <rect class="sx-ink-f" x="72" y="68" width="48" height="20" rx="4" />
                <text class="sx-mono" x="96" y="81.5" text-anchor="middle">parse</text>
                <rect class="sx-pf" x="136" y="45" width="44" height="20" rx="4" />
                <text class="sx-mono sx-tp" x="158" y="58.5" text-anchor="middle">index</text>
                <rect class="sx-ink-f" x="190" y="45" width="40" height="20" rx="4" />
                <text class="sx-mono" x="210" y="58.5" text-anchor="middle">DAE</text>
                <path class="sx-a sx-glow" d="M185 46 V64" stroke-width="2.4" />
                <text class="sx-label sx-tp" x="96" y="15" text-anchor="middle">re-run</text>
                <text class="sx-label sx-ta" x="158" y="78" text-anchor="middle">same result</text>
                <text class="sx-label" x="210" y="78" text-anchor="middle">cached</text>
              </template>

              <!-- 3. Arena SoA: eq → expr ids; expr nodes reference child exprs in the same array; leaves → vars -->
              <template v-else-if="c.id === 'arena'">
                <text class="sx-mono" x="12" y="25">eq</text>
                <text class="sx-mono" x="12" y="57">expr</text>
                <text class="sx-mono" x="12" y="89">var</text>
                <g v-for="row in [14, 46, 78]" :key="row">
                  <rect class="sx-ink-f" x="48" :y="row" width="180" height="16" rx="3" />
                  <path
                    class="sx-ink"
                    :d="[78, 108, 138, 168, 198].map((x) => `M${x} ${row} V${row + 16}`).join(' ')"
                    stroke-opacity="0.55"
                  />
                </g>
                <rect class="sx-pf" x="198" y="14" width="30" height="16" />
                <rect class="sx-af" x="198" y="46" width="30" height="16" />
                <rect class="sx-af" x="108" y="46" width="30" height="16" />
                <rect class="sx-af" x="168" y="46" width="30" height="16" />
                <rect class="sx-pf" x="78" y="78" width="30" height="16" />
                <rect class="sx-pf" x="168" y="78" width="30" height="16" />
                <!-- eq → expr -->
                <path class="sx-p" d="M218 30 V42" stroke-width="1.5" />
                <polygon class="sx-pd" points="215,41 221,41 218,46" />
                <!-- expr → child expr (same array) -->
                <g class="sx-glow">
                  <path class="sx-a" d="M206 46 C206 33 123 33 123 42" stroke-width="1.5" />
                  <polygon class="sx-ad" points="120,41 126,41 123,46" />
                  <path class="sx-a" d="M210 46 C210 37 183 37 183 42" stroke-width="1.5" />
                  <polygon class="sx-ad" points="180,41 186,41 183,46" />
                </g>
                <!-- leaf expr → var -->
                <path class="sx-p" d="M123 62 L97.4 75.6 M183 62 V74" stroke-width="1.5" />
                <polygon class="sx-pd" points="93,78 98.8,78.3 96,73" />
                <polygon class="sx-pd" points="180,73 186,73 183,78" />
              </template>

              <!-- 4. Structural analysis: unsorted incidence → Tarjan BLT with diagonal blocks + tearing column -->
              <template v-else-if="c.id === 'solvers'">
                <rect class="sx-ink-f" x="20" y="18" width="64" height="64" rx="4" />
                <rect
                  v-for="(e, i) in bltScrambled"
                  :key="`s${i}`"
                  class="sx-ink-d"
                  :x="23.5 + e.c * 10"
                  :y="21.5 + e.r * 10"
                  width="7"
                  height="7"
                  rx="1.5"
                />
                <path class="sx-ink" d="M94 50 H132" />
                <polygon class="sx-ink-d" points="137,50 131,46.5 131,53.5" />
                <text class="sx-label" x="115" y="43" text-anchor="middle">Tarjan</text>
                <rect class="sx-ink-f" x="146" y="18" width="64" height="64" rx="4" />
                <rect class="sx-af" x="178" y="30" width="10" height="30" stroke-width="1" />
                <rect
                  v-for="(e, i) in bltSorted"
                  :key="`b${i}`"
                  :class="e.kind === 'block' ? 'sx-pd' : e.kind === 'tear' ? 'sx-ad sx-glow' : 'sx-ink-d'"
                  :x="149.5 + e.c * 10"
                  :y="21.5 + e.r * 10"
                  width="7"
                  height="7"
                  rx="1.5"
                />
                <g class="sx-p" stroke-width="1">
                  <rect x="148" y="20" width="10" height="10" rx="2" />
                  <rect x="158" y="30" width="30" height="30" rx="2" />
                  <rect x="188" y="60" width="20" height="20" rx="2" />
                </g>
                <text class="sx-label" x="52" y="100" text-anchor="middle">incidence</text>
                <text class="sx-label sx-tp" x="166" y="100" text-anchor="middle">BLT</text>
                <text class="sx-label sx-ta" x="197" y="100" text-anchor="middle">torn</text>
              </template>

              <!-- 5. Direct collocation: Radau IIA nodes (2 interior + right endpoint) on every mesh interval -->
              <template v-else-if="c.id === 'optimization'">
                <rect x="16" y="10" width="208" height="12" rx="2" style="fill: var(--sx-ink-soft)" />
                <path class="sx-ink" d="M16 22 H224" stroke-dasharray="3 2.5" />
                <text class="sx-label" x="222" y="19" text-anchor="end">x ≤ xₘₐₓ</text>
                <path
                  class="sx-ink"
                  d="M68 22 V92 M120 22 V92 M172 22 V92"
                  stroke-dasharray="2 2.5"
                  stroke-opacity="0.7"
                />
                <path class="sx-ink" d="M16 92 H226" />
                <path class="sx-p" :d="statePath" stroke-width="2" />
                <circle class="sx-bg sx-p" :cx="meshKnots[0].x" :cy="meshKnots[0].y" r="3.2" stroke-width="1.6" />
                <g v-for="k in meshKnots.slice(1)" :key="`k${k.x}`">
                  <circle class="sx-bg sx-p" :cx="k.x" :cy="k.y" r="3.6" stroke-width="1.6" />
                  <circle class="sx-ad" :cx="k.x" :cy="k.y" r="1.6" />
                </g>
                <circle v-for="n in radauInterior" :key="`n${n.x}`" class="sx-ad sx-glow" :cx="n.x" :cy="n.y" r="2.4" />
                <text class="sx-label sx-ta" x="120" y="104" text-anchor="middle">Radau collocation nodes</text>
              </template>

              <!-- 6. TGG: source graph (SysML) ↔ correspondence nodes ↔ target graph (Modelica) -->
              <template v-else-if="c.id === 'tgg'">
                <text class="sx-label sx-tp" x="46" y="26" text-anchor="middle">SysML v2</text>
                <text class="sx-label" x="120" y="28" text-anchor="middle">corr</text>
                <text class="sx-label sx-ta" x="194" y="26" text-anchor="middle">Modelica</text>
                <path class="sx-ink" d="M72 48 H110 M130 48 H164 M72 78 H110 M130 78 H164" />
                <path class="sx-p" d="M46 58 V68" stroke-width="1.5" />
                <path class="sx-a" d="M194 58 V68" stroke-width="1.5" />
                <rect class="sx-pf" x="20" y="38" width="52" height="20" rx="4" />
                <text class="sx-mono sx-tp" x="46" y="51.5" text-anchor="middle">part</text>
                <rect class="sx-pf" x="20" y="68" width="52" height="20" rx="4" />
                <text class="sx-mono sx-tp" x="46" y="81.5" text-anchor="middle">port</text>
                <polygon class="sx-ink-f" points="120,39 130,48 120,57 110,48" />
                <polygon class="sx-ink-f" points="120,69 130,78 120,87 110,78" />
                <rect class="sx-af sx-glow" x="164" y="38" width="60" height="20" rx="4" />
                <text class="sx-mono sx-ta" x="194" y="51.5" text-anchor="middle">model</text>
                <rect class="sx-af sx-glow" x="164" y="68" width="60" height="20" rx="4" />
                <text class="sx-mono sx-ta" x="194" y="81.5" text-anchor="middle">connector</text>
              </template>

              <!-- 7. IC3/PDR: Init ⊆ F₁ ⊆ F₂ = F₃ (inductive invariant), disjoint from Bad -->
              <template v-else-if="c.id === 'verification'">
                <rect class="sx-af sx-glow" x="172" y="14" width="56" height="44" rx="10" stroke-width="1.5" />
                <text class="sx-label sx-ta" x="200" y="40" text-anchor="middle">Bad</text>
                <ellipse class="sx-pf" cx="86" cy="60" rx="70" ry="36" stroke-width="1.5" />
                <ellipse class="sx-p" cx="74" cy="64" rx="46" ry="24" stroke-dasharray="3 2.5" />
                <ellipse class="sx-pf" cx="60" cy="68" rx="18" ry="11" />
                <text class="sx-label sx-tp" x="86" y="35" text-anchor="middle">F₂ = F₃ = Inv</text>
                <text class="sx-label sx-tp" x="106" y="67" text-anchor="middle">F₁</text>
                <text class="sx-label sx-tp" x="60" y="71" text-anchor="middle">Init</text>
                <text class="sx-mono sx-tp" x="200" y="80" text-anchor="middle">Inv ∩ Bad = ∅</text>
                <text class="sx-label sx-tp" x="200" y="94" text-anchor="middle">✓ safe</text>
              </template>

              <!-- 8. SIL/HIL: fixed frames; each step finishes (WCET) before its deadline; clock edges = frame starts -->
              <template v-else>
                <path class="sx-ink" d="M16 18 V98" />
                <path class="sx-a" d="M120 18 V98 M224 18 V98" stroke-dasharray="3 2.5" />
                <text class="sx-label" x="16" y="13" text-anchor="middle">t₀</text>
                <text class="sx-label sx-ta" x="120" y="13" text-anchor="middle">Δt</text>
                <text class="sx-label sx-ta" x="224" y="13" text-anchor="middle">2Δt</text>
                <g v-for="o in [0, 104]" :key="`f${o}`">
                  <rect class="sx-ink-f" :x="20 + o" y="28" width="18" height="20" rx="3" />
                  <text class="sx-mono" :x="29 + o" y="41.5" text-anchor="middle">in</text>
                  <rect class="sx-pf" :x="40 + o" y="28" width="40" height="20" rx="3" />
                  <text class="sx-mono sx-tp" :x="60 + o" y="41.5" text-anchor="middle">step</text>
                  <rect class="sx-ink-f" :x="82 + o" y="28" width="18" height="20" rx="3" />
                  <text class="sx-mono" :x="91 + o" y="41.5" text-anchor="middle">out</text>
                  <rect class="sx-ink" :x="102 + o" y="28" width="14" height="20" rx="3" stroke-dasharray="2 2" />
                </g>
                <path class="sx-ink" d="M20 58 V62 H100 V58" />
                <text class="sx-label" x="60" y="74" text-anchor="middle">WCET</text>
                <text class="sx-label" x="109" y="74" text-anchor="middle">slack</text>
                <path class="sx-p" d="M8 98 H16 V86 H68 V98 H120 V86 H172 V98 H224 V86 H232" stroke-width="1.3" />
              </template>
            </svg>
          </div>

          <div class="cap-meta">
            <span class="cap-icon ms-tone-tile"
              ><MsIcon :name="c.icon" :size="18" :stroke="1.6" :duotone="true"
            /></span>
            <span class="cap-badge">{{ c.badge }}</span>
          </div>
          <h3>{{ c.title }}</h3>
          <p>{{ c.body }}</p>
        </a>
      </div>

      <div class="caps-links">
        <a href="/architecture/overview">Architecture overview <MsIcon name="arrowRight" :size="14" :stroke="2" /></a>
        <a href="/algorithms/overview">Algorithms catalog <MsIcon name="arrowRight" :size="14" :stroke="2" /></a>
        <a href="/modelscript-reference-manual.pdf" target="_blank" rel="noopener">
          PDF reference manual <MsIcon name="download" :size="14" :stroke="2" />
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.caps-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.cap {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: 18px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  transition:
    transform 0.25s ease,
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    background 0.25s ease;
}

.cap:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--tone-p) 45%, transparent);
  box-shadow: 0 22px 44px -24px color-mix(in srgb, var(--tone-p) 45%, transparent);
}

.cap-schematic {
  aspect-ratio: 240 / 110;
  margin-bottom: 16px;
}

.cap:hover .cap-schematic {
  border-color: color-mix(in srgb, var(--tone-p) 38%, transparent);
}

.cap-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.cap-icon {
  width: 34px;
  height: 34px;
  border-radius: 10px;
}

.cap-badge {
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 550;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.cap h3 {
  margin: 12px 0 6px;
  font-size: 1rem;
  font-weight: 680;
  color: var(--vp-c-text-1);
}

.cap p {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.caps-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 32px;
  margin-top: 36px;
}

.caps-links a {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.caps-links a:hover {
  text-decoration: underline;
  text-underline-offset: 4px;
}

@media (max-width: 1024px) {
  .caps-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 560px) {
  .caps-grid {
    grid-template-columns: 1fr;
  }
}
</style>
