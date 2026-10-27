<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { INDUSTRIES } from "../data/industries";
import { LANGUAGES, PLATFORM_GROUPS, type LanguageGroupId } from "../data/languages";
import MsIcon from "./MsIcon.vue";

const query = ref("");
const filter = ref<"all" | string>("all");

/** Filter chips: platform groups + industries (industry filter matches every language the industry lists). */
const chips = computed(() => [
  { id: "all", label: `All (${LANGUAGES.length})` },
  ...PLATFORM_GROUPS.map((g) => ({ id: `group:${g.id}`, label: g.label })),
  ...INDUSTRIES.map((i) => ({ id: `industry:${i.slug}`, label: i.name })),
]);

function inFilter(slug: string, group: LanguageGroupId): boolean {
  const f = filter.value;
  if (f === "all") return true;
  if (f.startsWith("group:")) return group === f.slice(6);
  const ind = INDUSTRIES.find((i) => `industry:${i.slug}` === f);
  return !!ind && ind.languages.includes(slug);
}

const results = computed(() => {
  const q = query.value.trim().toLowerCase();
  return LANGUAGES.filter((l) => {
    if (!inFilter(l.slug, l.group)) return false;
    if (!q) return true;
    return [l.name, l.ext, l.role, l.slug].some((s) => s.toLowerCase().includes(q));
  });
});

function industriesFor(slug: string): { name: string; accent: string }[] {
  return INDUSTRIES.filter((i) => i.languages.includes(slug))
    .slice(0, 3)
    .map((i) => ({ name: i.name, accent: i.accent }));
}
</script>

<template>
  <div class="lx">
    <div class="lx-search">
      <MsIcon name="search" :size="16" class="lx-search-icon" />
      <input
        id="language-explorer-search"
        v-model="query"
        type="search"
        placeholder="Search languages, extensions, or domains (e.g. .raw, multibody, EMT)"
        aria-label="Search languages"
      />
      <span class="lx-count">{{ results.length }} / {{ LANGUAGES.length }}</span>
    </div>

    <div class="lx-chips" role="group" aria-label="Filter by group or industry">
      <button
        v-for="c in chips"
        :key="c.id"
        type="button"
        class="lx-chip"
        :class="{ active: filter === c.id }"
        :aria-pressed="filter === c.id"
        @click="filter = c.id"
      >
        {{ c.label }}
      </button>
    </div>

    <div v-if="results.length" class="lx-grid">
      <a v-for="l in results" :key="l.slug" :href="`/languages/${l.slug}`" class="lx-card">
        <span class="lx-top">
          <span class="lx-ext">{{ l.ext }}</span>
          <code class="lx-pkg">@modelscript/{{ l.slug }}</code>
        </span>
        <span class="lx-name">{{ l.name }}</span>
        <span class="lx-role">{{ l.role }}</span>
        <span class="lx-inds">
          <span v-for="ind in industriesFor(l.slug)" :key="ind.name" class="lx-ind" :style="{ '--accent': ind.accent }">
            {{ ind.name }}
          </span>
        </span>
      </a>
    </div>
    <p v-else class="lx-empty">No languages match “{{ query }}”.</p>
  </div>
</template>

<style scoped>
.lx {
  margin: 24px 0 40px;
}

.lx-search {
  position: relative;
  display: flex;
  align-items: center;
}

.lx-search-icon {
  position: absolute;
  left: 14px;
  color: var(--vp-c-text-3);
}

.lx-search input {
  width: 100%;
  height: 44px;
  padding: 0 80px 0 40px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  font-size: 14px;
  color: var(--vp-c-text-1);
  transition: border-color 0.2s;
}

.lx-search input:focus {
  outline: none;
  border-color: var(--vp-c-brand-1);
}

.lx-count {
  position: absolute;
  right: 14px;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  color: var(--vp-c-text-3);
}

.lx-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin: 14px 0 20px;
}

.lx-chip {
  padding: 5px 12px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  transition:
    border-color 0.2s,
    color 0.2s,
    background 0.2s;
}

.lx-chip:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-border);
}

.lx-chip.active {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.lx-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(230px, 1fr));
  gap: 12px;
}

.lx-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none !important;
  color: inherit;
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.lx-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.lx-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.lx-ext {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

.lx-pkg {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 10.5px !important;
  color: var(--vp-c-text-3) !important;
  background: none !important;
  padding: 0 !important;
}

.lx-name {
  margin-top: 8px;
  font-size: 0.95rem;
  font-weight: 650;
  color: var(--vp-c-text-1);
}

.lx-role {
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.lx-inds {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 8px;
}

.lx-ind {
  padding: 1px 7px;
  border-radius: 999px;
  font-size: 10.5px;
  font-weight: 550;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.lx-empty {
  padding: 24px;
  text-align: center;
  color: var(--vp-c-text-2);
}
</style>
