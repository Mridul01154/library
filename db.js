  const { Pool } = require('pg');

  const pool = new Pool({
    user: 'postgres',
    host: 'localhost',
    database: 'librarydb',
    password: '743336',
    port: 5432,
  });

  // Initialize database tables
async function initTables() {
  const client = await pool.connect();
  try {
    // Add new columns to books table if not exists
    await client.query(`
      ALTER TABLE books 
      ADD COLUMN IF NOT EXISTS isbn VARCHAR(20),
      ADD COLUMN IF NOT EXISTS cover_url TEXT,
      ADD COLUMN IF NOT EXISTS avg_rating DECIMAL(3,2) DEFAULT 0,
      ADD COLUMN IF NOT EXISTS rating_count INT DEFAULT 0
    `);
    
    // Create reservations table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reservations (
        id SERIAL PRIMARY KEY,
        book_id INT REFERENCES books(id) ON DELETE CASCADE,
        member_id INT REFERENCES members(id) ON DELETE CASCADE,
        reservation_date DATE DEFAULT CURRENT_DATE,
        status VARCHAR(20) DEFAULT 'pending',
        notified BOOLEAN DEFAULT FALSE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        UNIQUE(book_id, member_id, status)
      )
    `);
    
    // Create reviews table
    await client.query(`
      CREATE TABLE IF NOT EXISTS reviews (
        id SERIAL PRIMARY KEY,
        book_id INT REFERENCES books(id) ON DELETE CASCADE,
        member_id INT REFERENCES members(id) ON DELETE CASCADE,
        rating INT CHECK (rating >= 1 AND rating <= 5),
        review TEXT,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    console.log('✅ Database tables initialized');
  } catch (error) {
    console.error('Error initializing tables:', error);
  } finally {
    client.release();
  }
}

initTables();

  module.exports = pool;