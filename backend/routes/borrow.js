const express = require('express');
const router = express.Router();
const db = require('../db');

// GET ALL borrow records (including returned) for reports
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        br.id,
        br.member_id,
        br.book_id,
        br.quantity,
        br.issue_date,
        br.due_date,
        br.return_date,
        br.status,
        br.fine_amount,
        br.created_at,
        m.name as member_name,
        b.title as book_title,
        b.author as book_author
      FROM borrow_records br
      JOIN members m ON br.member_id = m.id
      JOIN books b ON br.book_id = b.id
      ORDER BY br.created_at DESC
    `);
    
    console.log(`Found ${result.rows.length} total borrow records`);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching borrow records:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET only active borrows (not returned yet)
router.get('/active', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        br.id,
        br.member_id,
        br.book_id,
        br.quantity,
        br.issue_date,
        br.due_date,
        br.status,
        m.name as member_name,
        b.title as book_title,
        b.author as book_author
      FROM borrow_records br
      JOIN members m ON br.member_id = m.id
      JOIN books b ON br.book_id = b.id
      WHERE br.status = 'Borrowed'
      ORDER BY br.due_date ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// POST new borrow record - FIXED VERSION
router.post('/', async (req, res) => {
  console.log('📚 POST /borrow - Request received');
  console.log('Request body:', req.body);
  
  const { member_id, book_id, quantity, issue_date, due_date } = req.body;
  
  // Validate required fields
  if (!member_id || !book_id || !quantity || !issue_date || !due_date) {
    console.log('❌ Missing required fields:', { member_id, book_id, quantity, issue_date, due_date });
    return res.status(400).json({ 
      error: 'Missing required fields',
      required: ['member_id', 'book_id', 'quantity', 'issue_date', 'due_date']
    });
  }
  
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    console.log('✅ Transaction started');
    
    // Lock the row to prevent concurrent updates
    const bookCheck = await client.query(
      'SELECT id, title, quantity FROM books WHERE id = $1 FOR UPDATE',
      [book_id]
    );
    
    console.log('Book check result:', bookCheck.rows);
    
    if (bookCheck.rows.length === 0) {
      throw new Error(`Book with ID ${book_id} not found`);
    }
    
    const book = bookCheck.rows[0];
    const availableQty = parseInt(book.quantity);
    const requestedQty = parseInt(quantity);
    
    console.log(`📖 Book found: "${book.title}"`);
    console.log(`Current stock: ${availableQty}, Requested: ${requestedQty}`);
    
    // Check if enough stock is available
    if (availableQty < requestedQty) {
      throw new Error(`Insufficient stock. Only ${availableQty} copy/copies available, you requested ${requestedQty}`);
    }
    
    // Check if member exists and is active
    const memberCheck = await client.query(
      'SELECT id, name, status FROM members WHERE id = $1',
      [member_id]
    );
    
    console.log('Member check result:', memberCheck.rows);
    
    if (memberCheck.rows.length === 0) {
      throw new Error(`Member with ID ${member_id} not found`);
    }
    
    const member = memberCheck.rows[0];
    
    if (member.status !== 'Active') {
      throw new Error(`Member "${member.name}" is not active. Status: ${member.status}`);
    }
    
    console.log(`👤 Member found: "${member.name}" (${member.status})`);
    
    // Calculate new quantity
    const newQuantity = availableQty - requestedQty;
    console.log(`📊 Stock calculation: ${availableQty} - ${requestedQty} = ${newQuantity}`);
    
    // Update book quantity (decrease)
    const updateResult = await client.query(
      'UPDATE books SET quantity = $1 WHERE id = $2 RETURNING quantity',
      [newQuantity, book_id]
    );
    
    console.log(`📚 Book stock updated. New quantity: ${updateResult.rows[0].quantity}`);
    
    // Insert borrow record
    const insertResult = await client.query(`
      INSERT INTO borrow_records (
        member_id, 
        book_id, 
        quantity, 
        issue_date, 
        due_date, 
        status,
        fine_amount,
        return_date,
        created_at
      )
      VALUES ($1, $2, $3, $4, $5, 'Borrowed', 0, NULL, CURRENT_TIMESTAMP)
      RETURNING *
    `, [member_id, book_id, requestedQty, issue_date, due_date]);
    
    console.log('✅ Borrow record created successfully:', insertResult.rows[0]);
    
    await client.query('COMMIT');
    console.log('✅ Transaction committed');
    
    // Send success response
    res.status(201).json({
      success: true,
      message: 'Book borrowed successfully',
      borrow_record: {
        id: insertResult.rows[0].id,
        member_id: insertResult.rows[0].member_id,
        book_id: insertResult.rows[0].book_id,
        quantity: insertResult.rows[0].quantity,
        issue_date: insertResult.rows[0].issue_date,
        due_date: insertResult.rows[0].due_date,
        status: insertResult.rows[0].status
      },
      book: {
        id: book.id,
        title: book.title,
        old_quantity: availableQty,
        new_quantity: updateResult.rows[0].quantity
      },
      member: {
        id: member.id,
        name: member.name
      }
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('❌ Error creating borrow record:', error.message);
    
    // Send detailed error response
    res.status(500).json({ 
      success: false,
      error: error.message
    });
  } finally {
    client.release();
    console.log('🔒 Database client released');
  }
});

// PUT return book with fine calculation and reservation check
router.put('/return/:id', async (req, res) => {
  const { id } = req.params;
  const { return_date } = req.body;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // Get borrow record with book details - LOCK the row
    const borrowResult = await client.query(`
      SELECT br.*, b.title as book_title, b.quantity as current_book_quantity
      FROM borrow_records br
      JOIN books b ON br.book_id = b.id
      WHERE br.id = $1
      FOR UPDATE
    `, [id]);
    
    if (borrowResult.rows.length === 0) throw new Error('Record not found');
    
    const borrow = borrowResult.rows[0];
    if (borrow.status === 'Returned') throw new Error('Already returned');
    
    // Get fine per day from settings
    const settingsResult = await client.query(
      "SELECT value FROM settings WHERE key = 'fine_per_day'"
    );
    const finePerDay = parseInt(settingsResult.rows[0]?.value || 10);
    
    // Calculate fine
    const due = new Date(borrow.due_date);
    const returned = new Date(return_date);
    let fineAmount = 0;
    let daysLate = 0;
    
    if (returned > due) {
      daysLate = Math.ceil((returned - due) / (1000 * 60 * 60 * 24));
      fineAmount = daysLate * finePerDay;
    }
    
    // Calculate new quantity (add back the borrowed copies)
    const newQuantity = borrow.current_book_quantity + borrow.quantity;
    console.log(`📊 Return stock calculation: ${borrow.current_book_quantity} + ${borrow.quantity} = ${newQuantity}`);
    
    // Update book quantity (add back the borrowed copies)
    await client.query('UPDATE books SET quantity = $1 WHERE id = $2', 
      [newQuantity, borrow.book_id]);
    
    // Update borrow record
    await client.query(`
      UPDATE borrow_records 
      SET return_date = $1, status = 'Returned', fine_amount = $2
      WHERE id = $3
    `, [return_date, fineAmount, id]);
    
    // UPDATE MEMBER'S FINE BALANCE
    if (fineAmount > 0) {
      const updateResult = await client.query(`
        UPDATE members 
        SET fine_balance = COALESCE(fine_balance, 0) + $1 
        WHERE id = $2 
        RETURNING fine_balance
      `, [fineAmount, borrow.member_id]);
      
      console.log(`Added ₹${fineAmount} fine to member ${borrow.member_id}. New balance: ₹${updateResult.rows[0]?.fine_balance}`);
      
      // Insert fine record for history
      await client.query(`
        INSERT INTO fines(member_id, borrow_record_id, amount, reason, paid)
        VALUES($1, $2, $3, $4, false)
      `, [borrow.member_id, id, fineAmount, `Late return of "${borrow.book_title}" - ${daysLate} days late`]);
    }
    
    // ========== CHECK FOR RESERVATIONS ==========
    const reservations = await client.query(`
      SELECT r.id, r.member_id, m.email, m.name
      FROM reservations r
      JOIN members m ON r.member_id = m.id
      WHERE r.book_id = $1 AND r.status = 'pending' AND r.notified = false
      ORDER BY r.reservation_date ASC
      LIMIT 1
    `, [borrow.book_id]);
    
    if (reservations.rows.length > 0) {
      const reservation = reservations.rows[0];
      await client.query(`
        UPDATE reservations SET notified = true, status = 'notified'
        WHERE id = $1
      `, [reservation.id]);
      
      console.log(`📧 NOTIFICATION: ${reservation.name} (${reservation.email}) - Book "${borrow.book_title}" is now available!`);
    }
    // ========== END RESERVATION CHECK ==========
    
    await client.query('COMMIT');
    
    // Get updated member info
    const memberResult = await client.query(
      'SELECT name, COALESCE(fine_balance, 0) as fine_balance FROM members WHERE id = $1',
      [borrow.member_id]
    );
    
    res.json({ 
      message: 'Book returned successfully', 
      fineAmount,
      daysLate,
      memberName: memberResult.rows[0]?.name,
      newFineBalance: memberResult.rows[0]?.fine_balance
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Return error:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET most active member (based on borrow count from ALL records)
router.get('/stats/most-active-member', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        m.id,
        m.name,
        m.email,
        COUNT(br.id) as total_borrows,
        SUM(br.quantity) as total_books_borrowed
      FROM members m
      JOIN borrow_records br ON m.id = br.member_id
      GROUP BY m.id, m.name, m.email
      ORDER BY total_books_borrowed DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return res.json({ 
        most_active_member: 'No data yet',
        total_borrows: 0 
      });
    }
    
    res.json({
      most_active_member: result.rows[0].name,
      member_id: result.rows[0].id,
      total_borrows: parseInt(result.rows[0].total_books_borrowed),
      total_transactions: parseInt(result.rows[0].total_borrows)
    });
  } catch (error) {
    console.error('Error fetching most active member:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET most borrowed book (based on borrow_records from ALL records)
router.get('/stats/most-borrowed-book', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        b.id,
        b.title,
        b.author,
        SUM(br.quantity) as total_borrowed
      FROM books b
      JOIN borrow_records br ON b.id = br.book_id
      GROUP BY b.id, b.title, b.author
      ORDER BY total_borrowed DESC
      LIMIT 1
    `);
    
    if (result.rows.length === 0) {
      return res.json({ 
        most_borrowed_book: 'No data yet',
        total_borrowed: 0 
      });
    }
    
    res.json({
      most_borrowed_book: result.rows[0].title,
      book_id: result.rows[0].id,
      author: result.rows[0].author,
      total_borrowed: parseInt(result.rows[0].total_borrowed)
    });
  } catch (error) {
    console.error('Error fetching most borrowed book:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET complete borrow statistics (using ALL records)
router.get('/stats/summary', async (req, res) => {
  try {
    // Most active member (based on total books borrowed)
    const activeMemberResult = await db.query(`
      SELECT 
        m.name,
        COUNT(br.id) as borrow_count,
        SUM(br.quantity) as total_books
      FROM members m
      JOIN borrow_records br ON m.id = br.member_id
      GROUP BY m.id, m.name
      ORDER BY total_books DESC
      LIMIT 1
    `);
    
    // Most borrowed book (based on total quantity)
    const mostBookResult = await db.query(`
      SELECT 
        b.title,
        b.author,
        SUM(br.quantity) as total_borrowed
      FROM books b
      JOIN borrow_records br ON b.id = br.book_id
      GROUP BY b.id, b.title, b.author
      ORDER BY total_borrowed DESC
      LIMIT 1
    `);
    
    // Total borrow statistics (from ALL records)
    const statsResult = await db.query(`
      SELECT 
        COUNT(*) as total_transactions,
        SUM(quantity) as total_books_borrowed,
        COUNT(DISTINCT member_id) as unique_borrowers,
        COUNT(DISTINCT book_id) as unique_books_borrowed
      FROM borrow_records
    `);
    
    // Get top 5 most borrowed books for leaderboard
    const topBooksResult = await db.query(`
      SELECT 
        b.title,
        b.author,
        SUM(br.quantity) as total_borrowed
      FROM books b
      JOIN borrow_records br ON b.id = br.book_id
      GROUP BY b.id, b.title, b.author
      ORDER BY total_borrowed DESC
      LIMIT 5
    `);
    
    // Get top 5 most active members for leaderboard
    const topMembersResult = await db.query(`
      SELECT 
        m.name,
        SUM(br.quantity) as total_books
      FROM members m
      JOIN borrow_records br ON m.id = br.member_id
      GROUP BY m.id, m.name
      ORDER BY total_books DESC
      LIMIT 5
    `);
    
    res.json({
      most_active_member: activeMemberResult.rows[0]?.name || 'No data',
      most_active_member_books: parseInt(activeMemberResult.rows[0]?.total_books || 0),
      most_borrowed_book: mostBookResult.rows[0]?.title || 'No data',
      most_borrowed_book_author: mostBookResult.rows[0]?.author || '',
      most_borrowed_book_count: parseInt(mostBookResult.rows[0]?.total_borrowed || 0),
      total_transactions: parseInt(statsResult.rows[0].total_transactions || 0),
      total_books_borrowed: parseInt(statsResult.rows[0].total_books_borrowed || 0),
      unique_borrowers: parseInt(statsResult.rows[0].unique_borrowers || 0),
      unique_books_borrowed: parseInt(statsResult.rows[0].unique_books_borrowed || 0),
      top_books: topBooksResult.rows,
      top_members: topMembersResult.rows
    });
  } catch (error) {
    console.error('Error fetching borrow statistics:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
