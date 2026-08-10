# Skucha Architecture

## Purpose
This document describes the current technical architecture of the Skucha repository and serves as a baseline for future changes.

## System Overview
Skucha is deployed as a single Azure Static Web Apps solution with:

- static frontend pages in repository root
- Azure Functions API in `api/`
- shared JSON configuration in `config/config.json`

The system follows a thin-handler backend pattern:

- Azure Function handlers parse input/output and map errors
- business logic lives in `api/services/*`
- data shape rules live in `api/models/*`
- reservation state is persisted in Azure Table Storage
- concurrency-sensitive inventory creation uses a short-lived Table Storage lease

## Testing Architecture Requirements

The repository uses a production-grade testing strategy and all future modules must follow it.

### Core Principles

- Keep Azure Function handlers thin: parse request, call service, map response/error.
- Keep business rules in services and persistence in repositories.
- Avoid shared mutable state in tests.
- Prefer dependency injection via factory functions over brittle module-level monkey patching.
- Mock only external dependencies (Azure SDK, storage, notification transports, HTTP, payment providers).
- Do not mock business logic under test.

### Test Stack

- Test runner: Vitest.
- Runtime: Node environment.
- Linting: ESLint.
- Coverage outputs:
  - console summary
  - `api/coverage/index.html`
  - `api/coverage/lcov.info`

Coverage thresholds enforced in CI:

- Lines >= 90%
- Branches >= 85%
- Functions >= 90%
- Statements >= 90%

### Folder and Naming Conventions

- Tests live under `api/tests/`.
- Unit tests:
  - `api/tests/unit/services/`
  - `api/tests/unit/repositories/`
  - `api/tests/unit/helpers/`
- Integration tests:
  - `api/tests/integration/reservation/`
  - `api/tests/integration/availability/`
- Shared test utilities:
  - `api/tests/factories/`
  - `api/tests/mocks/`
  - `api/tests/helpers/`

Test naming uses behavior style, for example:

- `should_save_valid_reservation()`
- `should_reject_overlapping_reservations()`
- `should_return_400_for_invalid_payload()`

### Dependency Injection Standard

Services, repositories, and function handlers expose non-breaking factory constructors for testability.

- Service factories:
  - `createReservationService(dependencies)`
  - `createAvailabilityService(dependencies)`
- Repository factory:
  - `createReservationRepository(dependencies)`
- Function handler factories:
  - `createReservationHandler(dependencies)`
  - `createAvailabilityHandler(dependencies)`

Default exports preserve current runtime behavior and remain production-safe.

### CI Quality Gate

Deployment is gated by quality checks in GitHub Actions:

1. checkout
2. setup Node
3. `npm ci` in `api/`
4. `npm run lint`
5. `npm test`
6. `npm run test:coverage`
7. deploy only if all previous steps pass

### Future Modules Checklist

Every new module (payments, inventory, products, orders, auth, admin panel) must include:

- service + repository split
- DI factory for testability
- unit tests for validation and error propagation
- integration tests for handler status mapping (200/400/404/500)
- mocked external boundaries only
- coverage maintained at or above enforced thresholds

## High-Level Components

### Frontend
Main entry points:

- `index.html` (redirect shell)
- `skucha.html` (responsive booking experience for desktop and mobile)
- `skucha-print.html` (print-oriented variant)

Frontend responsibilities:

- render pricing and booking UI
- call `/api/availability` for calendar day availability
- call `/api/reservation` to create reservation requests
- do basic client-side validation (required fields, email format)
- check `/api/site-status` before exposing public page interaction
- redirect to `under-construction.html` when maintenance mode is enabled

Frontend data sources:

- dynamic config from `config/config.json` via `config/config-loader.js`
- live availability from API

### Backend (Azure Functions)
HTTP functions:

- `GET /api/availability` in `api/availability/index.js`
- `POST /api/reservation` in `api/reservation/index.js`
- `GET /api/site-status` in `api/site-status/index.js`
- `POST /api/reservation/cancel` in `api/reservation-cancel/index.js`
- `POST /api/internal/housekeeping` in `api/internal/housekeeping/index.js`
- `GET|POST /api/admin/reservations` in `api/admin/reservations/index.js`
- `POST /api/admin/housekeeping` in `api/admin/housekeeping/index.js`

Service layer:

- `api/services/AvailabilityService.js`
- `api/services/ReservationService.js`
- `api/services/ReservationLifecycleService.js`
- `api/services/ReservationTimeService.js`
- `api/services/HousekeepingService.js`
- `api/services/AdminReservationService.js`
- `api/services/ConfigService.js`
- `api/services/MailService.js`

Model layer:

- `api/models/Reservation.js`

Maintenance behavior:

