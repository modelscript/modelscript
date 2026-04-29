import initOpenCascade from "occt-import-js";

self.onmessage = async (event) => {
  const { uri, buffer } = event.data;

  try {
    // Initialize the WebAssembly module
    const occt = await initOpenCascade();

    // occt.ReadStepFile requires a Uint8Array
    const result = occt.ReadStepFile(buffer, null);

    self.postMessage({ type: "success", uri, result });
  } catch (error) {
    self.postMessage({ type: "error", uri, error: String(error) });
  }
};
