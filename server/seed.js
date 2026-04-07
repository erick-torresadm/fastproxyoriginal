const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');

const userSchema = new mongoose.Schema({
  name: String,
  email: { type: String, unique: true, lowercase: true },
  password: String,
  role: { type: String, enum: ['user', 'admin'], default: 'user' },
  isActive: { type: Boolean, default: true },
}, { timestamps: true });

const planSchema = new mongoose.Schema({
  name: String,
  tier: String,
  price: Number,
  proxyCount: Number,
  isActive: { type: Boolean, default: true }
}, { timestamps: true });

const User = mongoose.models.User || mongoose.model('User', userSchema);
const Plan = mongoose.models.Plan || mongoose.model('Plan', planSchema);

async function seed() {
  const MONGODB_URI = process.env.MONGODB_URI || 'mongodb+srv://ericktorresadm_db_user:FBra8yqPipxOVFSy@clusterfastproxy.tdun6hv.mongodb.net/fastproxy?appName=clusterfastproxy';
  
  try {
    await mongoose.connect(MONGODB_URI, {
      serverSelectionTimeoutMS: 30000,
      socketTimeoutMS: 30000,
    });
    console.log('✅ Conectado ao MongoDB!');

    // Criar admin
    const hashedPassword = await bcrypt.hash('admin123', 12);
    const adminExists = await User.findOne({ email: 'admin@fastproxy.com' });
    if (!adminExists) {
      await User.create({
        name: 'Admin',
        email: 'admin@fastproxy.com',
        password: hashedPassword,
        role: 'admin'
      });
      console.log('✅ Admin criado: admin@fastproxy.com / admin123');
    } else {
      console.log('ℹ️ Admin já existe');
    }

    // Criar planos
    const plans = [
      { name: 'Starter', tier: 'starter', price: 47, proxyCount: 5 },
      { name: 'Business', tier: 'business', price: 97, proxyCount: 20 },
      { name: 'Enterprise', tier: 'enterprise', price: 197, proxyCount: 50 }
    ];

    await Plan.deleteMany({});
    for (const plan of plans) {
      await Plan.create(plan);
      console.log(`✅ Plano criado: ${plan.name}`);
    }

    console.log('\n🎉 Setup concluído com sucesso!');
    console.log('   Admin: admin@fastproxy.com');
    console.log('   Senha: admin123');
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (error) {
    console.error('❌ Erro:', error.message);
    process.exit(1);
  }
}

seed();