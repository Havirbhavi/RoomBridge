import "./polyfill.js";

import cors from "cors";
import dotenv from "dotenv";
import express from "express";
import { mkdirSync } from "fs";
import http from "http";
import multer from "multer";
import path from "path";
import { fileURLToPath } from "url";
import { randomUUID } from "crypto";
import { Server } from "socket.io";
import { nearbyStudentContext } from "./mapContext.js";
import {
  bootstrap,
  createContactRequest,
  createConditionReport,
  createJourneyTask,
  createListing,
  createMessage,
  createProfile,
  createRoommateAgreement,
  createSavedSearch,
  createSharedShortlist,
  createSupportCase,
  createSubleaseCheck,
  createTour,
  createVaultDocument,
  getSharedShortlist,
  hostReliabilityForListing,
  initializeStoreStorage,
  listListings,
  listJourney,
  listMessages,
  listProfiles,
  matchesForProfile,
  moderationQueue,
  reportListing,
  updateListingAvailability,
  voteOnSharedShortlist,
  savedSearchHitsForListing
} from "./store.js";
import { getLiveRentalListings } from "./rentcast.js";
import { enrichListingWithGooglePlace } from "./googlePlaces.js";
import { callRoomBridgeTool } from "./mcpClient.js";
import { getMatches } from "./matching.js";
import { reviewListingSubmission } from "./listingReview.js";
import {
  bearerToken,
  initializeAuthStorage,
  loginUser,
  registerUser,
  resendUniversityVerification,
  revokeSession,
  sessionUser,
  verifyUniversityEmail
} from "./auth.js";

dotenv.config({ path: new URL("../../.env", import.meta.url) });

const PORT = process.env.PORT || 4000;
const CLIENT_ORIGIN = process.env.CLIENT_ORIGIN || "http://localhost:5173";
const AI_SERVICE_URL = process.env.AI_SERVICE_URL || "http://127.0.0.1:8001";
const UPLOAD_DIR = fileURLToPath(new URL("../../.data/uploads/", import.meta.url));
mkdirSync(UPLOAD_DIR, { recursive: true });

const photoUpload = multer({
  storage: multer.diskStorage({
    destination: UPLOAD_DIR,
    filename: (_req, file, callback) => {
      const extension = {
        "image/jpeg": ".jpg",
        "image/png": ".png",
        "image/webp": ".webp"
      }[file.mimetype] || "";
      callback(null, `${randomUUID()}${extension}`);
    }
  }),
  limits: { files: 8, fileSize: 6 * 1024 * 1024 },
  fileFilter: (_req, file, callback) => {
    callback(null, ["image/jpeg", "image/png", "image/webp"].includes(file.mimetype));
  }
});

const app = express();
const server = http.createServer(app);
const io = new Server(server, {
  cors: {
    origin: CLIENT_ORIGIN,
    methods: ["GET", "POST"]
  }
});

app.use(cors({ origin: CLIENT_ORIGIN }));
app.use(express.json({ limit: "15mb" }));
app.use("/uploads", express.static(UPLOAD_DIR, { maxAge: "7d", immutable: true }));

app.get("/api/health", (_req, res) => {
  res.json({ ok: true, service: "roombridge-api", realtime: "socket.io" });
});

app.get("/api/bootstrap", (_req, res) => {
  res.json(bootstrap());
});

app.post("/api/uploads/listing-photos", photoUpload.array("photos", 8), (req, res) => {
  if (!req.files?.length) return res.status(400).json({ error: "Choose at least one JPG, PNG, or WebP image" });
  res.status(201).json({
    photos: req.files.map((file) => ({
      id: path.parse(file.filename).name,
      name: file.originalname,
      url: `${req.protocol}://${req.get("host")}/uploads/${file.filename}`,
      size: file.size,
      type: file.mimetype
    }))
  });
});

app.post("/api/auth/register", async (req, res) => {
  try {
    res.status(201).json(await registerUser(req.body));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Account could not be created" });
  }
});

app.post("/api/auth/login", async (req, res) => {
  try {
    res.json(await loginUser(req.body));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Login failed" });
  }
});

app.get("/api/auth/session", async (req, res) => {
  const user = await sessionUser(bearerToken(req.headers.authorization));
  if (!user) return res.status(401).json({ error: "Session expired" });
  return res.json({ user });
});

app.post("/api/auth/logout", async (req, res) => {
  await revokeSession(bearerToken(req.headers.authorization));
  res.status(204).end();
});

