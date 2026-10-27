<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";
import MsIcon from "./MsIcon.vue";

const { page, frontmatter } = useData();

interface Crumb {
  label: string;
  link?: string;
}

const SECTION_MAP: Record<string, { label: string; link: string }> = {
  guide: { label: "Guide", link: "/guide/introduction" },
  architecture: { label: "Architecture", link: "/architecture/overview" },
  algorithms: { label: "Algorithms", link: "/algorithms/overview" },
  cli: { label: "CLI Reference", link: "/cli/overview" },
  languages: { label: "Languages", link: "/languages/overview" },
  industries: { label: "Industries", link: "/industries" },
  reference: { label: "Reference", link: "/reference/linter-rules" },
};

const crumbs = computed<Crumb[]>(() => {
  const rel = page.value.relativePath ?? "";
  if (!rel || rel === "index.md" || frontmatter.value.layout === "home") {
    return [];
  }

  const clean = rel.replace(/(^|\/)index\.md$/, "$1").replace(/\.md$/, "");
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
  </nav>
</template>

<style scoped>
.doc-breadcrumbs {
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

@media (max-width: 640px) {
  .doc-breadcrumbs-current {
    max-width: 180px;
  }
}
</style>
