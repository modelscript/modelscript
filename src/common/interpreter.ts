import { ModelScriptContext } from './context.js';
import { ModelScriptAbstractSyntaxVisitor, ArrayConstructorAbstractSyntaxNode, BinaryIntegerLiteralAbstractSyntaxNode, DecimalIntegerLiteralAbstractSyntaxNode, DoubleQuotedStringLiteralAbstractSyntaxNode, HexadecimalIntegerLiteralAbstractSyntaxNode, KeyedElementAbstractSyntaxNode, LogicalLiteralAbstractSyntaxNode, ModuleAbstractSyntaxNode, NullLiteralAbstractSyntaxNode, ObjectConstructorAbstractSyntaxNode, OctalIntegerLiteralAbstractSyntaxNode, SingleQuotedStringLiteralAbstractSyntaxNode, UnkeyedElementAbstractSyntaxNode, UnaryExpressionAbstractSyntaxNode, UnaryOperator, BinaryExpressionAbstractSyntaxNode, BinaryOperator, ParenthesizedExpressionAbstractSyntaxNode, ConditionalExpressionAbstractSyntaxNode, ContextItemExpressionAbstractSyntaxNode, SubscriptExpressionAbstractSyntaxNode } from './syntax.js';

export class ModelScriptInterpreter extends ModelScriptAbstractSyntaxVisitor {

    #context: ModelScriptContext;
    #contextItem: any = null;

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

    override visitBinaryExpression(node: BinaryExpressionAbstractSyntaxNode, ...args: any[]): any {
        switch (node.operator) {
            case BinaryOperator.ASSIGNMENT:
                throw new Error();
            case BinaryOperator.MULTIPLICATION_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.DIVISION_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.MODULUS_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.ADDITION_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.SUBTRACTION_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.LEFT_SHIFT_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.RIGHT_SHIFT_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.BITWISE_AND_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.BITWISE_INCLUSIVE_OR_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.BITWISE_EXCLUSIVE_OR_ASSIGNMENT:
                throw new Error();
            case BinaryOperator.LOGICAL_OR:
                return node.operand1?.accept(this) || node.operand2?.accept(this);
            case BinaryOperator.LOGICAL_AND:
                return node.operand1?.accept(this) && node.operand2?.accept(this);
            case BinaryOperator.BITWISE_INCLUSIVE_OR:
                return node.operand1?.accept(this) | node.operand2?.accept(this);
            case BinaryOperator.BITWISE_EXCLUSIVE_OR:
                return node.operand1?.accept(this) ^ node.operand2?.accept(this);
            case BinaryOperator.BITWISE_AND:
                return node.operand1?.accept(this) & node.operand2?.accept(this);
            case BinaryOperator.EQUALITY:
                return node.operand1?.accept(this) == node.operand2?.accept(this);
            case BinaryOperator.INEQUALITY:
                return node.operand1?.accept(this) != node.operand2?.accept(this);
            case BinaryOperator.LESS_THAN:
                return node.operand1?.accept(this) < node.operand2?.accept(this);
            case BinaryOperator.GREATER_THAN:
                return node.operand1?.accept(this) > node.operand2?.accept(this);
            case BinaryOperator.LESS_THAN_OR_EQUAL_TO:
                return node.operand1?.accept(this) <= node.operand2?.accept(this);
            case BinaryOperator.GREATER_THAN_OR_EQUAL_TO:
                return node.operand1?.accept(this) >= node.operand2?.accept(this);
            case BinaryOperator.LEFT_SHIFT:
                return node.operand1?.accept(this) << node.operand2?.accept(this);
            case BinaryOperator.RIGHT_SHIFT:
                return node.operand1?.accept(this) >> node.operand2?.accept(this);
            case BinaryOperator.ADDITION:
                return node.operand1?.accept(this) + node.operand2?.accept(this);
            case BinaryOperator.SUBTRACTION:
                return node.operand1?.accept(this) - node.operand2?.accept(this);
            case BinaryOperator.MULTIPLICATION:
                return node.operand1?.accept(this) * node.operand2?.accept(this);
            case BinaryOperator.DIVISION:
                return node.operand1?.accept(this) / node.operand2?.accept(this);
            case BinaryOperator.MODULUS:
                return node.operand1?.accept(this) % node.operand2?.accept(this);
            default:
                throw new Error();
        }
    }

    override visitConditionalExpression(node: ConditionalExpressionAbstractSyntaxNode, ...args: any[]): any {
        if (node.condition?.accept(this))
            return node.consequence?.accept(this);
        else
            return node.alternative?.accept(this);
    }

    override visitContextItemExpression(node: ContextItemExpressionAbstractSyntaxNode, ...args: any[]): any {
        return this.#contextItem;
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

    override visitParenthesizedExpression(node: ParenthesizedExpressionAbstractSyntaxNode, ...args: any[]): any {
        return node.expression?.accept(this);
    }

    override visitSingleQuotedStringLiteral(node: SingleQuotedStringLiteralAbstractSyntaxNode, ...args: any[]): any {
        return node.value;
    }

    override visitSubscriptExpression(node: SubscriptExpressionAbstractSyntaxNode, ...args: any[]): any {
        const expression = node.expression?.accept(this);
        let subscript = node.subscript?.accept(this);

        if (typeof subscript == "boolean") {
            const result: any = Array.isArray(expression) ? [] : {};
            for (const [key, value] of Object.entries(expression)) {
                this.#contextItem = value;
                if (node.subscript?.accept(this))
                    result[key] = value;
            }
            return result;
        } else {
            return expression[subscript];
        }
    }

    override visitUnkeyedElement(node: UnkeyedElementAbstractSyntaxNode, ...args: any[]): any {
        const container = args[0];
        const value = node.value?.accept(this);
        if (Array.isArray(container))
            container.push(value);
        else
            container[value] = value;
    }

    override visitUnaryExpression(node: UnaryExpressionAbstractSyntaxNode, ...args: any[]): any {
        switch (node.operator) {
            case UnaryOperator.BITWISE_NOT:
                return ~node.operand?.accept(this)
            case UnaryOperator.LOGICAL_NOT:
                return !node.operand?.accept(this)
            case UnaryOperator.UNARY_NEGATION:
                return -node.operand?.accept(this)
            case UnaryOperator.UNARY_PLUS:
                return +node.operand?.accept(this)
            default:
                throw new Error();
        }
    }

}