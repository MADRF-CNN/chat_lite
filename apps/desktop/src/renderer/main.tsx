import React from "react";
import { createRoot } from "react-dom/client";
import { App } from "./App";
import { applyStyle, loadSettings } from "./settings";
import "./styles.css";

applyStyle(loadSettings().style);

createRoot(document.getElementById("root")!).render(<React.StrictMode><App /></React.StrictMode>);
