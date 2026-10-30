# 🚑 SABS — Smart Ambulance Booking System

**Real-Time Emergency Response, Intelligent Dispatch & Hospital Coordination Platform**

A full-stack emergency response system built as an academic engineering project demonstrating real-time dispatch algorithms, WebSocket GPS tracking, AI-assisted triage, and multi-role dashboards.

---

## 🏗 Architecture

```
┌──────────────────┐      REST + WS       ┌──────────────────┐       Mongoose       ┌───────────┐
│   Next.js 16     │ ◄──────────────────► │  Express + TS     │ ◄─────────────────► │  MongoDB  │
│   Frontend       │    Socket.IO          │  Backend API      │                      │  (Local)  │
│   Port 3000      │                       │  Port 5000        │                      │           │
└──────────────────┘                       └──────────────────┘                       └───────────┘
```

| Layer | Tech | Purpose |
|-------|------|---------|
| Frontend | Next.js 16, React 19, TailwindCSS, Socket.IO Client, Lucide Icons | 4 role dashboards, real-time UI |
| Backend | Express 4, TypeScript, Socket.IO Server | REST API + WebSocket events |
| Database | MongoDB + Mongoose 8 | Document models with validation |
| AI | Google Gemini API (optional) + rule-based fallback | Emergency classification |
| Auth | JWT + bcrypt + role-based middleware | Secure multi-role access |

---

## ✨ Key Features

### 🧠 Intelligent Dispatch Engine
- Haversine distance + capability matching + ETA scoring
- Atomic ambulance reservation (prevents double-booking)
- 30-second driver response timeout with automatic reassignment
- Explainable scoring: each candidate gets a breakdown of why it was selected

### 🏥 Hospital Recommendation
- Specialty matching against emergency category
- Live ICU / General / ED bed availability
- Distance + capacity weighted scoring
- Pre-arrival clinical notifications via Socket.IO

### 📡 Real-Time Telemetry
- Driver GPS → Socket.IO → Admin Map + Patient Tracking
- Trip GPS trails stored in MongoDB
- Simulated GPS routes for demo (clearly labeled `⚠️ SIMULATED`)

### 🤖 AI Emergency Intake
- Google Gemini 1.5 Flash for natural language emergency classification
- Rule-based fallback when API key not configured
- Classifies: category, urgency, suggested ambulance type

### 🔒 Security
- JWT authentication with role-based authorization
- bcrypt password hashing (10 rounds)
- Helmet security headers
- Rate limiting (100 req / 15 min)
- Input validation with Zod
- Audit logging (capped MongoDB collection)

---

## 👥 Four Role Dashboards

| Role | Features |
|------|----------|
| **Patient** | SOS booking with AI triage, live ambulance tracking, booking history, cancel |
| **Driver** | Accept/decline alerts, trip status advancement, GPS broadcasting, online/offline toggle |
| **Hospital Staff** | Bed capacity editor (ICU/General/ED), pre-arrival notifications, specialty display |
| **Admin** | KPI overview, fleet grid, booking table, audit logs, live activity feed, manual dispatch |

---

## 🗂 Project Structure

```
SABS/
├── backend/
│   ├── src/
│   │   ├── config/          # database.ts
│   │   ├── middleware/       # auth.ts, errorHandler.ts
│   │   ├── models/           # User, Ambulance, Booking, Trip, Hospital, Notification, AuditLog, Feedback
│   │   ├── routes/           # auth, bookings, trips, ambulances, hospitals, drivers, analytics, admin, ai, users, notifications
│   │   ├── services/         # dispatchService, hospitalService, notificationService
│   │   ├── sockets/          # socketHandler.ts
│   │   ├── utils/            # logger.ts, geoUtils.ts
│   │   ├── scripts/          # seed.ts
│   │   ├── __tests__/        # api.test.ts (12 test scenarios)
│   │   └── server.ts         # Entry point
│   ├── package.json
│   ├── tsconfig.json
│   └── .env
├── frontend/
│   ├── src/
│   │   ├── app/
│   │   │   ├── page.tsx              # Landing page
│   │   │   ├── login/page.tsx        # Login with demo quick-fill
│   │   │   ├── register/page.tsx     # Registration with role picker
│   │   │   └── dashboard/
│   │   │       ├── patient/page.tsx  # Patient SOS dashboard
│   │   │       ├── driver/page.tsx   # Driver response dashboard
│   │   │       ├── hospital/page.tsx # Hospital capacity dashboard
│   │   │       └── admin/page.tsx    # Admin command center
│   │   ├── components/   # Navbar.tsx
│   │   ├── contexts/     # AuthContext.tsx, SocketContext.tsx
│   │   └── lib/          # api.ts (Axios client)
│   ├── .env.local
│   └── package.json
└── README.md
```

