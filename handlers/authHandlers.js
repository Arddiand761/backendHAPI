"use strict";

const db = require("../database/db");
const bcrypt = require("bcrypt");
const HapiJwt = require("@hapi/jwt");
const { isGenerator } = require("framer-motion");
require("dotenv").config();

const JWT_SECRET = process.env.JWT_SECRET_KEY;

const registerHandler = async (request, h) => {
  try {
    const { username, email, password } = request.payload;
    if (!username || !password) {
      return h
        .response({ error: "Username dan password wajib di isi. " })
        .code(400);
    }
    if (password.length <= 6) {
      return h.response({ error: "Password kurang dari 6 karakter" }).code(400);
    }

    const saltRounds = 10;
    const password_hash = await bcrypt.hash(password, saltRounds);
    const queryText =
      "INSERT INTO users(username, email, password_hash) VALUES($1, $2, $3) RETURNING id, username, email, password_hash, created_at";
    const values = [username, email, password_hash];
    const result = await db.query(queryText, values);
    return h
      .response({
        message: "Registrasi berhassil",
        user: result.rows[0],
      })
      .code(201);
  } catch (error) {
    console.error("Error Registrasi gagal :", error);
    if (error.code === "23505") {
      if (error.constraint && error.constraint.includes("username")) {
        return h.response({ error: "Username Sudah digunakan." }).code(409);
      }
      if (error.constraint && error.constraint.includes("email")) {
        return h.response({ error: "Email sudah di gunakan" }).code(409);
      }
    }
    return h.response({ error: "Registrasi Gagal" }).code(500);
  }
};

const loginHandler = async (request, h) => {
  try {
    const { username, password } = request.payload;
    if (!username || !password) {
      return h
        .response({ error: "Username dan password dibutuhkan." })
        .code(400);
    }

    const queryText =
      "SELECT id, username, email, password_hash FROM users WHERE LOWER (username) = LOWER($1) OR LOWER(email) = LOWER($1)";
    const result = await db.query(queryText, [username]);

    if (result.rows.length === 0) {
      return h.response({ error: "Username atau password salah." }).code(401);
    }

    const user = result.rows[0];
    const passwordMatch = await bcrypt.compare(password, user.password_hash);

    if (!passwordMatch) {
      return h.response({ error: "Username atau password salah." }).code(401);
    }

    const tokenPayload = { id: user.id, username: user.username };
    const token = HapiJwt.token.generate(
      tokenPayload,
      { key: JWT_SECRET },
      { ttlSec: 14400 }
    );

    return h.response({ message: "Login berhasil!", token: token }).code(200);
  } catch (error) {
    console.error("Error login di authHandlers:", error);
    return h
      .response({ error: "Login gagal, terjadi kesalahan internal." })
      .code(500);
  }
};

module.exports = {
  registerHandler,
  loginHandler,
};
