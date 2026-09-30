import { useEffect, useSyncExternalStore } from "react";

// Light and dark follow the operating system, live.
export type Scheme = "light" | "dark";

const QUERY = "(prefers-color-scheme: dark)";

export function initialScheme(): Scheme {
  return window.matchMedia(QUERY).matches ? "dark" : "light";
}

function subscribe(onChange: () => void): () => void {
  const media = window.matchMedia(QUERY);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

export function useColorScheme(rootEl: HTMLElement): Scheme {
  const scheme = useSyncExternalStore(subscribe, initialScheme);
  useEffect(() => {
    rootEl.setAttribute("data-recursica-theme", scheme);
  }, [rootEl, scheme]);
  return scheme;
}
