import assert from "node:assert/strict";
import test from "node:test";
import {
  loginUser,
  registerUser,
  resetAuthForTests,
  resendUniversityVerification,
  revokeSession,
  sessionUser,
  verifyUniversityEmail
} from "../src/auth.js";

test.beforeEach(async () => resetAuthForTests());

test("registers a university account with a pending verification challenge", async () => {
  const session = await registerUser({
    name: "Maya Patel",
    email: "maya@pdx.edu",
    password: "correct-horse",
    university: "Portland State University",
    role: "Student"
  });

  assert.equal(session.user.universityVerified, false);
  assert.equal(session.user.verificationStatus, "email_confirmation_needed");
  assert.equal(session.verificationRequired, true);
  assert.match(session.developmentVerificationCode, /^\d{6}$/);
  assert.equal((await sessionUser(session.token)).email, "maya@pdx.edu");
  assert.equal("passwordHash" in session.user, false);
});

test("marks a non-university email as needing confirmation", async () => {
  const session = await registerUser({
    name: "Alex Rivera",
    email: "alex@example.com",
    password: "eight-characters",
    university: "UCLA",
    role: "Student"
  });

  assert.equal(session.user.universityVerified, false);
  assert.equal(session.user.verificationStatus, "email_confirmation_needed");
  assert.equal(session.verificationRequired, false);
});

test("verifies a university email using the one-time code", async () => {
  const session = await registerUser({
    name: "Maya Patel",
    email: "maya@pdx.edu",
    password: "correct-horse",
    university: "Portland State University"
  });

  await assert.rejects(() => verifyUniversityEmail(session.token, "000000"), /incorrect/);
  const verified = await verifyUniversityEmail(session.token, session.developmentVerificationCode);
  assert.equal(verified.universityVerified, true);
  assert.equal(verified.verificationStatus, "verified");
  assert.equal((await sessionUser(session.token)).universityVerified, true);
});

test("resends a replacement university verification code", async () => {
  const session = await registerUser({
    name: "Maya Patel",
    email: "maya@pdx.edu",
    password: "correct-horse",
    university: "Portland State University"
  });
  const replacement = await resendUniversityVerification(session.token);
  assert.match(replacement.developmentVerificationCode, /^\d{6}$/);
  assert.notEqual(replacement.developmentVerificationCode, session.developmentVerificationCode);
  await assert.rejects(
    () => verifyUniversityEmail(session.token, session.developmentVerificationCode),
    /incorrect/
  );
  assert.equal((await verifyUniversityEmail(session.token, replacement.developmentVerificationCode)).universityVerified, true);
});

test("rejects weak passwords, duplicate accounts, and incorrect login", async () => {
  const input = {
    name: "Maya Patel",
    email: "maya@pdx.edu",
    password: "correct-horse",
    university: "Portland State University"
  };
  await assert.rejects(() => registerUser({ ...input, password: "short" }), /at least 8/);
  await registerUser(input);
  await assert.rejects(() => registerUser(input), /already exists/);
  await assert.rejects(() => loginUser({ email: input.email, password: "wrong-password" }), /incorrect/);
});

test("logs in and revokes a session", async () => {
  await registerUser({
    name: "Maya Patel",
    email: "maya@pdx.edu",
    password: "correct-horse",
    university: "Portland State University"
  });
  const session = await loginUser({ email: "MAYA@PDX.EDU", password: "correct-horse" });
  assert.ok(await sessionUser(session.token));
  await revokeSession(session.token);
  assert.equal(await sessionUser(session.token), null);
});
