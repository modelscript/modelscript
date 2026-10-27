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
          <div class="ind-head">
            <span class="ind-icon"><MsIcon :name="ind.icon" :size="24" :duotone="true" /></span>
            <span class="ind-count">{{ ind.languages.length }} formats</span>
          </div>
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
  background: linear-gradient(180deg, color-mix(in srgb, var(--vp-c-bg-soft) 92%, transparent), var(--vp-c-bg));
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  text-decoration: none;
  color: inherit;
  overflow: hidden;
  isolation: isolate;
  transition:
    transform 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

.ind-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 55%, transparent), transparent);
  opacity: 0.45;
  transition: opacity 0.3s ease;
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
  box-shadow:
    0 24px 48px -24px color-mix(in srgb, var(--accent) 50%, transparent),
    inset 0 1px 0 rgba(255, 255, 255, 0.08);
}

.ind-card:hover::before {
  opacity: 1;
}

.ind-card:hover .ind-glow {
  opacity: 1;
}

.ind-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
}

.ind-icon {
  display: grid;
  place-items: center;
  width: 50px;
  height: 50px;
  border-radius: 14px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 68%),
    radial-gradient(circle at 80% 85%, rgba(129, 140, 248, 0.16), transparent 68%),
    color-mix(in srgb, var(--accent) 10%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.16),
    0 10px 22px -10px color-mix(in srgb, var(--accent) 55%, transparent);
  transition:
    transform 0.3s ease,
    border-color 0.3s ease,
    box-shadow 0.3s ease;
}

.ind-card:hover .ind-icon {
  transform: scale(1.06) translateY(-1px);
  border-color: color-mix(in srgb, var(--accent) 60%, transparent);
}

.ind-count {
  padding: 3px 9px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 550;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.ind-name {
  margin: 18px 0 6px;
  font-size: 1.04rem;
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
