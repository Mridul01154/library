const express = require('express');
const cors = require('cors');
const booksRoutes = require('./routes/books');
const membersRoutes = require('./routes/members');
const borrowRoutes = require('./routes/borrow');
const settingsRoutes = require('./routes/settings');
const reviewsRoutes = require('./routes/reviews');
const reservationsRoutes = require('./routes/reservations');

const app = express();

app.use(cors());
app.use(express.json());

// Register all routes
app.use('/api/books', booksRoutes);
app.use('/api/members', membersRoutes);
app.use('/api/borrow', borrowRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/reviews', reviewsRoutes);        // ← MAKE SURE THIS EXISTS
app.use('/api/reservations', reservationsRoutes);  // ← MAKE SURE THIS EXISTS

app.listen(5000, () => {
  console.log('✅ Server running on port 5000');
  console.log('📚 Routes registered:');
  console.log('   - /api/books');
  console.log('   - /api/members');
  console.log('   - /api/borrow');
  console.log('   - /api/settings');
  console.log('   - /api/reviews');
  console.log('   - /api/reservations');
});