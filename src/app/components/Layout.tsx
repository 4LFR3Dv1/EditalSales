import { Outlet, NavLink } from "react-router";
import { Radar, Briefcase, Users, FileText, Settings, Search, Plus, User, Globe } from "lucide-react";

export default function Layout() {
  return (
    <div className="flex h-screen bg-slate-50">
      {/* Sidebar */}
      <aside className="w-64 bg-slate-900 text-slate-100 flex flex-col">
        <div className="p-6 border-b border-slate-800">
          <h1 className="text-xl font-semibold">Edital Sales</h1>
          <p className="text-slate-400 text-sm mt-1">Produtora Cultural</p>
        </div>

        <nav className="flex-1 p-4 space-y-1">
          <NavLink
            to="/"
            end
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            <Radar className="w-5 h-5" />
            <span>Radar de Editais</span>
          </NavLink>

          <NavLink
            to="/oportunidades"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            <Briefcase className="w-5 h-5" />
            <span>CRM de Oportunidades</span>
          </NavLink>

          <NavLink
            to="/artistas"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            <Users className="w-5 h-5" />
            <span>Base de Artistas & Projetos</span>
          </NavLink>

          <NavLink
            to="/documentos"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            <FileText className="w-5 h-5" />
            <span>Documentos</span>
          </NavLink>

          <NavLink
            to="/fontes"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            <Globe className="w-5 h-5" />
            <span>Fontes</span>
          </NavLink>

          <NavLink
            to="/configuracoes"
            className={({ isActive }) =>
              `flex items-center gap-3 px-4 py-3 rounded-lg transition-colors ${
                isActive
                  ? "bg-slate-800 text-white"
                  : "text-slate-300 hover:bg-slate-800 hover:text-white"
              }`
            }
          >
            <Settings className="w-5 h-5" />
            <span>Configurações</span>
          </NavLink>
        </nav>

        <div className="p-4 border-t border-slate-800">
          <div className="text-xs text-slate-500">
            v1.0.0
          </div>
        </div>
      </aside>

      {/* Main content area */}
      <div className="flex-1 flex flex-col overflow-hidden">
        {/* Topbar */}
        <header className="bg-white border-b border-slate-200 px-6 py-3 flex items-center justify-between">
          <div className="flex items-center gap-4 flex-1">
            <div className="relative flex-1 max-w-xl">
              <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
              <input
                type="text"
                placeholder="Busca global..."
                className="w-full pl-10 pr-4 py-2 border border-slate-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
              />
            </div>
          </div>

          <div className="flex items-center gap-3">
            <NavLink
              to="/fontes"
              className="flex items-center gap-2 px-4 py-2 bg-slate-800 text-white rounded-lg hover:bg-slate-700 transition-colors"
            >
              <Globe className="w-4 h-4" />
              Fontes
            </NavLink>
            <NavLink
              to="/"
              end
              className="flex items-center gap-2 px-4 py-2 bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo edital
            </NavLink>
            <NavLink
              to="/artistas"
              className="flex items-center gap-2 px-4 py-2 bg-green-600 text-white rounded-lg hover:bg-green-700 transition-colors"
            >
              <Plus className="w-4 h-4" />
              Novo artista/projeto
            </NavLink>
            <button className="w-10 h-10 rounded-full bg-slate-700 flex items-center justify-center text-white hover:bg-slate-600 transition-colors">
              <User className="w-5 h-5" />
            </button>
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-hidden">
          <Outlet />
        </main>
      </div>
    </div>
  );
}
