import type { IJiraClient } from "./jiraClient.js";
import type {
  JiraCreateStoryParams,
  JiraCreateStoryResult,
  JiraIssueForRefine,
  JiraIssueSummary,
  JiraSearchParams,
} from "./types.js";

/**
 * Placeholder for a future implementation that proxies to a Jira MCP server
 * (e.g. stdio/SSE MCP client in a trusted backend process).
 *
 * Browsers cannot speak MCP directly; host this adapter in Node and wire it
 * to your MCP transport.
 */
export class McpJiraClient implements IJiraClient {
  async searchIssues(_params: JiraSearchParams): Promise<JiraIssueSummary[]> {
    throw new Error(
      "McpJiraClient is not wired. Use JIRA_BACKEND=rest or implement MCP transport (see README)."
    );
  }

  async getIssue(_key: string): Promise<JiraIssueSummary | null> {
    throw new Error(
      "McpJiraClient is not wired. Use JIRA_BACKEND=rest or implement MCP transport (see README)."
    );
  }

  async createStoryUnderParent(
    _params: JiraCreateStoryParams
  ): Promise<JiraCreateStoryResult> {
    throw new Error(
      "McpJiraClient is not wired. Use JIRA_BACKEND=rest or implement MCP transport (see README)."
    );
  }

  async getIssueForRefine(_key: string): Promise<JiraIssueForRefine | null> {
    throw new Error(
      "McpJiraClient is not wired. Use JIRA_BACKEND=rest or implement MCP transport (see README)."
    );
  }

  async updateIssueDescription(_issueKey: string, _description: string): Promise<void> {
    throw new Error(
      "McpJiraClient is not wired. Use JIRA_BACKEND=rest or implement MCP transport (see README)."
    );
  }
}
