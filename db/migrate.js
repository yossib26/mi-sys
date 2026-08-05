const fs = require('fs');
const path = require('path');
const pool = require('../lib/db');
const { slugify } = require('../lib/slug');

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

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await backfillBrandSlugs();
  await backfillCampaignSlugs();
  console.log('Migration applied successfully.');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
