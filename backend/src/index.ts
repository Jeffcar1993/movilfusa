const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
import type { Request, Response } from 'express';
import type { Server as SocketIOServer, Socket } from 'socket.io';

type ServiceType = 'pasajero' | 'encomienda';
type TripStatus = 'PENDING' | 'CONDUCTOR_EN_CAMINO' | 'EN_VIAJE' | 'FINALIZADO' | 'CANCELADO';

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

interface ClientProfile {
  id: string;
  name: string;
}

interface DriverLocation {
  latitude: number;
  longitude: number;
  updatedAt: string;
}

interface TripRating {
  stars: number;
  message?: string;
  createdAt: string;
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
  client?: {
    id?: string;
    name?: string;
  };
}

interface DriverLocationRequestBody {
  latitude?: number;
  longitude?: number;
}

interface TripRatingRequestBody {
  stars?: number;
  message?: string;
}

interface AcceptTripRequestBody {
  driver?: {
    id?: string;
    name?: string;
    vehicle?: string;
    plate?: string;
  };
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
  startedAt?: string;
  finishedAt?: string;
  client?: ClientProfile;
  driver?: DriverProfile;
  currentDriverLocation?: DriverLocation;
  rating?: TripRating;
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

const buildDriverProfile = (payload?: AcceptTripRequestBody['driver']): DriverProfile => ({
  id: typeof payload?.id === 'string' && payload.id.trim().length > 0 ? payload.id.trim() : 'driver-001',
  name:
    typeof payload?.name === 'string' && payload.name.trim().length > 0
      ? payload.name.trim()
      : 'Jhon Alex Motorizado',
  vehicle:
    typeof payload?.vehicle === 'string' && payload.vehicle.trim().length > 0
      ? payload.vehicle.trim()
      : 'AKT NKD 125',
  plate:
    typeof payload?.plate === 'string' && payload.plate.trim().length > 0
      ? payload.plate.trim()
      : 'FUS 219',
});

const getNextPendingTrip = (): TripRecord | null =>
  Array.from(trips.values()).find((trip) => trip.status === 'PENDING') ?? null;

const emitTripUpdate = (trip: TripRecord): void => {
  io.to(getTripRoom(trip.id)).emit('trip:updated', { trip });
};

const emitDriverLocation = (tripId: string, location: DriverLocation): void => {
  io.to(getTripRoom(tripId)).emit('driver:location', { tripId, location });
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
  const { origin, destination, fare, serviceType, packageNotes, client } = req.body as CreateTripRequestBody;
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
    ...(typeof client?.id === 'string' && typeof client?.name === 'string'
      ? {
          client: {
            id: client.id,
            name: client.name,
          },
        }
      : {}),
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

app.get('/api/client/trips/:clientId', (req: Request, res: Response) => {
  const clientId = getTripIdFromParams(req.params.clientId);

  if (!clientId) {
    return res.status(400).json({ message: 'Identificador de cliente inválido.' });
  }

  const clientTrips = Array.from(trips.values())
    .filter((trip) => trip.client?.id === clientId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ trips: clientTrips });
});

app.delete('/api/client/account/:clientId', (req: Request, res: Response) => {
  const clientId = getTripIdFromParams(req.params.clientId);

  if (!clientId) {
    return res.status(400).json({ message: 'Identificador de cliente inválido.' });
  }

  trips.forEach((trip, tripId) => {
    if (trip.client?.id !== clientId) {
      return;
    }

    const updatedTrip: TripRecord = {
      ...trip,
      status: trip.status === 'PENDING' ? 'CANCELADO' : trip.status,
      client: {
        id: `${clientId}-deleted`,
        name: 'Cuenta eliminada',
      },
    };

    trips.set(tripId, updatedTrip);
    emitTripUpdate(updatedTrip);
  });

  emitDriverQueueUpdate();
  res.json({ message: 'Cuenta de cliente eliminada de forma permanente.' });
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

  if (trip.status === 'CONDUCTOR_EN_CAMINO' || trip.status === 'EN_VIAJE' || trip.status === 'FINALIZADO') {
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

app.get('/api/driver/trips/history/:driverId', (req: Request, res: Response) => {
  const driverId = getTripIdFromParams(req.params.driverId);

  if (!driverId) {
    return res.status(400).json({ message: 'Identificador de conductor inválido.' });
  }

  const driverTrips = Array.from(trips.values())
    .filter((trip) => trip.driver?.id === driverId)
    .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());

  res.json({ trips: driverTrips });
});

app.delete('/api/driver/account/:driverId', (req: Request, res: Response) => {
  const driverId = getTripIdFromParams(req.params.driverId);

  if (!driverId) {
    return res.status(400).json({ message: 'Identificador de conductor inválido.' });
  }

  trips.forEach((trip, tripId) => {
    if (trip.driver?.id !== driverId) {
      return;
    }

    const updatedTrip: TripRecord = {
      ...trip,
      status: trip.status === 'CONDUCTOR_EN_CAMINO' ? 'CANCELADO' : trip.status,
      driver: {
        id: `${driverId}-deleted`,
        name: 'Cuenta eliminada',
        vehicle: 'No disponible',
        plate: 'N/A',
      },
    };

    trips.set(tripId, updatedTrip);
    emitTripUpdate(updatedTrip);
  });

  emitDriverQueueUpdate();
  res.json({ message: 'Cuenta de conductor eliminada de forma permanente.' });
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

  const { driver } = req.body as AcceptTripRequestBody;

  const acceptedTrip: TripRecord = {
    ...trip,
    status: 'CONDUCTOR_EN_CAMINO',
    acceptedAt: new Date().toISOString(),
    driver: buildDriverProfile(driver),
  };

  trips.set(acceptedTrip.id, acceptedTrip);
  emitTripUpdate(acceptedTrip);
  emitDriverQueueUpdate();

  res.json({
    message: 'Viaje aceptado. Cliente notificado.',
    trip: acceptedTrip,
  });
});

app.post('/api/driver/trips/:tripId/start', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'CONDUCTOR_EN_CAMINO') {
    return res.status(409).json({ message: 'El viaje no está listo para iniciar.', trip });
  }

  const startedTrip: TripRecord = {
    ...trip,
    status: 'EN_VIAJE',
    startedAt: new Date().toISOString(),
  };

  trips.set(startedTrip.id, startedTrip);
  emitTripUpdate(startedTrip);

  res.json({
    message: 'Viaje iniciado. Seguimiento en tiempo real activo.',
    trip: startedTrip,
  });
});

app.post('/api/driver/trips/:tripId/location', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'EN_VIAJE') {
    return res.status(409).json({ message: 'El viaje no está en curso.', trip });
  }

