/**
 * SABS Database Seed Script
 * Creates demo users, ambulances, and hospitals for testing.
 * Safe to re-run: uses upsert (findOneAndUpdate with upsert:true) to prevent duplicates.
 */

import dotenv from 'dotenv';
import mongoose from 'mongoose';
import { User } from '../models/User';
import { Ambulance } from '../models/Ambulance';
import { Hospital } from '../models/Hospital';
import { logger } from '../utils/logger';

dotenv.config();

const DEMO_USERS = [
  {
    name: 'Admin User',
    email: 'admin@sabs.com',
    password: 'Admin@123',
    phone: '+919876543210',
    role: 'admin' as const,
    isActive: true,
  },
  {
    name: 'Priya Sharma',
    email: 'patient@sabs.com',
    password: 'Patient@123',
    phone: '+919876543211',
    role: 'patient' as const,
    bloodGroup: 'B+',
    address: 'Banjara Hills, Hyderabad',
    isActive: true,
  },
  {
    name: 'Ravi Kumar',
    email: 'driver1@sabs.com',
    password: 'Driver@123',
    phone: '+919876543212',
    role: 'driver' as const,
    isActive: true,
  },
  {
    name: 'Suresh Reddy',
    email: 'driver2@sabs.com',
    password: 'Driver@123',
    phone: '+919876543213',
    role: 'driver' as const,
    isActive: true,
  },
  {
    name: 'Anita Singh',
    email: 'driver3@sabs.com',
    password: 'Driver@123',
    phone: '+919876543214',
    role: 'driver' as const,
    isActive: true,
  },
  {
    name: 'Dr. Meena Patel',
    email: 'hospital@sabs.com',
    password: 'Hospital@123',
    phone: '+919876543215',
    role: 'hospital_staff' as const,
    isActive: true,
  },
  {
    name: 'Nurse Lakshmi',
    email: 'hospital2@sabs.com',
    password: 'Hospital@123',
    phone: '+919876543216',
    role: 'hospital_staff' as const,
    isActive: true,
  },
  {
    name: 'Arjun Nair',
    email: 'patient2@sabs.com',
    password: 'Patient@123',
    phone: '+919876543217',
    role: 'patient' as const,
    bloodGroup: 'O+',
    address: 'Jubilee Hills, Hyderabad',
    isActive: true,
  },
];

// Hyderabad coordinates region
const DEMO_AMBULANCES_CONFIG = [
  {
    vehicleNumber: 'TS09AB1001',
    type: 'ALS' as const,
    capabilities: ['Cardiac Monitor', 'Defibrillator', 'IV Therapy', 'Oxygen'],
    equipment: ['Stretcher', 'First Aid Kit', 'AED', 'Oxygen Cylinder'],
    make: 'Force',
    model: 'Traveller Ambulance',
    // Banjara Hills area
    location: { lat: 17.4138, lng: 78.4370 },
    driverEmail: 'driver1@sabs.com',
  },
  {
    vehicleNumber: 'TS09AB1002',
    type: 'BLS' as const,
    capabilities: ['First Aid', 'Patient Transport', 'Oxygen'],
    equipment: ['Stretcher', 'First Aid Kit', 'Oxygen Cylinder', 'BP Monitor'],
    make: 'Tata',
    model: 'Winger Ambulance',
    // Jubilee Hills area
    location: { lat: 17.4333, lng: 78.4078 },
    driverEmail: 'driver2@sabs.com',
  },
  {
    vehicleNumber: 'TS09AB1003',
    type: 'CCT' as const,
    capabilities: ['Critical Care', 'Ventilator', 'Cardiac Monitor', 'Defibrillator', 'IV Therapy'],
    equipment: ['ICU Equipment', 'Ventilator', 'Monitor', 'Infusion Pump'],
    make: 'Mercedes',
    model: 'Sprinter CCT',
    // Hitech City area
    location: { lat: 17.4489, lng: 78.3799 },
    driverEmail: 'driver3@sabs.com',
  },
  {
    vehicleNumber: 'TS09AB1004',
    type: 'ALS' as const,
    capabilities: ['Advanced Life Support', 'IV Therapy', 'Cardiac Monitor'],
    equipment: ['Stretcher', 'AED', 'First Aid', 'Oxygen'],
    make: 'Force',
    model: 'Traveller ALS',
    // Secunderabad area
    location: { lat: 17.4399, lng: 78.4983 },
    driverEmail: null, // Unassigned
  },
];

