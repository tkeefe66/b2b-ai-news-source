import { beforeEach, describe, expect, it, vi } from "vitest";

const state = vi.hoisted(() => ({ rows: new Map<string, string[]>(), fail: false }));
vi.mock("../db", () => ({ db: {
  insert: () => ({ values: (row: { id: string; recipients: string[] }) => ({ onConflictDoNothing: async () => {
    if (state.fail) throw new Error("database unavailable");
    if (!state.rows.has(row.id)) state.rows.set(row.id, [...row.recipients]);
  } }) }),
  select: () => ({ from: () => ({ where: async () => [...state.rows].map(([id, recipients]) => ({ id, recipients })) }) }),
  transaction: async (callback: any) => callback({
    select: () => ({ from: () => ({ where: () => ({ for: async () => [...state.rows].map(([id, recipients]) => ({ id, recipients })) }) }) }),
    update: () => ({ set: ({ recipients }: { recipients: string[] }) => ({ where: async () => { state.rows.set("morning-brief", recipients); } }) }),
  }),
} }));

import { changeBriefRecipient, getBriefRecipients } from "./recipients";
import { getBriefConfig } from "./config";

beforeEach(() => { state.rows.clear(); state.fail = false; });

describe("persisted brief recipients", () => {
  it("imports configuration once, normalizes addresses and removes duplicates", async () => {
    // Mutation: returning the environment forever loses UI changes after a restart.
    expect(await getBriefRecipients(" Owner@Example.com,owner@example.com,new@example.com ")).toEqual([
      "owner@example.com", "new@example.com",
    ]);
    expect(await getBriefRecipients("changed@example.com")).toEqual(["owner@example.com", "new@example.com"]);
  });

  it("keeps an intentionally empty list instead of re-subscribing removed people", async () => {
    // Mutation: treating an empty saved list as uninitialized resurrects removed recipients.
    await getBriefRecipients("");
    expect(await getBriefRecipients("owner@example.com")).toEqual([]);
    expect(getBriefConfig({ RESEND_API_KEY: "test", BRIEF_RECIPIENTS: "owner@example.com" }, []).enabled).toBe(false);
  });

  it("does not fall back to old recipients when the database fails", async () => {
    // Mutation: swallowing read errors sends to a stale list after someone is removed.
    state.fail = true;
    await expect(getBriefRecipients("owner@example.com")).rejects.toThrow("database unavailable");
  });

  it("enables delivery using saved recipients when no environment recipients exist", () => {
    // Mutation: config still checks BRIEF_RECIPIENTS rather than the authoritative list.
    expect(getBriefConfig({ RESEND_API_KEY: "test" }, ["new@example.com"])).toMatchObject({
      enabled: true, recipients: ["new@example.com"],
    });
  });

  it("normalizes edits, rejects duplicates and invalid input, and persists removal", async () => {
    // Mutation: accepting case variants or dropping the update produces duplicate/missing recipients.
    await getBriefRecipients("owner@example.com");
    expect(await changeBriefRecipient(" New@Example.com ", "add")).toEqual(["owner@example.com", "new@example.com"]);
    await expect(changeBriefRecipient("NEW@example.com", "add")).rejects.toMatchObject({ status: 409 });
    await expect(changeBriefRecipient("invalid", "add")).rejects.toMatchObject({ status: 400 });
    await changeBriefRecipient("OWNER@example.com", "remove");
    await changeBriefRecipient("new@example.com", "remove");
    expect(await getBriefRecipients("owner@example.com")).toEqual([]);
  });

  it("rejects exceeding the provider recipient limit without changing the saved list", async () => {
    // Mutation: omitting the cap lets an added recipient break delivery for everyone.
    const recipients = Array.from({ length: 50 }, (_, i) => `person${i}@example.com`);
    await getBriefRecipients(recipients.join(","));
    await expect(changeBriefRecipient("overflow@example.com", "add")).rejects.toMatchObject({ status: 400 });
    expect(await getBriefRecipients()).toEqual(recipients);
  });

  it("ignores obsolete invalid seed configuration after initialization", async () => {
    // Mutation: validating old environment data before loading saved settings disables the managed list.
    await getBriefRecipients("owner@example.com");
    expect(await getBriefRecipients("obsolete invalid value")).toEqual(["owner@example.com"]);
  });
});
