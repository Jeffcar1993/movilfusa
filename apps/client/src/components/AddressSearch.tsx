import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList } from 'react-native';

type Place = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  zone: string;
  fare: number;
};

// Data oficial calibrada con la tabla de precios de Fusagasugá
const FUSA_PLACES: Place[] = [
  // --- Urbano e Intermedio ($5.000 - $7.000) ---
  { id: '1', name: 'Centro Comercial Manila', address: 'Cra. 10 # 21-39, Perímetro Urbano', latitude: 4.3364, longitude: -74.3638, zone: 'urbano', fare: 5000 },
  { id: '2', name: 'Parque Principal (Plaza de Bolívar)', address: 'Calle 7 con Carrera 6, Centro', latitude: 4.3462, longitude: -74.3642, zone: 'urbano', fare: 5000 },
  { id: '3', name: 'Terminal de Transportes', address: 'Panamericana, Fusagasugá', latitude: 4.3325, longitude: -74.3705, zone: 'urbano', fare: 5000 },
  { id: '4', name: 'Universidad de Cundinamarca (UDEC)', address: 'Diagonal 18 # 20-29', latitude: 4.3318, longitude: -74.3606, zone: 'urbano', fare: 5000 },
  { id: '5', name: 'Hospital San Rafael', address: 'Carrera 4 # 13-10', latitude: 4.3495, longitude: -74.3615, zone: 'urbano', fare: 5000 },
  { id: '6', name: 'El Indio (Sector Abajo Indio)', address: 'Avenida las Palmas, Fusagasugá', latitude: 4.3398, longitude: -74.3780, zone: 'abajo_indio', fare: 6000 },
  { id: '7', name: 'Manta Amarillo (Sector Abajo)', address: 'Vía Antigua Panamericana, Fusa', latitude: 4.3260, longitude: -74.3820, zone: 'abajo_m_amarillo', fare: 7000 },

  // --- Fuera del Perímetro / Rural / Aledaños ---
  { id: '8', name: 'Puente de Cucharal', address: 'Vía Panamericana Sur', latitude: 4.3162, longitude: -74.3912, zone: 'fuera_perimetro', fare: 5000 },
  { id: '9', name: 'Tres Esquinas', address: 'Sector Tres Esquinas, Fusa', latitude: 4.3590, longitude: -74.3490, zone: 'fuera_perimetro', fare: 8000 },
  { id: '10', name: 'Chinauta (1 Retorno)', address: 'Vía Melgar, Chinauta', latitude: 4.3050, longitude: -74.4320, zone: 'fuera_perimetro', fare: 15000 },
  { id: '11', name: 'Chinauta (3 Retorno)', address: 'Vía Melgar, Sector Hoteles', latitude: 4.2810, longitude: -74.4550, zone: 'fuera_perimetro', fare: 21000 },
  { id: '12', name: 'Pasca (Cundinamarca)', address: 'Municipio Aledaño', latitude: 4.3072, longitude: -74.3015, zone: 'aledanos', fare: 20000 },
  { id: '13', name: 'Arbeláez (Cundinamarca)', address: 'Municipio Aledaño', latitude: 4.2725, longitude: -74.4158, zone: 'aledanos', fare: 31000 },
  { id: '14', name: 'Silvania (Cundinamarca)', address: 'Municipio Aledaño', latitude: 4.4045, longitude: -74.3860, zone: 'aledanos', fare: 21000 },
  { id: '15', name: 'Aguadita', address: 'Corregimiento Vía Pasca/Bogota', latitude: 4.4120, longitude: -74.3310, zone: 'aledanos', fare: 20000 },
];

interface AddressSearchProps {
  onSelectDestination: (coords: { latitude: number; longitude: number; name: string; fare: number }) => void;
  onClose: () => void;
  children?: React.ReactNode;
}

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export default function AddressSearch({ onSelectDestination, onClose, children }: AddressSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);

  const handleSearch = (text: string) => {
    setQuery(text);
    const normalizedQuery = normalizeText(text.trim());

    if (!normalizedQuery) {
      setResults([]);
      return;
    }

    const filtered = FUSA_PLACES.filter((place) => {
      const searchTarget = normalizeText(`${place.name} ${place.address}`);
      return searchTarget.includes(normalizedQuery);
    }).sort((a, b) => {
      const aStarts = normalizeText(a.name).startsWith(normalizedQuery);
      const bStarts = normalizeText(b.name).startsWith(normalizedQuery);
      return Number(bStarts) - Number(aStarts);
    });

    setResults(filtered);
  };

  const formatFare = (fare: number) => `$${fare.toLocaleString('es-CO')}`;

  return (
    <View style={styles.container}>
      <View style={styles.headerCard}>
        <View style={styles.topRow}>
          <TouchableOpacity style={styles.backButton} onPress={onClose}>
            <Text style={styles.backButtonText}>← Atrás</Text>
          </TouchableOpacity>
          <Text style={styles.headerTitle}>
            {query ? 'Resultados' : '¿A dónde deseas ir?'}
          </Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Escribe tu destino (ej: Manila, Terminal...)"
          placeholderTextColor="#94A3B8"
          value={query}
          onChangeText={handleSearch}
          autoFocus={true}
        />
        {children}
      </View>

      <FlatList
        data={results}
        keyExtractor={(item) => item.id}
        contentContainerStyle={styles.listContainer}
        renderItem={({ item }) => (
          <TouchableOpacity
            style={styles.resultItem}
            onPress={() => {
              onSelectDestination({
                latitude: item.latitude,
                longitude: item.longitude,
                name: item.name,
                fare: item.fare,
              });
            }}
          >
            <View style={styles.resultHeader}>
              <Text style={styles.placeName}>{item.name}</Text>
              <Text style={styles.fareTag}>{formatFare(item.fare)}</Text>
            </View>
            <Text style={styles.placeAddress}>{item.address}</Text>
          </TouchableOpacity>
        )}
        ListEmptyComponent={
          query.length > 0 ? (
            <Text style={styles.emptyText}>No se encontraron lugares en Fusa</Text>
          ) : null
        }
      />
    </View>
  );
}

const styles = StyleSheet.create({
  container: { flex: 1, backgroundColor: '#F8FAFC' },
  headerCard: {
    backgroundColor: '#FFFFFF',
    padding: 20,
    borderBottomLeftRadius: 24,
    borderBottomRightRadius: 24,
    elevation: 4,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
  },
  topRow: { flexDirection: 'row', alignItems: 'center', marginBottom: 16, marginTop: 10 },
  backButton: { paddingRight: 16 },
  backButtonText: { fontSize: 18, fontWeight: 'bold', color: '#1E3A8A' },
  headerTitle: { fontSize: 20, fontWeight: 'bold', color: '#1E3A8A' },
  input: { backgroundColor: '#F1F5F9', paddingHorizontal: 16, paddingVertical: 12, borderRadius: 12, fontSize: 16, color: '#334155' },
  listContainer: { padding: 20 },
  resultItem: { backgroundColor: '#FFFFFF', padding: 16, borderRadius: 12, marginBottom: 12, elevation: 1 },
  resultHeader: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', gap: 8 },
  placeName: { fontSize: 16, fontWeight: 'bold', color: '#334155', flex: 1 },
  placeAddress: { fontSize: 14, color: '#64748B', marginTop: 4 },
  fareTag: { fontSize: 12, fontWeight: '700', color: '#0F766E', backgroundColor: '#CCFBF1', paddingHorizontal: 8, paddingVertical: 4, borderRadius: 8 },
  emptyText: { textAlign: 'center', color: '#64748B', marginTop: 20 },
});