app.post("/api/auth/verify-university", async (req, res) => {
  try {
    const user = await verifyUniversityEmail(bearerToken(req.headers.authorization), req.body.code);
    res.json({ user });
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Email could not be verified" });
  }
});

app.post("/api/auth/resend-verification", async (req, res) => {
  try {
    res.json(await resendUniversityVerification(bearerToken(req.headers.authorization)));
  } catch (error) {
    res.status(error.status || 500).json({ error: error.message || "Verification code could not be sent" });
  }
});

app.get("/api/profiles", (_req, res) => {
  res.json(listProfiles());
});

app.post("/api/profiles", (req, res) => {
  const profile = createProfile(req.body);
  io.emit("profile:created", profile);
  res.status(201).json(profile);
});

app.get("/api/listings", (req, res) => {
  res.json(listListings(req.query));
});

app.get("/api/listings/live", async (req, res) => {
  const result = await getLiveRentalListings(req.query);
  res.json(result);
});

app.get("/api/map/context", async (req, res) => {
  try {
    res.json(await nearbyStudentContext(req.query.latitude, req.query.longitude));
  } catch (error) {
    res.status(error.status || 502).json({ error: error.name === "AbortError" ? "Nearby places are taking too long to load" : error.message });
  }
});

app.post("/api/listings/enrich", async (req, res) => {
  const listing = await enrichListingWithGooglePlace(req.body);
  res.json(listing);
});

app.post("/api/listings", async (req, res) => {
  try {
    const submittedPhotos = Array.isArray(req.body?.photos) ? req.body.photos : [];
    const photoLabels = new Set(submittedPhotos.map((photo) => String(photo?.label || "").toLowerCase()));
    const hasRequiredPhotos = ["bedroom", "kitchen or common area", "bathroom"].every((label) => photoLabels.has(label));
    const hasValidPhotoUrls = submittedPhotos.every((photo) => {
      try {
        const url = new URL(photo?.url);
        return url.host === req.get("host") && url.pathname.startsWith("/uploads/") && ["http:", "https:"].includes(url.protocol);
      } catch {
        return false;
      }
    });
    if (!hasRequiredPhotos || !hasValidPhotoUrls) {
      return res.status(400).json({ error: "Bedroom, kitchen or common-area, and bathroom photos are required." });
    }
    const requiredFields = ["address", "unitNumber", "pricingBasis", "availableBeds", "availableFrom", "availableTo", "rent", "roomType"];
    const missingFields = requiredFields.filter((field) => req.body?.[field] === undefined || req.body?.[field] === null || String(req.body[field]).trim() === "");
    if (missingFields.length) return res.status(400).json({ error: `Complete these listing details: ${missingFields.join(", ")}` });
    const moderationReview = await reviewListingSubmission(req.body);
    if (moderationReview.status === "rejected") {
      return res.status(422).json({
        error: "This listing did not pass the publication review.",
        review: moderationReview
      });
    }
    const listing = await createListing({ ...req.body, moderationReview });
    const alertHits = savedSearchHitsForListing(listing);
    io.emit("listing:created", listing);
    alertHits.forEach((hit) => {
      io.to(`profile:${hit.profile.id}`).emit("alert:matched", {
        search: hit.search,
        listing,
        message: `${listing.title} near ${listing.university} matches ${hit.search.name}`
      });
    });
    io.emit("moderation:updated", moderationQueue());
    res.status(201).json({ listing, alertHits: alertHits.length });
  } catch (error) {
    res.status(error.status || 503).json({ error: error.message || "Listing could not be saved" });
  }
});

app.post("/api/listings/review", async (req, res) => {
  try {
    res.status(201).json(await reviewListingSubmission(req.body));
  } catch (error) {
    res.status(error.status || 502).json({
      error: error.message,
      details: error.details || undefined
    });
  }
});

app.patch("/api/listings/:listingId/availability", async (req, res) => {
  const user = await sessionUser(bearerToken(req.headers.authorization));
  if (!user) return res.status(401).json({ error: "Login is required to manage availability" });
  if (String(user.role).toLowerCase() !== "host") {
    return res.status(403).json({ error: "Only host accounts can confirm listing availability" });
  }
  const status = req.body?.status;
  if (!["available", "unavailable", "leased"].includes(status)) {
    return res.status(400).json({ error: "Choose available, unavailable, or leased" });
  }
  const listing = await updateListingAvailability(req.params.listingId, status, user.name);
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  io.emit("listing:availability", listing);
  return res.json(listing);
});

