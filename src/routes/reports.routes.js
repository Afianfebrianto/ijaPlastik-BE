// src/routes/reports.routes.js
import { Router } from 'express';
import { verify } from '../middlewares/auth.js';
import { checkRole } from '../middlewares/role.js';
import { listCashiers, cashierReport, cashierReportCsv } from '../controllers/reports.controller.js';

const r = Router();

// admin only
r.get('/cashiers', verify, checkRole('admin'), listCashiers);
r.get('/cashier', verify, checkRole('admin'), cashierReport);
r.get('/cashier.csv', verify, checkRole('admin'), cashierReportCsv);

export default r;
