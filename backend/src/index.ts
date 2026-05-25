const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
import type { Request, Response } from 'express';
import type { Server as SocketIOServer, Socket } from 'socket.io';

type ServiceType = 'pasajero' | 'encomienda';
type TripStatus = 'PENDING' | 'CONDUCTOR_EN_CAMINO' | 'CANCELADO';

interface TripPoint {
  latitude?: number;
  longitude?: number;
  name?: string;
}

interface DriverProfile {
  id: string;
  name: string;
  vehicle: string;
  plate: string;
}

interface NearbyDriversRequestBody {
  origin?: { latitude?: number; longitude?: number };
  destination?: { latitude?: number; longitude?: number };
  serviceType?: ServiceType;
  packageNotes?: string;
}

interface CreateTripRequestBody {
  origin?: TripPoint;
  destination?: TripPoint;
  fare?: number;
  serviceType?: ServiceType;
  packageNotes?: string;
}

interface TripRecord {
  id: string;
  origin: Required<TripPoint>;
  destination: Required<TripPoint>;
  fare: number;
  serviceType: ServiceType;
  packageNotes?: string;
  status: TripStatus;
  createdAt: string;
  acceptedAt?: string;
  driver?: DriverProfile;
}

const app = express();
const PORT = process.env.PORT || 3000;
const trips = new Map<string, TripRecord>();
const httpServer = createServer(app);
const io: SocketIOServer = new Server(httpServer, {
  cors: {
    origin: '*',
  },
});

app.use(express.json());

const isValidCoordinate = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
const getTripIdFromParams = (tripIdParam: string | string[] | undefined): string | null =>
  typeof tripIdParam === 'string' ? tripIdParam : null;
const getTripRoom = (tripId: string) => `trip:${tripId}`;

const buildDriverProfile = (): DriverProfile => ({
  id: 'driver-001',
  name: 'Jhon Alex Motorizado',
  vehicle: 'AKT NKD 125',
  plate: 'FUS 219',
});

const getNextPendingTrip = (): TripRecord | null =>
  Array.from(trips.values()).find((trip) => trip.status === 'PENDING') ?? null;

const emitTripUpdate = (trip: TripRecord): void => {
  io.to(getTripRoom(trip.id)).emit('trip:updated', { trip });
};

const emitDriverQueueUpdate = (): void => {
  io.to('drivers').emit('driver:trip', { trip: getNextPendingTrip() });
};

io.on('connection', (socket: Socket) => {
  socket.on('driver:subscribe', () => {
    socket.join('drivers');
    socket.emit('driver:trip', { trip: getNextPendingTrip() });
  });

  socket.on('trip:watch', (tripId: unknown) => {
    if (typeof tripId !== 'string') {
      return;
    }

    socket.join(getTripRoom(tripId));
    socket.emit('trip:updated', { trip: trips.get(tripId) ?? null });
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Servidor de MovilFusa corriendo' });
});

app.post('/api/trips', (req: Request, res: Response) => {
  const { origin, destination, fare, serviceType, packageNotes } = req.body as CreateTripRequestBody;
  const resolvedServiceType: ServiceType = serviceType === 'encomienda' ? 'encomienda' : 'pasajero';

  if (
    !isValidCoordinate(origin?.latitude) ||
    !isValidCoordinate(origin?.longitude) ||
    !isValidCoordinate(destination?.latitude) ||
    !isValidCoordinate(destination?.longitude) ||
    typeof origin?.name !== 'string' ||
    typeof destination?.name !== 'string' ||
    typeof fare !== 'number' ||
    fare <= 0
  ) {
    return res.status(400).json({ message: 'Datos de viaje invalidos.' });
  }

  const trip: TripRecord = {
    id: `trip-${Date.now()}`,
    origin: {
      latitude: origin.latitude,
      longitude: origin.longitude,
      name: origin.name,
    },
    destination: {
      latitude: destination.latitude,
      longitude: destination.longitude,
      name: destination.name,
    },
    fare,
    serviceType: resolvedServiceType,
    status: 'PENDING',
    createdAt: new Date().toISOString(),
    ...(resolvedServiceType === 'encomienda' ? { packageNotes: packageNotes ?? '' } : {}),
  };

  trips.set(trip.id, trip);
  emitTripUpdate(trip);
  emitDriverQueueUpdate();

  res.status(201).json({
    message: 'Solicitud recibida. Buscando conductor disponible.',
    trip,
  });
});

app.get('/api/trips/:tripId', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  res.json({ trip });
});

app.post('/api/trips/:tripId/cancel', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status === 'CONDUCTOR_EN_CAMINO') {
    return res.status(409).json({ message: 'El viaje ya fue aceptado por un conductor.' });
  }

  const cancelledTrip: TripRecord = {
    ...trip,
    status: 'CANCELADO',
  };

  trips.set(cancelledTrip.id, cancelledTrip);
  emitTripUpdate(cancelledTrip);
  emitDriverQueueUpdate();
  res.json({ message: 'Solicitud cancelada.', trip: cancelledTrip });
});