---

## 🚀 Quick Start

### Prerequisites
- **Node.js** ≥ 18
- **MongoDB** running locally on port 27017

### 1. Clone & Install

```bash
# Backend
cd backend
npm install

# Frontend
cd ../frontend
npm install
```

### 2. Configure Environment

Backend `.env` is pre-configured for local development:
```env
PORT=5000
MONGODB_URI=mongodb://localhost:27017/sabs_db
JWT_SECRET=sabs_secure_jwt_secret_key_2024
FRONTEND_URL=http://localhost:3000
GEMINI_API_KEY=your_gemini_api_key_here  # Optional — rule-based fallback works without it
```

### 3. Seed Database

```bash
cd backend
npm run seed
```

Creates 8 demo users, 4 ambulances, and 5 Hyderabad hospitals.

### 4. Start Servers

```bash
# Terminal 1 — Backend
cd backend
npm run dev   # Port 5000

# Terminal 2 — Frontend
cd frontend
npm run dev   # Port 3000
```

### 5. Open App

Visit **http://localhost:3000** and use one-click demo login buttons.

---

## 🔑 Demo Credentials

| Role | Email | Password |
|------|-------|----------|
| Admin | admin@sabs.com | Admin@123 |
| Patient | patient@sabs.com | Patient@123 |
| Patient 2 | patient2@sabs.com | Patient@123 |
| Driver 1 (ALS) | driver1@sabs.com | Driver@123 |
| Driver 2 (BLS) | driver2@sabs.com | Driver@123 |
| Driver 3 (CCT) | driver3@sabs.com | Driver@123 |
| Hospital Staff | hospital@sabs.com | Hospital@123 |

---

## 📡 API Endpoints

### Auth
| Method | Route | Access |
|--------|-------|--------|
| POST | `/api/auth/register` | Public |
| POST | `/api/auth/login` | Public |
| GET | `/api/auth/me` | Authenticated |
| PUT | `/api/auth/profile` | Authenticated |
| POST | `/api/auth/change-password` | Authenticated |

### Bookings
| Method | Route | Access |
|--------|-------|--------|
| POST | `/api/bookings` | Patient |
| GET | `/api/bookings` | Authenticated |
| GET | `/api/bookings/:id` | Owner/Admin |
| POST | `/api/bookings/:id/cancel` | Owner/Admin |
| GET | `/api/bookings/:id/hospitals` | Authenticated |
| POST | `/api/bookings/:id/select-hospital` | Authenticated |

### Trips
| Method | Route | Access |
|--------|-------|--------|
| GET | `/api/trips` | Authenticated |
| GET | `/api/trips/active` | Driver |
| PUT | `/api/trips/:id/status` | Driver/Admin |
| POST | `/api/trips/:id/feedback` | Patient |

### Ambulances
| Method | Route | Access |
|--------|-------|--------|
| GET | `/api/ambulances` | Authenticated |
| POST | `/api/ambulances` | Admin |
| PUT | `/api/ambulances/:id/assign-driver` | Admin |
| PUT | `/api/ambulances/:id/location` | Driver |
| PUT | `/api/ambulances/:id/availability` | Driver/Admin |

### Hospitals
| Method | Route | Access |
|--------|-------|--------|
| GET | `/api/hospitals` | Authenticated |
| POST | `/api/hospitals` | Admin |
| PUT | `/api/hospitals/:id/capacity` | Hospital Staff/Admin |
| POST | `/api/hospitals/:id/pre-arrival` | Authenticated |

