import type { Express, Request, Response } from "express";
import type { IJiraClient } from "../jira/jiraClient.js";
import { generateGherkinFromText } from "../gherkin/generateGherkin.js";

function badRequest(res: Response, message: string) {
  res.status(400).json({ ok: false, error: message });
}

/** Acceptance criteria: exactly three non-empty paragraphs (blank line separated). */
function assertExactlyThreeParagraphs(label: string, text: string): void {
  const parts = text
    .trim()
    .split(/\n\s*\n+/)
    .map((p) => p.trim())
    .filter((p) => p.length > 0);
  if (parts.length !== 3) {
    throw new Error(
      `${label} must contain exactly three non-empty paragraphs separated by a blank line.`
    );
  }
}

export function registerApiRoutes(app: Express, jira: IJiraClient) {
  app.get("/api/health", (_req, res) => {
    res.json({ ok: true });
  });

  app.get("/api/jira/search", async (req: Request, res: Response) => {
    try {
      const q = String(req.query.q ?? "").trim();
      if (!q) {
        return badRequest(res, "Query parameter q is required");
      }
      const issues = await jira.searchIssues({ query: q, maxResults: 20 });
      res.json({ ok: true, issues });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Search failed";
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.get("/api/jira/issue/:key/refine", async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key ?? "").trim();
      if (!key) {
        return badRequest(res, "Issue key is required");
      }
      const issue = await jira.getIssueForRefine(key);
      if (!issue) {
        return res.status(404).json({ ok: false, error: `Issue not found: ${key}` });
      }
      res.json({ ok: true, issue });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Lookup failed";
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.put("/api/jira/issue/:key/description", async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key ?? "").trim();
      const description = String(req.body?.description ?? "").trim();
      const acceptanceCriteriaRaw = req.body?.acceptanceCriteria;
      const acceptanceCriteria =
        acceptanceCriteriaRaw === undefined || acceptanceCriteriaRaw === null
          ? ""
          : String(acceptanceCriteriaRaw).trim();
      if (!key) {
        return badRequest(res, "Issue key is required");
      }
      if (!description) {
        return badRequest(res, "description is required");
      }
      if (acceptanceCriteria) {
        assertExactlyThreeParagraphs("acceptanceCriteria", acceptanceCriteria);
      }
      await jira.updateIssueDescription(key, description, {
        ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
      });
      res.json({ ok: true });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Update failed";
      const status = message.includes("must contain exactly three") ? 400 : 502;
      res.status(status).json({ ok: false, error: message });
    }
  });

  app.get("/api/jira/issue/:key", async (req: Request, res: Response) => {
    try {
      const key = String(req.params.key ?? "").trim();
      if (!key) {
        return badRequest(res, "Issue key is required");
      }
      const issue = await jira.getIssue(key);
      if (!issue) {
        return res.status(404).json({ ok: false, error: `Issue not found: ${key}` });
      }
      res.json({ ok: true, issue });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Lookup failed";
      res.status(502).json({ ok: false, error: message });
    }
  });

  app.post("/api/gherkin/generate", async (req: Request, res: Response) => {
    try {
      const rawText = String(req.body?.text ?? "").trim();
      if (!rawText) {
        return badRequest(res, "Field text is required");
      }
      const { gherkin, suggestedSummary, acceptanceCriteria } = generateGherkinFromText({
        rawText,
      });
      res.json({ ok: true, gherkin, suggestedSummary, acceptanceCriteria });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Generation failed";
      res.status(400).json({ ok: false, error: message });
    }
  });

  app.post("/api/jira/stories", async (req: Request, res: Response) => {
    try {
      const parentKey = String(req.body?.parentKey ?? "").trim();
      const summary = String(req.body?.summary ?? "").trim();
      const description = String(req.body?.description ?? "").trim();
      const acceptanceCriteriaRaw = req.body?.acceptanceCriteria;
      const acceptanceCriteria =
        acceptanceCriteriaRaw === undefined || acceptanceCriteriaRaw === null
          ? ""
          : String(acceptanceCriteriaRaw).trim();

      if (!parentKey) {
        return badRequest(res, "parentKey is required");
      }
      if (!summary) {
        return badRequest(res, "summary is required");
      }
      if (!description) {
        return badRequest(res, "description is required");
      }
      if (acceptanceCriteria) {
        assertExactlyThreeParagraphs("acceptanceCriteria", acceptanceCriteria);
      }

      const created = await jira.createStoryUnderParent({
        parentKey,
        summary,
        description,
        ...(acceptanceCriteria ? { acceptanceCriteria } : {}),
      });
      res.json({ ok: true, issue: created });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Create story failed";
      const status = message.includes("must contain exactly three") ? 400 : 502;
      res.status(status).json({ ok: false, error: message });
    }
  });
}
