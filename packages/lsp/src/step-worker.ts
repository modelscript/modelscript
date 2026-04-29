import initOpenCascade from "occt-import-js";

self.onmessage = async (event) => {
  const { uri, buffer } = event.data;

  try {
    // Initialize the WebAssembly module
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const occt = await (initOpenCascade as any)();

    // occt.ReadStepFile requires a Uint8Array
    const result = occt.ReadStepFile(buffer, null);

    self.postMessage({ type: "success", uri, result });
  } catch (error) {
    self.postMessage({ type: "error", uri, error: String(error) });
  }
};
