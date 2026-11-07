export interface StepEntity {
    id: string;
    type: string;
    args: string;
    startOffset: number;
    endOffset: number;
}
/**
 * High-performance, zero-regex scanner that parses all `#ID = TYPE(ARGS);` entities
 * from STEP ISO 10303-21 clear text, correctly respecting comments, quoted strings, and nested parentheses.
 */
export declare function scanStepEntities(text: string): StepEntity[];
/**
 * Scans raw STEP ISO 10303-21 text to extract all `#N = ENTITY(...)` instance definitions
 * and `#N` entity reference occurrences (skipping comments and single-quoted strings).
 */
export declare function parseStepReferences(text: string): {
    definitions: Map<string, {
        startOffset: number;
        endOffset: number;
        text: string;
        type: string;
    }>;
    references: {
        id: string;
        startOffset: number;
        endOffset: number;
    }[];
};
/**
 * EXPRESS schema catalog for common STEP AP203 / AP214 / AP242 geometric, topological,
 * product structure, and representation entities used for hover documentation and completion.
 */
export declare const STEP_SCHEMA: Record<string, {
    description: string;
    parameters: {
        name: string;
        type: string;
    }[];
}>;
//# sourceMappingURL=schema.d.ts.map