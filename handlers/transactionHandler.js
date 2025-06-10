const axios = require("axios");
const db = require("../database/db");

const createTransactionHandler = async (request, h) => {
  const { id: userId } = request.auth.credentials.user;
  const { title, amount, type, category, transaction_date } = request.payload;

  // Konversi ke huruf besar untuk database
  const dbType = type.toUpperCase(); // 'expense' -> 'EXPENSE', 'income' -> 'INCOME'
  let finalCategory = category; // Default category dari user
  let savedTransaction;

  // --- BAGIAN BARU: AUTO-KATEGORISASI ML ---
  // Jika category tidak diisi atau kosong, gunakan ML untuk prediksi
  if (!category || category.trim() === "") {
    try {
      console.log("Kategori kosong, menggunakan ML untuk prediksi...");

      const categorizationApiUrl =
        "https://kategoriipeng-production.up.railway.app/categorize/transaction";

      const categorizationPayload = {
        description: title,
        amount: parseFloat(amount),
      };

      const categorizationResponse = await axios.post(
        categorizationApiUrl,
        categorizationPayload,
        {
          headers: {
            "Content-Type": "application/json",
          },
          timeout: 10000, // 10 detik timeout
        },
      );

      const { predicted_category, confidence } = categorizationResponse.data;
      finalCategory = predicted_category;

      console.log(
        `ML Kategorisasi - Kategori: ${predicted_category}, Confidence: ${confidence}`,
      );

      // Optional: Set minimum confidence threshold
      if (confidence < 0.5) {
        console.log(
          `Confidence rendah (${confidence}), menggunakan kategori default`,
        );
        finalCategory = "Lainnya"; // Fallback category
      }
    } catch (mlCategoryError) {
      console.error("Error saat kategorisasi ML:", mlCategoryError.message);
      // Jika ML gagal, gunakan kategori default
      finalCategory = "Lainnya";
    }
  }

  // --- SIMPAN TRANSAKSI KE DATABASE ---
  try {
    const query =
      "INSERT INTO transactions (user_id, title, amount, type, category, transaction_date) VALUES ($1, $2, $3, $4, $5, $6) RETURNING *";
    const values = [
      userId,
      title,
      amount,
      dbType,
      finalCategory,
      transaction_date,
    ]; // Gunakan finalCategory
    const { rows } = await db.query(query, values);
    savedTransaction = rows[0];
    console.log("Transaksi berhasil disimpan:", savedTransaction);
  } catch (dbError) {
    console.error("Error saat menyimpan transaksi ke DB:", dbError);
    return h.response({ message: "Gagal menyimpan transaksi." }).code(500);
  }

  // --- DETEKSI ANOMALI (KODE EXISTING) ---
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
      data: {
        ...savedTransaction,
        category_source: category ? "manual" : "ml_prediction", // Info sumber kategori
      },
    })
    .code(201);
};

// --- HANDLER BARU: KATEGORISASI MANUAL ---
const categorizeSingleTransactionHandler = async (request, h) => {
  const { id: transactionId } = request.params;
  const { id: userId } = request.auth.credentials.user;

  try {
    // 1. Ambil data transaksi
    const getTransactionQuery =
      "SELECT * FROM transactions WHERE id = $1 AND user_id = $2";
    const { rows: transactions } = await db.query(getTransactionQuery, [
      transactionId,
      userId,
    ]);

    if (transactions.length === 0) {
      return h
        .response({
          error: "Transaksi tidak ditemukan atau tidak memiliki akses.",
        })
        .code(404);
    }

    const transaction = transactions[0];

    // 2. Panggil ML API untuk kategorisasi
    const categorizationApiUrl =
      "https://kategoriipeng-production.up.railway.app/categorize/transaction";

    const categorizationPayload = {
      description: transaction.title,
      amount: parseFloat(transaction.amount),
    };

    const categorizationResponse = await axios.post(
      categorizationApiUrl,
      categorizationPayload,
      {
        headers: {
          "Content-Type": "application/json",
        },
        timeout: 10000,
      },
    );

    const { predicted_category, confidence } = categorizationResponse.data;

    // 3. Update kategori di database
    const updateQuery =
      "UPDATE transactions SET category = $1 WHERE id = $2 RETURNING *";
    const { rows: updatedTransactions } = await db.query(updateQuery, [
      predicted_category,
      transactionId,
    ]);

    return h
      .response({
        message: "Kategorisasi berhasil diperbarui",
        data: {
          transaction: updatedTransactions[0],
          ml_result: {
            predicted_category,
            confidence,
          },
        },
      })
      .code(200);
  } catch (error) {
    console.error("Error saat kategorisasi transaksi:", error.message);
    return h
      .response({
        error: "Gagal melakukan kategorisasi otomatis",
      })
      .code(500);
  }
};

// --- HANDLER BARU: BATCH KATEGORISASI ---
const categorizeAllTransactionsHandler = async (request, h) => {
  const { id: userId } = request.auth.credentials.user;

  try {
    // 1. Ambil semua transaksi tanpa kategori atau dengan kategori "Lainnya"
    const getTransactionsQuery = `
      SELECT * FROM transactions 
      WHERE user_id = $1 AND (category IS NULL OR category = '' OR category = 'Lainnya')
      ORDER BY created_at DESC
    `;
    const { rows: transactions } = await db.query(getTransactionsQuery, [
      userId,
    ]);

    if (transactions.length === 0) {
      return h
        .response({
          message: "Tidak ada transaksi yang perlu dikategorisasi",
          data: { processed: 0 },
        })
        .code(200);
    }

    let successCount = 0;
    let errorCount = 0;
    const results = [];

    // 2. Process setiap transaksi
    for (const transaction of transactions) {
      try {
        const categorizationPayload = {
          description: transaction.title,
          amount: parseFloat(transaction.amount),
        };

        const categorizationResponse = await axios.post(
          "https://kategoriipeng-production.up.railway.app/categorize/transaction",
          categorizationPayload,
          {
            headers: { "Content-Type": "application/json" },
            timeout: 10000,
          },
        );

        const { predicted_category, confidence } = categorizationResponse.data;

        // Update database
        await db.query("UPDATE transactions SET category = $1 WHERE id = $2", [
          predicted_category,
          transaction.id,
        ]);

        results.push({
          transaction_id: transaction.id,
          title: transaction.title,
          old_category: transaction.category,
          new_category: predicted_category,
          confidence: confidence,
          status: "success",
        });

        successCount++;

        // Small delay to avoid overwhelming the ML API
        await new Promise((resolve) => setTimeout(resolve, 100));
      } catch (error) {
        console.error(
          `Error kategorisasi transaksi ${transaction.id}:`,
          error.message,
        );
        results.push({
          transaction_id: transaction.id,
          title: transaction.title,
          status: "error",
          error: error.message,
        });
        errorCount++;
      }
    }

    return h
      .response({
        message: "Batch kategorisasi selesai",
        data: {
          total_processed: transactions.length,
          success_count: successCount,
          error_count: errorCount,
          results: results,
        },
      })
      .code(200);
  } catch (error) {
    console.error("Error batch kategorisasi:", error.message);
    return h
      .response({
        error: "Gagal melakukan batch kategorisasi",
      })
      .code(500);
  }
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

// Export semua handlers
module.exports = {
  createTransactionHandler,
  getAllTransactionsHandler,
  getExpensePredictionHandler,
  categorizeSingleTransactionHandler, // BARU
  categorizeAllTransactionsHandler, // BARU
};
