<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, ref, watch } from "vue";
import benchmarksData from "../data/benchmarks.generated.json";
import { INDUSTRIES, INDUSTRY_BY_SLUG, type Industry } from "../data/industries";
import { LANGUAGE_BY_SLUG, TIER_LABELS, type LanguageSpec } from "../data/languages";
import languagesGenerated from "../data/languages.generated.json";
import mcpToolsData from "../data/mcp-tools.generated.json";
import { useAnsatzOrigin } from "../util/ansatz";
import MsIcon from "./MsIcon.vue";

const props = defineProps<{ slug: string }>();

const { ansatzOrigin } = useAnsatzOrigin();
const { frontmatter, isDark } = useData();

interface IndustryExampleItem {
  slug: string;
  name: string;
  ext: string;
  filename: string;
  title: string;
  description: string;
  viewLabel: string;
  code: string;
  lineCount: number;
  highlightedLines?: string[];
  permalinkToken: string;
  svgDark: string;
  svgLight: string;
}

interface GeneratedLangEntry {
  slug: string;
  cliCommand?: string;
  capabilities?: {
    parse: boolean;
    lint: boolean;
    dae: boolean;
    simulate: boolean;
    projections: string[];
  };
  ruleCount?: number;
}

interface BenchmarkCatalogEntry {
  id: string;
  name: string;
  version: string;
  license: string;
  referenceTool: string;
  metricTarget: string;
  threshold: number;
  description: string;
}

interface BenchmarkLangEntry {
  slug: string;
  catalogIds?: string[];
  scorecard?: {
    testFileCount?: number;
    testCaseCount?: number;
    testedErrorCodesCount?: number;
    auditedTier?: string;
  };
  summary?: {
    totalCases?: number;
    passedCases?: number;
    passRate?: number;
  };
}

interface McpToolMeta {
  name: string;
  description: string;
  category: string;
}

const LANG_GEN_BY_SLUG: Record<string, GeneratedLangEntry> = Object.fromEntries(
  (languagesGenerated as GeneratedLangEntry[]).map((l) => [l.slug, l]),
);
const CATALOG_BY_ID = (benchmarksData as { catalogById: Record<string, BenchmarkCatalogEntry> }).catalogById;
const BENCH_BY_SLUG: Record<string, BenchmarkLangEntry> = Object.fromEntries(
  ((benchmarksData as { languages: BenchmarkLangEntry[] }).languages ?? []).map((b) => [b.slug, b]),
);
const MCP_BY_NAME: Record<string, McpToolMeta> = Object.fromEntries(
  ((mcpToolsData as { tools: McpToolMeta[] }).tools ?? []).map((t) => [t.name, t]),
);

const activeTrackId = ref<string>("all");
const activeExampleIdx = ref<number>(0);
const workbenchView = ref<"split" | "code" | "diagram">("split");
const copiedExample = ref<boolean>(false);
const copiedCli = ref<boolean>(false);

watch(
  () => props.slug,
  () => {
    activeTrackId.value = "all";
    activeExampleIdx.value = 0;
    workbenchView.value = "split";
    copiedExample.value = false;
    copiedCli.value = false;
  },
);

const industry = computed<Industry | undefined>(() => INDUSTRY_BY_SLUG[props.slug]);

const allLanguages = computed(() =>
  (industry.value?.languages ?? [])
    .map((s) => LANGUAGE_BY_SLUG[s])
    .filter((l): l is LanguageSpec => l !== undefined),
);

const activeTrack = computed(() =>
  activeTrackId.value === "all"
    ? undefined
    : industry.value?.tracks?.find((t) => t.id === activeTrackId.value),
);

const visibleLanguages = computed(() => {
  const slugs = activeTrack.value ? activeTrack.value.languages : (industry.value?.languages ?? []);
  return slugs
    .map((s) => LANGUAGE_BY_SLUG[s])
    .filter((l): l is LanguageSpec => l !== undefined)
    .map((spec) => ({
      spec,
      meta: LANG_GEN_BY_SLUG[spec.slug],
      bench: BENCH_BY_SLUG[spec.slug],
    }));
});

const industryExamples = computed<IndustryExampleItem[]>(() => {
  const raw = (frontmatter.value as { _industryExamples?: IndustryExampleItem[] })?._industryExamples;
  return Array.isArray(raw) ? raw : [];
});

const activeExample = computed<IndustryExampleItem | undefined>(() => {
  return industryExamples.value[activeExampleIdx.value] ?? industryExamples.value[0];
});

const activeCodeLines = computed<string[]>(() => {
  return activeExample.value ? activeExample.value.code.split("\n") : [];
});

const activeExampleSvg = computed<string>(() => {
  if (!activeExample.value) return "";
  return isDark.value ? activeExample.value.svgDark : activeExample.value.svgLight;
});

function morselHrefFor(ex: IndustryExampleItem | undefined): string {
  if (!ex?.permalinkToken) return `${ansatzOrigin.value}/editor`;
  return `${ansatzOrigin.value}/editor#m=${ex.permalinkToken}`;
}

const heroMorselHref = computed(() => morselHrefFor(industryExamples.value[0]));

const domainBenchStats = computed(() => {
  const entries = (industry.value?.languages ?? [])
    .map((s) => BENCH_BY_SLUG[s])
    .filter((b): b is BenchmarkLangEntry => b !== undefined);
  let testCases = 0;
  let passedCases = 0;
  let totalBenchCases = 0;
  for (const b of entries) {
    testCases += b.scorecard?.testCaseCount ?? 0;
    passedCases += b.summary?.passedCases ?? 0;
    totalBenchCases += b.summary?.totalCases ?? 0;
  }
  return {
    auditedFormats: entries.length,
    testCases,
    passedCases,
    totalBenchCases,
    passRate: totalBenchCases > 0 ? Math.round((passedCases / totalBenchCases) * 100) : 100,
  };
});

const benchmarkEntries = computed(() => {
  const ind = industry.value;
  if (!ind) return [];
  const suiteToLang = new Map<string, string>();
  for (const slug of ind.languages) {
    for (const cid of BENCH_BY_SLUG[slug]?.catalogIds ?? []) {
      if (!suiteToLang.has(cid)) suiteToLang.set(cid, slug);
    }
  }
  return ind.benchmarkSuites
    .map((id) => {
      const cat = CATALOG_BY_ID[id];
      if (!cat) return undefined;
      return {
        ...cat,
        langSlug: suiteToLang.get(id) ?? ind.languages[0] ?? "overview",
      };
    })
    .filter((c): c is BenchmarkCatalogEntry & { langSlug: string } => c !== undefined);
});

