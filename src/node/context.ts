import Parser from 'tree-sitter';
import ModelScript from '@modelscript/tree-sitter-modelscript';

import { ModelScriptAbstractSyntaxNode } from '../common/syntax.js';
import { ModelScriptInterpreter } from '../common/interpreter.js';
import { ModelScriptContext } from '../common/context.js';

export class ModelScriptNodeContext extends ModelScriptContext {

    #parser: Parser;

    constructor() {
        super();
        this.#parser = new Parser();
        this.#parser.setLanguage(ModelScript);
    }

    override eval(input: string): any {

        const concreteSyntaxNode = this.#parser.parse(input)?.rootNode;

        if (concreteSyntaxNode == null)
            return null;

        const abstractSyntaxNode = ModelScriptAbstractSyntaxNode.construct(concreteSyntaxNode);

        if (abstractSyntaxNode == null)
            return null;

        return abstractSyntaxNode.accept(new ModelScriptInterpreter(this));

    }

}