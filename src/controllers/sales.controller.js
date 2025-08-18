
import { pool } from '../db.js';
import { saleToHTML } from '../utils/receipt.js';
import { notifyAdminsStockStatus } from '../services/stockAlert.service.js';

// async function alertIfThresholdBreach(conn, productId) {
//   const [[p]] = await conn.query(
//     `SELECT id, name, stock_units, min_stock_units, max_stock_units FROM products WHERE id=?`, [productId]
//   );
//   if (!p) return;
//   const low = p.stock_units < (p.min_stock_units ?? 0);
//   const over = p.stock_units > (p.max_stock_units ?? 999999999);
//   if (low || over) {
//     await conn.query(
//       `INSERT INTO notifications (title, message, status) VALUES (?,?, 'queued')`,
//       [
//         low ? 'Stok Menipis' : 'Stok Melebihi Batas',
//         `${p.name} sekarang ${p.stock_units} unit (min ${p.min_stock_units || 0}, max ${p.max_stock_units || '-'})`
//       ]
//     );
//   }
// }

const badReq = (msg) => { const e = new Error(msg); e.statusCode = 400; return e; };

export const createSale = async (req, res, next) => {
  const { items = [], payment_method, customer_name, cash_received } = req.body;

  try {
    if (!Array.isArray(items) || !items.length) throw badReq('Items tidak boleh kosong');
    for (const it of items) {
      if (!it?.product_id) throw badReq('product_id wajib');
      if (!['unit','pack'].includes(it.item_type)) throw badReq('item_type harus unit/pack');
      if (!Number.isFinite(Number(it.qty)) || Number(it.qty) <= 0) throw badReq('qty harus > 0');
    }
  } catch (e) { return next(e); }

  const conn = await pool.getConnection();
  const changedIds = new Set();

  try {
    await conn.beginTransaction();

    // Hitung harga
    let subtotal = 0;
    const priced = [];
    for (const it of items) {
      const [[prod]] = await conn.query(
        `SELECT id, name, pack_size, wholesale_price_per_pack, retail_price_per_unit
         FROM products WHERE id=? FOR UPDATE`,
        [it.product_id]
      );
      if (!prod) throw badReq(`Produk id ${it.product_id} tidak ditemukan`);
      const price = it.item_type === 'pack' ? Number(prod.wholesale_price_per_pack) : Number(prod.retail_price_per_unit);
      const qty = Number(it.qty);
      const line_total = price * qty;
      subtotal += line_total;
      priced.push({ product_id: prod.id, name: prod.name, pack_size: Number(prod.pack_size), item_type: it.item_type, qty, price, line_total });
    }

    const total = subtotal;
    const payMethod = (payment_method || 'cash').toLowerCase();
    if (!['cash','qris','card'].includes(payMethod)) throw badReq('payment_method tidak valid');

    let cashReceived = null, changeAmount = 0;
    if (payMethod === 'cash') {
      if (cash_received == null || !Number.isFinite(Number(cash_received))) throw badReq('cash_received wajib untuk cash');
      cashReceived = Number(cash_received);
      if (cashReceived < total) throw badReq('Uang kurang dari total belanja');
      changeAmount = cashReceived - total;
    }

    const ymd = new Date().toISOString().slice(0,10).replace(/-/g,'');
    const rnd = Math.floor(Math.random()*9000+1000);
    const receiptNo = `STRK-${ymd}-${rnd}`;

    const [saleRes] = await conn.query(
      `INSERT INTO sales (receipt_no, cashier_id, subtotal, total, payment_method, customer_name, cash_received, change_amount)
       VALUES (?,?,?,?,?,?,?,?)`,
      [receiptNo, req.user?.id || null, subtotal, total, payMethod, customer_name || null, cashReceived, changeAmount]
    );
    const saleId = saleRes.insertId;

    // Kurangi stok + catat item & movement
    for (const it of priced) {
      const units = it.item_type === 'pack' ? it.qty * it.pack_size : it.qty;

      const [[cur]] = await conn.query(`SELECT stock_units FROM products WHERE id=? FOR UPDATE`, [it.product_id]);
      const current = Number(cur?.stock_units ?? 0);
      if (current - units < 0) throw badReq(`Stok tidak cukup untuk ${it.name}`);

      await conn.query(`UPDATE products SET stock_units = stock_units - ? WHERE id=?`, [units, it.product_id]);
      changedIds.add(it.product_id);

      await conn.query(
        `INSERT INTO sale_items (sale_id, product_id, item_type, qty, price, line_total)
         VALUES (?,?,?,?,?,?)`,
        [saleId, it.product_id, it.item_type, it.qty, it.price, it.line_total]
      );
      await conn.query(
        `INSERT INTO stock_movements (product_id, movement_type, source, ref_table, ref_id, qty_units, note)
         VALUES (?,?,?,?,?,?,?)`,
        [it.product_id, 'out', 'sale', 'sales', saleId, units, 'Sale']
      );
    }

    await conn.commit();

    res.status(201).json({
      status:true, id: saleId, receipt_no: receiptNo,
      subtotal, total, payment_method: payMethod, cash_received: cashReceived, change_amount: changeAmount
    });

    // === TRIGGER NOTIF WA (tanpa cooldown) ===
    for (const pid of changedIds) {
      try { await notifyAdminsStockStatus(pid); } catch (e) { console.error('WA stok error:', e.message); }
    }

  } catch (e) {
    try { await conn.rollback(); } catch {}
    if (e?.statusCode) return res.status(e.statusCode).json({ status:false, message:e.message });
    next(e);
  } finally { conn.release(); }
};

export const getSale = async (req, res, next) => {
  try {
    const [sales] = await pool.query(`SELECT * FROM sales WHERE id=?`, [req.params.id]);
    if (!sales.length) return res.status(404).json({ status:false, message:'Not found' });
    const sale = sales[0];
    const [items] = await pool.query(
      `SELECT si.*, p.name FROM sale_items si JOIN products p ON p.id=si.product_id WHERE si.sale_id=?`,
      [req.params.id]
    );
    res.json({ status:true, sale, items });
  } catch (e) { next(e); }
};

export const getSaleReceipt = async (req, res, next) => {
  try {
    // Ambil header sales (tanpa pajak)
    const [[sale]] = await pool.query(
      `SELECT s.id, s.receipt_no, s.created_at, s.payment_method,
              s.subtotal, s.total, s.cash_received, s.change_amount,
              u.name AS cashier_name
       FROM sales s
       JOIN users u ON u.id = s.cashier_id
       WHERE s.id = ?`,
      [req.params.id]
    );
    if (!sale) return res.status(404).send('Not found');

    // Ambil item-item
    const [items] = await pool.query(
      `SELECT si.item_type, si.qty, si.price, si.line_total,
              p.name AS product_name
       FROM sale_items si
       JOIN products p ON p.id = si.product_id
       WHERE si.sale_id = ?`,
      [req.params.id]
    );

    const html = saleToHTML(sale, items);
    res.setHeader('Content-Type', 'text/html; charset=utf-8');
    res.send(html);
  } catch (e) { next(e); }
};