const mcpToolEntries = computed(() =>
  (industry.value?.mcpTools ?? []).map((name) => {
    const found = MCP_BY_NAME[name];
    return {
      name,
      category: found?.category ?? "Domain Analysis",
      description: found?.description ?? "Registered MCP verification and simulation tool.",
    };
  }),
);

const related = computed(() => {
  const ind = industry.value;
  if (!ind) return [];
  if (ind.relatedSlugs?.length) {
    return ind.relatedSlugs
      .map((r) => {
        const target = INDUSTRY_BY_SLUG[r.slug];
        return target ? { industry: target, reason: r.reason } : undefined;
      })
      .filter((r): r is { industry: Industry; reason: string } => r !== undefined);
  }
  return INDUSTRIES.filter((i) => i.slug !== ind.slug && i.group === ind.group)
    .slice(0, 3)
    .map((target) => ({ industry: target, reason: target.tagline }));
});

function formatThreshold(metricTarget: string, threshold: number): string {
  const label = metricTarget === "max-relative-error" ? "Rel Err" : metricTarget.toUpperCase();
  if (metricTarget === "ast-pass-rate") return `${label} ${(threshold * 100).toFixed(0)}%`;
  return `${label} < ${threshold}`;
}

async function copyText(text: string, which: "cli" | "example") {
  if (typeof navigator === "undefined" || !navigator.clipboard) return;
  try {
    await navigator.clipboard.writeText(text);
    if (which === "cli") {
      copiedCli.value = true;
      setTimeout(() => {
        copiedCli.value = false;
      }, 1800);
    } else {
      copiedExample.value = true;
      setTimeout(() => {
        copiedExample.value = false;
      }, 1800);
    }
  } catch {
    /* ignore clipboard permission errors */
  }
}
</script>

<template>
  <div v-if="industry" class="ind-page" :style="{ '--accent': industry.accent }">
    <!-- Hero -->
    <section class="ind-hero">
      <div class="ind-grid-bg" aria-hidden="true" />
      <div class="ind-glow" aria-hidden="true" />
      <div class="ms-container ind-hero-inner">
        <div class="ind-hero-copy">
          <nav class="ind-crumbs" aria-label="Breadcrumb">
            <a href="/industries/">Industries</a>
            <span aria-hidden="true">/</span>
            <span>{{ industry.name }}</span>
          </nav>
          <span class="ind-eyebrow">
            <span class="ind-eyebrow-icon"><MsIcon :name="industry.icon" :size="16" :duotone="true" /></span>
            {{ industry.name }}
          </span>
          <h1 class="ind-title">{{ industry.headline }}</h1>
          <p class="ind-summary">{{ industry.summary }}</p>

          <div class="ind-hero-stats">
            <span class="hero-stat-pill">
              <strong>{{ allLanguages.length }}</strong> domain formats
            </span>
            <span class="hero-stat-pill">
              <strong>{{ industry.standards.length }}</strong> verified standards
            </span>
            <span v-if="domainBenchStats.testCases > 0" class="hero-stat-pill">
              <strong>{{ domainBenchStats.testCases.toLocaleString() }}</strong> automated tests
            </span>
            <span v-if="benchmarkEntries.length > 0" class="hero-stat-pill">
              <strong>{{ benchmarkEntries.length }}</strong> benchmark suites
            </span>
          </div>

          <div class="ind-actions">
            <a class="ms-btn ms-btn-lg ms-btn-brand" href="/guide/getting-started">
              Get started <MsIcon name="arrowRight" :size="16" :stroke="2" />
            </a>
            <a class="ms-btn ms-btn-lg ms-btn-ghost" :href="heroMorselHref" target="_blank" rel="noopener noreferrer">
              {{ industryExamples.length ? `Open ${industryExamples[0]?.name} in Ansatz` : "Open Ansatz" }}
              <MsIcon name="arrow-up-right" :size="15" :stroke="2" />
            </a>
          </div>
        </div>

        <div class="ind-terminal" role="figure" aria-label="Example CLI session">
          <div class="term-bar">
            <span class="dot" /><span class="dot" /><span class="dot" />
            <span class="term-title">msx — {{ industry.slug }}</span>
            <button
              type="button"
              class="term-copy"
              :aria-label="copiedCli ? 'CLI commands copied' : 'Copy CLI commands'"
              @click="copyText(industry.cli.join('\n'), 'cli')"
            >
              <MsIcon :name="copiedCli ? 'check' : 'copy'" :size="12" />
              <span>{{ copiedCli ? "Copied" : "Copy" }}</span>
            </button>
          </div>
          <pre
            class="term-body"
          ><code><template v-for="(line, i) in industry.cli" :key="i"><span class="term-prompt">$</span> {{ line }}
