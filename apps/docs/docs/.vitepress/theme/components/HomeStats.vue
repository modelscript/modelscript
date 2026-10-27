<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { INDUSTRIES } from "../data/industries";
import type { IconName } from "../data/icons";
import { LANGUAGE_COUNT } from "../data/languages";
import MsIcon from "./MsIcon.vue";

interface StatItem {
  value: string;
  label: string;
  description: string;
  icon: IconName;
  link: string;
}

// Counts are derived from the shared data catalog so they never drift from the docs.
const stats: StatItem[] = [
  {
    value: String(LANGUAGE_COUNT),
    label: "Languages & formats",
    description: "From Modelica and SysML v2 to PSCAD, AUTOSAR, and STEP.",
    icon: "layers",
    link: "/languages/overview",
  },
  {
    value: String(INDUSTRIES.length),
    label: "Industries served",
    description: "Aerospace, automotive, grid, rail, offshore, and more.",
    icon: "globe",
    link: "/industries/",
  },
  {
    value: "250+",
    label: "Compiler lint rules",
    description: "Real-time diagnostics for syntax, types, units, and balance.",
    icon: "shield",
    link: "/reference/linter-rules",
  },
  {
    value: "0",
    label: "Installs required",
    description: "Native WebAssembly runs in the browser, Node.js, and the CLI.",
    icon: "cube",
    link: "/architecture/overview",
  },
];
</script>

<template>
  <section class="home-stats" aria-label="ModelScript at a glance">
    <div class="ms-container">
      <div class="stats-grid">
        <a v-for="item in stats" :key="item.label" :href="item.link" class="stat">
          <span class="stat-icon"><MsIcon :name="item.icon" :size="18" /></span>
          <span class="stat-value">{{ item.value }}</span>
          <span class="stat-label">{{ item.label }}</span>
          <span class="stat-desc">{{ item.description }}</span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-stats {
  position: relative;
  z-index: 2;
  padding: 8px 0 24px;
}

.stats-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  border: 1px solid var(--vp-c-divider);
  border-radius: 20px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 70%, transparent);
  backdrop-filter: blur(8px);
  overflow: hidden;
}

.stat {
  display: grid;
  grid-template-columns: auto 1fr;
  grid-template-areas:
    "icon value"
    "label label"
    "desc desc";
  align-items: center;
  column-gap: 12px;
  padding: 26px 26px 24px;
  text-decoration: none;
  color: inherit;
  transition: background 0.25s;
}

.stat + .stat {
  border-left: 1px solid var(--vp-c-divider);
}

.stat:hover {
  background: var(--ms-surface-hover);
}

.stat-icon {
  grid-area: icon;
  display: grid;
  place-items: center;
  width: 34px;
  height: 34px;
  border-radius: 10px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.stat-value {
  grid-area: value;
  font-size: 2.1rem;
  font-weight: 750;
  line-height: 1;
  letter-spacing: -0.03em;
  font-variant-numeric: tabular-nums;
  background: var(--ms-gradient-text);
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
}

.stat-label {
  grid-area: label;
  margin-top: 14px;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.stat-desc {
  grid-area: desc;
  margin-top: 4px;
  font-size: 0.84rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

@media (max-width: 960px) {
  .stats-grid {
    grid-template-columns: repeat(2, 1fr);
  }
  .stat:nth-child(3) {
    border-left: none;
  }
  .stat:nth-child(n + 3) {
    border-top: 1px solid var(--vp-c-divider);
  }
}

@media (max-width: 560px) {
  .stats-grid {
    grid-template-columns: 1fr;
  }
  .stat + .stat {
    border-left: none;
    border-top: 1px solid var(--vp-c-divider);
  }
}
</style>
