import { SyntaxNode, childForFieldName, childrenForFieldName } from './tree-sitter.js';

export abstract class ModelScriptAbstractSyntaxNode {

    #concreteSyntaxNode?: SyntaxNode;
    #processed: boolean = false;

    constructor(concreteSyntaxNode?: SyntaxNode) {
        this.#concreteSyntaxNode = concreteSyntaxNode;
    }

    abstract accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    get concreteSyntaxNode(): SyntaxNode | undefined {
        return this.#concreteSyntaxNode;
    }

    static construct(concreteSyntaxNode?: SyntaxNode | null): ModelScriptAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'array_constructor':
                return new ArrayConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_expression':
                return new BinaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'conditional_expression':
                return new ConditionalExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'double_quoted_string_literal':
                return new DoubleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'logical_literal':
                return new LogicalLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'keyed_element':
                return new KeyedElementAbstractSyntaxNode(concreteSyntaxNode);
            case 'module':
                return new ModuleAbstractSyntaxNode(concreteSyntaxNode);
            case 'null_literal':
                return new NullLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'object_constructor':
                return new ObjectConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'parenthesized_expression':
                return new ParenthesizedExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'unary_expression':
                return new UnaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'unkeyed_element':
                return new UnkeyedElementAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode?.type)
        }
    }

    protected abstract process(): void;

    protected get processed(): boolean {
        return this.#processed;
    }

    protected set processed(processed: boolean) {
        this.#processed = processed;
    }

}

export abstract class ExpressionAbstractSyntaxNode extends ModelScriptAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static construct(concreteSyntaxNode?: SyntaxNode | null): ExpressionAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'array_constructor':
                return new ArrayConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_expression':
                return new BinaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'conditional_expression':
                return new ConditionalExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'double_quoted_string_literal':
                return new DoubleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'logical_literal':
                return new LogicalLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'null_literal':
                return new NullLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'object_constructor':
                return new ObjectConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'parenthesized_expression':
                return new ParenthesizedExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'unary_expression':
                return new UnaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode?.type)
        }
    }

    protected abstract override process(): void;

}

export class BinaryExpressionAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #operand1?: ExpressionAbstractSyntaxNode;
    #operand2?: ExpressionAbstractSyntaxNode;
    #operator?: BinaryOperator;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitBinaryExpression(this, ...args);
    }

    get operand1(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#operand1;
    }

    get operand2(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#operand2;
    }

    get operator(): BinaryOperator | undefined {
        this.process();
        return this.#operator;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'binary_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#operand1 = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'operand1'));
        this.#operand2 = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'operand2'));

        switch (childForFieldName(this.concreteSyntaxNode, 'operator')?.text) {
            case '=':
                this.#operator = BinaryOperator.ASSIGNMENT;
                break;
            case '*=':
                this.#operator = BinaryOperator.MULTIPLICATION_ASSIGNMENT;
                break;
            case '/=':
                this.#operator = BinaryOperator.DIVISION_ASSIGNMENT;
                break;
            case '%=':
                this.#operator = BinaryOperator.MODULUS_ASSIGNMENT;
                break;
            case '+=':
                this.#operator = BinaryOperator.ADDITION_ASSIGNMENT;
                break;
            case '-=':
                this.#operator = BinaryOperator.SUBTRACTION_ASSIGNMENT;
                break;
            case '<<=':
                this.#operator = BinaryOperator.LEFT_SHIFT_ASSIGNMENT;
                break;
            case '>>=':
                this.#operator = BinaryOperator.RIGHT_SHIFT_ASSIGNMENT;
                break;
            case '&=':
                this.#operator = BinaryOperator.BITWISE_AND_ASSIGNMENT;
                break;
            case '|=':
                this.#operator = BinaryOperator.BITWISE_INCLUSIVE_OR_ASSIGNMENT;
                break;
            case '^=':
                this.#operator = BinaryOperator.BITWISE_EXCLUSIVE_OR_ASSIGNMENT;
                break;
            case '||':
                this.#operator = BinaryOperator.LOGICAL_OR;
                break;
            case '&&':
                this.#operator = BinaryOperator.LOGICAL_AND;
                break;
            case '|':
                this.#operator = BinaryOperator.BITWISE_INCLUSIVE_OR;
                break;
            case '^':
                this.#operator = BinaryOperator.BITWISE_EXCLUSIVE_OR;
                break;
            case '&':
                this.#operator = BinaryOperator.BITWISE_AND;
                break;
            case '==':
                this.#operator = BinaryOperator.EQUALITY;
                break;
            case '!=':
                this.#operator = BinaryOperator.INEQUALITY;
                break;
            case '<':
                this.#operator = BinaryOperator.LESS_THAN;
                break;
            case '>':
                this.#operator = BinaryOperator.GREATER_THAN;
                break;
            case '<=':
                this.#operator = BinaryOperator.LESS_THAN_OR_EQUAL_TO;
                break;
            case '>=':
                this.#operator = BinaryOperator.GREATER_THAN_OR_EQUAL_TO;
                break;
            case '<<':
                this.#operator = BinaryOperator.LEFT_SHIFT;
                break;
            case '>>':
                this.#operator = BinaryOperator.RIGHT_SHIFT;
                break;
            case '+':
                this.#operator = BinaryOperator.ADDITION;
                break;
            case '-':
                this.#operator = BinaryOperator.SUBTRACTION;
                break;
            case '*':
                this.#operator = BinaryOperator.MULTIPLICATION;
                break;
            case '/':
                this.#operator = BinaryOperator.DIVISION;
                break;
            case '%':
                this.#operator = BinaryOperator.MODULUS;
                break;
        }

        this.processed = true;

    }

}

