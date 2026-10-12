import { createRoot } from "react-dom/client";
import App from "./App";
import "@fontsource-variable/ibm-plex-sans";
import "@fontsource-variable/ibm-plex-sans/wght-italic.css";
import "@fontsource-variable/inconsolata";
import "./style.css";
createRoot(document.getElementById("root")!).render(<App />);
