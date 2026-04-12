<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cli

Command-line interface for ModelScript. Provides the `msc` command for parsing, linting, flattening, simulating, optimizing, rendering, and publishing Modelica models.

## Scripts

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `npm run build` | Clean, lint, compile, and make executable |
| `npm run clean` | Remove `dist/` output                     |
| `npm run lint`  | Run ESLint on `src/`                      |
| `npm run watch` | Compile in watch mode                     |

## Usage

After building, the CLI is available as `msc`:

```bash
npx msc --help
```

## Commands

| Command       | Description                                                |
| ------------- | ---------------------------------------------------------- |
| `parse`       | Parse Modelica files and output the AST                    |
| `lint`        | Run lint checks on Modelica files                          |
| `flatten`     | Flatten a Modelica model to flat DAE                       |
| `instantiate` | Instantiate a Modelica class hierarchy                     |
| `simulate`    | Simulate a Modelica model and output results (CSV or JSON) |
| `optimize`    | Solve an optimal control problem for a Modelica model      |
| `render`      | Render a Modelica model diagram to SVG                     |
| `i18n`        | Extract translatable strings from Modelica models          |
| `publish`     | Publish a Modelica library to the ModelScript registry     |
| `unpublish`   | Remove a published library from the registry               |
| `login`       | Authenticate with the ModelScript registry                 |
| `logout`      | Log out from the ModelScript registry                      |

## Examples

```bash
# Flatten a model
msc flatten Modelica.Electrical.Analog.Examples.CauerLowPassAnalog path/to/MSL

# Simulate a model (CSV output)
msc simulate BouncingBall model.mo --stop-time 5

# Simulate with JSON output
msc simulate BouncingBall model.mo --format json --start-time 0 --stop-time 10

# Solve an optimal control problem
msc optimize MyModel model.mo \
  --objective "u^2" --controls "u" \
  --control-bounds "u:-1:1" --stop-time 10

# Lint Modelica files
msc lint model.mo

# Render a diagram to SVG (outputs to stdout)
msc render MyModel model.mo > diagram.svg

# Render an icon
msc render MyModel model.mo --icon > icon.svg
```
