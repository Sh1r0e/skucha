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

## High-Level Components

### Frontend
Main entry points:

- `index.html` (redirect shell)
- `skucha-mobile.html` (mobile booking experience)
- `skucha-desktop.html` (desktop booking experience)
- `skucha-print.html` (print-oriented variant)

Frontend responsibilities:

- render pricing and booking UI
- call `/api/availability` for calendar day availability
- call `/api/reservation` to create reservation requests
- do basic client-side validation (required fields, email format)

Frontend data sources:

- dynamic config from `config/config.json` via `config/config-loader.js`
- live availability from API

### Backend (Azure Functions)
HTTP functions:

- `GET /api/availability` in `api/availability/index.js`
- `POST /api/reservation` in `api/reservation/index.js`

Service layer:

- `api/services/AvailabilityService.js`
- `api/services/ReservationService.js`
- `api/services/ConfigService.js`
- `api/services/MailService.js`

Model layer:

- `api/models/Reservation.js`

## Runtime Flows

### 1. Calendar Availability Flow
1. Frontend requests `GET /api/availability?from=YYYY-MM-DD&to=YYYY-MM-DD` for visible month range.
2. `AvailabilityService` validates dates and reads `availability.totalPads` from config.
3. Service computes remaining pads per day based on in-memory reservations.
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
3. `ReservationService` validates payload and checks availability for selected range.
4. If enough pads are available, reservation is added to in-memory store.
5. `MailService` returns log-only notification result (placeholder for real transport).
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

- reservations are stored in process memory only (`reservationsInMemory`)
- data is reset on cold start/redeploy/scale event

This is acceptable for early stage but not production-grade.

## Deployment Topology
Azure Static Web Apps configuration (from repository conventions):

- app location: repository root (`/`)
- API location: `api/`
- static pages and functions deployed together

## Current Constraints and Risks

- In-memory reservation store does not survive restarts.
- Concurrent instances can produce inconsistent availability without shared storage.
- No authentication/authorization for admin operations yet.
- Mail notification is placeholder only.

## Recommended Next Steps

### Short Term
- Add automated tests for:
  - date parsing/validation
  - availability day map correctness
  - reservation validation rules
- Add request/response contract examples in README.

### Mid Term
- Move reservation and availability state to durable storage (Azure Table Storage or Cosmos DB).
- Add idempotency protection for reservation creation.
- Add server-side input normalization and stricter phone/email validation.

### Long Term
- Introduce admin endpoints/UI for manual availability blocking.
- Add payment and reservation lifecycle states (pending/confirmed/cancelled).
- Add observability (structured logs, metrics, tracing).

## Repository Map (Current)

- `/index.html`
- `/skucha-mobile.html`
- `/skucha-desktop.html`
- `/skucha-print.html`
- `/config/config.json`
- `/config/config-loader.js`
- `/api/availability/index.js`
- `/api/reservation/index.js`
- `/api/services/AvailabilityService.js`
- `/api/services/ReservationService.js`
- `/api/services/ConfigService.js`
- `/api/services/MailService.js`
- `/api/models/Reservation.js`
