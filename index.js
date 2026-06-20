const express = require('express');
const cors = require('cors');
const cookieParser = require('cookie-parser');
const { MongoClient, ServerApiVersion, ObjectId } = require('mongodb');
require('dotenv').config();
const stripe = require('stripe')(process.env.STRIPE_SECRET_KEY);

const app = express();
const port = process.env.PORT || 5000;

app.use(cors({
  origin: ['http://localhost:3001', 'https://mediacare-frontend.vercel.app'],
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization', 'Cookie'],
}));
app.use(cookieParser());
app.use(express.json());

const uri = process.env.MONGODB_URI;
const client = new MongoClient(uri, {
  serverApi: { version: ServerApiVersion.v1, strict: true, deprecationErrors: true },
});

async function run() {
  try {
    await client.connect();
    console.log('MongoDB connected successfully');

    const db = client.db('medicareConnect');
    const usersCollection = db.collection('users');
    const doctorsCollection = db.collection('doctors');
    const appointmentsCollection = db.collection('appointments');
    const reviewsCollection = db.collection('reviews');
    const paymentsCollection = db.collection('payments');
    const prescriptionsCollection = db.collection('prescriptions');

    // --- SESSION VERIFICATION (talks to Next.js Better Auth) ---
    const verifySession = async (req, res, next) => {
      try {
        const response = await fetch(`${process.env.CLIENT_URL || 'http://localhost:3001'}/api/auth/get-session`, {
  headers: {
    cookie: req.headers.cookie || '',
  },
});
        const session = await response.json();
        if (!session?.user) return res.status(401).send({ message: 'unauthorized access' });
        req.user = session.user;
        next();
      } catch (e) {
        res.status(401).send({ message: 'unauthorized access' });
      }
    };

    const verifyAdmin = async (req, res, next) => {
      const dbUser = await usersCollection.findOne({ email: req.user.email });
      if (!dbUser || dbUser.role !== 'admin') return res.status(403).send({ message: 'forbidden access' });
      next();
    };

    // --- ROOT ---
    app.get('/', (req, res) => res.send('MediCare Connect server is running'));

    // --- USER ROUTES ---
    app.post('/users', async (req, res) => {
      const user = req.body;
      const existingUser = await usersCollection.findOne({ email: user.email });
      if (existingUser) return res.send({ message: 'user already exists', insertedId: null });
      const result = await usersCollection.insertOne({
        ...user,
        role: user.role || 'patient',
        status: 'active',
        createdAt: new Date(),
      });
      res.send(result);
    });

    app.get('/users/role/:email', async (req, res) => {
      const user = await usersCollection.findOne({ email: req.params.email });
      res.send({ role: user?.role || 'patient' });
    });

    app.patch('/users/update-role', async (req, res) => {
      const { email, role } = req.body;
      if (!['patient', 'doctor', 'admin'].includes(role)) {
        return res.status(400).send({ message: 'Invalid role' });
      }
      const result = await usersCollection.updateOne({ email }, { $set: { role } });
      res.send(result);
    });

    app.patch('/users/profile/:email', verifySession, async (req, res) => {
      const result = await usersCollection.updateOne(
        { email: req.params.email },
        { $set: req.body }
      );
      res.send(result);
    });
app.get('/users/profile/:email', verifySession, async (req, res) => {
  const user = await usersCollection.findOne({ email: req.params.email });
  res.send(user || {});
});

    app.get('/users', verifySession, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().toArray();
      res.send(users);
    });

    app.delete('/users/:email', verifySession, verifyAdmin, async (req, res) => {
      const result = await usersCollection.deleteOne({ email: req.params.email });
      res.send(result);
    });

    // --- DOCTOR ROUTES ---
    app.get('/doctors/profile/:email', verifySession, async (req, res) => {
      const doctor = await doctorsCollection.findOne({ email: req.params.email });
      res.send(doctor);
    });

    app.patch('/doctors/profile/:email', verifySession, async (req, res) => {
      const existing = await doctorsCollection.findOne({ email: req.params.email });
      const result = await doctorsCollection.updateOne(
        { email: req.params.email },
        { $set: { ...req.body, verificationStatus: existing?.verificationStatus || 'pending' } },
        { upsert: true }
      );
      res.send(result);
    });

    app.get('/doctors', async (req, res) => {
      const { search = '', specialization = '', sort = '', page = 1, limit = 9 } = req.query;
      const query = { verificationStatus: 'verified' };
      if (search) query.doctorName = { $regex: search, $options: 'i' };
      if (specialization) query.specialization = specialization;

      let sortQuery = {};
      if (sort === 'fee-asc') sortQuery = { appointmentFee: 1 };
      if (sort === 'fee-desc') sortQuery = { appointmentFee: -1 };
      if (sort === 'experience-desc') sortQuery = { experienceYears: -1 };
      if (sort === 'rating-desc') sortQuery = { rating: -1 };

      const pageNum = parseInt(page);
      const limitNum = parseInt(limit);
      const totalDoctors = await doctorsCollection.countDocuments(query);
      const doctors = await doctorsCollection
        .find(query)
        .sort(sortQuery)
        .skip((pageNum - 1) * limitNum)
        .limit(limitNum)
        .toArray();

      res.send({
        doctors,
        totalDoctors,
        totalPages: Math.ceil(totalDoctors / limitNum),
        currentPage: pageNum,
      });
    });

    app.get('/doctors/:id', async (req, res) => {
      try {
        const doctor = await doctorsCollection.findOne({ _id: new ObjectId(req.params.id) });
        res.send(doctor);
      } catch {
        res.status(400).send({ message: 'Invalid doctor ID' });
      }
    });

    // --- APPOINTMENT ROUTES ---
    app.get('/appointments/patient/:email', verifySession, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email) return res.status(403).send({ message: 'forbidden access' });
      const appointments = await appointmentsCollection
        .find({ patientEmail: email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(appointments);
    });

    app.get('/appointments/doctor/:email', verifySession, async (req, res) => {
      const doctor = await doctorsCollection.findOne({ email: req.params.email });
      if (!doctor) return res.send([]);
      const appointments = await appointmentsCollection
        .find({ doctorId: doctor._id.toString() })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(appointments);
    });

app.post('/appointments', verifySession, async (req, res) => {
  const appointment = req.body;

  // We explicitly include 'problem' from req.body 
  // (Assuming your frontend sends it as 'problem')
  const result = await appointmentsCollection.insertOne({
    ...appointment,
    appointmentStatus: 'pending',
    paymentStatus: 'paid',
    createdAt: new Date(),
    // Ensure the problem is saved if sent during initial booking
    problem: appointment.problem || appointment.symptoms || "", 
  });

  // Look up doctor name
  let doctorName = appointment.doctorName;
  if (!doctorName && appointment.doctorId) {
    const doctorDoc = await doctorsCollection.findOne({ _id: new ObjectId(appointment.doctorId) });
    doctorName = doctorDoc?.doctorName || 'Unknown Doctor';
  }

  await paymentsCollection.insertOne({
    appointmentId: result.insertedId,
    patientEmail: appointment.patientEmail,
    doctorId: appointment.doctorId,
    doctorName,
    amount: appointment.fee,
    transactionId: appointment.transactionId,
    paymentDate: new Date(),
  });

  res.send(result);
});

    app.patch('/appointments/cancel/:id', verifySession, async (req, res) => {
      res.send(await appointmentsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { appointmentStatus: 'cancelled' } }
      ));
    });

    app.patch('/appointments/accept/:id', verifySession, async (req, res) => {
      res.send(await appointmentsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { appointmentStatus: 'accepted' } }
      ));
    });

    app.patch('/appointments/complete/:id', verifySession, async (req, res) => {
      res.send(await appointmentsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { appointmentStatus: 'completed' } }
      ));
    });

    // Patient submits their problem/symptoms for an accepted appointment
   app.patch('/appointments/symptoms/:id', verifySession, async (req, res) => {
  const { problem, symptoms } = req.body; // Accept either key
  const finalProblem = problem || symptoms;
  
  const result = await appointmentsCollection.updateOne(
    { _id: new ObjectId(req.params.id) },
    { $set: { problem: finalProblem } } // Consistently update the 'problem' field
  );
  res.send(result);
});
    // --- PAYMENT ROUTES ---
    app.post('/create-payment-intent', verifySession, async (req, res) => {
      const { fee } = req.body;
      const paymentIntent = await stripe.paymentIntents.create({
        amount: Math.round(fee * 100),
        currency: 'usd',
        payment_method_types: ['card'],
      });
      res.send({ clientSecret: paymentIntent.client_secret });
    });

    app.get('/payments/patient/:email', verifySession, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email) return res.status(403).send({ message: 'forbidden access' });
      const payments = await paymentsCollection
        .find({ patientEmail: email })
        .sort({ paymentDate: -1 })
        .toArray();
      res.send(payments);
    });

    // --- REVIEW ROUTES ---
    app.get('/reviews/latest', async (req, res) => {
      const reviews = await reviewsCollection.find().sort({ createdAt: -1 }).limit(3).toArray();
      res.send(reviews);
    });

    app.post('/reviews', verifySession, async (req, res) => {
      const result = await reviewsCollection.insertOne({ ...req.body, createdAt: new Date() });
      res.send(result);
    });

    app.get('/reviews/patient/:email', verifySession, async (req, res) => {
      const reviews = await reviewsCollection
        .find({ patientEmail: req.params.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(reviews);
    });

    app.delete('/reviews/:id', verifySession, async (req, res) => {
      const result = await reviewsCollection.deleteOne({ _id: new ObjectId(req.params.id) });
      res.send(result);
    });

    // --- PRESCRIPTION ROUTES ---
    app.post('/prescriptions', verifySession, async (req, res) => {
      // Look up the doctor's name so it's stored correctly on the prescription
      const doctorDoc = await doctorsCollection.findOne({ email: req.user.email });
      const result = await prescriptionsCollection.insertOne({
        ...req.body,
        doctorName: doctorDoc?.doctorName || req.user.name || 'Unknown Doctor',
        doctorEmail: req.user.email,
        createdAt: new Date(),
      });
      res.send(result);
    });

    app.get('/prescriptions/doctor/:email', verifySession, async (req, res) => {
      const prescriptions = await prescriptionsCollection
        .find({ doctorEmail: req.params.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(prescriptions);
    });

    app.get('/prescriptions/patient/:email', verifySession, async (req, res) => {
      const prescriptions = await prescriptionsCollection
        .find({ patientEmail: req.params.email })
        .sort({ createdAt: -1 })
        .toArray();
      res.send(prescriptions);
    });

    // --- SCHEDULE ROUTES ---
    app.get('/schedule/:email', verifySession, async (req, res) => {
      const doctor = await doctorsCollection.findOne({ email: req.params.email });
      res.send(doctor?.schedule || []);
    });

    app.patch('/schedule/:email', verifySession, async (req, res) => {
      const { schedule } = req.body;
      const result = await doctorsCollection.updateOne(
        { email: req.params.email },
        { $set: { schedule } },
        { upsert: true }
      );
      res.send(result);
    });

    // --- DASHBOARD STATS ---
    app.get('/dashboard/patient/stats/:email', verifySession, async (req, res) => {
      const email = req.params.email;
      if (req.user.email !== email) return res.status(403).send({ message: 'forbidden access' });
      const totalAppointments = await appointmentsCollection.countDocuments({ patientEmail: email });
      const pendingAppointments = await appointmentsCollection.countDocuments({ patientEmail: email, appointmentStatus: 'pending' });
      const completedAppointments = await appointmentsCollection.countDocuments({ patientEmail: email, appointmentStatus: 'completed' });
      const payments = await paymentsCollection.find({ patientEmail: email }).toArray();
      const totalSpent = payments.reduce((sum, p) => sum + p.amount, 0);
      res.send({ totalAppointments, pendingAppointments, completedAppointments, totalSpent });
    });

    app.get('/dashboard/doctor/stats/:email', verifySession, async (req, res) => {
      const email = req.params.email;
      const doctor = await doctorsCollection.findOne({ email });
      if (!doctor) return res.send({ totalAppointments: 0, pending: 0, completed: 0, totalEarned: 0 });
      const doctorId = doctor._id.toString();
      const totalAppointments = await appointmentsCollection.countDocuments({ doctorId });
      const pending = await appointmentsCollection.countDocuments({ doctorId, appointmentStatus: 'pending' });
      const completed = await appointmentsCollection.countDocuments({ doctorId, appointmentStatus: 'completed' });
      const payments = await paymentsCollection.find({ doctorId }).toArray();
      const totalEarned = payments.reduce((sum, p) => sum + p.amount, 0);
      res.send({ totalAppointments, pending, completed, totalEarned });
    });

    // --- ADMIN ROUTES ---
    app.get('/dashboard/admin/stats', verifySession, verifyAdmin, async (req, res) => {
      const totalUsers = await usersCollection.countDocuments();
      const totalDoctors = await doctorsCollection.countDocuments();
      const totalAppointments = await appointmentsCollection.countDocuments();
      const payments = await paymentsCollection.find().toArray();
      const totalRevenue = payments.reduce((sum, p) => sum + p.amount, 0);
      const pendingDoctors = await doctorsCollection.countDocuments({ verificationStatus: 'pending' });
      res.send({ totalUsers, totalDoctors, totalAppointments, totalRevenue, pendingDoctors });
    });

    app.get('/admin/users', verifySession, verifyAdmin, async (req, res) => {
      const users = await usersCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(users);
    });

    app.patch('/admin/users/role/:email', verifySession, verifyAdmin, async (req, res) => {
      const { role } = req.body;
      const result = await usersCollection.updateOne(
        { email: req.params.email },
        { $set: { role } }
      );
      res.send(result);
    });

    app.delete('/admin/users/:email', verifySession, verifyAdmin, async (req, res) => {
      const result = await usersCollection.deleteOne({ email: req.params.email });
      res.send(result);
    });

    app.get('/admin/doctors', verifySession, verifyAdmin, async (req, res) => {
      const doctors = await doctorsCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(doctors);
    });

    app.patch('/admin/doctors/verify/:id', verifySession, verifyAdmin, async (req, res) => {
      const result = await doctorsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { verificationStatus: 'verified' } }
      );
      res.send(result);
    });

    app.patch('/admin/doctors/reject/:id', verifySession, verifyAdmin, async (req, res) => {
      const result = await doctorsCollection.updateOne(
        { _id: new ObjectId(req.params.id) },
        { $set: { verificationStatus: 'rejected' } }
      );
      res.send(result);
    });

    app.get('/admin/appointments', verifySession, verifyAdmin, async (req, res) => {
      const appointments = await appointmentsCollection.find().sort({ createdAt: -1 }).toArray();
      res.send(appointments);
    });

    app.get('/admin/payments', verifySession, verifyAdmin, async (req, res) => {
      const payments = await paymentsCollection.find().sort({ paymentDate: -1 }).toArray();
      res.send(payments);
    });

    app.get('/admin/analytics', verifySession, verifyAdmin, async (req, res) => {
      const payments = await paymentsCollection.find().toArray();
      const revenueByMonth = {};
      payments.forEach((p) => {
        const month = new Date(p.paymentDate).toLocaleString('default', { month: 'short', year: 'numeric' });
        revenueByMonth[month] = (revenueByMonth[month] || 0) + p.amount;
      });
      const appointmentsByStatus = await appointmentsCollection.aggregate([
        { $group: { _id: '$appointmentStatus', count: { $sum: 1 } } },
      ]).toArray();
      const specializationData = await doctorsCollection.aggregate([
        { $group: { _id: '$specialization', count: { $sum: 1 } } },
      ]).toArray();
      res.send({
        revenueByMonth: Object.entries(revenueByMonth).map(([month, revenue]) => ({ month, revenue })),
        appointmentsByStatus: appointmentsByStatus.map((s) => ({ name: s._id || 'unknown', value: s.count })),
        specializationData: specializationData.map((s) => ({ name: s._id || 'unspecified', count: s.count })),
      });
    });

  } finally {
    // keep connection open
  }
}

run().catch(console.dir);

app.listen(port, () => {
  console.log(`MediCare Connect server listening on port ${port}`);
});