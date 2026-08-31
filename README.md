# skucha

Website for renting climbing crash pads in Wroclaw.

See [security-audit.md](security-audit.md) for the current release security decision, open infrastructure controls, refined requirements, and implementation plan.

This project is intentionally lightweight:

- Azure Static Web Apps
- static HTML/CSS/JavaScript frontend
- Azure Functions integrated in `/api`
- API deployment bundle generated with esbuild
- Static site artifact generated with `npm run build:site` from an explicit allowlist, local React bundle, and precompiled component logic

## Architecture

Frontend responsibilities:

- render UI
- perform basic form validation
- call API endpoints
- check `/api/site-status` before exposing new booking interactions
- show the maintenance page while every operational API, including payment and cancellation processing, fails closed

Backend responsibilities:

- validate reservation payloads
- check availability
- persist reservations in Azure Table Storage
- upsert explicitly opted-in email addresses into the `MarketingContacts` Azure Table
- serialize reservation creation with the inventory lease
- enforce production request idempotency and persist versioned legal-consent evidence
- send checkout-stage, payment, and cancellation notifications through Azure Communication Services Email
- create Stripe Checkout sessions for reservation payments

Never trust frontend input. Reservation acceptance is backend-controlled.

## Endpoints

- `GET /api/availability`
- `POST /api/reservation`
- `GET /api/reservation?id={reservationId}&session_id={stripeSessionId}` (minimal status projection)
- `POST /api/stripe-webhook`
- `POST /api/reservation/cancel`
- `GET /api/site-status`
- `POST /api/internal/housekeeping` (scheduler secret)
- `GET|POST /api/backoffice/reservations` (API-enforced `admin` role)
- `POST /api/backoffice/housekeeping` (API-enforced `admin` role)

Signing in with Microsoft Entra ID grants the built-in `authenticated` role; staff must also receive the custom `admin` role through Static Web Apps Role Management to load the admin page. The admin API handlers independently validate the same role from `x-ms-client-principal`.

## Checkout and Email Lifecycle

1. `POST /api/reservation` validates the required legal acknowledgements, claims the production `Idempotency-Key`, acquires the inventory lease, re-checks availability, saves a `Pending` reservation with consent evidence, creates a Stripe Checkout session, stores payment/cancellation data, and sends the checkout-start email.
2. `checkout.session.completed` is durably deduplicated. A paid `Pending` reservation becomes `Confirmed`; the customer receives confirmation and staff receive a separate operational alert. Late events never resurrect `Cancelled`, `Expired`, `InProgress`, or `Completed` reservations.
3. The payment-success page polls the reservation endpoint. If webhook delivery is delayed, the API retrieves the matching Checkout session and conditionally reconciles a paid `Pending` reservation after validating its reservation ID, session ID, amount, currency, and mode.
4. `checkout.session.expired` conditionally changes unpaid `Pending` reservations to `Expired` and releases inventory.
5. The emailed cancellation link opens a confirmation page. Only its explicit `POST /api/reservation/cancel` request can mutate state. Cancellation is allowed through 24 hours before rental start in `Europe/Warsaw`; paid refunds use Stripe idempotency and `CancellationPending` recovery.
6. Staff use `/admin/reservations.html` to move `Confirmed` reservations to `InProgress` at collection and to `Completed` after all pads are returned.

Published legal documents:

- `/rental-terms.html` and `/rental-terms-v1.0.pdf`
- `/privacy-policy.html` and `/privacy-policy-v1.0.pdf`
- The paid confirmation email attaches both versioned PDFs. The withdrawal form is included in the rental-terms document.

The Stripe webhook must be configured to send `checkout.session.completed` and `checkout.session.expired` events to `/api/stripe-webhook`. Webhook failures return a non-2xx response so Stripe retries delivery.

Reservation statuses:

- `Pending` - checkout/payment is not finalized; blocks inventory until expiry.
- `Confirmed` - paid and awaiting collection; blocks inventory.
- `CancellationPending` - refund saga is in progress; blocks inventory.
- `InProgress` - pads are with the customer; blocks inventory until return.
- `Completed` - all pads returned; terminal and releases inventory.
- `Cancelled` - reservation cancelled; terminal and releases inventory.
- `Expired` - unpaid checkout expired; terminal and releases inventory.

## Repository Layout

```text
/
	index.html
	styles.css
	script.js

	config/
		config.json
		config-loader.js

	assets/
	images/

	api/
		host.json
		package.json
		admin/
			housekeeping/
			reservations/
		internal/
			housekeeping/
		repositories/
			InventoryLeaseRepository.js
			MarketingContactRepository.js
			ReservationIdempotencyRepository.js
			ReservationRepository.js
			StripeEventRepository.js
		legal/
			rental-terms-v1.0.pdf
			privacy-policy-v1.0.pdf

		reservation/
			index.js
			function.json

		availability/
			index.js
			function.json

		services/
			ReservationService.js
			AvailabilityService.js
			AdminReservationService.js
			HousekeepingService.js
			ReservationLifecycleService.js
			ReservationTimeService.js
			MailService.js
			ConfigService.js

		models/
			Reservation.js
```

