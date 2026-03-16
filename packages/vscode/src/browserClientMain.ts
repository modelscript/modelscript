import { ExtensionContext, Uri } from "vscode";
import { LanguageClientOptions } from "vscode-languageclient";
import { LanguageClient } from "vscode-languageclient/browser";

let client: LanguageClient | undefined;

export async function activate(context: ExtensionContext) {
  console.log("ModelScript extension activated");

  const documentSelector = [{ language: "modelica" }];

  // Options to control the language client
  const clientOptions: LanguageClientOptions = {
    documentSelector,
    synchronize: {},
    initializationOptions: {},
  };

  client = createWorkerLanguageClient(context, clientOptions);

  await client.start();
  console.log("ModelScript language server is ready");
}

export async function deactivate(): Promise<void> {
  if (client !== undefined) {
    await client.stop();
  }
}

function createWorkerLanguageClient(context: ExtensionContext, clientOptions: LanguageClientOptions) {
  // The server bundle is built into server/dist/ by webpack
  const serverMain = Uri.joinPath(context.extensionUri, "server", "dist", "browserServerMain.js");
  const worker = new Worker(serverMain.toString(true));

  return new LanguageClient("modelscript", "ModelScript Language Server", clientOptions, worker);
}
