
import { Router } from 'express';
import { login, me } from '../controllers/auth.controller.js';
import { verify } from '../middlewares/auth.js';

const r = Router();
r.post('/login', login);
r.get('/me', verify, me);
export default r;
