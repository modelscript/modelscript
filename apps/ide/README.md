<div align="center"><b>بِسْمِ اللَّهِ الرَّحْمَٰنِ الرَّحِيمِ</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/ide

Browser-based VS Code Web engineering environment for polyglot systems modeling, physical simulation, and 3D CAD. Hosts VS Code Web with the ModelScript language services extension, integrated WebAssembly solvers, interactive 3D CAD/diagram viewers, and an optional browser-local AI assistant.

---

## Features

- **Full VS Code Web Workbench**: Complete browser-based editor experience with syntax highlighting, language services, auto-completions, and semantic diagnostics.
- **Polyglot Engineering Support**: Native editing and verification for Modelica, SysML v2, STEP CAD, OpenSCAD, OWL 2, and CSV telemetry.
- **Interactive 3D CAD & Diagrams**: Integrated webview panels for 3D STEP/CSG visualization, auto-placed Modelica component diagrams, and SysML v2 block definition diagrams.
- **Browser-Local AI Assistant**: Privacy-preserving AI assistant powered by WebLLM running directly in the browser on client WebGPU (no telemetry or remote API keys needed).
- **GitHub & GitLab Integration**: Direct repository exploration via `github.com/owner/repo` URLs using an in-memory `FileSystemProvider`.
- **Zero-Backend Static Deployment**: Can be compiled into a fully static distribution (`npm run build-static`) hosted on GitHub Pages or static web storage.

---

## Scripts

| Command                   | Description                                                          |
| ------------------------- | -------------------------------------------------------------------- |
| `npm run build`           | Download VS Code Web assets, build extensions, and bundle the server |
| `npm run build-static`    | Generate a fully static web deployment (`dist/static/`)              |
| `npm run dev`             | Start development server on port **3003** with extension auto-build  |
| `npm run download-vscode` | Fetch upstream VS Code Web distribution                              |
| `npm run download-model`  | Download Qwen3-0.6B WebLLM model weights (~350 MB) for AI assistant  |
| `npm run lint`            | Run ESLint across `src/`                                             |

---

## Running Locally

```bash
# 1. Start the IDE development server
npm run dev

# 2. (Optional) Download browser-local AI model weights
npm run download-model
```

The IDE launches at http://localhost:3003. From the landing page:

- Paste any public GitHub repository URL to load it into the workspace.
- Choose a quick-start template (Bouncing Ball, RLC Circuit, SysML Drone, CSG CAD).
- Open the **ModelScript AI** assistant panel in the sidebar.

---

## Docker

The IDE is available as a containerized service:

```bash
docker compose up ide
```

Exposes port **3003**.
