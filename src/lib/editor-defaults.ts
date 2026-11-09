export const catalogDefaults: Record<string, string[]> = {
  area: [
    "MATEMÁTICA",
    "RELIGIÓN",
    "COMUNICACIÓN",
    "CIENCIAS NATURALES",
    "CIENCIAS SOCIALES",
    "EDUCACIÓN FÍSICA",
    "ARTE",
    "INGLÉS",
    "COMPUTACIÓN",
    "GEOMETRÍA",
  ],
  teacher: ["LUIS TORRES", "MARÍA GARCÍA"],
  grade: ["1", "2", "3", "4", "5", "6"],
  level: ["INICIAL", "PRIMARIA", "SECUNDARIA"],
  bimester: ["BIMESTRE I", "BIMESTRE II", "BIMESTRE III", "BIMESTRE IV"],
  unit: ["UNIDAD 1", "UNIDAD 2", "UNIDAD 3"],
  subarea: ["ÁLGEBRA", "ARITMÉTICA", "GEOMETRÍA", "RAZONAMIENTO MATEMÁTICO"],
  institution: ["COLEGIO CRAMER"],
  section: [],
  topic: [],
  competency: [],
};
export const builtInAssets = [
  {
    id: "builtin:1.jpg",
    kind: "headerFirst",
    label: "Encabezado 1",
    url: "/institutional/1.jpg",
  },
  {
    id: "builtin:2.jpg",
    kind: "headerFirst",
    label: "Encabezado 2",
    url: "/institutional/2.jpg",
  },
  {
    id: "builtin:3.png",
    kind: "headerFollowing",
    label: "Evaluación de proceso",
    url: "/institutional/3.png",
  },
  {
    id: "builtin:4.png",
    kind: "headerFollowing",
    label: "Evaluación de unidad",
    url: "/institutional/4.png",
  },
  {
    id: "builtin:5.png",
    kind: "headerFollowing",
    label: "Practicramer",
    url: "/institutional/5.png",
  },
  {
    id: "builtin:fc.png",
    kind: "centralImage",
    label: "Img 1 · Insignia Cramer",
    url: "/institutional/fc.png",
  },
];
export const institutionalDefaults = {
  frame: "curved",
  email: "contacto@cramer.com.pe",
  phone: "961 055 829",
  facebook: "Colegio Cramer | Huacho",
  headerFirst: "",
  headerFollowing: "",
  centralImage: "builtin:fc.png",
  watermark: "",
  footerPageLabel: "Página {pagina} de {total}",
  studentLabel: "Apellidos y nombres",
  showFooter: true,
};
export type Institutional = typeof institutionalDefaults &
  Record<string, unknown>;
export function defaultExamSettings() {
  return {
    institution: "COLEGIO CRAMER",
    institutional: { ...institutionalDefaults },
    scoringMode: "manual",
    total: 40,
    instructions: "",
    columns: 2,
    date: "",
    teacherName: "",
    subarea: "",
    studentName: "",
    localQuestions: [],
  };
}
