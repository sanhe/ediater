import { createContext, useContext, type Dispatch } from "react";
import type { SessionData } from "./session/sessionData";
import type { SessionAction } from "./session/reducer";

/**
 * Shared workspace context so deeply-nested panel bodies (rendered by the
 * docking layout via the panel registry) can read session state and trigger
 * actions without prop-drilling through the layout tree.
 */
export interface WorkspaceContextValue {
  session: SessionData;
  dispatch: Dispatch<SessionAction>;
  /** Open the folder picker and load the chosen folder as the project. */
  openFolder: () => Promise<void>;
  /** Open a file in the editor (wired in the editor milestone). */
  openFile: (path: string) => void;
}

const WorkspaceContext = createContext<WorkspaceContextValue | null>(null);

export const WorkspaceProvider = WorkspaceContext.Provider;

export function useWorkspace(): WorkspaceContextValue {
  const ctx = useContext(WorkspaceContext);
  if (!ctx) {
    throw new Error("useWorkspace must be used within WorkspaceProvider");
  }
  return ctx;
}
