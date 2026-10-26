import { z } from "zod";

export const briefRecipientEmailSchema = z.string().trim().toLowerCase().email("Enter a valid email address.").max(254);
export const briefRecipientsSchema = z.array(briefRecipientEmailSchema).max(50, "A brief supports up to 50 recipients.");
export interface BriefRecipientResponse {
  recipients: string[];
  senderNeedsSetup: boolean;
}
