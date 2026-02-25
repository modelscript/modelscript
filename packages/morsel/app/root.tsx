// SPDX-License-Identifier: AGPL-3.0-or-later

import { BaseStyles, ThemeProvider } from "@primer/react";
import { useEffect } from "react";
import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigate } from "react-router";

import "@primer/css/dist/primer.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
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
