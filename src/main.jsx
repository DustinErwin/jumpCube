import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import { BrowserRouter } from "react-router-dom";
import "mana-font/css/mana.css";
import "./index.css";
import App from "./App.jsx";

function restoreGitHubPagesRedirect() {
  const redirectPath = window.sessionStorage.getItem("jumpCubeRedirectPath");

  if (!redirectPath) return;

  window.sessionStorage.removeItem("jumpCubeRedirectPath");

  const basePath = import.meta.env.BASE_URL.replace(/\/$/, "");
  const nextPath = `${basePath}${redirectPath.startsWith("/") ? redirectPath : `/${redirectPath}`}`;

  window.history.replaceState(null, "", nextPath);
}

/*
 * Vite entry point.
 *
 * BrowserRouter basename uses BASE_URL so routes work when deployed under a
 * GitHub Pages project path instead of the domain root.
 */
restoreGitHubPagesRedirect();

createRoot(document.getElementById("root")).render(
  <StrictMode>
    <BrowserRouter basename={import.meta.env.BASE_URL}>
      <App />
    </BrowserRouter>
  </StrictMode>,
);
