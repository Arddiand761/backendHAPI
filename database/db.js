"use strict";

const { Pool } = require("pg");
require("dotenv").config();

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 20,
  idleTimeoutMillis: 30000,
  connectionTimeoutMillis: 10000,
});

pool.on("connect", (client) => {
  console.log("✅ Terhubung ke Supabase PostgreSQL");
});

pool.on("error", (err, client) => {
  console.error("❌ Error koneksi Database PostgreSQL:", err);
});

const testConnection = async () => {
  try {
    const client = await pool.connect();
    const result = await client.query("SELECT NOW()");
    client.release();
    console.log("🚀 Database connection test successful:", result.rows[0]);
    return true;
  } catch (err) {
    console.error("💥 Database connection test failed:", err);
    return false;
  }
};

module.exports = {
  query: (text, params) => pool.query(text, params),
  pool,
  testConnection,
};

