import { createContext, useContext, type ReactNode } from "react";

interface BrandMarkProps {
  className?: string;
  size?: number;
}

export const BRAND_NAME = "RelayDock";
export const DEFAULT_BRAND_LOGO = "/brand.png";

export interface Branding {
  name: string;
  logo: string;
  favicon: string;
}

export const DEFAULT_BRANDING: Branding = {
  name: BRAND_NAME,
  logo: "",
  favicon: "",
};

const BrandingContext = createContext<Branding>(DEFAULT_BRANDING);

export function normalizeBranding(value: Partial<Branding> | null | undefined): Branding {
  const name = typeof value?.name === "string" ? value.name.trim() : "";
  const logo = typeof value?.logo === "string" ? value.logo.trim() : "";
  const favicon = typeof value?.favicon === "string" ? value.favicon.trim() : "";
  return { name: name || BRAND_NAME, logo, favicon };
}

export function brandLogoURL(branding: Branding): string {
  return branding.logo || DEFAULT_BRAND_LOGO;
}

export function brandFaviconURL(branding: Branding): string {
  return branding.favicon || branding.logo || DEFAULT_BRAND_LOGO;
}

export function BrandingProvider({ branding, children }: { branding: Branding; children: ReactNode }) {
  return <BrandingContext.Provider value={normalizeBranding(branding)}>{children}</BrandingContext.Provider>;
}

export function useBranding(): Branding {
  return useContext(BrandingContext);
}

function faviconType(source: string): string {
  if (source.startsWith("data:image/svg+xml") || /\.svg(?:[?#]|$)/i.test(source)) return "image/svg+xml";
  if (source.startsWith("data:image/x-icon") || source.startsWith("data:image/vnd.microsoft.icon") || /\.ico(?:[?#]|$)/i.test(source)) return "image/x-icon";
  if (source.startsWith("data:image/webp") || /\.webp(?:[?#]|$)/i.test(source)) return "image/webp";
  return "image/png";
}

export function applyBrandingDocument(value: Partial<Branding> | null | undefined): void {
  if (typeof document === "undefined") return;
  const branding = normalizeBranding(value);
  document.title = `${branding.name} Console`;

  let favicon = document.querySelector<HTMLLinkElement>("#app-favicon");
  if (!favicon) {
    favicon = document.createElement("link");
    favicon.id = "app-favicon";
    favicon.rel = "icon";
    document.head.appendChild(favicon);
  }
  const source = brandFaviconURL(branding);
  favicon.href = source;
  favicon.type = faviconType(source);
  favicon.sizes = "32x32";
  favicon.referrerPolicy = "no-referrer";
}

export function BrandMark({ className = "", size = 20 }: BrandMarkProps) {
  const branding = useBranding();
  return (
    <span className={`brand-mark ${className}`.trim()} aria-hidden="true">
      <img src={brandLogoURL(branding)} alt="" width={size} height={size} referrerPolicy="no-referrer" />
    </span>
  );
}