app.get('/api/driver/trips/next', (req: Request, res: Response) => {
  const pendingTrip = getNextPendingTrip();

  if (!pendingTrip) {
    return res.json({ trip: null });
  }

  res.json({ trip: pendingTrip });
});

app.post('/api/driver/trips/:tripId/accept', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'PENDING') {
    return res.status(409).json({ message: 'Este viaje ya no esta disponible.', trip });
  }

  const acceptedTrip: TripRecord = {
    ...trip,
    status: 'CONDUCTOR_EN_CAMINO',
    acceptedAt: new Date().toISOString(),
    driver: buildDriverProfile(),
  };

  trips.set(acceptedTrip.id, acceptedTrip);
  emitTripUpdate(acceptedTrip);
  emitDriverQueueUpdate();

  res.json({
    message: 'Viaje aceptado. Cliente notificado.',
    trip: acceptedTrip,
  });
});


// Endpoint para buscar conductores cercanos
app.post('/api/nearby-drivers', (req: Request, res: Response) => {
  const { origin, destination, serviceType, packageNotes } = req.body as NearbyDriversRequestBody;
  const resolvedServiceType: ServiceType = serviceType === 'encomienda' ? 'encomienda' : 'pasajero';

  if (typeof origin?.latitude !== 'number' || typeof origin?.longitude !== 'number') {
    return res.status(400).json({
      message: 'Origen invalido.',
      serviceType: resolvedServiceType,
    });
  }

  // Simulación: lista de conductores ficticios
  const drivers = [
    {
      id: 'driver1',
      name: 'Carlos Pérez',
      lat: origin?.latitude + 0.002,
      lng: origin?.longitude + 0.001,
      distance: 350, // metros
      car: 'Chevrolet Spark',
      plate: 'ABC123',
    },
    {
      id: 'driver2',
      name: 'María Gómez',
      lat: origin?.latitude - 0.0015,
      lng: origin?.longitude - 0.001,
      distance: 600,
      car: 'Renault Logan',
      plate: 'XYZ789',
    },
  ];
  // Simula que a veces no hay conductores
  if (Math.random() < 0.1) {
    return res.json({
      drivers: [],
      serviceType: resolvedServiceType,
      packageNotes: resolvedServiceType === 'encomienda' ? packageNotes ?? '' : undefined,
    });
  }

  res.json({
    drivers,
    serviceType: resolvedServiceType,
    packageNotes: resolvedServiceType === 'encomienda' ? packageNotes ?? '' : undefined,
  });
});

httpServer.on('error', (error: NodeJS.ErrnoException) => {
  if (error.code === 'EADDRINUSE') {
    console.error(`Puerto ${PORT} ocupado. Ya hay otra instancia del backend corriendo.`);
    process.exit(1);
  }

  console.error('No fue posible iniciar el servidor backend.', error);
  process.exit(1);
});

httpServer.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});