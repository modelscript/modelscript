<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { computed, ref } from "vue";
import { INDUSTRIES } from "../data/industries";
import { PLATFORM_GROUPS } from "../data/languages";
import languagesData from "../data/languages.generated.json";
import MsIcon from "./MsIcon.vue";

interface LanguageManifest {
  slug: string;
  name: string;
  sidebar: string;
  ext: string;
  role: string;
  group: string;
  pkgName: string;
  version: string;
  cliCommand: string | null;
  actions: string[];
  capabilities: {
    parse: boolean;
    lint: boolean;
    dae: boolean;
    simulate: boolean;
    projections: string[];
  };
  ruleCount: number;
  tier: "stable" | "beta" | "preview";
}

const props = withDefaults(
  defineProps<{
    industry?: string;
    group?: string;
    compact?: boolean;
  }>(),
  {
    industry: undefined,
    group: undefined,
    compact: false,
  },
);

const allLanguages = languagesData as LanguageManifest[];

const search = ref("");
const selectedFilter = ref<string>(
  props.group ? `group:${props.group}` : props.industry ? `industry:${props.industry}` : "all",
);
const capabilityFilter = ref<"all" | "simulate" | "dae" | "projections">("all");

const filterOptions = computed(() => {
  if (props.industry || props.group) return [];
  return [
    { id: "all", label: `All (${allLanguages.length})` },
    ...PLATFORM_GROUPS.map((g) => ({ id: `group:${g.id}`, label: g.label })),
    ...INDUSTRIES.map((i) => ({ id: `industry:${i.slug}`, label: i.name })),
  ];
});

function matchesScope(lang: LanguageManifest): boolean {
  if (props.industry) {
    const ind = INDUSTRIES.find((i) => i.slug === props.industry);
    return ind ? ind.languages.includes(lang.slug) : false;
  }
  if (props.group) {
    return lang.group === props.group;
  }
  const f = selectedFilter.value;
  if (f === "all") return true;
  if (f.startsWith("group:")) return lang.group === f.slice(6);
  if (f.startsWith("industry:")) {
    const ind = INDUSTRIES.find((i) => i.slug === f.slice(9));
    return ind ? ind.languages.includes(lang.slug) : false;
  }
  return true;
}

const filteredLanguages = computed(() => {
  const q = search.value.trim().toLowerCase();
  const cap = capabilityFilter.value;

  return allLanguages.filter((lang) => {
    if (!matchesScope(lang)) return false;

    if (cap === "simulate" && !lang.capabilities.simulate) return false;
    if (cap === "dae" && !lang.capabilities.dae) return false;
    if (cap === "projections" && lang.capabilities.projections.length === 0) return false;

    if (!q) return true;
    return (
      lang.name.toLowerCase().includes(q) ||
      lang.ext.toLowerCase().includes(q) ||
      lang.role.toLowerCase().includes(q) ||
      lang.slug.toLowerCase().includes(q) ||
      lang.pkgName.toLowerCase().includes(q) ||
      lang.tier.toLowerCase().includes(q) ||
      (lang.cliCommand && lang.cliCommand.toLowerCase().includes(q)) ||
      lang.capabilities.projections.some((p) => p.toLowerCase().includes(q))
    );
  });
});
</script>

