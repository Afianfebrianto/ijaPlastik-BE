// src/routes/dev.routes.js
import { Router } from 'express';
import { notifyAdminsStockStatus } from '../services/stockAlert.service.js';

const r = Router();
r.post('/test-stock-alert/:productId', async (req, res) => {
  try {
    await notifyAdminsStockStatus(Number(req.params.productId));
    res.json({ ok: true });
  } catch (e) { res.status(500).json({ ok:false, error:e.message }); }
});
export default r;
