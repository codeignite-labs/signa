import React from "react";
export let colorScheme: string | null = "light";
export function setColorScheme(value: string | null) {
  colorScheme = value;
}
export const useColorScheme = () => colorScheme;
export const StyleSheet = { create: (styles: object) => styles };
export const View = ({ children }: { children?: React.ReactNode }) => (
  <div>{children}</div>
);
export const Text = ({ children }: { children?: React.ReactNode }) => (
  <span>{children}</span>
);
export const ActivityIndicator = () => <div role="progressbar" />;
