import puppeteer from "puppeteer";

async function run() {
  const browser = await puppeteer.launch({
    headless: "new",
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });

  const page = await browser.newPage();

  page.on("console", (msg) => {
    console.log(`[BROWSER CONSOLE ${msg.type()}]:`, msg.text());
  });

  page.on("pageerror", (err) => {
    console.error("[BROWSER PAGE ERROR]:", err);
  });

  console.log("Navigating to http://localhost:3002...");
  await page.goto("http://localhost:3002", { waitUntil: "networkidle2" });

  console.log("Waiting for compilation to finish...");
  await page.waitForFunction(
    () => {
      const el = document.getElementById("status");
      return el && el.textContent && el.textContent.includes("Compiled successfully");
    },
    { timeout: 30000 },
  );

  console.log("Compilation finished! Waiting 1s...");
  await new Promise((r) => setTimeout(r, 1000));

  console.log("Clicking 2D Diagram tab...");
  await page.evaluate(() => {
    const btns = Array.from(document.querySelectorAll("button"));
    const diagramBtn = btns.find((b) => b.textContent.includes("2D Diagram"));
    if (diagramBtn) diagramBtn.click();
    else console.error("Could not find 2D Diagram button");
  });

  await new Promise((r) => setTimeout(r, 2000));

  const state = await page.evaluate(() => {
    const rawData = window.__latestDiagramData || { nodes: [], edges: [] };
    const syntaxNames = window.syntaxNames || [];
    return {
      nodes: rawData.nodes.map((n) => ({
        id: n.id,
        ruleName: syntaxNames[n.typeId] || "Unknown",
        typeId: n.typeId,
        startByte: n.startByte,
        endByte: n.endByte,
        text: n.text,
      })),
    };
  });

  console.log("=== RAW DIAGRAM NODES ===");
  console.log(JSON.stringify(state.nodes, null, 2));
  await page.evaluate(() => {
    const Diagram = window.DiagramModule;
    const g = Diagram && Diagram.getGraph ? Diagram.getGraph() : null;
    if (g) {
      const nodes = g.getNodes();
      if (nodes.length > 0) {
        // trigger move event
        nodes[0].translate(30, 30);
      }
    }
  });

  await new Promise((r) => setTimeout(r, 1000));

  const codeAfterMove = await page.evaluate(() => {
    return window.codeEditor ? window.codeEditor.getValue() : "";
  });

  console.log("Code after moving node (first 100 chars):", JSON.stringify(codeAfterMove.slice(0, 100)));
  const hasNullBytes = codeAfterMove.includes("\0");
  console.log("Code corrupted with null bytes?:", hasNullBytes);

  console.log("Taking screenshot...");
  await page.screenshot({ path: "/home/omar/git3/modelscript/packages/diagram/scripts/diagram-screenshot.png" });
  console.log("Screenshot saved to packages/diagram/scripts/diagram-screenshot.png");

  await browser.close();
}

run().catch(console.error);
