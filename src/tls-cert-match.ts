export interface TLSCertificateCandidate {
  id: number;
  domain: string;
  dns_names?: string[];
  status?: string;
  expiry_date?: string | null;
  remote_server_id?: number;
}

export interface TLSCertServerTarget {
  id?: number;
  domain?: string | null;
}

export type TLSCertMatchKind = "exact" | "wildcard";

export interface TLSCertMatchResult<T extends TLSCertificateCandidate = TLSCertificateCandidate> {
  certificate: T;
  matchKind: TLSCertMatchKind;
}

/** Matches a certificate DNS name against a concrete hostname using X.509 single-label wildcard semantics. */
export function managedCertificateNameMatchesHost(name: string, hostname: string): boolean {
  const normalizedName = name.trim().toLowerCase().replace(/\.$/, "");
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalizedName || !normalizedHost) return false;
  if (normalizedName === normalizedHost) return true;
  if (!normalizedName.startsWith("*.")) return false;
  const suffix = normalizedName.slice(2);
  return normalizedHost.endsWith(`.${suffix}`) && normalizedHost.split(".").length === suffix.split(".").length + 1;
}

/** Returns true when the certificate is valid, unexpired, and not bound to another server. */
export function isTLSCertificateUsable(certificate: TLSCertificateCandidate, nowMs = Date.now(), serverId?: number): boolean {
  if (certificate.status !== undefined && certificate.status !== "valid") return false;
  if (certificate.expiry_date) {
    const expiryMs = new Date(certificate.expiry_date).getTime();
    if (!Number.isNaN(expiryMs) && expiryMs <= nowMs) return false;
  }
  if (serverId !== undefined && serverId > 0 && certificate.remote_server_id && certificate.remote_server_id !== serverId) {
    return false;
  }
  return true;
}

/** Returns concrete SAN names (or primary domain when SAN list is absent) covered by a certificate. */
export function certificateHostnames(certificate: TLSCertificateCandidate): string[] {
  const rawNames = certificate.dns_names?.length ? certificate.dns_names : [certificate.domain];
  return Array.from(new Set(rawNames.map((item) => item.trim().toLowerCase().replace(/\.$/, "")).filter(Boolean)));
}

/** Checks whether a certificate is bound/global for `server` and covers `server.domain`. */
export function managedCertificateCoversServer(certificate: TLSCertificateCandidate, server?: TLSCertServerTarget): boolean {
  if (!server) return false;
  const serverDomain = (server.domain || "").trim().toLowerCase();
  if (!serverDomain) return false;
  if (server.id && certificate.remote_server_id && certificate.remote_server_id !== server.id) return false;
  return certificateHostnames(certificate).some((name) => managedCertificateNameMatchesHost(name, serverDomain));
}

/**
 * Computes best match specificity of a certificate for `hostname`:
 * `0` = exact single-domain match, `1` = single-label wildcard match, `-1` = no match.
 */
export function certificateMatchRankForHost(certificate: TLSCertificateCandidate, hostname: string): number {
  const host = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!host) return -1;
  let bestRank = -1;
  for (const candidateName of certificateHostnames(certificate)) {
    if (!managedCertificateNameMatchesHost(candidateName, host)) continue;
    const rank = candidateName.startsWith("*.") ? 1 : 0;
    if (bestRank === -1 || rank < bestRank) bestRank = rank;
    if (bestRank === 0) break;
  }
  return bestRank;
}

/**
 * Finds the best usable certificate covering `hostname` (supports both single-domain and wildcard certs),
 * matching backend priority: server-bound before global, exact domain before wildcard, newer ID first.
 */
export function findBestMatchingCertificate<T extends TLSCertificateCandidate>(
  certificates: T[],
  hostname: string,
  serverId?: number,
): TLSCertMatchResult<T> | undefined {
  const normalizedHost = hostname.trim().toLowerCase().replace(/\.$/, "");
  if (!normalizedHost) return undefined;
  const nowMs = Date.now();
  let best: { certificate: T; ownerRank: number; matchRank: number } | undefined;
  for (const certificate of certificates) {
    if (!isTLSCertificateUsable(certificate, nowMs, serverId)) continue;
    const matchRank = certificateMatchRankForHost(certificate, normalizedHost);
    if (matchRank < 0) continue;
    const ownerRank = serverId && certificate.remote_server_id === serverId ? 0 : 1;
    if (
      !best
      || ownerRank < best.ownerRank
      || (ownerRank === best.ownerRank && matchRank < best.matchRank)
      || (ownerRank === best.ownerRank && matchRank === best.matchRank && certificate.id > best.certificate.id)
    ) {
      best = { certificate, ownerRank, matchRank };
    }
  }
  if (!best) return undefined;
  return {
    certificate: best.certificate,
    matchKind: best.matchRank === 0 ? "exact" : "wildcard",
  };
}

/** Resolves the hostname to display/submit when a user picks a specific certificate. */
export function managedTLSHostnameForCertificate(
  certificate: TLSCertificateCandidate | undefined,
  server: TLSCertServerTarget | undefined,
  fallback: string,
): string {
  const cleanFallback = fallback.trim();
  const serverDomain = (server?.domain || "").trim();
  if (!certificate) return cleanFallback || serverDomain;
  const names = certificateHostnames(certificate);
  if (cleanFallback && names.some((name) => managedCertificateNameMatchesHost(name, cleanFallback))) {
    return cleanFallback;
  }
  if (serverDomain && names.some((name) => managedCertificateNameMatchesHost(name, serverDomain))) {
    return serverDomain;
  }
  const exactName = names.find((name) => !name.startsWith("*."));
  if (exactName) return exactName;
  return cleanFallback || serverDomain;
}

/**
 * Resolves the initial `(domain, certificateId)` pair for any TLS-certificate protocol:
 * matches the current domain or server domain first, or picks a usable single-domain / wildcard certificate.
 */
export function defaultDomainAndCertificateForTLS<T extends TLSCertificateCandidate>(
  certificates: T[],
  server: TLSCertServerTarget | undefined,
  currentDomain = "",
): { domain: string; certificateId: string; matchKind?: TLSCertMatchKind } {
  const serverId = server?.id;
  const usable = certificates.filter((item) => isTLSCertificateUsable(item, Date.now(), serverId));
  const candidateDomain = currentDomain.trim() || (server?.domain || "").trim();
  if (candidateDomain) {
    const matched = findBestMatchingCertificate(usable, candidateDomain, serverId);
    return {
      domain: candidateDomain,
      certificateId: matched ? String(matched.certificate.id) : "",
      matchKind: matched?.matchKind,
    };
  }
  const sortedUsable = [...usable].sort((a, b) => {
    const ownerA = serverId && a.remote_server_id === serverId ? 0 : 1;
    const ownerB = serverId && b.remote_server_id === serverId ? 0 : 1;
    if (ownerA !== ownerB) return ownerA - ownerB;
    const exactA = certificateHostnames(a).some((name) => !name.startsWith("*.")) ? 0 : 1;
    const exactB = certificateHostnames(b).some((name) => !name.startsWith("*.")) ? 0 : 1;
    if (exactA !== exactB) return exactA - exactB;
    return b.id - a.id;
  });
  const first = sortedUsable[0];
  if (!first) return { domain: "", certificateId: "" };
  const exactHost = certificateHostnames(first).find((name) => !name.startsWith("*."));
  if (exactHost) {
    return { domain: exactHost, certificateId: String(first.id), matchKind: "exact" };
  }
  return { domain: "", certificateId: String(first.id), matchKind: "wildcard" };
}
