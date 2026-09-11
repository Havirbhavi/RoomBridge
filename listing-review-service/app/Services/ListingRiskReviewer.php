<?php

namespace App\Services;

class ListingRiskReviewer
{
    public function review(array $listing): array
    {
        $reasons = [];
        $checks = [];
        $riskScore = 0;

        $labels = collect($listing['photos'])->pluck('label')->map(
            fn (string $label) => strtolower(trim($label))
        );
        $requiredLabels = ['bedroom', 'kitchen or common area', 'bathroom'];
        $missingLabels = collect($requiredLabels)->reject(fn (string $label) => $labels->contains($label))->values();
        $checks['required_photos'] = $missingLabels->isEmpty();

        if ($missingLabels->isNotEmpty()) {
            $riskScore += 70;
            $reasons[] = 'Missing required photo categories: '.$missingLabels->join(', ').'.';
        }

        $monthlyRent = (float) $listing['rent'];
        $checks['plausible_monthly_rent'] = $monthlyRent >= 300 && $monthlyRent <= 10000;
        if (! $checks['plausible_monthly_rent']) {
            $riskScore += 25;
            $reasons[] = 'The normalized monthly rent is outside the expected review range.';
        }

        $description = (string) ($listing['description'] ?? '');
        $checks['no_off_platform_contact'] = ! preg_match('/(?:\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}|(?:whats?app|telegram|cash\s*app)/i', $description);
        if (! $checks['no_off_platform_contact']) {
            $riskScore += 20;
            $reasons[] = 'The description includes off-platform contact or payment language.';
        }

        $checks['complete_location'] = strlen(trim($listing['address'])) >= 8 && strlen(trim($listing['unitNumber'])) > 0;
        if (! $checks['complete_location']) {
            $riskScore += 15;
            $reasons[] = 'The address or unit information needs manual confirmation.';
        }

        $status = $riskScore >= 60 ? 'rejected' : ($riskScore > 0 ? 'needs_review' : 'approved');

        return [
            'status' => $status,
            'risk_score' => min($riskScore, 100),
            'normalized_monthly_rent' => round($monthlyRent, 2),
            'reasons' => $reasons,
            'checks' => $checks,
            'reviewed_at' => now()->toIso8601String(),
        ];
    }
}
