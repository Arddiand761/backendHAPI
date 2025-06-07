// handlers/transactionHandlers.js
'use strict';

const db = require('../database/db'); // Path relatif ke modul db Anda

const createTransactionHandler = async (request, h) => {
    try {
        // 1. Dapatkan informasi pengguna yang login dari token JWT
        // Ini adalah bagian terpenting dari rute yang dilindungi!
        const { id: userId } = request.auth.credentials.user;
        if (!userId) {
            return h.response({ error: 'User tidak terautentikasi dengan benar.' }).code(401);
        }

        // 2. Ambil data transaksi dari payload permintaan
        const { title, amount, type, category, transaction_date } = request.payload;

        // 3. Validasi input dasar
        if (!title || amount === undefined || !type) {
            return h.response({ error: 'Field title, amount, dan type wajib diisi.' }).code(400);
        }
        if (type !== 'EXPENSE' && type !== 'INCOME') {
            return h.response({ error: "Nilai type harus 'EXPENSE' atau 'INCOME'." }).code(400);
        }
        if (typeof amount !== 'number' || amount <= 0) {
             return h.response({ error: 'Amount harus berupa angka positif.' }).code(400);
        }

        // 4. Masukkan data ke dalam database
        const queryText = `
            INSERT INTO transactions(user_id, title, amount, type, category, transaction_date) 
            VALUES($1, $2, $3, $4, $5, $6) 
            RETURNING id, title, amount, type, category, transaction_date
        `;
        // Jika transaction_date tidak disertakan, gunakan waktu saat ini
        const values = [userId, title, amount, type, category, transaction_date || new Date()];

        const result = await db.query(queryText, values);
        const newTransaction = result.rows[0];

        // 5. Kembalikan respons sukses dengan data transaksi baru
        return h.response({
            message: 'Transaksi berhasil ditambahkan!',
            transaction: newTransaction
        }).code(201); // 201 Created adalah status yang tepat untuk resource baru

    } catch (error) {
        console.error('Error saat menambahkan transaksi:', error);
        // Anda bisa menambahkan penanganan error yang lebih spesifik jika perlu
        return h.response({ error: 'Terjadi kesalahan internal saat menambahkan transaksi.' }).code(500);
    }
};

const getAllTransactionsHandler = async (request, h) => {
    try {
        // 1. Dapatkan ID pengguna dari token JWT.
        const { id: userId } = request.auth.credentials.user;

        // 2. Query database untuk semua transaksi dengan user_id yang sesuai.
        //    Diurutkan berdasarkan tanggal transaksi terbaru.
        const queryText = 'SELECT * FROM transactions WHERE user_id = $1 ORDER BY transaction_date DESC';
        const result = await db.query(queryText, [userId]);

        // 3. Kembalikan data transaksi dalam bentuk array.
        return h.response({
            status: 'success',
            transactions: result.rows
        }).code(200);

    } catch (error) {
        console.error('Error saat mengambil transaksi:', error);
        return h.response({ error: 'Terjadi kesalahan internal saat mengambil transaksi.' }).code(500);
    }
};

// Ekspor handler agar bisa digunakan di server.js
module.exports = {
    createTransactionHandler,
    getAllTransactionsHandler,
    // Nantinya Anda bisa tambahkan handler lain di sini (getTransactions, update, delete)
};