### Analytics & Admin
| Method | Route | Access |
|--------|-------|--------|
| GET | `/api/analytics/overview` | Admin/Hospital |
| GET | `/api/analytics/bookings-over-time` | Admin |
| GET | `/api/analytics/emergency-categories` | Admin |
| GET | `/api/analytics/ambulance-utilization` | Admin |
| GET | `/api/analytics/response-times` | Admin |
| GET | `/api/admin/users` | Admin |
| POST | `/api/admin/bookings/:id/manual-assign` | Admin |
| POST | `/api/admin/bookings/:id/force-dispatch` | Admin |
| GET | `/api/admin/audit-logs` | Admin |

### AI
| Method | Route | Access |
|--------|-------|--------|
| POST | `/api/ai/analyze-emergency` | Authenticated |

---

## 🧪 Automated Testing (100% Pass)

```bash
cd backend
npm test          # Run all 33 test scenarios across 12 suites
npm run test:coverage  # With coverage report
```

```
PASS  src/__tests__/api.test.ts
  Test Suites: 1 passed, 1 total
  Tests:       33 passed, 33 total
  Snapshots:   0 total
  Time:        ~14 s
```

### Verified Test Scenarios
1. **Registration and Login (8 tests):** Patient/driver/staff/admin registration, duplicate email rejection (409), password check, invalid credential rejection
2. **Role-Based Access Control (6 tests):** Admin route isolation, 403 checks for patient/driver, 401 unauthenticated & invalid token rejection, `/auth/me` verification
3. **Database Setup for Dispatch (2 tests):** Hospital creation, ALS ambulance registration & driver assignment
4. **Invalid Booking Rejection:** Payload validation (missing coords, missing category)
5. **Valid SOS Booking:** Instant dispatch creation, duplicate active booking prevention
6. **Nearest Ambulance Selection:** Haversine distance-based dispatch selection
7. **No Ambulance Available Handling:** Graceful `no_ambulance_available` status handling
8. **Hospital Capacity Validation (3 tests):** Over-capacity bed rejection, negative count rejection, valid capacity update
9. **Trip Status Transitions (2 tests):** Strict FSM progression enforcement, jumping steps rejection
10. **Unauthorized Access Prevention (3 tests):** Cross-patient booking isolation, non-driver trip status updates, driver location spoofing prevention
11. **Analytics (2 tests):** Real MongoDB aggregation metrics, patient access denial
12. **Booking Cancellation Edge Cases:** Idempotent cancellation prevention

---

## 📊 Data Models

| Model | Key Fields |
|-------|-----------|
| **User** | name, email, password (bcrypt), role, phone, bloodGroup, isActive |
| **Ambulance** | vehicleNumber, type (BLS/ALS/CCT/NICU), status, currentLocation, driver, capabilities |
| **Booking** | bookingId (SOS-*), emergencyCategory, pickupLocation, status, priority, assignmentAttempts |
| **Trip** | tripId, currentStatus (strict FSM transitions), gpsTrail, statusHistory, actualDurationMinutes |
| **Hospital** | name, specialties, icuBeds, generalBeds, emergencyDepartment, location |
| **Notification** | recipient, type, title, message, isRead |
| **AuditLog** | actor, action, targetModel, details (capped collection) |
| **Feedback** | overallRating, driverRating, hospitalRating, responseTimeRating |

---

## 🔧 Socket.IO Events

| Event | Direction | Description |
|-------|-----------|-------------|
| `location_update` | Driver → Server | GPS coordinates broadcast |
| `ambulance_location_update` | Server → Admin/Patient | Real-time location updates |
| `new_booking_request` | Server → Driver | Incoming dispatch alert |
| `booking_status_update` | Server → Patient | Booking state changes |
| `pre_arrival_notification` | Server → Hospital | Patient incoming alert |
| `set_availability` | Driver → Server | Go online/offline |
| `start_gps_simulation` | Admin → Server | Demo GPS simulation |

---

## 🎓 Academic Project

Built as the final-year engineering project demonstrating:
- Full-stack TypeScript development
- Real-time systems with WebSockets
- Geospatial algorithms (Haversine, bounding box)
- AI integration (Gemini API)
- Role-based access control
- Atomic database operations
- State machine enforcement
- Comprehensive test coverage

**Tech Stack:** Next.js 16 · React 19 · TypeScript · Express · MongoDB · Mongoose · Socket.IO · JWT · Gemini AI · TailwindCSS · Lucide Icons · Jest