</template></code></pre>
        </div>
      </div>
    </section>

    <!-- Interactive Model & Schematic Workbench -->
    <section v-if="industryExamples.length && activeExample" class="ms-section">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">Interactive Workbench</span>
          <h2 class="ms-h2">Inspect live {{ industry.name.toLowerCase() }} models &amp; schematics</h2>
          <p class="ms-lead">
            Pre-rendered from the same parser, diagram layout engine, and Ansatz WebAssembly runtime used in
            production.
          </p>
        </header>

        <div class="wb-shell">
          <div class="wb-topbar">
            <div class="wb-model-tabs" role="tablist" aria-label="Featured domain models">
              <button
                v-for="(ex, idx) in industryExamples"
                :key="ex.slug"
                type="button"
                role="tab"
                class="wb-model-tab"
                :class="{ active: idx === activeExampleIdx }"
                :aria-selected="idx === activeExampleIdx"
                @click="activeExampleIdx = idx"
              >
                <span class="wb-model-ext">{{ ex.ext.split(",")[0]?.trim() }}</span>
                <span class="wb-model-name">{{ ex.name }}</span>
              </button>
            </div>

            <div class="wb-controls">
              <div class="wb-view-tabs" role="tablist" aria-label="Workbench view mode">
                <button
                  type="button"
                  role="tab"
                  class="wb-view-btn"
                  :class="{ active: workbenchView === 'split' }"
                  :aria-selected="workbenchView === 'split'"
                  @click="workbenchView = 'split'"
                >
                  <MsIcon name="layers" :size="13" />
                  <span>Split</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  class="wb-view-btn"
                  :class="{ active: workbenchView === 'code' }"
                  :aria-selected="workbenchView === 'code'"
                  @click="workbenchView = 'code'"
                >
                  <MsIcon name="code" :size="13" />
                  <span>Code</span>
                </button>
                <button
                  type="button"
                  role="tab"
                  class="wb-view-btn"
                  :class="{ active: workbenchView === 'diagram' }"
                  :aria-selected="workbenchView === 'diagram'"
                  @click="workbenchView = 'diagram'"
                >
                  <MsIcon name="workflow" :size="13" />
                  <span>Schematic</span>
                </button>
              </div>
              <a
                :href="morselHrefFor(activeExample)"
                target="_blank"
                rel="noopener noreferrer"
                class="wb-morsel-btn"
              >
                <span>Open in Ansatz</span>
                <MsIcon name="arrow-up-right" :size="13" />
              </a>
            </div>
          </div>

          <div class="wb-caption">
            <div class="wb-caption-title">
              <code class="wb-filename">{{ activeExample.filename }}</code>
              <strong>{{ activeExample.title }}</strong>
            </div>
            <p class="wb-desc">{{ activeExample.description }}</p>
          </div>

          <div
            class="wb-body"
            :class="{
              'is-split': workbenchView === 'split',
              'is-code': workbenchView === 'code',
              'is-diagram': workbenchView === 'diagram',
            }"
          >
            <div v-if="workbenchView !== 'diagram'" class="wb-code-pane">
              <div class="wb-pane-bar">
                <span>
                  <MsIcon name="terminal" :size="12" />
                  Source ({{ activeExample.lineCount }} lines)
                </span>
                <div class="wb-pane-actions">
                  <a :href="`/languages/${activeExample.slug}`" class="wb-lang-link">
                    {{ activeExample.name }} docs <MsIcon name="arrowRight" :size="12" />
                  </a>
                  <button
                    type="button"
                    class="wb-copy-btn"
                    @click="copyText(activeExample.code, 'example')"
                  >
                    <MsIcon :name="copiedExample ? 'check' : 'copy'" :size="12" />
                    <span>{{ copiedExample ? "Copied" : "Copy" }}</span>
                  </button>
                </div>
              </div>
              <div class="wb-code-scroll">
                <pre class="wb-code-pre shiki"><code><span
                  v-for="(line, idx) in activeCodeLines"
                  :key="idx"
                  class="wb-code-line"
                ><span class="wb-line-num">{{ idx + 1 }}</span><span
                  v-if="activeExample.highlightedLines?.[idx]"
                  class="wb-line-text"
                  v-html="activeExample.highlightedLines[idx]"
                /><span v-else class="wb-line-text">{{ line }}</span></span></code></pre>
              </div>
            </div>

            <div v-if="workbenchView !== 'code'" class="wb-diagram-pane">
              <div class="wb-pane-bar">
                <span>
                  <MsIcon name="workflow" :size="12" />
                  {{ activeExample.viewLabel }}
                </span>
                <span class="wb-theme-tag">{{ isDark ? "Dark schematic" : "Light schematic" }}</span>
              </div>
              <div class="wb-svg-stage" v-html="activeExampleSvg" />
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Pains -->
    <section class="ms-section ms-section-alt">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">The challenge</span>
          <h2 class="ms-h2">What slows {{ industry.name.toLowerCase() }} teams down</h2>
        </header>
        <div class="pain-grid">
          <article v-for="(p, i) in industry.pains" :key="p.title" class="pain-card">
            <span class="pain-num">0{{ i + 1 }}</span>
            <h3>{{ p.title }}</h3>
            <p>{{ p.body }}</p>
          </article>
        </div>
      </div>
    </section>

    <!-- Workflow -->
    <section class="ms-section">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">Reference workflow</span>
          <h2 class="ms-h2">One pipeline, end to end</h2>
        </header>
        <ol class="flow">
          <li v-for="(s, i) in industry.workflow" :key="s.label" class="flow-step">
            <span class="flow-idx">{{ i + 1 }}</span>
            <div>
              <h3>{{ s.label }}</h3>
              <p>{{ s.detail }}</p>
            </div>
          </li>
        </ol>
      </div>
    </section>

    <!-- Capabilities -->
    <section class="ms-section ms-section-alt">
      <div class="ms-container">
        <header class="ms-section-head">
          <span class="ms-eyebrow">Capabilities</span>
          <h2 class="ms-h2">What ModelScript does for you</h2>
        </header>
        <div class="cap-grid">
          <article v-for="c in industry.capabilities" :key="c.title" class="cap-card">
            <span class="cap-check"><MsIcon name="check" :size="18" :stroke="2.25" /></span>
            <div>
              <h3>{{ c.title }}</h3>
              <p>{{ c.body }}</p>
            </div>
          </article>
        </div>
      </div>
    </section>

    <!-- Formats + standards -->
    <section class="ms-section">
      <div class="ms-container fmt-layout">
        <div>
          <header class="ms-section-head left">
            <span class="ms-eyebrow">Supported formats</span>
            <h2 class="ms-h2">Works with the tools you already use</h2>
          </header>

          <div v-if="industry.tracks?.length" class="track-filter-wrap">
            <div class="track-tabs" role="tablist" aria-label="Filter formats by domain sub-track">
              <button
                type="button"
                role="tab"
                class="track-tab"
                :class="{ active: activeTrackId === 'all' }"
                :aria-selected="activeTrackId === 'all'"
                @click="activeTrackId = 'all'"
              >
                <span>All formats</span>
                <span class="track-count">{{ allLanguages.length }}</span>
              </button>
              <button
                v-for="t in industry.tracks"
                :key="t.id"
                type="button"
                role="tab"
                class="track-tab"
                :class="{ active: activeTrackId === t.id }"
                :aria-selected="activeTrackId === t.id"
                @click="activeTrackId = t.id"
              >
                <span>{{ t.label }}</span>
                <span class="track-count">{{ t.languages.length }}</span>
              </button>
            </div>
            <p v-if="activeTrack" class="track-summary">{{ activeTrack.summary }}</p>
          </div>

          <div class="fmt-grid">
            <a
              v-for="item in visibleLanguages"
              :key="item.spec.slug"
              :href="`/languages/${item.spec.slug}`"
              class="fmt-card"
            >
              <div class="fmt-head">
                <span class="fmt-ext">{{ item.spec.ext }}</span>
                <span class="fmt-tier" :class="`fmt-tier--${item.spec.tier}`">
                  {{ TIER_LABELS[item.spec.tier] }}
                </span>
              </div>
              <span class="fmt-name">{{ item.spec.name }}</span>
              <span class="fmt-role">{{ item.spec.role }}</span>
              <div v-if="item.meta" class="fmt-caps">
                <span v-if="item.meta.capabilities?.simulate" class="fmt-cap-pill">Simulate</span>
                <span v-else-if="item.meta.capabilities?.dae" class="fmt-cap-pill">DAE</span>
                <span v-if="(item.meta.ruleCount ?? 0) > 0" class="fmt-cap-pill">
                  {{ item.meta.ruleCount }} lint rules
                </span>
                <span
                  v-for="proj in (item.meta.capabilities?.projections ?? []).slice(0, 2)"
                  :key="proj"
                  class="fmt-cap-pill"
                >
                  {{ proj }}
                </span>
              </div>
            </a>
          </div>
        </div>

        <aside class="std-card">
          <h3><MsIcon name="shield" :size="20" :duotone="true" /> Standards &amp; interchange</h3>
          <ul>
            <li v-for="s in industry.standards" :key="s"><MsIcon name="check" :size="14" :stroke="2.25" /> {{ s }}</li>
          </ul>
          <a href="/reference/export-formats" class="std-link">
            All export formats <MsIcon name="arrowRight" :size="14" :stroke="2" />
          </a>
        </aside>
      </div>
    </section>

    <!-- Verified Benchmarks + Reference Workspaces -->
    <section v-if="benchmarkEntries.length || industry.workspaces?.length" class="ms-section ms-section-alt">
      <div class="ms-container">
        <header class="ms-section-head left">
          <span class="ms-eyebrow">Empirical verification</span>
          <h2 class="ms-h2">Validated against upstream reference solvers</h2>
          <p v-if="domainBenchStats.auditedFormats > 0" class="ms-lead left-lead">
            Across <strong>{{ domainBenchStats.auditedFormats }}</strong> audited formats in this domain:
            <strong>{{ domainBenchStats.testCases.toLocaleString() }}</strong> unit &amp; regression test cases and
            <strong>{{ domainBenchStats.passedCases }}/{{ domainBenchStats.totalBenchCases }}</strong> reference benchmark checks
            ({{ domainBenchStats.passRate }}% pass rate).
          </p>
        </header>

        <div v-if="benchmarkEntries.length" class="bench-grid">
          <a
            v-for="b in benchmarkEntries"
            :key="b.id"
            :href="`/languages/${b.langSlug}`"
            class="bench-card"
          >
            <div class="bench-top">
              <span class="bench-ref">{{ b.referenceTool }}</span>
              <span class="bench-thresh">{{ formatThreshold(b.metricTarget, b.threshold) }}</span>
            </div>
            <h3>{{ b.name }}</h3>
            <p>{{ b.description }}</p>
            <div class="bench-foot">
              <span class="bench-meta">v{{ b.version }} · {{ b.license }}</span>
              <span class="bench-link">
                View language <MsIcon name="arrowRight" :size="13" />
              </span>
            </div>
          </a>
        </div>

        <div v-if="industry.workspaces?.length" class="ws-block">
          <div class="ws-header">
            <span class="ms-eyebrow">Digital-Thread Reference Workspaces</span>
            <h3>Multi-format example repositories</h3>
          </div>
          <div class="ws-grid" :class="{ 'ws-grid--single': industry.workspaces.length === 1 }">
            <article v-for="ws in industry.workspaces" :key="ws.path" class="ws-card">
              <div class="ws-top">
                <h4>{{ ws.name }}</h4>
                <code class="ws-path">{{ ws.path }}</code>
              </div>
              <p class="ws-summary">{{ ws.summary }}</p>
              <div class="ws-langs">
                <a
                  v-for="slug in ws.languages"
                  :key="slug"
                  :href="`/languages/${slug}`"
                  class="ws-lang-chip"
                >
                  {{ LANGUAGE_BY_SLUG[slug]?.name ?? slug }}
                </a>
              </div>
              <ul class="ws-highlights">
                <li v-for="h in ws.highlights" :key="h">
                  <MsIcon name="check" :size="14" :stroke="2.2" />
                  <span>{{ h }}</span>
                </li>
              </ul>
            </article>
          </div>
        </div>
      </div>
    </section>

    <!-- MCP AI Tools & CI/Enterprise Readiness -->
    <section class="ms-section">
      <div class="ms-container">
        <div class="ops-grid">
          <div class="ops-panel">
            <div class="ops-head">
              <span class="ms-eyebrow">AI Agent Integration</span>
              <h2>Native MCP tools for {{ industry.name.toLowerCase() }}</h2>
              <p>
                Every parse, structural check, solver run, and compliance verifier below is exposed directly to IDE agents
                via <code>@modelscript/mcp</code>.
              </p>
            </div>
            <div class="mcp-list">
              <div v-for="tool in mcpToolEntries" :key="tool.name" class="mcp-item">
                <div class="mcp-item-head">
                  <code class="mcp-name">{{ tool.name }}</code>
                  <span class="mcp-cat">{{ tool.category }}</span>
                </div>
                <p class="mcp-desc">{{ tool.description }}</p>
              </div>
            </div>
            <a href="/reference/mcp-and-ide" class="ops-more">
              Browse all MCP &amp; IDE tools <MsIcon name="arrowRight" :size="14" />
            </a>
          </div>

          <div class="ops-panel">
            <div class="ops-head">
              <span class="ms-eyebrow">CI/CD &amp; Enterprise Governance</span>
              <h2>Production gates &amp; audit readiness</h2>
              <p>
                Emit deterministic CI reports, signed FMU/SSP artifacts, and air-gapped audit records without per-seat
                floating license servers.
              </p>
            </div>

            <div class="comp-block">
              <span class="comp-label">CI &amp; Verification Artifacts</span>
              <div class="comp-chips">
                <span v-for="fmt in industry.compliance.ciFormats" :key="fmt" class="comp-chip">{{ fmt }}</span>
              </div>
            </div>

            <div class="comp-block">
              <span class="comp-label">Regulatory &amp; Enterprise Support</span>
              <ul class="comp-list">
                <li v-for="feat in industry.compliance.enterpriseFeatures" :key="feat">
                  <MsIcon name="shield" :size="14" />
                  <span>{{ feat }}</span>
                </li>
              </ul>
            </div>

            <div class="comp-links">
              <a v-for="doc in industry.compliance.docsLinks" :key="doc.to" :href="doc.to" class="comp-doc-link">
                <span>{{ doc.label }}</span>
                <MsIcon name="arrowRight" :size="13" />
              </a>
            </div>
          </div>
        </div>
      </div>
    </section>

    <!-- Related + CTA -->
    <section class="ms-section ms-section-alt">
      <div class="ms-container">
        <div v-if="related.length" class="related">
          <h2 class="related-title">Cross-sector digital threads &amp; related industries</h2>
          <div class="related-grid">
            <a
              v-for="r in related"
              :key="r.industry.slug"
              :href="`/industries/${r.industry.slug}`"
              class="related-card"
              :style="{ '--accent': r.industry.accent }"
            >
              <span class="related-icon"><MsIcon :name="r.industry.icon" :size="22" :duotone="true" /></span>
              <span class="related-copy">
                <strong>{{ r.industry.name }}</strong>
                <small>{{ r.reason }}</small>
              </span>
              <MsIcon name="arrowRight" :size="16" class="related-arrow" />
            </a>
          </div>
        </div>

        <div class="ms-cta">
          <div>
            <h2>Open-core toolchain that runs anywhere</h2>
            <p>Browser, CLI, VS Code, CI pipelines, or air-gapped Enterprise Appliances (AGPL-3.0 Core &amp; Commercial Editions).</p>
          </div>
          <div class="ms-cta-actions">
            <a class="ms-btn ms-btn-lg ms-btn-brand" href="/guide/installation">Install ModelScript</a>
            <a class="ms-btn ms-btn-lg ms-btn-ghost" href="https://github.com/modelscript/modelscript">
              <MsIcon name="github" :size="16" /> Star on GitHub
            </a>
          </div>
        </div>
      </div>
    </section>
  </div>
  <div v-else class="ms-container ms-section">
    <h1>Industry not found</h1>
    <p><a href="/industries/">Browse all industries</a></p>
  </div>
