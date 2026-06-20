require('dotenv').config();
const { MongoClient, ServerApiVersion } = require('mongodb');

const client = new MongoClient(process.env.MONGODB_URI, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

const sampleDoctors = [
  {
    name: 'Dr. Sarah Ahmed',
    email: 'sarah.ahmed@example.com',
    specialization: 'Cardiology',
    experience: 8,
    fee: 50,
    rating: 4.7,
    bio: 'Focused on preventive heart care and patient education.',
    degree: 'MBBS, MD (Cardiology)',
    hospital: 'City General Hospital',
    verificationStatus: 'verified',
    createdAt: new Date(),
  },
  {
    name: 'Dr. Imran Khan',
    email: 'imran.khan@example.com',
    specialization: 'Dermatology',
    experience: 5,
    fee: 35,
    rating: 4.5,
    bio: 'Specializes in skin conditions and cosmetic dermatology.',
    degree: 'MBBS, DDV',
    hospital: 'Skin Care Clinic',
    verificationStatus: 'verified',
    createdAt: new Date(),
  },
  {
    name: 'Dr. Fatima Noor',
    email: 'fatima.noor@example.com',
    specialization: 'Pediatrics',
    experience: 12,
    fee: 40,
    rating: 4.9,
    bio: 'Over a decade of experience treating children of all ages.',
    degree: 'MBBS, FCPS (Pediatrics)',
    hospital: 'Children\'s Health Center',
    verificationStatus: 'verified',
    createdAt: new Date(),
  },
];

async function seed() {
  try {
    await client.connect();
    const doctorsCollection = client.db('medicareConnect').collection('doctors');
    await doctorsCollection.deleteMany({});
    const result = await doctorsCollection.insertMany(sampleDoctors);
    console.log(`${result.insertedCount} doctors inserted`);
  } finally {
    await client.close();
  }
}

seed();