  const { latitude, longitude } = req.body as DriverLocationRequestBody;

  if (!isValidCoordinate(latitude) || !isValidCoordinate(longitude)) {
    return res.status(400).json({ message: 'Ubicación inválida.' });
  }

  const location: DriverLocation = {
    latitude,
    longitude,
    updatedAt: new Date().toISOString(),
  };

  const updatedTrip: TripRecord = {
    ...trip,
    currentDriverLocation: location,
  };

  trips.set(updatedTrip.id, updatedTrip);
  emitDriverLocation(updatedTrip.id, location);

  res.json({ trip: updatedTrip });
});

app.post('/api/driver/trips/:tripId/finish', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'EN_VIAJE') {
    return res.status(409).json({ message: 'El viaje no está en curso.', trip });
  }

  const finishedTrip: TripRecord = {
    ...trip,
    status: 'FINALIZADO',
    finishedAt: new Date().toISOString(),
  };

  trips.set(finishedTrip.id, finishedTrip);
  emitTripUpdate(finishedTrip);
  emitDriverQueueUpdate();

  res.json({
    message: 'Viaje finalizado. Cliente notificado.',
    trip: finishedTrip,
  });
});

app.post('/api/trips/:tripId/rating', (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = trips.get(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'FINALIZADO') {
    return res.status(409).json({ message: 'Solo se puede calificar un viaje finalizado.', trip });
  }

  if (trip.rating) {
    return res.status(409).json({ message: 'Este viaje ya fue calificado.', trip });
  }

  const { stars, message } = req.body as TripRatingRequestBody;

  if (typeof stars !== 'number' || !Number.isInteger(stars) || stars < 1 || stars > 5) {
    return res.status(400).json({ message: 'La calificación debe ser un número entero entre 1 y 5.' });
  }

  const ratedTrip: TripRecord = {
    ...trip,
    rating: {
      stars,
      ...(typeof message === 'string' && message.trim().length > 0 ? { message: message.trim() } : {}),
      createdAt: new Date().toISOString(),
    },
  };

  trips.set(ratedTrip.id, ratedTrip);
  emitTripUpdate(ratedTrip);

  res.json({
    message: 'Gracias por calificar el viaje.',
    trip: ratedTrip,
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