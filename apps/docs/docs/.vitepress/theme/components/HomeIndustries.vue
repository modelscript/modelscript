<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { INDUSTRIES } from "../data/industries";
import { LANGUAGE_BY_SLUG } from "../data/languages";
import MsIcon from "./MsIcon.vue";

withDefaults(defineProps<{ heading?: boolean; level?: "h1" | "h2" }>(), { heading: true, level: "h2" });

function formats(slugs: string[]): string[] {
  return slugs
    .slice(0, 3)
    .map((s) => LANGUAGE_BY_SLUG[s]?.name)
    .filter((n): n is string => !!n);
}
</script>

<template>
  <section class="ms-section home-industries">
    <div class="ms-container">
      <header v-if="heading" class="ms-section-head">
        <span class="ms-eyebrow">Industries</span>
        <component :is="level" class="ms-h2">Built for the way your industry engineers</component>
        <p class="ms-lead">
          Domain formats, standards, and verification workflows, all connected in one open digital thread.
        </p>
      </header>

      <div class="ind-grid">
        <a
          v-for="ind in INDUSTRIES"
          :key="ind.slug"
          :href="`/industries/${ind.slug}`"
          class="ind-card"
          :style="{ '--accent': ind.accent }"
        >
          <span class="ind-glow" aria-hidden="true" />
          <span class="ind-icon"><MsIcon :name="ind.icon" :size="20" /></span>
          <h3 class="ind-name">{{ ind.name }}</h3>
          <p class="ind-tag">{{ ind.tagline }}</p>
          <span class="ind-formats">
            <span v-for="f in formats(ind.languages)" :key="f" class="ind-fmt">{{ f }}</span>
          </span>
          <span class="ind-more">Explore <MsIcon name="arrowRight" :size="14" :stroke="2" /></span>
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.ind-grid {
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
}

.ind-card {
  position: relative;
  display: flex;
  flex-direction: column;
  padding: 24px;
  border-radius: 18px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  isolation: isolate;
  transition:
    transform 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

.ind-glow {
  position: absolute;
  inset: auto -40% -60% auto;
  width: 220px;
  height: 220px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 35%, transparent), transparent 70%);
  opacity: 0;
  transition: opacity 0.35s ease;
  z-index: -1;
}

.ind-card:hover {
  transform: translateY(-4px);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 24px 48px -24px color-mix(in srgb, var(--accent) 50%, transparent);
}

.ind-card:hover .ind-glow {
  opacity: 1;
}

.ind-icon {
  display: grid;
  place-items: center;
  width: 42px;
  height: 42px;
  border-radius: 12px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 13%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.ind-name {
  margin: 18px 0 6px;
  font-size: 1.02rem;
  font-weight: 680;
  line-height: 1.3;
  color: var(--vp-c-text-1);
}

.ind-tag {
  margin: 0;
  font-size: 0.86rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.ind-formats {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-top: 16px;
}

.ind-fmt {
  padding: 2px 8px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 550;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.ind-more {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  margin-top: auto;
  padding-top: 18px;
  font-size: 13px;
  font-weight: 600;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  transition: gap 0.2s;
}

.ind-card:hover .ind-more {
  gap: 10px;
}

@media (max-width: 1100px) {
  .ind-grid {
    grid-template-columns: repeat(3, 1fr);
  }
}

@media (max-width: 820px) {
  .ind-grid {
    grid-template-columns: repeat(2, 1fr);
  }
}

@media (max-width: 520px) {
  .ind-grid {
    grid-template-columns: 1fr;
  }
}
</style>
