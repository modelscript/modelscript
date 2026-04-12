import { BaseStyles, ThemeProvider } from "@primer/react";
import { createContext, useContext, useEffect, useState } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration } from "react-router";

import "./app.css";

function getInitialColorMode(): "day" | "night" {
  if (typeof window !== "undefined") {
    const stored = localStorage.getItem("ms-theme");
    if (stored === "day" || stored === "night") return stored;
    return window.matchMedia("(prefers-color-scheme: light)").matches ? "day" : "night";
  }
  return "night";
}

export const ThemeContext = createContext<{
  colorMode: "day" | "night";
  setColorMode: (mode: "day" | "night") => void;
}>({
  colorMode: "night",
  // eslint-disable-next-line @typescript-eslint/no-empty-function
  setColorMode: () => {},
});

export function useColorMode() {
  return useContext(ThemeContext);
}

export function Layout({ children }: { children: React.ReactNode }) {
  const [colorMode, setColorMode] = useState<"day" | "night">(getInitialColorMode);

  useEffect(() => {
    document.documentElement.setAttribute("data-color-mode", colorMode === "day" ? "light" : "dark");
    document.documentElement.setAttribute("data-dark-theme", "dark");
    document.documentElement.setAttribute("data-light-theme", "light");
    localStorage.setItem("ms-theme", colorMode);
  }, [colorMode]);

  return (
    <html
      lang="en"
      data-color-mode={colorMode === "day" ? "light" : "dark"}
      data-dark-theme="dark"
      data-light-theme="light"
    >
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />

        {/* Primary SEO */}
        <title>ModelScript — Open-Source Modelica Compiler, Simulator & IDE</title>
        <meta
          name="description"
          content="ModelScript is a free, open-source Modelica toolchain. Parse, lint, flatten, simulate, optimize, and render Modelica models in the browser or on the command line. Includes VS Code extension, CLI, and Docker images."
        />
        <meta
          name="keywords"
          content="Modelica, simulation, modeling, open-source, compiler, DAE, ODE, tree-sitter, VS Code, ModelScript, systems engineering, differential equations, Modelica Standard Library, MSL"
        />
        <meta name="author" content="Mohamad Omar Nachawati" />
        <link rel="canonical" href="https://modelscript.org" />

        {/* Open Graph */}
        <meta property="og:title" content="ModelScript — Open-Source Modelica Toolchain" />
        <meta
          property="og:description"
          content="Parse, lint, flatten, simulate, and render Modelica models — in the browser or on the command line. Free and open-source."
        />
        <meta property="og:type" content="website" />
        <meta property="og:url" content="https://modelscript.org" />
        <meta property="og:site_name" content="ModelScript" />
        <meta property="og:locale" content="en_US" />

        {/* Twitter Card */}
        <meta name="twitter:card" content="summary_large_image" />
        <meta name="twitter:title" content="ModelScript — Open-Source Modelica Toolchain" />
        <meta
          name="twitter:description"
          content="Parse, lint, flatten, simulate, and render Modelica models — in the browser or on the command line."
        />

        {/* Robots */}
        <meta name="robots" content="index, follow" />
        <meta name="googlebot" content="index, follow, max-snippet:-1, max-image-preview:large" />

        {/* Theme */}
        <meta name="theme-color" content="#0d1117" media="(prefers-color-scheme: dark)" />
        <meta name="theme-color" content="#ffffff" media="(prefers-color-scheme: light)" />

        {/* Structured Data (JSON-LD) */}
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{
            __html: JSON.stringify({
              "@context": "https://schema.org",
              "@type": "SoftwareApplication",
              name: "ModelScript",
              applicationCategory: "DeveloperApplication",
              operatingSystem: "Windows, macOS, Linux",
              url: "https://modelscript.org",
              description:
                "Open-source Modelica compiler, simulator, and IDE. Parse, lint, flatten, simulate, optimize, and render Modelica models.",
              license: "https://www.gnu.org/licenses/agpl-3.0.html",
              author: {
                "@type": "Person",
                name: "Mohamad Omar Nachawati",
                email: "mnachawa@gmail.com",
              },
              offers: {
                "@type": "Offer",
                price: "0",
                priceCurrency: "USD",
              },
              codeRepository: "https://github.com/modelscript/modelscript",
            }),
          }}
        />

        <Meta />
        <Links />
      </head>
      <body>
        <ThemeProvider colorMode={colorMode} preventSSRMismatch>
          <BaseStyles>
            <ThemeContext.Provider value={{ colorMode, setColorMode }}>{children}</ThemeContext.Provider>
          </BaseStyles>
        </ThemeProvider>
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return <Outlet />;
}
