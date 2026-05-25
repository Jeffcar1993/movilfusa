import React, { useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Platform, StyleSheet, Text, TouchableOpacity, Vibration, View } from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { io, type Socket } from 'socket.io-client';

type ServiceType = 'pasajero' | 'encomienda';
type TripStatus = 'PENDING' | 'CONDUCTOR_EN_CAMINO' | 'CANCELADO';

interface TripPoint {
  latitude: number;
  longitude: number;
  name: string;
}

interface DriverProfile {
  id: string;
  name: string;
  vehicle: string;
  plate: string;
}

interface TripRecord {
  id: string;
  origin: TripPoint;
  destination: TripPoint;
  fare: number;
  serviceType: ServiceType;
  packageNotes?: string;
  status: TripStatus;
  driver?: DriverProfile;
}

interface DriverTripResponse {
  trip: TripRecord | null;
  message?: string;
}

const fallbackApiBaseUrl = Platform.select({
  android: 'http://10.0.2.2:3000',
  default: 'http://localhost:3000',
}) as string;

const API_BASE_URL = (process.env.EXPO_PUBLIC_API_URL ?? fallbackApiBaseUrl).replace(/\/$/, '');
const defaultRegion = {
  latitude: 4.33646,
  longitude: -74.36378,
  latitudeDelta: 0.018,
  longitudeDelta: 0.018,
};

const formatCop = (value: number) => `$${value.toLocaleString('es-CO')}`;

