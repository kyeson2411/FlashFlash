"use client";

import { useEffect } from "react";

const SAVED_DECKS = "/study-offline";

function isSavedDecks(pathname: string) {
  return pathname === SAVED_DECKS || pathname === `${SAVED_DECKS}/`;
}

/** While offline, in-app links open the saved decks instead of a page that needs the network. */
export function OfflineNavigation() {
  useEffect(() => {
    function onClick(event: MouseEvent) {
      if (navigator.onLine || event.defaultPrevented) return;
      const target = event.target;
      if (!(target instanceof Element)) return;
      const link = target.closest("a[href]");
      if (!(link instanceof HTMLAnchorElement)) return;
      const href = link.getAttribute("href") ?? "";
      if (!href || href.startsWith("#") || href.startsWith("mailto:") || href.startsWith("tel:")) return;
      let url: URL;
      try {
        url = new URL(link.href, location.href);
      } catch {
        return;
      }
      if (url.origin !== location.origin || isSavedDecks(url.pathname)) return;
      event.preventDefault();
      event.stopPropagation();
      location.assign(SAVED_DECKS);
    }

    document.addEventListener("click", onClick, true);
    return () => document.removeEventListener("click", onClick, true);
  }, []);

  return null;
}
