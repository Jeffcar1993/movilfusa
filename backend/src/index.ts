require('dotenv/config');
const express = require('express');
const { createServer } = require('node:http');
const { Server } = require('socket.io');
const { createHash } = require('node:crypto');
const { supabaseAdmin } = require('./lib/supabase');
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

interface RegisterClientAuthRequestBody {
  email?: string;
  password?: string;
  name?: string;
}

const REGISTER_PASSWORD_REQUIREMENTS_MESSAGE =
  'La contraseña debe tener mínimo 8 caracteres e incluir mayúscula, minúscula, número y carácter especial.';
const REGISTER_PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;

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

interface ProfileRow {
  id: string;
  role: 'client' | 'driver' | 'admin';
  name: string;
}

interface DriverProfileRow {
  user_id: string;
  vehicle: string;
  plate: string;
}

interface TripRow {
  id: string;
  client_id: string;
  driver_id: string | null;
  origin_name: string;
  origin_lat: number;
  origin_lng: number;
  destination_name: string;
  destination_lat: number;
  destination_lng: number;
  fare: number;
  service_type: ServiceType;
  package_notes: string | null;
  status: TripStatus;
  accepted_at: string | null;
  started_at: string | null;
  finished_at: string | null;
  cancelled_at: string | null;
  created_at: string;
  updated_at: string;
}

interface TripLocationRow {
  trip_id: string;
  lat: number;
  lng: number;
  created_at: string;
}

