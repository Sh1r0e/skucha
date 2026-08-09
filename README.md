# skucha

Website for renting climbing crash pads in Wroclaw.

This project is intentionally lightweight:

- Azure Static Web Apps
- static HTML/CSS/JavaScript frontend
- Azure Functions integrated in `/api`
- no bundlers

## Architecture

Frontend responsibilities:

- render UI
- perform basic form validation
- call API endpoints
- check `/api/site-status` before exposing new booking interactions
- keep existing payment and cancellation operations available during maintenance

Backend responsibilities:

- validate reservation payloads
- check availability
- persist reservations in Azure Table Storage
- serialize reservation creation with the inventory lease
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
- `GET|POST /api/admin/reservations` (Static Web Apps `admin` role)
- `POST /api/admin/housekeeping` (Static Web Apps `admin` role)

## Checkout and Email Lifecycle

1. `POST /api/reservation` acquires the inventory lease, re-checks availability, saves a `Pending` reservation, creates a Stripe Checkout session, stores payment/cancellation data, and sends the checkout-start email.
2. `checkout.session.completed` is durably deduplicated. A paid `Pending` reservation becomes `Confirmed`; late events never resurrect `Cancelled`, `Expired`, `InProgress`, or `Completed` reservations.
3. `checkout.session.expired` conditionally changes unpaid `Pending` reservations to `Expired` and releases inventory.
4. The emailed cancellation link opens a confirmation page. Only its explicit `POST /api/reservation/cancel` request can mutate state. Cancellation is allowed through 24 hours before rental start in `Europe/Warsaw`; paid refunds use Stripe idempotency and `CancellationPending` recovery.
5. Staff use `/admin/reservations.html` to move `Confirmed` reservations to `InProgress` at collection and to `Completed` after all pads are returned.

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
			ReservationRepository.js
			StripeEventRepository.js

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

Stripe runtime settings are provided via environment variables in Azure Functions:

- `STRIPE_SECRET_KEY` - Stripe sandbox/live secret key (`sk_test_...` in sandbox)
- `STRIPE_CHECKOUT_SUCCESS_URL` - full URL where Stripe redirects after successful payment
- `STRIPE_CHECKOUT_CANCEL_URL` - full URL where Stripe redirects after canceled payment
- `STRIPE_WEBHOOK_SECRET` - Stripe webhook signing secret for `/api/stripe-webhook`

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
- `ACS_SENDER_ADDRESS` - sender address (for example `noreply@skucha.co`)

### Maintenance Mode

The public site has a fail-closed maintenance gate. Set `MAINTENANCE_MODE` to `true` in the production Static Web App application settings, save the setting, and restart the app. New booking pages and availability/reservation-creation calls are blocked with `503 Service Unavailable` and `code: "MaintenanceMode"`.

Set `MAINTENANCE_MODE` to `false` or remove it and restart the app to reopen the site. The `/api/site-status` endpoint remains available so the frontend can make this decision without exposing the environment variable. Payment result, reservation lookup, cancellation, housekeeping, and Stripe webhook operations remain available for existing workflows.

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
3. Use the exact MailFrom address shown for the linked domain, for example `noreply@skucha.co`, as the sender address.
4. In `skucha-communication-services`, select **Keys** and copy the **Primary connection string**. Treat it as a secret; do not commit it or paste it into source control.
5. Open `skucha-web`, select **Configuration**, then **Application settings**, and add these settings for the production environment:
	- `MAIL_MODE` = `acs-email`
	- `SKUCHA_ENV` = `production`
	- `ACS_CONNECTION_STRING` = the copied Primary connection string
	- `ACS_SENDER_ADDRESS` = `noreply@skucha.co`
	- `RESERVATION_PUBLIC_BASE_URL` = the public `skucha-web` domain
	- `RESERVATION_CANCEL_TOKEN_SECRET` = a long random secret
	- `RESERVATION_CANCELLATION_CUTOFF_HOURS` = `24`
	- `RESERVATION_PENDING_EXPIRY_HOURS` = `2`
	- `RESERVATION_TIMEZONE` = `Europe/Warsaw`
	- `HOUSEKEEPING_SECRET` = a separate long random secret
	- `INVENTORY_LEASE_TTL_MS` = `30000`
6. Save the settings and restart the Static Web App. For `development-preview`, add the same settings under the preview environment's configuration; Static Web Apps does not automatically copy production application settings to branch environments. Send a test reservation in Stripe test mode and confirm both the checkout-start email and the paid confirmation email arrive.

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
- `api_location: "api"`
- `output_location: "/"`
- Node.js `22` for quality checks and API dependency installation

## Roadmap

1. Static website, reservations, payments, and email notifications
2. Availability with Table Storage persistence and inventory lease
3. Cancellation cutoff, refund recovery, and pending housekeeping
4. Protected collection/return admin workflow
5. Monitoring, backup/restore, retention, and external rate limiting
