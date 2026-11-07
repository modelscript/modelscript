/**
 * Evaluates basic math expressions inside ${...} in Xacro attributes:
 * Supports +, -, *, /, parenthesis, numbers, pi, and variable lookups.
 */
export declare function evaluateXacroExpr(expr: string, properties: Map<string, number | string>): number;
/**
 * Expands Xacro properties and macros within an XML string, returning expanded URDF XML text.
 */
export declare function expandXacro(sourceXml: string): string;
//# sourceMappingURL=xacro.d.ts.map