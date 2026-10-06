const reports = require('../services/reportService');
exports.get = async (req, res, next) => {
  try {
    const rep = await reports.build(req.params.type, req.query);
    if (req.query.format === 'csv') {
      const stamp = rep.params.from ? `${rep.params.from}_to_${rep.params.to}` : new Date().toISOString().slice(0, 10);
      res.setHeader('Content-Type', 'text/csv; charset=utf-8');
      res.setHeader('Content-Disposition', `attachment; filename="${req.params.type}-${stamp}.csv"`);
      return res.send(reports.toCsv(rep));
    }
    res.json({ success: true, data: rep });
  } catch (e) { next(e); }
};