</template>

<style scoped>
.ind-page {
  --accent: var(--vp-c-brand-1);
}

/* ── Hero ── */
.ind-hero {
  position: relative;
  overflow: hidden;
  padding: 72px 0 80px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ind-grid-bg {
  position: absolute;
  inset: 0;
  background-image:
    linear-gradient(var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-line) 1px, transparent 1px),
    linear-gradient(var(--ms-grid-sub) 1px, transparent 1px),
    linear-gradient(90deg, var(--ms-grid-sub) 1px, transparent 1px);
  background-size:
    64px 64px,
    64px 64px,
    16px 16px,
    16px 16px;
  mask-image: radial-gradient(ellipse 85% 75% at 50% 25%, #000 30%, transparent 78%);
  -webkit-mask-image: radial-gradient(ellipse 85% 75% at 50% 25%, #000 30%, transparent 78%);
  pointer-events: none;
}

.ind-glow {
  position: absolute;
  top: -220px;
  right: -120px;
  width: 640px;
  height: 640px;
  border-radius: 50%;
  background: radial-gradient(circle, color-mix(in srgb, var(--accent) 28%, transparent), transparent 65%);
  filter: blur(30px);
  pointer-events: none;
}

.ind-hero-inner {
  position: relative;
  display: grid;
  grid-template-columns: minmax(0, 1.15fr) minmax(0, 1fr);
  gap: 56px;
  align-items: center;
}

.ind-crumbs {
  display: flex;
  gap: 8px;
  margin-bottom: 20px;
  font-size: 13px;
  color: var(--vp-c-text-3);
}

.ind-crumbs a {
  color: var(--vp-c-text-2);
  text-decoration: none;
}

.ind-crumbs a:hover {
  color: var(--vp-c-brand-1);
}

.ind-eyebrow {
  display: inline-flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px 5px 6px;
  border-radius: 999px;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: color-mix(in srgb, var(--accent) 10%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
}

.ind-eyebrow-icon {
  display: grid;
  place-items: center;
  width: 26px;
  height: 26px;
  border-radius: 999px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 18%, transparent);
}

.ind-title {
  margin: 20px 0 16px;
  font-size: clamp(2rem, 4.2vw, 3.25rem);
  line-height: 1.08;
  font-weight: var(--ms-fw-bold);
  letter-spacing: var(--ms-tracking-tight);
  color: var(--vp-c-text-1);
}

.ind-summary {
  margin: 0;
  max-width: 600px;
  font-size: var(--text-md);
  line-height: var(--leading-md);
  color: var(--vp-c-text-2);
}

.ind-actions {
  display: flex;
  flex-wrap: wrap;
  gap: 12px;
  margin-top: 32px;
}

.ind-terminal {
  border-radius: 14px;
  overflow: hidden;
  background: #0a0f1c;
  border: 1px solid rgba(148, 163, 184, 0.18);
  box-shadow:
    0 40px 80px -30px color-mix(in srgb, var(--accent) 45%, transparent),
    0 20px 40px -20px rgba(0, 0, 0, 0.6);
}

.term-bar {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 10px 14px;
  background: rgba(255, 255, 255, 0.03);
  border-bottom: 1px solid rgba(148, 163, 184, 0.12);
}

.dot {
  width: 10px;
  height: 10px;
  border-radius: 50%;
  background: #334155;
}

.term-title {
  margin-left: 10px;
  font-family: var(--vp-font-family-mono);
  font-size: var(--text-xs);
  color: #94a3b8;
}

.term-body {
  margin: 0;
  padding: 18px 20px 22px;
  font-family: var(--vp-font-family-mono);
  font-size: var(--text-xs);
  line-height: 1.9;
  color: #e2e8f0;
  white-space: pre-wrap;
  word-break: break-word;
}

.term-prompt {
  color: var(--accent);
  user-select: none;
}

/* ── Pains ── */
.pain-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 20px;
}

.pain-card {
  position: relative;
  padding: 28px;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
  overflow: hidden;
}

.pain-card::before {
  content: "";
  position: absolute;
  top: 0;
  left: 20px;
  right: 20px;
  height: 1px;
  background: linear-gradient(90deg, transparent, color-mix(in srgb, var(--accent) 50%, transparent), transparent);
  opacity: 0.6;
}

.pain-num {
  display: inline-grid;
  place-items: center;
  padding: 3px 9px;
  border-radius: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: var(--text-xs);
  font-weight: var(--ms-fw-semibold);
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.pain-card h3,
.cap-card h3,
.flow-step h3 {
  margin: 12px 0 8px;
  font-size: var(--text-md);
  font-weight: var(--ms-fw-semibold);
  color: var(--vp-c-text-1);
}

.pain-card p,
.cap-card p,
.flow-step p {
  margin: 0;
  font-size: 0.92rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
}

/* ── Workflow ── */
.flow {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  grid-template-columns: repeat(4, 1fr);
  gap: 16px;
  counter-reset: flow;
}

.flow-step {
  position: relative;
  padding: 24px;
  border-radius: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.04);
}

.flow-step:not(:last-child)::after {
  content: "";
  position: absolute;
  top: 40px;
  right: -17px;
  width: 18px;
  height: 1px;
  background: linear-gradient(90deg, var(--accent), transparent);
}

.flow-idx {
  display: grid;
  place-items: center;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  font-size: 14px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 25% 20%, color-mix(in srgb, var(--accent) 24%, transparent), transparent 68%),
    color-mix(in srgb, var(--accent) 10%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.16);
}

