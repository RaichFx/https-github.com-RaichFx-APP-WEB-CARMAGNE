
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { 
  User, MapPin, CheckCircle, 
  LogOut, Coffee, ArrowRight, ShieldAlert, Lock, Fingerprint, Delete, UserPlus, Save, ChevronLeft, Calendar, History, Clock, Smartphone, X, Mic, MicOff, FileText, Cloud, ExternalLink, Briefcase, Phone, KeyRound, BellRing, Search, Download, CalendarDays, Zap, Wrench, Package, Info, Plus, Trash2, Timer, Filter, ChevronDown, Shield, AlertTriangle, AlertCircle, Image as ImageIcon, Upload, ClipboardList, Sun, Moon, Eye, MessageSquare, Send, Mail, Edit3
} from 'lucide-react';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { StorageService, ELECTRICAL_TOOLS_LIST, ELECTRICAL_BRANDS_LIST, compressImage } from './services/storageService';
import { LocationService } from './services/locationService';
import { TelegramService } from './services/telegramService';
import { PushService, type PushPermissionStatus } from './services/pushService';
import { Worker, Site, WorkLog, LogType, GeoLocationData, WorkMode, AdminUser, ToolRecord, AppConfig, WeeklyReport, Payslip, ChatMessage } from './types';
import { AdminPanel } from './components/AdminPanel';
import { InstallTutorial } from './components/InstallTutorial';
import { ConfirmationModal } from './components/ConfirmationModal';
import { signInWithCustomToken, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from './services/firebase';

type WorkerCertificate = NonNullable<Worker['certificates']>[number];
enum Step {
  LOGIN_PHONE = 0,
  WORKER_DASHBOARD = 15,
  WORKER_HISTORY = 16,
  WORKER_TOOLS = 17,
  WORKER_REPORTS = 18,
  WORKER_PAYSLIPS = 19,
  WORKER_PROFILE = 20,
  WORKER_CERTIFICATES = 21,
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

const isPasswordProtectedPdf = async (file: File): Promise<boolean> => {
  const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);
  if (!isPdf) return false;

  const buffer = await file.arrayBuffer();
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunkSize = 0x8000;

  for (let i = 0; i < bytes.length; i += chunkSize) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunkSize));
  }

  const compactPdfText = binary.replace(/\s+/g, '');
  return compactPdfText.includes('/Encrypt') || compactPdfText.includes('/Filter/Standard') || compactPdfText.includes('/EncryptMetadata');
};

const downloadDataUri = (dataUri: string, fileName: string) => {
  const link = document.createElement('a');
  link.href = dataUri;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
};

