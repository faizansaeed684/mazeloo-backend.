import mysql from 'mysql2/promise';
import dotenv from 'dotenv';

dotenv.config();

const pool = mysql.createPool(process.env.DATABASE_URL);

export const query = async (sql, params) => {
    const [rows] = await pool.execute(sql, params);
    return { rows };
};

export default pool;
