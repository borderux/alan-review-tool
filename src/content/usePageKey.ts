import { useEffect, useState } from "react";
import { currentPageKey } from "./lib/page";

// How often to check whether the page's address has changed.
const CHECK_MS = 500;

// The key of the page the panel is on, kept current. Single-page apps
// change the address without reloading, and a content script cannot see
// the page's own history calls, so the address is checked on a short
// interval. Without this, comments added after such a navigation would be
// filed under the previous page.
export function usePageKey(): string {
  const [pageKey, setPageKey] = useState(currentPageKey);
  useEffect(() => {
    const check = () => {
      const next = currentPageKey();
      setPageKey((current) => (current === next ? current : next));
    };
    // Hash routes and back/forward are noticed at once; pushState and
    // replaceState can't be seen from a content script, so the interval
    // catches those.
    const timer = setInterval(check, CHECK_MS);
    window.addEventListener("hashchange", check);
    window.addEventListener("popstate", check);
    return () => {
      clearInterval(timer);
      window.removeEventListener("hashchange", check);
      window.removeEventListener("popstate", check);
    };
  }, []);
  return pageKey;
}
