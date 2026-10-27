# Compiler Linter Rules Reference

ModelScript includes a zero-allocation, multi-language static analysis engine that executes directly over linear WebAssembly Concrete Syntax Trees (`CompilerLint`) and memoized Salsa semantic queries (`lint__*` hooks). Across the **supported engineering languages**, the compiler enforces **over 250 diagnostic rules** before simulation or code generation begins.

## Running the Linter

Diagnostics run automatically in the VS Code / Web IDE via `@modelscript/lsp`, or headlessly via the CLI:

```bash
# Lint files or directories (language auto-detected by extension)
npx msx lint model.mo architecture.sysml grid.pscx

# Emit machine-readable JSON diagnostics or SARIF v2.1.0 for GitHub Code Scanning
npx msx lint ./workspace --format json
npx msx verify ./workspace --format sarif --report diagnostics.sarif
```

---

## 1. Modelica (`@modelscript/modelica`)

Modelica diagnostics (`languages/modelica/src/errors.ts` and `languages/modelica/src/lints/`) mirror OpenModelica (`omc`) frontend semantic checks and are partitioned into six numeric ranges (`M1xxx`–`M6xxx`).

### `M1xxx` — Syntax & Parser Diagnostics

| Code    | Rule Identifier              | Severity  | Message Template / Condition                                     |
| :------ | :--------------------------- | :-------- | :--------------------------------------------------------------- |
| `M1000` | `identity-arg-count`         | `error`   | `Function identity expects 1 argument, got <argCount>.`          |
| `M1000` | `identity-first-arg-integer` | `error`   | `First argument of identity must be an Integer expression.`      |
| `M1001` | `parse-error`                | `error`   | `Syntax error near '<text>'.`                                    |
| `M1002` | `parse-missing`              | `error`   | `Expected '<expected>' before end of statement.`                 |
| `M1003` | `empty-array-constructor`    | `error`   | `Empty array constructor '[]' or '{}' is not valid in Modelica.` |
| `M1099` | `wasm-flattener-unsupported` | `warning` | `WASM flattener kernel fallback triggered: <reason>.`            |

### `M2xxx` — Name & Scope Resolution

