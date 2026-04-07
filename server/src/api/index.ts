import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import validator from 'validator';

dotenv.config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ericktorresadm_db_user:FBra8yqPipxOVFSy@clusterfastproxy.tdun6hv.mongodb.net/fastproxy?appName=clusterfastproxy';

let isConnected = false;
let connectPromise: Promise<void> | null = null;

const connectDB = async () => {
  if (isConnected || mongoose.connection.readyState === 1) return;
  if (connectPromise) return connectPromise;
  
  connectPromise = (async () => {
    try {
      await mongoose.connect(MONGODB_URI, { 
        maxPoolSize: 1,
        serverSelectionTimeoutMS: 30000,
        socketTimeoutMS: 30000,
        bufferCommands: false,
      });
      isConnected = true;
      console.log('MongoDB connected');
    } catch (err: any) {
      console.error('MongoDB error:', err.message);
      connectPromise = null;
      throw err;
    }
  })();
  
  return connectPromise;
};

const sanitize = (str: string): string => {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, 500).replace(/[<>]/g, '');
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ origin: '*', credentials: true }));
app.use(express.json({ limit: '50kb' }));

const userSchema = new mongoose.Schema({
  name: { type: String, required: true, trim: true },
  email: { type: String, required: true, unique: true, lowercase: true },
  password: { type: String, required: true },
  whatsapp: { type: String },
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive: { type: Boolean, default: true },
  proxyCount: { type: Number, default: 0 }
}, { timestamps: true });

userSchema.pre('save', async function(next) {
  if (!this.isModified('password')) return next();
  this.password = await bcrypt.hash(this.password, 12);
  next();
});

userSchema.methods.comparePassword = function(candidatePassword: string) {
  return bcrypt.compare(candidatePassword, this.password);
};

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Plan = mongoose.models.Plan || mongoose.model('Plan', new mongoose.Schema({
  name: String, tier: String, price: Number, proxyCount: Number, isActive: { type: Boolean, default: true }
}, { timestamps: true }));
const Proxy = mongoose.models.Proxy || mongoose.model('Proxy', new mongoose.Schema({
  ip: String, port: Number, username: String, password: String, tier: { type: String, default: 'shared' },
  status: { type: String, default: 'available' }, assignedTo: mongoose.Schema.Types.ObjectId, assignedAt: Date, orderId: mongoose.Schema.Types.ObjectId, expiresAt: Date
}, { timestamps: true }));
const Order = mongoose.models.Order || mongoose.model('Order', new mongoose.Schema({
  userId: mongoose.Schema.Types.ObjectId, planId: mongoose.Schema.Types.ObjectId,
  status: { type: String, default: 'pending' }, expiresAt: Date
}, { timestamps: true }));

const authenticate = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) return res.status(401).json({ success: false, message: 'Token não fornecido' });
    const token = authHeader.split(' ')[1];
    const decoded: any = jwt.verify(token, JWT_SECRET);
    await connectDB();
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ success: false, message: 'Usuário não encontrado' });
    req.user = { userId: user._id.toString(), email: user.email, role: user.role };
    next();
  } catch { res.status(401).json({ success: false, message: 'Token inválido' }); }
};

const adminOnly = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') return res.status(403).json({ success: false, message: 'Acesso restrito' });
  next();
};

app.get('/api/health', (req, res) => res.json({ success: true, message: 'FastProxy API funcionando!', timestamp: new Date().toISOString() }));

