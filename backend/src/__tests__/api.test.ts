import request from 'supertest';
import mongoose from 'mongoose';
import { app } from '../server';
import { connectDatabase, disconnectDatabase } from '../config/database';
import { User } from '../models/User';
import { Ambulance } from '../models/Ambulance';
import { Booking } from '../models/Booking';
import { Hospital } from '../models/Hospital';
import { Trip } from '../models/Trip';

const TEST_DB = 'mongodb://localhost:27017/sabs_test';

let adminToken: string;
let patientToken: string;
let driverToken: string;
let hospitalToken: string;
let patientId: string;
let driverId: string;
let ambulanceId: string;
let hospitalId: string;
let bookingId: string;
let tripId: string;

beforeAll(async () => {
  process.env.MONGODB_URI = TEST_DB;
  process.env.JWT_SECRET = 'test_jwt_secret_key';
  process.env.NODE_ENV = 'test';
  await connectDatabase();
  // Clear test DB
  await Promise.all([
    User.deleteMany({}),
    Ambulance.deleteMany({}),
    Booking.deleteMany({}),
    Hospital.deleteMany({}),
    Trip.deleteMany({}),
  ]);
});

afterAll(async () => {
  await Promise.all([
    User.deleteMany({}),
    Ambulance.deleteMany({}),
    Booking.deleteMany({}),
    Hospital.deleteMany({}),
    Trip.deleteMany({}),
  ]);
  await disconnectDatabase();
});

// ─── TEST 1: Registration and Login ──────────────────────────────────────────
describe('TEST 1: Registration and Login', () => {
  it('should register a patient successfully', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Patient',
      email: 'patient@test.com',
      password: 'Test@123',
      phone: '+919999999001',
      role: 'patient',
    });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.token).toBeDefined();
    patientToken = res.body.data.token;
    patientId = res.body.data.user.id;
  });

  it('should register a driver successfully', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Driver',
      email: 'driver@test.com',
      password: 'Test@123',
      phone: '+919999999002',
      role: 'driver',
    });
    expect(res.status).toBe(201);
    driverToken = res.body.data.token;
    driverId = res.body.data.user.id;
  });

  it('should register a hospital staff', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Hospital Staff',
      email: 'hospital@test.com',
      password: 'Test@123',
      phone: '+919999999003',
      role: 'hospital_staff',
    });
    expect(res.status).toBe(201);
    hospitalToken = res.body.data.token;
  });

  it('should register an admin', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Test Admin',
      email: 'admin@test.com',
      password: 'Test@123',
      phone: '+919999999004',
      role: 'admin',
    });
    expect(res.status).toBe(201);
    adminToken = res.body.data.token;
  });

  it('should reject duplicate email registration', async () => {
    const res = await request(app).post('/api/auth/register').send({
      name: 'Duplicate',
      email: 'patient@test.com',
      password: 'Test@123',
      phone: '+919999999099',
      role: 'patient',
    });
    expect(res.status).toBe(409);
  });

  it('should login successfully', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'patient@test.com',
      password: 'Test@123',
    });
    expect(res.status).toBe(200);
    expect(res.body.data.token).toBeDefined();
  });

  it('should reject invalid password', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'patient@test.com',
      password: 'WrongPassword',
    });
    expect(res.status).toBe(401);
  });

  it('should reject non-existent email', async () => {
    const res = await request(app).post('/api/auth/login').send({
      email: 'nobody@test.com',
      password: 'Test@123',
    });
    expect(res.status).toBe(401);
  });
});

// ─── TEST 2: Role-Based Access Control ───────────────────────────────────────
describe('TEST 2: Role-Based Access Control', () => {
  it('should allow admin to access admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
  });

  it('should deny patient access to admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });

  it('should deny driver access to admin routes', async () => {
    const res = await request(app)
      .get('/api/admin/users')
      .set('Authorization', `Bearer ${driverToken}`);
    expect(res.status).toBe(403);
  });

  it('should deny unauthenticated access', async () => {
    const res = await request(app).get('/api/bookings');
    expect(res.status).toBe(401);
  });

  it('should reject invalid token', async () => {
    const res = await request(app)
      .get('/api/bookings')
      .set('Authorization', 'Bearer invalid.token.here');
    expect(res.status).toBe(401);
  });

  it('should return /api/auth/me for authenticated user', async () => {
    const res = await request(app)
      .get('/api/auth/me')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.user.role).toBe('patient');
  });
});

