import { nanoid } from "nanoid";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import { seedContactRequests, seedListings, seedProfiles, seedSavedSearches } from "./seed.js";
import { findSavedSearchHits, getMatches } from "./matching.js";
import { initializeListingRepository, persistListing } from "./listingRepository.js";
import { withListingFreshness } from "./freshness.js";
import { withTrueCost } from "./trueCost.js";
import { withListingQuality } from "./listingQuality.js";

function presentListing(listing) {
  const normalizedTitle = listing.apartmentName
    ? `${String(listing.apartmentName).trim()}${listing.unitNumber ? ` – Unit ${String(listing.unitNumber).trim()}` : ""}`
    : listing.title;
  return withListingQuality(withTrueCost(withListingFreshness({ ...listing, title: normalizedTitle })));
}

const state = {
  profiles: [...seedProfiles],
  listings: [...seedListings],
  contactRequests: [...seedContactRequests],
  savedSearches: [...seedSavedSearches],
  sharedShortlists: [],
  tours: [],
  messages: [],
  journeyTasks: [],
  roommateAgreements: [],
  subleaseChecks: [],
  conditionReports: [],
  documents: [],
  supportCases: [],
  reports: []
};

export async function initializeStoreStorage() {
  const { driver, listings } = await initializeListingRepository(seedListings);
  const seedById = new Map(seedListings.map((listing) => [listing.id, listing]));
  state.listings = listings.map((listing) => {
    const seed = seedById.get(listing.id);
    return {
      ...(seed || {}),
      ...listing,
      availabilityStatus: listing.availabilityStatus || seed?.availabilityStatus || "available",
      lastConfirmedAt: listing.lastConfirmedAt || seed?.lastConfirmedAt || listing.createdAt
    };
  });
  return { driver, listingCount: state.listings.length };
}

export function bootstrap() {
  return {
    profiles: state.profiles,
    listings: listListings(),
    contactRequests: state.contactRequests,
    savedSearches: state.savedSearches,
    moderation: moderationQueue()
  };
}

export function listProfiles() {
  return state.profiles;
}

export function createProfile(input) {
  const profile = {
    id: `profile-${nanoid(8)}`,
    verified: /\.edu$/i.test(input.email?.split("@")[1] || ""),
    updatedAt: new Date().toISOString(),
    ...input
  };
  state.profiles.unshift(profile);
  return profile;
}

export function listListings(filters = {}) {
  return state.listings
    .filter((listing) => (filters.includeUnavailable === "true" ? true : !["unavailable", "leased"].includes(listing.availabilityStatus)))
    .filter((listing) => (filters.university ? listing.university === filters.university : true))
    .filter((listing) => (filters.city ? listing.city === filters.city : true))
    .filter((listing) => (filters.state ? listing.state === filters.state : true))
    .filter((listing) => (filters.area ? listing.area === filters.area : true))
    .filter((listing) => (filters.maxRent ? listing.rent <= Number(filters.maxRent) : true))
    .filter((listing) => (filters.type ? listing.type === filters.type : true))
    .sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt))
    .map(presentListing);
}