app.post('/api/auth/register', async (req: any, res: any) => {
  try {
    await connectDB();
    const { name, email, password, whatsapp } = req.body;
    if (!name || name.length < 2) return res.status(400).json({ success: false, message: 'Nome muito curto' });
    if (!email || !validator.isEmail(email)) return res.status(400).json({ success: false, message: 'Email inválido' });
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: 'Senha mínimo 6 caracteres' });
    const existing = await User.findOne({ email: email.toLowerCase() });
    if (existing) return res.status(400).json({ success: false, message: 'Email já cadastrado' });
    const user = await User.create({ name, email: email.toLowerCase(), password, whatsapp });
    const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    res.status(201).json({ success: true, data: { user: { id: user._id, name, email, role: user.role }, token } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/auth/login', async (req: any, res: any) => {
  try {
    await connectDB();
    const { email, password } = req.body;
    if (!email || !password) return res.status(400).json({ success: false, message: 'Dados obrigatórios' });
    const user: any = await User.findOne({ email: email.toLowerCase() }).select('+password');
    if (!user) return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    const isMatch = await user.comparePassword(password);
    if (!isMatch) return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    if (!user.isActive) return res.status(403).json({ success: false, message: 'Conta desativada' });
    const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, data: { user: { id: user._id, name: user.name, email: user.email, role: user.role }, token } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/auth/me', authenticate, async (req: any, res: any) => {
  try {
    await connectDB();
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    res.json({ success: true, data: { user: { id: user._id, name: user.name, email: user.email, whatsapp: user.whatsapp, role: user.role } } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/plans', async (req: any, res: any) => {
  try {
    await connectDB();
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({ success: true, data: { plans } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/proxies', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    await connectDB();
    const proxies = await Proxy.find().populate('assignedTo', 'name email').sort({ createdAt: -1 });
    res.json({ success: true, data: { proxies } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/proxies/my', authenticate, async (req: any, res: any) => {
  try {
    await connectDB();
    const proxies = await Proxy.find({ assignedTo: req.user.userId, status: 'active' });
    res.json({ success: true, data: { proxies } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/proxies/bulk', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    await connectDB();
    const { proxies } = req.body;
    if (!proxies || !Array.isArray(proxies)) return res.status(400).json({ success: false, message: 'Proxies inválidos' });
    const docs = proxies.slice(0, 100).map((p: any) => {
      const proxyStr = p.proxy || '';
      const match = proxyStr.match(/^(.+?):(.+?)@(.+?):(\d+)$/);
      if (match) return { username: sanitize(match[1]), password: sanitize(match[2]), ip: sanitize(match[3]), port: parseInt(match[4]), tier: p.tier || 'shared', status: 'available' };
      return null;
    }).filter((p: any) => p && p.ip && p.port && p.username && p.password);
    if (docs.length === 0) return res.status(400).json({ success: false, message: 'Nenhum proxy válido (formato: user:pass@ip:port)' });
    await Proxy.insertMany(docs);
    res.json({ success: true, data: { count: docs.length } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/orders', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    await connectDB();
    const orders = await Order.find().populate('userId', 'name email whatsapp').populate('planId', 'name tier').sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.get('/api/orders/my', authenticate, async (req: any, res: any) => {
  try {
    await connectDB();
    const orders = await Order.find({ userId: req.user.userId }).populate('planId', 'name tier proxyCount').sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/orders', authenticate, async (req: any, res: any) => {
  try {
    await connectDB();
    const { planId } = req.body;
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plano não encontrado' });
    const order = await Order.create({ userId: req.user.userId, planId, status: 'pending' });
    res.status(201).json({ success: true, data: { order } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/orders/:id/approve', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    await connectDB();
    const order = await Order.findById(req.params.id).populate('planId');
    if (!order) return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    const plan: any = order.planId;
    const proxyCount = plan.proxyCount || 1;
    const availableProxies = await Proxy.find({ status: 'available' }).limit(proxyCount);
    if (availableProxies.length < proxyCount) return res.status(400).json({ success: false, message: 'Sem proxies suficientes em estoque' });
    const proxyIds = availableProxies.map((p: any) => p._id);
    await Proxy.updateMany({ _id: { $in: proxyIds } }, { status: 'active', assignedTo: order.userId, assignedAt: new Date(), orderId: order._id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) });
    await User.findByIdAndUpdate(order.userId, { $inc: { proxyCount: proxyCount } });
    order.status = 'active';
    order.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await order.save();
    res.json({ success: true, data: { order, proxiesAssigned: proxyCount } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

app.post('/api/orders/:id/reject', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    await connectDB();
    const order = await Order.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
    if (!order) return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    res.json({ success: true, data: { order } });
  } catch (error: any) { res.status(500).json({ success: false, message: error.message }); }
});

export default app;