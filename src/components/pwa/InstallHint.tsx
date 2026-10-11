"use client";

import { useEffect, useState, useSyncExternalStore } from "react";
import { Button } from "@/components/ui/Button";

const DISMISS_KEY = "autoflash-install-dismissed";
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
  return window.localStorage.getItem(DISMISS_KEY) === "1";
}

function rememberDismissed() {
  window.localStorage.setItem(DISMISS_KEY, "1");
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

export function InstallHint() {
  const isNarrow = useSyncExternalStore(subscribeNarrow, narrow, () => false);
  const isInstalled = useSyncExternalStore(subscribeInstalled, installed, () => false);
  const isDismissed = useSyncExternalStore(subscribeDismiss, dismissed, () => false);
  const isIos = useSyncExternalStore(subscribeNothing, iosSafari, () => false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

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
    const choice = await installEvent.userChoice;
    setInstallEvent(null);
    if (choice.outcome === "dismissed") rememberDismissed();
  }

  if (!isNarrow || isInstalled || isDismissed) return null;

  const showAndroid = installEvent !== null;
  const showIos = isIos && !showAndroid;
  if (!showAndroid && !showIos) return null;

  return (
    <div className="mb-4 flex flex-col gap-3 rounded-lg border border-border bg-surface p-4 sm:flex-row sm:items-center sm:justify-between">
      <p className="text-sm text-ink">
        {showAndroid
          ? "Install AutoFlash on this phone. The website stays available in the browser."
          : "Add AutoFlash to your home screen: tap Share, then Add to Home Screen."}
      </p>
      <div className="flex shrink-0 gap-2">
        {showAndroid ? (
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
