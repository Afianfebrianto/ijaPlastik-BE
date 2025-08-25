// src/utils/waGateway.js
import 'dotenv/config';
import axios from 'axios';

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

// Normalisasi nomor: buang non-digit, ganti 0 depan -> 62
export function normalizePhoneTo62(raw) {
  if (!raw) return null;
  const digits = String(raw).replace(/\D/g, '');
  if (!digits) return null;
  if (digits.startsWith('62')) return digits;
  if (digits.startsWith('0')) return '62' + digits.slice(1);
  return digits; // fallback: anggap sudah internasional
}

/**
 * Kirim WA ke supplier saat PO dibuat.
 * @param {string} targetPhone  - nomor WA (62xxxxxxxxxx)
 * @param {string} supplierName - nama supplier (untuk {name})
 * @param {string} poCode       - kode PO (mis: PO-20250825-123)
 * @param {Array<{name:string, qty_pack:number, price_per_pack:number}>} items - ringkasan item
 * @param {string|null} note     - catatan PO
 */
export async function sendPONotification(targetPhone, supplierName, poCode, items = [], note = null) {
  if (!FONNTE_TOKEN) throw new Error('FONNTE_TOKEN belum diset di .env');
  const phone = normalizePhoneTo62(targetPhone);
  if (!phone) throw new Error('Nomor WA supplier tidak valid/kosong');

  // Susun ringkasan item (maks 8 baris agar tidak kepanjangan)
  const lines = items.slice(0, 8).map(it =>
    `• ${it.name} — ${Number(it.qty_pack).toLocaleString()} pack @ ${Number(it.price_per_pack).toLocaleString()}`
  );
  const more = items.length > 8 ? `\n…dan ${items.length - 8} item lainnya` : '';

  const message =
`Halo {name},
Pesanan pembelian *${poCode}* Dari Toko Ija Plastik telah dibuat.

Rincian singkat:
${lines.join('\n')}${more}

Catatan: ${note || '-'}

Mohon konfirmasi di sistem atau balas pesan ini.
Terima kasih.`;

  // Fonnte multi-variant pakai {name}, var1..var5 (opsional).
  // Di sini cukup pakai {name}.
  const payload = new URLSearchParams({
    target: `${phone}|${supplierName}`,
    message,
    delay: 2,
    countryCode: '62'
  });

  const res = await axios.post('https://api.fonnte.com/send', payload, {
    headers: {
      Authorization: FONNTE_TOKEN,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    timeout: 15000
  });

  return res.data;
}
