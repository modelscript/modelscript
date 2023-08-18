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
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'array_constructor':
                return new ArrayConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_expression':
                return new BinaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'conditional_expression':
                return new ConditionalExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'context_item_expression':
                return new ContextItemExpressionAbstractSyntaxNode(concreteSyntaxNode);
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
            case 'name':
                return new NameAbstractSyntaxNode(concreteSyntaxNode);
            case 'null_literal':
                return new NullLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'object_constructor':
                return new ObjectConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'parenthesized_expression':
                return new ParenthesizedExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'quantified_expression':
                return new QuantifiedExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'quantifier':
                return new QuantifierAbstractSyntaxNode(concreteSyntaxNode);
            case 'quantifier_clause':
                return new QuantifiedClauseAbstractSyntaxNode(concreteSyntaxNode);
            case 'relation_expression':
                return new RelationExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'subscript_expression':
                return new SubscriptExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'unary_expression':
                return new UnaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'unkeyed_element':
                return new UnkeyedElementAbstractSyntaxNode(concreteSyntaxNode);
            case 'variable':
                return new VariableAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
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
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'array_constructor':
                return new ArrayConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_expression':
                return new BinaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'conditional_expression':
                return new ConditionalExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'context_item_expression':
                return new ContextItemExpressionAbstractSyntaxNode(concreteSyntaxNode);
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
            case 'quantified_expression':
                return new QuantifiedExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'relation_expression':
                return new RelationExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'subscript_expression':
                return new SubscriptExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'unary_expression':
                return new UnaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
        }
    }

    protected abstract override process(): void;

}

export class RelationExpressionAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    #property?: SingleExpressionAbstractSyntaxNode;
    #object?: SingleExpressionAbstractSyntaxNode;
    #subject?: SingleExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitRelationExpression(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): RelationExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'relation_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new RelationExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    get property(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#property;
    }

    get object(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#object;
    }

    get subject(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#subject;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'relation_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#property = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'property'));
        this.#object = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'object'));
        this.#subject = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'subject'));

        this.processed = true;

    }

}

export abstract class SingleExpressionAbstractSyntaxNode extends ExpressionAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static construct(concreteSyntaxNode?: SyntaxNode | null): SingleExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'array_constructor':
                return new ArrayConstructorAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_expression':
                return new BinaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'conditional_expression':
                return new ConditionalExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'context_item_expression':
                return new ContextItemExpressionAbstractSyntaxNode(concreteSyntaxNode);
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
            case 'quantified_expression':
                return new QuantifiedExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'subscript_expression':
                return new SubscriptExpressionAbstractSyntaxNode(concreteSyntaxNode);
            case 'unary_expression':
                return new UnaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
        }
    }

    protected abstract override process(): void;

}

export class BinaryExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #operand1?: SingleExpressionAbstractSyntaxNode;
    #operand2?: SingleExpressionAbstractSyntaxNode;
    #operator?: BinaryOperator;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitBinaryExpression(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): BinaryExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'binary_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new BinaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    get operand1(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#operand1;
    }

    get operand2(): SingleExpressionAbstractSyntaxNode | undefined {
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

        this.#operand1 = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'operand1'));
        this.#operand2 = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'operand2'));

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
            default:
                throw Error();
        }

        this.processed = true;

    }

}

export class ConditionalExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #alternative?: SingleExpressionAbstractSyntaxNode;
    #condition?: SingleExpressionAbstractSyntaxNode;
    #consequence?: SingleExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitConditionalExpression(this, ...args);
    }

    get alternative(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#alternative;
    }

    get condition(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#condition;
    }

    get consequence(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#consequence;
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ConditionalExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'conditional_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new ConditionalExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'conditional_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#alternative = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'alternative'));
        this.#condition = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'condition'));
        this.#consequence = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'consequence'));

        this.processed = true;

    }

}

export class ContextItemExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitContextItemExpression(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ContextItemExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'context_item_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new ContextItemExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'context_item_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.processed = true;

    }

}

export abstract class LiteralAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    abstract override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any;

    static override construct(concreteSyntaxNode?: SyntaxNode | null): LiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
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
                throw new Error(concreteSyntaxNode.type)
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): LogicalLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'logical_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new LogicalLiteralAbstractSyntaxNode(concreteSyntaxNode);
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): NullLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'null_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new NullLiteralAbstractSyntaxNode(concreteSyntaxNode);
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
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
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
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'binary_integer_literal':
                return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'decimal_integer_literal':
                return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'hexadecimal_integer_literal':
                return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'octal_integer_literal':
                return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): BinaryIntegerLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'binary_integer_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new BinaryIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): DecimalIntegerLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'decimal_integer_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new DecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): HexadecimalIntegerLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'hexadecimal_integer_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new HexadecimalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): OctalIntegerLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'octal_integer_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new OctalIntegerLiteralAbstractSyntaxNode(concreteSyntaxNode);
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
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'double_quoted_string_literal':
                return new DoubleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            case 'single_quoted_string_literal':
                return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): DoubleQuotedStringLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'double_quoted_string_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new DoubleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): SingleQuotedStringLiteralAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'single_quoted_string_literal')
            throw new Error(concreteSyntaxNode.type)
        else
            return new SingleQuotedStringLiteralAbstractSyntaxNode(concreteSyntaxNode);
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