app.post("/api/compare", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 15000);

  try {
    const response = await fetch(`${AI_SERVICE_URL}/compare`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload.detail || payload.error || "Comparison service rejected the request"
      });
    }
    return res.json(payload);
  } catch (error) {
    const message = error.name === "AbortError"
      ? "Comparison service timed out"
      : "Comparison service is unavailable";
    return res.status(502).json({ error: message });
  } finally {
    clearTimeout(timeout);
  }
});

app.post("/api/roomproof/reports", async (req, res) => {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 30000);
  try {
    const response = await fetch(`${AI_SERVICE_URL}/roomproof/reports`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body),
      signal: controller.signal
    });
    const payload = await response.json().catch(() => ({}));
    if (!response.ok) {
      return res.status(response.status).json({
        error: payload.detail || "RoomProof could not process this evidence"
      });
    }
    return res.json(payload);
  } catch (error) {
    return res.status(502).json({
      error: error.name === "AbortError" ? "RoomProof timed out" : "RoomProof is unavailable"
    });
  } finally {
    clearTimeout(timeout);
  }
});

app.get("/api/roomproof/reports/:reportId", async (req, res) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/roomproof/reports/${encodeURIComponent(req.params.reportId)}`);
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(response.ok ? payload : { error: payload.detail || "Report not found" });
  } catch {
    return res.status(502).json({ error: "RoomProof is unavailable" });
  }
});

app.get("/api/roomproof/trust-graph/:listingId", async (req, res) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/roomproof/trust-graph/${encodeURIComponent(req.params.listingId)}`);
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(response.ok ? payload : { error: payload.detail || "Trust graph not found" });
  } catch {
    return res.status(502).json({ error: "RoomTrust Graph is unavailable" });
  }
});

