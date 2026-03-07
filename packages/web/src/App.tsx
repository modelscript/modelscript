import { MoonIcon, SearchIcon, SunIcon } from "@primer/octicons-react";
import { BaseStyles, Header, Text, ThemeProvider } from "@primer/react";
import React, { useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import Box from "./components/Box";
import ClassDetailPage from "./pages/ClassDetailPage";
import LandingPage from "./pages/LandingPage";
import LibraryDetailPage from "./pages/LibraryDetailPage";
import LibraryListPage from "./pages/LibraryListPage";
import LibraryVersionPage from "./pages/LibraryVersionPage";
import { ThemeContextProvider, useTheme } from "./theme";

const HeaderInner = styled.div`
  max-width: 1280px;
  width: 100%;
  margin: 0 auto;
  display: flex;
  align-items: center;
  padding: 0 40px;
  box-sizing: border-box;
`;

const SearchWrapper = styled.div`
  position: relative;
  width: 100%;
  max-width: 480px;

  input {
    width: 100%;
    height: 36px;
    padding: 0 36px 0 12px;
    background: var(--color-search-bg);
    border: 1px solid var(--color-search-border);
    border-radius: 6px;
    color: var(--color-text-primary);
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;

    &::placeholder {
      color: var(--color-text-tertiary);
    }

    &:focus {
      border-color: var(--color-search-focus);
    }
  }

  .search-icon {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: var(--color-text-tertiary);
    pointer-events: none;
    display: flex;
    align-items: center;
  }
`;

const ThemeToggle = styled.button`
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 36px;
  border-radius: 8px;
  border: 1px solid var(--color-border);
  background: var(--color-glass-bg);
  color: var(--color-toggle-icon);
  cursor: pointer;
  transition: all 0.2s ease;

  &:hover {
    background: var(--color-glass-bg-hover);
    border-color: var(--color-border-strong);
    color: var(--color-text-heading);
  }
`;

const GlobalHeader: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const navigate = useNavigate();
  const location = useLocation();
  const { theme, toggleTheme } = useTheme();

  // Keep input in sync with URL when on /libraries (URL is source of truth there)
  const urlQuery = searchParams.get("q") || "";
  const displayQuery = location.pathname === "/libraries" ? urlQuery : query;

  const handleSearch = (e: React.FormEvent) => {
    e.preventDefault();
    const q = query.trim();
    if (q) {
      navigate(`/libraries?q=${encodeURIComponent(q)}`);
    } else {
      navigate("/libraries");
    }
  };

  // Live-update URL when typing and already on /libraries
  const handleChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const val = e.target.value;
    setQuery(val);
    if (location.pathname === "/libraries") {
      const q = val.trim();
      if (q) {
        navigate(`/libraries?q=${encodeURIComponent(q)}`, { replace: true });
      } else {
        navigate("/libraries", { replace: true });
      }
    }
  };

  return (
    <Header
      style={{
        backgroundColor: "var(--color-bg-primary)",
        borderBottom: "1px solid var(--color-border)",
        color: "var(--color-text-primary)",
        zIndex: 100,
        padding: "12px 0",
        transition: "background-color 0.3s ease",
      }}
    >
      <HeaderInner>
        <Header.Item>
          <Header.Link as={Link} to="/" style={{ display: "flex", alignItems: "center" }}>
            <img
              src={theme === "dark" ? "/ms-logo-light.png" : "/ms-logo.png"}
              alt="ModelScript"
              style={{ width: 36, height: 36 }}
            />
          </Header.Link>
        </Header.Item>
        <Header.Item full>
          <form onSubmit={handleSearch} style={{ width: "100%", maxWidth: "480px" }}>
            <SearchWrapper>
              <input type="text" placeholder="Search libraries…" value={displayQuery} onChange={handleChange} />
              <span className="search-icon">
                <SearchIcon size={16} />
              </span>
            </SearchWrapper>
          </form>
        </Header.Item>
        <Header.Item>
          <Header.Link as={Link} to="/libraries" style={{ color: "var(--color-text-muted)" }}>
            Libraries
          </Header.Link>
        </Header.Item>
        <Header.Item>
          <ThemeToggle
            onClick={toggleTheme}
            aria-label="Toggle theme"
            title={theme === "dark" ? "Switch to light mode" : "Switch to dark mode"}
          >
            {theme === "dark" ? <SunIcon size={16} /> : <MoonIcon size={16} />}
          </ThemeToggle>
        </Header.Item>
      </HeaderInner>
    </Header>
  );
};

function App() {
  const { theme } = useTheme();

  return (
    <ThemeProvider colorMode={theme === "dark" ? "night" : "day"}>
      <BaseStyles style={{ backgroundColor: "var(--color-bg-primary)", transition: "background-color 0.3s ease" }}>
        <BrowserRouter>
          <div
            style={{
              display: "flex",
              flexDirection: "column",
              minHeight: "100vh",
              backgroundColor: "var(--color-bg-primary)",
              transition: "background-color 0.3s ease",
            }}
          >
            <GlobalHeader />

            <Box
              flex={1}
              display="flex"
              flexDirection="column"
              style={{ backgroundColor: "var(--color-bg-primary)", transition: "background-color 0.3s ease" }}
            >
              <Routes>
                <Route path="/" element={<LandingPage />} />
                <Route path="/libraries" element={<LibraryListPage />} />
                <Route path="/:name" element={<LibraryVersionPage />} />
                <Route path="/:name/:version" element={<LibraryDetailPage />} />
                <Route path="/:name/:version/classes/:className" element={<ClassDetailPage />} />
              </Routes>
            </Box>

            <Box
              as="footer"
              style={{
                padding: "24px 32px",
                borderTop: "1px solid var(--color-border)",
                backgroundColor: "var(--color-bg-primary)",
                transition: "background-color 0.3s ease",
              }}
              display="flex"
              justifyContent="center"
              alignItems="center"
              gap={4}
            >
              <Text style={{ color: "var(--color-text-muted)", fontSize: "14px" }}>
                © {new Date().getFullYear()} ModelScript
              </Text>
              <Link to="/terms" style={{ color: "var(--color-text-muted)", textDecoration: "none", fontSize: "14px" }}>
                Terms of Use
              </Link>
              <Link
                to="/privacy"
                style={{ color: "var(--color-text-muted)", textDecoration: "none", fontSize: "14px" }}
              >
                Privacy
              </Link>
              <a
                href="https://github.com/modelscript/modelscript"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "var(--color-text-muted)", textDecoration: "none", fontSize: "14px" }}
              >
                GitHub
              </a>
            </Box>
          </div>
        </BrowserRouter>
      </BaseStyles>
    </ThemeProvider>
  );
}

function AppWithTheme() {
  return (
    <ThemeContextProvider>
      <App />
    </ThemeContextProvider>
  );
}

export default AppWithTheme;
