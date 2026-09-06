/**
 * Theme, skin, wallpaper and per-workspace colour — the shell's whole
 * appearance surface in one place.
 *
 * All of it is presentation with no session coupling, which is what makes it a
 * clean thing to lift out of `App.tsx`. The only two things it needs from
 * outside are the active workspace (a skin belongs to one) and a way to report
 * a failed wallpaper write.
 *
 * Persistence is deliberately eager: each setter writes storage, applies the
 * change to the document, and only then updates React state. A theme that
 * survives the next launch matters more than one render's worth of tidiness,
 * and the effects below re-apply on mount so the two paths agree.
 */

import { useEffect, useRef, useState } from "react";
import defaultWallpaperUrl from "@/assets/land-default.jpg";
import {
  applyThemeToDocument,
  applyNativeWindowTheme,
  loadTheme,
  saveTheme,
  type Theme,
} from "@/lib/theme";
import {
  applySkinToDocument,
  applyWallpaperFlag,
  applyWallpaperScrimToDocument,
  clearWallpaper,
  isThemeSkinId,
  loadSkin,
  loadWallpaperRecord,
  loadWallpaperScrim,
  saveSkin,
  saveWallpaper,
  saveWallpaperScrim,
  skinPreferredTheme,
  type ThemeSkinId,
  type WallpaperRecord,
} from "@/lib/themeSkin";
import {
  loadWorkspace,
  loadWorkspaceSkins,
  saveWorkspaceSkins,
  setWorkspaceSkin,
  type WorkspaceId,
  type WorkspaceSkins,
} from "@/lib/workspace";

export interface AppearanceDeps {
  /** Workspace that owns a skin chosen without an explicit owner. */
  workspace: WorkspaceId;
  /** Surface a failed wallpaper write; the choice is then not applied. */
  onError: (message: string) => void;
}

export interface AppearanceState {
  theme: Theme;
  skin: ThemeSkinId;
  workspaceSkins: WorkspaceSkins;
  wallpaperRecord: WallpaperRecord | null;
  wallpaperUrl: string;
  wallpaperScrim: number;
  applyThemeChoice: (next: Theme) => void;
  /** Apply a skin to the shell without changing which workspace owns it. */
  applySkinOnly: (next: ThemeSkinId) => void;
  /**
   * Apply a skin and record it as `owner`'s.
   *
   * `owner` is explicit because switching workspace applies the destination's
   * skin *before* the workspace state has committed — defaulting to the current
   * one would write the new skin onto the workspace being left.
   */
  applySkinChoice: (next: ThemeSkinId, owner?: WorkspaceId) => void;
  applyWallpaperChoice: (record: WallpaperRecord | null) => Promise<void>;
  applyWallpaperScrimChoice: (value: number) => void;
}

