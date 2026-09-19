import puppeteer from "puppeteer";

async function main() {
  console.log("Launching puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();

  page.on("console", (msg) => {
    console.log(`[BROWSER CONSOLE] ${msg.type()}: ${msg.text()}`);
  });

  page.on("pageerror", (err) => {
    console.error(`[BROWSER PAGEERROR]`, err);
  });

  browser.on("targetcreated", async (target) => {
    console.log(`[TARGET CREATED] ${target.type()} ${target.url()}`);
    try {
      const session = await target.createCDPSession();
      await session.send("Runtime.enable");
      session.on("Runtime.consoleAPICalled", (event: any) => {
        const text = event.args.map((a: any) => a.value ?? a.description ?? JSON.stringify(a)).join(" ");
        console.log(`[CDP ${target.type()} CONSOLE] ${event.type}: ${text}`);
      });
      session.on("Runtime.exceptionThrown", (event: any) => {
        console.error(
          `[CDP ${target.type()} EXCEPTION]`,
          event.exceptionDetails.text,
          event.exceptionDetails.exception?.description,
        );
      });
    } catch (e: any) {
      // Ignore targets that cannot create CDP session
    }
  });

  console.log("Navigating to workbench...");
  await page.goto("http://localhost:3003/vscode/workbench/#memfs:bouncing-ball", {
    waitUntil: "domcontentloaded",
  });

  console.log("Waiting 12 seconds for LSP initialization and logs...");
  await new Promise((resolve) => setTimeout(resolve, 12000));

  await browser.close();
  console.log("Done.");
}

main().catch(console.error);
