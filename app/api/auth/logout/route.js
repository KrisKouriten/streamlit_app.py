import { NextResponse } from "next/server";
import { endSession } from "../../../../lib/auth";

export async function POST() {
  // Revoke the server-side session as well as clearing the cookie, so the token
  // cannot be replayed even if it was captured before logout.
  await endSession();
  return NextResponse.json({ ok: true });
}
