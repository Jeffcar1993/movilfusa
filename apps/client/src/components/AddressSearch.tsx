import React, { useState } from 'react';
import { StyleSheet, Text, View, TextInput, TouchableOpacity, FlatList } from 'react-native';
import { MaterialCommunityIcons } from '@expo/vector-icons';

type Place = {
  id: string;
  name: string;
  address: string;
  latitude: number;
  longitude: number;
  zone: string;
  fare: number;
};

// Array definitivo consolidado con la Comuna Norte completa y los arreglos previos unificados
const FUSA_PLACES: Place[] = [
  // ==========================================
  // 1. PERÍMETRO URBANO ($5.000) - POR COMUNAS
  // ==========================================

  // --- COMUNA NORTE ---
  { id: 'norte_1', name: 'Barrio Jorge Eliécer Gaitán', address: 'Comuna Norte, Fusagasugá', latitude: 4.3545, longitude: -74.3612, zone: 'urbano', fare: 5000 },
  { id: 'norte_2', name: 'Barrio El Progreso (Norte)', address: 'Comuna Norte, Cerca a la Av. Norte', latitude: 4.3570, longitude: -74.3640, zone: 'urbano', fare: 5000 },
  { id: 'norte_3', name: 'Barrio Comuneros', address: 'Sector Comuna Norte, Fusa', latitude: 4.3582, longitude: -74.3595, zone: 'urbano', fare: 5000 },
  { id: 'norte_4', name: 'Barrio Piamonte', address: 'Sector Norte, Fusagasugá', latitude: 4.3552, longitude: -74.3670, zone: 'urbano', fare: 5000 },
  { id: 'norte_5', name: 'Barrio Piedra Grande', address: 'Sector Norte alta valoración', latitude: 4.3585, longitude: -74.3580, zone: 'urbano', fare: 5000 },
  { id: 'norte_6', name: 'Barrio Santa Anita', address: 'Comuna Norte, Fusagasugá', latitude: 4.3520, longitude: -74.3590, zone: 'urbano', fare: 5000 },
  { id: 'norte_7', name: 'Barrio Sabanitas', address: 'Sector Norte Periférico, Fusa', latitude: 4.3615, longitude: -74.3620, zone: 'urbano', fare: 5000 },
  { id: 'norte_8', name: 'Barrio La Florida', address: 'Comuna Norte, Fusagasugá', latitude: 4.3538, longitude: -74.3648, zone: 'urbano', fare: 5000 },
  { id: 'norte_9', name: 'Barrio Villa de los SUT', address: 'Sector Norte Residencial', latitude: 4.3595, longitude: -74.3662, zone: 'urbano', fare: 5000 },

  // --- COMUNA CENTRO / CORE URBANO ---
  { id: '1', name: 'Centro Comercial Manila', address: 'Cra. 10 # 21-39, Perímetro Urbano', latitude: 4.3364, longitude: -74.3638, zone: 'urbano', fare: 5000 },
  { id: '2', name: 'Parque Principal (Plaza de Bolívar)', address: 'Calle 7 con Carrera 6, Centro', latitude: 4.3462, longitude: -74.3642, zone: 'urbano', fare: 5000 },
  { id: '3', name: 'Terminal de Transportes', address: 'Panamericana, Fusagasugá', latitude: 4.3325, longitude: -74.3705, zone: 'urbano', fare: 5000 },
  { id: '4', name: 'Universidad de Cundinamarca (UDEC)', address: 'Diagonal 18 # 20-29', latitude: 4.3318, longitude: -74.3606, zone: 'urbano', fare: 5000 },
  { id: '5', name: 'Hospital San Rafael', address: 'Carrera 4 # 13-10', latitude: 4.3495, longitude: -74.3615, zone: 'urbano', fare: 5000 },
  { id: 'centro_6', name: 'Barrio Emilio Sierra', address: 'Cerca al Parque Principal, Centro', latitude: 4.3480, longitude: -74.3665, zone: 'urbano', fare: 5000 },
  { id: 'centro_7', name: 'Barrio Obrero', address: 'Comuna Centro, Fusagasugá', latitude: 4.3425, longitude: -74.3600, zone: 'urbano', fare: 5000 },
  { id: 'centro_8', name: 'Barrio Santander', address: 'Cerca a la Plaza de Mercado, Centro', latitude: 4.3445, longitude: -74.3690, zone: 'urbano', fare: 5000 },
  { id: 'centro_9', name: 'Plaza de Mercado (Galería)', address: 'Calle 5 con Carrera 9, Centro', latitude: 4.3438, longitude: -74.3695, zone: 'urbano', fare: 5000 },
  { id: 'centro_10', name: 'Centro Comercial San Fernando', address: 'Calle 22 # 11-45', latitude: 4.3340, longitude: -74.3662, zone: 'urbano', fare: 5000 },
  { id: 'centro_11', name: 'Colegio Francisco de Paula Santander', address: 'Avenida de la Constitución', latitude: 4.3430, longitude: -74.3660, zone: 'urbano', fare: 5000 },

  // --- COMUNA ORIENTAL ---
  { id: 'oriental_1', name: 'Barrio Balmoral (Éxito / Homecenter)', address: 'Av. Manuel Humberto Cárdenas', latitude: 4.3385, longitude: -74.3540, zone: 'urbano', fare: 5000 },
  { id: 'oriental_2', name: 'Barrio Fontanar', address: 'Sector Oriental, Fusa', latitude: 4.3410, longitude: -74.3475, zone: 'urbano', fare: 5000 },
  { id: 'oriental_3', name: 'Barrio Luxemburgo', address: 'Sector Centro-Oriente', latitude: 4.3440, longitude: -74.3575, zone: 'urbano', fare: 5000 },
  { id: 'oriental_4', name: 'Barrio COMFABOY / La Esmeralda', address: 'Sector Sur-Oriente', latitude: 4.3310, longitude: -74.3550, zone: 'urbano', fare: 5000 },

  // --- COMUNA OCCIDENTAL ---
  { id: 'occidente_1', name: 'Barrio La Macarena (Urbano)', address: 'Sector Colegio Técnico Industrial', latitude: 4.3485, longitude: -74.3720, zone: 'urbano', fare: 5000 },
  { id: 'occidente_2', name: 'Conjunto Residencial El Mirador', address: 'Sector Avenida las Palmas, Urbano', latitude: 4.3405, longitude: -74.3730, zone: 'urbano', fare: 5000 },
  { id: 'occidente_3', name: 'Colegio Técnico Industrial', address: 'Sede Principal, Fusagasugá', latitude: 4.3512, longitude: -74.3710, zone: 'urbano', fare: 5000 },

  // ==========================================
  // 2. SECTOR ABAJO INDIO ($6.000)
  // ==========================================
  { id: '6', name: 'El Indio (Sector Abajo Indio)', address: 'Avenida las Palmas, Fusagasugá', latitude: 4.3398, longitude: -74.3780, zone: 'abajo_indio', fare: 6000 },
  { id: 'abajo_i_2', name: 'Barrio Llano Verde', address: 'Sector Occidental, Fusa', latitude: 4.3435, longitude: -74.3840, zone: 'abajo_indio', fare: 6000 },
  { id: 'abajo_i_3', name: 'Barrio San Jorge', address: 'Sector Abajo del Indio', latitude: 4.3412, longitude: -74.3820, zone: 'abajo_indio', fare: 6000 },
  { id: 'abajo_i_4', name: 'Barrio Quinta Balmoral', address: 'Bajos de Balmoral, Occidente', latitude: 4.3360, longitude: -74.3765, zone: 'abajo_indio', fare: 6000 },
  { id: 'abajo_i_5', name: 'Cancha Sardinas', address: 'Sector Sardinas, Periferia Occidente', latitude: 4.3315, longitude: -74.3810, zone: 'abajo_indio', fare: 6000 },
  { id: 'abajo_i_6', name: 'Cancha Cucharal', address: 'Sector Cucharal Bajo', latitude: 4.3235, longitude: -74.3870, zone: 'abajo_indio', fare: 6000 },
  { id: 'abajo_i_7', name: 'Barrio El Progreso (Sur Occidente)', address: 'Comuna Sur Occidental', latitude: 4.3345, longitude: -74.3810, zone: 'abajo_indio', fare: 6000 },

  // ==========================================
  // 3. ABAJO DE MANTA AMARILLO ($7.000)
  // ==========================================
  { id: '7', name: 'Manta Amarillo (Sector Abajo)', address: 'Vía Antigua Panamericana, Fusa', latitude: 4.3260, longitude: -74.3820, zone: 'abajo_m_amarillo', fare: 7000 },
  { id: 'manta_a_2', name: 'Conjunto Residencial La Macarena (S.A.)', address: 'Vía Novillero, Fusagasugá', latitude: 4.3490, longitude: -74.3895, zone: 'abajo_m_amarillo', fare: 7000 },
  { id: 'manta_a_3', name: 'Conjunto Cerrado Yerbamala', address: 'Vía Antigua Panamericana Sur', latitude: 4.3210, longitude: -74.3845, zone: 'abajo_m_amarillo', fare: 7000 },
  { id: 'manta_a_4', name: 'Moteles (Sector El Escondite / Vía Antigua)', address: 'Vía Antigua Panamericana, Zona Rosa', latitude: 4.3240, longitude: -74.3835, zone: 'abajo_m_amarillo', fare: 7000 },
  { id: 'manta_a_5', name: 'Lucho Herrera', address: 'Sector Lucho Herrera, Límites Urbanos', latitude: 4.3215, longitude: -74.3790, zone: 'abajo_m_amarillo', fare: 7000 },
  { id: 'manta_a_6', name: 'Mirador de Monserrat', address: 'Sector Occidental Alto', latitude: 4.3510, longitude: -74.3940, zone: 'abajo_m_amarillo', fare: 7000 },

  // ==========================================
  // 4. FUERA DEL PERÍMETRO VIA CHINAUTA / RURAL
  // ==========================================
  { id: '8', name: 'Puente de Cucharal', address: 'Vía Panamericana Sur', latitude: 4.3162, longitude: -74.3912, zone: 'fuera_perimetro', fare: 5000 },
  { id: '9', name: 'Tres Esquinas', address: 'Sector Tres Esquinas, Fusa', latitude: 4.3590, longitude: -74.3490, zone: 'fuera_perimetro', fare: 8000 },
  { id: 'caseta_a', name: 'Caseta Azul', address: 'Vía Panamericana Sur', latitude: 4.3190, longitude: -74.3898, zone: 'fuera_perimetro', fare: 5000 },
  { id: 'alaska', name: 'Alaska', address: 'Sector Alaska, Vía Rural', latitude: 4.3620, longitude: -74.3420, zone: 'fuera_perimetro', fare: 8000 },
  { id: 'sena_q', name: 'SENA Quebrajacho', address: 'Centro Agroecológico y Empresarial', latitude: 4.3110, longitude: -74.4120, zone: 'fuera_perimetro', fare: 9000 },
  { id: 'quindiana', name: 'Quindiana', address: 'Vía Panamericana Suroccidente', latitude: 4.3090, longitude: -74.4210, zone: 'fuera_perimetro', fare: 11000 },
  { id: 'b_tardes', name: 'Buenas Tardes y Molino', address: 'Sector Industrial / Molinos', latitude: 4.3140, longitude: -74.4050, zone: 'fuera_perimetro', fare: 10000 },
  { id: '10', name: 'Chinauta (1 Retorno)', address: 'Vía Melgar, Entrada Principal Chinauta', latitude: 4.3050, longitude: -74.4320, zone: 'fuera_perimetro', fare: 15000 },
  { id: 'chinauta_r2', name: 'Chinauta (2 Retorno - El Oasis)', address: 'Vía Melgar, Mitad de Chinauta', latitude: 4.2930, longitude: -74.4440, zone: 'fuera_perimetro', fare: 18000 },
  { id: '11', name: 'Chinauta (3 Retorno)', address: 'Vía Melgar, Sector Hoteles y Condominios', latitude: 4.2810, longitude: -74.4550, zone: 'fuera_perimetro', fare: 21000 },
  { id: 'canecas', name: 'Retorno Canecas', address: 'Límites Chinauta / Boquerón', latitude: 4.2620, longitude: -74.4710, zone: 'fuera_perimetro', fare: 25000 },

  // --- ZONA RURAL EXPRESA ---
  { id: 'cuja', name: 'Cuja', address: 'Sector Corregimiento de Cuja', latitude: 4.3180, longitude: -74.3520, zone: 'zona_rural', fare: 9000 },
  { id: 'chorizo_g', name: 'Chorizo Gourmet', address: 'Vía Veredal Fusa', latitude: 4.3225, longitude: -74.3460, zone: 'zona_rural', fare: 9000 },
  { id: 'homero', name: 'Homero', address: 'Sector Rural Homero', latitude: 4.3115, longitude: -74.3390, zone: 'zona_rural', fare: 10000 },
  { id: 'gallina_a', name: 'Gallina Arizona', address: 'Restaurante Campestre Rural', latitude: 4.3100, longitude: -74.3350, zone: 'zona_rural', fare: 10000 },
  { id: 'rancho_gpc', name: 'Rancho GPC', address: 'Sector Rural Eventos', latitude: 4.3050, longitude: -74.3290, zone: 'zona_rural', fare: 12000 },
  { id: 'cancha_j', name: 'Cancha Jaibana', address: 'Sector Jaibana Rural', latitude: 4.2985, longitude: -74.3260, zone: 'zona_rural', fare: 12000 },
  { id: 'club_b', name: 'Club El Bosque', address: 'Vía Antigua Panamericana Sur (Campestre)', latitude: 4.3180, longitude: -74.3890, zone: 'zona_rural', fare: 25000 },
  { id: 'rio_sardinas', name: 'Río Sardinas', address: 'Zona de Balnearios Rural', latitude: 4.3250, longitude: -74.4020, zone: 'zona_rural', fare: 18000 },
  { id: 'col_nuevo_h', name: 'Colegio Nuevo Horizonte', address: 'Sede Campestre Rural', latitude: 4.3610, longitude: -74.3210, zone: 'zona_rural', fare: 15000 },
  { id: 'rural_3', name: 'Silos / El Placer', address: 'Vía Pasca, Entrada Veredal', latitude: 4.3280, longitude: -74.3310, zone: 'zona_rural', fare: 17000 },
  { id: 'la_trinidad', name: 'La Trinidad', address: 'Vereda La Trinidad Alta', latitude: 4.3750, longitude: -74.3050, zone: 'zona_rural', fare: 22000 },
  { id: 'guavio_bajo', name: 'Guavio Bajo', address: 'Sector Rural Guavio', latitude: 4.3820, longitude: -74.2980, zone: 'zona_rural', fare: 26000 },
  { id: 'guavio_alto', name: 'Guavio Alto', address: 'Límites de la Cordillera', latitude: 4.3910, longitude: -74.2850, zone: 'zona_rural', fare: 30000 },
  { id: 'rural_4', name: 'Novillero (Sector Alto)', address: 'Vía Novillero Rural, Fusa', latitude: 4.3580, longitude: -74.4080, zone: 'fuera_perimetro', fare: 10000 },
  { id: 'rural_5', name: 'Cuchuco (Vía Pasca)', address: 'Subiendo hacia Pasca, Entrada Veredal', latitude: 4.3210, longitude: -74.3220, zone: 'fuera_perimetro', fare: 9000 },
  { id: 'rural_6', name: 'Vereda El Placer (Cercano)', address: 'Sector Rural Cercano', latitude: 4.3640, longitude: -74.3350, zone: 'fuera_perimetro', fare: 8000 },
  { id: 'rural_7', name: 'Vereda Pekín', address: 'Sector San Pascasio / Pekín', latitude: 4.3685, longitude: -74.3440, zone: 'fuera_perimetro', fare: 8000 },
  { id: 'rural_8', name: 'Vereda Jordán', address: 'Vía Rural Fusagasugá', latitude: 4.3120, longitude: -74.3680, zone: 'fuera_perimetro', fare: 7000 },

  // ==========================================
  // 5. MUNICIPIOS ALEDAÑOS / PROVINCIA SUMAPAZ
  // ==========================================
  { id: '15', name: 'Aguadita (Corregimiento)', address: 'Vía Antigua Fusa - Bogotá', latitude: 4.4120, longitude: -74.3310, zone: 'aledanos', fare: 20000 },
  { id: 'aguabonita', name: 'Aguabonita', address: 'Vía Silvania / Aguabonita', latitude: 4.4250, longitude: -74.3620, zone: 'aledanos', fare: 32000 },
  { id: '12', name: 'Pasca (Cundinamarca)', address: 'Casco Urbano Municipio de Pasca', latitude: 4.3072, longitude: -74.3015, zone: 'aledanos', fare: 20000 },
  { id: '14', name: 'Silvania (Cundinamarca)', address: 'Casco Urbano Municipio de Silvania', latitude: 4.4045, longitude: -74.3860, zone: 'aledanos', fare: 21000 },
  { id: '13', name: 'Arbeláez (Cundinamarca)', address: 'Casco Urbano Municipio de Arbeláez', latitude: 4.2725, longitude: -74.4158, zone: 'aledanos', fare: 31000 },
  { id: 'subia', name: 'Subia (Silvania)', address: 'Inspección de Policía Subia, Vía Bogotá', latitude: 4.4490, longitude: -74.3680, zone: 'aledanos', fare: 35000 },
  { id: 'aledanos_5', name: 'Tibacuy (Cundinamarca)', address: 'Municipio Aledaño (Cerro Quininí)', latitude: 4.3472, longitude: -74.4542, zone: 'aledanos', fare: 42000 },
  { id: 'granada', name: 'Granada (Cundinamarca)', address: 'Municipio Norte del Sumapaz', latitude: 4.5160, longitude: -74.3520, zone: 'aledanos', fare: 40000 },
  { id: 'cumaca', name: 'Cumaca', address: 'Inspección de Tibacuy', latitude: 4.3210, longitude: -74.4850, zone: 'aledanos', fare: 45000 },
  { id: 'boqueron', name: 'Boquerón', address: 'Eje Vial Panamericana, Tolima Límites', latitude: 4.2310, longitude: -74.4920, zone: 'aledanos', fare: 40000 },
  { id: 'sibate', name: 'Sibaté (Cundinamarca)', address: 'Llegando al área Metropolitana de Bogotá', latitude: 4.4920, longitude: -74.2610, zone: 'aledanos', fare: 65000 },
  { id: 'aledanos_6', name: 'Fusacatán', address: 'Vía e inspección rural', latitude: 4.3680, longitude: -74.3190, zone: 'aledanos', fare: 12000 },
  { id: 'aledanos_10', name: 'San Bernardo (Cundinamarca)', address: 'Provincia del Sumapaz (Más allá de Arbeláez)', latitude: 4.1780, longitude: -74.4220, zone: 'aledanos', fare: 55000 }
];