| Code    | Rule Identifier                 | Severity  | Message Template / Condition                                                                                                                                |
| :------ | :------------------------------ | :-------- | :---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M2001` | `duplicate-element`             | `error`   | `Element '<name>' is already declared in this scope.`                                                                                                       |
| `M2002` | `variable-not-found`            | `error`   | `Variable '<name>' not found in scope.`                                                                                                                     |
| `M2003` | `class-not-found`               | `error`   | `Class '<name>' not found in scope.`                                                                                                                        |
| `M2003` | `class-not-found-in-scope`      | `error`   | `Class '<className>' not found in scope '<scopeName>'.`                                                                                                     |
| `M2003` | `base-class-not-found-in-scope` | `error`   | `Base class '<baseName>' not found in scope '<scopeName>'.`                                                                                                 |
| `M2003` | `partial-base-class`            | `error`   | `Cannot instantiate partial base class '<baseName>'.`                                                                                                       |
| `M2004` | `modifier-not-found`            | `error`   | `Element '<modName>' not found in class '<className>'.` (or `In modifier of '<componentName>', class or component '<modName>' not found in '<className>'.`) |
| `M2004` | `base-class-ambiguous`          | `error`   | `Base class '<baseName>' is ambiguous; found in multiple inherited scopes.`                                                                                 |
| `M2005` | `identifier-mismatch`           | `error`   | `The identifier at start and end are different '<startId>' != '<endId>'.`                                                                                   |
| `M2005` | `base-class-found-in`           | `info`    | `Candidate base class '<baseName>' found in '<scopeName>'.`                                                                                                 |
| `M2006` | `modified-element-not-found`    | `error`   | `Modified element '<elementName>' not found in class '<className>'.`                                                                                        |
| `M2007` | `modifier-class-not-found`      | `error`   | `Class '<typeName>' for component '<compName>' not found.`                                                                                                  |
| `M2011` | `same-name-type-shadowing`      | `warning` | `Component '<name>' has the same name as its type '<typeName>'.`                                                                                            |
| `M2038` | `partial-lookup-disallowed`     | `error`   | `Lookup through partial component or class '<name>' is not allowed.`                                                                                        |
| `M2090` | `from-here`                     | `info`    | `From here: '<context>'.` (instantiation trace note)                                                                                                        |
| `M2095` | `from-here-trace`               | `info`    | `Instantiated from '<className>' here.`                                                                                                                     |

### `M3xxx` — Type System & Dimensional Checking

| Code    | Rule Identifier                   | Severity  | Message Template / Condition                                                                       |
| :------ | :-------------------------------- | :-------- | :------------------------------------------------------------------------------------------------- |
| `M3001` | `type-mismatch-binding`           | `error`   | `Type mismatch in binding '<compName> = <exprText>', expected type <expected>, got <actual>.`      |
| `M3002` | `type-mismatch-modifier`          | `error`   | `Type mismatch in modifier of '<modName>', expected type <expected>, got <actual>.`                |
| `M3002` | `type-mismatch-modifier-binding`  | `error`   | `Type mismatch in modifier binding '<modName> = <exprText>', expected <expected>, got <actual>.`   |
| `M3003` | `not-plug-compatible`             | `error`   | `Connectors '<left>' and '<right>' are not plug-compatible.`                                       |
| `M3004` | `not-a-connector`                 | `error`   | `<which> is not a valid connector.`                                                                |
| `M3005` | `redeclare-type-mismatch`         | `error`   | `Redeclarations of '<name>' must be subtype-compatible with '<baseType>'.`                         |
| `M3006` | `function-arg-type-mismatch`      | `error`   | `Type mismatch in argument '<argName>' of function '<fnName>', expected <expected>, got <actual>.` |
| `M3007` | `connect-invalid-form`            | `error`   | `Arguments to connect() must be component references, got '<expr>'.`                               |
| `M3007` | `function-return-type-mismatch`   | `error`   | `Return value of function '<fnName>' has type <actual>, expected <expected>.`                      |
| `M3008` | `extends-type-mismatch`           | `error`   | `Cannot extend non-class or incompatible specialization '<baseName>'.`                             |
| `M3009` | `array-index-type-mismatch`       | `error`   | `Array subscript '<expr>' must be of type Integer, Boolean, or enumeration, got <actual>.`         |
| `M3010` | `unit-mismatch`                   | `warning` | `Inconsistent physical units in expression: '<leftUnit>' vs. '<rightUnit>'.`                       |
| `M3010` | `no-matching-function`            | `error`   | `No matching function found for call '<fnName>(...)'.`                                             |
| `M3011` | `binary-op-type-mismatch`         | `error`   | `Operator '<op>' is not defined for operand types <leftType> and <rightType>.`                     |
| `M3012` | `optimization-objective-type`     | `error`   | `Optimization objective attribute must evaluate to a scalar Real expression, got <actual>.`        |
| `M3013` | `optimization-constraint-type`    | `error`   | `Optimization constraint must be a relational or Boolean expression, got <actual>.`                |
| `M3014` | `builtin-attribute-type-mismatch` | `error`   | `Attribute '<attr>' on built-in type '<type>' expects <expected>, got <actual>.`                   |
| `M3015` | `attribute-type-mismatch`         | `error`   | `Invalid type <actual> for attribute '<attr>', expected <expected>.`                               |
| `M3016` | `conditional-type-mismatch`       | `error`   | `Branches of if-expression have incompatible types <trueType> and <falseType>.`                    |
| `M3017` | `connect-types-inconsistent`      | `error`   | `Connected elements '<left>' (<leftType>) and '<right>' (<rightType>) have inconsistent types.`    |

### `M4xxx` — Structural, Hierarchy & Variability Semantics

| Code    | Rule Identifier                                   | Severity  | Message Template / Condition                                                                                                 |
| :------ | :------------------------------------------------ | :-------- | :--------------------------------------------------------------------------------------------------------------------------- |
| `M4000` | `dimension-not-parameter`                         | `error`   | `Array dimension '<expr>' must have parameter or constant variability.`                                                      |
| `M4000` | `cardinality-in-condition-only`                   | `error`   | `Built-in operator cardinality() may only be used in the condition of an if-statement or if-equation.`                       |
| `M4000` | `conditional-expression-not-evaluated`            | `error`   | `Conditional component condition '<expr>' could not be evaluated at compile time.`                                           |
| `M4000` | `dimensions-must-be-parameter`                    | `error`   | `Non-function array dimensions must be known at compile time (constant or parameter).`                                       |
| `M4001` | `extends-cycle`                                   | `error`   | `Circular inheritance detected in extends clause for '<className>'.`                                                         |
| `M4002` | `duplicate-modification`                          | `error`   | `Element '<name>' is modified multiple times in the same modification clause.`                                               |
| `M4003` | `array-dimension-mismatch`                        | `error`   | `Array dimension mismatch: expected [<expectedDims>], got [<actualDims>].`                                                   |
| `M4004` | `unbalanced-model`                                | `warning` | `Model '<modelName>' is structurally unbalanced: <varCount> variables and <eqCount> equations.`                              |
| `M4005` | `protected-modification`                          | `error`   | `Cannot modify protected element '<elementName>' of class '<className>' from outside.`                                       |
| `M4006` | `external-with-algorithm`                         | `error`   | `Function '<fnName>' cannot contain both an external clause and an algorithm section.`                                       |
| `M4007` | `function-public-variable`                        | `error`   | `Public non-input/non-output variable '<varName>' is not allowed in function '<fnName>'; declare it in a protected section.` |
| `M4008` | `array-subscript-count-mismatch`                  | `error`   | `Too many subscripts for '<name>': expression has <rank> dimension(s), but <subCount> subscript(s) were provided.`           |
| `M4009` | `function-default-arg-cycle`                      | `error`   | `Cyclic dependency detected in default input arguments of function '<fnName>'.`                                              |
| `M4010` | `function-invalid-var-type`                       | `error`   | `Function '<fnName>' cannot declare connectors or models as local variables ('<varName>').`                                  |
| `M4011` | `function-protected-io`                           | `error`   | `Protected element '<varName>' in function '<fnName>' cannot have 'input' or 'output' causality.`                            |
| `M4012` | `function-arg-variability`                        | `error`   | `Function input/output '<varName>' cannot have 'constant', 'parameter', or 'discrete' variability.`                          |
| `M4013` | `nested-when-statement`                           | `error`   | `A 'when' clause cannot be nested inside another 'when' clause.`                                                             |
| `M4014` | `tuple-expression-context`                        | `error`   | `Tuple expression '(...)' is only permitted on the left-hand side of a multi-output function call.`                          |
| `M4015` | `within-in-script`                                | `error`   | `'within' clause must appear at the very top of a Modelica source file.`                                                     |
| `M4016` | `statement-in-standard-mode`                      | `error`   | `Top-level executable statements are not allowed outside an algorithm section.`                                              |
| `M4017` | `restriction-violation`                           | `error`   | `Class specialization '<kind>' violates restriction: <detail>.`                                                              |
| `M4018` | `partial-instantiation`                           | `error`   | `Cannot instantiate partial class '<className>'.`                                                                            |
| `M4019` | `redeclare-non-replaceable`                       | `error`   | `Cannot redeclare non-replaceable element '<elementName>'.`                                                                  |
| `M4020` | `builtin-time-invalid`                            | `error`   | `Built-in variable 'time' is only valid inside models and blocks, not in '<kind>'.`                                          |
| `M4021` | `range-step-too-small`                            | `error`   | `Range step value '<step>' is zero or invalid.`                                                                              |
| `M4022` | `enum-range-with-step`                            | `error`   | `Enumeration range expressions cannot specify an explicit step increment.`                                                   |
| `M4023` | `connect-in-when`                                 | `error`   | `'connect()' equations are not permitted inside 'when' clauses.`                                                             |
| `M4024` | `connect-in-initial`                              | `error`   | `'connect()' equations are not permitted inside 'initial equation' sections.`                                                |
| `M4025` | `connect-in-non-param-if`                         | `error`   | `'connect()' inside an 'if' equation requires a parameter or constant condition.`                                            |
| `M4026` | `final-override`                                  | `error`   | `Cannot modify final element '<elementName>'.`                                                                               |
| `M4027` | `variability-binding-mismatch`                    | `error`   | `Component '<name>' with <lhsVar> variability cannot be bound to expression '<expr>' with higher (<rhsVar>) variability.`    |
| `M4028` | `partial-type-component`                          | `error`   | `Non-replaceable component '<compName>' cannot be declared with partial type '<typeName>'.`                                  |
| `M4029` | `component-binding-restriction`                   | `error`   | `Binding expression on '<compName>' is not permitted in this specialized class context.`                                     |
| `M4030` | `outer-modifier`                                  | `error`   | `Modifications are not permitted on 'outer' component declaration '<compName>'.`                                             |
| `M4031` | `array-index-out-of-bounds`                       | `error`   | `Array index <index> is out of bounds for dimension of size <size> in '<name>'.`                                             |
| `M4032` | `function-invalid-prefix`                         | `error`   | `Prefix '<prefix>' is not allowed on components inside a function.`                                                          |
| `M4033` | `function-multiple-algorithm`                     | `error`   | `Function '<fnName>' may contain at most one 'algorithm' section.`                                                           |
| `M4034` | `replaceable-base-class`                          | `error`   | `Base class '<baseName>' in an extends clause cannot be replaceable.`                                                        |
| `M4035` | `cyclic-dimension-dependency`                     | `error`   | `Cyclic dependency detected while evaluating array dimension of '<name>'.`                                                   |
| `M4036` | `package-variable-not-constant`                   | `error`   | `Component '<varName>' declared in package '<pkgName>' must be a 'constant'.`                                                |
| `M4037` | `connector-variability`                           | `error`   | `Connector component '<name>' cannot have 'parameter' or 'constant' variability on flow/stream variables.`                   |
| `M4038` | `flow-outside-connector`                          | `error`   | `Prefix 'flow' or 'stream' on '<name>' is only valid inside a connector declaration.`                                        |
| `M4039` | `called-function-partial`                         | `error`   | `Cannot call partial function '<fnName>'.`                                                                                   |
| `M4039` | `discrete-not-on-lhs`                             | `error`   | `Discrete variable '<varName>' must be assigned inside a 'when' clause.`                                                     |
| `M4040` | `protected-element-modification`                  | `error`   | `Protected element '<name>' cannot be modified in a component modifier.`                                                     |
| `M4041` | `negative-dimension`                              | `error`   | `Array dimension size <size> for '<name>' cannot be negative.`                                                               |
| `M4042` | `constant-has-no-value`                           | `error`   | `Constant '<name>' is declared without a binding value.`                                                                     |
| `M4043` | `constant-variability-violation`                  | `error`   | `Constant '<name>' binding expression is not a compile-time constant.`                                                       |
| `M4044` | `non-array-modification`                          | `error`   | `Subscripted modification applied to scalar component '<name>'.`                                                             |
| `M4045` | `binding-dimension-mismatch`                      | `error`   | `Dimension mismatch in binding of '<name>': declared [<declDims>], expression has [<exprDims>].`                             |
| `M4046` | `constant-not-fixed`                              | `error`   | `Constant '<name>' cannot have 'fixed = false'.`                                                                             |
| `M4047` | `cardinality-invalid-context`                     | `error`   | `cardinality() is deprecated and only allowed in specific guard conditions.`                                                 |
| `M4048` | `cardinality-expected-component`                  | `error`   | `Argument to cardinality() must be a scalar connector component reference.`                                                  |
| `M4049` | `break-on-non-component`                          | `error`   | `break() connection operator requires connector component references.`                                                       |
| `M4050` | `class-specialization-violation`                  | `error`   | `Class '<name>' violates restrictions of its specialized class kind '<kind>'.`                                               |
| `M4050` | `break-component-invalid-type`                    | `error`   | `Arguments to break() must be connectors.`                                                                                   |
| `M4051` | `break-connect-not-found`                         | `error`   | `No matching connect(<left>, <right>) equation found for break(<left>, <right>).`                                            |
| `M4052` | `redeclare-final-component`                       | `error`   | `Cannot redeclare final component or class '<name>'.`                                                                        |
| `M4053` | `redeclare-constant-component`                    | `error`   | `Cannot change variability of '<name>' in a redeclaration.`                                                                  |
| `M4054` | `stream-unbalanced-connector`                     | `error`   | `Connector '<connName>' contains stream variables (<streamCount>) without exactly one matching flow variable (<flowCount>).` |
| `M4055` | `cannot-connect-expandable-with-non-expandable`   | `error`   | `Incompatible non-expandable connectors connected via an expandable connector.`                                              |
| `M4056` | `duplicate-inherited-element-not-identical`       | `error`   | `Inherited element '<name>' is declared in multiple base classes with non-identical definitions.`                            |
| `M4056` | `cannot-connect-undeclared-expandable-connectors` | `error`   | `Cannot connect two undeclared virtual members '<left>' and '<right>' of expandable connectors.`                             |
| `M4057` | `expandable-connector-flow-element`               | `error`   | `Expandable connector '<connName>' cannot contain 'flow' variables ('<varName>').`                                           |
| `M4058` | `recursive-definition`                            | `error`   | `Recursive component/class definition detected for '<name>'.`                                                                |
| `M4059` | `max-recursion-depth-exceeded`                    | `error`   | `Maximum instantiation recursion depth exceeded in '<className>'.`                                                           |
| `M4061` | `redeclare-non-inherited`                         | `error`   | `Element '<name>' with 'redeclare' does not exist in any inherited base class.`                                              |
| `M4062` | `invalid-external-object`                         | `error`   | `Class '<className>' extending ExternalObject must define strictly 'constructor' and 'destructor' functions.`                |
| `M4063` | `class-extends-non-inherited`                     | `error`   | `'class extends <name>' requires '<name>' to be an inherited replaceable class.`                                             |
| `M4064` | `protected-in-connector`                          | `error`   | `Protected sections are not permitted inside connector '<connName>'.`                                                        |
| `M4065` | `equations-in-connector`                          | `error`   | `Equations are not permitted inside connector '<connName>'.`                                                                 |
| `M4066` | `external-object-missing-destructor`              | `error`   | `ExternalObject class '<className>' is missing a 'destructor' function.`                                                     |
| `M4066` | `algorithm-in-connector`                          | `error`   | `Algorithm sections are not permitted inside connector '<connName>'.`                                                        |
| `M4067` | `external-object-missing-constructor`             | `error`   | `ExternalObject class '<className>' is missing a 'constructor' function.`                                                    |
| `M4067` | `invalid-connector-variability`                   | `error`   | `Invalid variability prefix in connector '<connName>'.`                                                                      |
| `M4068` | `external-object-not-replaceable`                 | `error`   | `ExternalObject class or component '<name>' cannot be replaceable.`                                                          |
| `M4068` | `redeclare-condition-attribute`                   | `error`   | `Conditional attribute 'if ...' cannot be added or modified in a redeclaration of '<name>'.`                                 |
| `M4069` | `external-object-return-restriction`              | `error`   | `Only an ExternalObject constructor may return an ExternalObject instance.`                                                  |
| `M4070` | `external-non-function`                           | `error`   | `'external' clause is only allowed inside a function definition, not in '<kind>'.`                                           |
| `M4070` | `operator-encapsulation`                          | `error`   | `Overloaded 'operator' must be encapsulated inside an 'operator record'.`                                                    |
| `M4071` | `external-invalid-language`                       | `error`   | `Unsupported external language specification '<lang>'; expected "C", "Fortran 77", or "builtin".`                            |
| `M4071` | `operator-constructor-outputs`                    | `error`   | `'operator' constructor function in '<recordName>' must have exactly one output.`                                            |
| `M4072` | `external-invalid-arg-expr`                       | `error`   | `Arguments to external function call must be simple component references or size() expressions.`                             |
| `M4072` | `operator-constructor-output-type`                | `error`   | `Output of 'operator' constructor must be of the enclosing operator record type '<recordName>'.`                             |
| `M4073` | `external-invalid-arg-size-const`                 | `error`   | `Second argument to size() in an external function call must be an Integer constant.`                                        |
| `M4073` | `variable-in-package-not-constant`                | `error`   | `Variable '<varName>' in package '<pkgName>' is not declared as 'constant'.`                                                 |
| `M4073` | `ambiguous-operator-overload`                     | `error`   | `Ambiguous overloaded operator '<op>' for operand types <leftType> and <rightType>.`                                         |
| `M4074` | `external-array-return-not-allowed`               | `error`   | `External C function '<fnName>' cannot return an array directly as its C return value.`                                      |
| `M4074` | `no-matching-operator-function`                   | `error`   | `No matching overloaded operator function '<op>' found in operator record '<recordName>'.`                                   |
| `M4075` | `cannot-resolve-operator-type`                    | `error`   | `Cannot resolve operator record type for overloaded operator '<op>'.`                                                        |
| `M4075` | `invalid-type-prefix-flow-nested`                 | `error`   | `Prefix 'flow' cannot be applied to a structured component containing nested flow variables.`                                |
| `M4076` | `parameter-bound-contradiction`                   | `warning` | `Parameter '<paramName>' value (<val>) violates its declared min/max bounds [<min>, <max>].`                                 |
| `M4077` | `loop-termination-inconclusive`                   | `warning` | `Cannot statically prove termination of while-loop in '<context>'.`                                                          |
| `M4078` | `terminate-in-function`                           | `error`   | `'terminate()' statement is not allowed inside a function.`                                                                  |
| `M4079` | `return-outside-function`                         | `error`   | `'return' statement is only allowed inside a function algorithm section.`                                                    |
| `M4080` | `cyclic-constants-or-parameters`                  | `error`   | `Cyclic dependency detected among constants/parameters: <cyclePath>.`                                                        |
| `M4081` | `cyclic-function-components`                      | `error`   | `Cyclic dependency detected in local variable declarations of function '<fnName>'.`                                          |
| `M4082` | `connector-non-parameter-subscript`               | `error`   | `Connector subscript '<expr>' in connect() must be a parameter or constant expression.`                                      |
| `M4083` | `enum-duplicate-literal`                          | `error`   | `Duplicate enumeration literal '<lit>' in enumeration type '<enumName>'.`                                                    |
| `M4084` | `enum-reserved-attribute-literal`                 | `error`   | `Enumeration literal '<lit>' conflicts with built-in type attribute.`                                                        |
| `M4101` | `top-level-outer-element`                         | `warning` | `'outer' component '<name>' has no matching 'inner' declaration in enclosing hierarchy.`                                     |
| `M4102` | `inner-not-found-existing-decl`                   | `warning` | `No matching 'inner' declaration found for 'outer' component '<name>'.`                                                      |
| `M4103` | `missing-redeclare-keyword`                       | `error`   | `Missing 'redeclare' keyword when overriding replaceable element '<name>'.`                                                  |
| `M4104` | `invalid-redeclaration-class-as-component`        | `error`   | `Cannot redeclare class '<name>' as a component.`                                                                            |
| `M4105` | `duplicate-redeclare`                             | `error`   | `Element '<name>' is redeclared multiple times in the same scope.`                                                           |
| `M4106` | `invalid-redeclaration-prefix`                    | `error`   | `Invalid type/variability prefix in redeclaration of '<name>'.`                                                              |
| `M4107` | `invalid-redeclaration-component-as-class`        | `error`   | `Cannot redeclare component '<name>' as a class.`                                                                            |
| `M4108` | `redeclare-enum-not-subtype-generic`              | `error`   | `Redeclared enumeration '<name>' is not a valid subtype of '<baseEnum>'.`                                                    |
| `M4109` | `redeclare-enum-not-subtype`                      | `error`   | `Enumeration '<subEnum>' is not a subtype of '<superEnum>'.`                                                                 |
| `M4110` | `invalid-type-prefix-conflict`                    | `error`   | `Conflicting prefixes on '<name>' (e.g. combining 'flow' with 'parameter' or 'input' with 'output').`                        |
| `M4111` | `invalid-redeclaration-basic-type-attribute`      | `error`   | `Cannot redeclare built-in attribute '<attr>' of primitive type '<type>'.`                                                   |
| `M4112` | `extends-other-base-class`                        | `error`   | `Redeclarations using 'class extends' must extend the inherited base class.`                                                 |

### `M5xxx` — Equations, Algorithms & Control-Flow Analysis (CFA)

| Code    | Rule Identifier                       | Severity  | Message Template / Condition                                                                                              |
| :------ | :------------------------------------ | :-------- | :------------------------------------------------------------------------------------------------------------------------ |
| `M5001` | `equation-type-mismatch`              | `error`   | `Type mismatch in equation '<lhs> = <rhs>' of type <lhsType> = <rhsType>.`                                                |
| `M5002` | `constrainedby-type-mismatch`         | `error`   | `Type '<newType>' in redeclaration of '<name>' does not satisfy constraining clause 'constrainedby <constrType>'.`        |
| `M5003` | `if-branch-type-mismatch`             | `error`   | `'if' equation/statement branches have mismatched equation counts (<thenCount> vs. <elseCount>).`                         |
| `M5004` | `connect-flow-mismatch`               | `error`   | `Cannot connect flow variable '<left>' to non-flow variable '<right>'.`                                                   |
| `M5005` | `division-by-zero`                    | `error`   | `Division by zero detected in constant/parameter expression '<expr>'.`                                                    |
| `M5006` | `assignment-type-mismatch`            | `error`   | `Type mismatch in algorithm assignment '<lhs> := <rhs>': expected <lhsType>, got <rhsType>.`                              |
| `M5007` | `reinit-type-mismatch`                | `error`   | `Type mismatch in reinit(<var>, <expr>): expected Real, got <actualType>.`                                                |
| `M5007` | `for-iterator-not-1d`                 | `error`   | `For-loop range expression '<expr>' must be a 1-dimensional vector, got <dims>D.`                                         |
| `M5008` | `reinit-not-continuous`               | `error`   | `First argument '<var>' to reinit() must be a continuous-time Real state variable.`                                       |
| `M5008` | `assignment-to-constant`              | `error`   | `Cannot assign to constant '<name>' in an algorithm section.`                                                             |
| `M5009` | `assignment-to-input`                 | `error`   | `Cannot assign to read-only input variable '<name>'.`                                                                     |
| `M5010` | `homotopy-recommended`                | `info`    | `Nonlinear algebraic loop detected involving '<vars>'; consider wrapping initialization in homotopy(actual, simplified).` |
| `M5010` | `elsewhen-variable-mismatch`          | `error`   | `All branches of a 'when'/'elsewhen' equation must solve for the exact same set of variables.`                            |
| `M5011` | `assignment-to-parameter`             | `error`   | `Cannot assign to parameter '<name>' outside an 'initial algorithm' section.`                                             |
| `M5011` | `eval-external-builtin`               | `warning` | `External function '<fnName>' cannot be constant-folded at compile time.`                                                 |
| `M5012` | `assignment-to-iterator`              | `error`   | `Cannot assign to loop iterator variable '<iterName>' inside a for-loop.`                                                 |
| `M5012` | `argument-not-differentiable`         | `error`   | `Argument '<expr>' to der() is not differentiable with respect to time.`                                                  |
| `M5013` | `not-a-stream-variable`               | `error`   | `Argument '<expr>' to inStream() or actualStream() must be a 'stream' connector variable.`                                |
| `M5014` | `assignment-to-non-variable`          | `error`   | `Left-hand side of assignment '<lhs>' is not an assignable variable reference.`                                           |
| `M5015` | `function-call-contains-subscripts`   | `error`   | `Invalid subscript syntax on function call.`                                                                              |
| `M5015` | `invalid-size-index`                  | `error`   | `Dimension index <idx> in size(<arr>, <idx>) exceeds array rank <rank>.`                                                  |
| `M5016` | `tuple-subscript-not-allowed`         | `error`   | `Tuple expressions cannot be subscripted directly.`                                                                       |
| `M5016` | `function-no-named-parameter`         | `error`   | `Function '<fnName>' has no formal parameter named '<paramName>'.`                                                        |
| `M5017` | `when-in-initial-equation`            | `error`   | `'when' clauses are not permitted inside 'initial equation' or 'initial algorithm' sections.`                             |
| `M5017` | `when-illegal-context`                | `error`   | `'when' clause is not permitted inside a function or nested conditional expression.`                                      |
| `M5017` | `size-first-arg-not-array`            | `error`   | `First argument to 2-argument size(A, i) must be an array expression, got scalar <type>.`                                 |
| `M5018` | `reinit-outside-when`                 | `error`   | `Built-in operator reinit() may only be used inside the body of a 'when' equation.`                                       |
| `M5018` | `reduction-invalid-expr-type`         | `error`   | `Invalid operand type <type> for reduction operator '<op>()'.`                                                            |
| `M5019` | `reinit-in-algorithm`                 | `error`   | `'reinit()' is only allowed in 'when' equations, not inside an algorithm section.`                                        |
| `M5019` | `failed-to-deduce-dimension`          | `error`   | `Failed to deduce array dimension size from binding expression for '<name>'.`                                             |
| `M5020` | `reinit-arg1-not-variable`            | `error`   | `First argument to reinit() must be a component reference to a state variable.`                                           |
| `M5020` | `output-not-definitely-assigned`      | `warning` | `Function output '<outName>' is not definitely assigned on all control-flow paths.`                                       |
| `M5020` | `illegal-end-usage`                   | `error`   | `Keyword 'end' may only be used inside an array subscript expression.`                                                    |
| `M5021` | `reinit-arg2-type-mismatch`           | `error`   | `Second argument to reinit() must be a scalar Real expression, got <actual>.`                                             |
| `M5021` | `uninitialized-variable-read`         | `warning` | `Local variable '<varName>' may be read before being initialized in algorithm section.`                                   |
| `M5022` | `unreachable-statement`               | `warning` | `Unreachable statement detected after 'return' or 'break'.`                                                               |
| `M5025` | `implicit-iterator-subscript-missing` | `error`   | `Implicit iteration variable '<iter>' is not declared and has no explicit range.`                                         |
| `M5026` | `implicit-iteration-dim-mismatch`     | `error`   | `Dimension mismatch in array comprehension / implicit iteration.`                                                         |
| `M5027` | `when-condition-not-discrete`         | `error`   | `Condition '<expr>' of 'when' clause must be a discrete-time Boolean expression or vector.`                               |
| `M5028` | `when-if-branch-lhs-mismatch`         | `error`   | `'if' equation inside a 'when' clause must have an 'else' branch solving for identical variables.`                        |
| `M5029` | `clocked-when-has-elsewhen`           | `error`   | `A 'when' clause with a Clock condition cannot have 'elsewhen' branches.`                                                 |
| `M5030` | `clocked-when-branch-in-when`         | `error`   | `Cannot mix Clock conditions and Boolean event conditions in the same 'when' clause.`                                     |
| `M5031` | `invalid-when-lhs`                    | `error`   | `Left-hand side '<lhs>' of equation inside 'when' clause must be a simple component reference.`                           |
| `M5032` | `when-conditional-expected-boolean`   | `error`   | `'when' condition must be of type Boolean or Clock, got <actualType>.`                                                    |

### `M6xxx` — Synchronous Clocks & State Machines (`MLS §16` & `§17`)

| Code    | Rule Identifier           | Severity | Message Template / Condition                                                                                                                                                |
| :------ | :------------------------ | :------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M6001` | `mixedClockDomains`       | `error`  | `Cannot mix variables from different clock partitions without an explicit transition operator ('sample', 'hold', 'subSample', 'superSample', 'shiftSample', 'backSample').` |
| `M6002` | `sampleFactorNotPositive` | `error`  | `Sub-sampling or super-sampling factor in '<op>()' must be a positive Integer (> 0).`                                                                                       |
| `M6003` | `previousOutsideClocked`  | `error`  | `Synchronous operator 'previous()' may only be used in a clocked discrete-time partition.`                                                                                  |
| `M6004` | `holdInContinuous`        | `error`  | `Operator 'hold()' requires a clocked discrete-time argument and produces a continuous-time signal.`                                                                        |
| `M6010` | `duplicateInitialState`   | `error`  | `State machine partition contains multiple 'initialState()' declarations.`                                                                                                  |
| `M6020` | `impureCalledInPure`      | `error`  | `Impure function '<fnName>' cannot be called from inside a pure function.`                                                                                                  |
| `M6021` | `impureInEquationSection` | `error`  | `Impure function '<fnName>' may only be called inside a 'when' clause or 'initial' section.`                                                                                |
| `M6040` | `breakConnectionNotFound` | `error`  | `Target connection for 'break()' operator does not exist in the current scope.`                                                                                             |

