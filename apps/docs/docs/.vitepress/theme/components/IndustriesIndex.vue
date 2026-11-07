<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { ref } from "vue";
import { INDUSTRIES, INDUSTRY_GROUPS, type IndustryGroupId } from "../data/industries";
import { LANGUAGE_COUNT } from "../data/languages";
import HomeIndustries from "./HomeIndustries.vue";
import MsIcon from "./MsIcon.vue";

const activeGroup = ref<IndustryGroupId | "all">("all");

function countForGroup(id: IndustryGroupId): number {
  return INDUSTRIES.filter((i) => i.group === id).length;
}
</script>

<template>
  <div class="ind-index">
    <section class="idx-hero">
      <div class="idx-grid-bg" aria-hidden="true" />
      <div class="ms-container idx-inner">
        <span class="ms-eyebrow">Industries</span>
        <h1 class="idx-title">Engineering simulation for every domain, connected</h1>
        <p class="idx-lead">
          ModelScript reads {{ LANGUAGE_COUNT }} languages and formats across {{ INDUSTRIES.length }} industries and
          links them through one open, computable digital thread. Pick your domain to see the formats, standards, and
          workflows we support.
        </p>
        <div class="idx-actions">
          <a class="ms-btn ms-btn-lg ms-btn-brand" href="/languages/overview">
            Browse all languages <MsIcon name="arrowRight" :size="16" :stroke="2" />
          </a>
          <a class="ms-btn ms-btn-lg ms-btn-ghost" href="/guide/getting-started">Get started</a>
        </div>

        <div class="idx-filters" role="tablist" aria-label="Filter industries by sector">
          <button
            type="button"
            role="tab"
            class="idx-filter"
            :class="{ active: activeGroup === 'all' }"
            :aria-selected="activeGroup === 'all'"
            @click="activeGroup = 'all'"
          >
            <span>All sectors</span>
            <span class="idx-filter-count">{{ INDUSTRIES.length }}</span>
          </button>
          <button
            v-for="g in INDUSTRY_GROUPS"
            :key="g.id"
            type="button"
            role="tab"
            class="idx-filter"
            :class="{ active: activeGroup === g.id }"
            :aria-selected="activeGroup === g.id"
            @click="activeGroup = g.id"
          >
            <span class="idx-filter-code">{{ g.code }}</span>
            <span>{{ g.label }}</span>
            <span class="idx-filter-count">{{ countForGroup(g.id) }}</span>
          </button>
        </div>
      </div>
    </section>
    <HomeIndustries :heading="false" :group-filter="activeGroup" />
  </div>
</template>

<style scoped>
.idx-hero {
  position: relative;
  overflow: hidden;
  padding: 80px 0 20px;
  text-align: center;
}

.idx-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    radial-gradient(ellipse 55% 60% at 70% 35%, var(--ms-glow-cyan), transparent 70%),
    radial-gradient(ellipse 45% 50% at 25% 25%, var(--ms-glow-indigo), transparent 70%),
    linear-gradient(var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(var(--ms-grid-sub) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-sub) 1px, transparent 1px);
  background-size:
    100% 100%,
    100% 100%,
    64px 64px,
    64px 64px,
    16px 16px,
    16px 16px;
  mask-image: radial-gradient(ellipse 80% 80% at 50% 25%, #000 35%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 80% 80% at 50% 25%, #000 35%, transparent 78%);
  pointer-events: none;
}

.idx-inner {
  position: relative;
  max-width: 920px;
}

.idx-title {
  margin: 0 0 18px;
  font-size: clamp(2rem, 4.6vw, 3.4rem);
  line-height: 1.08;
  font-weight: 760;
  letter-spacing: -0.028em;
  color: var(--vp-c-text-1);
}

.idx-lead {
  margin: 0 auto;
  max-width: 680px;
  font-size: 1.08rem;
  line-height: 1.65;
  color: var(--vp-c-text-2);
}

.idx-actions {
  display: flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 12px;
  margin-top: 32px;
}

.idx-filters {
  display: inline-flex;
  flex-wrap: wrap;
  justify-content: center;
  gap: 6px;
  margin-top: 36px;
  padding: 5px;
  border-radius: 14px;
  background: color-mix(in srgb, var(--vp-c-bg-soft) 88%, transparent);
  border: 1px solid var(--vp-c-divider);
  backdrop-filter: blur(10px);
}

.idx-filter {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 7px 13px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition:
    color 0.2s ease,
    background 0.2s ease,
    border-color 0.2s ease,
    box-shadow 0.2s ease;
}

.idx-filter:hover {
  color: var(--vp-c-text-1);
}

.idx-filter.active {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border-color: color-mix(in srgb, var(--vp-c-brand-1) 35%, var(--vp-c-divider));
  box-shadow: 0 2px 8px -2px rgba(15, 23, 42, 0.08);
}

.idx-filter-code {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 700;
  color: var(--vp-c-brand-1);
}

.idx-filter-count {
  padding: 1px 6px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg-soft);
}

.idx-filter.active .idx-filter-count {
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.ind-index :deep(.home-industries) {
  padding-top: 40px;
}
</style>
