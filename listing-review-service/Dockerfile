FROM composer:2 AS dependencies

WORKDIR /app
COPY composer.json composer.lock ./
RUN composer install --no-dev --no-interaction --prefer-dist --optimize-autoloader --no-scripts

FROM php:8.4-cli-alpine

RUN docker-php-ext-install pdo_pgsql
WORKDIR /app
COPY . .
COPY --from=dependencies /app/vendor ./vendor

ENV APP_ENV=production
EXPOSE 8010

CMD ["sh", "-c", "php artisan migrate --force && php artisan serve --host=0.0.0.0 --port=8010"]
