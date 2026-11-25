<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { withBase } from "vitepress";
import {
  LANGUAGES,
  PLATFORM_GROUPS,
  TIER_COUNTS,
  TIER_LABELS,
  type LanguageGroupId,
  type LanguageMaturityTier,
} from "../data/languages";
import MsIcon from "./MsIcon.vue";

interface FilterChip {
  id: "all" | LanguageGroupId;
  label: string;
  count: number;
}

const DEFAULT_VISIBLE = 12;

const activeGroup = ref<"all" | LanguageGroupId>("all");
const activeTier = ref<"all" | LanguageMaturityTier>("all");
const query = ref("");
const showAll = ref(false);

const industryGroupLabels: Partial<Record<LanguageGroupId, string>> = {
  power: "Power & Grid",
  aerospace: "Aerospace",
  automotive: "Automotive",
  electronics: "Electronics",
  process: "Chemical & Process",
  buildings: "Buildings & Water",
  "life-sciences": "Life Sciences & Medical",
  nuclear: "Nuclear",
  "oil-gas": "Oil & Gas",
  marine: "Marine",
  rail: "Rail",
  robotics: "Robotics & PLC",
};

const domainChips = computed<FilterChip[]>(() => {
  const counts = new Map<LanguageGroupId, number>();
  for (const l of LANGUAGES) {
    counts.set(l.group, (counts.get(l.group) ?? 0) + 1);
  }
  const list: FilterChip[] = [{ id: "all", label: "All Domains", count: LANGUAGES.length }];
  for (const g of PLATFORM_GROUPS) {
    const c = counts.get(g.id) ?? 0;
    if (c > 0) list.push({ id: g.id, label: g.label, count: c });
  }
  for (const [id, label] of Object.entries(industryGroupLabels) as [LanguageGroupId, string][]) {
    const c = counts.get(id) ?? 0;
    if (c > 0) list.push({ id, label, count: c });
  }
  return list;
});

const tierChips = computed(() => [
  { id: "all" as const, label: "All Tiers", count: LANGUAGES.length },
  { id: "beta" as const, label: "Beta", count: TIER_COUNTS.beta },
  { id: "alpha" as const, label: "Alpha", count: TIER_COUNTS.alpha },
  { id: "pre-alpha" as const, label: "Pre-Alpha", count: TIER_COUNTS["pre-alpha"] },
]);

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return LANGUAGES.filter((l) => {
    if (activeGroup.value !== "all" && l.group !== activeGroup.value) return false;
    if (activeTier.value !== "all" && l.tier !== activeTier.value) return false;
    if (!q) return true;
    return (
      l.name.toLowerCase().includes(q) ||
      l.slug.toLowerCase().includes(q) ||
      l.ext.toLowerCase().includes(q) ||
      l.role.toLowerCase().includes(q) ||
      l.tier.toLowerCase().includes(q)
    );
  });
});

const visibleLanguages = computed(() =>
  showAll.value ? filtered.value : filtered.value.slice(0, DEFAULT_VISIBLE),
);

const hasMore = computed(() => filtered.value.length > DEFAULT_VISIBLE);

function selectGroup(id: "all" | LanguageGroupId) {
  activeGroup.value = id;
  showAll.value = false;
}

function selectTier(id: "all" | LanguageMaturityTier) {
  activeTier.value = id;
  showAll.value = false;
}

function resetFilters() {
  query.value = "";
  activeGroup.value = "all";
  activeTier.value = "all";
  showAll.value = false;
}
</script>

<template>
  <section class="format-explorer" aria-label="Supported languages and formats">
    <div class="ms-container">
      <div class="ms-section-head">
        <span class="ms-eyebrow">Polyglot Catalog</span>
        <h2 class="ms-h2">Reads, checks, and simulates {{ LANGUAGES.length }} engineering formats</h2>
        <p class="ms-lead">
          Search by format name, file extension, maturity tier, or engineering domain.
        </p>
      </div>

      <div class="fe-toolbar">
        <div class="fe-top-row">
          <div class="fe-search">
            <MsIcon name="search" :size="16" class="fe-search-icon" />
            <input
              v-model="query"
              type="search"
              :placeholder="`Search ${LANGUAGES.length} languages (e.g. .mo, SysML, STEP, SPICE, OpenDSS)…`"
              aria-label="Filter languages and formats"
            />
          </div>

          <div class="fe-tiers" role="tablist" aria-label="Filter by maturity tier">
            <button
              v-for="t in tierChips"
              :key="t.id"
              type="button"
              role="tab"
              :aria-selected="activeTier === t.id"
              class="fe-tier-btn"
              :class="[`fe-tier-btn--${t.id}`, { active: activeTier === t.id }]"
              @click="selectTier(t.id)"
            >
              <span v-if="t.id !== 'all'" class="fe-tier-dot" :class="`fe-tier-dot--${t.id}`" />
              <span>{{ t.label }}</span>
              <span class="fe-count">{{ t.count }}</span>
            </button>
          </div>
        </div>

        <div class="fe-domains" role="tablist" aria-label="Filter by domain cluster">
          <button
            v-for="c in domainChips"
            :key="c.id"
            type="button"
            role="tab"
            :aria-selected="activeGroup === c.id"
            class="fe-chip"
            :class="{ active: activeGroup === c.id }"
            @click="selectGroup(c.id)"
          >
            <span>{{ c.label }}</span>
            <span class="fe-count">{{ c.count }}</span>
          </button>
        </div>
      </div>

      <div v-if="visibleLanguages.length" class="fe-grid">
        <a
          v-for="l in visibleLanguages"
          :key="l.slug"
          :href="withBase(`/languages/${l.slug}`)"
          class="fe-card"
        >
          <div class="fe-card-top">
            <span class="fe-name">{{ l.name }}</span>
            <div class="fe-badges">
              <span class="fe-tier" :class="`fe-tier--${l.tier}`">{{ TIER_LABELS[l.tier] }}</span>
              <code class="fe-ext">{{ l.ext }}</code>
            </div>
          </div>
          <p class="fe-role">{{ l.role }}</p>
        </a>
      </div>

      <div v-else class="fe-empty">
        <p>No languages match "{{ query }}" with the current filters.</p>
        <button type="button" class="ms-btn ms-btn-ghost" @click="resetFilters">Reset filters</button>
      </div>

      <div class="fe-footer">
        <button
          v-if="hasMore"
          type="button"
          class="ms-btn ms-btn-ghost"
          @click="showAll = !showAll"
        >
          {{ showAll ? "Show fewer" : `Show all ${filtered.length} matching formats` }}
        </button>
        <a class="fe-catalog-link" :href="withBase('/languages/overview')">
          Explore full catalog <MsIcon name="arrowRight" :size="14" />
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.format-explorer {
  padding: 56px 0 40px;
}

