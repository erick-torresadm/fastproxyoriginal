import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import dotenv from 'dotenv';
import mongoose from 'mongoose';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import validator from 'validator';
import rateLimit from 'express-rate-limit';

dotenv.config();

const app = express();
const JWT_SECRET = process.env.JWT_SECRET || 'fastproxy_secret_key_2024';
const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ericktorresadm_db_user:FBra8yqPipxOVFSy@clusterfastproxy.tdun6hv.mongodb.net/fastproxy?appName=clusterfastproxy';

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  message: { success: false, message: 'Muitas requisições. Tente novamente em 15 minutos.' }
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 20,
  message: { success: false, message: 'Muitas tentativas de login. Tente novamente em 15 minutos.' }
});

const connectDB = async () => {
  if (mongoose.connection.readyState >= 1) return;
  try {
    await mongoose.connect(MONGODB_URI, {
      socketTimeoutMS: 30000,
      serverSelectionTimeoutMS: 30000,
      maxPoolSize: 10,
    });
    console.log('✅ MongoDB conectado!');
  } catch (error: any) {
    console.error('❌ MongoDB error:', error.message);
  }
};

const sanitize = (str: string): string => {
  if (typeof str !== 'string') return '';
  return str.trim().slice(0, 500).replace(/[<>]/g, '');
};

app.use(helmet({ contentSecurityPolicy: false }));
app.use(cors({ 
  origin: '*', 
  credentials: true 
}));
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

