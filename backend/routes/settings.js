const express = require('express');
const router = express.Router();
const db = require('../db');

// GET all settings
router.get('/', async (req, res) => {
  try {
    const result = await db.query('SELECT key, value FROM settings');
    const settings = {};
    result.rows.forEach(row => {
      settings[row.key] = row.value;
    });
    res.json(settings);
  } catch (error) {
    console.error('Error fetching settings:', error);
    res.status(500).json({ error: error.message });
  }
});

// PUT update settings (creates if not exists)
router.put('/', async (req, res) => {
  const { fine_per_day, library_name, admin_email } = req.body;
  const client = await db.connect();
  
  try {
    await client.query('BEGIN');
    
    if (fine_per_day) {
      await client.query(`
        INSERT INTO settings (key, value, updated_at) 
        VALUES ('fine_per_day', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `, [fine_per_day.toString()]);
    }
    
    if (library_name) {
      await client.query(`
        INSERT INTO settings (key, value, updated_at) 
        VALUES ('library_name', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `, [library_name]);
    }
    
    if (admin_email) {
      await client.query(`
        INSERT INTO settings (key, value, updated_at) 
        VALUES ('admin_email', $1, CURRENT_TIMESTAMP)
        ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      `, [admin_email]);
    }
    
    await client.query('COMMIT');
    console.log('Settings updated:', { fine_per_day, library_name, admin_email });
    res.json({ message: 'Settings updated successfully' });
  } catch (error) {
    await client.query('ROLLBACK');
    console.error('Error saving settings:', error);
    res.status(500).json({ error: error.message });
  } finally {
    client.release();
  }
});

// Optional: POST to create/update single setting
router.post('/', async (req, res) => {
  const { key, value } = req.body;
  
  if (!key || value === undefined) {
    return res.status(400).json({ error: 'Key and value are required' });
  }
  
  try {
    const result = await db.query(`
      INSERT INTO settings (key, value, updated_at) 
      VALUES ($1, $2, CURRENT_TIMESTAMP)
      ON CONFLICT (key) DO UPDATE SET value = EXCLUDED.value, updated_at = EXCLUDED.updated_at
      RETURNING *
    `, [key, value.toString()]);
    
    res.json({ message: 'Setting saved', setting: result.rows[0] });
  } catch (error) {
    console.error('Error saving setting:', error);
    res.status(500).json({ error: error.message });
  }
});

module.exports = router;
