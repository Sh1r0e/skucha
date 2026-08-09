(function (window, document) {
  "use strict";

  var STATUS_URL = "/api/site-status";
  var MAINTENANCE_PAGE = "/under-construction.html";
  var localHostPattern = /^(localhost|127\.0\.0\.1|\[::1\])$/i;
  var productionHostPattern = /^(www\.)?skucha\.co$/i;
  var existingOperationPattern = /(?:skucha-payment-success|skucha-payment-cancel|reservation-cancel)\.html$/i;

  document.documentElement.setAttribute("data-site-status", "checking");

  var style = document.createElement("style");
  style.textContent = [
    "html[data-site-status=checking] body{visibility:hidden!important;pointer-events:none!important}",
    "html[data-site-status=checking]{background:#f5f4f1}",
    "html[data-site-status=maintenance] body{visibility:hidden!important;pointer-events:none!important}"
  ].join("");
  document.head.appendChild(style);

  function isLocalDevelopment() {
    return window.location.protocol === "file:" || localHostPattern.test(window.location.hostname);
  }

  function isProductionSite() {
    return productionHostPattern.test(window.location.hostname || "");
  }

  function maintenanceUrl() {
    var url = new URL(MAINTENANCE_PAGE, window.location.href);
    url.searchParams.set("from", window.location.pathname);
    return url.href;
  }

  function openSite() {
    document.documentElement.setAttribute("data-site-status", "open");
    return true;
  }

  function isExistingOperationPage() {
    return existingOperationPattern.test(window.location.pathname || "");
  }

  function redirectToMaintenance() {
    document.documentElement.setAttribute("data-site-status", "maintenance");
    window.location.replace(maintenanceUrl());
    return false;
  }

  function checkSiteStatus() {
    if (isExistingOperationPage()) {
      return Promise.resolve(openSite());
    }

    if (typeof window.fetch !== "function") {
      return Promise.resolve(isLocalDevelopment() || !isProductionSite() ? openSite() : redirectToMaintenance());
    }

    return fetch(STATUS_URL, {
      cache: "no-store",
      headers: { Accept: "application/json" }
    })
      .then(function (response) {
        if (!response.ok) {
          throw new Error("Site status request failed");
        }
        return response.json();
      })
      .then(function (payload) {
        if (!payload || typeof payload.maintenanceMode !== "boolean") {
          throw new Error("Site status response is invalid");
        }

        return payload.maintenanceMode ? redirectToMaintenance() : openSite();
      })
      .catch(function (error) {
        if (window.console && typeof window.console.error === "function") {
          window.console.error("SKUCHA site status check failed", error);
        }

        return isLocalDevelopment() || !isProductionSite() ? openSite() : redirectToMaintenance();
      });
  }

  window.SKUCHA_SITE_READY = checkSiteStatus();
})(window, document);
