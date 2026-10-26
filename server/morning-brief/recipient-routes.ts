import type { Express } from "express";
import { changeBriefRecipient, getBriefRecipients, RecipientError } from "./recipients";
import { getBriefSender } from "./deliver";

const response = (recipients: string[]) => ({
  recipients,
  senderNeedsSetup: getBriefSender().includes("@resend.dev"),
});

// Registered behind the application's authenticated workspace and same-origin guards.
export function registerBriefRecipientRoutes(app: Express) {
  app.get("/api/brief/recipients", async (_req, res) => {
    try { res.json(response(await getBriefRecipients())); }
    catch (error) {
      console.error("Failed to load brief recipients", error);
      res.status(503).json({ error: "Could not load email recipients. Try again shortly." });
    }
  });
  for (const method of ["post", "delete"] as const) {
    app[method]("/api/brief/recipients", async (req, res) => {
      try {
        res.json(response(await changeBriefRecipient(req.body?.email, method === "post" ? "add" : "remove")));
      } catch (error) {
        if (error instanceof RecipientError) { res.status(error.status).json({ error: error.message }); return; }
        console.error("Failed to save brief recipients", error);
        res.status(503).json({ error: "Could not save email recipients. Refresh the list and try again." });
      }
    });
  }
}
