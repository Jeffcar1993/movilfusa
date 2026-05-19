import React, { useState, useEffect } from 'react';
import { StyleSheet, Text, View, TouchableOpacity, ActivityIndicator, Dimensions } from 'react-native';
import MapView, { Marker, PROVIDER_GOOGLE } from 'react-native-maps';
import * as Location from 'expo-location';

export default function App() {
  // Estado para saber en qué pantalla estamos: 'welcome' o 'home'
  const [currentScreen, setCurrentScreen] = useState<'welcome' | 'home'>('welcome');
  
  // Estados para la geolocalización
  const [location, setLocation] = useState<Location.LocationObject | null>(null);
  const [errorMsg, setErrorMsg] = useState<string | null>(null);
  const [loadingGps, setLoadingGps] = useState(false);

  // Función para solicitar permisos y obtener coordenadas cuando el usuario avanza
  const handleGetStarted = async () => {
    setLoadingGps(true);
    try {
      let { status } = await Location.requestForegroundPermissionsAsync();
      if (status !== 'granted') {
        setErrorMsg('Permiso de ubicación denegado. Por favor actívalo en los ajustes.');
        setLoadingGps(false);
        setCurrentScreen('home'); // Avanza igual, pero mostrará el error en el mapa
        return;
      }

      let currentLocation = await Location.getCurrentPositionAsync({});
      setLocation(currentLocation);
      setCurrentScreen('home');
    } catch (error) {
      setErrorMsg('Error al obtener la ubicación actual.');
      setCurrentScreen('home');
    } finally {
      setLoadingGps(false);
    }
  };

  // --- RENDER DE PANTALLA 1: BIENVENIDA ---
  if (currentScreen === 'welcome') {
    return (
      <View style={styles.welcomeContainer}>
        <View style={styles.brandContainer}>
          <Text style={styles.title}>MovilFusa</Text>
          <Text style={styles.subtitle}>Tu transporte y mensajería de confianza</Text>
        </View>

        <View style={styles.bottomContainer}>
          <TouchableOpacity 
            style={styles.button} 
            onPress={handleGetStarted}
            disabled={loadingGps}
          >
            {loadingGps ? (
              <ActivityIndicator color="#FFFFFF" />
            ) : (
              <Text style={styles.buttonText}>Ingresar con el celular</Text>
            )}
          </TouchableOpacity>
        </View>
      </View>
    );
  }

  // --- RENDER DE PANTALLA 2: MAPA PRINCIPAL ---
  return (
    <View style={styles.homeContainer}>
      {errorMsg ? (
        <View style={styles.center}>
          <Text style={styles.errorText}>{errorMsg}</Text>
        </View>
      ) : location ? (
        <MapView
          provider={PROVIDER_GOOGLE} 
          style={styles.map}
          initialRegion={{
            latitude: location.coords.latitude,
            longitude: location.coords.longitude,
            latitudeDelta: 0.00922,
            longitudeDelta: 0.0421,
          }}
          showsUserLocation={true}
        >
          <Marker
            coordinate={{
              latitude: location.coords.latitude,
              longitude: location.coords.longitude,
            }}
            title="Tu ubicación"
            description="Estás aquí listo para pedir viaje"
          />
        </MapView>
      ) : (
        <View style={styles.center}>
          <ActivityIndicator size="large" color="#1E3A8A" />
          <Text style={styles.loadingText}>Sincronizando ubicación...</Text>
        </View>
      )}

      {/* Barra de búsqueda inferior (Caja flotante estilo Picap/Uber) */}
      <View style={styles.searchBarContainer}>
        <Text style={styles.searchText}>¿A dónde vamos hoy?</Text>
      </View>
    </View>
  );
}

// --- ESTILOS VISUALES ---
const styles = StyleSheet.create({
  // Estilos de Bienvenida
  welcomeContainer: {
    flex: 1,
    backgroundColor: '#1E3A8A', // Azul institucional
    justifyContent: 'space-between',
    padding: 24,
  },
  brandContainer: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
  },
  title: {
    fontSize: 42,
    fontWeight: 'bold',
    color: '#FFFFFF',
    letterSpacing: 1,
  },
  subtitle: {
    fontSize: 16,
    color: '#E2E8F0',
    marginTop: 10,
    textAlign: 'center',
  },
  bottomContainer: {
    marginBottom: 40,
  },
  button: {
    backgroundColor: '#10B981', // Verde llamativo
    paddingVertical: 16,
    borderRadius: 12,
    alignItems: 'center',
    elevation: 5,
  },
  buttonText: {
    color: '#FFFFFF',
    fontSize: 18,
    fontWeight: 'bold',
  },
  
  // Estilos del Home / Mapa
  homeContainer: {
    flex: 1,
    backgroundColor: '#fff',
  },
  map: {
    width: Dimensions.get('window').width,
    height: Dimensions.get('window').height,
  },
  center: {
    flex: 1,
    justifyContent: 'center',
    alignItems: 'center',
    backgroundColor: '#F8FAFC',
  },
  loadingText: {
    marginTop: 12,
    color: '#64748B',
    fontSize: 16,
  },
  errorText: {
    color: '#EF4444',
    fontSize: 16,
    padding: 20,
    textAlign: 'center',
  },
  searchBarContainer: {
    position: 'absolute',
    bottom: 40,
    left: 20,
    right: 20,
    backgroundColor: '#FFFFFF',
    padding: 18,
    borderRadius: 16,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 10 },
    shadowOpacity: 0.15,
    shadowRadius: 10,
    elevation: 8,
  },
  searchText: {
    fontSize: 16,
    fontWeight: '600',
    color: '#334155',
  },
});