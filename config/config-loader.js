(async function () {
  var DEFAULT_CONFIG = {
    contact: {
      phone: "+48 600 123 456",
      whatsapp: "+48 600 123 456",
      email: "kontakt@skucha.pl"
    },
    pricing: {
      weekday: 40,
      weekend: 45,
      deliveryPerPad: 15
    },
    pickupPoints: [
      { name: "Stablowice", address: "ul. Przykladowa 12, 54-100 Wroclaw", enabled: true },
      { name: "Brochow", address: "ul. Przykladowa 8, 52-200 Wroclaw", enabled: false }
    ],
    branding: {
      accent: "#FB5A12",
      ink: "#1a1916"
    }
  };

  function merge(base, extra) {
    var out = Object.assign({}, base, extra || {});
    out.contact = Object.assign({}, base.contact || {}, (extra && extra.contact) || {});
    out.pricing = Object.assign({}, base.pricing || {}, (extra && extra.pricing) || {});
    out.branding = Object.assign({}, base.branding || {}, (extra && extra.branding) || {});
    out.pickupPoints = Array.isArray(extra && extra.pickupPoints) ? extra.pickupPoints : base.pickupPoints;
    return out;
  }

  function digits(value) {
    return String(value || "").replace(/\D/g, "");
  }

  function pageNameFromPath() {
    var path = window.location.pathname || "";
    var file = path.split("/").pop() || "";
    return file.replace(/\.html?$/i, "") || "index";
  }

  function replaceTextInNode(root, fromText, toText) {
    if (!root || !fromText || !toText || fromText === toText) {
      return;
    }

    var walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT);
    var current;
    while ((current = walker.nextNode())) {
      if (current.nodeValue && current.nodeValue.indexOf(fromText) !== -1) {
        current.nodeValue = current.nodeValue.split(fromText).join(toText);
      }
    }
  }

  function patchStaticContent(config) {
    var p1 = (config.pickupPoints && config.pickupPoints[0]) || {};
    var p2 = (config.pickupPoints && config.pickupPoints[1]) || {};

    replaceTextInNode(document.body, "Stabłowice", p1.name || "Stabłowice");
    replaceTextInNode(document.body, "Brochów", p2.name || "Brochów");
    replaceTextInNode(document.body, "ul. Przykładowa 12, 54-100 Wrocław", p1.address || "ul. Przykładowa 12, 54-100 Wrocław");
    replaceTextInNode(document.body, "ul. Przykładowa 8, 52-200 Wrocław", p2.address || "ul. Przykładowa 8, 52-200 Wrocław");

    if (config.contact && config.contact.email) {
      document.documentElement.setAttribute("data-contact-email", config.contact.email);
    }
  }

  function setRuntimeProps(config) {
    if (typeof window.__dcSetProps !== "function") {
      return false;
    }

    var p1 = (config.pickupPoints && config.pickupPoints[0]) || {};
    var p2 = (config.pickupPoints && config.pickupPoints[1]) || {};

    window.__dcSetProps(pageNameFromPath(), {
      priceWeekday: Number(config.pricing && config.pricing.weekday),
      priceWeekend: Number(config.pricing && config.pricing.weekend),
      deliveryFee: Number(config.pricing && config.pricing.deliveryPerPad),
      whatsappNumber: digits((config.contact && config.contact.whatsapp) || (config.contact && config.contact.phone)),
      accent: (config.branding && config.branding.accent) || "#FB5A12",
      ink: (config.branding && config.branding.ink) || "#1a1916",
      pickupPoint1Name: p1.name || "Stabłowice",
      pickupPoint1Address: p1.address || "ul. Przykładowa 12, 54-100 Wrocław",
      pickupPoint2Name: p2.name || "Brochów",
      pickupPoint2Address: p2.address || "ul. Przykładowa 8, 52-200 Wrocław"
    });

    return true;
  }

  async function loadConfig() {
    try {
      var response = await fetch("./config/config.json", { cache: "no-store" });
      if (!response.ok) {
        return DEFAULT_CONFIG;
      }
      var parsed = await response.json();
      return merge(DEFAULT_CONFIG, parsed);
    } catch (error) {
      console.warn("Config load failed, using defaults", error);
      return DEFAULT_CONFIG;
    }
  }

  var config = await loadConfig();
  window.SKUCHA_CONFIG = config;

  if (document.readyState === "loading") {
    await new Promise(function (resolve) {
      document.addEventListener("DOMContentLoaded", resolve, { once: true });
    });
  }

  var attempts = 0;
  var maxAttempts = 50;
  var interval = setInterval(function () {
    attempts += 1;
    var applied = setRuntimeProps(config);
    patchStaticContent(config);

    if (applied || attempts >= maxAttempts) {
      clearInterval(interval);
    }
  }, 100);
})();
