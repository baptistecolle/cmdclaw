import { expect, test } from "@playwright/test";

test("redirects unauthenticated /chat to /login with callback", async ({ page }) => {
  await page.goto("/chat");
  await expect(page).toHaveURL(/\/login\?callbackUrl=%2Fchat$/);
});

test("renders login screen controls", async ({ page }) => {
  await page.goto("/login?callbackUrl=%2Fchat");

  await expect(page.getByRole("heading", { name: "Log in" })).toBeVisible();
  await expect(page.getByLabel("Email")).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Google" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Continue with Apple" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Send magic link" })).toBeVisible();
});

test("allows public legal and support routes", async ({ page }) => {
  await page.goto("/legal/terms");
  await expect(page).toHaveURL(/\/legal\/terms$/);

  await page.goto("/support");
  await expect(page).toHaveURL(/\/support$/);
});

test("does not redirect /api/rpc to login", async ({ request }) => {
  const response = await request.get("/api/rpc", { maxRedirects: 0 });
  expect([301, 302, 303, 307, 308]).not.toContain(response.status());
});
