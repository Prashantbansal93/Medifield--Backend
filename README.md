# Medifield Server

B2B pharmaceutical supply-chain API connecting **Retailers**, **Wholesalers**, **Delivery partners**, and **Admins**.

## Tech Stack

- Node.js + Express 5
- MongoDB + Mongoose
- JWT authentication
- Socket.IO realtime order events
- Helmet + rate limiting for production security

## Quick Start

```bash
cd server
npm install
cp .env.example .env
# Edit .env with your MongoDB URI and JWT secret
npm run seed:demo
npm run dev
```

Server runs at `http://localhost:5000`

## Environment Variables

| Variable | Required | Default | Description |
|----------|----------|---------|-------------|
| `MONGO_URI` | Yes | — | MongoDB connection string |
| `JWT_SECRET` | Yes | — | Secret for signing JWTs (32+ chars recommended) |
| `PORT` | No | 5000 | HTTP port |
| `CORS_ORIGIN` | No | http://localhost:3000 | Allowed frontend origin |
| `JWT_EXPIRES_IN` | No | 7d | Token expiry |
| `ADMIN_CODE` | No | MEDI-ADMIN-2026 | Admin registration/login code |
| `WHOLESALER_WAIT_MINUTES` | No | 5 | Wholesaler accept/reject window |

## Demo Credentials (after `npm run seed:demo`)

| Role | Email | Password |
|------|-------|----------|
| Retailer | retailer@medifield.demo | Retailer@123 |
| Delivery | delivery@medifield.demo | Delivery@123 |
| Admin | admin@medifield.demo | Admin@123 |
| Wholesaler | wholesaler1@medifield.demo | Wholesaler@123 |

## API Endpoints

### Auth — `/api/auth`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| POST | `/register` | No | Register (all roles) |
| POST | `/login` | No | Login, returns JWT |
| GET | `/me` | Bearer | Current user profile |

### Medicines — `/api/medicines`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/search?q=` | Bearer | Verified | Search medicines with stock |
| GET | `/` | Bearer | Admin | List all medicines |
| POST | `/` | Bearer | Admin | Create medicine |
| PUT | `/:id` | Bearer | Admin | Update medicine |
| DELETE | `/:id` | Bearer | Admin | Delete medicine |

### Orders — `/api/orders`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| POST | `/create` | Bearer | Retailer | Place order |
| POST | `/respond` | Bearer | Wholesaler | Accept or reject |
| POST | `/pack` | Bearer | Wholesaler | Mark order packed |
| POST | `/update-status` | Bearer | Delivery | Update delivery status + GPS |
| GET | `/` | Bearer | All | List role-filtered orders |
| GET | `/:id` | Bearer | All | Get single order |

### Retailers — `/api/retailers`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/profile` | Bearer | Retailer | Get retailer profile |
| PUT | `/profile` | Bearer | Retailer | Update name, phone, shop, location |
| GET | `/orders/history` | Bearer | Retailer | Past bills (default: delivered orders) |
| GET | `/orders/history/:orderId` | Bearer | Retailer | Single delivered bill with timeline |

**History query params:** `?page=1&limit=10&status=DELIVERED` (also `REJECTED`, `FAILED`, `ALL`)

### Wholesalers — `/api/wholesalers`

| Method | Path | Auth | Role | Description |
|--------|------|------|------|-------------|
| GET | `/profile` | Bearer | Wholesaler | Get business profile |
| PUT | `/profile` | Bearer | Wholesaler | Update profile/location |
| GET | `/inventory` | Bearer | Wholesaler | List inventory |
| POST | `/inventory` | Bearer | Wholesaler | Add/update stock item |
| DELETE | `/inventory/:medicineId` | Bearer | Wholesaler | Remove stock item |

### Admin — `/api/admin`

| Method | Path | Auth | Description |
|--------|------|------|-------------|
| GET | `/overview` | Admin | Dashboard metrics |
| GET | `/users` | Admin | List users (filter by role/status) |
| PATCH | `/users/:id/verify` | Admin | Approve/reject user |
| PATCH | `/wholesalers/:id/priority` | Admin | Set wholesaler priority rank |

## Order Lifecycle

```
WAITING_WHOLESALER → ACCEPTED → PACKED → PICKED → OUT_FOR_DELIVERY → DELIVERED
        ↓ reject/timeout
   next wholesaler (failover) or REJECTED/FAILED
```

- Wholesaler has **5 minutes** to respond (auto-reroute on timeout)
- Stock is **deducted** when wholesaler accepts
- Delivery requires **OTP** to mark DELIVERED
- **Prescription URL** required for prescription medicines

## Socket.IO

Connect with JWT:

```js
import { io } from 'socket.io-client';
const socket = io('http://localhost:5000', { auth: { token: jwt } });
socket.on('order:created', (order) => { /* ... */ });
socket.on('order:updated', (order) => { /* ... */ });
```

Rooms: `user:{id}`, `role:{role}`

## Scripts

| Command | Description |
|---------|-------------|
| `npm start` | Start production server |
| `npm run dev` | Start development server |
| `npm run seed:demo` | Seed demo data |
| `node scripts/clearDatabase.js` | Drop entire database |

## Architecture

```
src/
├── index.js              # App bootstrap
├── config/env.js         # Env validation
├── middleware/           # Auth, error handling
├── models/               # Mongoose schemas
├── routes/               # API endpoints
├── utils/                # Validation, order helpers
├── jobs/                 # Background jobs (timeout)
└── realtime.js           # Socket.IO
```

## Verification Flow

1. User registers → `verificationStatus: PENDING`
2. Admin approves via `PATCH /api/admin/users/:id/verify`
3. Only **APPROVED** users can access protected business endpoints
4. **REJECTED** users cannot login