.format-explorer .ms-section-head {
  margin-bottom: 28px;
}

.fe-toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.fe-top-row {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 12px;
}

.fe-search {
  flex: 1 1 320px;
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 0 14px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 12px;
  background: var(--vp-c-bg-soft);
  transition: border-color 0.2s ease;
}

.fe-search:focus-within {
  border-color: var(--vp-c-brand-1);
}

.fe-search-icon {
  color: var(--vp-c-text-3);
  flex-shrink: 0;
}

.fe-search input {
  width: 100%;
  border: none;
  outline: none;
  background: transparent;
  padding: 10px 0;
  font-size: 14px;
  color: var(--vp-c-text-1);
}

.fe-tiers,
.fe-domains {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.fe-tier-btn,
.fe-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 11px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 999px;
  background: var(--vp-c-bg-soft);
  font-size: 12.5px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition:
    border-color 0.15s ease,
    color 0.15s ease,
    background-color 0.15s ease;
}

.fe-tier-btn:hover,
.fe-chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}

.fe-tier-btn.active,
.fe-chip.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
  font-weight: 600;
}

.fe-tier-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}

.fe-tier-dot--beta {
  background: var(--ms-tier-beta);
}
.fe-tier-dot--alpha {
  background: var(--ms-tier-alpha);
}
.fe-tier-dot--pre-alpha {
  background: var(--ms-tier-pre-alpha);
}

.fe-count {
  font-size: 11px;
  opacity: 0.72;
}

.fe-grid {
  display: grid;
  grid-template-columns: repeat(3, minmax(0, 1fr));
  gap: 12px;
}

.fe-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 14px;
  background: var(--vp-c-bg-soft);
  text-decoration: none;
  color: inherit;
  transition:
    border-color 0.18s ease,
    transform 0.18s ease,
    background-color 0.18s ease;
}

.fe-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-elv);
  transform: translateY(-1px);
}

.fe-card-top {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  gap: 8px;
}

.fe-name {
  font-size: 14.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  line-height: 1.3;
}

.fe-badges {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.fe-tier {
  font-size: 10.5px;
  font-weight: 600;
  padding: 2px 7px;
  border-radius: 999px;
  border: 1px solid transparent;
}

.fe-tier--beta {
  color: var(--ms-tier-beta);
  background: var(--ms-tier-beta-bg);
  border-color: var(--ms-tier-beta-border);
}

.fe-tier--alpha {
  color: var(--ms-tier-alpha);
  background: var(--ms-tier-alpha-bg);
  border-color: var(--ms-tier-alpha-border);
}

.fe-tier--pre-alpha {
  color: var(--ms-tier-pre-alpha);
  background: var(--ms-tier-pre-alpha-bg);
  border-color: var(--ms-tier-pre-alpha-border);
}

.fe-ext {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  padding: 2px 6px;
  border-radius: 6px;
  background: var(--vp-c-bg-alt);
  color: var(--vp-c-text-2);
  max-width: 110px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.fe-role {
  margin: 0;
  font-size: 13px;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.fe-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  padding: 36px 24px;
  border: 1px dashed var(--vp-c-divider);
  border-radius: 14px;
  text-align: center;
  color: var(--vp-c-text-2);
}

.fe-empty p {
  margin: 0;
}

.fe-footer {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: center;
  gap: 16px;
  margin-top: 20px;
}

.fe-catalog-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  font-size: 13.5px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.fe-catalog-link:hover {
  text-decoration: underline;
}

@media (max-width: 960px) {
  .fe-grid {
    grid-template-columns: repeat(2, minmax(0, 1fr));
  }
}

@media (max-width: 600px) {
  .fe-grid {
    grid-template-columns: 1fr;
  }
}
</style>
