import puppeteer from "puppeteer";

async function main() {
  console.log("Launching puppeteer...");
  const browser = await puppeteer.launch({
    headless: true,
    args: ["--no-sandbox", "--disable-setuid-sandbox"],
  });
  const page = await browser.newPage();
  await page.setViewport({ width: 1600, height: 1200 });

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

  console.log("Waiting 10 seconds for MSL loading...");
  await new Promise((resolve) => setTimeout(resolve, 10000));

  // Collapse bouncing-ball pane and expand Modelica Library pane
  await page.evaluate(() => {
    const panes = Array.from(document.querySelectorAll(".pane"));
    const bbPane = panes.find((p) =>
      p.querySelector(".pane-header")?.textContent?.toLowerCase().includes("bouncing-ball"),
    );
    if (bbPane) {
      const header = bbPane.querySelector(".pane-header") as HTMLElement | null;
      const isExpanded = header?.getAttribute("aria-expanded") === "true" || bbPane.classList.contains("expanded");
      if (isExpanded && header) {
        header.click();
      }
    }
    const libPane = panes.find((p) =>
      p.querySelector(".pane-header")?.textContent?.toLowerCase().includes("modelica library"),
    );
    if (libPane) {
      const header = libPane.querySelector(".pane-header") as HTMLElement | null;
      const isCollapsed = header?.getAttribute("aria-expanded") === "false" || !libPane.classList.contains("expanded");
      console.log(`Modelica Library isCollapsed: ${isCollapsed}`);
      if (isCollapsed && header) {
        header.click();
      }
    }
  });

  await new Promise((resolve) => setTimeout(resolve, 3000));

  // Helper to wait for row and click twistie using real CDP mouse events + virtual scroll
  const waitAndClickTwistie = async (text: string, excludeText?: string, timeoutMs = 25000) => {
    console.log(`Waiting for row matching '${text}' (exclude: ${excludeText ?? "none"})...`);
    const startTime = Date.now();
    let scrollDirection = 1;
    let scrollAttempts = 0;

    while (Date.now() - startTime < timeoutMs) {
      const rowHandle = await page.evaluateHandle(
        (search, exclude) => {
          const rows = Array.from(document.querySelectorAll(".monaco-tl-row"));
          return rows.find((r) => {
            const t = r.textContent?.trim() || "";
            if (exclude && t.includes(exclude)) return false;
            return t.includes(search);
          });
        },
        text,
        excludeText,
      );

      const rowElement = rowHandle.asElement();
      if (rowElement) {
        const rowInfo = await page.evaluate((el) => {
          const text = el.textContent?.trim();
          const isExpanded = el.getAttribute("aria-expanded") === "true";
          const twistie = el.querySelector(".monaco-tl-twistie") as HTMLElement | null;
          const twistieClass = twistie?.className || "";
          el.scrollIntoView({ block: "center" });
          return { text, isExpanded, twistieClass };
        }, rowElement);

        console.log(
          `Found row '${rowInfo.text}', isExpanded=${rowInfo.isExpanded}, twistieClass=${rowInfo.twistieClass}`,
        );

        if (rowInfo.isExpanded) {
          console.log(`Row '${rowInfo.text}' is already expanded.`);
          return true;
        }

        const twistie = await rowElement.$(".monaco-tl-twistie");
        if (twistie) {
          console.log(`Clicking twistie for '${rowInfo.text}' with Puppeteer CDP mouse...`);
          await twistie.click();
        } else {
          console.log(`No twistie for '${rowInfo.text}', clicking row...`);
          await rowElement.click();
        }
        return true;
      }

      // Scroll the library tree container down to render virtualized rows
      await page.evaluate((dir) => {
        const panes = Array.from(document.querySelectorAll(".pane"));
        const libPane = panes.find((p) =>
          p.querySelector(".pane-header")?.textContent?.toLowerCase().includes("modelica library"),
        );
        const scrollable = libPane?.querySelector(".monaco-scrollable-element") as HTMLElement | null;
        if (scrollable) {
          scrollable.scrollTop += dir * 150;
          scrollable.dispatchEvent(new Event("scroll"));
        }
      }, scrollDirection);

      scrollAttempts++;
      if (scrollAttempts % 8 === 0) {
        scrollDirection = -scrollDirection;
      }

      await new Promise((r) => setTimeout(r, 400));
    }
    const currentRows = await page.$$eval(".monaco-tl-row", (rows) => rows.map((r) => r.textContent?.trim()));
    console.warn(`Timeout waiting for row '${text}'. Current rows in tree:`, currentRows);
    return false;
  };

  try {
    // 1. Click Modelica Standard Library
    await waitAndClickTwistie("Modelica Standard Library");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 2. Click Modelica package
    await waitAndClickTwistie("Modelica", "Standard");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 3. Click Electrical
    await waitAndClickTwistie("Electrical");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 4. Click Analog
    await waitAndClickTwistie("Analog");
    await new Promise((resolve) => setTimeout(resolve, 3000));

    // 5. Click Basic
    await waitAndClickTwistie("Basic");
    console.log("Waiting for 'Resistor' to appear in tree via scrolling...");
    const foundResistor = await waitAndClickTwistie("Resistor", undefined, 20000);
    console.log("Resistor found in tree:", foundResistor);

    console.log("Waiting 6 seconds for Basic component icons to fetch and render...");
    await new Promise((resolve) => setTimeout(resolve, 6000));

    // Scroll Basic into view
    await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".monaco-tl-row"));
      const rRow =
        rows.find((r) => r.textContent?.includes("Resistor")) || rows.find((r) => r.textContent?.includes("Basic"));
      rRow?.scrollIntoView({ block: "start" });
    });
    await new Promise((resolve) => setTimeout(resolve, 1000));

    const resistorHtml = await page.evaluate(() => {
      const rows = Array.from(document.querySelectorAll(".monaco-tl-row"));
      const rRow = rows.find((r) => r.textContent?.includes("Resistor"));
      return rRow?.outerHTML;
    });
    console.log("Resistor row HTML:", resistorHtml);

    const finalItems = await page.$$eval(".monaco-tl-row", (rows) =>
      rows.map((r) => {
        const icon = r.querySelector(".custom-icon, .codicon, .custom-view-tree-node-item-icon") as HTMLElement | null;
        const img = r.querySelector("img") as HTMLImageElement | null;
        return {
          text: r.textContent?.trim(),
          iconClass: icon?.className,
          iconStyle: icon?.getAttribute("style"),
          imgSrc: img?.src?.slice(0, 50),
        };
      }),
    );
    console.log("Final items and icons:", JSON.stringify(finalItems, null, 2));

    await page.screenshot({ path: "languages/modelica/tests/library_tree_icons.png" });
    console.log("Saved screenshot to languages/modelica/tests/library_tree_icons.png");
  } finally {
    await browser.close();
  }
  console.log("Done.");
}

main().catch(console.error);