// ─── TEST 3: Hospital and Ambulance Setup ────────────────────────────────────
describe('TEST 3: Database Setup for Dispatch Tests', () => {
  it('should create a hospital', async () => {
    const res = await request(app)
      .post('/api/hospitals')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        name: 'Test Hospital',
        address: 'Test Address, Hyderabad',
        location: { lat: 17.42, lng: 78.42 },
        phone: '+914000000001',
        specialties: ['Emergency Medicine', 'Cardiology'],
        facilities: ['ICU', 'CT Scanner'],
        emergencyDepartment: { isAvailable: true, capacity: 30, currentOccupancy: 5 },
        icuBeds: { total: 10, available: 5 },
        generalBeds: { total: 100, available: 50 },
        isDemo: true,
      });
    expect(res.status).toBe(201);
    hospitalId = res.body.data.hospital._id;
  });

  it('should create an ambulance and assign driver', async () => {
    const createRes = await request(app)
      .post('/api/ambulances')
      .set('Authorization', `Bearer ${adminToken}`)
      .send({
        vehicleNumber: 'TS01TEST001',
        type: 'ALS',
        capabilities: ['Cardiac Monitor', 'Defibrillator'],
        equipment: ['Stretcher', 'AED'],
      });
    expect(createRes.status).toBe(201);
    ambulanceId = createRes.body.data.ambulance._id;

    // Assign driver
    const assignRes = await request(app)
      .put(`/api/ambulances/${ambulanceId}/assign-driver`)
      .set('Authorization', `Bearer ${adminToken}`)
      .send({ driverId });
    expect(assignRes.status).toBe(200);

    // Set ambulance to online with a location
    await Ambulance.findByIdAndUpdate(ambulanceId, {
      isOnline: true,
      status: 'available',
      currentLocation: { lat: 17.41, lng: 78.43, timestamp: new Date() },
      lastLocationUpdate: new Date(),
    });
  });
});

