<?php

use App\Http\Controllers\ListingReviewController;
use Illuminate\Support\Facades\Route;

Route::get('/health', fn () => [
    'ok' => true,
    'service' => 'roombridge-listing-review',
    'framework' => app()->version(),
]);

Route::post('/listing-reviews', ListingReviewController::class);
