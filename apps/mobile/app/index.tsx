import { Redirect } from "expo-router";
import { useSession } from "../src/context/session";

/**
 * `/` no tiene pantalla propia — `Stack.Protected` en `app/_layout.tsx`
 * declara `(driver)` y `login`/`onboarding`, pero ninguno matchea la ruta
 * raíz literal. En un dev client esto quedaba enmascarado (Metro suele
 * arrancar navegando directo a la última ruta abierta); en un build
 * standalone real, el link inicial es `fyc:///` (path vacío) y no matchea
 * nada → pantalla 404 de expo-router ("Unmatched Route"), la app nunca
 * llega a mostrar ni el login. Este archivo resuelve la raíz con un
 * redirect según sesión, mismo criterio que ya gatea las rutas protegidas.
 */
export default function Index() {
  const { session, isLoading } = useSession();
  if (isLoading) return null;
  return <Redirect href={session ? "/(driver)/(tabs)/ruta" : "/login"} />;
}
