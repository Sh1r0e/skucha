(function () {
  "use strict";

  var appState = {
    config: null
  };

  function byId(id) {
    return document.getElementById(id);
  }

  function setText(id, value) {
    var el = byId(id);
    if (el) {
      el.textContent = value;
    }
  }

  function setStatus(id, message, kind) {
    var el = byId(id);
    if (!el) {
      return;
    }

    el.textContent = message;
    el.className = "status" + (kind ? " " + kind : "");
  }

  function renderFaq(faqItems) {
    var root = byId("faqList");
    if (!root) {
      return;
    }

    root.innerHTML = "";

    (faqItems || []).forEach(function (item) {
      var wrapper = document.createElement("article");
      wrapper.className = "faq-item";

      var title = document.createElement("h3");
      title.textContent = item.question || "Pytanie";

      var body = document.createElement("p");
      body.textContent = item.answer || "";

      wrapper.appendChild(title);
      wrapper.appendChild(body);
      root.appendChild(wrapper);
    });
  }

  function renderPickupOptions(points) {
    var select = byId("pickupPoint");
    if (!select) {
      return;
    }

    select.innerHTML = "";

    (points || [])
      .filter(function (point) {
        return point && point.enabled !== false;
      })
      .forEach(function (point) {
        var option = document.createElement("option");
        option.value = point.name;
        option.textContent = point.name + " - " + point.address;
        select.appendChild(option);
      });
  }

  function renderConfig(config) {
    setText("businessName", config.business && config.business.name ? config.business.name : "Skucha");
    setText("cityName", config.business && config.business.city ? config.business.city : "Wroclaw");
    setText("phoneNumber", config.contact && config.contact.phone ? config.contact.phone : "-");
    setText("emailAddress", config.contact && config.contact.email ? config.contact.email : "-");
    setText("weekdayPrice", String(config.pricing && config.pricing.weekday ? config.pricing.weekday : 0));
    setText("weekendPrice", String(config.pricing && config.pricing.weekend ? config.pricing.weekend : 0));
    setText("deliveryPrice", String(config.pricing && config.pricing.deliveryPerPad ? config.pricing.deliveryPerPad : 0));
    renderPickupOptions(config.pickupPoints);
    renderFaq(config.faq);
  }

  function parseDateInput(value) {
    var timestamp = Date.parse(value);
    if (Number.isNaN(timestamp)) {
      return null;
    }
    return new Date(timestamp);
  }

  function validateReservationInput(data) {
    if (!data.fullName || !data.email || !data.phone || !data.pickupPoint) {
      return "Wypelnij wszystkie wymagane pola.";
    }

    var fromDate = parseDateInput(data.dateFrom);
    var toDate = parseDateInput(data.dateTo);

    if (!fromDate || !toDate) {
      return "Podaj poprawny zakres dat.";
    }

    if (fromDate.getTime() > toDate.getTime()) {
      return "Data odbioru nie moze byc pozniejsza niz data zwrotu.";
    }

    if (!data.acceptTerms) {
      return "Musisz zaakceptowac regulamin.";
    }

    return null;
  }

  function getFormData() {
    return {
      fullName: byId("fullName").value.trim(),
      email: byId("email").value.trim(),
      phone: byId("phone").value.trim(),
      dateFrom: byId("dateFrom").value,
      dateTo: byId("dateTo").value,
      padsCount: Number(byId("padsCount").value),
      pickupPoint: byId("pickupPoint").value,
      notes: byId("notes").value.trim(),
      acceptTerms: byId("acceptTerms").checked
    };
  }

  async function checkAvailability() {
    var dateFrom = byId("dateFrom").value;
    var dateTo = byId("dateTo").value;

    if (!dateFrom || !dateTo) {
      setStatus("availabilityStatus", "Najpierw wybierz daty.", "warn");
      return;
    }

    setStatus("availabilityStatus", "Sprawdzam dostepnosc...", "");

    try {
      var response = await fetch("/api/availability?from=" + encodeURIComponent(dateFrom) + "&to=" + encodeURIComponent(dateTo));
      var payload = await response.json();

      if (!response.ok) {
        setStatus("availabilityStatus", payload.message || "Nie udalo sie pobrac dostepnosci.", "error");
        return;
      }

      if (payload.available) {
        setStatus("availabilityStatus", "Termin jest dostepny. Mozesz przejsc do rezerwacji.", "ok");
      } else {
        setStatus("availabilityStatus", payload.message || "Termin jest niedostepny.", "warn");
      }
    } catch (error) {
      setStatus("availabilityStatus", "Blad polaczenia z API.", "error");
    }
  }

  async function submitReservation(event) {
    event.preventDefault();

    var data = getFormData();
    var validationError = validateReservationInput(data);

    if (validationError) {
      setStatus("reservationStatus", validationError, "warn");
      return;
    }

    setStatus("reservationStatus", "Wysylam rezerwacje...", "");

    try {
      var response = await fetch("/api/reservation", {
        method: "POST",
        headers: {
          "Content-Type": "application/json"
        },
        body: JSON.stringify(data)
      });

      var payload = await response.json();

      if (!response.ok) {
        setStatus("reservationStatus", payload.message || "Rezerwacja odrzucona.", "error");
        return;
      }

      setStatus("reservationStatus", payload.message || "Rezerwacja przyjeta.", "ok");
      byId("reservationForm").reset();
    } catch (error) {
      setStatus("reservationStatus", "Blad polaczenia z API.", "error");
    }
  }

  async function bootstrap() {
    try {
      appState.config = await window.ConfigLoader.loadConfig();
      renderConfig(appState.config);
      setStatus("availabilityStatus", "Wybierz daty i kliknij Sprawdz dostepnosc.", "");
      setStatus("reservationStatus", "", "");
    } catch (error) {
      setStatus("reservationStatus", "Nie udalo sie zaladowac konfiguracji.", "error");
    }

    byId("checkAvailabilityBtn").addEventListener("click", checkAvailability);
    byId("reservationForm").addEventListener("submit", submitReservation);
  }

  document.addEventListener("DOMContentLoaded", bootstrap);
})();
