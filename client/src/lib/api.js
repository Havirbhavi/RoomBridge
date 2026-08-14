export const API_BASE = import.meta.env.VITE_API_BASE || "http://localhost:4000/api";
export const SOCKET_BASE = import.meta.env.VITE_SOCKET_BASE || "http://localhost:4000";

async function request(path, options = {}) {
  const { headers: optionHeaders, ...requestOptions } = options;
  const response = await fetch(`${API_BASE}${path}`, {
    ...requestOptions,
    headers: {
      "Content-Type": "application/json",
      ...optionHeaders
    }
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({}));
    throw new Error(error.error || `Request failed: ${response.status}`);
  }

  return response.json();
}

const SESSION_KEY = "roombridge_session";

export function savedSessionToken() {
  return localStorage.getItem(SESSION_KEY) || "";
}

export function saveSessionToken(token) {
  if (token) localStorage.setItem(SESSION_KEY, token);
  else localStorage.removeItem(SESSION_KEY);
}

export const api = {
  register: (payload) =>
    request("/auth/register", { method: "POST", body: JSON.stringify(payload) }),
  login: (payload) =>
    request("/auth/login", { method: "POST", body: JSON.stringify(payload) }),
  session: (token) =>
    request("/auth/session", { headers: { Authorization: `Bearer ${token}` } }),
  logout: (token) =>
    fetch(`${API_BASE}/auth/logout`, { method: "POST", headers: { Authorization: `Bearer ${token}` } }),
  verifyUniversity: (token, code) =>
    request("/auth/verify-university", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ code })
    }),
  resendVerification: (token) =>
    request("/auth/resend-verification", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: "{}"
    }),
  bootstrap: () => request("/bootstrap"),
  listings: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return request(`/listings${query ? `?${query}` : ""}`);
  },
  liveListings: (filters = {}) => {
    const params = new URLSearchParams();
    Object.entries(filters).forEach(([key, value]) => {
      if (value) params.set(key, value);
    });
    const query = params.toString();
    return request(`/listings/live${query ? `?${query}` : ""}`);
  },
  mapContext: (latitude, longitude) =>
    request(`/map/context?latitude=${encodeURIComponent(latitude)}&longitude=${encodeURIComponent(longitude)}`),
  uploadListingPhotos: async (files) => {
    const body = new FormData();
    files.forEach((file) => body.append("photos", file));
    const response = await fetch(`${API_BASE}/uploads/listing-photos`, { method: "POST", body });
    const result = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(result.error || `Photo upload failed: ${response.status}`);
    return result;
  },
  createListing: (payload) =>
    request("/listings", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  updateListingAvailability: (token, listingId, status) =>
    request(`/listings/${encodeURIComponent(listingId)}/availability`, {
      method: "PATCH",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify({ status })
    }),
  enrichListing: (payload) =>
    request("/listings/enrich", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createProfile: (payload) =>
    request("/profiles", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  matches: (profileId) => request(`/matches/${profileId}`),
  evaluateMatches: (profile, listings) =>
    request("/matches/evaluate", {
      method: "POST",
      body: JSON.stringify({ profile, listings })
    }),
  createContactRequest: (payload) =>
    request("/contact-requests", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createSavedSearch: (payload) =>
    request("/saved-searches", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createSharedShortlist: (payload) =>
    request("/shared-shortlists", { method: "POST", body: JSON.stringify(payload) }),
  sharedShortlist: (shortlistId) => request(`/shared-shortlists/${encodeURIComponent(shortlistId)}`),
  voteSharedShortlist: (shortlistId, payload) =>
    request(`/shared-shortlists/${encodeURIComponent(shortlistId)}/votes`, {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  requestTour: (payload) => request("/tours", { method: "POST", body: JSON.stringify(payload) }),
  messages: (listingId) => request(`/messages/${encodeURIComponent(listingId)}`),
  sendMessage: (payload) => request("/messages", { method: "POST", body: JSON.stringify(payload) }),
  journey: (profileId) => request(`/journey/${encodeURIComponent(profileId)}`),
  createJourneyTask: (payload) => request("/journey/tasks", { method: "POST", body: JSON.stringify(payload) }),
  createRoommateAgreement: (payload) => request("/roommate-agreements", { method: "POST", body: JSON.stringify(payload) }),
  createSubleaseCheck: (payload) => request("/sublease-checks", { method: "POST", body: JSON.stringify(payload) }),
  createConditionReport: (payload) => request("/condition-reports", { method: "POST", body: JSON.stringify(payload) }),
  saveVaultDocument: (payload) => request("/document-vault", { method: "POST", body: JSON.stringify(payload) }),
  createSupportCase: (payload) => request("/support-cases", { method: "POST", body: JSON.stringify(payload) }),
  hostReliability: (listingId) => request(`/listings/${encodeURIComponent(listingId)}/reliability`),
  listingQuestions: (listingId) => request(`/listings/${encodeURIComponent(listingId)}/questions`),
  screenListing: (payload) => request("/privacy/screen-listing", { method: "POST", body: JSON.stringify(payload) }),
  reportListing: (payload) =>
    request("/reports", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  compareListings: (payload) =>
    request("/compare", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  createRoomProofReport: (payload) =>
    request("/roomproof/reports", {
      method: "POST",
      body: JSON.stringify(payload)
    }),
  roomProofReport: (reportId) => request(`/roomproof/reports/${reportId}`),
  roomTrustGraph: (listingId) => request(`/roomproof/trust-graph/${listingId}`),
  buildRoomTrustGraph: (listingId) =>
    request(`/roomproof/trust-graph/${listingId}/index`, { method: "POST", body: "{}" }),
  askRoomProof: (reportId, question) =>
    request(`/roomproof/reports/${reportId}/questions`, {
      method: "POST",
      body: JSON.stringify({ question })
    }),
  askHomeAssistant: (message, history = []) =>
    request("/assistant/chat", {
      method: "POST",
      body: JSON.stringify({ message, history })
    }),
  moderation: () => request("/moderation")
};
