import { Settings, User, Bell, Shield, Database } from "lucide-react";

export default function Configuracoes() {
  return (
    <div className="h-full flex flex-col bg-slate-50">
      <div className="p-6 bg-white border-b border-slate-200">
        <div className="flex items-center justify-between">
          <div>
            <h2 className="text-2xl font-semibold mb-1">Configurações</h2>
            <p className="text-slate-600">Gerencie preferências e configurações da plataforma</p>
          </div>
        </div>
      </div>

      <div className="flex-1 p-6">
        <div className="max-w-4xl mx-auto space-y-4">
          <div className="bg-white border-2 border-slate-200 rounded-lg p-6 hover:border-blue-400 cursor-pointer transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-blue-100 rounded-lg flex items-center justify-center">
                <User className="w-6 h-6 text-blue-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">Perfil da organização</h3>
                <p className="text-sm text-slate-600">Gerencie informações da produtora e usuários</p>
              </div>
            </div>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-lg p-6 hover:border-blue-400 cursor-pointer transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-green-100 rounded-lg flex items-center justify-center">
                <Bell className="w-6 h-6 text-green-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">Notificações</h3>
                <p className="text-sm text-slate-600">Configure alertas de prazos e atualizações</p>
              </div>
            </div>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-lg p-6 hover:border-blue-400 cursor-pointer transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-purple-100 rounded-lg flex items-center justify-center">
                <Database className="w-6 h-6 text-purple-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">Integrações</h3>
                <p className="text-sm text-slate-600">Conecte com ferramentas externas e APIs</p>
              </div>
            </div>
          </div>

          <div className="bg-white border-2 border-slate-200 rounded-lg p-6 hover:border-blue-400 cursor-pointer transition-colors">
            <div className="flex items-center gap-4">
              <div className="w-12 h-12 bg-red-100 rounded-lg flex items-center justify-center">
                <Shield className="w-6 h-6 text-red-600" />
              </div>
              <div className="flex-1">
                <h3 className="font-semibold mb-1">Segurança e privacidade</h3>
                <p className="text-sm text-slate-600">Gerencie permissões e controle de acesso</p>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
