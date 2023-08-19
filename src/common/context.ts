export abstract class ModelScriptContext {

    #symbols: Map<string, any>;

    constructor() {
        this.#symbols = new Map<string, any>();
    }

    abstract eval(input: string): any;

    get(key: string): any {
        return this.#symbols.get(key);
    }

    set(key: string, value: any): void {
        this.#symbols.set(key, value);
    } 

}