---

## 2. SysML v2 (`@modelscript/sysml2`)

SysML v2 diagnostics (`languages/sysml2/src/errors.ts` — 34 rules) validate OMG SysML v2 / KerML syntax, naming conventions, port conjugation, SI unit algebra, ontological specialization, requirement satisfaction cycles, and behavioral state-machine/activity soundness.

| Code    | Rule Identifier                                           | Severity  | Description / Diagnostic Message                                                                       |
| :------ | :-------------------------------------------------------- | :-------- | :----------------------------------------------------------------------------------------------------- |
| `S1001` | `parse-error`                                             | `error`   | Syntax error reported by the native WASM GLR SysML v2 parser.                                          |
| `S1002` | `parse-missing`                                           | `error`   | Expected closing delimiter or keyword missing in `.sysml` source.                                      |
| `S1003` | `definition-naming`                                       | `warning` | Definition element (`part def`, `port def`, `action def`, `requirement def`) should use `PascalCase`.  |
| `S1004` | `usage-naming`                                            | `warning` | Usage element (`part`, `port`, `attribute`, `ref`) should use `camelCase`.                             |
| `S1005` | `package-naming`                                          | `info`    | Package declaration does not follow standard `PascalCase` naming convention.                           |
| `S2001` | `duplicate-member`                                        | `error`   | Duplicate member name declared within the same namespace or definition body.                           |
| `S2002` | `symbol-not-found`                                        | `error`   | Referenced feature, type, or requirement symbol could not be resolved in scope.                        |
| `S2003` | `unresolved-target` (`allocation-target-unresolved`)      | `error`   | Target endpoint of `connect`, `allocate`, `satisfy`, or `flow` cannot be resolved.                     |
| `S2004` | `unresolved-source` (`allocation-source-unresolved`)      | `error`   | Source endpoint of `connect`, `allocate`, or `flow` cannot be resolved.                                |
| `S2005` | `unresolved-import`                                       | `error`   | Imported package or member path (`import Pkg::*`) does not exist in the workspace index.               |
| `S3001` | `type-mismatch`                                           | `error`   | Attribute binding or feature redefinition value is incompatible with declared KerML type.              |
| `S3002` | `incompatible-port-connection`                            | `error`   | Connected ports have incompatible definitions or un-conjugated (`~`) directional flow items.           |
| `S3003` | `dimensional-mismatch`                                    | `error`   | Incompatible ISQ/SI physical unit dimensions in expression or attribute binding.                       |
| `S3004` | `invalid-multiplicity-bounds`                             | `error`   | Multiplicity lower bound exceeds upper bound or is negative (e.g., `[5..2]`).                          |
| `S3005` | `target-not-requirement`                                  | `error`   | Target of a `satisfy` relationship is not a `requirement def` or `requirement` usage.                  |
| `S3006` | `verify-target-not-a-requirement`                         | `error`   | Target of a `verify` relationship in a `verification def` is not a requirement.                        |
| `S3007` | `dimensional-connection-mismatch`                         | `error`   | Connected port attributes carry incompatible physical units across an interface connection.            |
| `S4001` | `circular-specialization`                                 | `error`   | Circular inheritance chain detected in `:>` (`specializes`) or `:>>` (`redefines`) hierarchy.          |
| `S4002` | `circular-satisfaction`                                   | `error`   | Cyclic requirement dependency or circular `satisfy` derivation chain detected.                         |
| `S4003` | `empty-definition`                                        | `info`    | Structural definition (`part def`, `port def`) has no features, ports, or constraints.                 |
| `S4004` | `abstract-requirement-violation`                          | `warning` | Concrete component directly satisfies an `abstract requirement` instead of a concrete specialization.  |
| `S4005` | `ontological-inconsistency`                               | `error`   | Disjoint OWL2/KerML ontological classifiers applied to the same element.                               |
| `S4006` | `missing-subject`                                         | `warning` | `requirement def` or `verification def` does not declare a `subject` parameter.                        |
| `S4007` | `empty-package`                                           | `info`    | Package declaration contains no child elements or imports.                                             |
| `S5001` | `constraint-violated`                                     | `error`   | Static `require constraint` or `assume constraint` evaluates to `false` under nominal parameters.      |
| `S5002` | `requirement-failed`                                      | `error`   | Requirement constraint expression is violated by the satisfying part's attribute bindings.             |
| `S5003` | `broken-interface-contract` (`interface-contract-broken`) | `error`   | `interface` connection violates port assume/guarantee constraints or item flow directionality.         |
| `S5004` | `activity-cfa-unreachable`                                | `warning` | Action node in an activity diagram (`action def`) is unreachable from the `first start` node.          |
| `S5005` | `activity-soundness-violation`                            | `error`   | Activity control-flow graph contains an unjoined `fork`, deadlocking `join`, or improper `merge`.      |
| `S5006` | `definite-assignment-violation`                           | `warning` | `out` parameter of an `action def` or `calc def` is not definitely assigned along all execution paths. |
| `S5007` | `statemachine-nondeterministic`                           | `warning` | State in `state def` has overlapping outgoing transition guards capable of simultaneous firing.        |
| `S5008` | `statemachine-deadlock`                                   | `warning` | Non-final state in `state def` has no outgoing transitions (sink deadlock).                            |

