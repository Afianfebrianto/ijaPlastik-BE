
import { pool } from '../db.js';

export const getSummary = async (req, res, next) => {
  try {
    const [[today]] = await pool.query(
      `SELECT DATE(sale_datetime) d, COUNT(*) as trx, COALESCE(SUM(total),0) omzet
       FROM sales WHERE DATE(sale_datetime)=CURDATE()`
    );
    const [top] = await pool.query(
      `SELECT p.id, p.name, SUM(si.qty * CASE WHEN si.item_type='pack' THEN p.pack_size ELSE 1 END) as units_sold
       FROM sale_items si JOIN products p ON p.id=si.product_id
       GROUP BY p.id, p.name ORDER BY units_sold DESC LIMIT 5`
    );
    const [low] = await pool.query(
      `SELECT id, name, stock_units, min_stock_units FROM products
       WHERE stock_units < COALESCE(min_stock_units,0) ORDER BY stock_units ASC LIMIT 10`
    );
    res.json({ status:true, today, top_products: top, low_stock: low });
  } catch (e) { next(e); }
};