export class ConditionalExpressionAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #alternative?: ExpressionAbstractSyntaxNode;
    #condition?: ExpressionAbstractSyntaxNode;
    #consequence?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitConditionalExpression(this, ...args);
    }

    get alternative(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#alternative;
    }

    get condition(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#condition;
    }

    get consequence(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#consequence;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'conditional_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#alternative = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'alternative'));
        this.#condition = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'condition'));
        this.#consequence = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'consequence'));

        this.processed = true;

    }

}

export abstract class LiteralAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static override construct(concreteSyntaxNode?: SyntaxNode | null): LiteralAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'double_quoted_string_literal':
                return new DoubleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'logical_literal':
                return new LogicalLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'null_literal':
                return new NullLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode?.type)
        }
    }

    protected abstract override process(): void;

    abstract get value(): any;

}

export class LogicalLiteralAbstractSyntaxNode extends LiteralAbstractSyntaxNode {

    #value?: boolean;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitLogicalLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'logical_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = this.concreteSyntaxNode.text == 'true';

        this.processed = true;

    }

    override get value(): boolean | undefined {
        this.process();
        return this.#value;
    }

}

export class NullLiteralAbstractSyntaxNode extends LiteralAbstractSyntaxNode {

    #value?: null;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitNullLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'null_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = null;

        this.processed = true;

    }

    override get value(): null | undefined {
        this.process();
        return this.#value;
    }

}

export abstract class NumberLiteralAbstractSyntaxNode extends LiteralAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static override construct(concreteSyntaxNode?: SyntaxNode | null): NumberLiteralAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode?.type)
        }
    }

    protected abstract override process(): void;

    abstract override get value(): number | undefined;

}

export abstract class IntegerLiteralAbstractSyntaxNode extends NumberLiteralAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static override construct(concreteSyntaxNode?: SyntaxNode | null): IntegerLiteralAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode?.type)
        }
    }

    protected abstract override process(): void;

    abstract override get value(): number | undefined;

}

export class BinaryIntegerLiteralAbstractSyntaxNode extends IntegerLiteralAbstractSyntaxNode {

    #value?: number;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitBinaryIntegerLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'binary_integer_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = parseInt(this.concreteSyntaxNode.text.substring(2), 2);

        this.processed = true;

    }

    override get value(): number | undefined {
        this.process();
        return this.#value;
    }

}

export class DecimalIntegerLiteralAbstractSyntaxNode extends IntegerLiteralAbstractSyntaxNode {

