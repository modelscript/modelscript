<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed, ref } from "vue";
import MsIcon from "./MsIcon.vue";

const { page, frontmatter } = useData();
const copied = ref(false);

interface Crumb {
  label: string;
  link?: string;
}

const SECTION_MAP: Record<string, { label: string; link: string }> = {
  guide: { label: "Guide", link: "/guide/introduction" },
  ansatz: { label: "Ansatz Platform", link: "/ansatz/overview" },
  architecture: { label: "Architecture", link: "/architecture/overview" },
  algorithms: { label: "Algorithms", link: "/algorithms/overview" },
  cli: { label: "CLI Reference", link: "/cli/overview" },
  languages: { label: "Languages", link: "/languages/overview" },
  industries: { label: "Industries", link: "/industries" },
  reference: { label: "Reference", link: "/reference/linter-rules" },
};

const cleanRoute = computed(() => {
  const rel = page.value.relativePath ?? "";
  return rel.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
});

const crumbs = computed<Crumb[]>(() => {
  const rel = page.value.relativePath ?? "";
  if (!rel || rel === "index.md" || frontmatter.value.layout === "home") {
    return [];
  }

  const clean = cleanRoute.value;
  const parts = clean.split("/").filter(Boolean);
  if (parts.length === 0) return [];

  const list: Crumb[] = [{ label: "Home", link: "/" }];
  const sectionKey = parts[0];
  const section = sectionKey ? SECTION_MAP[sectionKey] : undefined;

  if (section) {
    // If we're not on the section root itself, link to the section
    const currentLink = `/${clean}`;
    if (currentLink !== section.link) {
      list.push({ label: section.label, link: section.link });
    }
  }

  // Current page leaf
  const title = (page.value.title || parts[parts.length - 1] || "").replace(/\s*\|\s*ModelScript.*$/, "");
  list.push({ label: title });

  return list;
});

function extractPageMarkdown(): string {
  const title = (page.value.title || "ModelScript Documentation").replace(/\s*\|\s*ModelScript.*$/, "");
  const url = `https://modelscript.org/${cleanRoute.value}`;
  const lines: string[] = [`# ${title}`, "", `Canonical URL: ${url}`];
  if (page.value.description) {
    lines.push(`Description: ${page.value.description}`);
  }
  lines.push("");

  if (typeof document !== "undefined") {
    const docRoot = document.querySelector(".vp-doc");
    if (docRoot) {
      const blocks = docRoot.querySelectorAll("h1, h2, h3, h4, p, pre, ul, ol, table");
      for (const el of blocks) {
        const tag = el.tagName.toLowerCase();
        const text = (el.textContent || "").replace(/\u200b/g, "").trim();
        if (!text) continue;
        if (tag === "h1") lines.push(`# ${text}`, "");
        else if (tag === "h2") lines.push(`## ${text}`, "");
        else if (tag === "h3") lines.push(`### ${text}`, "");
        else if (tag === "h4") lines.push(`#### ${text}`, "");
        else if (tag === "pre") lines.push("```", text, "```", "");
        else if (tag === "ul" || tag === "ol") {
          const items = el.querySelectorAll(":scope > li");
          items.forEach((li, idx) => {
            const liText = (li.textContent || "").trim().replace(/\s+/g, " ");
            if (liText) lines.push(tag === "ol" ? `${idx + 1}. ${liText}` : `- ${liText}`);
          });
          lines.push("");
        } else if (tag === "table") {
          const rows = el.querySelectorAll("tr");
          rows.forEach((tr, rIdx) => {
            const cells = Array.from(tr.querySelectorAll("th, td")).map((c) =>
              (c.textContent || "").trim().replace(/\|/g, "\\|").replace(/\s+/g, " "),
            );
            if (cells.length > 0) {
              lines.push(`| ${cells.join(" | ")} |`);
              if (rIdx === 0) {
                lines.push(`| ${cells.map(() => "---").join(" | ")} |`);
              }
            }
          });
          lines.push("");
        } else if (tag === "p" && !el.closest("li, td, th, blockquote")) {
          lines.push(text, "");
        }
      }
    }
  }

  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

async function copyMarkdownForAi(): Promise<void> {
  try {
    const md = extractPageMarkdown();
    await navigator.clipboard.writeText(md);
    copied.value = true;
    setTimeout(() => {
      copied.value = false;
    }, 2000);
  } catch {
    /* clipboard unavailable */
  }
}
</script>

<template>
  <nav v-if="crumbs.length > 1" class="doc-breadcrumbs" aria-label="Breadcrumb">
    <ol class="doc-breadcrumbs-list">
      <li v-for="(c, i) in crumbs" :key="i" class="doc-breadcrumbs-item">
        <a v-if="c.link && i < crumbs.length - 1" :href="c.link" class="doc-breadcrumbs-link">
          <MsIcon v-if="i === 0" name="globe" :size="12" class="home-icon" />
          <span>{{ c.label }}</span>
        </a>
        <span v-else class="doc-breadcrumbs-current" aria-current="page">
          {{ c.label }}
        </span>
        <span v-if="i < crumbs.length - 1" class="doc-breadcrumbs-sep" aria-hidden="true">/</span>
      </li>
    </ol>
    <button
      type="button"
      class="copy-ai-btn"
      :class="{ copied }"
      title="Copy clean Markdown of this page for AI agents & LLMs"
      @click="copyMarkdownForAi"
    >
      <MsIcon :name="copied ? 'check' : 'copy'" :size="13" />
      <span>{{ copied ? "Copied for AI" : "Copy Markdown for AI" }}</span>
    </button>
  </nav>
</template>

<style scoped>
.doc-breadcrumbs {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  justify-content: space-between;
  gap: 10px;
  margin-bottom: 16px;
  font-size: 13px;
  line-height: 1.4;
  color: var(--vp-c-text-3);
}

.doc-breadcrumbs-list {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  list-style: none;
  padding: 0;
  margin: 0;
  gap: 6px;
}

.doc-breadcrumbs-item {
  display: inline-flex;
  align-items: center;
  gap: 6px;
}

.doc-breadcrumbs-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  color: var(--vp-c-text-2);
  text-decoration: none;
  transition: color 0.15s ease;
}

.doc-breadcrumbs-link:hover {
  color: var(--vp-c-brand-1);
}

.home-icon {
  opacity: 0.7;
}

.doc-breadcrumbs-current {
  color: var(--vp-c-text-1);
  font-weight: 500;
  max-width: 280px;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}

.doc-breadcrumbs-sep {
  color: var(--vp-c-divider);
  user-select: none;
  font-size: 12px;
}

.copy-ai-btn {
  display: inline-flex;
  align-items: center;
  gap: 6px;
  padding: 4px 10px;
  font-size: 12px;
  font-weight: 500;
  color: var(--vp-c-text-2);
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-divider);
  border-radius: 6px;
  cursor: pointer;
  transition:
    color 0.15s ease,
    border-color 0.15s ease,
    background 0.15s ease;
}

.copy-ai-btn:hover {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.copy-ai-btn.copied {
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
}

@media (max-width: 640px) {
  .doc-breadcrumbs-current {
    max-width: 180px;
  }
}
</style>

