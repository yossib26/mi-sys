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

// One-time bootstrap for the brand-access feature: the demo 'user'
// account predates it, so without this it would suddenly see zero
// brands/campaigns. Only runs if it has no assignments yet — an
// admin narrowing its access later via ניהול משתמשים won't get
// silently reset back to "all brands" on the next migrate.
async function bootstrapDemoUserBrandAccess() {
  const user = await pool.query("SELECT id FROM users WHERE username = 'user'");
  if (user.rowCount === 0) return;
  const userId = user.rows[0].id;
  const existing = await pool.query('SELECT 1 FROM user_brands WHERE user_id = $1 LIMIT 1', [userId]);
  if (existing.rowCount > 0) return;
  const result = await pool.query(
    `INSERT INTO user_brands (user_id, brand_id) SELECT $1, id FROM brands
     ON CONFLICT DO NOTHING RETURNING brand_id`,
    [userId]
  );
  if (result.rowCount > 0) console.log(`Granted demo 'user' access to ${result.rowCount} existing brand(s).`);
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await backfillBrandSlugs();
  await backfillCampaignSlugs();
  await seedUser('admin', 'admin', 'admin');
  await seedUser('user', 'user', 'user');
  await bootstrapDemoUserBrandAccess();
  console.log('Migration applied successfully.');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
