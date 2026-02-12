import { parseArgs } from "util";

const TOKEN = process.env.LINEAR_ACCESS_TOKEN;
if (!TOKEN) {
  console.error("Error: LINEAR_ACCESS_TOKEN environment variable required");
  process.exit(1);
}

const headers = { Authorization: TOKEN, "Content-Type": "application/json" };

async function graphql(query: string, variables?: Record<string, unknown>) {
  const res = await fetch("https://api.linear.app/graphql", {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const data = await res.json();
  if (data.errors) throw new Error(JSON.stringify(data.errors));
  return data.data;
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    help: { type: "boolean", short: "h" },
    team: { type: "string", short: "t" },
    state: { type: "string", short: "s" },
    limit: { type: "string", short: "l", default: "20" },
    title: { type: "string" },
    description: { type: "string", short: "d" },
    priority: { type: "string", short: "p" },
    assignee: { type: "string", short: "a" },
  },
});

const [command, ...args] = positionals;

async function listIssues() {
  const filters: string[] = [];
  if (values.team) filters.push(`team: { key: { eq: "${values.team}" } }`);
  if (values.state) filters.push(`state: { name: { eq: "${values.state}" } }`);
  const filterStr = filters.length ? `filter: { ${filters.join(", ")} }` : "";

  const data = await graphql(`query {
    issues(first: ${values.limit}, ${filterStr}) {
      nodes { id identifier title state { name } priority assignee { name } team { key } url updatedAt }
    }
  }`);

  const issues = data.issues.nodes.map((i: any) => ({
    identifier: i.identifier,
    title: i.title,
    state: i.state?.name,
    priority: i.priority,
    assignee: i.assignee?.name,
    team: i.team?.key,
    url: i.url,
  }));

  console.log(JSON.stringify(issues, null, 2));
}

async function getIssue(identifier: string) {
  const data = await graphql(`query {
    issues(filter: { identifier: { eq: "${identifier}" } }) {
      nodes {
        identifier title description state { name } priority priorityLabel
        assignee { name email } creator { name } team { key name }
        labels { nodes { name } } comments { nodes { body user { name } createdAt } }
        createdAt updatedAt url
      }
    }
  }`);

  if (!data.issues.nodes.length)
    throw new Error(`Issue ${identifier} not found`);
  console.log(JSON.stringify(data.issues.nodes[0], null, 2));
}

async function createIssue() {
  if (!values.team || !values.title) {
    console.error(
      "Required: --team <key> --title <title> [--description <text>] [--priority 0-4] [--assignee <email>]",
    );
    process.exit(1);
  }

  const teamData = await graphql(
    `query { teams(filter: { key: { eq: "${values.team}" } }) { nodes { id } } }`,
  );
  if (!teamData.teams.nodes.length)
    throw new Error(`Team ${values.team} not found`);

  const input: Record<string, unknown> = {
    teamId: teamData.teams.nodes[0].id,
    title: values.title,
  };
  if (values.description) input.description = values.description;
  if (values.priority) input.priority = parseInt(values.priority);

  if (values.assignee) {
    const userData = await graphql(
      `query { users(filter: { email: { eq: "${values.assignee}" } }) { nodes { id } } }`,
    );
    if (userData.users.nodes.length)
      input.assigneeId = userData.users.nodes[0].id;
  }

  const data = await graphql(
    `
      mutation ($input: IssueCreateInput!) {
        issueCreate(input: $input) {
          success
          issue {
            identifier
            title
            url
          }
        }
      }
    `,
    { input },
  );

  if (!data.issueCreate.success) throw new Error("Failed to create issue");
  console.log(
    `Created: ${data.issueCreate.issue.identifier} - ${data.issueCreate.issue.title}\n${data.issueCreate.issue.url}`,
  );
}

async function updateIssue(identifier: string) {
  const issueData = await graphql(`query {
    issues(filter: { identifier: { eq: "${identifier}" } }) { nodes { id team { id } } }
  }`);
  if (!issueData.issues.nodes.length)
    throw new Error(`Issue ${identifier} not found`);

  const input: Record<string, unknown> = {};
  if (values.title) input.title = values.title;
  if (values.description) input.description = values.description;
  if (values.priority) input.priority = parseInt(values.priority);

  if (values.state) {
    const teamId = issueData.issues.nodes[0].team.id;
    const stateData = await graphql(`query {
      workflowStates(filter: { team: { id: { eq: "${teamId}" } }, name: { eq: "${values.state}" } }) { nodes { id } }
    }`);
    if (stateData.workflowStates.nodes.length)
      input.stateId = stateData.workflowStates.nodes[0].id;
  }

  const data = await graphql(
    `
      mutation ($id: String!, $input: IssueUpdateInput!) {
        issueUpdate(id: $id, input: $input) {
          success
          issue {
            identifier
            state {
              name
            }
            url
          }
        }
      }
    `,
    { id: issueData.issues.nodes[0].id, input },
  );

  if (!data.issueUpdate.success) throw new Error("Failed to update");
  console.log(
    `Updated: ${data.issueUpdate.issue.identifier} (${data.issueUpdate.issue.state?.name})`,
  );
}

async function listTeams() {
  const data = await graphql(`
    query {
      teams {
        nodes {
          key
          name
          description
        }
      }
    }
  `);
  console.log(JSON.stringify(data.teams.nodes, null, 2));
}

async function myIssues() {
  const data = await graphql(`
    query {
      viewer {
        assignedIssues(
          first: 50
          filter: { state: { type: { nin: ["completed", "canceled"] } } }
        ) {
          nodes {
            identifier
            title
            state {
              name
            }
            priority
            team {
              key
            }
            url
          }
        }
      }
    }
  `);

  console.log(JSON.stringify(data.viewer.assignedIssues.nodes, null, 2));
}

function showHelp() {
  console.log(`Linear CLI - Commands:
  list [-t team] [-s state] [-l limit]                  List issues
  get <identifier>                                       Get issue details (e.g., ENG-123)
  create --team <key> --title <title> [-d desc] [-p 0-4] [-a email]
  update <identifier> [--title] [--state] [--priority]  Update issue
  teams                                                  List teams
  mine                                                   My assigned issues

Options:
  -h, --help                                             Show this help message`);
}

async function main() {
  if (values.help) {
    showHelp();
    return;
  }

  try {
    switch (command) {
      case "list":
        await listIssues();
        break;
      case "get":
        await getIssue(args[0]);
        break;
      case "create":
        await createIssue();
        break;
      case "update":
        await updateIssue(args[0]);
        break;
      case "teams":
        await listTeams();
        break;
      case "mine":
        await myIssues();
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
