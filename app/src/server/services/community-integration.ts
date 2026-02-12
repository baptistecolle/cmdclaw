import { eq } from "drizzle-orm";
import { env } from "@/env";
import { db } from "@/server/db/client";
import { customIntegration } from "@/server/db/schema";

/**
 * Submit a custom integration to the community repo via GitHub PR
 */
export async function submitToCommunityRepo(customIntegrationId: string): Promise<string | null> {
  const token = env.COMMUNITY_REPO_GITHUB_TOKEN;
  const owner = env.COMMUNITY_REPO_OWNER;
  const repo = env.COMMUNITY_REPO_NAME;

  if (!token || !owner || !repo) {
    console.log("[Community] Missing GitHub config, skipping PR submission");
    return null;
  }

  const integ = await db.query.customIntegration.findFirst({
    where: eq(customIntegration.id, customIntegrationId),
  });

  if (!integ) {
    throw new Error("Custom integration not found");
  }

  const branchName = `integration/${integ.slug}`;
  const headers = {
    Authorization: `Bearer ${token}`,
    Accept: "application/vnd.github.v3+json",
    "Content-Type": "application/json",
  };

  const apiBase = `https://api.github.com/repos/${owner}/${repo}`;

  try {
    // Get default branch SHA
    const repoRes = await fetch(apiBase, { headers });
    const repoData = await repoRes.json();
    const defaultBranch = repoData.default_branch || "main";

    const refRes = await fetch(`${apiBase}/git/refs/heads/${defaultBranch}`, {
      headers,
    });
    const refData = await refRes.json();
    const baseSha = refData.object.sha;

    // Create branch
    await fetch(`${apiBase}/git/refs`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        ref: `refs/heads/${branchName}`,
        sha: baseSha,
      }),
    });

    // Create files
    const files = [
      {
        path: `integrations/${integ.slug}/cli.ts`,
        content: integ.cliCode,
      },
      {
        path: `integrations/${integ.slug}/config.json`,
        content: JSON.stringify(
          {
            slug: integ.slug,
            name: integ.name,
            description: integ.description,
            baseUrl: integ.baseUrl,
            authType: integ.authType,
            oauthConfig: integ.oauthConfig,
            apiKeyConfig: integ.apiKeyConfig,
            permissions: integ.permissions,
          },
          null,
          2,
        ),
      },
      {
        path: `integrations/${integ.slug}/instructions.md`,
        content: integ.cliInstructions,
      },
    ];

    await Promise.all(
      files.map((file) =>
        fetch(`${apiBase}/contents/${file.path}`, {
          method: "PUT",
          headers,
          body: JSON.stringify({
            message: `Add ${integ.name} integration`,
            content: Buffer.from(file.content).toString("base64"),
            branch: branchName,
          }),
        }),
      ),
    );

    // Create PR
    const prRes = await fetch(`${apiBase}/pulls`, {
      method: "POST",
      headers,
      body: JSON.stringify({
        title: `Add ${integ.name} integration`,
        head: branchName,
        base: defaultBranch,
        body: `## New Integration: ${integ.name}\n\n${integ.description}\n\n- **Auth Type:** ${integ.authType}\n- **Base URL:** ${integ.baseUrl}\n`,
      }),
    });

    const prData = await prRes.json();
    const prUrl = prData.html_url;

    // Update integration with PR URL
    await db
      .update(customIntegration)
      .set({
        communityPrUrl: prUrl,
        communityStatus: "pending",
      })
      .where(eq(customIntegration.id, customIntegrationId));

    return prUrl;
  } catch (error) {
    console.error("[Community] Failed to submit PR:", error);
    return null;
  }
}
