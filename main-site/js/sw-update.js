/* Service worker registration and the update prompt bar.
   One script, loaded on every page, registering once for the whole site. It
   needs the ServiceWorkerRegistration object to notice a waiting worker, which
   is why this is not an inline register() call in each page's markup.
   Plain script, not an ES module, matching the rest of this project.

   The rule the whole thing rests on: a new worker never activates on its own.
   It downloads, installs, and waits. Only the Reload button promotes it. */

(function () {
  var SW_URL = "/sw.js";

  var COPY = {
    label: "Update",
    ready: "A new version of Indonesia Bisa is ready.",
    reload: "Reload",
    later: "Not now",
  };

  var registration = null;
  var waitingWorker = null;
  var reloading = false;
  // For this page view only, never stored. "Not now" means not now.
  var dismissed = false;

  function render() {
    var existing = document.querySelector(".update-notice");

    if (!waitingWorker || dismissed) {
      if (existing) existing.remove();
      return;
    }
    if (existing) return;

    var bar = document.createElement("div");
    bar.className = "update-notice";
    // status, not alert: nothing is wrong, and an alert would interrupt a
    // screen reader mid-sentence to say the site is slightly newer.
    bar.setAttribute("role", "status");
    bar.setAttribute("aria-label", COPY.label);

    var inner = document.createElement("div");
    inner.className = "update-notice-inner";

    var text = document.createElement("p");
    text.textContent = COPY.ready;

    var reloadBtn = document.createElement("button");
    reloadBtn.type = "button";
    reloadBtn.className = "update-notice-btn";
    reloadBtn.setAttribute("data-sw-update", "");
    reloadBtn.textContent = COPY.reload;
    reloadBtn.addEventListener("click", function () {
      // The only place anything asks for skipWaiting. The reload happens on
      // controllerchange, not here: reloading now would race the worker and
      // bring the page back under the old one with the prompt still showing.
      if (waitingWorker) waitingWorker.postMessage("skip-waiting");
    });

    var laterBtn = document.createElement("button");
    laterBtn.type = "button";
    laterBtn.className = "update-notice-btn quiet";
    laterBtn.setAttribute("data-sw-later", "");
    laterBtn.textContent = COPY.later;
    laterBtn.addEventListener("click", function () {
      dismissed = true;
      render();
    });

    inner.appendChild(text);
    inner.appendChild(reloadBtn);
    inner.appendChild(laterBtn);
    bar.appendChild(inner);
    document.body.prepend(bar);
  }

  function watchForUpdate() {
    if (!registration) return;

    // A worker already waiting when the page opened. This is the ordinary
    // case on the second page view after a deploy; without it the prompt
    // would only reach somebody who had the page open at the moment the new
    // worker finished installing.
    if (registration.waiting && navigator.serviceWorker.controller) {
      waitingWorker = registration.waiting;
      render();
    }

    registration.addEventListener("updatefound", function () {
      var installing = registration.installing;
      if (!installing) return;

      installing.addEventListener("statechange", function () {
        // installed with a controller present means an update. installed
        // with no controller is a first install, which has nothing to prompt
        // about: there is no previous version on screen to protect.
        if (installing.state === "installed" && navigator.serviceWorker.controller) {
          waitingWorker = registration.waiting || installing;
          render();
        }
      });
    });
  }

  function registerWorker() {
    if (!("serviceWorker" in navigator)) return;

    navigator.serviceWorker
      .register(SW_URL)
      .then(function (reg) {
        registration = reg;
        watchForUpdate();
      })
      .catch(function (cause) {
        // A refused registration is not a reason to break the page. Private
        // browsing in some browsers, and any http origin that is not
        // localhost, land here.
        console.warn("service worker registration failed:", cause);
      });

    // The swap, once somebody has accepted it. The controller has changed by
    // this point, so the reload is served by the new worker and not the one
    // being replaced. Guarded because controllerchange can fire more than
    // once, and a second reload mid-navigation is a reload loop.
    navigator.serviceWorker.addEventListener("controllerchange", function () {
      if (reloading) return;
      reloading = true;
      window.location.reload();
    });
  }

  // Register on load, not immediately: installing fetches everything the
  // worker precaches, and starting that while the page is still fetching its
  // own assets makes a first visit slower for no gain.
  if (document.readyState === "complete") registerWorker();
  else window.addEventListener("load", registerWorker, { once: true });
})();
