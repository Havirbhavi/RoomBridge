<?php

use Illuminate\Database\Migrations\Migration;
use Illuminate\Database\Schema\Blueprint;
use Illuminate\Support\Facades\Schema;

return new class extends Migration
{
    public function up(): void
    {
        Schema::create('listing_reviews', function (Blueprint $table): void {
            $table->id();
            $table->string('external_listing_id')->nullable()->index();
            $table->string('status', 30)->index();
            $table->unsignedTinyInteger('risk_score');
            $table->json('request_payload');
            $table->json('review_result');
            $table->timestamps();
        });
    }

    public function down(): void
    {
        Schema::dropIfExists('listing_reviews');
    }
};
