
import { pool } from '../db.js';
// import { notifyAdminsStockStatus } from '../utils/stockAlerts.js';

import { notifyAdminsStockStatus } from '../services/stockAlert.service.js';
import { sendPONotification } from '../utils/alertSupply.js';

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
      [code, supplier_id, req.user.id, 'sent', note || null]
    );
    for (const it of items) {
      await conn.query(
        `INSERT INTO purchase_order_items (purchase_order_id, product_id, qty_pack, price_per_pack)
         VALUES (?,?,?,?)`,
        [po.insertId, it.product_id, it.qty_pack, it.price_per_pack]
      );
    }
    await conn.commit();
     // === Kirim WA ke supplier (AFTER COMMIT) ===
    try {
      // Ambil nomor & nama supplier
      const [[supplier]] = await pool.query(
        `SELECT name, phone FROM suppliers WHERE id=?`, [supplier_id]
      );

      // Ambil nama produk untuk diringkas di pesan
      const [detailItems] = await pool.query(
        `SELECT p.name, poi.qty_pack, poi.price_per_pack
         FROM purchase_order_items poi
         JOIN products p ON p.id = poi.product_id
         WHERE poi.purchase_order_id = ?`,
        [po.insertId]
      );

      if (supplier?.phone) {
        await sendPONotification(
          supplier.phone,
          supplier.name || 'Supplier',
          code,
          detailItems.map(d => ({
            name: d.name,
            qty_pack: Number(d.qty_pack),
            price_per_pack: Number(d.price_per_pack)
          })),
          note || null
        );
      } else {
        console.warn(`PO ${code}: supplier tidak punya nomor WA`);
      }

      // (Opsional) catat ke tabel notifications
      await pool.query(
        `INSERT INTO notifications (title, message, status)
         VALUES (?,?,?)`,
        [
          `WA PO ${code}`,
          `WA ke supplier ${supplier?.name || '-'} (${supplier?.phone || '-'}) terkirim`,
          'sent'
        ]
      );
    } catch (waErr) {
      console.error('Gagal kirim WA PO:', waErr?.response?.data || waErr.message);
      // (Opsional) catat failed
      await pool.query(
        `INSERT INTO notifications (title, message, status)
         VALUES (?,?,?)`,
        [
          `WA PO ${code}`,
          `Gagal kirim WA: ${waErr.message}`,
          'failed'
        ]
      );
    }
    res.status(201).json({ status:true, id: po.insertId, code });
  } catch (e) { await conn.rollback(); next(e); } finally { conn.release(); }
};

export const sendPO = async (req, res, next) => {
  try {
    const { id } = req.params;
    const [r] = await pool.query(
      `UPDATE purchase_orders 
         SET status='sent', sent_at=NOW(), updated_at=NOW()
       WHERE id=?`,
      [id]
    );
    res.json({ status:true, message:'PO sent', affectedRows: r.affectedRows });
  } catch (e) { next(e); }
};

