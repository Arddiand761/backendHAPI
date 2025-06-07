"use strict";

const Hapi = require("@hapi/hapi");
const HapiJwt = require("@hapi/jwt");
const db = require('./database/db')
// const bcrypt = require('bcrypt')
require("dotenv").config();
const authHandlers = require("./handlers/authHandlers");
const transactionHandlers = require("./handlers/transactionHandler");

const JWT_SECRET = process.env.JWT_SECRET_KEY;

if (!JWT_SECRET) {
  console.error(
    "FATAL ERROR: JWT_SECRET_KEY tidak di-set di environment variables."
  );
  process.exit(1); // Aplikasi tidak boleh berjalan tanpa JWT secret
}

const init = async () => {
  const server = Hapi.server({
    port: process.env.NODE_PORT || 3000,
    host: "localhost",
  });

  await server.register(HapiJwt);
server.auth.strategy("jwt_strategy", "jwt", {
    keys: JWT_SECRET,
    verify: {
      aud: false, // Set 'false' jika tidak digunakan, atau string/array jika divalidasi
      iss: false, // Set 'false' jika tidak digunakan, atau string/array jika divalidasi
      sub: false, // Bisa juga divalidasi di fungsi `validate`
      nbf: true,  // Memastikan token tidak digunakan sebelum waktu 'nbf'
      exp: true,  // **WAJIB true**: Memastikan token divalidasi expiry-nya
      maxAgeSec: 14400, // Contoh: 4 jam (to
    },
    validate: async (artifacts, request, h) => {
      // artifacts.decoded.payload akan berisi payload dari token Anda,
      // misalnya: { id: user.id, username: user.username } yang dibuat saat login.
      const { id, username } = artifacts.decoded.payload;

      // Lakukan pengecekan tambahan ke database jika perlu:
      try {
        // Contoh: Pastikan pengguna masih ada dan aktif di database
        // const userCheckQuery = 'SELECT id, username FROM users WHERE id = $1 AND username = $2 AND is_active = TRUE'; // Jika ada kolom is_active
        const userCheckQuery = 'SELECT id, username FROM users WHERE id = $1 AND username = $2';
        const { rows } = await db.query(userCheckQuery, [id, username]);

        if (rows.length === 0) {
          // Pengguna tidak ditemukan di DB atau tidak lagi valid
          return { isValid: false };
        }

        // Jika pengguna valid dan semua pemeriksaan lolos:
        return {
          isValid: true,
          credentials: {
            // Objek 'credentials' ini akan tersedia di `request.auth.credentials`
            // di dalam handler route yang dilindungi.
            user: rows[0] // Menyimpan informasi pengguna yang relevan
            // Anda bisa juga menambahkan scope: ['user', 'admin'] jika menggunakan roles/permissions
          }
        };
      } catch (dbError) {
        console.error("Error saat validasi token di database (JWT strategy):", dbError);
        return { isValid: false }; // Gagal validasi karena error DB
      }
    },
  });

  server.route({
    method: "GET",
    path: "/",
    config: { auth: false },
    handler: (request, h) => "Selamat datang di API dengan Hapi.js dan JWT!",
  });

  // --- Route Registrasi menggunakan handler dari modul ---
  server.route({
    method: "POST",
    path: "/register",
    config: { auth: false },
    handler: authHandlers.registerHandler, // <-- GUNAKAN HANDLER DARI MODUL
  });

  // --- Route Login menggunakan handler dari modul ---
  server.route({
    method: "POST",
    path: "/login",
    config: { auth: false },
    handler: authHandlers.loginHandler, // <-- GUNAKAN HANDLER DARI MODUL
  });

  // --- Contoh Route yang Dilindungi JWT ---
  server.route({
    method: "GET",
    path: "/protected-data",
    config: { auth: "jwt_strategy" },
    handler: (request, h) => {
      const userInfo = request.auth.credentials.user;
      return { message: "Ini adalah data yang dilindungi.", user: userInfo };
    },
  });


      server.route({
        method: 'POST',
        path: '/transactions',
        config: {
            auth: 'jwt_strategy' // Ini sangat penting: melindungi rute ini
        },
        handler: transactionHandlers.createTransactionHandler
    });

        server.route({
        method: 'GET',
        path: '/transactions', // Endpoint untuk MENGAMBIL semua transaksi
        config: {
            auth: 'jwt_strategy' // Juga dilindungi, karena hanya user yang login yang bisa lihat transaksinya
        },
        handler: transactionHandlers.getAllTransactionsHandler
    });
  // Anda juga bisa membuat predictionHandlers.js untuk logika panggilan ke API Flask
  // dan mengimpornya di sini.

  await server.start();
  console.log("Server Hapi.js berjalan di %s", server.info.uri);
};



// ... (process.on('unhandledRejection') dan init() tetap sama) ...
process.on("unhandledRejection", (err) => {
  console.error("Unhandled Rejection:", err); // Lebih baik log errornya
  process.exit(1);
});
init();
