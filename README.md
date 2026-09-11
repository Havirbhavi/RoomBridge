# RoomBridge

RoomBridge is a fullstack housing and roommate matcher for students arriving at universities across the United States. It replaces scattered Facebook posts with structured listings, roommate profiles, compatibility scoring, saved searches, contact requests, moderation signals, and realtime updates.

## Features

- Student onboarding profile with university, city/state, budget, move-in date, location, lifestyle, and housing preferences
- Structured housing listings for sublets, temporary stays, shared rooms, and private apartments
- Matching API with transparent score reasons
- Realtime Socket.IO feed for new listings, updated profiles, contact requests, and university-specific alert matches
- Saved listing workflow, contact request workflow, and moderation queue
- Password-hashed account authentication with university-email verification and persistent sessions
- Expiring one-time university email challenges with retry limits and hashed verification codes
- PostgreSQL-backed room listings that survive API restarts
- Availability freshness states that distinguish recently confirmed, aging, stale, and unavailable rooms
- True monthly and move-in cost calculations with an interactive Costs workspace
- Grounded Compare & Match agent with deterministic scoring and optional Anthropic explanations
- RoomProof evidence workspace for lease, image, listing-consistency, and duplicate-artifact review
- Laravel listing-review service with request validation, rule-based risk checks, and PostgreSQL audit records
- Responsive React dashboard designed for repeat use

## Run locally

```bash
npm run install:all
npm run dev
```

Frontend: http://localhost:5173  
Backend API: http://localhost:4000/api  
Realtime: Socket.IO on http://localhost:4000
Compare agent: http://localhost:8001
MCP server: http://localhost:8002/mcp
Laravel listing review: http://localhost:8010/api/health

### Laravel listing review

`listing-review-service/` is a Laravel 12 and PHP 8.4 API responsible for
pre-publication listing moderation. Express sends each host submission to
`POST /api/listing-reviews`; Laravel validates the contract, checks required
photo categories, rent plausibility, location completeness, and risky
off-platform contact language, then persists the decision through Eloquent.
Rejected submissions are blocked and `needs_review` decisions remain attached
to the listing for auditability.

Run it independently after installing PHP and Composer:

```bash
cd listing-review-service
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve --port=8010
```

Run its feature tests with `npm run review:test`. The full Docker Compose stack
builds and configures the Laravel service automatically.
Operations can inspect recent moderation outcomes with
`php artisan listing-reviews:summary --days=30` from the service directory.

### Compare & Match agent

The default `npm run dev` command starts the React client, Express API, and
FastAPI comparison service. Set up its Python environment once:

```bash
python3 -m venv ai-service/venv
ai-service/venv/bin/pip install -r ai-service/requirements.txt
```

Add `ANTHROPIC_API_KEY` to `ai-service/.env` to enable Claude-written
explanations. Without a key, scores, recommendations, grounding checks, and
deterministic explanations continue to work locally.

### RoomProof AI

Open any room, select **RoomProof**, and upload a PDF/text lease or property
images. The LangGraph workflow persists evidence, extracts supported terms,
checks the listing against the lease, cites every supported finding, identifies
exact artifacts reused across listing records, and supports grounded follow-up
questions. Reports deliberately distinguish supported evidence, conflicts,
missing information, and uncertainty.

Run the offline grounding suite:

```bash
ai-service/venv/bin/python ai-service/evals/run_evals.py
ai-service/venv/bin/python ai-service/evals/run_graph_evals.py
```

The RoomProof v2 benchmark generates 50 controlled scenarios covering
consistent leases, missing evidence, and rent, deposit, unit, utility, and pet
policy conflicts. It reports scenario accuracy, conflict-detection recall,
supported-finding citation precision, and abstention accuracy independently.
The benchmark is deterministic and intended for regression testing; its
results should not be represented as accuracy on real-world production data.

The deployable reference stack is in `docker-compose.yml` and includes
PostgreSQL/pgvector, Redis, Kafka, the AI service, and the Express API.
Accounts and hashed session tokens are stored in PostgreSQL when
`DATABASE_URL` is configured. Local development falls back to a private
`server/.data/auth.json` store so accounts still survive API restarts without
requiring Docker.
Room listings use the same storage strategy: PostgreSQL in the deployable
stack and a private `server/.data/listings.json` store for Docker-free local
development. Seed listings are inserted only when the selected repository is
empty.

