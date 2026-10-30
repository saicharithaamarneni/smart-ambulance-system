import { Server as SocketIOServer, Socket } from 'socket.io';
import { verifySocketToken } from '../middleware/auth';
import { Ambulance } from '../models/Ambulance';
import { Trip } from '../models/Trip';
import { io } from '../server';
import { isValidCoordinate } from '../utils/geoUtils';
import { logger } from '../utils/logger';

interface AuthenticatedSocket extends Socket {
  userId?: string;
  userRole?: string;
  userName?: string;
}

// Store connected users: userId -> socketId
const connectedUsers = new Map<string, string>();
// Store active GPS simulators
const activeSimulators = new Map<string, NodeJS.Timeout>();

export function setupSocketHandlers(socketServer: SocketIOServer): void {
  // Authentication middleware for socket connections
  socketServer.use(async (socket: AuthenticatedSocket, next) => {
    const token =
      socket.handshake.auth?.token ||
      socket.handshake.headers?.authorization?.split(' ')[1];

    if (!token) {
      logger.warn(`Socket connection rejected: no token (${socket.id})`);
      return next(new Error('Authentication required'));
    }

    const decoded = verifySocketToken(token);
    if (!decoded) {
      logger.warn(`Socket connection rejected: invalid token (${socket.id})`);
      return next(new Error('Invalid or expired token'));
    }

    socket.userId = decoded.id;
    socket.userRole = decoded.role;
    socket.userName = decoded.name;
    next();
  });

  socketServer.on('connection', (socket: AuthenticatedSocket) => {
    const userId = socket.userId!;
    const role = socket.userRole!;

    logger.info(`[SOCKET] User connected: ${userId} (${role}) — ${socket.id}`);
    connectedUsers.set(userId, socket.id);

    // Join role-specific rooms
    socket.join(`user_${userId}`);
    socket.join(`${role}_room`);

    if (role === 'admin') {
      socket.join('admin_room');
    }

    if (role === 'driver') {
      socket.join(`driver_${userId}`);
    }

    if (role === 'patient') {
      socket.join(`patient_${userId}`);
    }

    // Emit connection acknowledgment
    socket.emit('connected', {
      userId,
      role,
      socketId: socket.id,
      timestamp: new Date(),
    });

    // ---- DRIVER EVENTS ----

    // Driver sends GPS location update
    socket.on('location_update', async (data: {
      ambulanceId: string;
      lat: number;
      lng: number;
      accuracy?: number;
      heading?: number;
      speed?: number;
      isSimulated?: boolean;
    }) => {
      if (role !== 'driver') {
        socket.emit('error', { message: 'Only drivers can update location' });
        return;
      }

      if (!isValidCoordinate(data.lat, data.lng)) {
        socket.emit('error', { message: 'Invalid GPS coordinates' });
        return;
      }

      try {
        const ambulance = await Ambulance.findById(data.ambulanceId);
        if (!ambulance || ambulance.driver?.toString() !== userId) {
          socket.emit('error', { message: 'Unauthorized location update' });
          return;
        }

        const now = new Date();
        await Ambulance.findByIdAndUpdate(data.ambulanceId, {
          currentLocation: {
            lat: data.lat,
            lng: data.lng,
            accuracy: data.accuracy,
            heading: data.heading,
            speed: data.speed,
            timestamp: now,
          },
          lastLocationUpdate: now,
          isSimulated: data.isSimulated || false,
        });

        // Update GPS trail in active trip
        if (ambulance.currentBooking) {
          await Trip.findOneAndUpdate(
            { booking: ambulance.currentBooking, currentStatus: { $nin: ['completed'] } },
            {
              $push: {
                gpsTrail: {
                  lat: data.lat,
                  lng: data.lng,
                  timestamp: now,
                  speed: data.speed,
                  heading: data.heading,
                  isSimulated: data.isSimulated || false,
                },
              },
              lastKnownLocation: {
                lat: data.lat,
                lng: data.lng,
                timestamp: now,
                isSimulated: data.isSimulated || false,
              },
            }
          );
        }

        // Broadcast to admin room
        io.to('admin_room').emit('ambulance_location_update', {
          ambulanceId: data.ambulanceId,
          vehicleNumber: ambulance.vehicleNumber,
          location: { lat: data.lat, lng: data.lng, heading: data.heading, speed: data.speed },
          timestamp: now,
          isSimulated: data.isSimulated || ambulance.isSimulated,
        });

        // If active booking, notify patient
        if (ambulance.currentBooking) {
          const { Booking } = await import('../models/Booking');
          const booking = await Booking.findById(ambulance.currentBooking);
          if (booking) {
            io.to(`patient_${booking.patient}`).emit('ambulance_location_update', {
              vehicleNumber: ambulance.vehicleNumber,
              location: { lat: data.lat, lng: data.lng, heading: data.heading, speed: data.speed },
              timestamp: now,
              isSimulated: data.isSimulated || ambulance.isSimulated,
            });
          }
        }
      } catch (error) {
        logger.error('Location update error:', error);
        socket.emit('error', { message: 'Failed to update location' });
      }
    });

    // Driver goes online/offline
    socket.on('set_availability', async (data: { ambulanceId: string; isOnline: boolean }) => {
      if (role !== 'driver') return;
      try {
        const ambulance = await Ambulance.findById(data.ambulanceId);
        if (!ambulance || ambulance.driver?.toString() !== userId) return;

        await Ambulance.findByIdAndUpdate(data.ambulanceId, {
          isOnline: data.isOnline,
          status: data.isOnline ? 'available' : 'offline',
        });

        io.to('admin_room').emit('ambulance_availability_change', {
          ambulanceId: data.ambulanceId,
          vehicleNumber: ambulance.vehicleNumber,
          isOnline: data.isOnline,
          timestamp: new Date(),
        });

        socket.emit('availability_confirmed', { isOnline: data.isOnline });
        logger.info(`Driver ${userId} set ambulance ${ambulance.vehicleNumber} to ${data.isOnline ? 'online' : 'offline'}`);
      } catch (error) {
        logger.error('Availability update error:', error);
      }
    });

    // ---- SIMULATION EVENTS ---- (CLEARLY LABELED)
    socket.on('start_gps_simulation', async (data: {
      ambulanceId: string;
      route: Array<{ lat: number; lng: number }>;
      intervalMs?: number;
    }) => {
      if (role !== 'admin' && role !== 'driver') return;

      const key = `sim_${data.ambulanceId}`;
      if (activeSimulators.has(key)) {
        clearInterval(activeSimulators.get(key)!);
      }

      let routeIndex = 0;
      const route = data.route;
      const interval = data.intervalMs || 3000;

      logger.info(`[SIMULATION] Starting GPS simulation for ambulance ${data.ambulanceId}`);

      const timer = setInterval(async () => {
        if (routeIndex >= route.length) {
          clearInterval(timer);
          activeSimulators.delete(key);
          socket.emit('simulation_completed', { ambulanceId: data.ambulanceId });
          return;
        }

        const point = route[routeIndex];
        routeIndex++;

        try {
          await Ambulance.findByIdAndUpdate(data.ambulanceId, {
            currentLocation: { lat: point.lat, lng: point.lng, timestamp: new Date() },
            lastLocationUpdate: new Date(),
            isSimulated: true,
          });

          // Emit CLEARLY labeled as simulated
          io.to('admin_room').emit('ambulance_location_update', {
            ambulanceId: data.ambulanceId,
            location: { lat: point.lat, lng: point.lng },
            timestamp: new Date(),
            isSimulated: true,
            label: '⚠️ SIMULATED GPS',
          });
        } catch (error) {
          logger.error('Simulation update error:', error);
        }
      }, interval);

      activeSimulators.set(key, timer);
      socket.emit('simulation_started', { ambulanceId: data.ambulanceId, routePoints: route.length });
    });

    socket.on('stop_gps_simulation', (data: { ambulanceId: string }) => {
      const key = `sim_${data.ambulanceId}`;
      if (activeSimulators.has(key)) {
        clearInterval(activeSimulators.get(key)!);
        activeSimulators.delete(key);
        socket.emit('simulation_stopped', { ambulanceId: data.ambulanceId });
        logger.info(`[SIMULATION] Stopped GPS simulation for ambulance ${data.ambulanceId}`);
      }
    });

    // ---- PATIENT EVENTS ----
    socket.on('join_booking_room', (data: { bookingId: string }) => {
      if (role !== 'patient' && role !== 'admin') return;
      socket.join(`booking_${data.bookingId}`);
      logger.debug(`User ${userId} joined booking room ${data.bookingId}`);
    });

    // ---- HOSPITAL EVENTS ----
    socket.on('join_hospital_room', (data: { hospitalId: string }) => {
      if (role !== 'hospital_staff' && role !== 'admin') return;
      socket.join(`hospital_${data.hospitalId}`);
    });

    // ---- DISCONNECT ----
    socket.on('disconnect', async (reason) => {
      connectedUsers.delete(userId);
      logger.info(`[SOCKET] User disconnected: ${userId} (${role}) — reason: ${reason}`);

      // If driver disconnects, note their last active time (don't auto-offline)
      if (role === 'driver') {
        // Driver remains "online" in DB until they explicitly go offline
        // to prevent disrupting active trips
      }
    });

    socket.on('error', (error) => {
      logger.error(`[SOCKET] Error for user ${userId}:`, error);
    });
  });

  logger.info('[SOCKET] Socket.IO handlers initialized');
}

export function getConnectedUsers(): Map<string, string> {
  return connectedUsers;
}
