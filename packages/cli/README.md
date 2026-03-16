<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/cli

Command-line interface for ModelScript. Provides the `msc` command for parsing, linting, flattening, rendering, and publishing Modelica models.

## Scripts

| Command         | Description                               |
| --------------- | ----------------------------------------- |
| `npm run build` | Clean, lint, compile, and make executable |
| `npm run clean` | Remove `dist/` output                     |
| `npm run lint`  | Run ESLint on `src/`                      |
| `npm run watch` | Compile in watch mode                     |

## Usage

After building, the CLI is available at `dist/main.js`:

```bash
node dist/main.js --help
```

Available commands: `parse`, `lint`, `flatten`, `instantiate`, `render`, `i18n`, `publish`, `unpublish`, `login`, `logout`.