---

## 3. ModelScript Native `.msx` (`@modelscript/lang`)

The native `.msx` language (`languages/modelscript/src/errors.ts` — 10 rules) combines declarative equations with imperative scripts and XQuery-style FLWOR (`for ... let ... where ... order by ... return`) graph queries.

| Code      | Rule Identifier           | Severity | Message Template                                                                             |
| :-------- | :------------------------ | :------- | :------------------------------------------------------------------------------------------- |
| `MSX1001` | `parse-error`             | `error`  | `Syntax error near '<token>'.`                                                               |
| `MSX2001` | `undefined-variable`      | `error`  | `Undefined identifier '<name>' in current scope.`                                            |
| `MSX2002` | `duplicate-declaration`   | `error`  | `Identifier '<name>' is already declared in this scope.`                                     |
| `MSX2003` | `unknown-type`            | `error`  | `Unknown type or struct '<typeName>'.`                                                       |
| `MSX3001` | `type-mismatch`           | `error`  | `Type mismatch: expected '<expected>', got '<actual>'.`                                      |
| `MSX3002` | `invalid-binary-operand`  | `error`  | `Operator '<op>' cannot be applied to types '<leftType>' and '<rightType>'.`                 |
| `MSX4001` | `non-iterable-collection` | `error`  | `FLWOR 'in' binding expression must evaluate to an iterable collection, got '<actualType>'.` |
| `MSX4002` | `flwor-unbound-variable`  | `error`  | `FLWOR variable '$<varName>' is not bound in any enclosing 'for' or 'let' clause.`           |
| `MSX5001` | `argument-count-mismatch` | `error`  | `Function '<fnName>' expects <expected> argument(s), got <actual>.`                          |
| `MSX5002` | `unknown-struct-field`    | `error`  | `Field '<fieldName>' does not exist on type '<typeName>'.`                                   |

---

## 4. PSCAD Electromagnetic Transients (`@modelscript/pscad`)

PSCAD workspace and case linting (`languages/pscad/src/lints/index.ts` — 11 rules, invoked via `msx lint` or `msx pscad lint`) detects electrical topology errors, numerical EMT stability hazards, and power-system equipment misconfigurations in `.pscx` and `.pswx` files.

| Code    | Rule Identifier                | Severity  | Electrical / EMT Condition Checked                                                                                                                                                            |
| :------ | :----------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `M6001` | `floating-electrical-node`     | `warning` | Electrical wire/bus node is connected to only one terminal without a ground reference or shunt path, causing singular nodal conductance matrices $\mathbf{G}$.                                |
| `M6002` | `transformer-winding-mismatch` | `error`   | Three-phase transformer primary/secondary nominal voltage ratio or MVA base rating is inconsistent with connected bus voltage levels.                                                         |
| `M6003` | `invalid-parameter-bounds`     | `error`   | Passive component parameter ($R, L, C$, or base frequency $f_0$) is negative or zero where strictly positive values are required.                                                             |
| `M6004` | `weak-grid-warning`            | `warning` | Point of Interconnection (POI) Short-Circuit Ratio ($\text{SCR} = S_{\text{sc}} / P_{\text{rated}} < 2.0$) indicates a weak grid prone to PLL synchronization instability.                    |
| `M6005` | `csmf-unresolved-input`        | `error`   | Continuous System Model Functions (CSMF) control block (PI controller, comparator, or transfer function) has an unconnected input signal pin.                                                 |
| `M6006` | `line-travel-time-underflow`   | `error`   | Bergeron / frequency-dependent transmission line propagation delay $\tau = \ell / v$ is smaller than the EMT simulation time step $\Delta t$ (`--step`), violating traveling-wave decoupling. |
| `M6007` | `sync-machine-reactance-order` | `error`   | Synchronous machine subtransient, transient, and synchronous reactances violate physical ordering ($X_d'' \le X_d' \le X_d$ or $X_q'' \le X_q' \le X_q$).                                     |
| `M6008` | `mov-arrester-under-rated`     | `warning` | Metal-Oxide Varistor (MOV) surge arrester Maximum Continuous Operating Voltage ($V_{\text{MCOV}}$) is below the bus nominal line-to-ground RMS voltage.                                       |
| `M6009` | `duplicate-component-id`       | `error`   | Two component instances in the same `.pscx` canvas share an identical `id` attribute.                                                                                                         |
| `M6010` | `bus-voltage-conflict`         | `error`   | Direct galvanic connection (wire or closed breaker without a transformer) bridges two buses with different nominal base voltages ($V_{\text{base},1} \neq V_{\text{base},2}$).                |
| `M6011` | `port-domain-mismatch`         | `error`   | A scalar control signal wire (CSMF real/integer/boolean) is connected directly to a 3-phase electrical power terminal (or vice versa).                                                        |

---

## 5. OpenSCAD Parametric CAD (`@modelscript/scad`)

OpenSCAD static analysis (`languages/scad/src/linter.ts` — 9 rules) validates parametric 3D CSG scripts (`.scad`) before invoking the OpenCASCADE B-Rep kernel, preventing degenerate zero-volume solids and unresolved variables.

