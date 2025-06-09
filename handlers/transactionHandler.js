const axios = require("axios");
const db = require("../database/db");

const createTransactionHandler = async (request, h) => {
  const { id: userId } = request.auth.credentials.user;
  const { title, amount, type, category, transaction_date } = request.payload;

  // Konversi ke huruf besar untuk database
  const dbType = type.toUpperCase(); // 'expense' -> 'EXPENSE', 'income' -> 'INCOME'
  let savedTransaction;

  try {
    const query =
      "INSERT INTO transactions (user_id, title, amount, type, category, transaction_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *";
    const values = [userId, title, amount, dbType, category, transaction_date]; // Gunakan dbType
    const { rows } = await db.query(query, values);
    savedTransaction = rows[0];
    console.log("Transaksi berhasil disimpan:", savedTransaction);
  } catch (dbError) {
    console.error("Error saat menyimpan transaksi ke DB:", dbError);
    return h.response({ message: "Gagal menyimpan transaksi." }).code(500);
  }

  try {
    const anomalyApiUrl = process.env.ANOMALY_API_URL;
    const apiKey = process.env.ML_API_KEY;

    const payloadForAnomalyApi = [
      {
        ID_Transaksi: savedTransaction.id,
        Tanggal_Transaksi: savedTransaction.transaction_date,
        Deskripsi_Pengeluaran: savedTransaction.title,
        Jumlah_Pengeluaran: parseFloat(savedTransaction.amount),
      },
    ];

    const anomalyResponse = await axios.post(
      anomalyApiUrl,
      payloadForAnomalyApi,
      { headers: { "x-api-key": apiKey } },
    );
    const detectionResult = anomalyResponse.data.anomaly_detection_result[0];
    const anomalyStatus = detectionResult.Prediksi_Label;
    console.log("Hasil Deteksi Anomali:", anomalyStatus);

    await db.query(
      "UPDATE transactions SET anomaly_status = $1 WHERE id = $2",
      [anomalyStatus, savedTransaction.id],
    );
    console.log(
      `Status anomali untuk transaksi ${savedTransaction.id} telah diupdate menjadi ${anomalyStatus}`,
    );

    savedTransaction.anomaly_status = anomalyStatus;
  } catch (mlError) {
    console.error(
      "Gagal mendapatkan atau menyimpan status anomali:",
      mlError.message,
    );
  }

  return h
    .response({
      message: "Transaksi berhasil dibuat.",
      data: savedTransaction,
    })
    .code(201);
};

const getAllTransactionsHandler = async (request, h) => {
  try {
    const { id: userId } = request.auth.credentials.user;
    const queryText = `
      SELECT 
        id, 
        user_id, 
        title, 
        amount, 
        type, 
        category, 
        transaction_date, 
        created_at, 
        anomaly_status 
      FROM transactions 
      WHERE user_id = $1 
      ORDER BY transaction_date DESC
    `;
    const result = await db.query(queryText, [userId]);

    return h
      .response({
        status: "success",
        transactions: result.rows,
      })
      .code(200);
  } catch (error) {
    console.error("Error saat mengambil transaksi:", error);
    return h
      .response({
        error: "Terjadi kesalahan internal saat mengambil transaksi.",
      })
      .code(500);
  }
};

// --- FUNGSI PREDIKSI YANG DIPERBARUI ---
const getExpensePredictionHandler = async (request, h) => {
  const { id: userId } = request.auth.credentials.user;

  try {
    // 1. Ambil 3 transaksi pengeluaran TERBARU
    const query = `
      SELECT "amount" FROM transactions 
      WHERE user_id = $1 AND "type" = $2 
      ORDER BY "transaction_date" DESC 
      LIMIT 3
    `;
    const values = [userId, "EXPENSE"];
    const { rows: recentTransactions } = await db.query(query, values);

    if (recentTransactions.length < 3) {
      return h
        .response({
          message:
            "Data pengeluaran tidak cukup untuk membuat prediksi. Dibutuhkan minimal 3 riwayat pengeluaran.",
        })
        .code(404);
    }

    // 2. Siapkan data untuk dikirim ke API ML
    const expensesArray = recentTransactions
      .map((tx) => parseFloat(tx.amount))
      .reverse();

    const predictionApiUrl = process.env.FINANCE_PREDICT_API_URL;
    const apiKey = process.env.ML_API_KEY;

    // 3. Panggil API Prediksi
    const predictionResponse = await axios.post(
      predictionApiUrl,
      { previous_expenses: expensesArray },
      { headers: { "x-api-key": apiKey } },
    );

    // --- PERUBAHAN DIMULAI DI SINI ---

    // 4. Simpan hasil prediksi ke tabel financial_forecasts
    const predictionResult = predictionResponse.data;
    const predictedAmount = predictionResult.prediksi_keuangan;
    const predictionType = "monthly_expense_prediction"; // Anda bisa membuat ini lebih dinamis jika perlu

    const insertQuery =
      "INSERT INTO financial_forecasts (user_id, prediction_type, predicted_amount) VALUES ($1, $2, $3)";
    const insertValues = [userId, predictionType, predictedAmount];
    await db.query(insertQuery, insertValues);

    console.log(
      `Prediksi untuk user ${userId} sebesar ${predictedAmount} berhasil disimpan.`,
    );

    // 5. Kembalikan hasilnya ke client
    return h.response(predictionResult).code(200);
  } catch (error) {
    console.error(
      "Error saat mendapatkan prediksi pengeluaran:",
      error.message,
    );
    if (error.response) {
      console.error("Detail Error dari Server ML:", error.response.data);
    }
    return h
      .response({ message: "Gagal mendapatkan prediksi keuangan" })
      .code(500);
  }
};

module.exports = {
  createTransactionHandler,
  getAllTransactionsHandler,
  getExpensePredictionHandler, // <-- Jangan lupa ekspor handler baru
};
