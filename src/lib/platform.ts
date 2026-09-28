/**
 * Where the app is running, decided once at start. Every module used to work this out for
 * itself from `window` and the user agent; they all import it from here now.
 */

/** Inside the Tauri app (desktop or Android), not a plain browser. */
export const isTauri = typeof window !== "undefined" && "__TAURI_INTERNALS__" in window;

const ua = typeof navigator !== "undefined" ? navigator.userAgent : "";

/** An Android device (the app's WebView, or a browser on a phone). */
export const isAndroid = /android/i.test(ua);

/** A phone or tablet: Android, iPhone or iPad. */
export const isMobile = isAndroid || /iphone|ipad|ipod/i.test(ua);

/** Linux on the desktop, i.e. a WebKitGTK webview in the app. Android says "Linux" too. */
export const isLinuxDesktop = /linux/i.test(ua) && !isMobile;

/** The Android app: the native audio plugin, Android Auto, the phone's voice. */
export const isTauriAndroid = isTauri && isAndroid;