    #value?: number;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitDecimalIntegerLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'decimal_integer_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = parseInt(this.concreteSyntaxNode.text, 10);

        this.processed = true;

    }

    override get value(): number | undefined {
        this.process();
        return this.#value;
    }

}

export class HexadecimalIntegerLiteralAbstractSyntaxNode extends IntegerLiteralAbstractSyntaxNode {

    #value?: number;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitHexadecimalIntegerLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'hexadecimal_integer_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = parseInt(this.concreteSyntaxNode.text.substring(2), 16);

        this.processed = true;

    }

    override get value(): number | undefined {
        this.process();
        return this.#value;
    }

}

export class OctalIntegerLiteralAbstractSyntaxNode extends IntegerLiteralAbstractSyntaxNode {

    #value?: number;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitOctalIntegerLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'octal_integer_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = parseInt(this.concreteSyntaxNode.text.substring(2), 8);

        this.processed = true;

    }

    override get value(): number | undefined {
        this.process();
        return this.#value;
    }

}

export abstract class StringLiteralAbstractSyntaxNode extends LiteralAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static override construct(concreteSyntaxNode?: SyntaxNode | null): StringLiteralAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'double_quoted_string_literal':
                return new DoubleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode?.type)
        }
    }

    protected abstract override process(): void;

    abstract override get value(): string | undefined;

}

export class DoubleQuotedStringLiteralAbstractSyntaxNode extends StringLiteralAbstractSyntaxNode {

    #value?: string;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitDoubleQuotedStringLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'double_quoted_string_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = this.concreteSyntaxNode.text.substring(1, this.concreteSyntaxNode.text.length);

        this.processed = true;

    }

    override get value(): string | undefined {
        this.process();
        return this.#value;
    }

}

export class SingleQuotedStringLiteralAbstractSyntaxNode extends StringLiteralAbstractSyntaxNode {

    #value?: string;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitSingleQuotedStringLiteral(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'single_quoted_string_literal')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = this.concreteSyntaxNode.text.substring(1, this.concreteSyntaxNode.text.length);

        this.processed = true;

    }

    override get value(): string | undefined {
        this.process();
        return this.#value;
    }

}

export class ArrayConstructorAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #elements?: ElementAbstractSyntaxNode[];

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitArrayConstructor(this, ...args);
    }

    get elements(): ElementAbstractSyntaxNode[] | undefined {
        this.process();
        return this.#elements;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'array_constructor')
            throw new Error(this.concreteSyntaxNode.type);

        this.#elements = [];
        for (const child of childrenForFieldName(this.concreteSyntaxNode, 'element')) {
            const element = ElementAbstractSyntaxNode.construct(child);
            if (element != null)
                this.#elements.push(element);
        }

        this.processed = true;

    }

}

export class ObjectConstructorAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #elements?: ElementAbstractSyntaxNode[];

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitObjectConstructor(this, ...args);
    }

    get elements(): ElementAbstractSyntaxNode[] | undefined {
        this.process();
        return this.#elements;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'object_constructor')
            throw new Error(this.concreteSyntaxNode.type);

        this.#elements = [];
        for (const child of childrenForFieldName(this.concreteSyntaxNode, 'element')) {
            const element = ElementAbstractSyntaxNode.construct(child);
            if (element != null)
                this.#elements.push(element);
        }

        this.processed = true;

    }

}

export abstract class ElementAbstractSyntaxNode extends ModelScriptAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ElementAbstractSyntaxNode | undefined {
        switch (concreteSyntaxNode?.type) {
            case 'keyed_element':
                return new KeyedElementAbstractSyntaxNode(concreteSyntaxNode);
            case 'unkeyed_element':
                return new UnkeyedElementAbstractSyntaxNode(concreteSyntaxNode);
        }
    }

    protected abstract override process(): void;

    abstract get value(): ExpressionAbstractSyntaxNode | undefined;

}

export class KeyedElementAbstractSyntaxNode extends ElementAbstractSyntaxNode {

    #key?: ExpressionAbstractSyntaxNode;
    #value?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitKeyedElement(this, ...args);
    }

    get key(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#key;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'keyed_element')
            throw new Error(this.concreteSyntaxNode.type);

        this.#key = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'key'));
        this.#value = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'value'));

        this.processed = true;

    }

    get value(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#value;
    }

}

