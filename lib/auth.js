import bcrypt from "bcryptjs";
import { SignJWT, jwtVerify } from "jose";
import { cookies } from "next/headers";

const COOKIE_NAME = "close_session";

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

export async function createSessionToken(user, roles = []) {
  return new SignJWT({ uid: user.id, name: user.name, email: user.email, roles })
    .setProtectedHeader({ alg: "HS256" })
    .setIssuedAt()
    .setExpirationTime("12h")
    .sign(getSecret());
}

export async function setSessionCookie(token) {
  cookies().set(COOKIE_NAME, token, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 12,
  });
}

export function clearSessionCookie() {
  cookies().set(COOKIE_NAME, "", { httpOnly: true, path: "/", maxAge: 0 });
}

export async function getSession() {
  const token = cookies().get(COOKIE_NAME)?.value;
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, getSecret());
    // Sessions issued before roles existed default to FINANCE.
    const roles = Array.isArray(payload.roles) && payload.roles.length ? payload.roles : ["FINANCE"];
    return { id: payload.uid, name: payload.name, email: payload.email, roles };
  } catch {
    return null;
  }
}

export function hasRole(session, ...roleCodes) {
  return !!session?.roles?.some((r) => roleCodes.includes(r));
}

export function isAdmin(session) {
  return hasRole(session, "ADMIN");
}