const DEMO_HOSPITALS = [
  {
    name: 'Apollo Hospital Jubilee Hills',
    address: 'Film Nagar, Jubilee Hills, Hyderabad - 500096',
    location: { lat: 17.4282, lng: 78.4052 },
    phone: '+914023607777',
    email: 'apollo.jubilee@demo.com',
    specialties: ['Cardiology', 'Neurology', 'Trauma Surgery', 'Emergency Medicine', 'Orthopedics', 'ICU', 'Oncology'],
    facilities: ['Cath Lab', 'CT Scanner', 'MRI', 'Operation Theatre', 'Blood Bank', 'ICU', 'NICU', 'Cardiac ICU'],
    emergencyDepartment: { isAvailable: true, capacity: 50, currentOccupancy: 18 },
    icuBeds: { total: 30, available: 8 },
    generalBeds: { total: 300, available: 65 },
    isDemo: true,
    isActive: true,
    staffEmail: 'hospital@sabs.com',
  },
  {
    name: 'Yashoda Hospital Somajiguda',
    address: 'Raj Bhavan Road, Somajiguda, Hyderabad - 500082',
    location: { lat: 17.4196, lng: 78.4567 },
    phone: '+914066777777',
    email: 'yashoda.somajiguda@demo.com',
    specialties: ['Neurology', 'Pediatrics', 'Emergency Medicine', 'NICU', 'Cardiac Surgery'],
    facilities: ['CT Scanner', 'MRI', 'NICU', 'Pediatric ICU', 'Blood Bank', 'Ventilators', 'Operation Theatre'],
    emergencyDepartment: { isAvailable: true, capacity: 40, currentOccupancy: 25 },
    icuBeds: { total: 20, available: 5 },
    generalBeds: { total: 200, available: 45 },
    isDemo: true,
    isActive: true,
    staffEmail: 'hospital2@sabs.com',
  },
  {
    name: 'KIMS Hospitals Secunderabad',
    address: '1-112/86, Statistics Colony, Begumpet, Hyderabad - 500016',
    location: { lat: 17.4451, lng: 78.4697 },
    phone: '+914044885000',
    email: 'kims.secunderabad@demo.com',
    specialties: ['Trauma Surgery', 'Emergency Medicine', 'Orthopedics', 'Burns', 'Plastic Surgery'],
    facilities: ['Trauma Bay', 'Operation Theatre', 'Blood Bank', 'CT Scanner', 'Burn Unit', 'ICU'],
    emergencyDepartment: { isAvailable: true, capacity: 30, currentOccupancy: 8 },
    icuBeds: { total: 15, available: 7 },
    generalBeds: { total: 150, available: 42 },
    isDemo: true,
    isActive: true,
    staffEmail: null,
  },
  {
    name: 'Care Hospitals Banjara Hills',
    address: 'Road No. 1, Banjara Hills, Hyderabad - 500034',
    location: { lat: 17.4142, lng: 78.4489 },
    phone: '+914040553553',
    email: 'care.banjarahills@demo.com',
    specialties: ['Cardiology', 'Emergency Medicine', 'ICU', 'Respiratory Medicine'],
    facilities: ['Cath Lab', 'ICU', 'Cardiac ICU', 'Ventilators', 'Defibrillator', 'Operation Theatre'],
    emergencyDepartment: { isAvailable: true, capacity: 25, currentOccupancy: 15 },
    icuBeds: { total: 20, available: 4 },
    generalBeds: { total: 180, available: 38 },
    isDemo: true,
    isActive: true,
    staffEmail: null,
  },
  {
    name: 'Government General Hospital (GGH)',
    address: 'Afzalgunj, Hyderabad - 500004',
    location: { lat: 17.3788, lng: 78.4685 },
    phone: '+914024600011',
    email: 'ggh.hyderabad@demo.com',
    specialties: ['Emergency Medicine', 'General Surgery', 'Pediatrics', 'Obstetrics', 'Psychiatry'],
    facilities: ['Emergency Department', 'Operation Theatre', 'Blood Bank', 'Labour Room', 'Psychiatric Ward'],
    emergencyDepartment: { isAvailable: true, capacity: 100, currentOccupancy: 72 },
    icuBeds: { total: 25, available: 2 },
    generalBeds: { total: 500, available: 125 },
    isDemo: true,
    isActive: true,
    staffEmail: null,
  },
];

