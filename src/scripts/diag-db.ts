import mongoose from 'mongoose';
import dotenv from 'dotenv';
import path from 'path';
import dns from 'dns';

dns.setServers(['8.8.8.8', '1.1.1.1']);

dotenv.config({ path: path.join(__dirname, '../../.env') });

async function check() {
  const uri = process.env.MONGODB_URI;
  if (!uri) {
    console.error('MONGODB_URI is not defined in .env');
    process.exit(1);
  }

  console.log('Attempting to connect to MongoDB...');
  
  try {
    await mongoose.connect(uri, {
      serverSelectionTimeoutMS: 30000,
    });
    console.log('✅ Successfully connected to MongoDB');
    
    // Test a simple find
    if (!mongoose.connection.db) {
      throw new Error('Database connection established but db object is undefined');
    }
    const collections = await mongoose.connection.db.listCollections().toArray();
    console.log(`✅ Database ready. Found ${collections.length} collections.`);
    
    await mongoose.disconnect();
    process.exit(0);
  } catch (e: any) {
    console.error('❌ Connection failed:', e.message);
    process.exit(1);
  }
}

check();
