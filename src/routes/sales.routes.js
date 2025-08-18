
import { Router } from 'express';
import { verify } from '../middlewares/auth.js';
import { checkRole } from '../middlewares/role.js';
import { createSale, getSale, getSaleReceipt } from '../controllers/sales.controller.js';

const r = Router();
r.post('/', verify, checkRole('cashier','admin'), createSale);
r.get('/:id', verify, getSale);
r.get('/:id/receipt', verify, getSaleReceipt);

export default r;