| Code                         | Severity  | Condition Checked                                                                                                                                                                        |
| :--------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SCAD_INVALID_DIMENSION`     | `error`   | Geometric primitive (`cube`, `sphere`, `cylinder`, `polyhedron`, `linear_extrude`) has a non-positive radius, height, or size ($\le 0$), or `cylinder` has both `r` and `d` conflicting. |
| `SCAD_UNDEFINED_VARIABLE`    | `error`   | Reference to an undeclared variable in an expression or transformation matrix.                                                                                                           |
| `SCAD_UNDEFINED_FUNCTION`    | `error`   | Call to an undeclared user function (and not a built-in math/list function).                                                                                                             |
| `SCAD_UNDEFINED_MODULE`      | `error`   | Instantiation of an undeclared CSG module (and not a built-in primitive or boolean operator).                                                                                            |
| `SCAD_UNKNOWN_METHOD`        | `error`   | Invalid member/method call on a vector or geometry value.                                                                                                                                |
| `SCAD_DIVISION_BY_ZERO`      | `error`   | Division or modulo by constant zero (`x / 0` or `x % 0`) in a parameter expression.                                                                                                      |
| `SCAD_ARGUMENT_COUNT`        | `error`   | Built-in or user-defined module/function called with too few or too many positional arguments.                                                                                           |
| `SCAD_UNKNOWN_PARAMETER`     | `warning` | Named keyword argument in a module/function call does not match any declared parameter of the target signature.                                                                          |
| `SCAD_DUPLICATE_DECLARATION` | `warning` | Variable, function, or module is declared multiple times in the same lexical scope (violating OpenSCAD single-assignment semantics).                                                     |

---

## 6. SSP 1.0 & SSV Parameter Archives (`@modelscript/ssp`)

The System Structure and Parameterization linter (`languages/ssp/src/linter.ts` — 20 rules across `.ssd` System Structure Descriptions and `.ssv` System Structure Parameter Values) validates multi-FMU co-simulation topologies and parameter bindings against the Modelica Association SSP 1.0 standard.

### SSP Architecture Rules (`.ssd` / `.ssp` — 13 Rules)

| Code                               | Severity  | Condition Checked                                                                                                                           |
| :--------------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------------------ |
| `SSP_EMPTY_CONNECTOR_NAME`         | `error`   | `<ssd:Connector>` element is missing a non-empty `name` attribute.                                                                          |
| `SSP_DUPLICATE_CONNECTOR`          | `error`   | Multiple connectors with the same `name` are declared on the same system or component.                                                      |
| `SSP_INVALID_CONNECTOR_KIND`       | `error`   | Connector `kind` attribute is not one of the valid SSP kinds (`input`, `output`, `parameter`, `calculatedParameter`, `local`, `inout`).     |
| `SSP_EMPTY_COMPONENT_NAME`         | `error`   | `<ssd:Component>` element has an empty or missing `name` attribute.                                                                         |
| `SSP_DUPLICATE_COMPONENT`          | `error`   | Two `<ssd:Component>` elements in the same `<ssd:Elements>` block share the same `name`.                                                    |
| `SSP_MISSING_COMPONENT_SOURCE`     | `error`   | `<ssd:Component>` of type `application/x-fmu-sharedlibrary` is missing its `source` URI attribute pointing to `resources/*.fmu`.            |
| `SSP_UNRESOLVED_ELEMENT`           | `error`   | `<ssd:Connection>` `startElement` or `endElement` references a component name that does not exist in `<ssd:Elements>`.                      |
| `SSP_UNRESOLVED_CONNECTOR`         | `error`   | `<ssd:Connection>` `startConnector` or `endConnector` does not exist on the referenced endpoint component or system boundary.               |
| `SSP_SELF_CONNECTION`              | `warning` | `<ssd:Connection>` connects a connector directly back to itself (`startElement == endElement` and `startConnector == endConnector`).        |
| `SSP_CONNECTOR_TYPE_MISMATCH`      | `error`   | Connected source and target connectors have incompatible data types (e.g., `Real` connected to `Boolean` or `String`).                      |
| `SSP_CONNECTOR_CAUSALITY_CONFLICT` | `error`   | Invalid causal connection direction (e.g., connecting two `output` connectors together or an internal `input` to another internal `input`). |
| `SSP_UNRESOLVED_BINDING_PREFIX`    | `error`   | `<ssd:ParameterBinding>` `prefix` attribute references a component hierarchy path that cannot be resolved.                                  |
| `SSP_INVALID_EXPERIMENT_BOUNDS`    | `error`   | `<ssd:DefaultExperiment>` specifies `startTime >= stopTime`.                                                                                |

### SSV Parameter Set Rules (`.ssv` — 7 Rules)

| Code                          | Severity | Condition Checked                                                                                                                                        |
| :---------------------------- | :------- | :------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `SSV_EMPTY_PARAMETER_NAME`    | `error`  | `<ssv:Parameter>` entry has an empty or missing `name` attribute.                                                                                        |
| `SSV_DUPLICATE_PARAMETER`     | `error`  | Duplicate `<ssv:Parameter>` entry overriding the same qualified parameter name in a single `.ssv` file.                                                  |
| `SSV_MISSING_PARAMETER_TYPE`  | `error`  | `<ssv:Parameter>` does not contain a typed value child element (`<ssv:Real>`, `<ssv:Integer>`, `<ssv:Boolean>`, `<ssv:String>`, or `<ssv:Enumeration>`). |
| `SSV_MISSING_PARAMETER_VALUE` | `error`  | Typed parameter element (`<ssv:Real>`, etc.) is missing its required `value` attribute.                                                                  |
| `SSV_INVALID_REAL_VALUE`      | `error`  | `<ssv:Real value="..."/>` cannot be parsed as a finite IEEE 754 floating-point number.                                                                   |
| `SSV_INVALID_INTEGER_VALUE`   | `error`  | `<ssv:Integer value="..."/>` cannot be parsed as a valid base-10 integer.                                                                                |
| `SSV_INVALID_BOOLEAN_VALUE`   | `error`  | `<ssv:Boolean value="..."/>` is neither `"true"`/`"false"` nor `"1"`/`"0"`.                                                                              |

---

## 7. CSV Trajectory & Lookup Tables (`@modelscript/csv`)

CSV validation (`languages/csv/src/csv-parser.ts` — 6 rules) checks external stimulus tables (`CombiTimeTable`), experimental telemetry datasets, and simulation reference trajectories.

| Code                        | Severity  | Condition Checked                                                                                                                                |
| :-------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------------------------------------- |
| `CSV_UNCLOSED_QUOTE`        | `error`   | Quoted RFC 4180 string field is missing its closing double-quote delimiter before end-of-file.                                                   |
| `CSV_EMPTY_HEADER`          | `warning` | Header row contains an empty column name.                                                                                                        |
| `CSV_DUPLICATE_HEADER`      | `warning` | Two or more columns in the header row share an identical variable identifier.                                                                    |
| `CSV_COLUMN_COUNT_MISMATCH` | `error`   | Data row has a different number of fields than the header row.                                                                                   |
| `CSV_INVALID_NUMERIC_CELL`  | `error`   | Cell in a numeric signal column contains a non-numeric token (excluding `NaN`/`Inf` when explicitly allowed).                                    |
| `CSV_NON_MONOTONIC_TIME`    | `warning` | The leading `time` column is not monotonically increasing ($t_k < t_{k-1}$), which invalidates time-series interpolation and trajectory diffing. |

---

## 8. STEP ISO 10303 CAD Exchange (`@modelscript/step`)

The STEP linter (`languages/step/src/errors.ts` — 8 rules, `T1001`–`T1008`) validates Part 21 exchange structure syntax, entity referential integrity, and schema compliance across AP203, AP214, and AP242 definitions.

| Code    | Rule Identifier               | Severity  | Diagnostic Condition / Message Template                                                             |
| :------ | :---------------------------- | :-------- | :-------------------------------------------------------------------------------------------------- |
| `T1001` | `step-syntax-error`           | `error`   | STEP file syntax error reported by the ISO 10303 Part 21 parser.                                    |
| `T1002` | `missing-header-section`      | `error`   | STEP exchange file is missing the mandatory `HEADER;` section.                                      |
| `T1003` | `missing-schema-declaration`  | `warning` | STEP header lacks a recognized `FILE_SCHEMA` declaration (e.g., AP203, AP214, AP242).               |
| `T1004` | `missing-data-section`        | `error`   | STEP exchange file is missing the mandatory `DATA;` section.                                        |
| `T1005` | `unresolved-entity-reference` | `error`   | Referenced STEP entity `#'<entityId>'` is not defined in the `DATA` section.                        |
| `T1006` | `duplicate-entity-id`         | `error`   | Entity ID `#'<entityId>'` is declared more than once in the `DATA` section.                         |
| `T1007` | `empty-data-section`          | `warning` | STEP `DATA` section contains no entity records.                                                     |
| `T1008` | `unsupported-ap-schema`       | `warning` | Application Protocol schema `'<schema>'` may not support complete PMI or B-Rep geometry extraction. |

---

## 9. CFD Aerodynamics & Mesh Validation (`@modelscript/cfd`)

CFD domain static analysis (`languages/cfd/src/errors.ts` — 8 rules, `C1001`–`C1008`) validates SU2 configuration decks, boundary condition coverage, and compressible fluid dynamics numerical stability bounds.

| Code    | Rule Identifier              | Severity  | Diagnostic Condition / Message Template                                                                               |
| :------ | :--------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------- |
| `C1001` | `cfl-stability-violation`    | `warning` | Courant-Friedrichs-Lewy (CFL) number `'<cfl>'` exceeds recommended maximum limit for explicit time integration.       |
| `C1002` | `unresolved-mesh-file`       | `error`   | Referenced computational grid mesh file `'<mesh>'` cannot be located or is invalid.                                   |
| `C1003` | `missing-inlet-boundary`     | `warning` | CFD domain `'<name>'` lacks a declared inlet boundary condition or stagnation state.                                  |
| `C1004` | `missing-outlet-boundary`    | `warning` | CFD domain `'<name>'` lacks a declared outlet boundary condition or static pressure exit.                             |
| `C1005` | `unphysical-freestream-mach` | `error`   | Freestream Mach number `'<mach>'` is non-physical or outside valid subsonic/supersonic simulation bounds $[0, 25]$.   |
| `C1006` | `unphysical-reynolds-number` | `error`   | Freestream Reynolds number `'<re>'` must be strictly positive ($Re > 0$).                                             |
| `C1007` | `negative-surface-area`      | `error`   | Aerodynamic reference surface area `'<area>'` must be strictly positive ($A > 0$).                                    |
| `C1008` | `turbulent-viscosity-ratio`  | `warning` | Turbulent eddy viscosity ratio $\mu_t / \mu$ `'<ratio>'` is non-physical or indicates numerical divergence in solver. |

---

## 10. FEA Structural Mechanics (`@modelscript/fea`)

Finite Element static analysis (`languages/fea/src/errors.ts` — 8 rules, `F1001`–`F1008`) checks material properties, mesh topology degeneracy, boundary constraints, and continuum mechanics constitutive bounds.

| Code    | Rule Identifier               | Severity  | Diagnostic Condition / Message Template                                                                                     |
| :------ | :---------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------- |
| `F1001` | `zero-elastic-modulus`        | `error`   | Material `'<mat>'` has non-positive Young's modulus $E \le 0$.                                                              |
| `F1002` | `poisson-ratio-limit`         | `error`   | Poisson's ratio $\nu$ for material `'<mat>'` violates continuum physical stability bounds ($-1.0 < \nu < 0.5$).             |
| `F1003` | `unconstrained-rigid-body`    | `warning` | Structural mesh `'<name>'` has fewer than 6 constrained DOF boundary nodes; rigid-body motion may cause singular stiffness. |
| `F1004` | `empty-mesh`                  | `error`   | FEA deck `'<name>'` does not contain any defined finite elements.                                                           |
| `F1005` | `missing-material-definition` | `error`   | Element set `'<elset>'` lacks an assigned material specification or section property.                                       |
| `F1006` | `degenerate-element-nodes`    | `error`   | Element `'<id>'` of type `'<type>'` contains duplicate or degenerate node references resulting in zero/negative volume.     |
| `F1007` | `negative-yield-stress`       | `error`   | Plastic yield strength $\sigma_y$ for material `'<mat>'` must be strictly positive.                                         |
| `F1008` | `negative-density`            | `warning` | Mass density $\rho$ for material `'<mat>'` must be strictly positive for dynamic/modal analysis.                            |

---

## 11. MSC Adams Multibody Dynamics (`@modelscript/adams`)

MSC Adams pre-flight multibody kinematic linter (`languages/adams/src/lints/rules.ts` — 9 rules, `M7301`–`M7310`) validates spatial mechanisms, Grübler-Kutzbach degrees of freedom, inertia tensors, and marker connectivity.

| Code    | Rule Identifier                | Severity  | Condition Checked / Message Template                                                                                                    |
| :------ | :----------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------------------------- |
| `M7301` | `overconstrained-mobility`     | `warning` | Overconstrained mechanism: Grübler-Kutzbach mobility $M < 0$ ($M = 6(N - 1) - \sum c_i$).                                               |
| `M7302` | `gimbal-lock-orientation`      | `warning` | Euler orientation of marker `'<id>'` is near singularity (pitch angle near $\pm 90^\circ$).                                             |
| `M7303` | `dangling-marker-reference`    | `error`   | Part, marker, joint, or force element references non-existent marker or part.                                                           |
| `M7304` | `non-physical-inertia-tensor`  | `error`   | Non-positive principal inertia ($I_{xx}, I_{yy}, I_{zz} \le 0$) or violation of rigid-body triangle inequalities ($I_i + I_j \ge I_k$). |
| `M7305` | `massless-moving-part`         | `error`   | Moving part `'<id>'` has zero or negative mass and is not kinematically grounded.                                                       |
| `M7307` | `non-coincident-joint-markers` | `warning` | Joint connects non-coincident markers ($d > 0.05\,\text{m}$) for concentric revolute, spherical, or universal joints.                   |
| `M7308` | `negative-force-parameter`     | `error`   | Force element `'<id>'` has negative stiffness ($K < 0$) or negative damping coefficient ($C < 0$).                                      |
| `M7309` | `missing-ground-part`          | `error`   | Dataset does not define a ground reference body (`PART/... GROUND`).                                                                    |
| `M7310` | `unconstrained-floating-part`  | `warning` | Moving part `'<id>'` is disconnected and has no kinematic joints or force elements attached.                                            |

---

## 12. Simulink Control Systems (`@modelscript/simulink`)

Simulink pre-flight static analysis (`languages/simulink/src/lints/simulink-linters.ts` — 10 rules, `M7201`–`M7210`) validates block connectivity, direct-feedthrough algebraic loops using Tarjan's SCC algorithm, and sample times.

| Code    | Rule Identifier             | Severity  | Condition Checked / Message Template                                                                                             |
| :------ | :-------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------------- |
| `M7201` | `unconnected-input-port`    | `error`   | Input port on block `'<name>'` is unconnected. All inputs must be driven or terminated with a `Ground` block.                    |
| `M7202` | `algebraic-loop`            | `error`   | Direct-feedthrough algebraic loop detected with no continuous integrator, memory state, or unit delay in feedback path.          |
| `M7203` | `unresolved-subsystem`      | `error`   | SubSystem block `'<name>'` has no defined sub-diagram or unresolved library reference.                                           |
| `M7204` | `invalid-port-index`        | `error`   | Block `'<name>'` has invalid port index (port numbers must be positive integers $1, 2, \dots$).                                  |
| `M7205` | `invalid-sample-time`       | `error`   | Block `'<name>'` specifies invalid SampleTime (must be $\ge 0$ for discrete or $-1$ for inherited).                              |
| `M7206` | `invalid-parameter`         | `error`   | Parameter contains non-finite value (`NaN`/`Inf`), unparseable numeric expression, or TransferFcn with zero leading denominator. |
| `M7207` | `invalid-bus-selector`      | `error`   | `BusSelector` references signal absent from incoming bus schema or is connected to a non-composite block.                        |
| `M7208` | `duplicate-block-name`      | `error`   | Duplicate block name `'<name>'` found within the same subsystem scope.                                                           |
| `M7209` | `division-by-zero-risk`     | `warning` | `Product`/`Divide` block performs division with variable denominator; protect denominator signal against zero crossing.          |
| `M7210` | `missing-initial-condition` | `info`    | Continuous `Integrator` block `'<name>'` does not specify an explicit `InitialCondition` parameter (defaulting to 0.0).          |

---

## 13. AUTOSAR Classic Architecture (`@modelscript/autosar`)

AUTOSAR software architecture static verification (`languages/autosar/src/lints/rules.ts` — 10 rules, `M7401`–`M7410`) checks composition port bindings, RTE runnable event mappings, worst-case execution time (WCET), and CAN PDU signal packing.

| Code    | Rule Identifier              | Severity  | Condition Checked / Message Template                                                                                      |
| :------ | :--------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------------ |
| `M7401` | `unconnected-required-port`  | `error`   | Required port (R-Port) `'<port>'` on component prototype is unconnected in composition `'<swc>'`.                         |
| `M7402` | `interface-mismatch`         | `error`   | Connector interface mismatch: Provider port provides `'<pIf>'` while Requester port requires `'<rIf>'`.                   |
| `M7403` | `untyped-data-element`       | `warning` | Data element `'<elem>'` in sender-receiver interface `'<iface>'` has no data type reference.                              |
| `M7404` | `duplicate-short-name`       | `error`   | Duplicate `SHORT-NAME` `'<name>'` detected within package scope `'<pkg>'`.                                                |
| `M7405` | `wcet-exceeded`              | `error`   | Worst-Case Execution Time ($WCET$) of runnable `'<runnable>'` exceeds its periodic timing event period ($T_{\text{ev}}$). |
| `M7406` | `signal-bit-overlap`         | `error`   | CAN signals `'<sig1>'` and `'<sig2>'` overlap bit positions in PDU `'<pdu>'`.                                             |
| `M7407` | `pdu-payload-exceeded`       | `error`   | PDU `'<pdu>'` byte length exceeds CAN/LIN frame payload capacity.                                                         |
| `M7408` | `cyclic-runnable-dependency` | `error`   | Cyclic inter-runnable data dependency detected across RTE synchronous reads/writes.                                       |
| `M7409` | `missing-internal-behavior`  | `warning` | Atomic software component `'<swc>'` lacks an `INTERNAL-BEHAVIOR` definition.                                              |
| `M7410` | `untriggered-runnable`       | `info`    | Runnable entity `'<name>'` in SWC has no associated RTE trigger event (`TimingEvent`, `DataReceivedEvent`).               |

---

## 14. URDF Robotics Kinematics (`@modelscript/urdf`)

URDF robot description static verification (`languages/urdf/src/lints/rules.ts` — 7 rules, `M7501`–`M7508`) validates tree topologies, link mass/inertias, and joint movement limits.

| Code    | Rule Identifier                   | Severity  | Condition Checked / Message Template                                                                                   |
| :------ | :-------------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------------- |
| `M7501` | `invalid-link-reference`          | `error`   | Joint `'<joint>'` references non-existent parent or child link, or link forms an unparented kinematic forest root.     |
| `M7502` | `closed-kinematic-loop`           | `error`   | Closed kinematic loop or directed closed cycle detected (URDF requires a strictly acyclic tree with one base link).    |
| `M7503` | `non-physical-link-inertia`       | `error`   | Link `'<link>'` has non-positive mass ($m \le 0$), non-positive inertia, or violates rigid-body triangle inequalities. |
| `M7504` | `missing-or-invalid-joint-limits` | `error`   | Non-continuous joint `'<joint>'` is missing `<limit>` tag or has non-positive effort/velocity bounds.                  |
| `M7505` | `missing-mesh-filename`           | `warning` | Visual or collision geometry `<mesh>` element in link `'<link>'` is missing a `filename` URI attribute.                |
| `M7507` | `zero-length-joint-axis`          | `error`   | Joint `'<joint>'` has a zero-length rotation/translation `<axis>` vector ($\|\mathbf{u}\| = 0$).                       |
| `M7508` | `inverted-joint-limits`           | `error`   | Joint `'<joint>'` has inverted angular/prismatic limits ($\text{lower} > \text{upper}$).                               |

---

## 15. SPICE Electronic Circuits (`@modelscript/spice`)

SPICE netlist analysis (`languages/spice/src/lints/rules.ts` — 10 rules, `M7101`–`M7110`) validates DC operating points, source loops, and subcircuit pinout parity before numerical transient integration.

| Code    | Rule Identifier               | Severity  | Condition Checked / Message Template                                                                                                |
| :------ | :---------------------------- | :-------- | :---------------------------------------------------------------------------------------------------------------------------------- |
| `M7101` | `spice-floating-node`         | `error`   | Floating node `'<node>'` has no DC reference path to ground (Node 0), causing singular conductance.                                 |
| `M7102` | `spice-voltage-loop`          | `error`   | Voltage source `'<vName>'` forms a closed loop of ideal voltage sources without series resistance.                                  |
| `M7103` | `spice-current-cutset`        | `error`   | Node `'<node>'` is connected strictly to ideal current sources (current cutset violating KCL).                                      |
| `M7104` | `spice-unresolved-subcircuit` | `error`   | Subcircuit `'.subckt <name>'` is instantiated by `'<comp>'` but is not defined in the netlist scope.                                |
| `M7105` | `spice-invalid-passive-value` | `error`   | Passive component ($R, L, C$) has invalid non-positive or non-finite value $\le 0$.                                                 |
| `M7106` | `spice-timestep-violation`    | `error`   | Transient analysis directive `.tran` specifies invalid timestep ($t_{\text{step}} \le 0$) or $t_{\text{stop}} \le t_{\text{step}}$. |
| `M7107` | `spice-duplicate-device`      | `error`   | Duplicate device instance name `'<comp>'` detected in circuit scope.                                                                |
| `M7108` | `spice-missing-model`         | `error`   | Active semiconductor device (diode, BJT, MOSFET) references undefined `.model` card `'<model>'`.                                    |
| `M7109` | `spice-pin-count-mismatch`    | `error`   | Subcircuit instance `'<comp>'` connects $N$ pins but definition `'.subckt'` expects $M$ ports.                                      |
| `M7110` | `spice-malformed-directive`   | `warning` | Malformed or unsupported SPICE dot directive.                                                                                       |

---

## 16. ReqIF Requirements Interchange (`@modelscript/reqif`)

Requirements engineering static validation (`languages/reqif/src/lints/rules.ts` — 10 rules, `M7001`–`M7010`) checks traceability graph completeness, formal contracts, and circularity.

| Code    | Rule Identifier                  | Severity  | Condition Checked / Message Template                                                             |
| :------ | :------------------------------- | :-------- | :----------------------------------------------------------------------------------------------- |
| `M7001` | `dangling-requirement-relation`  | `error`   | Requirement relation `'<rel>'` references missing source or target requirement `'<id>'`.         |
| `M7002` | `type-attribute-mismatch`        | `error`   | Attribute `'<attr>'` expected type `'<expected>'`, but received value `'<actual>'`.              |
| `M7003` | `circular-requirement-hierarchy` | `error`   | Circular requirement hierarchy detected at `'<id>'` along cycle path.                            |
| `M7004` | `unverified-leaf-requirement`    | `warning` | Leaf requirement `'<id>'` has no outgoing `verifies` or `satisfies` relationship.                |
| `M7005` | `unbounded-formal-contract`      | `warning` | Requirement `'<id>'` is marked safety/functional but lacks a bounded mathematical contract.      |
| `M7006` | `duplicate-spec-object-id`       | `error`   | Duplicate requirement identifier `'<id>'` declared in specification.                             |
| `M7007` | `missing-mandatory-attribute`    | `error`   | Requirement `'<id>'` is missing mandatory schema attribute `'<attr>'`.                           |
| `M7008` | `empty-specification`            | `warning` | Specification `'<id>'` contains no requirement hierarchies.                                      |
| `M7009` | `unresolved-type-reference`      | `error`   | SpecObject element references undefined `SpecObjectType` `'<ref>'`.                              |
| `M7010` | `invalid-contract-comparator`    | `error`   | Formal contract specifies invalid mathematical comparator (expected `<=`, `>=`, `<`, `>`, `==`). |

---

## 17. OLGA Multiphase Flow Assurance (`@modelscript/olga`)

OLGA flow assurance static analysis (`languages/olga/src/lints/index.ts` — 13 rules, `M7001`–`M7013`) checks subsea flowline hydrodynamics, severe riser slugging, wax appearance, NACE sour corrosion, and PVT table validity.

| Code    | Rule Identifier                     | Severity  | Condition Checked / Message Template                                                                                  |
| :------ | :---------------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------- |
| `M7001` | `cfl-condition-violation`           | `warning` | Pipe spatial discretization $\Delta x$ violates Courant-Friedrichs-Lewy (CFL) limit for configured maximum time step. |
| `M7002` | `invalid-pipe-dimensions`           | `error`   | Pipe has non-positive diameter ($D \le 0$), length ($L \le 0$), or negative absolute wall roughness ($k_s < 0$).      |
| `M7003` | `missing-boundary-condition`        | `error`   | Flowpath is missing an inlet mass/pressure source or terminal separator boundary condition.                           |
| `M7004` | `steep-elevation-warning`           | `info`    | Pipe has steep vertical inclination ($\theta > 70^\circ$); monitor for severe riser slugging.                         |
| `M7005` | `fully-closed-choke-hazard`         | `warning` | Production choke valve is fully closed ($\text{opening} = 0.0$); flowline shut-in overpressurization hazard.          |
| `M7006` | `severe-slugging-hazard`            | `warning` | Deep seabed tieback followed by steep riser without active topside slug controller; high severe slugging risk.        |
| `M7007` | `pig-stuck-hazard`                  | `error`   | Pipeline inspection pig friction force exceeds maximum upstream hydraulic drive capability; catastrophic stuck pig.   |
| `M7008` | `pvt-table-missing-or-invalid`      | `warning` | Fluid PVT table file missing, invalid format (`.tab`/`.pvt`), or boundary conditions outside tabulated bounds.        |
| `M7009` | `wax-deposition-risk`               | `warning` | Flowpath ambient temperature below Wax Appearance Temperature ($WAT$) without thermal insulation.                     |
| `M7010` | `sand-erosion-or-dropout-hazard`    | `warning` | Flow velocity below sand transport threshold ($v < 0.7\,\text{m/s}$) or exceeds API RP 14E erosional velocity limit.  |
| `M7011` | `sour-service-metallurgy-violation` | `error`   | Flowpath operates in NACE MR0175/ISO 15156 sour region ($p_{\text{H}_2\text{S}}$, pH) exceeding standard metallurgy.  |
| `M7012` | `asphaltene-precipitation-hazard`   | `error`   | Operating inside Asphaltene Onset Pressure (AOP) precipitation envelope ($CII$ colloidal instability).                |
| `M7013` | `heatexchanger-parameter-violation` | `error`   | Heat exchanger position outside flowpath length, non-finite duty ($Q$), or non-positive overall $UA \le 0$.           |

---

## 18. LPS Pipeline Networks (`@modelscript/lps`)

Liquid and gas pipeline simulation static analysis (`languages/lps/src/lints/index.ts` — 12 rules, `M8001`–`M8012`) checks MAOP compliance, compressor surge, cavitation, line pack, and transient water hammer hazards.

| Code    | Rule Identifier               | Severity  | Condition Checked / Message Template                                                                                     |
| :------ | :---------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------------- |
| `M8001` | `maop-exceeded`               | `error`   | Pipe node pressure exceeds Maximum Allowable Operating Pressure ($MAOP$) defined by ASME B31.4 / B31.8.                  |
| `M8002` | `compressor-surge-hazard`     | `warning` | Compressor operating pressure ratio exceeds limit or throughput setpoint is below aerodynamic surge limit.               |
| `M8003` | `compressor-stonewall-limit`  | `warning` | Compressor throughput setpoint exceeds maximum stonewall (choke) limit.                                                  |
| `M8004` | `unconnected-pipeline-node`   | `error`   | Node is isolated with no connecting pipe segments or hydraulic equipment links.                                          |
| `M8005` | `delivery-pressure-deficit`   | `error`   | Delivery off-take node is hydraulically unreachable from any supply source or underground storage cavern.                |
| `M8006` | `erosional-velocity-hazard`   | `warning` | Gas velocity exceeds API RP 14E erosional noise and pipe wear threshold ($v > 20\,\text{m/s}$).                          |
| `M8007` | `liquid-column-separation`    | `error`   | Node pressure drops near vapor pressure ($p \approx p_{\text{vap}}$), risking water hammer column separation on closure. |
| `M8008` | `hydrogen-embrittlement-risk` | `warning` | Gas mixture contains $>10\%$ $\text{H}_2$; verify steel fracture toughness and compressor power re-rating.               |
| `M8009` | `batch-transmix-excess`       | `warning` | Liquid pipeline batch volume is below $1000\,\text{m}^3$; interface transmix contamination degrades refined product.     |
| `M8010` | `joule-thomson-freezing`      | `warning` | Severe regulator throttling pressure drop without a preheater, creating severe Joule-Thomson hydrate/ice freezing risk.  |
| `M8011` | `pump-npsh-deficit`           | `error`   | Centrifugal pump available $NPSH_a$ is below required $NPSH_r$, causing impeller cavitation damage.                      |
| `M8012` | `line-pack-depletion-risk`    | `warning` | Total delivery customer demand exceeds continuous upstream supply; pipeline line pack inventory will deplete.            |

---

## 19. EASY5 Systems Modeling (`@modelscript/easy5`)

EASY5 static analysis (`languages/easy5/src/lints/index.ts` — 12 rules, `M7001`–`M7012`) checks block connections, continuous states, improper transfer functions, parameter bounds, and user Fortran code.

| Code    | Rule Identifier              | Severity  | Condition Checked / Message Template                                                                                 |
| :------ | :--------------------------- | :-------- | :------------------------------------------------------------------------------------------------------------------- |
| `M7001` | `unconnected-input-port`     | `warning` | Input port `'<comp>.<port>'` has no incoming connection.                                                             |
| `M7002` | `csmf-algebraic-loop`        | `error`   | Direct-feedthrough algebraic loop detected with no continuous state or delay in loop cycle.                          |
| `M7003` | `duplicate-component-id`     | `error`   | Duplicate component identifier `'<id>'` in EASY5 schematic model.                                                    |
| `M7004` | `uninitialized-state`        | `info`    | Continuous state in component `'<comp>'` defaults to 0.0 with no explicit initial condition $S_0$.                   |
| `M7005` | `improper-transfer-function` | `error`   | Transfer function in `'<comp>'` is improper: numerator degree ($\text{deg}_N$) exceeds denominator ($\text{deg}_D$). |
| `M7006` | `parameter-out-of-bounds`    | `error`   | Component parameter is outside valid physical or numerical bounds.                                                   |
| `M7007` | `port-dimension-mismatch`    | `error`   | Vector connection dimension mismatch from source (dim $N$) to target (dim $M$).                                      |
| `M7008` | `state-index-out-of-bounds`  | `error`   | State index $S(k)$ in component `'<comp>'` exceeds allocated continuous states ($k > S_{\max}$).                     |
| `M7009` | `sample-rate-mismatch`       | `warning` | Sample rate mismatch between blocks without an intermediate rate transition block.                                   |
| `M7010` | `user-fortran-syntax-error`  | `error`   | Embedded user Fortran subroutine in component `'<comp>'` contains compilation or syntax defects.                     |
| `M7011` | `unstable-linear-pole`       | `warning` | Component `'<comp>'` has open-loop pole in right-half plane ($\text{Re}(\lambda) > 0$), indicating instability.      |
| `M7012` | `table-extrapolation-hazard` | `warning` | Component references function generation table without bounded extrapolation protection.                             |

---

## 20. ROCETS Rocket Engine Transients (`@modelscript/rocets`)

ROCETS liquid rocket propulsion static analysis (`languages/rocets/src/lints/index.ts` — 14 rules, `M8001`–`M8014`) checks turbopump shaft power balances, cavitation, combustion temperature limits, and fluid tables.

| Code    | Rule Identifier                | Severity  | Condition Checked / Message Template                                                                             |
| :------ | :----------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------- |
| `M8001` | `unconnected-fluid-port`       | `error`   | Unconnected fluid port on propellant component.                                                                  |
| `M8002` | `fluid-type-mismatch`          | `error`   | Incompatible propellant fluid types connected across line junction (e.g., $\text{LH}_2$ to $\text{LOX}$).        |
| `M8003` | `shaft-power-imbalance`        | `error`   | Turbopump mechanical shaft power imbalance between driving turbine and driven impellers ($\Delta P > \epsilon$). |
| `M8004` | `unbalanced-flow-split`        | `error`   | Unbalanced mass flow rate conservation across propellant manifold junction.                                      |
| `M8005` | `pump-cavitation-risk`         | `warning` | Turbopump net positive suction pressure margin is insufficient, risking inducer/impeller cavitation.             |
| `M8006` | `negative-chamber-pressure`    | `error`   | Thrust chamber or gas generator stagnation pressure is negative ($p_c \le 0$).                                   |
| `M8007` | `combustion-temperature-limit` | `warning` | Combustion chamber adiabatic flame temperature exceeds throat material structural limits ($T_c > T_{\max}$).     |
| `M8008` | `invalid-valve-schedule`       | `error`   | Valve actuation profile specifies non-monotonic or negative time/area sequence.                                  |
| `M8009` | `choked-flow-inconsistency`    | `warning` | Convergent-divergent nozzle pressure ratio does not satisfy isentropic choked flow conditions.                   |
| `M8010` | `user-fortran-routine-error`   | `error`   | User Fortran routine compilation or runtime interface defect.                                                    |
| `M8011` | `extreme-mixture-ratio`        | `warning` | Oxidizer-to-fuel mixture ratio ($OF$) is outside stable combustion limits.                                       |
| `M8012` | `missing-fluid-table`          | `error`   | Thermodynamic propellant property table (e.g., hydrogen, methane, oxygen) is not loaded in session.              |
| `M8013` | `turbine-overspeed-hazard`     | `warning` | Turbopump shaft rotational speed exceeds maximum allowable mechanical burst limit ($RPM > RPM_{\max}$).          |
| `M8014` | `closed-flow-circuit`          | `error`   | Flowpath forms a completely isolated deadhead loop with no expansion tank or relief vent.                        |

---

## 21. CCSDS Spacecraft Telemetry & Ephemeris (`@modelscript/ccsds`)

CCSDS mission operations analysis (`languages/ccsds/src/lints/rules.ts` — 8 rules, `M8201`–`M8208`) validates orbital mechanics bounds, frame validity, ephemeris monotonicity, and telemetry packet bit layouts.

| Code    | Rule Identifier                  | Severity  | Condition Checked / Message Template                                                                               |
| :------ | :------------------------------- | :-------- | :----------------------------------------------------------------------------------------------------------------- |
| `M8201` | `sub-orbital-impact-trajectory`  | `error`   | Sub-orbital pericenter radius $r_p < R_\oplus$ ($6378.1\,\text{km}$), resulting in atmospheric re-entry or impact. |
| `M8202` | `telemetry-bit-packing-overlap`  | `error`   | Telemetry bit packing overlap in container: parameter entry starts at bit before previous entry finishes.          |
| `M8203` | `hyperbolic-unbounded-orbit`     | `warning` | Orbit eccentricity $e \ge 1.0$ indicates an unbounded hyperbolic or parabolic escape trajectory.                   |
| `M8204` | `unrecognized-reference-frame`   | `error`   | Unrecognized or non-inertial ephemeris reference frame (expected `EME2000`, `GCRF`, `ITRF`).                       |
| `M8205` | `missing-epoch-timestamp`        | `error`   | Ephemeris trajectory point missing valid UTC ISO 8601 epoch timestamp.                                             |
| `M8206` | `non-monotonic-ephemeris-epochs` | `error`   | Ephemeris timestamp $t_k$ is not strictly greater than previous timestamp $t_{k-1}$ ($t_k \le t_{k-1}$).           |
| `M8207` | `duplicate-parameter-name`       | `error`   | Duplicate telemetry parameter declaration in XTCE telemetry schema.                                                |
| `M8208` | `negative-spacecraft-mass`       | `error`   | Spacecraft wet or dry mass is non-positive ($m \le 0\,\text{kg}$).                                                 |

---

## 22. EnergyPlus Building Energy (`@modelscript/energyplus`)

Building energy static analysis (`languages/energyplus/src/lints/rules.ts` — 8 rules, `M7901`–`M7908`) validates geometric thermal zones, surface planar convexity, HVAC zone associations, and materials.

| Code    | Rule Identifier                | Severity  | Condition Checked / Message Template                                                                    |
| :------ | :----------------------------- | :-------- | :------------------------------------------------------------------------------------------------------ |
| `M7901` | `unmatched-interzone-surface`  | `error`   | Interzone surface specifies outside boundary object which does not exist or has mismatched reciprocal.  |
| `M7902` | `non-convex-surface-polygon`   | `warning` | Surface polygon violates planar convexity, which impairs solar raytracing and view factor calculations. |
| `M7903` | `missing-thermal-properties`   | `error`   | Material has non-positive thermal conductivity ($k \le 0$), density ($\rho \le 0$), or specific heat.   |
| `M7904` | `unconnected-hvac-zone`        | `error`   | HVAC component references non-existent thermal zone.                                                    |
| `M7905` | `excessive-surface-absorption` | `warning` | Material solar or thermal absorptance coefficient exceeds physical maximum of 1.0 ($\alpha > 1.0$).     |
| `M7906` | `duplicate-zone-name`          | `error`   | Duplicate thermal zone identifier detected in building model.                                           |
| `M7907` | `unreferenced-construction`    | `error`   | Building surface references undefined layered construction.                                             |
| `M7908` | `zero-thickness-material`      | `error`   | Opaque construction material has invalid non-positive thickness ($d \le 0\,\text{m}$).                  |

---

## 23. EPANET Water Distribution Networks (`@modelscript/epanet`)

EPANET static analysis (`languages/epanet/src/lints/rules.ts` — 8 rules, `M8101`–`M8108`) verifies water hydraulic network connectivity, pump head curves, pipe geometry, and junction pressures.

| Code    | Rule Identifier             | Severity  | Condition Checked / Message Template                                                                                  |
| :------ | :-------------------------- | :-------- | :-------------------------------------------------------------------------------------------------------------------- |
| `M8101` | `isolated-hydraulic-node`   | `error`   | Hydraulic node is isolated with no connecting pipes, valves, or pumps.                                                |
| `M8102` | `negative-pressure-risk`    | `warning` | Junction elevation exceeds maximum network reservoir head ($z > H_{\max}$), risking negative pressure and cavitation. |
| `M8103` | `non-monotonic-pump-curve`  | `error`   | Pump head curve violates decreasing monotonicity: head increases as flow rate increases ($dH/dQ > 0$).                |
| `M8104` | `zero-length-pipe`          | `error`   | Pipe link has non-positive physical length ($L \le 0\,\text{m}$).                                                     |
| `M8105` | `zero-diameter-pipe`        | `error`   | Pipe link has non-positive internal diameter ($D \le 0\,\text{mm}$).                                                  |
| `M8106` | `duplicate-node-id`         | `error`   | Duplicate node identifier detected in water network topology.                                                         |
| `M8107` | `duplicate-link-id`         | `error`   | Duplicate link identifier detected in water network topology.                                                         |
| `M8108` | `unreferenced-node-in-link` | `error`   | Pipe, valve, or pump link references undefined endpoint node identifier.                                              |

---

## 24. OpenDRIVE Autonomous Vehicle Networks (`@modelscript/opendrive`)

OpenDRIVE roadway network verification (`languages/opendrive/src/lints/rules.ts` — 8 rules, `M7801`–`M7808`) validates road geometry tangency, clothoid curvature, lane linkages, and road gradients.

| Code    | Rule Identifier                 | Severity  | Condition Checked / Message Template                                                                           |
| :------ | :------------------------------ | :-------- | :------------------------------------------------------------------------------------------------------------- |
| `M7801` | `road-tangency-discontinuity`   | `error`   | Tangency discontinuity between road geometry segments (position gap $\Delta s$ or heading gap $\Delta\theta$). |
| `M7802` | `unlinked-lane-boundary`        | `error`   | Unlinked lane connection: lane links to non-existent predecessor or successor lane ID.                         |
| `M7803` | `clothoid-curvature-divergence` | `error`   | Clothoid curvature rate of change ($\dot{\kappa}$) diverges ($> 0.1\,\text{m}^{-2}$).                          |
| `M7804` | `overlapping-junction-paths`    | `warning` | Connecting paths in junction conflict without assigned traffic signal or right-of-way priority.                |
| `M7805` | `elevation-gradient-extreme`    | `warning` | Extreme vertical road elevation slope ($> 15\%$) exceeds highway safety limits.                                |
| `M7806` | `negative-lane-width`           | `error`   | Negative or zero lane width ($w \le 0\,\text{m}$) in lane section polynomial profile.                          |
| `M7807` | `duplicate-road-id`             | `error`   | Duplicate road ID detected in roadway network.                                                                 |
| `M7808` | `missing-center-lane`           | `error`   | Road lane section is missing mandatory center reference lane (Lane ID 0).                                      |

---

## 25. PLCopen Industrial Automation (`@modelscript/plcopen`)

PLCopen IEC 61131-3 static code analysis (`languages/plcopen/src/lints/rules.ts` — 10 rules, `M7701`–`M7710`) checks Structured Text POUs, task overruns, recursion, I/O collisions, and timers.

| Code    | Rule Identifier            | Severity  | Condition Checked / Message Template                                                                             |
| :------ | :------------------------- | :-------- | :--------------------------------------------------------------------------------------------------------------- |
| `M7701` | `unassigned-variable-read` | `error`   | Variable is read before being assigned or initialized in POU body.                                               |
| `M7702` | `cyclic-task-overrun`      | `warning` | Computational complexity in periodic task may exceed assigned cyclic interval ($T_{\text{task}}$).               |
| `M7703` | `recursive-pou-call`       | `error`   | Recursive invocation of POU detected (recursion is strictly prohibited by IEC 61131-3 for deterministic timing). |
| `M7704` | `io-mapping-collision`     | `error`   | Hardware I/O address collision: multiple output variables assigned to the same physical address (`%QX...`).      |
| `M7705` | `type-mismatch-assignment` | `error`   | Type mismatch in assignment: expression type is incompatible with target variable type.                          |
| `M7706` | `timer-preset-negative`    | `error`   | Timer preset duration ($PT$) for `TON`/`TOF`/`TP` function block cannot be negative ($PT < T\#0s$).              |
| `M7707` | `unbounded-loop-detected`  | `warning` | `WHILE` or `REPEAT` loop in POU lacks a statically provable deterministic termination bound.                     |
| `M7708` | `unknown-pou-type`         | `error`   | Instantiation of unknown or unresolvable function block or POU type.                                             |
| `M7709` | `unreachable-code`         | `warning` | Unreachable statements detected following unconditional `RETURN`, `EXIT`, or jump.                               |
| `M7710` | `invalid-task-interval`    | `error`   | Periodic task configuration specifies invalid or non-positive execution interval ($T \le 0$).                    |

---

## 26. Verilog-A Analog Behavioral Modeling (`@modelscript/verilog-a`)

Verilog-A analog behavioral static verification (`languages/verilog-a/src/lints/rules.ts` — 10 rules, `M7601`–`M7610`) checks constitutive analog branch equations, `ddt()` continuity, and disciplined nodes.

| Code    | Rule Identifier                       | Severity  | Condition Checked / Message Template                                                                |
| :------ | :------------------------------------ | :-------- | :-------------------------------------------------------------------------------------------------- |
| `M7601` | `unassigned-analog-branch`            | `error`   | Electrical port pair has no constitutive branch equation in `analog` block.                         |
| `M7602` | `discontinuous-derivative-expression` | `warning` | Discontinuous time-derivative operator `ddt()` or `idt()` used inside conditional branch statement. |
| `M7603` | `invalid-parameter-range`             | `error`   | Parameter default value violates declared `from [...]` range bounds.                                |
| `M7604` | `unbounded-exponential-growth`        | `warning` | Unbounded standard exponential `exp()` used instead of safe limited analog exponential `limexp()`.  |
| `M7605` | `port-discipline-mismatch`            | `error`   | Port has no declared discipline (`electrical`, `rotational`, etc.) or mismatches module domain.     |
| `M7606` | `undefined-node-reference`            | `error`   | Analog branch access `V(p, n)` or `I(p, n)` references undeclared internal node.                    |
| `M7607` | `duplicate-module-declaration`        | `error`   | Duplicate module identifier declaration in translation unit.                                        |
| `M7608` | `zero-resistance-branch`              | `error`   | Potential contribution `V(p, n) <+ 0.0` forms an unconstrained ideal short-circuit branch.          |
| `M7609` | `floating-internal-node`              | `warning` | Internal node is declared but never referenced in any constitutive analog branch equation.          |
| `M7610` | `unsupported-analog-primitive`        | `warning` | Unsupported or deprecated analog primitive statement.                                               |

---

## 27. Fortran Numerical Subroutines (`@modelscript/fortran`)

Fortran static analysis (`languages/fortran/src/lints/index.ts` — 10 rules, `M4070`–`M4079`) checks legacy simulation subroutines against strict typing, DO-loop mutation, storage bounds, and COMMON blocks.

| Code    | Rule Identifier             | Severity  | Condition Checked / Message Template                                                                    |
| :------ | :-------------------------- | :-------- | :------------------------------------------------------------------------------------------------------ |
| `M4070` | `undeclared-variable`       | `error`   | Variable referenced without explicit declaration under strict typing (`IMPLICIT NONE`).                 |
| `M4071` | `uninitialized-variable`    | `warning` | Local variable may be read before being assigned a value.                                               |
| `M4072` | `constant-division-by-zero` | `error`   | Division by constant zero detected in arithmetic expression.                                            |
| `M4073` | `storage-bounds-overflow`   | `error`   | Static array subscript index exceeds declared dimension bounds ($i > N_{\max}$).                        |
| `M4074` | `dead-code-after-return`    | `warning` | Unreachable statements detected following unconditional `RETURN` or `STOP`.                             |
| `M4075` | `do-loop-index-mutation`    | `error`   | `DO`-loop iteration index variable is modified within its loop body.                                    |
| `M4076` | `procedural-algebraic-loop` | `warning` | Procedural algebraic loop / mutual cyclic variable assignment dependency detected in subroutine.        |
| `M4077` | `common-block-mismatch`     | `error`   | `COMMON` block definition size or type sequence conflict across translation units.                      |
| `M4078` | `array-dimension-underflow` | `error`   | Array dimension index underflows declared lower bound ($i < 1$).                                        |
| `M4079` | `obsolete-arithmetic-if`    | `info`    | Three-way arithmetic `IF (expr) n1, n2, n3` is obsolescent; prefer structured `IF (...) THEN ... ELSE`. |

---

## 28. C Numerical & Control Blocks (`@modelscript/c`)

C static analysis (`languages/c/src/lints/rules.ts` — 10 rules, `M8401`–`M8410`) checks procedural C blocks, S-functions, and control algorithms against memory safety, division by zero, uninitialized reads, prototype mismatches, and algebraic loops.

| Code    | Rule Identifier               | Severity  | Condition Checked / Message Template                                                      |
| :------ | :---------------------------- | :-------- | :---------------------------------------------------------------------------------------- |
| `M8401` | `uninitialized-variable`      | `warning` | Local variable may be read before being assigned or initialized.                          |
| `M8402` | `constant-division-by-zero`   | `error`   | Division or modulo by constant zero detected in arithmetic expression.                    |
| `M8403` | `array-bounds-overflow`       | `error`   | Static array subscript index exceeds declared dimension bound ($i \ge N$).                |
| `M8404` | `unreachable-code`            | `warning` | Unreachable statements detected following unconditional `return`, `break`, or `goto`.     |
| `M8405` | `assignment-in-conditional`   | `warning` | Assignment operator `=` used inside conditional expression instead of comparison `==`.    |
| `M8406` | `algebraic-dependency-cycle`  | `error`   | Procedural algebraic loop / mutual cyclic variable assignment detected without state lag. |
| `M8407` | `null-pointer-dereference`    | `error`   | Dereference of statically known `NULL` pointer constant.                                  |
| `M8408` | `function-prototype-mismatch` | `error`   | Function definition signature conflicts with previously declared prototype.               |
| `M8409` | `missing-return-value`        | `error`   | Non-void function reaches end of body without returning a value.                          |
| `M8410` | `implicit-lossy-conversion`   | `info`    | Floating-point value implicitly assigned to integer without explicit cast.                |
