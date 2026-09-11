# RoomBridge Listing Review Service

Laravel 12 / PHP 8.4 microservice for pre-publication room-listing moderation.

## API

- `GET /api/health`
- `POST /api/listing-reviews`

The review endpoint validates the listing contract, evaluates deterministic
risk checks, returns `approved`, `needs_review`, or `rejected`, and stores the
request and decision in the `listing_reviews` PostgreSQL table through Eloquent.

## Local setup

```bash
composer install
cp .env.example .env
php artisan key:generate
php artisan migrate
php artisan serve --port=8010
```

Run tests with `php artisan test`.

Generate a PHP/Artisan moderation summary for the last 30 days:

```bash
php artisan listing-reviews:summary --days=30
```