export class UnkeyedElementAbstractSyntaxNode extends ElementAbstractSyntaxNode {

    #value?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitUnkeyedElement(this, ...args);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'unkeyed_element')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'value'));

        this.processed = true;

    }

    get value(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#value;
    }

}

export class ParenthesizedExpressionAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #expression?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitParenthesizedExpression(this, ...args);
    }

    get expression(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#expression;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'parenthesized_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#expression = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'expression'));

        this.processed = true;

    }

}

export class UnaryExpressionAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #operand?: ExpressionAbstractSyntaxNode;
    #operator?: UnaryOperator;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitUnaryExpression(this, ...args);
    }

    get operand(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#operand;
    }

    get operator(): UnaryOperator | undefined {
        this.process();
        return this.#operator;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'unary_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#operand = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'operand'));

        switch (childForFieldName(this.concreteSyntaxNode, 'operator')?.text) {
            case '~':
                this.#operator = UnaryOperator.BITWISE_NOT;
                break;
            case '!':
                this.#operator = UnaryOperator.LOGICAL_NOT;
                break;
            case '-':
                this.#operator = UnaryOperator.UNARY_NEGATION;
                break;
            case '+':
                this.#operator = UnaryOperator.UNARY_PLUS;
                break;
        }

        this.processed = true;

    }

}

export class ModuleAbstractSyntaxNode extends ModelScriptAbstractSyntaxNode {

    #expression?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitModule(this, ...args);
    }

    get expression(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#expression;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'module')
            throw new Error(this.concreteSyntaxNode.type);

        this.#expression = ExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'expression'));

        this.processed = true;

    }

}

export abstract class ModelScriptAbstractSyntaxVisitor {

    visitArrayConstructor(node: ArrayConstructorAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitBinaryExpression(node: BinaryExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitBinaryIntegerLiteral(node: BinaryIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitConditionalExpression(node: ConditionalExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitDecimalIntegerLiteral(node: DecimalIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitDoubleQuotedStringLiteral(node: DoubleQuotedStringLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitHexadecimalIntegerLiteral(node: HexadecimalIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitKeyedElement(node: KeyedElementAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitLogicalLiteral(node: LogicalLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitModule(node: ModuleAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitNullLiteral(node: NullLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitObjectConstructor(node: ObjectConstructorAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitOctalIntegerLiteral(node: OctalIntegerLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitSingleQuotedStringLiteral(node: SingleQuotedStringLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitUnkeyedElement(node: UnkeyedElementAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitParenthesizedExpression(node: ParenthesizedExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitUnaryExpression(node: UnaryExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

}

export enum BinaryOperator {
    ASSIGNMENT,
    MULTIPLICATION_ASSIGNMENT,
    DIVISION_ASSIGNMENT,
    MODULUS_ASSIGNMENT,
    ADDITION_ASSIGNMENT,
    SUBTRACTION_ASSIGNMENT,
    LEFT_SHIFT_ASSIGNMENT,
    RIGHT_SHIFT_ASSIGNMENT,
    BITWISE_AND_ASSIGNMENT,
    BITWISE_INCLUSIVE_OR_ASSIGNMENT,
    BITWISE_EXCLUSIVE_OR_ASSIGNMENT,
    LOGICAL_OR,
    LOGICAL_AND,
    BITWISE_INCLUSIVE_OR,
    BITWISE_EXCLUSIVE_OR,
    BITWISE_AND,
    EQUALITY,
    INEQUALITY,
    LESS_THAN,
    GREATER_THAN,
    LESS_THAN_OR_EQUAL_TO,
    GREATER_THAN_OR_EQUAL_TO,
    LEFT_SHIFT,
    RIGHT_SHIFT,
    ADDITION,
    SUBTRACTION,
    MULTIPLICATION,
    DIVISION,
    MODULUS
}

export enum UnaryOperator {
    BITWISE_NOT,
    LOGICAL_NOT,
    UNARY_NEGATION,
    UNARY_PLUS
}