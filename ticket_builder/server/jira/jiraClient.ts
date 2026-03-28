import type {
  JiraClientConfig,
  JiraCreateStoryParams,
  JiraCreateStoryResult,
  JiraIssueForRefine,
  JiraIssueSummary,
  JiraSearchParams,
} from "./types.js";

/**
 * Contract for all Jira operations. Swap implementations:
 * - RestJiraClient: default (Atlassian REST API, same surfaces MCP uses)
 * - Future: McpJiraClient delegating to a Model Context Protocol server
 */
export interface IJiraClient {
  searchIssues(params: JiraSearchParams): Promise<JiraIssueSummary[]>;
  createStoryUnderParent(params: JiraCreateStoryParams): Promise<JiraCreateStoryResult>;
  getIssue(key: string): Promise<JiraIssueSummary | null>;
  getIssueForRefine(key: string): Promise<JiraIssueForRefine | null>;
  updateIssueDescription(
    issueKey: string,
    description: string,
    options?: { acceptanceCriteria?: string }
  ): Promise<void>;
}

export type { JiraClientConfig };
