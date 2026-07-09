
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  User, MapPin, CheckCircle, 
  LogOut, Coffee, ArrowRight, ShieldAlert, Lock, Fingerprint, Delete, UserPlus, Save, ChevronLeft, Calendar, History, Clock, Smartphone, X, Mic, MicOff, FileText, Cloud, ExternalLink, Briefcase, Phone, KeyRound, BellRing, Search, Download, CalendarDays, Zap, Wrench, Package, Info, Plus, Trash2, Timer, Filter, ChevronDown, Shield, AlertTriangle, AlertCircle, Image as ImageIcon, Upload, ClipboardList, Sun, Moon, Eye, MessageSquare, Send, Mail
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { StorageService, ELECTRICAL_TOOLS_LIST, ELECTRICAL_BRANDS_LIST, compressImage } from './services/storageService';
import { LocationService } from './services/locationService';
import { TelegramService } from './services/telegramService';
import { Worker, Site, WorkLog, LogType, GeoLocationData, WorkMode, AdminUser, ToolRecord, AppConfig, WeeklyReport, Payslip, ChatMessage } from './types';
import { AdminPanel } from './components/AdminPanel';
import { InstallTutorial } from './components/InstallTutorial';
import { ConfirmationModal } from './components/ConfirmationModal';

enum Step {
  LOGIN_PHONE = 0,
  WORKER_DASHBOARD = 15,
  WORKER_HISTORY = 16,
  WORKER_TOOLS = 17,
  WORKER_REPORTS = 18,
  WORKER_PAYSLIPS = 19,
  WORKER_PROFILE = 20,
  WORKER_SETTINGS = 21,
  WORKER_CHAT = 22,
  SELECT_SITE = 2,
  SELECT_ACTION = 3,
  REPORT_EXIT = 4, 
  SUCCESS = 5,
  REGISTER = 99,
  RECOVERY = 100
}

const MAX_DISTANCE_METERS = 500;
const MONTH_NAMES = [
  "Enero", "Febrero", "Marzo", "Abril", "Mayo", "Junio",
  "Julio", "Agosto", "Septiembre", "Octubre", "Noviembre", "Diciembre"
];

const formatMsToTime = (ms: number) => {
  const hours = Math.floor(ms / 3600000);
  const minutes = Math.floor((ms % 3600000) / 60000);
  const seconds = Math.floor((ms % 60000) / 1000);
  return `${hours.toString().padStart(2, '0')}:${minutes.toString().padStart(2, '0')}:${seconds.toString().padStart(2, '0')}`;
};

const calculateTotalsFromLogs = (logs: WorkLog[]) => {
  const sorted = [...logs].sort((a, b) => a.timestamp - b.timestamp);
  let totalWork = 0;
  let totalBreak = 0;
  let lastWorkStart: number | null = null;
  let lastBreakStart: number | null = null;
  let currentState: LogType | null = null;

  sorted.forEach(log => {
    if (log.type === LogType.ENTRADA || log.type === LogType.FIN_DESCANSO) {
      if (lastBreakStart && currentState === LogType.INICIO_DESCANSO) {
        totalBreak += Math.max(0, log.timestamp - lastBreakStart);
      }
      lastBreakStart = null;
      lastWorkStart = log.timestamp;
      currentState = log.type;
    } else if (log.type === LogType.INICIO_DESCANSO) {
      if (lastWorkStart && (currentState === LogType.ENTRADA || currentState === LogType.FIN_DESCANSO)) {
        totalWork += Math.max(0, log.timestamp - lastWorkStart);
      }
      lastWorkStart = null;
      lastBreakStart = log.timestamp;
      currentState = log.type;
    } else if (log.type === LogType.SALIDA) {
      if (lastWorkStart && (currentState === LogType.ENTRADA || currentState === LogType.FIN_DESCANSO)) {
        totalWork += Math.max(0, log.timestamp - lastWorkStart);
      }
      if (lastBreakStart && currentState === LogType.INICIO_DESCANSO) {
        totalBreak += Math.max(0, log.timestamp - lastBreakStart);
      }
      lastWorkStart = null;
      lastBreakStart = null;
      currentState = LogType.SALIDA;
    }
  });

  const isOngoing = currentState !== null && currentState !== LogType.SALIDA;
  if (isOngoing) {
    const now = Date.now();
    const isToday = logs.length > 0 && logs.some(l => l.dateStr === new Date().toLocaleDateString('es-ES'));
    if (isToday) {
      if (lastWorkStart) totalWork += Math.max(0, now - lastWorkStart);
      if (lastBreakStart) totalBreak += Math.max(0, now - lastBreakStart);
    }
  }
  return { totalWork, totalBreak, isOngoing };
};

const AppLogo = ({ className, size = "md", logoUrl, scale = 1.0 }: { className?: string, size?: "sm" | "md" | "lg", logoUrl?: string, scale?: number }) => {
  const baseSize = size === "sm" ? 28 : size === "md" ? 64 : size === "lg" ? 140 : 64;
  const iconSize = baseSize * scale;
  const logoSrc = logoUrl || "/logo.png";
  return (
    <div className={`relative flex items-center justify-center ${className}`}>
      <img 
        src={logoSrc} 
        alt="Company Logo" 
        style={{ width: iconSize, height: iconSize }} 
        className="object-contain rounded-2xl logo-glow"
      />
    </div>
  );
};

