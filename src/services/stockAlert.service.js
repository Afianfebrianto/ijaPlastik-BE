import { pool } from '../db.js';
import { sendStokWarning } from '../utils/waGateway.js';

// --- Helpers ---
function normalizePhone(phone) {
  const p = String(phone || '').replace(/[^\d]/g, '');
  if (!p) return null;
  if (p.startsWith('62')) return p;
  if (p.startsWith('0')) return '62' + p.slice(1);
  return '62' + p;
}

async function getAdminRecipients() {
  const [rows] = await pool.query(
    `SELECT u.name, u.phone
     FROM users u
     JOIN roles r ON r.id = u.role_id
     WHERE r.name='admin' AND u.is_active=1 AND COALESCE(u.phone,'') <> ''`
  );
  return rows
    .map(r => ({ name: r.name || 'Admin', phone: normalizePhone(r.phone) }))
    .filter(r => !!r.phone);
}

// Hitung status terkini berdasar stok & ambang
function computeStatus(p) {
  const stock = Number(p.stock_units ?? 0);
  const min = (p.min_stock_units != null) ? Number(p.min_stock_units) : null;
  const max = (p.max_stock_units != null) ? Number(p.max_stock_units) : null;
  if (min != null && stock <= min) return 'LOW';
  if (max != null && stock >= max) return 'OVER';
  return 'NORMAL';
}

/**
 * Kirim notifikasi WA hanya saat STATUS BERUBAH.
 * - Ambil produk (id, name, stock_units, min/max, last_stock_status)
 * - Hitung status baru
 * - Jika sama dengan last_stock_status → STOP (tidak kirim)
 * - Jika berbeda:
 *     - Update last_stock_status (+ timestamp)
 *     - Jika status baru LOW/OVER → kirim WA ke admin
 *     - (NORMAL) default: tidak kirim apa-apa, tapi status tetap disimpan
 *
 * @param {number|object} productOrId
 */
export async function notifyAdminsStockStatus(productOrId) {
  let p;
  if (typeof productOrId === 'number') {
    const [[row]] = await pool.query(
      `SELECT id, name, stock_units, min_stock_units, max_stock_units, last_stock_status
       FROM products WHERE id=?`,
      [productOrId]
    );
    if (!row) return;
    p = row;
  } else {
    p = productOrId;
  }

  const currentStatus = computeStatus(p);
  const prevStatus = p.last_stock_status || 'NORMAL';

  // Jika tidak berubah → selesai
  if (currentStatus === prevStatus) return;

  // Simpan status baru
  await pool.query(
    `UPDATE products
       SET last_stock_status = ?, last_stock_status_changed_at = NOW()
     WHERE id = ?`,
    [currentStatus, p.id]
  );

  // Kirim WA hanya untuk LOW/OVER
  if (currentStatus === 'NORMAL') return;

  const label = currentStatus === 'LOW' ? 'STOK MENIPIS' : 'STOK MELEBIHI BATAS';
  const admins = await getAdminRecipients();
  if (!admins.length) return;

  await Promise.allSettled(
    admins.map(a =>
      sendStokWarning(a.phone, a.name, label, p.name, Number(p.stock_units || 0))
    )
  );
}