app.post("/api/roomproof/trust-graph/:listingId/index", async (req, res) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/roomproof/trust-graph/${encodeURIComponent(req.params.listingId)}/index`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ listings: listListings({}) })
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(response.ok ? payload : { error: payload.detail || "Trust graph could not be built" });
  } catch {
    return res.status(502).json({ error: "RoomTrust Graph is unavailable" });
  }
});

app.post("/api/roomproof/reports/:reportId/questions", async (req, res) => {
  try {
    const response = await fetch(`${AI_SERVICE_URL}/roomproof/reports/${encodeURIComponent(req.params.reportId)}/questions`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(req.body)
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(response.ok ? payload : { error: payload.detail || "Question could not be answered" });
  } catch {
    return res.status(502).json({ error: "RoomProof is unavailable" });
  }
});

app.post("/api/assistant/chat", async (req, res) => {
  try {
    const mcpResult = await callRoomBridgeTool("search_rooms", { limit: 20 });
    const response = await fetch(`${AI_SERVICE_URL}/assistant/chat`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        message: req.body.message,
        history: req.body.history || [],
        listings: mcpResult.listings
      })
    });
    const payload = await response.json().catch(() => ({}));
    return res.status(response.status).json(response.ok ? payload : { error: payload.detail || "Assistant could not answer" });
  } catch {
    return res.status(502).json({ error: "RoomBridge assistant is unavailable" });
  }
});

app.get("/api/matches/:profileId", (req, res) => {
  const matches = matchesForProfile(req.params.profileId);
  if (!matches) return res.status(404).json({ error: "Profile not found" });
  return res.json(matches);
});

app.post("/api/matches/evaluate", (req, res) => {
  const { profile, listings } = req.body || {};
  if (!profile || !Array.isArray(listings)) {
    return res.status(400).json({ error: "A student profile and listings are required" });
  }
  return res.json(getMatches(profile, listings));
});

app.post("/api/contact-requests", (req, res) => {
  const request = createContactRequest(req.body);
  io.emit("contact:created", request);
  res.status(201).json(request);
});

app.post("/api/saved-searches", (req, res) => {
  const search = createSavedSearch(req.body);
  io.to(`profile:${search.profileId}`).emit("search:created", search);
  res.status(201).json(search);
});

app.post("/api/shared-shortlists", (req, res) => {
  const shortlist = createSharedShortlist(req.body || {});
  res.status(201).json(shortlist);
});

app.get("/api/shared-shortlists/:shortlistId", (req, res) => {
  const shortlist = getSharedShortlist(req.params.shortlistId);
  if (!shortlist) return res.status(404).json({ error: "Shared shortlist not found" });
  return res.json(shortlist);
});

app.post("/api/shared-shortlists/:shortlistId/votes", (req, res) => {
  const shortlist = voteOnSharedShortlist(req.params.shortlistId, req.body || {});
  if (!shortlist) return res.status(404).json({ error: "Shared shortlist or listing not found" });
  io.emit(`shortlist:${req.params.shortlistId}:updated`, shortlist);
  return res.json(shortlist);
});

app.post("/api/tours", (req, res) => {
  const tour = createTour(req.body || {});
  io.emit("tour:requested", tour);
  res.status(201).json(tour);
});

app.get("/api/messages/:listingId", (req, res) => res.json(listMessages(req.params.listingId)));
app.post("/api/messages", (req, res) => {
  const message = createMessage(req.body || {});
  io.emit("message:created", message);
  res.status(201).json(message);
});

app.get("/api/journey/:profileId", (req, res) => res.json(listJourney(req.params.profileId)));
app.post("/api/journey/tasks", (req, res) => res.status(201).json(createJourneyTask(req.body || {})));
app.post("/api/roommate-agreements", (req, res) => res.status(201).json(createRoommateAgreement(req.body || {})));
app.post("/api/sublease-checks", (req, res) => res.status(201).json(createSubleaseCheck(req.body || {})));
app.post("/api/condition-reports", (req, res) => res.status(201).json(createConditionReport(req.body || {})));
app.post("/api/document-vault", (req, res) => res.status(201).json(createVaultDocument(req.body || {})));
app.post("/api/support-cases", (req, res) => res.status(201).json(createSupportCase(req.body || {})));

app.get("/api/listings/:listingId/reliability", (req, res) => {
  const reliability = hostReliabilityForListing(req.params.listingId);
  if (!reliability) return res.status(404).json({ error: "Listing not found" });
  res.json(reliability);
});

app.get("/api/listings/:listingId/questions", (req, res) => {
  const listing = listListings({ includeUnavailable: "true" }).find((item) => String(item.id) === String(req.params.listingId));
  if (!listing) return res.status(404).json({ error: "Listing not found" });
  const questions = [
    !listing.utilitiesMonthly ? "Which utilities are not included, and what do they usually cost?" : null,
    !listing.parkingMonthly ? "Is parking available, and does it have a separate fee?" : null,
    !listing.applicationRequirements ? "Which documents are required before applying?" : null,
    !listing.guarantorPolicy ? "Do you accept an international guarantor or co-signer?" : null,
    !listing.leaseVerified ? "Can I review the complete lease before paying anything?" : null,
    "Can we schedule a live video tour of this exact unit?",
    "Are there any mandatory fees not shown in the listing?",
    "What are the household expectations for guests, cleaning, and quiet hours?"
  ].filter(Boolean).slice(0, 6);
  res.json({ listingId: listing.id, questions });
});

app.post("/api/privacy/screen-listing", (req, res) => {
  const text = `${req.body?.title || ""} ${req.body?.description || ""}`.toLowerCase();
  const flags = [];
  if (/ssn|social security/.test(text)) flags.push("Do not request an SSN in a public listing.");
  if (/wire transfer|gift card|cryptocurrency/.test(text)) flags.push("Unsafe payment method detected.");
  if (/no (children|families)|whites only|christians only|no disabled/.test(text)) flags.push("Potential fair-housing violation detected.");
  res.json({ passed: flags.length === 0, flags });
});

app.post("/api/reports", (req, res) => {
  const report = reportListing(req.body);
  io.emit("moderation:updated", moderationQueue());
  res.status(201).json(report);
});

app.get("/api/moderation", (_req, res) => {
  res.json(moderationQueue());
});

app.use((error, _req, res, next) => {
  if (!(error instanceof multer.MulterError)) return next(error);
  const message = error.code === "LIMIT_FILE_SIZE"
    ? "Each photo must be smaller than 6 MB"
    : error.code === "LIMIT_FILE_COUNT" || error.code === "LIMIT_UNEXPECTED_FILE"
      ? "A listing can include up to eight photos"
      : "The selected photos could not be uploaded";
  res.status(400).json({ error: message });
});

io.on("connection", (socket) => {
  socket.emit("realtime:ready", {
    socketId: socket.id,
    message: "Realtime housing feed connected"
  });

  socket.on("profile:watch", (profileId) => {
    socket.join(`profile:${profileId}`);
  });
});

Promise.all([initializeAuthStorage(), initializeStoreStorage()])
  .then(([authStorage, listingStorage]) => {
    server.listen(PORT, () => {
      console.log(
        `RoomBridge API listening on http://localhost:${PORT} · auth: ${authStorage.driver} · listings: ${listingStorage.driver}`
      );
    });
  })
  .catch((error) => {
    console.error("RoomBridge authentication storage failed to initialize", error);
    process.exitCode = 1;
  });
