import { isBoardPathWithoutPrefix, toCompanyRelativePath } from "@/lib/company-routes";

const PAPERCLIP_APP_HOSTS = new Set([
  "app.paperclip.ing",
  "paperclip.ing",
]);

function isHttpUrl(value: string) {
  return /^https?:\/\//i.test(value);
}

function isLoopbackHost(hostname: string) {
  return hostname === "127.0.0.1" || hostname === "localhost" || hostname === "::1";
}

function isCurrentBrowserOrigin(url: URL) {
  if (typeof window === "undefined") return false;
  return url.origin === window.location.origin;
}

function isPaperclipAppOrigin(url: URL) {
  return isCurrentBrowserOrigin(url) || isLoopbackHost(url.hostname) || PAPERCLIP_APP_HOSTS.has(url.hostname);
}

function isInternalBoardPath(pathname: string) {
  return isBoardPathWithoutPrefix(toCompanyRelativePath(pathname));
}

export function normalizeCommandCenterHref(href: string) {
  if (!isHttpUrl(href)) return href;

  try {
    const url = new URL(href);
    if (!isPaperclipAppOrigin(url) || !isInternalBoardPath(url.pathname)) return href;
    return `${toCompanyRelativePath(url.pathname)}${url.search}${url.hash}`;
  } catch {
    return href;
  }
}

export function isExternalCommandCenterHref(href: string) {
  return isHttpUrl(normalizeCommandCenterHref(href));
}
