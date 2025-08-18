
import { pool } from '../db.js';
// import { notifyAdminsStockStatus } from '../utils/stockAlerts.js';

import { notifyAdminsStockStatus } from '../services/stockAlert.service.js';

const badReq = (m)=>{ const e=new Error(m); e.statusCode=400; return e; };

export const createPO = async (req, res, next) => {
  const { supplier_id, items, note } = req.body; // items: [{product_id, qty_pack, price_per_pack}]
  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();
    const code = `PO-${new Date().toISOString().slice(0,10).replace(/-/g,'')}-${Math.floor(Math.random()*900+100)}`;
    const [po] = await conn.query(
      `INSERT INTO purchase_orders (code, supplier_id, requested_by, status, note)
       VALUES (?,?,?,?,?)`,
      [code, supplier_id, req.user.id, 'draft', note || null]
    );
    for (const it of items) {
      await conn.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, qty_pack, price_per_pack)
         VALUES (?,?,?,?)`,
        [po.insertId, it.product_id, it.qty_pack, it.price_per_pack]
      );
    }
    await conn.commit();
    res.status(201).json({ status:true, id: po.insertId, code });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
};

export const sendPO = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [r] = await pool.query(`UPDATE purchase_orders SET status='sent' WHERE id=?`, [id]);
    res.json({ status:true, message:'PO sent', affectedRows: r.affectedRows });
  } catch (e) { next(e); }
};

// di dalam receiveGRN:
export const receiveGRN = async (req, res, next) => {
  const { id } = req.params;
  const { items = [], note } = req.body;

  if (!id || isNaN(Number(id))) return next(badReq('PO id tidak valid'));
  if (!Array.isArray(items) || items.length === 0) return next(badReq('Items wajib diisi'));

  // sanitasi awal items
  for (const it of items) {
    if (!it?.product_id) return next(badReq('product_id wajib'));
    const qtyPack = Number(it.qty_pack);
    if (!Number.isFinite(qtyPack) || qtyPack <= 0) return next(badReq('qty_pack harus > 0'));
  }

  const conn = await pool.getConnection();
  const changedIds = new Set();

  try {
    await conn.beginTransaction();

    // Kunci PO
    const [[po]] = await conn.query(
      `SELECT id, status FROM purchase_orders WHERE id=? FOR UPDATE`,
      [Number(id)]
    );
    if (!po) throw badReq('PO tidak ditemukan');
    if (!['sent','confirmed','draft'].includes(po.status)) {
      throw badReq('PO tidak valid untuk penerimaan');
    }

    // Buat header GRN
    const [grnRes] = await conn.query(
      `INSERT INTO grn_receipts (purchase_order_id, received_by, note, received_at)
       VALUES (?,?,?,NOW())`,
      [po.id, req.user?.id || null, note || null]
    );
    const grnId = grnRes.insertId;

    // Proses tiap item
    for (const it of items) {
      const pid = Number(it.product_id);
      const qtyPack = Number(it.qty_pack);

      // Lock product row dulu
      const [[prod]] = await conn.query(
        `SELECT id, pack_size FROM products WHERE id=? FOR UPDATE`,
        [pid]
      );
      if (!prod) throw badReq(`Produk id ${pid} tidak ditemukan`);

      const packSize = Number(prod.pack_size || 1);
      const units = qtyPack * packSize;

      // Simpan baris item GRN
      await conn.query(
        `INSERT INTO grn_receipt_items (grn_receipt_id, product_id, qty_pack)
         VALUES (?,?,?)`,
        [grnId, pid, qtyPack]
      );

      // Tambah stok produk
      await conn.query(
        `UPDATE products SET stock_units = stock_units + ? WHERE id=?`,
        [units, pid]
      );
      changedIds.add(pid);

      // Catat movement
      await conn.query(
        `INSERT INTO stock_movements (product_id, movement_type, source, ref_table, ref_id, qty_units, note)
         VALUES (?,?,?,?,?,?,?)`,
        [pid, 'in', 'purchase', 'grn_receipts', grnId, units, 'GRN received']
      );
    }

    // Update status PO -> received
    await conn.query(
      `UPDATE purchase_orders SET status='received', updated_at=NOW() WHERE id=?`,
      [po.id]
    );

    await conn.commit();

    res.json({
      status: true,
      message: 'Barang diterima & stok terupdate',
      grn_id: grnId
    });

    // === Notifikasi WA setelah commit (tanpa cooldown) ===
    for (const pid of changedIds) {
      try { await notifyAdminsStockStatus(pid); } catch (e) {
        console.error('Gagal kirim WA stok:', e.message);
      }
    }

  } catch (e) {
    try { await conn.rollback(); } catch {}
    if (e?.statusCode) return res.status(e.statusCode).json({ status:false, message:e.message });
    next(e);
  } finally {
    conn.release();
  }
};
// ==== Tambahan untuk role SUPPLIER ====
export const listMyPOs = async (req, res, next) => {
  try {
    // ambil supplier_id dari user supplier
    const [[u]] = await pool.query(`SELECT supplier_id FROM users WHERE id=?`, [req.user.id]);
    if (!u?.supplier_id) return res.status(400).json({ status:false, message:'Akun supplier belum terhubung ke organisasi supplier' });

    const [rows] = await pool.query(
      `SELECT po.id, po.code, po.status, po.created_at,
              s.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items poi WHERE poi.purchase_order_id=po.id) AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id
       WHERE po.supplier_id=?
       ORDER BY po.created_at DESC`,
      [u.supplier_id]
    );
    res.json({ status:true, data: rows });
  } catch (e) { next(e); }
};

export const getPOById = async (req, res, next) => {
  try {
    const id = req.params.id;
    const [[po]] = await pool.query(
      `SELECT po.*, s.name AS supplier_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id
       WHERE po.id=?`, [id]
    );
    if (!po) return res.status(404).json({ status:false, message:'Not found' });

    // jika user supplier, pastikan dia pemilik PO tsb
    if (req.user.role === 'supplier') {
      const [[usr]] = await pool.query(`SELECT supplier_id FROM users WHERE id=?`, [req.user.id]);
      if (usr?.supplier_id !== po.supplier_id) {
        return res.status(403).json({ status:false, message:'Forbidden' });
      }
    }

    const [items] = await pool.query(
      `SELECT poi.id, poi.product_id, p.name AS product_name,
              poi.qty_pack, poi.price_per_pack, p.pack_size, p.unit_name
       FROM purchase_order_items poi
       JOIN products p ON p.id=poi.product_id
       WHERE poi.purchase_order_id=?`,
      [id]
    );

    res.json({ status:true, po, items });
  } catch (e) { next(e); }
};

export const supplierConfirmPO = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const id = req.params.id;
    // validasi kepemilikan
    const [[usr]] = await conn.query(`SELECT supplier_id FROM users WHERE id=?`, [req.user.id]);
    if (!usr?.supplier_id) throw new Error('Akun supplier belum terhubung ke organisasi supplier');

    const [[po]] = await conn.query(`SELECT supplier_id, status FROM purchase_orders WHERE id=? FOR UPDATE`, [id]);
    if (!po) return res.status(404).json({ status:false, message:'Not found' });
    if (po.supplier_id !== usr.supplier_id) return res.status(403).json({ status:false, message:'Forbidden' });

    if (po.status !== 'sent' && po.status !== 'draft') {
      return res.status(400).json({ status:false, message:'PO tidak bisa dikonfirmasi pada status saat ini' });
    }

    await conn.beginTransaction();
    await conn.query(`UPDATE purchase_orders SET status='confirmed', updated_at=NOW() WHERE id=?`, [id]);
    await conn.commit();
    res.json({ status:true, message:'PO dikonfirmasi' });
  } catch (e) {
    await conn.rollback();
    next(e);
  } finally { conn.release(); }
};

// List semua PO (ADMIN) dengan filter & pagination
export const listAllPOs = async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();   // cari di code / nama supplier
    const status = (req.query.status || '').trim();   // draft|sent|confirmed|received
    const page = Math.max(1, parseInt(req.query.page || '1', 10));
    const limit = Math.min(100, Math.max(1, parseInt(req.query.limit || '20', 10)));
    const offset = (page - 1) * limit;

    const where = [];
    const args = [];

    if (search) {
      where.push(`(po.code LIKE ? OR s.name LIKE ?)`);
      args.push(`%${search}%`, `%${search}%`);
    }
    if (status) {
      where.push(`po.status = ?`);
      args.push(status);
    }

    const whereSql = where.length ? `WHERE ${where.join(' AND ')}` : '';

    const [rows] = await pool.query(
      `SELECT po.id, po.code, po.status, po.created_at, s.name AS supplier_name,
              (SELECT COUNT(*) FROM purchase_order_items i WHERE i.purchase_order_id=po.id) AS item_count
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id
       ${whereSql}
       ORDER BY po.created_at DESC
       LIMIT ? OFFSET ?`,
      [...args, limit, offset]
    );

    const [[{ total }]] = await pool.query(
      `SELECT COUNT(*) total
       FROM purchase_orders po
       JOIN suppliers s ON s.id=po.supplier_id
       ${whereSql}`,
      args
    );

    res.json({ status: true, data: rows, page, limit, total });
  } catch (e) { next(e); }
};


