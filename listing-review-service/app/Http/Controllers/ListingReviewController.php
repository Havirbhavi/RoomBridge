<?php

namespace App\Http\Controllers;

use App\Http\Requests\ReviewListingRequest;
use App\Models\ListingReview;
use App\Services\ListingRiskReviewer;
use Illuminate\Http\JsonResponse;

class ListingReviewController extends Controller
{
    public function __invoke(ReviewListingRequest $request, ListingRiskReviewer $reviewer): JsonResponse
    {
        $listing = $request->validated();
        $result = $reviewer->review($listing);
        $review = ListingReview::create([
            'external_listing_id' => $listing['listingId'] ?? null,
            'status' => $result['status'],
            'risk_score' => $result['risk_score'],
            'request_payload' => $listing,
            'review_result' => $result,
        ]);

        return response()->json([
            'review_id' => $review->id,
            ...$result,
        ], 201);
    }
}