export function useAppearance(deps: AppearanceDeps): AppearanceState {
  const { workspace, onError } = deps;

  const [theme, setTheme] = useState<Theme>(() => loadTheme(localStorage));
  const [skin, setSkin] = useState<ThemeSkinId>(() => {
    // A workspace's own skin wins over the global one, so reopening the app in
    // the PR workspace does not flash the Code workspace's colour first.
    const perWorkspace = loadWorkspaceSkins(localStorage, isThemeSkinId)[
      loadWorkspace(localStorage)
    ];
    return isThemeSkinId(perWorkspace) ? perWorkspace : loadSkin(localStorage);
  });
  const [workspaceSkins, setWorkspaceSkins] = useState<WorkspaceSkins>(() =>
    loadWorkspaceSkins(localStorage, isThemeSkinId),
  );
  const [wallpaperRecord, setWallpaperRecord] =
    useState<WallpaperRecord | null>(null);
  const [wallpaperUrl, setWallpaperUrl] = useState<string>(defaultWallpaperUrl);
  // The live blob: URL, so it can be revoked when replaced or cleared.
  const wallpaperUrlRef = useRef<string | null>(null);
  const [wallpaperScrim, setWallpaperScrim] = useState(() =>
    loadWallpaperScrim(localStorage),
  );

  useEffect(() => {
    applyThemeToDocument(theme);
    void applyNativeWindowTheme(theme);
  }, [theme]);

  useEffect(() => {
    applySkinToDocument(skin);
  }, [skin]);

  // Cold-load the persisted wallpaper from IndexedDB (the blob is async-only)
  // and build the object URL for the media layer. `main.tsx` has already set
  // the data-wallpaper flag synchronously, so the shell is transparent by now.
  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const rec = await loadWallpaperRecord();
      if (cancelled || !rec) return;
      const url = URL.createObjectURL(rec.blob);
      wallpaperUrlRef.current = url;
      setWallpaperRecord(rec);
      setWallpaperUrl(url);
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Revoke the last object URL when the shell goes away. Nothing else will:
  // the browser holds a blob alive for the document's lifetime otherwise.
  useEffect(
    () => () => {
      if (wallpaperUrlRef.current) URL.revokeObjectURL(wallpaperUrlRef.current);
    },
    [],
  );

  // Keep the data-wallpaper flag in step with upload / clear.
  useEffect(() => {
    applyWallpaperFlag(wallpaperUrl !== null);
  }, [wallpaperUrl]);

  // Scrim strength dims the wallpaper overlay (::after) only, never chrome.
  useEffect(() => {
    applyWallpaperScrimToDocument(wallpaperScrim);
  }, [wallpaperScrim]);

  const applyThemeChoice = (next: Theme) => {
    saveTheme(localStorage, next);
    applyThemeToDocument(next);
    void applyNativeWindowTheme(next);
    setTheme(next);
  };

  const applySkinOnly = (next: ThemeSkinId) => {
    saveSkin(localStorage, next);
    applySkinToDocument(next);
    setSkin(next);
    const preferred = skinPreferredTheme(next);
    if (preferred && preferred !== theme) {
      applyThemeChoice(preferred);
    }
  };

  const applySkinChoice = (next: ThemeSkinId, owner: WorkspaceId = workspace) => {
    applySkinOnly(next);
    setWorkspaceSkins((prev) => {
      const updated = setWorkspaceSkin(prev, owner, next);
      saveWorkspaceSkins(localStorage, updated);
      return updated;
    });
  };

  const applyWallpaperChoice = async (record: WallpaperRecord | null) => {
    // Storage first, state second. If the write fails the user keeps the
    // wallpaper they had, rather than seeing one that will not survive a
    // restart.
    if (!record) {
      try {
        await clearWallpaper();
      } catch (e) {
        onError(String(e));
        return;
      }
      if (wallpaperUrlRef.current) {
        URL.revokeObjectURL(wallpaperUrlRef.current);
        wallpaperUrlRef.current = null;
      }
      setWallpaperRecord(null);
      setWallpaperUrl(defaultWallpaperUrl);
      return;
    }
    try {
      await saveWallpaper(record);
    } catch (e) {
      onError(String(e));
      return;
    }
    const url = URL.createObjectURL(record.blob);
    if (wallpaperUrlRef.current) URL.revokeObjectURL(wallpaperUrlRef.current);
    wallpaperUrlRef.current = url;
    setWallpaperRecord(record);
    setWallpaperUrl(url);
  };

  const applyWallpaperScrimChoice = (value: number) => {
    saveWallpaperScrim(localStorage, value);
    applyWallpaperScrimToDocument(value);
    setWallpaperScrim(value);
  };

  return {
    theme,
    skin,
    workspaceSkins,
    wallpaperRecord,
    wallpaperUrl,
    wallpaperScrim,
    applyThemeChoice,
    applySkinOnly,
    applySkinChoice,
    applyWallpaperChoice,
    applyWallpaperScrimChoice,
  };
}
