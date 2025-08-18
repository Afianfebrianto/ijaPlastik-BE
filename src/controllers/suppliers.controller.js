// src/controllers/suppliers.controller.js
import { pool } from '../db.js';

/**
 * GET /suppliers?search=nama
 * - tanpa query: list semua (limit 50)
 * - dengan ?search= : cari by nama (LIKE)
 */
export const listSuppliers = async (req, res, next) => {
  try {
    const search = (req.query.search || '').trim();
    let rows;
    if (search) {
      const [r] = await pool.query(
        `SELECT id, name, phone, email, address, pic_name
         FROM suppliers
         WHERE name LIKE ?
         ORDER BY name ASC
         LIMIT 50`,
        [`%${search}%`]
      );
      rows = r;
    } else {
      const [r] = await pool.query(
        `SELECT id, name, phone, email, address, pic_name
         FROM suppliers
         ORDER BY created_at DESC
         LIMIT 50`
      );
      rows = r;
    }
    res.json({ status: true, data: rows });
  } catch (e) { next(e); }
};

/**
 * GET /suppliers/:id
 */
export const getSupplier = async (req, res, next) => {
  try {
    const [r] = await pool.query(
      `SELECT id, name, phone, email, address, pic_name
       FROM suppliers WHERE id=?`,
      [req.params.id]
    );
    if (!r.length) return res.status(404).json({ status:false, message:'Not found' });
    res.json({ status:true, data: r[0] });
  } catch (e) { next(e); }
};

/**
 * POST /suppliers  (admin only)
 * body: { name, phone, email, address, pic_name }
 */
export const createSupplier = async (req, res, next) => {
  try {
    const { name, phone, email, address, pic_name } = req.body;
    if (!name) return res.status(400).json({ status:false, message:'Name is required' });
    const [ins] = await pool.query(
      `INSERT INTO suppliers (name, phone, email, address, pic_name)
       VALUES (?,?,?,?,?)`,
      [name, phone || null, email || null, address || null, pic_name || null]
    );
    res.status(201).json({ status:true, id: ins.insertId, message:'Supplier created' });
  } catch (e) { next(e); }
};

/**
 * PUT /suppliers/:id (admin only)
 */
export const updateSupplier = async (req, res, next) => {
  try {
    const { name, phone, email, address, pic_name } = req.body;
    const fields = [], vals = [];
    const add = (f,v)=>{ fields.push(f); vals.push(v); };
    if (name!==undefined) add('name=?', name);
    if (phone!==undefined) add('phone=?', phone);
    if (email!==undefined) add('email=?', email);
    if (address!==undefined) add('address=?', address);
    if (pic_name!==undefined) add('pic_name=?', pic_name);
    if (!fields.length) return res.json({ status:true, message:'No changes' });
    vals.push(req.params.id);

    const [r] = await pool.query(`UPDATE suppliers SET ${fields.join(', ')} WHERE id=?`, vals);
    res.json({ status:true, affectedRows: r.affectedRows });
  } catch (e) { next(e); }
};

/**
 * DELETE /suppliers/:id (admin only)
 */
export const deleteSupplier = async (req, res, next) => {
  try {
    const [r] = await pool.query(`DELETE FROM suppliers WHERE id=?`, [req.params.id]);
    res.json({ status:true, affectedRows: r.affectedRows });
  } catch (e) { next(e); }
};
