<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# ModelScript CLI

The CLI (`@modelscript/cli`) is the primary command-line tool for interacting with the ModelScript compiler. It provides commands for parsing, flattening, instantiating, and visualizing Modelica models.

## Installation

The CLI is part of the ModelScript monorepo. After building the project, it can be run via `msc` (if linked) or directly from the source.

```bash
# Link the package globally
npm link

# Or run via npx from the package directory
npx tsx src/main.ts --help
```

## Commands

### `parse <file>`

Parses a Modelica file and outputs the Concrete Syntax Tree (CST) in JSON format.

```bash
msc parse my_model.mo
```

### `flatten <name> <paths...>`

Flattens a Modelica model into a Differential Algebraic Equation (DAE) system.

```bash
msc flatten MyPackage.MyModel ./MyPackage -o output.json
```

### `instantiate <name> <paths...>`

Instantiates a Modelica model and outputs the instance tree, including all components and their modifications.

```bash
msc instantiate MyPackage.MyModel ./MyPackage
```

### `lint <path> [paths...]`

Lints Modelica files or directories to identify potential syntactic or semantic issues.

```bash
msc lint ./MyPackage
```

### `render <name> <paths...>`

Renders a Modelica class diagram or icon as an SVG.

```bash
msc render MyPackage.MyModel ./MyPackage --output diagram.svg
```

### `i18n <paths...>`

Extracts translatable strings from Modelica models (descriptions, documentation, etc.) and generates a `.pot` file for internationalization.

```bash
msc i18n ./MyPackage -o messages.pot
```

## Development

To run the CLI during development without pre-building:

```bash
npx tsx src/main.ts [command] [args]
```

## License

ModelScript is licensed under the **AGPL-3.0-or-later**.
