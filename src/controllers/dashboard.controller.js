import { pool } from '../db.js';

export const getSummary = async (req, res, next) => {
  try {
    // Hari ini (berdasarkan sale_datetime)
    const [[today]] = await pool.query(
      `SELECT 
         DATE(sale_datetime) AS d, 
         COUNT(*) AS trx, 
         COALESCE(SUM(total),0) AS omzet
       FROM sales 
       WHERE DATE(sale_datetime) = CURDATE()`
    );

    // Top produk terjual (units) – LIMIT 6
    // units = qty * (pack_size jika item_type='pack', else 1)
    const [top] = await pool.query(
      `SELECT 
         p.id, 
         p.name, 
         SUM(si.qty * CASE WHEN si.item_type='pack' THEN p.pack_size ELSE 1 END) AS units_sold
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       GROUP BY p.id, p.name
       ORDER BY units_sold DESC
       LIMIT 6`
    );

    // Produk stok menipis
    const [low] = await pool.query(
      `SELECT 
         id, name, stock_units, min_stock_units
       FROM products
       WHERE stock_units < COALESCE(min_stock_units, 0)
       ORDER BY stock_units ASC
       LIMIT 10`
    );

    // Omzet harian 14 hari terakhir (berdasarkan sale_datetime)
    const [daily] = await pool.query(
      `SELECT 
         DATE(sale_datetime) AS date,
         COALESCE(SUM(total),0) AS omzet,
         COUNT(*) AS trx
       FROM sales
       WHERE sale_datetime >= DATE_SUB(CURDATE(), INTERVAL 14 DAY)
       GROUP BY DATE(sale_datetime)
       ORDER BY DATE(sale_datetime) ASC`
    );

    res.json({ 
      status: true, 
      today, 
      top_products: top, 
      low_stock: low,
      daily_sales: daily
    });
  } catch (e) { 
    next(e); 
  }
};
