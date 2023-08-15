import { ModelScriptContext } from './context.js';
import { ModelScriptAbstractSyntaxVisitor, ArrayConstructorAbstractSyntaxNode, BinaryIntegerLiteralAbstractSyntaxNode, DecimalIntegerLiteralAbstractSyntaxNode, DoubleQuotedStringLiteralAbstractSyntaxNode, HexadecimalIntegerLiteralAbstractSyntaxNode, KeyedElementAbstractSyntaxNode, LogicalLiteralAbstractSyntaxNode, ModuleAbstractSyntaxNode, NullLiteralAbstractSyntaxNode, ObjectConstructorAbstractSyntaxNode, OctalIntegerLiteralAbstractSyntaxNode, SingleQuotedStringLiteralAbstractSyntaxNode, UnkeyedElementAbstractSyntaxNode } from './syntax.js';

export class ModelScriptInterpreter extends ModelScriptAbstractSyntaxVisitor {

    #context: ModelScriptContext;

    constructor(context: ModelScriptContext) {
        super();
        this.#context = context;
    }

    override visitArrayConstructor(node: ArrayConstructorAbstractSyntaxNode, ...args: any[]): any {
        const array: any = [];
        for (const element of node.elements ?? [])
            element?.accept(this, array);
        return array;
    }

    override visitBinaryIntegerLiteral(node: BinaryIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitDecimalIntegerLiteral(node: DecimalIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitDoubleQuotedStringLiteral(node: DoubleQuotedStringLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitHexadecimalIntegerLiteral(node: HexadecimalIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitKeyedElement(node: KeyedElementAbstractSyntaxNode, ...args: any[]): any {
        const container = args[0];
        const key = node.key?.accept(this);
        const value = node.value?.accept(this);
        container[key] = value;
    }

    override visitLogicalLiteral(node: LogicalLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitModule(node: ModuleAbstractSyntaxNode, ...args: any[]): any {
        return node.expression?.accept(this);
    }

    override visitNullLiteral(node: NullLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitObjectConstructor(node: ObjectConstructorAbstractSyntaxNode, ...args: any[]): any {
        const object: any = {};
        for (const element of node.elements ?? [])
            element?.accept(this, object);
        return object;
    }

    override visitOctalIntegerLiteral(node: OctalIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitSingleQuotedStringLiteral(node: SingleQuotedStringLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitUnkeyedElement(node: UnkeyedElementAbstractSyntaxNode, ...args: any[]): any {
        const container = args[0];
        const value = node.value?.accept(this);
        if (Array.isArray(container))
            container.push(value);
        else
            container[value] = value;
    }

}