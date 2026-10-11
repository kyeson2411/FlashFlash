"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { usePathname } from "next/navigation";
import { Button } from "@/components/ui/Button";

const OLD_DISMISS_KEY = "autoflash-install-dismissed";
const DISMISS_KEY = "autoflash-install-later";
const NARROW = "(max-width: 760px)";

type BeforeInstallPromptEvent = Event & {
  prompt: () => Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
};

const dismissListeners = new Set<() => void>();

function subscribeDismiss(onChange: () => void) {
  dismissListeners.add(onChange);
  return () => dismissListeners.delete(onChange);
}

function dismissed() {
  return window.sessionStorage.getItem(DISMISS_KEY) === "1";
}

function rememberDismissed() {
  window.sessionStorage.setItem(DISMISS_KEY, "1");
  dismissListeners.forEach((onChange) => onChange());
}

function subscribeNarrow(onChange: () => void) {
  const media = window.matchMedia(NARROW);
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function narrow() {
  return window.matchMedia(NARROW).matches;
}

function subscribeInstalled(onChange: () => void) {
  const media = window.matchMedia("(display-mode: standalone)");
  media.addEventListener("change", onChange);
  return () => media.removeEventListener("change", onChange);
}

function installed() {
  return (
    window.matchMedia("(display-mode: standalone)").matches ||
    ("standalone" in navigator && Boolean((navigator as Navigator & { standalone?: boolean }).standalone))
  );
}

function subscribeNothing() {
  return () => {};
}

function iosSafari() {
  const ua = navigator.userAgent;
  const ios = /iPad|iPhone|iPod/.test(ua) || (navigator.platform === "MacIntel" && navigator.maxTouchPoints > 1);
  return ios && /Safari/i.test(ua) && !/CriOS|FxiOS|EdgiOS/.test(ua);
}

function isPhoneHome(pathname: string, role: "student" | "teacher") {
  if (role === "teacher") return pathname === "/classes";
  return pathname === "/dashboard";
}

export function InstallHint({ role = "student" }: { role?: "student" | "teacher" }) {
  const pathname = usePathname();
  const isNarrow = useSyncExternalStore(subscribeNarrow, narrow, () => false);
  const isInstalled = useSyncExternalStore(subscribeInstalled, installed, () => false);
  const isDismissed = useSyncExternalStore(subscribeDismiss, dismissed, () => false);
  const isIos = useSyncExternalStore(subscribeNothing, iosSafari, () => false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    window.localStorage.removeItem(OLD_DISMISS_KEY);
  }, []);

  useEffect(() => {
    const onPrompt = (event: Event) => {
      if (!window.matchMedia(NARROW).matches) return;
      event.preventDefault();
      setInstallEvent(event as BeforeInstallPromptEvent);
    };
    window.addEventListener("beforeinstallprompt", onPrompt);
    return () => window.removeEventListener("beforeinstallprompt", onPrompt);
  }, []);

  async function install() {
    if (!installEvent) return;
    await installEvent.prompt();
    setInstallEvent(null);
  }

  if (!isPhoneHome(pathname, role) || !isNarrow || isInstalled || isDismissed) return null;

  const showInstall = installEvent !== null;
  const message = isIos
    ? "Add AutoFlash to your home screen: tap Share, then Add to Home Screen."
    : showInstall
      ? "Install AutoFlash on this phone. The website stays available in the browser."
      : "Install AutoFlash from the browser menu, then Install app.";

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink">{message}</p>
      <div className="flex shrink-0 gap-2">
        {showInstall ? (
          <Button type="button" onClick={install} className="h-9 px-3">
            Install
          </Button>
        ) : null}
        <Button type="button" variant="ghost" onClick={rememberDismissed} className="h-9 px-3">
          Not now
        </Button>
      </div>
    </div>
  );
}
