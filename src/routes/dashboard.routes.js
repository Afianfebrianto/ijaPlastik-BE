
import { Router } from 'express';
import { verify } from '../middlewares/auth.js';
import { getSummary } from '../controllers/dashboard.controller.js';

const r = Router();
r.get('/summary', verify, getSummary);

export default r;
