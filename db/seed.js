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

  // --- 20 additional demo campaigns (pagination/sorting sample data) ---
  { brand: 'נובה קוסמטיקס', name: 'מבצע ולנטיין', description: 'מבצע זוגי לקראת ולנטיין', budget: 6000, start_date: '2027-02-01', end_date: '2027-02-14', status: 'draft' },
  { brand: 'נובה קוסמטיקס', name: 'קולקציית חורף', description: 'השקת קולקציית איפור לחורף', budget: 18000, start_date: '2026-11-01', end_date: '2026-12-15', status: 'active' },
  { brand: 'נובה קוסמטיקס', name: 'אריזת מתנה לחג', description: 'סטים ארוזים למתנה לחגי תשרי', budget: 9500, start_date: '2026-09-10', end_date: '2026-10-05', status: 'completed' },
  { brand: 'נובה קוסמטיקס', name: 'שיתוף פעולה עם בלוגריות', description: 'קמפיין תוכן עם בלוגריות יופי מובילות', budget: 11000, start_date: '2026-04-01', end_date: '2026-04-30', status: 'paused' },
  { brand: 'נובה קוסמטיקס', name: 'מבצע 1+1', description: 'מבצע קנה אחד קבל אחד על כל המותג', budget: 14000, start_date: '2026-08-01', end_date: '2026-08-20', status: 'active' },
  { brand: 'נובה קוסמטיקס', name: 'השקת סדרת טיפוח לגברים', description: 'השקת קו מוצרים חדש לטיפוח גברים', budget: 22000, start_date: '2027-01-05', end_date: '2027-02-05', status: 'draft' },
  { brand: 'נובה קוסמטיקס', name: 'סוף עונה - מבצע סליקה', description: 'מכירת חיסול על מלאי עונתי', budget: 7000, start_date: '2026-12-20', end_date: '2027-01-10', status: 'draft' },
  { brand: 'נובה קוסמטיקס', name: 'יום האישה הבינלאומי', description: 'קמפיין מיוחד ליום האישה', budget: 5000, start_date: '2027-03-01', end_date: '2027-03-08', status: 'draft' },
  { brand: 'נובה קוסמטיקס', name: 'Back to School', description: 'מבצע חזרה לבית הספר', budget: 8000, start_date: '2026-08-15', end_date: '2026-09-01', status: 'completed' },
  { brand: 'נובה קוסמטיקס', name: 'מבצע חבר מביא חבר', description: 'תוכנית הפניות ללקוחות קיימים', budget: 4000, start_date: '2026-06-15', end_date: '2026-07-15', status: 'cancelled' },
  { brand: "פיוז'ן ספורט", name: 'מרתון תל אביב', description: 'חסות וחלוקת ציוד למשתתפי המרתון', budget: 20000, start_date: '2027-02-10', end_date: '2027-02-20', status: 'draft' },
  { brand: "פיוז'ן ספורט", name: 'קולקציית אימונים חדשה', description: 'השקת קולקציית ביגוד אימונים', budget: 16000, start_date: '2026-10-01', end_date: '2026-10-31', status: 'active' },
  { brand: "פיוז'ן ספורט", name: 'מבצע סוף עונה נעליים', description: 'מכירת חיסול על דגמי נעליים נבחרים', budget: 9000, start_date: '2026-12-01', end_date: '2026-12-31', status: 'draft' },
  { brand: "פיוז'ן ספורט", name: 'שיתוף פעולה עם קבוצת כדורגל', description: 'חסות רשמית לקבוצת ליגת העל', budget: 45000, start_date: '2026-08-01', end_date: '2027-05-31', status: 'active' },
  { brand: "פיוז'ן ספורט", name: 'השקת ביגוד יוגה', description: 'השקת קו ביגוד ייעודי ליוגה ופילאטיס', budget: 13000, start_date: '2026-05-15', end_date: '2026-06-15', status: 'completed' },
  { brand: "פיוז'ן ספורט", name: 'אליפות שחייה ארצית', description: 'חסות לאליפות שחייה ארצית', budget: 10000, start_date: '2026-07-01', end_date: '2026-07-10', status: 'completed' },
  { brand: "פיוז'ן ספורט", name: 'מבצע רכישה שנייה בהנחה', description: 'הנחה על מוצר שני בקנייה', budget: 6500, start_date: '2026-09-15', end_date: '2026-10-01', status: 'paused' },
  { brand: "פיוז'ן ספורט", name: 'יום הספורט הלאומי', description: 'קמפיין מיוחד ליום הספורט הלאומי', budget: 5500, start_date: '2027-04-01', end_date: '2027-04-05', status: 'draft' },
  { brand: "פיוז'ן ספורט", name: 'קמפיין השקה - נעלי ריצה למתחילים', description: 'קמפיין ממוקד רצים מתחילים', budget: 17000, start_date: '2027-01-15', end_date: '2027-02-15', status: 'draft' },
  { brand: "פיוז'ן ספורט", name: 'חסות לתחרות טריאתלון', description: 'חסות לתחרות טריאתלון ארצית', budget: 24000, start_date: '2026-06-01', end_date: '2026-06-05', status: 'cancelled' },
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
