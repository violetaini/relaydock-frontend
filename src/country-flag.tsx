import { useEffect, useState } from "react";
import { Globe2 } from "lucide-react";
import { countries } from "country-flag-icons";

const countryCodePattern = /^[A-Z]{2}$/;

// Some providers still use the common but non-ISO UK code. Keep the display
// resilient while using the ISO asset shipped with the application.
const countryCodeAliases: Record<string, string> = { UK: "GB" };

const popularRegionPriority = ["HK", "TW", "JP", "SG", "KR", "US", "GB", "DE", "FR", "NL", "CA", "AU", "RU", "TR", "IN", "MO"];
const regionShortNameOverrides: Record<string, string> = {
  HK: "香港",
  MO: "澳门",
  TW: "台湾",
  GB: "英国",
  US: "美国",
  KR: "韩国",
  KP: "朝鲜",
  RU: "俄罗斯",
};

export interface CountryRegionOption {
  code: string;
  zhName: string;
  enName: string;
  label: string;
}

function buildGlobalCountryRegions(): CountryRegionOption[] {
  const zhDisplay = typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["zh-Hans", "zh-CN"], { type: "region" })
    : null;
  const enDisplay = typeof Intl !== "undefined" && typeof Intl.DisplayNames === "function"
    ? new Intl.DisplayNames(["en"], { type: "region" })
    : null;
  const priorityRank = new Map(popularRegionPriority.map((code, idx) => [code, idx]));
  const items: CountryRegionOption[] = [];
  const seen = new Set<string>();
  for (const raw of countries) {
    const code = raw.trim().toUpperCase();
    if (!countryCodePattern.test(code) || seen.has(code)) continue;
    seen.add(code);
    const zhRaw = regionShortNameOverrides[code] || zhDisplay?.of(code) || code;
    const enRaw = enDisplay?.of(code) || code;
    items.push({
      code,
      zhName: zhRaw,
      enName: enRaw,
      label: `${zhRaw} (${code})`,
    });
  }
  items.sort((a, b) => {
    const pa = priorityRank.get(a.code);
    const pb = priorityRank.get(b.code);
    if (pa !== undefined && pb !== undefined) return pa - pb;
    if (pa !== undefined) return -1;
    if (pb !== undefined) return 1;
    return a.zhName.localeCompare(b.zhName, "zh-Hans-CN");
  });
  return items;
}

export const GLOBAL_COUNTRY_REGIONS: CountryRegionOption[] = buildGlobalCountryRegions();
const regionLookup = new Map(GLOBAL_COUNTRY_REGIONS.map((item) => [item.code, item]));

export function getCountryRegionLabel(code?: unknown): string {
  const norm = normalizeCountryCode(code);
  if (!norm || norm === "UN") return "未知地区 (未知)";
  const alias = countryCodeAliases[norm] ?? norm;
  return regionLookup.get(alias)?.label || regionLookup.get(norm)?.label || norm;
}

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
