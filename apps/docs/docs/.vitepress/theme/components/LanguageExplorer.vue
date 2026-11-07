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
import { INDUSTRIES } from "../data/industries";

interface FilterChip {
  id: "all" | LanguageGroupId;
  label: string;
  count: number;
}

const activeGroup = ref<"all" | LanguageGroupId>("all");
const activeTier = ref<"all" | LanguageMaturityTier>("all");
const query = ref("");

const industryGroupLabels: Partial<Record<LanguageGroupId, string>> = {
  aerospace: "Aerospace",
  automotive: "Automotive",
  rail: "Rail",
  power: "Power & Grid",
  "oil-gas": "Oil & Gas",
  nuclear: "Nuclear",
  marine: "Marine",
  electronics: "Electronics",
  robotics: "Robotics & PLC",
  buildings: "Buildings & Water",
  process: "Chemical & Process",
  "life-sciences": "Life Sciences & Medical",
};

const chips = computed<FilterChip[]>(() => {
  const counts = new Map<LanguageGroupId, number>();
  for (const l of LANGUAGES) {
    counts.set(l.group, (counts.get(l.group) ?? 0) + 1);
  }
  const list: FilterChip[] = [{ id: "all", label: "All", count: LANGUAGES.length }];
  for (const g of PLATFORM_GROUPS) {
    list.push({ id: g.id, label: g.label, count: counts.get(g.id) ?? 0 });
  }
  for (const [id, label] of Object.entries(industryGroupLabels) as [LanguageGroupId, string][]) {
    const c = counts.get(id) ?? 0;
    if (c > 0) list.push({ id, label, count: c });
  }
  return list;
});

