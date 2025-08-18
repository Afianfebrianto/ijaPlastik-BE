// src/controllers/users.controller.js
import { pool } from '../db.js';
import bcrypt from 'bcrypt';

const DEFAULT_PASSWORD = process.env.DEFAULT_USER_PASSWORD || '123456789';

const badReq = (msg) => {
  const err = new Error(msg);
  err.statusCode = 400;
  return err;
};

export const listUsers = async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    const role = (req.query.role || '').trim(); // admin|cashier|supplier
    const where = ['u.is_active=1'];
    const args = [];
    if (search) {
      where.push('(u.name LIKE ? OR u.email LIKE ?)');
      args.push(`%${search}%`, `%${search}%`);
    }
    if (role) {
      where.push('r.name=?');
      args.push(role);
    }

    const [rows] = await pool.query(
      `SELECT u.id, u.name, u.email, u.phone, u.is_active, u.supplier_id,
              r.name AS role,
              s.name AS supplier_name
       FROM users u
       JOIN roles r ON r.id = u.role_id
       LEFT JOIN suppliers s ON s.id = u.supplier_id
       ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
       ORDER BY u.created_at DESC
       LIMIT 200`
      , args
    );
    res.json({ status:true, data: rows });
  } catch (e) { next(e); }
};

export const createUser = async (req, res, next) => {
  const conn = await pool.getConnection();
  try {
    const { name, email, phone, role, supplier_id, password, supplier_new } = req.body;
    if (!name) throw badReq('name wajib');
    if (!email) throw badReq('email wajib');
    if (!role) throw badReq('role wajib (admin|cashier|supplier)');

    await conn.beginTransaction();

    const [[exist]] = await conn.query(`SELECT id FROM users WHERE email=?`, [email]);
    if (exist) throw badReq('email sudah terpakai');

    const [[roleRow]] = await conn.query(`SELECT id FROM roles WHERE name=?`, [role]);
    if (!roleRow) throw badReq('role tidak valid');

    // tentukan supplierId jika role=supplier
    let supplierId = null;
    if (role === 'supplier') {
      if (supplier_new && supplier_new.name) {
        // buat supplier baru dulu
        const { name: sName, phone: sPhone, email: sEmail, address, pic_name } = supplier_new;
        const [insSup] = await conn.query(
          `INSERT INTO suppliers (name, phone, email, address, pic_name, created_at)
           VALUES (?,?,?,?,?,NOW())`,
          [sName, sPhone || null, sEmail || null, address || null, pic_name || null]
        );
        supplierId = insSup.insertId;
      } else if (supplier_id) {
        // pakai supplier yang sudah ada
        const [[sup]] = await conn.query(`SELECT id FROM suppliers WHERE id=?`, [supplier_id]);
        if (!sup) throw badReq('supplier tidak ditemukan');
        supplierId = supplier_id;
      } else {
        throw badReq('supplier_id atau supplier_new wajib untuk role supplier');
      }
    }

    const hash = await bcrypt.hash(password || DEFAULT_PASSWORD, 10);

    const [insUser] = await conn.query(
      `INSERT INTO users (name, email, phone, role_id, supplier_id, password_hash, is_active, created_at)
       VALUES (?,?,?,?,?,?,1,NOW())`,
      [name, email, phone || null, roleRow.id, supplierId, hash]
    );

    await conn.commit();
    res.status(201).json({ status:true, message:'user created', id: insUser.insertId, supplier_id: supplierId });
  } catch (e) {
    try { await conn.rollback(); } catch {}
    next(e);
  } finally { conn.release(); }
};


export const updateUser = async (req, res, next) => {
  try {
    const { name, phone, role, supplier_id } = req.body;
    const fields = [];
    const vals = [];

    if (name !== undefined) { fields.push('name=?'); vals.push(name); }
    if (phone !== undefined) { fields.push('phone=?'); vals.push(phone); }

    if (role !== undefined) {
      const [[roleRow]] = await pool.query(`SELECT id FROM roles WHERE name=?`, [role]);
      if (!roleRow) throw badReq('role tidak valid');
      fields.push('role_id=?'); vals.push(roleRow.id);

      if (role === 'supplier') {
        if (!supplier_id) throw badReq('supplier_id wajib untuk role supplier');
        const [[sup]] = await pool.query(`SELECT id FROM suppliers WHERE id=?`, [supplier_id]);
        if (!sup) throw badReq('supplier tidak ditemukan');
        fields.push('supplier_id=?'); vals.push(supplier_id);
      } else {
        fields.push('supplier_id=?'); vals.push(null);
      }
    } else if (supplier_id !== undefined) {
      // mengubah supplier_id tanpa mengubah role — hanya izinkan jika role sekarang supplier
      const [[u]] = await pool.query(
        `SELECT r.name AS role FROM users u JOIN roles r ON r.id=u.role_id WHERE u.id=?`,
        [req.params.id]
      );
      if (u?.role !== 'supplier') throw badReq('supplier_id hanya untuk user role supplier');
      const [[sup]] = await pool.query(`SELECT id FROM suppliers WHERE id=?`, [supplier_id]);
      if (!sup) throw badReq('supplier tidak ditemukan');
      fields.push('supplier_id=?'); vals.push(supplier_id);
    }

    if (!fields.length) return res.json({ status:true, message:'no changes' });

    vals.push(req.params.id);
    const [r] = await pool.query(`UPDATE users SET ${fields.join(', ')}, updated_at=NOW() WHERE id=?`, vals);
    res.json({ status:true, affectedRows: r.affectedRows });
  } catch (e) { next(e); }
};

export const softDeleteUser = async (req, res, next) => {
  try {
    const [r] = await pool.query(
      `UPDATE users SET is_active=0, updated_at=NOW() WHERE id=?`,
      [req.params.id]
    );
    res.json({ status:true, affectedRows: r.affectedRows });
  } catch (e) { next(e); }
};

export const resetUserPassword = async (req, res, next) => {
  try {
    const newPass = req.body?.new_password || DEFAULT_PASSWORD;
    const hash = await bcrypt.hash(newPass, 10);
    const [r] = await pool.query(
      `UPDATE users SET password_hash=?, updated_at=NOW() WHERE id=?`,
      [hash, req.params.id]
    );
    res.json({ status:true, affectedRows: r.affectedRows, message:'password reset' });
  } catch (e) { next(e); }
};
