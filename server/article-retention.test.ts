import { afterAll, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import pg from "pg";
import { drizzle } from "drizzle-orm/node-postgres";
import * as schema from "@shared/schema";
import { ingestNewsArticle, runArticleRetention, startArticleRetention } from "./article-retention";

// Run with TEST_DATABASE_URL pointing to a disposable PostgreSQL instance.
// Every test uses a private schema, never the application's public tables.
const connectionString = process.env.TEST_DATABASE_URL;
const now = new Date("2026-10-24T12:00:00Z");
const cutoff = "2026-09-24T12:00:00Z";
const namespace = `retention_test_${process.pid}`;
const admin = connectionString ? new pg.Pool({ connectionString }) : undefined;
const pool = connectionString ? new pg.Pool({ connectionString, options: `-c search_path=${namespace} -c timezone=UTC` }) : undefined;
const db = pool ? drizzle(pool, { schema }) : undefined;

describe.skipIf(!connectionString)("article retention in PostgreSQL", () => {
  beforeAll(async () => {
    await admin!.query(`CREATE SCHEMA ${namespace}`);
    await pool!.query(`
      CREATE TABLE sources (id serial PRIMARY KEY, feed_url text NOT NULL);
      CREATE TABLE articles (
        id serial PRIMARY KEY, title text NOT NULL, link text NOT NULL,
        description text, content text, author text, published_at timestamp,
        source_id int REFERENCES sources(id), source_name text, category text,
        image_url text, is_read boolean NOT NULL DEFAULT false,
        dismissed boolean NOT NULL DEFAULT false, dismissed_at timestamp,
        created_at timestamp NOT NULL DEFAULT CURRENT_TIMESTAMP, guid text,
        tags text[], search_vector tsvector
      );
      CREATE UNIQUE INDEX articles_source_guid_idx ON articles(source_id, guid);
      CREATE TABLE article_seen_keys (key_hash varchar(64) PRIMARY KEY, last_seen_at timestamp NOT NULL);
      CREATE TABLE feed_tags (name text PRIMARY KEY, article_count int NOT NULL DEFAULT 0);
      CREATE TABLE briefs (id int PRIMARY KEY, payload jsonb);
      CREATE TABLE knowledge_entries (id int PRIMARY KEY, content text);
    `);
  });
  beforeEach(async () => {
    await pool!.query(`TRUNCATE articles, sources, article_seen_keys, feed_tags, briefs, knowledge_entries RESTART IDENTITY CASCADE;
      INSERT INTO sources(feed_url) VALUES ('https://feed.test/rss'), ('upload://manual.pdf');
      INSERT INTO briefs VALUES (1, '{"headline":"saved","articleIds":[1]}');
      INSERT INTO knowledge_entries VALUES (1, 'curated knowledge');`);
  });
  afterAll(async () => {
    await pool!.end();
    await admin!.query(`DROP SCHEMA ${namespace} CASCADE`);
    await admin!.end();
  });

  async function seed(link: string, published: string | null, sourceId = 1, created = "2026-10-01T00:00:00Z") {
    await pool!.query(`INSERT INTO articles(title,link,content,description,published_at,source_id,created_at,tags,guid)
      VALUES ('story',$1,'full body','short excerpt',$2,$3,$4,ARRAY['ai'],$1)`, [link, published, sourceId, created]);
  }

  it("deletes only expired news, keeps the exact boundary and protects uploads, briefs and knowledge", async () => {
    // Mutation: <= cutoff deletes the boundary; dropping the upload predicate destroys documents.
    await seed("https://old", "2026-09-24T11:59:59Z");
    await seed("https://boundary", cutoff);
    await seed("https://recent", "2026-10-23T00:00:00Z");
    await seed("https://document", "2020-01-01T00:00:00Z", 2);
    await seed("upload://orphan", "2020-01-01T00:00:00Z");
    await pool!.query("INSERT INTO feed_tags VALUES ('ai',5)");
    const result = await runArticleRetention(pool!, { now, batchSize: 1, vacuum: false });
    expect(result.deleted).toBe(1);
    expect((await pool!.query("SELECT link,content FROM articles ORDER BY id")).rows).toEqual([
      { link: "https://boundary", content: null }, { link: "https://recent", content: null },
      { link: "https://document", content: "full body" }, { link: "upload://orphan", content: "full body" },
    ]);
    expect((await pool!.query("SELECT * FROM briefs")).rows).toEqual([{ id: 1, payload: { headline: "saved", articleIds: [1] } }]);
    expect((await pool!.query("SELECT * FROM knowledge_entries")).rows).toEqual([{ id: 1, content: "curated knowledge" }]);
    expect((await pool!.query("SELECT article_count FROM feed_tags")).rows[0].article_count).toBe(4);
  });

  it("expires undated and future-dated news using ingestion time", async () => {
    // Mutation: publication-only filtering lets undated or far-future stories accumulate forever.
    await seed("https://undated-old", null, 1, "2026-01-01");
    await seed("https://future-old", "2099-01-01", 1, "2026-01-01");
    await seed("https://undated-new", null);
    expect((await runArticleRetention(pool!, { now, vacuum: false })).deleted).toBe(2);
    expect((await pool!.query("SELECT link FROM articles")).rows).toEqual([{ link: "https://undated-new" }]);
  });

  it("dry run leaves all content and identities untouched", async () => {
    // Mutation: executing the batch from a preview destroys rows without --apply.
    await seed("https://old", "2020-01-01");
    const result = await runArticleRetention(pool!, { now, dryRun: true });
    expect(result.expired).toBe(1);
    expect((await pool!.query("SELECT content FROM articles")).rows).toEqual([{ content: "full body" }]);
    expect((await pool!.query("SELECT count(*)::int AS n FROM article_seen_keys")).rows[0].n).toBe(0);
  });

  it("remembers deleted links and source GUIDs even when the publisher changes the date or URL", async () => {
    // Mutation: deleting without receipts allows old stories to be reinserted with today's date.
    await seed("https://old", "2020-01-01");
    await runArticleRetention(pool!, { now, vacuum: false });
    expect(await ingestNewsArticle(db!, { title: "repeat", link: "https://old", publishedAt: now }, now)).toBeUndefined();
    expect(await ingestNewsArticle(db!, { title: "repeat", link: "https://new-url", sourceId: 1, guid: "https://old", publishedAt: now }, now)).toBeUndefined();
    expect((await pool!.query("SELECT count(*)::int AS n FROM articles")).rows[0].n).toBe(0);
  });

  it("rejects stale arrivals and stores only a bounded description for new news", async () => {
    // Mutation: bypassing the age guard reimports expired news after receipts expire.
    expect(await ingestNewsArticle(db!, { title: "old", link: "https://old", publishedAt: new Date("2020-01-01") }, now)).toBeUndefined();
    const article = await ingestNewsArticle(db!, { title: "new", link: "https://new", content: "full body", description: "x".repeat(600), publishedAt: new Date("invalid") }, now);
    expect(article?.content).toBeNull();
    expect(article?.description).toHaveLength(500);
    expect(article?.publishedAt?.toISOString()).toBe(now.toISOString());
    expect(await ingestNewsArticle(db!, { title: "boundary", link: "https://boundary", publishedAt: new Date(cutoff) }, now)).toBeDefined();
  });

  it("serializes concurrent duplicate inserts and keeps source GUIDs scoped to their source", async () => {
    // Mutation: removing the shared transaction lock permits two identical URLs without a URL constraint.
    const inserts = await Promise.all(Array.from({ length: 4 }, () => ingestNewsArticle(db!, { title: "new", link: "https://same", sourceId: 1, guid: "123" }, now)));
    expect(inserts.filter(Boolean)).toHaveLength(1);
    expect(await ingestNewsArticle(db!, { title: "other source", link: "https://different", sourceId: 2, guid: "123" }, now)).toBeDefined();
  });

  it("bounds receipt history but refreshes identities when a feed repeats a story", async () => {
    // Mutation: not refreshing last_seen permits repeatedly surfaced undated stories to return.
    await seed("https://repeat", "2020-01-01");
    await seed("https://forgotten", "2020-01-01");
    await runArticleRetention(pool!, { now, vacuum: false });
    const later = new Date("2027-01-23T12:00:00Z");
    await ingestNewsArticle(db!, { title: "repeat", link: "https://repeat" }, new Date("2027-01-22T12:00:00Z"));
    await runArticleRetention(pool!, { now: later, vacuum: false });
    expect((await pool!.query("SELECT count(*)::int AS n FROM article_seen_keys")).rows[0].n).toBe(1);
    expect(await ingestNewsArticle(db!, { title: "repeat", link: "https://repeat" }, later)).toBeUndefined();
  });

  it("rolls back deletion if recording an identity fails, then resumes idempotently", async () => {
    // Mutation: separate commits for receipts and deletion can lose dedup history on failure.
    await seed("https://old", "2020-01-01");
    await pool!.query("ALTER TABLE article_seen_keys ADD CONSTRAINT fail_receipt CHECK(false)");
    await expect(runArticleRetention(pool!, { now, vacuum: false })).rejects.toThrow();
    expect((await pool!.query("SELECT count(*)::int AS n FROM articles")).rows[0].n).toBe(1);
    await pool!.query("ALTER TABLE article_seen_keys DROP CONSTRAINT fail_receipt");
    expect((await runArticleRetention(pool!, { now, vacuum: false })).deleted).toBe(1);
    expect((await runArticleRetention(pool!, { now, vacuum: false })).deleted).toBe(0);
  });
});

describe("retention schedule", () => {
  it("runs after startup and retries hourly after an error without overlap", async () => {
    // Mutation: omitting the timer or retaining a failed in-flight guard leaves cleanup permanently stopped.
    vi.useFakeTimers();
    const outcomes: string[] = [];
    let release!: () => void;
    const stop = startArticleRetention(async () => {
      outcomes.push("run");
      if (outcomes.length === 1) throw new Error("database unavailable");
      await new Promise<void>(resolve => { release = resolve; });
    });
    await vi.advanceTimersByTimeAsync(60_000);
    await vi.advanceTimersByTimeAsync(3_600_000);
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(outcomes).toEqual(["run", "run"]);
    release();
    await vi.advanceTimersByTimeAsync(3_600_000);
    expect(outcomes).toHaveLength(3);
    release();
    stop();
    vi.useRealTimers();
  });
});
