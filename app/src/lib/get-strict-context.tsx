import * as React from "react";

function getStrictContext<T>(name?: string): readonly [React.Provider<T | undefined>, () => T] {
  const Context = React.createContext<T | undefined>(undefined);

  const useSafeContext = () => {
    const ctx = React.useContext(Context);
    if (ctx === undefined) {
      throw new Error(`useContext must be used within ${name ?? "a Provider"}`);
    }
    return ctx;
  };

  return [Context.Provider, useSafeContext] as const;
}

export { getStrictContext };