export class ArrayConstructorAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #elements?: ElementAbstractSyntaxNode[];

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitArrayConstructor(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ArrayConstructorAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'array_constructor')
            throw new Error(concreteSyntaxNode.type)
        else
            return new ArrayConstructorAbstractSyntaxNode(concreteSyntaxNode);
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

export class ObjectConstructorAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #elements?: ElementAbstractSyntaxNode[];

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitObjectConstructor(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ObjectConstructorAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'object_constructor')
            throw new Error(concreteSyntaxNode.type)
        else
            return new ObjectConstructorAbstractSyntaxNode(concreteSyntaxNode);
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
        if (concreteSyntaxNode == null)
            return undefined;
        switch (concreteSyntaxNode.type) {
            case 'keyed_element':
                return new KeyedElementAbstractSyntaxNode(concreteSyntaxNode);
            case 'unkeyed_element':
                return new UnkeyedElementAbstractSyntaxNode(concreteSyntaxNode);
            default:
                throw new Error(concreteSyntaxNode.type)
        }
    }

    protected abstract override process(): void;

    abstract get value(): ExpressionAbstractSyntaxNode | undefined;

}

export class KeyedElementAbstractSyntaxNode extends ElementAbstractSyntaxNode {

    #key?: SingleExpressionAbstractSyntaxNode;
    #value?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitKeyedElement(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): KeyedElementAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'keyed_element')
            throw new Error(concreteSyntaxNode.type)
        else
            return new KeyedElementAbstractSyntaxNode(concreteSyntaxNode);
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

        this.#key = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'key'));
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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): UnkeyedElementAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'unkeyed_element')
            throw new Error(concreteSyntaxNode.type)
        else
            return new UnkeyedElementAbstractSyntaxNode(concreteSyntaxNode);
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

export class ParenthesizedExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #expression?: ExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitParenthesizedExpression(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ParenthesizedExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'parenthesized_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new ParenthesizedExpressionAbstractSyntaxNode(concreteSyntaxNode);
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

export class QuantifiedExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #condition?: SingleExpressionAbstractSyntaxNode;
    #predicate?: SingleExpressionAbstractSyntaxNode;
    #quantifierClauses?: QuantifiedClauseAbstractSyntaxNode[];

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitQuantifiedExpression(this, ...args);
    }

    get condition(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#condition;
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): QuantifiedExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'quantified_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new QuantifiedExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    get predicate(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#predicate;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'quantified_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#condition = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'condition'));
        this.#predicate = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'predicate'));

        this.#quantifierClauses = [];
        for (const child of childrenForFieldName(this.concreteSyntaxNode, 'quantifierClause')) {
            const quantifierClause = QuantifiedClauseAbstractSyntaxNode.construct(child);
            if (quantifierClause != null)
                this.#quantifierClauses.push(quantifierClause);
        }

        this.processed = true;

    }

    get quantifierClauses(): QuantifiedClauseAbstractSyntaxNode[] | undefined {
        this.process();
        return this.#quantifierClauses;
    }

}

export class QuantifiedClauseAbstractSyntaxNode extends ModelScriptAbstractSyntaxNode {

    #type?: QuantifierType;
    #quantifiers?: QuantifierAbstractSyntaxNode[];

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitQuantifierClause(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): QuantifiedClauseAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'quantified_clause')
            throw new Error(concreteSyntaxNode.type)
        else
            return new QuantifiedClauseAbstractSyntaxNode(concreteSyntaxNode);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'quantified_clause')
            throw new Error(this.concreteSyntaxNode.type);

        this.#quantifiers = [];
        for (const child of childrenForFieldName(this.concreteSyntaxNode, 'quantifier')) {
            const quantifier = QuantifierAbstractSyntaxNode.construct(child);
            if (quantifier != null)
                this.#quantifiers.push(quantifier);
        }

        switch (childForFieldName(this.concreteSyntaxNode, 'type')?.text) {
            case 'every':
                this.#type = QuantifierType.EVERY;
                break;
            case 'some':
                this.#type = QuantifierType.SOME;
                break;
        }

        this.processed = true;

    }

    get quantifiers(): QuantifierAbstractSyntaxNode[] | undefined {
        this.process();
        return this.#quantifiers;
    }


    get type(): QuantifierType | undefined {
        this.process();
        return this.#type;
    }

}

