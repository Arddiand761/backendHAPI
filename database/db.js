'use strict'

const { Pool } = require('pg');
require('dotenv').config();

const pool = new Pool({
     user: process.env.DB_USER,
    host: process.env.DB_HOST,
    database: process.env.DB_DATABASE,
    password: process.env.DB_PASSWORD,
    port: parseInt(process.env.DB_PORT || '5432'),
})


pool.on('connect', ()=>{
    console.log('Terhubung ke Postgresql')
});

pool.on('error', (err) =>{
    console.error('Error koneksi Database PostgreSQL', err)
})


module.exports = {
    query : (text, params) => pool.query(text, params),
    pool,
}