async function seed() {
  const mongoUri = process.env.MONGODB_URI || 'mongodb://localhost:27017/sabs_db';

  console.log('\n🌱 SABS Database Seeder');
  console.log('========================');
  console.log(`Connecting to: ${mongoUri}`);

  try {
    await mongoose.connect(mongoUri);
    console.log('✅ Connected to MongoDB\n');

    // --- USERS ---
    console.log('👥 Creating demo users...');
    const createdUsers: Record<string, any> = {};

    for (const userData of DEMO_USERS) {
      const existing = await User.findOne({ email: userData.email });
      if (existing) {
        console.log(`  ⏭️  User already exists: ${userData.email}`);
        createdUsers[userData.email] = existing;
        continue;
      }

      // Create new user (password will be hashed by pre-save hook)
      const user = await User.create(userData);
      createdUsers[userData.email] = user;
      console.log(`  ✅ Created ${userData.role}: ${userData.name} (${userData.email})`);
    }

    // --- AMBULANCES ---
    console.log('\n🚑 Creating demo ambulances...');
    const createdAmbulances: any[] = [];

    for (const ambConfig of DEMO_AMBULANCES_CONFIG) {
      const driverUser = ambConfig.driverEmail ? createdUsers[ambConfig.driverEmail] : null;

      const existing = await Ambulance.findOne({ vehicleNumber: ambConfig.vehicleNumber });
      if (existing) {
        console.log(`  ⏭️  Ambulance already exists: ${ambConfig.vehicleNumber}`);
        createdAmbulances.push(existing);
        continue;
      }

      const ambulance = await Ambulance.create({
        vehicleNumber: ambConfig.vehicleNumber,
        type: ambConfig.type,
        capabilities: ambConfig.capabilities,
        equipment: ambConfig.equipment,
        make: ambConfig.make,
        vehicleModel: ambConfig.model,
        driver: driverUser?._id,
        currentLocation: {
          lat: ambConfig.location.lat,
          lng: ambConfig.location.lng,
          timestamp: new Date(),
        },
        lastLocationUpdate: new Date(),
        isOnline: !!driverUser,
        status: driverUser ? 'available' : 'offline',
        isSimulated: true,
        fuelLevel: 80 + Math.floor(Math.random() * 20),
      });

      createdAmbulances.push(ambulance);
      const driverName = driverUser ? ` — Driver: ${driverUser.name}` : ' — No driver assigned';
      console.log(`  ✅ Created ${ambConfig.type}: ${ambConfig.vehicleNumber}${driverName}`);
    }

    // --- HOSPITALS ---
    console.log('\n🏥 Creating demo hospitals...');

    for (const hospConfig of DEMO_HOSPITALS) {
      const existing = await Hospital.findOne({ name: hospConfig.name });
      if (existing) {
        console.log(`  ⏭️  Hospital already exists: ${hospConfig.name}`);
        continue;
      }

      const staffMember = hospConfig.staffEmail ? createdUsers[hospConfig.staffEmail] : null;

      const hospital = await Hospital.create({
        ...hospConfig,
        staffMembers: staffMember ? [staffMember._id] : [],
        capacityLastUpdated: new Date(),
      });
      console.log(`  ✅ Created hospital: ${hospConfig.name}`);

      // Associate hospital with staff user
      if (staffMember) {
        console.log(`     👨‍⚕️ Staff: ${staffMember.name}`);
      }
    }

    console.log('\n🎉 Seed completed successfully!\n');
    console.log('═══════════════════════════════════════════');
    console.log('DEMO CREDENTIALS');
    console.log('═══════════════════════════════════════════');
    console.log('Admin:          admin@sabs.com      / Admin@123');
    console.log('Patient:        patient@sabs.com    / Patient@123');
    console.log('Patient 2:      patient2@sabs.com   / Patient@123');
    console.log('Driver 1 (ALS): driver1@sabs.com    / Driver@123');
    console.log('Driver 2 (BLS): driver2@sabs.com    / Driver@123');
    console.log('Driver 3 (CCT): driver3@sabs.com    / Driver@123');
    console.log('Hospital Staff: hospital@sabs.com   / Hospital@123');
    console.log('═══════════════════════════════════════════\n');

  } catch (error) {
    console.error('❌ Seed failed:', error);
    throw error;
  } finally {
    await mongoose.connection.close();
    console.log('Database connection closed.');
  }
}

seed().catch((err) => {
  console.error(err);
  process.exit(1);
});
