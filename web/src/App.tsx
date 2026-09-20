import { useEffect, useState } from "react";
import { Layout, type View } from "./components/Layout.tsx";
import { Interventions } from "./pages/Interventions.tsx";
import { SessionView } from "./pages/SessionView.tsx";
import { Catalog } from "./pages/Catalog.tsx";

/**
 * Deliberately no router dependency. The console has three views, and the only
 * deep link that matters operationally is a single intervention — an operator
 * is handed a URL and needs to land on the right session. A hash is enough for
 * that. If the console grows real navigation, react-router drops in here and
 * nothing else changes.
 */
function useHashRoute(): [View, string | null] {
  const parse = (): [View, string | null] => {
    const h = window.location.hash.replace(/^#\/?/, "");
    const [head, id] = h.split("/");
    if (head === "session" && id) return ["session", id];
    if (head === "catalog") return ["catalog", null];
    return ["interventions", null];
  };
  const [route, setRoute] = useState(parse);
  useEffect(() => {
    const on = () => setRoute(parse());
    window.addEventListener("hashchange", on);
    return () => window.removeEventListener("hashchange", on);
  }, []);
  return route;
}

export default function App() {
  const [view, id] = useHashRoute();
  return (
    <Layout view={view}>
      {view === "interventions" && <Interventions />}
      {view === "session" && id && <SessionView interventionId={id} />}
      {view === "catalog" && <Catalog />}
    </Layout>
  );
}
