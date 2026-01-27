import { randomUUID } from "node:crypto";

import { db, closePool } from "./client";
import { user } from "./schema";

async function main() {
  await db
    .insert(user)
    .values([
      {
        id: randomUUID(),
        email: "pilot@example.com",
        name: "Test Pilot",
        emailVerified: true,
      },
      {
        id: randomUUID(),
        email: "maverick@example.com",
        name: "Maverick",
        emailVerified: true,
      },
    ])
    .onConflictDoNothing();
}

main()
  .catch((err) => {
    console.error("Seed failed:", err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await closePool();
  });
