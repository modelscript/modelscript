import {
  BeakerIcon,
  CodeIcon,
  CommandPaletteIcon,
  CpuIcon,
  DeviceDesktopIcon,
  FileCodeIcon,
  GlobeIcon,
  MarkGithubIcon,
  MoonIcon,
  PackageIcon,
  PlayIcon,
  SearchIcon,
  SunIcon,
  TerminalIcon,
  TypographyIcon,
  ZapIcon,
} from "@primer/octicons-react";
import { Button, IconButton } from "@primer/react";
import { useColorMode } from "../root";

export default function Index() {
  const { colorMode, setColorMode } = useColorMode();
  const isDark = colorMode === "night";

  return (
    <>
      {/* ---- Navbar ---- */}
      <nav
        style={{
          position: "fixed",
          top: 0,
          left: 0,
          right: 0,
          zIndex: 100,
          padding: "12px 24px",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-between",
          backdropFilter: "blur(12px)",
          background: isDark ? "rgba(13, 17, 23, 0.8)" : "rgba(255, 255, 255, 0.8)",
          borderBottom: "1px solid var(--borderColor-default)",
        }}
      >
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <img src={isDark ? "/ms-logo-light.png" : "/ms-logo.png"} alt="ModelScript" style={{ height: 28 }} />
          <span style={{ fontWeight: 700, fontSize: "1.125rem" }}>ModelScript</span>
        </div>
        <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
          <Button as="a" href="https://ide.modelscript.org" variant="invisible" size="small">
            IDE
          </Button>
          <Button as="a" href="https://morsel.modelscript.org" variant="invisible" size="small">
            Morsel
          </Button>
          <Button
            as="a"
            href="https://github.com/modelscript/modelscript"
            variant="invisible"
            size="small"
            leadingVisual={MarkGithubIcon}
          >
            GitHub
          </Button>
          <IconButton
            aria-label="Toggle theme"
            icon={isDark ? SunIcon : MoonIcon}
            variant="invisible"
            size="small"
            onClick={() => setColorMode(isDark ? "day" : "night")}
          />
        </div>
      </nav>

      {/* ---- Hero ---- */}
      <section className="hero">
        <div className="hero-badge">
          <img src={isDark ? "/ms-logo-light.png" : "/ms-logo.png"} alt="" style={{ height: 14 }} />
          Open-source Modelica toolchain
        </div>
        <h1>
          The modern way to
          <br />
          <span className="gradient-text">model and simulate</span>
        </h1>
        <p className="hero-subtitle">
          Parse, lint, flatten, simulate, and render Modelica models — in the browser or on the command line. Free and
          open-source, licensed under AGPL-3.0.
        </p>
        <div className="hero-actions">
          <Button
            as="a"
            href="https://github.com/modelscript/modelscript"
            variant="primary"
            size="large"
            leadingVisual={MarkGithubIcon}
          >
            View on GitHub
          </Button>
          <Button as="a" href="https://morsel.modelscript.org" size="large" leadingVisual={GlobeIcon}>
            Try in Browser
          </Button>
        </div>
        <div className="hero-code">
          <TerminalIcon size={16} />
          <code>npm install -g @modelscript/cli</code>
        </div>
      </section>

      {/* ---- Features ---- */}
      <section className="features">
        <div className="features-heading">
          <h2>Everything you need for Modelica</h2>
          <p>A complete toolchain from parsing to simulation, all in one monorepo.</p>
        </div>
        <div className="features-grid">
          <FeatureCard
            icon={<FileCodeIcon size={24} />}
            title="Incremental Parsing"
            description="Tree-sitter based parser with full Modelica grammar coverage. Incremental re-parsing for IDE-speed responsiveness."
          />
          <FeatureCard
            icon={<SearchIcon size={24} />}
            title="Linting & Diagnostics"
            description="15+ lint rules covering parser errors, unresolved references, type mismatches, and structural checks."
          />
          <FeatureCard
            icon={<CodeIcon size={24} />}
            title="DAE Flattening"
            description="Transform hierarchical Modelica models into flat Differential Algebraic Equations with full inheritance and modification support."
          />
          <FeatureCard
            icon={<BeakerIcon size={24} />}
            title="Simulation"
            description="ODE/DAE numerical solver with Pantelides index reduction, BLT ordering, and alias elimination."
          />
          <FeatureCard
            icon={<CpuIcon size={24} />}
            title="Optimization"
            description="Direct collocation solver for Modelica optimal control problems with configurable bounds and objectives."
          />
          <FeatureCard
            icon={<CommandPaletteIcon size={24} />}
            title="Diagram Rendering"
            description="Generate interactive SVG diagrams from Modelica annotation data. Supports both icon and diagram views."
          />
        </div>
      </section>

      {/* ---- Packages ---- */}
      <section className="packages">
        <div className="packages-inner">
          <div className="packages-heading">
            <h2>Published Packages</h2>
            <p>Install only what you need from npm.</p>
          </div>
          <div className="packages-grid">
            <PackageCard
              name="@modelscript/core"
              description="Central compiler engine — parsing, semantic analysis, flattening, simulation, optimization, and rendering."
              install="npm install @modelscript/core"
            />
            <PackageCard
              name="@modelscript/cli"
              description="Command-line interface — the msc command for parsing, linting, flattening, simulating, and rendering."
              install="npm install -g @modelscript/cli"
            />
            <PackageCard
              name="@modelscript/modelica-polyglot/parser"
              description="Tree-sitter grammar for Modelica — native Node.js binding and WebAssembly build for browser use."
              install="npm install @modelscript/modelica-polyglot/parser"
            />
          </div>
        </div>
      </section>

      {/* ---- VS Code Extension ---- */}
      <section className="features">
        <div className="features-heading">
          <h2>VS Code Extension</h2>
          <p>Full Modelica language support right in your editor. Available on the VS Code Marketplace and Open VSX.</p>
        </div>
        <div className="features-grid">
          <FeatureCard
            icon={<TypographyIcon size={24} />}
            title="Syntax Highlighting"
            description="Rich, accurate syntax highlighting for all Modelica language constructs with Tree-sitter grammar."
          />
          <FeatureCard
            icon={<SearchIcon size={24} />}
            title="Diagnostics & Linting"
            description="Real-time error detection, type checking, and 15+ lint rules with inline squiggles and quick fixes."
          />
          <FeatureCard
            icon={<CommandPaletteIcon size={24} />}
            title="Diagram Editor"
            description="Visual diagram editor for Modelica models with auto-layout, drag-and-drop components, and SVG rendering."
          />
          <FeatureCard
            icon={<PlayIcon size={24} />}
            title="Simulation"
            description="Run simulations directly from the editor with interactive result charts and CSV/JSON export."
          />
          <FeatureCard
            icon={<ZapIcon size={24} />}
            title="Completions & Hover"
            description="Intelligent code completions, hover documentation, and go-to-definition for Modelica classes and components."
          />
          <FeatureCard
            icon={<PackageIcon size={24} />}
            title="Bundled MSL"
            description="Ships with the Modelica Standard Library — start modeling immediately without any additional setup."
          />
        </div>
        <div
          style={{
            display: "flex",
            justifyContent: "center",
            marginTop: "32px",
          }}
        >
          <Button
            as="a"
            href="https://marketplace.visualstudio.com/items?itemName=modelscript.vscode"
            size="large"
            leadingVisual={DeviceDesktopIcon}
          >
            Install Extension
          </Button>
        </div>
      </section>

      {/* ---- Quick Start ---- */}
      <section className="quickstart">
        <h2>Quick Start</h2>
        <div className="quickstart-steps">
          <QuickStartStep step={1} title="Install the CLI" code="npm install -g @modelscript/cli" />
          <QuickStartStep
            step={2}
            title="Flatten a model"
            code="msc flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL"
          />
          <QuickStartStep step={3} title="Simulate" code="msc simulate BouncingBall model.mo --stop-time 5" />
          <QuickStartStep step={4} title="Render a diagram" code="msc render MyModel model.mo > diagram.svg" />
        </div>
      </section>

      {/* ---- Docker ---- */}
      <section className="features" style={{ paddingTop: 0 }}>
        <div className="features-heading">
          <h2>Run with Docker</h2>
          <p>Pre-built images available on GitHub Container Registry.</p>
        </div>
        <div style={{ maxWidth: 600, margin: "0 auto" }}>
          <div className="step-code">
            <code>
              docker pull ghcr.io/modelscript/api:latest
              <br />
              docker pull ghcr.io/modelscript/morsel:latest
              <br />
              docker compose up
            </code>
          </div>
        </div>
      </section>

      {/* ---- Footer ---- */}
      <footer className="site-footer">
        <div className="footer-links">
          <a href="https://github.com/modelscript/modelscript">GitHub</a>
          <a href="https://github.com/modelscript/modelscript/blob/main/CONTRIBUTING.md">Contributing</a>
          <a href="https://github.com/modelscript/modelscript/blob/main/CODE_OF_CONDUCT.md">Code of Conduct</a>
          <a href="https://github.com/modelscript/modelscript/blob/main/SECURITY.md">Security</a>
          <a href="https://www.npmjs.com/org/modelscript">npm</a>
        </div>
        <p className="footer-copy">© {new Date().getFullYear()} Mohamad Omar Nachawati. Licensed under AGPL-3.0.</p>
      </footer>
    </>
  );
}

function FeatureCard({ icon, title, description }: { icon: React.ReactNode; title: string; description: string }) {
  return (
    <div className="feature-card">
      <div className="feature-icon">{icon}</div>
      <h3>{title}</h3>
      <p>{description}</p>
    </div>
  );
}

function PackageCard({ name, description, install }: { name: string; description: string; install: string }) {
  return (
    <div className="package-card">
      <div style={{ display: "flex", alignItems: "center", gap: "8px" }}>
        <PackageIcon size={16} />
        <span className="package-name">{name}</span>
      </div>
      <p className="package-desc">{description}</p>
      <div className="package-install">
        <code>$ {install}</code>
      </div>
    </div>
  );
}

function QuickStartStep({ step, title, code }: { step: number; title: string; code: string }) {
  return (
    <div className="quickstart-step">
      <div className="step-number">{step}</div>
      <div className="step-content" style={{ flex: 1 }}>
        <h3>{title}</h3>
        <div className="step-code">
          <code>{code}</code>
        </div>
      </div>
    </div>
  );
}
