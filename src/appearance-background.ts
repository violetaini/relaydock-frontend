import { useEffect, useMemo, useState } from "react";
import { DEFAULT_LOGIN_BACKGROUND_URL, useBranding } from "./brand";

// Login and the public probe share the appearance settings and failure fallback.
export function useAppearanceBackground(wallpaper = "") {
  const branding = useBranding();
  const mode = branding.login_background_mode || "fixed";
  const sources = JSON.stringify(branding.login_background_urls ?? [DEFAULT_LOGIN_BACKGROUND_URL]);
  const [revision, setRevision] = useState(0);
  const [failedSource, setFailedSource] = useState("");
  const source = useMemo(() => {
    if (mode === "gradient") return "";
    if (mode !== "random") return wallpaper;
    const urls = JSON.parse(sources) as string[];
    if (!urls.length) return "";
    const random = crypto.getRandomValues(new Uint32Array(1))[0];
    try {
      const url = new URL(urls[random % urls.length], location.origin);
      url.searchParams.set("_bg", `${random}-${revision}`);
      return url.href;
    } catch {
      return "";
    }
  }, [mode, sources, wallpaper, revision]);
  useEffect(() => setFailedSource(""), [source]);

  return {
    background: source !== failedSource ? source : "",
    canRefresh: mode === "random" && JSON.parse(sources).length > 0,
    refresh: () => setRevision((current) => current + 1),
    onError: () => setFailedSource(source),
  };
}
