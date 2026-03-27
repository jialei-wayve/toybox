import "dotenv/config";
import express from "express";
import cors from "cors";
import { createJiraClient } from "./jira/factory.js";
import { registerApiRoutes } from "./routes/api.js";

const PORT = Number(process.env.PORT) || 3001;

let jira;
try {
  jira = createJiraClient();
} catch (e) {
  console.warn(
    "[toybox] Jira client not configured:",
    e instanceof Error ? e.message : e
  );
  jira = null;
}

const app = express();
app.use(cors({ origin: true }));
app.use(express.json({ limit: "512kb" }));

if (jira) {
  registerApiRoutes(app, jira);
} else {
  app.use("/api", (_req, res) => {
    res.status(503).json({
      ok: false,
      error:
        "Jira is not configured. Set JIRA_SITE_BASE_URL, JIRA_EMAIL, JIRA_API_TOKEN in .env",
    });
  });
}

app.listen(PORT, () => {
  console.log(`API listening on http://127.0.0.1:${PORT}`);
});