/* ── Capabilities ── */
.cap-grid {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 16px;
}

.cap-card {
  display: flex;
  gap: 16px;
  padding: 24px;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
  transition:
    border-color 0.25s,
    transform 0.25s;
}

.cap-card:hover {
  border-color: color-mix(in srgb, var(--accent) 50%, transparent);
  transform: translateY(-2px);
}

.cap-card h3 {
  margin-top: 0;
}

.cap-check {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 38px;
  height: 38px;
  border-radius: 11px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background:
    radial-gradient(circle at 30% 25%, color-mix(in srgb, var(--accent) 26%, transparent), transparent 70%),
    color-mix(in srgb, var(--accent) 14%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.14);
}

/* ── Formats ── */
.fmt-layout {
  display: grid;
  grid-template-columns: minmax(0, 1fr) 320px;
  gap: 32px;
  align-items: start;
}

.fmt-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(210px, 1fr));
  gap: 12px;
}

.fmt-card {
  display: flex;
  flex-direction: column;
  gap: 4px;
  padding: 16px;
  border-radius: 12px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  transition:
    border-color 0.2s,
    transform 0.2s;
}

.fmt-card:hover {
  border-color: var(--accent);
  transform: translateY(-2px);
}

.fmt-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.fmt-ext {
  align-self: flex-start;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.fmt-tier {
  display: inline-block;
  padding: 1px 6px;
  border-radius: 999px;
  font-size: 10px;
  font-weight: 600;
  border: 1px solid transparent;
}
.fmt-tier--beta {
  color: var(--ms-tier-beta);
  background: var(--ms-tier-beta-bg);
  border-color: var(--ms-tier-beta-border);
}
.fmt-tier--alpha {
  color: var(--ms-tier-alpha);
  background: var(--ms-tier-alpha-bg);
  border-color: var(--ms-tier-alpha-border);
}
.fmt-tier--pre-alpha {
  color: var(--ms-tier-pre-alpha);
  background: var(--ms-tier-pre-alpha-bg);
  border-color: var(--ms-tier-pre-alpha-border);
}

.fmt-name {
  margin-top: 6px;
  font-weight: var(--ms-fw-semibold);
  font-size: var(--text-base);
  color: var(--vp-c-text-1);
}

.fmt-role {
  font-size: var(--text-sm);
  line-height: var(--leading-sm);
  color: var(--vp-c-text-2);
}

.std-card {
  position: sticky;
  top: calc(var(--vp-nav-height) + 24px);
  padding: 24px;
  border-radius: 16px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: inset 0 1px 0 rgba(255, 255, 255, 0.05);
}

.std-card h3 {
  display: flex;
  align-items: center;
  gap: 8px;
  margin: 0 0 14px;
  font-size: var(--text-md);
  font-weight: var(--ms-fw-semibold);
  color: var(--vp-c-text-1);
}

.std-card ul {
  list-style: none;
  margin: 0 0 18px;
  padding: 0;
  display: grid;
  gap: 10px;
}

.std-card li {
  display: flex;
  align-items: center;
  gap: 10px;
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
}

.std-card li .ms-icon {
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.std-link {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

/* ── Related ── */
.related {
  margin-bottom: 64px;
}

.related-title {
  margin: 0 0 20px;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.related-grid {
  display: grid;
  grid-template-columns: repeat(3, 1fr);
  gap: 14px;
}

.related-card {
  display: flex;
  align-items: center;
  gap: 14px;
  padding: 18px;
  border-radius: 16px;
  border: 1px solid var(--vp-c-divider);
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  text-decoration: none;
  color: var(--vp-c-text-1);
  transition:
    border-color 0.25s ease,
    transform 0.25s ease,
    box-shadow 0.25s ease;
}

.related-card:hover {
  transform: translateY(-2px);
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  box-shadow: 0 18px 36px -22px color-mix(in srgb, var(--accent) 50%, transparent);
}

.related-card strong {
  display: block;
  font-size: 0.95rem;
}

.related-card small {
  display: block;
  margin-top: 2px;
  font-size: 0.8rem;
  color: var(--vp-c-text-2);
}

.related-icon {
  display: grid;
  place-items: center;
  flex-shrink: 0;
  width: 44px;
  height: 44px;
  border-radius: 12px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background-color: color-mix(in srgb, var(--accent) 10%, var(--vp-c-bg-soft));
  background-image:
    radial-gradient(circle at 22% 18%, color-mix(in srgb, var(--accent) 22%, transparent), transparent 66%),
    linear-gradient(color-mix(in srgb, var(--accent) 7%, transparent) 1px, transparent 1px),
    linear-gradient(90deg, color-mix(in srgb, var(--accent) 7%, transparent) 1px, transparent 1px);
  background-size:
    100% 100%,
    11px 11px,
    11px 11px;
  border: 1px solid color-mix(in srgb, var(--accent) 34%, transparent);
  box-shadow:
    inset 0 1px 0 rgba(255, 255, 255, 0.2),
    0 8px 18px -8px color-mix(in srgb, var(--accent) 45%, transparent);
}

.related-arrow {
  margin-left: auto;
  color: var(--vp-c-text-3);
  transition:
    transform 0.2s,
    color 0.2s;
}

.related-card:hover .related-arrow {
  transform: translateX(3px);
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.related-copy {
  min-width: 0;
}

.related-copy small {
  display: -webkit-box;
  -webkit-line-clamp: 2;
  -webkit-box-orient: vertical;
  overflow: hidden;
  line-height: 1.45;
}

/* ── Hero Stats & Terminal Copy ── */
.ind-hero-stats {
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
  margin-top: 22px;
}

.hero-stat-pill {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 11px;
  border-radius: 999px;
  font-size: 12px;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, var(--vp-c-bg-soft) 80%, transparent);
  border: 1px solid var(--vp-c-divider);
}

.hero-stat-pill strong {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 700;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.term-copy {
  margin-left: auto;
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  color: #cbd5e1;
  background: rgba(148, 163, 184, 0.12);
  border: 1px solid rgba(148, 163, 184, 0.2);
  cursor: pointer;
  transition: background 0.18s ease, color 0.18s ease;
}

.term-copy:hover {
  color: #fff;
  background: rgba(148, 163, 184, 0.24);
}

/* ── Interactive Model & Schematic Workbench ── */
.wb-shell {
  border-radius: 16px;
  overflow: hidden;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  box-shadow: 0 24px 56px -34px rgba(15, 23, 42, 0.35);
}

.wb-topbar {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 12px 16px;
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.wb-model-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.wb-model-tab {
  display: inline-flex;
  align-items: center;
  gap: 7px;
  padding: 6px 12px;
  border-radius: 9px;
  font-size: 12.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: 1px solid transparent;
  cursor: pointer;
  transition: all 0.18s ease;
}

.wb-model-tab:hover {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
}

.wb-model-tab.active {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border-color: color-mix(in srgb, var(--accent) 45%, var(--vp-c-divider));
  box-shadow: 0 2px 8px -3px rgba(15, 23, 42, 0.12);
}

.wb-model-ext {
  padding: 1px 6px;
  border-radius: 5px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
}

.wb-controls {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 8px;
}

.wb-view-tabs {
  display: inline-flex;
  padding: 3px;
  border-radius: 9px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  gap: 2px;
}

.wb-view-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 4px 9px;
  border-radius: 6px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: transparent;
  border: none;
  cursor: pointer;
}

.wb-view-btn.active {
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
}

.wb-morsel-btn {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 12%, transparent);
  border: 1px solid color-mix(in srgb, var(--accent) 32%, transparent);
  transition: background 0.18s ease, border-color 0.18s ease;
}

.wb-morsel-btn:hover {
  background: color-mix(in srgb, var(--accent) 20%, transparent);
  border-color: color-mix(in srgb, var(--accent) 52%, transparent);
}

.wb-caption {
  padding: 12px 18px;
  border-bottom: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg);
}

.wb-caption-title {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 10px;
}

.wb-filename {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.wb-caption-title strong {
  font-size: 0.95rem;
  color: var(--vp-c-text-1);
}

.wb-desc {
  margin: 4px 0 0;
  font-size: 0.87rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.wb-body {
  display: grid;
  min-height: 360px;
}

.wb-body.is-split {
  grid-template-columns: minmax(0, 1fr) minmax(0, 1fr);
}

.wb-body.is-code,
.wb-body.is-diagram {
  grid-template-columns: minmax(0, 1fr);
}

.wb-code-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--vp-code-block-bg);
  border-right: 1px solid var(--vp-c-divider);
}

.wb-body.is-code .wb-code-pane {
  border-right: none;
}

.wb-diagram-pane {
  display: flex;
  flex-direction: column;
  min-width: 0;
  background: var(--vp-c-bg);
}

.wb-pane-bar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  padding: 7px 14px;
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border-bottom: 1px solid var(--vp-c-divider);
}

.wb-pane-bar > span {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.wb-pane-actions {
  display: flex;
  align-items: center;
  gap: 10px;
}

.wb-lang-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-size: 11.5px;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.wb-copy-btn {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  border-radius: 5px;
  font-size: 11px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-elv);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
}

.wb-copy-btn:hover {
  color: var(--vp-c-text-1);
}

.wb-theme-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: var(--vp-c-text-3);
}

.wb-code-scroll {
  flex: 1;
  max-height: 410px;
  overflow: auto;
  padding: 12px 0;
}

.wb-code-pre {
  margin: 0 !important;
  padding: 0 14px !important;
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  line-height: 1.55;
  background: transparent !important;
}

.wb-code-line {
  display: table-row;
}

.wb-line-num {
  display: table-cell;
  user-select: none;
  text-align: right;
  padding-right: 12px;
  min-width: 28px;
  color: var(--vp-c-text-3);
  font-size: 11px;
}

.wb-line-text {
  display: table-cell;
  white-space: pre;
  color: var(--vp-c-text-1);
}

.wb-svg-stage {
  flex: 1;
  display: flex;
  align-items: center;
  justify-content: center;
  padding: 16px;
  min-height: 340px;
  overflow: auto;
}

.wb-svg-stage :deep(svg) {
  max-width: 100%;
  max-height: 370px;
  width: auto;
  height: auto;
  display: block;
  border-radius: 8px;
}

/* ── Domain Track Filters & Format Capability Badges ── */
.track-filter-wrap {
  margin-bottom: 18px;
}

.track-tabs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.track-tab {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 6px 12px;
  border-radius: 999px;
  font-size: 12px;
  font-weight: 600;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  cursor: pointer;
  transition: all 0.18s ease;
}

.track-tab:hover {
  color: var(--vp-c-text-1);
  border-color: color-mix(in srgb, var(--accent) 40%, var(--vp-c-divider));
}

.track-tab.active {
  color: var(--vp-c-text-1);
  background: color-mix(in srgb, var(--accent) 12%, var(--vp-c-bg));
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
}

.track-count {
  padding: 1px 6px;
  border-radius: 999px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: var(--vp-c-text-3);
  background: var(--vp-c-bg);
}

.track-tab.active .track-count {
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.track-summary {
  margin: 10px 0 0;
  padding: 10px 14px;
  border-radius: 10px;
  font-size: 0.87rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
  background: color-mix(in srgb, var(--accent) 6%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 22%, var(--vp-c-divider));
}

.fmt-caps {
  display: flex;
  flex-wrap: wrap;
  gap: 5px;
  margin-top: 8px;
}

.fmt-cap-pill {
  padding: 1px 7px;
  border-radius: 5px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

/* ── Benchmarks & Workspaces ── */
.left-lead {
  max-width: 780px;
  margin: 8px 0 0;
  text-align: left;
}

.bench-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(280px, 1fr));
  gap: 14px;
}

.bench-card {
  display: flex;
  flex-direction: column;
  padding: 20px;
  border-radius: 14px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  text-decoration: none;
  transition: border-color 0.2s, transform 0.2s;
}

.bench-card:hover {
  border-color: color-mix(in srgb, var(--accent) 55%, transparent);
  transform: translateY(-2px);
}

.bench-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
}

