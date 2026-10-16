# CSV Tabular Data (`.csv`)

`@modelscript/csv` (`languages/csv`) elevates empirical measurement series, calibration look-up tables, and parameter sweeps into first-class typed symbols inside the `WorkspaceIndex`.

---

## Capabilities

1. **Native GLR Parsing & Delimiter Auto-Detection**: Parses RFC 4180 CSV documents into linear-memory CST rows and cells (`csv_document`, `header_row`, `data_row`, `field`, `quoted_field`) while `detectDelimiter` (`languages/csv/src/measurements.ts`) automatically detects comma (`,`), semicolon (`;`), or tab (`\t`) delimiters and handles quoted strings with escaped `""` sequences.
2. **Modelica Package Generation (`parseCsvToModelica`)**: Converts any CSV dataset directly into a strongly typed Modelica `package` containing:
   - `constant Integer numRows` and `constant Integer numCols`
   - A 2D `constant Real values[numRows, numCols]` matrix suitable for `Modelica.Blocks.Tables.CombiTable1D` / `CombiTable2D`
   - Sanitized 1D column vectors (`constant Real <colName>[numRows]`) with automatic duplicate-name disambiguation
3. **Salsa Virtual Component Queries (`CSVVirtualComponent`)**: Exposes every CSV column as a queryable virtual symbol in the `QueryEngine` (`languages/csv/src/queries.ts`):
   - `resolvedType`: Infers `"Real"`, `"Integer"`, `"Boolean"`, or `"String"` from column cells
   - `classInstance`: Maps to `"Modelica.Blocks.Sources.CombiTimeTable"`
   - `variability`: Returns `"constant"`
   - `causality`: Returns `"output"`
   - `resolvedArrayDimensions` / `arrayDimensions`: Returns `[rowCount]`
   - `effectiveModification`: Synthesizes `{ table: "[[...]]" }` array literals from column data
4. **Bidirectional Cell Writeback (`writeback`)**: When a parameter or table entry is modified during calibration or optimization, `csvLanguage.writeback` (`languages/csv/src/language.ts`) updates the exact `[row, col]` cell or column header in place while preserving the file's original delimiter and line endings.

---

## Semantic Linter & Diagnostic Codes

`lintCsv(sourceText)` (`languages/csv/src/linter.ts`) performs six structural and numerical integrity checks on CSV datasets:

| Code                        | Severity  | Condition Checked                                                                                   |
| :-------------------------- | :-------- | :-------------------------------------------------------------------------------------------------- |
| `CSV_UNCLOSED_QUOTE`        | `error`   | A quoted field contains an unclosed `"` at the end of a line                                        |
| `CSV_EMPTY_HEADER`          | `warning` | A column in the header row has an empty name                                                        |
| `CSV_DUPLICATE_HEADER`      | `warning` | Two or more columns share the same header identifier                                                |
| `CSV_COLUMN_COUNT_MISMATCH` | `error`   | A data row contains fewer or more cells than the header row                                         |
| `CSV_INVALID_NUMERIC_CELL`  | `error`   | A cell in a numeric column (where row 1 is numeric) contains non-numeric text, `NaN`, or `Infinity` |
| `CSV_NON_MONOTONIC_TIME`    | `warning` | The first column (`time` / `t`) is not strictly monotonically increasing ($t_i < t_{i-1}$)          |

---

## Polyglot TGG Rules

`@modelscript/csv` registers 2 bidirectional Triple Graph Grammar (TGG) rules in `languages/csv/src/language.ts`:

| Rule Name                                | Source (`csv`)        | Target (`modelica`)                  | Semantics                                                                          |
| :--------------------------------------- | :-------------------- | :----------------------------------- | :--------------------------------------------------------------------------------- |
| `CsvDocumentToModelicaPackage`           | `CSVDocument`         | `ClassDefinition` (`package`)        | Projects a CSV file into a Modelica data package with `values[numRows, numCols]`   |
| `CsvVirtualComponentToModelicaComponent` | `CSVVirtualComponent` | `ComponentClause` (`parameter Real`) | Binds a typed CSV column to a Modelica parameter vector or `CombiTimeTable` source |
