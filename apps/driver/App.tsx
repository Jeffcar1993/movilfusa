import React, { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  StyleSheet,
  Text,
  TouchableOpacity,
  Vibration,
  View,
  TextInput,
  Animated,
  Easing,
} from 'react-native';
import { SafeAreaView, SafeAreaProvider } from 'react-native-safe-area-context';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import { StatusBar } from 'expo-status-bar';
import { io, type Socket } from 'socket.io-client';
import AsyncStorage from '@react-native-async-storage/async-storage';

type ServiceType = 'pasajero' | 'encomienda';
type TripStatus = 'PENDING' | 'CONDUCTOR_EN_CAMINO' | 'EN_VIAJE' | 'FINALIZADO' | 'CANCELADO';

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
  startedAt?: string;
  finishedAt?: string;
  currentDriverLocation?: {
    latitude: number;
    longitude: number;
    updatedAt: string;
  };
}

interface DriverTripResponse {
  trip: TripRecord | null;
  message?: string;
}

type AuthProvider = 'google' | 'phone';
type DriverEntryStep = 'boot' | 'login' | 'otp' | 'profile' | 'wizard' | 'home';

interface DriverSession {
  provider: AuthProvider;
  identifier: string;
  name: string;
}

interface DriverRegistrationProfile {
  name: string;
  phone?: string;
  motorcycleModel: string;
  plate: string;
  documentId: string;
  licenseNumber: string;
  profilePhotoUrl?: string;
  registrationComplete: boolean;
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

const DRIVER_SESSION_KEY = 'movilfusa:driver:session';
const DRIVER_PROFILE_PREFIX = 'movilfusa:driver:profile:';

const formatCop = (value: number) => `$${value.toLocaleString('es-CO')}`;

export default function App() {
  const [entryStep, setEntryStep] = useState<DriverEntryStep>('boot');
  const [session, setSession] = useState<DriverSession | null>(null);
  const [authProvider, setAuthProvider] = useState<AuthProvider | null>(null);
  const [phoneNumber, setPhoneNumber] = useState('');
  const [otpCode, setOtpCode] = useState('');
  const [otpSecondsLeft, setOtpSecondsLeft] = useState(0);
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const [profileName, setProfileName] = useState('');
  const [wizardStep, setWizardStep] = useState(0);
  const [registration, setRegistration] = useState<DriverRegistrationProfile>({
    name: '',
    motorcycleModel: '',
    plate: '',
    documentId: '',
    licenseNumber: '',
    profilePhotoUrl: '',
    registrationComplete: false,
  });
  const splashOpacity = useRef(new Animated.Value(0)).current;
  const splashScale = useRef(new Animated.Value(0.95)).current;
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
    let isMounted = true;

    const bootstrap = async () => {
      let sessionRaw: string | null = null;

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
        sessionRaw = await AsyncStorage.getItem(DRIVER_SESSION_KEY);
      } catch {
        sessionRaw = null;
      }

      setTimeout(() => {
        if (!isMounted) {
          return;
        }

        if (!sessionRaw) {
          setEntryStep('login');
          return;
        }

        try {
          const parsedSession = JSON.parse(sessionRaw) as DriverSession;
          setSession(parsedSession);
          setEntryStep('home');
        } catch {
          setEntryStep('login');
        }
      }, 850);
    };

    bootstrap();

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

  const resolveIdentifier = (provider: AuthProvider): string => {
    if (provider === 'google') {
      return 'google-demo-driver';
    }

    return phoneNumber.replace(/\D/g, '');
  };

  const openHomeWithSession = async (provider: AuthProvider, identifier: string, name: string) => {
    const nextSession: DriverSession = { provider, identifier, name };

    try {
      await AsyncStorage.setItem(DRIVER_SESSION_KEY, JSON.stringify(nextSession));
    } catch {
      // Allow access even if local persistence fails in current session.
    }

    setSession(nextSession);
    setEntryStep('home');
    setAuthFeedback(null);
  };

  const moveToDriverProfile = (provider: AuthProvider) => {
    setAuthProvider(provider);
    setProfileName('');
    setEntryStep('profile');
  };

  const handleStartGoogleAuth = async () => {
    const provider: AuthProvider = 'google';
    const identifier = resolveIdentifier(provider);
    const profileRaw = await AsyncStorage.getItem(`${DRIVER_PROFILE_PREFIX}${identifier}`);

    if (profileRaw) {
      try {
        const profile = JSON.parse(profileRaw) as DriverRegistrationProfile;
        setRegistration(profile);
        if (profile.registrationComplete) {
          await openHomeWithSession(provider, identifier, profile.name);
          return;
        }
      } catch {
        // Continue to profile creation.
      }
    }

    moveToDriverProfile(provider);
  };

