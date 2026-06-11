import React, { useCallback, useEffect, useRef, useState } from 'react';
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
import * as WebBrowser from 'expo-web-browser';
import * as Linking from 'expo-linking';
import { io, type Socket } from 'socket.io-client';
import type { User } from '@supabase/supabase-js';
import AsyncStorage from '@react-native-async-storage/async-storage';
import { MaterialCommunityIcons } from '@expo/vector-icons';
import AddressSearch from './src/components/AddressSearch';
import { supabase } from './src/lib/supabase';

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
  createdAt?: string;
  driver?: DriverProfile;
  origin?: {
    latitude: number;
    longitude: number;
    name: string;
  };
  destination?: {
    latitude: number;
    longitude: number;
    name: string;
  };
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

type AuthProvider = 'google' | 'email';
type ClientEntryStep = 'boot' | 'login' | 'profile' | 'home';

interface ClientSession {
  provider: AuthProvider;
  identifier: string;
  name: string;
  email?: string;
}

interface ClientRegistrationProfile {
  name: string;
  phone?: string;
  email?: string;
  provider: AuthProvider;
  identifier: string;
  profilePhotoUrl?: string;
  registrationComplete: boolean;
  createdAt?: string;
  updatedAt?: string;
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
const REGISTER_PASSWORD_REQUIREMENTS_MESSAGE =
  'La contraseña debe tener mínimo 8 caracteres e incluir mayúscula, minúscula, número y carácter especial.';
const REGISTER_PASSWORD_POLICY_REGEX = /^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[^A-Za-z0-9]).{8,}$/;
const formatDateTime = (value?: string) => {
  if (!value) {
    return 'Sin fecha';
  }

  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    return 'Sin fecha';
  }

  return parsed.toLocaleString('es-CO', {
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
  });
};
const CLIENT_SESSION_KEY = 'movilfusa:client:session';
const CLIENT_PROFILE_PREFIX = 'movilfusa:client:profile:';
const CLIENT_AVATAR_BUCKET = 'client-avatars';
const getClientProfileKey = (identifier: string) => `${CLIENT_PROFILE_PREFIX}${identifier}`;
const OAUTH_REDIRECT_URI = Linking.createURL('/');

WebBrowser.maybeCompleteAuthSession();

const extractAuthParams = (url: string): Record<string, string> => {
  const [base, hash = ''] = url.split('#');
  const query = base.includes('?') ? (base.split('?')[1] ?? '') : '';
  const merged = [query, hash].filter(Boolean).join('&');

  if (!merged) {
    return {};
  }

  const params = new URLSearchParams(merged);
  const result: Record<string, string> = {};

  for (const [key, value] of params.entries()) {
    result[key] = value;
  }

  return result;
};

const resolveGoogleDisplayName = (user: User): string => {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const metadataName =
    typeof meta.full_name === 'string'
      ? meta.full_name
      : typeof meta.name === 'string'
        ? meta.name
        : typeof meta.user_name === 'string'
          ? meta.user_name
          : '';

  const fromEmail = typeof user.email === 'string' ? user.email.split('@')[0] ?? '' : '';
  const resolved = metadataName.trim() || fromEmail.trim() || 'Cliente';
  return resolved;
};

const resolveAuthProviderFromUser = (user: User): AuthProvider => {
  const appMeta = (user.app_metadata ?? {}) as Record<string, unknown>;
  const provider = typeof appMeta.provider === 'string' ? appMeta.provider : '';
  const providers = Array.isArray(appMeta.providers) ? appMeta.providers : [];

  if (provider === 'email' || providers.includes('email')) {
    return 'email';
  }

  return 'google';
};

const getFileExtensionFromUri = (uri: string): string => {
  const withoutQuery = uri.split('?')[0] ?? '';
  const rawExtension = withoutQuery.includes('.') ? withoutQuery.split('.').pop() ?? '' : '';
  const normalized = rawExtension.toLowerCase();

  if (normalized === 'jpeg' || normalized === 'jpg') {
    return 'jpg';
  }

  if (normalized === 'png' || normalized === 'webp') {
    return normalized;
  }

  return 'jpg';
};

const getPublicAvatarPathFromUrl = (url?: string): string | null => {
  if (!url) {
    return null;
  }

  const marker = `/storage/v1/object/public/${CLIENT_AVATAR_BUCKET}/`;
  const markerIndex = url.indexOf(marker);

  if (markerIndex === -1) {
    return null;
  }

  const encodedPath = url.slice(markerIndex + marker.length).split('?')[0] ?? '';
  if (!encodedPath) {
    return null;
  }

  try {
    return decodeURIComponent(encodedPath);
  } catch {
    return encodedPath;
  }
};

