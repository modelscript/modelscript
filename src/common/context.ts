import { Quad, Term } from '@rdfjs/types';
import dataFactory from '@rdfjs/data-model'
import datasetFactory from '@rdfjs/dataset';
import DatasetCore from '@rdfjs/dataset/DatasetCore';

export abstract class ModelScriptContext {

    #dataset: DatasetCore<Quad>;
    #symbols: Map<string, any>;

    constructor() {
        this.#dataset = datasetFactory.dataset();
        this.#symbols = new Map<string, any>();
    }

    blankNode(value?: string) {
        return dataFactory.blankNode(value);
    }

    delete(subject: any, predicate: any, object: any, graph: any) {
        this.#dataset.delete(dataFactory.quad(subject, predicate, object, graph));
    }

    abstract eval(input: string): any;

    get(key: string): any {
        return this.#symbols.get(key);
    }

    insert(subject: any, predicate: any, object: any, graph?: any) {
        this.#dataset.add(dataFactory.quad(subject, predicate, object, graph));
    }

    match(subject: any, predicate: any, object: any, graph: any): DatasetCore<Quad> {
        return this.#dataset.match(subject, predicate, object, graph);
    }

    namedNode(value: string) {
        return dataFactory.namedNode(value);
    }

    set(key: string, value: any): void {
        this.#symbols.set(key, value);
    } 

}