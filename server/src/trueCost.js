function amount(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : 0;
}

export function calculateTrueCost(listing) {
  const rent = amount(listing.rent);
  const utilities = amount(listing.utilitiesMonthly ?? listing.utilityEstimate);
  const parking = amount(listing.parkingMonthly ?? listing.parkingFee);
  const internet = amount(listing.internetMonthly ?? listing.internetFee);
  const insurance = amount(listing.rentersInsuranceMonthly);
  const recurringFees = amount(listing.otherMonthlyFees);
  const deposit = amount(listing.deposit);
  const applicationFee = amount(listing.applicationFee);
  const administrationFee = amount(listing.administrationFee);
  const petDeposit = amount(listing.petDeposit);

  const monthlyTotal = rent + utilities + parking + internet + insurance + recurringFees;
  const oneTimeTotal = deposit + applicationFee + administrationFee + petDeposit;
  const moveInTotal = monthlyTotal + oneTimeTotal;
  const disclosedExtras = utilities + parking + internet + insurance + recurringFees;
  const fieldsProvided = [
    listing.utilitiesMonthly ?? listing.utilityEstimate,
    listing.parkingMonthly ?? listing.parkingFee,
    listing.internetMonthly ?? listing.internetFee,
    listing.rentersInsuranceMonthly,
    listing.otherMonthlyFees
  ].filter((value) => value !== undefined && value !== null && value !== "").length;

  return {
    monthlyTotal,
    monthlyExtras: disclosedExtras,
    oneTimeTotal,
    moveInTotal,
    completeness: fieldsProvided === 5 ? "complete" : fieldsProvided > 0 ? "partial" : "rent-only",
    breakdown: {
      rent,
      utilities,
      parking,
      internet,
      rentersInsurance: insurance,
      recurringFees,
      deposit,
      applicationFee,
      administrationFee,
      petDeposit
    }
  };
}

export function withTrueCost(listing) {
  return { ...listing, costs: calculateTrueCost(listing) };
}
