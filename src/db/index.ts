import { Pool, PoolClient } from 'pg';
import dotenv from 'dotenv';

// Load environment variables
dotenv.config();

// Database configuration
const dbConfig = {
  user: process.env.DB_USER || 'contextnexus',
  password: process.env.DB_PASSWORD || 'contextnexus',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || '5432'),
  database: process.env.DB_NAME || 'contextnexus',
};

// Create a new pool
const pool = new Pool(dbConfig);

// Log any pool errors
pool.on('error', (err) => {
  console.error('Unexpected error on idle client', err);
  process.exit(-1);
});

/**
 * Execute a database query
 * @param text SQL query string
 * @param params Query parameters
 * @returns Query result
 */
export const query = async (text: string, params: any[] = []) => {
  try {
    const start = Date.now();
    const res = await pool.query(text, params);
    const duration = Date.now() - start;
    
    if (process.env.NODE_ENV === 'development') {
      console.log('Executed query', { text, duration, rows: res.rowCount });
    }
    
    return res;
  } catch (err) {
    console.error('Error executing query', err);
    throw err;
  }
};

/**
 * Get a client from the pool
 * Used for transactions
 */
export const getClient = async (): Promise<PoolClient> => {
  const client = await pool.connect();
  return client;
};

/**
 * Transaction helper
 * @param callback Function to execute within transaction
 */
export const transaction = async <T>(callback: (client: PoolClient) => Promise<T>): Promise<T> => {
  const client = await pool.connect();
  
  try {
    await client.query('BEGIN');
    
    const result = await callback(client);
    
    await client.query('COMMIT');
    return result;
  } catch (e) {
    await client.query('ROLLBACK');
    throw e;
  } finally {
    client.release();
  }
};

/**
 * Check database connection
 * @returns True if connected successfully
 */
export const checkConnection = async (): Promise<boolean> => {
  try {
    const client = await pool.connect();
    client.release();
    return true;
  } catch (err) {
    console.error('Database connection error:', err);
    return false;
  }
};

export default {
  query,
  getClient,
  transaction,
  checkConnection,
  pool
};
