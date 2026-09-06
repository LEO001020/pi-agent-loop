import { StrictMode } from "react";
import { createRoot } from "react-dom/client";
import App from "./App";
import "./styles/tokens.css";
import "./styles/skins.css";
import "./styles/tailwind.css";
import "streamdown/styles.css";
import "./styles/app.css";
import "./styles/setup-wizard.css";
import {
  applyNativeWindowTheme,
  applyThemeToDocument,
  loadTheme,
} from "./lib/theme";
import {
  applySkinToDocument,
  applyWallpaperFlag,
  applyWallpaperScrimToDocument,
  loadSkin,
  loadWallpaperScrim,
} from "./lib/themeSkin";

// Apply persisted theme + color skin + wallpaper flag before first paint of React tree.
const bootTheme = loadTheme(localStorage);
applyThemeToDocument(bootTheme);
applySkinToDocument(loadSkin(localStorage));
// A bundled default wallpaper is always present. Set the transparent wallpaper
// shell synchronously so first paint does not flash a solid background.
applyWallpaperFlag(true);
applyWallpaperScrimToDocument(loadWallpaperScrim(localStorage));
// Sync macOS NSAppearance / vibrancy with app theme (avoids dark glass under light UI).
void applyNativeWindowTheme(bootTheme);

createRoot(document.getElementById("root")!).render(
  <StrictMode>
    <App />
  </StrictMode>,
);
