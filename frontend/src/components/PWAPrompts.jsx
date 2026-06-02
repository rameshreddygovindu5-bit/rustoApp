import React, { useState, useEffect, useRef } from "react";
import { Download, RefreshCw, X } from "lucide-react";
import { RustoMark } from "./RustoLogo/RustoLogo";

/**
 * PWAPrompts — two small UI affordances that ride along on top of the
 * normal layout chrome:
 *
 *   1. **Install banner**: when the browser fires `beforeinstallprompt`,
 *      we capture it and surface a subtle "Install Rusto" pill that the
 *      user can dismiss. Re-shown 7 days after dismissal so we never feel
 *      naggy. Hidden once the app is already installed (detected via
 *      display-mode media query).
 *
 *   2. **Update toast**: the service-worker registration in index.html
 *      fires a custom `sw:update-available` event when a fresh worker is
 *      waiting. We listen and show a toast with a "Reload to update" CTA.
 *      Clicking it posts SKIP_WAITING to the worker; the controllerchange
 *      listener in index.html then triggers a one-time reload.
 *
 * Both states persist their "dismissed at" in localStorage so we don't
 * pester users across sessions.
 */

const INSTALL_DISMISS_KEY = "rusto_pwa_install_dismissed_at";
const INSTALL_RENAG_DAYS  = 7;

function isStandalone() {
  if (typeof window === "undefined") return false;
  // PWA on Android/Desktop:
  if (window.matchMedia?.("(display-mode: standalone)").matches) return true;
  // iOS Safari home-screen launches set navigator.standalone:
  if ("standalone" in window.navigator && window.navigator.standalone) return true;
  return false;
}

function isIos() {
  if (typeof navigator === "undefined") return false;
  // iPad on iPadOS reports MacIntel but exposes a touch UA quirk.
  const ua = navigator.userAgent || "";
  const isiPad = /iPad|Macintosh/.test(ua) && navigator.maxTouchPoints > 1;
  return /iPhone|iPod/.test(ua) || isiPad;
}

export default function PWAPrompts() {
  const [installEvent, setInstallEvent] = useState(null);     // captured beforeinstallprompt
  const [installVisible, setInstallVisible] = useState(false); // gating logic
  const [iosHintVisible, setIosHintVisible] = useState(false);
  const [updateWorker, setUpdateWorker] = useState(null);
  const [installing, setInstalling] = useState(false);
  const dismissedOnce = useRef(false);

  // ── beforeinstallprompt capture ────────────────────────────────
  useEffect(() => {
    if (isStandalone()) return; // already installed → nothing to prompt
    const dismissedAt = +localStorage.getItem(INSTALL_DISMISS_KEY) || 0;
    const daysSince = (Date.now() - dismissedAt) / 86_400_000;
    const cooledOff = daysSince > INSTALL_RENAG_DAYS;

    const onBeforeInstall = (e) => {
      // Stop the browser's mini-infobar; we'll surface our own UI.
      e.preventDefault();
      setInstallEvent(e);
      if (cooledOff) setInstallVisible(true);
    };
    window.addEventListener("beforeinstallprompt", onBeforeInstall);

    // iOS doesn't fire beforeinstallprompt. Show a hint instead — but
    // only after they've engaged a bit (deferred 8s) so it doesn't pop
    // immediately on every cold load.
    const iosTimer = setTimeout(() => {
      if (isIos() && !isStandalone() && cooledOff) setIosHintVisible(true);
    }, 8000);

    // Listen for install completion — Android fires `appinstalled`.
    const onInstalled = () => {
      setInstallVisible(false);
      setInstallEvent(null);
      setIosHintVisible(false);
    };
    window.addEventListener("appinstalled", onInstalled);

    return () => {
      window.removeEventListener("beforeinstallprompt", onBeforeInstall);
      window.removeEventListener("appinstalled", onInstalled);
      clearTimeout(iosTimer);
    };
  }, []);

  // ── Update-available listener ──────────────────────────────────
  useEffect(() => {
    const onUpdate = (e) => setUpdateWorker(e.detail?.worker || null);
    window.addEventListener("sw:update-available", onUpdate);
    return () => window.removeEventListener("sw:update-available", onUpdate);
  }, []);

  const dismissInstall = () => {
    localStorage.setItem(INSTALL_DISMISS_KEY, String(Date.now()));
    setInstallVisible(false);
    setIosHintVisible(false);
    dismissedOnce.current = true;
  };

  const triggerInstall = async () => {
    if (!installEvent) return;
    setInstalling(true);
    try {
      installEvent.prompt();
      const choice = await installEvent.userChoice;
      if (choice?.outcome === "dismissed") dismissInstall();
      else setInstallVisible(false);
    } finally {
      // The event can only be used once.
      setInstallEvent(null);
      setInstalling(false);
    }
  };

  const applyUpdate = () => {
    if (!updateWorker) return;
    updateWorker.postMessage({ type: "SKIP_WAITING" });
    // The controllerchange handler in index.html will reload the page
    // once the new worker takes over. Optimistically hide the toast.
    setUpdateWorker(null);
  };

  return (
    <>
      {/* Install banner (Android / Desktop Chromium) */}
      {installVisible && installEvent && (
        <InstallBanner installing={installing}
                        onInstall={triggerInstall}
                        onDismiss={dismissInstall}/>
      )}
      {/* iOS-specific hint (no programmatic install API) */}
      {iosHintVisible && !installVisible && (
        <IosInstallHint onDismiss={dismissInstall}/>
      )}
      {/* Update available toast */}
      {updateWorker && (
        <UpdateToast onApply={applyUpdate}
                      onDismiss={() => setUpdateWorker(null)}/>
      )}
    </>
  );
}


