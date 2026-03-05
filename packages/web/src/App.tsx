import { BaseStyles, Header, ThemeProvider } from "@primer/react";
import { BrowserRouter, Link, Route, Routes } from "react-router-dom";
import ClassDetailPage from "./pages/ClassDetailPage";
import LibraryDetailPage from "./pages/LibraryDetailPage";
import LibraryListPage from "./pages/LibraryListPage";
import LibraryVersionPage from "./pages/LibraryVersionPage";

function App() {
  return (
    <ThemeProvider colorMode="auto">
      <BaseStyles>
        <BrowserRouter>
          <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh" }}>
            <Header>
              <Header.Item full>
                <Header.Link as={Link} to="/" style={{ fontSize: "20px" }}>
                  <span>ModelScript Library Explorer</span>
                </Header.Link>
              </Header.Item>
            </Header>

            <Routes>
              <Route path="/" element={<LibraryListPage />} />
              <Route path="/:name" element={<LibraryVersionPage />} />
              <Route path="/:name/:version" element={<LibraryDetailPage />} />
              <Route path="/:name/:version/classes/:className" element={<ClassDetailPage />} />
            </Routes>
          </div>
        </BrowserRouter>
      </BaseStyles>
    </ThemeProvider>
  );
}

export default App;
