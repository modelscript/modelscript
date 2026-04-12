/* eslint-disable @typescript-eslint/no-explicit-any */
/* eslint-disable @typescript-eslint/no-misused-new */
// Ambient module declarations for polyglot packages.
// These prevent TypeScript from pulling raw .ts source files into core's strict compilation.
//
// During the polyglot migration, we use permissive index signatures ([key: string]: any)
// to allow the flattener to access properties that will be progressively typed.
// TODO: Replace with precise types once the compat-shim API is stable.

declare module "@modelscript/polyglot/query-engine" {
  export interface LintDiagnostic {
    severity: string;
    rule: string;
    message: string;
    node?: {
      startPosition: { row: number; column: number };
      endPosition: { row: number; column: number };
      startIndex: number;
      endIndex: number;
    } | null;
  }

  export class QueryEngine {
    constructor(index: any, queryHooks: any, expressionEvaluator?: any);
    query(symbolId: any, queryName: string): unknown;
    runAllLints(): LintDiagnostic[];
    resolveName(parts: string[]): any;
    invalidate(): void;
    get db(): any;
    [key: string]: any;
  }
}

declare module "@modelscript/polyglot/resolver" {
  export class ScopeResolver {
    constructor(index: any, refHooks: any, indexerHooks: any);
    resolve(name: string[], fromScope?: any): any;
    [key: string]: any;
  }
}

declare module "@modelscript/polyglot/workspace-index" {
  export class WorkspaceIndex {
    constructor(indexerHooks: any);
    updateIndex(rootNode: any): any;
    symbol(id: any): any;
    allSymbols(): Iterable<any>;
    [key: string]: any;
  }
}

declare module "@modelscript/modelica-polyglot/compat-shim" {
  export class QueryBackedElement {
    name: string;
    compositeName: string;
    description: string | null;
    parent: any;
    resolveSimpleName(name: string, ...args: any[]): any;
    [key: string]: any;
  }

  export class QueryBackedClassInstance extends QueryBackedElement {
    constructor(symbolId: any, db: any);
    static new(...args: any[]): QueryBackedClassInstance;
    static merge?(...args: any[]): any;
    readonly classKind: any;
    readonly components: Iterable<any>;
    readonly extendsClasses: any[];
    readonly extendsClassInstances: any[];
    readonly sections: any[];
    readonly equationSections: any[];
    readonly algorithmSections: any[];
    readonly annotations: any[];
    readonly annotation: any;
    readonly abstractSyntaxNode: any;
    readonly modification: any;
    readonly scope: any;
    readonly elements: Iterable<any>;
    readonly declaredElements: Iterable<any>;
    readonly virtualComponents: Iterable<any>;
    readonly inputParameters: any[];
    readonly outputParameters: any[];
    readonly diagnostics: any[];
    readonly entry: any;
    instantiated: boolean;
    instantiating: boolean;
    shape: number[];
    variability: any;
    causality: any;
    classInstance: QueryBackedClassInstance | null;
    isExpandable: boolean;
    isProtectedElement(name: string): boolean;
    instantiate(): void;
    resolveName(parts: string[]): QueryBackedClassInstance | null;
    resolveSimpleName(name: string, ...args: any[]): any;
    resolveComponentReference(parts: string[]): any;
    accept(visitor: any, ...args: any[]): any;
    [key: string]: any;
  }

  export class QueryBackedComponentInstance extends QueryBackedClassInstance {
    readonly componentName: string;
    readonly declaredType: any;
    flowPrefix: any;
    isProtected: boolean;
    isFinal: boolean;
    isInner: boolean;
    isOuter: boolean;
  }

  export class QueryBackedExtendsClassInstance extends QueryBackedClassInstance {}

  export class QueryBackedModification {
    static merge(...args: any[]): QueryBackedModification;
    readonly modificationArguments: any[];
    readonly expression: any;
    readonly description: string | null;
    modificationExpression: any;
    [key: string]: any;
  }

  export class QueryBackedElementModification {
    readonly name: string;
    readonly expression: any;
    readonly modification: QueryBackedModification | null;
    modificationExpression: any;
    [key: string]: any;
  }

  export class QueryBackedPredefinedClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedShortClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedClockClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedIntegerClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedBooleanClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedStringClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedRealClassInstance extends QueryBackedClassInstance {}
  export class QueryBackedEnumerationClassInstance extends QueryBackedClassInstance {
    readonly literals: any[];
    readonly enumerationLiterals: any[];
    readonly value: any;
  }
  export class QueryBackedArrayClassInstance extends QueryBackedClassInstance {
    readonly elementClassInstance: QueryBackedClassInstance;
    readonly arraySubscripts: any[];
    readonly enumDimensions: any[];
    readonly declaredElements: Iterable<any>;
  }
}

declare module "@modelscript/modelica-polyglot/query_hooks" {
  export const queryHooks: any;
}

declare module "@modelscript/modelica-polyglot/indexer_config" {
  export const indexerHooks: any;
}

declare module "@modelscript/modelica-polyglot/ref_config" {
  export const refHooks: any;
}

declare module "@modelscript/modelica-polyglot/expression-evaluator" {
  export const modelicaExpressionEvaluator: any;
}
