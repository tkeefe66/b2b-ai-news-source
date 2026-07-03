export interface BriefConfig {
  enabled: boolean;
  hour: number;
  timeZone: string;
  recipients: string[];
  appUrl: string;
  disabledReason?: string;
}

export function getBriefConfig(env: NodeJS.ProcessEnv = process.env): BriefConfig {
  const recipients = (env.BRIEF_RECIPIENTS || "")
    .split(",")
    .map(s => s.trim())
    .filter(Boolean);

  const base = {
    hour: env.BRIEF_HOUR ? parseInt(env.BRIEF_HOUR, 10) : 7,
    timeZone: env.BRIEF_TZ || "America/Chicago",
    recipients,
    appUrl: env.APP_URL || "http://localhost:5000",
  };

  if (!env.RESEND_API_KEY) {
    return { ...base, enabled: false, disabledReason: "RESEND_API_KEY is not set" };
  }
  if (recipients.length === 0) {
    return { ...base, enabled: false, disabledReason: "BRIEF_RECIPIENTS is not set" };
  }
  return { ...base, enabled: true };
}
