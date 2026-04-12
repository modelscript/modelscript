<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript — Modelica for VS Code

Modelica language support with interactive diagram editing, simulation, and scripting — powered by [ModelScript](https://modelscript.org).

[![GitHub Sponsor](https://img.shields.io/badge/Sponsor-%E2%9D%A4-red?logo=github)](https://github.com/sponsors/nachawati)
![ModelScript IDE showing an RLC circuit with diagram view, code editor, and Modelica library browser](https://github.com/modelscript/modelscript/raw/HEAD/extensions/vscode/images/ide-screenshot.png)

## Batteries Included

ModelScript is a **complete Modelica development environment** — no external compilers, tools, or configuration required. Everything runs directly in the browser or in VS Code, powered by the ModelScript framework:

- 🔋 **Modelica Standard Library** bundled and ready — full type resolution out of the box
- 🚀 **Zero configuration** — install the extension and start writing Modelica immediately
- 🌐 **Works everywhere** — desktop VS Code, [vscode.dev](https://vscode.dev), and the [browser-based IDE](https://ide.modelscript.org)

## Features

### Interactive Diagram Editing

Open a **visual diagram view** for any Modelica model with `ModelScript: Open Diagram`. Components are rendered as interactive SVG schematics with connection lines, icons, and labels.

- **Drag to move** — reposition components and the code updates automatically with `Placement` annotations
- **Auto-layout** — intelligent automatic placement of components via `ModelScript: Auto Layout`
- **Add components** — browse the Modelica library tree and add components directly to the diagram
- **Edit connections** — create and modify `connect` statements visually
- **Bidirectional sync** — changes in the diagram update the code, and vice versa

### Simulation & Plotting

Run simulations directly from the editor with `ModelScript: Run Simulation`:

- **ODE/DAE solver** with Pantelides index reduction and BLT ordering
- **Interactive plots** — view simulation results as time-series charts
- **Configurable** — set start/stop time, solver, and output format
- **No external tools** — the solver runs entirely in the browser via WebAssembly

### Modelica Scripting

Full support for Modelica Script (`.mos`) files with an integrated interpreter:

- **Execute scripts** — run `simulate()`, `plot()`, `loadModel()`, and other scripting commands
- **REPL-style workflow** — evaluate expressions and inspect results interactively
- **Flatten models** — introspect and debug class hierarchies with `flatten()`

### Notebook Interface

Modelica Notebook support (`.monb`) for literate programming:

- **Code cells** — write and execute Modelica script blocks
- **Rich output** — see simulation results, plots, and diagnostic messages inline
- **Documentation** — mix Modelica code with markdown explanations

### Intelligent Code Editing

#### Completions

- **Dot-path completions** — type `Modelica.` and get sub-packages, classes, and components from the entire standard library
- **Keyword completions** — all Modelica language keywords
- **Contextual suggestions** — parameters, modifications, and annotations

#### Hover Information

Hover over any Modelica identifier to see its type, description, and classification (model, connector, component, enumeration literal, etc.).

#### Go to Definition & References

- **Go to Definition** — jump to the declaration of any class, component, or type
- **Go to Type Definition** — navigate to the type of a component
- **Find All References** — locate every usage of a symbol across the workspace

#### Rename

Safely rename identifiers across files with `F2` — the rename provider validates the new name before applying changes.

#### Signature Help

View function parameter signatures as you type, with documentation for each argument.

#### Document Symbols & Outline

Navigate complex Modelica files with the Outline view — classes, components, equations, and algorithms are organized hierarchically.

#### Workspace Symbol Search

Find any class or component across the entire workspace with `Ctrl+T`.

### Error Diagnostics

Real-time error detection with **15+ lint rules**:

- **Parse errors** — caught via tree-sitter incremental parsing
- **Unresolved references** — missing imports, typos, undefined names
- **Type mismatches** — incompatible types in assignments, equations, and function calls
- **Array dimension errors** — shape mismatches, index type errors, wrong subscript counts
- **Structural errors** — circular extends, duplicate modifications, unbalanced models
- **Quick fixes** — code actions to resolve common issues

### Document Formatting

Format Modelica files with proper indentation for class definitions, equations, algorithms, and control structures.

### Auto-Indentation

Smart indentation and dedentation rules for Modelica keywords like `equation`, `algorithm`, `end`, `else`, etc. — the editor adjusts indentation as you type.

### Semantic Highlighting

Full semantic token support — variables, parameters, constants, types, and built-in identifiers are colored distinctly based on their semantic role, not just syntax.

### Color Provider

Inline color swatches for Modelica annotation color fields (`color`, `lineColor`, `fillColor`, `textColor`). Click to use the VS Code color picker.

### Code Folding

Fold class definitions, equation and algorithm sections, and control structures for easier navigation of large files.

### Modelica Library Browser

A dedicated sidebar panel for browsing the Modelica Standard Library:

- **Hierarchical tree** — navigate packages, models, connectors, and functions
- **Class icons** — each class kind has a distinct icon (model, connector, block, function, etc.)
- **Add to Diagram** — insert components directly from the library browser into your model

### AI Assistant

A browser-local AI chat powered by WebLLM (Qwen3-0.6B):

- **Privacy-first** — the model runs entirely in your browser, no data leaves your machine
- **Modelica-aware** — can flatten models, run simulations, and inspect classes via built-in tools
- **LaTeX rendering** — mathematical equations are rendered as Unicode for readability

## Requirements

- VS Code 1.100.0 or later
- Works in both desktop VS Code and [vscode.dev](https://vscode.dev)

## Extension Settings

| Setting                    | Description                                                                                 | Default   |
| -------------------------- | ------------------------------------------------------------------------------------------- | --------- |
| `modelscript.trace.server` | Traces communication between VS Code and the language server (`off`, `messages`, `verbose`) | `verbose` |

## Links

- [ModelScript](https://modelscript.org) — project homepage
- [GitHub](https://github.com/modelscript/modelscript) — source code and issue tracker
- [Morsel](https://modelscript-morsel.github.io) — online Modelica editor
- [IDE](https://ide.modelscript.org) — browser-based VS Code IDE
