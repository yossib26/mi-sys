const fs = require('fs');
const path = require('path');
const pool = require('../lib/db');
const { buildSlug } = require('../lib/slug');

async function backfillSlugs() {
  const { rows } = await pool.query(`
    SELECT c.id, c.name, b.name AS brand_name
    FROM campaigns c
    JOIN brands b ON b.id = c.brand_id
    WHERE c.slug IS NULL
  `);
  for (const row of rows) {
    const slug = buildSlug(row.brand_name, row.name, row.id);
    await pool.query('UPDATE campaigns SET slug = $1 WHERE id = $2', [slug, row.id]);
  }
  if (rows.length > 0) console.log(`Backfilled slug for ${rows.length} existing campaign(s).`);
}

async function migrate() {
  const sql = fs.readFileSync(path.join(__dirname, 'schema.sql'), 'utf8');
  await pool.query(sql);
  await backfillSlugs();
  console.log('Migration applied successfully.');
}

migrate()
  .catch((error) => {
    console.error('Migration failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
