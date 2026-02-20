const express = require('express');
const http = require('http');
const socketio = require('socket.io');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const cors = require('cors');
const fs = require('fs');

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
// DATABASE SEDERHANA (PAKE FILE JSON)
// ============================================
const DB_PATH = './db.json';

// Inisialisasi database kalo belum ada
if (!fs.existsSync(DB_PATH)) {
  fs.writeFileSync(DB_PATH, JSON.stringify({
    users: [],
    messages: []
  }, null, 2));
}

// Fungsi baca database
const readDB = () => {
  try {
    const data = fs.readFileSync(DB_PATH, 'utf8');
    return JSON.parse(data);
  } catch (error) {
    console.log('Error baca DB:', error.message);
    return { users: [], messages: [] };
  }
};

// Fungsi tulis database
const writeDB = (data) => {
  try {
    fs.writeFileSync(DB_PATH, JSON.stringify(data, null, 2));
    return true;
  } catch (error) {
    console.log('Error tulis DB:', error.message);
    return false;
  }
};

console.log('✅ Database siap (pake file JSON)');

// ============================================
// API REGISTER
// ============================================
app.post('/api/register', async (req, res) => {
  try {
    const { username, password, nama } = req.body;
    
    const db = readDB();
    
    // Cek username udah ada
    const existing = db.users.find(u => u.username === username);
    if (existing) {
      return res.json({ success: false, message: 'Username sudah dipakai' });
    }
    
    // Hash password
    const hashedPassword = await bcrypt.hash(password, 10);
    
    // Buat user baru
    const newUser = {
      id: Date.now().toString(),
      username,
      password: hashedPassword,
      nama: nama || username,
      status: 'online',
      lastSeen: new Date().toISOString(),
      location: { lat: -6.2088, lng: 106.8456 },
      isVip: false,
      avatar: `https://ui-avatars.com/api/?name=${username}&background=1DB954&color=fff`
    };
    
    db.users.push(newUser);
    writeDB(db);
    
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
    
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    
    if (!user) {
      return res.json({ success: false, message: 'User tidak ditemukan' });
    }
    
    const valid = await bcrypt.compare(password, user.password);
    if (!valid) {
      return res.json({ success: false, message: 'Password salah' });
    }
    
    // Update status
    user.status = 'online';
    user.lastSeen = new Date().toISOString();
    writeDB(db);
    
    // Buat token
    const token = jwt.sign(
      { id: user.id, username: user.username },
      'rahasia123'
    );
    
    res.json({
      success: true,
      token,
      user: {
        id: user.id,
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
    const db = readDB();
    
    const user = db.users.find(u => u.username === decoded.username);
    if (user) {
      user.location = { lat, lng };
      writeDB(db);
    }
    
    res.json({ success: true });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// API GET USERS
// ============================================
app.get('/api/users', (req, res) => {
  const db = readDB();
  const users = db.users.map(u => ({
    username: u.username,
    nama: u.nama,
    status: u.status,
    location: u.location,
    isVip: u.isVip,
    avatar: u.avatar
  }));
  res.json({ success: true, users });
});

// ============================================
// API GET MESSAGES
// ============================================
app.get('/api/messages/:from/:to', (req, res) => {
  try {
    const { from, to } = req.params;
    const db = readDB();
    
    const messages = db.messages
      .filter(m => (m.from === from && m.to === to) || (m.from === to && m.to === from))
      .sort((a, b) => new Date(a.timestamp) - new Date(b.timestamp))
      .slice(-50);
    
    res.json({ success: true, messages });
  } catch (error) {
    res.json({ success: false, message: error.message });
  }
});

// ============================================
// ROOT ENDPOINT
// ============================================
app.get('/', (req, res) => {
  res.json({ 
    message: 'API WARPONG-POS berjalan!',
    endpoints: [
      '/api/users',
      '/api/register',
      '/api/login',
      '/api/location',
      '/api/messages/:from/:to'
    ]
  });
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
    
    // Update status di database
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (user) {
      user.status = 'online';
      writeDB(db);
    }
  });
  
  socket.on('send-location', (data) => {
    const { username, lat, lng } = data;
    
    // Update database
    const db = readDB();
    const user = db.users.find(u => u.username === username);
    if (user) {
      user.location = { lat, lng };
      writeDB(db);
    }
    
    socket.broadcast.emit('user-location', { username, lat, lng });
  });
  
  socket.on('send-message', (data) => {
    const { from, to, message } = data;
    
    // Simpan ke database
    const db = readDB();
    db.messages.push({
      from,
      to,
      message,
      timestamp: new Date().toISOString()
    });
    writeDB(db);
    
    // Kirim ke penerima kalo online
    const targetSocket = onlineUsers.get(to);
    if (targetSocket) {
      io.to(targetSocket).emit('new-message', {
        from,
        to,
        message,
        timestamp: new Date()
      });
    }
    
    socket.emit('message-sent', { success: true });
  });
  
  socket.on('disconnect', () => {
    if (socket.username) {
      onlineUsers.delete(socket.username);
      io.emit('user-offline', socket.username);
      
      // Update status di database
      const db = readDB();
      const user = db.users.find(u => u.username === socket.username);
      if (user) {
        user.status = 'offline';
        writeDB(db);
      }
    }
  });
});

// ============================================
// START SERVER
// ============================================
const PORT = process.env.PORT || 8080;
server.listen(PORT, '0.0.0.0', () => {
  console.log(`✅ Server berjalan di port ${PORT}`);
});
