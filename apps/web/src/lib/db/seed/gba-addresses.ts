/**
 * Direcciones "reales del GBA" (criterio de aceptación de FASE 2, §14).
 *
 * Sin geocoding real todavía (eso es FASE 5: `GOOGLE_GEOCODING_API_KEY` no
 * está configurada, y no correspondía adelantar esa integración acá). Las
 * coordenadas son el centroide aproximado de cada localidad — reales y
 * ubicadas correctamente en el mapa del GBA, pero NO "rooftop accurate".
 * Por eso `geocodeAccuracy: "APPROXIMATE"` en el seed, con honestidad.
 *
 * Los nombres de calle son genéricos pero reales y comunes a casi
 * cualquier partido del GBA (San Martín, Rivadavia, Belgrano, Mitre...),
 * que es como efectivamente funciona el nomenclátor en Argentina.
 */

export interface GbaLocality {
  locality: string;
  municipality: string;
  province: string;
  lat: number;
  lng: number;
}

export const GBA_LOCALITIES: GbaLocality[] = [
  {
    locality: "San Isidro",
    municipality: "San Isidro",
    province: "Buenos Aires",
    lat: -34.4728,
    lng: -58.5273,
  },
  {
    locality: "Martínez",
    municipality: "San Isidro",
    province: "Buenos Aires",
    lat: -34.4934,
    lng: -58.5083,
  },
  {
    locality: "Vicente López",
    municipality: "Vicente López",
    province: "Buenos Aires",
    lat: -34.5266,
    lng: -58.4784,
  },
  {
    locality: "Olivos",
    municipality: "Vicente López",
    province: "Buenos Aires",
    lat: -34.5091,
    lng: -58.497,
  },
  {
    locality: "Florida",
    municipality: "Vicente López",
    province: "Buenos Aires",
    lat: -34.5285,
    lng: -58.4949,
  },
  {
    locality: "Munro",
    municipality: "Vicente López",
    province: "Buenos Aires",
    lat: -34.5311,
    lng: -58.5187,
  },
  {
    locality: "Tigre",
    municipality: "Tigre",
    province: "Buenos Aires",
    lat: -34.4264,
    lng: -58.5796,
  },
  {
    locality: "Don Torcuato",
    municipality: "Tigre",
    province: "Buenos Aires",
    lat: -34.4989,
    lng: -58.6386,
  },
  {
    locality: "San Fernando",
    municipality: "San Fernando",
    province: "Buenos Aires",
    lat: -34.4406,
    lng: -58.5586,
  },
  {
    locality: "Boulogne",
    municipality: "San Isidro",
    province: "Buenos Aires",
    lat: -34.5058,
    lng: -58.5648,
  },
  {
    locality: "Villa Ballester",
    municipality: "San Martín",
    province: "Buenos Aires",
    lat: -34.5461,
    lng: -58.5589,
  },
  {
    locality: "San Martín",
    municipality: "San Martín",
    province: "Buenos Aires",
    lat: -34.5722,
    lng: -58.5361,
  },
  {
    locality: "Caseros",
    municipality: "Tres de Febrero",
    province: "Buenos Aires",
    lat: -34.6047,
    lng: -58.5653,
  },
  {
    locality: "Ramos Mejía",
    municipality: "La Matanza",
    province: "Buenos Aires",
    lat: -34.6403,
    lng: -58.5658,
  },
  {
    locality: "San Justo",
    municipality: "La Matanza",
    province: "Buenos Aires",
    lat: -34.6791,
    lng: -58.5631,
  },
  {
    locality: "Morón",
    municipality: "Morón",
    province: "Buenos Aires",
    lat: -34.6534,
    lng: -58.6198,
  },
  {
    locality: "Haedo",
    municipality: "Morón",
    province: "Buenos Aires",
    lat: -34.6403,
    lng: -58.5934,
  },
  {
    locality: "Castelar",
    municipality: "Morón",
    province: "Buenos Aires",
    lat: -34.6494,
    lng: -58.6461,
  },
  {
    locality: "Ituzaingó",
    municipality: "Ituzaingó",
    province: "Buenos Aires",
    lat: -34.6606,
    lng: -58.6706,
  },
  {
    locality: "Merlo",
    municipality: "Merlo",
    province: "Buenos Aires",
    lat: -34.6656,
    lng: -58.7286,
  },
  {
    locality: "Lomas de Zamora",
    municipality: "Lomas de Zamora",
    province: "Buenos Aires",
    lat: -34.7614,
    lng: -58.4022,
  },
  {
    locality: "Banfield",
    municipality: "Lomas de Zamora",
    province: "Buenos Aires",
    lat: -34.7444,
    lng: -58.3947,
  },
  {
    locality: "Temperley",
    municipality: "Lomas de Zamora",
    province: "Buenos Aires",
    lat: -34.7739,
    lng: -58.3936,
  },
  {
    locality: "Lanús",
    municipality: "Lanús",
    province: "Buenos Aires",
    lat: -34.7061,
    lng: -58.3927,
  },
  {
    locality: "Avellaneda",
    municipality: "Avellaneda",
    province: "Buenos Aires",
    lat: -34.6626,
    lng: -58.3654,
  },
  {
    locality: "Wilde",
    municipality: "Avellaneda",
    province: "Buenos Aires",
    lat: -34.7047,
    lng: -58.3213,
  },
  {
    locality: "Quilmes",
    municipality: "Quilmes",
    province: "Buenos Aires",
    lat: -34.7203,
    lng: -58.2545,
  },
  {
    locality: "Berazategui",
    municipality: "Berazategui",
    province: "Buenos Aires",
    lat: -34.7648,
    lng: -58.2113,
  },
];

export const GBA_STREET_NAMES = [
  "Av. Rivadavia",
  "Av. Mitre",
  "Av. San Martín",
  "Belgrano",
  "Sarmiento",
  "Moreno",
  "Av. Libertador",
  "9 de Julio",
  "Av. Presidente Perón",
  "Av. Hipólito Yrigoyen",
  "Av. Pavón",
  "Alberdi",
];
