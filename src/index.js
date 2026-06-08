import React from "react";
import ReactDOM from "react-dom";
import "./index.css";
import App from "./App";
import { BrowserRouter as Router } from "react-router-dom";

/*
 * Legacy Create React App entry point.
 *
 * The Vite build uses src/main.jsx instead. Keep this only if older tooling or
 * tests still reference it; otherwise future cleanup can delete it.
 */
ReactDOM.render(
  <Router>
    <App />
  </Router>,
  document.getElementById("root")
);
