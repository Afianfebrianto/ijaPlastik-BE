// seedUsers.js
import 'dotenv/config';
import bcrypt from 'bcryptjs';
import { pool } from './src/db.js';

async function seed() {
  try {
    const defaultPassword = '123456789';
    const hash = await bcrypt.hash(defaultPassword, 10);

    // Ambil role IDs
    const [roles] = await pool.query(`SELECT id, name FROM roles`);
    const roleMap = Object.fromEntries(roles.map(r => [r.name, r.id]));

    if (!roleMap.admin || !roleMap.cashier || !roleMap.supplier) {
      throw new Error('Pastikan role admin, cashier, dan supplier sudah ada di tabel roles');
    }

    // Insert Admin
    const [adminRes] = await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, phone, receive_stock_alert, is_active)
       VALUES (?,?,?,?,?,?,?)`,
      ['Seed Admin', 'admin@example.com', hash, roleMap.admin, '628111111111', 1, 1]
    );

    // Insert Kasir (dibuat oleh adminRes.insertId)
    const [cashierRes] = await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, phone, receive_stock_alert, created_by, is_active)
       VALUES (?,?,?,?,?,?,?,?)`,
      ['Seed Kasir', 'cashier@example.com', hash, roleMap.cashier, '628122222222', 0, adminRes.insertId, 1]
    );

    // Insert Supplier Org
    const [suppOrgRes] = await pool.query(
      `INSERT INTO suppliers (name, phone, email, address, pic_name)
       VALUES (?,?,?,?,?)`,
      ['Seed Supplier Co.', '628133333333', 'contact@supplier.com', 'Jl. Supplier No.1', 'Pak Supplier']
    );

    // Insert Supplier User
    await pool.query(
      `INSERT INTO users (name, email, password_hash, role_id, phone, supplier_id, receive_stock_alert, created_by, is_active)
       VALUES (?,?,?,?,?,?,?,?,?)`,
      ['Seed Supplier', 'supplier@example.com', hash, roleMap.supplier, '628144444444', suppOrgRes.insertId, 0, adminRes.insertId, 1]
    );

    console.log('✅ Admin, Kasir, dan Supplier berhasil dibuat!');
    console.log('Password default:', defaultPassword);
    console.log('Admin login:', 'admin@example.com');
    console.log('Kasir login:', 'cashier@example.com');
    console.log('Supplier login:', 'supplier@example.com');
  } catch (err) {
    console.error('❌ Error:', err.message);
  } finally {
    await pool.end();
    process.exit(0);
  }
}

seed();