## Configuration

Editable business data is in `config/config.json`, including:

- pricing
- contact data
- pickup locations
- FAQ
- business name/city
- total pads for availability

Frontend loads config through `config/config-loader.js`.

Backend also reads `config/config.json` through `api/services/ConfigService.js`.

### Bot Protection

Public booking APIs use distributed fixed-window limits stored in the existing Azure Table Storage account. Client addresses are HMAC-hashed before storage; raw addresses and customer data are not written to the `AbuseProtection` table. The limits are 120 availability requests per minute, 60 reservation lookups per five minutes, and 10 booking or cancellation requests per five minutes for each hashed address. One entity is reused per policy and address, so repeated windows do not continually add rows.

Production reservation creation also requires a Cloudflare Turnstile token that is verified server-side for the `reservation` action and the hostname from `RESERVATION_PUBLIC_BASE_URL`. The deployment workflow disables the widget and server verification in preview artifacts; distributed rate limiting remains enabled.

1. In Cloudflare Turnstile, create a free widget and allow the canonical production hostname.
2. Put the public site key in `botProtection.turnstileSiteKey` in `config/config.json`. This value is intentionally public.
3. Add `TURNSTILE_SECRET_KEY` to the Static Web App application settings. Never put this secret in `config/config.json` or source control.
4. Generate a separate random value of at least 32 characters for `RATE_LIMIT_HASH_SECRET` and add it to the application settings. It must differ from the Turnstile, cancellation, and housekeeping secrets.
5. Save the settings and restart the app. Preview deployments do not require Turnstile configuration.
6. Verify a normal booking and an automated burst in the deployed environment. Confirm excess requests receive a generic `429` and verify which platform-provided forwarding header contains the real client address.

These controls make automated form spam and repeated API abuse more expensive at near-zero additional infrastructure cost. They run inside Azure Functions, so they do not absorb volumetric attacks before requests consume Static Web Apps or Functions quota and are not a replacement for an edge WAF or DDoS service. Addresses that are never seen again leave one small row per policy; plan a periodic retention purge if distinct-client growth becomes material.

Stripe runtime settings are provided via environment variables in Azure Functions:

- `STRIPE_SECRET_KEY` - Stripe sandbox/live secret key (`sk_test_...` in sandbox)
- `STRIPE_CHECKOUT_SUCCESS_URL` - full URL where Stripe redirects after successful payment
- `STRIPE_CHECKOUT_CANCEL_URL` - full URL where Stripe redirects after canceled payment
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret for `/api/stripe-webhook`

Production configuration validation also requires a canonical HTTPS public base URL, same-origin HTTPS Stripe return URLs containing `{CHECKOUT_SESSION_ID}`, a live `sk_live_` Stripe key, a `whsec_` webhook secret, and strong distinct values for `RESERVATION_CANCEL_TOKEN_SECRET` and `HOUSEKEEPING_SECRET`. The production dependency audit is enforced in CI; the audit document records the remaining Azure transitive exceptions and their runtime compatibility constraint.

The canonical production origin is `https://www.skucha.co`. Production configuration rejects another origin, and the main deployment probes canonical application routes plus same-path redirects from `https://skucha.co`. The apex redirect is managed by GoDaddy DNS/forwarding and must preserve each request path.

Cancellation link settings:

- `RESERVATION_PUBLIC_BASE_URL` - public app base URL used to build cancellation links (for example `https://www.skucha.co`)
- `RESERVATION_CANCEL_TOKEN_SECRET` - HMAC secret used to sign cancellation links
- `RESERVATION_CANCELLATION_CUTOFF_HOURS` - minimum notice required for cancellation (default `24`)
- `RESERVATION_PENDING_EXPIRY_HOURS` - unpaid Pending lifetime before housekeeping expires it (default `2`)
- `RESERVATION_TIMEZONE` - calendar timezone for rental/cancellation rules (default `Europe/Warsaw`)
- `INVENTORY_LEASE_TTL_MS` - inventory creation lease lifetime in milliseconds (default `30000`)

Housekeeping and admin settings:

- `SKUCHA_ENV` - set to `production` to enable required-runtime configuration validation
- `HOUSEKEEPING_SECRET` - high-entropy secret sent by the scheduled housekeeping workflow
- assign the custom Static Web Apps `admin` role to staff through the SWA invitations/authentication flow

Azure Communication Service email settings:

- `MAIL_MODE` - set to `acs-email` to send real emails (`log-only` keeps local placeholder behavior)
- `ACS_CONNECTION_STRING` - connection string for ACS Email resource
- `ACS_SENDER_ADDRESS` - sender address (for example `rental@skucha.co`)
- `PAID_RESERVATION_NOTIFY_EMAILS` - comma-separated staff recipients for paid-reservation alerts (defaults to `kubagrech@gmail.com,kacperbednarz@icloud.com`)

### Maintenance Mode

