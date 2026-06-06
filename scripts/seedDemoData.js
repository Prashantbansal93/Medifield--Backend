require('dotenv').config();
const mongoose = require('mongoose');
const bcrypt = require('bcryptjs');
const User = require('../src/models/User');
const Medicine = require('../src/models/Medicine');
const Wholesaler = require('../src/models/Wholesaler');

const BASE_MEDICINES = [
  ['Paracetamol', 'Sun Pharma', 62, 'Pain Relief'],
  ['Amoxicillin', 'Cipla', 128, 'Antibiotic'],
  ['Azithromycin', 'Alkem', 154, 'Antibiotic'],
  ['Pantoprazole', 'Dr. Reddy', 94, 'Gastro'],
  ['Cetirizine', 'Mankind', 45, 'Allergy'],
  ['Metformin', 'USV', 88, 'Diabetes'],
  ['Atorvastatin', 'Lupin', 112, 'Cardiac'],
  ['Vitamin C', 'Dabur', 76, 'Nutrition'],
  ['ORS Sachet', 'Electral', 25, 'Hydration'],
  ['Calcium D3', 'Abbott', 132, 'Nutrition'],
  ['Ibuprofen', 'GSK', 72, 'Pain Relief'],
  ['Levocetirizine', 'Torrent', 64, 'Allergy'],
  ['Omeprazole', 'Zydus', 86, 'Gastro'],
  ['Cough Syrup', 'Himalaya', 118, 'Respiratory'],
  ['Insulin Pen', 'Novo Nordisk', 640, 'Diabetes'],
];

const STRENGTHS = ['100', '200', '250', '300', '400', '500', '650'];
const FORMS = ['Tablet', 'Capsule', 'Syrup', 'Injection', 'Drops'];

function buildMedicineTemplates(target = 260) {
  const templates = [];
  let i = 0;
  while (templates.length < target) {
    const base = BASE_MEDICINES[i % BASE_MEDICINES.length];
    const strength = STRENGTHS[i % STRENGTHS.length];
    const form = FORMS[i % FORMS.length];
    const serial = String(Math.floor(i / BASE_MEDICINES.length) + 1).padStart(2, '0');
    const name = `${base[0]} ${strength} ${form} ${serial}`;
    const mrp = Math.max(18, base[2] + (i % 23) * 4);
    templates.push([name, base[1], mrp, base[3]]);
    i += 1;
  }
  return templates;
}

async function ensureUser(base) {
  const existing = await User.findOne({ email: base.email });
  if (existing) return existing;
  const password = await bcrypt.hash(base.password, 10);
  return User.create({ ...base, password });
}

async function run() {
  if (!process.env.MONGO_URI) {
    throw new Error('MONGO_URI missing in .env');
  }
  await mongoose.connect(process.env.MONGO_URI);

  const medicineTemplates = buildMedicineTemplates(260);
  const medicines = [];
  for (const [name, company, mrp, category] of medicineTemplates) {
    let med = await Medicine.findOne({ name });
    if (!med) {
      med = await Medicine.create({
        name,
        company,
        mrp,
        category,
        composition: `${name.split(' ')[0]} blend`,
        requiresPrescription: /Antibiotic|Diabetes|Cardiac/.test(category),
      });
    }
    medicines.push(med);
  }

  const adminCode = process.env.ADMIN_CODE || 'MEDI-ADMIN-2026';

  await ensureUser({
    name: 'Demo Retailer',
    email: 'retailer@medifield.demo',
    password: 'Retailer@123',
    role: 'RETAILER',
    phone: '9876543210',
    verificationStatus: 'APPROVED',
    profile: {
      aadhaarNumber: '123412341234',
      shopAddress: 'Retail Market Road, Jaipur',
      licenseNumber: 'RAJ-RET-001',
      gstNumber: '08ABCDE1234F1Z5',
      documentUrls: ['https://example.com/retailer-doc-1', 'https://example.com/retailer-doc-2'],
      city: 'Jaipur',
      lat: 26.9124,
      lng: 75.7873,
    },
  });

  await ensureUser({
    name: 'Demo Delivery',
    email: 'delivery@medifield.demo',
    password: 'Delivery@123',
    role: 'DELIVERY',
    phone: '9876500001',
    verificationStatus: 'APPROVED',
    profile: {
      vehicleType: 'Bike',
      vehicleNumber: 'RJ14AB1234',
      drivingLicenseNumber: 'DL-DEL-778899',
      city: 'Jaipur',
      pinCode: '302001',
      lat: 26.9182,
      lng: 75.7999,
    },
  });

  await ensureUser({
    name: 'Platform Admin',
    email: 'admin@medifield.demo',
    password: 'Admin@123',
    role: 'ADMIN',
    phone: '9876500002',
    verificationStatus: 'APPROVED',
    profile: { adminCode },
  });

  for (let i = 1; i <= 20; i += 1) {
    const email = `wholesaler${i}@medifield.demo`;
    const user = await ensureUser({
      name: `Wholesaler ${i}`,
      email,
      password: 'Wholesaler@123',
      role: 'WHOLESALER',
      phone: `98${String(70000000 + i).slice(-8)}`,
      verificationStatus: 'APPROVED',
      profile: {
        aadhaarNumber: `4321${String(10000000 + i).slice(-8)}`,
        shopName: `Medi Wholesale Hub ${i}`,
        shopAddress: `Warehouse ${i}, Jaipur`,
        licenseNumber: `RAJ-WHS-${String(i).padStart(3, '0')}`,
        gstNumber: `08WHSL${String(i).padStart(5, '0')}Z`,
        documentUrls: ['https://example.com/wh-doc-1', 'https://example.com/wh-doc-2'],
        city: 'Jaipur',
        lat: 26.91 + i * 0.001,
        lng: 75.78 + i * 0.001,
      },
    });

    const inventoryStart = ((i - 1) * 11) % medicines.length;
    const inventory = Array.from({ length: 90 }).map((_, idx) => {
      const med = medicines[(inventoryStart + idx) % medicines.length];
      return {
        medicine: med._id,
        quantity: 60 + ((i * 5 + idx) % 120),
        price: Math.max(10, med.mrp - (i % 7) * 3 + (idx % 5)),
      };
    });

    await Wholesaler.findOneAndUpdate(
      { user: user._id },
      {
        user: user._id,
        shopName: `Medi Wholesale Hub ${i}`,
        address: `Industrial Area ${i}, Jaipur`,
        city: 'Jaipur',
        priorityRank: i,
        location: {
          type: 'Point',
          coordinates: [75.78 + (i * 0.001), 26.91 + (i * 0.001)],
        },
        inventory,
      },
      { upsert: true, returnDocument: 'after' }
    );
  }

  const wholesalerCount = await Wholesaler.countDocuments();
  const medicineCount = await Medicine.countDocuments();
  console.log(`Demo data seeded successfully (${medicineCount} medicines, ${wholesalerCount} wholesalers)`);
  await mongoose.disconnect();
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