<template>
  <div class="cap-matrix-container" :class="{ compact }">
    <!-- Controls (unless locked compact without search) -->
    <div v-if="!compact" class="cap-matrix-controls">
      <div class="search-box">
        <MsIcon name="search" :size="16" class="search-icon" />
        <input
          v-model="search"
          type="search"
          placeholder="Filter by name, extension (.mo, .arxml), role, tier, or projection target..."
          aria-label="Filter languages"
        />
        <span class="count-badge">{{ filteredLanguages.length }} / {{ allLanguages.length }}</span>
      </div>

      <div class="filter-row">
        <!-- Scope Filter Tabs (if not locked by props) -->
        <div v-if="filterOptions.length" class="chip-group" role="group" aria-label="Scope filter">
          <button
            v-for="opt in filterOptions"
            :key="opt.id"
            type="button"
            class="chip"
            :class="{ active: selectedFilter === opt.id }"
            @click="selectedFilter = opt.id"
          >
            {{ opt.label }}
          </button>
        </div>

        <!-- Capability Toggles -->
        <div class="cap-toggles" role="group" aria-label="Capability filter">
          <button
            type="button"
            class="toggle-btn"
            :class="{ active: capabilityFilter === 'all' }"
            @click="capabilityFilter = 'all'"
          >
            All Capabilities
          </button>
          <button
            type="button"
            class="toggle-btn"
            :class="{ active: capabilityFilter === 'simulate' }"
            @click="capabilityFilter = 'simulate'"
          >
            Simulate / Solve
          </button>
          <button
            type="button"
            class="toggle-btn"
            :class="{ active: capabilityFilter === 'dae' }"
            @click="capabilityFilter = 'dae'"
          >
            DAE Arena
          </button>
          <button
            type="button"
            class="toggle-btn"
            :class="{ active: capabilityFilter === 'projections' }"
            @click="capabilityFilter = 'projections'"
          >
            Projections & Interop
          </button>
        </div>
      </div>
    </div>

    <!-- Table -->
    <div class="table-scroller">
      <table class="cap-table">
        <thead>
          <tr>
            <th class="th-lang">Language & Extensions</th>
            <th class="th-pkg">Package</th>
            <th class="th-cli">CLI Command</th>
            <th class="th-cap text-center">Parse</th>
            <th class="th-cap text-center">Lint & Diagnostics</th>
            <th class="th-cap text-center">DAE Arena</th>
            <th class="th-cap text-center">Simulate</th>
            <th class="th-proj">Projections & Interop</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="lang in filteredLanguages" :key="lang.slug">
            <!-- Language -->
            <td class="td-lang">
              <a :href="`/languages/${lang.slug}`" class="lang-link">
                <span class="lang-name">{{ lang.name }}</span>
                <span class="lang-ext">{{ lang.ext }}</span>
                <span class="lang-tier" :class="`tier-${lang.tier}`">{{ lang.tier }}</span>
              </a>
              <span v-if="!compact" class="lang-role">{{ lang.role }}</span>
            </td>

            <!-- Package -->
            <td class="td-pkg">
              <code>{{ lang.pkgName }}</code>
            </td>

            <!-- CLI -->
            <td class="td-cli">
              <code v-if="lang.cliCommand" class="cli-badge">{{ lang.cliCommand }}</code>
              <span v-else class="text-muted">—</span>
            </td>

            <!-- Parse -->
            <td class="td-cap text-center">
              <span class="cap-status active" title="Ahead-of-Time WebAssembly parser">
                <MsIcon name="check" :size="15" :stroke="2.5" />
              </span>
            </td>

            <!-- Lint -->
            <td class="td-cap text-center">
              <a
                v-if="lang.ruleCount > 0"
                :href="`/reference/linter-rules#${lang.slug}`"
                class="rule-pill"
                :title="`${lang.ruleCount} diagnostic rules defined. Click to view reference.`"
              >
                {{ lang.ruleCount }} rules
              </a>
              <span v-else-if="lang.capabilities.lint" class="cap-status active" title="Syntax and structural linter">
                <MsIcon name="check" :size="15" :stroke="2.5" />
              </span>
              <span v-else class="text-muted">—</span>
            </td>

            <!-- DAE Arena -->
            <td class="td-cap text-center">
              <span
                v-if="lang.capabilities.dae"
                class="cap-status active"
                title="Direct lowering to @modelscript/runtime linear memory DAE arena"
              >
                <MsIcon name="check" :size="15" :stroke="2.5" />
              </span>
              <span v-else class="text-muted">—</span>
            </td>

            <!-- Simulate -->
            <td class="td-cap text-center">
              <span
                v-if="lang.capabilities.simulate"
                class="cap-status active"
                title="Domain solver or direct simulation engine"
              >
                <MsIcon name="check" :size="15" :stroke="2.5" />
              </span>
              <span v-else class="text-muted">—</span>
            </td>

            <!-- Projections -->
            <td class="td-proj">
              <div v-if="lang.capabilities.projections.length" class="proj-pills">
                <span v-for="proj in lang.capabilities.projections" :key="proj" class="proj-badge">
                  {{ proj }}
                </span>
              </div>
              <span v-else class="text-muted">—</span>
            </td>
          </tr>
          <tr v-if="filteredLanguages.length === 0">
            <td colspan="8" class="no-results">No languages match the current search or filters.</td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>

<style scoped>
.cap-matrix-container {
  margin: 28px 0 44px;
}

.cap-matrix-controls {
  display: flex;
  flex-direction: column;
  gap: 14px;
  margin-bottom: 20px;
}

.search-box {
  position: relative;
  display: flex;
  align-items: center;
}

.search-icon {
  position: absolute;
  left: 14px;
  color: var(--vp-c-text-2);
  pointer-events: none;
}

.search-box input {
  width: 100%;
  padding: 10px 90px 10px 38px;
  font-size: 14px;
  border-radius: 8px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
  outline: none;
  transition:
    border-color 0.2s,
    box-shadow 0.2s;
}

.search-box input:focus {
  border-color: var(--vp-c-brand-1);
  box-shadow: 0 0 0 3px var(--vp-c-brand-soft);
}

.count-badge {
  position: absolute;
  right: 12px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  font-family: var(--vp-font-family-mono);
}

