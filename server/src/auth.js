import { randomBytes, scryptSync, timingSafeEqual } from "node:crypto";
import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import { nanoid } from "nanoid";
import pg from "pg";
import { sendUniversityVerificationEmail } from "./email.js";

const SESSION_TTL_MS = 7 * 24 * 60 * 60 * 1000;
const VERIFICATION_TTL_MS = 15 * 60 * 1000;
const databaseUrl = process.env.DATABASE_URL || "";
const localDataFile = path.resolve(process.env.AUTH_DATA_FILE || ".data/auth.json");
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;

let localState = null;

async function ensureStorage() {
  if (pool) {
    await pool.query(`
      CREATE TABLE IF NOT EXISTS users (
        id TEXT PRIMARY KEY,
        name TEXT NOT NULL,
        email TEXT UNIQUE NOT NULL,
        university TEXT NOT NULL,
        role TEXT NOT NULL,
        university_verified BOOLEAN NOT NULL DEFAULT FALSE,
        password_hash TEXT NOT NULL,
        password_salt TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS auth_sessions (
        token_hash TEXT PRIMARY KEY,
        user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
        expires_at TIMESTAMPTZ NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE TABLE IF NOT EXISTS email_verification_challenges (
        user_id TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
        code_hash TEXT NOT NULL,
        code_salt TEXT NOT NULL,
        expires_at TIMESTAMPTZ NOT NULL,
        attempts INTEGER NOT NULL DEFAULT 0,
        created_at TIMESTAMPTZ NOT NULL DEFAULT now()
      );
      CREATE INDEX IF NOT EXISTS auth_sessions_user_idx ON auth_sessions(user_id);
      CREATE INDEX IF NOT EXISTS auth_sessions_expiry_idx ON auth_sessions(expires_at);
    `);
    return;
  }
  if (localState) return;
  try {
    localState = JSON.parse(await readFile(localDataFile, "utf8"));
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    localState = { users: [], sessions: [], verifications: [] };
  }
  localState.verifications ||= [];
}

async function saveLocalState() {
  await mkdir(path.dirname(localDataFile), { recursive: true });
  const temporary = `${localDataFile}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify(localState, null, 2), { mode: 0o600 });
  await rename(temporary, localDataFile);
}

function fromRow(row) {
  if (!row) return null;
  return {
    id: row.id,
    name: row.name,
    email: row.email,
    university: row.university,
    role: row.role,
    universityVerified: row.university_verified ?? row.universityVerified,
    passwordHash: row.password_hash ?? row.passwordHash,
    passwordSalt: row.password_salt ?? row.passwordSalt,
    createdAt: new Date(row.created_at ?? row.createdAt).toISOString()
  };
}

async function findUserByEmail(email) {
  await ensureStorage();
  if (pool) return fromRow((await pool.query("SELECT * FROM users WHERE email = $1", [email])).rows[0]);
  return localState.users.find((user) => user.email === email) || null;
}

async function findUserById(id) {
  await ensureStorage();
  if (pool) return fromRow((await pool.query("SELECT * FROM users WHERE id = $1", [id])).rows[0]);
  return localState.users.find((user) => user.id === id) || null;
}

async function insertUser(user) {
  await ensureStorage();
  if (pool) {
    await pool.query(
      `INSERT INTO users
        (id, name, email, university, role, university_verified, password_hash, password_salt, created_at)
       VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
      [user.id, user.name, user.email, user.university, user.role, user.universityVerified,
        user.passwordHash, user.passwordSalt, user.createdAt]
    );
    return;
  }
  localState.users.push(user);
  await saveLocalState();
}

function tokenHash(token) {
  return scryptSync(token, "roombridge-session-v1", 32).toString("hex");
}

async function insertSession(token, userId, expiresAt) {
  await ensureStorage();
  const hashedToken = tokenHash(token);
  if (pool) {
    await pool.query(
      "INSERT INTO auth_sessions (token_hash, user_id, expires_at) VALUES ($1,$2,$3)",
      [hashedToken, userId, expiresAt]
    );
    return;
  }
  localState.sessions.push({ tokenHash: hashedToken, userId, expiresAt });
  await saveLocalState();
}

async function findSession(token) {
  await ensureStorage();
  const hashedToken = tokenHash(token);
  if (pool) {
    const row = (await pool.query(
      "SELECT user_id, expires_at FROM auth_sessions WHERE token_hash = $1",
      [hashedToken]
    )).rows[0];
    return row ? { userId: row.user_id, expiresAt: new Date(row.expires_at).toISOString() } : null;
  }
  return localState.sessions.find((session) => session.tokenHash === hashedToken) || null;
}