export class QuantifierAbstractSyntaxNode extends ModelScriptAbstractSyntaxNode {

    #context?: SingleExpressionAbstractSyntaxNode;
    #name?: NameAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitQuantifier(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): QuantifierAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'quantifier')
            throw new Error(concreteSyntaxNode.type)
        else
            return new QuantifierAbstractSyntaxNode(concreteSyntaxNode);
    }

    get context(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#context;
    }

    get name(): NameAbstractSyntaxNode | undefined {
        this.process();
        return this.#name;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'quantifier')
            throw new Error(this.concreteSyntaxNode.type);

        this.#context = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'context'));
        this.#name = NameAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'name'));

        this.processed = true;

    }

}

export class SubscriptExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #expression?: SingleExpressionAbstractSyntaxNode;
    #subscript?: SingleExpressionAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitSubscriptExpression(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): SubscriptExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'subscript_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new SubscriptExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    get expression(): SingleExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#expression;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'subscript_expression')
            throw new Error(this.concreteSyntaxNode.type);

        this.#expression = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'expression'));
        this.#subscript = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'subscript'));

        this.processed = true;

    }

    get subscript(): ExpressionAbstractSyntaxNode | undefined {
        this.process();
        return this.#subscript;
    }

}

export class UnaryExpressionAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #operand?: SingleExpressionAbstractSyntaxNode;
    #operator?: UnaryOperator;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitUnaryExpression(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): UnaryExpressionAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'unary_expression')
            throw new Error(concreteSyntaxNode.type)
        else
            return new UnaryExpressionAbstractSyntaxNode(concreteSyntaxNode);
    }

    get operand(): SingleExpressionAbstractSyntaxNode | undefined {
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

        this.#operand = SingleExpressionAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'operand'));

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

export class VariableAbstractSyntaxNode extends SingleExpressionAbstractSyntaxNode {

    #name?: NameAbstractSyntaxNode;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitVariable(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): VariableAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'variable')
            throw new Error(concreteSyntaxNode.type)
        else
            return new VariableAbstractSyntaxNode(concreteSyntaxNode);
    }

    get name(): NameAbstractSyntaxNode | undefined {
        this.process();
        return this.#name;
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'variable')
            throw new Error(this.concreteSyntaxNode.type);

        this.#name = NameAbstractSyntaxNode.construct(childForFieldName(this.concreteSyntaxNode, 'name'));

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

    static override construct(concreteSyntaxNode?: SyntaxNode | null): ModuleAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'module')
            throw new Error(concreteSyntaxNode.type)
        else
            return new ModuleAbstractSyntaxNode(concreteSyntaxNode);
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

export class NameAbstractSyntaxNode extends ModelScriptAbstractSyntaxNode {

    #value?: string;

    constructor(concreteSyntaxNode: SyntaxNode) {
        super(concreteSyntaxNode);
    }

    override accept(visitor: ModelScriptAbstractSyntaxVisitor, ...args: any[]): any {
        return visitor.visitName(this, ...args);
    }

    static override construct(concreteSyntaxNode?: SyntaxNode | null): NameAbstractSyntaxNode | undefined {
        if (concreteSyntaxNode == null)
            return undefined;
        else if (concreteSyntaxNode.type != 'name')
            throw new Error(concreteSyntaxNode.type)
        else
            return new NameAbstractSyntaxNode(concreteSyntaxNode);
    }

    protected override process(): void {

        if (this.processed == true || this.concreteSyntaxNode == null)
            return;

        if (this.concreteSyntaxNode.type != 'name')
            throw new Error(this.concreteSyntaxNode.type);

        this.#value = this.concreteSyntaxNode.text;

        this.processed = true;

    }

    get value(): string | undefined {
        this.process();
        return this.#value;
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

    visitContextItemExpression(node: ContextItemExpressionAbstractSyntaxNode, ...args: any[]): any {
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

    visitName(node: NameAbstractSyntaxNode, ...args: any[]): any {
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

    visitQuantifiedExpression(node: QuantifiedExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitQuantifierClause(node: QuantifiedClauseAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitQuantifier(node: QuantifierAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitParenthesizedExpression(node: ParenthesizedExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitRelationExpression(node: RelationExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitSingleQuotedStringLiteral(node: SingleQuotedStringLiteralAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitSubscriptExpression(node: SubscriptExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitUnkeyedElement(node: UnkeyedElementAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitUnaryExpression(node: UnaryExpressionAbstractSyntaxNode, ...args: any[]): any {
        throw new Error();
    }

    visitVariable(node: VariableAbstractSyntaxNode, ...args: any[]): any {
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

export enum QuantifierType {
    EVERY,
    SOME
}

export enum UnaryOperator {
    BITWISE_NOT,
    LOGICAL_NOT,
    UNARY_NEGATION,
    UNARY_PLUS
}