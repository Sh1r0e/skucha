"use strict";

const fs = require("fs");
const path = require("path");

const workflowPath = path.resolve(
  __dirname,
  "../../..",
  ".github",
  "workflows",
  "azure-static-web-apps-witty-bush-0164ebc10.yml"
);
const {
  buildSite,
  outputRoot,
  publicDirectories,
  publicFiles
} = require("../../scripts/build-site");
const staticWebAppConfigPath = path.resolve(__dirname, "../../..", "staticwebapp.config.json");
const sourceSiteConfigPath = path.resolve(__dirname, "../../..", "config", "config.json");
const reservationPagePath = path.resolve(__dirname, "../../..", "skucha.html");
const paymentSuccessPagePath = path.resolve(__dirname, "../../..", "skucha-payment-success.html");
const reservationCancelPagePath = path.resolve(__dirname, "../../..", "reservation-cancel.html");
const adminReservationsConfigPath = path.resolve(__dirname, "../../admin/reservations/function.json");
const adminHousekeepingConfigPath = path.resolve(__dirname, "../../admin/housekeeping/function.json");

describe("deployment workflow", function () {
  it("should deploy only main to production and development-preview to a preview environment", function () {
    const workflow = fs.readFileSync(workflowPath, "utf8").replace(/\r\n/g, "\n");
    const uploadJobStart = workflow.indexOf("  build_and_deploy_job:");
    const uploadJobEnd = workflow.indexOf("\n  close_pull_request_job:");

    expect(workflow).toMatch(
      /^on:\n\x20{2}push:\n\x20{4}branches:\n\x20{6}- main\n\x20{6}- development-preview\n\x20{2}pull_request:/m
    );
    expect(uploadJobStart).toBeGreaterThan(-1);
    expect(uploadJobEnd).toBeGreaterThan(uploadJobStart);

    const uploadJob = workflow.slice(uploadJobStart, uploadJobEnd);

    expect(uploadJob).toMatch(/uses: Azure\/static-web-apps-deploy@v1/);
    expect(uploadJob).toMatch(/^\s+production_branch: "main"\s*$/m);
    expect(workflow).toMatch(/^permissions:\n\x20{2}contents: read\s*$/m);
    expect(workflow).not.toMatch(/^\x20{2}pull-requests: write\s*$/m);
    expect(uploadJob).toMatch(/^\x20{4}permissions:\n\x20{6}contents: read\n\x20{6}pull-requests: write\s*$/m);
    expect(uploadJob).toMatch(/npm run build:site/);
    expect(uploadJob).toMatch(/app_location: "site-dist"/);
    expect(uploadJob).toMatch(
      /SKUCHA_DEPLOYMENT_ENV: \$\{\{ github\.ref_name == 'main' && 'production' \|\| 'preview' \}\}/
    );
  });

  it("should_build_only_the_allowlisted_public_site_artifact()", function () {
    expect(publicDirectories).not.toContain("config");
    expect(publicFiles.filter(function (file) {
      return file.startsWith("config/");
    })).toEqual(["config/config-loader.js", "config/config.json"]);

    buildSite();

    const files = [];
    function collectFiles(directory) {
      fs.readdirSync(directory, { withFileTypes: true }).forEach(function (entry) {
        const relativePath = path.relative(outputRoot, path.join(directory, entry.name)).replace(/\\/g, "/");
        if (entry.isDirectory()) {
          collectFiles(path.join(directory, entry.name));
        } else {
          files.push(relativePath);
        }
      });
    }
    collectFiles(outputRoot);

    [
      "index.html",
      "skucha.html",
      "skucha-payment-success.html",
      "skucha-payment-cancel.html",
      "reservation-cancel.html",
      "rental-terms.html",
      "privacy-policy.html",
      "rental-terms-v1.0.pdf",
      "privacy-policy-v1.0.pdf",
      "admin/reservations.html",
      "config/config.json",
      "config/config-loader.js",
      "staticwebapp.config.json",
      "images/crash-pad-circuit.webp"
    ].forEach(function (requiredFile) {
      expect(files).toContain(requiredFile);
    });

    [
      "architecture.md",
      "README.md",
      "security-audit.md",
      "production-readiness.md",
      ".github",
      "api",
      "coverage",
      "changes",
      "changes-to-htmls.html"
    ].forEach(function (forbiddenPath) {
      expect(files.some(function (file) {
        return file === forbiddenPath || file.startsWith(forbiddenPath + "/");
      })).toBe(false);
    });
  });

  it("should_disable_turnstile_only_in_the_preview_site_artifact", function () {
    const sourceConfigBefore = fs.readFileSync(sourceSiteConfigPath, "utf8");

    buildSite({ deploymentEnvironment: "preview" });

    const previewConfig = JSON.parse(
      fs.readFileSync(path.join(outputRoot, "config", "config.json"), "utf8")
    );
    expect(previewConfig.botProtection.turnstileSiteKey).toBe("");
    expect(fs.readFileSync(sourceSiteConfigPath, "utf8")).toBe(sourceConfigBefore);

    buildSite({ deploymentEnvironment: "production" });
    const productionConfig = JSON.parse(
      fs.readFileSync(path.join(outputRoot, "config", "config.json"), "utf8")
    );
    expect(productionConfig.botProtection.turnstileSiteKey).not.toBe("");
  });

  it("should_show_payment_loading_and_human_readable_refund_outcomes", function () {
    const paymentSuccessPage = fs.readFileSync(paymentSuccessPagePath, "utf8");
    const reservationCancelPage = fs.readFileSync(reservationCancelPagePath, "utf8");

    expect(paymentSuccessPage).toContain('id="summaryLoading"');
    expect(paymentSuccessPage).toContain('aria-busy="true"');
    expect(paymentSuccessPage).toContain("finishSummaryLoading()");
    expect(paymentSuccessPage).toContain("showVerificationUnavailable()");
    expect(reservationCancelPage).toContain('refundStatus === "succeeded"');
    expect(reservationCancelPage).toContain('refundStatus === "pending"');
    expect(reservationCancelPage).toContain('refundStatus === "failed"');
    expect(reservationCancelPage).toContain("Stripe potwierdził pełny zwrot pieniędzy");
  });

  it("should_refresh_calendar_availability_when_the_reservation_tab_becomes_active", function () {
    const reservationPage = fs.readFileSync(reservationPagePath, "utf8");

    expect(reservationPage).toContain("loadMonthAvailability(this.state.calYear, this.state.calMonth, true)");
    expect(reservationPage).toContain("cache: 'no-store'");
    expect(reservationPage).toContain("window.addEventListener('focus', this._onAvailabilityFocus)");
    expect(reservationPage).toContain("document.addEventListener('visibilitychange', this._onAvailabilityVisibility)");
    expect(reservationPage).toContain("window.removeEventListener('focus', this._onAvailabilityFocus)");
    expect(reservationPage).toContain("document.removeEventListener('visibilitychange', this._onAvailabilityVisibility)");
  });

  it("should leave admin API authorization to the Function handlers", function () {
    const staticWebAppConfig = JSON.parse(fs.readFileSync(staticWebAppConfigPath, "utf8"));
    const adminApiRule = staticWebAppConfig.routes.find(function (route) {
      return route.route === "/api/admin*";
    });

    expect(adminApiRule).toBeUndefined();
  });

  it("should keep admin API routes outside the Static Web Apps admin namespace", function () {
    const reservationsConfig = JSON.parse(fs.readFileSync(adminReservationsConfigPath, "utf8"));
    const housekeepingConfig = JSON.parse(fs.readFileSync(adminHousekeepingConfigPath, "utf8"));
    const reservationsTrigger = reservationsConfig.bindings.find(function (binding) {
      return binding.type === "httpTrigger";
    });
    const housekeepingTrigger = housekeepingConfig.bindings.find(function (binding) {
      return binding.type === "httpTrigger";
    });

    expect(reservationsTrigger.route).toBe("backoffice/reservations");
    expect(housekeepingTrigger.route).toBe("backoffice/housekeeping");
  });

  it("should_apply_global_browser_security_headers_and_protect_payment_pages", function () {
    const staticWebAppConfig = JSON.parse(fs.readFileSync(staticWebAppConfigPath, "utf8"));
    const headers = staticWebAppConfig.globalHeaders;

    expect(headers["Content-Security-Policy"]).toContain("frame-ancestors 'none'");
    expect(headers["Strict-Transport-Security"]).toContain("max-age=31536000");
    expect(headers["X-Content-Type-Options"]).toBe("nosniff");
    expect(headers["X-Frame-Options"]).toBe("DENY");
    expect(headers["Permissions-Policy"]).toContain("camera=()");

    ["/skucha-payment-success.html", "/skucha-payment-cancel.html"].forEach(function (routePath) {
      const route = staticWebAppConfig.routes.find(function (candidate) {
        return candidate.route === routePath;
      });

      expect(route.headers["Cache-Control"]).toBe("no-store");
      expect(route.headers["Referrer-Policy"]).toBe("no-referrer");
    });
  });
});
