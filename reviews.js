const express = require('express');
const router = express.Router();
const db = require('../db');

// GET reviews for a book
router.get('/book/:bookId', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, m.name as member_name, m.email as member_email
      FROM reviews r
      JOIN members m ON r.member_id = m.id
      WHERE r.book_id = $1
      ORDER BY r.created_at DESC
    `, [req.params.bookId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new review/rating
router.post('/', async (req, res) => {
  const { book_id, member_id, rating, review } = req.body;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if user already reviewed this book
    const existing = await client.query(
      'SELECT id FROM reviews WHERE book_id = $1 AND member_id = $2',
      [book_id, member_id]
    );
    
    if (existing.rows.length > 0) {
      // Update existing review
      await client.query(`
        UPDATE reviews 
        SET rating = $1, review = $2, updated_at = CURRENT_TIMESTAMP
        WHERE book_id = $3 AND member_id = $4
      `, [rating, review, book_id, member_id]);
    } else {
      // Insert new review
      await client.query(`
        INSERT INTO reviews (book_id, member_id, rating, review)
        VALUES ($1, $2, $3, $4)
      `, [book_id, member_id, rating, review]);
    }
    
    // Update book's average rating
    await client.query(`
      UPDATE books 
      SET avg_rating = (
        SELECT COALESCE(AVG(rating), 0) FROM reviews WHERE book_id = $1
      ),
      rating_count = (
        SELECT COUNT(*) FROM reviews WHERE book_id = $1
      )
      WHERE id = $1
    `, [book_id]);
    
    await client.query('COMMIT');
    res.json({ message: 'Rating submitted successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;