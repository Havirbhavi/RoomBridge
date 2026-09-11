<?php

namespace Tests\Feature;

use App\Models\ListingReview;
use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ListingReviewSummaryTest extends TestCase
{
    use RefreshDatabase;

    public function test_it_summarizes_recent_review_decisions(): void
    {
        foreach ([['approved', 0], ['approved', 0], ['needs_review', 20], ['rejected', 70]] as [$status, $risk]) {
            ListingReview::create([
                'status' => $status,
                'risk_score' => $risk,
                'request_payload' => [],
                'review_result' => [],
            ]);
        }

        $this->artisan('listing-reviews:summary', ['--days' => 7])
            ->expectsOutput('Listing reviews from the last 7 days')
            ->expectsTable(
                ['Decision', 'Count'],
                [['approved', 2], ['needs_review', 1], ['rejected', 1]],
            )
            ->expectsOutput('Average risk score: 22.5')
            ->assertSuccessful();
    }
}
