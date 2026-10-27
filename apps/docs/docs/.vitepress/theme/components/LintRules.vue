<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<!--
  Renders a language's diagnostic rules from data/lint-rules.generated.json,
  which is generated from the rule catalogs in languages/* (scripts/gen-lint-rules.ts).
  Never hand-edit rule tables; regenerate instead.
-->
<script setup lang="ts">
import { withBase } from "vitepress";
import { computed, ref } from "vue";
import lintData from "../data/lint-rules.generated.json";

interface Rule {
  code: string;
  rule: string;
  severity: string;
  message: string;
}
interface Lang {
  slug: string;
  name: string;
  packageName: string;
  sources: string[];
  cli: string | null;
  rules: Rule[];
}

const props = defineProps<{ lang: string }>();

const lang = computed(() => (lintData as Lang[]).find((l) => l.slug === props.lang));
const query = ref("");
const severity = ref<string>("all");

const severities = computed(() => [...new Set(lang.value?.rules.map((r) => r.severity) ?? [])]);
const counts = computed(() => {
  const c: Record<string, number> = {};
  for (const r of lang.value?.rules ?? []) c[r.severity] = (c[r.severity] ?? 0) + 1;
  return c;
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return (lang.value?.rules ?? []).filter(
    (r) =>
      (severity.value === "all" || r.severity === severity.value) &&
      (!q || r.code.toLowerCase().includes(q) || r.rule.includes(q) || r.message.toLowerCase().includes(q)),
  );
});

/** Splits a message template into text and `<param>` parts for highlighting. */
function parts(message: string): { text: string; param: boolean }[] {
  return message
    .split(/(<[A-Za-z_$][\w$]*>)/)
    .filter(Boolean)
    .map((text) => ({ text, param: /^<[A-Za-z_$][\w$]*>$/.test(text) }));
}

function href(code: string): string {
  return withBase(`/reference/linter-rules#${props.lang}-${code}`.toLowerCase());
}
</script>

<template>
  <div v-if="lang" class="lint-rules">
    <div class="lr-head">
      <p class="lr-summary">
        <strong>{{ lang.rules.length }} rules</strong>
        <span v-for="s in severities" :key="s" class="lr-count" :data-sev="s">{{ counts[s] }} {{ s }}</span>
        <span v-if="lang.cli" class="lr-cli">
          Run with <code>{{ lang.cli }}</code>
        </span>
      </p>
      <div v-if="lang.rules.length > 12" class="lr-filters">
        <input
          :id="`lr-search-${lang.slug}`"
          v-model="query"
          type="search"
          class="lr-input"
          placeholder="Filter by code, rule or message"
          :aria-label="`Filter ${lang.name} rules`"
        />
        <select :id="`lr-sev-${lang.slug}`" v-model="severity" class="lr-select" aria-label="Filter by severity">
          <option value="all">All severities</option>
          <option v-for="s in severities" :key="s" :value="s">{{ s }}</option>
        </select>
      </div>
    </div>

    <table>
      <thead>
        <tr>
          <th>Code</th>
          <th>Rule</th>
          <th>Severity</th>
          <th>Message</th>
        </tr>
      </thead>
      <tbody>
        <tr v-for="r in filtered" :key="`${r.code}:${r.rule}`">
          <td>
            <a :href="href(r.code)" class="lr-code"
              ><code>{{ r.code }}</code></a
            >
          </td>
          <td>
            <code>{{ r.rule }}</code>
          </td>
          <td>
            <span class="lr-sev" :data-sev="r.severity">{{ r.severity }}</span>
          </td>
          <td class="lr-msg">
            <template v-for="(p, i) in parts(r.message)" :key="i">
              <code v-if="p.param" class="lr-param">{{ p.text }}</code
              ><template v-else>{{ p.text }}</template>
            </template>
          </td>
        </tr>
        <tr v-if="!filtered.length">
          <td colspan="4" class="lr-empty">No rules match this filter.</td>
        </tr>
      </tbody>
    </table>

    <p class="lr-foot">
      Generated from <code v-for="s in lang.sources" :key="s">{{ s }}</code
      >. <a :href="withBase(`/reference/linter-rules#${lang.slug}`)">All languages →</a>
    </p>
  </div>
  <div v-else class="warning custom-block">
    <p class="custom-block-title">No rule catalog</p>
    <p>
      <code>{{ props.lang }}</code> does not export a rule catalog.
    </p>
  </div>
</template>

<style scoped>
.lint-rules table {
  display: table;
  width: 100%;
}
.lint-rules td:first-child,
.lint-rules td:nth-child(2),
.lint-rules td:nth-child(3) {
  white-space: nowrap;
}
.lr-head {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  margin-top: 16px;
}
.lr-summary {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px 14px;
  margin: 0;
  font-size: 14px;
  color: var(--vp-c-text-2);
}
.lr-count::before {
  content: "";
  display: inline-block;
  width: 7px;
  height: 7px;
  margin-right: 6px;
  border-radius: 50%;
  background: var(--lr-dot, var(--vp-c-text-3));
  vertical-align: 1px;
}
.lr-filters {
  display: flex;
  gap: 8px;
}
.lr-input,
.lr-select {
  height: 34px;
  padding: 0 10px;
  border: 1px solid var(--vp-c-divider);
  border-radius: 8px;
  background: var(--vp-c-bg-soft);
  color: var(--vp-c-text-1);
  font-size: 13px;
}
.lr-input {
  width: 260px;
}
.lr-input:focus-visible,
.lr-select:focus-visible {
  outline: 2px solid var(--vp-c-brand-1);
  outline-offset: 1px;
}
.lr-code {
  text-decoration: none;
}
.lr-sev {
  display: inline-block;
  padding: 0 8px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 500;
  line-height: 20px;
  color: var(--lr-fg, var(--vp-c-text-2));
  background: var(--lr-bg, var(--vp-c-default-soft));
}
[data-sev="error"] {
  --lr-dot: var(--vp-c-danger-1);
  --lr-fg: var(--vp-c-danger-1);
  --lr-bg: var(--vp-c-danger-soft);
}
[data-sev="warning"] {
  --lr-dot: var(--vp-c-warning-1);
  --lr-fg: var(--vp-c-warning-1);
  --lr-bg: var(--vp-c-warning-soft);
}
[data-sev="info"],
[data-sev="notification"] {
  --lr-dot: var(--vp-c-tip-1);
  --lr-fg: var(--vp-c-tip-1);
  --lr-bg: var(--vp-c-tip-soft);
}
[data-sev="hint"] {
  --lr-dot: var(--vp-c-text-3);
}
.lr-msg {
  font-size: 13px;
  line-height: 1.55;
}
.lr-param {
  font-size: 0.92em;
  color: var(--vp-c-brand-1);
}
.lr-empty {
  text-align: center;
  color: var(--vp-c-text-3);
}
.lr-foot {
  font-size: 13px;
  color: var(--vp-c-text-3);
}
.lr-foot code + code {
  margin-left: 6px;
}
@media (max-width: 640px) {
  .lr-filters,
  .lr-input {
    width: 100%;
  }
}
</style>
