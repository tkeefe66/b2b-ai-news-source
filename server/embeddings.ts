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
