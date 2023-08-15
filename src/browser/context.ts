import Parser from 'web-tree-sitter';

import { ModelScriptContext } from '../common/context.js';
import { ModelScriptInterpreter } from '../common/interpreter.js';
import { ModelScriptAbstractSyntaxNode } from '../common/syntax.js';

export class ModelScriptBrowserContext extends ModelScriptContext {

    static #language: Parser.Language;
    #parser: Parser;

    constructor() {
        super();
        this.#parser = new Parser();
        this.#parser.setLanguage(ModelScriptBrowserContext.#language);
    }

    public static async initialize(initializationOptions?: any): Promise<void> {
        
        await Parser.init({
            locateFile(scriptName: string, scriptDirectory: string) {
                return initializationOptions?.treeSitterWasm ?? scriptDirectory + '../node_modules/web-tree-sitter/tree-sitter.wasm';
            },
        });

        ModelScriptBrowserContext.#language = await Parser.Language.load(initializationOptions?.treeSitterModelScriptWasm ?? './node_modules/@modelscript/tree-sitter-modelscript/tree-sitter-modelscript.wasm');
        
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