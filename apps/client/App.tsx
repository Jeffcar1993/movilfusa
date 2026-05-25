import React, { useEffect, useRef, useState } from 'react';
import {
  StyleSheet,
  Text,
  View,
  TouchableOpacity,
  ActivityIndicator,
  Dimensions,
  Platform,
  TextInput,
  Keyboard,
  Animated,
  Easing,
  ScrollView,
  Alert,
  Image,
  Vibration,
} from 'react-native';
import MapView, { Marker, Polyline, PROVIDER_GOOGLE, type LatLng } from 'react-native-maps';
import * as Location from 'expo-location';
import * as ImagePicker from 'expo-image-picker';
import { io, type Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AddressSearch from './src/components/AddressSearch';

interface RouteInfo {
  distanceKm: number;
  durationMin: number;
}

type ServiceType = 'pasajero' | 'encomienda';

type TripStatus = 'PENDING' | 'CONDUCTOR_EN_CAMINO' | 'EN_VIAJE' | 'FINALIZADO' | 'CANCELADO';

interface DriverProfile {
  id: string;
  name: string;
  vehicle: string;
  plate: string;
}

interface TripRecord {
  id: string;
  fare: number;
  status: TripStatus;
  serviceType: ServiceType;
  packageNotes?: string;
  driver?: DriverProfile;
  finishedAt?: string;
  currentDriverLocation?: {
    latitude: number;
    longitude: number;
    updatedAt: string;
  };
  rating?: {
    stars: number;
    message?: string;
    createdAt: string;
  };
}

interface CreateTripResponse {
  trip?: TripRecord | null;
  packageNotes?: string;
  message?: string;
}

interface DriverLocationEvent {
  tripId: string;
  location: {
    latitude: number;
    longitude: number;
    updatedAt: string;
  };
}

type AuthProvider = 'google' | 'phone';
type ClientEntryStep = 'boot' | 'login' | 'otp' | 'profile' | 'home';

interface ClientSession {
  provider: AuthProvider;
  identifier: string;
  name: string;
}

interface ClientRegistrationProfile {
  name: string;
  phone?: string;
  provider: AuthProvider;
  identifier: string;
  profilePhotoUrl?: string;
  registrationComplete: boolean;
}

type ProfileSection = 'menu' | 'details' | 'history';

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
const CLIENT_SESSION_KEY = 'movilfusa:client:session';
const CLIENT_PROFILE_PREFIX = 'movilfusa:client:profile:';
const getClientProfileKey = (identifier: string) => `${CLIENT_PROFILE_PREFIX}${identifier}`;

export default function App() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [entryStep, setEntryStep] = useState<ClientEntryStep>('boot');
  const [session, setSession] = useState<ClientSession | null>(null);
  const [authProvider, setAuthProvider] = useState<AuthProvider | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const [profileName, setProfileName] = useState('');
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const splashOpacity = useRef(new Animated.Value(0)).current;
  const splashScale = useRef(new Animated.Value(0.95)).current;
  
  // Estados de control de rutas y UI
  const [searchMode, setSearchMode] = useState<'origin' | 'destination' | null>(null);
  const [origin, setOrigin] = useState<TripPoint | null>(null);
  const [destination, setDestination] = useState<TripPoint | null>(null);
  const [loadingGps, setLoadingGps] = useState(false);
  const [routeCoordinates, setRouteCoordinates] = useState<LatLng[]>([]);
  const [routeInfo, setRouteInfo] = useState<RouteInfo | null>(null);
  const [loadingRoute, setLoadingRoute] = useState(false);
  const [requestingDriver, setRequestingDriver] = useState(false);
  const [isMatching, setIsMatching] = useState(false);
  const [driverError, setDriverError] = useState<string | null>(null);
  const [requestMetaMessage, setRequestMetaMessage] = useState<string | null>(null);
  const [currentTripId, setCurrentTripId] = useState<string | null>(null);
  const [tripStatus, setTripStatus] = useState<TripStatus | null>(null);
  const [activeTrip, setActiveTrip] = useState<TripRecord | null>(null);
  const [driverLiveLocation, setDriverLiveLocation] = useState<LatLng | null>(null);
  const [ratingStars, setRatingStars] = useState(0);
  const [ratingMessage, setRatingMessage] = useState('');
  const [submittingRating, setSubmittingRating] = useState(false);
  const [ratingSubmitted, setRatingSubmitted] = useState(false);
  const [keyboardOffset, setKeyboardOffset] = useState(0);
  const [showProfileScreen, setShowProfileScreen] = useState(false);
  const [profileSection, setProfileSection] = useState<ProfileSection>('menu');
  const [clientTripHistory, setClientTripHistory] = useState<TripRecord[]>([]);
  const [loadingClientHistory, setLoadingClientHistory] = useState(false);
  const [clientProfile, setClientProfile] = useState<ClientRegistrationProfile | null>(null);
  const mapRef = useRef<MapView | null>(null);
  const socketRef = useRef<Socket | null>(null);
  const currentTripIdRef = useRef<string | null>(null);
  const notifiedAcceptedTripIdRef = useRef<string | null>(null);

  const fallbackRouteCoordinates: LatLng[] = origin && destination
    ? [
        { latitude: origin.latitude, longitude: origin.longitude },
        { latitude: destination.latitude, longitude: destination.longitude },
      ]
    : [];

  const saveClientProfile = async (profile: ClientRegistrationProfile) => {
    await AsyncStorage.setItem(getClientProfileKey(profile.identifier), JSON.stringify(profile));
    setClientProfile(profile);
  };

  const loadClientProfile = async (identifier: string): Promise<ClientRegistrationProfile | null> => {
    const profileRaw = await AsyncStorage.getItem(getClientProfileKey(identifier));
    if (!profileRaw) {
      setClientProfile(null);
      return null;
    }

    try {
      const parsed = JSON.parse(profileRaw) as ClientRegistrationProfile;
      setClientProfile(parsed);
      return parsed;
    } catch {
      setClientProfile(null);
      return null;
    }
  };

  const handleLogout = async () => {
    try {
      await AsyncStorage.removeItem(CLIENT_SESSION_KEY);
    } catch {
      // Keep UX responsive even if storage fails.
    }

    setSession(null);
    setClientProfile(null);
    setShowProfileScreen(false);
    setProfileSection('menu');
    setEntryStep('login');
  };

  const handleDeleteAccount = () => {
    if (!session) {
      return;
    }

    Alert.alert(
      'Eliminar cuenta',
      'Esta acción es permanente y cerrará tu sesión.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar',
          style: 'destructive',
          onPress: async () => {
            try {
              await fetch(`${API_BASE_URL}/api/client/account/${session.identifier}`, {
                method: 'DELETE',
              });
            } catch {
              // Account cleanup continues locally even if backend is unavailable.
            }

            try {
              await AsyncStorage.removeItem(CLIENT_SESSION_KEY);
              await AsyncStorage.removeItem(getClientProfileKey(session.identifier));
            } catch {
              // Continue with in-memory cleanup.
            }

            setSession(null);
            setClientProfile(null);
            setShowProfileScreen(false);
            setProfileSection('menu');
            setEntryStep('login');
          },
        },
      ],
    );
  };

  const handlePickProfilePhoto = async () => {
    if (!clientProfile) {
      return;
    }

    const permission = await ImagePicker.requestMediaLibraryPermissionsAsync();
    if (!permission.granted) {
      setAuthFeedback('Debes habilitar galería para subir foto de perfil.');
      return;
    }

    const result = await ImagePicker.launchImageLibraryAsync({
      mediaTypes: ['images'],
      allowsEditing: true,
      quality: 0.7,
      aspect: [1, 1],
    });

    if (result.canceled || !result.assets[0]?.uri) {
      return;
    }

    const updatedProfile: ClientRegistrationProfile = {
      ...clientProfile,
      profilePhotoUrl: result.assets[0].uri,
    };

    await saveClientProfile(updatedProfile);
  };

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
    let isMounted = true;

    const bootstrapSession = async () => {
      let savedSessionRaw: string | null = null;

      Animated.parallel([
        Animated.timing(splashOpacity, {
          toValue: 1,
          duration: 420,
          easing: Easing.out(Easing.quad),
          useNativeDriver: true,
        }),
        Animated.timing(splashScale, {
          toValue: 1,
          duration: 700,
          easing: Easing.out(Easing.back(1.2)),
          useNativeDriver: true,
        }),
      ]).start();

      try {
        savedSessionRaw = await AsyncStorage.getItem(CLIENT_SESSION_KEY);
      } catch {
        savedSessionRaw = null;
      }

      setTimeout(() => {
        if (!isMounted) {
          return;
        }

        if (!savedSessionRaw) {
          setEntryStep('login');
          return;
        }

        try {
          const parsedSession = JSON.parse(savedSessionRaw) as ClientSession;
          if (parsedSession?.identifier && parsedSession?.name) {
            setSession(parsedSession);
            void loadClientProfile(parsedSession.identifier);
            setEntryStep('home');
            return;
          }
        } catch {
          // If parsing fails, continue with fresh login.
        }

        setEntryStep('login');
      }, 850);
    };

    bootstrapSession();

    return () => {
      isMounted = false;
    };
  }, [splashOpacity, splashScale]);

  useEffect(() => {
    if (entryStep !== 'otp' || otpSecondsLeft <= 0) {
      return;
    }

    const timeout = setTimeout(() => {
      setOtpSecondsLeft((current) => Math.max(0, current - 1));
    }, 1000);

    return () => clearTimeout(timeout);
  }, [entryStep, otpSecondsLeft]);

  useEffect(() => {
    if (entryStep !== 'home' || location) {
      return;
    }

    let isActive = true;

    const requestLocation = async () => {
      setLoadingGps(true);
      try {
        const { status } = await Location.requestForegroundPermissionsAsync();
        if (status !== 'granted') {
          if (isActive) {
            setErrorMsg('Permiso de ubicación denegado.');
          }
          return;
        }

        const currentLocation = await Location.getCurrentPositionAsync({});
        if (isActive) {
          setLocation(currentLocation);
          setErrorMsg(null);
        }
      } catch {
        if (isActive) {
          setErrorMsg('Error al obtener la ubicación.');
        }
      } finally {
        if (isActive) {
          setLoadingGps(false);
        }
      }
    };

    requestLocation();

    return () => {
      isActive = false;
    };
  }, [entryStep, location]);

  const resolveIdentifier = (provider: AuthProvider): string => {
    if (provider === 'google') {
      return 'google-demo-user';
    }

    return phoneNumber.replace(/\D/g, '');
  };

  const persistSessionAndOpenHome = async (provider: AuthProvider, identifier: string, name: string) => {
    const nextSession: ClientSession = { provider, identifier, name };

    try {
      await AsyncStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(nextSession));
    } catch {
      // Allow access even if local persistence fails in current session.
    }

    setSession(nextSession);
    void loadClientProfile(identifier);
    setAuthFeedback(null);
    setEntryStep('home');
  };

  const handleStartGoogleAuth = async () => {
    const provider: AuthProvider = 'google';
    const identifier = resolveIdentifier(provider);
    const profile = await loadClientProfile(identifier);

    setAuthProvider(provider);
    if (profile?.name) {
      await persistSessionAndOpenHome(provider, identifier, profile.name);
      return;
    }

    setProfileName('');
    setEntryStep('profile');
  };

  const handleStartPhoneAuth = () => {
    const sanitized = phoneNumber.replace(/\D/g, '');
    if (sanitized.length < 10) {
      setAuthFeedback('Ingresa un número de teléfono válido.');
      return;
    }

    setAuthFeedback('Código enviado. Revisa tus SMS.');
    setOtpCode('');
    setOtpSecondsLeft(35);
    setAuthProvider('phone');
    setEntryStep('otp');
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6 || authProvider !== 'phone') {
      setAuthFeedback('El código OTP debe tener 6 dígitos.');
      return;
    }

    const identifier = resolveIdentifier('phone');
    const profile = await loadClientProfile(identifier);

    if (profile?.name) {
      await persistSessionAndOpenHome('phone', identifier, profile.name);
      return;
    }

    setProfileName('');
    setEntryStep('profile');
    setAuthFeedback('Código validado. Completa tu perfil rápido.');
  };

  const handleSaveProfile = async () => {
    const trimmedName = profileName.trim();
    if (!trimmedName || !authProvider) {
      setAuthFeedback('Escribe tu nombre para continuar.');
      return;
    }

    const identifier = resolveIdentifier(authProvider);
    const nextProfile: ClientRegistrationProfile = {
      name: trimmedName,
      provider: authProvider,
      identifier,
      phone: authProvider === 'phone' ? phoneNumber.replace(/\D/g, '') : undefined,
      profilePhotoUrl: '',
      registrationComplete: true,
    };
    await saveClientProfile(nextProfile);

    await persistSessionAndOpenHome(authProvider, identifier, trimmedName);
  };

  const handleResendOtp = () => {
    if (otpSecondsLeft > 0) {
      return;
    }

    setOtpSecondsLeft(35);
    setAuthFeedback('Nuevo código enviado por SMS.');
  };

  const handleQuickDemoAccess = async () => {
    const provider: AuthProvider = 'google';
    const identifier = 'demo-client-local';
    const demoName = 'Cliente Demo';

    try {
      await saveClientProfile({
        name: demoName,
        provider,
        identifier,
        phone: '3000000000',
        profilePhotoUrl: '',
        registrationComplete: true,
      });
    } catch {
      // Continue with transient demo access.
    }

    await persistSessionAndOpenHome(provider, identifier, demoName);
  };

  const loadClientHistory = async () => {
    if (!session?.identifier) {
      setClientTripHistory([]);
      return;
    }

    setLoadingClientHistory(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/client/trips/${session.identifier}`);
      const data = (await response.json()) as { trips?: TripRecord[] };
      setClientTripHistory(Array.isArray(data.trips) ? data.trips : []);
    } catch {
      setClientTripHistory([]);
    } finally {
      setLoadingClientHistory(false);
    }
  };

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
    setDriverError(null);
    setRequestMetaMessage(null);
    setIsMatching(false);
    setCurrentTripId(null);
    setTripStatus(null);
    setActiveTrip(null);
    setDriverLiveLocation(null);
    setRatingStars(0);
    setRatingMessage('');
    setRatingSubmitted(false);
    notifiedAcceptedTripIdRef.current = null;
  }, [origin, destination]);

  useEffect(() => {
    currentTripIdRef.current = currentTripId;
  }, [currentTripId]);

  useEffect(() => {
    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
    });

    const subscribeCurrentTrip = () => {
      if (currentTripIdRef.current) {
        socket.emit('trip:watch', currentTripIdRef.current);
      }
    };

    const handleTripUpdated = (payload: CreateTripResponse) => {
      const trip = payload.trip;

      if (!trip || trip.id !== currentTripIdRef.current) {
        return;
      }

      setActiveTrip(trip);
      setTripStatus(trip.status);

      if (trip.currentDriverLocation) {
        setDriverLiveLocation({
          latitude: trip.currentDriverLocation.latitude,
          longitude: trip.currentDriverLocation.longitude,
        });
      }

      if (trip.status === 'CONDUCTOR_EN_CAMINO') {
        if (notifiedAcceptedTripIdRef.current !== trip.id) {
          notifiedAcceptedTripIdRef.current = trip.id;
          Vibration.vibrate([0, 220, 120, 220]);
          Alert.alert(
            'Conductor aceptó tu viaje',
            `${trip.driver?.name ?? 'Tu conductor'} va en camino${trip.driver?.plate ? ` · Placa ${trip.driver.plate}` : ''}.`,
          );
        }

        setRequestMetaMessage(
          `${trip.driver?.name ?? 'Un conductor'} aceptó tu solicitud y va en camino en ${trip.driver?.vehicle ?? 'su vehículo'}${trip.driver?.plate ? ` · Placa ${trip.driver.plate}` : ''}.`,
        );
        return;
      }

      if (trip.status === 'EN_VIAJE') {
        setRequestMetaMessage('Tu viaje está en curso. Sigues al conductor en tiempo real.');
        return;
      }

      if (trip.status === 'FINALIZADO') {
        setRequestMetaMessage('Viaje finalizado. ¿Cómo estuvo tu experiencia?');
        return;
      }

      if (trip.status === 'CANCELADO') {
        setRequestMetaMessage('La solicitud fue cancelada.');
        setIsMatching(false);
        setCurrentTripId(null);
        setActiveTrip(null);
        setDriverLiveLocation(null);
      }
    };

    const handleDriverLocation = (payload: DriverLocationEvent) => {
      if (payload.tripId !== currentTripIdRef.current) {
        return;
      }

      setDriverLiveLocation({
        latitude: payload.location.latitude,
        longitude: payload.location.longitude,
      });
    };

    const handleConnectionError = () => {
      setDriverError('No se pudo abrir el canal en tiempo real con el servidor.');
    };

    socketRef.current = socket;
    socket.on('connect', subscribeCurrentTrip);
    socket.on('trip:updated', handleTripUpdated);
    socket.on('driver:location', handleDriverLocation);
    socket.on('connect_error', handleConnectionError);

    return () => {
      socket.off('connect', subscribeCurrentTrip);
      socket.off('trip:updated', handleTripUpdated);
      socket.off('driver:location', handleDriverLocation);
      socket.off('connect_error', handleConnectionError);
      socket.disconnect();
      socketRef.current = null;
    };
  }, []);

  useEffect(() => {
    if (!currentTripId || !isMatching) {
      return;
    }

    socketRef.current?.emit('trip:watch', currentTripId);
  }, [currentTripId, isMatching]);

  useEffect(() => {
    const showSubscription = Keyboard.addListener('keyboardDidShow', (event) => {
      setKeyboardOffset(event.endCoordinates.height + 10);
    });
    const hideSubscription = Keyboard.addListener('keyboardDidHide', () => {
      setKeyboardOffset(0);
    });

    return () => {
      showSubscription.remove();
      hideSubscription.remove();
    };
  }, []);

  const handleRequestTrip = async () => {
    if (!origin || !destination || requestingDriver || isMatching || !computedFare) {
      return;
    }

    setRequestingDriver(true);
    setIsMatching(true);
    setDriverError(null);
    setRequestMetaMessage(null);
    setTripStatus('PENDING');
    setActiveTrip(null);
    setDriverLiveLocation(null);
    setRatingStars(0);
    setRatingMessage('');
    setRatingSubmitted(false);
    notifiedAcceptedTripIdRef.current = null;

    try {
      const response = await fetch(`${API_BASE_URL}/api/trips`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
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
          fare: computedFare,
          serviceType: destination.serviceType ?? 'pasajero',
          packageNotes: destination.packageNotes,
          ...(session
            ? {
                client: {
                  id: session.identifier,
                  name: session.name,
                },
              }
            : {}),
        }),
      });

      const data = (await response.json()) as CreateTripResponse;

      const confirmedServiceType: ServiceType = destination.serviceType === 'encomienda' ? 'encomienda' : 'pasajero';
      setRequestMetaMessage(
        `Solicitud enviada como ${confirmedServiceType === 'encomienda' ? 'encomienda' : 'viaje en moto'}. Buscando conductor cercano...`,
      );

      if (!response.ok) {
        throw new Error(data?.message ?? 'No fue posible contactar el servidor de conductores.');
      }

      setCurrentTripId(data.trip?.id ?? null);
      setActiveTrip(data.trip ?? null);
      if (data.trip?.id) {
        socketRef.current?.emit('trip:watch', data.trip.id);
      }
    } catch {
      setDriverError('No se pudo solicitar el servicio. Verifica red y servidor.');
      setIsMatching(false);
      setCurrentTripId(null);
      setTripStatus(null);
      setActiveTrip(null);
      setDriverLiveLocation(null);
    } finally {
      setRequestingDriver(false);
    }
  };

  const handleCancelRequest = async () => {
    const tripIdToCancel = currentTripId;

    if (tripIdToCancel) {
      try {
        await fetch(`${API_BASE_URL}/api/trips/${tripIdToCancel}/cancel`, {
          method: 'POST',
        });
      } catch {
        setDriverError('No se pudo cancelar la solicitud en el servidor.');
      }
    }

    setIsMatching(false);
    setRequestingDriver(false);
    setRequestMetaMessage(null);
    setDriverError(null);
    setCurrentTripId(null);
    setTripStatus(null);
    setActiveTrip(null);
    setDriverLiveLocation(null);
    setRatingStars(0);
    setRatingMessage('');
    setRatingSubmitted(false);
    notifiedAcceptedTripIdRef.current = null;
  };

  const handleSubmitRating = async () => {
    if (!currentTripId || ratingStars < 1 || submittingRating || ratingSubmitted) {
      return;
    }

    setSubmittingRating(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/trips/${currentTripId}/rating`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          stars: ratingStars,
          message: ratingMessage,
        }),
      });

      const data = (await response.json()) as CreateTripResponse;

      if (!response.ok) {
        throw new Error(data.message ?? 'No fue posible enviar la calificación.');
      }

      setActiveTrip(data.trip ?? null);
      setRatingSubmitted(true);

      // Reset customer screen so it's ready for a fresh request.
      setIsMatching(false);
      setCurrentTripId(null);
      setTripStatus(null);
      setActiveTrip(null);
      setDriverLiveLocation(null);
      setOrigin(null);
      setDestination(null);
      setRouteCoordinates([]);
      setRouteInfo(null);
      setRequestMetaMessage(null);
      setDriverError(null);
      setRatingStars(0);
      setRatingMessage('');
      setRatingSubmitted(false);
    } catch {
      setDriverError('No se pudo enviar la calificación. Intenta de nuevo.');
    } finally {
      setSubmittingRating(false);
    }
  };

  if (entryStep === 'boot') {
    return (
      <View style={styles.welcomeContainer}>
        <Animated.View style={[styles.brandContainer, { opacity: splashOpacity, transform: [{ scale: splashScale }] }]}>
          <Text style={styles.title}>MovilFusa</Text>
          <Text style={styles.subtitle}>Conecta Fusagasugá en segundos</Text>
        </Animated.View>
      </View>
    );
  }

  if (entryStep === 'login') {
    return (
      <View style={styles.authScreen}>
        <View style={styles.authHeroCard}>
          <View style={styles.authHeroIconWrap}>
            <MaterialCommunityIcons name="map-marker-radius" size={34} color="#0F766E" />
          </View>
          <Text style={styles.authTitle}>Bienvenido Cliente</Text>
          <Text style={styles.authSubtitle}>Ingresa con Google o tu número de teléfono.</Text>
        </View>

        <TouchableOpacity style={styles.authPrimaryButton} onPress={handleStartGoogleAuth}>
          <View style={styles.authButtonContentRow}>
            <MaterialCommunityIcons name="google" size={20} color="#FFFFFF" />
            <Text style={styles.authPrimaryButtonText}>Continuar con Google</Text>
          </View>
        </TouchableOpacity>

        <Text style={styles.authHint}>o continúa con número</Text>

        <View style={styles.authPhoneInputRow}>
          <View style={styles.authPhonePrefixBadge}>
            <Text style={styles.authPhonePrefixText}>+57</Text>
          </View>
          <TextInput
            value={phoneNumber}
            onChangeText={setPhoneNumber}
            placeholder="3001234567"
            placeholderTextColor="#94A3B8"
            keyboardType="phone-pad"
            style={styles.authPhoneInput}
          />
        </View>

        <TouchableOpacity style={styles.authSecondaryButton} onPress={handleStartPhoneAuth}>
          <View style={styles.authButtonContentRow}>
            <MaterialCommunityIcons name="cellphone-message" size={19} color="#FFFFFF" />
            <Text style={styles.authSecondaryButtonText}>Continuar con número de teléfono</Text>
          </View>
        </TouchableOpacity>

        <TouchableOpacity style={styles.authDemoButton} onPress={handleQuickDemoAccess}>
          <MaterialCommunityIcons name="flash" size={18} color="#0F172A" />
          <Text style={styles.authDemoButtonText}>Entrar rápido para pruebas</Text>
        </TouchableOpacity>

        {authFeedback ? <Text style={styles.authFeedback}>{authFeedback}</Text> : null}
      </View>
    );
  }

  if (entryStep === 'otp') {
    return (
      <View style={styles.authScreen}>
        <Text style={styles.authTitle}>Verifica tu número</Text>
        <Text style={styles.authSubtitle}>Ingresa el código OTP de 6 dígitos.</Text>

        <TextInput
          value={otpCode}
          onChangeText={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
          placeholder="123456"
          placeholderTextColor="#94A3B8"
          keyboardType="number-pad"
          autoComplete="sms-otp"
          textContentType="oneTimeCode"
          maxLength={6}
          style={styles.authOtpInput}
        />

        <TouchableOpacity style={styles.authPrimaryButton} onPress={handleVerifyOtp}>
          <Text style={styles.authPrimaryButtonText}>Verificar código</Text>
        </TouchableOpacity>

        <TouchableOpacity style={styles.authDemoButton} onPress={() => setOtpCode('123456')}>
          <MaterialCommunityIcons name="numeric-6-circle" size={18} color="#0F172A" />
          <Text style={styles.authDemoButtonText}>Usar OTP demo 123456</Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.authGhostButton, otpSecondsLeft > 0 && styles.authGhostButtonDisabled]}
          onPress={handleResendOtp}
          disabled={otpSecondsLeft > 0}
        >
          <Text style={styles.authGhostButtonText}>
            {otpSecondsLeft > 0 ? `Reenviar en ${otpSecondsLeft}s` : 'Reenviar código'}
          </Text>
        </TouchableOpacity>

        {authFeedback ? <Text style={styles.authFeedback}>{authFeedback}</Text> : null}
      </View>
    );
  }

  if (entryStep === 'profile') {
    return (
      <View style={styles.authScreen}>
        <Text style={styles.authTitle}>Completa tu perfil</Text>
        <Text style={styles.authSubtitle}>Solo te toma unos segundos.</Text>

        <TextInput
          value={profileName}
          onChangeText={setProfileName}
          placeholder="Tu nombre"
          placeholderTextColor="#94A3B8"
          style={styles.authInput}
        />

        <TouchableOpacity style={styles.authPrimaryButton} onPress={handleSaveProfile}>
          <Text style={styles.authPrimaryButtonText}>Guardar y continuar</Text>
        </TouchableOpacity>

        {authFeedback ? <Text style={styles.authFeedback}>{authFeedback}</Text> : null}
      </View>
    );
  }

  if (searchMode === 'origin') {
    return (
      <AddressSearch
        showServiceSelector={false}
        currentLocation={{
          latitude: location?.coords.latitude ?? 4.33646,
          longitude: location?.coords.longitude ?? -74.36378,
        }}
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
        currentLocation={{
          latitude: origin?.latitude ?? location?.coords.latitude ?? 4.33646,
          longitude: origin?.longitude ?? location?.coords.longitude ?? -74.36378,
        }}
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

  if (showProfileScreen) {
    return (
      <View style={styles.profileScreenRoot}>
        <View style={styles.profileScreenHeader}>
          <TouchableOpacity
            style={styles.profileBackButton}
            onPress={() => {
              if (profileSection === 'menu') {
                setShowProfileScreen(false);
                return;
              }
              setProfileSection('menu');
            }}
          >
            <MaterialCommunityIcons name="chevron-left" size={22} color="#0F172A" />
          </TouchableOpacity>
          <Text style={styles.profileScreenTitle}>Perfil</Text>
          <View style={{ width: 36 }} />
        </View>

        {profileSection === 'menu' ? (
          <View style={styles.profileMenuBody}>
            <TouchableOpacity style={styles.profileMenuItem} onPress={() => setProfileSection('details')}>
              <MaterialCommunityIcons name="account-box-outline" size={20} color="#0F766E" />
              <Text style={styles.profileMenuText}>Perfil</Text>
            </TouchableOpacity>

            <TouchableOpacity
              style={styles.profileMenuItem}
              onPress={() => {
                setProfileSection('history');
                void loadClientHistory();
              }}
            >
              <MaterialCommunityIcons name="history" size={20} color="#1E3A8A" />
              <Text style={styles.profileMenuText}>Historial de viajes</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.profileMenuItem} onPress={handleLogout}>
              <MaterialCommunityIcons name="logout" size={20} color="#B45309" />
              <Text style={styles.profileMenuText}>Cerrar sesión</Text>
            </TouchableOpacity>

            <TouchableOpacity style={styles.profileMenuItemDanger} onPress={handleDeleteAccount}>
              <MaterialCommunityIcons name="delete-alert-outline" size={20} color="#B91C1C" />
              <Text style={styles.profileMenuDangerText}>Eliminar cuenta permanentemente</Text>
            </TouchableOpacity>
          </View>
        ) : null}

        {profileSection === 'details' ? (
          <ScrollView contentContainerStyle={styles.profileDetailsBody}>
            <TouchableOpacity style={styles.profilePhotoWrap} onPress={() => void handlePickProfilePhoto()}>
              {clientProfile?.profilePhotoUrl ? (
                <Image source={{ uri: clientProfile.profilePhotoUrl }} style={styles.profilePhoto} />
              ) : (
                <View style={styles.profilePhotoPlaceholder}>
                  <MaterialCommunityIcons name="account" size={34} color="#334155" />
                </View>
              )}
              <Text style={styles.profilePhotoCta}>Subir o cambiar foto</Text>
            </TouchableOpacity>

            <View style={styles.readonlyRow}>
              <Text style={styles.readonlyLabel}>Nombre</Text>
              <Text style={styles.readonlyValue}>{clientProfile?.name ?? session?.name ?? 'Sin dato'}</Text>
            </View>
            <View style={styles.readonlyRow}>
              <Text style={styles.readonlyLabel}>Proveedor</Text>
              <Text style={styles.readonlyValue}>{clientProfile?.provider === 'phone' ? 'Teléfono' : 'Google'}</Text>
            </View>
            <View style={styles.readonlyRow}>
              <Text style={styles.readonlyLabel}>Teléfono</Text>
              <Text style={styles.readonlyValue}>{clientProfile?.phone ?? 'No aplica'}</Text>
            </View>
            <View style={styles.readonlyRow}>
              <Text style={styles.readonlyLabel}>ID de cuenta</Text>
              <Text style={styles.readonlyValue}>{session?.identifier ?? 'Sin dato'}</Text>
            </View>

            <Text style={styles.readonlyFootnote}>Los datos personales no se pueden modificar después del registro.</Text>
          </ScrollView>
        ) : null}

        {profileSection === 'history' ? (
          <View style={styles.profileHistoryBody}>
            {loadingClientHistory ? (
              <ActivityIndicator color="#0F766E" style={{ marginTop: 24 }} />
            ) : (
              <ScrollView contentContainerStyle={{ gap: 10, paddingBottom: 12 }}>
                {clientTripHistory.length === 0 ? (
                  <Text style={styles.profileEmptyText}>Aún no tienes viajes en tu historial.</Text>
                ) : (
                  clientTripHistory.map((trip) => (
                    <View key={trip.id} style={styles.profileTripItem}>
                      <Text style={styles.profileTripPrimary}>Viaje {trip.id.slice(-6)}</Text>
                      <Text style={styles.profileTripMeta}>Estado: {trip.status}</Text>
                      <Text style={styles.profileTripMeta}>Valor: {formatCop(trip.fare)}</Text>
                    </View>
                  ))
                )}
              </ScrollView>
            )}
          </View>
        ) : null}
      </View>
    );
  }

  return (
    <View style={styles.homeContainer}>
      {/* Campos superiores de ruteo */}
      <View style={styles.topFieldsContainer}>
        <View style={styles.topActionsRow}>
          <Text style={styles.topWelcomeText}>Hola, {session?.name ?? 'Cliente'}</Text>
          <TouchableOpacity
            style={styles.profileButton}
            onPress={() => {
              setProfileSection('menu');
              setShowProfileScreen(true);
            }}
          >
            <MaterialCommunityIcons name="account-circle" size={18} color="#0F172A" />
            <Text style={styles.profileButtonText}>Perfil</Text>
          </TouchableOpacity>
        </View>

        <View style={styles.inputRow}>
          <TouchableOpacity style={styles.inputField} onPress={() => setSearchMode('origin')}>
            <Text style={[styles.inputLabel, { color: origin ? '#1E3A8A' : '#94A3B8' }]}>¿Dónde estás?</Text>
            <Text style={styles.inputValue} numberOfLines={1}>{origin ? origin.name : 'Toca para buscar tu origen'}</Text>
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
            <Text style={styles.inputValue} numberOfLines={1}>{destination ? destination.name : 'Toca para buscar tu destino'}</Text>
          </TouchableOpacity>
        </View>
        
        {origin && destination && (
          <Text style={styles.routeMetaText}>
            {loadingRoute
              ? 'Calculando ruta...'
              : routeInfo
                ? `⏱️ ${Math.round(routeInfo.durationMin)} min · 🛣️ ${routeInfo.distanceKm.toFixed(1)} km · 💰 ${formatCop(computedFare ?? 5000)}`
                : `Línea recta · 💰 ${formatCop(computedFare ?? 5000)}`}
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
        >
          {origin && <Marker coordinate={{ latitude: origin.latitude, longitude: origin.longitude }} title={origin.name} pinColor="blue" />}
          {destination && <Marker coordinate={{ latitude: destination.latitude, longitude: destination.longitude }} title="Destino" description={destination.name} pinColor="green" />}
          {driverLiveLocation && isMatching ? (
            <Marker
              coordinate={driverLiveLocation}
              title={activeTrip?.driver?.name ?? 'Conductor'}
              description={tripStatus === 'EN_VIAJE' ? 'Viaje en curso' : 'Conductor en camino'}
              pinColor="#F97316"
            />
          ) : null}
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
        <View style={[styles.confirmTripContainer, keyboardOffset > 0 && { bottom: keyboardOffset + 12 }] }>
          {isMatching ? (
            tripStatus === 'FINALIZADO' ? (
              <View style={styles.matchingContainer}>
                <Text style={styles.matchingTitle}>Viaje finalizado</Text>
                <Text style={styles.matchingSubtitle}>
                  {activeTrip?.driver?.name ?? 'Tu conductor'} · Placa {activeTrip?.driver?.plate ?? 'N/A'}
                </Text>

                <View style={styles.starsRow}>
                  {[1, 2, 3, 4, 5].map((star) => (
                    <TouchableOpacity key={star} onPress={() => setRatingStars(star)} disabled={ratingSubmitted || submittingRating}>
                      <Text style={[styles.starButtonText, ratingStars >= star && styles.starButtonActive]}>
                        {ratingStars >= star ? '★' : '☆'}
                      </Text>
                    </TouchableOpacity>
                  ))}
                </View>

                <View style={styles.optionalMessageBox}>
                  <Text style={styles.optionalMessageTitle}>Mensaje opcional</Text>
                  <TextInput
                    value={ratingMessage}
                    onChangeText={setRatingMessage}
                    editable={!ratingSubmitted && !submittingRating}
                    placeholder="Escribe un comentario corto (opcional)"
                    placeholderTextColor="#94A3B8"
                    style={styles.optionalMessageInput}
                    multiline
                    maxLength={180}
                  />
                </View>

                <TouchableOpacity
                  style={[styles.ratingSubmitButton, (submittingRating || ratingSubmitted || ratingStars < 1) && styles.disabledButton]}
                  disabled={submittingRating || ratingSubmitted || ratingStars < 1}
                  onPress={handleSubmitRating}
                >
                  {submittingRating ? (
                    <ActivityIndicator color="#FFFFFF" />
                  ) : (
                    <Text style={styles.ratingSubmitButtonText}>{ratingSubmitted ? 'CALIFICACIÓN ENVIADA' : 'ENVIAR CALIFICACIÓN'}</Text>
                  )}
                </TouchableOpacity>

                {requestMetaMessage && <Text style={styles.requestMetaText}>{requestMetaMessage}</Text>}
                {driverError && <Text style={styles.driverErrorText}>{driverError}</Text>}
              </View>
            ) : (
              <View style={styles.matchingContainer}>
                <Text style={styles.matchingTitle}>
                  {tripStatus === 'EN_VIAJE'
                    ? 'Viaje en curso'
                    : tripStatus === 'CONDUCTOR_EN_CAMINO'
                      ? 'Conductor confirmado'
                      : 'Buscando conductor cercano...'}
                </Text>

                {tripStatus === 'PENDING' ? (
                  <ActivityIndicator size="large" color="#10B981" style={styles.matchingLoader} />
                ) : null}

                <Text style={styles.matchingSubtitle}>
                  {tripStatus === 'EN_VIAJE'
                    ? 'Sigue el recorrido en el mapa en tiempo real.'
                    : tripStatus === 'CONDUCTOR_EN_CAMINO'
                      ? 'Tu motorizado ya aceptó y se está dirigiendo al punto de recogida.'
                      : 'Estamos enviando tu solicitud a los motorizados disponibles.'}
                </Text>

                {requestMetaMessage && <Text style={styles.requestMetaText}>{requestMetaMessage}</Text>}

                {tripStatus === 'PENDING' ? (
                  <TouchableOpacity style={styles.cancelRequestButton} onPress={handleCancelRequest}>
                    <Text style={styles.cancelRequestButtonText}>Cancelar Solicitud</Text>
                  </TouchableOpacity>
                ) : null}
              </View>
            )
          ) : (
            <>
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
            </>
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
  authScreen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 24,
    paddingTop: 90,
  },
  authHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: '#DBEAFE',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    marginBottom: 12,
  },
  authHeroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#CCFBF1',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  authTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0F172A',
  },
  authSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#475569',
    fontWeight: '600',
  },
  authHint: {
    marginTop: 22,
    marginBottom: 8,
    color: '#64748B',
    textAlign: 'center',
    fontWeight: '700',
  },
  authInput: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
  },
  authPhoneInputRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  authPhonePrefixBadge: {
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  authPhonePrefixText: {
    color: '#0F172A',
    fontWeight: '800',
  },
  authPhoneInput: {
    flex: 1,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
  },
  authOtpInput: {
    marginTop: 14,
    backgroundColor: '#FFFFFF',
    borderRadius: 16,
    paddingHorizontal: 14,
    paddingVertical: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    color: '#0F172A',
    fontSize: 28,
    fontWeight: '800',
    textAlign: 'center',
    letterSpacing: 8,
  },
  authPrimaryButton: {
    marginTop: 18,
    backgroundColor: '#0F766E',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  authPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  authButtonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  authSecondaryButton: {
    marginTop: 12,
    backgroundColor: '#1E3A8A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  authSecondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  authDemoButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 11,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    backgroundColor: '#F1F5F9',
    flexDirection: 'row',
    justifyContent: 'center',
    alignItems: 'center',
    gap: 8,
  },
  authDemoButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 13,
  },
  authGhostButton: {
    marginTop: 12,
    borderRadius: 12,
    paddingVertical: 10,
    alignItems: 'center',
    borderWidth: 1,
    borderColor: '#94A3B8',
  },
  authGhostButtonDisabled: {
    opacity: 0.55,
  },
  authGhostButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  authFeedback: {
    marginTop: 12,
    textAlign: 'center',
    color: '#0F766E',
    fontWeight: '700',
  },
  bottomContainer: { marginBottom: 40 },
  button: { backgroundColor: '#10B981', paddingVertical: 16, borderRadius: 12, alignItems: 'center', elevation: 5 },
  buttonText: { color: '#FFFFFF', fontSize: 18, fontWeight: 'bold' },
  homeContainer: { flex: 1, backgroundColor: '#fff' },
  map: { width: Dimensions.get('window').width, height: Dimensions.get('window').height },
  center: { flex: 1, justifyContent: 'center', alignItems: 'center', backgroundColor: '#F8FAFC' },
  loadingText: { marginTop: 12, color: '#64748B', fontSize: 16 },
  errorText: { color: '#EF4444', fontSize: 16, padding: 20, textAlign: 'center' },
  
  topFieldsContainer: { position: 'absolute', top: 50, left: 16, right: 16, zIndex: 10, backgroundColor: '#fff', borderRadius: 20, padding: 14, elevation: 8, shadowColor: '#1E3A8A', shadowOpacity: 0.15, shadowRadius: 8 },
  topActionsRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 8 },
  topWelcomeText: { color: '#334155', fontWeight: '700', fontSize: 12 },
  profileButton: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: '#E2E8F0',
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 6,
  },
  profileButtonText: { color: '#0F172A', fontSize: 12, fontWeight: '800' },
  profileScreenRoot: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingTop: 56,
    paddingHorizontal: 16,
  },
  profileScreenHeader: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    marginBottom: 18,
  },
  profileBackButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
  },
  profileScreenTitle: {
    color: '#0F172A',
    fontSize: 22,
    fontWeight: '900',
  },
  profileMenuBody: {
    gap: 12,
  },
  profileMenuItem: {
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#E2E8F0',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileMenuText: {
    color: '#0F172A',
    fontSize: 14,
    fontWeight: '700',
  },
  profileMenuItemDanger: {
    backgroundColor: '#FEF2F2',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#FECACA',
    paddingHorizontal: 14,
    paddingVertical: 14,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 10,
  },
  profileMenuDangerText: {
    color: '#B91C1C',
    fontSize: 14,
    fontWeight: '800',
  },
  profileDetailsBody: {
    paddingBottom: 24,
  },
  profilePhotoWrap: {
    alignItems: 'center',
    marginBottom: 18,
  },
  profilePhoto: {
    width: 92,
    height: 92,
    borderRadius: 46,
    marginBottom: 10,
  },
  profilePhotoPlaceholder: {
    width: 92,
    height: 92,
    borderRadius: 46,
    backgroundColor: '#E2E8F0',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  profilePhotoCta: {
    color: '#0F766E',
    fontSize: 13,
    fontWeight: '800',
  },
  readonlyRow: {
    backgroundColor: '#FFFFFF',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
    marginBottom: 10,
  },
  readonlyLabel: {
    color: '#64748B',
    fontWeight: '700',
    fontSize: 12,
    marginBottom: 4,
  },
  readonlyValue: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 14,
  },
  readonlyFootnote: {
    marginTop: 6,
    color: '#64748B',
    fontSize: 12,
    fontWeight: '600',
    textAlign: 'center',
  },
  profileHistoryBody: {
    flex: 1,
  },
  inputRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 8 },
  inputField: { flex: 1, paddingVertical: 8, paddingHorizontal: 12, backgroundColor: '#F1F5F9', borderRadius: 10 },
  inputLabel: { fontSize: 11, fontWeight: '700', marginBottom: 2, textTransform: 'uppercase' },
  inputValue: { fontSize: 14, color: '#334155', fontWeight: '500' },
  useLocationButton: { marginLeft: 8, backgroundColor: '#10B981', borderRadius: 10, width: 40, height: 40, alignItems: 'center', justifyContent: 'center' },
  useLocationText: { fontSize: 16 },
  routeMetaText: { marginTop: 4, fontSize: 12, color: '#64748B', textAlign: 'center', fontWeight: '600' },
  
  embeddedGpsButton: { marginBottom: 12, backgroundColor: '#1E3A8A', borderRadius: 12, padding: 12, alignItems: 'center' },
  embeddedGpsText: { color: '#fff', fontWeight: 'bold', fontSize: 14 },

  profileTripItem: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 10,
  },
  profileTripPrimary: { color: '#0F172A', fontWeight: '800', fontSize: 13, marginBottom: 3 },
  profileTripMeta: { color: '#475569', fontWeight: '600', fontSize: 12 },
  profileEmptyText: { color: '#64748B', textAlign: 'center', fontWeight: '600', marginTop: 10 },

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
  ratingSubmitButton: {
    width: '100%',
    backgroundColor: '#0F766E',
    paddingVertical: 16,
    borderRadius: 16,
    alignItems: 'center',
    elevation: 4,
    shadowColor: '#0F766E',
    shadowOpacity: 0.28,
    shadowRadius: 10,
    shadowOffset: { width: 0, height: 5 },
  },
  disabledButton: { backgroundColor: '#94A3B8' },
  requestButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: 'bold', letterSpacing: 0.5 },
  ratingSubmitButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '900', letterSpacing: 0.6 },
  matchingContainer: { alignItems: 'center' },
  matchingTitle: { fontSize: 18, fontWeight: '800', color: '#1E3A8A', textAlign: 'center' },
  matchingLoader: { marginTop: 14, marginBottom: 10 },
  matchingSubtitle: { fontSize: 13, color: '#64748B', textAlign: 'center', fontWeight: '600', lineHeight: 18 },
  cancelRequestButton: { marginTop: 14, backgroundColor: '#EF4444', paddingVertical: 12, paddingHorizontal: 18, borderRadius: 12 },
  cancelRequestButtonText: { color: '#FFFFFF', fontWeight: '800', fontSize: 14 },
  starsRow: { flexDirection: 'row', gap: 8, marginTop: 12, marginBottom: 10 },
  starButtonText: { fontSize: 34, color: '#94A3B8' },
  starButtonActive: { color: '#F59E0B' },
  optionalMessageBox: {
    width: '100%',
    marginTop: 6,
    marginBottom: 12,
    borderRadius: 12,
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    padding: 10,
  },
  optionalMessageTitle: {
    fontSize: 12,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 6,
  },
  optionalMessageInput: {
    minHeight: 60,
    maxHeight: 110,
    fontSize: 13,
    color: '#0F172A',
    textAlignVertical: 'top',
  },
  requestMetaText: { marginTop: 10, fontSize: 12, color: '#0F766E', fontWeight: '700', textAlign: 'center' },
  driverErrorText: { marginTop: 10, fontSize: 12, color: '#DC2626', fontWeight: '600', textAlign: 'center' },
});