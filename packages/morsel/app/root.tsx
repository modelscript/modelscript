// SPDX-License-Identifier: AGPL-3.0-or-later

import { Links, Meta, Outlet, Scripts, ScrollRestoration, useNavigate } from "react-router";
import { BaseStyles, ThemeProvider } from "@primer/react";
import { useEffect } from "react";

import "@primer/css/dist/primer.css";
import "@primer/primitives/dist/css/functional/themes/light.css";
import "./app.css";

export function Layout({ children }: { children: React.ReactNode }) {
  return (
    <html lang="en">
      <head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
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
