import React, { useEffect, useMemo, useState } from "react";
import { createRoot } from "react-dom/client";
import { io } from "socket.io-client";
import L from "leaflet";
import { MapContainer, Marker, TileLayer, Tooltip, useMap } from "react-leaflet";
import {
  Bell,
  Bot,
  Bus,
  CalendarDays,
  CheckCircle2,
  CircleDollarSign,
  ClipboardCheck,
  Clock3,
  Columns2,
  FileText,
  Flag,
  Globe2,
  Heart,
  Home,
  List,
  LogIn,
  Map as MapIcon,
  MapPin,
  MessageSquare,
  Network,
  Plus,
  Radio,
  Search,
  Send,
  Share2,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  UploadCloud,
  UserPlus,
  UserRoundCheck,
  UsersRound,
  X
} from "lucide-react";
import { format, formatDistanceToNow } from "date-fns";
import { api, savedSessionToken, saveSessionToken, SOCKET_BASE } from "./lib/api";
import "leaflet/dist/leaflet.css";
import "./styles.css";

const blankListing = {
  title: "",
  apartmentName: "",
  university: "UCLA",
  city: "Los Angeles",
  state: "CA",
  type: "Sublease",
  rent: 1480,
  deposit: 600,
  utilitiesMonthly: 90,
  parkingMonthly: 0,
  internetMonthly: 0,
  rentersInsuranceMonthly: 15,
  otherMonthlyFees: 0,
  applicationFee: 45,
  administrationFee: 0,
  acceptsNoCreditHistory: true,
  ssnRequired: false,
  remoteSigning: true,
  guarantorPolicy: "International guarantor or approved co-signer accepted",
  applicationRequirements: "Photo ID, enrollment proof, income or guarantor",
  campusDestination: "",
  availableFrom: "2026-09-08",
  availableTo: "2027-06-20",
  area: "Westwood",
  address: "",
  unitNumber: "",
  pricingBasis: "per-person",
  availableBeds: 1,
  distanceToCampus: 0.7,
  furnished: true,
  utilitiesIncluded: ["Water", "Internet"],
  roomType: "Private room",
  roommatesNeeded: 1,
  genderPreference: "No preference",
  pets: "No pets",
  smoking: "No smoking",
  tags: ["International friendly"],
  description: "",
  postedBy: ""
};

const universityOptions = [
  { university: "Penn State University", city: "State College", state: "PA", areas: ["Downtown", "West College", "Campus Shuttle"] },
  { university: "Portland State University", city: "Portland", state: "OR", areas: ["Downtown Portland", "Goose Hollow", "South Waterfront"] },
  { university: "Oregon State University", city: "Corvallis", state: "OR", areas: ["Monroe Ave", "North Corvallis", "Southtown"] },
  { university: "University of Oregon", city: "Eugene", state: "OR", areas: ["West University", "South University", "Downtown Eugene"] },
  { university: "UCLA", city: "Los Angeles", state: "CA", areas: ["Westwood", "Sawtelle", "Santa Monica Bus"] },
  { university: "University of Texas at Austin", city: "Austin", state: "TX", areas: ["West Campus", "North Campus", "Riverside Shuttle"] },
  { university: "New York University", city: "New York", state: "NY", areas: ["Greenwich Village", "Downtown Brooklyn", "Jersey City PATH"] },
  { university: "Northeastern University", city: "Boston", state: "MA", areas: ["Fenway", "Mission Hill", "Back Bay"] }
];

const campusCoordinates = {
  "Penn State University": [40.7982, -77.8599],
  "Portland State University": [45.5118, -122.6843],
  "Oregon State University": [44.5638, -123.2794],
  "University of Oregon": [44.0448, -123.0726],
  UCLA: [34.0689, -118.4452],
  "University of Texas at Austin": [30.2849, -97.7341],
  "New York University": [40.7295, -73.9965],
  "Northeastern University": [42.3398, -71.0892]
};

function listingCoordinates(listing, index = 0) {
  const latitude = Number(listing.latitude);
  const longitude = Number(listing.longitude);
  if (Number.isFinite(latitude) && Number.isFinite(longitude)) return [latitude, longitude];
  const center = campusCoordinates[listing.university] || [39.8283, -98.5795];
  const seed = [...String(listing.id || listing.title || index)].reduce((total, character) => total + character.charCodeAt(0), 0);
  const angle = ((seed * 47 + index * 61) % 360) * Math.PI / 180;
  const miles = Math.max(.25, Math.min(Number(listing.distanceToCampus) || 1.2, 4.5));
  return [
    center[0] + Math.sin(angle) * miles / 69,
    center[1] + Math.cos(angle) * miles / (69 * Math.cos(center[0] * Math.PI / 180))
  ];
}

function universityMeta(university) {
  const normalized = university?.trim().toLowerCase();
  return universityOptions.find((option) => option.university.toLowerCase() === normalized);
}

function money(value) {
  const amount = Number(value);
  if (!Number.isFinite(amount)) return "Ask host";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    maximumFractionDigits: 0
  }).format(amount);
}

function price(value) {
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? money(amount) : "Ask host";
}

function trueCostFor(listing) {
  if (listing.costs) return listing.costs;
  const amount = (value) => {
    const number = Number(value);
    return Number.isFinite(number) && number > 0 ? number : 0;
  };
  const breakdown = {
    rent: amount(listing.rent),
    utilities: amount(listing.utilitiesMonthly ?? listing.utilityEstimate),
    parking: amount(listing.parkingMonthly ?? listing.parkingFee),
    internet: amount(listing.internetMonthly ?? listing.internetFee),
    rentersInsurance: amount(listing.rentersInsuranceMonthly),
    recurringFees: amount(listing.otherMonthlyFees),
    deposit: amount(listing.deposit),
    applicationFee: amount(listing.applicationFee),
    administrationFee: amount(listing.administrationFee),
    petDeposit: amount(listing.petDeposit)
  };
  const monthlyExtras = breakdown.utilities + breakdown.parking + breakdown.internet + breakdown.rentersInsurance + breakdown.recurringFees;
  const monthlyTotal = breakdown.rent + monthlyExtras;
  const oneTimeTotal = breakdown.deposit + breakdown.applicationFee + breakdown.administrationFee + breakdown.petDeposit;
  return { monthlyTotal, monthlyExtras, oneTimeTotal, moveInTotal: monthlyTotal + oneTimeTotal, breakdown, completeness: "partial" };
}

function shortDate(value) {
  const dateOnly = typeof value === "string" && /^\d{4}-\d{2}-\d{2}$/.test(value);
  const date = dateOnly
    ? new Date(...value.split("-").map((part, index) => Number(part) - (index === 1 ? 1 : 0)))
    : new Date(value);
  return value && !Number.isNaN(date.getTime()) ? format(date, "MMM d") : "Ask host";
}

function cleanText(value, fallback) {
  return typeof value === "string" && value.trim() ? value.trim() : fallback;
}

function listingFreshness(listing) {
  if (listing.freshness?.label) return listing.freshness.label;
  const date = new Date(listing.lastConfirmedAt || listing.createdAt);
  if (Number.isNaN(date.getTime())) return "Availability unconfirmed";
  const days = Math.max(0, Math.floor((Date.now() - date.getTime()) / 86400000));
  if (days === 0) return "Updated today";
  if (days <= 3) return `Confirmed ${days} day${days === 1 ? "" : "s"} ago`;
  return `Last checked ${days} days ago`;
}

function confirmationDate(value) {
  const date = new Date(value);
  return value && !Number.isNaN(date.getTime()) ? format(date, "MMM d, yyyy") : "Timestamp unavailable";
}

function commuteFor(listing) {
  const miles = Number(listing.distanceToCampus);
  if (!Number.isFinite(miles)) return { walk: "Ask host", bike: "Ask host", transit: "Ask host" };
  return {
    walk: `${Math.max(4, Math.round(miles * 20))} min`,
    bike: `${Math.max(3, Math.round(miles * 7))} min`,
    transit: `${Math.max(8, Math.round(miles * 9 + 6))} min`
  };
}

function commuteIntelligence(listing) {
  const commute = commuteFor(listing);
  const miles = Number(listing.distanceToCampus);
  const bestMode = !Number.isFinite(miles) ? "Confirm route"
    : miles <= 0.8 ? "Walking"
      : miles <= 2.5 ? "Bike or transit"
        : "Transit";
  return {
    ...commute,
    bestMode,
    destination: listing.campusDestination || `${listing.university || "Campus"} main campus`,
    lateNote: listing.lateTransitVerified
      ? "Late-evening service confirmed by the listing source."
      : "Check the final evening route before signing."
  };
}

function internationalReadiness(listing) {
  const text = `${listing.description || ""} ${(listing.tags || []).join(" ")}`.toLowerCase();
  const items = [
    { label: "No U.S. credit history", ready: listing.acceptsNoCreditHistory ?? /international friendly|international student/.test(text) },
    { label: "No SSN required", ready: listing.ssnRequired === false || /no ssn/.test(text) },
    { label: "Remote signing", ready: listing.remoteSigning ?? /remote sign|video tour/.test(text) },
    { label: "Guarantor options", ready: Boolean(listing.guarantorPolicy) || /guarantor|co-signer/.test(text) },
    { label: "Furnished arrival", ready: Boolean(listing.furnished) }
  ];
  const confirmed = items.filter((item) => item.ready).length;
  return {
    items,
    confirmed,
    label: confirmed >= 4 ? "International-ready" : confirmed >= 2 ? "Some arrival support" : "Requirements unclear"
  };
}

function roommatePreview(profile, listing) {
  if (!profile) return null;
  const checks = [
    { label: "Smoking", known: Boolean(listing.smoking), match: listing.smoking === profile.smoking },
    { label: "Pets", known: Boolean(listing.pets), match: listing.pets === profile.pets || listing.pets === "Cat okay" || profile.pets === "No pets" },
    { label: "Household preference", known: Boolean(listing.genderPreference), match: listing.genderPreference === "No preference" || listing.genderPreference === profile.genderPreference },
    { label: "Room style", known: Boolean(listing.roomType), match: listing.roomType === profile.roomType || profile.roomType?.includes(listing.roomType) }
  ];
  const known = checks.filter((check) => check.known);
  const matched = known.filter((check) => check.match);
  return {
    score: known.length ? Math.round((matched.length / known.length) * 100) : null,
    strengths: matched.map((check) => `${check.label} works with your profile`),
    conflicts: known.filter((check) => !check.match).map((check) => `${check.label} may need discussion`),
    unknown: ["Sleep schedule", "Cleaning routine", "Guest expectations"].filter((label) => !listing.roommatePreferences?.[label])
  };
}

function applicationReadiness(listing) {
  return [
    { label: "Current availability confirmed", ready: ["fresh", "current"].includes(listing.freshness?.status) },
    { label: "Total monthly costs reviewed", ready: true },
    { label: "Host or property identity verified", ready: Boolean(listing.verified) },
    { label: "Tour requested or completed", ready: Boolean(listing.tourCompleted) },
    { label: "Lease terms checked", ready: Boolean(listing.leaseVerified) },
    { label: "Application requirements confirmed", ready: Boolean(listing.applicationRequirements) }
  ];
}

function listingToCompareFeatures(listing) {
  const commute = commuteFor(listing);
  const commuteMinutes = Number.parseFloat(commute.walk);
  const distance = Number(listing.distanceToCampus);
  const rent = Number(listing.rent);
  const amenities = [
    ...(Array.isArray(listing.tags) ? listing.tags : []),
    ...(Array.isArray(listing.amenities) ? listing.amenities : []),
    ...(listing.furnished ? ["Furnished"] : [])
  ];

  return {
    id: String(listing.id),
    title: cleanText(listing.title || listing.apartmentName, "Room near campus"),
    rent: Number.isFinite(rent) && rent >= 0 ? rent : 0,
    commute_minutes: Number.isFinite(commuteMinutes) ? commuteMinutes : 0,
    distance_miles: Number.isFinite(distance) && distance >= 0 ? distance : null,
    room_type: listing.roomType || listing.type || null,
    furnished: Boolean(listing.furnished),
    utilities_included: Array.isArray(listing.utilitiesIncluded) ? listing.utilitiesIncluded : [],
    amenities,
    pets: listing.pets || null,
    verified: Boolean(listing.verified)
  };
}

function Pill({ children, tone = "neutral" }) {
  return <span className={`pill ${tone}`}>{children}</span>;
}

function Metric({ icon: Icon, label, value }) {
  return (
    <div className="metric">
      <Icon size={18} />
      <div>
        <span>{label}</span>
        <strong>{value}</strong>
      </div>
    </div>
  );
}

function ListingCard({ listing, match, showMatch, onContact, onReport, onViewDetails, decision, onDecision }) {
  const isExcellent = match?.score >= 80;
  const title = cleanText(listing.title || listing.apartmentName, "Room near campus");
  const area = cleanText(listing.area, "Campus area");
  const university = cleanText(listing.university, "Nearby campus");
  const city = cleanText(listing.city, "City");
  const state = cleanText(listing.state, "USA");
  const description = cleanText(listing.description, "Details are being verified. Contact the host for availability and lease information.");
  const distance = Number(listing.distanceToCampus);
  const distanceLabel = Number.isFinite(distance) ? `${distance} mi` : "Nearby";
  const visualTone = Math.abs([...title].reduce((sum, character) => sum + character.charCodeAt(0), 0)) % 4;
  const initials = title
    .split(" ")
    .filter(Boolean)
    .slice(0, 2)
    .map((word) => word[0])
    .join("")
    .toUpperCase();
  const costs = trueCostFor(listing);
  const firstPhotoUrl = listing.imageUrl || listing.photos?.[0]?.url || listing.photos?.[0]?.dataUrl;

  return (
    <article className={`listing-card compact-choice-card decision-${decision || "none"}`}>
      <div
        className={`listing-visual tone-${visualTone} ${firstPhotoUrl ? "has-property-photo" : ""}`}
        style={firstPhotoUrl ? { backgroundImage: `linear-gradient(180deg, transparent 40%, rgba(45,31,26,.48)), url("${firstPhotoUrl}")` } : undefined}
      >
        <Pill tone={listing.verified ? "green" : "amber"}>{listing.verified ? "Verified" : "Review"}</Pill>
        {showMatch && <span className={`visual-match ${isExcellent ? "hot" : ""}`}>{match?.score ?? "--"}% match</span>}
        {listing.photos?.length > 1 && <span className="card-photo-count">{listing.photos.length} photos</span>}
        <strong>{initials}</strong>
      </div>
      <div className="listing-main">
        <h3>{title}</h3>
        <p className="compact-card-location"><MapPin size={13} /> {area} · {distanceLabel} to campus</p>
        <div className="compact-availability">
          <span />
          <div><small>Available</small><strong>{shortDate(listing.availableFrom)}</strong></div>
          <em>{listing.availableBeds || 1} {Number(listing.availableBeds || 1) === 1 ? "bed" : "beds"} · {listingFreshness(listing)}</em>
        </div>
        <div className="card-true-cost">
          <span><small>{listing.pricingBasis === "entire-unit" ? "Entire unit total" : "Per-person total"}</small><strong>{money(costs.monthlyTotal)}<b>/mo</b></strong></span>
          <em>{costs.monthlyExtras > 0 ? `${money(costs.monthlyExtras)} beyond rent` : "No disclosed monthly extras"}</em>
        </div>
        <button className="compact-details-link prominent" onClick={() => onViewDetails(listing)}><Home size={16} /> View room</button>
        <div className="decision-actions" aria-label={`Choose preference for ${title}`}>
          <button className="pass" onClick={() => onDecision(listing, "pass")}><X size={16} /><span>Pass</span></button>
          <button className={decision === "maybe" ? "maybe selected" : "maybe"} onClick={() => onDecision(listing, "maybe")}><Sparkles size={16} /><span>Maybe</span></button>
          <button className={decision === "like" ? "like selected" : "like"} onClick={() => onDecision(listing, "like")}><Heart size={16} fill={decision === "like" ? "currentColor" : "none"} /><span>Like</span></button>
        </div>
      </div>
    </article>
  );
}

function RoomMapViewport({ positions, selectedCoordinates, focusSelected }) {
  const map = useMap();
  useEffect(() => {
    if (focusSelected && selectedCoordinates) {
      map.setView(selectedCoordinates, 14, { animate: true });
      return;
    }
    if (positions.length === 1) {
      map.setView(positions[0], 14, { animate: true });
      return;
    }
    if (positions.length > 1) map.fitBounds(L.latLngBounds(positions), { padding: [48, 48], maxZoom: 13, animate: true });
  }, [map, focusSelected, selectedCoordinates?.[0], selectedCoordinates?.[1], positions.map((position) => position.join(",")).join("|")]);
  return null;
}

const studentMapLayers = [
  { id: "campus", label: "Campus", symbol: "C" },
  { id: "transit", label: "Transit", symbol: "T" },
  { id: "groceries", label: "Groceries", symbol: "G" },
  { id: "libraries", label: "Libraries", symbol: "L" },
  { id: "healthcare", label: "Healthcare", symbol: "H" },
  { id: "late-night", label: "Late night", symbol: "24" }
];

