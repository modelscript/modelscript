<!-- SPDX-License-Identifier: AGPL-3.0-or-later -->
<script setup lang="ts">
import { useData } from "vitepress";
import { computed } from "vue";
import { resolveAuthor } from "../data/authors";
import { data as allPosts } from "../data/posts.data";

const { frontmatter } = useData();

const postRecord = computed(() => {
  const slug = String(frontmatter.value.slug || "");
  return allPosts.find((p) => p.slug === slug);
});

const author = computed(() => resolveAuthor(frontmatter.value.author));

const formattedDate = computed(() => {
  const raw = frontmatter.value.date;
  const iso = raw instanceof Date ? raw.toISOString().slice(0, 10) : String(raw || "").slice(0, 10);
  if (!iso) return "";
  return new Date(`${iso}T12:00:00Z`).toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
    timeZone: "UTC",
  });
});

const tags = computed<string[]>(() =>
  Array.isArray(frontmatter.value.tags) ? frontmatter.value.tags.map((t: unknown) => String(t)) : [],
);
</script>

<template>
  <header v-if="frontmatter.slug" class="ms-post-header">
    <a href="/" class="ms-back-link">← All posts</a>

    <div class="ms-post-meta-row">
      <time v-if="formattedDate" :datetime="String(frontmatter.date)">{{ formattedDate }}</time>
      <template v-if="postRecord">
        <span aria-hidden="true">·</span>
        <span>{{ postRecord.readingTimeMinutes }} min read</span>
      </template>
    </div>

    <h1 class="ms-post-title">{{ frontmatter.title }}</h1>
    <p v-if="frontmatter.description" class="ms-post-subtitle">{{ frontmatter.description }}</p>

    <div class="ms-post-byline">
      <div class="ms-author-block">
        <span class="ms-author-primary">{{ author.name }}</span>
        <span class="ms-author-role">{{ author.role }}</span>
      </div>
      <div v-if="tags.length > 0" class="ms-post-tags">
        <span v-for="t in tags" :key="t" class="ms-post-tag">#{{ t }}</span>
      </div>
    </div>
  </header>
</template>

<style scoped>
.ms-post-header {
  margin-bottom: 32px;
  padding-bottom: 24px;
  border-bottom: 1px solid var(--vp-c-divider);
}

.ms-back-link {
  display: inline-block;
  font-size: 13px;
  font-weight: 600;
  color: var(--vp-c-brand-1);
  text-decoration: none;
  margin-bottom: 16px;
}

.ms-back-link:hover {
  text-decoration: underline;
}

.ms-post-meta-row {
  display: flex;
  align-items: center;
  gap: 8px;
  font-family: var(--vp-font-family-mono);
  font-size: 13px;
  color: var(--vp-c-text-3);
  margin-bottom: 10px;
}

.ms-post-title {
  font-size: clamp(1.85rem, 3.6vw, 2.55rem);
  line-height: 1.16;
  font-weight: 800;
  letter-spacing: -0.025em;
  margin: 0 0 14px;
  color: var(--vp-c-text-1);
}

.ms-post-subtitle {
  font-size: 1.1rem;
  line-height: 1.6;
  color: var(--vp-c-text-2);
  margin: 0 0 20px;
}

.ms-post-byline {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 16px;
  flex-wrap: wrap;
}

.ms-author-block {
  display: flex;
  flex-direction: column;
  gap: 2px;
}

.ms-author-primary {
  font-size: 14px;
  font-weight: 700;
  color: var(--vp-c-text-1);
}

.ms-author-role {
  font-size: 12.5px;
  color: var(--vp-c-text-3);
}

.ms-post-tags {
  display: flex;
  gap: 8px;
  flex-wrap: wrap;
}

.ms-post-tag {
  font-family: var(--vp-font-family-mono);
  font-size: 12px;
  padding: 3px 10px;
  border-radius: 999px;
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
}
</style>
