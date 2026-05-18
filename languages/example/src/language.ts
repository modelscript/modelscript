import {
  choice,
  def,
  error,
  field,
  language,
  ref,
  repeat,
  seq,
  warning,
  type QueryDB,
  type SymbolEntry,
} from "@modelscript/compiler";

export default language({
  name: "example",

  extras: () => [
    /\s/,
    /\/\/.*/, // Line comments
    /\/\*.*?\*\//, // Block comments
  ],

  word: ($) => $.IDENT,

  rules: {
    // The top-level file rule
    SourceFile: ($) => repeat($.Declaration),

    Declaration: ($) => choice($.ClassDeclaration),

    // Defines a Class that can contain fields
    ClassDeclaration: ($) =>
      def({
        syntax: seq("class", field("name", $.IDENT), "{", repeat($.FieldDeclaration), "}"),
        symbol: (self) => ({
          kind: "Class",
          name: self.name,
          // Expose the class name to the global index
          exports: [self.name],
          // Graphics configuration for visual representation
          graphics: {
            shape: "class-box",
            color: "#3498db",
          },
        }),
        queries: {
          // Query to get all fields belonging to this class
          fields: (db: QueryDB, self: SymbolEntry) => db.childrenOf(self.id).filter((c) => c.kind === "Field"),

          // Lint rule for classes
          lint: (db: QueryDB, self: SymbolEntry) => {
            if (self.name && !/^[A-Z]/.test(self.name)) {
              warning("Class names should start with an uppercase letter.", self.id);
            }
          },
        },
      }),

    // Defines a Field inside a Class, which references a type
    FieldDeclaration: ($) =>
      def({
        syntax: seq(
          field("name", $.IDENT),
          ":",
          // 'ref' creates a resolvable reference node pointing to another symbol
          field(
            "type",
            ref($.TypeReference, {
              kind: "TypeReference",
              target: "Class",
              // The resolve function is used by the language server for Go-To-Definition
              resolve: (db: QueryDB, node: { text: string }) => {
                const types = db.byName(node.text);
                return types.find((t) => t.kind === "Class") || null;
              },
            }),
          ),
          ";",
        ),
        symbol: (self) => ({
          kind: "Field",
          name: self.name,
        }),
        queries: {
          // Query to find the semantic symbol of the type this field uses
          resolvedType: (db: QueryDB, self: SymbolEntry) => {
            const cst = db.cstNode(self.id);
            if (!cst) return null;

            const typeRef = cst.childForFieldName("type");
            if (!typeRef) return null;

            // Look up the class definition globally
            const types = db.byName(typeRef.text);
            return types.find((t) => t.kind === "Class") || null;
          },

          // Lint rule to ensure the type exists
          lint: (db: QueryDB, self: SymbolEntry) => {
            const resolved = db.query("resolvedType", self.id);
            if (!resolved) {
              const cst = db.cstNode(self.id);
              const typeName = cst?.childForFieldName("type")?.text || "Unknown";
              error(
                `Cannot resolve type '${typeName}' for field '${self.name}'. Did you forget to define the class?`,
                self.id,
              );
            }
          },
        },
      }),

    TypeReference: ($) => $.IDENT,

    // Lexical tokens
    IDENT: () => /[a-zA-Z_][a-zA-Z0-9_]*/,
  },
});
