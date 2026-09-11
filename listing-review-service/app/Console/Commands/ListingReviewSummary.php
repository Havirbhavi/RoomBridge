<?php

namespace App\Console\Commands;

use App\Models\ListingReview;
use Illuminate\Console\Command;

class ListingReviewSummary extends Command
{
    protected $signature = 'listing-reviews:summary {--days=30 : Number of recent days to include}';

    protected $description = 'Summarize recent RoomBridge listing moderation decisions';

    public function handle(): int
    {
        $days = max(1, (int) $this->option('days'));
        $reviews = ListingReview::query()
            ->where('created_at', '>=', now()->subDays($days))
            ->get();

        $this->info("Listing reviews from the last {$days} days");
        $this->table(
            ['Decision', 'Count'],
            collect(['approved', 'needs_review', 'rejected'])->map(fn (string $status) => [
                $status,
                $reviews->where('status', $status)->count(),
            ])->all(),
        );
        $this->line('Average risk score: '.number_format((float) $reviews->avg('risk_score'), 1));

        return self::SUCCESS;
    }
}