export default function App() {
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [refreshingLocation, setRefreshingLocation] = useState(false);
  const [locationAccuracyMeters, setLocationAccuracyMeters] = useState<number | null>(null);
  const [entryStep, setEntryStep] = useState<ClientEntryStep>('boot');
  const [session, setSession] = useState<ClientSession | null>(null);
  const [authProvider, setAuthProvider] = useState<AuthProvider | null>(null);
  const [profileName, setProfileName] = useState('');
  const [authFeedback, setAuthFeedback] = useState<string | null>(null);
  const [profileSaveNotice, setProfileSaveNotice] = useState<string | null>(null);
  const profileSaveNoticeTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [googleAuthLoading, setGoogleAuthLoading] = useState(false);
  const [emailAuthLoading, setEmailAuthLoading] = useState(false);
  const [emailAuthMode, setEmailAuthMode] = useState<'register' | 'login'>('register');
  const [savingProfileChanges, setSavingProfileChanges] = useState(false);
  const [emailValue, setEmailValue] = useState('');
  const [passwordValue, setPasswordValue] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [profileEmail, setProfileEmail] = useState('');
  const [profilePhone, setProfilePhone] = useState('');
  const googleAuthLoadingRef = useRef(false);
  const splashOpacity = useRef(new Animated.Value(0)).current;
  const splashScale = useRef(new Animated.Value(0.95)).current;
  const splashTranslateY = useRef(new Animated.Value(14)).current;
  const splashPulse = useRef(new Animated.Value(1)).current;
  
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
  const [uploadingProfilePhoto, setUploadingProfilePhoto] = useState(false);
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

  const showProfileSaveNotice = (message: string) => {
    setProfileSaveNotice(message);

    if (profileSaveNoticeTimeoutRef.current) {
      clearTimeout(profileSaveNoticeTimeoutRef.current);
    }

    profileSaveNoticeTimeoutRef.current = setTimeout(() => {
      setProfileSaveNotice(null);
      profileSaveNoticeTimeoutRef.current = null;
    }, 2600);
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

  useEffect(() => {
    if (entryStep === 'profile' || (showProfileScreen && profileSection === 'details')) {
      setProfileName(clientProfile?.name ?? session?.name ?? '');
      setProfileEmail(clientProfile?.email ?? session?.email ?? '');
      setProfilePhone(clientProfile?.phone ?? '');
    }
  }, [clientProfile, entryStep, profileSection, session, showProfileScreen]);

  useEffect(() => {
    return () => {
      if (profileSaveNoticeTimeoutRef.current) {
        clearTimeout(profileSaveNoticeTimeoutRef.current);
      }
    };
  }, []);

  const syncClientSessionFromSupabaseUser = async (user: User, providerOverride?: AuthProvider) => {
    setGoogleAuthLoading(false);
    googleAuthLoadingRef.current = false;
    setEmailAuthLoading(false);
    const provider = providerOverride ?? resolveAuthProviderFromUser(user);
    const resolvedName = resolveGoogleDisplayName(user);
    const metadata = (user.user_metadata ?? {}) as Record<string, unknown>;
    const avatarUrl = typeof metadata.avatar_url === 'string' ? metadata.avatar_url : '';

    const { error: upsertError } = await supabase.from('profiles').upsert(
      {
        id: user.id,
        role: 'client',
        name: resolvedName,
        avatar_url: avatarUrl || null,
      },
      { onConflict: 'id' },
    );

    if (upsertError) {
      throw upsertError;
    }

    const { data: profileRow, error: profileError } = await supabase
      .from('profiles')
      .select('id, name, phone, avatar_url, created_at, updated_at')
      .eq('id', user.id)
      .maybeSingle();

    if (profileError) {
      throw profileError;
    }

    const profileNameFromDb = typeof profileRow?.name === 'string' && profileRow.name.trim().length > 0
      ? profileRow.name.trim()
      : resolvedName;

    const nextSession: ClientSession = {
      provider,
      identifier: user.id,
      name: profileNameFromDb,
      email: typeof user.email === 'string' ? user.email : undefined,
    };

    try {
      await AsyncStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(nextSession));
    } catch {
      // Keep in-memory session even if local cache fails.
    }

    await saveClientProfile({
      name: profileNameFromDb,
      provider,
      identifier: user.id,
      email: typeof user.email === 'string' ? user.email : undefined,
      phone: typeof profileRow?.phone === 'string' ? profileRow.phone : undefined,
      profilePhotoUrl:
        typeof profileRow?.avatar_url === 'string' && profileRow.avatar_url.trim().length > 0
          ? profileRow.avatar_url
          : avatarUrl,
      registrationComplete: true,
      createdAt: typeof profileRow?.created_at === 'string' ? profileRow.created_at : undefined,
      updatedAt: typeof profileRow?.updated_at === 'string' ? profileRow.updated_at : undefined,
    });

    setSession(nextSession);
    setAuthProvider(provider);
    setProfileName(profileNameFromDb);
    setProfileEmail(typeof user.email === 'string' ? user.email : '');
    setProfilePhone(typeof profileRow?.phone === 'string' ? profileRow.phone : '');
    setAuthFeedback(null);
    setEntryStep('home');
  };

  const performLogout = async () => {
    try {
      await supabase.auth.signOut();
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

  const handleLogout = () => {
    Alert.alert(
      'Cerrar sesión',
      '¿Realmente quieres cerrar sesión?',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Cerrar sesión',
          style: 'destructive',
          onPress: () => {
            void performLogout();
          },
        },
      ],
    );
  };

  const handleDeleteAccount = () => {
    if (!session) {
      return;
    }

    Alert.alert(
      'Eliminar perfil',
      '¿Realmente quieres eliminar tu perfil? Esta acción es permanente y cerrará tu sesión.',
      [
        { text: 'Cancelar', style: 'cancel' },
        {
          text: 'Eliminar perfil',
          style: 'destructive',
          onPress: async () => {
            try {
              const response = await fetch(`${API_BASE_URL}/api/client/account/${session.identifier}`, {
                method: 'DELETE',
              });

              const payload = (await response.json().catch(() => null)) as { message?: string; details?: string } | null;

              if (!response.ok) {
                Alert.alert(
                  'No se pudo eliminar la cuenta',
                  payload?.details ?? payload?.message ?? 'Intenta de nuevo en unos minutos.',
                );
                return;
              }
            } catch {
              Alert.alert('Sin conexión', 'No se pudo eliminar la cuenta en el servidor.');
              return;
            }

            try {
              await supabase.auth.signOut();
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
    if (uploadingProfilePhoto) {
      return;
    }

    setUploadingProfilePhoto(true);
    const previousIdentifier = session?.identifier?.trim() ?? '';
    const { data: authUserData } = await supabase.auth.getUser();
    const identifier = authUserData.user?.id?.trim() || previousIdentifier;

    if (!identifier) {
      setAuthFeedback('No fue posible resolver tu usuario para subir la foto. Inicia sesión nuevamente.');
      setUploadingProfilePhoto(false);
      return;
    }

    try {
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

      const selectedAsset = result.assets[0];
      const fileExtension = getFileExtensionFromUri(selectedAsset.uri);
      const contentType = selectedAsset.mimeType || `image/${fileExtension === 'jpg' ? 'jpeg' : fileExtension}`;
      const storagePath = `${identifier}/avatar-${Date.now()}.${fileExtension}`;

      const response = await fetch(selectedAsset.uri);
      const fileArrayBuffer = await response.arrayBuffer();

      const { error: uploadError } = await supabase.storage
        .from(CLIENT_AVATAR_BUCKET)
        .upload(storagePath, fileArrayBuffer, {
          contentType,
          cacheControl: '3600',
          upsert: true,
        });

      if (uploadError) {
        throw uploadError;
      }

      const { data: publicUrlData } = supabase.storage
        .from(CLIENT_AVATAR_BUCKET)
        .getPublicUrl(storagePath);

      const uploadedPhotoUrl = publicUrlData.publicUrl;
      const previousPhotoPath = getPublicAvatarPathFromUrl(clientProfile?.profilePhotoUrl);

      const updatedProfile: ClientRegistrationProfile = {
        name: clientProfile?.name ?? session?.name ?? (profileName.trim() || 'Cliente'),
        provider: clientProfile?.provider ?? session?.provider ?? 'email',
        identifier,
        email: clientProfile?.email ?? session?.email,
        phone: clientProfile?.phone,
        profilePhotoUrl: uploadedPhotoUrl,
        registrationComplete: true,
      };

      const { data: profileUpsertRow, error: profileUpsertError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: identifier,
            role: 'client',
            name: updatedProfile.name,
            avatar_url: uploadedPhotoUrl,
          },
          { onConflict: 'id' },
        )
        .select('id, name, phone, avatar_url, created_at, updated_at')
        .single();

      if (profileUpsertError) {
        throw profileUpsertError;
      }

      await saveClientProfile({
        name: updatedProfile.name,
        provider: updatedProfile.provider,
        identifier,
        email: updatedProfile.email,
        phone: typeof profileUpsertRow?.phone === 'string' ? profileUpsertRow.phone : updatedProfile.phone,
        profilePhotoUrl:
          typeof profileUpsertRow?.avatar_url === 'string' && profileUpsertRow.avatar_url.trim().length > 0
            ? profileUpsertRow.avatar_url
            : uploadedPhotoUrl,
        registrationComplete: true,
        createdAt: typeof profileUpsertRow?.created_at === 'string' ? profileUpsertRow.created_at : undefined,
        updatedAt: typeof profileUpsertRow?.updated_at === 'string' ? profileUpsertRow.updated_at : undefined,
      });

      const { error: metadataError } = await supabase.auth.updateUser({
        data: {
          name: updatedProfile.name,
          avatar_url: uploadedPhotoUrl,
        },
      });

      if (metadataError) {
        throw metadataError;
      }

      if (previousPhotoPath && previousPhotoPath !== storagePath) {
        void supabase.storage.from(CLIENT_AVATAR_BUCKET).remove([previousPhotoPath]);
      }

      if (previousIdentifier && previousIdentifier !== identifier) {
        void AsyncStorage.removeItem(getClientProfileKey(previousIdentifier));
      }

      showProfileSaveNotice('Cambios guardados. Foto de perfil actualizada.');
      setAuthFeedback('Foto de perfil subida y sincronizada en Supabase.');
    } catch {
      setAuthFeedback('No fue posible subir la foto a Supabase. Intenta de nuevo.');
    } finally {
      setUploadingProfilePhoto(false);
    }
  };

  const persistEditableProfile = async (options?: { navigateHome?: boolean }) => {
    const trimmedName = profileName.trim();
    const normalizedEmail = profileEmail.trim().toLowerCase();
    const sanitizedPhone = profilePhone.replace(/[^\d+]/g, '').trim();
    const previousIdentifier = session?.identifier?.trim() ?? '';

    const { data: currentUserData } = await supabase.auth.getUser();
    const identifier = currentUserData.user?.id?.trim() || previousIdentifier;

    if (!identifier) {
      setAuthFeedback('No fue posible resolver tu cuenta. Inicia sesión de nuevo.');
      return;
    }

    if (!trimmedName) {
      setAuthFeedback('Escribe tu nombre completo para continuar.');
      return;
    }

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setAuthFeedback('Ingresa un correo válido.');
      return;
    }

    setSavingProfileChanges(true);

    try {
      const currentEmail = currentUserData.user?.email?.trim().toLowerCase() ?? session?.email?.trim().toLowerCase() ?? '';
      const avatarUrl = clientProfile?.profilePhotoUrl?.trim() || null;

      if (normalizedEmail !== currentEmail) {
        const { error: updateEmailError } = await supabase.auth.updateUser({
          email: normalizedEmail,
          data: {
            name: trimmedName,
            avatar_url: avatarUrl,
          },
        });

        if (updateEmailError) {
          throw updateEmailError;
        }
      } else {
        const { error: updateMetadataError } = await supabase.auth.updateUser({
          data: {
            name: trimmedName,
            avatar_url: avatarUrl,
          },
        });

        if (updateMetadataError) {
          throw updateMetadataError;
        }
      }

      const { data: profileUpsertRow, error: profileUpsertError } = await supabase
        .from('profiles')
        .upsert(
          {
            id: identifier,
            role: 'client',
            name: trimmedName,
            phone: sanitizedPhone || null,
            avatar_url: avatarUrl,
          },
          { onConflict: 'id' },
        )
        .select('id, name, phone, avatar_url, created_at, updated_at')
        .single();

      if (profileUpsertError) {
        throw profileUpsertError;
      }

      const nextSession: ClientSession = {
        provider: authProvider ?? session?.provider ?? 'email',
        identifier,
        name: trimmedName,
        email: normalizedEmail,
      };

      try {
        await AsyncStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(nextSession));
      } catch {
        // Keep in-memory session even if local cache fails.
      }

      await saveClientProfile({
        name: trimmedName,
        provider: authProvider ?? session?.provider ?? 'email',
        identifier,
        email: normalizedEmail,
        phone: typeof profileUpsertRow?.phone === 'string' ? profileUpsertRow.phone : sanitizedPhone || undefined,
        profilePhotoUrl:
          typeof profileUpsertRow?.avatar_url === 'string' && profileUpsertRow.avatar_url.trim().length > 0
            ? profileUpsertRow.avatar_url
            : avatarUrl ?? undefined,
        registrationComplete: true,
        createdAt: typeof profileUpsertRow?.created_at === 'string' ? profileUpsertRow.created_at : undefined,
        updatedAt: typeof profileUpsertRow?.updated_at === 'string' ? profileUpsertRow.updated_at : undefined,
      });

      if (previousIdentifier && previousIdentifier !== identifier) {
        void AsyncStorage.removeItem(getClientProfileKey(previousIdentifier));
      }

      setSession(nextSession);
      showProfileSaveNotice('Cambios guardados.');
      setAuthFeedback(
        normalizedEmail !== currentEmail
          ? 'Perfil actualizado. Si Supabase exige confirmación de correo, revisa tu email.'
          : 'Perfil actualizado correctamente.'
      );

      if (options?.navigateHome) {
        setEntryStep('home');
      }
    } catch {
      setAuthFeedback('No fue posible guardar tu perfil. Revisa los datos e inténtalo de nuevo.');
    } finally {
      setSavingProfileChanges(false);
    }
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

  const readMostAccurateLocation = useCallback(async (): Promise<Location.LocationObject | null> => {
    let bestLocation: Location.LocationObject | null = null;

    const keepBest = (candidate: Location.LocationObject | null) => {
      if (!candidate) {
        return;
      }

      const candidateAccuracy = candidate.coords.accuracy ?? Number.POSITIVE_INFINITY;
      const bestAccuracy = bestLocation?.coords.accuracy ?? Number.POSITIVE_INFINITY;

      if (!bestLocation || candidateAccuracy < bestAccuracy) {
        bestLocation = candidate;
      }
    };

    try {
      const cached = await Location.getLastKnownPositionAsync({
        maxAge: 15000,
        requiredAccuracy: 80,
      });
      keepBest(cached);
    } catch {
      // Ignore cache lookup errors and continue with fresh GPS reads.
    }

    for (let attempt = 0; attempt < 3; attempt += 1) {
      try {
        const current = await Location.getCurrentPositionAsync({
          accuracy: Location.Accuracy.BestForNavigation,
          mayShowUserSettingsDialog: true,
        });

        keepBest(current);

        if ((current.coords.accuracy ?? Number.POSITIVE_INFINITY) <= 20) {
          break;
        }
      } catch {
        // Retry to get a better fix.
      }
    }

    return bestLocation;
  }, []);

  const refreshCurrentLocation = useCallback(
    async (options?: { setAsOrigin?: boolean; silent?: boolean }) => {
      const setAsOrigin = options?.setAsOrigin ?? false;
      const silent = options?.silent ?? false;

      if (!silent) {
        setLoadingGps(true);
      }

      setRefreshingLocation(true);

      try {
        const existingPermission = await Location.getForegroundPermissionsAsync();
        let status = existingPermission.status;

        if (status !== 'granted') {
          const requestedPermission = await Location.requestForegroundPermissionsAsync();
          status = requestedPermission.status;
        }

        if (status !== 'granted') {
          setErrorMsg('Permiso de ubicacion denegado.');
          return;
        }

        const nextLocation = await readMostAccurateLocation();
        if (!nextLocation) {
          setErrorMsg('No fue posible obtener una ubicacion precisa.');
          return;
        }

        setLocation(nextLocation);
        setLocationAccuracyMeters(nextLocation.coords.accuracy ?? null);
        setErrorMsg(null);

        setOrigin((previousOrigin) => {
          if (!setAsOrigin && previousOrigin?.name !== 'Mi ubicación actual') {
            return previousOrigin;
          }

          return {
            latitude: nextLocation.coords.latitude,
            longitude: nextLocation.coords.longitude,
            name: 'Mi ubicación actual',
            fare: previousOrigin?.fare,
          };
        });
      } catch {
        setErrorMsg('Error al obtener la ubicación.');
      } finally {
        if (!silent) {
          setLoadingGps(false);
        }
        setRefreshingLocation(false);
      }
    },
    [readMostAccurateLocation],
  );

  useEffect(() => {
    let isMounted = true;
    let entranceAnimation: Animated.CompositeAnimation | null = null;
    let pulseAnimation: Animated.CompositeAnimation | null = null;

    const bootstrapSession = async () => {
      let initialUser: User | null = null;

      entranceAnimation = Animated.parallel([
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
        Animated.timing(splashTranslateY, {
          toValue: 0,
          duration: 620,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]);

      pulseAnimation = Animated.loop(
        Animated.sequence([
          Animated.timing(splashPulse, {
            toValue: 1.02,
            duration: 850,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
          Animated.timing(splashPulse, {
            toValue: 1,
            duration: 850,
            easing: Easing.inOut(Easing.quad),
            useNativeDriver: true,
          }),
        ]),
      );

      entranceAnimation.start(() => {
        pulseAnimation?.start();
      });

      try {
        const { data, error } = await supabase.auth.getSession();
        if (!error) {
          initialUser = data.session?.user ?? null;
        }
      } catch {
        initialUser = null;
      }

      setTimeout(() => {
        if (!isMounted) {
          return;
        }

        if (!initialUser) {
          setEntryStep('login');
          return;
        }

        void syncClientSessionFromSupabaseUser(initialUser).catch(() => {
          setAuthFeedback('No fue posible restaurar tu sesión de Google.');
          setEntryStep('login');
        });
      }, 1500);
    };

    bootstrapSession();

    return () => {
      isMounted = false;
      entranceAnimation?.stop();
      pulseAnimation?.stop();
    };
  }, [splashOpacity, splashScale, splashTranslateY, splashPulse]);

  useEffect(() => {
    if (entryStep !== 'home' || location) {
      return;
    }

    void refreshCurrentLocation();
  }, [entryStep, location, refreshCurrentLocation]);

  useEffect(() => {
    if (entryStep !== 'home') {
      return;
    }

    let isMounted = true;
    let subscription: Location.LocationSubscription | null = null;

    const startLocationWatch = async () => {
      try {
        const permission = await Location.getForegroundPermissionsAsync();
        if (permission.status !== 'granted') {
          return;
        }

        subscription = await Location.watchPositionAsync(
          {
            accuracy: Location.Accuracy.High,
            distanceInterval: 10,
            timeInterval: 5000,
            mayShowUserSettingsDialog: true,
          },
          (nextLocation) => {
            if (!isMounted) {
              return;
            }

            const nextAccuracy = nextLocation.coords.accuracy ?? Number.POSITIVE_INFINITY;

            if (nextAccuracy > 60) {
              return;
            }

            const currentAccuracy = location?.coords.accuracy ?? Number.POSITIVE_INFINITY;
            const movedEnough = !location
              || Math.abs(nextLocation.coords.latitude - location.coords.latitude) > 0.00005
              || Math.abs(nextLocation.coords.longitude - location.coords.longitude) > 0.00005;
            const meaningfullyMoreAccurate = nextAccuracy + 8 < currentAccuracy;

            if (!movedEnough && !meaningfullyMoreAccurate) {
              return;
            }

            setLocation(nextLocation);
            setLocationAccuracyMeters(nextLocation.coords.accuracy ?? null);

            setOrigin((previousOrigin) => {
              if (previousOrigin?.name !== 'Mi ubicación actual') {
                return previousOrigin;
              }

              return {
                ...previousOrigin,
                latitude: nextLocation.coords.latitude,
                longitude: nextLocation.coords.longitude,
              };
            });
          },
        );
      } catch {
        // Live tracking is optional; fallback is the current GPS fix.
      }
    };

    void startLocationWatch();

    return () => {
      isMounted = false;
      subscription?.remove();
    };
  }, [entryStep, location]);

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

  // Handle incoming deep-link URL (from OAuth redirect or Linking.openURL)
  const handleIncomingUrl = async (url: string) => {
    if (!url) return;

    const params = extractAuthParams(url);

    if (typeof params.code === 'string' && params.code.length > 0) {
      try {
        const { error } = await supabase.auth.exchangeCodeForSession(params.code);
        if (error) throw error;
      } catch {
        setAuthFeedback('No fue posible completar el inicio con Google.');
        setGoogleAuthLoading(false);
        googleAuthLoadingRef.current = false;
      }
      return;
    }

    if (
      typeof params.access_token === 'string' &&
      typeof params.refresh_token === 'string' &&
      params.access_token.length > 0 &&
      params.refresh_token.length > 0
    ) {
      try {
        const { error } = await supabase.auth.setSession({
          access_token: params.access_token,
          refresh_token: params.refresh_token,
        });
        if (error) throw error;
      } catch {
        setAuthFeedback('No fue posible completar el inicio con Google.');
        setGoogleAuthLoading(false);
        googleAuthLoadingRef.current = false;
      }
    }
  };

  useEffect(() => {
    // Primary: listen to Supabase auth state changes.
    // This fires regardless of how the session arrives (redirect, URL listener, etc.)
    const { data: { subscription } } = supabase.auth.onAuthStateChange((event, authSession) => {
      if ((event === 'SIGNED_IN' || event === 'TOKEN_REFRESHED') && authSession?.user) {
        if (googleAuthLoadingRef.current || entryStep === 'boot') {
          void syncClientSessionFromSupabaseUser(authSession.user).catch(() => {
            setAuthFeedback('No fue posible cargar tu perfil de Google.');
            setGoogleAuthLoading(false);
            googleAuthLoadingRef.current = false;
          });
        }
      }
    });

    // Secondary: catch the redirect URL when Expo Go doesn't intercept it via openAuthSessionAsync
    const urlSubscription = Linking.addEventListener('url', ({ url }) => {
      void handleIncomingUrl(url);
    });

    return () => {
      subscription.unsubscribe();
      urlSubscription.remove();
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [entryStep]);

  const handleStartGoogleAuth = async () => {
    if (googleAuthLoading) {
      return;
    }

    setGoogleAuthLoading(true);
    googleAuthLoadingRef.current = true;
    setAuthProvider('google');
    setAuthFeedback(null);

    // DEBUG: show the exact redirect URI so the user knows what to add in Supabase
    console.log('[OAuth] OAUTH_REDIRECT_URI =>', OAUTH_REDIRECT_URI);

    try {
      const { data, error } = await supabase.auth.signInWithOAuth({
        provider: 'google',
        options: {
          redirectTo: OAUTH_REDIRECT_URI,
          skipBrowserRedirect: true,
        },
      });

      if (error || !data?.url) {
        throw error ?? new Error('No fue posible iniciar sesión con Google.');
      }

      // Open the system browser and let Supabase redirect back into the app.
      // The app listens for the deep link and the Supabase auth state change.
      await WebBrowser.openBrowserAsync(data.url);

      // Prevent infinite loading when Expo Go does not complete redirect callbacks.
      setTimeout(() => {
        if (googleAuthLoadingRef.current) {
          setGoogleAuthLoading(false);
          googleAuthLoadingRef.current = false;
          setAuthFeedback('No se pudo completar Google en Expo Go. Usa Crear cuenta con correo.');
        }
      }, 12000);
    } catch {
      setAuthFeedback('No fue posible iniciar con Google. Revisa la configuración de OAuth en Supabase.');
      setGoogleAuthLoading(false);
      googleAuthLoadingRef.current = false;
    }
  };

  const handleEmailAuth = async () => {
    const normalizedEmail = emailValue.trim().toLowerCase();
    const password = passwordValue;
    const baseName = normalizedEmail.split('@')[0] ?? 'Cliente';

    if (!normalizedEmail || !normalizedEmail.includes('@')) {
      setAuthFeedback('Ingresa un correo válido.');
      return;
    }

    if (emailAuthMode === 'register' && !REGISTER_PASSWORD_POLICY_REGEX.test(password)) {
      setAuthFeedback(REGISTER_PASSWORD_REQUIREMENTS_MESSAGE);
      return;
    }

    setAuthFeedback(null);
    setAuthProvider('email');
    setEmailAuthLoading(true);
    googleAuthLoadingRef.current = false;

    try {
      if (emailAuthMode === 'login') {
        const { data, error } = await supabase.auth.signInWithPassword({
          email: normalizedEmail,
          password,
        });

        if (error || !data.user) {
          throw error ?? new Error('No fue posible iniciar sesión. Verifica correo y contraseña.');
        }

        await syncClientSessionFromSupabaseUser(data.user, 'email');
        return;
      }

      const registerResponse = await fetch(`${API_BASE_URL}/api/client/auth/register`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          email: normalizedEmail,
          password,
          name: baseName,
        }),
      });

      const registerPayload = (await registerResponse.json().catch(() => null)) as { message?: string } | null;

      if (!registerResponse.ok) {
        throw new Error(registerPayload?.message ?? 'No fue posible crear la cuenta.');
      }

      const { data, error } = await supabase.auth.signInWithPassword({
        email: normalizedEmail,
        password,
      });

      if (error || !data.user) {
        throw error ?? new Error('No fue posible iniciar sesión con la cuenta creada.');
      }

      const nextSession: ClientSession = {
        provider: 'email',
        identifier: data.user.id,
        name: baseName,
        email: normalizedEmail,
      };

      try {
        await AsyncStorage.setItem(CLIENT_SESSION_KEY, JSON.stringify(nextSession));
      } catch {
        // Allow navigation even if local cache fails.
      }

      setSession(nextSession);
      setAuthProvider('email');
      setProfileName(baseName);
      setProfileEmail(normalizedEmail);
      setProfilePhone('');
      setEmailAuthLoading(false);
      googleAuthLoadingRef.current = false;
      setAuthFeedback('Cuenta creada. Completa tus datos para finalizar.');
      setEntryStep('profile');
    } catch (error) {
      const message =
        error instanceof Error
          ? error.message
          : emailAuthMode === 'login'
            ? 'No fue posible iniciar sesión. Verifica correo y contraseña.'
            : 'No fue posible crear tu cuenta. Verifica correo y contraseña.';
      setAuthFeedback(message);
      setEmailAuthLoading(false);
      googleAuthLoadingRef.current = false;
    }
  };

  const handleSaveProfile = async () => {
    if (!authProvider) {
      setAuthFeedback('Escribe tu nombre para continuar.');
      return;
    }

    await persistEditableProfile({ navigateHome: true });
  };

  const loadClientHistory = async () => {
    let clientIdentifier = session?.identifier ?? '';

    if (!clientIdentifier) {
      const { data } = await supabase.auth.getUser();
      clientIdentifier = data.user?.id ?? '';
    }

    if (!clientIdentifier) {
      setClientTripHistory([]);
      setAuthFeedback('Debes iniciar sesión para ver tu historial.');
      return;
    }

    setLoadingClientHistory(true);
    try {
      const response = await fetch(`${API_BASE_URL}/api/client/trips/${clientIdentifier}`);
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
      const { data: authUserData } = await supabase.auth.getUser();
      const clientIdentifier = authUserData.user?.id?.trim() || session?.identifier?.trim() || '';

      if (!clientIdentifier) {
        setDriverError('Debes iniciar sesión para solicitar un viaje.');
        setIsMatching(false);
        setRequestingDriver(false);
        return;
      }

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
          client: {
            id: clientIdentifier,
            name: session?.name ?? clientProfile?.name ?? 'Cliente',
          },
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
        <View style={styles.brandContainer}>
          <Animated.Image
            source={require('./src/img/logo.png')}
            resizeMode="contain"
            style={[
              styles.splashLogo,
              {
                opacity: splashOpacity,
                transform: [
                  { translateY: splashTranslateY },
                  { scale: Animated.multiply(splashScale, splashPulse) },
                ],
              },
            ]}
          />
        </View>
      </View>
    );
  }

  if (entryStep === 'login') {
    const isAuthBusy = googleAuthLoading || emailAuthLoading;

    return (
      <View style={styles.authScreen}>
        <View style={styles.authHeroCard}>
          <View style={styles.authHeroIconWrap}>
            <MaterialCommunityIcons name="map-marker-radius" size={34} color="#0F766E" />
          </View>
          <Text style={styles.authTitle}>Bienvenido Cliente</Text>
          <Text style={styles.authSubtitle}>
            {emailAuthMode === 'register'
              ? 'Primero crea tu cuenta con correo y luego podrás iniciar sesión.'
              : 'Inicia sesión con el correo que ya registraste.'}
          </Text>
        </View>

        <TextInput
          value={emailValue}
          onChangeText={setEmailValue}
          placeholder="correo@ejemplo.com"
          placeholderTextColor="#94A3B8"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          editable={!isAuthBusy}
          style={styles.authInput}
        />

        <View style={styles.authPasswordRow}>
          <TextInput
            value={passwordValue}
            onChangeText={setPasswordValue}
            placeholder="Contraseña"
            placeholderTextColor="#94A3B8"
            secureTextEntry={!showPassword}
            editable={!isAuthBusy}
            style={styles.authPasswordInput}
          />
          <TouchableOpacity
            onPress={() => setShowPassword((prev) => !prev)}
            disabled={isAuthBusy}
            style={styles.passwordToggleButton}
            accessibilityRole="button"
            accessibilityLabel={showPassword ? 'Ocultar contraseña' : 'Mostrar contraseña'}
          >
            <MaterialCommunityIcons
              name={showPassword ? 'eye-off-outline' : 'eye-outline'}
              size={22}
              color="#475569"
            />
          </TouchableOpacity>
        </View>

        <TouchableOpacity
          style={[styles.authSecondaryButton, emailAuthLoading && styles.disabledButton]}
          onPress={handleEmailAuth}
          disabled={isAuthBusy}
        >
          <Text style={styles.authSecondaryButtonText}>
            {emailAuthLoading
              ? (emailAuthMode === 'register' ? 'Creando cuenta...' : 'Ingresando...')
              : (emailAuthMode === 'register' ? 'Crear cuenta con correo' : 'Ingresar con correo')}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.authGhostButton, isAuthBusy && styles.authGhostButtonDisabled]}
          onPress={() => {
            setEmailAuthMode((prev) => (prev === 'register' ? 'login' : 'register'));
            setAuthFeedback(null);
          }}
          disabled={isAuthBusy}
        >
          <Text style={styles.authGhostButtonText}>
            {emailAuthMode === 'register'
              ? 'Ya tengo cuenta, quiero iniciar sesión'
              : 'No tengo cuenta, quiero crearla'}
          </Text>
        </TouchableOpacity>

        <TouchableOpacity
          style={[styles.authPrimaryButton, googleAuthLoading && styles.disabledButton]}
          onPress={handleStartGoogleAuth}
          disabled={isAuthBusy}
        >
          <View style={styles.authButtonContentRow}>
            <MaterialCommunityIcons name="google" size={20} color="#FFFFFF" />
            <Text style={styles.authPrimaryButtonText}>
              {googleAuthLoading ? 'Conectando con Google...' : 'Continuar con Google'}
            </Text>
          </View>
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
          placeholder="Tu nombre completo"
          placeholderTextColor="#94A3B8"
          style={styles.authInput}
        />

        <TextInput
          value={profileEmail}
          onChangeText={setProfileEmail}
          placeholder="correo@ejemplo.com"
          placeholderTextColor="#94A3B8"
          keyboardType="email-address"
          autoCapitalize="none"
          autoCorrect={false}
          style={styles.authInput}
        />

        <TextInput
          value={profilePhone}
          onChangeText={setProfilePhone}
          placeholder="Teléfono"
          placeholderTextColor="#94A3B8"
          keyboardType="phone-pad"
          style={styles.authInput}
        />

        <TouchableOpacity
          style={[styles.authPrimaryButton, savingProfileChanges && styles.disabledButton]}
          onPress={handleSaveProfile}
          disabled={savingProfileChanges}
        >
          <Text style={styles.authPrimaryButtonText}>
            {savingProfileChanges ? 'Guardando...' : 'Guardar y continuar'}
          </Text>
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
            <TouchableOpacity
              style={[styles.profilePhotoWrap, uploadingProfilePhoto && styles.disabledButton]}
              onPress={() => void handlePickProfilePhoto()}
              disabled={uploadingProfilePhoto}
            >
              {clientProfile?.profilePhotoUrl ? (
                <Image source={{ uri: clientProfile.profilePhotoUrl }} style={styles.profilePhoto} />
              ) : (
                <View style={styles.profilePhotoPlaceholder}>
                  <MaterialCommunityIcons name="account" size={34} color="#334155" />
                </View>
              )}
              <Text style={styles.profilePhotoCta}>
                {uploadingProfilePhoto ? 'Subiendo foto...' : 'Subir o cambiar foto'}
              </Text>
            </TouchableOpacity>

            <View style={styles.profileFieldBlock}>
              <Text style={styles.readonlyLabel}>Nombre completo</Text>
              <TextInput
                value={profileName}
                onChangeText={setProfileName}
                placeholder="Tu nombre completo"
                placeholderTextColor="#94A3B8"
                style={styles.authInput}
              />
            </View>
            <View style={styles.profileFieldBlock}>
              <Text style={styles.readonlyLabel}>Correo</Text>
              <TextInput
                value={profileEmail}
                onChangeText={setProfileEmail}
                placeholder="correo@ejemplo.com"
                placeholderTextColor="#94A3B8"
                keyboardType="email-address"
                autoCapitalize="none"
                autoCorrect={false}
                style={styles.authInput}
              />
            </View>
            <View style={styles.profileFieldBlock}>
              <Text style={styles.readonlyLabel}>Teléfono</Text>
              <TextInput
                value={profilePhone}
                onChangeText={setProfilePhone}
                placeholder="Teléfono"
                placeholderTextColor="#94A3B8"
                keyboardType="phone-pad"
                style={styles.authInput}
              />
            </View>
            <View style={styles.readonlyRow}>
              <Text style={styles.readonlyLabel}>Proveedor</Text>
              <Text style={styles.readonlyValue}>
                {clientProfile?.provider === 'email' ? 'Correo' : 'Google'}
              </Text>
            </View>
            <View style={styles.readonlyRow}>
              <Text style={styles.readonlyLabel}>Última actualización</Text>
              <Text style={styles.readonlyValue}>
                {clientProfile?.updatedAt
                  ? formatDateTime(clientProfile.updatedAt)
                  : clientProfile?.createdAt
                    ? formatDateTime(clientProfile.createdAt)
                    : 'Sin actualizaciones registradas'}
              </Text>
            </View>
            {profileSaveNotice ? <Text style={styles.profileSaveNotice}>{profileSaveNotice}</Text> : null}
            <TouchableOpacity
              style={[styles.authPrimaryButton, savingProfileChanges && styles.disabledButton]}
              onPress={() => void persistEditableProfile()}
              disabled={savingProfileChanges}
            >
              <Text style={styles.authPrimaryButtonText}>
                {savingProfileChanges ? 'Guardando...' : 'Guardar cambios'}
              </Text>
            </TouchableOpacity>

            <Text style={styles.readonlyFootnote}>
              La foto se conserva para esta cuenta en tu app actual, pero hoy no está subida a Supabase Storage; para persistirla entre dispositivos falta ese paso.
            </Text>
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
                      <Text style={styles.profileTripMeta}>Fecha: {formatDateTime(trip.finishedAt ?? trip.createdAt)}</Text>
                      <Text style={styles.profileTripMeta}>Origen: {trip.origin?.name ?? 'Sin dato'}</Text>
                      <Text style={styles.profileTripMeta}>Destino: {trip.destination?.name ?? 'Sin dato'}</Text>
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
              void refreshCurrentLocation({ setAsOrigin: true });
            }}
          >
            <Text style={styles.useLocationText}>{refreshingLocation ? '...' : '📍'}</Text>
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

        {origin?.name === 'Mi ubicación actual' && locationAccuracyMeters != null ? (
          <Text style={styles.gpsAccuracyText}>
            Precision GPS aprox.: {Math.round(locationAccuracyMeters)} m
          </Text>
        ) : null}
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
              <View style={styles.serviceTypeRow}>
                <TouchableOpacity
                  style={styles.serviceTypeToggleButton}
                  onPress={() => setSearchMode('destination')}
                >
                  <MaterialCommunityIcons name="arrow-left" size={16} color="#1E3A8A" />
                </TouchableOpacity>

                <View style={styles.serviceTypeBadge}>
                  <Text style={styles.serviceTypeBadgeText}>
                    {destination.serviceType === 'encomienda' ? 'Servicio: Encomienda' : 'Servicio: Viaje en moto'}
                  </Text>
                </View>
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
  welcomeContainer: { flex: 1, backgroundColor: '#071633', justifyContent: 'center', padding: 24 },
  brandContainer: { flex: 1, justifyContent: 'center', alignItems: 'center' },
  splashLogo: {
    width: '100%',
    maxWidth: 360,
    height: 360,
  },
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
  authPasswordRow: {
    marginTop: 10,
    backgroundColor: '#FFFFFF',
    borderRadius: 14,
    borderWidth: 1,
    borderColor: '#CBD5E1',
    flexDirection: 'row',
    alignItems: 'center',
    paddingRight: 8,
  },
  authPasswordInput: {
    flex: 1,
    color: '#0F172A',
    fontSize: 16,
    fontWeight: '600',
    paddingVertical: 12,
    paddingHorizontal: 14,
  },
  passwordToggleButton: {
    width: 38,
    height: 38,
    alignItems: 'center',
    justifyContent: 'center',
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
  redirectUriBox: {
    marginTop: 16,
    marginBottom: 4,
    backgroundColor: '#F1F5F9',
    borderRadius: 10,
    padding: 12,
    borderWidth: 1,
    borderColor: '#CBD5E1',
  },
  redirectUriLabel: {
    fontSize: 11,
    color: '#64748B',
    marginBottom: 6,
    fontWeight: '600',
  },
  redirectUriValue: {
    fontSize: 11,
    color: '#0F766E',
    fontFamily: 'monospace',
    fontWeight: '700',
    flexWrap: 'wrap',
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
  profileFieldBlock: {
    marginBottom: 10,
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
  gpsAccuracyText: { marginTop: 6, fontSize: 12, color: '#0F766E', textAlign: 'center', fontWeight: '700' },
  
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
  profileSaveNotice: {
    marginBottom: 10,
    textAlign: 'center',
    color: '#0F766E',
    fontWeight: '800',
    backgroundColor: '#DCFCE7',
    borderWidth: 1,
    borderColor: '#86EFAC',
    borderRadius: 10,
    paddingVertical: 8,
    paddingHorizontal: 10,
  },

  confirmTripContainer: { position: 'absolute', left: 16, right: 16, bottom: 30, backgroundColor: '#FFFFFF', borderRadius: 24, padding: 20, elevation: 12, shadowColor: '#000', shadowOffset: { width: 0, height: -4 }, shadowOpacity: 0.15, shadowRadius: 10, zIndex: 30 },
  serviceTypeRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    marginBottom: 10,
  },
  serviceTypeToggleButton: {
    width: 30,
    height: 30,
    borderRadius: 15,
    borderWidth: 1,
    borderColor: '#BFDBFE',
    backgroundColor: '#EFF6FF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  serviceTypeBadge: { alignSelf: 'flex-start', backgroundColor: '#FEF3C7', borderRadius: 999, paddingHorizontal: 12, paddingVertical: 6 },
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