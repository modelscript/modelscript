<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import benchmarksData from "../data/benchmarks.generated.json";
import { LANGUAGE_COUNT } from "../data/languages";
import MsIcon from "./MsIcon.vue";

const { passedCases, totalCases, overallPassRate } = benchmarksData.aggregate;
</script>

<template>
  <section class="home-whats-new" aria-label="Latest release highlights">
    <div class="ms-container">
      <div class="whats-new-bar">
        <a
          class="whats-new-pill"
          href="https://github.com/modelscript/modelscript/releases"
          target="_blank"
          rel="noopener noreferrer"
        >
          <span class="whats-new-dot" aria-hidden="true" />
          <span class="whats-new-version">v0.1.0</span>
          <span class="whats-new-tag">What’s New</span>
        </a>

        <p class="whats-new-summary">
          <strong>{{ LANGUAGE_COUNT }} polyglot formats</strong>
          <span class="whats-new-sep" aria-hidden="true">·</span>
          <span>
            <strong>{{ overallPassRate }}%</strong> benchmark parity ({{ passedCases }}/{{ totalCases }} cases)
          </span>
          <span class="whats-new-sep" aria-hidden="true">·</span>
          <span>Ansatz Studio, VR 3D panels &amp; FMI 3.0 co-simulation</span>
        </p>

        <div class="whats-new-actions">
          <a class="whats-new-link" href="/guide/getting-started">
            Quickstart <MsIcon name="arrowRight" :size="13" />
          </a>
          <a
            class="whats-new-link whats-new-link--muted"
            href="https://github.com/modelscript/modelscript/releases"
            target="_blank"
            rel="noopener noreferrer"
          >
            Release notes <MsIcon name="arrow-up-right" :size="13" />
          </a>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-whats-new {
  position: relative;
  z-index: 2;
  padding: 4px 0 8px;
}

.whats-new-bar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px 18px;
  padding: 10px 16px;
  border-radius: 14px;
  border: 1px solid var(--ms-border-strong);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 86%, transparent);
  backdrop-filter: blur(12px);
  -webkit-backdrop-filter: blur(12px);
}

.whats-new-pill {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 4px 10px 4px 8px;
  border-radius: 999px;
  border: 1px solid rgba(16, 185, 129, 0.32);
  background: rgba(16, 185, 129, 0.12);
  text-decoration: none;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  transition: border-color 0.2s ease, background-color 0.2s ease;
}

.whats-new-pill:hover {
  border-color: rgba(16, 185, 129, 0.55);
  background: rgba(16, 185, 129, 0.18);
}

.whats-new-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
  background: #10b981;
  box-shadow: 0 0 0 3px rgba(16, 185, 129, 0.2);
}

.whats-new-version {
  font-family: var(--vp-font-family-mono);
  color: #10b981;
}

.whats-new-tag {
  color: var(--vp-c-text-2);
  font-weight: 500;
}

.whats-new-summary {
  margin: 0;
  flex: 1 1 320px;
  font-size: 13.5px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.whats-new-summary strong {
  color: var(--vp-c-text-1);
  font-weight: 600;
}

.whats-new-sep {
  margin: 0 8px;
  color: var(--vp-c-text-3);
}

.whats-new-actions {
  display: inline-flex;
  align-items: center;
  gap: 14px;
}

.whats-new-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  white-space: nowrap;
}

.whats-new-link:hover {
  text-decoration: underline;
}

.whats-new-link--muted {
  color: var(--vp-c-text-2);
  font-weight: 500;
}

@media (max-width: 760px) {
  .whats-new-bar {
    flex-direction: column;
    align-items: flex-start;
  }

  .whats-new-summary {
    flex-basis: auto;
  }
}
</style>
