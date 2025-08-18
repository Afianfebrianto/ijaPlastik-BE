// src/utils/waGateway.js
import 'dotenv/config';
import axios from 'axios';

const FONNTE_TOKEN = process.env.FONNTE_TOKEN;

/**
 * Kirim peringatan stok via Fonnte
 * @param {string} targetPhone  - nomor WA (62xxxxxxxxxx)
 * @param {string} displayName  - nama penerima (untuk {name})
 * @param {string} kondisi      - teks status utk {var1} (mis: "STOK MENIPIS" / "STOK MELEBIHI BATAS")
 * @param {string} barangNama   - nama barang
 * @param {number} stok         - jumlah stok sekarang
 * @returns {Promise<any>}
 */
export async function sendStokWarning(targetPhone, displayName, kondisi, barangNama, stok) {
  try {
    const targetString = `${targetPhone}|${displayName}|${kondisi}`;
    const message = `Halo {name}, stok barang *${barangNama}* saat ini adalah *${stok}*. Status: *{var1}*`;

    const res = await axios.post(
      'https://api.fonnte.com/send',
      new URLSearchParams({
        target: targetString,
        message: message,
        delay: 2,
        countryCode: '62'
      }),
      {
        headers: {
          Authorization: FONNTE_TOKEN,
          'Content-Type': 'application/x-www-form-urlencoded'
        },
        timeout: 15000
      }
    );

    return res.data;
  } catch (err) {
    console.error('Gagal kirim WA:', err?.response?.data || err.message);
    return { error: err.message };
  }
}
