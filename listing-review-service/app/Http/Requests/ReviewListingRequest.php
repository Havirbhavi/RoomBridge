<?php

namespace App\Http\Requests;

use Illuminate\Foundation\Http\FormRequest;
use Illuminate\Validation\Validator;

class ReviewListingRequest extends FormRequest
{
    public function authorize(): bool
    {
        return true;
    }

    public function rules(): array
    {
        return [
            'listingId' => ['nullable', 'string', 'max:100'],
            'title' => ['nullable', 'string', 'max:200'],
            'description' => ['nullable', 'string', 'max:5000'],
            'address' => ['required', 'string', 'max:300'],
            'unitNumber' => ['required', 'string', 'max:50'],
            'university' => ['nullable', 'string', 'max:200'],
            'pricingBasis' => ['required', 'string', 'in:per-person,entire-unit'],
            'availableBeds' => ['required', 'integer', 'min:1', 'max:20'],
            'availableFrom' => ['required', 'date'],
            'availableTo' => ['required', 'date'],
            'rent' => ['required', 'numeric', 'min:1', 'max:100000'],
            'roomType' => ['required', 'string', 'max:100'],
            'photos' => ['required', 'array', 'min:3', 'max:8'],
            'photos.*.label' => ['required', 'string', 'max:100'],
            'photos.*.url' => ['required', 'url:http,https', 'max:2000'],
        ];
    }

    public function after(): array
    {
        return [function (Validator $validator): void {
            $from = strtotime((string) $this->input('availableFrom'));
            $to = strtotime((string) $this->input('availableTo'));

            if ($from && $to && $to < $from) {
                $validator->errors()->add('availableTo', 'The availability end date must be on or after the start date.');
            }
        }];
    }
}
