import { parseArgs } from "util";

const CLI_ARGS = process.argv.slice(2);
const IS_HELP_REQUEST = CLI_ARGS.includes("--help") || CLI_ARGS.includes("-h");
const TOKEN = process.env.GITHUB_ACCESS_TOKEN;
if (!TOKEN && !IS_HELP_REQUEST) {
  console.error("Error: GITHUB_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = {
  Authorization: `Bearer ${TOKEN}`,
  Accept: "application/vnd.github+json",
  "X-GitHub-Api-Version": "2022-11-28",
};

async function api<T>(path: string, options?: RequestInit): Promise<T> {
  const res = await fetch(`https://api.github.com${path}`, {
    ...options,
    headers: { ...headers, ...options?.headers },
  });
  if (!res.ok) {
    throw new Error(`${res.status} ${await res.text()}`);
  }
  return (await res.json()) as T;
}

const { positionals, values } = parseArgs({
  args: CLI_ARGS,
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    owner: { type: "string", short: "o" },
    repo: { type: "string", short: "r" },
    state: { type: "string", short: "s", default: "open" },
    limit: { type: "string", short: "l", default: "20" },
    title: { type: "string", short: "t" },
    body: { type: "string", short: "b" },
    labels: { type: "string" },
    assignees: { type: "string" },
    filter: { type: "string", short: "f", default: "created" },
    query: { type: "string", short: "q" },
  },
});

const [command, ...args] = positionals;

async function listRepos() {
  const params = new URLSearchParams({
    sort: "updated",
    per_page: values.limit || "20",
  });
  const repos = await api<
    Array<{
      full_name: string;
      private: boolean;
      language: string | null;
      stargazers_count: number;
      html_url: string;
    }>
  >(`/user/repos?${params}`);

  const list = repos.map((r) => ({
    name: r.full_name,
    private: r.private,
    language: r.language,
    stars: r.stargazers_count,
    url: r.html_url,
  }));

  console.log(JSON.stringify(list, null, 2));
}

async function listPRs() {
  if (!values.owner || !values.repo) {
    console.error("Required: --owner <owner> --repo <repo>");
    process.exit(1);
  }

  const params = new URLSearchParams({
    state: values.state || "open",
    per_page: values.limit || "20",
  });
  const prs = await api<
    Array<{
      number: number;
      title: string;
      user?: { login?: string };
      draft?: boolean;
      html_url: string;
      created_at: string;
    }>
  >(`/repos/${values.owner}/${values.repo}/pulls?${params}`);

  const list = prs.map((pr) => ({
    number: pr.number,
    title: pr.title,
    author: pr.user?.login,
    draft: pr.draft,
    url: pr.html_url,
    createdAt: pr.created_at,
  }));

  console.log(JSON.stringify(list, null, 2));
}

async function getPR(prNumber: string) {
  if (!values.owner || !values.repo) {
    console.error("Required: --owner <owner> --repo <repo>");
    process.exit(1);
  }

  const [pr, reviews] = await Promise.all([
    api<{
      number: number;
      title: string;
      body: string | null;
      state: string;
      merged: boolean;
      user?: { login?: string };
      base?: { ref?: string };
      head?: { ref?: string };
      additions: number;
      deletions: number;
      changed_files: number;
      html_url: string;
    }>(`/repos/${values.owner}/${values.repo}/pulls/${prNumber}`),
    api<Array<{ user?: { login?: string }; state: string }>>(
      `/repos/${values.owner}/${values.repo}/pulls/${prNumber}/reviews`,
    ),
  ]);

  console.log(
    JSON.stringify(
      {
        number: pr.number,
        title: pr.title,
        body: pr.body,
        state: pr.state,
        merged: pr.merged,
        author: pr.user?.login,
        base: pr.base?.ref,
        head: pr.head?.ref,
        additions: pr.additions,
        deletions: pr.deletions,
        files: pr.changed_files,
        url: pr.html_url,
        reviews: reviews.map((r) => ({
          author: r.user?.login,
          state: r.state,
        })),
      },
      null,
      2,
    ),
  );
}

