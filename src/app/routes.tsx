import { createBrowserRouter } from "react-router";
import Layout from "./components/Layout";
import RadarEditais from "./pages/RadarEditais";
import CRMOportunidades from "./pages/CRMOportunidades";
import BaseArtistas from "./pages/BaseArtistas";
import Documentos from "./pages/Documentos";
import Fontes from "./pages/Fontes";
import Configuracoes from "./pages/Configuracoes";

export const router = createBrowserRouter([
  {
    path: "/",
    Component: Layout,
    children: [
      { index: true, Component: RadarEditais },
      { path: "oportunidades", Component: CRMOportunidades },
      { path: "artistas", Component: BaseArtistas },
      { path: "documentos", Component: Documentos },
      { path: "fontes", Component: Fontes },
      { path: "configuracoes", Component: Configuracoes },
    ],
  },
]);
