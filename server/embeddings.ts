import pg from "pg";

const pool = new pg.Pool({
  connectionString: process.env.DATABASE_URL,
});

export async function initializeVectorSupport(): Promise<void> {
  const client = await pool.connect();
  try {
    await client.query(`
      ALTER TABLE articles ADD COLUMN IF NOT EXISTS search_vector tsvector
    `);
    await client.query(`
      CREATE INDEX IF NOT EXISTS articles_search_idx ON articles USING gin(search_vector)
    `);
    await client.query(`
      UPDATE articles SET search_vector = 
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(source_name, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'D')
      WHERE search_vector IS NULL
    `);
    console.log("Full-text search index initialized");
  } finally {
    client.release();
  }
}

export async function updateSearchVectors(): Promise<{ updated: number }> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      UPDATE articles SET search_vector = 
        setweight(to_tsvector('english', coalesce(title, '')), 'A') ||
        setweight(to_tsvector('english', coalesce(category, '')), 'B') ||
        setweight(to_tsvector('english', coalesce(source_name, '')), 'C') ||
        setweight(to_tsvector('english', coalesce(description, '')), 'D')
      WHERE search_vector IS NULL
    `);
    return { updated: result.rowCount || 0 };
  } finally {
    client.release();
  }
}

export async function searchRelevantArticles(
  query: string,
  limit = 40
): Promise<Array<{
  id: number;
  title: string;
  description: string | null;
  content: string | null;
  category: string | null;
  sourceName: string | null;
  publishedAt: Date | null;
  rank: number;
}>> {
  const client = await pool.connect();
  try {
    const words = query
      .replace(/[^\w\s]/g, "")
      .split(/\s+/)
      .filter(w => w.length > 2);
    
    if (words.length === 0) {
      const result = await client.query(
        `SELECT id, title, description, content, category, source_name, published_at, 0 as rank
         FROM articles
         WHERE dismissed = false
         ORDER BY published_at DESC NULLS LAST
         LIMIT $1`,
        [limit]
      );
      return result.rows.map(mapRow);
    }

    const tsQuery = words.map(w => `${w}:*`).join(" | ");
    const allResults: any[] = [];

    try {
      const result = await client.query(
        `SELECT id, title, description, content, category, source_name, published_at,
                ts_rank_cd(search_vector, to_tsquery('english', $1)) as rank
         FROM articles
         WHERE search_vector @@ to_tsquery('english', $1) AND dismissed = false
         ORDER BY rank DESC, published_at DESC NULLS LAST
         LIMIT $2`,
        [tsQuery, limit]
      );
      allResults.push(...result.rows);
    } catch {
    }

    if (allResults.length < limit) {
      const existingIds = allResults.map(r => r.id);
      const remaining = limit - allResults.length;
      const likePatterns = words.slice(0, 3);
      const likeConditions = likePatterns.map((_, i) =>
        `(title ILIKE $${i + 1} OR description ILIKE $${i + 1} OR category ILIKE $${i + 1})`
      ).join(" OR ");
      const likeValues = likePatterns.map(w => `%${w}%`);

      const fallback = await client.query(
        `SELECT id, title, description, content, category, source_name, published_at, 0.01 as rank
         FROM articles
         WHERE (${likeConditions}) AND dismissed = false
         ${existingIds.length > 0 ? `AND id NOT IN (${existingIds.join(",")})` : ""}
         ORDER BY published_at DESC NULLS LAST
         LIMIT $${likePatterns.length + 1}`,
        [...likeValues, remaining]
      );
      allResults.push(...fallback.rows);
    }

    if (allResults.length === 0) {
      const fallback = await client.query(
        `SELECT id, title, description, content, category, source_name, published_at, 0 as rank
         FROM articles
         WHERE dismissed = false
         ORDER BY published_at DESC NULLS LAST
         LIMIT $1`,
        [limit]
      );
      return fallback.rows.map(mapRow);
    }

    return allResults.map(mapRow);
  } finally {
    client.release();
  }
}

function mapRow(row: any) {
  return {
    id: row.id,
    title: row.title,
    description: row.description,
    content: row.content,
    category: row.category,
    sourceName: row.source_name,
    publishedAt: row.published_at,
    rank: parseFloat(row.rank),
  };
}

export async function getSearchStats(): Promise<{
  total: number;
  indexed: number;
  pending: number;
}> {
  const client = await pool.connect();
  try {
    const result = await client.query(`
      SELECT 
        COUNT(*) as total,
        COUNT(search_vector) as indexed,
        COUNT(*) - COUNT(search_vector) as pending
      FROM articles
    `);
    return {
      total: parseInt(result.rows[0].total),
      indexed: parseInt(result.rows[0].indexed),
      pending: parseInt(result.rows[0].pending),
    };
  } finally {
    client.release();
  }
}
