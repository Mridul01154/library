const { Pool } = require('pg');

const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: process.env.NODE_ENV === 'production' ? { rejectUnauthorized: false } : false,
});

async function initTables() {
  const client = await pool.connect();
  try {
    console.log('🔄 Creating database tables if not exist...');
    
    // Create members table
    await client.query(`
      CREATE TABLE IF NOT EXISTS members (
        id SERIAL PRIMARY KEY,
        name VARCHAR(255) NOT NULL,
        email VARCHAR(255) UNIQUE NOT NULL,
        phone VARCHAR(20),
        membership_type VARCHAR(50) DEFAULT 'Basic',
        status VARCHAR(20) DEFAULT 'Active',
        joined_date TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
        fine_balance DECIMAL(10,2) DEFAULT 0
      )
    `);
    
    // Create books table
    await client.query(`
      CREATE TABLE IF NOT EXISTS books (
        id SERIAL PRIMARY KEY,
        title VARCHAR(255) NOT NULL,
        author VARCHAR(255) NOT NULL,
        category VARCHAR(255),
        quantity INT DEFAULT 1,
        isbn VARCHAR(20),
        cover_url TEXT,
        avg_rating DECIMAL(3,2) DEFAULT 0,
        rating_count INT DEFAULT 0
      )
    `);
    
    // Create borrow_records table
    await client.query(`
      CREATE TABLE IF NOT EXISTS borrow_records (
        id SERIAL PRIMARY KEY,
        member_id INT REFERENCES members(id) ON DELETE CASCADE,
        book_id INT REFERENCES books(id) ON DELETE CASCADE,
        quantity INT DEFAULT 1,
        issue_date DATE DEFAULT CURRENT_DATE,
        due_date DATE,
        return_date DATE,
        status VARCHAR(20) DEFAULT 'Borrowed',
        fine_amount DECIMAL(10,2) DEFAULT 0,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Create fines table
    await client.query(`
      CREATE TABLE IF NOT EXISTS fines (
        id SERIAL PRIMARY KEY,
        member_id INT REFERENCES members(id) ON DELETE CASCADE,
        borrow_record_id INT REFERENCES borrow_records(id) ON DELETE CASCADE,
        amount DECIMAL(10,2) NOT NULL,
        reason VARCHAR(255),
        paid BOOLEAN DEFAULT FALSE,
        paid_date DATE,
        created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
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
    
    // Create settings table
    await client.query(`
      CREATE TABLE IF NOT EXISTS settings (
        id SERIAL PRIMARY KEY,
        key VARCHAR(100) UNIQUE NOT NULL,
        value TEXT,
        updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
      )
    `);
    
    // Insert default settings if not exists
    await client.query(`
      INSERT INTO settings (key, value) VALUES 
      ('fine_per_day', '10'),
      ('library_name', 'City Central Library'),
      ('admin_email', 'admin@library.com')
      ON CONFLICT (key) DO NOTHING
    `);
    
    console.log('✅ All database tables created/verified successfully');
  } catch (error) {
    console.error('❌ Error creating tables:', error.message);
  } finally {
    client.release();
  }
}

// Run table initialization
initTables();

module.exports = pool;
