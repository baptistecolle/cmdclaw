import * as fs from "fs";
import { SignJWT, importPKCS8 } from "jose";

// Apple Sign In Configuration
const TEAM_ID = "H4LAG3Q6BJ";
const KEY_ID = "5TUU49X577";
const CLIENT_ID = "com.heybap.bap.client";
const PRIVATE_KEY_PATH = "/Users/baptiste/Git/bap/app/scripts/apple_authkey";

// JWT valid for 6 months (max allowed by Apple)
const EXPIRATION_DAYS = 180;

async function generateAppleClientSecret(): Promise<string> {
  const privateKeyPem = fs.readFileSync(PRIVATE_KEY_PATH, "utf8");
  const privateKey = await importPKCS8(privateKeyPem, "ES256");

  const now = Math.floor(Date.now() / 1000);

  const jwt = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: KEY_ID })
    .setIssuer(TEAM_ID)
    .setSubject(CLIENT_ID)
    .setAudience("https://appleid.apple.com")
    .setIssuedAt(now)
    .setExpirationTime(`${EXPIRATION_DAYS}d`)
    .sign(privateKey);

  return jwt;
}

const secret = await generateAppleClientSecret();
console.log("\n=== Apple Client Secret ===\n");
console.log(secret);
console.log("\n=== Add this to your .env file ===\n");
console.log(`APPLE_CLIENT_SECRET="${secret}"`);
console.log(
  `\nExpires: ${new Date(Date.now() + EXPIRATION_DAYS * 24 * 60 * 60 * 1000).toISOString()}`,
);
