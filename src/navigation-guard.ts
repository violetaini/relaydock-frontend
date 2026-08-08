export const NAVIGATION_REQUEST_EVENT = "arcway:navigation-request";

export interface NavigationRequestDetail {
  proceed: () => void;
}

export function requestNavigation(proceed: () => void): boolean {
  const event = new CustomEvent<NavigationRequestDetail>(NAVIGATION_REQUEST_EVENT, {
    cancelable: true,
    detail: { proceed },
  });
  if (!window.dispatchEvent(event)) return false;
  proceed();
  return true;
}
