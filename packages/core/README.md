<div align="center"><b>&#1576;&#1587;&#1605; &#1575;&#1604;&#1604;&#1607; &#1575;&#1604;&#1585;&#1581;&#1605;&#1606; &#1575;&#1604;&#1585;&#1581;&#1610;&#1605;</b></div>
<div align="center">In the name of Allah, the Compassionate, the Merciful</div>

# @modelscript/core

Central compiler engine for ModelScript. Provides Modelica parsing, semantic analysis, model instantiation, DAE flattening, SVG diagram rendering, linting, and i18n support.

## Scripts

| Command         | Description                         |
| --------------- | ----------------------------------- |
| `npm run build` | Clean, lint, and compile TypeScript |
| `npm run clean` | Remove `dist/` output               |
| `npm run lint`  | Run ESLint on `src/`                |
| `npm test`      | Run the Modelica test suite         |
| `npm run watch` | Compile in watch mode               |

## Testing

```bash
npm test
```

Runs the Modelica test suite via `tsx tests/testsuite-runner.ts` with increased heap size (8 GB).