const tierChips = computed(() => [
  { id: "all" as const, label: "All Tiers", count: LANGUAGES.length },
  { id: "stable" as const, label: "Stable", count: TIER_COUNTS.stable },
  { id: "beta" as const, label: "Beta", count: TIER_COUNTS.beta },
  { id: "preview" as const, label: "Preview", count: TIER_COUNTS.preview },
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

// Quick lookup: which industries list a given language.
const industriesByLang = computed(() => {
  const map = new Map<string, string[]>();
  for (const ind of INDUSTRIES) {
    for (const slug of ind.languages) {
      const arr = map.get(slug) ?? [];
      arr.push(ind.name);
      map.set(slug, arr);
    }
  }
  return map;
});
</script>

<template>
  <div class="le">
    <div class="le-toolbar">
      <div class="le-search">
        <svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="7" />
          <path d="m20 20-3.5-3.5" />
        </svg>
        <input
          v-model="query"
          type="search"
          :placeholder="`Filter ${LANGUAGES.length} languages by name, extension, tier, or domain…`"
          aria-label="Filter languages"
        />
      </div>
      <div class="le-tiers" role="tablist" aria-label="Filter by maturity tier">
        <button
          v-for="t in tierChips"
          :key="t.id"
          type="button"
          class="le-tier-btn"
          :class="[`le-tier-btn--${t.id}`, { active: activeTier === t.id }]"
          @click="activeTier = t.id"
        >
          <span v-if="t.id !== 'all'" class="le-tier-dot" :class="`le-tier-dot--${t.id}`" />
          <span>{{ t.label }}</span>
          <span class="le-chip-count">{{ t.count }}</span>
        </button>
      </div>
      <div class="le-chips" role="tablist" aria-label="Filter by domain">
        <button
          v-for="c in chips"
          :key="c.id"
          type="button"
          class="le-chip"
          :class="{ active: activeGroup === c.id }"
          @click="activeGroup = c.id"
        >
          <span>{{ c.label }}</span>
          <span class="le-chip-count">{{ c.count }}</span>
        </button>
      </div>
    </div>

    <div class="le-grid">
      <a
        v-for="l in filtered"
        :key="l.slug"
        :href="withBase(`/languages/${l.slug}`)"
        class="le-card"
      >
        <div class="le-top">
          <span class="le-name">{{ l.name }}</span>
          <div class="le-badges">
            <span class="le-tier" :class="`le-tier--${l.tier}`">{{ TIER_LABELS[l.tier] }}</span>
            <code class="le-ext">{{ l.ext }}</code>
          </div>
        </div>
        <div class="le-role">{{ l.role }}</div>
        <div v-if="industriesByLang.get(l.slug)?.length" class="le-tags">
          <span v-for="ind in industriesByLang.get(l.slug)!.slice(0, 2)" :key="ind" class="le-tag">{{ ind }}</span>
        </div>
      </a>
    </div>

    <div v-if="filtered.length === 0" class="le-empty">
      No languages match "{{ query }}".
    </div>
  </div>
</template>

<style scoped>
.le {
  margin: 24px 0 32px;
}

.le-toolbar {
  display: flex;
  flex-direction: column;
  gap: 12px;
  margin-bottom: 20px;
}

.le-search {
  display: flex;
  align-items: center;
  gap: 10px;
  padding: 10px 14px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
}
.le-search:focus-within {
  border-color: var(--vp-c-brand-1);
}
.le-search input {
  flex: 1;
  border: 0;
  background: transparent;
  color: var(--vp-c-text-1);
  font-size: 14px;
  outline: none;
}

.le-tiers {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.le-tier-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 600;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.le-tier-btn:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
.le-tier-btn.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.le-tier-dot {
  width: 7px;
  height: 7px;
  border-radius: 999px;
}
.le-tier-dot--stable {
  background: #10b981;
}
.le-tier-dot--beta {
  background: #38bdf8;
}
.le-tier-dot--preview {
  background: #a855f7;
}

.le-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.le-chip {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 5px 11px;
  border-radius: 999px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  font-size: 12px;
  font-weight: 500;
  cursor: pointer;
  transition: border-color 0.15s, color 0.15s, background 0.15s;
}
.le-chip:hover {
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-text-1);
}
.le-chip.active {
  background: var(--vp-c-brand-soft);
  border-color: var(--vp-c-brand-1);
  color: var(--vp-c-brand-1);
}

.le-chip-count {
  font-size: 11px;
  opacity: 0.7;
  font-variant-numeric: tabular-nums;
}

.le-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(235px, 1fr));
  gap: 10px;
}

.le-card {
  display: flex;
  flex-direction: column;
  gap: 6px;
  padding: 14px 16px;
  border-radius: 10px;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-soft);
  text-decoration: none !important;
  color: inherit !important;
  transition: border-color 0.15s, transform 0.15s, background 0.15s;
}
.le-card:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-bg-elv);
  transform: translateY(-1px);
}

.le-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.le-badges {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  flex-shrink: 0;
}

.le-name {
  font-size: 14px;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.le-tier {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  letter-spacing: 0.02em;
  border: 1px solid transparent;
}
.le-tier--stable {
  color: var(--ms-tier-stable);
  background: var(--ms-tier-stable-bg);
  border-color: var(--ms-tier-stable-border);
}
.le-tier--beta {
  color: var(--ms-tier-beta);
  background: var(--ms-tier-beta-bg);
  border-color: var(--ms-tier-beta-border);
}
.le-tier--preview {
  color: var(--ms-tier-preview);
  background: var(--ms-tier-preview-bg);
  border-color: var(--ms-tier-preview-border);
}

.le-ext {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-brand-1);
}

.le-role {
  font-size: 12.5px;
  color: var(--vp-c-text-2);
  line-height: 1.45;
}

.le-tags {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  margin-top: 4px;
}
.le-tag {
  font-size: 10.5px;
  padding: 1px 7px;
  border-radius: 4px;
  background: var(--vp-c-default-soft);
  color: var(--vp-c-text-3);
}

.le-empty {
  padding: 32px;
  text-align: center;
  color: var(--vp-c-text-2);
  font-size: 14px;
}
</style>
