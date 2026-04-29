# Installation

ModelScript can be installed as a VS Code extension for end users, or set up locally for developers looking to contribute.

## For Users

The easiest way to use ModelScript is via the VS Code Marketplace.

1. Open VS Code.
2. Go to the Extensions tab (`Ctrl+Shift+X`).
3. Search for **ModelScript**.
4. Click **Install**.

The extension bundles the Language Server, the 3D Viewer, and all necessary polyglot tools out-of-the-box.

## For Developers

To set up ModelScript for local development, you'll need `Node.js` (v20+) and `Docker` installed.

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

### 3. Build the Native Modules

ModelScript uses Tree-sitter for AST generation, which requires native WebAssembly bindings:

```bash
npm run build --workspaces
```

### 4. Run the Dev Server

You can launch the IDE and the local web environment via:

```bash
npm run dev
```

This will spawn the compiler backend, the LSP workers, and open the web UI in your browser.
