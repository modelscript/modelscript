import { LanguageOptions } from "../dsl.js";

export function generateWatEmitter(grammarDef?: LanguageOptions): string {
  const exportName = grammarDef?.targets?.wat?.exportName || "main";
  return `// ----------------------------------------------------------------------------
// Phase 2: WebAssembly Text (WAT) Emitter
// ----------------------------------------------------------------------------

export function emit_wat(blockPtr: u32): u32 {
    sb_reset();
    
    // Module Header
    sb_appendLiteral("(module\\n");
    sb_appendLiteral("  (import \\"env\\" \\"perform_effect\\" (func $__perform_effect (param i32 i32) (result i32)))\\n");
    sb_appendLiteral("  (import \\"env\\" \\"resume_continuation\\" (func $__resume_continuation (param i32) (result i32)))\\n");
    sb_appendLiteral("  (func $${exportName} (result i32)\\n");
    
    // First pass: scan for local variable declarations
    let curr = load<u32>(blockPtr, 0);
    while (curr != 0) {
        let op = load<u16>(curr, 0);
        if (op == OP_ASSIGN) {
            let nameHash = load<u32>(curr + 4, 0);
            sb_appendLiteral("    (local $v");
            sb_appendI32(nameHash);
            sb_appendLiteral(" i32)\\n");
        }
        curr = load<u32>(curr + 12, 0);
    }
    
    // Second pass: Emit WebAssembly instructions
    curr = load<u32>(blockPtr, 0);
    while (curr != 0) {
        let op = load<u16>(curr, 0);
        let op1 = load<u32>(curr + 4, 0);
        let op2 = load<u32>(curr + 8, 0);
        
        sb_appendLiteral("    ");
        
        if (op == OP_CONST) {
            sb_appendLiteral("i32.const ");
            sb_appendI32(op1);
            sb_appendLiteral("\\n");
        } else if (op == OP_BINOP_ADD) {
            sb_appendLiteral("i32.add\\n");
        } else if (op == OP_BINOP_SUB) {
            sb_appendLiteral("i32.sub\\n");
        } else if (op == OP_BINOP_MUL) {
            sb_appendLiteral("i32.mul\\n");
        } else if (op == OP_BINOP_DIV) {
            sb_appendLiteral("i32.div_s\\n");
        } else if (op == OP_ASSIGN) {
            sb_appendLiteral("local.set $v");
            sb_appendI32(op1);
            sb_appendLiteral("\\n");
        } else if (op == OP_VAR_REF) {
            sb_appendLiteral("local.get $v");
            sb_appendI32(op1);
            sb_appendLiteral("\\n");
        } else if (op == OP_RETURN) {
            sb_appendLiteral("return\\n");
        } else if (op == OP_PERFORM) {
            sb_appendLiteral("i32.const ");
            sb_appendI32(op1);
            sb_appendLiteral("\\n");
            
            sb_appendLiteral("local.get $v");
            sb_appendI32(op2);
            sb_appendLiteral("\\n");
            
            sb_appendLiteral("call $__perform_effect\\n");
        } else if (op == OP_RESUME) {
            sb_appendLiteral("local.get $v");
            sb_appendI32(op1);
            sb_appendLiteral("\\n");
            
            sb_appendLiteral("call $__resume_continuation\\n");
        }
        
        curr = load<u32>(curr + 12, 0);
    }
    
    sb_appendLiteral("    i32.const 0\\n");
    sb_appendLiteral("    return\\n");
    
    sb_appendLiteral("  )\\n");
    sb_appendLiteral("  (export \\"${exportName}\\" (func $${exportName}))\\n");
    sb_appendLiteral(")\\n");
    
    return sb_finish();
}
`;
}