export default function App() {
  const [driverLocation, setDriverLocation] = useState(defaultRegion);
  const [locationReady, setLocationReady] = useState(false);
  const [locationError, setLocationError] = useState<string | null>(null);
  const [incomingTrip, setIncomingTrip] = useState<TripRecord | null>(null);
  const [isTripCardCollapsed, setIsTripCardCollapsed] = useState(false);
  const [acceptingTrip, setAcceptingTrip] = useState(false);
  const [acceptanceMessage, setAcceptanceMessage] = useState<string | null>(null);
  const alertedTripIdRef = useRef<string | null>(null);
  const socketRef = useRef<Socket | null>(null);

  useEffect(() => {
    const requestLocation = async () => {
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();

        if (status !== 'granted') {
          setLocationError('Sin permiso de ubicación. Mostrando zona base de Fusagasugá.');
          setLocationReady(true);
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({});
        setDriverLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.018,
          longitudeDelta: 0.018,
        });
      } catch {
        setLocationError('No se pudo leer la ubicación del conductor.');
      } finally {
        setLocationReady(true);
      }
    };

    requestLocation();
  }, []);

  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
    });

    const subscribeDriverQueue = () => {
      socket.emit('driver:subscribe');
    };

    const handleDriverTrip = (payload: DriverTripResponse) => {
      if (!payload.trip) {
        setIncomingTrip((currentTrip) => (currentTrip?.status === 'CONDUCTOR_EN_CAMINO' ? currentTrip : null));
        return;
      }

      setIncomingTrip(payload.trip);
      setIsTripCardCollapsed(false);
      setAcceptanceMessage(null);

      if (alertedTripIdRef.current !== payload.trip.id && payload.trip.status === 'PENDING') {
        alertedTripIdRef.current = payload.trip.id;
        Vibration.vibrate([0, 300, 200, 300]);
      }
    };

    const handleConnectionError = () => {
      setAcceptanceMessage('No se pudo abrir el canal en tiempo real del conductor.');
    };

    socketRef.current = socket;
    socket.on('connect', subscribeDriverQueue);
    socket.on('driver:trip', handleDriverTrip);
    socket.on('connect_error', handleConnectionError);

    return () => {
      socket.off('connect', subscribeDriverQueue);
      socket.off('driver:trip', handleDriverTrip);
      socket.off('connect_error', handleConnectionError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  const handleAcceptTrip = async () => {
    if (!incomingTrip || acceptingTrip) {
      return;
    }

    setAcceptingTrip(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/driver/trips/${incomingTrip.id}/accept`, {
        method: 'POST',
      });
      const data = (await response.json()) as DriverTripResponse;

      if (!response.ok || !data.trip) {
        throw new Error(data.message ?? 'No fue posible aceptar el viaje.');
      }

      setIncomingTrip(data.trip);
      setAcceptanceMessage(`${data.trip.origin.name} listo. Cliente notificado y recogida en curso.`);
    } catch {
      setAcceptanceMessage('El viaje ya no está disponible o hubo un error de red.');
    } finally {
      setAcceptingTrip(false);
    }
  };

  const serviceLabel = incomingTrip?.serviceType === 'encomienda' ? 'Encomienda' : 'Pasajero';
  const serviceIcon = incomingTrip?.serviceType === 'encomienda' ? 'package-variant-closed' : 'motorbike';
  const driverStatusLabel =
    incomingTrip?.status === 'CONDUCTOR_EN_CAMINO' ? 'Viaje aceptado' : incomingTrip ? 'Viaje entrante' : 'Disponible';
  const driverStatusDotStyle =
    incomingTrip?.status === 'CONDUCTOR_EN_CAMINO'
      ? styles.statusAccepted
      : incomingTrip
        ? styles.statusBusy
        : styles.statusAvailable;

  return (
    <SafeAreaProvider>
    <SafeAreaView style={styles.screen}>
      <StatusBar style="light" />

      <View style={styles.header}>
        <View>
          <Text style={styles.kicker}>MovilFusa Driver</Text>
          <Text style={styles.title}>Conductor</Text>
        </View>
        <View style={styles.statusPill}>
          <View style={[styles.statusDot, driverStatusDotStyle]} />
          <Text style={styles.statusText}>{driverStatusLabel}</Text>
        </View>
      </View>

      <View style={styles.mapCard}>
        {locationReady ? (
          <MapView
            provider={PROVIDER_GOOGLE}
            style={styles.map}
            initialRegion={driverLocation}
            region={driverLocation}
            showsUserLocation={true}
          >
            <Marker
              coordinate={{ latitude: driverLocation.latitude, longitude: driverLocation.longitude }}
              title="Tu moto"
              description="Ubicación actual del conductor"
              pinColor="#F97316"
            />

            {incomingTrip ? (
              <Marker
                coordinate={{ latitude: incomingTrip.origin.latitude, longitude: incomingTrip.origin.longitude }}
                title="Recogida"
                description={incomingTrip.origin.name}
                pinColor="#0F766E"
              />
            ) : null}
          </MapView>
        ) : (
          <View style={styles.mapLoadingState}>
            <ActivityIndicator size="large" color="#F97316" />
            <Text style={styles.mapLoadingText}>Ubicando al conductor...</Text>
          </View>
        )}

        <View style={styles.mapOverlay}>
          <Text style={styles.mapOverlayLabel}>Zona operativa</Text>
          <Text style={styles.mapOverlayValue}>Fusagasugá en tiempo real</Text>
          {locationError ? <Text style={styles.locationError}>{locationError}</Text> : null}
        </View>
      </View>

      <View style={styles.bottomPanel}>
        {incomingTrip ? (
          <View style={styles.tripCard}>
            <View style={styles.tripCardHeader}>
              <View style={styles.alertBadge}>
                <MaterialCommunityIcons name="bell-ring" size={18} color="#7C2D12" />
                <Text style={styles.alertBadgeText}>{incomingTrip.status === 'CONDUCTOR_EN_CAMINO' ? 'Viaje aceptado' : 'Viaje entrante'}</Text>
              </View>
              <TouchableOpacity
                style={styles.collapseButton}
                onPress={() => setIsTripCardCollapsed((currentValue) => !currentValue)}
                activeOpacity={0.8}
              >
                <MaterialCommunityIcons
                  name={isTripCardCollapsed ? 'chevron-up' : 'chevron-down'}
                  size={24}
                  color="#7C2D12"
                />
              </TouchableOpacity>
            </View>

            {isTripCardCollapsed ? (
              <View style={styles.collapsedSummaryRow}>
                <View style={styles.collapsedSummaryTextBlock}>
                  <Text style={styles.tripMetricLabel}>Destino</Text>
                  <Text style={styles.collapsedDestinationText}>{incomingTrip.destination.name}</Text>
                </View>
                <Text style={styles.collapsedFareText}>{formatCop(incomingTrip.fare)}</Text>
              </View>
            ) : (
              <>
                <View style={styles.tripMetricRow}>
                  <Text style={styles.tripMetricLabel}>¿A dónde va?</Text>
                  <Text style={styles.tripMetricValue}>{incomingTrip.destination.name}</Text>
                </View>

                <View style={styles.tripMetricRow}>
                  <Text style={styles.tripMetricLabel}>¿Cuánto gana?</Text>
                  <Text style={styles.tripFare}>{formatCop(incomingTrip.fare)}</Text>
                </View>

                <View style={styles.serviceRow}>
                  <View style={styles.serviceChip}>
                    <MaterialCommunityIcons name={serviceIcon} size={22} color="#0F172A" />
                    <Text style={styles.serviceChipText}>{serviceLabel}</Text>
                  </View>
                  {incomingTrip.serviceType === 'encomienda' && incomingTrip.packageNotes ? (
                    <Text style={styles.packageNote}>{incomingTrip.packageNotes}</Text>
                  ) : (
                    <Text style={styles.packageNote}>1 pasajero, casco reglamentario.</Text>
                  )}
                </View>

                <TouchableOpacity
                  style={[styles.acceptButton, acceptingTrip && styles.acceptButtonDisabled]}
                  onPress={handleAcceptTrip}
                  disabled={acceptingTrip || incomingTrip.status === 'CONDUCTOR_EN_CAMINO'}
                  activeOpacity={0.9}
                >
                  {acceptingTrip ? (
                    <ActivityIndicator color="#FFF7ED" />
                  ) : (
                    <Text style={styles.acceptButtonText}>
                      {incomingTrip.status === 'CONDUCTOR_EN_CAMINO' ? 'VIAJE ACEPTADO' : 'ACEPTAR VIAJE'}
                    </Text>
                  )}
                </TouchableOpacity>

                {acceptanceMessage ? <Text style={styles.acceptanceMessage}>{acceptanceMessage}</Text> : null}
              </>
            )}
          </View>
        ) : (
          <View style={styles.idleCard}>
            <MaterialCommunityIcons name="motorbike-electric" size={34} color="#F97316" />
            <Text style={styles.idleTitle}>Esperando la próxima solicitud</Text>
            <Text style={styles.idleText}>Cuando el cliente pida un viaje o una encomienda, la alerta aparecerá aquí con un único botón grande para aceptarla.</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: '#0B1120',
  },
  header: {
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  kicker: {
    color: '#F97316',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
    letterSpacing: 1,
  },
  title: {
    color: '#FFF7ED',
    fontSize: 28,
    fontWeight: '800',
    marginTop: 4,
  },
  statusPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: '#111827',
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderRadius: 999,
  },
  statusDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  statusAvailable: {
    backgroundColor: '#22C55E',
  },
  statusAccepted: {
    backgroundColor: '#14B8A6',
  },
  statusBusy: {
    backgroundColor: '#F97316',
  },
  statusText: {
    color: '#E5E7EB',
    fontWeight: '700',
    fontSize: 12,
  },
  mapCard: {
    flex: 1,
    marginHorizontal: 16,
    borderRadius: 28,
    overflow: 'hidden',
    backgroundColor: '#111827',
    borderWidth: 1,
    borderColor: '#1F2937',
  },
  map: {
    flex: 1,
  },
  mapLoadingState: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#111827',
  },
  mapLoadingText: {
    color: '#E5E7EB',
    marginTop: 12,
    fontSize: 15,
    fontWeight: '600',
  },
  mapOverlay: {
    position: 'absolute',
    top: 16,
    left: 16,
    right: 16,
    backgroundColor: 'rgba(15, 23, 42, 0.82)',
    padding: 14,
    borderRadius: 18,
  },
  mapOverlayLabel: {
    color: '#94A3B8',
    fontSize: 12,
    textTransform: 'uppercase',
    fontWeight: '700',
  },
  mapOverlayValue: {
    color: '#FFF7ED',
    fontSize: 18,
    fontWeight: '700',
    marginTop: 4,
  },
  locationError: {
    color: '#FDBA74',
    marginTop: 6,
    fontSize: 12,
    fontWeight: '600',
  },
  bottomPanel: {
    paddingHorizontal: 16,
    paddingTop: 16,
    paddingBottom: 20,
  },
  tripCard: {
    backgroundColor: '#FFF7ED',
    borderRadius: 28,
    padding: 20,
    gap: 14,
  },
  tripCardHeader: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
  },
  alertBadge: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 999,
    backgroundColor: '#FED7AA',
  },
  alertBadgeText: {
    color: '#7C2D12',
    fontWeight: '800',
    fontSize: 12,
    textTransform: 'uppercase',
  },
  collapseButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    alignItems: 'center',
    justifyContent: 'center',
    backgroundColor: '#FED7AA',
  },
  collapsedSummaryRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
  },
  collapsedSummaryTextBlock: {
    flex: 1,
  },
  collapsedDestinationText: {
    color: '#0F172A',
    fontSize: 18,
    fontWeight: '700',
  },
  collapsedFareText: {
    color: '#C2410C',
    fontSize: 24,
    fontWeight: '900',
  },
  tripMetricRow: {
    gap: 4,
  },
  tripMetricLabel: {
    color: '#64748B',
    fontSize: 12,
    fontWeight: '700',
    textTransform: 'uppercase',
  },
  tripMetricValue: {
    color: '#0F172A',
    fontSize: 21,
    fontWeight: '700',
  },
  tripFare: {
    color: '#C2410C',
    fontSize: 32,
    fontWeight: '900',
  },
  serviceRow: {
    gap: 10,
  },
  serviceChip: {
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
    backgroundColor: '#E2E8F0',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  serviceChipText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 15,
  },
  packageNote: {
    color: '#334155',
    fontSize: 14,
    lineHeight: 20,
    fontWeight: '600',
  },
  acceptButton: {
    backgroundColor: '#EA580C',
    borderRadius: 24,
    minHeight: 72,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 4,
  },
  acceptButtonDisabled: {
    opacity: 0.72,
  },
  acceptButtonText: {
    color: '#FFF7ED',
    fontSize: 24,
    fontWeight: '900',
    letterSpacing: 0.8,
  },
  acceptanceMessage: {
    color: '#0F766E',
    fontSize: 14,
    fontWeight: '700',
  },
  idleCard: {
    backgroundColor: '#111827',
    borderRadius: 28,
    padding: 20,
    alignItems: 'flex-start',
    gap: 10,
  },
  idleTitle: {
    color: '#FFF7ED',
    fontSize: 22,
    fontWeight: '800',
  },
  idleText: {
    color: '#CBD5E1',
    fontSize: 15,
    lineHeight: 22,
    fontWeight: '500',
  },
});