  const handleStartPhoneAuth = () => {
    if (phoneNumber.replace(/\D/g, '').length < 10) {
      setAuthFeedback('Ingresa un número válido para conductor.');
      return;
    }

    setAuthProvider('phone');
    setOtpCode('');
    setOtpSecondsLeft(35);
    setAuthFeedback('Código OTP enviado al conductor.');
    setEntryStep('otp');
  };

  const handleVerifyOtp = async () => {
    if (otpCode.length !== 6 || authProvider !== 'phone') {
      setAuthFeedback('El código debe tener 6 dígitos.');
      return;
    }

    const identifier = resolveIdentifier('phone');
    const profileRaw = await AsyncStorage.getItem(`${DRIVER_PROFILE_PREFIX}${identifier}`);

    if (profileRaw) {
      try {
        const profile = JSON.parse(profileRaw) as DriverRegistrationProfile;
        setRegistration(profile);
        if (profile.registrationComplete) {
          await openHomeWithSession('phone', identifier, profile.name);
          return;
        }
      } catch {
        // Continue with profile + wizard.
      }
    }

    moveToDriverProfile('phone');
    setAuthFeedback('Código validado. Completa tu perfil de conductor.');
  };

  const handleSaveDriverProfile = () => {
    const trimmedName = profileName.trim();
    if (!trimmedName || !authProvider) {
      setAuthFeedback('Escribe tu nombre para continuar.');
      return;
    }

    setRegistration((current) => ({
      ...current,
      name: trimmedName,
      phone: authProvider === 'phone' ? phoneNumber.replace(/\D/g, '') : current.phone,
    }));
    setWizardStep(0);
    setEntryStep('wizard');
  };

  const handleResendOtp = () => {
    if (otpSecondsLeft > 0) {
      return;
    }

    setOtpSecondsLeft(35);
    setAuthFeedback('Código reenviado.');
  };

  const handleFinishDriverRegistration = async () => {
    if (!authProvider) {
      return;
    }

    const identifier = resolveIdentifier(authProvider);
    const completedProfile: DriverRegistrationProfile = {
      ...registration,
      registrationComplete: true,
    };

    if (!completedProfile.name || !completedProfile.motorcycleModel || !completedProfile.plate) {
      setAuthFeedback('Completa los campos obligatorios del conductor.');
      return;
    }

    await AsyncStorage.setItem(`${DRIVER_PROFILE_PREFIX}${identifier}`, JSON.stringify(completedProfile));
    await openHomeWithSession(authProvider, identifier, completedProfile.name);
  };

  const handleQuickDriverDemoAccess = async () => {
    const provider: AuthProvider = 'google';
    const identifier = 'demo-driver-local';
    const profile: DriverRegistrationProfile = {
      name: 'Jhon Alex Motorizado',
      phone: '3000000000',
      motorcycleModel: 'AKT NKD 125',
      plate: 'FUS 219',
      documentId: '123456789',
      licenseNumber: 'LIC-0001',
      profilePhotoUrl: '',
      registrationComplete: true,
    };

    try {
      await AsyncStorage.setItem(`${DRIVER_PROFILE_PREFIX}${identifier}`, JSON.stringify(profile));
    } catch {
      // Continue with transient demo access.
    }

    await openHomeWithSession(provider, identifier, profile.name);
  };

  useEffect(() => {
    if (entryStep !== 'home') {
      return;
    }

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
  }, [entryStep]);

