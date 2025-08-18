// src/utils/stockAlerts.js
import { pool } from '../db.js';
import { sendStokWarning } from './waGateway.js';

/**
 * Ambil admin yang berhak menerima alert (view: vw_admin_wa_targets)
 */
async function getAdminTargets() {
  const [rows] = await pool.query(`SELECT name, phone FROM vw_admin_wa_targets`);
  // filter phone kosong/null
  return rows.filter(r => !!r.phone);
}

/**
 * Kirim WA alert untuk 1 produk dengan kondisi tertentu
 * @param {{id:number,name:string,stock_units:number,min_stock_units:number,max_stock_units:number}} prod
 */
export async function notifyAdminsStockStatus(prod) {
  const admins = await getAdminTargets();
  if (!admins.length) return { sent: 0, note: 'No admin WA targets' };

  const kondisi =
    prod.stock_units < (prod.min_stock_units ?? 0)
      ? 'STOK MENIPIS'
      : prod.stock_units > (prod.max_stock_units ?? 999999999)
      ? 'STOK MELEBIHI BATAS'
      : null;

  if (!kondisi) return { sent: 0, note: 'Tidak melanggar threshold' };

  let sent = 0;
  for (const a of admins) {
    const resp = await sendStokWarning(a.phone, a.name, kondisi, prod.name, prod.stock_units);
    if (!resp?.error) sent++;
  }
  return { sent, kondisi };
}
