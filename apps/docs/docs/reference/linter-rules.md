# Compiler Diagnostics & Linter Rules

ModelScript enforces strict static semantic validation matching OpenModelica diagnostic conventions. Every diagnostic emitted by `@modelscript/modelica` is assigned a unique numeric code (`M1xxx` through `M5xxx`) and kebab-case rule identifier.

---

## Error Code Numbering Scheme

- **`1xxx`**: Syntax & Parser Errors
- **`2xxx`**: Name Resolution & Scoping
- **`3xxx`**: Type System & Compatibility
- **`4xxx`**: Structural Hierarchy & Declarations
- **`5xxx`**: Equations & Algorithms

---

## 1xxx: Syntax & Parse Diagnostics

### `M1001`: `parse-error`

- **Severity**: Error
- **Message**: `Parse error.`
- **Description**: The native WebAssembly GLR parser encountered tokens that do not conform to the Modelica grammar specification.
- **Remediation**: Check for missing semicolons, unbalanced parentheses, or misplaced keywords.

### `M1002`: `parse-missing`

- **Severity**: Error
- **Message**: `Parse error: '<token>' expected.`
- **Description**: A required grammatical delimiter (such as `;`, `)`, or `end`) was expected at the current token position.
- **Remediation**: Insert the missing delimiter.

### `M1003`: `empty-array-constructor`

- **Severity**: Error
- **Message**: `Empty array constructor '[]' or '{}' is not valid in Modelica.`
- **Description**: The Modelica language specification does not permit empty array literals without elements.
- **Remediation**: Provide at least one element or specify array dimensions via type attributes.

---

## 2xxx: Name Resolution Diagnostics

### `M2001`: `duplicate-element`

- **Severity**: Error
- **Message**: `An element with name '<name>' is already declared in this scope.`
- **Description**: A variable, parameter, or nested class with this identifier has already been defined in the current scope.
- **Remediation**: Rename or remove the redundant declaration.

### `M2002`: `variable-not-found`

- **Severity**: Error
- **Message**: `Variable '<name>' not found in scope '<scope>'.`
- **Description**: The identifier referenced in an expression or equation cannot be resolved in the local or inherited lexical scopes.
- **Remediation**: Verify the spelling of the variable or add an import/extends clause.

### `M2003`: `class-not-found`

- **Severity**: Error
- **Message**: `Class '<className>' not found in scope '<scope>'.`
- **Description**: The type specified in a component declaration or extends statement does not exist in the accessible package hierarchy.
- **Remediation**: Ensure the library containing `<className>` is included in the workspace paths.

### `M2004`: `modifier-not-found`

- **Severity**: Error
- **Message**: `In modifier of '<componentName>', class or component '<modName>' not found in '<className>'.`
- **Description**: A modifier clause attempts to override a parameter or component that is not declared in the target class.
- **Remediation**: Verify the parameter names available on `<className>`.

### `M2005`: `identifier-mismatch`

- **Severity**: Error
- **Message**: `The identifier at start and end are different.`
- **Description**: The class identifier declared at `class <Name>` does not match the closing identifier at `end <Name>;`.
- **Remediation**: Update the ending identifier to match the class name.

---

## 3xxx: Type System Diagnostics

### `M3001`: `type-mismatch-binding`

- **Severity**: Error
- **Message**: `Type mismatch in binding <name> = <expr>, expected subtype of <expected>, got type <actual>.`
- **Description**: The evaluated type of a binding expression is incompatible with the declared component type (e.g. assigning a `String` to a `Real`).
- **Remediation**: Ensure the assigned expression evaluates to a compatible type or use explicit conversion functions.

### `M3002`: `type-mismatch-modifier`

- **Severity**: Error
- **Message**: `Type mismatch: '<name>' expects type '<expected>' but got '<actual>'.`
- **Description**: A modifier value assigned during component instantiation does not match the expected field type.
- **Remediation**: Correct the literal or expression supplied in the modifier parenthesis.

### `M3003`: `not-plug-compatible`

- **Severity**: Error
- **Message**: `The connectors in connect(<ref1>, <ref2>) are not type compatible.`
- **Description**: The two connector instances passed to `connect()` are not plug-compatible (different connector types or incompatible flow/stream variables).
- **Remediation**: Ensure both sides of `connect()` reference instances of the same connector definition.

### `M3004`: `not-a-connector`

- **Severity**: Error
- **Message**: `In connect(<ref1>, <ref2>): '<which>' is not a connector.`
- **Description**: An argument to `connect()` references a primitive scalar variable or standard class rather than a `connector`.
- **Remediation**: Connect equations can only link instances of classes declared with the `connector` restriction.

### `M3006`: `function-arg-type-mismatch`

- **Severity**: Error
- **Message**: `Type mismatch for positional argument <pos> in <call>. The argument has type: <actual> expected type: <expected>.`
- **Description**: An argument passed to a function call violates the signature expected by the function definition.
- **Remediation**: Verify the order and types of arguments in the function invocation.

---

## 4xxx: Structural & Hierarchy Diagnostics

### `M4001`: `extends-cycle`

- **Severity**: Error
- **Message**: `extends <baseName> causes an instantiation loop.`
- **Description**: A circular inheritance dependency was detected (e.g. $A \text{ extends } B \text{ extends } A$).
- **Remediation**: Break the inheritance cycle by refactoring shared elements into a common base class.

### `M4002`: `duplicate-modification`

- **Severity**: Error
- **Message**: `Duplicate modification of element <name> on <kind> <compName>.`
- **Description**: The same parameter or sub-element is modified multiple times in a single instantiation clause.
- **Remediation**: Remove the redundant modifier assignment.

### `M4004`: `unbalanced-model`

- **Severity**: Warning
- **Message**: `The <kind> '<name>' is not balanced: <nEquations> equation(s) and <nVariables> variable(s).`
- **Description**: A non-partial simulation model must have an equal number of scalar equations and non-parameter variables to be solvable.
- **Remediation**: Add missing equations or declare surplus variables as `parameter` or `input`.

---

## 5xxx: Equations & Algorithms Diagnostics

### `M5001`: `equation-type-mismatch`

- **Severity**: Error
- **Message**: `Type mismatch in equation <lhs>=<rhs> of type <lhsType>=<rhsType>.`
- **Description**: The left-hand side and right-hand side expressions in an equality equation evaluate to incompatible types (e.g. equating a `Boolean` to a `Real`).
- **Remediation**: Ensure both expressions in the equation evaluate to compatible types.