async function deleteSession(token) {
  await ensureStorage();
  const hashedToken = tokenHash(token);
  if (pool) {
    await pool.query("DELETE FROM auth_sessions WHERE token_hash = $1", [hashedToken]);
    return;
  }
  localState.sessions = localState.sessions.filter((session) => session.tokenHash !== hashedToken);
  await saveLocalState();
}

async function saveVerificationChallenge(challenge) {
  await ensureStorage();
  if (pool) {
    await pool.query(
      `INSERT INTO email_verification_challenges
        (user_id, code_hash, code_salt, expires_at, attempts, created_at)
       VALUES ($1,$2,$3,$4,0,$5)
       ON CONFLICT (user_id) DO UPDATE SET
         code_hash = EXCLUDED.code_hash,
         code_salt = EXCLUDED.code_salt,
         expires_at = EXCLUDED.expires_at,
         attempts = 0,
         created_at = EXCLUDED.created_at`,
      [challenge.userId, challenge.codeHash, challenge.codeSalt, challenge.expiresAt, challenge.createdAt]
    );
    return;
  }
  localState.verifications = localState.verifications.filter((item) => item.userId !== challenge.userId);
  localState.verifications.push(challenge);
  await saveLocalState();
}

async function findVerificationChallenge(userId) {
  await ensureStorage();
  if (pool) {
    const row = (await pool.query(
      "SELECT * FROM email_verification_challenges WHERE user_id = $1",
      [userId]
    )).rows[0];
    return row ? {
      userId: row.user_id,
      codeHash: row.code_hash,
      codeSalt: row.code_salt,
      expiresAt: new Date(row.expires_at).toISOString(),
      attempts: row.attempts
    } : null;
  }
  return localState.verifications.find((item) => item.userId === userId) || null;
}

async function incrementVerificationAttempts(userId) {
  await ensureStorage();
  if (pool) {
    await pool.query("UPDATE email_verification_challenges SET attempts = attempts + 1 WHERE user_id = $1", [userId]);
    return;
  }
  const challenge = localState.verifications.find((item) => item.userId === userId);
  if (challenge) challenge.attempts += 1;
  await saveLocalState();
}

async function markUniversityVerified(userId) {
  await ensureStorage();
  if (pool) {
    await pool.query("UPDATE users SET university_verified = TRUE WHERE id = $1", [userId]);
    await pool.query("DELETE FROM email_verification_challenges WHERE user_id = $1", [userId]);
    return;
  }
  const user = localState.users.find((item) => item.id === userId);
  if (user) user.universityVerified = true;
  localState.verifications = localState.verifications.filter((item) => item.userId !== userId);
  await saveLocalState();
}

function normalizedEmail(value) {
  return String(value || "").trim().toLowerCase();
}

function publicUser(user) {
  return {
    id: user.id,
    name: user.name,
    email: user.email,
    university: user.university,
    role: user.role,
    universityVerified: user.universityVerified,
    verificationStatus: user.universityVerified ? "verified" : "email_confirmation_needed",
    createdAt: user.createdAt
  };
}

function hashPassword(password, salt = randomBytes(16).toString("hex")) {
  return { salt, hash: scryptSync(password, salt, 64).toString("hex") };
}

async function issueSession(user) {
  const token = randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS).toISOString();
  await insertSession(token, user.id, expiresAt);
  return { token, expiresAt, user: publicUser(user) };
}

async function issueVerificationChallenge(user) {
  if (!/\.edu$/i.test(user.email.split("@")[1] || "")) {
    throw Object.assign(new Error("University verification requires a .edu email address"), { status: 400 });
  }
  if (user.universityVerified) return { verificationRequired: false };

  const code = String(Math.floor(100000 + Math.random() * 900000));
  const codeSalt = randomBytes(16).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_TTL_MS).toISOString();
  await saveVerificationChallenge({
    userId: user.id,
    codeHash: scryptSync(code, codeSalt, 32).toString("hex"),
    codeSalt,
    expiresAt,
    attempts: 0,
    createdAt: new Date().toISOString()
  });
  const delivery = await sendUniversityVerificationEmail({ email: user.email, name: user.name, code });
  return {
    verificationRequired: true,
    verificationExpiresAt: expiresAt,
    verificationDelivery: delivery.provider,
    ...(process.env.NODE_ENV === "production" ? {} : { developmentVerificationCode: code })
  };
}

