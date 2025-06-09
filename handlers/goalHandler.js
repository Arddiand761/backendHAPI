"use strict";

const db = require("../database/db"); // Pastikan path ini benar

/**
 * Handler untuk membuat goal baru.
 * Method: POST
 * Path: /goals
 */
const createGoalHandler = async (request, h) => {
  try {
    const { id: userId } = request.auth.credentials.user;
    const { goal_name, target_amount, target_date } = request.payload;

    // Validasi input
    if (!goal_name || target_amount === undefined) {
      return h
        .response({ error: "Field goal_name dan target_amount wajib diisi." })
        .code(400);
    }
    if (typeof target_amount !== "number" || target_amount <= 0) {
      return h
        .response({ error: "Target_amount harus berupa angka positif." })
        .code(400);
    }

    const queryText = `
            INSERT INTO goals(user_id, goal_name, target_amount, target_date)
            VALUES($1, $2, $3, $4)
            RETURNING *;
        `;
    const values = [userId, goal_name, target_amount, target_date];

    const result = await db.query(queryText, values);

    return h
      .response({
        message: "Goal berhasil dibuat!",
        goal: result.rows[0],
      })
      .code(201);
  } catch (error) {
    console.error("Error saat membuat goal:", error);
    return h
      .response({ error: "Terjadi kesalahan internal saat membuat goal." })
      .code(500);
  }
};

/**
 * Handler untuk mendapatkan semua goal milik pengguna.
 * Method: GET
 * Path: /goals
 */
const getAllGoalsHandler = async (request, h) => {
  try {
    const { id: userId } = request.auth.credentials.user;

    const queryText =
      "SELECT * FROM goals WHERE user_id = $1 ORDER BY created_at DESC";
    const result = await db.query(queryText, [userId]);

    return h
      .response({
        status: "success",
        goals: result.rows,
      })
      .code(200);
  } catch (error) {
    console.error("Error saat mengambil goals:", error);
    return h
      .response({ error: "Terjadi kesalahan internal saat mengambil goals." })
      .code(500);
  }
};

/**
 * Handler untuk memperbarui goal (misalnya, menambah tabungan).
 * Method: PUT
 * Path: /goals/{id}
 */
const updateGoalHandler = async (request, h) => {
  const { id: userId } = request.auth.credentials.user;
  const { id: goalId } = request.params;
  // Ganti nama payload agar lebih jelas, misal `amount_to_add`
  const { amount_to_add } = request.payload;

  // Validasi
  if (amount_to_add === undefined) {
    return h.response({ error: "Field amount_to_add wajib diisi." }).code(400);
  }
  if (typeof amount_to_add !== "number" || amount_to_add <= 0) {
    return h
      .response({ error: "Amount_to_add harus berupa angka positif." })
      .code(400);
  }

  // Mulai transaksi database
  await db.query("BEGIN");

  try {
    // 1. Ambil goal saat ini
    const selectQuery =
      "SELECT * FROM goals WHERE id = $1 AND user_id = $2 FOR UPDATE";
    const selectResult = await db.query(selectQuery, [goalId, userId]);

    if (selectResult.rows.length === 0) {
      await db.query("ROLLBACK"); // Batalkan transaksi jika goal tidak ada
      return h
        .response({
          error: "Goal tidak ditemukan atau Anda tidak memiliki akses.",
        })
        .code(404);
    }
    const goal = selectResult.rows[0];

    // 2. Update jumlah saat ini dan status
    const newCurrentAmount = parseFloat(goal.current_amount) + amount_to_add;
    let newStatus = goal.status;
    if (newCurrentAmount >= parseFloat(goal.target_amount)) {
      newStatus = "COMPLETED";
    }

    // 3. Update tabel 'goals'
    const updateQuery = `UPDATE goals SET current_amount = $1, status = $2 WHERE id = $3 RETURNING *;`;
    const updateResult = await db.query(updateQuery, [
      newCurrentAmount,
      newStatus,
      goalId,
    ]);

    // --- BAGIAN YANG DITAMBAHKAN ---
    // 4. Buat catatan transaksi baru untuk "menabung" ini
    const transactionTitle = `Menabung untuk: ${goal.goal_name}`;
    const transactionQuery =
      "INSERT INTO transactions (user_id, title, amount, type, category) VALUES ($1, $2, $3, $4, $5)";
    // Kita anggap menabung adalah 'EXPENSE' dari dompet utama ke pos 'Tabungan'
    await db.query(transactionQuery, [
      userId,
      transactionTitle,
      amount_to_add,
      "EXPENSE",
      "Tabungan",
    ]);
    // --- AKHIR DARI BAGIAN TAMBAHAN ---

    // Jika semua berhasil, simpan perubahan permanen
    await db.query("COMMIT");

    return h
      .response({
        message: "Goal berhasil diperbarui!",
        goal: updateResult.rows[0],
      })
      .code(200);
  } catch (error) {
    // Jika ada error di salah satu langkah, batalkan semua perubahan
    await db.query("ROLLBACK");
    console.error("Error saat memperbarui goal:", error);
    return h
      .response({ error: "Terjadi kesalahan internal saat memperbarui goal." })
      .code(500);
  }
};
/**
 * Handler untuk menghapus goal.
 * Method: DELETE
 * Path: /goals/{id}
 */
const deleteGoalHandler = async (request, h) => {
  try {
    const { id: userId } = request.auth.credentials.user;
    const { id: goalId } = request.params;

    const queryText =
      "DELETE FROM goals WHERE id = $1 AND user_id = $2 RETURNING id";
    const result = await db.query(queryText, [goalId, userId]);

    if (result.rowCount === 0) {
      return h
        .response({
          error: "Goal tidak ditemukan atau Anda tidak memiliki akses.",
        })
        .code(404);
    }

    return h
      .response({
        message: "Goal berhasil dihapus!",
      })
      .code(200);
  } catch (error) {
    console.error("Error saat menghapus goal:", error);
    return h
      .response({ error: "Terjadi kesalahan internal saat menghapus goal." })
      .code(500);
  }
};

// Ekspor semua handler baru
module.exports = {
  createGoalHandler,
  getAllGoalsHandler,
  updateGoalHandler,
  deleteGoalHandler,
};