University verification emails are sent through SMTP when `SMTP_HOST`,
`SMTP_USER`, `SMTP_PASSWORD`, and optionally `EMAIL_FROM` are configured. In
local development, the same verification flow displays the one-time code in
the modal instead of requiring an email provider.
`infrastructure/k8s/roomproof.yaml` adds health probes, resource limits, and
horizontal autoscaling. Prometheus metrics are exposed by the AI service at
`GET /metrics`.

The local Docker stack also provisions Prometheus at `http://localhost:9090`
and Grafana at `http://localhost:3001` (development login: `admin` /
`roombridge-local`). The provisioned **RoomBridge AI Operations** dashboard
tracks request throughput, server-error rate, p95 latency, comparison
grounding pass rate, grounding retries and fallbacks, RoomProof report and
finding outcomes, evidence volume, and grounded-Q&A abstention rate. These
KPIs measure both service health and AI answer quality instead of treating a
successful HTTP response as sufficient evidence of a healthy workflow.

Splunk is available at `http://localhost:8000` in the Docker stack (local user
`admin`; password from `SPLUNK_PASSWORD`). The AI service sends non-blocking,
structured events through Splunk HTTP Event Collector using
`SPLUNK_HEC_TOKEN`. The bundled **RoomBridge Operations** app provides request
and error trends, endpoint latency, grounding/fallback outcomes, Q&A
abstention, and RoomProof risk investigations. Scheduled searches detect
elevated 5xx responses, repeated grounding failures, and high abstention.
Events contain operational metadata and correlation IDs, but exclude lease
text, user questions, and other uploaded content.

Local inference currently provides PDF/text extraction, image indexing,
content-hash graph signals, consistency checks, citations, abstention, and
deterministic scoring. GPU-backed VQA, zero-shot detection, ASR, and video
workers use the same evidence contracts but require separately configured
Hugging Face model-serving infrastructure.

RoomProof maintains a persistent **RoomTrust Graph** linking listings to
normalized addresses, units, hosts, phone numbers, email addresses, evidence
files, description features, and perceptual image hashes. It produces
explainable signals for shared contacts, identical evidence, near-duplicate
descriptions, and visually similar images. The relevant subgraph is rendered
inside each report.

The contract-difference engine compares listing claims with extracted lease
terms for rent, security deposit, unit, utilities, pets, subletting,
application fees, parking, cleaning fees, and recurring pet charges.
Deterministic cost logic calculates effective monthly and identified one-time
costs.

### Model Context Protocol

`mcp-server/` exposes RoomBridge as a read-only MCP server over Streamable HTTP.
It provides:

- `search_rooms`
- `get_listing`
- `compare_listings`
- `get_roomproof_report`
- `query_roomtrust_graph`
- `roombridge://policies/rental-safety`
- `roombridge://listings/{listingId}`
- `compare_student_rooms` prompt

The public homepage assistant uses the official MCP client to obtain listing
context instead of directly reading the listing store. Every MCP tool execution
is schema-validated and written to a local JSONL audit trail. Run the protocol
smoke test while the application services are running:

```bash
npm --prefix mcp-server test
```

Only read-only tools are exposed. Contact, calendar, upload, and other mutation
tools are intentionally excluded until user authentication, scoped
authorization, and action-time approval are implemented.

## Optional live rental API

RoomBridge can call RentCast for real rental listings near a selected campus.

1. Create a RentCast API key.
2. Copy `.env.example` to `.env`.
3. Set `RENTCAST_API_KEY`.
4. Restart `npm run dev`.

Without the key, the app safely falls back to local student/demo listings.

RoomBridge can also enrich a selected listing through Google Places before a student sends a contact request. This can improve apartment names, area labels, website links, Google Maps links, and phone numbers when Google has a matching place.

Set `GOOGLE_MAPS_API_KEY` in `.env` to enable contact-time enrichment. Google Places generally does not provide direct email addresses.

## API highlights

- `POST /api/auth/register`
- `POST /api/auth/login`
- `GET /api/auth/session`
- `POST /api/auth/logout`
- `POST /api/auth/verify-university`
- `POST /api/auth/resend-verification`
- `GET /api/bootstrap`
- `GET /api/listings?university=UCLA`
- `GET /api/listings/live?university=Portland%20State%20University`
- `POST /api/listings/enrich`
- `POST /api/listings`
- `POST /api/compare`
- `POST /api/roomproof/reports`
- `GET /api/roomproof/reports/:reportId`
- `POST /api/roomproof/reports/:reportId/questions`
- `GET /api/roomproof/trust-graph/:listingId`
- `GET /api/profiles`
- `POST /api/profiles`
- `GET /api/matches/:profileId`
- `POST /api/contact-requests`
- `POST /api/saved-searches`
- `GET /api/moderation`
