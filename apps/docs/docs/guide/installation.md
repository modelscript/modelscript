# Installation

ModelScript can be installed as a VS Code extension for end users, or set up locally for developers looking to contribute.

## For Users & Engineers

ModelScript provides four deployment modalities tailored to your workflow:

### 1. VS Code Extension

The official extension transforms VS Code into a comprehensive multi-domain modeling environment:

1. Open VS Code.
2. Open the Extensions view (`Ctrl+Shift+X` or `Cmd+Shift+X`).
3. Search for **`ModelScript`** and click **Install**.

The extension automatically provisions the native WebAssembly Language Server (LSP), the interactive 3D WebGL viewer, and compiler diagnostics out of the box.

### 2. Command-Line Interface (`msx`)

The `msx` toolchain executes headless simulations, CI/CD linting, and export tasks:

```bash
# Run immediately via npx without manual installation
npx msx --help

# Or install globally for system-wide access
npm install -g @modelscript/cli
msx --version
```

### 3. Native Desktop Studio (Tauri v2)

For low-latency, air-gapped, or high-performance workstation workflows, download the standalone native desktop application (`@modelscript/desktop`):

- **Linux**: Standalone `.AppImage` or native Debian/Ubuntu `.deb` packages.
- **macOS**: Universal Apple Silicon / Intel `.dmg` disk image.
- **Windows**: Modern Windows 64-bit installer (`.msi`) or portable executable (`.exe`).

The desktop app bundles offline native WebAssembly GLR language parsers, embedded SQLite caching, and direct hardware serial/IPC bridges for Hardware-in-the-Loop (HIL) testing. Downloads are available from the [ModelScript GitHub Releases](https://github.com/modelscript/modelscript/releases).

### 4. Containerized Hub & Simulation Server

Spin up the complete private simulation hub, REST/GraphQL APIs, and web studio using Docker:

```bash
# Pull official multi-architecture containers
docker pull ghcr.io/modelscript/api:latest
docker pull ghcr.io/modelscript/web:latest

# Launch backend simulation cluster and web IDE
docker compose up -d
```

## For Developers

To set up ModelScript for local development, you will need **Node.js ≥ 24** (matching `.nvmrc`) and `npm`. Docker is optional and only required if running backend database/API services.

### 1. Clone the Repository

```bash
git clone https://github.com/modelscript/modelscript.git
cd modelscript
```

### 2. Install Dependencies

We use `npm` workspaces to manage our monorepo packages.

```bash
npm install
```

### 3. Build the Monorepo

ModelScript compiles its native WebAssembly GLR parsers, AssemblyScript flattening kernels, and TypeScript packages via Nx:

```bash
npm run build:libs    # Build core compiler packages and language runtimes
npm run build         # Build all monorepo targets
```

### 4. Run the Dev Server

You can launch the IDE and the local web environment via:

```bash
npm run dev
```

This will spawn the compiler backend, the LSP workers, and open the web UI in your browser.