const AppLogo = ({ className, size = "md", logoUrl, scale = 1.0, theme = "light" }: { className?: string, size?: "sm" | "md" | "lg", logoUrl?: string, scale?: number, theme?: "light" | "dark" }) => {
  const baseSize = size === "sm" ? 28 : size === "md" ? 64 : size === "lg" ? 140 : 64;
  const iconSize = baseSize * scale;
  const configuredLogo = logoUrl || "/logo.png";
  const logoSrc = configuredLogo === "/logo.png" ? (theme === "dark" ? "/logo.png" : "/logo-black.png") : configuredLogo;
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
  const [locationRetry, setLocationRetry] = useState<{ type: LogType; report?: string; mode?: WorkMode } | null>(null);
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
  const [isEditingProfile, setIsEditingProfile] = useState(false);
  const [editDni, setEditDni] = useState('');
  const [editEmail, setEditEmail] = useState('');
  const [editPhone, setEditPhone] = useState('');
  
  const [exitReportText, setExitReportText] = useState('');
  const [exitWorkMode, setExitWorkMode] = useState<WorkMode>('HORAS');
  const [pinInput, setPinInput] = useState('');
  const [isPhoneVerified, setIsPhoneVerified] = useState(false);
  const [matchedWorker, setMatchedWorker] = useState<Worker | null>(null);
  const [loginPassword, setLoginPassword] = useState('');
  const [showLoginPassword, setShowLoginPassword] = useState(false);
  const [recoveryPhone, setRecoveryPhone] = useState('');
  const [recoveryDni, setRecoveryDni] = useState('');
  const [recoveryEmail, setRecoveryEmail] = useState('');
  const [recoveryPassword, setRecoveryPassword] = useState('');
  const [recoveryPasswordConfirm, setRecoveryPasswordConfirm] = useState('');
  const [recoveryMessage, setRecoveryMessage] = useState('');
  const [profileCurrentPassword, setProfileCurrentPassword] = useState('');
  const [profileNewPassword, setProfileNewPassword] = useState('');
  const [profileNewPasswordConfirm, setProfileNewPasswordConfirm] = useState('');
  const [profilePasswordMessage, setProfilePasswordMessage] = useState('');
  const [profilePasswordLoading, setProfilePasswordLoading] = useState(false);
  const [showRegPin, setShowRegPin] = useState(false);
  const [showRegPinConfirm, setShowRegPinConfirm] = useState(false);
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
  const [workerDirectory, setWorkerDirectory] = useState<Worker[]>([]);
  const [expandedPhoneWorkerId, setExpandedPhoneWorkerId] = useState<string | null>(null);
  const [expandedDirectoryWorkerId, setExpandedDirectoryWorkerId] = useState<string | null>(null);

  // iOS 26 Push Notifications state
  const [pushNotifications, setPushNotifications] = useState<any[]>([]);
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus>(() => PushService.getPermissionStatus());
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushRegistered, setPushRegistered] = useState(false);
  
  const selectedWorkerRef = useRef<Worker | null>(null);
  const isAdminRef = useRef<boolean>(false);
  const mountTimeRef = useRef<number>(Date.now());
  const notifiedIdsRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    selectedWorkerRef.current = selectedWorker;
    if (selectedWorker) {
      setPushRegistered(PushService.isRegisteredLocally({
        ownerType: 'worker',
        ownerId: selectedWorker.id,
        ownerName: selectedWorker.name,
      }));
      setPushStatus(PushService.getPermissionStatus());
    }
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

  const handleEnableWorkerPush = async () => {
    if (!selectedWorker) return;
    setPushLoading(true);
    setPushMessage('');

    try {
      const result = await PushService.requestPermissionAndRegister({
        ownerType: 'worker',
        ownerId: selectedWorker.id,
        ownerName: selectedWorker.name,
      });

      setPushStatus(result.status);
      setPushMessage(result.message);

      if (result.ok) {
        setPushRegistered(true);
        triggerPushNotification(
          'Notificaciones activadas',
          'Te avisaremos aunque no estés dentro de la app.',
          'system',
          undefined,
          '🔔'
        );
      }
    } catch (error: any) {
      setPushStatus(PushService.getPermissionStatus());
      setPushMessage(error?.message || 'No se pudieron activar las notificaciones.');
    } finally {
      setPushLoading(false);
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
    
    // Load only cached non-sensitive UI data before authentication.
    setSites(StorageService.getSites());
    setAppConfig(StorageService.getConfig());

    return () => {
      clearTimeout(timer); clearInterval(interval);
    };
  }, []);

  useEffect(() => {
    if (!selectedWorker?.id || isAdmin) return;

    const unsubWorker = StorageService.subscribeToWorker(selectedWorker.id, (worker) => {
      if (worker && worker.active) {
        setSelectedWorker(worker);
        setWorkers([worker]);
        setWorkerDirectory(prev => {
          const byId = new Map<string, Worker>(prev.map(item => [item.id, item]));
          byId.set(worker.id, sanitizeWorkerForDirectory(worker));
          return Array.from(byId.values());
        });
      } else {
        resetApp();
        setError('Cuenta desactivada o pendiente de aprobación.');
      }
    });
    const unsubWorkerDirectory = StorageService.subscribeToWorkers((newWorkers) => {
      const safeDirectory = newWorkers
        .filter(worker => worker.active)
        .map(sanitizeWorkerForDirectory)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
      setWorkerDirectory(safeDirectory);
    });
    loadWorkerDirectoryFromApi().catch(error => console.warn('No se pudo cargar el directorio de compañeros:', error));
    const unsubSites = StorageService.subscribeToSites(setSites);
    const unsubLogs = StorageService.subscribeToWorkerLogs(selectedWorker.id, (newLogs) => {
      setWorkerLogs(newLogs);
      newLogs.forEach(log => {
        if (log.timestamp > mountTimeRef.current && !notifiedIdsRef.current.has(log.id)) {
          notifiedIdsRef.current.add(log.id);
        }
      });
    });
    const unsubTools = StorageService.subscribeToWorkerTools(selectedWorker.id, setAllTools);
    const unsubReports = StorageService.subscribeToWorkerReports(selectedWorker.id, setMyReports);
    const unsubPayslips = StorageService.subscribeToWorkerPayslips(selectedWorker.id, setMyPayslips);
    const unsubChats = StorageService.subscribeToWorkerChats(selectedWorker.id, (newChats) => {
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
    StorageService.runMonthlyChatCleanup()
      .then(result => {
        if (result.deleted && result.deleted > 0) {
          console.log(`[Chat Cleanup] ${result.deleted} mensajes antiguos eliminados.`);
        }
      })
      .catch(error => console.warn('No se pudo ejecutar la limpieza mensual de chats:', error));
    return () => {
      unsubWorker(); unsubWorkerDirectory(); unsubSites(); unsubLogs(); unsubTools(); unsubReports(); unsubPayslips(); unsubChats();
    };
  }, [selectedWorker?.id, isAdmin]);

  // Dynamic favicon update
  useEffect(() => {
    if (appConfig?.faviconUrl) {
      let link: HTMLLinkElement | null = document.querySelector("link[rel*='icon']");
      if (!link) {
        link = document.createElement('link');
        link.rel = 'icon';
        link.type = 'image/png';
        document.getElementsByTagName('head')[0].appendChild(link);
      }
      link.href = appConfig.faviconUrl;
    }
  }, [appConfig?.faviconUrl]);

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

  const getRequiredLocationErrorMessage = (err: any) => {
    const code = Number(err?.code);
    if (code === 1) return 'Ubicación obligatoria: pulsa Reintentar ubicación y acepta el permiso cuando aparezca. Si no aparece, la ubicación está bloqueada en ajustes del navegador o de la app.';
    if (code === 2) return 'No se pudo obtener tu ubicación. Activa el GPS/datos del dispositivo y pulsa Reintentar ubicación.';
    if (code === 3) return 'No se pudo obtener tu ubicación a tiempo. Acércate a una zona con mejor señal y pulsa Reintentar ubicación.';
    return err?.message || 'No se pudo obtener tu ubicación. Sin ubicación no se puede fichar.';
  };

  const getLocationPermissionState = async (): Promise<'granted' | 'prompt' | 'denied' | 'unknown'> => {
    try {
      const permissions = (navigator as any).permissions;
      if (!permissions?.query) return 'unknown';
      const status = await permissions.query({ name: 'geolocation' } as any);
      return status?.state || 'unknown';
    } catch {
      return 'unknown';
    }
  };

  const handleLocationRetry = async () => {
    if (!locationRetry || loading) return;

    setError('Solicitando ubicación... acepta el permiso cuando aparezca.');
    const permissionState = await getLocationPermissionState();

    if (permissionState === 'denied') {
      setError('La ubicación está bloqueada para esta app. Actívala en ajustes del navegador/app y después vuelve a pulsar el fichaje. Sin ubicación no se puede fichar.');
      return;
    }

    await executeLogSubmission(locationRetry.type, locationRetry.report, locationRetry.mode);
  };

  const sanitizeWorkerForDirectory = (worker: Worker): Worker => ({
    ...worker,
    pin: '',
    pinHash: '',
    certificates: [],
  });

  const mergeWorkerDirectory = (incomingWorkers: Worker[]) => {
    setWorkerDirectory(prev => {
      const byId = new Map<string, Worker>();
      [...prev, ...incomingWorkers]
        .filter(Boolean)
        .map(sanitizeWorkerForDirectory)
        .forEach(worker => byId.set(worker.id, worker));
      return Array.from(byId.values())
        .filter(worker => worker.active)
        .sort((a, b) => a.name.localeCompare(b.name, 'es'));
    });
  };

  const loadWorkerDirectoryFromApi = async () => {
    const user = auth.currentUser;
    if (!user) return;

    const idToken = await user.getIdToken();
    const response = await fetch('/api/workers/directory', {
      method: 'GET',
      headers: {
        Authorization: `Bearer ${idToken}`,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'No se pudo cargar el directorio de operarios.');
    }

    if (Array.isArray(data?.workers)) {
      mergeWorkerDirectory(data.workers as Worker[]);
    }
  };

  const getWorkerDirectory = () => {
    const byId = new Map<string, Worker>();
    [...workerDirectory, ...workers, ...(selectedWorker ? [selectedWorker] : [])]
      .filter(Boolean)
      .forEach(worker => byId.set(worker.id, sanitizeWorkerForDirectory(worker)));
    return Array.from(byId.values());
  };

  const getWorkerById = (workerId?: string | null) => {
    if (!workerId) return undefined;
    return getWorkerDirectory().find(worker => worker.id === workerId);
  };

  const getWhatsAppPhoneNumber = (phone?: string) => {
    if (!phone) return '';
    return processSpanishPhone(phone).replace(/[^\d]/g, '');
  };

  const repairDisplayText = (value?: string | null) => {
    if (!value) return '';
    return String(value)
      .replace(/\u00c3\u00a1/g, 'á').replace(/\u00c3\u00a9/g, 'é').replace(/\u00c3\u00ad/g, 'í').replace(/\u00c3\u00b3/g, 'ó').replace(/\u00c3\u00ba/g, 'ú')
      .replace(/\u00c3\u0081/g, 'Á').replace(/\u00c3\u0089/g, 'É').replace(/\u00c3\u008d/g, 'Í').replace(/\u00c3\u0093/g, 'Ó').replace(/\u00c3\u009a/g, 'Ú')
      .replace(/\u00c3\u00b1/g, 'ñ').replace(/\u00c3\u0091/g, 'Ñ')
      .replace(/\u00c2\u00bf/g, '¿').replace(/\u00c2\u00a1/g, '¡')
      .replace(/\u00e2\u20ac\u00a2/g, '')
      .replace(/\uFFFD/g, '')
      .trim();
  };

  const getWorkerPhotoUrl = (worker?: Partial<Worker> | null) => {
    const record = worker as Partial<Worker> & {
      photoURL?: string;
      photo?: string;
      avatarUrl?: string;
      profilePhotoUrl?: string;
      profileImageUrl?: string;
      imageUrl?: string;
    } | null | undefined;

    return repairDisplayText(
      record?.photoUrl ||
      record?.photoURL ||
      record?.photo ||
      record?.avatarUrl ||
      record?.profilePhotoUrl ||
      record?.profileImageUrl ||
      record?.imageUrl ||
      ''
    );
  };

  const getWorkerInitial = (worker?: Partial<Worker> | null) => {
    const name = repairDisplayText(worker?.name);
    return (name.charAt(0) || '?').toUpperCase();
  };

  const formatDni = (dni?: string) => {
    const cleanDni = repairDisplayText(dni)
      .toUpperCase()
      .replace(/[^0-9A-Z]/g, '');
    return cleanDni || 'No indicado';
  };

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

  const handlePhoneLogin = async () => {
    const formattedPhone = processSpanishPhone(loginPhone);
    if(!isPhoneValidSpain(formattedPhone)) { setError("Solo se permiten números de España (+34)"); return; }

    if (!isPhoneVerified) {
      setMatchedWorker(null);
      setIsPhoneVerified(true);
      setError('');
      setLoginPassword('');
      return;
    }

    if (!loginPassword.trim()) {
      setError('Introduce tu contraseña.');
      return;
    }

    setLoading(true);
    try {
      const response = await fetch('/api/auth/worker-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ phone: formattedPhone, password: loginPassword }),
      });
      const data = await response.json().catch(() => ({}));

      if (response.status === 404) {
        if (confirm("Este número no está registrado. ¿Quieres crear una cuenta nueva?")) {
          setRegPhone(formattedPhone);
          setError('');
          setCurrentStep(Step.REGISTER);
        }
        return;
      }

      if (!response.ok || !data.token || !data.worker) {
        setError(data.error || 'No se pudo iniciar sesión.');
        return;
      }

      await signInWithCustomToken(auth, data.token);
      setSelectedWorker(data.worker as Worker);
      setWorkers([data.worker as Worker]);
      setWorkerDirectory([sanitizeWorkerForDirectory(data.worker as Worker)]);
      loadWorkerDirectoryFromApi().catch(error => console.warn('No se pudo cargar el directorio de compañeros:', error));
      setError('');
      setIsPhoneVerified(false);
      setMatchedWorker(null);
      setLoginPassword('');
      setCurrentStep(Step.WORKER_DASHBOARD);
    } catch (err) {
      console.error("Error en login seguro de trabajador:", err);
      setError('Error al iniciar sesión.');
    } finally {
      setLoading(false);
    }
  };

  const startPasswordRecovery = () => {
    const formattedPhone = processSpanishPhone(loginPhone || '');
    setRecoveryPhone(isPhoneValidSpain(formattedPhone) ? formattedPhone : loginPhone);
    setRecoveryDni('');
    setRecoveryEmail('');
    setRecoveryPassword('');
    setRecoveryPasswordConfirm('');
    setRecoveryMessage('');
    setError('');
    setCurrentStep(Step.RECOVERY);
  };

  const handlePasswordRecovery = async () => {
    // The previous public flow accepted personal data as proof of identity. Keep this
    // screen explicit instead of attempting an insecure reset from an unauthenticated device.
    setError('');
    setRecoveryMessage('Por seguridad, solicita al administrador que restablezca tu contraseña.');
  };  const renderPasswordRecovery = () => (
    <div className="flex flex-col h-full animate-fadeIn justify-center items-center py-4 max-w-sm mx-auto w-full">
      <div className="text-center w-full">
        <div className="inline-flex mb-6">
          <AppLogo size="lg" logoUrl={appConfig.logoUrl} scale={appConfig.logoScaleLogin} theme={theme} />
        </div>
        <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter uppercase font-sans">Recuperar acceso</h2>
        <p className="text-[var(--text-muted)] text-[10px] font-black uppercase tracking-[0.25em] mt-1">Protección de cuenta</p>
      </div>

      <div className="bg-[var(--panel-bg)] backdrop-blur-2xl p-6 rounded-[2.5rem] border border-[var(--panel-border)] w-full mt-6 shadow-[var(--panel-shadow)] text-center">
        <p className="text-sm text-[var(--text-main)] font-black uppercase tracking-wide">Restablecimiento protegido</p>
        <p className="text-xs leading-relaxed text-[var(--text-muted)] font-medium mt-3">Para evitar que alguien pueda cambiar una contraseña usando datos personales, el restablecimiento lo realiza el administrador tras comprobar tu identidad.</p>
        <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-wider mt-4">Contacta con tu jefe o administrador.</p>
        {recoveryMessage && (
          <div className="mt-4 rounded-2xl border border-[#15803D]/20 bg-[#15803D]/10 p-3 text-center text-[10px] font-black uppercase tracking-widest text-[#15803D]">{recoveryMessage}</div>
        )}
        <button
          type="button"
          onClick={() => { setCurrentStep(Step.LOGIN_PHONE); setError(''); setRecoveryMessage(''); }}
          className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 rounded-2xl shadow-lg shadow-[#15803D]/10 mt-6 flex items-center justify-center gap-2 active:scale-95 uppercase text-xs tracking-widest transition-all"
        >
          Volver al login <ArrowRight size={14} />
        </button>
      </div>
    </div>
  );