.filter-row {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  align-items: center;
  justify-content: space-between;
}

.chip-group {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.chip {
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  border-radius: 6px;
  border: 1px solid var(--vp-c-border);
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.chip:hover {
  color: var(--vp-c-text-1);
  border-color: var(--vp-c-brand-2);
}

.chip.active {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  font-weight: 600;
}

.cap-toggles {
  display: flex;
  gap: 4px;
  background: var(--vp-c-bg-soft);
  padding: 3px;
  border-radius: 6px;
  border: 1px solid var(--vp-c-border);
}

.toggle-btn {
  padding: 4px 8px;
  font-size: 11px;
  font-weight: 500;
  border-radius: 4px;
  border: none;
  background: transparent;
  color: var(--vp-c-text-2);
  cursor: pointer;
  transition: all 0.15s ease;
}

.toggle-btn:hover {
  color: var(--vp-c-text-1);
}

.toggle-btn.active {
  background: var(--vp-c-bg-elv);
  color: var(--vp-c-text-1);
  box-shadow: 0 1px 2px rgba(0, 0, 0, 0.08);
  font-weight: 600;
}

.table-scroller {
  overflow-x: auto;
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  background: var(--vp-c-bg-elv);
  box-shadow: 0 1px 3px rgba(0, 0, 0, 0.04);
}

.cap-table {
  width: 100%;
  border-collapse: collapse;
  font-size: 13px;
  margin: 0;
}

.cap-table th,
.cap-table td {
  padding: 8px 10px;
  border-bottom: 1px solid var(--vp-c-divider);
  text-align: left;
  vertical-align: middle;
}

.cap-table th {
  background: var(--vp-c-bg-soft);
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-text-2);
  white-space: nowrap;
}

.cap-table tbody tr:last-child td {
  border-bottom: none;
}

.cap-table tbody tr:hover {
  background: var(--ms-surface-hover);
}

.text-center {
  text-align: center !important;
}

.text-muted {
  color: var(--vp-c-text-3);
}

.th-lang {
  min-width: 170px;
}

.th-pkg {
  min-width: 140px;
}

.th-cli {
  min-width: 110px;
}

.th-cap {
  width: 54px;
  min-width: 54px;
  padding-left: 4px !important;
  padding-right: 4px !important;
}

.th-proj {
  min-width: 130px;
}

.td-lang {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.lang-link {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.lang-link:hover {
  text-decoration: underline;
}

.lang-name {
  color: var(--vp-c-text-1);
}

.lang-ext {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 500;
  padding: 1px 5px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-border);
}

.lang-tier {
  font-size: 10px;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.04em;
  padding: 1px 5px;
  border-radius: 4px;
}

.tier-stable {
  background: rgba(34, 197, 94, 0.14);
  color: #15803d;
}

.dark .tier-stable {
  background: rgba(34, 197, 94, 0.2);
  color: #4ade80;
}

.tier-beta {
  background: rgba(59, 130, 246, 0.14);
  color: #1d4ed8;
}

.dark .tier-beta {
  background: rgba(59, 130, 246, 0.2);
  color: #60a5fa;
}

.tier-preview {
  background: rgba(245, 158, 11, 0.14);
  color: #b45309;
}

.dark .tier-preview {
  background: rgba(245, 158, 11, 0.2);
  color: #fbbf24;
}

.lang-role {
  font-size: 11.5px;
  color: var(--vp-c-text-2);
  line-height: 1.3;
}

.td-pkg code {
  font-size: 11px;
  color: var(--vp-c-text-2);
  background: transparent;
  padding: 0;
}

.cli-badge {
  font-size: 11px;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  padding: 2px 6px;
  border-radius: 4px;
  border: 1px solid var(--vp-c-border);
}

.cap-status {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 24px;
  height: 24px;
  border-radius: 50%;
}

.cap-status.active {
  background: rgba(34, 197, 94, 0.12);
  color: #16a34a;
}

.dark .cap-status.active {
  background: rgba(34, 197, 94, 0.18);
  color: #4ade80;
}

.rule-pill {
  display: inline-block;
  padding: 2px 7px;
  font-size: 11px;
  font-weight: 600;
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  border-radius: 12px;
  text-decoration: none;
  transition: all 0.15s ease;
  white-space: nowrap;
}

.rule-pill:hover {
  filter: brightness(1.1);
  text-decoration: underline;
}

.proj-pills {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
}

.proj-badge {
  font-size: 10.5px;
  font-weight: 500;
  padding: 1px 6px;
  border-radius: 4px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-2);
  border: 1px solid var(--vp-c-border);
  white-space: nowrap;
}

.no-results {
  text-align: center;
  padding: 32px 16px;
  color: var(--vp-c-text-2);
  font-size: 13px;
}
</style>