.bench-ref {
  font-family: var(--vp-font-family-mono);
  font-size: 11px;
  font-weight: 600;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.bench-thresh {
  padding: 2px 7px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 10.5px;
  font-weight: 600;
  color: var(--ms-tier-beta);
  background: var(--ms-tier-beta-bg);
  border: 1px solid var(--ms-tier-beta-border);
}

.bench-card h3 {
  margin: 10px 0 6px;
  font-size: 0.98rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
}

.bench-card p {
  margin: 0;
  font-size: 0.85rem;
  line-height: 1.5;
  color: var(--vp-c-text-2);
}

.bench-foot {
  margin-top: auto;
  padding-top: 14px;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  font-size: 11.5px;
}

.bench-meta {
  font-family: var(--vp-font-family-mono);
  color: var(--vp-c-text-3);
}

.bench-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
}

.ws-block {
  margin-top: 40px;
}

.ws-header h3 {
  margin: 6px 0 16px;
  font-size: 1.25rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ws-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 16px;
}

.ws-grid--single {
  grid-template-columns: minmax(0, 1fr);
}

.ws-card {
  padding: 22px;
  border-radius: 14px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.ws-top {
  display: flex;
  flex-wrap: wrap;
  align-items: baseline;
  justify-content: space-between;
  gap: 8px;
}

.ws-top h4 {
  margin: 0;
  font-size: 1.02rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ws-path {
  padding: 2px 8px;
  border-radius: 6px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
}

.ws-summary {
  margin: 8px 0 12px;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.ws-langs {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
  margin-bottom: 12px;
}

.ws-lang-chip {
  padding: 2px 9px;
  border-radius: 999px;
  font-size: 11.5px;
  font-weight: 600;
  text-decoration: none;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
  background: color-mix(in srgb, var(--accent) 10%, var(--vp-c-bg-soft));
  border: 1px solid color-mix(in srgb, var(--accent) 28%, transparent);
}

.ws-highlights {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 6px;
}

.ws-highlights li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.85rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.ws-highlights li .ms-icon {
  margin-top: 2px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

/* ── AI MCP Tools & Enterprise Compliance Panels ── */
.ops-grid {
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 20px;
}

.ops-panel {
  display: flex;
  flex-direction: column;
  padding: 26px;
  border-radius: 16px;
  background: linear-gradient(180deg, var(--vp-c-bg-soft), var(--vp-c-bg));
  border: 1px solid var(--vp-c-divider);
}

.ops-head h2 {
  margin: 8px 0 8px;
  font-size: 1.35rem;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ops-head p {
  margin: 0 0 18px;
  font-size: 0.9rem;
  line-height: 1.55;
  color: var(--vp-c-text-2);
}

.mcp-list {
  display: grid;
  gap: 10px;
  margin-bottom: 16px;
}

.mcp-item {
  padding: 12px 14px;
  border-radius: 10px;
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.mcp-item-head {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  margin-bottom: 4px;
}

.mcp-name {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  font-weight: 700;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.mcp-cat {
  font-size: 10.5px;
  color: var(--vp-c-text-3);
}

.mcp-desc {
  margin: 0;
  font-size: 0.82rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.ops-more {
  margin-top: auto;
  display: inline-flex;
  align-items: center;
  gap: 6px;
  font-size: 0.88rem;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
}

.comp-block {
  margin-bottom: 18px;
}

.comp-label {
  display: block;
  margin-bottom: 8px;
  font-size: 11px;
  font-weight: 700;
  letter-spacing: 0.06em;
  text-transform: uppercase;
  color: var(--vp-c-text-3);
}

.comp-chips {
  display: flex;
  flex-wrap: wrap;
  gap: 6px;
}

.comp-chip {
  padding: 4px 10px;
  border-radius: 7px;
  font-family: var(--vp-font-family-mono);
  font-size: 11.5px;
  font-weight: 600;
  color: var(--vp-c-text-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
}

.comp-list {
  list-style: none;
  margin: 0;
  padding: 0;
  display: grid;
  gap: 8px;
}

.comp-list li {
  display: flex;
  align-items: flex-start;
  gap: 8px;
  font-size: 0.88rem;
  line-height: 1.45;
  color: var(--vp-c-text-2);
}

.comp-list li .ms-icon {
  margin-top: 2px;
  color: color-mix(in srgb, var(--accent) var(--ms-accent-strength), var(--vp-c-text-1));
}

.comp-links {
  margin-top: auto;
  padding-top: 8px;
  display: flex;
  flex-wrap: wrap;
  gap: 8px;
}

.comp-doc-link {
  display: inline-flex;
  align-items: center;
  gap: 5px;
  padding: 6px 12px;
  border-radius: 8px;
  font-size: 12px;
  font-weight: 600;
  text-decoration: none;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-divider);
  transition: border-color 0.18s ease;
}

.comp-doc-link:hover {
  border-color: var(--vp-c-brand-1);
}

@media (max-width: 960px) {
  .ind-hero-inner,
  .fmt-layout,
  .wb-body.is-split,
  .ops-grid,
  .ws-grid {
    grid-template-columns: 1fr;
  }
  .wb-code-pane {
    border-right: none;
    border-bottom: 1px solid var(--vp-c-divider);
  }
  .pain-grid,
  .related-grid {
    grid-template-columns: 1fr;
  }
  .flow {
    grid-template-columns: repeat(2, 1fr);
  }
  .flow-step::after {
    display: none;
  }
  .std-card {
    position: static;
  }
}

@media (max-width: 640px) {
  .ind-hero {
    padding: 48px 0 56px;
  }
  .flow,
  .cap-grid {
    grid-template-columns: 1fr;
  }
}
</style>
