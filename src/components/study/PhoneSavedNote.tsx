"use client";

import { useEffect, useState } from "react";
import { PACKS_SAVED_EVENT, PACKS_SAVED_KEY } from "@/lib/offline/study-store";

export function PhoneSavedNote() {
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    const show = () => setSaved(true);
    try {
      if (sessionStorage.getItem(PACKS_SAVED_KEY) === "1") setSaved(true);
    } catch {
      // The event still shows the line after this visit's save.
    }
    window.addEventListener(PACKS_SAVED_EVENT, show);
    return () => window.removeEventListener(PACKS_SAVED_EVENT, show);
  }, []);

  if (!saved) return null;
  return <p className="dash-note">Saved on this phone.</p>;
}
