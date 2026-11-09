"use client";
import { createContext, useContext, type ReactNode } from "react";
export interface WorkspaceSession {
  id: string;
  email: string;
  role: "teacher" | "admin";
}
const Context = createContext<WorkspaceSession | null>(null);
export function WorkspaceProvider({
  session,
  children,
}: {
  session: WorkspaceSession;
  children: ReactNode;
}) {
  return <Context.Provider value={session}>{children}</Context.Provider>;
}
export function useWorkspace() {
  const value = useContext(Context);
  if (!value) throw Error("Falta sesión del espacio académico");
  return value;
}
