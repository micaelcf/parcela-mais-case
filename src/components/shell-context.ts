import { createContext } from "react";

/**
 * The frame around the current page, if any. A page rendered in place of a route that brings its
 * own frame (an error page) reads it to add the public frame only where none is already around.
 */
export const ShellContext = createContext<"public" | "backoffice" | null>(null);
