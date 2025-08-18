
import { pool } from '../db.js';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';

export const login = async (req, res, next) => {
  try {
    const { email, password } = req.body;
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.password_hash, r.name AS role
       FROM users u JOIN roles r ON r.id=u.role_id
       WHERE u.email=? AND u.is_active=1
       LIMIT 1`, [email]
    );
    if (!rows.length) return res.status(401).json({ status:false, message:'Invalid credentials' });
    const user = rows[0];
    const ok = await bcrypt.compare(password, user.password_hash);
    if (!ok) return res.status(401).json({ status:false, message:'Invalid credentials' });

    const token = jwt.sign({ id:user.id, role:user.role, name:user.name }, process.env.JWT_SECRET, { expiresIn:'1d' });
    res.json({ status:true, token, user: { id:user.id, name:user.name, email:user.email, role:user.role } });
  } catch (e) { next(e); }
};

export const me = async (req, res, next) => {
  try {
    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, r.name AS role, u.phone, u.receive_stock_alert
       FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`, [req.user.id]
    );
    res.json({ status:true, user: rows[0] });
  } catch (e) { next(e); }
};
