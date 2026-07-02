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
- send reservation notifications (phase 1: log-only placeholder)

Never trust frontend input. Reservation acceptance is backend-controlled.

## Endpoints

- `GET /api/availability`
- `POST /api/reservation`

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
5. Online payments