async function myPRs() {
  const user = await api<{ login: string }>("/user");
  const filterMap: Record<string, string> = {
    created: `author:${user.login}`,
    assigned: `assignee:${user.login}`,
    review: `review-requested:${user.login}`,
  };

  const q = `is:pr state:${values.state || "open"} ${filterMap[values.filter || "created"] || ""}`;
  const result = await api<{
    items: Array<{
      title: string;
      repository_url: string;
      number: number;
      html_url: string;
    }>;
  }>(`/search/issues?q=${encodeURIComponent(q)}&per_page=30`);

  const prs = result.items.map((pr) => ({
    title: pr.title,
    repo: pr.repository_url?.split("/").slice(-2).join("/"),
    number: pr.number,
    url: pr.html_url,
  }));

  console.log(JSON.stringify(prs, null, 2));
}

async function createIssue() {
  if (!values.owner || !values.repo || !values.title) {
    console.error(
      "Required: --owner <owner> --repo <repo> --title <title> [--body <text>] [--labels a,b]",
    );
    process.exit(1);
  }

  const issue = await api<{ number: number; title: string; html_url: string }>(
    `/repos/${values.owner}/${values.repo}/issues`,
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        title: values.title,
        body: values.body,
        labels: values.labels?.split(","),
        assignees: values.assignees?.split(","),
      }),
    },
  );

  console.log(`Issue created: #${issue.number} - ${issue.title}\n${issue.html_url}`);
}

async function listIssues() {
  if (!values.owner || !values.repo) {
    console.error("Required: --owner <owner> --repo <repo>");
    process.exit(1);
  }

  const params = new URLSearchParams({
    state: values.state || "open",
    per_page: values.limit || "20",
  });
  if (values.labels) {
    params.set("labels", values.labels);
  }

  const issues = await api<
    Array<{
      pull_request?: unknown;
      number: number;
      title: string;
      user?: { login?: string };
      labels?: Array<{ name: string }>;
      html_url: string;
    }>
  >(`/repos/${values.owner}/${values.repo}/issues?${params}`);
  const filtered = issues.filter((i) => !i.pull_request);

  const list = filtered.map((i) => ({
    number: i.number,
    title: i.title,
    author: i.user?.login,
    labels: i.labels?.map((l) => l.name),
    url: i.html_url,
  }));

  console.log(JSON.stringify(list, null, 2));
}

async function searchCode() {
  if (!values.query) {
    console.error("Required: --query <search>");
    process.exit(1);
  }

  const result = await api<{
    total_count: number;
    items: Array<{
      name: string;
      path: string;
      repository?: { full_name?: string };
      html_url: string;
    }>;
  }>(`/search/code?q=${encodeURIComponent(values.query)}&per_page=${values.limit || "10"}`);

  const results = result.items.map((item) => ({
    name: item.name,
    path: item.path,
    repo: item.repository?.full_name,
    url: item.html_url,
  }));

  console.log(JSON.stringify({ total: result.total_count, results }, null, 2));
}

function showHelp() {
  console.log(`GitHub CLI - Commands:
  repos [-l limit]                                      List my repositories
  prs -o <owner> -r <repo> [-s state] [-l limit]        List pull requests
  pr <number> -o <owner> -r <repo>                      Get PR details
  my-prs [-f created|assigned|review] [-s state]        My pull requests
  issues -o <owner> -r <repo> [-s state] [--labels a,b] List issues
  create-issue -o <owner> -r <repo> -t <title> [-b body] [--labels a,b]
  search -q <query> [-l limit]                          Search code

Options:
  -h, --help                                            Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "repos":
        await listRepos();
        break;
      case "prs":
        await listPRs();
        break;
      case "pr":
        await getPR(args[0]);
        break;
      case "my-prs":
        await myPRs();
        break;
      case "issues":
        await listIssues();
        break;
      case "create-issue":
        await createIssue();
        break;
      case "search":
        await searchCode();
        break;
      default:
        showHelp();
    }
  } catch (e) {
    console.error("Error:", e instanceof Error ? e.message : e);
    process.exit(1);
  }
}

main();