function RoomMap({ listings, selectedId, onSelect, onOpen }) {
  const [contextLayers, setContextLayers] = useState(() => new Set(["campus", "transit", "groceries"]));
  const [contextPlaces, setContextPlaces] = useState([]);
  const [contextStatus, setContextStatus] = useState("loading");
  const positioned = listings.map((listing, index) => ({
    listing,
    coordinates: listingCoordinates(listing, index)
  }));
  const selected = positioned.find(({ listing }) => listing.id === selectedId) || positioned[0];
  const center = selected?.coordinates || [39.8283, -98.5795];
  const campusPosition = campusCoordinates[selected?.listing.university] || center;

  useEffect(() => {
    let cancelled = false;
    setContextStatus("loading");
    api.mapContext(campusPosition[0], campusPosition[1])
      .then((result) => {
        if (cancelled) return;
        setContextPlaces(result.places || []);
        setContextStatus("ready");
      })
      .catch(() => {
        if (cancelled) return;
        setContextPlaces([]);
        setContextStatus("unavailable");
      });
    return () => {
      cancelled = true;
    };
  }, [campusPosition[0], campusPosition[1]]);

  function toggleContextLayer(layer) {
    setContextLayers((current) => {
      const next = new Set(current);
      next.has(layer) ? next.delete(layer) : next.add(layer);
      return next;
    });
  }

  return (
    <section className="room-map-panel" aria-label="Room locations map">
      <div className="student-map-controls" aria-label="Student-friendly map layers">
        <div><strong>Nearby essentials</strong><small>{contextStatus === "loading" ? "Loading places…" : contextStatus === "unavailable" ? "Places temporarily unavailable" : "Choose what matters to you"}</small></div>
        <div>
          {studentMapLayers.map((layer) => (
            <button key={layer.id} type="button" className={contextLayers.has(layer.id) ? "active" : ""} aria-pressed={contextLayers.has(layer.id)} onClick={() => toggleContextLayer(layer.id)}>
              <span>{layer.symbol}</span>{layer.label}
            </button>
          ))}
        </div>
      </div>
      <MapContainer center={center} zoom={selected ? 13 : 4} scrollWheelZoom className="room-map">
        <RoomMapViewport positions={positioned.map(({ coordinates }) => coordinates)} selectedCoordinates={selected?.coordinates} focusSelected={Boolean(selectedId)} />
        <TileLayer
          attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a>'
          url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
        />
        {positioned.map(({ listing, coordinates }) => {
          const active = listing.id === selected?.listing.id;
          const marker = L.divIcon({
            className: "room-map-marker-shell",
            html: `<span class="room-map-price${active ? " active" : ""}">${money(trueCostFor(listing).monthlyTotal)}</span>`,
            iconSize: [82, 34],
            iconAnchor: [41, 17]
          });
          return (
            <Marker
              key={listing.id}
              position={coordinates}
              icon={marker}
              eventHandlers={{ click: () => onSelect(listing.id) }}
            >
              <Tooltip direction="top" offset={[0, -14]}>
                <strong>{listing.title}</strong><br />{listing.area} · {Number.isFinite(Number(listing.distanceToCampus)) ? `${listing.distanceToCampus} mi` : "Near campus"}
              </Tooltip>
            </Marker>
          );
        })}
        {contextLayers.has("campus") && selected && (
          <Marker
            position={campusPosition}
            icon={L.divIcon({ className: "student-context-marker-shell", html: '<span class="student-context-marker campus">C</span>', iconSize: [32, 32], iconAnchor: [16, 16] })}
          >
            <Tooltip direction="top" offset={[0, -12]}><strong>{selected.listing.university}</strong><br />Campus</Tooltip>
          </Marker>
        )}
        {contextPlaces.filter((place) => contextLayers.has(place.category)).map((place) => {
          const layer = studentMapLayers.find((item) => item.id === place.category);
          return (
            <Marker
              key={place.id}
              position={[place.latitude, place.longitude]}
              icon={L.divIcon({
                className: "student-context-marker-shell",
                html: `<span class="student-context-marker ${place.category}">${layer?.symbol || "•"}</span>`,
                iconSize: [28, 28],
                iconAnchor: [14, 14]
              })}
            >
              <Tooltip direction="top" offset={[0, -10]}><strong>{place.name}</strong><br />{layer?.label}{place.openingHours ? ` · ${place.openingHours}` : ""}</Tooltip>
            </Marker>
          );
        })}
      </MapContainer>
      {selected && (
        <article className="map-selection-card">
          <div>
            <span>{selected.listing.area || selected.listing.city}</span>
            <strong>{selected.listing.title}</strong>
            <small>{money(trueCostFor(selected.listing).monthlyTotal)}/mo estimated · {Number.isFinite(Number(selected.listing.distanceToCampus)) ? `${selected.listing.distanceToCampus} mi to campus` : "Near campus"}</small>
          </div>
          <button onClick={() => onOpen(selected.listing)}>View details</button>
        </article>
      )}
    </section>
  );
}

function BrandMark() {
  return (
    <div className="brand-mark" aria-hidden="true">
      <svg viewBox="0 0 48 48" role="presentation">
        <path className="logo-arch" d="M8 38V23C8 13.6 15.2 7 24 7s16 6.6 16 16v15" />
        <path className="logo-bridge" d="M8 29c5.2-4.2 10.5-6.3 16-6.3S34.8 24.8 40 29" />
        <path className="logo-door" d="M19 38V27h10v11" />
      </svg>
    </div>
  );
}

function HeroVisual() {
  return <div className="hero-visual" aria-hidden="true" />;
}

function LoadingListings() {
  return (
    <div className="listing-stack">
      {[1, 2, 3].map((item) => (
        <div className="listing-card skeleton-card" key={item}>
          <div className="listing-visual" />
          <div className="listing-main">
            <span />
            <strong />
            <p />
            <div />
          </div>
          <aside className="match-panel" />
        </div>
      ))}
    </div>
  );
}

function EmptyState({ onReset }) {
  return (
    <div className="empty-state">
      <div className="empty-icon">
        <Home size={30} />
      </div>
      <h3>No rooms found yet</h3>
      <p>Try a nearby city, increase max rent, or clear the area filter.</p>
      <button className="primary" onClick={onReset}>Reset filters</button>
    </div>
  );
}

function ContactModal({ listing, note, loading, onNoteChange, onClose, onSend }) {
  if (!listing) return null;

  const contact = listing.contact || {};
  const hasContact = contact.phone || contact.website || contact.googleMapsUri;

  return (
    <div className="modal-backdrop" role="presentation">
      <section className="contact-modal" role="dialog" aria-modal="true" aria-labelledby="contact-title">
        <div className="section-heading">
          <div>
            <span className="eyebrow">Contact details</span>
            <h2 id="contact-title">{listing.title || listing.apartmentName}</h2>
          </div>
          <button className="ghost icon" aria-label="Close contact details" onClick={onClose}>x</button>
        </div>

        <div className="contact-summary">
          <span>{listing.address}</span>
          <span>{listing.area} · {listing.city}, {listing.state}</span>
          <span>{listing.enrichment?.message || "Listing details ready."}</span>
        </div>

        {loading ? (
          <p className="source-note">Looking up apartment details...</p>
        ) : (
          <div className="contact-links">
            {hasContact ? (
              <>
                {contact.phone && <a href={`tel:${contact.phone}`}>{contact.phone}</a>}
                {contact.website && <a href={contact.website} target="_blank" rel="noreferrer">Website</a>}
                {contact.googleMapsUri && <a href={contact.googleMapsUri} target="_blank" rel="noreferrer">Google Maps</a>}
              </>
            ) : (
              <p className="source-note">No public phone or website was found. You can still send a request through RoomBridge.</p>
            )}
          </div>
        )}

        <label className="note-field">
          Your note
          <textarea value={note} onChange={(event) => onNoteChange(event.target.value)} />
        </label>

        <div className="modal-actions">
          <button className="ghost" onClick={onClose}>Cancel</button>
          <button className="primary" disabled={loading || !note.trim()} onClick={onSend}>
            <MessageSquare size={16} />
            Send request
          </button>
        </div>
      </section>
    </div>
  );
}

function ListingActionTools({ listing, profile }) {
  const [tour, setTour] = useState({ date: "", time: "17:00", mode: "Video tour" });
  const [tourStatus, setTourStatus] = useState("");
  const [message, setMessage] = useState("");
  const [messages, setMessages] = useState([]);
  const [questions, setQuestions] = useState([]);
  const [reliability, setReliability] = useState(null);
  const [transferChecks, setTransferChecks] = useState({});
  const [transferStatus, setTransferStatus] = useState("");

  useEffect(() => {
    let cancelled = false;
    Promise.all([
      api.listingQuestions(listing.id),
      api.hostReliability(listing.id),
      api.messages(listing.id)
    ]).then(([questionResult, reliabilityResult, messageResult]) => {
      if (cancelled) return;
      setQuestions(questionResult.questions || []);
      setReliability(reliabilityResult);
      setMessages(messageResult || []);
    }).catch(() => {});
    return () => { cancelled = true; };
  }, [listing.id]);

  async function submitTour(event) {
    event.preventDefault();
    if (!tour.date) return;
    const result = await api.requestTour({
      listingId: listing.id,
      profileId: profile?.id || "guest",
      ...tour
    });
    setTourStatus(`Requested for ${shortDate(result.date)} at ${result.time} · ${result.mode}`);
  }

  async function submitMessage(event) {
    event.preventDefault();
    if (!message.trim()) return;
    const result = await api.sendMessage({
      listingId: listing.id,
      profileId: profile?.id || "guest",
      sender: profile?.name || "Student",
      body: message.trim()
    });
    setMessages((current) => [...current, result]);
    setMessage("");
  }

  const neighborhood = [
    { label: "Campus access", value: `${listing.distanceToCampus ?? "?"} mi · ${commuteFor(listing).walk} walk` },
    { label: "Transit", value: /transit|max|streetcar|subway|bus/i.test(`${listing.description} ${(listing.tags || []).join(" ")}`) ? "Transit mentioned in listing" : "Confirm nearest evening route" },
    { label: "Daily needs", value: "Check groceries, pharmacy and laundry within your preferred walking range" },
    { label: "Late arrival", value: listing.lateTransitVerified ? "Evening transit information provided" : "Verify the route after your latest class" }
  ];
  const isTransfer = /sublease|takeover/i.test(`${listing.type || ""} ${listing.description || ""}`);
  const transferItems = ["Written landlord approval", "Original tenant identity", "Remaining lease dates", "Transfer and application fees", "Deposit ownership and refund terms"];

  async function saveTransferReview() {
    const result = await api.createSubleaseCheck({ listingId: listing.id, profileId: profile?.id || "guest", checks: transferChecks });
    setTransferStatus(`Review saved · ${Object.values(transferChecks).filter(Boolean).length}/${transferItems.length} checks complete · ${result.status.replace("_", " ")}`);
  }

  return (
    <>
      <details className="detail-accordion">
        <summary><span><CalendarDays size={16} /> Schedule a tour</span><small>Video or in person</small></summary>
        <form className="tour-request-form" onSubmit={submitTour}>
          <label>Date<input type="date" value={tour.date} onChange={(event) => setTour((current) => ({ ...current, date: event.target.value }))} required /></label>
          <label>Time<input type="time" value={tour.time} onChange={(event) => setTour((current) => ({ ...current, time: event.target.value }))} /></label>
          <label>Tour type<select value={tour.mode} onChange={(event) => setTour((current) => ({ ...current, mode: event.target.value }))}><option>Video tour</option><option>In-person tour</option></select></label>
          <button className="primary">Request tour</button>
          {tourStatus && <p><CheckCircle2 size={14} /> {tourStatus}</p>}
        </form>
      </details>
      <details className="detail-accordion">
        <summary><span><MessageSquare size={16} /> Secure messages</span><small>{messages.length} message{messages.length === 1 ? "" : "s"}</small></summary>
        <div className="secure-thread">
          {messages.slice(-4).map((item) => <p key={item.id}><strong>{item.sender || "Student"}</strong><span>{item.body}</span><small>{confirmationDate(item.createdAt)}</small></p>)}
          {!messages.length && <em>No messages yet. Ask without sharing your phone number.</em>}
          <form onSubmit={submitMessage}><input value={message} onChange={(event) => setMessage(event.target.value)} placeholder="Ask the host a question…" /><button disabled={!message.trim()}><Send size={15} /></button></form>
        </div>
      </details>
      <details className="detail-accordion">
        <summary><span><Sparkles size={16} /> Questions worth asking</span><small>Based on missing details</small></summary>
        <div className="listing-questions">{questions.map((question) => <button type="button" key={question} onClick={() => setMessage(question)}><MessageSquare size={14} /> {question}</button>)}</div>
      </details>
      <details className="detail-accordion">
        <summary><span><MapPin size={16} /> Neighborhood reality check</span><small>Daily life beyond distance</small></summary>
        <dl className="neighborhood-check">{neighborhood.map((item) => <div key={item.label}><dt>{item.label}</dt><dd>{item.value}</dd></div>)}</dl>
      </details>
      <details className="detail-accordion">
        <summary><span><UserRoundCheck size={16} /> Host reliability</span><small>{reliability?.label || "Loading signals"}</small></summary>
        {reliability && <div className="host-reliability"><strong>{reliability.score}<small>/100</small></strong><div><span>{reliability.verified ? "Verified identity" : "Identity pending"}</span><span>{reliability.confirmations} availability confirmation{reliability.confirmations === 1 ? "" : "s"}</span><span>{reliability.tourRequestsHandled} tour request{reliability.tourRequestsHandled === 1 ? "" : "s"} received</span></div></div>}
      </details>
      {isTransfer && <details className="detail-accordion">
        <summary><span><FileText size={16} /> Lease transfer checklist</span><small>Sublease and takeover protection</small></summary>
        <div className="transfer-checklist">
          {transferItems.map((item) => <label key={item}><input type="checkbox" checked={Boolean(transferChecks[item])} onChange={(event) => setTransferChecks((current) => ({ ...current, [item]: event.target.checked }))} /> {item}</label>)}
          <small>Do not pay until the property manager confirms the transfer in writing.</small>
          <button className="tool-action" onClick={saveTransferReview}>Save transfer review</button>
          {transferStatus && <p>{transferStatus}</p>}
        </div>
      </details>}
    </>
  );
}

function CompactTourScheduler({ listing, profile }) {
  const [tour, setTour] = useState({ date: "", time: "17:00", mode: "Video tour" });
  const [status, setStatus] = useState("");

  async function submit(event) {
    event.preventDefault();
    const result = await api.requestTour({ listingId: listing.id, profileId: profile?.id || "guest", ...tour });
    setStatus(`Requested for ${shortDate(result.date)} at ${result.time}`);
  }

  return (
    <details className="detail-accordion compact-tour">
      <summary><span><CalendarDays size={16} /> Schedule a tour</span><small>Video or in person</small></summary>
      <form className="tour-request-form" onSubmit={submit}>
        <label>Date<input type="date" value={tour.date} onChange={(event) => setTour((current) => ({ ...current, date: event.target.value }))} required /></label>
        <label>Time<input type="time" value={tour.time} onChange={(event) => setTour((current) => ({ ...current, time: event.target.value }))} /></label>
        <label>Tour type<select value={tour.mode} onChange={(event) => setTour((current) => ({ ...current, mode: event.target.value }))}><option>Video tour</option><option>In-person tour</option></select></label>
        <button className="primary">Request</button>
        {status && <p><CheckCircle2 size={14} /> {status}</p>}
      </form>
    </details>
  );
}

