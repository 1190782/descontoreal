"use client";

import { SITE } from "@descontoreal/core";
import { type ReactElement, useEffect, useState, useSyncExternalStore } from "react";

/** Chromium's install prompt, which no TypeScript lib types yet. */
interface BeforeInstallPromptEvent extends Event {
  prompt(): Promise<void>;
  userChoice: Promise<{ outcome: "accepted" | "dismissed" }>;
}

// Kept in this browser only and never sent anywhere (see /privacidade).
const VISITS_KEY = "descontoreal:visitas";
const SESSION_KEY = "descontoreal:sessao";
const DISMISSED_KEY = "descontoreal:instalar-fechado";
const VISITS_BEFORE_PROMPT = 2;

/**
 * Registers the service worker and, from the second visit on, offers to install the site: Chromium's prompt, or
 * the Share → Add to Home Screen steps on iPhone and iPad. Shows nothing when installed or after "Agora não".
 */
export function PwaSupport(): ReactElement | null {
  const visits = useSyncExternalStore(subscribeNever, countVisit, () => 0);
  const standalone = useSyncExternalStore(subscribeNever, isStandalone, () => true);
  const ios = useSyncExternalStore(subscribeNever, isIos, () => false);
  const dismissedBefore = useSyncExternalStore(subscribeNever, wasDismissed, () => true);
  const [dismissed, setDismissed] = useState(false);
  const [installEvent, setInstallEvent] = useState<BeforeInstallPromptEvent | null>(null);

  useEffect(() => {
    if (process.env.NODE_ENV === "production" && "serviceWorker" in navigator) {
      navigator.serviceWorker
        .register("/sw.js", { scope: "/", updateViaCache: "none" })
        .catch(() => undefined);
    }
    function onPrompt(event: Event): void {
      if (isInstallPrompt(event)) {
        event.preventDefault();
        setInstallEvent(event);
      }
    }
    function onInstalled(): void {
      setInstallEvent(null);
    }
    window.addEventListener("beforeinstallprompt", onPrompt);
    window.addEventListener("appinstalled", onInstalled);
    return () => {
      window.removeEventListener("beforeinstallprompt", onPrompt);
      window.removeEventListener("appinstalled", onInstalled);
    };
  }, []);

  if (
    visits < VISITS_BEFORE_PROMPT ||
    standalone ||
    dismissedBefore ||
    dismissed ||
    (installEvent === null && !ios)
  ) {
    return null;
  }

  function close(): void {
    try {
      localStorage.setItem(DISMISSED_KEY, "1");
    } catch {
      // Storage blocked: the banner just comes back next time.
    }
    setDismissed(true);
  }

  async function install(): Promise<void> {
    if (installEvent === null) {
      return;
    }
    await installEvent.prompt();
    await installEvent.userChoice;
    setInstallEvent(null);
  }

  return (
    <div
      role="region"
      aria-label="Instalar a aplicação"
      className="fixed inset-x-0 bottom-0 z-20 border-t border-slate-200 bg-white p-4 shadow-lg"
      style={{ paddingBottom: "max(1rem, env(safe-area-inset-bottom))" }}
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm text-slate-800">
          {installEvent === null
            ? `Para instalar o ${SITE.name}, toca em Partilhar e depois em "Adicionar ao ecrã principal".`
            : `Instala o ${SITE.name} no ecrã principal para o abrires mais depressa.`}
        </p>
        <div className="flex gap-2">
          {installEvent === null ? null : (
            <button
              type="button"
              onClick={() => void install()}
              className="rounded-lg bg-indigo-700 px-4 py-2 text-sm font-semibold text-white hover:bg-indigo-800"
            >
              Instalar
            </button>
          )}
          <button
            type="button"
            onClick={close}
            className="rounded-lg px-4 py-2 text-sm font-medium text-slate-700 ring-1 ring-slate-300"
          >
            Agora não
          </button>
        </div>
      </div>
    </div>
  );
}

function isInstallPrompt(event: Event): event is BeforeInstallPromptEvent {
  return "prompt" in event && typeof event.prompt === "function";
}

function subscribeNever(): () => void {
  return () => undefined;
}

/** Counts this visit once per browser session and returns the visits so far (0 when storage is blocked). */
function countVisit(): number {
  try {
    const visits = Number(localStorage.getItem(VISITS_KEY) ?? "0");
    if (sessionStorage.getItem(SESSION_KEY) !== null) {
      return visits;
    }
    sessionStorage.setItem(SESSION_KEY, "1");
    localStorage.setItem(VISITS_KEY, String(visits + 1));
    return visits + 1;
  } catch {
    return 0;
  }
}

function isStandalone(): boolean {
  const legacyIos = "standalone" in navigator && navigator.standalone === true;
  return legacyIos || window.matchMedia("(display-mode: standalone)").matches;
}

/** iPhone, iPad and iPadOS, which reports itself as a Mac with touch. */
function isIos(): boolean {
  return (
    /iPhone|iPad|iPod/.test(navigator.userAgent) ||
    (/Macintosh/.test(navigator.userAgent) && navigator.maxTouchPoints > 1)
  );
}

function wasDismissed(): boolean {
  try {
    return localStorage.getItem(DISMISSED_KEY) !== null;
  } catch {
    return false;
  }
}
