const express = require('express');
const mongoose = require('mongoose');
const cors = require('cors');
const http = require('http');
const socketio = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');

const app = express();
const server = http.createServer(app);
const io = socketio(server, {
  cors: {
    origin: "*",
    methods: ["GET", "POST"]
  }
});

app.use(cors());
app.use(express.json());

// ============================================
// GANTI INI NANTI SETELAH DAPET MONGODB URL
// ============================================
const MONGODB_URL = 'isi_nanti_setelah_bikin_mongodb';

mongoose.connect(MONGODB_URL)
.then(() => console.log('✅ Database connected'))
.catch(err => console.log('❌ Database error:', err));

// ============================================
// SCHEMA
// ============================================
const UserSchema = new mongoose.Schema({
  username: { type: String, required: true, unique: true },
  password: { type: String, required: true },
  nama: String,
  status: { type: String, default: "online" },
  lastSeen: Date,
  location: {
    lat: Number,
    lng: Number
  },
  isVip: { type: Boolean, default: false },
  avatar: String
});

const MessageSchema = new mongoose.Schema({
  from: String,
  to: String,
  message: String,
  timestamp: { type: Date, default: Date.now },
  isRead: { type: Boolean, default: false }
});

const User = mongoose.model('User', UserSchema);
const Message = mongoose.model('Message', MessageSchema);

// ============================================
// API REGISTER
// ============================================
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, nama } = req.body;
    
    const existing = await User.findOne({ username });
    if (existing) {
      return res.json({ success: false, message: 'Username sudah dipakai' });
    }
    
    const hashedPassword = await bcrypt.hash(password, 10);
    
    const user = new User({
      username,
      password: hashedPassword,
      nama: nama || username,
      avatar: `https://ui-avatars.com/api/?name=${username}&background=1DB954&color=fff`
    });
    
    await user.save();
    res.json({ success: true, message: 'Register berhasil' });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// API LOGIN
// ============================================
app.post('/api/login', async (req, res) => {
  try {
    const { username, password } = req.body;
    
    const user = await User.findOne({ username });
    if (!user) {
      return res.json({ success: false, message: 'User tidak ditemukan' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.json({ success: false, message: 'Password salah' });
    }
    
    user.status = 'online';
    user.lastSeen = new Date();
    await user.save();
    
    const token = jwt.sign(
      { id: user._id, username: user.username },
      'rahasia123'
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user._id,
        username: user.username,
        nama: user.nama,
        isVip: user.isVip,
        avatar: user.avatar
      }
    });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// API UPDATE LOKASI
// ============================================
app.post('/api/location', async (req, res) => {
  try {
    const { token, lat, lng } = req.body;
    
    const decoded = jwt.verify(token, 'rahasia123');
    await User.updateOne(
      { username: decoded.username },
      { location: { lat, lng } }
    );
    
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// API GET USERS
// ============================================
app.get('/api/users', async (req, res) => {
  try {
    const users = await User.find({}, 'username nama status location isVip avatar');
    res.json({ success: true, users });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// API GET MESSAGES
// ============================================
app.get('/api/messages/:from/:to', async (req, res) => {
  try {
    const { from, to } = req.params;
    
    const messages = await Message.find({
      $or: [
        { from, to },
        { from: to, to: from }
      ]
    }).sort({ timestamp: 1 }).limit(50);
    
    res.json({ success: true, messages });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// SOCKET.IO
// ============================================
const onlineUsers = new Map();

io.on('connection', (socket) => {
  console.log('User connected:', socket.id);
  
  socket.on('login', (username) => {
    onlineUsers.set(username, socket.id);
    socket.username = username;
    io.emit('user-online', username);
  });
  
  socket.on('send-location', (data) => {
    const { username, lat, lng } = data;
    socket.broadcast.emit('user-location', { username, lat, lng });
  });
  
  socket.on('send-message', async (data) => {
    const { from, to, message } = data;
    
    const msg = new Message({ from, to, message });
    await msg.save();
    
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('new-message', {
        from, to, message,
        timestamp: new Date()
      });
    }
    
    socket.emit('message-sent', { success: true });
  });
  
  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('user-offline', socket.username);
    }
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 3000;
server.listen(PORT, () => {
  console.log(`✅ Server jalan di port ${PORT}`);
});