function ListingDetailsModal({ listing, match, profile, canManageAvailability, availabilityBusy, decision, onClose, onContact, onDecision, onRoomProof, onAvailabilityChange }) {
  const [activePhoto, setActivePhoto] = useState(0);
  useEffect(() => setActivePhoto(0), [listing?.id]);
  if (!listing) return null;
  const tags = [...new Set([listing.roomType, listing.furnished ? "Furnished" : "Unfurnished", ...(listing.tags || [])].filter(Boolean))];
  const commute = commuteIntelligence(listing);
  const costs = trueCostFor(listing);
  const galleryPhotos = (listing.photos || []).map((photo) => ({
    url: photo.url || photo.dataUrl,
    label: photo.label || "Property photo"
  })).filter((photo) => photo.url);
  if (!galleryPhotos.length && listing.imageUrl) galleryPhotos.push({ url: listing.imageUrl, label: "Property photo" });
  const selectedPhoto = galleryPhotos[activePhoto];
  return (
    <div className="modal-backdrop" role="presentation">
      <section className="listing-details-modal" role="dialog" aria-modal="true" aria-labelledby="listing-details-title">
        <div className={`details-visual listing-gallery ${selectedPhoto ? "has-property-photo" : ""}`}>
          {selectedPhoto && <img className="gallery-main-image" src={selectedPhoto.url} alt={`${listing.title} — ${selectedPhoto.label}`} />}
          <span className="gallery-shade" />
          <Pill tone={listing.verified ? "green" : "amber"}>{listing.verified ? "Verified listing" : "Review before paying"}</Pill>
          <button aria-label="Close listing details" onClick={onClose}><X size={19} /></button>
          <div><span>{listing.area}</span><strong>{price(listing.rent)}<small>/month</small></strong></div>
          {galleryPhotos.length > 1 && (
            <>
              <button className="gallery-arrow previous" aria-label="Previous property photo" onClick={() => setActivePhoto((current) => (current - 1 + galleryPhotos.length) % galleryPhotos.length)}>‹</button>
              <button className="gallery-arrow next" aria-label="Next property photo" onClick={() => setActivePhoto((current) => (current + 1) % galleryPhotos.length)}>›</button>
              <span className="gallery-counter">{activePhoto + 1} / {galleryPhotos.length}</span>
              <div className="gallery-thumbnails" aria-label="Property photo gallery">
                {galleryPhotos.map((photo, index) => (
                  <button className={index === activePhoto ? "active" : ""} key={`${photo.url}-${index}`} onClick={() => setActivePhoto(index)} aria-label={`Show ${photo.label}`}>
                    <img src={photo.url} alt="" /><span>{photo.label}</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        <div className="details-content">
          <span className="eyebrow">{listing.university}</span>
          <h2 id="listing-details-title">{listing.title}</h2>
          <p className="details-location"><MapPin size={16} /> {listing.address}</p>
          <div className="details-primary-facts" aria-label="Listing overview">
            {match && <span className="compact-fit-score"><Sparkles size={15} /><strong>{match.score}% match</strong></span>}
            <span><CalendarDays size={15} /><strong>{shortDate(listing.availableFrom)}</strong><small>Available</small></span>
            <span><MapPin size={15} /><strong>{Number.isFinite(Number(listing.distanceToCampus)) ? `${listing.distanceToCampus} mi` : "Nearby"}</strong><small>To campus</small></span>
            <span><UsersRound size={15} /><strong>{listing.availableBeds || 1}</strong><small>Available {Number(listing.availableBeds || 1) === 1 ? "bed" : "beds"}</small></span>
          </div>
          {canManageAvailability && (
            <section className="host-availability-control" aria-label="Host availability controls">
              <div><Radio size={17} /><span><strong>Manage availability</strong><small>Students see your latest confirmation immediately.</small></span></div>
              <div>
                <button disabled={availabilityBusy} className={listing.availabilityStatus === "available" ? "active" : ""} onClick={() => onAvailabilityChange(listing, "available")}><CheckCircle2 size={15} /> Still available</button>
                <button disabled={availabilityBusy} onClick={() => onAvailabilityChange(listing, "unavailable")}><X size={15} /> No longer available</button>
              </div>
            </section>
          )}
          <div className="details-description compact"><h3>About this home</h3><p>{listing.description}</p></div>
          <div className="details-amenities compact"><div>{tags.slice(0, 3).map((tag) => <span key={tag}><CheckCircle2 size={14} /> {tag}</span>)}</div></div>
          <section className="listing-decision-summary" aria-label="Essential listing details">
            <div><CircleDollarSign size={18} /><span><small>{listing.pricingBasis === "entire-unit" ? "Entire unit monthly cost" : "Per-person monthly cost"}</small><strong>{money(costs.monthlyTotal)}</strong><em>{money(costs.monthlyExtras)} beyond rent</em></span></div>
            <div><MapPin size={18} /><span><small>Best campus commute</small><strong>{commute.bestMode}</strong><em>{commute.walk} walk · {commute.transit} transit</em></span></div>
            <div><ShieldCheck size={18} /><span><small>Listing quality</small><strong>{listing.quality ? `${listing.quality.score}% complete` : listing.verified ? "Verified" : "Needs review"}</strong><em>{listingFreshness(listing)}</em></span></div>
          </section>
          <div className="details-accordions">
            <details className="detail-accordion">
              <summary><span><CalendarDays size={16} /> Costs and lease details</span><small>See full breakdown</small></summary>
              <div className="lease-clarity">
                <div className="true-cost-lead"><span>Estimated true monthly cost</span><strong>{money(costs.monthlyTotal)}<small>/month</small></strong><p>{money(costs.breakdown.rent)} rent + {money(costs.monthlyExtras)} disclosed monthly extras</p></div>
                <dl><div><dt>Estimated move-in total</dt><dd>{money(costs.moveInTotal)}</dd></div><div><dt>Stay type</dt><dd>{listing.type || "Ask host"}</dd></div><div><dt>Deposit</dt><dd>{Number(listing.deposit) > 0 ? price(listing.deposit) : "Confirm with host"}</dd></div><div><dt>Utilities</dt><dd>{listing.utilitiesIncluded?.length ? listing.utilitiesIncluded.join(", ") : "Not confirmed"}</dd></div><div><dt>End date</dt><dd>{listing.availableTo ? shortDate(listing.availableTo) : "Flexible / ask host"}</dd></div></dl>
                <details className="cost-line-items"><summary>View the full calculation</summary><dl><div><dt>Rent</dt><dd>{money(costs.breakdown.rent)}</dd></div><div><dt>Utilities</dt><dd>{money(costs.breakdown.utilities)}</dd></div><div><dt>Parking</dt><dd>{money(costs.breakdown.parking)}</dd></div><div><dt>Internet</dt><dd>{money(costs.breakdown.internet)}</dd></div><div><dt>Insurance</dt><dd>{money(costs.breakdown.rentersInsurance)}</dd></div><div><dt>Other monthly fees</dt><dd>{money(costs.breakdown.recurringFees)}</dd></div></dl></details>
                <small className="cost-disclaimer">{costs.completeness === "complete" ? "All standard monthly cost fields were provided." : "Estimate uses disclosed charges only. Confirm missing fees with the host."}</small>
              </div>
            </details>
            <CompactTourScheduler listing={listing} profile={profile} />
          </div>
          <div className="details-decision-row">
            <button className={decision === "maybe" ? "selected maybe" : "maybe"} onClick={() => onDecision(listing, "maybe")}><Sparkles size={16} /> Maybe</button>
            <button className={decision === "like" ? "selected like" : "like"} onClick={() => onDecision(listing, "like")}><Heart size={16} fill={decision === "like" ? "currentColor" : "none"} /> Like</button>
            <button className="primary" onClick={() => onContact(listing)}><MessageSquare size={16} /> Contact host</button>
          </div>
        </div>
      </section>
    </div>
  );
}

function fileToEvidence(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = () => reject(new Error(`Could not read ${file.name}`));
    reader.onload = () => resolve({
      kind: file.type === "application/pdf" || file.type.startsWith("text/") ? "lease"
        : file.type.startsWith("image/") ? "image"
          : file.type.startsWith("video/") ? "video"
            : file.type.startsWith("audio/") ? "audio" : "other",
      filename: file.name,
      media_type: file.type || "application/octet-stream",
      content_base64: String(reader.result).split(",")[1]
    });
    reader.readAsDataURL(file);
  });
}

function ContractDiff({ listing, terms }) {
  const listingUnit = listing.unit || listing.unitNumber || listing.title?.match(/unit\s+([a-z0-9-]+)/i)?.[1];
  const rows = [
    { label: "Monthly rent", listing: Number(listing.rent) ? money(listing.rent) : "Not stated", evidence: Number(terms.monthly_rent) ? money(terms.monthly_rent) : null, conflict: Number(terms.monthly_rent) && Number(listing.rent) && Number(terms.monthly_rent) !== Number(listing.rent) },
    { label: "Security deposit", listing: Number(listing.deposit) ? money(listing.deposit) : "Not stated", evidence: Number(terms.security_deposit) ? money(terms.security_deposit) : null, conflict: Number(terms.security_deposit) && Number(listing.deposit) && Number(terms.security_deposit) !== Number(listing.deposit) },
    { label: "Unit", listing: listingUnit ? `Unit ${listingUnit}` : "Not stated", evidence: terms.unit_number ? `Unit ${terms.unit_number}` : null, conflict: listingUnit && terms.unit_number && String(listingUnit).toLowerCase() !== String(terms.unit_number).toLowerCase() },
    { label: "Utilities", listing: listing.utilitiesIncluded?.length ? listing.utilitiesIncluded.join(", ") : "Not confirmed", evidence: terms.utilities_policy || null, conflict: !!terms.utilities_policy && /tenant pays|resident pays|not included/i.test(terms.utilities_policy) && (listing.utilitiesIncluded || []).some((utility) => terms.utilities_policy.toLowerCase().includes(utility.toLowerCase())) },
    { label: "Pets", listing: listing.pets || (listing.tags || []).find((tag) => /pet|cat|dog/i.test(tag)) || "Not confirmed", evidence: terms.pet_policy || null, conflict: terms.pet_policy === "prohibited" && /pet.?friendly|pets allowed|cats allowed|dogs allowed/i.test(`${listing.pets || ""} ${(listing.tags || []).join(" ")}`) }
  ].filter((row) => row.evidence);
  if (!rows.length) return null;
  return (
    <section className="contract-diff" aria-label="Listing ↔ contract">
      <div className="contract-diff-heading"><div><span className="eyebrow">Listing ↔ contract</span><h3>What changed in the fine print</h3></div>{Number(terms.effective_monthly_cost) > 0 && <strong>{money(terms.effective_monthly_cost)}<small> effective monthly</small></strong>}</div>
      <div className="contract-diff-table">
        <div className="contract-diff-head"><span>Term</span><span>Listing</span><span>Evidence</span><span>Result</span></div>
        {rows.map((row) => <div className={`contract-diff-row ${row.conflict ? "conflict" : "aligned"}`} key={row.label}><strong>{row.label}</strong><span>{row.listing}</span><span>{row.evidence}</span><b>{row.conflict ? "Conflict" : "Aligned"}</b></div>)}
      </div>
      {Number(terms.one_time_fees) > 0 && <p className="contract-cost-note"><CircleDollarSign size={15} /> Identified one-time costs total {money(terms.one_time_fees)}. Confirm refundability and payment timing in the cited clauses.</p>}
    </section>
  );
}

function RoomTrustModal({ listing, onClose, onRoomProof }) {
  const [graph, setGraph] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    if (!listing) return undefined;
    setLoading(true);
    setError("");
    api.buildRoomTrustGraph(listing.id)
      .then((result) => { if (!cancelled) setGraph(result); })
      .catch((graphError) => { if (!cancelled) setError(graphError.message); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, [listing]);

  if (!listing) return null;
  const center = { x: 350, y: 175 };
  const entities = (graph?.nodes || []).filter((node) => node.id !== `listing:${listing.id}`).slice(0, 10);
  const positioned = entities.map((node, index) => {
    const angle = (index / Math.max(entities.length, 1)) * Math.PI * 2 - Math.PI / 2;
    const radiusX = entities.length <= 4 ? 215 : 270;
    const radiusY = entities.length <= 4 ? 105 : 125;
    return { ...node, x: center.x + Math.cos(angle) * radiusX, y: center.y + Math.sin(angle) * radiusY };
  });

  return (
    <div className="modal-backdrop roomtrust-backdrop" role="presentation">
      <section className="roomtrust-modal" role="dialog" aria-modal="true" aria-labelledby="roomtrust-title">
        <header>
          <div><span className="eyebrow"><Network size={14} /> Listing relationship intelligence</span><h2 id="roomtrust-title">RoomTrust Graph</h2><p>{listing.title}</p></div>
          <button aria-label="Close RoomTrust Graph" onClick={onClose}><X size={19} /></button>
        </header>
        <div className="roomtrust-body">
          {loading ? <div className="roomtrust-loading"><span /><strong>Building listing relationships…</strong></div> : error ? <p className="roomproof-error">{error}</p> : (
            <>
              <div className="roomtrust-summary"><div><strong>{graph.nodes.length}</strong><span>connected entities</span></div><div><strong>{graph.edges.length}</strong><span>verified relationships</span></div><p>This view connects the listing to normalized host, address, unit, contact, and evidence records. Shared entities become cross-listing risk signals.</p></div>
              <div className="roomtrust-canvas">
                <svg viewBox="0 0 700 350" role="img" aria-label={`Relationship graph for ${listing.title}`}>
                  {positioned.map((node) => <line key={`line-${node.id}`} x1={center.x} y1={center.y} x2={node.x} y2={node.y} />)}
                  <g className="roomtrust-center"><circle cx={center.x} cy={center.y} r="60" /><text x={center.x} y={center.y - 5}>LISTING</text><text className="node-value" x={center.x} y={center.y + 16}>{listing.title.slice(0, 25)}</text></g>
                  {positioned.map((node) => <g className={`roomtrust-svg-node ${node.kind}`} key={node.id}><circle cx={node.x} cy={node.y} r="47" /><text x={node.x} y={node.y - 5}>{node.kind.toUpperCase()}</text><text className="node-value" x={node.x} y={node.y + 14}>{String(node.label).slice(0, 20)}</text></g>)}
                </svg>
              </div>
              <div className="roomtrust-legend"><span><i className="listing" /> Current listing</span><span><i className="entity" /> Evidence or identity entity</span><span><i className="related" /> Related listing</span></div>
              <div className="roomtrust-edge-list">{graph.edges.map((edge, index) => {
                const target = graph.nodes.find((node) => node.id === edge.target);
                const source = graph.nodes.find((node) => node.id === edge.source);
                return <div key={`${edge.source}-${edge.target}-${index}`}><Network size={14} /><span><strong>{source?.label || "Listing"}</strong> {edge.relation.replaceAll("_", " ")} <strong>{target?.label || "entity"}</strong></span></div>;
              })}</div>
              <div className="roomtrust-actions"><button className="ghost" onClick={onClose}>Close</button><button className="primary" onClick={() => onRoomProof(listing)}><ShieldCheck size={16} /> Check evidence with RoomProof</button></div>
            </>
          )}
        </div>
      </section>
    </div>
  );
}

function RoomProofModal({ listing, onClose }) {
  const [files, setFiles] = useState([]);
  const [leaseText, setLeaseText] = useState("");
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState("");
  const [question, setQuestion] = useState("");
  const [answer, setAnswer] = useState(null);

  if (!listing) return null;

  async function runReport() {
    setLoading(true);
    setError("");
    setAnswer(null);
    try {
      const fileEvidence = await Promise.all(files.map(fileToEvidence));
      const evidence = [...fileEvidence];
      if (leaseText.trim()) {
        evidence.push({
          kind: "lease",
          filename: "pasted-lease-notes.txt",
          media_type: "text/plain",
          text: leaseText.trim()
        });
      }
      const result = await api.createRoomProofReport({
        listing,
        user_preferences: {},
        evidence
      });
      setReport(result);
    } catch (runError) {
      setError(runError.message || "RoomProof could not process this evidence.");
    } finally {
      setLoading(false);
    }
  }

  async function askEvidence(event) {
    event.preventDefault();
    if (!question.trim() || !report) return;
    setAnswer(null);
    try {
      setAnswer(await api.askRoomProof(report.report_id, question.trim()));
    } catch (askError) {
      setAnswer({ answer: askError.message, citations: [], abstained: true });
    }
  }

  return (
    <div className="modal-backdrop roomproof-backdrop" role="presentation">
      <section className="roomproof-modal" role="dialog" aria-modal="true" aria-labelledby="roomproof-title">
        <header>
          <div><span className="eyebrow"><ShieldCheck size={14} /> Optional rental evidence check</span><h2 id="roomproof-title">Check documents</h2><p>{listing.title}</p></div>
          <button aria-label="Close room verification" onClick={onClose}><X size={19} /></button>
        </header>

        {!report ? (
          <div className="roomproof-intake">
            <div className="roomproof-intro">
              <strong>Check the important details before you pay.</strong>
              <p>If you want extra confidence, add a lease, sublease, or property photos. We’ll compare them with the listing and show anything that needs attention.</p>
              <div><span><FileText size={16} /> Costs and lease terms</span><span><CheckCircle2 size={16} /> Mismatched details</span><span><ShieldCheck size={16} /> Evidence-backed results</span></div>
            </div>
            <label className="roomproof-upload">
              <UploadCloud size={25} />
              <strong>Add evidence files</strong>
              <span>PDF, text, or property images · up to 10 MB each</span>
              <input type="file" multiple accept=".pdf,.txt,text/plain,image/*" onChange={(event) => setFiles(Array.from(event.target.files || []))} />
            </label>
            {!!files.length && <div className="roomproof-files">{files.map((file) => <span key={`${file.name}-${file.size}`}><FileText size={14} /> {file.name}</span>)}</div>}
            <label className="roomproof-paste">Paste lease text or host terms (optional)<textarea value={leaseText} onChange={(event) => setLeaseText(event.target.value)} placeholder="Example: Monthly rent is $950. Subletting requires written consent…" /></label>
            {error && <p className="roomproof-error">{error}</p>}
            <div className="roomproof-actions"><button className="ghost" onClick={onClose}>Cancel</button><button className="primary" disabled={loading} onClick={runReport}>{loading ? "Checking…" : "Check this room"}</button></div>
          </div>
        ) : (
          <div className="roomproof-report">
            <div className="roomproof-score">
              <div><strong>{report.confidence_score}</strong><span>/100 evidence confidence</span></div>
              <section><span className={`roomproof-status ${report.status}`}>{report.status === "needs_review" ? "Needs review" : "Evidence checked"}</span><h3>{report.recommendation}</h3><p>{report.evidence_summary.artifact_count} artifacts · {report.evidence_summary.documents} documents · {report.evidence_summary.images} images</p></section>
            </div>
            {report.evidence_summary.trust_graph && (() => {
              const relatedListings = report.evidence_summary.trust_graph.nodes.filter((node) => node.kind === "listing" && node.value !== String(listing.id));
              return (
                <section className={`cross-listing-check ${relatedListings.length ? "attention" : "clear"}`}>
                  <Network size={19} />
                  <div>
                    <strong>{relatedListings.length ? "Related listing evidence found" : "No cross-listing conflicts found"}</strong>
                    <p>{relatedListings.length ? `Some submitted evidence is also connected to ${relatedListings.length} other listing${relatedListings.length === 1 ? "" : "s"}. Review the highlighted findings before paying.` : "We checked available addresses, hosts, contacts, descriptions, and evidence for suspicious reuse."}</p>
                  </div>
                </section>
              );
            })()}
            <ContractDiff listing={listing} terms={report.extracted_terms || {}} />
            <div className="roomproof-priority">
              <span className="eyebrow">What needs your attention</span>
              <div className="roomproof-findings">
              {[...report.findings].sort((left, right) => (right.status === "conflict") - (left.status === "conflict") || (right.severity === "high") - (left.severity === "high")).slice(0, 4).map((finding) => (
                <article className={`roomproof-finding ${finding.severity}`} key={finding.id}>
                  <div><span>{finding.category}</span><b>{Math.round(finding.confidence * 100)}% confidence</b></div>
                  <h4>{finding.title}</h4><p>{finding.detail}</p>
                  {finding.citations.map((citation) => <blockquote key={`${citation.evidence_id}-${citation.locator}`}><strong>{citation.filename} · {citation.locator}</strong><span>“{citation.excerpt}”</span></blockquote>)}
                </article>
              ))}
              </div>
            </div>
            {report.findings.length > 4 && <details className="all-verification-checks"><summary>View all {report.findings.length} evidence checks</summary><div className="roomproof-findings">{report.findings.map((finding) => <article className={`roomproof-finding ${finding.severity}`} key={`all-${finding.id}`}><div><span>{finding.category}</span><b>{Math.round(finding.confidence * 100)}% confidence</b></div><h4>{finding.title}</h4><p>{finding.detail}</p>{finding.citations.map((citation) => <blockquote key={`${citation.evidence_id}-${citation.locator}`}><strong>{citation.filename} · {citation.locator}</strong><span>“{citation.excerpt}”</span></blockquote>)}</article>)}</div></details>}
            <form className="roomproof-question" onSubmit={askEvidence}><label>Ask the uploaded evidence<input value={question} onChange={(event) => setQuestion(event.target.value)} placeholder="Does this lease allow subletting?" /></label><button disabled={!question.trim()}>Ask</button></form>
            {answer && <div className={`roomproof-answer ${answer.abstained ? "abstained" : ""}`}><strong>{answer.abstained ? "Not enough evidence" : "Grounded answer"}</strong><p>{answer.answer}</p>{answer.citations?.map((citation) => <small key={citation.evidence_id}>{citation.filename}: {citation.excerpt}</small>)}</div>}
            <div className="roomproof-actions"><button className="ghost" onClick={() => setReport(null)}>Check different evidence</button><button className="primary" onClick={onClose}>Done</button></div>
          </div>
        )}
      </section>
    </div>
  );
}

function AuthModal({ mode, onModeChange, onClose, onSubmit, onVerify, onResend }) {
  const [form, setForm] = useState({
    name: "",
    email: "",
    password: "",
    university: "",
    role: "Student"
  });
  const isSignup = mode === "signup";
  const [error, setError] = useState("");
  const [submitting, setSubmitting] = useState(false);
  const [verification, setVerification] = useState(null);
  const [verificationCode, setVerificationCode] = useState("");

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  async function submit(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      const result = await onSubmit({ ...form, mode });
      if (result?.verificationRequired) setVerification(result);
    } catch (submitError) {
      setError(submitError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function verify(event) {
    event.preventDefault();
    setError("");
    setSubmitting(true);
    try {
      await onVerify(verificationCode);
      onClose();
    } catch (verifyError) {
      setError(verifyError.message);
    } finally {
      setSubmitting(false);
    }
  }

  async function resend() {
    setError("");
    setSubmitting(true);
    try {
      const replacement = await onResend();
      setVerification(replacement);
      setVerificationCode("");
    } catch (resendError) {
      setError(resendError.message);
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <div className="modal-backdrop auth-backdrop" role="presentation">
      <section className="auth-modal" role="dialog" aria-modal="true" aria-labelledby="auth-title">
        <div className="auth-art">
          <span className="eyebrow">Welcome</span>
          <h2>{isSignup ? "Create your housing profile." : "Good to see you again."}</h2>
          <p>Save searches, contact listings, post rooms, and keep your housing conversations in one place.</p>
          <div className="auth-points">
            <span>Verified student-friendly flow</span>
            <span>Realtime room alerts</span>
            <span>Safer contact requests</span>
          </div>
        </div>

        <form className="auth-form" onSubmit={verification ? verify : submit}>
          <div className="section-heading">
            <div>
              <span className="eyebrow">{verification ? "Student verification" : isSignup ? "Sign up" : "Login"}</span>
              <h2 id="auth-title">{verification ? "Check your university email" : isSignup ? "Join RoomBridge" : "Login to RoomBridge"}</h2>
            </div>
            <button type="button" className="ghost icon" aria-label="Close auth modal" onClick={onClose}>
              <X size={17} />
            </button>
          </div>

          {!verification && <div className="auth-tabs" role="group" aria-label="Authentication mode">
            <button type="button" className={mode === "login" ? "active" : ""} onClick={() => onModeChange("login")}>
              Login
            </button>
            <button type="button" className={mode === "signup" ? "active" : ""} onClick={() => onModeChange("signup")}>
              Sign up
            </button>
          </div>}

          {!verification && isSignup && (
            <label>
              Full name
              <input value={form.name} onChange={(event) => update("name", event.target.value)} placeholder="Maya Patel" required />
            </label>
          )}

          {!verification && <label>
            Email
            <input type="email" value={form.email} onChange={(event) => update("email", event.target.value)} placeholder="name@university.edu" required />
          </label>}

          {!verification && <label>
            Password
            <input type="password" value={form.password} onChange={(event) => update("password", event.target.value)} placeholder="At least 8 characters" required />
          </label>}

          {!verification && isSignup && (
            <>
              <label>
                University
                <input value={form.university} onChange={(event) => update("university", event.target.value)} placeholder="Portland State University" required />
              </label>
              <label>
                I am a
                <select value={form.role} onChange={(event) => update("role", event.target.value)}>
                  <option>Student</option>
                  <option>Roommate</option>
                  <option>Host</option>
                </select>
              </label>
            </>
          )}

          {verification && (
            <div className="verification-step">
              <p>Enter the six-digit code sent to <strong>{form.email}</strong>. The code expires in 15 minutes.</p>
              {verification.developmentVerificationCode && (
                <p className="verification-preview">Local preview code: <strong>{verification.developmentVerificationCode}</strong></p>
              )}
              <label>
                Verification code
                <input
                  autoFocus
                  inputMode="numeric"
                  maxLength={6}
                  pattern="[0-9]{6}"
                  value={verificationCode}
                  onChange={(event) => setVerificationCode(event.target.value.replace(/\D/g, ""))}
                  placeholder="000000"
                  required
                />
              </label>
              <button type="button" className="ghost verification-resend" onClick={resend} disabled={submitting}>
                Send a new code
              </button>
            </div>
          )}

          {error && <p className="auth-error" role="alert">{error}</p>}
          <button className="primary auth-submit" disabled={submitting}>
            {verification ? <ShieldCheck size={17} /> : isSignup ? <UserPlus size={17} /> : <LogIn size={17} />}
            {submitting ? "Please wait…" : verification ? "Verify university email" : isSignup ? "Create account" : "Login"}
          </button>
        </form>
      </section>
    </div>
  );
}

function ModePanel({ mode, onModeChange, profiles, selectedProfileId, onSelect }) {
  return (
    <section className="panel compact-panel profile-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Search style</span>
          <h2>Browse your way</h2>
        </div>
        <Search size={22} />
      </div>
      <div className="mode-toggle" role="group" aria-label="Browse mode">
        <button className={mode === "browse" ? "active" : ""} onClick={() => onModeChange("browse")}>
          Browse rooms
        </button>
        <button className={mode === "personalized" ? "active" : ""} onClick={() => onModeChange("personalized")}>
          Personalized match
        </button>
      </div>
      {mode === "personalized" ? (
        <ProfilePanel profiles={profiles} selectedProfileId={selectedProfileId} onSelect={onSelect} />
      ) : (
        <div className="profile-summary">
          <h3>No profile required</h3>
          <p>Start with campus, rent, and location. Matching is optional.</p>
        </div>
      )}
    </section>
  );
}

function ProfilePanel({ profiles, selectedProfileId, onSelect }) {
  const selected = profiles.find((profile) => profile.id === selectedProfileId);
  return (
    <div className="nested-profile">
      <div className="subheading">
        <UserRoundCheck size={18} />
        <strong>Match as</strong>
      </div>
      <select value={selectedProfileId} onChange={(event) => onSelect(event.target.value)}>
        {profiles.map((profile) => (
          <option key={profile.id} value={profile.id}>
            {profile.name}
          </option>
        ))}
      </select>
      {selected && (
        <div className="profile-summary">
          <h3>{selected.name}</h3>
          <p>
            {selected.program} at {selected.university}
          </p>
          <div className="profile-facts">
            <span>{selected.city}, {selected.state}</span>
            <span>{money(selected.budgetMin)}-{money(selected.budgetMax)}</span>
            <span>Move-in {shortDate(selected.moveInDate)}</span>
            <span>{selected.roomType}</span>
            <span>{selected.genderPreference}</span>
          </div>
          <p>{selected.vibe}</p>
        </div>
      )}
    </div>
  );
}

function ListingForm({ onSubmit, busy }) {
  const photoLabels = ["Bedroom", "Kitchen or common area", "Bathroom", "Building exterior", "Floor plan", "Other"];
  const requiredPhotoLabels = ["Bedroom", "Kitchen or common area", "Bathroom"];
  const [form, setForm] = useState({
    ...blankListing,
    title: "New verified room near campus",
    description: "Furnished room posted for an incoming international student. Flexible video tour available.",
    postedBy: "Demo Host"
  });
  const [photos, setPhotos] = useState([]);
  const [photoConsent, setPhotoConsent] = useState(false);
  const [photoError, setPhotoError] = useState("");
  const [uploadingPhotos, setUploadingPhotos] = useState(false);
  const [step, setStep] = useState(0);
  const [formError, setFormError] = useState("");
  const steps = [
    { title: "Property", hint: "Where is the room?" },
    { title: "Pricing & lease", hint: "What will students pay?" },
    { title: "Photos", hint: "Show the actual space" },
    { title: "Review", hint: "Confirm and publish" }
  ];

  function update(key, value) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function updateUniversity(value) {
    const meta = universityMeta(value);
    setForm((current) => ({
      ...current,
      university: value,
      city: meta?.city || current.city,
      state: meta?.state || current.state,
      area: meta?.areas[0] || current.area,
      address: current.address
    }));
  }

  const selectedUniversity = universityMeta(form.university);

  function addPhotos(event) {
    const files = [...(event.target.files || [])];
    const invalid = files.find((file) => !["image/jpeg", "image/png", "image/webp"].includes(file.type) || file.size > 6 * 1024 * 1024);
    if (invalid) {
      setPhotoError("Use JPG, PNG, or WebP images smaller than 6 MB.");
      event.target.value = "";
      return;
    }
    const available = Math.max(0, 8 - photos.length);
    const additions = files.slice(0, available).map((file, index) => ({
      id: `${file.name}-${file.lastModified}-${index}`,
      file,
      label: requiredPhotoLabels[photos.length + index] || "Other",
      preview: URL.createObjectURL(file)
    }));
    setPhotos((current) => [...current, ...additions]);
    setPhotoError(files.length > available ? "A listing can include up to eight photos." : "");
    event.target.value = "";
  }

  function removePhoto(photoId) {
    setPhotos((current) => {
      const removed = current.find((photo) => photo.id === photoId);
      if (removed) URL.revokeObjectURL(removed.preview);
      return current.filter((photo) => photo.id !== photoId);
    });
  }

  function validateStep(currentStep) {
    if (currentStep === 0 && (!form.university.trim() || !form.address.trim() || !form.unitNumber.trim())) {
      return "Add the university, street address, and exact unit number.";
    }
    if (currentStep === 1 && (!(Number(form.rent) > 0) || !form.availableFrom || !form.availableTo || !form.roomType)) {
      return "Add rent, room type, and complete lease dates.";
    }
    if (currentStep === 2) {
      const labels = new Set(photos.map((photo) => photo.label));
      const missing = requiredPhotoLabels.filter((label) => !labels.has(label));
      if (photos.length < 3 || missing.length) return `Add and label the required photos: ${missing.join(", ") || requiredPhotoLabels.join(", ")}.`;
      if (!photoConsent) return "Confirm that the photos show the actual available room.";
    }
    return "";
  }

  function goNext() {
    const error = validateStep(step);
    setFormError(error);
    if (!error) setStep((current) => Math.min(3, current + 1));
  }

  async function submitListing(event) {
    event.preventDefault();
    const labels = new Set(photos.map((photo) => photo.label));
    const missing = requiredPhotoLabels.filter((label) => !labels.has(label));
    if (photos.length < 3 || missing.length) {
      setPhotoError(`Add at least three photos and label: ${missing.join(", ") || requiredPhotoLabels.join(", ")}.`);
      return;
    }
    if (!photoConsent) {
      setPhotoError("Confirm that these photos show the actual available room.");
      return;
    }
    setPhotoError("");
    setUploadingPhotos(true);
    try {
      const uploaded = await api.uploadListingPhotos(photos.map((photo) => photo.file));
      await onSubmit({
        ...form,
        photos: uploaded.photos.map((photo, index) => ({ ...photo, label: photos[index].label })),
        imageUrl: uploaded.photos[0]?.url || null
      });
    } catch (error) {
      setPhotoError(error.message);
    } finally {
      setUploadingPhotos(false);
    }
  }

  return (
    <section className="panel compact-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">For hosts</span>
          <h2>Post a listing</h2>
        </div>
        <Plus size={22} />
      </div>
      <form
        className="listing-wizard"
        onSubmit={submitListing}
      >
        <nav className="wizard-steps" aria-label="Listing progress">
          {steps.map((item, index) => (
            <button type="button" className={`${index === step ? "active" : ""} ${index < step ? "complete" : ""}`} onClick={() => index < step && setStep(index)} key={item.title}>
              <span>{index < step ? <CheckCircle2 size={16} /> : index + 1}</span>
              <div><strong>{item.title}</strong><small>{item.hint}</small></div>
            </button>
          ))}
        </nav>

        <div className="wizard-stage">
          <header><span>Step {step + 1} of 4</span><h3>{steps[step].title}</h3><p>{steps[step].hint}</p></header>

          {step === 0 && (
            <div className="wizard-fields">
              <label>Property or building name<input value={form.apartmentName} onChange={(event) => update("apartmentName", event.target.value)} placeholder="University Pointe" /></label>
              <label>University<input list="host-universities" value={form.university} onChange={(event) => updateUniversity(event.target.value)} required /><datalist id="host-universities">{universityOptions.map((option) => <option key={option.university}>{option.university}</option>)}</datalist></label>
              <label>Area<input list="host-areas" value={form.area} onChange={(event) => update("area", event.target.value)} /><datalist id="host-areas">{(selectedUniversity?.areas || []).map((area) => <option key={area}>{area}</option>)}</datalist></label>
              <label>Street address<input value={form.address} onChange={(event) => update("address", event.target.value)} placeholder="123 College Avenue" required /></label>
              <label>Unit number<input value={form.unitNumber} onChange={(event) => update("unitNumber", event.target.value)} placeholder="304 or B" required /></label>
              <label>Campus destination<input value={form.campusDestination} onChange={(event) => update("campusDestination", event.target.value)} placeholder="Main campus or engineering building" /></label>
            </div>
          )}

          {step === 1 && (
            <div className="wizard-fields">
              <label>Monthly rent<input type="number" min="1" value={form.rent} onChange={(event) => update("rent", event.target.value)} required /></label>
              <label>Rent applies to<select value={form.pricingBasis} onChange={(event) => update("pricingBasis", event.target.value)}><option value="per-person">Each person / bed</option><option value="entire-unit">Entire unit</option></select></label>
              <label>Available beds<input type="number" min="1" max="20" value={form.availableBeds} onChange={(event) => update("availableBeds", event.target.value)} required /></label>
              <label>Room type<select value={form.roomType} onChange={(event) => update("roomType", event.target.value)}><option>Private room</option><option>Shared room</option><option>Studio or private room</option><option>Shared apartment</option></select></label>
              <label>Available from<input type="date" value={form.availableFrom} onChange={(event) => update("availableFrom", event.target.value)} required /></label>
              <label>Lease ends<input type="date" min={form.availableFrom} value={form.availableTo} onChange={(event) => update("availableTo", event.target.value)} required /></label>
              <label>Estimated utilities / month<input type="number" min="0" value={form.utilitiesMonthly} onChange={(event) => update("utilitiesMonthly", event.target.value)} /></label>
              <label>Application fee<input type="number" min="0" value={form.applicationFee} onChange={(event) => update("applicationFee", event.target.value)} /></label>
              <label>Gender preference<select value={form.genderPreference} onChange={(event) => update("genderPreference", event.target.value)}><option>No preference</option><option>Women only</option><option>Men only</option></select></label>
              <label className="wide">Description<textarea value={form.description} onChange={(event) => update("description", event.target.value)} /></label>
              <div className="wizard-checks wide">
                <label><input type="checkbox" checked={form.acceptsNoCreditHistory} onChange={(event) => update("acceptsNoCreditHistory", event.target.checked)} /> Accepts students without U.S. credit history</label>
                <label><input type="checkbox" checked={!form.ssnRequired} onChange={(event) => update("ssnRequired", !event.target.checked)} /> SSN not required to apply</label>
                <label><input type="checkbox" checked={form.remoteSigning} onChange={(event) => update("remoteSigning", event.target.checked)} /> Remote signing available</label>
              </div>
            </div>
          )}

          {step === 2 && (
            <fieldset className="listing-photo-fieldset standard">
              <legend>Room photos <span>3 required</span></legend>
              <p>Add clear, current photos. The first photo becomes the listing cover.</p>
              <label className="standard-photo-picker"><UploadCloud size={17} /> Choose photos<input type="file" accept="image/jpeg,image/png,image/webp" multiple onChange={addPhotos} /></label>
              {!!photos.length && <div className="listing-photo-list">{photos.map((photo, index) => <article key={photo.id}><img src={photo.preview} alt="" /><div><strong>{index === 0 ? `Cover · ${photo.file.name}` : photo.file.name}</strong><select value={photo.label} aria-label={`Photo label for ${photo.file.name}`} onChange={(event) => setPhotos((current) => current.map((item) => item.id === photo.id ? { ...item, label: event.target.value } : item))}>{photoLabels.map((label) => <option key={label}>{label}</option>)}</select></div><button type="button" aria-label={`Remove ${photo.file.name}`} onClick={() => removePhoto(photo.id)}><X size={15} /></button></article>)}</div>}
              <div className="photo-requirements">{requiredPhotoLabels.map((label) => <span className={photos.some((photo) => photo.label === label) ? "complete" : ""} key={label}><CheckCircle2 size={14} /> {label}</span>)}</div>
              <label className="photo-confirmation"><input type="checkbox" checked={photoConsent} onChange={(event) => setPhotoConsent(event.target.checked)} /> I confirm these photos show the actual room currently being offered.</label>
              <small className="photo-privacy-note">JPG, PNG, or WebP; maximum 6 MB each. Avoid personal information in the frame.</small>
              {photoError && <span className="listing-photo-error" role="alert">{photoError}</span>}
            </fieldset>
          )}

          {step === 3 && (
            <section className="listing-review">
              <div className="review-cover">{photos[0] ? <img src={photos[0].preview} alt="" /> : <Home size={30} />}</div>
              <div><span className="eyebrow">Ready to publish</span><h3>{form.apartmentName || form.address} – Unit {form.unitNumber}</h3><p>{form.roomType} near {form.university}</p></div>
              <dl>
                <div><dt>Monthly rent</dt><dd>{money(form.rent)} · {form.pricingBasis === "entire-unit" ? "entire unit" : "per person"}</dd></div>
                <div><dt>Availability</dt><dd>{shortDate(form.availableFrom)} – {shortDate(form.availableTo)}</dd></div>
                <div><dt>Photos</dt><dd>{photos.length} labeled photos</dd></div>
                <div><dt>Location</dt><dd>{form.address}, Unit {form.unitNumber}</dd></div>
              </dl>
              <p className="review-note"><ShieldCheck size={16} /> RoomBridge will display the exact pricing basis, availability freshness, and photo coverage to students.</p>
            </section>
          )}

          {formError && <p className="wizard-error" role="alert">{formError}</p>}
          <footer className="wizard-actions">
            {step > 0 && <button type="button" className="ghost" onClick={() => { setFormError(""); setStep((current) => current - 1); }}>Back</button>}
            {step < 3 ? <button type="button" className="primary" onClick={goNext}>Continue</button> : <button className="primary" disabled={busy || uploadingPhotos}><Radio size={17} />{busy || uploadingPhotos ? "Uploading and posting..." : "Publish listing"}</button>}
          </footer>
        </div>
      </form>
    </section>
  );
}

function PostRoomPage({ onSubmit, busy, onBrowse }) {
  return (
    <section className="post-room-page" id="post-room" aria-labelledby="post-room-title">
      <header className="post-room-hero">
        <div>
          <span className="eyebrow">For students and verified hosts</span>
          <h1 id="post-room-title">Share a room with the right details upfront.</h1>
          <p>Clear pricing, availability, campus location, and lease expectations help students decide whether to contact you.</p>
        </div>
        <button className="ghost" onClick={onBrowse}><Search size={16} /> Browse rooms</button>
      </header>
      <div className="post-room-layout">
        <aside>
          <strong>A stronger listing includes</strong>
          <span><CheckCircle2 size={16} /> The actual monthly rent and recurring fees</span>
          <span><CheckCircle2 size={16} /> A precise campus and neighborhood</span>
          <span><CheckCircle2 size={16} /> Availability and lease dates</span>
          <span><CheckCircle2 size={16} /> Room type and household expectations</span>
          <small>RoomBridge screens submitted text before publishing and may ask for corrections when important information is missing.</small>
        </aside>
        <ListingForm onSubmit={onSubmit} busy={busy} />
      </div>
    </section>
  );
}

function HousingJourneyTools({ listing, profile }) {
  const [tasks, setTasks] = useState([]);
  const [task, setTask] = useState({ title: "", dueDate: "" });
  const [agreement, setAgreement] = useState({ cleaning: "Weekly rotation", guests: "Ask before overnight guests", quietHours: "10 PM–7 AM", expenses: "Split shared supplies equally" });
  const [conditionNote, setConditionNote] = useState("");
  const [conditionFiles, setConditionFiles] = useState([]);
  const [vaultFiles, setVaultFiles] = useState([]);
  const [supportIssue, setSupportIssue] = useState("");
  const [status, setStatus] = useState("");

  useEffect(() => {
    if (!profile?.id) return;
    api.journey(profile.id).then(setTasks).catch(() => {});
  }, [profile?.id]);

  async function addTask(event) {
    event.preventDefault();
    if (!task.title.trim()) return;
    const created = await api.createJourneyTask({ ...task, profileId: profile?.id || "guest", listingId: listing?.id });
    setTasks((current) => [created, ...current]);
    setTask({ title: "", dueDate: "" });
  }

  async function saveAgreement() {
    await api.createRoommateAgreement({ profileId: profile?.id || "guest", listingId: listing?.id, terms: agreement });
    setStatus("Roommate agreement draft saved");
  }

  async function saveConditionReport() {
    await api.createConditionReport({ profileId: profile?.id || "guest", listingId: listing?.id, note: conditionNote, photos: conditionFiles.map((file) => ({ name: file.name, size: file.size, type: file.type })), capturedAt: new Date().toISOString() });
    setConditionNote("");
    setConditionFiles([]);
    setStatus("Timestamped move-in condition report saved");
  }

  async function storeFiles(files) {
    const selected = Array.from(files || []);
    const evidence = await Promise.all(selected.map(fileToEvidence));
    const saved = await Promise.all(selected.map((file, index) => api.saveVaultDocument({
        profileId: profile?.id || "guest",
        filename: file.name,
        mediaType: file.type,
        size: file.size,
        contentBase64: evidence[index].content_base64
      })));
    setVaultFiles((current) => [...current, ...saved]);
    setStatus(`${saved.length} private document${saved.length === 1 ? "" : "s"} added`);
  }

  async function requestSupport() {
    if (!supportIssue.trim()) return;
    await api.createSupportCase({ profileId: profile?.id || "guest", listingId: listing?.id, issue: supportIssue.trim() });
    setSupportIssue("");
    setStatus("Housing support request created");
  }

  const university = profile?.university || listing?.university || "Your university";
  return (
    <section className="journey-toolkit" aria-labelledby="journey-toolkit-title">
      <header><span className="eyebrow">Housing Journey workspace</span><h2 id="journey-toolkit-title">From application to move-in, in one place.</h2><p>Keep deadlines, agreements, documents and support steps connected to the room you are considering.</p></header>
      {status && <div className="toolkit-status"><CheckCircle2 size={16} /> {status}</div>}
      <div className="journey-tool-grid">
        <article>
          <div className="tool-icon"><CalendarDays size={19} /></div><h3>Deadline tracker</h3><p>Track applications, deposits, lease signing and move-in tasks.</p>
          <form className="task-form" onSubmit={addTask}><input value={task.title} onChange={(event) => setTask((current) => ({ ...current, title: event.target.value }))} placeholder="Add a housing task" /><input type="date" value={task.dueDate} onChange={(event) => setTask((current) => ({ ...current, dueDate: event.target.value }))} /><button><Plus size={15} /></button></form>
          <div className="journey-task-list">{tasks.slice(0, 4).map((item) => <span key={item.id}><span className="empty-check" /><b>{item.title}</b><small>{item.dueDate ? shortDate(item.dueDate) : "No deadline"}</small></span>)}</div>
        </article>
        <article>
          <div className="tool-icon"><UsersRound size={19} /></div><h3>Roommate agreement</h3><p>Set expectations before small differences become conflicts.</p>
          <div className="agreement-fields">{Object.entries(agreement).map(([key, value]) => <label key={key}>{key.replace(/([A-Z])/g, " $1")}<input value={value} onChange={(event) => setAgreement((current) => ({ ...current, [key]: event.target.value }))} /></label>)}</div>
          <button className="tool-action" onClick={saveAgreement}>Save agreement draft</button>
        </article>
        <article>
          <div className="tool-icon"><UploadCloud size={19} /></div><h3>Private document vault</h3><p>Keep application documents private until you intentionally share them.</p>
          <label className="vault-drop"><UploadCloud size={22} /><span>Add ID, enrollment or income documents</span><input type="file" multiple onChange={(event) => storeFiles(event.target.files)} /></label>
          <div className="vault-list">{vaultFiles.map((file) => <span key={file.id}><FileText size={14} /> {file.filename}<b>Private</b></span>)}</div>
        </article>
        <article>
          <div className="tool-icon"><Home size={19} /></div><h3>Move-in condition report</h3><p>Timestamp existing damage and notes before unpacking.</p>
          <textarea value={conditionNote} onChange={(event) => setConditionNote(event.target.value)} placeholder="Describe scratches, stains, missing items or meter readings…" />
          <label className="condition-photos"><UploadCloud size={15} /> Add room photos<input type="file" accept="image/*" multiple onChange={(event) => setConditionFiles(Array.from(event.target.files || []))} /></label>
          {!!conditionFiles.length && <small>{conditionFiles.length} photo{conditionFiles.length === 1 ? "" : "s"} ready to timestamp</small>}
          <button className="tool-action" disabled={!conditionNote.trim()} onClick={saveConditionReport}>Save timestamped report</button>
        </article>
        <article>
          <div className="tool-icon"><ShieldCheck size={19} /></div><h3>{university} resources</h3><p>Useful contacts when a housing problem needs human help.</p>
          <div className="resource-links"><a href={`https://www.google.com/search?q=${encodeURIComponent(`${university} student legal services housing`)}`} target="_blank" rel="noreferrer">Student legal services</a><a href={`https://www.google.com/search?q=${encodeURIComponent(`${university} emergency housing`)}`} target="_blank" rel="noreferrer">Emergency housing</a><a href={`https://www.google.com/search?q=${encodeURIComponent(`${university} off campus housing office`)}`} target="_blank" rel="noreferrer">Off-campus housing office</a></div>
        </article>
        <article>
          <div className="tool-icon"><Flag size={19} /></div><h3>Housing support escalation</h3><p>Report fraud, unsafe housing, displacement or urgent lease concerns.</p>
          <textarea value={supportIssue} onChange={(event) => setSupportIssue(event.target.value)} placeholder="Briefly describe what happened…" />
          <button className="tool-action" disabled={!supportIssue.trim()} onClick={requestSupport}>Create support request</button>
        </article>
      </div>
    </section>
  );
}

function PlanCenter({ listings, profile, onBrowse, onOpenListing }) {
  const [selectedId, setSelectedId] = useState(listings[0]?.id || "");
  const selected = listings.find((listing) => listing.id === selectedId) || listings[0];
  const [budget, setBudget] = useState(1400);
  const costs = trueCostFor(selected || {});
  const comparison = useMemo(() => listings
    .map((listing) => ({ listing, costs: trueCostFor(listing) }))
    .sort((a, b) => a.costs.monthlyTotal - b.costs.monthlyTotal)
    .slice(0, 3), [listings]);
  const missingCosts = [
    ["utilitiesMonthly", "Utilities"],
    ["parkingMonthly", "Parking"],
    ["internetMonthly", "Internet"],
    ["rentersInsuranceMonthly", "Renters insurance"],
    ["applicationFee", "Application fee"],
    ["administrationFee", "Administration fee"]
  ].filter(([key]) => selected?.[key] === undefined || selected?.[key] === null || selected?.[key] === "");
  const budgetDifference = Number(budget) - costs.monthlyTotal;
  const affordability = budgetDifference >= 150
    ? { status: "comfortable", label: `${money(budgetDifference)} below your budget` }
    : budgetDifference >= 0
      ? { status: "close", label: `Only ${money(budgetDifference)} below your budget` }
      : { status: "over", label: `${money(Math.abs(budgetDifference))} above your budget` };

  return (
    <section className="journey-page" aria-labelledby="plan-page-title">
      <header className="journey-hero">
        <div>
          <span className="eyebrow">Before you choose</span>
          <h1 id="plan-page-title">Make one confident housing decision.</h1>
          <p>Choose a room and we’ll surface the few things worth knowing before you apply, sign, or pay.</p>
        </div>
        <button className="primary" onClick={onBrowse}><Search size={16} /> Browse rooms</button>
      </header>

      <div className="journey-controls">
        <label>
          Room you are considering
          <select value={selected?.id || ""} onChange={(event) => setSelectedId(event.target.value)}>
            {listings.map((listing) => <option key={listing.id} value={listing.id}>{listing.title}</option>)}
          </select>
        </label>
        <label>
          Your monthly housing budget
          <span><b>$</b><input type="number" min="0" value={budget} onChange={(event) => setBudget(event.target.value)} /></span>
        </label>
      </div>

      <div className="decision-sentence">
        <span>{selected?.title}</span>
        <p>
          About <strong>{money(costs.monthlyTotal)} each month</strong>,
          {" "}<strong className={affordability.status}>{affordability.label}</strong>,
          and approximately <strong>{money(costs.moveInTotal)} before move-in</strong>.
        </p>
      </div>

      <div className="journey-steps">
        <section>
          <span className="journey-number">01</span>
          <div>
            <span className="eyebrow">Before you apply</span>
            <h2>Know what has not been disclosed.</h2>
            {missingCosts.length ? (
              <p>Ask about {missingCosts.map(([, label]) => label.toLowerCase()).join(", ")} before paying an application fee.</p>
            ) : (
              <p>The standard cost fields were provided. Confirm that the same amounts appear in the lease.</p>
            )}
            <button className="text-action" onClick={() => onOpenListing(selected)}>Open room details →</button>
          </div>
        </section>

        <section>
          <span className="journey-number">02</span>
          <div>
            <span className="eyebrow">Before you decide</span>
            <h2>Compare the total, not the headline rent.</h2>
            <div className="journey-comparison">
              {comparison.map(({ listing, costs: listingCosts }) => (
                <button key={listing.id} onClick={() => setSelectedId(listing.id)}>
                  <span><strong>{listing.title}</strong><small>{money(listing.rent)} advertised</small></span>
                  <span><strong>{money(listingCosts.monthlyTotal)}</strong><small>estimated monthly</small></span>
                </button>
              ))}
            </div>
          </div>
        </section>

        <section>
          <span className="journey-number">03</span>
          <div>
            <span className="eyebrow">Before you sign</span>
            <h2>Match every promise to the lease.</h2>
            <p>Check rent, deposit, utilities, parking, lease dates and subletting rules. Use Verify this room only when you are seriously considering the listing.</p>
            <button className="text-action" onClick={() => onOpenListing(selected)}>Review and verify this room →</button>
          </div>
        </section>

        <section>
          <span className="journey-number">04</span>
          <div>
            <span className="eyebrow">Before you move</span>
            <h2>Prepare approximately {money(costs.moveInTotal)}.</h2>
            <p>This includes the estimated first month, {money(costs.breakdown.deposit)} deposit, and {money(costs.breakdown.applicationFee + costs.breakdown.administrationFee + costs.breakdown.petDeposit)} in disclosed application or setup charges.</p>
            <details className="journey-breakdown">
              <summary>See how this was calculated</summary>
              <dl>
                <div><dt>Advertised rent</dt><dd>{money(costs.breakdown.rent)}</dd></div>
                <div><dt>Monthly costs beyond rent</dt><dd>{money(costs.monthlyExtras)}</dd></div>
                <div><dt>Deposit</dt><dd>{money(costs.breakdown.deposit)}</dd></div>
                <div><dt>Application and setup charges</dt><dd>{money(costs.breakdown.applicationFee + costs.breakdown.administrationFee + costs.breakdown.petDeposit)}</dd></div>
              </dl>
            </details>
          </div>
        </section>
      </div>

      <details className="plan-tool-disclosure">
        <summary>
          <span><Sparkles size={17} /><strong>Additional planning tools</strong></span>
          <small>Tasks, roommate agreement, document vault and move-in support</small>
        </summary>
        <HousingJourneyTools listing={selected} profile={profile} />
      </details>

      <footer className="journey-note">
        <ShieldCheck size={18} />
        <p>RoomBridge estimates use disclosed listing information. Always confirm the final amounts in the lease before signing or paying.</p>
      </footer>
    </section>
  );
}

function RecentlyAdded({ listings }) {
  const recent = listings.slice(0, 3);

  return (
    <section className="panel compact-panel activity">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Fresh rooms</span>
          <h2>Recently added</h2>
        </div>
        <Clock3 size={22} />
      </div>
      <div className="activity-list">
        {recent.map((listing) => (
          <div className="activity-item" key={listing.id}>
            <span className="dot green" />
            <div>
              <strong>{listing.title}</strong>
              <p>{listing.university} · {money(listing.rent)}/mo</p>
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function SafetyTips() {
  return (
    <section className="panel compact-panel tips-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Before you pay</span>
          <h2>Safety checklist</h2>
        </div>
        <ShieldCheck size={22} />
      </div>
      <div className="tip-list">
        <span><CheckCircle2 size={16} /> Ask for a live video tour</span>
        <span><CheckCircle2 size={16} /> Verify the lease or sublease</span>
        <span><CheckCircle2 size={16} /> Avoid deposits before proof</span>
      </div>
    </section>
  );
}

function SearchOverview({ filters, resultCount, savedCount, onSaveAlert }) {
  const location = [filters.city, filters.state].filter(Boolean).join(", ");
  return (
    <section className="panel compact-panel search-overview">
      <div className="section-heading">
        <div><span className="eyebrow">Your search</span><h2>{filters.university || "Explore any campus"}</h2></div>
        <MapPin size={21} />
      </div>
      <p>{location || "Choose a city and state to focus live availability."}</p>
      <div className="overview-facts">
        <div><strong>{resultCount}</strong><span>results</span></div>
        <div><strong>{savedCount}</strong><span>saved</span></div>
        <div><strong>{filters.maxRent ? `$${Number(filters.maxRent).toLocaleString()}` : "Any"}</strong><span>max rent</span></div>
      </div>
      <button className="overview-alert" onClick={onSaveAlert}><Bell size={16} /> Save this search</button>
    </section>
  );
}

function ModerationPanel({ queue }) {
  return (
    <section className="panel compact-panel">
      <div className="section-heading">
        <div>
          <span className="eyebrow">Safety</span>
          <h2>Review queue</h2>
        </div>
        <ShieldCheck size={22} />
      </div>
      <div className="moderation-list">
        {queue.map((item) => (
          <div key={item.id}>
            <Pill tone={item.severity === "high" ? "red" : "amber"}>{item.severity}</Pill>
            <strong>{item.title}</strong>
            <span>{item.reason}</span>
          </div>
        ))}
      </div>
    </section>
  );
}

function LandingSections({ onBrowse, onCampus }) {
  const campuses = universityOptions.slice(0, 6);
  return (
    <>
      <section className="landing-trust" aria-label="RoomBridge benefits">
        <div><ShieldCheck size={22} /><strong>Safety signals</strong><span>See verification details before you contact</span></div>
        <div><SlidersHorizontal size={22} /><strong>Useful filters</strong><span>Rent, distance, laundry, pets, and more</span></div>
        <div><Heart size={22} /><strong>Your shortlist</strong><span>Like, save, and compare promising homes</span></div>
      </section>

      <section className="landing-section how-section" id="how-it-works">
        <div className="landing-heading">
          <span className="eyebrow">How RoomBridge works</span>
          <h2>Less searching. More clarity.</h2>
          <p>A focused path from “I need a room” to a shortlist you can actually compare.</p>
        </div>
        <div className="how-grid">
          <article><span>01</span><Search size={24} /><h3>Choose your campus</h3><p>Search a university, city, or neighborhood to focus the available rooms.</p></article>
          <article><span>02</span><Heart size={24} /><h3>Build a shortlist</h3><p>Pass, save as maybe, or like a home without losing your place in the results.</p></article>
          <article><span>03</span><MessageSquare size={24} /><h3>Review, then contact</h3><p>Compare costs, distance, availability, and safety details before reaching out.</p></article>
        </div>
      </section>

      <section className="student-proof" aria-label="Room comparison preview">
        <div className="proof-quote">
          <span className="eyebrow">Made for real decisions</span>
          <h2>Keep the details that matter in one view.</h2>
          <p>Compare monthly rent, campus distance, availability, room style, and verification status—without juggling tabs.</p>
          <button type="button" onClick={onBrowse}>Explore the room feed <span>→</span></button>
        </div>
        <div className="proof-stats" aria-label="Example room comparison">
          <div className="preview-card preview-like"><span>Liked</span><strong>University Pointe</strong><small>$1,180 · 0.6 mi away</small></div>
          <div className="preview-card preview-maybe"><span>Maybe</span><strong>Park Avenue House</strong><small>$1,050 · Furnished</small></div>
          <div className="preview-check"><ShieldCheck size={18} /><span><strong>Review before you contact</strong><small>Check the address, lease, and host details.</small></span></div>
        </div>
      </section>

      <section className="landing-section campus-section" id="campuses">
        <div className="landing-heading split-heading">
          <div><span className="eyebrow">Popular campuses</span><h2>Start somewhere familiar.</h2></div>
          <p>Choose a campus to open the room feed with its city and nearby areas ready to explore.</p>
        </div>
        <div className="landing-campus-grid">
          {campuses.map((campus) => (
            <button key={campus.university} onClick={() => onCampus(campus)}>
              <MapPin size={20} />
              <strong>{campus.university}</strong>
              <span>{campus.city}, {campus.state}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="landing-cta">
        <div><span className="eyebrow">Your next place starts here</span><h2>A simpler way to find your room.</h2><p>Explore current rooms, narrow the results around your needs, and keep the strongest options together.</p></div>
        <button className="primary" onClick={onBrowse}>See available rooms <Search size={18} /></button>
      </section>
    </>
  );
}

function SiteFooter({ onHome, onRooms, onHow }) {
  return (
    <footer className="site-footer">
      <div className="footer-main">
        <div className="footer-brand"><BrandMark /><div><strong>RoomBridge</strong><p>Student housing discovery built around the way you live and study.</p></div></div>
        <div><strong>Explore</strong><button onClick={onHome}>Home</button><button onClick={onRooms}>Find rooms</button></div>
        <div><strong>Support</strong><a href="mailto:support@roombridge.example">Contact support</a><a href="#how-it-works" onClick={onHow}>How it works</a></div>
        <div><strong>Safety</strong><span>Verify before paying</span><span>Request a video tour</span></div>
      </div>
      <div className="footer-bottom"><span>© 2026 RoomBridge</span><span>Made for students moving to U.S. campuses.</span></div>
    </footer>
  );
}

function HomeAssistant({ onBrowseSuggestion }) {
  const [open, setOpen] = useState(false);
  const [input, setInput] = useState("");
  const [loading, setLoading] = useState(false);
  const [messages, setMessages] = useState([
    {
      role: "assistant",
      content: "Hi! I can help you find a room, understand the search process, or explain how to verify a listing.",
      followUps: ["Find rooms under $1,200", "Show furnished rooms", "How do I verify a listing?"]
    }
  ]);

  async function sendMessage(message) {
    const clean = message.trim();
    if (!clean || loading) return;
    const history = messages.slice(-8).map(({ role, content }) => ({ role, content }));
    setInput("");
    setMessages((current) => [...current, { role: "user", content: clean }]);
    setLoading(true);
    try {
      const response = await api.askHomeAssistant(clean, history);
      setMessages((current) => [...current, {
        role: "assistant",
        content: response.answer,
        suggestions: response.suggestions || [],
        followUps: response.follow_up_prompts || []
      }]);
    } catch (error) {
      setMessages((current) => [...current, {
        role: "assistant",
        content: error.message || "I’m temporarily unavailable. You can still browse rooms normally.",
        error: true
      }]);
    } finally {
      setLoading(false);
    }
  }

  return (
    <aside className={`home-assistant ${open ? "open" : ""}`} aria-label="RoomBridge assistant">
      {open && (
        <section className="home-assistant-panel" role="dialog" aria-modal="false" aria-labelledby="home-assistant-title">
          <header>
            <div className="assistant-avatar"><Bot size={19} /></div>
            <div><strong id="home-assistant-title">Ask RoomBridge</strong><span><i /> Housing assistant</span></div>
            <button aria-label="Close RoomBridge assistant" onClick={() => setOpen(false)}><X size={17} /></button>
          </header>
          <div className="assistant-messages" aria-live="polite">
            {messages.map((message, index) => (
              <div className={`assistant-message ${message.role} ${message.error ? "error" : ""}`} key={`${message.role}-${index}`}>
                <p>{message.content}</p>
                {!!message.suggestions?.length && <div className="assistant-listings">{message.suggestions.map((listing) => (
                  <button key={listing.id} onClick={() => onBrowseSuggestion(listing)}>
                    <span><strong>{listing.title}</strong><small>{[listing.area, listing.university].filter(Boolean).join(" · ")}</small></span>
                    <b>{listing.rent ? money(listing.rent) : "View"}</b>
                  </button>
                ))}</div>}
                {!!message.followUps?.length && index === messages.length - 1 && <div className="assistant-prompts">{message.followUps.map((prompt) => <button key={prompt} onClick={() => sendMessage(prompt)}>{prompt}</button>)}</div>}
              </div>
            ))}
            {loading && <div className="assistant-typing" aria-label="Assistant is responding"><span /><span /><span /></div>}
          </div>
          <form onSubmit={(event) => { event.preventDefault(); sendMessage(input); }}>
            <input value={input} onChange={(event) => setInput(event.target.value)} placeholder="Ask about rooms, leases, or safety…" aria-label="Message RoomBridge assistant" />
            <button disabled={!input.trim() || loading} aria-label="Send message"><Send size={17} /></button>
          </form>
          <small className="assistant-disclaimer">Uses current RoomBridge listing data. Always verify before paying.</small>
        </section>
      )}
      <button className="home-assistant-launcher" onClick={() => setOpen((current) => !current)} aria-expanded={open}>
        {open ? <X size={19} /> : <Bot size={20} />}
        <span>{open ? "Close" : "Ask RoomBridge"}</span>
      </button>
    </aside>
  );
}

function ShortlistDock({ listings, likedIds, maybeIds, onReview, onRemove }) {
  if (!listings.length) return null;
  return (
    <aside className="shortlist-dock" aria-label="Saved room shortlist">
      <div className="shortlist-dock-heading">
        <span><Heart size={16} fill="currentColor" /> Your shortlist</span>
        <strong>{likedIds.size} liked · {maybeIds.size} maybe</strong>
      </div>
      <div className="shortlist-mini-list">
        {listings.slice(0, 3).map((listing) => (
          <div key={listing.id}>
            <small>{likedIds.has(listing.id) ? "Liked" : "Maybe"}</small>
            <span>{listing.title}</span>
            <button aria-label={`Remove ${listing.title} from shortlist`} onClick={() => onRemove(listing)}><X size={14} /></button>
          </div>
        ))}
        {listings.length > 3 && <span className="shortlist-more">+{listings.length - 3} more</span>}
      </div>
      <button className="primary" onClick={onReview}>Review and compare <span>→</span></button>
    </aside>
  );
}

function ShortlistReview({ listings, likedIds, profile, swipes, sharedShortlistId, onSharedShortlistId, onBack, onRemove, onContact }) {
  const [aiComparison, setAiComparison] = useState(null);
  const [aiLoading, setAiLoading] = useState(false);
  const [aiError, setAiError] = useState("");
  const [shareStatus, setShareStatus] = useState("");
  const decisionLabels = useMemo(() => {
    if (!listings.length) return new Map();
    const cheapest = [...listings].sort((a, b) => trueCostFor(a).monthlyTotal - trueCostFor(b).monthlyTotal)[0];
    const closest = [...listings].sort((a, b) => Number(a.distanceToCampus ?? Infinity) - Number(b.distanceToCampus ?? Infinity))[0];
    const freshest = [...listings].sort((a, b) => new Date(b.lastConfirmedAt || 0) - new Date(a.lastConfirmedAt || 0))[0];
    const labels = new Map();
    [[cheapest, "Best total cost"], [closest, "Shortest commute"], [freshest, "Freshest listing"]].forEach(([listing, label]) => {
      if (listing) labels.set(listing.id, [...(labels.get(listing.id) || []), label]);
    });
    return labels;
  }, [listings]);

  async function shareShortlist() {
    try {
      const shared = sharedShortlistId
        ? { id: sharedShortlistId }
        : await api.createSharedShortlist({
          title: `${profile?.name || "Student"}'s RoomBridge shortlist`,
          listingIds: listings.map((listing) => listing.id)
        });
      onSharedShortlistId(shared.id);
      const url = `${window.location.origin}${window.location.pathname}?shortlist=${encodeURIComponent(shared.id)}`;
      const text = `Review my RoomBridge shortlist: ${url}`;
      if (navigator.share) await navigator.share({ title: "My RoomBridge shortlist", text, url });
      else await navigator.clipboard.writeText(url);
      setShareStatus(navigator.share ? "Shared" : "Copied");
    } catch (error) {
      if (error.name !== "AbortError") setShareStatus("Could not share");
    }
  }

  useEffect(() => {
    let cancelled = false;
    async function loadComparison() {
      if (!listings.length) {
        setAiComparison(null);
        return;
      }
      setAiLoading(true);
      setAiError("");
      try {
        const petPreference = /cat/i.test(profile?.pets || "") ? "cat" : /dog/i.test(profile?.pets || "") ? "dog" : null;
        const result = await api.compareListings({
          listings: listings.map(listingToCompareFeatures),
          preferences: {
            max_rent: Number(profile?.budgetMax) || null,
            max_commute_minutes: 30,
            preferred_room_type: profile?.roomType || null,
            preferred_amenities: [],
            pet_preference: petPreference
          },
          swipes
        });
        if (!cancelled) setAiComparison(result);
      } catch (error) {
        if (!cancelled) setAiError(error.message || "Comparison is temporarily unavailable.");
      } finally {
        if (!cancelled) setAiLoading(false);
      }
    }
    loadComparison();
    return () => { cancelled = true; };
  }, [listings, profile, swipes]);

  return (
    <section className="shortlist-page" aria-labelledby="shortlist-title">
      <button className="back-to-results" onClick={onBack}>← Back to all rooms</button>
      <div className="shortlist-page-heading">
        <div><span className="eyebrow">Decision time</span><h1 id="shortlist-title">Compare your favorite homes.</h1><p>Review the essentials side by side and contact the place that fits you best.</p></div>
        {!!listings.length && <button className="share-shortlist" onClick={shareShortlist}><Share2 size={16} /> {shareStatus || "Share shortlist"}</button>}
      </div>
      {listings.length ? (
        <>
          <section className="ai-compare-panel" aria-labelledby="ai-compare-title">
            <div className="ai-compare-heading">
              <div><span className="eyebrow"><Sparkles size={14} /> Compare &amp; Match agent</span><h2 id="ai-compare-title">A grounded read on your shortlist.</h2><p>Recommendations use your preferences and the facts provided for each room.</p></div>
            </div>
            {aiLoading && <div className="ai-compare-loading"><span /><div><strong>Comparing your homes</strong><small>Checking cost, commute, room type, and listing signals…</small></div></div>}
            {aiError && <div className="ai-compare-error"><ShieldCheck size={18} /><span><strong>Comparison unavailable</strong><small>{aiError}</small></span></div>}
            {aiComparison && !aiLoading && (
              <>
                <div className="ai-recommendation"><Sparkles size={18} /><span><small>Recommended first</small><strong>{aiComparison.comparisons.find((item) => item.listing_id === aiComparison.recommended_id)?.title}</strong></span></div>
                <div className="ai-comparison-grid">
                  {aiComparison.comparisons.map((comparison, index) => (
                    <article className={comparison.listing_id === aiComparison.recommended_id ? "recommended" : ""} key={comparison.listing_id}>
                      <div className="ai-card-top"><span>#{index + 1}</span><strong>{comparison.score.toFixed(1)}<small>/100</small></strong></div>
                      <h3>{comparison.title}</h3>
                      <p>{comparison.explanation}</p>
                      <div className="ai-fact-tags wins">{comparison.wins.slice(0, 2).map((item) => <span key={item}><CheckCircle2 size={13} /> {item}</span>)}</div>
                    </article>
                  ))}
                </div>
              </>
            )}
          </section>
          <div className="shortlist-map" aria-label="Campus proximity map">
            <div className="campus-map-center"><Home size={19} /><span>Campus</span></div>
            {listings.slice(0, 6).map((listing, index) => {
              const angle = (index / Math.max(1, Math.min(6, listings.length))) * Math.PI * 2;
              const radius = 28 + Math.min(24, Number(listing.distanceToCampus || 2) * 5);
              return <div className="shortlist-map-pin" key={listing.id} style={{ left: `${50 + Math.cos(angle) * radius}%`, top: `${50 + Math.sin(angle) * radius}%` }}><MapPin size={16} /><span>{listing.title}</span></div>;
            })}
          </div>
          <div className="comparison-grid">
            {listings.map((listing) => (
              <article className="comparison-card" key={listing.id}>
                <div className="comparison-card-top">
                  <Pill tone={likedIds.has(listing.id) ? "red" : "amber"}>{likedIds.has(listing.id) ? "Liked" : "Maybe"}</Pill>
                  <button aria-label={`Remove ${listing.title}`} onClick={() => onRemove(listing)}><X size={16} /></button>
                </div>
                <h2>{listing.title}</h2>
                <p><MapPin size={15} /> {listing.area} · {listing.city}, {listing.state}</p>
                {!!decisionLabels.get(listing.id)?.length && <div className="decision-labels">{decisionLabels.get(listing.id).map((label) => <span key={label}><Sparkles size={12} /> {label}</span>)}</div>}
                <dl>
                  <div><dt>True monthly cost</dt><dd>{money(trueCostFor(listing).monthlyTotal)}</dd></div>
                  <div><dt>Campus distance</dt><dd>{Number.isFinite(Number(listing.distanceToCampus)) ? `${listing.distanceToCampus} mi` : "Nearby"}</dd></div>
                  <div><dt>Available</dt><dd>{shortDate(listing.availableFrom)}</dd></div>
                  <div><dt>Room style</dt><dd>{listing.roomType || "Ask host"}</dd></div>
                  <div><dt>Walk / Bike</dt><dd>{commuteFor(listing).walk} / {commuteFor(listing).bike}</dd></div>
                </dl>
                <button className="primary" onClick={() => onContact(listing)}><MessageSquare size={16} /> Contact this home</button>
              </article>
            ))}
          </div>
        </>
      ) : (
        <div className="empty-shortlist"><Heart size={32} /><h2>Your shortlist is empty</h2><p>Save a few homes from the browse page, then return here to compare them.</p><button className="primary" onClick={onBack}>Browse rooms</button></div>
      )}
    </section>
  );
}

function App() {
  const [profiles, setProfiles] = useState([]);
  const [listings, setListings] = useState([]);
  const [baseListings, setBaseListings] = useState([]);
  const [matches, setMatches] = useState([]);
  const [moderation, setModeration] = useState([]);
  const [selectedProfileId, setSelectedProfileId] = useState("");
  const [mode, setMode] = useState("browse");
  const [events, setEvents] = useState([]);
  const [filters, setFilters] = useState({ university: "", city: "", state: "", maxRent: "", area: "", type: "", moveInDate: "" });
  const [submittedSearch, setSubmittedSearch] = useState(null);
  const [busy, setBusy] = useState(false);
  const [loadingLive, setLoadingLive] = useState(false);
  const [contactListing, setContactListing] = useState(null);
  const [detailsListing, setDetailsListing] = useState(null);
  const [roomProofListing, setRoomProofListing] = useState(null);
  const [contactLoading, setContactLoading] = useState(false);
  const [availabilityBusy, setAvailabilityBusy] = useState(false);
  const [contactNote, setContactNote] = useState("");
  const [authUser, setAuthUser] = useState(null);
  const [authMode, setAuthMode] = useState(null);
  const [currentPage, setCurrentPage] = useState("home");
  const [sortBy, setSortBy] = useState("recommended");
  const [savedListingIds, setSavedListingIds] = useState(() => new Set());
  const [maybeListingIds, setMaybeListingIds] = useState(() => new Set());
  const [dismissedListingIds, setDismissedListingIds] = useState(() => new Set());
  const [exitingListingIds, setExitingListingIds] = useState(() => new Set());
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [amenityFilters, setAmenityFilters] = useState(() => new Set());
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [browseView, setBrowseView] = useState("list");
  const [selectedMapListingId, setSelectedMapListingId] = useState("");
  const [listingSource, setListingSource] = useState({
    source: "seed",
    status: "local",
    message: "Search any U.S. university to explore rooms near campus."
  });
  const [sharedShortlistId, setSharedShortlistId] = useState("");

  function pushEvent(title, message, tone = "blue") {
    setEvents((current) => [
      {
        id: `${Date.now()}-${Math.random()}`,
        title,
        message,
        tone
      },
      ...current
    ].slice(0, 8));
  }

  function requireAuth(actionName, callback) {
    if (!authUser) {
      setAuthMode("login");
      pushEvent("Login needed", `${actionName} is available after login or sign up.`, "gold");
      return;
    }
    callback();
  }

  async function handleAuthSubmit(form) {
    const result = form.mode === "signup" ? await api.register(form) : await api.login(form);
    saveSessionToken(result.token);
    setAuthUser(result.user);
    if (!result.verificationRequired) setAuthMode(null);
    pushEvent(
      "Signed in",
      result.user.universityVerified
        ? `Welcome, ${result.user.name}. Your university email is verified.`
        : `Welcome, ${result.user.name}. Confirm a .edu address to receive student verification.`,
      "green"
    );
    return result;
  }

  async function handleUniversityVerification(code) {
    const result = await api.verifyUniversity(savedSessionToken(), code);
    setAuthUser(result.user);
    pushEvent("University verified", `${result.user.email} is now verified.`, "green");
    return result;
  }

  async function handleVerificationResend() {
    const result = await api.resendVerification(savedSessionToken());
    pushEvent("New code sent", "Use the latest six-digit verification code.", "green");
    return result;
  }

  useEffect(() => {
    api.bootstrap().then((data) => {
      setProfiles(data.profiles);
      setListings(data.listings);
      setBaseListings(data.listings);
      setModeration(data.moderation);
      setSelectedProfileId(data.profiles[0]?.id || "");
      pushEvent("RoomBridge ready", "Search, save alerts, and contact rooms from one place.", "green");
      const sharedId = new URLSearchParams(window.location.search).get("shortlist");
      if (sharedId) {
        api.sharedShortlist(sharedId).then((shared) => {
          const ids = new Set(shared.listingIds);
          setSavedListingIds(ids);
          setSharedShortlistId(shared.id);
          setCurrentPage("shortlist");
        }).catch(() => pushEvent("Shared shortlist unavailable", "This link may have expired.", "gold"));
      }
    });
  }, []);

  useEffect(() => {
    const token = savedSessionToken();
    if (!token) return;
    api.session(token)
      .then(({ user }) => setAuthUser(user))
      .catch(() => saveSessionToken(""));
  }, []);

  useEffect(() => {
    let cancelled = false;

    async function loadListings() {
      if (!submittedSearch?.university) {
        setListings(baseListings);
        setListingSource({
          source: "seed",
          status: "local",
          message: "Search any U.S. university to explore rooms near campus."
        });
        return;
      }

      setLoadingLive(true);
      try {
        const result = await api.liveListings({
          university: submittedSearch.university,
          city: submittedSearch.city,
          state: submittedSearch.state,
          maxRent: submittedSearch.maxRent
        });
        if (cancelled) return;
        setListings(result.listings);
        setListingSource(result);
        pushEvent(
          result.source === "rentcast" ? "Live rentals loaded" : "Fallback listings shown",
          result.message,
          result.source === "rentcast" ? "green" : "gold"
        );
      } catch (error) {
        if (cancelled) return;
        setListings(baseListings);
        setListingSource({
          source: "seed",
          status: "request-error",
          message: "Showing rooms near your search while live listings reconnect."
        });
        pushEvent("Live listing request failed", error.message, "red");
      } finally {
        if (!cancelled) setLoadingLive(false);
      }
    }

    loadListings();
    return () => {
      cancelled = true;
    };
  }, [submittedSearch, baseListings]);

  useEffect(() => {
    if (mode !== "personalized" || !selectedProfileId) {
      setMatches([]);
      return;
    }
    const profile = profiles.find((item) => item.id === selectedProfileId);
    if (!profile) return;
    api.evaluateMatches(profile, listings)
      .then(setMatches)
      .catch(() => api.matches(selectedProfileId).then(setMatches));
  }, [mode, selectedProfileId, listings, profiles]);

  useEffect(() => {
    const socket = io(SOCKET_BASE);

    socket.on("realtime:ready", () => {
      pushEvent("Realtime connected", "Listening for new listings, alerts, and moderation events.", "green");
      if (mode === "personalized" && selectedProfileId) socket.emit("profile:watch", selectedProfileId);
    });

    socket.on("listing:created", (listing) => {
      setListings((current) => [listing, ...current.filter((item) => item.id !== listing.id)]);
      pushEvent("New listing posted", `${listing.title} near ${listing.university} for ${money(listing.rent)}.`, "blue");
    });

    socket.on("listing:availability", (listing) => {
      const replace = (current) => listing.availabilityStatus === "available"
        ? current.map((item) => item.id === listing.id ? listing : item)
        : current.filter((item) => item.id !== listing.id);
      setListings(replace);
      setBaseListings(replace);
      setDetailsListing((current) => current?.id === listing.id ? (listing.availabilityStatus === "available" ? listing : null) : current);
      pushEvent(
        listing.availabilityStatus === "available" ? "Availability confirmed" : "Listing closed",
        `${listing.title} was updated by the host.`,
        "green"
      );
    });

    socket.on("alert:matched", (alert) => {
      pushEvent("Saved search match", alert.message, "gold");
    });

    socket.on("contact:created", (request) => {
      pushEvent("Contact request sent", request.message, "blue");
    });

    socket.on("moderation:updated", setModeration);
    return () => socket.disconnect();
  }, [mode, selectedProfileId]);

  const matchMap = useMemo(() => {
    return new Map(matches.map((match) => [match.listing.id, match]));
  }, [matches]);

  const visibleListings = useMemo(() => {
    const filtered = listings
      .filter((listing) => {
        if (!filters.area) return true;
        const haystack = [
          listing.area,
          listing.address,
          listing.city,
          listing.state,
          listing.title,
          listing.apartmentName,
          listing.university
        ]
          .filter(Boolean)
          .join(" ")
          .toLowerCase();
        return haystack.includes(filters.area.toLowerCase());
      })
      .filter((listing) => (filters.type ? listing.roomType === filters.type || listing.type === filters.type : true))
      .filter((listing) => (filters.maxRent ? listing.rent <= Number(filters.maxRent) : true))
      .filter((listing) => {
        if (!amenityFilters.size) return true;
        const featureText = [listing.pets, listing.type, listing.roomType, listing.description, ...(listing.tags || []), ...(listing.utilitiesIncluded || []), ...(listing.amenities || [])].filter(Boolean).join(" ").toLowerCase();
        return [...amenityFilters].every((filter) => {
          if (filter === "pet-friendly") return /pet friendly|pets allowed|cats allowed|dogs allowed|cat okay|dog okay/.test(featureText);
          if (filter === "laundry") return /in-unit laundry|in unit laundry|washer|dryer/.test(featureText);
          if (filter === "furnished") return Boolean(listing.furnished);
          if (filter === "utilities") return Boolean(listing.utilitiesIncluded?.length) || /utilities included/.test(featureText);
          if (filter === "short-term") return /sublease|short-term|temporary|month-to-month/.test(featureText);
          if (filter === "verified") return Boolean(listing.verified);
          if (filter === "near-campus") return Number.isFinite(Number(listing.distanceToCampus)) && Number(listing.distanceToCampus) <= 1;
          return true;
        });
      })
      .filter((listing) => !dismissedListingIds.has(listing.id))
      .filter((listing) => !["unavailable", "leased"].includes(listing.availabilityStatus))
      .filter((listing) => !showSavedOnly || savedListingIds.has(listing.id) || maybeListingIds.has(listing.id));
    const sorted = [...filtered];
    if (sortBy === "price-low") sorted.sort((a, b) => Number(a.rent || Infinity) - Number(b.rent || Infinity));
    if (sortBy === "distance") sorted.sort((a, b) => Number(a.distanceToCampus || Infinity) - Number(b.distanceToCampus || Infinity));
    if (sortBy === "newest") sorted.sort((a, b) => new Date(b.createdAt || 0) - new Date(a.createdAt || 0));
    if (sortBy === "recommended" && mode === "personalized") sorted.sort((a, b) => (matchMap.get(b.id)?.score || 0) - (matchMap.get(a.id)?.score || 0));
    return sorted;
  }, [listings, filters, mode, matchMap, sortBy, showSavedOnly, savedListingIds, maybeListingIds, dismissedListingIds, amenityFilters]);

  function toggleAmenityFilter(filter) {
    setAmenityFilters((current) => {
      const next = new Set(current);
      next.has(filter) ? next.delete(filter) : next.add(filter);
      return next;
    });
  }

  function removeFromShortlist(listing) {
    setSavedListingIds((current) => { const next = new Set(current); next.delete(listing.id); return next; });
    setMaybeListingIds((current) => { const next = new Set(current); next.delete(listing.id); return next; });
  }

  function handleListingDecision(listing, decision) {
    if (decision === "pass") {
      removeFromShortlist(listing);
      setExitingListingIds((current) => new Set(current).add(listing.id));
      window.setTimeout(() => {
        setDismissedListingIds((current) => new Set(current).add(listing.id));
        setExitingListingIds((current) => { const next = new Set(current); next.delete(listing.id); return next; });
      }, 280);
      return;
    }

    setDismissedListingIds((current) => { const next = new Set(current); next.delete(listing.id); return next; });
    if (decision === "maybe") {
      setSavedListingIds((current) => { const next = new Set(current); next.delete(listing.id); return next; });
      setMaybeListingIds((current) => { const next = new Set(current); next.has(listing.id) ? next.delete(listing.id) : next.add(listing.id); return next; });
    } else {
      setMaybeListingIds((current) => { const next = new Set(current); next.delete(listing.id); return next; });
      setSavedListingIds((current) => { const next = new Set(current); next.has(listing.id) ? next.delete(listing.id) : next.add(listing.id); return next; });
    }
  }

  async function handleAvailabilityChange(listing, status) {
    setAvailabilityBusy(true);
    try {
      const updated = await api.updateListingAvailability(savedSessionToken(), listing.id, status);
      if (status === "available") {
        const replace = (current) => current.map((item) => item.id === updated.id ? updated : item);
        setListings(replace);
        setBaseListings(replace);
        setDetailsListing(updated);
        pushEvent("Availability confirmed", `${updated.title} now shows a fresh confirmation.`, "green");
      } else {
        setListings((current) => current.filter((item) => item.id !== listing.id));
        setBaseListings((current) => current.filter((item) => item.id !== listing.id));
        setDetailsListing(null);
        pushEvent("Listing removed from search", `${listing.title} is now marked unavailable.`, "gold");
      }
    } catch (error) {
      pushEvent("Availability was not updated", error.message, "red");
    } finally {
      setAvailabilityBusy(false);
    }
  }


  async function handleCreateListing(payload) {
    if (!authUser) {
      setAuthMode("signup");
      pushEvent("Sign up needed", "Create an account before posting a room.", "gold");
      return;
    }
    setBusy(true);
    try {
      const screening = await api.screenListing(payload);
      if (!screening.passed) {
        pushEvent("Listing needs changes", screening.flags.join(" "), "red");
        return;
      }
      const response = await api.createListing(payload);
      pushEvent("Listing published", `${response.alertHits} saved-search alert${response.alertHits === 1 ? "" : "s"} triggered.`, "green");
    } finally {
      setBusy(false);
    }
  }

  async function handleContact(listing) {
    if (!authUser) {
      setAuthMode("login");
      pushEvent("Login needed", "Login or sign up before contacting a listing.", "gold");
      return;
    }
    setContactListing(listing);
    setContactNote(`Hi, I am interested in ${listing.title || listing.apartmentName}. Could you share availability, lease details, and next steps?`);
    setContactLoading(true);
    try {
      const enriched = await api.enrichListing(listing);
      setContactListing(enriched);
      setContactNote(`Hi, I am interested in ${enriched.title || enriched.apartmentName}. Could you share availability, lease details, and next steps?`);
    } catch (error) {
      pushEvent("Contact lookup failed", error.message, "red");
    } finally {
      setContactLoading(false);
    }
  }

  async function sendContactRequest() {
    if (!contactListing) return;
    await api.createContactRequest({
      fromProfileId: mode === "personalized" ? selectedProfileId : authUser?.email || "browse-user",
      listingId: contactListing.id,
      message: contactNote
    });
    setContactListing(null);
    setContactNote("");
  }

  async function handleReport(listing) {
    if (!authUser) {
      setAuthMode("login");
      pushEvent("Login needed", "Login before reporting a listing.", "gold");
      return;
    }
    await api.reportListing({
      listingId: listing.id,
      reason: "Student requested review before sharing personal details."
    });
    pushEvent("Report submitted", `${listing.title} was sent to moderation.`, "red");
  }

  async function handleSaveSearch() {
    if (!authUser) {
      setAuthMode("login");
      pushEvent("Login needed", "Login or sign up to save alerts.", "gold");
      return;
    }
    await api.createSavedSearch({
      profileId: selectedProfileId || authUser.email,
      name: filters.university ? `${filters.university} room alert` : "Current RoomBridge search",
      filters: {
        maxRent: filters.maxRent ? Number(filters.maxRent) : undefined,
        university: filters.university || undefined,
        areas: filters.area ? [filters.area] : [],
        roomType: undefined
      }
    });
    pushEvent("Alert saved", "New listings matching these filters will trigger realtime alerts.", "gold");
  }

  const topMatch = matches[0];
  const showMatch = mode === "personalized";
  const shortlistedListings = listings.filter((listing) => savedListingIds.has(listing.id) || maybeListingIds.has(listing.id));
  const selectedProfile = profiles.find((profile) => profile.id === selectedProfileId) || null;
  const comparisonSwipes = listings.flatMap((listing) => {
    const action = savedListingIds.has(listing.id)
      ? "like"
      : maybeListingIds.has(listing.id)
        ? "maybe"
        : dismissedListingIds.has(listing.id)
          ? "pass"
          : null;
    return action ? [{ action, listing: listingToCompareFeatures(listing) }] : [];
  });
  const areaSuggestions = useMemo(() => {
    if (!submittedSearch?.university || listingSource.source === "seed") return [];

    const requestedCity = submittedSearch.city?.trim().toLowerCase();
    const requestedState = submittedSearch.state?.trim().toLowerCase();
    return [...new Set(
      listings
        .filter((listing) => !requestedCity || listing.city?.trim().toLowerCase() === requestedCity)
        .filter((listing) => !requestedState || listing.state?.trim().toLowerCase() === requestedState)
        .map((listing) => cleanText(listing.area, ""))
        .filter(Boolean)
    )].sort((a, b) => a.localeCompare(b));
  }, [listings, submittedSearch, listingSource.source]);

  function updateSearchUniversity(value) {
    const meta = universityMeta(value);
    setFilters((current) => ({
      ...current,
      university: value,
      city: meta?.city || current.city,
      state: meta?.state || current.state,
      area: ""
    }));
  }

  function submitSearch(event) {
    event.preventDefault();
    setSubmittedSearch({
      university: filters.university.trim(),
      city: filters.city.trim(),
      state: filters.state.trim().toUpperCase(),
      maxRent: filters.maxRent
    });
  }

  function resetFilters() {
    setFilters({ university: "", city: "", state: "", maxRent: "", area: "", type: "", moveInDate: "" });
    setAmenityFilters(new Set());
    setSubmittedSearch(null);
  }

  function showHome(event) {
    event?.preventDefault();
    setCurrentPage("home");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function showRooms(event) {
    event?.preventDefault();
    setCurrentPage("discover");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function showPlan(event) {
    event?.preventDefault();
    setCurrentPage("plan");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function showHowItWorks(event) {
    event?.preventDefault();
    setCurrentPage("home");
    window.requestAnimationFrame(() => document.getElementById("how-it-works")?.scrollIntoView({ behavior: "smooth" }));
  }

  function browseCampus(campus) {
    setFilters((current) => ({ ...current, university: campus.university, city: campus.city, state: campus.state, area: "" }));
    setSubmittedSearch({ university: campus.university, city: campus.city, state: campus.state, maxRent: "" });
    setCurrentPage("discover");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  function handlePostRoomClick(event) {
    event?.preventDefault();
    setCurrentPage("post");
    window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
  }

  return (
    <div className="app-shell">
      <header className="topbar">
        <a className="brand" href="#home" aria-label="RoomBridge home" onClick={showHome}>
          <BrandMark />
          <div>
            <span>RoomBridge</span>
            <strong>Find your place near campus</strong>
          </div>
        </a>
        <nav className="nav-links" aria-label="Primary navigation">
          <a className={currentPage === "home" ? "active" : ""} href="#home" onClick={showHome}>
            <Home size={16} />
            Home
          </a>
          <a className={currentPage === "discover" ? "active" : ""} href="#rooms" onClick={showRooms}><Search size={15} /> Browse</a>
          <a className={currentPage === "plan" ? "active" : ""} href="#plan" onClick={showPlan}><CircleDollarSign size={15} /> Plan</a>
          <a className={currentPage === "post" ? "active" : ""} href="#post-room" onClick={handlePostRoomClick}><Plus size={15} /> Post a room</a>
        </nav>
        <div className="top-actions">
          {authUser ? (
            <div className="user-chip">
              <span>{authUser.name.slice(0, 1).toUpperCase()}</span>
              <strong>{authUser.name}</strong>
              <button onClick={async () => {
                const token = savedSessionToken();
                await api.logout(token).catch(() => {});
                saveSessionToken("");
                setAuthUser(null);
              }}>Logout</button>
            </div>
          ) : (
            <>
              <button className="ghost" onClick={() => setAuthMode("login")}>
                <LogIn size={16} />
                Login
              </button>
              <button className="primary" onClick={() => setAuthMode("signup")}>
                <UserPlus size={16} />
                Sign up
              </button>
            </>
          )}
        </div>
      </header>

      <main>
        {currentPage === "home" ? (
          <>
        <section className="hero-band" id="home">
          <HeroVisual />
          <div className="hero-content">
            <span className="hero-kicker"><span className="status-dot" /> Student housing, made clearer</span>
            <h1>A room that feels like <em>your place.</em></h1>
            <p className="hero-copy">Discover student-friendly homes near campus, keep your favorites together, and decide with the right details in front of you.</p>
            <div className="hero-primary-actions" aria-label="Homepage actions">
              <button className="hero-browse-button" onClick={showRooms}>
                Browse rooms <span>→</span>
              </button>
              <button className="hero-how-button" onClick={showHowItWorks}>See how it works</button>
            </div>
          </div>
        </section>

        <LandingSections
          onBrowse={showRooms}
          onCampus={browseCampus}
        />
          </>
        ) : currentPage === "discover" ? (
          <>
        <section className="dashboard-hero" aria-labelledby="dashboard-title">
          <div className="dashboard-hero-content">
            <span className="dashboard-kicker"><Sparkles size={15} /> Personalized room discovery</span>
            <p className="dashboard-greeting">Hello, {authUser?.name?.split(" ")[0] || "there"}.</p>
            <h1 id="dashboard-title">Let’s find your best place near campus.</h1>
            <p>{submittedSearch?.university ? `Exploring student-friendly rentals near ${submittedSearch.university}. Save the strongest options as you go.` : "Explore live rentals, save the homes you like, then compare your shortlist before deciding."}</p>
          </div>
        </section>

        <section className="rooms-zone" id="rooms" aria-labelledby="rooms-title">
          <div className="workspace-grid">
          <div className="results">
            <div className="results-heading">
              <div>
                <span className="eyebrow">Available now</span>
                <h2 id="rooms-title">{showMatch ? "Best matches for you" : "Student rooms"}</h2>
                <p>{visibleListings.length} available {visibleListings.length === 1 ? "room" : "rooms"}</p>
              </div>
              <div className="mini-actions">
                <button className={mode === "browse" ? "active" : ""} onClick={() => setMode("browse")}>Browse</button>
                <button className={mode === "personalized" ? "active" : ""} onClick={() => requireAuth("Personalized matching", () => setMode("personalized"))}>Match me</button>
              </div>
            </div>
            <form className="filters results-filters" onSubmit={submitSearch}>
              <label>
                <Search size={15} />
                  <input
                    list="university-suggestions"
                    placeholder="University"
                    value={filters.university}
                    onChange={(event) => updateSearchUniversity(event.target.value)}
                  />
                <datalist id="university-suggestions">
                  {universityOptions.map((option) => (
                    <option key={option.university}>{option.university}</option>
                  ))}
                </datalist>
              </label>
              <label>
                <MapPin size={15} />
                <input
                  placeholder="City"
                  value={filters.city}
                  onChange={(event) => setFilters((current) => ({ ...current, city: event.target.value }))}
                />
              </label>
              <label className="state-field">
                <MapPin size={15} />
                <input
                  placeholder="State"
                  maxLength="2"
                  value={filters.state}
                  onChange={(event) => setFilters((current) => ({ ...current, state: event.target.value.toUpperCase() }))}
                />
              </label>
              <label>
                <MapPin size={15} />
                <input
                  list="area-suggestions"
                  placeholder="Area"
                  value={filters.area}
                  onChange={(event) => setFilters((current) => ({ ...current, area: event.target.value }))}
                />
                <datalist id="area-suggestions">
                  {areaSuggestions.map((area) => (
                    <option key={area}>{area}</option>
                  ))}
                </datalist>
              </label>
              <label>
                <SlidersHorizontal size={15} />
                <input
                  type="number"
                  placeholder="Max rent"
                  value={filters.maxRent}
                  onChange={(event) => setFilters((current) => ({ ...current, maxRent: event.target.value }))}
                />
              </label>
              <button className="primary search-button">Search</button>
            </form>
            <div className="filter-disclosure">
              <button
                type="button"
                className={filtersExpanded ? "filter-toggle active" : "filter-toggle"}
                aria-expanded={filtersExpanded}
                aria-controls="quick-room-filters"
                onClick={() => setFiltersExpanded((current) => !current)}
              >
                <SlidersHorizontal size={17} />
                More filters
                {(amenityFilters.size + (filters.type ? 1 : 0)) > 0 && <span>{amenityFilters.size + (filters.type ? 1 : 0)}</span>}
                <b>{filtersExpanded ? "−" : "+"}</b>
              </button>
              <small>{filtersExpanded ? "Choose any combination" : "Pets, laundry, furnishing, room type and more"}</small>
            </div>
            {filtersExpanded && <div className="quick-filters" id="quick-room-filters" aria-label="Optional room filters">
              <span>Refine your results</span>
              <button type="button" className={!filters.maxRent && !filters.type && !filters.area && !amenityFilters.size ? "active" : ""} onClick={() => { setFilters((current) => ({ ...current, maxRent: "", type: "", area: "" })); setAmenityFilters(new Set()); }}>All rooms</button>
              <button type="button" className={filters.maxRent === "1200" ? "active" : ""} onClick={() => setFilters((current) => ({ ...current, maxRent: "1200" }))}>Under $1,200</button>
              <button type="button" className={filters.type === "Private room" ? "active" : ""} onClick={() => setFilters((current) => ({ ...current, type: current.type === "Private room" ? "" : "Private room" }))}>Private rooms</button>
              <button type="button" className={filters.type === "Studio" ? "active" : ""} onClick={() => setFilters((current) => ({ ...current, type: current.type === "Studio" ? "" : "Studio" }))}>Studios</button>
              <button type="button" className={amenityFilters.has("pet-friendly") ? "active" : ""} onClick={() => toggleAmenityFilter("pet-friendly")}>Pet friendly</button>
              <button type="button" className={amenityFilters.has("laundry") ? "active" : ""} onClick={() => toggleAmenityFilter("laundry")}>In-unit laundry</button>
              <button type="button" className={amenityFilters.has("furnished") ? "active" : ""} onClick={() => toggleAmenityFilter("furnished")}>Furnished</button>
              <button type="button" className={amenityFilters.has("utilities") ? "active" : ""} onClick={() => toggleAmenityFilter("utilities")}>Utilities included</button>
              <button type="button" className={amenityFilters.has("short-term") ? "active" : ""} onClick={() => toggleAmenityFilter("short-term")}>Short-term</button>
              <button type="button" className={amenityFilters.has("verified") ? "active" : ""} onClick={() => toggleAmenityFilter("verified")}>Verified</button>
              <button type="button" className={amenityFilters.has("near-campus") ? "active" : ""} onClick={() => toggleAmenityFilter("near-campus")}>Within 1 mile</button>
            </div>}
            <div className="results-toolbar">
              <div>
                <strong>{visibleListings.length} {visibleListings.length === 1 ? "place" : "places"}</strong>
                <span>{showSavedOnly ? "in your Maybe and Liked shortlist" : "matching your current filters"}</span>
              </div>
              <div className="toolbar-actions">
                <div className="browse-view-switcher" role="group" aria-label="Choose room results view">
                  <button type="button" className={browseView === "list" ? "active" : ""} aria-pressed={browseView === "list"} onClick={() => setBrowseView("list")}><List size={15} /> List</button>
                  <button type="button" className={browseView === "split" ? "active" : ""} aria-pressed={browseView === "split"} onClick={() => setBrowseView("split")}><Columns2 size={15} /> Split</button>
                  <button type="button" className={browseView === "map" ? "active" : ""} aria-pressed={browseView === "map"} onClick={() => setBrowseView("map")}><MapIcon size={15} /> Map</button>
                </div>
                {dismissedListingIds.size > 0 && (
                  <button type="button" onClick={() => setDismissedListingIds(new Set())}><X size={15} /> Restore passed ({dismissedListingIds.size})</button>
                )}
                <button type="button" onClick={handleSaveSearch}><Bell size={16} /> Alert me</button>
                <button type="button" className={showSavedOnly ? "saved-active" : ""} onClick={() => setShowSavedOnly((current) => !current)}>
                  <Heart size={16} fill={showSavedOnly ? "currentColor" : "none"} /> Shortlist ({savedListingIds.size + maybeListingIds.size})
                </button>
                <label>
                  <span>Sort by</span>
                  <select value={sortBy} onChange={(event) => setSortBy(event.target.value)}>
                    <option value="recommended">Recommended</option>
                    <option value="price-low">Lowest price</option>
                    <option value="distance">Closest to campus</option>
                    <option value="newest">Newest</option>
                  </select>
                </label>
              </div>
            </div>
            {loadingLive ? (
              <div className="listing-stack"><LoadingListings /></div>
            ) : visibleListings.length ? (
              <div className={`browse-results-layout view-${browseView}`}>
                {browseView !== "map" && (
                  <div className="listing-stack">
                    {visibleListings.map((listing) => (
                      <ListingCard
                        key={listing.id}
                        listing={listing}
                        match={matchMap.get(listing.id)}
                        showMatch={showMatch}
                        onContact={handleContact}
                        onReport={handleReport}
                        onViewDetails={setDetailsListing}
                        decision={exitingListingIds.has(listing.id) ? "pass" : savedListingIds.has(listing.id) ? "like" : maybeListingIds.has(listing.id) ? "maybe" : null}
                        onDecision={handleListingDecision}
                      />
                    ))}
                  </div>
                )}
                {browseView !== "list" && (
                  <RoomMap
                    listings={visibleListings}
                    selectedId={visibleListings.some((listing) => listing.id === selectedMapListingId) ? selectedMapListingId : ""}
                    onSelect={setSelectedMapListingId}
                    onOpen={setDetailsListing}
                  />
                )}
              </div>
            ) : (
              <EmptyState onReset={resetFilters} />
            )}
          </div>

          </div>
        </section>
          </>
        ) : currentPage === "plan" ? (
          <PlanCenter listings={listings} profile={selectedProfile} onBrowse={showRooms} onOpenListing={setDetailsListing} />
        ) : currentPage === "post" ? (
          <PostRoomPage onSubmit={handleCreateListing} busy={busy} onBrowse={showRooms} />
        ) : (
          <ShortlistReview
            listings={shortlistedListings}
            likedIds={savedListingIds}
            profile={selectedProfile}
            swipes={comparisonSwipes}
            sharedShortlistId={sharedShortlistId}
            onSharedShortlistId={setSharedShortlistId}
            onBack={() => {
              setCurrentPage("discover");
              window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
            }}
            onRemove={removeFromShortlist}
            onContact={handleContact}
          />
        )}
      </main>
      {currentPage === "discover" && (
        <ShortlistDock
          listings={shortlistedListings}
          likedIds={savedListingIds}
          maybeIds={maybeListingIds}
          onReview={() => {
            setCurrentPage("shortlist");
            window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
          }}
          onRemove={removeFromShortlist}
        />
      )}
      <SiteFooter onHome={showHome} onRooms={showRooms} onHow={showHowItWorks} />
      {currentPage === "home" && (
        <HomeAssistant
          onBrowseSuggestion={(suggestion) => {
            setFilters((current) => ({
              ...current,
              university: suggestion.university || "",
              area: suggestion.area || ""
            }));
            setCurrentPage("discover");
            window.requestAnimationFrame(() => window.scrollTo({ top: 0, behavior: "smooth" }));
          }}
        />
      )}
      <ContactModal
        listing={contactListing}
        note={contactNote}
        loading={contactLoading}
        onNoteChange={setContactNote}
        onClose={() => setContactListing(null)}
        onSend={sendContactRequest}
      />
      <ListingDetailsModal
        listing={detailsListing}
        match={detailsListing ? matchMap.get(detailsListing.id) : null}
        profile={selectedProfile}
        canManageAvailability={String(authUser?.role || "").toLowerCase() === "host"}
        availabilityBusy={availabilityBusy}
        decision={detailsListing ? (savedListingIds.has(detailsListing.id) ? "like" : maybeListingIds.has(detailsListing.id) ? "maybe" : null) : null}
        onClose={() => setDetailsListing(null)}
        onContact={(listing) => {
          setDetailsListing(null);
          handleContact(listing);
        }}
        onDecision={handleListingDecision}
        onRoomProof={(listing) => {
          setDetailsListing(null);
          setRoomProofListing(listing);
        }}
        onAvailabilityChange={handleAvailabilityChange}
      />
      <RoomProofModal listing={roomProofListing} onClose={() => setRoomProofListing(null)} />
      {authMode && (
        <AuthModal
          mode={authMode}
          onModeChange={setAuthMode}
          onClose={() => setAuthMode(null)}
          onSubmit={handleAuthSubmit}
          onVerify={handleUniversityVerification}
          onResend={handleVerificationResend}
        />
      )}
    </div>
  );
}

createRoot(document.getElementById("root")).render(<App />);
