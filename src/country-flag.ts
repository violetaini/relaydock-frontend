const countryCodePattern = /^[A-Z]{2}$/;

export function normalizeCountryCode(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const code = value.trim().toUpperCase();
  return countryCodePattern.test(code) ? code : undefined;
}

export function countryFlag(value: unknown): string {
  const code = normalizeCountryCode(value);
  if (!code) return "";
  return String.fromCodePoint(...Array.from(code, (letter) => 0x1F1A5 + letter.charCodeAt(0)));
}