interface AddressSearchProps {
  onSelectDestination: (destination: { latitude: number; longitude: number; name: string; fare: number; serviceType: ServiceType; packageNotes?: string }) => void;
  onClose: () => void;
  children?: React.ReactNode;
}

type ServiceType = 'pasajero' | 'encomienda';

interface ServiceSelectorProps {
  activeService: ServiceType;
  onServiceChange: (type: ServiceType) => void;
  calculatedFare: number;
  packageNotes: string;
  onChangePackageNotes: (text: string) => void;
  onConfirm: () => void;
}

// Subcomponente interno del selector de servicios enfocado al 100% en UX limpia
export const ServiceSelector: React.FC<ServiceSelectorProps> = ({ 
  activeService, 
  onServiceChange, 
  calculatedFare, 
  packageNotes,
  onChangePackageNotes,
  onConfirm 
}) => {
  return (
    <View style={selectorStyles.container}>
      <Text style={selectorStyles.title}>¿Qué tipo de servicio necesitas?</Text>
      
      {/* Selector de tipo Segmented Control de Alta Visibilidad */}
      <View style={selectorStyles.selectorRow}>
        <TouchableOpacity 
          style={[selectorStyles.typeButton, activeService === 'pasajero' && selectorStyles.activeButton]}
          onPress={() => onServiceChange('pasajero')}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons 
            name="motorbike" 
            size={26} 
            color={activeService === 'pasajero' ? '#FFF' : '#64748B'} 
          />
          <Text style={[selectorStyles.buttonText, activeService === 'pasajero' && selectorStyles.activeButtonText]}>
            Viajar
          </Text>
        </TouchableOpacity>

        <TouchableOpacity 
          style={[selectorStyles.typeButton, activeService === 'encomienda' && selectorStyles.activeButton]}
          onPress={() => onServiceChange('encomienda')}
          activeOpacity={0.8}
        >
          <MaterialCommunityIcons 
            name="package-variant-closed" 
            size={26} 
            color={activeService === 'encomienda' ? '#FFF' : '#64748B'} 
          />
          <Text style={[selectorStyles.buttonText, activeService === 'encomienda' && selectorStyles.activeButtonText]}>
            Encomienda
          </Text>
        </TouchableOpacity>
      </View>

      {/* Contenido dinámico según el servicio seleccionado */}
      <View style={selectorStyles.dynamicContent}>
        {activeService === 'pasajero' ? (
          <View style={selectorStyles.infoRow}>
            <MaterialCommunityIcons name="shield-check" size={18} color="#0F766E" />
            <Text style={selectorStyles.descriptionText}>
              Tarifa para 1 pasajero. Incluye casco reglamentario desinfectado.
            </Text>
          </View>
        ) : (
          <View>
            <View style={[selectorStyles.infoRow, { marginBottom: 10 }]}>
              <MaterialCommunityIcons name="truck-delivery" size={18} color="#E65100" />
              <Text style={selectorStyles.descriptionText}>
                Envía llaves, documentos o paquetes medianos seguros.
              </Text>
            </View>
            <TextInput
              style={selectorStyles.noteInput}
              placeholder="¿Qué llevas o qué indicaciones tienes? (Opcional)"
              placeholderTextColor="#94A3B8"
              value={packageNotes}
              onChangeText={onChangePackageNotes}
              multiline={false}
            />
          </View>
        )}
      </View>

      {/* Tarifa Exacta y Botón de Acción Directo */}
      <View style={selectorStyles.footerRow}>
        <View>
          <Text style={selectorStyles.fareLabel}>Total a pagar</Text>
          <Text style={selectorStyles.fareText}>${calculatedFare.toLocaleString('es-CO')}</Text>
        </View>
        <TouchableOpacity style={selectorStyles.submitButton} onPress={onConfirm}>
          <Text style={selectorStyles.submitButtonText}>
            Confirmar {activeService === 'pasajero' ? 'Viaje' : 'Envío'}
          </Text>
        </TouchableOpacity>
      </View>
    </View>
  );
};

