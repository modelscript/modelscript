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

declare module "@modelscript/modelica/semantic-model" {
  export type AbstractSyntaxNodeFactory = (cst: any) => any;
  export function registerAbstractSyntaxNodeFactory(factory: AbstractSyntaxNodeFactory): void;

  export type AnnotationEvaluator = (ast: any, name: string) => any;
  export function registerAnnotationEvaluator(evaluator: AnnotationEvaluator): void;

  export class ModelicaElement {
    name: string;
    compositeName: string;
    description: string | null;
    parent: any;
    resolveSimpleName(name: string, ...args: any[]): any;
    [key: string]: any;
  }

  export class ModelicaClassInstance extends ModelicaElement {
    constructor(symbolId: any, db: any);
    static new(...args: any[]): ModelicaClassInstance;
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
    classInstance: ModelicaClassInstance | null;
    isExpandable: boolean;
    isProtectedElement(name: string): boolean;
    instantiate(): void;
    resolveName(parts: string[]): ModelicaClassInstance | null;
    resolveSimpleName(name: string, ...args: any[]): any;
    resolveComponentReference(parts: string[]): any;
    accept(visitor: any, ...args: any[]): any;
    [key: string]: any;
  }

  export class ModelicaComponentInstance extends ModelicaClassInstance {
    readonly componentName: string;
    readonly declaredType: any;
    flowPrefix: any;
    isProtected: boolean;
    isFinal: boolean;
    isInner: boolean;
    isOuter: boolean;
  }

  export class ModelicaExtendsClassInstance extends ModelicaClassInstance {}

  export class ModelicaModification {
    static merge(...args: any[]): ModelicaModification;
    readonly modificationArguments: any[];
    readonly expression: any;
    readonly description: string | null;
    modificationExpression: any;
    [key: string]: any;
  }

  export class ModelicaElementModification {
    readonly name: string;
    readonly expression: any;
    readonly modification: ModelicaModification | null;
    modificationExpression: any;
    [key: string]: any;
  }

  export class ModelicaPredefinedClassInstance extends ModelicaClassInstance {}
  export class ModelicaShortClassInstance extends ModelicaClassInstance {}
  export class ModelicaClockClassInstance extends ModelicaClassInstance {}
  export class ModelicaExpressionClassInstance extends ModelicaClassInstance {}
  export class ModelicaIntegerClassInstance extends ModelicaClassInstance {}
  export class ModelicaBooleanClassInstance extends ModelicaClassInstance {}
  export class ModelicaStringClassInstance extends ModelicaClassInstance {}
  export class ModelicaRealClassInstance extends ModelicaClassInstance {}
  export class ModelicaEnumerationClassInstance extends ModelicaClassInstance {
    readonly literals: any[];
    readonly enumerationLiterals: any[];
    readonly value: any;
  }
  export class ModelicaArrayClassInstance extends ModelicaClassInstance {
    readonly elementClassInstance: ModelicaClassInstance;
    readonly arraySubscripts: any[];
    readonly enumDimensions: any[];
    readonly declaredElements: Iterable<any>;
  }
}

declare module "@modelscript/modelica/query_hooks" {
  export const queryHooks: any;
}

declare module "@modelscript/modelica/indexer_config" {
  export const indexerHooks: any;
}

declare module "@modelscript/modelica/ref_config" {
  export const refHooks: any;
}

declare module "@modelscript/modelica/expression-evaluator" {
  export const modelicaExpressionEvaluator: any;
}
