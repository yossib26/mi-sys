// One-off demo data: 2 brands, 5 campaigns. Safe to re-run — brand
// names are upserted by their unique constraint; campaigns are only
// inserted if a campaign with the same brand + name doesn't exist yet.
const pool = require('../lib/db');

const BRANDS = ['נובה קוסמטיקס', "פיוז'ן ספורט"];

const CAMPAIGNS = [
  {
    brand: 'נובה קוסמטיקס',
    name: 'השקת קולקציית קיץ',
    description: 'קמפיין השקה לקולקציית איפור קיץ חדשה',
    budget: 15000,
    start_date: '2026-06-01',
    end_date: '2026-07-15',
    status: 'active',
  },
  {
    brand: 'נובה קוסמטיקס',
    name: 'מבצע Black Friday',
    description: 'מבצע מכירות ליום שישי השחור',
    budget: 25000,
    start_date: '2026-11-20',
    end_date: '2026-11-30',
    status: 'draft',
  },
  {
    brand: 'נובה קוסמטיקס',
    name: 'קמפיין משפיעני יופי',
    description: 'שיתופי פעולה עם משפיענים ברשתות החברתיות',
    budget: 8000,
    start_date: '2026-05-01',
    end_date: '2026-05-31',
    status: 'paused',
  },
  {
    brand: "פיוז'ן ספורט",
    name: 'השקת קולקציית ריצה סתיו',
    description: 'קמפיין להשקת קולקציית נעלי ריצה חדשה',
    budget: 30000,
    start_date: '2026-09-01',
    end_date: '2026-10-15',
    status: 'active',
  },
  {
    brand: "פיוז'ן ספורט",
    name: 'חסות לאליפות רצים 2026',
    description: 'חסות לאירוע ריצה ארצי',
    budget: 12000,
    start_date: '2026-03-01',
    end_date: '2026-03-10',
    status: 'completed',
  },
];

async function seed() {
  const brandIds = {};

  for (const name of BRANDS) {
    const result = await pool.query(
      `INSERT INTO brands (name) VALUES ($1)
       ON CONFLICT (name) DO UPDATE SET name = EXCLUDED.name
       RETURNING id`,
      [name]
    );
    brandIds[name] = result.rows[0].id;
  }

  let inserted = 0;
  for (const c of CAMPAIGNS) {
    const result = await pool.query(
      `INSERT INTO campaigns (brand_id, name, description, budget, start_date, end_date, status)
       SELECT $1, $2, $3, $4, $5, $6, $7
       WHERE NOT EXISTS (
         SELECT 1 FROM campaigns WHERE brand_id = $1 AND name = $2
       )
       RETURNING id`,
      [brandIds[c.brand], c.name, c.description, c.budget, c.start_date, c.end_date, c.status]
    );
    inserted += result.rowCount;
  }

  console.log(`Seeded ${BRANDS.length} brands and ${inserted} new campaigns (${CAMPAIGNS.length - inserted} already existed).`);
}

seed()
  .catch((error) => {
    console.error('Seed failed:', error.message);
    process.exitCode = 1;
  })
  .finally(() => pool.end());
