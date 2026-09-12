import { describe, it, expect, vi } from "vitest";
import { sendEmail } from "./deliver";

const email = { subject: "s", html: "<p>h</p>", text: "t" };

describe("sendEmail", () => {
  it("reuses the provider key after an accepted send loses its response", async () => {
    // Mutation: dropping the provider idempotency option delivers twice after response loss.
    const accepted = new Set<string>();
    let deliveries = 0;
    let responseLost = false;
    const client = { send: vi.fn(async (_email, options) => {
      const key = options?.idempotencyKey ?? `unkeyed-${deliveries}`;
      if (!accepted.has(key)) { accepted.add(key); deliveries++; }
      if (!responseLost) { responseLost = true; throw new Error("response lost"); }
      return { data: { id: "em_once" }, error: null };
    }) };
    await expect(sendEmail(email, ["tom@example.com"], { client, retries: 0, idempotencyKey: "brief/10" })).rejects.toThrow();
    await sendEmail(email, ["tom@example.com"], { client, retries: 0, idempotencyKey: "brief/10" });
    expect(deliveries).toBe(1);
  });
  it("sends via the client and returns the id", async () => {
    const client = { send: vi.fn().mockResolvedValue({ data: { id: "em_1" }, error: null }) };
    const result = await sendEmail(email, ["tom@example.com"], { client, retries: 0, idempotencyKey: "brief/1" });
    expect(result.id).toBe("em_1");
    expect(client.send).toHaveBeenCalledWith({
      from: "GTM Brief <onboarding@resend.dev>",
      to: ["tom@example.com"],
      subject: "s",
      html: "<p>h</p>",
      text: "t",
    }, { idempotencyKey: "brief/1" });
  });

  it("retries on failure then succeeds", async () => {
    const client = {
      send: vi
        .fn()
        .mockResolvedValueOnce({ data: null, error: { message: "rate limited" } })
        .mockResolvedValueOnce({ data: { id: "em_2" }, error: null }),
    };
    const result = await sendEmail(email, ["tom@example.com"], { client, retries: 2, idempotencyKey: "brief/2" });
    expect(result.id).toBe("em_2");
    expect(client.send).toHaveBeenCalledTimes(2);
  });

  it("throws a labeled error after retries exhaust", async () => {
    const client = { send: vi.fn().mockResolvedValue({ data: null, error: { message: "boom" } }) };
    await expect(sendEmail(email, ["tom@example.com"], { client, retries: 1, idempotencyKey: "brief/3" })).rejects.toThrow(
      /Email delivery failed.*boom/,
    );
    expect(client.send).toHaveBeenCalledTimes(2);
  });
});
