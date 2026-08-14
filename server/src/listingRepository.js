import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import path from "node:path";
import pg from "pg";

const databaseUrl = process.env.DATABASE_URL || "";
const localDataFile = path.resolve(process.env.LISTINGS_DATA_FILE || ".data/listings.json");
const pool = databaseUrl ? new pg.Pool({ connectionString: databaseUrl }) : null;

let localListings = null;

async function saveLocalListings() {
  await mkdir(path.dirname(localDataFile), { recursive: true });
  const temporary = `${localDataFile}.${process.pid}.tmp`;
  await writeFile(temporary, JSON.stringify({ listings: localListings }, null, 2), { mode: 0o600 });
  await rename(temporary, localDataFile);
}

async function initializePostgres(seedListings) {
  await pool.query(`
    CREATE TABLE IF NOT EXISTS listings (
      id TEXT PRIMARY KEY,
      payload JSONB NOT NULL,
      created_at TIMESTAMPTZ NOT NULL
    );
    CREATE INDEX IF NOT EXISTS listings_created_idx ON listings(created_at DESC);
  `);
  const existing = await pool.query("SELECT payload FROM listings ORDER BY created_at DESC");
  if (existing.rowCount) return existing.rows.map((row) => row.payload);

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    for (const listing of seedListings) {
      await client.query(
        "INSERT INTO listings (id, payload, created_at) VALUES ($1,$2,$3) ON CONFLICT (id) DO NOTHING",
        [listing.id, JSON.stringify(listing), listing.createdAt]
      );
    }
    await client.query("COMMIT");
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
  return [...seedListings];
}

async function initializeLocal(seedListings) {
  if (localListings) return localListings;
  try {
    const stored = JSON.parse(await readFile(localDataFile, "utf8"));
    localListings = Array.isArray(stored.listings) ? stored.listings : [];
  } catch (error) {
    if (error.code !== "ENOENT") throw error;
    localListings = [...seedListings];
    await saveLocalListings();
  }
  return localListings;
}

export async function initializeListingRepository(seedListings) {
  const listings = pool
    ? await initializePostgres(seedListings)
    : await initializeLocal(seedListings);
  return { driver: pool ? "postgres" : "local-file", listings };
}

export async function persistListing(listing) {
  if (pool) {
    await pool.query(
      `INSERT INTO listings (id, payload, created_at) VALUES ($1,$2,$3)
       ON CONFLICT (id) DO UPDATE SET payload = EXCLUDED.payload, created_at = EXCLUDED.created_at`,
      [listing.id, JSON.stringify(listing), listing.createdAt]
    );
    return listing;
  }
  if (!localListings) await initializeLocal([]);
  const index = localListings.findIndex((item) => item.id === listing.id);
  if (index >= 0) localListings[index] = listing;
  else localListings.unshift(listing);
  await saveLocalListings();
  return listing;
}

export async function resetListingsForTests(seedListings = []) {
  if (pool) {
    await pool.query("TRUNCATE listings");
    for (const listing of seedListings) await persistListing(listing);
  } else {
    localListings = [...seedListings];
    await saveLocalListings();
  }
}
