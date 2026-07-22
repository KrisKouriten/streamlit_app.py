import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";
import { createSession, getSessionRow, revokeSession, revokeAllForUser, touchSession } from "./sessions";
import { sessionValidity } from "./session-rules";

const COOKIE_NAME = "close_session";
const MAX_AGE_SECONDS = 60 * 60 * 12; // 12h — matches the absolute session lifetime

function getSecret() {
  const s = process.env.SESSION_SECRET;
  if (!s || s.length < 16) {
    throw new Error("SESSION_SECRET is not set (must be a long random string). Add it in Vercel project settings.");
  }
  return new TextEncoder().encode(s);
}

export async function hashPassword(plain) {
  return bcrypt.hash(plain, 12);
}

export async function verifyPassword(plain, hash) {
  return bcrypt.compare(plain, hash);
}

// Mint the signed cookie token for a session. The token now carries only a
// session id (sid) plus a cached identity/role snapshot; the sid is what gets
// validated against governance.session on every request.
async function signToken({ sid, user, roles }) {
  return new SignJWT({ sid, uid: user.id, name: user.name, email: user.email, roles })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

// Open a server-side session and return its cookie token. Call setSessionCookie
// with the result. meta carries best-effort { ip, userAgent } for the audit view.
export async function startSession(user, roles = [], meta = {}) {
  const sid = await createSession({ userId: user.id, ip: meta.ip, userAgent: meta.userAgent });
  return signToken({ sid, user, roles });
}

export async function setSessionCookie(token) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: MAX_AGE_SECONDS,
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;

  let payload;
  try {
    ({ payload } = await jwtVerify(token, getSecret()));
  } catch {
    return null; // bad signature or expired token
  }

  // A token without a sid predates server-side sessions. Refuse it so the user
  // re-authenticates into a real, revocable session.
  const sid = payload.sid;
  if (!sid) return null;

  const row = await getSessionRow(sid);
  const { valid } = sessionValidity(row, Date.now());
  if (!valid) return null;
  if (row.is_active === false) return null; // deactivated accounts stop working at once

  // Keep an active session alive (coalesced so it is not a write per request).
  try {
    await touchSession(sid, row.last_seen_at);
  } catch {
    // A failed heartbeat must never log the user out.
  }

  const roles = Array.isArray(payload.roles) && payload.roles.length ? payload.roles : ["FINANCE"];
  // Identity comes from the live row (reflects renames); roles from the token.
  return { id: row.user_id, name: row.name, email: row.email, roles, sid };
}

// End the current session: revoke its server-side row and clear the cookie.
export async function endSession() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (token) {
    try {
      const { payload } = await jwtVerify(token, getSecret());
      if (payload.sid) await revokeSession(payload.sid, payload.email || "self", "logout");
    } catch {
      // Even an unverifiable token still gets its cookie cleared below.
    }
  }
  clearSessionCookie();
}

// End every session for a user (logout-everywhere / on deactivation).
export async function endAllSessions(userId, byEmail) {
  return revokeAllForUser(userId, byEmail || "self", "logout_all");
}

export function hasRole(session, ...roleCodes) {
  return !!session?.roles?.some((r) => roleCodes.includes(r));
}

export function isAdmin(session) {
  return hasRole(session, "ADMIN");
}