The public site has a fail-closed maintenance gate. Set `MAINTENANCE_MODE` to `true` in the production Static Web App application settings, save the setting, and restart the app. Every operational API endpoint is blocked with `503 Service Unavailable` and `code: "MaintenanceMode"` before authentication, storage, payment, or housekeeping work begins.

Set `MAINTENANCE_MODE` to `false` or remove it and restart the app to reopen the site. Only `/api/site-status` remains available so the frontend can make this decision without exposing the environment variable.

For local development, omit the variable or set `MAINTENANCE_MODE=false` in `api/local.settings.json`. To exercise the maintenance screen locally, set it to `true` and run the frontend through the local Static Web Apps/Functions host so `/api/site-status` is available.

### Azure Portal Setup

The repository uses the resources shown in the deployment subscription:

- `skucha-communication-services` supplies the Communication Services connection string.
- `skucha-communication-email-services` owns the Email Communication Services configuration.
- `skucha.co` is the configured email domain.
- `skucha-web` hosts the Static Web App and integrated Functions API.

Configure ACS email in the Azure portal:

1. Open `skucha-communication-email-services` and open the `MailFrom` or Domains area. Confirm that the `skucha.co` domain is provisioned and verified. Do not continue until its status is ready.
2. Open `skucha-communication-services`, open **Email** or **Domains**, and connect the verified `skucha.co` domain from `skucha-communication-email-services`. The domain must show as linked or connected to this Communication Services resource; verification in the Email resource alone is not sufficient.
3. Use the exact MailFrom address shown for the linked domain, for example `rental@skucha.co`, as the sender address.
4. In `skucha-communication-services`, select **Keys** and copy the **Primary connection string**. Treat it as a secret; do not commit it or paste it into source control.
5. Open `skucha-web`, select **Configuration**, then **Application settings**, and add these settings for the production environment:
	- `MAIL_MODE` = `acs-email`
	- `SKUCHA_ENV` = `production`
	- `ACS_CONNECTION_STRING` = the copied Primary connection string
	- `ACS_SENDER_ADDRESS` = `rental@skucha.co`
	- `RESERVATION_PUBLIC_BASE_URL` = the public `skucha-web` domain
	- `RESERVATION_CANCEL_TOKEN_SECRET` = a long random secret
	- `RESERVATION_CANCELLATION_CUTOFF_HOURS` = `24`
	- `RESERVATION_PENDING_EXPIRY_HOURS` = `2`
	- `RESERVATION_TIMEZONE` = `Europe/Warsaw`
	- `HOUSEKEEPING_SECRET` = a separate long random secret
	- `INVENTORY_LEASE_TTL_MS` = `30000`
	- `TURNSTILE_SECRET_KEY` = the secret for the production Cloudflare Turnstile widget
	- `RATE_LIMIT_HASH_SECRET` = a separate random secret of at least 32 characters
6. Save the settings and restart the Static Web App. For `development-preview`, add the non-Turnstile settings under the preview environment's configuration; Static Web Apps does not automatically copy production application settings to branch environments. The workflow builds preview artifacts with Turnstile disabled. Send a test reservation in Stripe test mode and confirm both the checkout-start email and the paid confirmation email arrive.

Create GitHub repository secrets `SKUCHA_PUBLIC_BASE_URL` and `HOUSEKEEPING_SECRET` for the scheduled workflow in `.github/workflows/housekeeping.yml`. Configure Stripe to send `checkout.session.completed` and `checkout.session.expired` to `/api/stripe-webhook`.

For local development, use the same variable names in `api/local.settings.json`; keep that file out of version control.

Example local values (`local.settings.json` for Functions runtime):

```json
{
	"Values": {
		"STRIPE_SECRET_KEY": "sk_test_xxx",
		"STRIPE_CHECKOUT_SUCCESS_URL": "https://localhost:4280/skucha-payment-success.html?session_id={CHECKOUT_SESSION_ID}",
		"STRIPE_CHECKOUT_CANCEL_URL": "https://localhost:4280/skucha-payment-cancel.html?session_id={CHECKOUT_SESSION_ID}"
	}
}
```

For Azure Static Web Apps production, use your deployed domain with the same paths.

## Azure Static Web Apps Workflow

Current GitHub Actions workflow uses:

- `app_location: "/"`
- `api_location: "api-dist"` with `skip_api_build: true`
- `output_location: "/"`
- Node.js `22` for quality checks and API dependency installation
- runtime compatibility checks on Node.js `22` and `24`
- published-version checks, production dependency install, Function entrypoint verification, and API bundle builds before deployment

`main` is the only production branch. `development-preview` is deployed to its branch preview environment. Keep `production_branch: "main"` in the upload job; the deployment test fails if this routing guard is removed.

## Roadmap

1. Static website, reservations, payments, and email notifications
2. Availability with Table Storage persistence and inventory lease
3. Cancellation cutoff, refund recovery, and pending housekeeping
4. Protected collection/return admin workflow
5. Monitoring, backup/restore, retention, and optional edge WAF protection
