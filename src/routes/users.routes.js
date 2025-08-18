
import { Router } from 'express';
import { verify } from '../middlewares/auth.js';
import { checkRole } from '../middlewares/role.js';
import {
  listUsers, createUser, updateUser, softDeleteUser, resetUserPassword
} from '../controllers/users.controller.js';

const r = Router();
r.get('/', verify, checkRole('admin'), listUsers);
r.post('/', verify, checkRole('admin'), createUser);
r.put('/:id', verify, checkRole('admin'), updateUser);
r.delete('/:id', verify, checkRole('admin'), softDeleteUser);
r.post('/:id/reset-password', verify, checkRole('admin'), resetUserPassword);

export default r;
