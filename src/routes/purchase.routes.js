
import { Router } from 'express';
import { verify } from '../middlewares/auth.js';
import { checkRole } from '../middlewares/role.js';
import { createPO, sendPO, receiveGRN, listMyPOs, getPOById, supplierConfirmPO,  listAllPOs,getPurchaseReceiveDetail, supplierDecideItems, } from '../controllers/purchase.controller.js';

const r = Router();
r.post('/', verify, checkRole('admin'), createPO);
r.post('/:id/send', verify, checkRole('admin'), sendPO);
r.post('/:id/receive', verify, checkRole('admin'), receiveGRN);
r.get('/', verify, checkRole('admin'), listAllPOs);
r.get('/:id/receive-detail', verify, checkRole('admin','supplier'), getPurchaseReceiveDetail);

// SUPPLIER
r.get('/mine', verify, checkRole('supplier'), listMyPOs);
r.get('/:id', verify, getPOById);                    // admin atau supplier pemilik PO
r.post('/:id/confirm', verify, checkRole('supplier'), supplierConfirmPO);
// hanya supplier yang boleh
r.post('/:id/items/decision', verify, checkRole('supplier'), supplierDecideItems);


export default r;
