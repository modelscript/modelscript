# CLI Overview (`msc`)

The ModelScript unified command-line interface, `msc`, is published as [`@modelscript/cli`](https://www.npmjs.com/package/@modelscript/cli).

It provides an all-in-one developer tool for parsing, linting, compiling, flattening, simulating, optimizing, and verifying models across the **computable digital thread**.

---

## Installation

### Global Installation via npm

```bash
npm install -g @modelscript/cli
```

### Direct Invocation via npx

```bash
npx @modelscript/cli --help
# Or when working inside the cloned ModelScript repository:
npx msc --help
```

---

## Global Options

The following flags are available across all `msc` subcommands:

| Flag            | Description                                                                |
| :-------------- | :------------------------------------------------------------------------- |
| `-v, --version` | Print the current CLI and compiler version.                                |
| `-h, --help`    | Display help and usage instructions for the command.                       |
| `--verbose`     | Enable detailed debug logs and execution traces.                           |
| `--quiet`       | Suppress all informational output; only print errors or raw data payloads. |
| `--json`        | Output machine-readable JSON payloads suitable for CI/CD scripting.        |
| `--no-color`    | Disable ANSI terminal color codes.                                         |

---

## Interactive Playground Mode

Launch the interactive local CLI playground:

```bash
msc playground
```

This starts a terminal-based or local web UI for experimenting with models, viewing live equation trees, and inspecting flattened DAE structures in real time.
