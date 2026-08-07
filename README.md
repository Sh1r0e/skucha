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

Backend responsibilities:

- validate reservation payloads
- check availability
- prevent double booking (currently in-memory, phase 3 will move to Azure Table Storage)
- send checkout-stage, payment, and cancellation notifications through Azure Communication Services Email
- create Stripe Checkout sessions for reservation payments

Never trust frontend input. Reservation acceptance is backend-controlled.

## Endpoints

- `GET /api/availability`
- `POST /api/reservation`
- `GET /api/reservation?id={reservationId}`
- `POST /api/stripe-webhook`
- `GET /api/reservation/cancel?reservation_id={reservationId}&token={token}`
- `POST /api/reservation/cancel`

## Checkout and Email Lifecycle

1. `POST /api/reservation` saves the complete reservation, creates a Stripe Checkout session, stores the payment and cancellation data, and sends the checkout-start email.
2. `checkout.session.completed` updates the reservation. Paid sessions send the final confirmation email with the customer, rental, payment, and cancellation details. Pending sessions send a payment-status update.
3. `checkout.session.expired` marks the payment as expired and sends a status email.
4. The cancellation link verifies the signed reservation and Stripe session identifiers, then retrieves the Stripe payment intent and creates a refund before sending the cancellation email.

The Stripe webhook must be configured to send `checkout.session.completed` and `checkout.session.expired` events to `/api/stripe-webhook`. Webhook failures return a non-2xx response so Stripe retries delivery.

Planned:

- `GET /api/config`
- `POST /api/admin/availability`

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

		reservation/
			index.js
			function.json

		availability/
			index.js
			function.json

		services/
			ReservationService.js
			AvailabilityService.js
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
- `RESERVATION_CANCEL_TOKEN_TTL_HOURS` - cancellation link TTL in hours (default `72`)

Azure Communication Service email settings:

- `MAIL_MODE` - set to `acs-email` to send real emails (`log-only` keeps local placeholder behavior)
- `ACS_CONNECTION_STRING` - connection string for ACS Email resource
- `ACS_SENDER_ADDRESS` - sender address (for example `noreply@skucha.co`)

### Azure Portal Setup

The repository uses the resources shown in the deployment subscription:

- `skucha-communication-services` supplies the Communication Services connection string.
- `skucha-communication-email-services` owns the Email Communication Services configuration.
- `skucha.co` is the configured email domain.
- `skucha-web` hosts the Static Web App and integrated Functions API.

Configure ACS email in the Azure portal:

1. Open `skucha-communication-email-services` and open the `MailFrom` or Domains area. Confirm that the `skucha.co` domain is provisioned and verified. Do not continue until its status is ready.
2. Use `noreply@skucha.co` as the sender address. It must belong to the verified `skucha.co` domain.
3. Open `skucha-communication-services`, select **Keys**, and copy the **Primary connection string**. Treat it as a secret; do not commit it or paste it into source control.
4. Open `skucha-web`, select **Configuration**, then **Application settings**, and add these settings for the production environment:
	- `MAIL_MODE` = `acs-email`
	- `ACS_CONNECTION_STRING` = the copied Primary connection string
	- `ACS_SENDER_ADDRESS` = `noreply@skucha.co`
	- `RESERVATION_PUBLIC_BASE_URL` = the public `skucha-web` domain
	- `RESERVATION_CANCEL_TOKEN_SECRET` = a long random secret
	- `RESERVATION_CANCEL_TOKEN_TTL_HOURS` = `72`
5. Save the settings and restart the Static Web App. Send a test reservation in Stripe test mode and confirm both the checkout-start email and the paid confirmation email arrive.

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

## Roadmap

1. Static website + reservation endpoint (mail placeholder)
2. Availability endpoint
3. Azure Table Storage persistence
4. Admin page
5. Webhook-based payment status reconciliation
