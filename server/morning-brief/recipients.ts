import { eq } from "drizzle-orm";
import { db } from "../db";
import { briefRecipientSettings } from "@shared/schema";
import { briefRecipientEmailSchema, briefRecipientsSchema } from "@shared/brief-recipients";
import { getBriefConfig } from "./config";
import { blog } from "./log";

const ID = "morning-brief";

export class RecipientError extends Error {
  constructor(message: string, public status: number) { super(message); }
}

export async function getBriefRecipients(seed = process.env.BRIEF_RECIPIENTS ?? ""): Promise<string[]> {
  const [existing] = await db.select().from(briefRecipientSettings).where(eq(briefRecipientSettings.id, ID));
  if (existing) return briefRecipientsSchema.parse(existing.recipients);
  const recipients = briefRecipientsSchema.parse(Array.from(new Set(seed.split(",").map(s => s.trim().toLowerCase()).filter(Boolean))));
  // ON CONFLICT makes the one-time import safe across simultaneous requests.
  // An existing empty list is deliberate and must never be reseeded.
  await db.insert(briefRecipientSettings).values({ id: ID, recipients }).onConflictDoNothing();
  const [row] = await db.select().from(briefRecipientSettings).where(eq(briefRecipientSettings.id, ID));
  if (!row) throw new Error("Recipient settings could not be loaded. Try again.");
  return briefRecipientsSchema.parse(row.recipients);
}

export async function changeBriefRecipient(input: unknown, action: "add" | "remove"): Promise<string[]> {
  const parsed = briefRecipientEmailSchema.safeParse(input);
  if (!parsed.success) throw new RecipientError("Enter a valid email address.", 400);
  await getBriefRecipients();
  const recipients = await db.transaction(async tx => {
    // Serialize edits so two administrators cannot overwrite one another's changes.
    const [row] = await tx.select().from(briefRecipientSettings).where(eq(briefRecipientSettings.id, ID)).for("update");
    if (!row) throw new Error("Recipient settings could not be loaded. Try again.");
    const current = briefRecipientsSchema.parse(row.recipients);
    if (action === "add" && current.includes(parsed.data)) throw new RecipientError("This email is already a recipient.", 409);
    const next = action === "add" ? [...current, parsed.data] : current.filter(email => email !== parsed.data);
    if (next.length > 50) throw new RecipientError("A brief supports up to 50 recipients. Remove one before adding another.", 400);
    await tx.update(briefRecipientSettings).set({ recipients: next }).where(eq(briefRecipientSettings.id, ID));
    return next;
  });
  blog(`recipient ${action} saved; ${recipients.length} recipient(s)`);
  return recipients;
}

export async function getRuntimeBriefConfig() {
  return getBriefConfig(process.env, await getBriefRecipients());
}
