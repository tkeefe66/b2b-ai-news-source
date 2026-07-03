import { Resend } from "resend";
import pRetry from "p-retry";
import type { RenderedEmail } from "./render-email";
import { blog } from "./log";

const FROM = "GTM Brief <onboarding@resend.dev>";

export interface EmailClient {
  send(args: {
    from: string;
    to: string[];
    subject: string;
    html: string;
    text: string;
  }): Promise<{ data: { id: string } | null; error: { message: string } | null }>;
}

function resendClient(): EmailClient {
  const resend = new Resend(process.env.RESEND_API_KEY);
  return {
    send: args => resend.emails.send(args) as ReturnType<EmailClient["send"]>,
  };
}

export async function sendEmail(
  email: RenderedEmail,
  to: string[],
  deps: { client?: EmailClient; retries?: number } = {},
): Promise<{ id: string }> {
  const client = deps.client ?? resendClient();
  const retries = deps.retries ?? 3;
  try {
    return await pRetry(
      async () => {
        const { data, error } = await client.send({
          from: FROM,
          to,
          subject: email.subject,
          html: email.html,
          text: email.text,
        });
        if (error || !data) {
          throw new Error(error?.message || "Resend returned no data");
        }
        blog(`email sent to ${to.join(", ")} (id ${data.id})`);
        return { id: data.id };
      },
      { retries, minTimeout: 1000 },
    );
  } catch (err: any) {
    throw new Error(`Email delivery failed after ${retries + 1} attempts: ${err.message}`);
  }
}
