import React, { useState } from 'react';
import { Share, MoreVertical, PlusSquare, X, Smartphone, ArrowDown, ArrowUp, Download } from 'lucide-react';

interface InstallTutorialProps {
  onClose: () => void;
}

export const InstallTutorial: React.FC<InstallTutorialProps> = ({ onClose }) => {
  // Detectar SO simple (por defecto Android, si es iOS cambiamos)
  const isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent) && !(window as any).MSStream;
  const [tab, setTab] = useState<'ios' | 'android'>(isIOS ? 'ios' : 'android');

  return (
    <div className="fixed inset-0 z-50 bg-black/90 backdrop-blur-sm flex items-center justify-center p-4 animate-fadeIn">
      <div className="bg-slate-800 w-full max-w-md rounded-2xl border border-slate-700 shadow-2xl overflow-hidden flex flex-col max-h-[90vh]">
        
        {/* Header */}
        <div className="bg-slate-900 p-4 flex justify-between items-center border-b border-slate-700">
          <h3 className="text-white font-bold text-lg flex items-center gap-2">
            <Smartphone className="text-yellow-400" /> Instalar App
          </h3>
          <button onClick={onClose} className="text-slate-400 hover:text-white bg-slate-800 p-1 rounded-full">
            <X size={24} />
          </button>
        </div>

        {/* Tabs */}
        <div className="flex bg-slate-900 border-b border-slate-700">
          <button 
            onClick={() => setTab('android')}
            className={`flex-1 py-3 text-sm font-bold transition ${tab === 'android' ? 'text-green-400 border-b-2 border-green-400 bg-slate-800' : 'text-slate-500 hover:text-white'}`}
          >
            Android (Chrome)
          </button>
          <button 
            onClick={() => setTab('ios')}
            className={`flex-1 py-3 text-sm font-bold transition ${tab === 'ios' ? 'text-blue-400 border-b-2 border-blue-400 bg-slate-800' : 'text-slate-500 hover:text-white'}`}
          >
            iPhone (Safari)
          </button>
        </div>

        {/* Content */}
        <div className="p-6 overflow-y-auto custom-scrollbar flex-1">
          
          {tab === 'ios' && (
            <div className="space-y-8 text-center">
              <div className="bg-blue-900/20 p-4 rounded-xl border border-blue-500/30">
                <p className="text-blue-200 text-sm mb-2 font-bold">Paso 1: Pulsa Compartir</p>
                <p className="text-slate-400 text-xs mb-4">Busca el icono en la barra inferior de Safari.</p>
                
                {/* Animation IOS Step 1 */}
                <div className="h-24 bg-slate-900 rounded-lg border border-slate-700 relative flex items-end justify-center pb-2 overflow-hidden mx-auto w-48">
                   <div className="w-full h-8 bg-slate-800 absolute bottom-0 border-t border-slate-600 flex justify-center items-center gap-8 px-4">
                      <div className="w-4 h-4 bg-slate-600 rounded-sm"></div>
                      <div className="w-4 h-4 bg-slate-600 rounded-sm"></div>
                      <Share className="text-blue-400 w-6 h-6" /> 
                      <div className="w-4 h-4 bg-slate-600 rounded-sm"></div>
                      <div className="w-4 h-4 bg-slate-600 rounded-sm"></div>
                   </div>
                   {/* Bouncing Arrow */}
                   <ArrowDown className="absolute bottom-10 text-yellow-400 animate-bounce w-8 h-8" />
                </div>
              </div>

              <div className="bg-blue-900/20 p-4 rounded-xl border border-blue-500/30">
                <p className="text-blue-200 text-sm mb-2 font-bold">Paso 2: Añadir a Inicio</p>
                <p className="text-slate-400 text-xs mb-4">Desliza hacia abajo y selecciona "Añadir a la pantalla de inicio".</p>
                
                 {/* Animation IOS Step 2 */}
                 <div className="bg-slate-100 text-slate-900 rounded-lg p-2 mx-auto w-56 text-left shadow-lg">
                    <div className="flex items-center gap-3 p-2 border-b border-slate-200 opacity-50">
                       <div className="w-5 h-5 bg-slate-300 rounded"></div>
                       <div className="h-2 w-24 bg-slate-300 rounded"></div>
                    </div>
                    <div className="flex items-center gap-3 p-2 bg-blue-50 border border-blue-200 rounded my-1">
                       <PlusSquare className="text-slate-600 w-5 h-5" />
                       <span className="text-xs font-bold">Añadir a inicio</span>
                       {/* Finger Pointer */}
                       <div className="absolute right-12 animate-pulse text-2xl">👈</div> 
                    </div>
                    <div className="flex items-center gap-3 p-2 border-b border-slate-200 opacity-50">
                       <div className="w-5 h-5 bg-slate-300 rounded"></div>
                       <div className="h-2 w-20 bg-slate-300 rounded"></div>
                    </div>
                 </div>
              </div>
            </div>
          )}

          {tab === 'android' && (
            <div className="space-y-8 text-center">
              <div className="bg-green-900/20 p-4 rounded-xl border border-green-500/30">
                <p className="text-green-200 text-sm mb-2 font-bold">Paso 1: Menú de Opciones</p>
                <p className="text-slate-400 text-xs mb-4">Pulsa los 3 puntos arriba a la derecha en Chrome.</p>
                
                {/* Animation Android Step 1 */}
                <div className="h-24 bg-slate-900 rounded-lg border border-slate-700 relative flex items-start justify-end pr-2 pt-2 overflow-hidden mx-auto w-48">
                   <div className="w-full h-8 bg-slate-800 absolute top-0 border-b border-slate-600 flex justify-between items-center px-2">
                      <div className="w-24 h-3 bg-slate-700 rounded-full"></div>
                      <MoreVertical className="text-green-400 w-5 h-5" /> 
                   </div>
                   {/* Bouncing Arrow */}
                   <div className="absolute top-8 right-2">
                      <ArrowUp className="text-yellow-400 animate-bounce w-8 h-8" />
                   </div>
                </div>
              </div>

              <div className="bg-green-900/20 p-4 rounded-xl border border-green-500/30">
                <p className="text-green-200 text-sm mb-2 font-bold">Paso 2: Instalar Aplicación</p>
                <p className="text-slate-400 text-xs mb-4">Selecciona "Instalar aplicación" o "Añadir a pantalla de inicio".</p>
                
                 {/* Animation Android Step 2 */}
                 <div className="bg-white text-slate-900 rounded-lg p-2 mx-auto w-48 text-left shadow-lg absolute-center">
                    <div className="absolute -right-4 top-8 text-3xl animate-pulse">👈</div>
                    <div className="space-y-2">
                       <div className="flex items-center gap-2 p-1 opacity-50">
                          <div className="w-4 h-4 bg-slate-300 rounded-full"></div>
                          <div className="h-2 w-20 bg-slate-300 rounded"></div>
                       </div>
                       <div className="flex items-center gap-2 p-2 bg-green-50 border border-green-200 rounded">
                          <Download className="w-4 h-4 text-slate-700"/>
                          <span className="text-xs font-bold">Instalar aplicación</span>
                       </div>
                       <div className="flex items-center gap-2 p-1 opacity-50">
                          <div className="w-4 h-4 bg-slate-300 rounded-full"></div>
                          <div className="h-2 w-16 bg-slate-300 rounded"></div>
                       </div>
                    </div>
                 </div>
              </div>
            </div>
          )}

        </div>

        <div className="bg-slate-900 p-4 border-t border-slate-700 text-center">
          <button 
            onClick={onClose}
            className="w-full bg-slate-700 hover:bg-slate-600 text-white font-bold py-3 rounded-xl transition"
          >
            Entendido
          </button>
        </div>
      </div>
    </div>
  );
};