- `MAINTENANCE_MODE` is read only by the API runtime and defaults to disabled.
- `api/helpers/maintenance.js` rejects every operational API endpoint with `503` while the flag is enabled; only `GET /api/site-status` remains available for the frontend gate.
- The API deployment bundle flattens nested source Function directories (`admin/reservations` -> `admin-reservations`) because Static Web Apps discovers Function folders directly under `api_location`; each copied `function.json` retains its nested HTTP route.

Reservation lifecycle:

- `Pending -> Confirmed` is driven by a paid Stripe webhook.
- `Pending -> Expired` is driven by checkout expiry or the two-hour housekeeping service.
- `Pending|Confirmed -> CancellationPending -> Cancelled` is the customer refund saga.
- `Confirmed -> InProgress -> Completed` is the authenticated staff collection/return flow.
- `Cancelled`, `Expired`, and `Completed` are terminal and release inventory.

## Runtime Flows

### 1. Calendar Availability Flow
1. Frontend requests `GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` for visible month range.
2. `AvailabilityService` validates dates and reads `availability.totalPads` from config.
3. Service computes remaining pads per day from Table Storage reservations. `Pending`, `Confirmed`, `CancellationPending`, and `InProgress` block; stale unpaid Pending rows are ignored defensively.
4. API returns:
   - `available` (range-level boolean)
   - `remainingPads` (minimum remaining pads for selected range)
   - `days` map (`YYYY-MM-DD -> remaining pads`)
5. Frontend renders daily availability markers in calendar.

### 2. Reservation Flow
1. User selects dates, pads count, pickup/delivery mode, and enters:
   - first name
   - last name
   - email
   - phone
2. Frontend sends `POST /api/reservation` payload.
3. `ReservationService` validates the payload and acquires the global inventory lease.
4. It re-checks availability and persists the Pending reservation before releasing the lease.
5. `MailService` sends through ACS when `MAIL_MODE=acs-email`; log-only mode is local-development behavior.
6. API returns accepted reservation summary.

Validation strategy:

- frontend sanitizes and constrains user input (name chars, phone chars/length, email length)
- backend enforces canonical validation regardless of frontend behavior
- phone must match `^\\+?[0-9]{9,15}$`
- names must be 2-60 chars and match `^[A-Za-zÀ-ž\\-\\s']+$`
- dates must be `YYYY-MM-DD`
- pads count must be integer in safe range (currently 1-8)

## Configuration Model
`config/config.json` currently controls:

- contact values (phone/email/WhatsApp)
- pricing (`weekday`, `weekend`, `deliveryPerPad`)
- pickup points and enabled flags
- availability settings:
  - `totalPads`
  - `horizonMonths` (frontend planning horizon)

## Data and Persistence
Current persistence state:

- reservations are stored in the `Reservations` Azure Table
- Stripe webhook claims are stored in the `StripeEvents` Azure Table
- the inventory creation lease is stored in the `InventoryLeases` Azure Table
- existing reservation partition keys remain `YYYY-MM`; RowKey lookups currently scan partitions and should gain an index before volume grows materially

## Deployment Topology
Azure Static Web Apps configuration (from repository conventions):

- app location: repository root (`/`)
- API location: `api/`
- static pages and functions deployed together

## Current Constraints and Risks

- Table Storage ETags protect row transitions, but Stripe side effects remain a saga and require reconciliation.
- The global inventory lease is appropriate for the current low-volume aggregate pad count; a daily allocation ledger or transactional store is the next scale step.
- ACS email delivery requires production configuration and operational retry/monitoring.
- External rate limiting/WAF and Application Insights alerts still need to be configured in Azure.

## Recommended Next Steps

### Short Term
- Configure SWA `admin` role invitations and GitHub housekeeping secrets.
- Configure ACS live email, Stripe webhook events, Application Insights, and alerts.
- Run a dry-run housekeeping pass and review stale legacy Pending rows.

### Mid Term
- Add a direct reservation lookup index or a partition strategy optimized for RowKey retrieval.
- Add external rate limiting/WAF and email retry/delivery tracking.
- Define backup/restore, retention, and GDPR deletion procedures.

### Long Term
- Replace the global lease with daily allocation transactions or a transactional database if concurrency grows.
- Add individual pad identity, partial returns, damage/loss billing, and rescheduling only when the business requires them.
- Add richer observability and operational dashboards.

## Repository Map (Current)

- `/index.html`
- `/skucha.html`
- `/skucha-print.html`
- `/config/config.json`
- `/config/config-loader.js`
- `/api/availability/index.js`
- `/api/reservation/index.js`
- `/api/services/AvailabilityService.js`
- `/api/services/ReservationService.js`
- `/api/services/ReservationLifecycleService.js`
- `/api/services/ReservationTimeService.js`
- `/api/services/HousekeepingService.js`
- `/api/services/AdminReservationService.js`
- `/api/repositories/ReservationRepository.js`
- `/api/repositories/InventoryLeaseRepository.js`
- `/api/repositories/StripeEventRepository.js`
- `/api/services/ConfigService.js`
- `/api/services/MailService.js`
- `/api/models/Reservation.js`
