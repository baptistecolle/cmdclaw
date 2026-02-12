import { NextRequest, NextResponse } from "next/server";

import { auth } from "@/lib/auth";

/**
 * Native app callback handler for magic link authentication.
 *
 * Flow:
 * 1. App requests magic link with callbackURL pointing here
 * 2. User clicks email link, better-auth verifies and sets session cookies
 * 3. Better-auth redirects here with cookies set
 * 4. We extract the session token from cookies and redirect to the native app
 */
export async function GET(request: NextRequest) {
  const searchParams = request.nextUrl.searchParams;
  const redirect = searchParams.get("redirect") || "bap://auth/callback";

  try {
    // Log cookies for debugging
    const cookieHeader = request.headers.get("cookie");
    console.log("[native-callback] Cookies received:", cookieHeader);

    // Get session from cookies that better-auth just set
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    console.log(
      "[native-callback] Session result:",
      JSON.stringify(session, null, 2),
    );

    if (!session?.session?.token) {
      console.error("[native-callback] No session token found");
      const errorUrl = new URL(redirect);
      errorUrl.searchParams.set("error", "no_session");
      return NextResponse.redirect(errorUrl.toString());
    }

    // Redirect to native app with the session token
    const callbackUrl = new URL(redirect);
    callbackUrl.searchParams.set("token", session.session.token);

    console.log(`[native-callback] Redirecting to native app with token`);
    return NextResponse.redirect(callbackUrl.toString());
  } catch (error) {
    console.error("[native-callback] Error:", error);
    const errorUrl = new URL(redirect);
    errorUrl.searchParams.set("error", "verification_failed");
    return NextResponse.redirect(errorUrl.toString());
  }
}