export async function initializeAuthStorage() {
  await ensureStorage();
  return { driver: pool ? "postgres" : "local-file" };
}

export async function registerUser(input) {
  const email = normalizedEmail(input.email);
  const password = String(input.password || "");
  const name = String(input.name || "").trim();
  const university = String(input.university || "").trim();
  const role = ["Student", "Roommate", "Host"].includes(input.role) ? input.role : "Student";

  if (!name || !university) throw Object.assign(new Error("Name and university are required"), { status: 400 });
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) throw Object.assign(new Error("Enter a valid email address"), { status: 400 });
  if (password.length < 8) throw Object.assign(new Error("Password must contain at least 8 characters"), { status: 400 });
  if (await findUserByEmail(email)) throw Object.assign(new Error("An account already exists for this email"), { status: 409 });

  const passwordRecord = hashPassword(password);
  const user = {
    id: `user-${nanoid(10)}`,
    name,
    email,
    university,
    role,
    universityVerified: false,
    passwordHash: passwordRecord.hash,
    passwordSalt: passwordRecord.salt,
    createdAt: new Date().toISOString()
  };
  await insertUser(user);
  const session = await issueSession(user);
  if (/\.edu$/i.test(email.split("@")[1] || "")) {
    return { ...session, ...(await issueVerificationChallenge(user)) };
  }
  return { ...session, verificationRequired: false };
}

export async function loginUser(input) {
  const user = await findUserByEmail(normalizedEmail(input.email));
  const passwordHash = user ? hashPassword(String(input.password || ""), user.passwordSalt).hash : "";
  const supplied = Buffer.from(passwordHash, "hex");
  const stored = Buffer.from(user?.passwordHash || "", "hex");
  if (!user || supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) {
    throw Object.assign(new Error("Email or password is incorrect"), { status: 401 });
  }
  const session = await issueSession(user);
  if (!user.universityVerified && /\.edu$/i.test(user.email.split("@")[1] || "")) {
    return { ...session, ...(await issueVerificationChallenge(user)) };
  }
  return { ...session, verificationRequired: false };
}

export async function sessionUser(token) {
  if (!token) return null;
  const session = await findSession(token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    if (session) await deleteSession(token);
    return null;
  }
  const user = await findUserById(session.userId);
  return user ? publicUser(user) : null;
}

export async function revokeSession(token) {
  if (token) await deleteSession(token);
}

export async function resendUniversityVerification(token) {
  const session = await findSession(token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw Object.assign(new Error("Session expired"), { status: 401 });
  }
  const user = await findUserById(session.userId);
  return issueVerificationChallenge(user);
}

export async function verifyUniversityEmail(token, code) {
  const session = await findSession(token);
  if (!session || new Date(session.expiresAt).getTime() <= Date.now()) {
    throw Object.assign(new Error("Session expired"), { status: 401 });
  }
  const user = await findUserById(session.userId);
  if (user.universityVerified) return publicUser(user);

  const challenge = await findVerificationChallenge(user.id);
  if (!challenge || new Date(challenge.expiresAt).getTime() <= Date.now()) {
    throw Object.assign(new Error("Verification code expired. Request a new code."), { status: 410 });
  }
  if (challenge.attempts >= 5) {
    throw Object.assign(new Error("Too many incorrect attempts. Request a new code."), { status: 429 });
  }
  const supplied = Buffer.from(scryptSync(String(code || "").trim(), challenge.codeSalt, 32).toString("hex"), "hex");
  const stored = Buffer.from(challenge.codeHash, "hex");
  if (supplied.length !== stored.length || !timingSafeEqual(supplied, stored)) {
    await incrementVerificationAttempts(user.id);
    throw Object.assign(new Error("Verification code is incorrect"), { status: 400 });
  }
  await markUniversityVerified(user.id);
  return publicUser({ ...user, universityVerified: true });
}

export function bearerToken(header = "") {
  return /^Bearer\s+(.+)$/i.exec(header)?.[1] || "";
}

export async function resetAuthForTests() {
  await ensureStorage();
  if (pool) {
    await pool.query("TRUNCATE email_verification_challenges, auth_sessions, users CASCADE");
  } else {
    localState = { users: [], sessions: [], verifications: [] };
    await saveLocalState();
  }
}
