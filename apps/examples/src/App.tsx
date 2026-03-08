import { useEffect } from "react";
import { Route, Routes, useLocation, useNavigate } from "react-router";

import examples from "./examples";
import ExamplePage from "./routes/example";
import LandingPage from "./routes/landing";

function OldHashRedirect() {
  const navigate = useNavigate();
  const location = useLocation();

  useEffect(() => {
    // Handle old hash format: #example-id -> #/example/example-id
    const hash = window.location.hash;

    // Check if we're at root and there's an old-style hash without /
    if (location.pathname === "/" && hash && !hash.startsWith("#/")) {
      const oldId = hash.replace(/^#/, "");

      // Verify this is a valid example ID
      const example = examples.find((e) => e.id === oldId);
      if (example) {
        // Redirect to new format
        navigate(`/example/${oldId}`, { replace: true });
      }
    }
  }, [location, navigate]);

  return null;
}

function App() {
  return (
    <>
      <OldHashRedirect />
      <Routes>
        <Route path="/" element={<LandingPage />} />
        <Route path="/example/*" element={<ExamplePage />} />
      </Routes>
    </>
  );
}

export default App;
