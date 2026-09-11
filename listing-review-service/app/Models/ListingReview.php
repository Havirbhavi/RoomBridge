<?php

namespace App\Models;

use Illuminate\Database\Eloquent\Model;

class ListingReview extends Model
{
    protected $fillable = [
        'external_listing_id',
        'status',
        'risk_score',
        'request_payload',
        'review_result',
    ];

    protected function casts(): array
    {
        return [
            'request_payload' => 'array',
            'review_result' => 'array',
        ];
    }
}
