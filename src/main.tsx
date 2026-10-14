import { createRoot } from "react-dom/client";
import "@fontsource/kanit/400.css";
import "@fontsource/kanit/600.css";
import "@fontsource/kanit/800-italic.css";
import "@fontsource/ibm-plex-sans-thai/400.css";
import "@fontsource/ibm-plex-sans-thai/600.css";
import "./index.css";
import { Home } from "./Home.tsx";
import { RoomView } from "./RoomView.tsx";
import { useRoute } from "./ui.tsx";

function App() {
  const { code, tab } = useRoute();
  return code ? <RoomView key={code} code={code} tab={tab} /> : <Home />;
}

createRoot(document.getElementById("root")!).render(<App />);

// Lets the app open with no signal at all. Service workers need https or
// localhost, so on a plain-http LAN this silently does nothing.
if (import.meta.env.PROD && "serviceWorker" in navigator) {
  navigator.serviceWorker.register("/sw.js").catch(() => {});
}
