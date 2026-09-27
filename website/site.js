// breadoflife.dev: small progressive enhancements. The page works without this file:
// every download link already points at the latest GitHub release.
(function () {
  "use strict";

  var REPO = "matt-shearing/bread-of-life";
  var CACHE_KEY = "bol-latest-release";
  var ASSETS = {
    apk: /\.apk$/i,
    appimage: /\.AppImage$/i,
    deb: /\.deb$/i,
    exe: /setup\.exe$/i,
    dmg: /\.dmg$/i,
  };

  function mb(bytes) {
    return Math.round(bytes / 1048576) + " MB";
  }

  function apply(release) {
    if (!release || !release.tag_name) return;
    var version = String(release.tag_name).replace(/^v/, "");
    document.querySelectorAll("[data-version]").forEach(function (el) {
      el.textContent = version;
    });
    var assets = release.assets || [];
    Object.keys(ASSETS).forEach(function (key) {
      var asset = assets.filter(function (a) { return ASSETS[key].test(a.name); })[0];
      if (!asset) return;
      document.querySelectorAll('[data-asset="' + key + '"]').forEach(function (a) {
        a.href = asset.browser_download_url;
      });
      document.querySelectorAll('[data-size="' + key + '"]').forEach(function (s) {
        s.textContent = mb(asset.size);
      });
    });
  }

  function readCache() {
    try {
      var c = JSON.parse(sessionStorage.getItem(CACHE_KEY) || "null");
      return c && Date.now() - c.at < 30 * 60 * 1000 ? c.release : null;
    } catch (e) {
      return null;
    }
  }

  var cached = readCache();
  if (cached) {
    apply(cached);
  } else if (window.fetch) {
    fetch("https://api.github.com/repos/" + REPO + "/releases/latest", {
      headers: { Accept: "application/vnd.github+json" },
    })
      .then(function (r) { return r.ok ? r.json() : null; })
      .then(function (json) {
        if (!json) return;
        var slim = {
          tag_name: json.tag_name,
          assets: (json.assets || []).map(function (a) {
            return { name: a.name, size: a.size, browser_download_url: a.browser_download_url };
          }),
        };
        try { sessionStorage.setItem(CACHE_KEY, JSON.stringify({ at: Date.now(), release: slim })); } catch (e) {}
        apply(slim);
      })
      .catch(function () { /* keep the static links */ });
  }

  // Mark the download card that matches this device.
  var ua = navigator.userAgent || "";
  var os = /Android/i.test(ua) ? "android"
    : /iPhone|iPad|iPod/i.test(ua) ? null
    : /Mac OS X|Macintosh/i.test(ua) ? "mac"
    : /Windows/i.test(ua) ? "windows"
    : /Linux|X11|CrOS/i.test(ua) ? "linux"
    : null;
  if (os) {
    var card = document.querySelector('.platform[data-os="' + os + '"]');
    if (card) card.classList.add("this-device");
  }

  // Copy buttons.
  if (navigator.clipboard) {
    document.querySelectorAll("[data-copy]").forEach(function (btn) {
      btn.hidden = false;
      btn.addEventListener("click", function () {
        var src = document.getElementById(btn.getAttribute("data-copy"));
        if (!src) return;
        navigator.clipboard.writeText(src.textContent.trim()).then(function () {
          btn.textContent = "Copied";
          setTimeout(function () { btn.textContent = "Copy"; }, 1600);
        });
      });
    });
  }

  // Hairline under the header once the page has scrolled.
  var header = document.querySelector(".site-header");
  if (header) {
    var onScroll = function () { header.classList.toggle("scrolled", window.scrollY > 8); };
    window.addEventListener("scroll", onScroll, { passive: true });
    onScroll();
  }
})();