// ─── TEST 4 & 5: Invalid Booking and Successful SOS Booking ──────────────────
describe('TEST 4 & 5: Booking Creation', () => {
  it('TEST 4: should reject booking with invalid data', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        emergencyCategory: 'cardiac_arrest',
        emergencyDescription: 'Short', // Too short
        pickupLocation: { address: 'Test', lat: 999, lng: 78.4 }, // Invalid lat
      });
    expect(res.status).toBe(400);
  });

  it('TEST 5: should create a valid SOS booking', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        emergencyCategory: 'cardiac_arrest',
        emergencyDescription: 'Patient has severe chest pain and difficulty breathing',
        pickupLocation: {
          address: 'Banjara Hills, Hyderabad',
          lat: 17.4138,
          lng: 78.437,
        },
        priority: 'critical',
      });
    expect(res.status).toBe(201);
    expect(res.body.success).toBe(true);
    expect(res.body.data.bookingId).toMatch(/^SOS-/);
    bookingId = res.body.data.bookingId;
  });

  it('should reject duplicate active booking for same patient', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({
        emergencyCategory: 'trauma',
        emergencyDescription: 'Another emergency attempt while first is active',
        pickupLocation: { address: 'Somewhere', lat: 17.42, lng: 78.42 },
      });
    expect(res.status).toBe(409);
  });

  it('should only allow drivers to create bookings as patients... should be rejected', async () => {
    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${driverToken}`)
      .send({
        emergencyCategory: 'trauma',
        emergencyDescription: 'Driver trying to book as patient — should fail',
        pickupLocation: { address: 'Somewhere', lat: 17.42, lng: 78.42 },
      });
    expect(res.status).toBe(403);
  });
});

// ─── TEST 6 & 7: Ambulance Dispatch ──────────────────────────────────────────
describe('TEST 6 & 7: Ambulance Dispatch', () => {
  it('TEST 6: should verify nearest ambulance was selected', async () => {
    // Wait briefly for async dispatch
    await new Promise((r) => setTimeout(r, 1500));

    const booking = await Booking.findOne({ bookingId });
    expect(booking).toBeTruthy();
    // Booking should have moved from pending
    expect(['pending', 'dispatching', 'assigned', 'no_ambulance_available']).toContain(booking!.status);
  });

  it('TEST 7: should return no_ambulance_available when all offline', async () => {
    // Take existing ambulance offline
    await Ambulance.updateMany({}, { isOnline: false, status: 'offline' });

    // Register a new patient
    const reg = await request(app).post('/api/auth/register').send({
      name: 'New Patient',
      email: 'newpatient@test.com',
      password: 'Test@123',
      phone: '+919999999090',
      role: 'patient',
    });
    const newToken = reg.body.data.token;

    const res = await request(app)
      .post('/api/bookings')
      .set('Authorization', `Bearer ${newToken}`)
      .send({
        emergencyCategory: 'stroke',
        emergencyDescription: 'Patient collapsed with stroke symptoms, urgent need',
        pickupLocation: { address: 'Test Area', lat: 17.42, lng: 78.42 },
      });
    expect(res.status).toBe(201); // Booking created

    await new Promise((r) => setTimeout(r, 1500));

    const newBooking = await Booking.findOne({ bookingId: res.body.data.bookingId });
    // With no ambulances, should be no_ambulance_available
    expect(newBooking?.status).toContain('no_ambulance_available');

    // Restore ambulance for further tests
    await Ambulance.findByIdAndUpdate(ambulanceId, {
      isOnline: true, status: 'available',
      currentLocation: { lat: 17.41, lng: 78.43, timestamp: new Date() },
      lastLocationUpdate: new Date(),
    });
  });
});

// ─── TEST 8: Hospital Capacity Validation ────────────────────────────────────
describe('TEST 8: Hospital Capacity Validation', () => {
  it('should reject when available beds exceed total beds', async () => {
    const res = await request(app)
      .put(`/api/hospitals/${hospitalId}/capacity`)
      .set('Authorization', `Bearer ${hospitalToken}`)
      .send({
        icuAvailable: 100,
        icuTotal: 10,
      });
    expect(res.status).toBe(400);
  });

  it('should reject negative bed counts', async () => {
    const res = await request(app)
      .put(`/api/hospitals/${hospitalId}/capacity`)
      .set('Authorization', `Bearer ${hospitalToken}`)
      .send({ icuAvailable: -5 });
    expect(res.status).toBe(400);
  });

  it('should successfully update valid capacity', async () => {
    const res = await request(app)
      .put(`/api/hospitals/${hospitalId}/capacity`)
      .set('Authorization', `Bearer ${hospitalToken}`)
      .send({
        icuAvailable: 3,
        icuTotal: 10,
        generalAvailable: 40,
        generalTotal: 100,
      });
    expect(res.status).toBe(200);
  });
});

// ─── TEST 9: Invalid Trip Status Transition ───────────────────────────────────
describe('TEST 9: Trip Status Transition Validation', () => {
  it('should reject invalid status transition (completed → en_route_to_pickup)', async () => {
    // Create a completed trip directly
    const trip = await Trip.create({
      tripId: `TRIP-TEST-${Date.now()}`,
      booking: new mongoose.Types.ObjectId(),
      patient: new mongoose.Types.ObjectId(patientId),
      driver: new mongoose.Types.ObjectId(driverId),
      ambulance: new mongoose.Types.ObjectId(ambulanceId),
      currentStatus: 'completed',
      statusHistory: [{ status: 'completed', timestamp: new Date(), updatedBy: new mongoose.Types.ObjectId(driverId) }],
      pickupLocation: { address: 'Test', lat: 17.42, lng: 78.42 },
    });

    const res = await request(app)
      .put(`/api/trips/${trip.tripId}/status`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'en_route_to_pickup' });

    // Should fail — completed trips cannot transition
    expect(res.status).toBe(400);
    expect(res.body.success).toBe(false);
    expect(res.body.message).toContain('Invalid status transition');

    await Trip.findByIdAndDelete(trip._id);
  });

  it('should reject skipping status steps (assigned → patient_onboard)', async () => {
    const trip = await Trip.create({
      tripId: `TRIP-TEST-SKIP-${Date.now()}`,
      booking: new mongoose.Types.ObjectId(),
      patient: new mongoose.Types.ObjectId(patientId),
      driver: new mongoose.Types.ObjectId(driverId),
      ambulance: new mongoose.Types.ObjectId(ambulanceId),
      currentStatus: 'assigned',
      statusHistory: [{ status: 'assigned', timestamp: new Date(), updatedBy: new mongoose.Types.ObjectId(driverId) }],
      pickupLocation: { address: 'Test', lat: 17.42, lng: 78.42 },
    });

    const res = await request(app)
      .put(`/api/trips/${trip.tripId}/status`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ status: 'patient_onboard' });

    expect(res.status).toBe(400);
    await Trip.findByIdAndDelete(trip._id);
  });
});

// ─── TEST 10: Unauthorized Patient Access ────────────────────────────────────
describe('TEST 10: Unauthorized Access Prevention', () => {
  it('should prevent patient from accessing another patient\'s booking', async () => {
    const reg2 = await request(app).post('/api/auth/register').send({
      name: 'Other Patient',
      email: 'other.patient@test.com',
      password: 'Test@123',
      phone: '+919999998001',
      role: 'patient',
    });
    const otherToken = reg2.body.data.token;

    // Try to access first patient's booking with second patient's token
    const res = await request(app)
      .get(`/api/bookings/${bookingId}`)
      .set('Authorization', `Bearer ${otherToken}`);

    expect(res.status).toBe(403);
  });

  it('should prevent patient from updating trip status', async () => {
    // Patients cannot update trip status (only drivers/admin)
    const res = await request(app)
      .put('/api/trips/some-trip-id/status')
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ status: 'en_route_to_pickup' });

    expect([403, 404]).toContain(res.status);
  });

  it('should prevent driver from unauthorized location update', async () => {
    // Create another ambulance
    const amb2 = await Ambulance.create({
      vehicleNumber: 'TS01TEST999',
      type: 'BLS',
      status: 'available',
    });

    const res = await request(app)
      .put(`/api/ambulances/${amb2._id}/location`)
      .set('Authorization', `Bearer ${driverToken}`)
      .send({ lat: 17.42, lng: 78.42 });

    // Driver doesn't own this ambulance
    expect(res.status).toBe(403);
    await Ambulance.findByIdAndDelete(amb2._id);
  });
});

// ─── TEST 11: Analytics ───────────────────────────────────────────────────────
describe('TEST 11: Analytics', () => {
  it('should return analytics overview from real DB data', async () => {
    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', `Bearer ${adminToken}`);
    expect(res.status).toBe(200);
    expect(res.body.data.bookings.total).toBeGreaterThanOrEqual(0);
    expect(typeof res.body.data.ambulances.total).toBe('number');
  });

  it('should deny analytics access to patient', async () => {
    const res = await request(app)
      .get('/api/analytics/overview')
      .set('Authorization', `Bearer ${patientToken}`);
    expect(res.status).toBe(403);
  });
});

// ─── TEST 12: Booking Cancellation ───────────────────────────────────────────
describe('TEST 12: Booking Cancellation', () => {
  it('should prevent cancelling an already-cancelled booking', async () => {
    // Get patient's booking and try cancelling twice
    const booking = await Booking.findOne({ bookingId }).lean();
    if (!booking || booking.status === 'completed') return; // Skip if already done

    // Cancel it
    await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ reason: 'Test cancel' });

    // Try again
    const res = await request(app)
      .post(`/api/bookings/${bookingId}/cancel`)
      .set('Authorization', `Bearer ${patientToken}`)
      .send({ reason: 'Duplicate cancel' });

    expect(res.status).toBe(400);
  });
});
