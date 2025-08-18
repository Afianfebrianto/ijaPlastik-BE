// src/routes/suppliers.routes.js
import { Router } from 'express';
import { verify } from '../middlewares/auth.js';
import { checkRole } from '../middlewares/role.js';
import {
  listSuppliers, getSupplier,
  createSupplier, updateSupplier, deleteSupplier
} from '../controllers/suppliers.controller.js';

const r = Router();

/** Semua role boleh lihat/list (buat pencarian by name untuk Create PO) */
r.get('/', verify, listSuppliers);
r.get('/:id', verify, getSupplier);

/** Hanya admin yang boleh create/update/delete supplier */
r.post('/', verify, checkRole('admin'), createSupplier);
r.put('/:id', verify, checkRole('admin'), updateSupplier);
r.delete('/:id', verify, checkRole('admin'), deleteSupplier);

export default r;
