<?php

namespace Tests\Feature;

use Illuminate\Foundation\Testing\RefreshDatabase;
use Tests\TestCase;

class ListingReviewTest extends TestCase
{
    use RefreshDatabase;

    public function test_a_complete_listing_is_approved_and_audited(): void
    {
        $response = $this->postJson('/api/listing-reviews', $this->validListing());

        $response->assertCreated()
            ->assertJsonPath('status', 'approved')
            ->assertJsonPath('risk_score', 0)
            ->assertJsonPath('checks.required_photos', true);

        $this->assertDatabaseHas('listing_reviews', ['status' => 'approved', 'risk_score' => 0]);
    }

    public function test_suspicious_contact_language_requires_review(): void
    {
        $listing = $this->validListing();
        $listing['description'] = 'Message me on WhatsApp and pay through Cash App.';

        $this->postJson('/api/listing-reviews', $listing)
            ->assertCreated()
            ->assertJsonPath('status', 'needs_review')
            ->assertJsonPath('checks.no_off_platform_contact', false);
    }

    public function test_missing_required_photo_category_is_rejected(): void
    {
        $listing = $this->validListing();
        $listing['photos'][2]['label'] = 'Exterior';

        $this->postJson('/api/listing-reviews', $listing)
            ->assertCreated()
            ->assertJsonPath('status', 'rejected')
            ->assertJsonPath('checks.required_photos', false);
    }

    private function validListing(): array
    {
        return [
            'title' => 'University Pointe - Unit 304',
            'description' => 'Furnished room near campus.',
            'address' => '1955 SW 5th Avenue, Portland, OR',
            'unitNumber' => '304',
            'university' => 'Portland State University',
            'pricingBasis' => 'per-person',
            'availableBeds' => 1,
            'availableFrom' => '2026-09-01',
            'availableTo' => '2027-06-30',
            'rent' => 1100,
            'roomType' => 'Private room',
            'photos' => [
                ['label' => 'Bedroom', 'url' => 'https://example.com/bedroom.jpg'],
                ['label' => 'Kitchen or common area', 'url' => 'https://example.com/kitchen.jpg'],
                ['label' => 'Bathroom', 'url' => 'https://example.com/bathroom.jpg'],
            ],
        ];
    }
}
