import type { UserItem } from "./types";

/** Package ownership is authoritative even while a legacy mode column is stale. */
export function isPackageAuthorization(user?: Pick<UserItem, "package_id" | "authorization_mode"> | null): boolean {
  return Boolean(user && (Number(user.package_id ?? 0) > 0 || user.authorization_mode === "package"));
}
