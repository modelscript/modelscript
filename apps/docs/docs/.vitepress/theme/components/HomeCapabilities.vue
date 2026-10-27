<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import type { IconName } from "../data/icons";
import MsIcon from "./MsIcon.vue";

interface Capability {
  icon: IconName;
  title: string;
  body: string;
  link: string;
}

const capabilities: Capability[] = [
  {
    icon: "code",
    title: "Incremental GLR parsing",
    body: "A native WebAssembly GLR parser generator with incremental reparsing, fast enough to run on every keystroke in the IDE.",
    link: "/architecture/glr-parser",
  },
  {
    icon: "database",
    title: "Salsa query engine",
    body: "Memoized, dependency-tracked semantic queries recompute only what changed across multi-file workspaces.",
    link: "/architecture/salsa-queries",
  },
  {
    icon: "cube",
    title: "Arena DAE flattening",
    body: "Hierarchical models are lowered straight into a struct-of-arrays DAE arena in linear memory, with no intermediate AST.",
    link: "/architecture/dae-arena",
  },
  {
    icon: "activity",
    title: "Structural analysis & solvers",
    body: "Pantelides index reduction, Tarjan BLT, and Cellier–Elmqvist tearing, plus SUNDIALS, BDF, and Rosenbrock integrators.",
    link: "/algorithms/pantelides",
  },
  {
    icon: "target",
    title: "Optimization",
    body: "Direct collocation for optimal control and parameter estimation, with bounds, constraints, and custom objectives.",
    link: "/algorithms/optimization",
  },
  {
    icon: "link",
    title: "Triple graph grammars",
    body: "Bidirectional synchronization links SysML v2, Modelica, STEP, and domain formats into one hypergraph.",
    link: "/architecture/tgg",
  },
  {
    icon: "shield",
    title: "Formal verification",
    body: "Nelson–Oppen theory combination, CHC/IC3, and abstract interpretation prove properties of hybrid systems.",
    link: "/algorithms/verification-chc",
  },
  {
    icon: "gauge",
    title: "SIL & real-time HIL",
    body: "Deterministic WebAssembly runtimes for software-in-the-loop and hardware-in-the-loop execution.",
    link: "/architecture/hil-wasm-runtime",
  },
];
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
        <a v-for="c in capabilities" :key="c.title" :href="c.link" class="cap">
          <span class="cap-icon"><MsIcon :name="c.icon" :size="18" /></span>
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
  gap: 1px;
  border-radius: 18px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-divider);
}

.cap {
  display: flex;
  flex-direction: column;
  padding: 26px 24px;
  background: var(--vp-c-bg);
  text-decoration: none;
  color: inherit;
  transition: background 0.25s;
}

.cap:hover {
  background: var(--vp-c-bg-soft);
}

.cap-icon {
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  transition: transform 0.25s;
}

.cap:hover .cap-icon {
  transform: translateY(-2px);
}

.cap h3 {
  margin: 16px 0 6px;
  font-size: 0.98rem;
  font-weight: 660;
  color: var(--vp-c-text-1);
}

.cap p {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.caps-links {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px 32px;
  margin-top: 32px;
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
