import { useEffect, useState } from "react";

export interface Route {
  path: string[];
  query: URLSearchParams;
}

function parse(): Route {
  const h = window.location.hash.replace(/^#\/?/, "");
  const [p, q] = h.split("?");
  return { path: p.split("/").filter(Boolean).map(decodeURIComponent), query: new URLSearchParams(q || "") };
}

export function useRoute(): Route {
  const [r, setR] = useState(parse);
  useEffect(() => {
    const on = () => setR(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return r;
}

export function go(path: string) {
  const h = path.startsWith("#") ? path : "#" + (path.startsWith("/") ? path : "/" + path);
  if (window.location.hash !== h) {
    window.location.hash = h;
    window.scrollTo({ top: 0 });
  }
}

export const href = (path: string) => "#" + (path.startsWith("/") ? path : "/" + path);
