import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";

const countryCodePattern = /^[A-Z]{2}$/;

// Some providers still use the common but non-ISO UK code. Keep the display
// resilient while using the ISO asset shipped with the application.
const countryCodeAliases: Record<string, string> = { UK: "GB" };

const countryFlagAssets = import.meta.glob<string>("../node_modules/country-flag-icons/3x2/*.svg", {
  query: "?url&no-inline",
  import: "default",
});

export function normalizeCountryCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return countryCodePattern.test(code) ? code : undefined;
}

export function CountryFlag({ countryCode, className = "country-flag-svg", fallbackSize = 14 }: {
  countryCode?: unknown;
  className?: string;
  fallbackSize?: number;
}) {
  const normalizedCode = normalizeCountryCode(countryCode);
  const assetCode = normalizedCode ? countryCodeAliases[normalizedCode] ?? normalizedCode : undefined;
  const assetLoader = assetCode ? countryFlagAssets[`../node_modules/country-flag-icons/3x2/${assetCode}.svg`] : undefined;
  const [asset, setAsset] = useState<string | null>();

  useEffect(() => {
    let active = true;
    setAsset(undefined);
    if (!assetLoader) {
      setAsset(null);
      return () => { active = false; };
    }
    void assetLoader()
      .then((source) => { if (active) setAsset(source); })
      .catch(() => { if (active) setAsset(null); });
    return () => { active = false; };
  }, [assetLoader]);

  if (asset) return <img aria-hidden="true" alt="" className={className} src={asset} />;
  return <Globe2 aria-hidden="true" className={`${className} country-flag-fallback`} size={fallbackSize} />;
}
