import { SearchIcon } from "@primer/octicons-react";
import { BaseStyles, Header, Text, ThemeProvider } from "@primer/react";
import React, { useEffect, useState } from "react";
import { BrowserRouter, Link, Route, Routes, useLocation, useNavigate, useSearchParams } from "react-router-dom";
import styled from "styled-components";
import Box from "./components/Box";
import ClassDetailPage from "./pages/ClassDetailPage";
import LandingPage from "./pages/LandingPage";
import LibraryDetailPage from "./pages/LibraryDetailPage";
import LibraryListPage from "./pages/LibraryListPage";
import LibraryVersionPage from "./pages/LibraryVersionPage";

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
    background: rgba(255, 255, 255, 0.05);
    border: 1px solid rgba(255, 255, 255, 0.1);
    border-radius: 6px;
    color: #c9d1d9;
    font-size: 14px;
    outline: none;
    box-sizing: border-box;
    transition: border-color 0.2s;

    &::placeholder {
      color: #6e7681;
    }

    &:focus {
      border-color: rgba(88, 166, 255, 0.4);
    }
  }

  .search-icon {
    position: absolute;
    right: 10px;
    top: 50%;
    transform: translateY(-50%);
    color: #6e7681;
    pointer-events: none;
    display: flex;
    align-items: center;
  }
`;

const GlobalHeader: React.FC = () => {
  const [searchParams] = useSearchParams();
  const [query, setQuery] = useState(searchParams.get("q") || "");
  const navigate = useNavigate();
  const location = useLocation();

  // Sync input with URL q param when it changes externally
  useEffect(() => {
    setQuery(searchParams.get("q") || "");
  }, [searchParams]);

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
        backgroundColor: "#0d1117",
        borderBottom: "1px solid rgba(255,255,255,0.05)",
        color: "#c9d1d9",
        zIndex: 100,
        padding: "12px 0",
      }}
    >
      <HeaderInner>
        <Header.Item>
          <Header.Link as={Link} to="/" style={{ display: "flex", alignItems: "center" }}>
            <img src="/ms-logo-light.png" alt="ModelScript" style={{ width: 36, height: 36 }} />
          </Header.Link>
        </Header.Item>
        <Header.Item full>
          <form onSubmit={handleSearch} style={{ width: "100%", maxWidth: "480px" }}>
            <SearchWrapper>
              <input type="text" placeholder="Search libraries…" value={query} onChange={handleChange} />
              <span className="search-icon">
                <SearchIcon size={16} />
              </span>
            </SearchWrapper>
          </form>
        </Header.Item>
        <Header.Item>
          <Header.Link as={Link} to="/libraries" style={{ color: "#8b949e" }}>
            Libraries
          </Header.Link>
        </Header.Item>
      </HeaderInner>
    </Header>
  );
};

function App() {
  return (
    <ThemeProvider colorMode="night">
      <BaseStyles style={{ backgroundColor: "#0d1117" }}>
        <BrowserRouter>
          <div style={{ display: "flex", flexDirection: "column", minHeight: "100vh", backgroundColor: "#0d1117" }}>
            <GlobalHeader />

            <Box flex={1} display="flex" flexDirection="column" style={{ backgroundColor: "#0d1117" }}>
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
                borderTop: "1px solid rgba(255,255,255,0.05)",
                backgroundColor: "#0d1117",
              }}
              display="flex"
              justifyContent="center"
              alignItems="center"
              gap={4}
            >
              <Text style={{ color: "#8b949e", fontSize: "14px" }}>© {new Date().getFullYear()} ModelScript</Text>
              <Link to="/terms" style={{ color: "#8b949e", textDecoration: "none", fontSize: "14px" }}>
                Terms of Use
              </Link>
              <Link to="/privacy" style={{ color: "#8b949e", textDecoration: "none", fontSize: "14px" }}>
                Privacy
              </Link>
              <a
                href="https://github.com/modelscript/modelscript"
                target="_blank"
                rel="noopener noreferrer"
                style={{ color: "#8b949e", textDecoration: "none", fontSize: "14px" }}
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

export default App;
