import * as path from "path";
import { fileURLToPath } from "url";
import { extractLanguageAST } from "../src/codegen/ast-loader.js";

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

describe("Modelica 3.7 Modular Lints Extraction & Direct Source AST", () => {
  it("should extract all modular lints across all categories from Modelica language definition", () => {
    const modelicaLangPath = path.join(__dirname, "..", "..", "..", "languages", "modelica", "src", "language.ts");
    const ast = extractLanguageAST(modelicaLangPath);

    expect(ast).not.toBeNull();
    expect(ast?.lints.size).toBeGreaterThan(20);

    // Verify Category 1 (Syntax & Placement)
    expect(ast?.lints.has("emptyArrayConstructor")).toBe(true);
    expect(ast?.lints.has("identifierMismatch")).toBe(true);
    expect(ast?.lints.has("functionProtectedIO")).toBe(true);
    expect(ast?.lints.has("nestedWhen")).toBe(true);
    expect(ast?.lints.has("connectInWhen")).toBe(true);
    expect(ast?.lints.has("connectInInitial")).toBe(true);
    expect(ast?.lints.has("finalOverride")).toBe(true);
    expect(ast?.lints.has("functionMultipleAlgorithm")).toBe(true);
    expect(ast?.lints.has("flowOutsideConnector")).toBe(true);
    expect(ast?.lints.has("cardinalityInvalidContext")).toBe(true);

    // Verify Category 2 (Types & Expressions)
    expect(ast?.lints.has("typeMismatchBinding")).toBe(true);
    expect(ast?.lints.has("arrayIndexTypeMismatch")).toBe(true);
    expect(ast?.lints.has("equationTypeMismatch")).toBe(true);
    expect(ast?.lints.has("divisionByZero")).toBe(true);
    expect(ast?.lints.has("assignmentTypeMismatch")).toBe(true);
    expect(ast?.lints.has("assignmentToConstant")).toBe(true);
    expect(ast?.lints.has("assignmentToInput")).toBe(true);
    expect(ast?.lints.has("notAStreamVariable")).toBe(true);

    // Verify Category 3 (Hierarchy & Variability)
    expect(ast?.lints.has("unresolvedReference")).toBe(true);
    expect(ast?.lints.has("extendsCycle")).toBe(true);
    expect(ast?.lints.has("duplicateModification")).toBe(true);
    expect(ast?.lints.has("unbalancedModel")).toBe(true);
    expect(ast?.lints.has("variabilityBindingMismatch")).toBe(true);
    expect(ast?.lints.has("outerModifier")).toBe(true);
    expect(ast?.lints.has("replaceableBaseClass")).toBe(true);
    expect(ast?.lints.has("constantVariabilityViolation")).toBe(true);

    // Verify Category 4 (Connections & Streams)
    expect(ast?.lints.has("connectFlowMismatch")).toBe(true);
    expect(ast?.lints.has("connectorVariability")).toBe(true);
    expect(ast?.lints.has("constantNotFixed")).toBe(true);
    expect(ast?.lints.has("missingInner")).toBe(true);

    // Verify Category 5 (Modelica 3.7 Synchronous Clocks & Extensions)
    expect(ast?.lints.has("mixedClockDomains")).toBe(true);
    expect(ast?.lints.has("sampleFactorNotPositive")).toBe(true);
    expect(ast?.lints.has("previousOutsideClocked")).toBe(true);
    expect(ast?.lints.has("holdInContinuous")).toBe(true);
    expect(ast?.lints.has("duplicateInitialState")).toBe(true);
    expect(ast?.lints.has("impureCalledInPure")).toBe(true);
    expect(ast?.lints.has("impureInEquationSection")).toBe(true);
    expect(ast?.lints.has("breakConnectionNotFound")).toBe(true);

    // Verify Classes & Helpers
    expect(ast?.classes.has("ModelicaFlattener")).toBe(true);
    expect(ast?.classes.has("ModelicaModificationEnv")).toBe(true);
    expect(ast?.classes.has("ModelicaPortBalancer")).toBe(true);
    expect(ast?.classes.has("ModelicaEquationFlattener")).toBe(true);
    expect(ast?.classes.has("ModelicaExprVisitor")).toBe(true);
  });
});
