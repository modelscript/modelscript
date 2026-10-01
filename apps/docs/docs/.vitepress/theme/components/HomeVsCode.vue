<script setup lang="ts">
const features = [
  {
    icon: "🎨",
    title: "Syntax Highlighting",
    description: "Deep highlighting powered by WASM GLR parser tokens and TextMate grammar rules.",
  },
  {
    icon: "⚡",
    title: "Diagnostics & Linting",
    description: "Sub-millisecond diagnostics with 15+ compiler lint rules and inline quick-fixes.",
  },
  {
    icon: "📊",
    title: "Interactive Diagramming",
    description: "Visual schematic editor with automatic connector routing and SVG icon rendering.",
  },
  {
    icon: "📈",
    title: "In-Editor Simulation",
    description: "Run numerical simulations and inspect trajectory plots without leaving VS Code.",
  },
  {
    icon: "💡",
    title: "Hover & Navigation",
    description: "Go-to-definition, hover type inspection, and Salsa-backed semantic completion.",
  },
  {
    icon: "📦",
    title: "Bundled MSL",
    description: "Pre-indexed Modelica Standard Library (MSL 4.0.0) ready out of the box.",
  },
];
</script>

<template>
  <section class="home-section vscode-section">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">Editor Tooling</span>
        <h2 class="section-title">VS Code Extension</h2>
        <p class="section-subtitle">
          Turn VS Code into a comprehensive physical modeling and simulation IDE.
        </p>
      </div>

      <div class="vscode-grid">
        <div v-for="feat in features" :key="feat.title" class="vscode-feat-card">
          <span class="feat-icon">{{ feat.icon }}</span>
          <div class="feat-content">
            <h3 class="feat-title">{{ feat.title }}</h3>
            <p class="feat-desc">{{ feat.description }}</p>
          </div>
        </div>
      </div>

      <div class="vscode-actions">
        <a
          href="https://marketplace.visualstudio.com/items?itemName=modelscript.vscode"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-primary"
        >
          Install from Marketplace &rarr;
        </a>
        <a
          href="https://open-vsx.org/extension/modelscript/vscode"
          target="_blank"
          rel="noopener noreferrer"
          class="btn-secondary"
        >
          Open VSX Registry
        </a>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-section {
  padding: 64px 24px;
}

.section-container {
  max-width: 1040px;
  margin: 0 auto;
}

.section-header {
  text-align: center;
  margin-bottom: 48px;
}

.section-badge {
  display: inline-block;
  padding: 4px 12px;
  border-radius: 999px;
  font-size: 0.8rem;
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--vp-c-brand-1);
  background: var(--vp-c-brand-soft);
  margin-bottom: 12px;
}

.section-title {
  font-size: clamp(1.8rem, 3.5vw, 2.4rem);
  font-weight: 700;
  letter-spacing: -0.02em;
  color: var(--vp-c-text-1);
}

.section-subtitle {
  color: var(--vp-c-text-2);
  font-size: 1.05rem;
  margin-top: 8px;
  line-height: 1.6;
}

.vscode-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(300px, 1fr));
  gap: 20px;
  margin-bottom: 40px;
}

.vscode-feat-card {
  display: flex;
  gap: 16px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 12px;
  padding: 20px;
  transition: border-color 0.25s ease, transform 0.25s ease;
}

.vscode-feat-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
}

.feat-icon {
  font-size: 1.6rem;
  line-height: 1;
  flex-shrink: 0;
  margin-top: 2px;
}

.feat-title {
  font-size: 1.05rem;
  font-weight: 600;
  color: var(--vp-c-text-1);
  margin: 0 0 6px 0;
}

.feat-desc {
  font-size: 0.9rem;
  color: var(--vp-c-text-2);
  line-height: 1.5;
  margin: 0;
}

.vscode-actions {
  display: flex;
  justify-content: center;
  gap: 16px;
  flex-wrap: wrap;
}

.btn-primary {
  display: inline-flex;
  align-items: center;
  padding: 12px 24px;
  background: var(--vp-c-brand-1);
  color: #fff !important;
  font-weight: 600;
  border-radius: 8px;
  text-decoration: none;
  transition: background 0.2s, transform 0.2s;
  box-shadow: 0 4px 14px var(--vp-c-brand-soft);
}

.btn-primary:hover {
  background: var(--vp-c-brand-2);
  transform: translateY(-1px);
}

.btn-secondary {
  display: inline-flex;
  align-items: center;
  padding: 12px 24px;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  color: var(--vp-c-text-1) !important;
  font-weight: 600;
  border-radius: 8px;
  text-decoration: none;
  transition: border-color 0.2s, background 0.2s;
}

.btn-secondary:hover {
  border-color: var(--vp-c-brand-1);
  background: var(--vp-c-default-soft);
}
</style>