export async function createListing(input) {
  const listing = {
    id: `listing-${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    verified: false,
    riskLevel: input.verified ? "low" : "medium",
    availabilityStatus: "available",
    lastConfirmedAt: new Date().toISOString(),
    ...input,
    rent: Number(input.rent),
    deposit: Number(input.deposit),
    distanceToCampus: Number(input.distanceToCampus),
    roommatesNeeded: Number(input.roommatesNeeded),
    availableBeds: Math.max(1, Number(input.availableBeds || 1)),
    pricingBasis: input.pricingBasis === "entire-unit" ? "entire-unit" : "per-person",
    unitNumber: String(input.unitNumber || "").trim(),
    title: `${String(input.apartmentName || input.streetAddress || input.address || "Room near campus").trim()}${
      input.unitNumber ? ` – Unit ${String(input.unitNumber).trim()}` : ""
    }`
  };
  state.listings.unshift(listing);
  try {
    await persistListing(listing);
  } catch (error) {
    state.listings = state.listings.filter((item) => item.id !== listing.id);
    throw error;
  }
  return presentListing(listing);
}

export async function updateListingAvailability(listingId, status, confirmedBy) {
  const listing = state.listings.find((item) => String(item.id) === String(listingId));
  if (!listing || !["available", "unavailable", "leased"].includes(status)) return null;
  listing.availabilityStatus = status;
  listing.lastConfirmedAt = new Date().toISOString();
  listing.lastConfirmedBy = confirmedBy || "host";
  listing.confirmationCount = Number(listing.confirmationCount || 0) + 1;
  await persistListing(listing);
  return presentListing(listing);
}

export function matchesForProfile(profileId) {
  const profile = state.profiles.find((item) => item.id === profileId);
  if (!profile) return null;
  return getMatches(profile, state.listings.map(presentListing));
}

export function createContactRequest(input) {
  const request = {
    id: `request-${nanoid(8)}`,
    status: "pending",
    createdAt: new Date().toISOString(),
    ...input
  };
  state.contactRequests.unshift(request);
  return request;
}

export function createSavedSearch(input) {
  const search = {
    id: `search-${nanoid(8)}`,
    lastTriggeredAt: null,
    ...input
  };
  state.savedSearches.unshift(search);
  return search;
}

export function reportListing(input) {
  const report = {
    id: `report-${nanoid(8)}`,
    createdAt: new Date().toISOString(),
    status: "open",
    ...input
  };
  state.reports.unshift(report);
  return report;
}

export function moderationQueue() {
  const unverifiedListings = state.listings
    .filter((listing) => !listing.verified || listing.riskLevel !== "low")
    .map((listing) => ({
      id: `mod-${listing.id}`,
      type: "listing",
      severity: listing.riskLevel === "high" ? "high" : "medium",
      title: listing.title,
      reason: listing.verified ? "Review risk flag" : "Needs verification",
      createdAt: listing.createdAt
    }));

  const reports = state.reports.map((report) => ({
    id: report.id,
    type: "report",
    severity: "high",
    title: `Report on ${report.listingId}`,
    reason: report.reason,
    createdAt: report.createdAt
  }));

  return [...reports, ...unverifiedListings].sort((a, b) => new Date(b.createdAt) - new Date(a.createdAt));
}

export function savedSearchHitsForListing(listing) {
  return state.savedSearches
    .filter((search) => findSavedSearchHits(search, listing))
    .map((search) => ({
      search,
      profile: state.profiles.find((profile) => profile.id === search.profileId)
    }))
    .filter((hit) => hit.profile);
}

export function createSharedShortlist(input) {
  const shortlist = {
    id: `shortlist-${nanoid(10)}`,
    title: input.title || "RoomBridge shortlist",
    listingIds: [...new Set((input.listingIds || []).map(String))].slice(0, 12),
    votes: {},
    createdAt: new Date().toISOString()
  };
  state.sharedShortlists.unshift(shortlist);
  return shortlist;
}

export function getSharedShortlist(id) {
  const shortlist = state.sharedShortlists.find((item) => item.id === id);
  if (!shortlist) return null;
  return {
    ...shortlist,
    listings: shortlist.listingIds
      .map((listingId) => state.listings.find((listing) => String(listing.id) === listingId))
      .filter(Boolean)
      .map(presentListing)
  };
}

export function voteOnSharedShortlist(id, input) {
  const shortlist = state.sharedShortlists.find((item) => item.id === id);
  if (!shortlist || !shortlist.listingIds.includes(String(input.listingId))) return null;
  const listingId = String(input.listingId);
  const voter = String(input.voter || "guest").slice(0, 40);
  const current = new Set(shortlist.votes[listingId] || []);
  input.active === false ? current.delete(voter) : current.add(voter);
  shortlist.votes[listingId] = [...current];
  return getSharedShortlist(id);
}

function createWorkflowItem(prefix, input, defaults = {}) {
  return { id: `${prefix}-${nanoid(10)}`, createdAt: new Date().toISOString(), ...defaults, ...input };
}

export function createTour(input) {
  const tour = createWorkflowItem("tour", input, { status: "requested", mode: "Video tour" });
  state.tours.unshift(tour);
  return tour;
}

export function createMessage(input) {
  const message = createWorkflowItem("message", input, { status: "sent" });
  state.messages.push(message);
  return message;
}

export function listMessages(listingId) {
  return state.messages.filter((message) => String(message.listingId) === String(listingId));
}

export function createJourneyTask(input) {
  const task = createWorkflowItem("task", input, { completed: false });
  state.journeyTasks.unshift(task);
  return task;
}

export function listJourney(profileId) {
  return state.journeyTasks.filter((task) => !profileId || String(task.profileId) === String(profileId));
}

export function createRoommateAgreement(input) {
  const agreement = createWorkflowItem("agreement", input, { status: "draft" });
  state.roommateAgreements.unshift(agreement);
  return agreement;
}

export function createSubleaseCheck(input) {
  const check = createWorkflowItem("sublease", input, { status: "in_review" });
  state.subleaseChecks.unshift(check);
  return check;
}

export function createConditionReport(input) {
  const report = createWorkflowItem("condition", input, { status: "saved" });
  state.conditionReports.unshift(report);
  return report;
}

export function createVaultDocument(input) {
  const key = createHash("sha256").update(process.env.DOCUMENT_VAULT_KEY || "roombridge-local-development-key").digest();
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key, iv);
  const encrypted = Buffer.concat([
    cipher.update(String(input.contentBase64 || ""), "utf8"),
    cipher.final()
  ]);
  const document = createWorkflowItem("document", {
    profileId: input.profileId,
    filename: String(input.filename || "Document").slice(0, 120),
    mediaType: String(input.mediaType || "application/octet-stream").slice(0, 80),
    size: Number(input.size || 0),
    encryption: "AES-256-GCM",
    encryptedContent: encrypted.toString("base64"),
    iv: iv.toString("base64"),
    authTag: cipher.getAuthTag().toString("base64")
  }, { status: "private", sharedWith: [] });
  state.documents.unshift(document);
  const { encryptedContent, iv: storedIv, authTag, ...safeDocument } = document;
  return safeDocument;
}

export function createSupportCase(input) {
  const supportCase = createWorkflowItem("support", input, { status: "open", priority: "standard" });
  state.supportCases.unshift(supportCase);
  return supportCase;
}

export function hostReliabilityForListing(listingId) {
  const listing = state.listings.find((item) => String(item.id) === String(listingId));
  if (!listing) return null;
  const confirmations = Number(listing.confirmationCount || (listing.lastConfirmedAt ? 1 : 0));
  const tours = state.tours.filter((tour) => String(tour.listingId) === String(listingId));
  const messages = state.messages.filter((message) => String(message.listingId) === String(listingId));
  const score = Math.min(100, 40 + (listing.verified ? 25 : 0) + Math.min(15, confirmations * 5) + Math.min(10, tours.length * 2) + Math.min(10, messages.length));
  return {
    score,
    verified: Boolean(listing.verified),
    confirmations,
    tourRequestsHandled: tours.length,
    messagesHandled: messages.length,
    label: score >= 80 ? "Highly reliable" : score >= 60 ? "Established" : "New host"
  };
}