// di dalam receiveGRN:
export const receiveGRN = async (req, res, next) => {
  const { id } = req.params;
  const { items = [], note } = req.body;

  if (!id || isNaN(Number(id))) return next(badReq('PO id tidak valid'));
  if (!Array.isArray(items) || items.length === 0) return next(badReq('Items wajib diisi'));

  for (const it of items) {
    if (!it?.product_id) return next(badReq('product_id wajib'));
    const qtyPack = Number(it.qty_pack);
    if (!Number.isFinite(qtyPack) || qtyPack < 0) return next(badReq('qty_pack harus >= 0'));

    const diffPack = Number(it.diff_qty_pack || 0);
    if (diffPack < 0) return next(badReq('diff_qty_pack tidak boleh negatif'));
    if (diffPack > 0 && !String(it.diff_reason || '').trim()) {
      return next(badReq('Alasan selisih wajib diisi bila ada diff_qty_pack > 0'));
    }
  }

  const conn = await pool.getConnection();
  const changedIds = new Set();

  try {
    await conn.beginTransaction();

    // lock PO
    const [[po]] = await conn.query(
      `SELECT id, status FROM purchase_orders WHERE id=? FOR UPDATE`,
      [Number(id)]
    );
    if (!po) throw badReq('PO tidak ditemukan');
    if (!['sent','confirmed','draft'].includes(po.status)) {
      throw badReq('PO tidak valid untuk penerimaan');
    }

    // header GRN
    const [grnRes] = await conn.query(
      `INSERT INTO grn_receipts (purchase_order_id, received_by, note, received_at)
       VALUES (?,?,?,NOW())`,
      [po.id, req.user?.id || null, note || null]
    );
    const grnId = grnRes.insertId;

    for (const it of items) {
      const pid = Number(it.product_id);
      const qtyPack = Number(it.qty_pack);
      const diffPack = Number(it.diff_qty_pack || 0);
      const diffReason = String(it.diff_reason || '').trim() || null;

      // lock product
      const [[prod]] = await conn.query(
        `SELECT id, pack_size FROM products WHERE id=? FOR UPDATE`,
        [pid]
      );
      if (!prod) throw badReq(`Produk id ${pid} tidak ditemukan`);

      const packSize = Number(prod.pack_size || 1);
      const units = qtyPack * packSize;

      // simpan item GRN (yang diterima saja)
      if (qtyPack > 0) {
        await conn.query(
          `INSERT INTO grn_receipt_items (grn_receipt_id, product_id, qty_pack)
           VALUES (?,?,?)`,
          [grnId, pid, qtyPack]
        );
        // tambah stok sesuai qty diterima
        await conn.query(
          `UPDATE products SET stock_units = stock_units + ? WHERE id=?`,
          [units, pid]
        );
        changedIds.add(pid);

        // movement
        await conn.query(
          `INSERT INTO stock_movements (product_id, movement_type, source, ref_table, ref_id, qty_units, note)
           VALUES (?,?,?,?,?,?,?)`,
          [pid, 'in', 'purchase', 'grn_receipts', grnId, units, 'GRN received']
        );
      }

      // catat selisih/retur (jika ada)
      if (diffPack > 0) {
        await conn.query(
          `INSERT INTO supplier_returns
             (grn_receipt_id, purchase_order_id, product_id, qty_pack, reason, created_at)
           VALUES (?,?,?,?,?,NOW())`,
          [grnId, po.id, pid, diffPack, diffReason]
        );
        // *Tidak* ada pergerakan stok untuk retur ini (asumsi barang tidak masuk stok)
      }
    }

    // status PO -> received
    await conn.query(
      `UPDATE purchase_orders SET status='received', received_at=NOW(), updated_at=NOW() WHERE id=?`,
      [po.id]
    );

    await conn.commit();

    res.json({
      status: true,
      message: 'Barang diterima, selisih (jika ada) tercatat, stok terupdate',
      grn_id: grnId
    });

    // notifikasi pasca-commit
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
        WHERE po.id=?`,
      [id]
    );
    if (!po) return res.status(404).json({ status:false, message:'Not found' });

    // supplier hanya boleh akses PO miliknya
    if (req.user.role === 'supplier') {
      const [[usr]] = await pool.query(`SELECT supplier_id FROM users WHERE id=?`, [req.user.id]);
      if (usr?.supplier_id !== po.supplier_id) {
        return res.status(403).json({ status:false, message:'Forbidden' });
      }
    }

    const [items] = await pool.query(
      `SELECT
          poi.id,
          poi.product_id,
          p.name AS product_name,
          poi.qty_pack,
          poi.price_per_pack,
          p.pack_size,
          p.unit_name,
          poi.supplier_decision,
          poi.supplier_note,
          poi.supplier_price_per_pack
       FROM purchase_order_items poi
       JOIN products p ON p.id=poi.product_id
       WHERE poi.purchase_order_id=?`,
      [id]
    );

    res.json({ status:true, po, items });
  } catch (e) { next(e); }
};


export const supplierDecideItems = async (req, res, next) => {
  const poId = Number(req.params.id);
  const { items = [] } = req.body; 
  // items: [{ item_id, decision: 'send'|'nosend', note?: string }]

  if (!poId) return res.status(400).json({ status:false, message:'PO id invalid' });
  if (!Array.isArray(items) || !items.length) {
    return res.status(400).json({ status:false, message:'items kosong' });
  }

  const conn = await pool.getConnection();
  try {
    await conn.beginTransaction();

    // validasi user adalah supplier pemilik PO
    const [[usr]] = await conn.query(`SELECT supplier_id FROM users WHERE id=?`, [req.user.id]);
    if (!usr?.supplier_id) throw new Error('Akun supplier tidak terhubung ke supplier');

    const [[po]] = await conn.query(
      `SELECT supplier_id, status FROM purchase_orders WHERE id=? FOR UPDATE`,
      [poId]
    );
    if (!po) return res.status(404).json({ status:false, message:'PO tidak ditemukan' });
    if (po.supplier_id !== usr.supplier_id) return res.status(403).json({ status:false, message:'Forbidden' });
    if (!['draft','sent','confirmed'].includes(po.status)) {
      return res.status(400).json({ status:false, message:'PO tidak dapat diputuskan pada status ini' });
    }

    // update setiap item
    for (const it of items) {
      const itemId = Number(it.item_id);
      const decision = String(it.decision || '').toLowerCase();
      const note = (it.note || '').trim();

      if (!itemId || !['send','nosend'].includes(decision)) {
        await conn.rollback();
        return res.status(400).json({ status:false, message:'Data item tidak valid' });
      }

      const [r] = await conn.query(
        `UPDATE purchase_order_items
         SET supplier_decision=?, supplier_note=?, supplier_decided_at=NOW()
         WHERE id=? AND purchase_order_id=?`,
        [decision, note || null, itemId, poId]
      );
      if (!r.affectedRows) {
        await conn.rollback();
        return res.status(400).json({ status:false, message:`Item ${itemId} tidak ditemukan` });
      }
    }

    // opsional: jika semua sudah diputuskan dan minimal ada yg 'send', otomatis set PO -> 'confirmed'
    const [[agg]] = await conn.query(
      `SELECT 
          SUM(supplier_decision='send') AS send_count,
          SUM(supplier_decision='pending') AS pending_count
       FROM purchase_order_items WHERE purchase_order_id=?`,
      [poId]
    );
    if (agg?.pending_count === 0 && po.status !== 'received') {
      await conn.query(
        `UPDATE purchase_orders SET status='confirmed', updated_at=NOW() WHERE id=?`,
        [poId]
      );
    }

    await conn.commit();
    res.json({ status:true, message:'Keputusan item tersimpan' });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    next(e);
  } finally { conn.release(); }
};


export const supplierConfirmPO = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const id = Number(req.params.id);
    const { decisions = [] } = req.body || {};

    await conn.beginTransaction();

    // --- Validasi user & lock PO
    const [[usr]] = await conn.query(
      `SELECT supplier_id FROM users WHERE id=?`,
      [req.user.id]
    );
    if (!usr?.supplier_id) {
      await conn.rollback();
      return res.status(400).json({ status:false, message:'Akun supplier belum terhubung ke organisasi supplier' });
    }

    const [[po]] = await conn.query(
      `SELECT id, supplier_id, status FROM purchase_orders WHERE id=? FOR UPDATE`,
      [id]
    );
    if (!po) { await conn.rollback(); return res.status(404).json({ status:false, message:'Not found' }); }
    if (po.supplier_id !== usr.supplier_id) { await conn.rollback(); return res.status(403).json({ status:false, message:'Forbidden' }); }
    if (!['draft','sent'].includes(po.status)) {
      await conn.rollback();
      return res.status(400).json({ status:false, message:'PO tidak bisa dikonfirmasi pada status saat ini' });
    }

    // --- Ambil semua item PO (beserta keputusan yg sudah ada)
    const [poiRows] = await conn.query(
      `SELECT id, supplier_decision, supplier_note, supplier_price_per_pack
         FROM purchase_order_items
        WHERE purchase_order_id=?`,
      [id]
    );
    const byId = new Map(poiRows.map(r => [Number(r.id), {
      id: Number(r.id),
      supplier_decision: r.supplier_decision || 'pending',
      supplier_note: r.supplier_note || '',
      supplier_price_per_pack: r.supplier_price_per_pack != null ? Number(r.supplier_price_per_pack) : null,
    }]));

    if (byId.size === 0) {
      await conn.rollback();
      return res.status(400).json({ status:false, message:'PO tidak memiliki item' });
    }

    // --- Patch keputusan dari payload (kalau ada)
    const norm = (Array.isArray(decisions) ? decisions : []).map(d => {
      const itemId = Number(d.purchase_item_id ?? d.item_id);
      let dec = String(d.decision || '').toLowerCase();
      if (!['send','nosend','pending'].includes(dec)) dec = 'pending';
      const note = d.note ? String(d.note) : '';
      const price = d.supplier_price_per_pack != null ? Number(d.supplier_price_per_pack) : null;
      return { item_id: itemId, decision: dec, note, supplier_price_per_pack: price };
    });

    for (const d of norm) {
      const cur = byId.get(d.item_id);
      if (!cur) continue; // item id tidak valid -> diabaikan
      // apply patch ke state "akhir" yang akan divalidasi
      cur.supplier_decision = d.decision ?? cur.supplier_decision;
      cur.supplier_note = d.note ?? cur.supplier_note;
      // untuk nosend, harga harus null
      if (cur.supplier_decision === 'nosend') {
        cur.supplier_price_per_pack = null;
      } else if (cur.supplier_decision === 'send') {
        // jika ada price di payload, pakai; kalau null, biarkan existing (nanti tervalidasi)
        if (d.supplier_price_per_pack != null) {
          cur.supplier_price_per_pack = Number(d.supplier_price_per_pack);
        }
      }
    }

    // --- Validasi final: semua item harus decided (≠ pending),
    //     item 'send' harus punya harga > 0
    for (const cur of byId.values()) {
      const dec = String(cur.supplier_decision || 'pending').toLowerCase();
      if (dec === 'pending') {
        await conn.rollback();
        return res.status(400).json({
          status:false,
          message:'Semua item harus diputuskan (tidak boleh pending)'
        });
      }
      if (dec === 'send') {
        if (!(Number(cur.supplier_price_per_pack) > 0)) {
          await conn.rollback();
          return res.status(400).json({
            status:false,
            message:'Harga modal per pack wajib diisi (>0) untuk item yang dikirim'
          });
        }
      } else {
        // nosend => pastikan harga null
        cur.supplier_price_per_pack = null;
      }
    }

    // --- Simpan perubahan item (hanya yang berubah)
    const toUpdate = [];
    for (const cur of byId.values()) {
      const orig = poiRows.find(r => Number(r.id) === cur.id);
      const changed =
        (String(orig.supplier_decision || 'pending') !== String(cur.supplier_decision)) ||
        (String(orig.supplier_note || '') !== String(cur.supplier_note || '')) ||
        (
          (orig.supplier_price_per_pack != null ? Number(orig.supplier_price_per_pack) : null)
          !== (cur.supplier_price_per_pack != null ? Number(cur.supplier_price_per_pack) : null)
        );
      if (changed) toUpdate.push(cur);
    }

    for (const u of toUpdate) {
      await conn.query(
        `UPDATE purchase_order_items
            SET supplier_decision=?,
                supplier_note=?,
                supplier_price_per_pack=?
          WHERE id=?`,
        [u.supplier_decision, u.supplier_note, u.supplier_price_per_pack, u.id]
      );
    }

    // --- Update status PO -> confirmed + timestamp
    await conn.query(
      `UPDATE purchase_orders 
          SET status='confirmed', confirmed_at=NOW(), updated_at=NOW()
        WHERE id=?`,
      [id]
    );

    await conn.commit();
    res.json({
      status:true,
      message:'PO dikonfirmasi & keputusan tersimpan',
      updated_items: toUpdate.length
    });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    next(e);
  } finally {
    conn.release();
  }
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


export const getPurchaseReceiveDetail = async (req, res, next) => {
  try {
    const poId = Number(req.params.id);
    if (!poId) return res.status(400).json({ status: false, message: 'id invalid' });

    // Header PO
    const [[purchase]] = await pool.query(
      `SELECT 
         po.id, po.code, po.status, po.created_at,
         s.name AS supplier_name
       FROM purchase_orders po
       JOIN suppliers s ON s.id = po.supplier_id
       WHERE po.id = ?`,
      [poId]
    );
    if (!purchase) return res.status(404).json({ status: false, message: 'PO tidak ditemukan' });

    // GRN header
    const [grns] = await pool.query(
      `SELECT 
         gr.id,
         gr.received_at,
         gr.note,
         u.name AS received_by_name
       FROM grn_receipts gr
       JOIN users u ON u.id = gr.received_by
       WHERE gr.purchase_order_id = ?
       ORDER BY gr.received_at ASC, gr.id ASC`,
      [poId]
    );

    // GRN items
    const [grnItems] = await pool.query(
      `SELECT
         gr.id AS grn_receipt_id,
         p.id AS product_id,
         p.name AS product_name,
         p.pack_size,
         gri.qty_pack,
         (gri.qty_pack * p.pack_size) AS qty_units
       FROM grn_receipt_items gri
       JOIN grn_receipts gr ON gr.id = gri.grn_receipt_id
       JOIN products p ON p.id = gri.product_id
       WHERE gr.purchase_order_id = ?
       ORDER BY gr.received_at ASC, gri.id ASC`,
      [poId]
    );

    // Ringkasan per purchase item (+ alasan selisih dari supplier_returns)
    const [receivedSummary] = await pool.query(
      `WITH recv AS (
         SELECT
           poi.id AS purchase_item_id,
           poi.product_id,
           COALESCE(SUM(gri.qty_pack), 0) AS received_qty_pack
         FROM purchase_order_items poi
         LEFT JOIN grn_receipts gr
           ON gr.purchase_order_id = poi.purchase_order_id
         LEFT JOIN grn_receipt_items gri
           ON gri.grn_receipt_id = gr.id
          AND gri.product_id = poi.product_id
         WHERE poi.purchase_order_id = ?
         GROUP BY poi.id, poi.product_id
       )
       SELECT
         poi.id AS purchase_item_id,
         poi.product_id,
         p.name AS product_name,
         p.pack_size,
         poi.qty_pack AS ordered_qty_pack,
         r.received_qty_pack,
         (poi.qty_pack - r.received_qty_pack) AS remaining_qty_pack,
         poi.supplier_price_per_pack,
         poi.supplier_decision,
         poi.supplier_note,
         (r.received_qty_pack * COALESCE(poi.supplier_price_per_pack,0)) AS received_cost,
         (
           SELECT sr.reason
           FROM supplier_returns sr
           WHERE sr.purchase_order_id = ?
             AND sr.product_id = poi.product_id
           ORDER BY sr.created_at DESC, sr.id DESC
           LIMIT 1
         ) AS admin_return_reason
       FROM purchase_order_items poi
       JOIN products p ON p.id = poi.product_id
       JOIN recv r ON r.purchase_item_id = poi.id
       WHERE poi.purchase_order_id = ?
       ORDER BY poi.id ASC`,
      [poId, poId, poId] // <-- tambahkan poId untuk subquery supplier_returns
    );

    // Grupkan items per-GRN
    const itemMap = new Map();
    for (const it of grnItems) {
      const arr = itemMap.get(it.grn_receipt_id) || [];
      arr.push({
        product_id: it.product_id,
        product_name: it.product_name,
        pack_size: Number(it.pack_size),
        qty_pack: Number(it.qty_pack),
        qty_units: Number(it.qty_units)
      });
      itemMap.set(it.grn_receipt_id, arr);
    }

    const grnWithItems = grns.map(g => ({
      id: g.id,
      received_at: g.received_at,
      received_by_name: g.received_by_name,
      note: g.note,
      items: itemMap.get(g.id) || []
    }));

    res.json({
      status: true,
      purchase,
      grns: grnWithItems,
      summary_items: receivedSummary.map(r => ({
        purchase_item_id: r.purchase_item_id,
        product_id: r.product_id,
        product_name: r.product_name,
        pack_size: Number(r.pack_size),
        ordered_qty_pack: Number(r.ordered_qty_pack),
        received_qty_pack: Number(r.received_qty_pack),
        remaining_qty_pack: Math.max(0, Number(r.remaining_qty_pack)),
        supplier_price_per_pack: r.supplier_price_per_pack != null ? Number(r.supplier_price_per_pack) : null,
        supplier_decision: r.supplier_decision || 'pending',
        supplier_note: r.supplier_note || '',
        received_cost: Number(r.received_cost || 0),
        admin_return_reason: r.admin_return_reason || '' // <-- alasan selisih pack
      }))
    });
  } catch (e) { next(e); }
};





