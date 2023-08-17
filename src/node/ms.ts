#!/usr/bin/node
import fs from 'fs';
import yargs from 'yargs';
import { hideBin } from 'yargs/helpers';
import { ModelScriptNodeContext } from './context.js';

yargs(hideBin(process.argv))
    .scriptName('ms')
    .usage("Usage: $0 <file>")
    .command('$0 <file>', false, (yargs) => {
        yargs.positional('file', {
            type: 'string',
            describe: 'ModelScript file to run'
        })
    }, function (argv) {
        const input = fs.readFileSync(String(argv.file), { encoding: "utf8" });
        const context = new ModelScriptNodeContext();
        const result = context.eval(input);
        console.log(JSON.stringify(result, undefined, 4));
    })
    .demandCommand(1)
    .parse();