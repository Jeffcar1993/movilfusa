const express = require('express');
import type { Request, Response } from 'express';

type ServiceType = 'pasajero' | 'encomienda';

interface NearbyDriversRequestBody {
  origin?: { latitude?: number; longitude?: number };
  destination?: { latitude?: number; longitude?: number };
  serviceType?: ServiceType;
  packageNotes?: string;
}

const app = express();
const PORT = process.env.PORT || 3000;

app.use(express.json());

app.get('/api/health', (req: Request, res: Response) => {
  res.json({ status: 'ok', message: 'Servidor de MovilFusa corriendo' });
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

app.listen(PORT, () => {
  console.log(`🚀 Servidor escuchando en el puerto ${PORT}`);
});