import React, { useEffect, useRef, useState } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Dimensions, Platform } from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import AddressSearch from './src/components/AddressSearch';

interface RouteInfo {
  distanceKm: number;
  durationMin: number;
}

interface NearbyDriver {
  id: string;
  name: string;
  lat: number;
  lng: number;
  distance: number;
  car: string;
  plate: string;
}

type ServiceType = 'pasajero' | 'encomienda';

type TripPoint = {
  latitude: number;
  longitude: number;
  name: string;
  fare?: number;
  serviceType?: ServiceType;
  packageNotes?: string;
};

const fallbackApiBaseUrl = Platform.select({
  android: 'http://10.0.2.2:3000',
  default: 'http://localhost:3000',
}) as string;

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? fallbackApiBaseUrl).replace(/\/$/, '');
const formatCop = (fare: number) => `$${fare.toLocaleString('es-CO')} COP`;

export default function App() {
  const [currentScreen, setCurrentScreen] = useState<'welcome' | 'home'>('welcome');
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  
  // Estados de control de rutas y UI
  const [searchMode, setSearchMode] = useState<'origin' | 'destination' | null>(null);
  const [origin, setOrigin] = useState<TripPoint | null>(null);
  const [destination, setDestination] = useState<TripPoint | null>(null);
  const [loadingGps, setLoadingGps] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [requestingDriver, setRequestingDriver] = useState(false);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [nearbyDrivers, setNearbyDrivers] = useState<NearbyDriver[]>([]);
  const mapRef = useRef<MapView | null>(null);

  const fallbackRouteCoordinates: LatLng[] = origin && destination
    ? [
        { latitude: origin.latitude, longitude: origin.longitude },
        { latitude: destination.latitude, longitude: destination.longitude },
      ]
    : [];

  const visibleRouteCoordinates = routeCoordinates.length > 1 ? routeCoordinates : fallbackRouteCoordinates;

  // Respaldo dinámico si marcan puntos aleatorios en el mapa en vez de la lista
  const estimateFareByDistance = (distanceKm: number): number => {
    if (distanceKm <= 4) return 5000;
    if (distanceKm <= 8) return 7000;
    if (distanceKm <= 12) return 10000;
    if (distanceKm <= 18) return 15000;
    if (distanceKm <= 30) return 20000;
    if (distanceKm <= 45) return 30000;
    return Math.round(distanceKm * 700);
  };

  // MOTOR DE TARIFAS SIMÉTRICAS INTEGRADO
  const computedFare = (() => {
    if (!origin || !destination) return null;

    const originFare = typeof origin.fare === 'number' ? origin.fare : 0;
    const destinationFare = typeof destination.fare === 'number' ? destination.fare : 0;

    // Caso 1: Ambos puntos tienen asignada una tarifa fija (Se toma la mayor de forma recíproca)
    if (originFare > 0 && destinationFare > 0) {
      return Math.max(originFare, destinationFare);
    }

    // Caso 2: Solo un extremo tiene tarifa fija (Ej: Ubicación GPS <-> Destino de la lista)
    if (originFare > 0) return originFare;
    if (destinationFare > 0) return destinationFare;

    // Caso 3: Puntos libres sobre el mapa
    if (routeInfo) {
      return estimateFareByDistance(routeInfo.distanceKm);
    }

    return 5000;
  })();

  useEffect(() => {
    if (!mapRef.current || visibleRouteCoordinates.length < 2) {
      return;
    }
    mapRef.current.fitToCoordinates(visibleRouteCoordinates, {
      edgePadding: { top: 120, right: 60, bottom: 260, left: 60 },
      animated: true,
    });
  }, [visibleRouteCoordinates]);

  useEffect(() => {
    const fetchRoute = async () => {
      if (!origin || !destination) {
        setRouteCoordinates([]);
        setRouteInfo(null);
        return;
      }

      setLoadingRoute(true);
      try {
        const originStr = `${origin.longitude},${origin.latitude}`;
        const target = `${destination.longitude},${destination.latitude}`;
        const url = `https://router.project-osrm.org/route/v1/driving/${originStr};${target}?overview=full&geometries=geojson`;

        const response = await fetch(url);
        if (!response.ok) throw new Error('No fue posible consultar la ruta.');

        const data = await response.json();
        const route = data?.routes?.[0];
        const geometryCoordinates = route?.geometry?.coordinates;

        if (!route || !Array.isArray(geometryCoordinates) || geometryCoordinates.length < 2) {
          throw new Error('La API de rutas no devolvió un trazado válido.');
        }

        const parsedCoordinates: LatLng[] = geometryCoordinates.map((coord: [number, number]) => ({
          latitude: coord[1],
          longitude: coord[0],
        }));

        setRouteCoordinates(parsedCoordinates);
        setRouteInfo({
          distanceKm: route.distance / 1000,
          durationMin: route.duration / 60,
        });
      } catch {
        setRouteCoordinates([]);
        setRouteInfo(null);
      } finally {
        setLoadingRoute(false);
      }
    };

    fetchRoute();
  }, [origin, destination]);

  useEffect(() => {
    setNearbyDrivers([]);
    setDriverError(null);
  }, [origin, destination]);

  const handleRequestTrip = async () => {
    if (!origin || !destination || requestingDriver) {
      return;
    }

    setRequestingDriver(true);
    setDriverError(null);
    setNearbyDrivers([]);

    try {
      const response = await fetch(`${API_BASE_URL}/api/nearby-drivers`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          origin: {
            latitude: origin.latitude,
            longitude: origin.longitude,
          },
          destination: {
            latitude: destination.latitude,
            longitude: destination.longitude,
          },
        }),
      });

      if (!response.ok) {
        throw new Error('No fue posible contactar el servidor de conductores.');
      }

      const data = await response.json();
      const drivers = Array.isArray(data?.drivers) ? (data.drivers as NearbyDriver[]) : [];

      if (drivers.length === 0) {
        setDriverError('No hay conductores disponibles en este momento.');
        return;
      }

      setNearbyDrivers(drivers);
    } catch {
      setDriverError('No se pudo solicitar el servicio. Verifica red y servidor.');
    } finally {
      setRequestingDriver(false);
    }
  };

  const handleGetStarted = async () => {
    setLoadingGps(true);
    try {
      const { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permiso de ubicación denegado.');
        setCurrentScreen('home');
        return;
      }
      const currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);
      setCurrentScreen('home');
    } catch {
      setErrorMsg('Error al obtener la ubicación.');
      setCurrentScreen('home');
    } finally {
      setLoadingGps(false);
    }
  };

  if (currentScreen === 'welcome') {
    return (
      <View style={styles.welcomeContainer}>
        <View style={styles.brandContainer}>
          <Text style={styles.title}>MovilFusa</Text>
          <Text style={styles.subtitle}>Tu transporte y mensajería de confianza</Text>
        </View>
        <View style={styles.bottomContainer}>
          <TouchableOpacity style={styles.button} onPress={handleGetStarted} disabled={loadingGps}>
            {loadingGps ? <ActivityIndicator color="#FFFFFF" /> : <Text style={styles.buttonText}>Ingresar con el celular</Text>}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  if (searchMode === 'origin') {
    return (
      <AddressSearch
        showServiceSelector={false}
        onClose={() => setSearchMode(null)}
        onSelectDestination={(place) => {
          setOrigin({ latitude: place.latitude, longitude: place.longitude, name: place.name, fare: place.fare });
          setSearchMode(null);
        }}
      >
        <TouchableOpacity
          style={styles.embeddedGpsButton}
          onPress={() => {
            if (location) {
              setOrigin({ latitude: location.coords.latitude, longitude: location.coords.longitude, name: 'Mi ubicación actual' });
              setSearchMode(null);
            }
          }}
        >
          <Text style={styles.embeddedGpsText}>📍 Usar mi ubicación actual</Text>
        </TouchableOpacity>
      </AddressSearch>
    );
  }

  if (searchMode === 'destination') {
    return (
      <AddressSearch
        showServiceSelector={true}
        onClose={() => setSearchMode(null)}
        onSelectDestination={(place) => {
          setDestination({
            latitude: place.latitude,
            longitude: place.longitude,
            name: place.name,
            fare: place.fare,
            serviceType: place.serviceType,
            packageNotes: place.packageNotes,
          });
          setSearchMode(null);
        }}
      />
    );
  }

  return (
    <View style={styles.homeContainer}>
      {/* Campos superiores de ruteo */}
      <View style={styles.topFieldsContainer}>
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.inputField} onPress={() => setSearchMode('origin')}>
            <Text style={[styles.inputLabel, { color: origin ? '#1E3A8A' : '#94A3B8' }]}>¿Dónde estás?</Text>
            <Text style={styles.inputValue} numberOfLines={1}>{origin ? origin.name : 'Toca para buscar o usa el mapa'}</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={styles.useLocationButton}
            onPress={() => {
              if (location) {
                setOrigin({ latitude: location.coords.latitude, longitude: location.coords.longitude, name: 'Mi ubicación actual' });
              }
            }}
          >
            <Text style={styles.useLocationText}>📍</Text>
          </TouchableOpacity>
        </View>
        
        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.inputField} onPress={() => setSearchMode('destination')} disabled={!origin}>
            <Text style={[styles.inputLabel, { color: destination ? '#1E3A8A' : '#94A3B8' }]}>¿A dónde vas?</Text>
            <Text style={styles.inputValue} numberOfLines={1}>{destination ? destination.name : 'Toca para buscar o usa el mapa'}</Text>
          </TouchableOpacity>
        </View>
        
        {origin && destination && (
          <Text style={styles.routeMetaText}>
            {loadingRoute ? 'Calculando ruta...' : routeInfo ? `⏱️ ${Math.round(routeInfo.durationMin)} min · 🛣️ ${routeInfo.distanceKm.toFixed(1)} km` : 'Línea recta'}
          </Text>
        )}
      </View>

      {(origin || location) ? (
        <MapView
          ref={mapRef}
          provider={PROVIDER_GOOGLE}
          style={styles.map}
          initialRegion={{
            latitude: origin?.latitude ?? location!.coords.latitude,
            longitude: origin?.longitude ?? location!.coords.longitude,
            latitudeDelta: 0.015,
            longitudeDelta: 0.015,
          }}
          showsUserLocation={true}
          onPress={e => {
            const { latitude, longitude } = e.nativeEvent.coordinate;
            if (!origin) {
              setOrigin({ latitude, longitude, name: 'Origen seleccionado en mapa' });
            } else {
              setDestination({ latitude, longitude, name: 'Destino seleccionado en mapa', serviceType: 'pasajero' });
            }
          }}
        >
          {origin && <Marker coordinate={{ latitude: origin.latitude, longitude: origin.longitude }} title={origin.name} pinColor="blue" />}
          {destination && <Marker coordinate={{ latitude: destination.latitude, longitude: destination.longitude }} title="Destino" description={destination.name} pinColor="green" />}
          {visibleRouteCoordinates.length > 1 && <Polyline coordinates={visibleRouteCoordinates} strokeColor="#10B981" strokeWidth={5} />}
        </MapView>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1E3A8A" />
          <Text style={styles.loadingText}>Sincronizando ubicación...</Text>
        </View>
      )}

      {/* TARJETA INFERIOR: UI/UX DE CONFIRMACIÓN FINAL */}
      {origin && destination && (
        <View style={styles.confirmTripContainer}>
          <View style={styles.serviceTypeBadge}>
            <Text style={styles.serviceTypeBadgeText}>
              {destination.serviceType === 'encomienda' ? 'Servicio: Encomienda' : 'Servicio: Viaje en moto'}
            </Text>
          </View>

          {destination.serviceType === 'encomienda' && destination.packageNotes ? (
            <Text style={styles.packageNotesText}>Detalle de envío: {destination.packageNotes}</Text>
          ) : null}

          <View style={styles.fareRow}>
            <View>
              <Text style={styles.fareLabel}>Costo del servicio:</Text>
              <Text style={styles.paymentMethod}>Pago al conductor</Text>
            </View>
            <Text style={styles.fareAmount}>{formatCop(computedFare ?? 5000)}</Text>
          </View>

          <TouchableOpacity 
            style={[styles.requestButton, (loadingRoute || requestingDriver) && styles.disabledButton]} 
            disabled={loadingRoute || requestingDriver}
            onPress={handleRequestTrip}
          >
            {requestingDriver ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.requestButtonText}>Solicitar Mototaxi Ya</Text>
            )}
          </TouchableOpacity>

          {driverError && <Text style={styles.driverErrorText}>{driverError}</Text>}

          {nearbyDrivers.length > 0 && (
            <View style={styles.driverCard}>
              <Text style={styles.driverCardTitle}>Conductor asignado</Text>
              <Text style={styles.driverCardLine}>{nearbyDrivers[0].name}</Text>
              <Text style={styles.driverCardLine}>{nearbyDrivers[0].car} · {nearbyDrivers[0].plate}</Text>
              <Text style={styles.driverCardLine}>A {nearbyDrivers[0].distance} m de tu origen</Text>
              {nearbyDrivers.length > 1 && (
                <Text style={styles.driverExtraText}>+{nearbyDrivers.length - 1} conductor(es) también disponibles</Text>
              )}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  welcomeContainer: { flex: 1, backgroundColor: '#1E3A8A', justifyContent: 'space-between', padding: 24 },
  brandContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  title: { fontSize: 42, fontWeight: 'bold', color: '#FFFFFF', letterSpacing: 1 },
  subtitle: { fontSize: 16, color: '#E2E8F0', marginTop: 10, textAlign: 'center' },
  bottomContainer: { marginBottom: 40 },
  button: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center', elevation: 5 },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  homeContainer: { flex: 1, backgroundColor: '#fff' },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { marginTop: 12, color: '#64748B', fontSize: 16 },
  errorText: { color: '#EF4444', fontSize: 16, padding: 20, textAlign: 'center' },
  
  topFieldsContainer: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 10, backgroundColor: '#fff', borderRadius: 20, padding: 14, elevation: 8, shadowColor: '#1E3A8A', shadowOpacity: 0.15, shadowRadius: 8 },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  inputField: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#F1F5F9', borderRadius: 10 },
  inputLabel: { fontSize: 11, fontWeight: '700', marginBottom: 2, textTransform: 'uppercase' },
  inputValue: { fontSize: 14, color: '#334155', fontWeight: '500' },
  useLocationButton: { marginLeft: 8, backgroundColor: '#10B981', borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  useLocationText: { fontSize: 16 },
  routeMetaText: { marginTop: 4, fontSize: 12, color: '#64748B', textAlign: 'center', fontWeight: '600' },
  
  embeddedGpsButton: { marginBottom: 12, backgroundColor: '#1E3A8A', borderRadius: 12, padding: 12, alignItems: 'center' },
  embeddedGpsText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  confirmTripContainer: { position: 'absolute', left: 16, right: 16, bottom: 30, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, elevation: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 10, zIndex: 30 },
  serviceTypeBadge: { alignSelf: 'flex-start', marginBottom: 10, backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
  serviceTypeBadgeText: { fontSize: 12, fontWeight: '800', color: '#92400E' },
  packageNotesText: { marginBottom: 10, fontSize: 12, color: '#475569', fontWeight: '600' },
  tripHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  tripTitle: { fontSize: 18, fontWeight: '800', color: '#1E3A8A' },
  cancelText: { color: '#EF4444', fontWeight: '700', fontSize: 14 },
  fareRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 18, backgroundColor: '#F8FAFC', padding: 14, borderRadius: 16 },
  fareLabel: { fontSize: 13, color: '#64748B', fontWeight: '600' },
  fareAmount: { fontSize: 22, color: '#0F766E', fontWeight: '900' },
  paymentMethod: { fontSize: 11, color: '#10B981', fontWeight: '700', marginTop: 1 },
  requestButton: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 16, alignItems: 'center', elevation: 2 },
  disabledButton: { backgroundColor: '#94A3B8' },
  requestButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  driverErrorText: { marginTop: 10, fontSize: 12, color: '#DC2626', fontWeight: '600', textAlign: 'center' },
  driverCard: { marginTop: 12, backgroundColor: '#ECFDF5', borderRadius: 14, padding: 12, borderWidth: 1, borderColor: '#A7F3D0' },
  driverCardTitle: { fontSize: 13, fontWeight: '800', color: '#065F46', marginBottom: 4 },
  driverCardLine: { fontSize: 13, color: '#065F46', fontWeight: '600' },
  driverExtraText: { marginTop: 6, fontSize: 12, color: '#047857', fontWeight: '700' },
});