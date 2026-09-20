/** A few screens and links that survive a reload -- a routing library would
 *  be more code than the routes. History-based so shared links look real. */

import { createContext, useContext, useEffect, useState } from "react";
import type { MouseEvent, ReactNode } from "react";

const RouteContext = createContext<string>(window.location.pathname);

export function RouterProvider({ children }: { children: ReactNode }) {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const onChange = () => setPath(window.location.pathname);
    window.addEventListener("popstate", onChange);
    window.addEventListener("sp:navigate", onChange);
    return () => {
      window.removeEventListener("popstate", onChange);
      window.removeEventListener("sp:navigate", onChange);
    };
  }, []);
  return <RouteContext.Provider value={path}>{children}</RouteContext.Provider>;
}

export function usePath(): string {
  return useContext(RouteContext);
}

export function navigate(path: string, replace = false): void {
  if (path === window.location.pathname + window.location.search) return;
  if (replace) window.history.replaceState(null, "", path);
  else window.history.pushState(null, "", path);
  window.dispatchEvent(new Event("sp:navigate"));
  window.scrollTo(0, 0);
}

export function Link({ to, className, children }: { to: string; className?: string; children: ReactNode }) {
  const onClick = (e: MouseEvent) => {
    if (e.metaKey || e.ctrlKey || e.shiftKey || e.button !== 0) return;
    e.preventDefault();
    navigate(to);
  };
  return (
    <a href={to} className={className} onClick={onClick}>
      {children}
    </a>
  );
}

/** Match `/leagues/:id/:tab` style patterns; returns params or null. */
export function match(pattern: string, path: string): Record<string, string> | null {
  const p = pattern.split("/").filter(Boolean);
  const s = path.split("/").filter(Boolean);
  if (p.length !== s.length) return null;
  const out: Record<string, string> = {};
  for (let i = 0; i < p.length; i++) {
    if (p[i].startsWith(":")) out[p[i].slice(1)] = decodeURIComponent(s[i]);
    else if (p[i] !== s[i]) return null;
  }
  return out;
}
