/** Jira issue shape returned from search / get for parent selection */
export interface JiraIssueSummary {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
}

export interface JiraSearchParams {
  query: string;
  maxResults?: number;
}

export interface JiraCreateStoryParams {
  parentKey: string;
  summary: string;
  /** Plain text or Gherkin — converted to ADF for Jira */
  description: string;
}

export interface JiraCreateStoryResult {
  key: string;
  id: string;
  self: string;
  browseUrl: string;
}

/** Issue + plain description for Refine Ticket flow */
export interface JiraIssueForRefine {
  key: string;
  id: string;
  summary: string;
  issueType: string;
  status: string;
  descriptionPlain: string;
}

export interface JiraClientConfig {
  siteBaseUrl: string;
  email: string;
  apiToken: string;
  /** Optional; used by future MCP or OAuth-style adapters */
  cloudId?: string;
}
