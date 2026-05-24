const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all members with fine_balance
router.get('/', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT id, name, email, phone, membership_type, status, joined_date, 
             COALESCE(fine_balance, 0) as fine_balance
      FROM members 
      ORDER BY id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching members:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET single member
router.get('/:id', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT m.*, COALESCE(m.fine_balance, 0) as fine_balance,
        (SELECT COUNT(*) FROM borrow_records WHERE member_id = m.id AND status = 'Borrowed') as active_borrows
      FROM members m
      WHERE m.id = $1
    `, [req.params.id]);
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching member:', error);
    res.status(500).json({ error: error.message });
  }
});

// POST new member
router.post('/', async (req, res) => {
  const { name, email, phone, membership_type, status } = req.body;
  try {
    const result = await db.query(
      `INSERT INTO members(name, email, phone, membership_type, status, joined_date, fine_balance) 
       VALUES($1, $2, $3, $4, $5, CURRENT_DATE, 0) 
       RETURNING *`,
      [name, email, phone, membership_type, status || 'Active']
    );
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error creating member:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update member
router.put('/:id', async (req, res) => {
  const { name, email, phone, membership_type, status } = req.body;
  const { id } = req.params;
  try {
    const result = await db.query(
      `UPDATE members 
       SET name=$1, email=$2, phone=$3, membership_type=$4, status=$5 
       WHERE id=$6 
       RETURNING *`,
      [name, email, phone, membership_type, status, id]
    );
    
    if (result.rows.length === 0) {
      return res.status(404).json({ error: 'Member not found' });
    }
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error updating member:', error);
    res.status(500).json({ error: error.message });
  }
});

// ==================== FINE ENDPOINTS ====================

// POST pay fine - FIXED to match your fines table structure
router.post('/pay-fine', async (req, res) => {
  console.log('Pay-fine endpoint called with body:', req.body);
  
  const { member_id, amount } = req.body;
  
  // Validate input
  if (!member_id) {
    return res.status(400).json({ error: 'Member ID is required' });
  }
  
  if (!amount || amount <= 0) {
    return res.status(400).json({ error: 'Valid payment amount is required' });
  }
  
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    // First, check if member exists and get current fine balance
    const balanceCheck = await client.query(
      'SELECT id, name, COALESCE(fine_balance, 0) as fine_balance FROM members WHERE id = $1',
      [member_id]
    );
    
    if (balanceCheck.rows.length === 0) {
      throw new Error('Member not found');
    }
    
    const currentBalance = parseFloat(balanceCheck.rows[0].fine_balance);
    const memberName = balanceCheck.rows[0].name;
    
    console.log(`Member ${memberName} (ID: ${member_id}) has fine balance: ₹${currentBalance}`);
    
    if (amount > currentBalance) {
      throw new Error(`Payment amount (₹${amount}) exceeds fine balance (₹${currentBalance})`);
    }
    
    // Update member's fine balance
    const result = await client.query(
      'UPDATE members SET fine_balance = COALESCE(fine_balance, 0) - $1 WHERE id = $2 RETURNING fine_balance',
      [amount, member_id]
    );
    
    const newBalance = result.rows[0].fine_balance;
    
    // Record the payment in fines table - MATCHING YOUR TABLE STRUCTURE
    // Your table has columns: id, member_id, borrow_record_id, amount, reason, paid, paid_date, created_at
    await client.query(
      `INSERT INTO fines (member_id, borrow_record_id, amount, reason, paid, paid_date, created_at) 
       VALUES ($1, NULL, $2, $3, true, CURRENT_DATE, CURRENT_TIMESTAMP)`,
      [member_id, amount, `Fine payment received from ${memberName}`]
    );
    
    await client.query('COMMIT');
    
    // Get updated collected fines total
    const collectedTotal = await client.query(
      'SELECT COALESCE(SUM(amount), 0) as total FROM fines WHERE paid = true'
    );
    
    console.log(`✅ Payment successful: ${memberName} paid ₹${amount}, new balance: ₹${newBalance}`);
    console.log(`Total collected fines now: ₹${collectedTotal.rows[0].total}`);
    
    res.json({ 
      success: true,
      message: 'Payment successful', 
      new_balance: newBalance,
      amount_paid: amount,
      member_name: memberName,
      total_collected: parseFloat(collectedTotal.rows[0].total)
    });
    
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Payment error:', error.message);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// GET total collected fines (paid fines)
router.get('/collected-fines/total', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT COALESCE(SUM(amount), 0) as total_collected
      FROM fines 
      WHERE paid = true
    `);
    console.log(`Total collected fines: ₹${result.rows[0].total_collected}`);
    res.json({ total_collected: parseFloat(result.rows[0].total_collected) });
  } catch (error) {
    console.error('Error fetching collected fines:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET total outstanding fines (unpaid from members table)
router.get('/outstanding-fines/total', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT COALESCE(SUM(fine_balance), 0) as total_outstanding
      FROM members
    `);
    res.json({ total_outstanding: parseFloat(result.rows[0].total_outstanding) });
  } catch (error) {
    console.error('Error fetching outstanding fines:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all fines records for a member
router.get('/fines/member/:memberId', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT f.*, 
             CASE 
               WHEN f.paid = true THEN 'Paid'
               ELSE 'Unpaid'
             END as payment_status
      FROM fines f
      WHERE f.member_id = $1
      ORDER BY f.created_at DESC
    `, [req.params.memberId]);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching member fines:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all fines summary
router.get('/fines/summary', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT 
        COUNT(*) as total_fines,
        COALESCE(SUM(CASE WHEN paid = false THEN amount ELSE 0 END), 0) as total_unpaid,
        COALESCE(SUM(CASE WHEN paid = true THEN amount ELSE 0 END), 0) as total_paid,
        COUNT(CASE WHEN paid = false THEN 1 END) as unpaid_count,
        COUNT(CASE WHEN paid = true THEN 1 END) as paid_count
      FROM fines
    `);
    res.json(result.rows[0]);
  } catch (error) {
    console.error('Error fetching fines summary:', error);
    res.status(500).json({ error: error.message });
  }
});

// GET all fines (for debugging)
router.get('/fines/all', async (req, res) => {
  try {
    const result = await db.query(`
      SELECT f.*, m.name as member_name 
      FROM fines f
      JOIN members m ON f.member_id = m.id
      ORDER BY f.created_at DESC
    `);
    res.json(result.rows);
  } catch (error) {
    console.error('Error fetching all fines:', error);
    res.status(500).json({ error: error.message });
  }
});

// DELETE member
router.delete('/:id', async (req, res) => {
  const { id } = req.params;
  try {
    // Check if member has active borrows
    const activeBorrows = await db.query(
      'SELECT COUNT(*) FROM borrow_records WHERE member_id = $1 AND status = $2',
      [id, 'Borrowed']
    );
    
    if (parseInt(activeBorrows.rows[0].count) > 0) {
      return res.status(400).json({ error: 'Cannot delete member with active borrows' });
    }
    
    // Check if member has unpaid fines
    const fineBalance = await db.query(
      'SELECT COALESCE(fine_balance, 0) as fine_balance FROM members WHERE id = $1',
      [id]
    );
    
    if (parseFloat(fineBalance.rows[0]?.fine_balance || 0) > 0) {
      return res.status(400).json({ error: 'Cannot delete member with unpaid fines' });
    }
    
    await db.query('DELETE FROM members WHERE id=$1', [id]);
    res.json({ message: 'Member deleted' });
  } catch (error) {
    console.error('Error deleting member:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;