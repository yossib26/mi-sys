const { TEMPLATES } = require('../lib/campaign-page');

const templateList = Object.entries(TEMPLATES).map(([id, t]) => ({ id, label: t.label, swatch: t.swatch }));

module.exports = async (req, res) => {
  if (req.method !== 'GET') {
    res.status(405).json({ error: 'שיטת בקשה לא נתמכת' });
    return;
  }
  res.status(200).json(templateList);
};
