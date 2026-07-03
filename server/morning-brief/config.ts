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

  let hour = env.BRIEF_HOUR ? parseInt(env.BRIEF_HOUR, 10) : 7;
  if (!(Number.isFinite(hour) && hour >= 0 && hour <= 23)) {
    console.warn(`BRIEF_HOUR="${env.BRIEF_HOUR}" is invalid (must be an integer 0-23); defaulting to 7`);
    hour = 7;
  }

  const base = {
    hour,
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
