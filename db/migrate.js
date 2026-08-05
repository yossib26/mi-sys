const fs = require('fs');
const path = require('path');
const pool = require('../lib/db');
const { slugify } = require('../lib/slug');
const { hashPassword } = require('../lib/auth');

async function backfillBrandSlugs() {
  const { rows } = await pool.query('SELECT id, name FROM brands WHERE slug IS NULL');
  for (const row of rows) {
    const slug = `${slugify(row.name)}-${row.id}`.replace(/^-+/, '');
    await pool.query('UPDATE brands SET slug = $1 WHERE id = $2', [slug, row.id]);
  }
  if (rows.length > 0) console.log(`Backfilled slug for ${rows.length} existing brand(s).`);
}

async function backfillCampaignSlugs() {
  const { rows } = await pool.query('SELECT id, name FROM campaigns WHERE slug IS NULL');
  for (const row of rows) {
    const slug = `${slugify(row.name)}-${row.id}`.replace(/^-+/, '');
    await pool.query('UPDATE campaigns SET slug = $1 WHERE id = $2', [slug, row.id]);
  }
  if (rows.length > 0) console.log(`Backfilled slug for ${rows.length} existing campaign(s).`);
}

// One-time bootstrap: guarantees a primary admin account (and one
// demo regular user) exist. Idempotent (ON CONFLICT DO NOTHING) —
// safe to run on every deploy.
async function seedUser(username, password, role) {
  const passwordHash = await hashPassword(password);
  const result = await pool.query(
    `INSERT INTO users (username, password_hash, role)
     VALUES ($1, $2, $3)
     ON CONFLICT (username) DO NOTHING
     RETURNING id`,
    [username, passwordHash, role]
  );
  if (result.rowCount > 0) console.log(`Seeded ${role} user (username '${username}').`);
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await backfillBrandSlugs();
  await backfillCampaignSlugs();
  await seedUser('admin', 'admin', 'admin');
  await seedUser('user', 'user', 'user');
  console.log('Migration applied successfully.');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
