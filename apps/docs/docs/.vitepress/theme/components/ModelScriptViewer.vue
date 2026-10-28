<script setup lang="ts">
import { computed } from "vue";

const props = withDefaults(
  defineProps<{
    code: string;
    dialect?: string;
    view?: string;
    anchor?: string;
    height?: string;
    title?: string;
    isMultiFile?: boolean;
    artifactId?: string;
    token?: string;
  }>(),
  {
    dialect: "modelica",
    view: "diagram",
    height: "480px",
    isMultiFile: false,
  },
);

const iframeSrc = computed(() => {
  if (props.token) {
    return `/embed/playground#m=${props.token}`;
  }
  const dialectKey = encodeURIComponent(props.dialect || "modelica");
  const encodedCode = encodeURIComponent(props.code.trim());
  return `/embed/playground#${dialectKey}=${encodedCode}`;
});
</script>

<template>
  <div class="modelscript-embed-container" :style="{ height }">
    <iframe
      :src="iframeSrc"
      width="100%"
      height="100%"
      frameborder="0"
      allow="clipboard-read; clipboard-write"
      :title="title || 'ModelScript Artifact Viewer'"
    />
  </div>
</template>

<style scoped>
.modelscript-embed-container {
  width: 100%;
  border-radius: 8px;
  overflow: hidden;
  border: 1px solid var(--vp-c-divider);
  background: var(--vp-c-bg-alt);
  margin: 16px 0;
  box-shadow: 0 4px 16px rgba(0, 0, 0, 0.15);
}
</style>