export const App: React.FC = () => {
  const [theme, setTheme] = useState<'light' | 'dark'>(() => (localStorage.getItem('theme') as 'light' | 'dark') || 'light');

  useEffect(() => {
    localStorage.setItem('theme', theme);
    if (theme === 'dark') {
      document.body.classList.add('dark-theme');
    } else {
      document.body.classList.remove('dark-theme');
    }
  }, [theme]);

  const [isAppLoading, setIsAppLoading] = useState(true);
  const [isAdmin, setIsAdmin] = useState(false);
  const [currentAdminUser, setCurrentAdminUser] = useState<AdminUser | null>(null);
  const [currentStep, setCurrentStep] = useState<Step>(Step.LOGIN_PHONE);
  const [showAdminLogin, setShowAdminLogin] = useState(false);
  const [adminUsernameInput, setAdminUsernameInput] = useState(''); 
  const [adminPasswordInput, setAdminPasswordInput] = useState('');
  const [adminError, setAdminError] = useState('');
  const [loginPhone, setLoginPhone] = useState('');
  const [selectedWorker, setSelectedWorker] = useState<Worker | null>(null);
  const [selectedSite, setSelectedSite] = useState<Site | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [confirmState, setConfirmState] = useState<{isOpen: boolean; action: LogType | null;}>({ isOpen: false, action: null });
  const [currentTime, setCurrentTime] = useState(new Date());
  const [appConfig, setAppConfig] = useState<AppConfig>(StorageService.getConfig());
  
  // History and Tools state
  const [historySearch, setHistorySearch] = useState('');
  const [toolSearch, setToolSearch] = useState('');
  const [historyPeriod, setHistoryPeriod] = useState<'ALL' | 'DAY' | 'WEEK' | 'MONTH'>('ALL');
  const [selectedMonth, setSelectedMonth] = useState(new Date().getMonth());
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().split('T')[0]);
  const [allTools, setAllTools] = useState<ToolRecord[]>([]);
  
  // New Tool Form State
  const [isToolModalOpen, setIsToolModalOpen] = useState(false);
  const [newToolForm, setNewToolForm] = useState({ name: '', brand: '', model: '' });

  // Worker Profile States and Refs
  const workerPhotoInputRef = useRef<HTMLInputElement>(null);
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const chatEndRef = useRef<HTMLDivElement>(null);
  const [certNameInput, setCertNameInput] = useState('');
  
  const [exitReportText, setExitReportText] = useState('');
  const [exitWorkMode, setExitWorkMode] = useState<WorkMode>('HORAS');
  const [pinInput, setPinInput] = useState('');
  const [regName, setRegName] = useState('');
  const [regDni, setRegDni] = useState('');
  const [regPhone, setRegPhone] = useState('');
  const [regEmail, setRegEmail] = useState('');
  const [forceEmailInput, setForceEmailInput] = useState('');
  const [forceEmailError, setForceEmailError] = useState('');
  const [regPin, setRegPin] = useState('');
  const [regPinConfirm, setRegPinConfirm] = useState('');
  const [workerLogs, setWorkerLogs] = useState<WorkLog[]>([]);
  const [workers, setWorkers] = useState<Worker[]>([]);
  const [sites, setSites] = useState<Site[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);

  // New states for Reports and Payslips
  const [myReports, setMyReports] = useState<WeeklyReport[]>([]);
  const [myPayslips, setMyPayslips] = useState<Payslip[]>([]);
  const [reportPhoto, setReportPhoto] = useState<string | null>(null);
  const [reportStartDate, setReportStartDate] = useState('');
  const [reportEndDate, setReportEndDate] = useState('');
  const [reportComments, setReportComments] = useState('');
  const [submittingReport, setSubmittingReport] = useState(false);
  const [selectedPayslipMonth, setSelectedPayslipMonth] = useState(new Date().toISOString().substring(0, 7));
  const [previewPhotoUrl, setPreviewPhotoUrl] = useState<string | null>(null);

  // Chat states
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [activeChatPartnerId, setActiveChatPartnerId] = useState<string | null>(null);
  const [chatMessageInput, setChatMessageInput] = useState('');

  // iOS 26 Push Notifications state
  const [pushNotifications, setPushNotifications] = useState<any[]>([]);
  
  const selectedWorkerRef = useRef<Worker | null>(null);
  const isAdminRef = useRef<boolean>(false);
  const mountTimeRef = useRef<number>(Date.now());
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedWorkerRef.current = selectedWorker;
  }, [selectedWorker]);

  useEffect(() => {
    isAdminRef.current = isAdmin;
  }, [isAdmin]);

  const triggerPushNotification = (title: string, body: string, type: 'chat' | 'log' | 'system', senderId?: string, icon?: string) => {
    const id = Math.random().toString(36).substring(2, 11);
    const newNotif = {
      id,
      title,
      body,
      type,
      senderId,
      icon,
      timestamp: Date.now()
    };
    setPushNotifications(prev => [newNotif, ...prev].slice(0, 4));
    setTimeout(() => {
      setPushNotifications(prev => prev.filter(n => n.id !== id));
    }, 5000);

    // Subtle premium web audio haptic beep/ding
    try {
      const audioCtx = new (window.AudioContext || (window as any).webkitAudioContext)();
      const osc = audioCtx.createOscillator();
      const gain = audioCtx.createGain();
      osc.type = 'sine';
      osc.frequency.setValueAtTime(800, audioCtx.currentTime); 
      osc.frequency.exponentialRampToValueAtTime(1200, audioCtx.currentTime + 0.12); 
      gain.gain.setValueAtTime(0.04, audioCtx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, audioCtx.currentTime + 0.25);
      osc.connect(gain);
      gain.connect(audioCtx.destination);
      osc.start();
      osc.stop(audioCtx.currentTime + 0.25);
    } catch (e) {
      // Audio context may be blocked by browser autoplay rules
    }
  };

  const handleNotificationClick = (notif: any) => {
    if (notif.type === 'chat' && notif.senderId) {
      setActiveChatPartnerId(notif.senderId);
      setCurrentStep(Step.WORKER_CHAT);
      // Clean selected notification
      setPushNotifications(prev => prev.filter(n => n.id !== notif.id));
    }
  };


  useEffect(() => {
    const timer = setTimeout(() => setIsAppLoading(false), 2000);
    const interval = setInterval(() => setCurrentTime(new Date()), 1000);
    
    // Load data from storage
    const storedWorkers = StorageService.getWorkers();
    setWorkers(storedWorkers);
    setSites(StorageService.getSites());
    setWorkerLogs(StorageService.getLogs()); 
    setAdmins(StorageService.getAdmins());
    setAllTools(StorageService.getTools());
    setAppConfig(StorageService.getConfig());
    setChats(StorageService.getChats());

    // Check for existing session
    const savedWorkerId = localStorage.getItem('carmagne_session_worker_id');
    if (savedWorkerId) {
      const worker = storedWorkers.find(w => w.id === savedWorkerId);
      if (worker && worker.active) {
        setSelectedWorker(worker);
        setCurrentStep(Step.WORKER_DASHBOARD);
      }
    }

    const unsubWorkers = StorageService.subscribeToWorkers((ws) => {
      setWorkers(ws);
      // Update session if worker data changed
      const currentId = localStorage.getItem('carmagne_session_worker_id');
      if (currentId) {
        const found = ws.find(w => w.id === currentId);
        if (found) setSelectedWorker(found);
      }
    });
    const unsubSites = StorageService.subscribeToSites(setSites);
    const unsubLogs = StorageService.subscribeToLogs((newLogs) => {
      setWorkerLogs(newLogs);
      newLogs.forEach(log => {
        if (log.timestamp > mountTimeRef.current && !notifiedIdsRef.current.has(log.id)) {
          notifiedIdsRef.current.add(log.id);
          const isFromMe = selectedWorkerRef.current && log.workerId === selectedWorkerRef.current.id;
          if (!isFromMe) {
            const actionEmoji = log.type === LogType.ENTRADA ? '🚀' : log.type === LogType.SALIDA ? '🚪' : '⏱️';
            const cleanType = log.type.replace('_', ' ');
            triggerPushNotification(
              `${actionEmoji} ${log.workerName}`,
              `${cleanType} en ${log.siteName}`,
              'log',
              undefined,
              actionEmoji
            );
          }
        }
      });
    });
    const unsubAdmins = StorageService.subscribeToAdmins(setAdmins);
    const unsubTools = StorageService.subscribeToTools(setAllTools);
    const unsubConfig = StorageService.subscribeToConfig(setAppConfig);
    const unsubReports = StorageService.subscribeToReports(setMyReports);
    const unsubPayslips = StorageService.subscribeToPayslips(setMyPayslips);
    const unsubChats = StorageService.subscribeToChats((newChats) => {
      setChats(newChats);
      newChats.forEach(msg => {
        if (msg.timestamp > mountTimeRef.current && !notifiedIdsRef.current.has(msg.id)) {
          notifiedIdsRef.current.add(msg.id);
          const activeWorker = selectedWorkerRef.current;
          const isAdminView = isAdminRef.current;
          const isForMe = (activeWorker && msg.receiverId === activeWorker.id) || (isAdminView && msg.receiverId === 'ADMIN');
          const isFromMe = (activeWorker && msg.senderId === activeWorker.id) || (isAdminView && msg.senderId === 'ADMIN');
          if (isForMe && !isFromMe) {
            triggerPushNotification(
              msg.senderName === 'El Jefe' ? '👑 EL JEFE' : `💬 ${msg.senderName}`,
              msg.text,
              'chat',
              msg.senderId,
              msg.senderId === 'ADMIN' ? '👑' : '💬'
            );
          }
        }
      });
    });
    return () => {
      clearTimeout(timer); clearInterval(interval);
      unsubWorkers(); unsubSites(); unsubLogs(); unsubAdmins(); unsubTools(); unsubConfig(); unsubReports(); unsubPayslips(); unsubChats();
    };
  }, []);

  // Worker tools filtered list
  const workerTools = useMemo(() => {
    if (!selectedWorker) return [];
    let base = allTools.filter(t => t.workerId === selectedWorker.id);
    if (toolSearch) {
      const q = toolSearch.toLowerCase();
      base = base.filter(t => t.toolName.toLowerCase().includes(q) || t.brand.toLowerCase().includes(q));
    }
    return base;
  }, [allTools, selectedWorker, toolSearch]);

  const unreadChatsCount = useMemo(() => {
    if (!selectedWorker) return 0;
    return chats.filter(c => c.receiverId === selectedWorker.id && !c.read).length;
  }, [chats, selectedWorker]);

  const filteredHistory = useMemo(() => {
    if (!selectedWorker) return [];
    let baseHistory = workerLogs.filter(l => l.workerId === selectedWorker.id);
    if (historyPeriod === 'DAY') {
      const pickedDateStr = new Date(selectedDate).toLocaleDateString('es-ES');
      baseHistory = baseHistory.filter(l => l.dateStr === pickedDateStr);
    } else if (historyPeriod === 'WEEK') {
      const pickedDate = new Date(selectedDate);
      const day = pickedDate.getDay();
      const diffToMonday = pickedDate.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(pickedDate);
      startOfWeek.setDate(diffToMonday);
      startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek);
      endOfWeek.setDate(startOfWeek.getDate() + 6);
      endOfWeek.setHours(23, 59, 59, 999);
      baseHistory = baseHistory.filter(l => l.timestamp >= startOfWeek.getTime() && l.timestamp <= endOfWeek.getTime());
    } else if (historyPeriod === 'MONTH') {
      baseHistory = baseHistory.filter(l => {
        const logDate = new Date(l.timestamp);
        return logDate.getMonth() === selectedMonth && logDate.getFullYear() === new Date().getFullYear();
      });
    }
    if (historySearch) {
      const q = historySearch.toLowerCase();
      baseHistory = baseHistory.filter(l => l.siteName.toLowerCase().includes(q) || (l.workReport || '').toLowerCase().includes(q));
    }
    return baseHistory;
  }, [workerLogs, selectedWorker, historySearch, historyPeriod, selectedMonth, selectedDate]);

  const historyTotals = useMemo(() => calculateTotalsFromLogs(filteredHistory), [filteredHistory, currentTime]);

  const handleDownloadPDF = () => {
    if (!selectedWorker) return;
    const doc = new jsPDF();
    doc.setFontSize(18);
    doc.setTextColor(15, 23, 42);
    doc.text("Historial de Actividad - CARMAGNE INSTAL SL", 105, 15, { align: 'center' });
    doc.setFillColor(248, 250, 252);
    doc.roundedRect(14, 30, 182, 20, 2, 2, 'F');
    doc.setFontSize(9);
    doc.setTextColor(71, 85, 105);
    doc.text(`Trabajo Neto: ${formatMsToTime(historyTotals.totalWork)} | Descanso: ${formatMsToTime(historyTotals.totalBreak)} | Total: ${formatMsToTime(historyTotals.totalWork + historyTotals.totalBreak)}`, 20, 42);
    const tableData = filteredHistory.map(l => [l.dateStr, l.timeStr, l.type, l.siteName, l.workMode || 'HORAS', l.workReport || '-']);
    autoTable(doc, {
      startY: 55, head: [['Fecha', 'Hora', 'Acción', 'Obra', 'Modo', 'Reporte']], body: tableData,
      headStyles: { fillColor: [15, 23, 42], textColor: [255, 255, 255], fontStyle: 'bold' }, styles: { fontSize: 8 }
    });
    doc.save(`Historial_${selectedWorker.name.replace(/\s+/g, '_')}_${new Date().getTime()}.pdf`);
  };

  const processSpanishPhone = (phone: string): string => {
    let cleaned = phone.trim().replace(/\s/g, '');
    if (cleaned.startsWith('0034')) cleaned = '+34' + cleaned.slice(4);
    if (cleaned.length === 9 && /^[6789]/.test(cleaned)) cleaned = '+34' + cleaned;
    if (cleaned.startsWith('34') && cleaned.length === 11) cleaned = '+' + cleaned;
    return cleaned;
  };
  const isPhoneValidSpain = (phone: string): boolean => /^\+34[6789]\d{8}$/.test(phone);

  const workerStatus = useMemo(() => {
    if (!selectedWorker) return null;
    const today = new Date().toLocaleDateString('es-ES');
    const allTodayLogs = workerLogs.filter(l => l.workerId === selectedWorker.id && l.dateStr === today).slice().reverse();
    let lastSalidaIndex = -1;
    for (let i = allTodayLogs.length - 1; i >= 0; i--) { if (allTodayLogs[i].type === LogType.SALIDA) { lastSalidaIndex = i; break; } }
    const currentSessionLogs = lastSalidaIndex === -1 ? allTodayLogs : allTodayLogs.slice(lastSalidaIndex + 1);
    let accumulatedWorkTime = 0; let accumulatedBreakTime = 0;
    let currentWorkStart: number | null = null; let currentBreakStart: number | null = null;
    let currentState: 'INACTIVO' | 'TRABAJANDO' | 'DESCANSO' = 'INACTIVO';
    let currentSite = null; let currentSiteId = null;
    for (const log of currentSessionLogs) {
      if (log.type === LogType.ENTRADA || log.type === LogType.FIN_DESCANSO) {
        if (currentBreakStart) { accumulatedBreakTime += (log.timestamp - currentBreakStart); currentBreakStart = null; }
        currentWorkStart = log.timestamp; currentState = 'TRABAJANDO'; currentSite = log.siteName; currentSiteId = log.siteId;
      } else if (log.type === LogType.INICIO_DESCANSO) {
        if (currentWorkStart) { accumulatedWorkTime += (log.timestamp - currentWorkStart); currentWorkStart = null; }
        currentBreakStart = log.timestamp; currentState = 'DESCANSO'; currentSite = log.siteName; currentSiteId = log.siteId;
      }
    }
    return { type: currentState, site: currentSite, siteId: currentSiteId, accumulatedWorkTime, currentWorkStart, accumulatedBreakTime, currentBreakStart };
  }, [workerLogs, selectedWorker]);

  const getEffectiveWorkTime = () => {
    if (!workerStatus) return 0;
    let total = workerStatus.accumulatedWorkTime;
    if (workerStatus.type === 'TRABAJANDO' && workerStatus.currentWorkStart) total += (currentTime.getTime() - workerStatus.currentWorkStart);
    return total;
  };
  const getEffectiveBreakTime = () => {
    if (!workerStatus) return 0;
    let total = workerStatus.accumulatedBreakTime;
    if (workerStatus.type === 'DESCANSO' && workerStatus.currentBreakStart) total += (currentTime.getTime() - workerStatus.currentBreakStart);
    return total;
  };

  const handlePhoneLogin = () => {
    const formattedPhone = processSpanishPhone(loginPhone);
    if(!isPhoneValidSpain(formattedPhone)) { setError("Solo se permiten números de España (+34)"); return; }
    const worker = workers.find(w => w.phone && processSpanishPhone(w.phone) === formattedPhone);
    if (worker) {
      if (!worker.active) { setError("Cuenta desactivada."); return; }
      setSelectedWorker(worker); 
      localStorage.setItem('carmagne_session_worker_id', worker.id);
      setError(''); 
      setCurrentStep(Step.WORKER_DASHBOARD);
    } else if(confirm("Este número no está registrado. ¿Quieres crear una cuenta nueva?")) {
      setRegPhone(formattedPhone); setError(''); setCurrentStep(Step.REGISTER);
    }
  };

  const handleAddWorkerTool = async () => {
    if (!newToolForm.name || !newToolForm.brand || !selectedWorker) return;
    const tool: ToolRecord = {
      id: `T-W-${Date.now()}`,
      workerId: selectedWorker.id,
      workerName: selectedWorker.name,
      toolName: newToolForm.name,
      brand: newToolForm.brand,
      model: newToolForm.model,
      timestamp: Date.now(),
      dateStr: new Date().toLocaleDateString('es-ES'),
      timeStr: new Date().toLocaleTimeString('es-ES')
    };
    await StorageService.addTool(tool);

    // Notificación Telegram: Nueva Herramienta
    const telegramMessage = `🛠️ <b>Nueva Herramienta Registrada</b>\n👷‍♂️ Operario: <b>${selectedWorker.name}</b>\n🔧 Equipo: <b>${tool.toolName}</b>\n🏷️ Marca: ${tool.brand}\n📦 Modelo: ${tool.model || 'S/M'}`;
    TelegramService.enviarNotificacionTelegram(telegramMessage);

    setNewToolForm({ name: '', brand: '', model: '' });
    setIsToolModalOpen(false);
  };

  const handleRegistration = async () => {
    const fPhone = processSpanishPhone(regPhone);
    if (!regName || !regDni || !fPhone || !regEmail) { setError('Todos los campos son obligatorios, incluyendo el Correo Electrónico.'); return; }
    if (!isPhoneValidSpain(fPhone)) { setError('Solo números de España (+34)'); return; }
    if (!/\S+@\S+\.\S+/.test(regEmail)) { setError('El formato del correo electrónico no es válido.'); return; }
    setLoading(true);
    const newWorker: Worker = { 
      id: `W${Date.now()}`, 
      name: regName, 
      dni: regDni, 
      phone: fPhone, 
      email: regEmail,
      pin: '0000', 
      qrCode: `QR_${Date.now()}`, 
      active: true, 
      defaultMode: 'HORAS' 
    };
    try { 
      await StorageService.registerNewWorker(newWorker); 
      setSelectedWorker(newWorker); 
      localStorage.setItem('carmagne_session_worker_id', newWorker.id);

      // Notificación Telegram: Nuevo Operario
      const telegramMessage = `🆕 <b>Nuevo Operario Registrado</b>\n👷‍♂️ Nombre: <b>${newWorker.name}</b>\n🆔 DNI: ${newWorker.dni}\n📱 Teléfono: ${newWorker.phone}\n📧 Email: ${newWorker.email}`;
      TelegramService.enviarNotificacionTelegram(telegramMessage);

      setCurrentStep(Step.WORKER_DASHBOARD); 
    } catch (err) { setError('Error al registrar.'); } finally { setLoading(false); }
  };

  const handleSaveForceEmail = async () => {
    if (!forceEmailInput.trim()) {
      setForceEmailError('Por favor, introduce tu correo electrónico.');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(forceEmailInput)) {
      setForceEmailError('El formato del correo electrónico no es válido.');
      return;
    }
    setLoading(true);
    try {
      const updatedWorker = { ...selectedWorker!, email: forceEmailInput.trim() };
      const updatedWorkers = workers.map(w => w.id === selectedWorker!.id ? updatedWorker : w);
      await StorageService.saveWorkers(updatedWorkers);
      setSelectedWorker(updatedWorker);
      setForceEmailInput('');
      setForceEmailError('');

      const telegramMessage = `📧 <b>Correo Electrónico Registrado</b>\n👷‍♂️ Operario: <b>${updatedWorker.name}</b>\n📧 Email: ${updatedWorker.email}`;
      TelegramService.enviarNotificacionTelegram(telegramMessage);
    } catch (err) {
      setForceEmailError('Error al guardar el correo electrónico.');
    } finally {
      setLoading(false);
    }
  };

  const handlePinInput = (digit: string) => {
    if (pinInput.length < 4) {
      const newPin = pinInput + digit;
      setPinInput(newPin);
      if (newPin.length === 4) {
        if (selectedWorker?.pin === newPin) { setCurrentStep(Step.WORKER_DASHBOARD); setError(''); }
        else { setError('PIN Incorrecto'); setTimeout(() => setPinInput(''), 500); }
      }
    }
  };

  const handleActionSelect = (type: LogType) => {
    if (type === LogType.SALIDA) {
      if (workerStatus?.type === 'DESCANSO') { setError("Primero debes finalizar el descanso antes de dar salida."); return; }
      setCurrentStep(Step.REPORT_EXIT); return;
    }
    setConfirmState({ isOpen: true, action: type });
  };

  const executeLogSubmission = async (type: LogType, report?: string, mode?: WorkMode) => {
    setLoading(true);
    let loc: GeoLocationData | null = null;
    try {
      loc = await LocationService.getCurrentPosition();
    } catch (err) {
      console.warn("Ubicación no disponible para el fichaje:", err);
    }

    try {
      let distance = 0; let warning = false;
      const targetSite = selectedSite || sites.find(s => s.name === workerStatus?.site);
      
      if (loc && targetSite?.coordinates) {
        distance = LocationService.calculateDistance(loc.latitude, loc.longitude, targetSite.coordinates.latitude, targetSite.coordinates.longitude);
        if (distance > MAX_DISTANCE_METERS) warning = true;
      }

      const now = new Date();
      const actualLoc = loc || { latitude: 0, longitude: 0, accuracy: 0, address: 'Ubicación no disponible' };
      
      const newLog: WorkLog = { 
        id: `LOG-${Date.now()}`, 
        workerId: selectedWorker!.id, 
        workerName: selectedWorker!.name, 
        siteId: targetSite?.id || 'UNKNOWN', 
        siteName: targetSite?.name || workerStatus?.site || 'UNKNOWN', 
        type, 
        timestamp: Date.now(), 
        dateStr: now.toLocaleDateString('es-ES'), 
        timeStr: now.toLocaleTimeString('es-ES'), 
        location: actualLoc, 
        sentToWhatsapp: false, 
        syncedToSheets: false, 
        distanceMeters: distance, 
        locationWarning: warning, 
        workReport: report, 
        workMode: mode 
      };
      
      await StorageService.addLog(newLog); 
      
      // Send Telegram Notification
      const timeStr = now.toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' });
      const actionEmoji = type === LogType.ENTRADA ? '🚀' : type === LogType.SALIDA ? '🏠' : type === LogType.INICIO_DESCANSO ? '☕' : '⚙️';
      
      let locationText = '📍 Ubicación: No disponible';
      if (loc) {
        locationText = `📍 Ubicación: <a href="https://www.google.com/maps?q=${loc.latitude},${loc.longitude}">Ver en Google Maps</a>`;
      }

      const telegramMessage = `👷‍♂️ <b>${selectedWorker!.name}</b> ha marcado <b>${type}</b> a las <b>${timeStr}</b> ${actionEmoji}\n🏢 Obra: ${newLog.siteName}${report ? `\n📝 Reporte: ${report}` : ''}\n${locationText}`;
      
      TelegramService.enviarNotificacionTelegram(telegramMessage);

      setExitReportText('');
      setCurrentStep(Step.SUCCESS);
    } catch (err) { 
      setError('Error al registrar el fichaje.'); 
    } finally { 
      setLoading(false); 
      setConfirmState({ isOpen: false, action: null }); 
    }
  };

  const resetApp = () => { 
    localStorage.removeItem('carmagne_session_worker_id');
    setCurrentStep(Step.LOGIN_PHONE); 
    setSelectedWorker(null); 
    setSelectedSite(null); 
    setError(''); 
    setPinInput(''); 
    setLoginPhone(''); 
  };

  // Fix: Added the missing verifyAdminPassword function to handle admin panel authentication
  const verifyAdminPassword = () => {
    if (adminUsernameInput === 'admin' && adminPasswordInput === appConfig.adminPassword) {
      setIsAdmin(true);
      setCurrentAdminUser(null);
      setShowAdminLogin(false);
      setAdminError('');
      return;
    }

    const matchedAdmin = admins.find(a => a.username === adminUsernameInput && a.password === adminPasswordInput);
    if (matchedAdmin) {
      setIsAdmin(true);
      setCurrentAdminUser(matchedAdmin);
      setShowAdminLogin(false);
      setAdminError('');
    } else {
      setAdminError('Credenciales incorrectas');
    }
  };

  const renderWorkerDashboard = () => {
    // Get the 4 most recent logs of the worker sorted by timestamp descending
    const recentLogs = [...workerLogs]
      .filter(l => l.workerId === selectedWorker?.id)
      .sort((a, b) => b.timestamp - a.timestamp)
      .slice(0, 4);

    return (
      <div className="flex flex-col md:grid md:grid-cols-12 gap-5 md:h-full animate-fadeIn md:overflow-hidden text-[var(--text-main)]">
        {/* LEFT COLUMN: Profile & Actions (Widgets style) */}
        <div className="md:col-span-4 flex flex-col gap-4 md:justify-between md:h-full">
          {/* iOS Profile widget with glassmorphism */}
          <div className="bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] rounded-[2rem] p-5 shadow-[var(--panel-shadow)] relative overflow-hidden flex items-center justify-between group transition-all duration-300 shrink-0">
            <div className="flex items-center gap-3 cursor-pointer" onClick={() => setCurrentStep(Step.WORKER_PROFILE)}>
              {selectedWorker?.photoUrl ? (
                <img 
                  src={selectedWorker.photoUrl} 
                  alt={selectedWorker.name} 
                  className="w-12 h-12 rounded-full object-cover border border-white/20 shadow-md"
                />
              ) : (
                <div className="w-12 h-12 rounded-full bg-gradient-to-tr from-blue-500 to-indigo-600 flex items-center justify-center text-white font-black text-lg border border-white/20 shadow-md">
                  {selectedWorker?.name.charAt(0)}
                </div>
              )}
              <div>
                <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest block flex items-center gap-1 hover:text-white transition-colors">
                  <span>Operario</span>
                  <ExternalLink size={10} className="text-blue-400" />
                </span>
                <span className="text-base font-black text-[var(--text-main)] block leading-tight hover:text-[#CCFF00] transition-colors">{selectedWorker?.name}</span>
              </div>
            </div>
            {/* Action Buttons: Theme Switcher & Logout */}
            <div className="flex items-center gap-2">
              <button 
                onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
                className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-3 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] rounded-2xl active:scale-95 transition-all" 
                title={theme === 'dark' ? "Modo Claro" : "Modo Oscuro"}
              >
                {theme === 'dark' ? <Sun size={18} className="text-amber-400" /> : <Moon size={18} className="text-blue-400" />}
              </button>
              <button onClick={resetApp} className="text-[var(--text-muted)] hover:text-[var(--text-main)] p-3 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] rounded-2xl active:scale-95 transition-all" title="Cerrar Sesión">
                <LogOut size={18} />
              </button>
            </div>
          </div>

          {/* Quick Shortcuts Grid (iOS-style icon widgets) */}
          <div className="grid grid-cols-2 gap-3 md:flex-1 md:overflow-y-auto custom-scrollbar pr-1 shrink-0 pb-1">
            {/* Navigation: History */}
            <button onClick={() => setCurrentStep(Step.WORKER_HISTORY)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-emerald-500/30 transition-all duration-300">
              <div className="text-emerald-500 bg-emerald-500/10 p-3 rounded-2xl border border-emerald-500/10"><History size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Historial</span>
            </button>
            {/* Navigation: Tools */}
            <button onClick={() => setCurrentStep(Step.WORKER_TOOLS)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-amber-500/30 transition-all duration-300">
              <div className="text-amber-500 bg-amber-500/10 p-3 rounded-2xl border border-amber-500/10"><Wrench size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Equipos</span>
            </button>
            {/* Navigation: Reports */}
            <button onClick={() => setCurrentStep(Step.WORKER_REPORTS)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-cyan-500/30 transition-all duration-300">
              <div className="text-cyan-500 bg-cyan-500/10 p-3 rounded-2xl border border-cyan-500/10"><ClipboardList size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Partes IA</span>
            </button>
            {/* Navigation: Payslips */}
            <button onClick={() => setCurrentStep(Step.WORKER_PAYSLIPS)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-fuchsia-500/30 transition-all duration-300">
              <div className="text-fuchsia-500 bg-fuchsia-500/10 p-3 rounded-2xl border border-fuchsia-500/10"><FileText size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Nóminas</span>
            </button>
            {/* Navigation: Profile */}
            <button onClick={() => setCurrentStep(Step.WORKER_PROFILE)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-blue-500/30 transition-all duration-300">
              <div className="text-blue-500 bg-blue-500/10 p-3 rounded-2xl border border-blue-500/10"><User size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Mi Perfil</span>
            </button>
            {/* Navigation: Settings */}
            <button onClick={() => setCurrentStep(Step.WORKER_SETTINGS)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-purple-500/30 transition-all duration-300">
              <div className="text-purple-500 bg-purple-500/10 p-3 rounded-2xl border border-purple-500/10"><BellRing size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Ajustes</span>
            </button>
            {/* Navigation: Chat / Mensajes */}
            <button onClick={() => setCurrentStep(Step.WORKER_CHAT)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-[#CCFF00]/30 transition-all duration-300 relative">
              {unreadChatsCount > 0 && (
                <div className="absolute top-2 right-2 bg-[#CCFF00] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(204,255,0,0.4)]">
                  {unreadChatsCount}
                </div>
              )}
              <div className="text-[#CCFF00] bg-[#CCFF00]/10 p-3 rounded-2xl border border-[#CCFF00]/10"><MessageSquare size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Mensajes</span>
            </button>
          </div>
        </div>

        {/* CENTER COLUMN: Focal Time state stopwatch & Dynamic Island */}
        <div className="md:col-span-5 flex flex-col md:h-full gap-4">
          <div className="flex-1 bg-[var(--panel-bg)] backdrop-blur-2xl border border-[var(--panel-border)] rounded-[2.5rem] p-6 shadow-[var(--panel-shadow)] flex flex-col items-center justify-between relative overflow-hidden md:h-full min-h-[320px] py-8">
            
            {/* Top portion: Apple-style "Dynamic Island" state pill */}
            <div className="w-full flex justify-center mt-2">
              <div className="bg-[var(--island-bg)] backdrop-blur-3xl px-5 py-2.5 rounded-full border border-[var(--panel-border)] flex items-center gap-3 shadow-lg transition-all duration-500 animate-pulse hover:scale-105">
                <span className="relative flex h-2.5 w-2.5">
                  <span className={`animate-ping absolute inline-flex h-full w-full rounded-full opacity-75 ${
                    workerStatus?.type === 'TRABAJANDO' ? 'bg-emerald-400' : workerStatus?.type === 'DESCANSO' ? 'bg-amber-400' : 'bg-blue-400'
                  }`}></span>
                  <span className={`relative inline-flex rounded-full h-2.5 w-2.5 ${
                    workerStatus?.type === 'TRABAJANDO' ? 'bg-emerald-500' : workerStatus?.type === 'DESCANSO' ? 'bg-amber-500' : 'bg-blue-500'
                  }`}></span>
                </span>
                <span className="text-[10px] font-black uppercase tracking-[0.2em] text-[var(--island-text)]">
                  {workerStatus?.type === 'TRABAJANDO' ? `TRABAJANDO` : workerStatus?.type === 'DESCANSO' ? 'EN PAUSA' : 'SIN OBRA ACTIVA'}
                </span>
              </div>
            </div>

            {/* Central massive high-contrast stopwatch */}
            <div className="flex flex-col items-center justify-center my-auto py-6">
              <span className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-[0.3em] mb-1">TIEMPO DE TRABAJO HOY</span>
              <h1 className="text-5xl md:text-6xl font-black font-sans tracking-tight text-[var(--text-main)] drop-shadow-sm leading-none select-none">
                {formatMsToTime(getEffectiveWorkTime())}
              </h1>
              
              {/* Active Site Indicator */}
              {workerStatus?.site && (
                <div className="flex items-center gap-1.5 mt-3 text-[var(--text-main)] bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] px-3 py-1 rounded-full text-[10px] font-bold uppercase tracking-wider">
                  <MapPin size={10} className="text-blue-500" />
                  <span>{workerStatus.site}</span>
                </div>
              )}

              {/* Break duration if any */}
              {(getEffectiveBreakTime() > 0 || workerStatus?.type === 'DESCANSO') && (
                <div className="flex items-center gap-2 mt-4 text-amber-500 bg-amber-500/10 border border-amber-500/20 px-3.5 py-1.5 rounded-full text-[10px] font-black uppercase tracking-widest animate-fadeIn">
                  <Coffee size={12} />
                  <span>DESCANSO: {formatMsToTime(getEffectiveBreakTime())}</span>
                </div>
              )}
            </div>

            {/* Bottom: Dynamic widgets/actions (Fichar, Entrada, Salida, Pausa) */}
            <div className="w-full">
              {workerStatus?.type === 'INACTIVO' ? (
                // Logic: Clock in starts by choosing site first
                <button onClick={() => setCurrentStep(Step.SELECT_SITE)} className="w-full bg-[#CCFF00] hover:bg-[#e1ff33] text-black font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-[#CCFF00]/10 transition-all duration-300 active:scale-95 uppercase text-xs tracking-widest">
                  <Timer size={16} /> Fichar Entrada
                </button>
              ) : (
                // Logic: Active state controls
                <div className="flex gap-3">
                  {workerStatus?.type === 'TRABAJANDO' ? (
                    <>
                      {/* Logic: Pause starts break */}
                      <button onClick={() => handleActionSelect(LogType.INICIO_DESCANSO)} className="flex-1 bg-amber-600/20 hover:bg-amber-600/30 text-amber-500 border border-amber-500/20 font-black py-4 px-3 rounded-2xl flex items-center justify-center gap-2 transition-all duration-300 active:scale-95 uppercase text-[10px] tracking-wider">
                        <Coffee size={14} /> Pausa
                      </button>
                      {/* Logic: Clock-out initiates exit report */}
                      <button onClick={() => handleActionSelect(LogType.SALIDA)} className="flex-1 bg-rose-600 hover:bg-rose-700 text-white font-black py-4 px-3 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-rose-600/10 transition-all duration-300 active:scale-95 uppercase text-[10px] tracking-wider">
                        <LogOut size={14} /> Salida
                      </button>
                    </>
                  ) : (
                    // Logic: Resume work ending break
                    <button onClick={() => handleActionSelect(LogType.FIN_DESCANSO)} className="w-full bg-[#CCFF00] hover:bg-[#e1ff33] text-black font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-[#CCFF00]/10 transition-all duration-300 active:scale-95 uppercase text-xs tracking-widest">
                      <Timer size={16} /> Reanudar Trabajo
                    </button>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>

        {/* RIGHT COLUMN: Recent activity borderless widget */}
        <div className="md:col-span-3 bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] rounded-[2rem] p-5 shadow-[var(--panel-shadow)] flex flex-col md:h-full md:overflow-hidden min-h-[250px] shrink-0">
          <div className="flex items-center gap-2 mb-4 shrink-0">
            <div className="w-1.5 h-3 bg-blue-500 rounded-full"></div>
            <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest">Actividad Reciente</span>
          </div>

          <div className="md:flex-1 md:overflow-y-auto space-y-3 custom-scrollbar pr-1">
            {recentLogs.length > 0 ? (
              recentLogs.map((log, idx) => (
                <div key={log.id} className={`flex flex-col py-2 ${idx !== recentLogs.length - 1 ? 'border-b border-[var(--panel-border)]' : ''}`}>
                  <div className="flex justify-between items-center text-[10px] mb-1">
                    <span className={`font-black uppercase tracking-wider ${
                      log.type === LogType.ENTRADA ? 'text-emerald-500' : log.type === LogType.SALIDA ? 'text-rose-500' : 'text-blue-500'
                    }`}>
                      {log.type}
                    </span>
                    <span className="text-[var(--text-muted)] font-bold">{log.timeStr}</span>
                  </div>
                  <span className="text-xs font-bold text-[var(--text-main)] uppercase tracking-tight truncate">{log.siteName}</span>
                  <span className="text-[8px] text-[var(--text-muted)] uppercase tracking-widest font-bold mt-0.5">{log.dateStr}</span>
                </div>
              ))
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-[var(--text-muted)] py-6 text-center">
                <Clock size={20} className="mb-2 opacity-30" />
                <span className="text-[9px] font-black uppercase tracking-widest">Sin actividad hoy</span>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const handleReportPhotoChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    const reader = new FileReader();
    reader.onloadend = async () => {
      try {
        // Compress image to fit within Firestore 1MB limits
        const compressed = await compressImage(reader.result as string, 800, 800, 0.7);
        setReportPhoto(compressed);
      } catch (err) {
        console.error("Error compressing report photo:", err);
        setReportPhoto(reader.result as string);
      }
    };
    reader.readAsDataURL(file);
  };

  const handleSendWeeklyReport = async () => {
    if (!reportPhoto) {
      alert("Por favor toma o sube una foto de tu parte semanal.");
      return;
    }
    if (!reportStartDate || !reportEndDate) {
      alert("Por favor selecciona las fechas de inicio y fin del período que cubre el parte.");
      return;
    }
    setSubmittingReport(true);
    try {
      const response = await fetch('/api/gemini/analyze-sheet', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ image: reportPhoto })
      });
      const data = await response.json();
      const parsedData = data.result || {};
      
      // Formato legible para el rango de fechas seleccionado
      const startFormatted = new Date(reportStartDate).toLocaleDateString('es-ES');
      const endFormatted = new Date(reportEndDate).toLocaleDateString('es-ES');
      const selectedRange = `${startFormatted} al ${endFormatted}`;

      const newReport: WeeklyReport = {
        id: `REP-${Date.now()}`,
        workerId: selectedWorker!.id,
        workerName: selectedWorker!.name,
        dateStr: new Date().toLocaleDateString('es-ES'),
        timestamp: Date.now(),
        photoUrl: reportPhoto,
        startDate: reportStartDate,
        endDate: reportEndDate,
        comments: reportComments,
        status: 'PENDING',
        isAiParsed: true,
        extractedDates: parsedData.dates || selectedRange,
        extractedTasks: parsedData.tasks,
        extractedHours: Number(parsedData.hours) || 0,
        extractedTotal: parsedData.total,
        dailyHours: parsedData.dailyHours || []
      };

      await StorageService.addReport(newReport);

      const msg = `👷‍♂️ <b>Nuevo Parte Semanal Subido (IA)</b>\n👤 Operario: <b>${selectedWorker!.name}</b>\n📅 Período: ${selectedRange}\n📅 Envío: ${newReport.dateStr}\n\n🤖 <i>Gemini ha extraído del documento:</i>\n📅 Fechas: ${parsedData.dates || '-'}\n📊 Horas totales: ${parsedData.hours || 0}h\n💰 Total: ${parsedData.total || '-'}`;
      TelegramService.enviarNotificacionTelegram(msg);

      alert("Parte semanal enviado correctamente para revisión.");
      setReportPhoto(null);
      setReportStartDate('');
      setReportEndDate('');
      setReportComments('');
      setCurrentStep(Step.WORKER_DASHBOARD);
    } catch (err) {
      alert("Error al enviar o analizar el parte semanal. Inténtalo de nuevo.");
    } finally {
      setSubmittingReport(false);
    }
  };

  const handleDeleteReport = async (reportId: string) => {
    if (confirm("¿Estás seguro de que deseas eliminar este parte de trabajo?")) {
      try {
        await StorageService.deleteReport(reportId);
      } catch (err) {
        alert("Error al eliminar el parte.");
      }
    }
  };

  const handleSendWorkerMessage = async () => {
    if (!chatMessageInput.trim() || !selectedWorker || !activeChatPartnerId) return;

    const partnerName = activeChatPartnerId === 'ADMIN' ? 'El Jefe' : (workers.find(w => w.id === activeChatPartnerId)?.name || 'Compañero');

    const msg: ChatMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      senderId: selectedWorker.id,
      senderName: selectedWorker.name,
      receiverId: activeChatPartnerId,
      receiverName: partnerName,
      text: chatMessageInput.trim(),
      timestamp: Date.now(),
      dateStr: new Date().toLocaleDateString('es-ES'),
      timeStr: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
      read: false
    };

    try {
      await StorageService.sendMessage(msg);
      setChatMessageInput('');
    } catch (err) {
      alert("Error al enviar el mensaje.");
    }
  };

  useEffect(() => {
    if (currentStep === Step.WORKER_CHAT && selectedWorker && activeChatPartnerId) {
      StorageService.markMessagesAsRead(activeChatPartnerId, selectedWorker.id);
    }
  }, [currentStep, activeChatPartnerId, chats, selectedWorker]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats, activeChatPartnerId, currentStep]);

  const handleWorkerPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedWorker) {
      if (!file.type.startsWith('image/')) {
        alert("Por favor, sube un archivo de imagen.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const compressed = await compressImage(reader.result as string, 300, 300, 0.75);
          const updated = { ...selectedWorker, photoUrl: compressed };
          const updatedList = workers.map(w => w.id === selectedWorker.id ? updated : w);
          await StorageService.saveWorkers(updatedList);
          setWorkers(updatedList);
          setSelectedWorker(updated);
          alert("Foto de perfil actualizada.");
        } catch (err) {
          console.error("Error compressing image", err);
          alert("Hubo un error al procesar o guardar la imagen.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddCertificate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedWorker) {
      if (file.size > 900 * 1024) {
        alert("El archivo supera el límite de tamaño permitido (900 KB). Por favor, sube un archivo más pequeño.");
        if (certFileInputRef.current) certFileInputRef.current.value = '';
        return;
      }
      const name = certNameInput.trim() || file.name.split('.')[0];
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          let fileData = reader.result as string;
          if (file.type.startsWith('image/')) {
            fileData = await compressImage(fileData, 1000, 1000, 0.8);
          }
          const newCert = {
            id: `CERT-${Date.now()}`,
            name: name,
            fileBase64: fileData,
            uploadDate: new Date().toLocaleDateString('es-ES'),
            size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
          };
          const currentCerts = selectedWorker.certificates || [];
          const updated = {
            ...selectedWorker,
            certificates: [...currentCerts, newCert]
          };
          
          const updatedList = workers.map(w => w.id === selectedWorker.id ? updated : w);
          await StorageService.saveWorkers(updatedList);
          setWorkers(updatedList);
          setSelectedWorker(updated);
          setCertNameInput('');
          if (certFileInputRef.current) certFileInputRef.current.value = '';
          alert("Certificado subido con éxito.");
        } catch (err) {
          console.error("Error upload cert", err);
          alert("Error al subir el certificado a Firebase.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleDeleteCertificate = async (certId: string) => {
    if (selectedWorker && confirm("¿Estás seguro de que deseas eliminar este certificado?")) {
      const currentCerts = selectedWorker.certificates || [];
      const updated = {
        ...selectedWorker,
        certificates: currentCerts.filter(c => c.id !== certId)
      };
      const updatedList = workers.map(w => w.id === selectedWorker.id ? updated : w);
      try {
        await StorageService.saveWorkers(updatedList);
        setWorkers(updatedList);
        setSelectedWorker(updated);
      } catch (err) {
        console.error("Error deleting certificate:", err);
        alert("Error al eliminar el certificado en Firebase.");
      }
    }
  };

  const renderWorkerProfile = () => {
    if (!selectedWorker) return null;
    const certificates = selectedWorker.certificates || [];

    return (
      <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden pb-4">
        <div className="flex items-center justify-between gap-4 mb-6 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} 
              className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10"
            >
              <ChevronLeft size={20}/>
            </button>
            <div>
              <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tight">Mi Perfil Profesional</h2>
              <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">Visualiza y gestiona tus datos</p>
            </div>
          </div>
        </div>

        <div className="md:flex-1 md:overflow-y-auto space-y-6 pb-6 custom-scrollbar pr-1">
          {/* Top Info Card with Photo */}
          <div className="bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] p-6 rounded-[2rem] shadow-[var(--panel-shadow)] flex flex-col sm:flex-row gap-6 items-center sm:items-start text-center sm:text-left">
            {/* Foto de perfil */}
            <div className="relative group cursor-pointer" onClick={() => workerPhotoInputRef.current?.click()}>
              {selectedWorker.photoUrl ? (
                <img 
                  src={selectedWorker.photoUrl} 
                  alt={selectedWorker.name} 
                  className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover border-2 border-blue-500/30 group-hover:border-blue-500 transition-colors shadow-lg"
                />
              ) : (
                <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-blue-600/10 border-2 border-dashed border-blue-500/20 text-blue-500 flex flex-col items-center justify-center group-hover:border-blue-500 transition-all shadow-inner">
                  <User size={36} />
                  <span className="text-[8px] font-black uppercase mt-2 text-blue-400">Subir Foto</span>
                </div>
              )}
              <div className="absolute inset-0 bg-black/40 rounded-3xl opacity-0 group-hover:opacity-100 flex items-center justify-center transition-opacity">
                <Upload size={18} className="text-white" />
              </div>
            </div>
            <input 
              type="file" 
              ref={workerPhotoInputRef} 
              className="hidden" 
              accept="image/*" 
              onChange={handleWorkerPhotoUpload} 
            />

            <div className="space-y-1 flex-1">
              <div className="flex items-center gap-2.5 justify-center sm:justify-start">
                <h3 className="text-xl sm:text-2xl font-black text-[var(--text-main)] uppercase tracking-tight">{selectedWorker.name}</h3>
                <span className="w-2.5 h-2.5 rounded-full bg-emerald-500" />
              </div>
              <p className="text-[10px] text-[var(--text-muted)] font-bold tracking-widest uppercase">
                ID: <span className="font-mono text-[var(--text-main)]">{selectedWorker.id}</span>
              </p>
              <div className="flex flex-wrap gap-2 justify-center sm:justify-start mt-3">
                <span className="text-[9px] font-black tracking-wider uppercase px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                  {selectedWorker.role || 'Electricista'}
                </span>
                {selectedWorker.phone && (
                  <span className="text-[9px] font-black tracking-wider uppercase px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                    <Phone size={10} /> {selectedWorker.phone}
                  </span>
                )}
                {selectedWorker.email && (
                  <span className="text-[9px] font-black tracking-wider px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                    <Mail size={10} /> {selectedWorker.email}
                  </span>
                )}
              </div>
            </div>
          </div>

          {/* Ficha técnica del operario */}
          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] shadow-[var(--panel-shadow)]">
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">DNI / NIE / Pasaporte</p>
              <p className="text-sm font-black text-[var(--text-main)] uppercase mt-1">{selectedWorker.dni || 'S/DNI'}</p>
            </div>
            <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] shadow-[var(--panel-shadow)]">
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Correo Electrónico</p>
              <p className="text-sm font-black text-[var(--text-main)] mt-1 break-all">{selectedWorker.email || 'No registrado'}</p>
            </div>
            <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] shadow-[var(--panel-shadow)]">
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Código PIN de Acceso</p>
              <p className="text-sm font-mono font-black text-[var(--text-main)] mt-1">{selectedWorker.pin || '0000'}</p>
            </div>
            <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] shadow-[var(--panel-shadow)]">
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Código QR asignado</p>
              <p className="text-sm font-mono font-black text-blue-400 mt-1 truncate">{selectedWorker.qrCode || 'S/QR'}</p>
            </div>
            <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] shadow-[var(--panel-shadow)]">
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Modo de trabajo habitual</p>
              <p className="text-sm font-black text-[var(--text-main)] uppercase mt-1">{selectedWorker.defaultMode || 'HORAS'}</p>
            </div>
          </div>

          {/* Certificados / Documentos section */}
          <div className="space-y-4">
            <div className="border-t border-[var(--panel-border)] pt-5 text-center sm:text-left">
              <h4 className="text-sm font-black text-[var(--text-main)] uppercase tracking-widest">Mis Certificados y Documentos</h4>
              <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase mt-0.5">Sube y gestiona tus aptitudes médicas, prevención, etc.</p>
            </div>

            {/* Formulario rápido para subir certificado */}
            <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)] shadow-[var(--panel-shadow)] space-y-4">
              <div className="flex flex-col sm:flex-row gap-3">
                <input 
                  type="text" 
                  placeholder="Nombre del documento (Ej: Prevención de Riesgos 20h)" 
                  value={certNameInput}
                  onChange={(e) => setCertNameInput(e.target.value)}
                  className="flex-1 bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl px-4 py-3 text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                />
                <button 
                  onClick={() => certFileInputRef.current?.click()}
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase px-5 py-3 rounded-xl flex items-center justify-center gap-1.5 active:scale-95 transition-all shadow-md shrink-0"
                >
                  <Upload size={14} /> Seleccionar archivo
                </button>
                <input 
                  type="file" 
                  ref={certFileInputRef} 
                  className="hidden" 
                  onChange={handleAddCertificate} 
                />
              </div>
            </div>

            {/* List of Certificates */}
            {certificates.length > 0 ? (
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {certificates.map(cert => (
                  <div key={cert.id} className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] flex flex-col justify-between gap-3 hover:border-blue-500/20 transition-all shadow-[var(--panel-shadow)]">
                    <div>
                      <h5 className="font-black text-[var(--text-main)] text-xs uppercase tracking-tight truncate" title={cert.name}>{cert.name}</h5>
                      <p className="text-[8px] text-[var(--text-muted)] font-bold uppercase mt-1">Subido: {cert.uploadDate} {cert.size && `• ${cert.size}`}</p>
                    </div>
                    <div className="flex gap-2 justify-end">
                      <a 
                        href={cert.fileBase64} 
                        download={cert.name}
                        title="Descargar Certificado"
                        className="p-1.5 rounded-lg bg-blue-500/10 hover:bg-blue-500 text-blue-500 hover:text-white transition-all text-[9px] font-black uppercase flex items-center gap-1 px-3"
                      >
                        <Download size={12} /> Descargar
                      </a>
                      <button 
                        onClick={() => handleDeleteCertificate(cert.id)}
                        title="Eliminar Certificado"
                        className="p-1.5 rounded-lg bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white transition-all"
                      >
                        <Trash2 size={12} />
                      </button>
                    </div>
                  </div>
                ))}
              </div>
            ) : (
              <div className="text-center p-8 bg-zinc-900/5 dark:bg-white/5 border border-dashed border-[var(--panel-border)] rounded-2xl">
                <FileText className="mx-auto text-[var(--text-muted)] mb-2" size={24} />
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wider">No has subido ningún certificado aún.</p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderWorkerSettings = () => {
    if (!selectedWorker) return null;

    // Default to true if not set
    const notifyCheckIn = selectedWorker.notificationPreferences?.notifyCheckIn ?? true;
    const notifyCertificates = selectedWorker.notificationPreferences?.notifyCertificates ?? true;

    const handleToggleCheckIn = async () => {
      const updatedPrefs = {
        ...(selectedWorker.notificationPreferences || {}),
        notifyCheckIn: !notifyCheckIn
      };
      const updatedWorker = {
        ...selectedWorker,
        notificationPreferences: updatedPrefs
      };
      const updatedList = workers.map(w => w.id === selectedWorker.id ? updatedWorker : w);
      try {
        await StorageService.saveWorkers(updatedList);
        setWorkers(updatedList);
        setSelectedWorker(updatedWorker);
      } catch (err) {
        console.error("Error updating settings:", err);
        alert("Error al guardar la configuración en Firebase.");
      }
    };

    const handleToggleCertificates = async () => {
      const updatedPrefs = {
        ...(selectedWorker.notificationPreferences || {}),
        notifyCertificates: !notifyCertificates
      };
      const updatedWorker = {
        ...selectedWorker,
        notificationPreferences: updatedPrefs
      };
      const updatedList = workers.map(w => w.id === selectedWorker.id ? updatedWorker : w);
      try {
        await StorageService.saveWorkers(updatedList);
        setWorkers(updatedList);
        setSelectedWorker(updatedWorker);
      } catch (err) {
        console.error("Error updating settings:", err);
        alert("Error al guardar la configuración en Firebase.");
      }
    };

    return (
      <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden pb-4 text-[var(--text-main)]">
        <div className="flex items-center gap-4 mb-6 shrink-0">
          <button 
            onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} 
            className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10 active:scale-95 transition-all"
          >
            <ChevronLeft size={20}/>
          </button>
          <div>
            <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tight">Ajustes del Sistema</h2>
            <p className="text-[10px] text-purple-500 font-bold uppercase tracking-widest">Gestión de notificaciones y avisos</p>
          </div>
        </div>

        <div className="md:flex-1 md:overflow-y-auto space-y-6 pb-6 custom-scrollbar pr-1">
          {/* Settings Section Card */}
          <div className="bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] p-6 rounded-[2rem] shadow-[var(--panel-shadow)] space-y-6">
            <div className="flex items-center gap-3 border-b border-[var(--panel-border)] pb-4">
              <div className="p-2 bg-purple-500/10 rounded-xl text-purple-500 border border-purple-500/10">
                <BellRing size={20} />
              </div>
              <div>
                <h3 className="text-sm font-black uppercase tracking-wider text-[var(--text-main)]">Preferencias de Alertas</h3>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-tight">Activa o desactiva las notificaciones automáticas</p>
              </div>
            </div>

            <div className="space-y-4">
              {/* Option 1: Fichajes */}
              <div className="flex items-center justify-between p-4 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] rounded-2xl">
                <div className="space-y-0.5 flex-1 pr-4">
                  <h4 className="text-xs font-black uppercase tracking-wide text-[var(--text-main)] flex items-center gap-1.5">
                    <Zap size={14} className="text-[#CCFF00]" /> Notificación de Fichajes
                  </h4>
                  <p className="text-[9px] font-medium text-[var(--text-muted)] leading-relaxed">
                    Avisos en tiempo real al registrar tu entrada, salida o periodos de descanso.
                  </p>
                </div>
                <button 
                  onClick={handleToggleCheckIn}
                  className="w-12 h-6 rounded-full relative transition-colors duration-300 outline-none select-none min-h-[44px] min-w-[56px] flex items-center p-1"
                  style={{ backgroundColor: notifyCheckIn ? '#CCFF00' : '#27272a' }}
                >
                  <span 
                    className="w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-300 absolute"
                    style={{ 
                      transform: notifyCheckIn ? 'translateX(26px)' : 'translateX(4px)',
                      backgroundColor: notifyCheckIn ? '#050505' : '#ffffff'
                    }}
                  />
                </button>
              </div>

              {/* Option 2: Certificados */}
              <div className="flex items-center justify-between p-4 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] rounded-2xl">
                <div className="space-y-0.5 flex-1 pr-4">
                  <h4 className="text-xs font-black uppercase tracking-wide text-[var(--text-main)] flex items-center gap-1.5">
                    <FileText size={14} className="text-[#CCFF00]" /> Recordatorios de Certificados
                  </h4>
                  <p className="text-[9px] font-medium text-[var(--text-muted)] leading-relaxed">
                    Avisos y alertas previas a la caducidad de certificados médicos o de prevención.
                  </p>
                </div>
                <button 
                  onClick={handleToggleCertificates}
                  className="w-12 h-6 rounded-full relative transition-colors duration-300 outline-none select-none min-h-[44px] min-w-[56px] flex items-center p-1"
                  style={{ backgroundColor: notifyCertificates ? '#CCFF00' : '#27272a' }}
                >
                  <span 
                    className="w-5 h-5 rounded-full bg-white shadow-md transform transition-transform duration-300 absolute"
                    style={{ 
                      transform: notifyCertificates ? 'translateX(26px)' : 'translateX(4px)',
                      backgroundColor: notifyCertificates ? '#050505' : '#ffffff'
                    }}
                  />
                </button>
              </div>
            </div>
          </div>

          {/* Context Info Banner */}
          <div className="bg-purple-500/5 border border-purple-500/10 p-5 rounded-3xl flex gap-3.5 items-start">
            <Info size={18} className="text-purple-400 shrink-0 mt-0.5" />
            <div className="space-y-1">
              <h4 className="text-[10px] font-black uppercase tracking-widest text-purple-400">Sincronización en la Nube</h4>
              <p className="text-[9px] font-medium text-[var(--text-muted)] leading-relaxed">
                Tus preferencias se guardan de forma segura en tu perfil de operario. La empresa respetará tu elección para el envío de alertas automatizadas.
              </p>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderWorkerChat = () => {
    if (!selectedWorker) return null;

    // Filter active workers except me
    const otherWorkers = workers.filter(w => w.id !== selectedWorker.id && w.active);

    // Filter messages for current active partner
    const activeMessages = chats.filter(c => 
      (c.senderId === selectedWorker.id && c.receiverId === activeChatPartnerId) ||
      (c.senderId === activeChatPartnerId && c.receiverId === selectedWorker.id)
    );

    const partnerUnreadCount = (partnerId: string) => {
      return chats.filter(c => c.senderId === partnerId && c.receiverId === selectedWorker.id && !c.read).length;
    };

    return (
      <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden pb-4 text-[var(--text-main)]">
        {/* Header */}
        <div className="flex items-center gap-4 mb-4 shrink-0">
          <button 
            onClick={() => {
              setCurrentStep(Step.WORKER_DASHBOARD);
              setActiveChatPartnerId(null);
            }} 
            className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10 active:scale-95 transition-all"
          >
            <ChevronLeft size={20}/>
          </button>
          <div>
            <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tight font-sans">Mensajería Interna</h2>
            <p className="text-[10px] text-[#CCFF00] font-bold uppercase tracking-widest">Contacto directo entre compañeros y jefe</p>
          </div>
        </div>

        {/* Two-Column Chat Area */}
        <div className="flex flex-col md:grid md:grid-cols-12 gap-4 md:flex-1 md:overflow-hidden min-h-[480px]">
          
          {/* LEFT COLUMN: Contacts */}
          <div className={`md:col-span-4 bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] rounded-[2rem] p-4 flex flex-col gap-3 md:h-full overflow-y-auto custom-scrollbar shadow-[var(--panel-shadow)] ${
            activeChatPartnerId ? 'hidden md:flex' : 'flex'
          }`}>
            <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--panel-border)] pb-2">Canales de Chat</h3>
            
            {/* El Jefe (Admin/Boss) option */}
            <button 
              onClick={() => setActiveChatPartnerId('ADMIN')}
              className={`flex items-center justify-between p-3 rounded-2xl border transition-all text-left ${
                activeChatPartnerId === 'ADMIN' 
                  ? 'bg-[#CCFF00]/10 border-[#CCFF00]/40 text-[#CCFF00]' 
                  : 'bg-[var(--btn-glass-bg)] border-[var(--btn-glass-border)] hover:bg-slate-500/5'
              }`}
            >
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-500 to-amber-600 flex items-center justify-center text-white font-black shadow-md border border-yellow-400/20">
                  👑
                </div>
                <div>
                  <h4 className="text-xs font-black uppercase tracking-wide">EL JEFE</h4>
                  <p className="text-[9px] text-[var(--text-muted)] font-medium">Administrador Principal</p>
                </div>
              </div>
              
              {partnerUnreadCount('ADMIN') > 0 && (
                <span className="bg-[#CCFF00] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(204,255,0,0.5)]">
                  {partnerUnreadCount('ADMIN')}
                </span>
              )}
            </button>

            {/* Other Workers list */}
            <div className="space-y-2 mt-1">
              <span className="text-[9px] font-black tracking-widest text-[var(--text-muted)] uppercase block mb-1">Compañeros ({otherWorkers.length})</span>
              {otherWorkers.length === 0 ? (
                <p className="text-[10px] text-[var(--text-muted)] italic text-center py-4">No hay otros operarios disponibles.</p>
              ) : (
                otherWorkers.map(w => {
                  const isSelected = activeChatPartnerId === w.id;
                  const unread = partnerUnreadCount(w.id);
                  return (
                    <button 
                      key={w.id}
                      onClick={() => setActiveChatPartnerId(w.id)}
                      className={`w-full flex items-center justify-between p-3 rounded-2xl border transition-all text-left ${
                        isSelected 
                          ? 'bg-[#CCFF00]/10 border-[#CCFF00]/40 text-[#CCFF00]' 
                          : 'bg-[var(--btn-glass-bg)] border-[var(--btn-glass-border)] hover:bg-slate-500/5'
                      }`}
                    >
                      <div className="flex items-center gap-3">
                        {w.photoUrl ? (
                          <img src={w.photoUrl} alt={w.name} className="w-10 h-10 rounded-full object-cover border border-white/10" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-black text-xs text-slate-300 uppercase">
                            {w.name.charAt(0)}
                          </div>
                        )}
                        <div>
                          <h4 className="text-xs font-black uppercase tracking-wide text-[var(--text-main)] truncate max-w-[140px]">{w.name}</h4>
                          <p className="text-[9px] text-[var(--text-muted)] font-medium">{w.role || 'Operario'}</p>
                        </div>
                      </div>

                      {unread > 0 && (
                        <span className="bg-[#CCFF00] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(204,255,0,0.5)]">
                          {unread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* RIGHT COLUMN: Active Chat Box */}
          <div className={`md:col-span-8 bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] rounded-[2rem] p-4 flex flex-col md:h-full justify-between shadow-[var(--panel-shadow)] min-h-[400px] ${
            activeChatPartnerId ? 'flex' : 'hidden md:flex'
          }`}>
            {activeChatPartnerId ? (
              <>
                {/* Active Partner Header */}
                <div className="flex items-center justify-between border-b border-[var(--panel-border)] pb-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setActiveChatPartnerId(null)} 
                      className="md:hidden p-2 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-muted)] hover:text-white"
                    >
                      <ChevronLeft size={16} />
                    </button>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-[var(--text-main)] flex items-center gap-2 font-sans">
                        {activeChatPartnerId === 'ADMIN' ? '👑 EL JEFE' : workers.find(w => w.id === activeChatPartnerId)?.name}
                      </h3>
                      <p className="text-[9px] text-[#CCFF00] font-bold uppercase tracking-widest">Chat individual seguro</p>
                    </div>
                  </div>

                  <span className="text-[9px] text-[var(--text-muted)] font-bold tracking-widest uppercase font-mono">Canal Directo</span>
                </div>

                {/* Messages Feed */}
                <div className="flex-1 overflow-y-auto my-3 p-2 space-y-3 custom-scrollbar min-h-[250px] max-h-[350px] md:max-h-none">
                  {activeMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-10 opacity-60">
                      <MessageSquare size={32} className="text-[var(--text-muted)] mb-2" />
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">No hay mensajes anteriores</p>
                      <p className="text-[9px] font-medium text-[var(--text-muted)] mt-1">Escribe un mensaje abajo para iniciar la conversación.</p>
                    </div>
                  ) : (
                    activeMessages.map(m => {
                      const isMe = m.senderId === selectedWorker.id;
                      return (
                        <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm text-xs ${
                            isMe 
                              ? 'bg-[#CCFF00] text-black font-medium rounded-tr-none' 
                              : 'bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] text-[var(--text-main)] rounded-tl-none'
                          }`}>
                            <p className="whitespace-pre-wrap leading-relaxed break-words">{m.text}</p>
                            <div className="flex items-center justify-end gap-1 mt-1 opacity-60 text-[8px] font-mono">
                              <span>{m.timeStr}</span>
                              {isMe && (
                                <span className={m.read ? 'text-blue-500 font-bold' : 'text-slate-400'}>
                                  {m.read ? '✓✓' : '✓'}
                                </span>
                              )}
                            </div>
                          </div>
                        </div>
                      );
                    })
                  )}
                  <div ref={chatEndRef} />
                </div>

                {/* Message Input Bar */}
                <div className="border-t border-[var(--panel-border)] pt-3 flex items-center gap-2 shrink-0">
                  <input 
                    type="text" 
                    value={chatMessageInput}
                    onChange={(e) => setChatMessageInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSendWorkerMessage(); }}
                    className="flex-1 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl px-4 py-3 text-xs outline-none focus:border-[#CCFF00]"
                    placeholder="Escribe un mensaje..."
                  />
                  <button 
                    onClick={handleSendWorkerMessage}
                    className="p-3 bg-[#CCFF00] text-black rounded-xl hover:bg-[#e1ff33] active:scale-95 transition-all shadow-md shadow-[#CCFF00]/10 flex items-center justify-center"
                  >
                    <Send size={16} />
                  </button>
                </div>
              </>
            ) : (
              <div className="flex flex-col items-center justify-center h-full text-center py-20 opacity-60">
                <div className="p-4 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] rounded-[2rem] text-[var(--text-muted)] mb-4">
                  <MessageSquare size={36} />
                </div>
                <h3 className="text-sm font-black uppercase tracking-wider text-[var(--text-main)]">Selecciona un Canal</h3>
                <p className="text-[10px] text-[var(--text-muted)] mt-1 max-w-[240px] mx-auto leading-relaxed">
                  Elige a un compañero o al jefe en la lista de la izquierda para ver el historial y enviarle un mensaje directo.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderWorkerReports = () => {
    const reportsForMe = myReports.filter(r => r.workerId === selectedWorker?.id && r.startDate && r.endDate);
    return (
      <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden">
        <div className="flex items-center gap-4 mb-4 shrink-0">
          <button onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
            <ChevronLeft size={20}/>
          </button>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter">Partes Semanales (IA)</h2>
        </div>

        <div className="md:flex-1 md:overflow-y-auto space-y-6 pb-6 custom-scrollbar pr-1">
          <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)] space-y-4">
            <h3 className="text-sm font-black text-[var(--text-main)] uppercase tracking-wide">Subir Parte de Trabajo</h3>
            
            {/* Período del Parte de Trabajo */}
            <div className="space-y-2 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] p-4 rounded-2xl">
              <label className="text-[10px] font-black text-purple-400 uppercase tracking-widest block ml-0.5">Período que cubre el parte *</label>
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <span className="text-[8px] font-black uppercase text-[var(--text-muted)] block mb-1 ml-0.5">Desde</span>
                  <input 
                    type="date" 
                    value={reportStartDate} 
                    onChange={(e) => setReportStartDate(e.target.value)} 
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-xs text-[var(--input-text)] [color-scheme:dark] focus:border-blue-500 outline-none"
                    required
                  />
                </div>
                <div>
                  <span className="text-[8px] font-black uppercase text-[var(--text-muted)] block mb-1 ml-0.5">Hasta</span>
                  <input 
                    type="date" 
                    value={reportEndDate} 
                    onChange={(e) => setReportEndDate(e.target.value)} 
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-xs text-[var(--input-text)] [color-scheme:dark] focus:border-blue-500 outline-none"
                    required
                  />
                </div>
              </div>
            </div>

            <div className="space-y-3">
              <label className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest block ml-1">Foto o Captura del Parte *</label>
              
              {!reportPhoto ? (
                <div className="border-2 border-dashed border-[var(--panel-border)] rounded-2xl p-6 flex flex-col items-center justify-center gap-2 bg-[var(--input-bg)] relative cursor-pointer hover:border-blue-500 transition">
                  <input type="file" accept="image/*" capture="environment" onChange={handleReportPhotoChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <ImageIcon size={32} className="text-[var(--text-muted)]" />
                  <span className="text-[10px] font-black text-[var(--text-muted)] uppercase">Hacer Foto o Seleccionar</span>
                </div>
              ) : (
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black">
                  <img src={reportPhoto} alt="Parte seleccionado" className="w-full h-full object-contain" />
                  <button onClick={() => setReportPhoto(null)} className="absolute top-2 right-2 p-2 bg-black/80 text-white rounded-full">
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>

            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest block ml-1">Comentarios / Observaciones</label>
              <textarea value={reportComments} onChange={(e) => setReportComments(e.target.value)} placeholder="Ej: He trabajado horas extras el martes..." className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-xs text-[var(--input-text)] h-20 resize-none focus:border-blue-500 outline-none" />
            </div>

            <button disabled={submittingReport || !reportPhoto || !reportStartDate || !reportEndDate} onClick={handleSendWeeklyReport} className="w-full bg-[#CCFF00] hover:bg-[#e1ff33] text-black disabled:bg-slate-800 disabled:text-slate-500 py-4 rounded-xl font-black uppercase text-xs shadow-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300">
              {submittingReport ? (
                <>
                  <Clock className="animate-spin text-black" size={16} /> Analizando con Gemini...
                </>
              ) : (
                <>
                  <Upload size={16} /> Subir y Procesar Parte
                </>
              )}
            </button>
            {(!reportStartDate || !reportEndDate || !reportPhoto) && (
              <div className="text-center bg-rose-500/5 border border-rose-500/10 p-3 rounded-xl">
                <p className="text-[8px] text-rose-500 font-bold uppercase tracking-wider">
                  * CAMPOS OBLIGATORIOS: PERÍODO (DESDE/HASTA) Y FOTO DEL PARTE.
                </p>
              </div>
            )}
          </div>

          <div className="space-y-3">
            {reportsForMe.length > 0 && (
              <>
                <h3 className="text-sm font-black text-[var(--text-main)] uppercase tracking-wide">Partes Enviados</h3>
                {reportsForMe.map(report => {
                  return (
                    <div key={report.id} className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] space-y-3 animate-fadeIn">
                      <div className="flex justify-between items-start gap-2">
                        <div className="space-y-0.5">
                          <span className="text-xs font-black text-[var(--text-main)] tracking-tight block">
                            Parte Semanal
                          </span>
                          <span className="text-[9px] text-[var(--text-muted)] font-medium block">
                            Enviado el {report.dateStr}
                          </span>
                        </div>
                        <div className="flex items-center gap-2">
                          <span className={`text-[8px] font-black uppercase px-2.5 py-1 rounded-full shrink-0 ${
                            report.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' :
                            report.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-500 border border-rose-500/20' :
                            'bg-amber-500/10 text-amber-500 border border-amber-500/20'
                          }`}>
                            {report.status === 'APPROVED' ? 'Aprobado' : report.status === 'REJECTED' ? 'Rechazado' : 'Pendiente'}
                          </span>
                          <button 
                            onClick={() => handleDeleteReport(report.id)} 
                            className="p-1.5 text-rose-500 hover:text-rose-400 bg-rose-500/10 hover:bg-rose-500/20 rounded-xl border border-rose-500/15 transition-all duration-200 active:scale-95"
                            title="Eliminar Parte"
                          >
                            <Trash2 size={12} />
                          </button>
                        </div>
                      </div>

                      {report.isAiParsed && (
                        <div className="p-3 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--panel-border)] grid grid-cols-2 gap-2 text-[10px]">
                          <div>
                            <span className="text-[var(--text-muted)] block font-bold uppercase text-[8px]">Horas Extraídas:</span>
                            <span className="font-black text-[var(--text-main)] text-xs">{report.extractedHours || 0}h</span>
                          </div>
                          <div>
                            <span className="text-[var(--text-muted)] block font-bold uppercase text-[8px]">Total Reportado:</span>
                            <span className="font-black text-[#CCFF00] text-xs">{report.extractedTotal || '-'}</span>
                          </div>
                        </div>
                      )}

                      {report.dailyHours && report.dailyHours.length > 0 && (
                        <div className="border-t border-[var(--panel-border)] pt-2.5 space-y-1">
                          <span className="text-[8px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Desglose diario (IA):</span>
                          <div className="space-y-1 max-h-[100px] overflow-y-auto custom-scrollbar pr-1">
                            {report.dailyHours.map((dh, idx) => (
                              <div key={idx} className="flex justify-between items-center text-[9px] bg-black/25 px-2 py-1 rounded-lg border border-[var(--panel-border)]">
                                <span className="font-bold text-[var(--text-main)]">{dh.date}</span>
                                <span className="font-black text-emerald-400 bg-emerald-500/10 px-1.5 rounded">{dh.hours}h</span>
                              </div>
                            ))}
                          </div>
                        </div>
                      )}

                      {report.rejectionReason && (
                        <div className="p-2.5 bg-rose-500/5 rounded-xl border border-rose-500/10 text-rose-500 text-[10px]">
                          <span className="font-bold block uppercase text-[8px] tracking-wider mb-0.5">Motivo de Rechazo:</span>
                          {report.rejectionReason}
                        </div>
                      )}

                      {report.photoUrl && (
                        <div className="flex gap-2 pt-2.5 border-t border-[var(--panel-border)]">
                          <button
                            onClick={() => setPreviewPhotoUrl(report.photoUrl)}
                            className="flex-1 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] text-[10px] text-[var(--text-main)] py-2 px-3 rounded-xl font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition-all hover:bg-slate-500/10"
                          >
                            <Eye size={12} className="text-[#CCFF00]" />
                            Ver Parte
                          </button>
                          <a
                            href={report.photoUrl}
                            download={`parte-${report.id}.png`}
                            className="flex-1 bg-[#CCFF00]/10 border border-[#CCFF00]/20 hover:border-[#CCFF00]/40 text-[10px] text-[#CCFF00] py-2 px-3 rounded-xl font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition-all text-center"
                          >
                            <Download size={12} />
                            Descargar
                          </a>
                        </div>
                      )}
                    </div>
                  );
                })}
              </>
            )}
          </div>
        </div>

        {/* Modal Vista Previa de Imagen */}
        {previewPhotoUrl && (
          <div className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex flex-col items-center justify-center p-4 animate-fadeIn">
            <div className="absolute top-4 right-4 flex items-center gap-2">
              <a
                href={previewPhotoUrl}
                download="parte-semanal.png"
                className="p-3 bg-zinc-900 border border-zinc-800 text-[#CCFF00] rounded-full hover:bg-zinc-800 transition active:scale-95"
                title="Descargar Foto"
              >
                <Download size={20} />
              </a>
              <button
                onClick={() => setPreviewPhotoUrl(null)}
                className="p-3 bg-zinc-900 border border-zinc-800 text-white rounded-full hover:bg-zinc-800 transition active:scale-95"
              >
                <X size={20} />
              </button>
            </div>
            <div className="max-w-4xl max-h-[80vh] w-full h-full flex items-center justify-center p-2">
              <img
                src={previewPhotoUrl}
                alt="Vista previa del parte"
                className="max-w-full max-h-full object-contain rounded-2xl border border-zinc-800 shadow-2xl"
              />
            </div>
          </div>
        )}
      </div>
    );
  };

  const renderWorkerPayslips = () => {
    const payslipsForMe = myPayslips.filter(ps => ps.workerId === selectedWorker?.id);
    const filteredPayslips = payslipsForMe.filter(ps => ps.monthStr === selectedPayslipMonth);

    const handleSignPayslip = async (ps: Payslip) => {
      const updated = { ...ps, status: 'SIGNED' as const };
      await StorageService.updatePayslip(updated);
      const msg = `✍️ <b>Nómina Firmada Digitalmente</b>\n👤 Operario: <b>${selectedWorker!.name}</b>\n📅 Período: <b>${ps.monthStr}</b>\n💰 Importe: ${ps.totalPay.toFixed(2)}€`;
      TelegramService.enviarNotificacionTelegram(msg);
      alert("Nómina firmada digitalmente con éxito.");
    };

    return (
      <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden">
        <div className="flex items-center gap-4 mb-4 shrink-0">
          <button onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
            <ChevronLeft size={20}/>
          </button>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter">Mis Nóminas</h2>
        </div>

        <div className="mb-4 shrink-0">
          <label className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest block ml-1 mb-1">Filtrar por Mes</label>
          <input type="month" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-2xl py-3 px-4 text-xs font-bold outline-none [color-scheme:dark]" value={selectedPayslipMonth} onChange={(e) => setSelectedPayslipMonth(e.target.value)} />
        </div>

        <div className="md:flex-1 md:overflow-y-auto space-y-4 pb-4 custom-scrollbar pr-1">
          {filteredPayslips.length > 0 ? (
            filteredPayslips.map(ps => (
              <div key={ps.id} className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)] space-y-4">
                <div className="flex justify-between items-start">
                  <div>
                    <h4 className="font-black text-[var(--text-main)] text-sm uppercase">{ps.title}</h4>
                    <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase mt-0.5">{ps.monthStr}</p>
                  </div>
                  <span className={`text-[8px] font-black uppercase px-2 py-0.5 rounded-full ${
                    ps.status === 'SIGNED' ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-500 border border-blue-500/20'
                  }`}>
                    {ps.status === 'SIGNED' ? 'Firmado' : 'Enviado'}
                  </span>
                </div>

                <div className="grid grid-cols-2 gap-3 bg-[var(--btn-glass-bg)] p-3 rounded-2xl border border-[var(--panel-border)] text-xs">
                  <div>
                    <span className="text-[9px] text-[var(--text-muted)] block">Salario Base:</span>
                    <span className="font-bold text-[var(--text-main)]">{ps.baseSalary}€</span>
                  </div>
                  <div>
                    <span className="text-[9px] text-[var(--text-muted)] block">Horas Extra:</span>
                    <span className="font-bold text-[var(--text-main)]">{ps.extraHours}h</span>
                  </div>
                  <div className="col-span-2 border-t border-[var(--panel-border)] pt-2 mt-1 flex justify-between items-center">
                    <span className="text-[10px] font-bold text-[var(--text-muted)] uppercase">Líquido Neto:</span>
                    <span className="text-lg font-black text-emerald-500">{ps.totalPay.toFixed(2)}€</span>
                  </div>
                </div>

                <div className="flex gap-2">
                  {ps.pdfBase64 && (
                    <a href={ps.pdfBase64} download={`Nomina_${selectedWorker?.name.replace(/\s+/g, '_')}_${ps.monthStr}.pdf`} className="flex-1 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-1 text-[var(--text-main)]">
                      <Download size={14} /> Descargar PDF
                    </a>
                  )}

                  {ps.status !== 'SIGNED' && (
                    <button onClick={() => handleSignPayslip(ps)} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl text-xs font-black uppercase shadow-lg shadow-emerald-500/10">
                      ✍️ Firmar Nómina
                    </button>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="text-center py-12 bg-[var(--panel-bg)]/40 rounded-3xl border border-dashed border-[var(--panel-border)]">
              <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-widest">No hay nóminas para este mes</p>
            </div>
          )}
        </div>
      </div>
    );
  };

  const renderStep = () => {
    switch(currentStep) {
      case Step.LOGIN_PHONE: return (
        <div className="flex flex-col h-full animate-fadeIn justify-center items-center py-4 max-w-sm mx-auto w-full">
          <div className="text-center w-full">
            <div className="inline-flex mb-6">
              <AppLogo size="lg" logoUrl={appConfig.logoUrl} scale={appConfig.logoScaleLogin} />
            </div>
            <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter uppercase font-sans">CARMAGNE INSTAL SL</h2>
            <p className="text-[var(--text-muted)] text-[10px] font-black uppercase tracking-[0.25em] mt-1">Acceso Operario</p>
          </div>
          
          <div className="bg-[var(--panel-bg)] backdrop-blur-2xl p-6 rounded-[2.5rem] border border-[var(--panel-border)] w-full mt-6 shadow-[var(--panel-shadow)]">
            <input type="tel" value={loginPhone} onChange={(e) => setLoginPhone(e.target.value)} className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-2xl p-4 text-xl font-black focus:border-[#CCFF00] outline-none text-center tracking-widest" placeholder="600000000"/>
            <button onClick={handlePhoneLogin} className="w-full bg-[#CCFF00] hover:bg-[#e1ff33] text-black font-black py-4 rounded-2xl shadow-lg shadow-[#CCFF00]/10 mt-4 flex items-center justify-center gap-2 active:scale-95 uppercase text-xs tracking-widest transition-all">
              Entrar <ArrowRight size={14} />
            </button>
          </div>
          
          <div className="flex items-center justify-center gap-4 mt-6">
            <button onClick={() => setShowAdminLogin(true)} className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-[9px] font-black uppercase tracking-[0.4em] transition-colors">
              Admin Panel
            </button>
            <div className="w-px h-3 bg-[var(--panel-border)]"></div>
            <button 
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
              className="text-[var(--text-muted)] hover:text-[var(--text-main)] text-[9px] font-black uppercase tracking-[0.4em] flex items-center gap-1.5 transition-colors"
            >
              {theme === 'dark' ? <Sun size={12} className="text-amber-400" /> : <Moon size={12} className="text-blue-400" />}
              <span>{theme === 'dark' ? 'Modo Claro' : 'Modo Oscuro'}</span>
            </button>
          </div>
        </div>
      );
      case Step.WORKER_DASHBOARD: return renderWorkerDashboard();
      case Step.WORKER_REPORTS: return renderWorkerReports();
      case Step.WORKER_PAYSLIPS: return renderWorkerPayslips();
      case Step.WORKER_PROFILE: return renderWorkerProfile();
      case Step.WORKER_SETTINGS: return renderWorkerSettings();
      case Step.WORKER_CHAT: return renderWorkerChat();
      case Step.SELECT_SITE: return (
        <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden">
           <div className="flex items-center gap-4 mb-4 shrink-0">
             <button onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
               <ChevronLeft size={20}/>
             </button>
             <h2 className="text-xl font-black text-[var(--text-main)]">Selecciona Obra</h2>
           </div>
           <div className="md:flex-1 md:overflow-y-auto space-y-3 pb-4 custom-scrollbar">
             {sites.map(site => { 
               const isActiveSite = workerStatus?.siteId === site.id; 
               const isLocked = workerStatus?.type !== 'INACTIVO' && !isActiveSite; 
               return (
                 <button 
                   key={site.id} 
                   disabled={isLocked} 
                   onClick={() => { if (isLocked) return; setSelectedSite(site); setCurrentStep(Step.SELECT_ACTION); }} 
                   className={`w-full p-4 rounded-[1.5rem] border text-left transition-all ${
                     isActiveSite 
                       ? 'bg-blue-600/20 border-blue-500 shadow-[0_0_15px_rgba(59,130,246,0.2)] text-[var(--text-main)]' 
                       : isLocked 
                         ? 'border-[var(--panel-border)] opacity-40 grayscale' 
                         : 'bg-[var(--panel-bg)] border-[var(--panel-border)] hover:border-blue-500 active:scale-95 text-[var(--text-main)]'
                   }`}
                 >
                   <div className="flex justify-between items-start">
                     <div className="max-w-[75%]">
                       <h3 className="font-black text-[var(--text-main)] text-sm uppercase tracking-tight">{site.name}</h3>
                       <p className="text-[9px] text-[var(--text-muted)] truncate uppercase font-bold mt-1">{site.address}</p>
                     </div>
                     {isActiveSite && (
                       <span className="bg-blue-600 text-white text-[8px] font-black px-2 py-1 rounded-full uppercase tracking-widest shadow-lg">Sesión Activa</span>
                     )}
                   </div>
                 </button>
               ); 
             })}
           </div>
        </div>
      );
      case Step.SELECT_ACTION: return (
        <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden">
           <div className="flex items-center gap-4 mb-6 shrink-0">
             <button onClick={() => setCurrentStep(Step.SELECT_SITE)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
               <ChevronLeft size={20}/>
             </button>
             <div>
               <h2 className="text-xl font-black text-[var(--text-main)]">Acción en Obra</h2>
               <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">{selectedSite?.name || workerStatus?.site}</p>
             </div>
           </div>
           <div className="grid grid-cols-2 gap-3 md:flex-1 pb-4 min-h-[280px]">
             <button disabled={workerStatus?.type !== 'INACTIVO'} onClick={() => handleActionSelect(LogType.ENTRADA)} className={`bg-emerald-600/10 border border-emerald-500/20 rounded-[2rem] flex flex-col items-center justify-center gap-3 text-emerald-500 active:bg-emerald-600 active:text-white transition-all ${(workerStatus?.type !== 'INACTIVO') ? 'opacity-40 grayscale pointer-events-none' : ''}`}><Zap size={32} /> <span className="text-sm font-black uppercase">Entrada</span></button>
             <button disabled={workerStatus?.type === 'INACTIVO' || workerStatus?.type === 'DESCANSO'} onClick={() => handleActionSelect(LogType.SALIDA)} className={`bg-rose-600/10 border border-rose-500/20 rounded-[2rem] flex flex-col items-center justify-center gap-3 text-rose-500 active:bg-rose-600 active:text-white transition-all ${(workerStatus?.type === 'INACTIVO' || workerStatus?.type === 'DESCANSO') ? 'opacity-40 grayscale pointer-events-none' : ''}`}><LogOut size={32} /> <span className="text-sm font-black uppercase">Salida</span></button>
             <button disabled={workerStatus?.type !== 'TRABAJANDO'} onClick={() => handleActionSelect(LogType.INICIO_DESCANSO)} className={`bg-amber-600/10 border border-amber-500/20 rounded-[2rem] flex flex-col items-center justify-center gap-3 text-amber-500 active:bg-amber-600 active:text-white transition-all ${(workerStatus?.type !== 'TRABAJANDO') ? 'opacity-40 grayscale pointer-events-none' : ''}`}><Coffee size={32} /> <span className="text-sm font-black uppercase tracking-tighter">Ini Descanso</span></button>
             <button disabled={workerStatus?.type !== 'DESCANSO'} onClick={() => handleActionSelect(LogType.FIN_DESCANSO)} className={`bg-blue-600/10 border border-blue-500/20 rounded-[2rem] flex flex-col items-center justify-center gap-3 text-blue-500 active:bg-blue-600 active:text-white transition-all ${(workerStatus?.type !== 'DESCANSO') ? 'opacity-40 grayscale pointer-events-none' : ''}`}><Timer size={32} /> <span className="text-sm font-black uppercase tracking-tighter">Fin Descanso</span></button>
           </div>
        </div>
      );
      case Step.REPORT_EXIT: return (
        <div className="flex flex-col h-full animate-fadeIn overflow-hidden pb-4">
           <div className="flex items-center gap-4 mb-6 shrink-0">
             <button onClick={() => setCurrentStep(Step.SELECT_ACTION)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
               <ChevronLeft size={20}/>
             </button>
             <div>
               <h2 className="text-xl font-black text-[var(--text-main)]">Finalizar Jornada</h2>
               <p className="text-[10px] text-rose-500 font-bold uppercase tracking-widest">{workerStatus?.site}</p>
             </div>
           </div>
           <div className="flex-1 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-[2.5rem] p-6 shadow-[var(--panel-shadow)] space-y-6 overflow-y-auto custom-scrollbar">
              <div className="space-y-3">
                 <label className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest ml-1">Modo de Trabajo</label>
                 <div className="flex gap-2">
                    {(['HORAS', 'DESTAJO'] as const).map(m => (
                      <button key={m} onClick={() => setExitWorkMode(m)} className={`flex-1 py-4 rounded-2xl text-xs font-black transition-all border ${exitWorkMode === m ? 'bg-blue-600 border-blue-500 text-white shadow-lg' : 'bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>{m}</button>
                    ))}
                 </div>
              </div>
              <div className="space-y-3">
                 <label className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest ml-1">Resumen de Tareas</label>
                 <textarea value={exitReportText} onChange={(e) => setExitReportText(e.target.value)} placeholder="¿Qué has hecho hoy?" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-[2rem] p-5 text-sm text-[var(--input-text)] focus:border-blue-500 outline-none h-40 resize-none font-medium leading-relaxed" />
              </div>
              <div className="bg-[var(--btn-glass-bg)] p-4 rounded-2xl border border-[var(--btn-glass-border)] flex items-center justify-between">
                 <div className="flex items-center gap-2"><Clock size={16} className="text-[var(--text-muted)]" /><span className="text-[10px] font-black text-[var(--text-muted)] uppercase">Tiempo hoy</span></div>
                 <span className="text-lg font-mono font-black text-[var(--text-main)]">{formatMsToTime(getEffectiveWorkTime())}</span>
              </div>
              <button 
                disabled={!exitReportText.trim()}
                onClick={() => setConfirmState({ isOpen: true, action: LogType.SALIDA })}
                className={`w-full py-5 rounded-[2rem] font-black uppercase text-xs tracking-widest flex items-center justify-center gap-3 transition-all shadow-2xl ${exitReportText.trim() ? 'bg-rose-600 text-white active:scale-95' : 'bg-slate-300 dark:bg-slate-800 text-slate-500 cursor-not-allowed'}`}
              >
                 <LogOut size={18} /> Enviar y Salir
              </button>
           </div>
        </div>
      );
      case Step.WORKER_HISTORY: return (
        <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden">
           <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
             <div className="flex items-center gap-4">
               <button onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
                 <ChevronLeft size={20}/>
               </button>
               <h2 className="text-xl font-black text-[var(--text-main)]">Mi Actividad</h2>
             </div>
             <button onClick={handleDownloadPDF} className="p-2.5 bg-emerald-600/10 text-emerald-500 rounded-xl border border-emerald-500/20 active:bg-emerald-600 active:text-white">
               <Download size={20}/>
             </button>
           </div>
           <div className="bg-[var(--panel-bg)] p-4 rounded-3xl border border-[var(--panel-border)] shadow-sm mb-4 shrink-0 space-y-4">
              <div className="flex items-center gap-2">
                <div className="w-2 h-2 rounded-full bg-blue-500 animate-pulse"></div>
                <span className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-[0.2em]">Resumen del periodo</span>
              </div>
              <div className="grid grid-cols-3 gap-2">
                 <div className="flex flex-col items-center gap-1"><span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Trabajo Neto</span><span className="text-sm font-mono font-black text-[var(--text-main)]">{formatMsToTime(historyTotals.totalWork)}</span></div>
                 <div className="flex flex-col items-center gap-1 border-x border-[var(--panel-border)]"><span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Descanso</span><span className="text-sm font-mono font-black text-[var(--text-main)]">{formatMsToTime(historyTotals.totalBreak)}</span></div>
                 <div className="flex flex-col items-center gap-1"><span className="text-[8px] font-black text-blue-400 uppercase tracking-widest">Total Bruto</span><span className="text-sm font-mono font-black text-[var(--text-main)]">{formatMsToTime(historyTotals.totalWork + historyTotals.totalBreak)}</span></div>
              </div>
           </div>
           <div className="space-y-3 mb-4 shrink-0">
             <div className="relative">
               <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
               <input type="text" placeholder="Buscar obra..." className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-2xl py-3 pl-11 pr-4 text-xs text-[var(--text-main)] outline-none focus:border-blue-500" value={historySearch} onChange={(e) => setHistorySearch(e.target.value)}/>
             </div>
             <div className="flex gap-2">{(['ALL', 'DAY', 'WEEK', 'MONTH'] as const).map(p => (<button key={p} onClick={() => setHistoryPeriod(p)} className={`flex-1 py-2.5 rounded-xl text-[10px] font-black uppercase tracking-widest transition-all border ${historyPeriod === p ? 'bg-blue-600 border-blue-500 text-white' : 'bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] text-[var(--text-muted)] hover:text-[var(--text-main)]'}`}>{p === 'ALL' ? 'Todo' : p === 'DAY' ? 'Día' : p === 'WEEK' ? 'Semana' : 'Mes'}</button>))}</div>
             {historyPeriod === 'MONTH' && (<div className="animate-slideDown relative"><select value={selectedMonth} onChange={(e) => setSelectedMonth(parseInt(e.target.value))} className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-2xl py-3 px-4 text-xs font-bold outline-none appearance-none">{MONTH_NAMES.map((name, idx) => (<option key={name} value={idx} className="bg-[var(--panel-bg)] text-[var(--text-main)]">{name}</option>))}</select><ChevronDown className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] pointer-events-none" size={16} /></div>)}
             {(historyPeriod === 'WEEK' || historyPeriod === 'DAY') && (<div className="animate-slideDown flex flex-col gap-1"><span className="text-[10px] text-[var(--text-muted)] font-black uppercase tracking-widest ml-1">{historyPeriod === 'DAY' ? 'Elegir día:' : 'Elegir día de la semana:'}</span><div className="relative"><CalendarDays size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-blue-500" /><input type="date" value={selectedDate} onChange={(e) => setSelectedDate(e.target.value)} className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-2xl py-3 pl-11 pr-4 text-xs font-bold outline-none [color-scheme:dark]"/></div></div>)}
           </div>
           <div className="md:flex-1 md:overflow-y-auto space-y-3 pb-4 custom-scrollbar">
              {filteredHistory.map(log => (
                <div key={log.id} className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] shadow-sm">
                  <div className="flex justify-between items-start mb-2">
                    <span className={`text-[10px] font-black uppercase tracking-widest ${log.type === LogType.ENTRADA ? 'text-emerald-500' : log.type === LogType.SALIDA ? 'text-rose-500' : 'text-blue-500'}`}>{log.type}</span>
                    <span className="text-[9px] text-[var(--text-muted)] font-bold">{log.dateStr} • {log.timeStr}</span>
                  </div>
                  <p className="text-xs font-black text-[var(--text-main)] uppercase tracking-tight truncate">{log.siteName}</p>
                </div>
              ))}
            </div>
         </div>
       );
       
case Step.WORKER_TOOLS: return (
        <div className="flex flex-col h-full animate-fadeIn overflow-hidden">
          <div className="flex items-center justify-between gap-4 mb-4 shrink-0">
            <div className="flex items-center gap-4">
              <button onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
                <ChevronLeft size={20}/>
              </button>
              <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter">Mis Herramientas</h2>
            </div>
            <button onClick={() => setIsToolModalOpen(true)} className="p-2.5 bg-amber-600 text-white rounded-xl shadow-lg active:scale-95"><Plus size={20}/></button>
          </div>
          <div className="relative mb-4 shrink-0"><Search className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={16}/><input type="text" placeholder="Buscar por nombre o marca..." className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-2xl py-4 pl-11 pr-4 text-xs text-[var(--input-text)] outline-none focus:border-amber-500" value={toolSearch} onChange={(e) => setToolSearch(e.target.value)}/></div>
          <div className="flex-1 overflow-y-auto space-y-3 pb-4 custom-scrollbar">
            {workerTools.map(tool => (
              <div key={tool.id} className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] flex items-center gap-4">
                <div className="w-12 h-12 bg-amber-600/10 rounded-xl flex items-center justify-center text-amber-500 border border-amber-500/10 shrink-0"><Wrench size={24} /></div>
                <div className="flex-1 min-w-0"><h4 className="font-black text-[var(--text-main)] uppercase text-sm truncate">{tool.toolName}</h4><p className="text-[10px] text-[var(--text-muted)] font-bold uppercase truncate">{tool.brand} • {tool.model || 'S/M'}</p></div>
                <button onClick={() => StorageService.deleteTool(tool.id)} className="p-2 text-rose-500 hover:bg-rose-500/10 rounded-lg transition"><Trash2 size={18} /></button>
              </div>
            ))}
          </div>
          {isToolModalOpen && (
            <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
              <div className="bg-[var(--modal-bg)] w-full max-w-sm rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative">
                <div className="flex justify-between items-center mb-6"><div><h3 className="text-lg font-black text-[var(--modal-text-main)] uppercase tracking-tighter">Añadir Herramienta</h3><p className="text-amber-500 text-[10px] font-bold uppercase tracking-widest">Nueva Ficha</p></div><button onClick={() => setIsToolModalOpen(false)} className="text-[var(--modal-text-muted)] p-2"><X size={20}/></button></div>
                <div className="space-y-4">
                  <div className="space-y-1.5"><label className="text-[9px] font-black text-[var(--modal-text-muted)] uppercase ml-1">Nombre *</label><input list="worker-tools-list" type="text" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)] outline-none" value={newToolForm.name} onChange={(e)=>setNewToolForm({...newToolForm, name: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[9px] font-black text-[var(--modal-text-muted)] uppercase ml-1">Marca *</label><input list="worker-brands-list" type="text" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)] outline-none" value={newToolForm.brand} onChange={(e)=>setNewToolForm({...newToolForm, brand: e.target.value})} /></div>
                  <div className="space-y-1.5"><label className="text-[9px] font-black text-[var(--modal-text-muted)] uppercase ml-1">Modelo</label><input type="text" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)] outline-none" value={newToolForm.model} onChange={(e)=>setNewToolForm({...newToolForm, model: e.target.value})} /></div>
                  <button onClick={handleAddWorkerTool} className="w-full bg-amber-600 text-white py-4 rounded-2xl font-black uppercase text-xs shadow-lg active:scale-95 transition mt-2">Guardar Equipo</button>
                </div>
              </div>
            </div>
          )}
        </div>
      );
      case Step.SUCCESS: return (
        <div className="flex flex-col items-center justify-center py-10 md:py-20 min-h-[60vh] flex-1 gap-6 animate-fadeIn text-center w-full max-w-md mx-auto">
           <div 
             style={{ width: '96px', height: '96px', minWidth: '96px', minHeight: '96px' }}
             className="w-24 h-24 shrink-0 flex-shrink-0 mx-auto self-center bg-emerald-600 rounded-[2rem] flex items-center justify-center shadow-2xl animate-bounce"
           >
             <CheckCircle size={44} className="text-white shrink-0" />
           </div>
           <div className="px-4">
             <h2 className="text-2xl md:text-3xl font-black text-[var(--text-main)] uppercase tracking-tighter leading-tight">
               ¡Operación con Éxito!
             </h2>
             <p className="text-[var(--text-muted)] text-xs md:text-sm mt-2 font-medium">
               Tu fichaje ha sido registrado en el sistema.
             </p>
           </div>
           <button 
             onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} 
             className="bg-[var(--btn-glass-bg)] text-[var(--text-main)] px-8 py-4 rounded-2xl font-black border border-[var(--btn-glass-border)] uppercase tracking-widest text-xs shadow-lg active:scale-95 hover:bg-slate-500/10 transition mt-2"
           >
             Regresar al Panel
           </button>
        </div>
      );
      case Step.REGISTER: return (
        <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden pb-4">
           <h2 className="text-2xl font-black text-[var(--text-main)] mb-4 shrink-0 tracking-tighter uppercase">Crear Cuenta</h2>
           <div className="bg-[var(--panel-bg)] p-5 rounded-[2.5rem] border border-[var(--panel-border)] space-y-3 shadow-xl md:overflow-y-auto custom-scrollbar md:flex-1">
             <input type="text" placeholder="Nombre completo" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)] focus:border-blue-500 outline-none" value={regName} onChange={(e)=>setRegName(e.target.value)}/>
             <input type="text" placeholder="DNI / NIE" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)] focus:border-blue-500 outline-none" value={regDni} onChange={(e)=>setRegDni(e.target.value)}/>
             <input type="tel" placeholder="Teléfono" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)] font-bold" value={regPhone} onChange={(e)=>setRegPhone(e.target.value)}/>
             <input type="email" placeholder="Correo electrónico" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-sm text-[var(--input-text)]" value={regEmail} onChange={(e)=>setRegEmail(e.target.value)}/>
             <button onClick={handleRegistration} className="w-full bg-blue-600 text-white font-black py-4 rounded-2xl uppercase tracking-widest text-xs mt-4 active:scale-95 shadow-lg shrink-0">Registrarme</button>
           </div>
        </div>
      );
      default: return (
        <div className="flex items-center justify-center h-full text-[var(--text-muted)] text-xs font-black uppercase tracking-[0.2em] animate-pulse">
           Cargando interfaz...
         </div>
      );
    }
  };

  if (isAdmin) return <AdminPanel onBack={() => setIsAdmin(false)} currentUser={currentAdminUser} theme={theme} setTheme={setTheme} />;
  return (
    <div className="min-h-screen w-screen flex items-center justify-center p-0 md:p-6 relative md:overflow-hidden font-inter select-none text-[var(--text-main)]">
      {/* Background Liquid Glows */}
      <div className="liquid-bg hidden md:block">
        <div className="liquid-glow-1"></div>
        <div className="liquid-glow-2"></div>
      </div>

      {/* Main 16:9 Aspect ratio container on desktop, full-screen on mobile */}
      <div className="w-full min-h-screen md:min-h-0 md:h-auto md:max-w-6xl md:aspect-video bg-[var(--bg-color)] md:bg-[var(--panel-bg)] backdrop-blur-none md:backdrop-blur-3xl md:rounded-[2.5rem] md:border md:border-[var(--panel-border)] md:shadow-[var(--panel-shadow)] md:overflow-hidden flex flex-col relative">
        <div className="flex-1 p-4 md:p-8 flex flex-col md:overflow-hidden relative z-10">
          {renderStep()}
        </div>
      </div>
      {showAdminLogin && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-[var(--modal-bg)] w-full max-w-sm rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative overflow-hidden">
             <div className="flex justify-between items-center mb-6"><div className="flex items-center gap-3"><div className="p-2 bg-blue-600/10 rounded-xl text-blue-500"><Shield size={24}/></div><h2 className="text-xl font-black text-[var(--modal-text-main)] uppercase tracking-tighter">Admin Login</h2></div><button onClick={() => setShowAdminLogin(false)} className="text-[var(--modal-text-muted)] hover:text-[var(--modal-text-main)]"><X size={20}/></button></div>
             <div className="space-y-4">
                <input type="text" placeholder="Usuario" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-[var(--input-text)] outline-none focus:border-blue-500" value={adminUsernameInput} onChange={(e) => setAdminUsernameInput(e.target.value)}/>
                <input type="password" placeholder="Contraseña" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-4 text-[var(--input-text)] outline-none focus:border-blue-500" value={adminPasswordInput} onChange={(e) => setAdminPasswordInput(e.target.value)}/>
                {adminError && <p className="text-rose-500 text-[10px] font-bold uppercase text-center">{adminError}</p>}
                <button onClick={verifyAdminPassword} className="w-full bg-blue-600 py-4 rounded-xl font-black text-white uppercase text-xs tracking-widest shadow-lg">Acceder al Panel</button>
             </div>
          </div>
        </div>
      )}
      {error && (<div className="fixed bottom-10 left-1/2 -translate-x-1/2 bg-rose-600 px-6 py-3 rounded-full text-xs font-black uppercase z-[200] shadow-2xl flex items-center gap-3"><ShieldAlert size={16}/> {error} <button onClick={()=>setError('')} className="bg-white/20 p-1 rounded-full"><X size={12}/></button></div>)}
      <ConfirmationModal 
        isOpen={confirmState.isOpen} 
        title={`Confirmar ${confirmState.action}`} 
        message={confirmState.action === LogType.SALIDA ? '¿Estás seguro de que deseas enviar el reporte y finalizar tu jornada?' : `¿Deseas registrar tu ${confirmState.action}?`} 
        onConfirm={() => executeLogSubmission(confirmState.action!, exitReportText, exitWorkMode)} 
        onCancel={() => setConfirmState({ isOpen: false, action: null })} 
      />
      {selectedWorker && !selectedWorker.email && (
        <div className="fixed inset-0 z-[150] bg-black/95 backdrop-blur-2xl flex items-center justify-center p-6 animate-fadeIn select-none">
          <div className="bg-[#0c0c0e] w-full max-w-md rounded-[2.5rem] border border-zinc-800 p-8 shadow-2xl relative overflow-hidden text-center">
            {/* Decorative neon gradient subtle glows */}
            <div className="absolute -top-12 -left-12 w-40 h-40 bg-[#CCFF00]/10 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-[#CCFF00]/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="relative z-10 flex flex-col items-center font-inter">
              <div className="p-4 bg-[#CCFF00]/10 rounded-full text-[#CCFF00] mb-5 border border-[#CCFF00]/20 shadow-[0_0_15px_rgba(204,255,0,0.1)]">
                <Mail size={32} />
              </div>

              <h2 className="text-2xl font-black text-white tracking-tighter uppercase font-bebas mb-2">
                REGISTRO DE CORREO OBLIGATORIO
              </h2>
              
              <p className="text-zinc-400 text-xs font-medium mb-6 leading-relaxed max-w-xs mx-auto font-sans">
                Hola <span className="text-[#CCFF00] font-black">{selectedWorker.name}</span>. Para garantizar la entrega de nóminas y partes oficiales, es obligatorio registrar tu correo electrónico.
              </p>

              <div className="w-full space-y-4">
                <div className="text-left">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block ml-1 mb-1.5 font-sans">
                    Dirección de Correo *
                  </label>
                  <input 
                    type="email" 
                    placeholder="ejemplo@carmagne.com" 
                    className="w-full bg-zinc-900/80 border border-zinc-800 text-white rounded-xl p-4 text-sm outline-none focus:border-[#CCFF00] transition-colors font-semibold font-sans" 
                    value={forceEmailInput} 
                    onChange={(e) => {
                      setForceEmailInput(e.target.value);
                      if (forceEmailError) setForceEmailError('');
                    }}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') handleSaveForceEmail();
                    }}
                  />
                </div>

                {forceEmailError && (
                  <p className="text-rose-500 text-[10px] font-bold uppercase tracking-wider bg-rose-500/10 border border-rose-500/20 py-2.5 px-4 rounded-lg font-sans">
                    {forceEmailError}
                  </p>
                )}

                <button 
                  onClick={handleSaveForceEmail} 
                  disabled={loading}
                  className="w-full bg-[#CCFF00] hover:bg-[#e1ff33] disabled:opacity-50 text-black font-black py-4 rounded-xl uppercase text-xs tracking-widest transition-all duration-300 active:scale-95 shadow-lg shadow-[#CCFF00]/10 font-sans"
                >
                  {loading ? 'Guardando...' : 'GUARDAR Y CONTINUAR'}
                </button>

                <div className="pt-2">
                  <button 
                    onClick={resetApp} 
                    className="text-zinc-500 hover:text-zinc-300 text-[10px] font-bold uppercase tracking-widest transition-colors font-sans"
                  >
                    Cerrar Sesión / Cancelar
                  </button>
                </div>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* iOS 26 Styled Push Notifications Container */}
      <div className="fixed top-4 left-0 right-0 z-[99999] flex flex-col items-center gap-2 pointer-events-none px-4">
        {pushNotifications.map(notif => (
          <div 
            key={notif.id}
            onClick={() => handleNotificationClick(notif)}
            className="pointer-events-auto w-full max-w-sm bg-[#050505]/90 backdrop-blur-xl border border-[#CCFF00]/30 text-white rounded-[2rem] p-4 flex gap-3 shadow-[0_10px_30px_rgba(204,255,0,0.15)] cursor-pointer hover:scale-[1.02] transition-all duration-300 transform animate-slideDown relative overflow-hidden"
          >
             {/* Dynamic neon top bar */}
             <div className="absolute top-0 left-0 right-0 h-[2px] bg-gradient-to-r from-transparent via-[#CCFF00] to-transparent opacity-80" />
             
             {/* Left Icon/Initial */}
             <div className="w-10 h-10 min-w-[40px] rounded-2xl bg-zinc-950 border border-zinc-900 flex items-center justify-center text-lg shadow-inner">
               {notif.icon || (notif.type === 'chat' ? '💬' : '📋')}
             </div>
             
             {/* Body */}
             <div className="flex-1 min-w-0">
               <div className="flex justify-between items-center">
                 <span className="text-[9px] text-[#CCFF00] font-black uppercase tracking-wider font-sans">
                   {notif.type === 'chat' ? 'Mensaje Recibido' : 'Registro de Actividad'}
                 </span>
                 <span className="text-[9px] text-zinc-500 font-mono">Ahora</span>
               </div>
               <h4 className="text-xs font-black text-white uppercase tracking-tighter mt-0.5 truncate font-sans">
                 {notif.title}
               </h4>
               <p className="text-[10px] text-zinc-300 font-medium truncate mt-0.5 leading-snug font-sans">
                 {notif.body}
               </p>
             </div>
             
             {/* Subtle iOS indicator line */}
             <div className="absolute bottom-1 w-12 h-[3px] left-1/2 transform -translate-x-1/2 bg-zinc-800 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
};
