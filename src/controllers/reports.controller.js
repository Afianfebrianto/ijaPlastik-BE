// src/controllers/reports.controller.js
import { pool } from '../db.js';

// GET /reports/cashiers  → daftar kasir aktif
export const listCashiers = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       WHERE r.name = 'cashier' AND u.is_active = 1
       ORDER BY u.name ASC`
    );
    res.json({ status: true, data: rows });
  } catch (e) { next(e); }
};

// GET /reports/cashier?date_from=YYYY-MM-DD&date_to=YYYY-MM-DD&cashier_id=#
export const cashierReport = async (req, res, next) => {
  try {
    const df = req.query.date_from;
    const dt = req.query.date_to;
    const cashierId = req.query.cashier_id ? Number(req.query.cashier_id) : null;
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    if (!df || !dt) return res.status(400).json({ status:false, message:'date_from dan date_to wajib' });

    const where = [`s.created_at BETWEEN ? AND ?`];
    const args = [`${df} 00:00:00`, `${dt} 23:59:59`];
    if (cashierId) { where.push(`s.cashier_id = ?`); args.push(cashierId); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    // Detail baris per transaksi (dengan agregat item_count & units_sold)
    const [rows] = await pool.query(
  `SELECT s.id, s.receipt_no, s.created_at, s.payment_method,
          s.subtotal, s.total,
          u.name AS cashier_name,
          COUNT(si.id) AS item_count,
          COALESCE(SUM(CASE WHEN si.item_type='pack' 
              THEN si.qty * p.pack_size ELSE si.qty END),0) AS units_sold
   FROM sales s
   JOIN users u ON u.id = s.cashier_id
   LEFT JOIN sale_items si ON si.sale_id = s.id
   LEFT JOIN products p ON p.id = si.product_id
   ${whereSql}
   GROUP BY s.id
   ORDER BY s.created_at DESC
   LIMIT ? OFFSET ?`,
  [...args, limit, offset]
);

    // Ringkasan total
    const [sumRows] = await pool.query(
  `SELECT COUNT(DISTINCT s.id) AS trx,
          COALESCE(SUM(s.subtotal),0) AS subtotal,
          COALESCE(SUM(s.total),0) AS omzet,
          COALESCE(SUM(CASE WHEN si.item_type='pack' 
              THEN si.qty * p.pack_size ELSE si.qty END),0) AS units_sold
   FROM sales s
   LEFT JOIN sale_items si ON si.sale_id = s.id
   LEFT JOIN products p ON p.id = si.product_id
   ${whereSql}`,
  args
);
    const summary = sumRows[0];

    // total untuk pagination (jumlah transaksi)
    const [[{ total_trx }]] = await pool.query(
      `SELECT COUNT(*) AS total_trx
       FROM sales s
       ${whereSql.replace('JOIN users u ON u.id = s.cashier_id','')} -- safe, we didn't include that join here`,
      args
    );

    res.json({ status:true, data: rows, summary, page, limit, total: total_trx });
  } catch (e) { next(e); }
};

// GET /reports/cashier.csv?date_from=...&date_to=...&cashier_id=#
export const cashierReportCsv = async (req, res, next) => {
  try {
    const df = req.query.date_from;
    const dt = req.query.date_to;
    const cashierId = req.query.cashier_id ? Number(req.query.cashier_id) : null;

    if (!df || !dt) return res.status(400).json({ status:false, message:'date_from dan date_to wajib' });

    const where = [`s.created_at BETWEEN ? AND ?`];
    const args = [`${df} 00:00:00`, `${dt} 23:59:59`];
    if (cashierId) { where.push(`s.cashier_id = ?`); args.push(cashierId); }
    const whereSql = 'WHERE ' + where.join(' AND ');

    const [rows] = await pool.query(
      `SELECT s.id, s.receipt_no, s.created_at, s.payment_method,
              s.subtotal, s.tax, s.total,
              u.name AS cashier_name,
              COUNT(si.id) AS item_count,
              COALESCE(SUM(CASE WHEN si.item_type='pack' THEN si.qty * p.pack_size ELSE si.qty END),0) AS units_sold
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       LEFT JOIN sale_items si ON si.sale_id = s.id
       LEFT JOIN products p ON p.id = si.product_id
       ${whereSql}
       GROUP BY s.id
       ORDER BY s.created_at DESC`,
      args
    );

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="cashier-report_${df}_to_${dt}.csv"`);

    const headers = ['receipt_no','tanggal','kasir','items','units_sold','subtotal','total','payment'];
res.write(headers.join(',') + '\n');
for (const r of rows) {
  const line = [
    r.receipt_no,
    new Date(r.created_at).toISOString(),
    r.cashier_name,
    r.item_count,
    r.units_sold,
    r.subtotal,
    r.total,
    r.payment_method
  ].map(v => `"${String(v).replace(/"/g,'""')}"`).join(',');
  res.write(line + '\n');
}
    res.end();
  } catch (e) { next(e); }
};