interface TripRatingRow {
  trip_id: string;
  stars: number;
  message: string | null;
  created_at: string;
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

const uuidPattern =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

const normalizeExternalIdToUuid = (externalId: string): string => {
  const trimmed = externalId.trim();

  if (uuidPattern.test(trimmed)) {
    return trimmed.toLowerCase();
  }

  const hash = createHash('sha1').update(`movilfusa:${trimmed}`).digest('hex');
  const hex = hash.slice(0, 32);
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20, 32)}`;
};

const tripRows = new Map<string, TripRecord>();

const cacheTrip = (trip: TripRecord): TripRecord => {
  tripRows.set(trip.id, trip);
  return trip;
};

const mapTripRowToRecord = (
  tripRow: TripRow,
  clientProfile?: ProfileRow | null,
  driverProfile?: ProfileRow | null,
  driverDetails?: DriverProfileRow | null,
  latestLocation?: TripLocationRow | null,
  ratingRow?: TripRatingRow | null,
): TripRecord => {
  const trip: TripRecord = {
    id: tripRow.id,
    origin: {
      latitude: tripRow.origin_lat,
      longitude: tripRow.origin_lng,
      name: tripRow.origin_name,
    },
    destination: {
      latitude: tripRow.destination_lat,
      longitude: tripRow.destination_lng,
      name: tripRow.destination_name,
    },
    fare: Number(tripRow.fare),
    serviceType: tripRow.service_type,
    status: tripRow.status,
    createdAt: tripRow.created_at,
    ...(tripRow.package_notes ? { packageNotes: tripRow.package_notes } : {}),
    ...(tripRow.accepted_at ? { acceptedAt: tripRow.accepted_at } : {}),
    ...(tripRow.started_at ? { startedAt: tripRow.started_at } : {}),
    ...(tripRow.finished_at ? { finishedAt: tripRow.finished_at } : {}),
    ...(clientProfile
      ? { client: { id: clientProfile.id, name: clientProfile.name } }
      : { client: { id: tripRow.client_id, name: 'Cliente' } }),
    ...(driverProfile && driverDetails
      ? {
          driver: {
            id: driverProfile.id,
            name: driverProfile.name,
            vehicle: driverDetails.vehicle,
            plate: driverDetails.plate,
          },
        }
      : tripRow.driver_id
        ? {
            driver: {
              id: tripRow.driver_id,
              name: driverProfile?.name ?? 'Conductor',
              vehicle: driverDetails?.vehicle ?? 'No disponible',
              plate: driverDetails?.plate ?? 'N/A',
            },
          }
        : {}),
    ...(latestLocation
      ? {
          currentDriverLocation: {
            latitude: latestLocation.lat,
            longitude: latestLocation.lng,
            updatedAt: latestLocation.created_at,
          },
        }
      : {}),
    ...(ratingRow
      ? {
          rating: {
            stars: ratingRow.stars,
            ...(typeof ratingRow.message === 'string' && ratingRow.message.trim().length > 0
              ? { message: ratingRow.message.trim() }
              : {}),
            createdAt: ratingRow.created_at,
          },
        }
      : {}),
  };

  return cacheTrip(trip);
};

const loadProfileById = async (id: string): Promise<ProfileRow | null> => {
  const { data, error } = await supabaseAdmin.from('profiles').select('id, role, name').eq('id', id).maybeSingle();

  if (error) {
    throw error;
  }

  return (data as ProfileRow | null) ?? null;
};

const loadDriverDetailsById = async (id: string): Promise<DriverProfileRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('driver_profiles')
    .select('user_id, vehicle, plate')
    .eq('user_id', id)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as DriverProfileRow | null) ?? null;
};

const loadLatestTripLocation = async (tripId: string): Promise<TripLocationRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('trip_locations')
    .select('trip_id, lat, lng, created_at')
    .eq('trip_id', tripId)
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as TripLocationRow | null) ?? null;
};

const loadTripRating = async (tripId: string): Promise<TripRatingRow | null> => {
  const { data, error } = await supabaseAdmin
    .from('trip_ratings')
    .select('trip_id, stars, message, created_at')
    .eq('trip_id', tripId)
    .maybeSingle();

  if (error) {
    throw error;
  }

  return (data as TripRatingRow | null) ?? null;
};

const loadTripRecordById = async (tripId: string): Promise<TripRecord | null> => {
  const cachedTrip = tripRows.get(tripId);

  const { data, error } = await supabaseAdmin.from('trips').select('*').eq('id', tripId).maybeSingle();

  if (error) {
    throw error;
  }

  const tripRow = data as TripRow | null;
  if (!tripRow) {
    return cachedTrip ?? null;
  }

  const [clientProfile, driverProfile, driverDetails, latestLocation, ratingRow] = await Promise.all([
    loadProfileById(tripRow.client_id),
    tripRow.driver_id ? loadProfileById(tripRow.driver_id) : Promise.resolve(null),
    tripRow.driver_id ? loadDriverDetailsById(tripRow.driver_id) : Promise.resolve(null),
    loadLatestTripLocation(tripId),
    loadTripRating(tripId),
  ]);

  return mapTripRowToRecord(tripRow, clientProfile, driverProfile, driverDetails, latestLocation, ratingRow);
};

const loadNextPendingTrip = async (): Promise<TripRecord | null> => {
  const { data, error } = await supabaseAdmin
    .from('trips')
    .select('*')
    .eq('status', 'PENDING')
    .order('created_at', { ascending: true })
    .limit(1)
    .maybeSingle();

  if (error) {
    throw error;
  }

  const tripRow = data as TripRow | null;
  if (!tripRow) {
    return null;
  }

  return loadTripRecordById(tripRow.id);
};

const listTripsByClientId = async (clientId: string): Promise<TripRecord[]> => {
  const { data, error } = await supabaseAdmin
    .from('trips')
    .select('id')
    .eq('client_id', clientId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const tripIds = ((data ?? []) as Array<{ id: string }>).map((row: { id: string }) => row.id);
  const trips = await Promise.all(tripIds.map((tripId: string) => loadTripRecordById(tripId)));

  return trips.filter((trip): trip is TripRecord => trip !== null);
};

const listTripsByDriverId = async (driverId: string): Promise<TripRecord[]> => {
  const { data, error } = await supabaseAdmin
    .from('trips')
    .select('id')
    .eq('driver_id', driverId)
    .order('created_at', { ascending: false });

  if (error) {
    throw error;
  }

  const tripIds = ((data ?? []) as Array<{ id: string }>).map((row: { id: string }) => row.id);
  const trips = await Promise.all(tripIds.map((tripId: string) => loadTripRecordById(tripId)));

  return trips.filter((trip): trip is TripRecord => trip !== null);
};

const ensureProfile = async (id: string, role: 'client' | 'driver', name: string): Promise<void> => {
  const { error } = await supabaseAdmin.from('profiles').upsert(
    {
      id,
      role,
      name,
    },
    { onConflict: 'id' },
  );

  if (error) {
    throw error;
  }
};

const ensureDriverProfile = async (driver: DriverProfile): Promise<void> => {
  await ensureProfile(driver.id, 'driver', driver.name);

  const { error } = await supabaseAdmin.from('driver_profiles').upsert(
    {
      user_id: driver.id,
      vehicle: driver.vehicle,
      plate: driver.plate,
      is_available: true,
      last_seen_at: new Date().toISOString(),
    },
    { onConflict: 'user_id' },
  );

  if (error) {
    throw error;
  }
};

const updateTripStatus = async (
  tripId: string,
  patch: Partial<Pick<TripRow, 'driver_id' | 'status' | 'accepted_at' | 'started_at' | 'finished_at' | 'cancelled_at'>>,
): Promise<TripRecord | null> => {
  const { error: updateError } = await supabaseAdmin.from('trips').update(patch).eq('id', tripId);

  if (updateError) {
    throw updateError;
  }

  return loadTripRecordById(tripId);
};

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

const getNextPendingTrip = async (): Promise<TripRecord | null> => loadNextPendingTrip();

const logBackendError = (context: string, error: unknown): void => {
  console.error(context, error);
};

const extractErrorMessage = (error: unknown): string => {
  if (typeof error === 'string') {
    return error;
  }

  if (error && typeof error === 'object' && 'message' in error && typeof error.message === 'string') {
    return error.message;
  }

  return 'Error desconocido';
};

const emitTripUpdate = (trip: TripRecord): void => {
  io.to(getTripRoom(trip.id)).emit('trip:updated', { trip });
};

const emitDriverLocation = (tripId: string, location: DriverLocation): void => {
  io.to(getTripRoom(tripId)).emit('driver:location', { tripId, location });
};

const emitDriverQueueUpdate = (): void => {
  void loadNextPendingTrip()
    .then((trip) => {
      io.to('drivers').emit('driver:trip', { trip });
    })
    .catch((error) => {
      logBackendError('No fue posible actualizar la cola de conductores.', error);
    });
};

io.on('connection', (socket: Socket) => {
  socket.on('driver:subscribe', () => {
    socket.join('drivers');
    void loadNextPendingTrip()
      .then((trip) => {
        socket.emit('driver:trip', { trip });
      })
      .catch((error) => {
        logBackendError('No fue posible enviar el siguiente viaje al conductor.', error);
      });
  });

  socket.on('trip:watch', (tripId: unknown) => {
    if (typeof tripId !== 'string') {
      return;
    }

    socket.join(getTripRoom(tripId));
    void loadTripRecordById(tripId)
      .then((trip) => {
        socket.emit('trip:updated', { trip });
      })
      .catch((error) => {
        logBackendError(`No fue posible cargar el viaje ${tripId}.`, error);
      });
  });
});

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Servidor de MovilFusa corriendo' });
});

app.post('/api/client/auth/register', async (req: Request, res: Response) => {
  const body = (req.body ?? {}) as RegisterClientAuthRequestBody;
  const email = typeof body.email === 'string' ? body.email.trim().toLowerCase() : '';
  const password = typeof body.password === 'string' ? body.password : '';
  const name =
    typeof body.name === 'string' && body.name.trim().length > 0
      ? body.name.trim()
      : (email.split('@')[0] ?? 'Cliente');

  if (!email || !email.includes('@')) {
    return res.status(400).json({ message: 'Correo inválido.' });
  }

  if (!REGISTER_PASSWORD_POLICY_REGEX.test(password)) {
    return res.status(400).json({ message: REGISTER_PASSWORD_REQUIREMENTS_MESSAGE });
  }

  try {
    const { data, error } = await supabaseAdmin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: {
        name,
      },
    });

    if (error || !data.user) {
      throw error ?? new Error('No se pudo crear el usuario.');
    }

    await ensureProfile(data.user.id, 'client', name);

    return res.status(201).json({
      user: {
        id: data.user.id,
        email: data.user.email,
      },
    });
  } catch (error) {
    const message = extractErrorMessage(error);
    const statusCode = /already|exists|registered|duplicate/i.test(message) ? 409 : 500;
    return res.status(statusCode).json({ message });
  }
});

app.post('/api/trips', async (req: Request, res: Response) => {
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

  const clientExternalId = typeof client?.id === 'string' && client.id.trim().length > 0 ? client.id.trim() : '';

  if (!clientExternalId) {
    return res.status(401).json({ message: 'Debes iniciar sesión para solicitar un viaje.' });
  }

  const clientId = normalizeExternalIdToUuid(clientExternalId);
  const clientName = typeof client?.name === 'string' && client.name.trim().length > 0 ? client.name.trim() : 'Cliente';

  try {
    await ensureProfile(clientId, 'client', clientName);

    const { data: insertedTrip, error: insertError } = await supabaseAdmin
      .from('trips')
      .insert({
        client_id: clientId,
        origin_name: origin.name,
        origin_lat: origin.latitude,
        origin_lng: origin.longitude,
        destination_name: destination.name,
        destination_lat: destination.latitude,
        destination_lng: destination.longitude,
        fare,
        service_type: resolvedServiceType,
        package_notes: resolvedServiceType === 'encomienda' ? packageNotes ?? '' : null,
        status: 'PENDING',
      })
      .select('id')
      .single();

    if (insertError) {
      throw insertError;
    }

    const trip = await loadTripRecordById((insertedTrip as { id: string }).id);

    if (!trip) {
      return res.status(500).json({ message: 'No fue posible cargar el viaje creado.' });
    }

    void emitTripUpdate(trip);
    void emitDriverQueueUpdate();

    return res.status(201).json({
      message: 'Solicitud recibida. Buscando conductor disponible.',
      trip,
    });
  } catch (error) {
    logBackendError('No fue posible guardar la solicitud en Supabase.', error);
    return res.status(500).json({
      message: 'No fue posible guardar la solicitud en Supabase.',
      details: extractErrorMessage(error),
    });
  }
});

app.get('/api/trips/:tripId', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  res.json({ trip });
});

app.get('/api/client/trips/:clientId', async (req: Request, res: Response) => {
  const externalClientId = getTripIdFromParams(req.params.clientId);

  if (!externalClientId) {
    return res.status(400).json({ message: 'Identificador de cliente inválido.' });
  }

  const clientId = normalizeExternalIdToUuid(externalClientId);

  try {
    const clientTrips = await listTripsByClientId(clientId);
    return res.json({ trips: clientTrips });
  } catch {
    return res.status(500).json({ message: 'No fue posible cargar el historial del cliente.' });
  }
});

app.delete('/api/client/account/:clientId', async (req: Request, res: Response) => {
  const externalClientId = getTripIdFromParams(req.params.clientId);

  if (!externalClientId) {
    return res.status(400).json({ message: 'Identificador de cliente inválido.' });
  }

  const clientId = normalizeExternalIdToUuid(externalClientId);

  try {
    const { data: clientTrips, error: listTripsError } = await supabaseAdmin
      .from('trips')
      .select('id')
      .eq('client_id', clientId);

    if (listTripsError) {
      throw listTripsError;
    }

    const tripIds = ((clientTrips ?? []) as Array<{ id: string }>).map((trip) => trip.id);

    if (tripIds.length > 0) {
      const { error: deleteTripsError } = await supabaseAdmin.from('trips').delete().eq('client_id', clientId);

      if (deleteTripsError) {
        throw deleteTripsError;
      }

      for (const tripId of tripIds) {
        tripRows.delete(tripId);
      }
    }

    const { error: deleteAuthUserError } = await supabaseAdmin.auth.admin.deleteUser(clientId);

    if (deleteAuthUserError && !/user.*not.*found/i.test(extractErrorMessage(deleteAuthUserError))) {
      throw deleteAuthUserError;
    }

    void emitDriverQueueUpdate();
    return res.json({ message: 'Cuenta eliminada completamente de la base de datos y autenticación.' });
  } catch (error) {
    return res.status(500).json({ message: 'No fue posible eliminar la cuenta del cliente.', details: extractErrorMessage(error) });
  }
});

app.post('/api/trips/:tripId/cancel', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status === 'CONDUCTOR_EN_CAMINO' || trip.status === 'EN_VIAJE' || trip.status === 'FINALIZADO') {
    return res.status(409).json({ message: 'El viaje ya fue aceptado por un conductor.' });
  }

  const cancelledTrip = await updateTripStatus(tripId, {
    status: 'CANCELADO',
    cancelled_at: new Date().toISOString(),
  });

  if (!cancelledTrip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  void emitTripUpdate(cancelledTrip);
  void emitDriverQueueUpdate();
  return res.json({ message: 'Solicitud cancelada.', trip: cancelledTrip });
});

app.get('/api/driver/trips/next', async (req: Request, res: Response) => {
  try {
    const pendingTrip = await loadNextPendingTrip();
    return res.json({ trip: pendingTrip });
  } catch {
    return res.status(500).json({ message: 'No fue posible obtener el siguiente viaje pendiente.' });
  }
});

app.get('/api/driver/trips/history/:driverId', async (req: Request, res: Response) => {
  const externalDriverId = getTripIdFromParams(req.params.driverId);

  if (!externalDriverId) {
    return res.status(400).json({ message: 'Identificador de conductor inválido.' });
  }

  const driverId = normalizeExternalIdToUuid(externalDriverId);

  try {
    const driverTrips = await listTripsByDriverId(driverId);
    return res.json({ trips: driverTrips });
  } catch {
    return res.status(500).json({ message: 'No fue posible cargar el historial del conductor.' });
  }
});

app.delete('/api/driver/account/:driverId', async (req: Request, res: Response) => {
  const externalDriverId = getTripIdFromParams(req.params.driverId);

  if (!externalDriverId) {
    return res.status(400).json({ message: 'Identificador de conductor inválido.' });
  }

  const driverId = normalizeExternalIdToUuid(externalDriverId);

  try {
    await supabaseAdmin
      .from('profiles')
      .update({ name: 'Cuenta eliminada', deleted_at: new Date().toISOString() })
      .eq('id', driverId);

    await supabaseAdmin
      .from('driver_profiles')
      .update({ is_available: false })
      .eq('user_id', driverId);

    const { data: driverTrips } = await supabaseAdmin.from('trips').select('id, status').eq('driver_id', driverId);
    const affectedTripIds = (driverTrips ?? [] as Array<{ id: string; status: TripStatus }>)
      .filter((trip: { id: string; status: TripStatus }) => trip.status === 'CONDUCTOR_EN_CAMINO')
      .map((trip: { id: string; status: TripStatus }) => trip.id);

    for (const tripId of affectedTripIds) {
      const updatedTrip = await updateTripStatus(tripId, {
        status: 'CANCELADO',
        cancelled_at: new Date().toISOString(),
      });

      if (updatedTrip) {
        void emitTripUpdate(updatedTrip);
      }
    }

    void emitDriverQueueUpdate();
    return res.json({ message: 'Cuenta de conductor eliminada de forma permanente.' });
  } catch {
    return res.status(500).json({ message: 'No fue posible eliminar la cuenta del conductor.' });
  }
});

app.post('/api/driver/trips/:tripId/accept', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'PENDING') {
    return res.status(409).json({ message: 'Este viaje ya no esta disponible.', trip });
  }

  const { driver } = req.body as AcceptTripRequestBody;
  const resolvedDriver = buildDriverProfile(driver);
  const normalizedDriver = {
    ...resolvedDriver,
    id: normalizeExternalIdToUuid(resolvedDriver.id),
  };

  try {
    await ensureDriverProfile(normalizedDriver);

    const acceptedTrip = await updateTripStatus(tripId, {
      status: 'CONDUCTOR_EN_CAMINO',
      accepted_at: new Date().toISOString(),
      driver_id: normalizedDriver.id,
    });

    if (!acceptedTrip) {
      return res.status(404).json({ message: 'Viaje no encontrado.' });
    }

    void emitTripUpdate(acceptedTrip);
    void emitDriverQueueUpdate();

    return res.json({
      message: 'Viaje aceptado. Cliente notificado.',
      trip: acceptedTrip,
    });
  } catch {
    return res.status(500).json({ message: 'No fue posible aceptar el viaje.' });
  }
});

app.post('/api/driver/trips/:tripId/start', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'CONDUCTOR_EN_CAMINO') {
    return res.status(409).json({ message: 'El viaje no está listo para iniciar.', trip });
  }

  const startedTrip = await updateTripStatus(tripId, {
    status: 'EN_VIAJE',
    started_at: new Date().toISOString(),
  });

  if (!startedTrip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  void emitTripUpdate(startedTrip);

  return res.json({
    message: 'Viaje iniciado. Seguimiento en tiempo real activo.',
    trip: startedTrip,
  });
});

app.post('/api/driver/trips/:tripId/location', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

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

  try {
    if (trip.driver?.id) {
      await supabaseAdmin
        .from('driver_profiles')
        .update({
          last_lat: latitude,
          last_lng: longitude,
          last_seen_at: location.updatedAt,
        })
        .eq('user_id', trip.driver.id);
    }

    const { error } = await supabaseAdmin.from('trip_locations').insert({
      trip_id: tripId,
      driver_id: trip.driver?.id ?? tripId,
      lat: latitude,
      lng: longitude,
    });

    if (error) {
      throw error;
    }

    const updatedTrip = await loadTripRecordById(tripId);
    if (!updatedTrip) {
      return res.status(404).json({ message: 'Viaje no encontrado.' });
    }

    emitDriverLocation(updatedTrip.id, location);
    return res.json({ trip: updatedTrip });
  } catch {
    return res.status(500).json({ message: 'No fue posible guardar la ubicación del conductor.' });
  }
});

app.post('/api/driver/trips/:tripId/finish', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

  if (!trip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  if (trip.status !== 'EN_VIAJE') {
    return res.status(409).json({ message: 'El viaje no está en curso.', trip });
  }

  const finishedTrip = await updateTripStatus(tripId, {
    status: 'FINALIZADO',
    finished_at: new Date().toISOString(),
  });

  if (!finishedTrip) {
    return res.status(404).json({ message: 'Viaje no encontrado.' });
  }

  void emitTripUpdate(finishedTrip);
  void emitDriverQueueUpdate();

  return res.json({
    message: 'Viaje finalizado. Cliente notificado.',
    trip: finishedTrip,
  });
});

app.post('/api/trips/:tripId/rating', async (req: Request, res: Response) => {
  const tripId = getTripIdFromParams(req.params.tripId);

  if (!tripId) {
    return res.status(400).json({ message: 'Identificador de viaje invalido.' });
  }

  const trip = await loadTripRecordById(tripId);

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

  try {
    const { error } = await supabaseAdmin.from('trip_ratings').insert({
      trip_id: tripId,
      client_id: trip.client?.id ?? tripId,
      stars,
      message: typeof message === 'string' && message.trim().length > 0 ? message.trim() : null,
    });

    if (error) {
      throw error;
    }

    const ratedTrip = await loadTripRecordById(tripId);
    if (!ratedTrip) {
      return res.status(404).json({ message: 'Viaje no encontrado.' });
    }

    void emitTripUpdate(ratedTrip);

    return res.json({
      message: 'Gracias por calificar el viaje.',
      trip: ratedTrip,
    });
  } catch {
    return res.status(500).json({ message: 'No fue posible guardar la calificación.' });
  }
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