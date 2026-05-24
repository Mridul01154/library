const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all books with ratings
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.*, 
             COALESCE(AVG(r.rating), 0) as avg_rating,
             COUNT(DISTINCT r.id) as rating_count
      FROM books b
      LEFT JOIN reviews r ON b.id = r.book_id
      GROUP BY b.id
      ORDER BY b.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching books:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET single book with details and ratings
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT b.*, 
             COALESCE(AVG(r.rating), 0) as avg_rating,
             COUNT(DISTINCT r.id) as rating_count
      FROM books b
      LEFT JOIN reviews r ON b.id = r.book_id
      WHERE b.id = $1
      GROUP BY b.id
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching book:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET book recommendations based on category
router.get('/:id/recommendations', async (req, res) => {
  try {
    // Get the book's category
    const bookResult = await db.query('SELECT category FROM books WHERE id = $1', [req.params.id]);
    
    if (bookResult.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    const category = bookResult.rows[0].category;
    
    // Find similar books in same category (excluding current book)
    let query = `
      SELECT id, title, author, category, cover_url, quantity,
             COALESCE(avg_rating, 0) as avg_rating
      FROM books 
      WHERE id != $1 AND quantity > 0
    `;
    const params = [req.params.id];
    
    if (category) {
      query += ` AND category = $2`;
      params.push(category);
    }
    
    query += ` LIMIT 5`;
    
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching recommendations:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new book with optional ISBN and cover_url
router.post('/', async (req, res) => {
  const { title, author, category, quantity, isbn, cover_url } = req.body;
  
  // Validate required fields
  if (!title || !author) {
    return res.status(400).json({ error: 'Title and author are required' });
  }
  
  try {
    const result = await db.query(
      `INSERT INTO books(title, author, category, quantity, isbn, cover_url, avg_rating, rating_count) 
       VALUES($1, $2, $3, $4, $5, $6, 0, 0) 
       RETURNING *`,
      [title, author, category || 'General', quantity || 1, isbn || null, cover_url || null]
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating book:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update book with full details
router.put('/:id', async (req, res) => {
  const { title, author, category, quantity, isbn, cover_url } = req.body;
  const { id } = req.params;
  
  try {
    const result = await db.query(
      `UPDATE books 
       SET title=$1, author=$2, category=$3, quantity=$4, isbn=$5, cover_url=$6
       WHERE id=$7 
       RETURNING *`,
      [title, author, category, quantity, isbn, cover_url, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Book not found' });
    }
    
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating book:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE book (cascade deletes reviews and reservations)
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if book exists
    const bookCheck = await client.query('SELECT id FROM books WHERE id = $1', [id]);
    if (bookCheck.rows.length === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Book not found' });
    }
    
    // Delete related records first (foreign key constraints)
    await client.query('DELETE FROM reservations WHERE book_id = $1', [id]);
    await client.query('DELETE FROM reviews WHERE book_id = $1', [id]);
    await client.query('DELETE FROM books WHERE id = $1', [id]);
    
    await client.query('COMMIT');
    res.json({ message: 'Book and all related records deleted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error deleting book:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET books by category (for filtering)
router.get('/categories/:category', async (req, res) => {
  try {
    const result = await db.query(
      `SELECT b.*, 
              COALESCE(AVG(r.rating), 0) as avg_rating
       FROM books b
       LEFT JOIN reviews r ON b.id = r.book_id
       WHERE b.category ILIKE $1
       GROUP BY b.id
       ORDER BY b.title ASC`,
      [`%${req.params.category}%`]
    );
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching books by category:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all unique categories (for filter dropdown)
router.get('/filters/categories', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT DISTINCT category 
      FROM books 
      WHERE category IS NOT NULL AND category != ''
      ORDER BY category ASC
    `);
    res.json(result.rows.map(r => r.category));
  } catch (error) {
    console.error('Error fetching categories:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET books with advanced filters
router.post('/filter', async (req, res) => {
  const { category, availability, searchTerm } = req.body;
  
  let query = `
    SELECT b.*, 
           COALESCE(AVG(r.rating), 0) as avg_rating,
           COUNT(DISTINCT r.id) as rating_count
    FROM books b
    LEFT JOIN reviews r ON b.id = r.book_id
    WHERE 1=1
  `;
  const params = [];
  let paramIndex = 1;
  
  if (category) {
    query += ` AND b.category = $${paramIndex}`;
    params.push(category);
    paramIndex++;
  }
  
  if (availability === 'available') {
    query += ` AND b.quantity > 0`;
  } else if (availability === 'borrowed') {
    query += ` AND b.quantity = 0`;
  } else if (availability === 'lowstock') {
    query += ` AND b.quantity > 0 AND b.quantity < 3`;
  }
  
  if (searchTerm) {
    query += ` AND (b.title ILIKE $${paramIndex} OR b.author ILIKE $${paramIndex})`;
    params.push(`%${searchTerm}%`);
    paramIndex++;
  }
  
  query += ` GROUP BY b.id ORDER BY b.title ASC`;
  
  try {
    const result = await db.query(query, params);
    res.json(result.rows);
  } catch (error) {
    console.error('Error filtering books:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
