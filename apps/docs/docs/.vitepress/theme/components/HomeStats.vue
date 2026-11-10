<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed } from "vue";
import type { IconName } from "../data/icons";
import { LANGUAGE_COUNT } from "../data/languages";
import languagesData from "../data/languages.generated.json";
import MsIcon from "./MsIcon.vue";

interface StatItem {
  value: string;
  badge: string;
  label: string;
  description: string;
  icon: IconName;
  link: string;
  actionText: string;
  accent: "emerald" | "indigo" | "cyan" | "amber";
  tags?: string[];
  metaLeft?: string;
  metaRight?: string;
}

const totalLintRules = languagesData.reduce((sum, lang) => sum + lang.ruleCount, 0);

// High-value, verified claims grounded in compiler architecture and real benchmarks
const stats = computed<StatItem[]>(() => [
  {
    value: String(LANGUAGE_COUNT),
    badge: "Unified",
    label: "Polyglot Formats",
    description: "Modelica, SysML v2, STEP CAD, SPICE, AUTOSAR, and FMI 3.0.",
    icon: "layers",
    link: "/languages/overview",
    actionText: "Catalog",
    accent: "emerald",
    tags: [".mo", ".sysml", ".step", ".cir", `+${LANGUAGE_COUNT - 4}`],
  },
  {
    value: totalLintRules.toLocaleString("en-US"),
    badge: "Pre-Flight",
    label: "Compiler Lint Rules",
    description: "Static diagnostics for DAE balance, connector topology & unit consistency.",
    icon: "shield",
    link: "/reference/linter-rules",
    actionText: "Rules",
    accent: "indigo",
    metaLeft: "Sound by construction",
    metaRight: "Pre-flight",
  },
  {
    value: "< 50ms",
    badge: "Cold Start",
    label: "End-to-End Compile",
    description: "Parses, indexes, flattens, and verifies 200+ coupled DAE equations from cold source.",
    icon: "gauge",
    link: "/architecture/glr-parser",
    actionText: "Pipeline",
    accent: "cyan",
    metaLeft: "200+ DAE equations",
    metaRight: "Zero GCC waits",
  },
  {
    value: "100%",
    badge: "Sovereign",
    label: "Air-Gapped & Offline",
    description: "Runs entirely on-device, in air-gapped enclaves, or local Slurm HPC. Zero cloud telemetry.",
    icon: "terminal",
    link: "/ansatz/overview",
    actionText: "Deploy",
    accent: "amber",
    metaLeft: "Browser · CLI · Slurm",
    metaRight: "NERC CIP ready",
  },
]);
</script>

<template>
  <section class="home-stats" aria-label="ModelScript at a glance">
    <div class="ms-container">
      <div class="bento-grid">
        <a
          v-for="item in stats"
          :key="item.label"
          :href="item.link"
          class="bento-card"
          :class="`bento-card--${item.accent}`"
        >
          <!-- Ambient glow backdrop -->
          <div class="bento-glow" aria-hidden="true" />

          <!-- Card Header: Icon & Action Link -->
          <div class="bento-header">
            <span class="bento-icon">
              <MsIcon :name="item.icon" :size="22" :duotone="true" />
            </span>
            <span class="bento-action">
              {{ item.actionText }}
              <MsIcon name="arrow-up-right" :size="13" class="bento-arrow" />
            </span>
          </div>

          <!-- Main Metric & Badge -->
          <div class="bento-metric-row">
            <span class="bento-value">{{ item.value }}</span>
            <span class="bento-badge">{{ item.badge }}</span>
          </div>

          <!-- Title & Description -->
          <div class="bento-body">
            <h3 class="bento-label">{{ item.label }}</h3>
            <p class="bento-desc">{{ item.description }}</p>
          </div>

          <!-- Footer: Micro Tags or Chips -->
          <div class="bento-footer">
            <div v-if="item.tags" class="bento-chips">
              <span
                v-for="tag in item.tags"
                :key="tag"
                class="bento-chip"
                :class="{ 'bento-chip--more': tag.startsWith('+') }"
              >
                {{ tag }}
              </span>
            </div>
            <div v-else class="bento-meta">
              <span class="bento-meta-left">{{ item.metaLeft }}</span>
              <span class="bento-meta-right">{{ item.metaRight }}</span>
            </div>
          </div>
        </a>
      </div>

      <!-- Elevated Licensing Bar -->
      <div class="stats-licensing">
        <span class="licensing-badge">Open Core · AGPL-3.0</span>
        <span class="licensing-text">
          Free and open source under AGPL-3.0 — with
          <a href="/pricing">Commercial OEM SDK &amp; Enterprise Appliance Licenses</a> available.
        </span>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-stats {
  position: relative;
  z-index: 2;
  padding: 12px 0 28px;
}

.bento-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

/* Individual Bento Card */
.bento-card {
  position: relative;
  display: flex;
  flex-direction: column;
  justify-content: space-between;
  padding: 22px 20px 18px;
  border-radius: 18px;
  border: 1px solid var(--ms-border-strong);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 82%, transparent);
  backdrop-filter: blur(14px) saturate(140%);
  -webkit-backdrop-filter: blur(14px) saturate(140%);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  box-shadow:
    0 12px 28px -12px rgba(2, 6, 23, 0.25),
    inset 0 1px 0 rgba(255, 255, 255, 0.06);
  transition:
    transform 0.25s cubic-bezier(0.16, 1, 0.3, 1),
    border-color 0.25s ease,
    box-shadow 0.25s ease,
    background-color 0.25s ease;
}

.bento-card:hover {
  transform: translateY(-2px);
  background-color: var(--vp-c-bg-elv);
}