// ── Sub-components ────────────────────────────────────────────────

function InstallBanner({ installing, onInstall, onDismiss }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 animate-slide-up">
      <div className="bg-white rounded-2xl shadow-lux border border-gold/30 p-4 flex items-start gap-3">
        <RustoMark size={40} className="flex-shrink-0"/>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-navy text-sm">Install Rusto</p>
          <p className="text-2xs text-ink-500 mt-0.5">
            Get faster access — opens like an app, works on your home screen.
          </p>
          <div className="flex gap-2 mt-2">
            <button onClick={onInstall} disabled={installing}
                    className="btn-gold text-2xs px-3 py-1.5 flex items-center gap-1">
              <Download size={11}/> {installing ? "Installing…" : "Install"}
            </button>
            <button onClick={onDismiss} className="btn-ghost text-2xs px-3 py-1.5">
              Not now
            </button>
          </div>
        </div>
        <button onClick={onDismiss} className="text-ink-400 hover:text-ink-700 flex-shrink-0" aria-label="Dismiss">
          <X size={16}/>
        </button>
      </div>
    </div>
  );
}

function IosInstallHint({ onDismiss }) {
  return (
    <div className="fixed bottom-4 left-4 right-4 sm:left-auto sm:right-4 sm:max-w-sm z-50 animate-slide-up">
      <div className="bg-white rounded-2xl shadow-lux border border-gold/30 p-4 flex items-start gap-3">
        <RustoMark size={40} className="flex-shrink-0"/>
        <div className="flex-1 min-w-0">
          <p className="font-display font-bold text-navy text-sm">Add Rusto to Home Screen</p>
          <p className="text-2xs text-ink-500 mt-0.5 leading-relaxed">
            Tap <span className="inline-block px-1 py-0.5 bg-ink-100 rounded text-2xs font-mono">Share</span> in Safari, then <strong>Add to Home Screen</strong> for a full-screen app experience.
          </p>
        </div>
        <button onClick={onDismiss} className="text-ink-400 hover:text-ink-700 flex-shrink-0" aria-label="Dismiss">
          <X size={16}/>
        </button>
      </div>
    </div>
  );
}

function UpdateToast({ onApply, onDismiss }) {
  return (
    <div className="fixed top-4 left-1/2 -translate-x-1/2 z-50 animate-slide-down max-w-md w-[calc(100%-2rem)]">
      <div className="bg-navy text-white rounded-xl shadow-lifted border border-gold/40 px-4 py-3 flex items-center gap-3">
        <div className="w-8 h-8 rounded-lg bg-gold/20 flex items-center justify-center flex-shrink-0">
          <RefreshCw size={14} className="text-gold animate-spin"/>
        </div>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-semibold">Update available</p>
          <p className="text-2xs text-white/60">A new version of Rusto is ready.</p>
        </div>
        <button onClick={onApply} className="btn-gold text-2xs px-3 py-1.5 whitespace-nowrap">
          Reload
        </button>
        <button onClick={onDismiss} className="text-white/50 hover:text-white flex-shrink-0" aria-label="Dismiss">
          <X size={16}/>
        </button>
      </div>
    </div>
  );
}
