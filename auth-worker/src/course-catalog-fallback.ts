type CourseCatalogFallbackCourse = {
  readonly id: number;
  readonly name: string;
  readonly location: string;
  readonly udisc_url: string;
  readonly lat: number;
  readonly lng: number;
  readonly is_default: number;
  readonly created_by: null;
  readonly created_at: string;
  readonly udisc_course_id: null;
};

type CourseCatalogFallbackLayout = {
  readonly id: number;
  readonly course_id: number;
  readonly name: string;
  readonly holes: string;
  readonly total_par: number;
  readonly created_at: string;
};

const ECU_NORTH_REC_COURSE = {
  id: 1,
  name: "ECU North Rec Complex",
  location: "Greenville, NC",
  udisc_url: "https://udisc.com/courses/ecu-north-recreational-complex-HbME",
  lat: 35.631092,
  lng: -77.319923,
  is_default: 1,
  created_by: null,
  created_at: "2026-06-29 03:07:16",
  udisc_course_id: null,
} as const satisfies CourseCatalogFallbackCourse;

const PEE_DEES_TREASURE_MAP_LAYOUT = {
  id: 11,
  course_id: 1,
  name: "Pee Dee's Treasure Map",
  holes: JSON.stringify([
    { hole: 1, par: 3, distance_ft: 351 },
    { hole: 2, par: 3, distance_ft: 325 },
    { hole: 3, par: 3, distance_ft: 155 },
    { hole: 4, par: 3, distance_ft: 366 },
    { hole: 5, par: 3, distance_ft: 267 },
    { hole: 6, par: 3, distance_ft: 245 },
    { hole: 7, par: 3, distance_ft: 308 },
    { hole: 8, par: 3, distance_ft: 239 },
    { hole: 9, par: 3, distance_ft: 270 },
    { hole: 10, par: 3, distance_ft: 362 },
    { hole: 11, par: 3, distance_ft: 324 },
    { hole: 12, par: 3, distance_ft: 339 },
    { hole: 13, par: 3, distance_ft: 307 },
    { hole: 14, par: 3, distance_ft: 394 },
    { hole: 15, par: 3, distance_ft: 360 },
    { hole: 16, par: 3, distance_ft: 385 },
    { hole: 17, par: 3, distance_ft: 265 },
    { hole: 18, par: 3, distance_ft: 367 },
  ]),
  total_par: 54,
  created_at: "2026-06-29 21:43:12",
} as const satisfies CourseCatalogFallbackLayout;

const FALLBACK_COURSES = [ECU_NORTH_REC_COURSE] as const;
const FALLBACK_LAYOUTS = [PEE_DEES_TREASURE_MAP_LAYOUT] as const;

export function fallbackCourses(): CourseCatalogFallbackCourse[] {
  return FALLBACK_COURSES.map((course) => ({ ...course }));
}

export function fallbackCourse(id: number): CourseCatalogFallbackCourse | null {
  return fallbackCourses().find((course) => course.id === id) ?? null;
}

export function fallbackLayouts(courseId: number): CourseCatalogFallbackLayout[] {
  return FALLBACK_LAYOUTS.filter((layout) => layout.course_id === courseId).map((layout) => ({ ...layout }));
}

export function fallbackLayout(id: number): CourseCatalogFallbackLayout | null {
  return FALLBACK_LAYOUTS.find((layout) => layout.id === id) ?? null;
}

export function fallbackLayoutNames(courseId: number): { id: number; name: string }[] {
  return fallbackLayouts(courseId).map((layout) => ({ id: layout.id, name: layout.name }));
}