  useEffect(() => {
    if (entryStep !== 'home') {
      return;
    }

    const socket = io(API_BASE_URL, {
      transports: ['websocket'],
    });

    const subscribeDriverQueue = () => {
      socket.emit('driver:subscribe');
    };

    const handleDriverTrip = (payload: DriverTripResponse) => {
      if (!payload.trip) {
        setIncomingTrip((currentTrip) =>
          currentTrip && (currentTrip.status === 'CONDUCTOR_EN_CAMINO' || currentTrip.status === 'EN_VIAJE')
            ? currentTrip
            : null,
        );
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
  }, [entryStep]);

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

  const handleTripAction = async (action: 'start' | 'finish') => {
    if (!incomingTrip || acceptingTrip) {
      return;
    }

    setAcceptingTrip(true);

    try {
      const response = await fetch(`${API_BASE_URL}/api/driver/trips/${incomingTrip.id}/${action}`, {
        method: 'POST',
      });

      const data = (await response.json()) as DriverTripResponse;

      if (!response.ok || !data.trip) {
        throw new Error(data.message ?? 'No fue posible actualizar el viaje.');
      }

      if (action === 'finish') {
        setIncomingTrip(null);
        setIsTripCardCollapsed(false);
        setAcceptanceMessage(null);
      } else {
        setIncomingTrip(data.trip);
        setAcceptanceMessage('Viaje iniciado. Compartiendo ubicación en tiempo real.');
      }
    } catch {
      setAcceptanceMessage('No se pudo actualizar el estado del viaje. Intenta de nuevo.');
    } finally {
      setAcceptingTrip(false);
    }
  };

  const handleStartTrip = async () => {
    await handleTripAction('start');
  };

  const handleFinishTrip = async () => {
    await handleTripAction('finish');
  };

  useEffect(() => {
    if (entryStep !== 'home' || !incomingTrip || incomingTrip.status !== 'EN_VIAJE') {
      return;
    }

    let isCancelled = false;

    const sendLocationUpdate = async () => {
      try {
        const currentLocation = await Location.getCurrentPositionAsync({});

        if (isCancelled) {
          return;
        }

        setDriverLocation({
          latitude: currentLocation.coords.latitude,
          longitude: currentLocation.coords.longitude,
          latitudeDelta: 0.018,
          longitudeDelta: 0.018,
        });

        await fetch(`${API_BASE_URL}/api/driver/trips/${incomingTrip.id}/location`, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            latitude: currentLocation.coords.latitude,
            longitude: currentLocation.coords.longitude,
          }),
        });
      } catch {
        // Keep ride active even if a location push fails.
      }
    };

    sendLocationUpdate();
    const interval = setInterval(sendLocationUpdate, 4000);

    return () => {
      isCancelled = true;
      clearInterval(interval);
    };
  }, [entryStep, incomingTrip?.id, incomingTrip?.status]);

  if (entryStep === 'boot') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.screen}>
          <Animated.View style={[styles.driverBootContainer, { opacity: splashOpacity, transform: [{ scale: splashScale }] }]}>
            <Text style={styles.kicker}>MovilFusa Driver</Text>
            <Text style={styles.title}>Conduce con confianza</Text>
          </Animated.View>
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (entryStep === 'login') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.driverAuthScreen}>
          <View style={styles.driverHeroCard}>
            <View style={styles.driverHeroIconWrap}>
              <MaterialCommunityIcons name="motorbike" size={34} color="#EA580C" />
            </View>
            <Text style={styles.driverAuthTitle}>Ingreso Conductor</Text>
            <Text style={styles.driverAuthSubtitle}>Accede con Google o número de teléfono.</Text>
          </View>

          <TouchableOpacity style={styles.driverAuthPrimaryButton} onPress={handleStartGoogleAuth}>
            <View style={styles.driverAuthButtonContentRow}>
              <MaterialCommunityIcons name="google" size={20} color="#FFFFFF" />
              <Text style={styles.driverAuthPrimaryButtonText}>Continuar con Google</Text>
            </View>
          </TouchableOpacity>

          <Text style={styles.driverAuthHint}>o continúa con número</Text>

          <View style={styles.driverPhoneInputRow}>
            <View style={styles.driverPhonePrefixBadge}>
              <Text style={styles.driverPhonePrefixText}>+57</Text>
            </View>
            <TextInput
              value={phoneNumber}
              onChangeText={setPhoneNumber}
              placeholder="3001234567"
              placeholderTextColor="#94A3B8"
              keyboardType="phone-pad"
              style={styles.driverPhoneInput}
            />
          </View>

          <TouchableOpacity style={styles.driverAuthSecondaryButton} onPress={handleStartPhoneAuth}>
            <View style={styles.driverAuthButtonContentRow}>
              <MaterialCommunityIcons name="cellphone-message" size={19} color="#FFFFFF" />
              <Text style={styles.driverAuthSecondaryButtonText}>Continuar con número de teléfono</Text>
            </View>
          </TouchableOpacity>

          <TouchableOpacity style={styles.driverDemoButton} onPress={handleQuickDriverDemoAccess}>
            <MaterialCommunityIcons name="flash" size={18} color="#0F172A" />
            <Text style={styles.driverDemoButtonText}>Entrar rápido para pruebas</Text>
          </TouchableOpacity>

          {authFeedback ? <Text style={styles.driverAuthFeedback}>{authFeedback}</Text> : null}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (entryStep === 'otp') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.driverAuthScreen}>
          <Text style={styles.driverAuthTitle}>Código OTP</Text>
          <Text style={styles.driverAuthSubtitle}>Ingresa el código de 6 dígitos para validar tu cuenta.</Text>

          <TextInput
            value={otpCode}
            onChangeText={(value) => setOtpCode(value.replace(/\D/g, '').slice(0, 6))}
            placeholder="123456"
            placeholderTextColor="#94A3B8"
            keyboardType="number-pad"
            maxLength={6}
            autoComplete="sms-otp"
            textContentType="oneTimeCode"
            style={styles.driverAuthOtpInput}
          />

          <TouchableOpacity style={styles.driverAuthPrimaryButton} onPress={handleVerifyOtp}>
            <Text style={styles.driverAuthPrimaryButtonText}>Verificar código</Text>
          </TouchableOpacity>

          <TouchableOpacity style={styles.driverDemoButton} onPress={() => setOtpCode('123456')}>
            <MaterialCommunityIcons name="numeric-6-circle" size={18} color="#0F172A" />
            <Text style={styles.driverDemoButtonText}>Usar OTP demo 123456</Text>
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.driverAuthGhostButton, otpSecondsLeft > 0 && styles.driverAuthGhostButtonDisabled]}
            onPress={handleResendOtp}
            disabled={otpSecondsLeft > 0}
          >
            <Text style={styles.driverAuthGhostButtonText}>
              {otpSecondsLeft > 0 ? `Reenviar en ${otpSecondsLeft}s` : 'Reenviar código'}
            </Text>
          </TouchableOpacity>

          {authFeedback ? <Text style={styles.driverAuthFeedback}>{authFeedback}</Text> : null}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (entryStep === 'profile') {
    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.driverAuthScreen}>
          <Text style={styles.driverAuthTitle}>Perfil básico</Text>
          <Text style={styles.driverAuthSubtitle}>Este paso se hace una sola vez.</Text>

          <TextInput
            value={profileName}
            onChangeText={setProfileName}
            placeholder="Nombre completo"
            placeholderTextColor="#94A3B8"
            style={styles.driverAuthInput}
          />

          <TouchableOpacity style={styles.driverAuthPrimaryButton} onPress={handleSaveDriverProfile}>
            <Text style={styles.driverAuthPrimaryButtonText}>Continuar al registro</Text>
          </TouchableOpacity>

          {authFeedback ? <Text style={styles.driverAuthFeedback}>{authFeedback}</Text> : null}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  if (entryStep === 'wizard') {
    const totalSteps = 4;
    const progress = ((wizardStep + 1) / totalSteps) * 100;

    return (
      <SafeAreaProvider>
        <SafeAreaView style={styles.driverAuthScreen}>
          <Text style={styles.driverAuthTitle}>Registro conductor</Text>
          <Text style={styles.driverAuthSubtitle}>Paso {wizardStep + 1} de {totalSteps}</Text>

          <View style={styles.wizardProgressTrack}>
            <View style={[styles.wizardProgressFill, { width: `${progress}%` }]} />
          </View>

          {wizardStep === 0 ? (
            <View style={styles.wizardStepBlock}>
              <Text style={styles.wizardStepTitle}>Datos personales</Text>
              <TextInput
                value={registration.name}
                onChangeText={(value) => setRegistration((current) => ({ ...current, name: value }))}
                placeholder="Nombre completo"
                placeholderTextColor="#94A3B8"
                style={styles.driverAuthInput}
              />
            </View>
          ) : null}

          {wizardStep === 1 ? (
            <View style={styles.wizardStepBlock}>
              <Text style={styles.wizardStepTitle}>Moto y placa</Text>
              <TextInput
                value={registration.motorcycleModel}
                onChangeText={(value) => setRegistration((current) => ({ ...current, motorcycleModel: value }))}
                placeholder="Modelo de moto"
                placeholderTextColor="#94A3B8"
                style={styles.driverAuthInput}
              />
              <TextInput
                value={registration.plate}
                onChangeText={(value) => setRegistration((current) => ({ ...current, plate: value.toUpperCase() }))}
                placeholder="Placa"
                placeholderTextColor="#94A3B8"
                style={styles.driverAuthInput}
              />
            </View>
          ) : null}

          {wizardStep === 2 ? (
            <View style={styles.wizardStepBlock}>
              <Text style={styles.wizardStepTitle}>Verificación mínima</Text>
              <TextInput
                value={registration.documentId}
                onChangeText={(value) => setRegistration((current) => ({ ...current, documentId: value }))}
                placeholder="Documento"
                placeholderTextColor="#94A3B8"
                style={styles.driverAuthInput}
              />
              <TextInput
                value={registration.licenseNumber}
                onChangeText={(value) => setRegistration((current) => ({ ...current, licenseNumber: value }))}
                placeholder="Licencia"
                placeholderTextColor="#94A3B8"
                style={styles.driverAuthInput}
              />
            </View>
          ) : null}

          {wizardStep === 3 ? (
            <View style={styles.wizardStepBlock}>
              <Text style={styles.wizardStepTitle}>Foto opcional</Text>
              <TextInput
                value={registration.profilePhotoUrl ?? ''}
                onChangeText={(value) => setRegistration((current) => ({ ...current, profilePhotoUrl: value }))}
                placeholder="URL de foto (opcional)"
                placeholderTextColor="#94A3B8"
                style={styles.driverAuthInput}
              />
            </View>
          ) : null}

          <View style={styles.wizardActionsRow}>
            <TouchableOpacity
              style={[styles.driverAuthGhostButton, wizardStep === 0 && styles.driverAuthGhostButtonDisabled]}
              disabled={wizardStep === 0}
              onPress={() => setWizardStep((current) => Math.max(0, current - 1))}
            >
              <Text style={styles.driverAuthGhostButtonText}>Atrás</Text>
            </TouchableOpacity>

            {wizardStep < 3 ? (
              <TouchableOpacity
                style={styles.driverAuthPrimaryButton}
                onPress={() => setWizardStep((current) => Math.min(3, current + 1))}
              >
                <Text style={styles.driverAuthPrimaryButtonText}>Siguiente</Text>
              </TouchableOpacity>
            ) : (
              <TouchableOpacity style={styles.driverAuthPrimaryButton} onPress={handleFinishDriverRegistration}>
                <Text style={styles.driverAuthPrimaryButtonText}>Finalizar registro</Text>
              </TouchableOpacity>
            )}
          </View>

          {authFeedback ? <Text style={styles.driverAuthFeedback}>{authFeedback}</Text> : null}
        </SafeAreaView>
      </SafeAreaProvider>
    );
  }

  const serviceLabel = incomingTrip?.serviceType === 'encomienda' ? 'Encomienda' : 'Pasajero';
  const serviceIcon = incomingTrip?.serviceType === 'encomienda' ? 'package-variant-closed' : 'motorbike';
  const driverStatusLabel =
    incomingTrip?.status === 'CONDUCTOR_EN_CAMINO'
      ? 'Viaje aceptado'
      : incomingTrip?.status === 'EN_VIAJE'
        ? 'En viaje'
        : incomingTrip?.status === 'FINALIZADO'
          ? 'Viaje finalizado'
          : incomingTrip
            ? 'Viaje entrante'
            : 'Disponible';
  const driverStatusDotStyle =
    incomingTrip?.status === 'CONDUCTOR_EN_CAMINO' || incomingTrip?.status === 'EN_VIAJE'
      ? styles.statusAccepted
      : incomingTrip
        ? styles.statusBusy
        : styles.statusAvailable;

  const actionButtonLabel =
    incomingTrip?.status === 'PENDING'
      ? 'ACEPTAR VIAJE'
      : incomingTrip?.status === 'CONDUCTOR_EN_CAMINO'
        ? 'INICIAR VIAJE'
        : incomingTrip?.status === 'EN_VIAJE'
          ? 'FINALIZAR VIAJE'
          : 'VIAJE FINALIZADO';

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

            {incomingTrip && incomingTrip.status !== 'EN_VIAJE' ? (
              <Marker
                coordinate={{ latitude: incomingTrip.origin.latitude, longitude: incomingTrip.origin.longitude }}
                title="Recogida"
                description={incomingTrip.origin.name}
                pinColor="#0F766E"
              />
            ) : null}

            {incomingTrip ? (
              <Marker
                coordinate={{ latitude: incomingTrip.destination.latitude, longitude: incomingTrip.destination.longitude }}
                title="Destino"
                description={incomingTrip.destination.name}
                pinColor="#2563EB"
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
                <Text style={styles.alertBadgeText}>
                  {incomingTrip.status === 'CONDUCTOR_EN_CAMINO'
                    ? 'Viaje aceptado'
                    : incomingTrip.status === 'EN_VIAJE'
                      ? 'En curso'
                      : incomingTrip.status === 'FINALIZADO'
                        ? 'Finalizado'
                        : 'Viaje entrante'}
                </Text>
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
                  onPress={
                    incomingTrip.status === 'PENDING'
                      ? handleAcceptTrip
                      : incomingTrip.status === 'CONDUCTOR_EN_CAMINO'
                        ? handleStartTrip
                        : handleFinishTrip
                  }
                  disabled={acceptingTrip || incomingTrip.status === 'FINALIZADO'}
                  activeOpacity={0.9}
                >
                  {acceptingTrip ? (
                    <ActivityIndicator color="#FFF7ED" />
                  ) : (
                    <Text style={styles.acceptButtonText}>{actionButtonLabel}</Text>
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
  driverBootContainer: {
    flex: 1,
    alignItems: 'center',
    justifyContent: 'center',
    paddingHorizontal: 24,
  },
  driverAuthScreen: {
    flex: 1,
    backgroundColor: '#F8FAFC',
    paddingHorizontal: 24,
    paddingTop: 80,
  },
  driverHeroCard: {
    backgroundColor: '#FFFFFF',
    borderRadius: 20,
    paddingHorizontal: 18,
    paddingVertical: 20,
    borderWidth: 1,
    borderColor: '#FED7AA',
    shadowColor: '#0F172A',
    shadowOpacity: 0.12,
    shadowRadius: 12,
    shadowOffset: { width: 0, height: 6 },
    elevation: 4,
    marginBottom: 12,
  },
  driverHeroIconWrap: {
    width: 52,
    height: 52,
    borderRadius: 26,
    backgroundColor: '#FFEDD5',
    alignItems: 'center',
    justifyContent: 'center',
    marginBottom: 10,
  },
  driverAuthTitle: {
    fontSize: 30,
    fontWeight: '900',
    color: '#0F172A',
  },
  driverAuthSubtitle: {
    marginTop: 8,
    fontSize: 14,
    color: '#475569',
    fontWeight: '600',
  },
  driverAuthHint: {
    marginTop: 20,
    marginBottom: 8,
    textAlign: 'center',
    color: '#64748B',
    fontWeight: '700',
  },
  driverAuthInput: {
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
  driverPhoneInputRow: {
    marginTop: 10,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  driverPhonePrefixBadge: {
    backgroundColor: '#E2E8F0',
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  driverPhonePrefixText: {
    color: '#0F172A',
    fontWeight: '800',
  },
  driverPhoneInput: {
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
  driverAuthOtpInput: {
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
  driverAuthPrimaryButton: {
    marginTop: 16,
    backgroundColor: '#EA580C',
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 14,
    alignItems: 'center',
  },
  driverAuthPrimaryButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '800',
  },
  driverAuthButtonContentRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
  },
  driverAuthSecondaryButton: {
    marginTop: 12,
    backgroundColor: '#0F172A',
    borderRadius: 14,
    paddingVertical: 14,
    alignItems: 'center',
  },
  driverAuthSecondaryButtonText: {
    color: '#FFFFFF',
    fontSize: 14,
    fontWeight: '800',
  },
  driverDemoButton: {
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
  driverDemoButtonText: {
    color: '#0F172A',
    fontWeight: '800',
    fontSize: 13,
  },
  driverAuthGhostButton: {
    marginTop: 10,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderWidth: 1,
    borderColor: '#94A3B8',
    alignItems: 'center',
  },
  driverAuthGhostButtonDisabled: {
    opacity: 0.5,
  },
  driverAuthGhostButtonText: {
    color: '#334155',
    fontWeight: '700',
  },
  driverAuthFeedback: {
    marginTop: 12,
    textAlign: 'center',
    color: '#0F766E',
    fontWeight: '700',
  },
  wizardProgressTrack: {
    marginTop: 14,
    height: 8,
    borderRadius: 999,
    backgroundColor: '#E2E8F0',
    overflow: 'hidden',
  },
  wizardProgressFill: {
    height: '100%',
    backgroundColor: '#EA580C',
  },
  wizardStepBlock: {
    marginTop: 16,
  },
  wizardStepTitle: {
    color: '#1E293B',
    fontSize: 14,
    fontWeight: '800',
    marginBottom: 6,
  },
  wizardActionsRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    gap: 12,
    marginTop: 12,
  },
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
