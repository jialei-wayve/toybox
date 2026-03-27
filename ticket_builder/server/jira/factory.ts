import "dotenv/config";
import type { IJiraClient } from "./jiraClient.js";
import type { JiraClientConfig } from "./types.js";
import { RestJiraClient } from "./restJiraClient.js";
import { McpJiraClient } from "./mcpJiraClient.js";

function readConfig(): JiraClientConfig {
  const siteBaseUrl = process.env.JIRA_SITE_BASE_URL?.trim();
  const email = process.env.JIRA_EMAIL?.trim();
  const apiToken = process.env.JIRA_API_TOKEN?.trim();
  const cloudId = process.env.JIRA_CLOUD_ID?.trim();

  if (!siteBaseUrl || !email || !apiToken) {
    throw new Error(
      "Missing Jira env: JIRA_SITE_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN"
    );
  }

  return { cloudId, siteBaseUrl, email, apiToken };
}

export function createJiraClient(): IJiraClient {
  const backend = (process.env.JIRA_BACKEND || "rest").toLowerCase();
  if (backend === "mcp") {
    return new McpJiraClient();
  }
  return new RestJiraClient(readConfig());
}
