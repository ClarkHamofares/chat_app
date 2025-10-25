/*
Simple full chat server:
- Express + Socket.io
- MongoDB via Mongoose (set MONGODB_URI)
- JWT auth
- File uploads via multer (stores in /uploads and serves statically)
Env variables:
- MONGODB_URI
- JWT_SECRET
- PORT (optional)
*/
require('dotenv').config();
const express = require('express');
const http = require('http');
const cors = require('cors');
const mongoose = require('mongoose');
const bcrypt = require('bcrypt');
const jwt = require('jsonwebtoken');
const multer = require('multer');
const path = require('path');
const { v4: uuidv4 } = require('uuid');
const { Server } = require('socket.io');

const JWT_SECRET = process.env.JWT_SECRET || 'change_this_secret';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb://localhost:27017/chat_app';
const PORT = process.env.PORT || 3000;

const app = express();
app.use(cors());
app.use(express.json());
app.use('/uploads', express.static(path.join(__dirname, 'uploads')));
app.use(express.static(path.join(__dirname, 'public')));

// MongoDB models
mongoose.connect(MONGODB_URI, { useNewUrlParser: true, useUnifiedTopology: true })
  .then(()=> console.log('MongoDB connected'))
  .catch(err=> console.error('MongoDB error', err));

const userSchema = new mongoose.Schema({
  email: { type: String, unique: true, required: true },
  passwordHash: String,
  displayName: String,
  createdAt: { type: Date, default: Date.now }
});
const User = mongoose.model('User', userSchema);

const messageSchema = new mongoose.Schema({
  from: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  to: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  text: String,
  mediaUrl: String,
  mediaType: String,
  createdAt: { type: Date, default: Date.now }
});
const Message = mongoose.model('Message', messageSchema);

// Helpers
function createToken(user) {
  return jwt.sign({ id: user._id, email: user.email, displayName: user.displayName }, JWT_SECRET, { expiresIn: '7d' });
}

function authMiddleware(req, res, next) {
  const header = req.headers.authorization;
  if (!header) return res.status(401).json({ error: 'no token' });
  const token = header.split(' ')[1];
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(401).json({ error: 'invalid token' });
    req.user = decoded;
    next();
  });
}

// Multer setup for uploads (images/videos)
const storage = multer.diskStorage({
  destination: function (req, file, cb) {
    cb(null, 'uploads/');
  },
  filename: function (req, file, cb) {
    const ext = path.extname(file.originalname);
    cb(null, uuidv4() + ext);
  }
});
const upload = multer({
  storage,
  limits: { fileSize: 50 * 1024 * 1024 }, // 50MB limit
  fileFilter: function (req, file, cb) {
    // accept images and videos
    if (file.mimetype.startsWith('image/') || file.mimetype.startsWith('video/')) {
      cb(null, true);
    } else {
      cb(new Error('Only images and videos are allowed'));
    }
  }
});

// Routes
app.post('/api/register', async (req, res) => {
  try {
    const { email, password, displayName } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ error: 'email already taken' });
    const hash = await bcrypt.hash(password, 10);
    const user = await User.create({ email, passwordHash: hash, displayName: displayName || email });
    const token = createToken(user);
    res.json({ user: { id: user._id, email: user.email, displayName: user.displayName }, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.post('/api/login', async (req, res) => {
  try {
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ error: 'email and password required' });
    const user = await User.findOne({ email });
    if (!user) return res.status(400).json({ error: 'invalid credentials' });
    const ok = await bcrypt.compare(password, user.passwordHash);
    if (!ok) return res.status(400).json({ error: 'invalid credentials' });
    const token = createToken(user);
    res.json({ user: { id: user._id, email: user.email, displayName: user.displayName }, token });
  } catch (e) {
    console.error(e);
    res.status(500).json({ error: 'server error' });
  }
});

app.get('/api/users', authMiddleware, async (req, res) => {
  const users = await User.find({ _id: { $ne: req.user.id } }, 'email displayName');
  res.json({ users });
});

app.get('/api/messages', authMiddleware, async (req, res) => {
  const other = req.query.with;
  if (!other) return res.status(400).json({ error: 'with param required' });
  const messages = await Message.find({
    $or: [
      { from: req.user.id, to: other },
      { from: other, to: req.user.id }
    ]
  }).sort('createdAt').limit(100).exec();
  res.json({ messages });
});

app.post('/api/upload', authMiddleware, upload.single('file'), (req, res) => {
  if (!req.file) return res.status(400).json({ error: 'no file' });
  const url = `${req.protocol}://${req.get('host')}/uploads/${req.file.filename}`;
  res.json({ url, mimetype: req.file.mimetype });
});

// start server + socket.io
const server = http.createServer(app);
const io = new Server(server, { cors: { origin: '*', methods: ['GET','POST'] } });

const online = new Map();

io.use((socket, next) => {
  const token = socket.handshake.auth?.token || socket.handshake.query?.token;
  if (!token) return next(new Error('no token'));
  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return next(new Error('invalid token'));
    socket.user = decoded;
    next();
  });
});

io.on('connection', (socket) => {
  const user = socket.user;
  online.set(user.id, socket.id);
  io.emit('online_users', Array.from(online.keys()));
  console.log('connected', user.email);

  socket.on('private_message', async (payload) => {
    // payload: { to, text, mediaUrl, mediaType }
    const from = user.id;
    const to = payload.to;
    const text = payload.text || '';
    const mediaUrl = payload.mediaUrl || null;
    const mediaType = payload.mediaType || null;
    const msg = await Message.create({ from, to, text, mediaUrl, mediaType });
    const populated = await Message.findById(msg._id).populate('from','email displayName').exec();
    // Emit to sender
    socket.emit('message', populated);
    // Emit to recipient if online
    const recSocketId = online.get(String(to));
    if (recSocketId) {
      io.to(recSocketId).emit('message', populated);
    }
  });

  socket.on('disconnect', () => {
    online.delete(user.id);
    io.emit('online_users', Array.from(online.keys()));
  });
});

server.listen(PORT, ()=> {
  console.log('Server listening on port', PORT);
});