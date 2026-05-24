const express = require('express');
const router = express.Router();
const db = require('../db');

// GET reservations for a member
router.get('/member/:memberId', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT r.*, b.title as book_title, b.author as book_author, b.cover_url
      FROM reservations r
      JOIN books b ON r.book_id = b.id
      WHERE r.member_id = $1 AND r.status = 'pending'
      ORDER BY r.reservation_date ASC
    `, [req.params.memberId]);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new reservation
router.post('/', async (req, res) => {
  const { book_id, member_id } = req.body;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Check if book is actually out of stock
    const bookCheck = await client.query('SELECT quantity, title FROM books WHERE id = $1', [book_id]);
    if (bookCheck.rows[0].quantity > 0) {
      throw new Error('Book is available, no need to reserve');
    }
    
    // Check if user already has a pending reservation for this book
    const existing = await client.query(
      'SELECT id FROM reservations WHERE book_id = $1 AND member_id = $2 AND status = $3',
      [book_id, member_id, 'pending']
    );
    
    if (existing.rows.length > 0) {
      throw new Error('You already have a pending reservation for this book');
    }
    
    const result = await client.query(`
      INSERT INTO reservations (book_id, member_id, reservation_date, status)
      VALUES ($1, $2, CURRENT_DATE, 'pending')
      RETURNING *
    `, [book_id, member_id]);
    
    await client.query('COMMIT');
    res.json({ message: 'Book reserved successfully', reservation: result.rows[0] });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// DELETE reservation (cancel)
router.delete('/:id', async (req, res) => {
  try {
    await db.query('DELETE FROM reservations WHERE id = $1', [req.params.id]);
    res.json({ message: 'Reservation cancelled' });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// Check and notify when reserved books become available
router.post('/check-availability', async (req, res) => {
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Find books that are now available and have pending reservations
    const availableBooks = await client.query(`
      SELECT DISTINCT b.id, b.title, b.quantity, r.member_id, m.email, m.name
      FROM books b
      JOIN reservations r ON b.id = r.book_id
      JOIN members m ON r.member_id = m.id
      WHERE b.quantity > 0 AND r.status = 'pending' AND r.notified = false
    `);
    
    for (const book of availableBooks.rows) {
      // Mark as notified
      await client.query(`
        UPDATE reservations SET notified = true, status = 'notified'
        WHERE book_id = $1 AND member_id = $2 AND status = 'pending'
      `, [book.id, book.member_id]);
      
      // In a real app, you'd send an email here
      console.log(`📧 Notify ${book.name} (${book.email}): "${book.title}" is now available!`);
    }
    
    await client.query('COMMIT');
    res.json({ 
      message: 'Checked availability', 
      notified_count: availableBooks.rows.length 
    });
  } catch (error) {
    await client.query('ROLLBACK');
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

module.exports = router;