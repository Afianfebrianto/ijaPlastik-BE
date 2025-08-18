export const saleToHTML = (sale, items) => {
  const fmt = (n) => Number(n || 0).toLocaleString('id-ID');
  const dateStr = new Date(sale.created_at).toLocaleString('id-ID');
  const storeName = process.env.STORE_NAME || 'TOKO IJA PLASTIK';

  const cashBlock = sale.payment_method === 'cash'
    ? `
      <tr><td>Tunai</td><td class="val">${fmt(sale.cash_received)}</td></tr>
      <tr><td>Kembalian</td><td class="val">${fmt(sale.change_amount)}</td></tr>
    `
    : '';

  // Baris item
  const rows = items.map(it => {
    const labelType = it.item_type === 'pack' ? '(pack)' : '(unit)';
    return `
      <tr class="item">
        <td>
          <div class="name">${it.product_name} ${labelType}</div>
          <div class="meta">${fmt(it.price)} × ${it.qty}</div>
        </td>
        <td class="val">${fmt(it.line_total)}</td>
      </tr>
    `;
  }).join('');

  return `
<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8" />
  <title>${sale.receipt_no}</title>
  <style>
    /* Layout simple 58–80mm */
    body { font-family: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, "Liberation Mono", "Courier New", monospace; margin: 0; padding: 8px; }
    .wrap { width: 280px; }
    .center { text-align: center; }
    .muted { color: #666; font-size: 12px; }
    h3 { margin: 0 0 4px; font-size: 14px; }
    hr { border: 0; border-top: 1px dashed #999; margin: 6px 0; }
    table { width: 100%; border-collapse: collapse; }
    td { vertical-align: top; font-size: 12px; }
    .item td { padding: 2px 0; }
    .name { font-weight: 600; }
    .meta { color: #666; font-size: 11px; }
    .val { text-align: right; white-space: nowrap; }
    .totals td { padding: 2px 0; }
    .grand td { font-weight: 700; font-size: 13px; padding-top: 4px; }
    .footer { margin-top: 8px; text-align: center; font-size: 12px; }
    @media print {
      body { margin: 0; }
      .wrap { width: auto; }
    }
  </style>
</head>
<body>
  <div class="wrap">
    <div class="center">
      <h3>${storeName}</h3>
      <div class="muted">Receipt: ${sale.receipt_no}</div>
      <div class="muted">${dateStr}</div>
      <div class="muted">Kasir: ${sale.cashier_name || '-'}</div>
      <div class="muted">Metode: ${String(sale.payment_method || '').toUpperCase()}</div>
    </div>

    <hr/>

    <table>
      <tbody>
        ${rows || `<tr><td class="muted">Tidak ada item</td><td></td></tr>`}
      </tbody>
    </table>

    <hr/>

    <table class="totals">
      <tbody>
        <tr><td>Subtotal</td><td class="val">${fmt(sale.subtotal)}</td></tr>
        <tr class="grand"><td>Total</td><td class="val">${fmt(sale.total)}</td></tr>
        ${cashBlock}
      </tbody>
    </table>

    <div class="footer">Terima kasih 🙏</div>
  </div>
</body>
</html>
  `;
};