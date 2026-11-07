<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { LANGUAGES, TIER_LABELS } from "../data/languages";

const half = Math.ceil(LANGUAGES.length / 2);
const rowA = LANGUAGES.slice(0, half);
const rowB = LANGUAGES.slice(half);
</script>

<template>
  <section class="format-strip" aria-label="Supported languages and formats">
    <p class="strip-label">Reads, checks, and simulates the formats your teams already use</p>
    <div class="marquee">
      <div class="track">
        <template v-for="copy in 2" :key="copy">
          <a
            v-for="l in rowA"
            :key="`${copy}-${l.slug}`"
            :href="`/languages/${l.slug}`"
            class="chip"
            :title="`${l.name} (${l.ext}) — ${TIER_LABELS[l.tier]}`"
            :tabindex="copy === 2 ? -1 : 0"
            :aria-hidden="copy === 2 ? 'true' : undefined"
          >
            <span class="chip-ext">{{ l.ext }}</span>
            <span>{{ l.name }}</span>
            <span class="chip-tier" :class="`chip-tier--${l.tier}`">{{ TIER_LABELS[l.tier] }}</span>
          </a>
        </template>
      </div>
    </div>
    <div class="marquee reverse">
      <div class="track">
        <template v-for="copy in 2" :key="copy">
          <a
            v-for="l in rowB"
            :key="`${copy}-${l.slug}`"
            :href="`/languages/${l.slug}`"
            class="chip"
            :title="`${l.name} (${l.ext}) — ${TIER_LABELS[l.tier]}`"
            :tabindex="copy === 2 ? -1 : 0"
            :aria-hidden="copy === 2 ? 'true' : undefined"
          >
            <span class="chip-ext">{{ l.ext }}</span>
            <span>{{ l.name }}</span>
            <span class="chip-tier" :class="`chip-tier--${l.tier}`">{{ TIER_LABELS[l.tier] }}</span>
          </a>
        </template>
      </div>
    </div>
  </section>
</template>

<style scoped>
.format-strip {
  padding: 40px 0 24px;
  overflow: hidden;
}

.strip-label {
  margin: 0 0 20px;
  text-align: center;
  font-size: 13px;
  font-weight: 500;
  letter-spacing: 0.02em;
  color: var(--vp-c-text-3);
}

.marquee {
  position: relative;
  overflow: hidden;
  padding: 6px 0;
  mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
  -webkit-mask-image: linear-gradient(90deg, transparent, #000 10%, #000 90%, transparent);
}

.track {
  display: flex;
  gap: 10px;
  width: max-content;
  animation: scroll 70s linear infinite;
}

.marquee.reverse .track {
  animation-direction: reverse;
  animation-duration: 80s;
}

.marquee:hover .track {
  animation-play-state: paused;
}

.chip {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px 8px 8px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-size: 13.5px;
  font-weight: 550;
  color: var(--vp-c-text-1);
  white-space: nowrap;
  text-decoration: none;
  transition:
    border-color 0.2s,
    color 0.2s;
}

.chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.chip-ext {
  padding: 2px 8px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.chip-tier {
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid transparent;
}
.chip-tier--stable {
  color: var(--ms-tier-stable);
  background: var(--ms-tier-stable-bg);
  border-color: var(--ms-tier-stable-border);
}
.chip-tier--beta {
  color: var(--ms-tier-beta);
  background: var(--ms-tier-beta-bg);
  border-color: var(--ms-tier-beta-border);
}
.chip-tier--preview {
  color: var(--ms-tier-preview);
  background: var(--ms-tier-preview-bg);
  border-color: var(--ms-tier-preview-border);
}

@keyframes scroll {
  from {
    transform: translateX(0);
  }
  to {
    transform: translateX(-50%);
  }
}

@media (prefers-reduced-motion: reduce) {
  .track {
    animation: none;
    flex-wrap: wrap;
    width: auto;
    justify-content: center;
  }

  .chip[aria-hidden="true"] {
    display: none;
  }
}
</style>

