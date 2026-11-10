"use client";

import dynamic from "next/dynamic";

const Records = dynamic(() => import("./records").then((m) => m.Records));
const ExamEditor = dynamic(() =>
  import("./exam-editor").then((m) => m.ExamEditor),
);
const Scanner = dynamic(() => import("./scanner").then((m) => m.Scanner));
const Results = dynamic(() => import("./results").then((m) => m.Results));
const SettingsPanel = dynamic(() =>
  import("./settings").then((m) => m.SettingsPanel),
);
const AdminPanel = dynamic(() =>
  import("./admin-panel").then((m) => m.AdminPanel),
);
const QuestionBank = dynamic(() =>
  import("./question-bank").then((m) => m.QuestionBank),
);

export function WorkspaceModule({ module }: { module: string }) {
  switch (module) {
    case "administracion":
      return <AdminPanel />;
    case "preguntas":
      return <QuestionBank />;
    case "alumnos":
    case "docentes":
      return <Records key={module} module={module} />;
    case "examenes":
      return <ExamEditor />;
    case "escaner":
      return <Scanner />;
    case "resultados":
    case "correccion":
    case "reportes":
      return <Results key={module} mode={module} />;
    case "configuracion":
      return <SettingsPanel />;
    default:
      return null;
  }
}
