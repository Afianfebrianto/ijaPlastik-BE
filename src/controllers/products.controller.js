// src/controllers/products.controller.js
import { pool } from '../db.js';
import { notifyAdminsStockStatus } from '../services/stockAlert.service.js';

const badReq = (m)=>{ const e=new Error(m); e.statusCode=400; return e; };

// Hitung status berdasarkan stok & ambang
function computeStatus({ stock_units=0, min_stock_units=null, max_stock_units=null }) {
  const s = Number(stock_units || 0);
  const min = (min_stock_units != null) ? Number(min_stock_units) : null;
  const max = (max_stock_units != null) ? Number(max_stock_units) : null;
  if (min != null && s <= min) return 'LOW';
  if (max != null && s >= max) return 'OVER';
  return 'NORMAL';
}

export const addProduct = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const {
      name, sku, category,
      pack_size, unit_name,
      wholesale_price_per_pack, retail_price_per_unit,
      min_stock_units, max_stock_units,
      initial_stock_units // << stok awal (UNIT)
    } = req.body;

    const image_url = req.file?.path || null;

    // Validasi dasar
    if (!name) throw badReq('name wajib');
    if (!unit_name) throw badReq('unit_name wajib');
    if (!pack_size || Number(pack_size) <= 0) throw badReq('pack_size harus > 0');
    if (wholesale_price_per_pack == null || Number(wholesale_price_per_pack) < 0) throw badReq('wholesale_price_per_pack tidak valid');
    if (retail_price_per_unit == null || Number(retail_price_per_unit) < 0) throw badReq('retail_price_per_unit tidak valid');

    // SKU unik (opsional)
    if (sku) {
      const [[dupe]] = await pool.query(`SELECT id FROM products WHERE sku=?`, [sku]);
      if (dupe) throw badReq('SKU sudah dipakai');
    }

    const stockInit = Math.max(0, Number(initial_stock_units || 0));
    const minVal = (min_stock_units !== undefined && min_stock_units !== null) ? Number(min_stock_units) : null;
    const maxVal = (max_stock_units !== undefined && max_stock_units !== null) ? Number(max_stock_units) : null;

    const initialStatus = computeStatus({
      stock_units: stockInit,
      min_stock_units: minVal,
      max_stock_units: maxVal
    });

    await conn.beginTransaction();

    // INSERT product + status awal
    const [ins] = await conn.query(
      `INSERT INTO products
       (name, sku, category, pack_size, unit_name,
        wholesale_price_per_pack, retail_price_per_unit,
        stock_units, min_stock_units, max_stock_units,
        last_stock_status, last_stock_status_changed_at,
        image_url, created_at)
       VALUES (?,?,?,?,?,?,?,?,?,?,?,NOW(),?,NOW())`,
      [
        name, sku || null, category || null, Number(pack_size), unit_name,
        Number(wholesale_price_per_pack), Number(retail_price_per_unit),
        stockInit, minVal, maxVal,
        initialStatus, image_url
      ]
    );
    const productId = ins.insertId;

    // Catat movement jika stok awal > 0
    if (stockInit > 0) {
      await conn.query(
        `INSERT INTO stock_movements
         (product_id, movement_type, source, ref_table, ref_id, qty_units, note, created_at)
         VALUES (?,?,?,?,?,?,?,NOW())`,
        [productId, 'in', 'init', 'products', productId, stockInit, 'Initial stock']
      );
    }

    await conn.commit();

    // Tidak kirim WA saat create; biarkan sistem notif berjalan pada perubahan berikutnya
    res.status(201).json({ status:true, id: productId, message:'Produk ditambahkan' });

  } catch (e) {
    try { await conn.rollback(); } catch {}
    next(e);
  } finally {
    conn.release();
  }
};

export const listProducts = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM products ORDER BY id DESC`);
    res.json({ status:true, data: rows });
  } catch (e) { next(e); }
};

export const getProduct = async (req, res, next) => {
  try {
    const [rows] = await pool.query(`SELECT * FROM products WHERE id=?`, [req.params.id]);
    if(!rows.length) return res.status(404).json({ status:false, message:'Not found' });
    res.json({ status:true, data: rows[0] });
  } catch (e) { next(e); }
};

export const updateProduct = async (req, res, next) => {
  const id = Number(req.params.id);
  if (!id) return next(badReq('id invalid'));

  const {
    name, sku, category, unit_name,
    pack_size, wholesale_price_per_pack, retail_price_per_unit,
    stock_units, min_stock_units, max_stock_units
  } = req.body;

  try {
    // Ambil nilai lama (untuk cek apakah threshold/stock berubah)
    const [[old]] = await pool.query(
      `SELECT id, stock_units, min_stock_units, max_stock_units FROM products WHERE id=?`,
      [id]
    );
    if (!old) throw badReq('Produk tidak ditemukan');

    // Build SET dinamis
    const fields = [];
    const vals = [];
    const setIf = (col, val) => { if (val !== undefined) { fields.push(`${col}=?`); vals.push(val); } };

    setIf('name', name);
    setIf('sku', sku);
    setIf('category', category);
    setIf('unit_name', unit_name);
    setIf('pack_size', pack_size);
    setIf('wholesale_price_per_pack', wholesale_price_per_pack);
    setIf('retail_price_per_unit', retail_price_per_unit);
    setIf('stock_units', stock_units);
    setIf('min_stock_units', min_stock_units);
    setIf('max_stock_units', max_stock_units);

    if (!fields.length) return res.json({ status:true, message:'no changes' });

    fields.push('updated_at=NOW()');
    const sql = `UPDATE products SET ${fields.join(', ')} WHERE id=?`;
    vals.push(id);

    await pool.query(sql, vals);

    res.json({ status:true, message:'updated' });

    // Jika ada perubahan pada stok/min/max → cek & kirim WA (status-change aware)
    const changedThresholdOrStock =
      stock_units !== undefined || min_stock_units !== undefined || max_stock_units !== undefined;

    if (changedThresholdOrStock) {
      try { await notifyAdminsStockStatus(id); } catch (e) { console.error('WA stok error:', e.message); }
    }

  } catch (e) { next(e); }
};

export const deleteProduct = async (req, res, next) => {
  try {
    const [result] = await pool.query(`DELETE FROM products WHERE id=?`, [req.params.id]);
    res.json({ status:true, affectedRows: result.affectedRows });
  } catch (e) { next(e); }
};