/* Accent Color Tokens */
.bento-card--emerald {
  --bento-accent: #10b981;
  --bento-accent-bg: rgba(16, 185, 129, 0.12);
  --bento-accent-border: rgba(16, 185, 129, 0.32);
  --bento-glow: rgba(16, 185, 129, 0.18);
}

.bento-card--indigo {
  --bento-accent: #6366f1;
  --bento-accent-bg: rgba(99, 102, 241, 0.12);
  --bento-accent-border: rgba(99, 102, 241, 0.32);
  --bento-glow: rgba(99, 102, 241, 0.18);
}

.bento-card--cyan {
  --bento-accent: #06b6d4;
  --bento-accent-bg: rgba(6, 182, 212, 0.12);
  --bento-accent-border: rgba(6, 182, 212, 0.32);
  --bento-glow: rgba(6, 182, 212, 0.18);
}

.bento-card--amber {
  --bento-accent: #f59e0b;
  --bento-accent-bg: rgba(245, 158, 11, 0.12);
  --bento-accent-border: rgba(245, 158, 11, 0.32);
  --bento-glow: rgba(245, 158, 11, 0.18);
}

.bento-card:hover {
  border-color: var(--bento-accent-border);
  box-shadow:
    0 18px 36px -12px rgba(2, 6, 23, 0.35),
    0 0 24px -6px var(--bento-glow),
    inset 0 1px 0 rgba(255, 255, 255, 0.12);
}

/* Ambient glow bubble */
.bento-glow {
  position: absolute;
  top: -40px;
  right: -40px;
  width: 120px;
  height: 120px;
  border-radius: 999px;
  background: var(--bento-glow);
  filter: blur(28px);
  opacity: 0.5;
  transition: opacity 0.3s ease, transform 0.3s ease;
  pointer-events: none;
}

.bento-card:hover .bento-glow {
  opacity: 0.9;
  transform: scale(1.15);
}

/* Header */
.bento-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 14px;
}

.bento-icon {
  display: grid;
  place-items: center;
  width: 40px;
  height: 40px;
  border-radius: 12px;
  color: var(--bento-accent);
  background: var(--bento-accent-bg);
  border: 1px solid var(--bento-accent-border);
  transition: transform 0.25s ease;
}

.bento-card:hover .bento-icon {
  transform: scale(1.08);
}

.bento-action {
  display: inline-flex;
  align-items: center;
  gap: 3px;
  font-size: 11.5px;
  font-family: var(--ms-font-mono, monospace);
  font-weight: 550;
  color: var(--vp-c-text-3);
  transition: color 0.2s ease, transform 0.2s ease;
}

.bento-arrow {
  transition: transform 0.2s ease;
}

.bento-card:hover .bento-action {
  color: var(--bento-accent);
}

.bento-card:hover .bento-arrow {
  transform: translate(2px, -2px);
}

/* Metric Row */
.bento-metric-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  margin-bottom: 8px;
}

.bento-value {
  font-size: 2.15rem;
  font-weight: 800;
  line-height: 1;
  letter-spacing: -0.035em;
  font-variant-numeric: tabular-nums;
  color: var(--vp-c-text-1);
  transition: color 0.2s ease;
}

.bento-card:hover .bento-value {
  color: var(--bento-accent);
}

.bento-badge {
  display: inline-flex;
  align-items: center;
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 650;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: var(--bento-accent);
  background: var(--bento-accent-bg);
  border: 1px solid var(--bento-accent-border);
}

/* Label & Description */
.bento-body {
  flex-grow: 1;
}

.bento-label {
  margin: 0;
  font-size: 0.94rem;
  font-weight: 680;
  color: var(--vp-c-text-1);
  letter-spacing: -0.01em;
}

.bento-desc {
  margin: 5px 0 0;
  font-size: 0.81rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

/* Footer: Chips & Meta */
.bento-footer {
  margin-top: 16px;
  padding-top: 12px;
  border-top: 1px solid color-mix(in srgb, var(--vp-c-divider) 70%, transparent);
}

.bento-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
}

.bento-chip {
  padding: 2px 6px;
  border-radius: 6px;
  font-size: 10.5px;
  font-family: var(--ms-font-mono, monospace);
  font-weight: 550;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, var(--vp-c-bg) 60%, transparent);
  border: 1px solid var(--vp-c-divider);
}

.bento-chip--more {
  color: var(--bento-accent);
  background: var(--bento-accent-bg);
  border-color: var(--bento-accent-border);
  font-weight: 700;
}

.bento-meta {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 11px;
  font-family: var(--ms-font-mono, monospace);
  color: var(--vp-c-text-3);
}

.bento-meta-left {
  color: var(--bento-accent);
  font-weight: 600;
}

/* Licensing Sub-bar */
.stats-licensing {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 10px;
  margin-top: 16px;
  padding: 10px 16px;
  border-radius: 12px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 50%, transparent);
  border: 1px solid var(--vp-c-divider);
  font-size: 12px;
  color: var(--vp-c-text-2);
  text-align: center;
}

.licensing-badge {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 700;
  letter-spacing: 0.04em;
  text-transform: uppercase;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border: 1px solid color-mix(in srgb, var(--vp-c-brand-1) 35%, transparent);
}

.licensing-text a {
  color: var(--vp-c-text-1);
  font-weight: 600;
  text-decoration: underline;
  text-underline-offset: 3px;
}

.licensing-text a:hover {
  color: var(--vp-c-brand-1);
}

/* Responsive Breakpoints */
@media (max-width: 1024px) {
  .bento-grid {
    grid-template-columns: repeat(2, 1fr);
    gap: 14px;
  }
}

@media (max-width: 580px) {
  .bento-grid {
    grid-template-columns: 1fr;
    gap: 12px;
  }

  .bento-card {
    padding: 18px 16px;
  }
}
</style>