const planSchema = new mongoose.Schema({
  name: String,
  tier: { type: String, enum: ['starter', 'business', 'enterprise'] },
  price: Number,
  proxyCount: Number,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const Plan = mongoose.models.Plan || mongoose.model('Plan', planSchema);

const proxySchema = new mongoose.Schema({
  ip: { type: String, required: true },
  port: { type: Number, required: true },
  username: { type: String, required: true },
  password: { type: String, required: true },
  tier: { type: String, enum: ['shared', 'dedicated', 'premium'], default: 'shared' },
  status: { type: String, enum: ['available', 'active', 'expired'], default: 'available' },
  assignedTo: { type: mongoose.Schema.Types.ObjectId, ref: 'User' },
  assignedAt: Date,
  orderId: { type: mongoose.Schema.Types.ObjectId, ref: 'Order' },
  expiresAt: Date
}, { timestamps: true });

const Proxy = mongoose.models.Proxy || mongoose.model('Proxy', proxySchema);

const orderSchema = new mongoose.Schema({
  userId: { type: mongoose.Schema.Types.ObjectId, ref: 'User', required: true },
  planId: { type: mongoose.Schema.Types.ObjectId, ref: 'Plan', required: true },
  status: { type: String, enum: ['pending', 'approved', 'active', 'rejected', 'expired'], default: 'pending' },
  expiresAt: Date
}, { timestamps: true });

const Order = mongoose.models.Order || mongoose.model('Order', orderSchema);

app.use(async (req: any, res: any, next: any) => {
  if (!req.path.startsWith('/api/health')) {
    await connectDB();
  }
  next();
});

const authenticate = async (req: any, res: any, next: any) => {
  try {
    const authHeader = req.headers.authorization;
    if (!authHeader?.startsWith('Bearer ')) {
      return res.status(401).json({ success: false, message: 'Token não fornecido' });
    }
    const token = authHeader.split(' ')[1];
    const decoded: any = jwt.verify(token, JWT_SECRET);
    const user = await User.findById(decoded.userId);
    if (!user) return res.status(401).json({ success: false, message: 'Usuário não encontrado' });
    req.user = { userId: user._id.toString(), email: user.email, role: user.role };
    next();
  } catch {
    res.status(401).json({ success: false, message: 'Token inválido' });
  }
};

const adminOnly = (req: any, res: any, next: any) => {
  if (req.user?.role !== 'admin') {
    return res.status(403).json({ success: false, message: 'Acesso restrito' });
  }
  next();
};

app.get('/api/health', async (req, res) => {
  res.json({ success: true, message: 'FastProxy API funcionando!', timestamp: new Date().toISOString() });
});

app.get('/api/setup', async (req: any, res: any) => {
  try {
    await connectDB();
    const plans = [
      { name: 'Starter', tier: 'starter', price: 47, proxyCount: 5 },
      { name: 'Business', tier: 'business', price: 97, proxyCount: 20 },
      { name: 'Enterprise', tier: 'enterprise', price: 197, proxyCount: 50 }
    ];
    await Plan.deleteMany({});
    await Plan.insertMany(plans);
    
    const adminExists = await User.findOne({ email: 'admin@fastproxy.com' });
    if (!adminExists) {
      await User.create({
        name: 'Admin',
        email: 'admin@fastproxy.com',
        password: 'admin123',
        role: 'admin'
      });
      res.json({ success: true, message: 'Admin e planos criados!', admin: 'admin@fastproxy.com', password: 'admin123' });
    } else {
      res.json({ success: true, message: 'Admin e planos já existem!' });
    }
  } catch (error: any) {
    console.error('Setup error:', error.message);
    res.status(500).json({ success: false, message: error.message });
  }
});

app.post('/api/auth/register', limiter, async (req: any, res: any) => {
  try {
    const name = sanitize(req.body.name);
    const email = sanitize(req.body.email).toLowerCase();
    const password = req.body.password;
    const whatsapp = sanitize(req.body.whatsapp);
    
    if (!name || name.length < 2) return res.status(400).json({ success: false, message: 'Nome muito curto' });
    if (!email || !validator.isEmail(email)) return res.status(400).json({ success: false, message: 'Email inválido' });
    if (!password || password.length < 6) return res.status(400).json({ success: false, message: 'Senha mínimo 6 caracteres' });
    
    const existing = await User.findOne({ email });
    if (existing) return res.status(400).json({ success: false, message: 'Email já cadastrado' });
    
    const user = await User.create({ name, email, password, whatsapp });
    const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '30d' });
    
    res.status(201).json({ success: true, data: { user: { id: user._id, name, email, role: user.role }, token } });
  } catch (error) {
    console.error('Register error:', error);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/auth/login', authLimiter, async (req: any, res: any) => {
  try {
    const email = sanitize(req.body.email || '').toLowerCase();
    const password = req.body.password;
    
    if (!email || !password) {
      return res.status(400).json({ success: false, message: 'Dados obrigatórios' });
    }
    
    const user: any = await User.findOne({ email }).select('+password');
    if (!user) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }
    
    const isMatch = await user.comparePassword(password);
    if (!isMatch) {
      return res.status(401).json({ success: false, message: 'Credenciais inválidas' });
    }
    
    if (!user.isActive) {
      return res.status(403).json({ success: false, message: 'Conta desativada' });
    }
    
    const token = jwt.sign({ userId: user._id, email: user.email, role: user.role }, JWT_SECRET, { expiresIn: '7d' });
    res.json({ success: true, data: { user: { id: user._id, name: user.name, email, role: user.role }, token } });
  } catch (error: any) {
    console.error('Login error:', error.message);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.get('/api/auth/me', authenticate, async (req: any, res: any) => {
  try {
    const user = await User.findById(req.user.userId);
    if (!user) return res.status(404).json({ success: false, message: 'Usuário não encontrado' });
    res.json({ success: true, data: { user: { id: user._id, name: user.name, email: user.email, whatsapp: user.whatsapp, role: user.role } } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.get('/api/plans', async (req: any, res: any) => {
  try {
    const plans = await Plan.find({ isActive: true }).sort({ price: 1 });
    res.json({ success: true, data: { plans } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/plans', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const plan = await Plan.create(req.body);
    res.status(201).json({ success: true, data: { plan } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/plans/seed', async (req: any, res: any) => {
  try {
    await connectDB();
    const plans = [
      { name: 'Starter', tier: 'starter', price: 47, proxyCount: 5 },
      { name: 'Business', tier: 'business', price: 97, proxyCount: 20 },
      { name: 'Enterprise', tier: 'enterprise', price: 197, proxyCount: 50 }
    ];
    await Plan.deleteMany({});
    await Plan.insertMany(plans);
    
    const adminExists = await User.findOne({ email: 'admin@fastproxy.com' });
    if (!adminExists) {
      await User.create({
        name: 'Admin',
        email: 'admin@fastproxy.com',
        password: 'admin123',
        role: 'admin'
      });
    }
    
    res.json({ success: true, message: 'Planos e admin criados!', data: { count: plans.length } });
  } catch (error: any) {
    console.error('Seed error:', error.message);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.get('/api/proxies', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const { tier, status } = req.query;
    const query: any = {};
    if (tier) query.tier = tier;
    if (status) query.status = status;
    
    const proxies = await Proxy.find(query).populate('assignedTo', 'name email').sort({ createdAt: -1 });
    res.json({ success: true, data: { proxies } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.get('/api/proxies/my', authenticate, async (req: any, res: any) => {
  try {
    const proxies = await Proxy.find({ assignedTo: req.user.userId, status: 'active' }).populate('planId', 'name');
    res.json({ success: true, data: { proxies } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.delete('/api/proxies/:id', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const proxy = await Proxy.findByIdAndDelete(req.params.id);
    if (!proxy) return res.status(404).json({ success: false, message: 'Proxy não encontrado' });
    res.json({ success: true, message: 'Proxy excluído' });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/proxies/bulk', limiter, authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const { proxies } = req.body;
    if (!proxies || !Array.isArray(proxies)) {
      return res.status(400).json({ success: false, message: 'Proxies inválidos' });
    }
    
    const limitedProxies = proxies.slice(0, 100);
    const validTiers = ['shared', 'dedicated', 'premium'];
    const docs = limitedProxies.map((p: any) => {
      const proxyStr = p.proxy || '';
      const match = proxyStr.match(/^(.+?):(.+?)@(.+?):(\d+)$/);
      if (match) {
        return {
          username: sanitize(match[1]),
          password: sanitize(match[2]),
          ip: sanitize(match[3]),
          port: parseInt(match[4]) || 0,
          tier: validTiers.includes(p.tier) ? p.tier : 'shared',
          status: 'available'
        };
      }
      return null;
    }).filter(p => p && p.ip && p.port && p.username && p.password);
    
    if (docs.length === 0) {
      return res.status(400).json({ success: false, message: 'Nenhum proxy válido (formato: user:pass@ip:port)' });
    }
    
    await Proxy.insertMany(docs);
    res.json({ success: true, data: { count: docs.length } });
  } catch (error) {
    console.error('Bulk upload error:', error);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.get('/api/orders', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const orders = await Order.find()
      .populate('userId', 'name email whatsapp')
      .populate('planId', 'name tier')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.get('/api/orders/my', authenticate, async (req: any, res: any) => {
  try {
    const orders = await Order.find({ userId: req.user.userId })
      .populate('planId', 'name tier proxyCount')
      .sort({ createdAt: -1 });
    res.json({ success: true, data: { orders } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/orders', authenticate, async (req: any, res: any) => {
  try {
    const { planId } = req.body;
    
    const plan = await Plan.findById(planId);
    if (!plan) return res.status(404).json({ success: false, message: 'Plano não encontrado' });
    
    const order = await Order.create({
      userId: req.user.userId,
      planId,
      status: 'pending'
    });
    
    res.status(201).json({ success: true, data: { order } });
  } catch (error) {
    console.error('Create order error:', error);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/orders/:id/approve', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const order = await Order.findById(req.params.id).populate('planId');
    if (!order) return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    
    const plan: any = order.planId;
    const proxyCount = plan.proxyCount || 1;
    
    const availableProxies = await Proxy.find({ status: 'available' }).limit(proxyCount);
    
    if (availableProxies.length < proxyCount) {
      return res.status(400).json({ success: false, message: 'Sem proxies suficientes em estoque' });
    }
    
    const proxyIds = availableProxies.map(p => p._id);
    await Proxy.updateMany(
      { _id: { $in: proxyIds } },
      { status: 'active', assignedTo: order.userId, assignedAt: new Date(), orderId: order._id, expiresAt: new Date(Date.now() + 30 * 24 * 60 * 60 * 1000) }
    );
    
    await User.findByIdAndUpdate(order.userId, { $inc: { proxyCount: proxyCount } });
    
    order.status = 'active';
    order.expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
    await order.save();
    
    res.json({ success: true, data: { order, proxiesAssigned: proxyCount } });
  } catch (error) {
    console.error('Approve error:', error);
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

app.post('/api/orders/:id/reject', authenticate, adminOnly, async (req: any, res: any) => {
  try {
    const order = await Order.findByIdAndUpdate(req.params.id, { status: 'rejected' }, { new: true });
    if (!order) return res.status(404).json({ success: false, message: 'Pedido não encontrado' });
    res.json({ success: true, data: { order } });
  } catch (error) {
    res.status(500).json({ success: false, message: 'Erro interno' });
  }
});

const createAdmin = async () => {
  try {
    await connectDB();
    const admin = await User.findOne({ role: 'admin' });
    if (!admin) {
      await User.create({
        name: 'Admin',
        email: 'admin@fastproxy.com',
        password: 'admin123',
        role: 'admin'
      });
      console.log('✅ Admin criado: admin@fastproxy.com / admin123');
    }
  } catch (error) {
    console.error('Erro ao criar admin:', error);
  }
};

const start = async () => {
  try {
    await connectDB();
    await createAdmin();
    app.listen(3000, () => {
      console.log('🚀 FastProxy API rodando na porta 3000');
    });
  } catch (error) {
    console.error('❌ Erro:', error);
  }
};

start();

export default app;