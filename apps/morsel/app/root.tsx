// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, ThemeProvider } from "@primer/react";
import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigate } from "react-router";

import "@primer/css/dist/primer.css";
import "@primer/primitives/dist/css/functional/themes/dark.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en" suppressHydrationWarning>
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta httpEquiv="Cache-Control" content="no-cache, no-store, must-revalidate" />
        <meta httpEquiv="Pragma" content="no-cache" />
        <meta httpEquiv="Expires" content="0" />
        <Meta />
        <Links />
      </head>
      <body>
        <div
          id="morsel-initial-loader"
          style={{
            position: "fixed",
            inset: 0,
            display: "flex",
            flexDirection: "column",
            alignItems: "center",
            justifyContent: "center",
            gap: "16px",
            zIndex: 9999,
            backgroundColor: "var(--bgColor-default, #0d1117)",
            color: "var(--fgColor-muted, #8b949e)",
            fontFamily: "-apple-system, BlinkMacSystemFont, 'Segoe UI', Helvetica, Arial, sans-serif",
            fontSize: "14px",
          }}
        >
          <div
            style={{
              width: "32px",
              height: "32px",
              border: "3px solid rgba(125, 133, 144, 0.3)",
              borderTopColor: "#58a6ff",
              borderRadius: "50%",
              animation: "morsel-loader-spin 0.8s linear infinite",
            }}
          />
          <span>Loading Morsel…</span>
        </div>
        <style
          dangerouslySetInnerHTML={{
            __html: `
          @keyframes morsel-loader-spin { to { transform: rotate(360deg); } }
          @media (prefers-color-scheme: light) {
            #morsel-initial-loader { background-color: #ffffff !important; color: #57606a !important; }
            #morsel-initial-loader > div:first-child { border-top-color: #0969da !important; }
          }
        `,
          }}
        />
        <script
          dangerouslySetInnerHTML={{
            __html: `
          // Remove loader once React renders content
          (function() {
            var loader = document.getElementById('morsel-initial-loader');
            if (!loader) return;
            var observer = new MutationObserver(function() {
              if (document.getElementById('morsel-app-loader')) {
                loader.remove();
                observer.disconnect();
              }
            });
            observer.observe(document.body, { childList: true, subtree: true });
            // Fallback: remove after 15s in case observer never fires
            setTimeout(function() { if (loader.parentNode) loader.remove(); }, 15000);
          })();
        `,
          }}
        />
        {children}
        <ScrollRestoration />
        <Scripts />
      </body>
    </html>
  );
}

export default function App() {
  return (
    <ThemeProvider>
      <BaseStyles>
        <Outlet />
      </BaseStyles>
    </ThemeProvider>
  );
}

export function ErrorBoundary() {
  const navigate = useNavigate();
  useEffect(() => {
    navigate("/");
  }, []);
}
