<script setup lang="ts">
import { ref } from "vue";

interface PackageInfo {
  name: string;
  description: string;
  install: string;
  docsLink: string;
  npmLink: string;
  tag: string;
}

const packages: PackageInfo[] = [
  {
    name: "@modelscript/cli",
    description: "The unified msc command-line toolchain — flatten, simulate, optimize, lint, render, and execute the digital thread.",
    install: "npm install -g @modelscript/cli",
    docsLink: "/cli/overview",
    npmLink: "https://www.npmjs.com/package/@modelscript/cli",
    tag: "Toolchain",
  },
  {
    name: "@modelscript/modelica",
    description: "High-performance Modelica compiler — native WebAssembly GLR parser, CST indexer, and DAE flattener.",
    install: "npm install @modelscript/modelica",
    docsLink: "/languages/modelica",
    npmLink: "https://www.npmjs.com/package/@modelscript/modelica",
    tag: "Compiler",
  },
  {
    name: "@modelscript/dsl",
    description: "Polyglot modeling language runtime — AST combinators, GLR parser generator, and graph rewriting engines.",
    install: "npm install @modelscript/dsl",
    docsLink: "/architecture/overview",
    npmLink: "https://www.npmjs.com/package/@modelscript/dsl",
    tag: "Grammar & AST",
  },
  {
    name: "@modelscript/runtime",
    description: "Linear-memory WebAssembly DAE arena, Salsa incremental query engine, and computable digital thread coordinator.",
    install: "npm install @modelscript/runtime",
    docsLink: "/architecture/dae-arena",
    npmLink: "https://www.npmjs.com/package/@modelscript/runtime",
    tag: "Arena Engine",
  },
  {
    name: "@modelscript/simulate",
    description: "Numerical ODE/DAE integrators, SUNDIALS CVODE/IDA, WebGPU batched solver, and surrogate modeling.",
    install: "npm install @modelscript/simulate",
    docsLink: "/algorithms/solvers-ode-dae",
    npmLink: "https://www.npmjs.com/package/@modelscript/simulate",
    tag: "Numerics",
  },
  {
    name: "@modelscript/cad",
    description: "CAD & ECAD engine — CSG primitives, OpenCascade integration, STEP (ISO 10303), and Gerber support.",
    install: "npm install @modelscript/cad",
    docsLink: "/languages/step",
    npmLink: "https://www.npmjs.com/package/@modelscript/cad",
    tag: "CAD / CSG",
  },
];

const copiedPkg = ref<string | null>(null);

async function copyInstall(install: string, name: string) {
  try {
    await navigator.clipboard.writeText(install);
    copiedPkg.value = name;
    setTimeout(() => {
      if (copiedPkg.value === name) copiedPkg.value = null;
    }, 2000);
  } catch {
    // fallback
  }
}
</script>

<template>
  <section class="home-section packages-section">
    <div class="section-container">
      <div class="section-header">
        <span class="section-badge">Modular Ecosystem</span>
        <h2 class="section-title">Published Packages</h2>
        <p class="section-subtitle">
          Engineered for composability. Modular building blocks powering the computable digital thread.
        </p>
      </div>

      <div class="packages-grid">
        <div v-for="pkg in packages" :key="pkg.name" class="package-card">
          <div class="package-top">
            <span class="package-name">{{ pkg.name }}</span>
            <span class="package-tag">{{ pkg.tag }}</span>
          </div>

          <p class="package-desc">{{ pkg.description }}</p>

          <div class="package-install-box">
            <span class="install-cmd"><code>{{ pkg.install }}</code></span>
            <button
              type="button"
              class="pkg-copy-btn"
              :aria-label="'Copy install command for ' + pkg.name"
              @click="copyInstall(pkg.install, pkg.name)"
            >
              <span v-if="copiedPkg === pkg.name" class="copied">✓</span>
              <span v-else>Copy</span>
            </button>
          </div>

          <div class="package-actions">
            <a :href="pkg.docsLink" class="pkg-link">Documentation &rarr;</a>
            <a :href="pkg.npmLink" target="_blank" rel="noopener noreferrer" class="pkg-npm-link">npm</a>
          </div>
        </div>
      </div>
    </div>
  </section>
</template>

<style scoped>
.home-section {
  padding: 64px 24px;
}

.packages-section {
  background: var(--vp-c-bg-alt);
}

.section-container {
  max-width: 1152px;
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

.packages-grid {
  display: grid;
  grid-template-columns: repeat(auto-fit, minmax(320px, 1fr));
  gap: 20px;
}

.package-card {
  background: var(--vp-c-bg);
  border: 1px solid var(--vp-c-border);
  border-radius: 14px;
  padding: 24px;
  display: flex;
  flex-direction: column;
  transition: border-color 0.25s ease, transform 0.25s ease, box-shadow 0.25s ease;
}

.package-card:hover {
  border-color: var(--vp-c-brand-1);
  transform: translateY(-2px);
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.06);
}

.package-top {
  display: flex;
  align-items: center;
  justify-content: space-between;
  margin-bottom: 12px;
}

.package-name {
  font-family: var(--vp-font-family-mono);
  font-weight: 700;
  font-size: 0.98rem;
  color: var(--vp-c-brand-1);
}

.package-tag {
  font-size: 0.75rem;
  font-weight: 600;
  color: var(--vp-c-text-3);
  background: var(--vp-c-default-soft);
  padding: 2px 8px;
  border-radius: 6px;
}

.package-desc {
  font-size: 0.92rem;
  color: var(--vp-c-text-2);
  line-height: 1.55;
  margin-bottom: 16px;
  flex: 1;
}

.package-install-box {
  display: flex;
  align-items: center;
  justify-content: space-between;
  background: var(--vp-c-bg-soft);
  border: 1px solid var(--vp-c-border);
  border-radius: 8px;
  padding: 8px 12px;
  margin-bottom: 16px;
}

.install-cmd {
  font-family: var(--vp-font-family-mono);
  font-size: 0.82rem;
  color: var(--vp-c-text-1);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.pkg-copy-btn {
  background: transparent;
  border: 1px solid var(--vp-c-border);
  border-radius: 4px;
  color: var(--vp-c-text-2);
  font-size: 0.75rem;
  padding: 2px 8px;
  margin-left: 8px;
  cursor: pointer;
  transition: all 0.2s;
  flex-shrink: 0;
}

.pkg-copy-btn:hover {
  background: var(--vp-c-brand-soft);
  color: var(--vp-c-brand-1);
  border-color: var(--vp-c-brand-1);
}

.copied {
  color: #3fb950;
  font-weight: 700;
}

.package-actions {
  display: flex;
  align-items: center;
  justify-content: space-between;
  font-size: 0.88rem;
}

.pkg-link {
  color: var(--vp-c-brand-1);
  font-weight: 600;
  text-decoration: none;
  transition: color 0.2s;
}

.pkg-link:hover {
  text-decoration: underline;
}

.pkg-npm-link {
  color: var(--vp-c-text-3);
  text-decoration: none;
  font-size: 0.82rem;
}

.pkg-npm-link:hover {
  color: var(--vp-c-text-1);
}
</style>