const normalizeText = (value: string) =>
  value
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .toLowerCase();

export default function AddressSearch({ onSelectDestination, onClose, children }: AddressSearchProps) {
  const [query, setQuery] = useState('');
  const [results, setResults] = useState<Place[]>([]);
  
  // Estados para manejar el flujo de confirmación del servicio seleccionado
  const [selectedPlace, setSelectedPlace] = useState<Place | null>(null);
  const [serviceType, setServiceType] = useState<ServiceType>('pasajero');
  const [packageNotes, setPackageNotes] = useState('');

  const handleSearch = (text: string) => {
    setQuery(text);
    // Si el usuario empieza a escribir de nuevo, limpiamos la selección previa para mostrar la lista
    if (selectedPlace) setSelectedPlace(null);

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

  const handleSelectPlace = (place: Place) => {
    // Seteamos el lugar seleccionado. Esto automáticamente oculta la lista y muestra el panel inferior de servicio
    setSelectedPlace(place);
    setQuery(place.name); // Muestra el nombre en el input de arriba como feedback visual limpio
  };

  const handleFinalConfirm = () => {
    if (!selectedPlace) return;
    
    // Devolvemos el objeto completo con el tipo de servicio y notas configuradas por el usuario
    onSelectDestination({
      latitude: selectedPlace.latitude,
      longitude: selectedPlace.longitude,
      name: selectedPlace.name,
      fare: selectedPlace.fare,
      serviceType: serviceType,
      packageNotes: serviceType === 'encomienda' ? packageNotes : undefined
    });
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
            {selectedPlace ? 'Detalle del Servicio' : query ? 'Resultados' : '¿A dónde deseas ir?'}
          </Text>
        </View>

        <TextInput
          style={styles.input}
          placeholder="Escribe tu destino (ej: Gaitan, Manila, Terminal...)"
          placeholderTextColor="#94A3B8"
          value={query}
          onChangeText={handleSearch}
          autoFocus={!selectedPlace}
        />
        {children}
      </View>

      {/* RENDERIZADO CONDICIONAL DE LA UI BASADO EN UX */}
      {selectedPlace ? (
        // Si ya tocó un destino, le mostramos directamente el selector para cerrar el trato
        <View style={styles.selectorWrapper}>
          <ServiceSelector
            activeService={serviceType}
            onServiceChange={setServiceType}
            calculatedFare={selectedPlace.fare}
            packageNotes={packageNotes}
            onChangePackageNotes={setPackageNotes}
            onConfirm={handleFinalConfirm}
          />
        </View>
      ) : (
        // Si no ha seleccionado nada, le mostramos la lista predictiva de búsqueda
        <FlatList
          data={results}
          keyExtractor={(item) => item.id}
          contentContainerStyle={styles.listContainer}
          renderItem={({ item }) => (
            <TouchableOpacity
              style={styles.resultItem}
              onPress={() => handleSelectPlace(item)}
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
      )}
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
  selectorWrapper: { flex: 1, justifyContent: 'flex-end' }
});

// Estilos específicos e impecables para el módulo inferior del Selector de Servicios
const selectorStyles = StyleSheet.create({
  container: {
    padding: 20,
    backgroundColor: '#FFFFFF',
    borderTopLeftRadius: 28,
    borderTopRightRadius: 28,
    elevation: 10,
    shadowColor: '#000',
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.15,
    shadowRadius: 6,
  },
  title: {
    fontSize: 15,
    fontWeight: '700',
    color: '#334155',
    marginBottom: 14,
    textAlign: 'center'
  },
  selectorRow: {
    flexDirection: 'row',
    backgroundColor: '#F1F5F9',
    borderRadius: 14,
    padding: 4,
  },
  typeButton: {
    flex: 1,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    paddingVertical: 12,
    borderRadius: 12,
    gap: 8,
  },
  activeButton: {
    backgroundColor: '#E65100', // Naranja vibrante para el estado activo, transmite velocidad y dinamismo
  },
  buttonText: {
    fontSize: 14,
    fontWeight: '600',
    color: '#64748B',
  },
  activeButtonText: {
    color: '#FFFFFF',
  },
  dynamicContent: {
    marginVertical: 18,
    minHeight: 52,
    justifyContent: 'center'
  },
  infoRow: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 4
  },
  descriptionText: {
    fontSize: 13,
    color: '#64748B',
    lineHeight: 18,
    flex: 1
  },
  noteInput: {
    backgroundColor: '#F8FAFC',
    borderWidth: 1,
    borderColor: '#E2E8F0',
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: '#334155',
  },
  footerRow: {
    flexDirection: 'row',
    justifyContent: 'space-between',
    alignItems: 'center',
    borderTopWidth: 1,
    borderTopColor: '#F1F5F9',
    paddingTop: 14,
  },
  fareLabel: {
    fontSize: 12,
    color: '#64748B',
    fontWeight: '500'
  },
  fareText: {
    fontSize: 26,
    fontWeight: '800',
    color: '#1E3A8A',
  },
  submitButton: {
    backgroundColor: '#10B981', // Verde esmeralda sólido para confirmar
    paddingHorizontal: 28,
    paddingVertical: 14,
    borderRadius: 14,
    elevation: 2,
  },
  submitButtonText: {
    color: '#FFFFFF',
    fontSize: 15,
    fontWeight: '700',
  },
});