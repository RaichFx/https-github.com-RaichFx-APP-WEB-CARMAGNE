
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

  const startEditingProfile = () => {
    if (selectedWorker) {
      setEditDni(selectedWorker.dni || '');
      setEditEmail(selectedWorker.email || '');
      setEditPhone(selectedWorker.phone || '');
      setIsEditingProfile(true);
      setError('');
    }
  };

  const cancelEditingProfile = () => {
    setIsEditingProfile(false);
    setError('');
  };

  const handleSaveProfile = async () => {
    if (!selectedWorker) return;
    const fPhone = processSpanishPhone(editPhone);
    if (!editDni.trim() || !fPhone || !editEmail.trim()) {
      setError('Todos los campos son obligatorios.');
      return;
    }
    if (!isPhoneValidSpain(fPhone)) {
      setError('Solo números de España (+34)');
      return;
    }
    if (!/\S+@\S+\.\S+/.test(editEmail)) {
      setError('El formato del correo electrónico no es válido.');
      return;
    }

    const duplicate = getWorkerDirectory().find(w => w.id !== selectedWorker.id && w.phone && processSpanishPhone(w.phone) === fPhone);
    if (duplicate) {
      setError('Este número de teléfono ya está registrado por otro empleado.');
      return;
    }

    const updatedWorker = {
      ...selectedWorker,
      dni: editDni.trim(),
      phone: fPhone,
      email: editEmail.trim(),
    };

    setLoading(true);
    try {
      await StorageService.saveWorkers([updatedWorker]);
      setWorkers([updatedWorker]);
      setSelectedWorker(updatedWorker);
      setWorkerDirectory(prev => {
        const byId = new Map<string, Worker>(prev.map(item => [item.id, item]));
        byId.set(updatedWorker.id, sanitizeWorkerForDirectory(updatedWorker));
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
      });
      setIsEditingProfile(false);
      setError('');
    } catch (err) {
      console.error("Error updating profile:", err);
      setError("Error al guardar el perfil.");
    } finally {
      setLoading(false);
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
    if (!regPin.trim()) { setError('La contraseña es obligatoria.'); return; }
    if (regPin !== regPinConfirm) { setError('Las contraseñas no coinciden.'); return; }
    setLoading(true);
    try { 
      const response = await fetch('/api/auth/register-worker', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          name: regName.trim(),
          dni: regDni.trim(),
          phone: fPhone,
          email: regEmail.trim(),
          password: regPin.trim(),
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        setError(data.error || 'Error al registrar.');
        return;
      }

      // Notificación Telegram: Nuevo Operario
      const telegramMessage = `🆕 <b>Nuevo Operario Pendiente de Aprobación</b>\n👷‍♂️ Nombre: <b>${regName.trim()}</b>\n🆔 DNI: ${regDni.trim()}\n📱 Teléfono: ${fPhone}\n📧 Email: ${regEmail.trim()}`;
      TelegramService.enviarNotificacionTelegram(telegramMessage);

      alert("Registro enviado. Tu cuenta queda pendiente de aprobación por el administrador.");
      setRegName('');
      setRegDni('');
      setRegEmail('');
      setRegPin('');
      setRegPinConfirm('');
      setLoginPassword('');
      setIsPhoneVerified(false);
      setCurrentStep(Step.LOGIN_PHONE); 
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
      await StorageService.saveWorkers([updatedWorker]);
      setWorkers([updatedWorker]);
      setSelectedWorker(updatedWorker);
      setWorkerDirectory(prev => {
        const byId = new Map<string, Worker>(prev.map(item => [item.id, item]));
        byId.set(updatedWorker.id, sanitizeWorkerForDirectory(updatedWorker));
        return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
      });
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
      PushService.sendEvent({
        eventType: 'worker_log',
        payload: {
          workerId: newLog.workerId,
          workerName: newLog.workerName,
          logType: newLog.type,
          siteName: newLog.siteName,
          timeStr: newLog.timeStr,
          dateStr: newLog.dateStr,
        },
      }).catch((pushError) => console.warn('No se pudo enviar push de fichaje:', pushError));
      
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
    firebaseSignOut(auth).catch(() => {});
    setCurrentStep(Step.LOGIN_PHONE); 
    setSelectedWorker(null); 
    setWorkers([]);
    setWorkerDirectory([]);
    setChats([]);
    setActiveChatPartnerId(null);
    setExpandedPhoneWorkerId(null);
    setSelectedSite(null); 
    setError(''); 
    setPinInput(''); 
    setLoginPhone(''); 
  };

  const verifyAdminPassword = async () => {
    setLoading(true);
    try {
      const response = await fetch('/api/auth/admin-login', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          username: adminUsernameInput,
          password: adminPasswordInput,
        }),
      });
      const data = await response.json().catch(() => ({}));

      if (!response.ok || !data.token) {
        setAdminError(data.error || 'Credenciales incorrectas');
        return;
      }

      await signInWithCustomToken(auth, data.token);
      setIsAdmin(true);
      setCurrentAdminUser((data.admin || null) as AdminUser | null);
      setShowAdminLogin(false);
      setAdminError('');
      setAdminPasswordInput('');
    } catch (err) {
      console.error("Error en login seguro de admin:", err);
      setAdminError('No se pudo iniciar sesión de administrador.');
    } finally {
      setLoading(false);
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
                <span className="text-base font-black text-[var(--text-main)] block leading-tight hover:text-[#15803D] transition-colors">{selectedWorker?.name}</span>
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

          <div className="bg-[var(--panel-bg)] backdrop-blur-xl border border-[var(--panel-border)] rounded-[2rem] p-4 shadow-[var(--panel-shadow)] relative overflow-hidden shrink-0">
            <div className="absolute -right-8 -top-8 w-24 h-24 bg-[#15803D]/10 rounded-full blur-2xl pointer-events-none"></div>
            <div className="relative z-10 flex items-center justify-between gap-3">
              <div className="flex items-center gap-3 min-w-0">
                <div className="w-11 h-11 rounded-2xl bg-[#15803D]/10 border border-[#15803D]/20 flex items-center justify-center text-[#15803D] shrink-0">
                  <BellRing size={20} />
                </div>
                <div className="min-w-0">
                  <p className="text-xs font-black uppercase tracking-wider text-[var(--text-main)]">Activar notificaciones</p>
                  <p className="text-[10px] text-[var(--text-muted)] font-semibold leading-snug">
                    {pushMessage || PushService.getStatusMessage(pushStatus)}
                  </p>
                </div>
              </div>
              <button
                onClick={handleEnableWorkerPush}
                disabled={pushLoading || pushRegistered}
                className={`shrink-0 px-4 py-3 rounded-2xl text-[9px] font-black uppercase tracking-widest transition-all active:scale-95 ${
                  pushRegistered
                    ? 'bg-emerald-500/10 text-emerald-500 border border-emerald-500/20'
                    : 'bg-[#15803D] text-black hover:bg-[#16A34A] disabled:opacity-60'
                }`}
              >
                {pushLoading ? 'Activando...' : pushRegistered ? 'Activadas' : pushStatus === 'granted' ? 'Registrar' : 'Activar'}
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
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Partes</span>
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
            {/* Navigation: Certificates */}
            <button onClick={() => setCurrentStep(Step.WORKER_CERTIFICATES)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-blue-500/30 transition-all duration-300">
              <div className="text-blue-500 bg-blue-500/10 p-3 rounded-2xl border border-blue-500/10"><FileText size={24} /></div>
              <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider">Certificados</span>
            </button>
            {/* Navigation: Chat / Mensajes */}
            <button onClick={() => setCurrentStep(Step.WORKER_CHAT)} className="bg-[var(--panel-bg)] backdrop-blur-md border border-[var(--panel-border)] p-4 rounded-3xl flex flex-col items-center justify-center gap-2 active:bg-[var(--btn-glass-bg)] hover:border-[#15803D]/30 transition-all duration-300 relative">
              {unreadChatsCount > 0 && (
                <div className="absolute top-2 right-2 bg-[#15803D] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_10px_rgba(21,128,61,0.4)]">
                  {unreadChatsCount}
                </div>
              )}
              <div className="text-[#15803D] bg-[#15803D]/10 p-3 rounded-2xl border border-[#15803D]/10"><MessageSquare size={24} /></div>
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
                <button onClick={() => setCurrentStep(Step.SELECT_SITE)} className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-[#15803D]/10 transition-all duration-300 active:scale-95 uppercase text-xs tracking-widest">
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
                    <button onClick={() => handleActionSelect(LogType.FIN_DESCANSO)} className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 px-6 rounded-2xl flex items-center justify-center gap-2 shadow-lg shadow-[#15803D]/10 transition-all duration-300 active:scale-95 uppercase text-xs tracking-widest">
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
    setSubmittingReport(true);
    try {
      // Formato para el período si se han seleccionado fechas
      let selectedRange = "Sin período especificado";
      if (reportStartDate && reportEndDate) {
        const startFormatted = new Date(reportStartDate).toLocaleDateString('es-ES');
        const endFormatted = new Date(reportEndDate).toLocaleDateString('es-ES');
        selectedRange = `${startFormatted} al ${endFormatted}`;
      } else if (reportStartDate) {
        selectedRange = `Desde ${new Date(reportStartDate).toLocaleDateString('es-ES')}`;
      }

      const newReport: WeeklyReport = {
        id: `REP-${Date.now()}`,
        workerId: selectedWorker!.id,
        workerName: selectedWorker!.name,
        dateStr: new Date().toLocaleDateString('es-ES'),
        timestamp: Date.now(),
        photoUrl: reportPhoto,
        startDate: reportStartDate || '',
        endDate: reportEndDate || '',
        comments: reportComments || '',
        status: 'PENDING',
        isAiParsed: false,
        extractedDates: selectedRange,
        extractedTasks: '',
        extractedHours: 0,
        extractedTotal: '',
        dailyHours: []
      };

      await StorageService.addReport(newReport);

      let msg = `👷‍♂️ <b>Nuevo Parte Semanal Subido</b>\n👤 Operario: <b>${selectedWorker!.name}</b>\n📅 Período: ${selectedRange}\n📅 Envío: ${newReport.dateStr}`;
      if (reportComments.trim()) {
        msg += `\n📝 Comentarios: ${reportComments.trim()}`;
      }
      TelegramService.enviarNotificacionTelegram(msg);

      alert("Parte semanal subido correctamente para revisión.");
      setReportPhoto(null);
      setReportStartDate('');
      setReportEndDate('');
      setReportComments('');
      setCurrentStep(Step.WORKER_DASHBOARD);
    } catch (err) {
      alert("Error al subir el parte semanal. Inténtalo de nuevo.");
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

    const partnerName = activeChatPartnerId === 'ADMIN' ? 'El Jefe' : (getWorkerById(activeChatPartnerId)?.name || 'Compañero');

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
      PushService.sendEvent({
        eventType: 'chat_message',
        payload: msg,
      }).catch((pushError) => console.warn('No se pudo enviar push de chat:', pushError));
      setChatMessageInput('');
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al enviar el mensaje.");
    }
  };

  useEffect(() => {
    if (currentStep === Step.WORKER_CHAT && selectedWorker && activeChatPartnerId) {
      StorageService.markMessagesAsRead(activeChatPartnerId, selectedWorker.id);
    }
  }, [currentStep, activeChatPartnerId, chats, selectedWorker]);

  useEffect(() => {
    setExpandedPhoneWorkerId(null);
  }, [activeChatPartnerId]);

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
          await StorageService.saveWorkers([updated]);
          setWorkers([updated]);
          setSelectedWorker(updated);
          setWorkerDirectory(prev => {
            const byId = new Map<string, Worker>(prev.map(item => [item.id, item]));
            byId.set(updated.id, sanitizeWorkerForDirectory(updated));
            return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
          });
          alert("Foto de perfil actualizada.");
        } catch (err) {
          console.error("Error compressing image", err);
          alert("Hubo un error al procesar o guardar la imagen.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddCertificate = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedWorker) {
      const name = certNameInput.trim() || file.name.split('.')[0];
      const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/i.test(file.name);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

      if (!isImage && !isPdf) {
        alert("Solo se pueden subir certificados en PDF o imagen (JPG, PNG, WEBP o HEIC).");
        if (certFileInputRef.current) certFileInputRef.current.value = '';
        return;
      }

      if (isPdf && file.size > 750 * 1024) {
        alert(`El archivo PDF es demasiado grande (${(file.size / 1024).toFixed(0)} KB). El tamaño máximo permitido para archivos PDF es de 750 KB para no superar el límite de almacenamiento de Firebase.\n\nSugerencia: Puedes hacer una foto o captura de pantalla al certificado y subir la imagen.`);
        if (certFileInputRef.current) certFileInputRef.current.value = '';
        return;
      }

      if (isPdf) {
        try {
          const protectedPdf = await isPasswordProtectedPdf(file);
          if (protectedPdf) {
            alert("No se puede subir este certificado porque el PDF está protegido con contraseña. Sube una versión sin contraseña o una imagen/captura.");
            if (certFileInputRef.current) certFileInputRef.current.value = '';
            return;
          }
        } catch (err) {
          console.error("Error checking PDF password protection", err);
          alert("No se pudo comprobar si el PDF está protegido. Por seguridad, no se ha subido.");
          if (certFileInputRef.current) certFileInputRef.current.value = '';
          return;
        }
      }

      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          let fileData = reader.result as string;

          if (isImage) {
            fileData = await compressImage(fileData, 1200, 1200, 0.75);
          }

          if (fileData.length > 1050000) {
            alert("El archivo resultante supera el límite máximo permitido por documento. Por favor, selecciona un archivo más pequeño o una imagen comprimida.");
            if (certFileInputRef.current) certFileInputRef.current.value = '';
            return;
          }

          const certId = `CERT-${Date.now()}`;
          const newCertDoc = {
            id: certId,
            workerId: selectedWorker.id,
            name: name,
            fileBase64: fileData,
            mimeType: isPdf ? 'application/pdf' : (file.type || 'image/jpeg'),
            uploadDate: new Date().toLocaleDateString('es-ES'),
            size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
          };

          // Save the file in Firebase Storage and only metadata/path in Firestore
          const savedCert = await StorageService.saveCertificateDoc(newCertDoc);

          // Store only metadata on worker document. Legacy base64 is still readable through the certificates collection.
          const certForWorker = {
            id: certId,
            name: name,
            fileBase64: '',
            filePath: savedCert.filePath,
            mimeType: savedCert.mimeType,
            uploadDate: newCertDoc.uploadDate,
            size: newCertDoc.size
          };

          const currentCerts = selectedWorker.certificates || [];
          const updated = {
            ...selectedWorker,
            certificates: [...currentCerts, certForWorker]
          };
          
          await StorageService.saveWorkers([updated]);
          setWorkers([updated]);
          setSelectedWorker(updated);
          setWorkerDirectory(prev => {
            const byId = new Map<string, Worker>(prev.map(item => [item.id, item]));
            byId.set(updated.id, sanitizeWorkerForDirectory(updated));
            return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
          });
          setCertNameInput('');
          if (certFileInputRef.current) certFileInputRef.current.value = '';
          PushService.sendEvent({
            eventType: 'worker_certificate',
            payload: {
              workerId: selectedWorker.id,
              workerName: selectedWorker.name,
              certificateName: name,
            },
          }).catch((pushError) => console.warn('No se pudo enviar push de certificado:', pushError));
          alert("Certificado subido con éxito.");
        } catch (err: any) {
          console.error("Error upload cert", err);
          alert(`Error al subir el certificado: ${err?.message || 'Fallo de almacenamiento en Firebase'}`);
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
      try {
        await StorageService.deleteCertificateDoc(certId);
        await StorageService.saveWorkers([updated]);
        setWorkers([updated]);
        setSelectedWorker(updated);
        setWorkerDirectory(prev => {
          const byId = new Map<string, Worker>(prev.map(item => [item.id, item]));
          byId.set(updated.id, sanitizeWorkerForDirectory(updated));
          return Array.from(byId.values()).sort((a, b) => a.name.localeCompare(b.name, 'es'));
        });
      } catch (err) {
        console.error("Error deleting certificate:", err);
        alert("Error al eliminar el certificado en Firebase.");
      }
    }
  };

  const getWorkerCertificateDataUri = async (cert: WorkerCertificate) => {
    if (cert.fileBase64 && cert.fileBase64.length > 50) return cert.fileBase64;
    return await StorageService.getCertificateBase64(cert.id);
  };

  const handleViewWorkerCertificate = async (cert: WorkerCertificate) => {
    const dataUri = await getWorkerCertificateDataUri(cert);
    if (!dataUri) {
      alert("No se pudo cargar el archivo del certificado desde Firebase.");
      return;
    }

    const viewer = window.open(dataUri, '_blank', 'noopener,noreferrer');
    if (!viewer) {
      downloadDataUri(dataUri, cert.name);
    }
  };

  const handleDownloadWorkerCertificate = async (cert: WorkerCertificate) => {
    const dataUri = await getWorkerCertificateDataUri(cert);
    if (!dataUri) {
      alert("No se pudo cargar el archivo del certificado desde Firebase.");
      return;
    }

    downloadDataUri(dataUri, cert.name);
  };

  const renderWorkerProfile = () => {
    if (!selectedWorker) return null;
    const certificates = selectedWorker.certificates || [];

    return (
      <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden pb-4">
        <div className="flex items-center justify-between gap-4 mb-6 shrink-0">
          <div className="flex items-center gap-4">
            <button 
              onClick={() => {
                setIsEditingProfile(false);
                setCurrentStep(Step.WORKER_DASHBOARD);
              }} 
              className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10"
            >
              <ChevronLeft size={20}/>
            </button>
            <div>
              <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tight">Mi Perfil Profesional</h2>
              <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest">Visualiza y gestiona tus datos</p>
            </div>
          </div>

          <button
            onClick={() => {
              if (isEditingProfile) {
                cancelEditingProfile();
              } else {
                startEditingProfile();
              }
            }}
            className={`px-4 py-2 rounded-xl text-xs font-black uppercase tracking-widest flex items-center gap-2 border transition-all active:scale-95 ${
              isEditingProfile 
                ? 'bg-rose-500/10 text-rose-500 border-rose-500/20 hover:bg-rose-500/20' 
                : 'bg-[#15803D]/10 text-[#15803D] border-[#15803D]/20 hover:bg-[#15803D]/20'
            }`}
          >
            {isEditingProfile ? (
              <>Cancelar</>
            ) : (
              <>
                <Edit3 size={14} /> Editar Datos
              </>
            )}
          </button>
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
          {isEditingProfile ? (
            <div className="bg-[var(--panel-bg)] backdrop-blur-xl border border-[#15803D]/20 p-6 rounded-[2rem] shadow-[var(--panel-shadow)] space-y-4">
              <div className="border-b border-[var(--panel-border)] pb-3">
                <span className="text-[9px] font-black uppercase tracking-widest text-[#15803D] bg-[#15803D]/10 px-2.5 py-1 rounded-md border border-[#15803D]/20">Modo de Edición</span>
                <p className="text-xs text-[var(--text-muted)] font-medium mt-2">Modifica tus datos de contacto y acceso. El número de teléfono modificado será tu nuevo identificador para iniciar sesión.</p>
              </div>

              <div className="space-y-3">
                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] ml-1">DNI / NIE / Pasaporte</label>
                  <input 
                    type="text" 
                    value={editDni} 
                    onChange={(e) => setEditDni(e.target.value)} 
                    placeholder="DNI / NIE"
                    className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl px-4 py-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[#15803D] mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] ml-1">Correo Electrónico</label>
                  <input 
                    type="email" 
                    value={editEmail} 
                    onChange={(e) => setEditEmail(e.target.value)} 
                    placeholder="ejemplo@correo.com"
                    className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl px-4 py-3 text-sm text-[var(--text-main)] focus:outline-none focus:border-[#15803D] mt-1"
                  />
                </div>

                <div>
                  <label className="text-[10px] font-black uppercase tracking-wider text-[var(--text-muted)] ml-1">Número de Teléfono (Para entrar en la App)</label>
                  <input 
                    type="tel" 
                    value={editPhone} 
                    onChange={(e) => setEditPhone(e.target.value)} 
                    placeholder="600000000"
                    className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl px-4 py-3 text-sm text-[var(--text-main)] font-black focus:outline-none focus:border-[#15803D] mt-1"
                  />
                </div>
              </div>

              <button 
                onClick={handleSaveProfile}
                disabled={loading}
                className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 rounded-2xl uppercase tracking-widest text-xs mt-4 flex items-center justify-center gap-2 active:scale-95 shadow-lg shadow-[#15803D]/10 transition-all disabled:opacity-50"
              >
                <Save size={14} /> {loading ? "Guardando..." : "Guardar Perfil"}
              </button>
            </div>
          ) : (
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
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Acceso seguro</p>
                <p className="text-sm font-mono font-black text-[var(--text-main)] mt-1">{selectedWorker.pin ? 'PIN legacy configurado' : 'Contraseña protegida'}</p>
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
          )}

          {/* Certificados / Documentos section */}
          <div className="bg-[var(--panel-bg)] rounded-[2rem] p-6 border border-[var(--panel-border)] shadow-sm">
            <div className="flex items-start justify-between gap-4 mb-5">
              <div>
                <h4 className="text-sm font-black text-[var(--text-main)] uppercase tracking-widest">Mis Certificados y Documentos</h4>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase mt-0.5">Solo lectura desde tu perfil profesional</p>
              </div>
              <div className="bg-blue-500/10 text-blue-500 p-3 rounded-2xl"><FileText size={22} /></div>
            </div>
            {certificates.length === 0 ? (
              <div className="text-center py-8 border border-dashed border-[var(--panel-border)] rounded-[1.5rem] bg-[var(--btn-glass-bg)]">
                <FileText size={30} className="mx-auto text-[var(--text-muted)] mb-2 opacity-50" />
                <p className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-wider">No tienes certificados subidos todavía.</p>
              </div>
            ) : (
              <div className="space-y-2">
                {certificates.map(cert => (
                  <div key={cert.id} className="flex items-center justify-between gap-3 p-3 bg-[var(--btn-glass-bg)] rounded-2xl border border-[var(--panel-border)]">
                    <div className="flex items-center gap-3 min-w-0">
                      <div className="bg-green-500/10 text-green-500 p-2 rounded-xl shrink-0"><CheckCircle size={16} /></div>
                      <div className="min-w-0">
                        <p className="text-[11px] font-black text-[var(--text-main)] truncate">{cert.name}</p>
                        <p className="text-[8px] font-bold text-[var(--text-muted)] uppercase">{cert.uploadDate}</p>
                      </div>
                    </div>
                    <div className="flex items-center gap-2 shrink-0">
                      <button type="button" onClick={() => handleViewWorkerCertificate(cert)} className="text-[9px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-blue-500/10 text-blue-500 active:scale-95 transition-transform">Ver</button>
                      <button type="button" onClick={() => handleDownloadWorkerCertificate(cert)} className="text-[9px] font-black uppercase tracking-wider px-3 py-2 rounded-xl bg-[var(--panel-bg)] text-[var(--text-main)] border border-[var(--panel-border)] active:scale-95 transition-transform">Descargar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
            <div className="mt-4 p-3 rounded-2xl bg-blue-500/10 border border-blue-500/20 text-blue-500 text-[10px] font-bold leading-relaxed">Para subir nuevos certificados entra en el apartado Certificados del panel del trabajador.</div>
          </div>
        </div>
      </div>
    );
  };

  const renderWorkerCertificates = () => {
    if (!selectedWorker) return null;
    const certificates = selectedWorker.certificates || [];

    return (
      <div className="min-h-screen bg-[var(--app-bg)] text-[var(--text-main)] pb-24 flex flex-col transition-colors duration-300">
        <div className="sticky top-0 z-50 bg-[var(--app-bg)]/95 backdrop-blur-md border-b border-[var(--panel-border)] px-5 py-4 flex items-center gap-4">
          <button onClick={() => setCurrentStep(Step.WORKER_DASHBOARD)} className="p-3 bg-[var(--btn-glass-bg)] rounded-2xl text-[var(--text-main)]"><ChevronLeft size={20}/></button>
          <div>
            <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tight">Certificados</h2>
            <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Sube, consulta y descarga tus documentos</p>
          </div>
        </div>
        <div className="p-5 space-y-5">
          <div className="bg-[var(--panel-bg)] rounded-[2rem] p-6 border border-[var(--panel-border)] shadow-sm">
            <div className="flex items-start gap-4 mb-5">
              <div className="bg-blue-500/10 text-blue-500 p-4 rounded-2xl shrink-0"><FileText size={28} /></div>
              <div>
                <h3 className="text-lg font-black uppercase tracking-tight text-[var(--text-main)]">Subir certificado</h3>
                <p className="text-[11px] font-bold text-[var(--text-muted)] leading-relaxed mt-1">Puedes subir PDF o imagen. Los PDF protegidos con contraseña se bloquean automáticamente para evitar problemas al verlos o descargarlos.</p>
              </div>
            </div>
            <div className="space-y-3">
              <input type="text" value={certNameInput} onChange={(e) => setCertNameInput(e.target.value)} placeholder="Nombre del certificado" className="w-full p-4 rounded-2xl bg-[var(--btn-glass-bg)] border border-[var(--panel-border)] text-sm font-bold outline-none focus:border-blue-500 transition-colors text-[var(--text-main)]" />
              <button onClick={() => certFileInputRef.current?.click()} className="w-full p-4 rounded-2xl bg-blue-500 text-white font-black text-xs uppercase tracking-widest flex items-center justify-center gap-2 active:scale-95 transition-transform shadow-lg shadow-blue-500/20"><Upload size={18} /> Seleccionar archivo</button>
              <input ref={certFileInputRef} type="file" accept="application/pdf,image/jpeg,image/png,image/webp,image/heic,image/heif" className="hidden" onChange={handleAddCertificate} />
            </div>
          </div>
          <div className="bg-[var(--panel-bg)] rounded-[2rem] p-6 border border-[var(--panel-border)] shadow-sm">
            <div className="flex items-center justify-between gap-4 mb-5">
              <div>
                <h3 className="text-sm font-black uppercase tracking-widest text-[var(--text-main)]">Mis certificados</h3>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase mt-0.5">Disponibles también en tu perfil profesional</p>
              </div>
              <span className="px-3 py-1 rounded-full bg-blue-500/10 text-blue-500 text-[10px] font-black">{certificates.length}</span>
            </div>
            {certificates.length === 0 ? (
              <div className="text-center py-10 border border-dashed border-[var(--panel-border)] rounded-[1.5rem] bg-[var(--btn-glass-bg)]">
                <FileText size={34} className="mx-auto text-[var(--text-muted)] mb-3 opacity-50" />
                <p className="text-[11px] font-black text-[var(--text-main)] uppercase tracking-wider">Aún no hay certificados</p>
                <p className="text-[9px] font-bold text-[var(--text-muted)] uppercase mt-1">Sube el primero desde el botón superior</p>
              </div>
            ) : (
              <div className="space-y-2">
                {certificates.map(cert => (
                  <div key={cert.id} className="p-3 bg-[var(--btn-glass-bg)] rounded-2xl border border-[var(--panel-border)]">
                    <div className="flex items-center gap-3 min-w-0 mb-3">
                      <div className="bg-green-500/10 text-green-500 p-2 rounded-xl shrink-0"><CheckCircle size={16} /></div>
                      <div className="min-w-0">
                        <p className="text-[12px] font-black text-[var(--text-main)] truncate">{cert.name}</p>
                        <p className="text-[8px] font-bold text-[var(--text-muted)] uppercase">Subido el {cert.uploadDate}</p>
                      </div>
                    </div>
                    <div className="grid grid-cols-2 gap-2">
                      <button type="button" onClick={() => handleViewWorkerCertificate(cert)} className="text-[10px] font-black uppercase tracking-wider px-3 py-3 rounded-xl bg-blue-500/10 text-blue-500 active:scale-95 transition-transform">Ver</button>
                      <button type="button" onClick={() => handleDownloadWorkerCertificate(cert)} className="text-[10px] font-black uppercase tracking-wider px-3 py-3 rounded-xl bg-[var(--panel-bg)] text-[var(--text-main)] border border-[var(--panel-border)] active:scale-95 transition-transform">Descargar</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
          </div>
          <div className="bg-[#15803D]/10 border border-[#15803D]/20 rounded-[2rem] p-5 text-[11px] font-bold text-[var(--text-main)] leading-relaxed">En el perfil profesional solo se pueden consultar los certificados. La subida se hace desde esta pantalla para mantener el flujo limpio.</div>
        </div>
      </div>
    );
  };

  const renderWorkerChat = () => {
    if (!selectedWorker) return null;

    // Filter active workers except me from the safe directory (no PINs, no certificates)
    const directory = getWorkerDirectory();
    const otherWorkers = directory.filter(w => w.id !== selectedWorker.id && w.active);
    const activePartner = activeChatPartnerId === 'ADMIN' ? null : getWorkerById(activeChatPartnerId);
    const activePartnerWhatsAppPhone = getWhatsAppPhoneNumber(activePartner?.phone);

    // Filter messages for current active partner and sort chronologically
    const activeMessages = chats.filter(c => 
      (c.senderId === selectedWorker.id && c.receiverId === activeChatPartnerId) ||
      (c.senderId === activeChatPartnerId && c.receiverId === selectedWorker.id)
    ).sort((a, b) => a.timestamp - b.timestamp);

    const partnerUnreadCount = (partnerId: string) => {
      return chats.filter(c => c.senderId === partnerId && c.receiverId === selectedWorker.id && !c.read).length;
    };

    const getMostRecentMessageTimestamp = (partnerId: string) => {
      const msgs = chats.filter(c => 
        (c.senderId === selectedWorker.id && c.receiverId === partnerId) ||
        (c.senderId === partnerId && c.receiverId === selectedWorker.id)
      );
      if (msgs.length === 0) return 0;
      return Math.max(...msgs.map(m => m.timestamp));
    };

    const sortedOtherWorkers = [...otherWorkers].sort((a, b) => {
      return getMostRecentMessageTimestamp(b.id) - getMostRecentMessageTimestamp(a.id);
    });

    const lastBossMsg = chats
      .filter(c => (c.senderId === 'ADMIN' && c.receiverId === selectedWorker.id) || (c.senderId === selectedWorker.id && c.receiverId === 'ADMIN'))
      .sort((a, b) => b.timestamp - a.timestamp)[0];

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
            <p className="text-[10px] text-[#15803D] font-bold uppercase tracking-widest">Contacto directo entre compañeros y jefe</p>
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
                  ? 'bg-[#15803D]/10 border-[#15803D]/40 text-[#15803D]' 
                  : 'bg-[var(--btn-glass-bg)] border-[var(--btn-glass-border)] hover:bg-slate-500/5'
              }`}
            >
              <div className="flex items-center gap-3 overflow-hidden">
                <div className="w-10 h-10 rounded-full bg-gradient-to-tr from-yellow-500 to-amber-600 flex items-center justify-center text-white font-black shadow-md border border-yellow-400/20 shrink-0">
                  J
                </div>
                <div className="overflow-hidden">
                  <h4 className="text-xs font-black uppercase tracking-wide">EL JEFE</h4>
                  <p className="text-[9px] text-[var(--text-muted)] font-medium">Administrador Principal</p>
                  {lastBossMsg && (
                    <p className="text-[9px] text-slate-400 truncate mt-0.5 max-w-[140px]">{repairDisplayText(lastBossMsg.text)}</p>
                  )}
                </div>
              </div>
              
              {partnerUnreadCount('ADMIN') > 0 && (
                <span className="bg-[#15803D] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(21,128,61,0.5)] shrink-0 ml-2">
                  {partnerUnreadCount('ADMIN')}
                </span>
              )}
            </button>

            {/* Other Workers list */}
            <div className="space-y-2 mt-1">
              <span className="text-[9px] font-black tracking-widest text-[var(--text-muted)] uppercase block mb-1">Compañeros ({sortedOtherWorkers.length})</span>
              {sortedOtherWorkers.length === 0 ? (
                <p className="text-[10px] text-[var(--text-muted)] italic text-center py-4">No hay otros operarios disponibles.</p>
              ) : (
                sortedOtherWorkers.map(w => {
                  const isSelected = activeChatPartnerId === w.id;
                  const isExpanded = expandedDirectoryWorkerId === w.id;
                  const whatsappPhone = getWhatsAppPhoneNumber(w.phone);
                  const unread = partnerUnreadCount(w.id);
                  const workerPhotoUrl = getWorkerPhotoUrl(w);
                  const workerName = repairDisplayText(w.name) || 'Operario';
                  const workerRole = repairDisplayText(w.role) || 'Operario';
                  const workerEmail = repairDisplayText(w.email) || 'No indicado';
                  const workerPhone = repairDisplayText(w.phone) || 'No indicado';
                  const lastMsg = chats
                    .filter(c => (c.senderId === w.id && c.receiverId === selectedWorker.id) || (c.senderId === selectedWorker.id && c.receiverId === w.id))
                    .sort((a, b) => b.timestamp - a.timestamp)[0];
                  return (
                    <div
                      key={w.id}
                      className={`w-full rounded-2xl border transition-all overflow-hidden ${
                        isSelected || isExpanded
                          ? 'bg-[#15803D]/10 border-[#15803D]/40 text-[#15803D]'
                          : 'bg-[var(--btn-glass-bg)] border-[var(--btn-glass-border)] hover:bg-slate-500/5'
                      }`}
                    >
                      <button
                        type="button"
                        onClick={() => {
                          setExpandedDirectoryWorkerId(isExpanded ? null : w.id);
                          setExpandedPhoneWorkerId(null);
                        }}
                        className="w-full flex items-center justify-between p-3 text-left"
                      >
                        <div className="flex items-center gap-3 overflow-hidden">
                          {workerPhotoUrl ? (
                            <img src={workerPhotoUrl} alt={workerName} className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0" />
                          ) : (
                            <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-black text-xs text-slate-300 uppercase shrink-0">
                              {getWorkerInitial(w)}
                            </div>
                          )}
                          <div className="overflow-hidden">
                            <h4 className="text-xs font-black uppercase tracking-wide text-[var(--text-main)] truncate max-w-[140px]">{workerName}</h4>
                            <p className="text-[9px] text-[var(--text-muted)] font-medium">{workerRole}</p>
                            {lastMsg && (
                              <p className="text-[9px] text-slate-400 truncate mt-0.5 max-w-[140px]">{repairDisplayText(lastMsg.text)}</p>
                            )}
                          </div>
                        </div>

                        <div className="flex items-center gap-2 shrink-0">
                          {unread > 0 && (
                            <span className="bg-[#15803D] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(21,128,61,0.5)]">
                              {unread}
                            </span>
                          )}
                          <ChevronDown size={15} className={`text-[var(--text-muted)] transition-transform ${isExpanded ? 'rotate-180' : ''}`} />
                        </div>
                      </button>

                      {isExpanded && (
                        <div className="mx-3 mb-3 rounded-2xl border border-[var(--panel-border)] bg-[var(--panel-bg)] p-3 animate-fadeIn">
                          <div className="grid grid-cols-1 gap-2 text-[10px] font-bold">
                            <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2">
                              <span className="block text-[8px] uppercase tracking-widest text-[var(--text-muted)]">Email</span>
                              <span className="break-all text-[var(--text-main)]">{workerEmail}</span>
                            </div>
                            <div className="grid grid-cols-2 gap-2">
                              <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2">
                                <span className="block text-[8px] uppercase tracking-widest text-[var(--text-muted)]">DNI</span>
                                <span className="text-[var(--text-main)]">{formatDni(w.dni)}</span>
                              </div>
                              <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--input-bg)] px-3 py-2">
                                <span className="block text-[8px] uppercase tracking-widest text-[var(--text-muted)]">Teléfono</span>
                                <span className="text-[var(--text-main)]">{workerPhone}</span>
                              </div>
                            </div>
                          </div>

                          <div className="mt-3 grid grid-cols-2 gap-2">
                            <button
                              type="button"
                              onClick={() => {
                                setActiveChatPartnerId(w.id);
                                setExpandedPhoneWorkerId(null);
                              }}
                              className="col-span-2 rounded-xl bg-[#15803D] text-black px-3 py-2.5 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                            >
                              Abrir chat
                            </button>
                            {whatsappPhone && (
                              <a
                                href={`https://wa.me/${whatsappPhone}`}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="flex items-center justify-center gap-2 rounded-xl bg-emerald-600 text-white px-3 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                              >
                                <MessageSquare size={13} /> WhatsApp
                              </a>
                            )}
                            {w.phone && (
                              <a
                                href={`tel:${w.phone}`}
                                className="flex items-center justify-center gap-2 rounded-xl bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] text-[var(--text-main)] px-3 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                              >
                                <Phone size={13} /> Llamar
                              </a>
                            )}
                          </div>
                          <p className="mt-3 text-[8px] text-[var(--text-muted)] font-bold uppercase tracking-widest leading-relaxed">
                            Los certificados no se muestran en mensajería por privacidad.
                          </p>
                        </div>
                      )}
                    </div>
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
                        {activeChatPartnerId === 'ADMIN' ? 'EL JEFE' : repairDisplayText(activePartner?.name)}
                      </h3>
                      <p className="text-[9px] text-[#15803D] font-bold uppercase tracking-widest">Chat individual seguro</p>
                    </div>
                  </div>

                  <span className="text-[9px] text-[var(--text-muted)] font-bold tracking-widest uppercase font-mono">Canal Directo</span>
                </div>

                {false && activePartner && (
                  <div className="mt-3 rounded-[1.5rem] border border-[var(--panel-border)] bg-[var(--btn-glass-bg)] p-4 shrink-0">
                    <div className="flex items-start gap-3">
                      {activePartner.photoUrl ? (
                        <img src={activePartner.photoUrl} alt={activePartner.name} className="w-12 h-12 rounded-2xl object-cover border border-white/10 shrink-0" />
                      ) : (
                        <div className="w-12 h-12 rounded-2xl bg-slate-800 flex items-center justify-center font-black text-sm text-slate-300 uppercase shrink-0">
                          {activePartner.name.charAt(0)}
                        </div>
                      )}
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-2">
                          <h4 className="text-sm font-black uppercase tracking-tight text-[var(--text-main)] truncate">{activePartner.name}</h4>
                          <span className="px-2 py-1 rounded-full bg-emerald-500/10 text-emerald-500 border border-emerald-500/20 text-[8px] font-black uppercase tracking-widest">
                            Activo
                          </span>
                        </div>
                        <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest mt-1">{activePartner.role || 'Operario'}</p>
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-2 mt-3 text-[10px] font-bold">
                          <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2">
                            <span className="block text-[8px] uppercase tracking-widest text-[var(--text-muted)]">Email</span>
                            <span className="break-all text-[var(--text-main)]">{activePartner.email || 'No indicado'}</span>
                          </div>
                          <div className="rounded-xl border border-[var(--panel-border)] bg-[var(--panel-bg)] px-3 py-2">
                            <span className="block text-[8px] uppercase tracking-widest text-[var(--text-muted)]">DNI</span>
                            <span className="text-[var(--text-main)]">{formatDni(activePartner.dni)}</span>
                          </div>
                        </div>
                        {activePartner.phone && (
                          <div className="mt-3">
                            <button
                              type="button"
                              onClick={() => setExpandedPhoneWorkerId(expandedPhoneWorkerId === activePartner.id ? null : activePartner.id)}
                              className="w-full flex items-center justify-between gap-2 rounded-xl border border-[#15803D]/30 bg-[#15803D]/10 px-3 py-2 text-left text-[11px] font-black text-[var(--text-main)] active:scale-[0.99] transition-transform"
                            >
                              <span className="inline-flex items-center gap-2">
                                <Phone size={14} className="text-[#15803D]" />
                                {activePartner.phone}
                              </span>
                              <span className="text-[8px] uppercase tracking-widest text-[#15803D]">Opciones</span>
                            </button>
                            {expandedPhoneWorkerId === activePartner.id && (
                              <div className="mt-2 grid grid-cols-1 sm:grid-cols-3 gap-2">
                                {activePartnerWhatsAppPhone && (
                                  <a
                                    href={`https://wa.me/${activePartnerWhatsAppPhone}`}
                                    target="_blank"
                                    rel="noopener noreferrer"
                                    className="flex items-center justify-center gap-2 rounded-xl bg-emerald-500 text-white px-3 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                                  >
                                    <MessageSquare size={13} /> WhatsApp
                                  </a>
                                )}
                                <a
                                  href={`tel:${activePartner.phone}`}
                                  className="flex items-center justify-center gap-2 rounded-xl bg-[var(--panel-bg)] border border-[var(--panel-border)] text-[var(--text-main)] px-3 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                                >
                                  <Phone size={13} /> Llamar
                                </a>
                                <button
                                  type="button"
                                  onClick={() => navigator.clipboard?.writeText(activePartner.phone || '')}
                                  className="flex items-center justify-center gap-2 rounded-xl bg-[var(--panel-bg)] border border-[var(--panel-border)] text-[var(--text-main)] px-3 py-2 text-[10px] font-black uppercase tracking-widest active:scale-95 transition-transform"
                                >
                                  <ClipboardList size={13} /> Copiar
                                </button>
                              </div>
                            )}
                          </div>
                        )}
                        <p className="mt-3 text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest">
                          Certificados ocultos en mensajería por privacidad.
                        </p>
                      </div>
                    </div>
                  </div>
                )}

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
                              ? 'bg-[#15803D] text-black font-medium rounded-tr-none' 
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
                    className="flex-1 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl px-4 py-3 text-base outline-none focus:border-[#15803D]"
                    placeholder="Escribe un mensaje..."
                  />
                  <button 
                    onClick={handleSendWorkerMessage}
                    className="p-3 bg-[#15803D] text-black rounded-xl hover:bg-[#16A34A] active:scale-95 transition-all shadow-md shadow-[#15803D]/10 flex items-center justify-center"
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
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter">Partes Semanales</h2>
        </div>

        <div className="md:flex-1 md:overflow-y-auto space-y-6 pb-6 custom-scrollbar pr-1">
          <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)] space-y-5">
            <h3 className="text-sm font-black text-[var(--text-main)] uppercase tracking-wide">Subir Parte de Trabajo</h3>
            
            {/* Foto o Captura (OBLIGATORIO) */}
            <div className="space-y-3">
              <label className="text-[10px] font-black text-[var(--text-main)] uppercase tracking-widest block ml-1 flex items-center justify-between">
                <span>Foto o Captura del Parte</span>
                <span className="text-rose-400 font-bold">* Obligatorio</span>
              </label>
              
              {!reportPhoto ? (
                <div className="border-2 border-dashed border-[var(--panel-border)] rounded-2xl p-6 flex flex-col items-center justify-center gap-2 bg-[var(--input-bg)] relative cursor-pointer hover:border-blue-500 transition">
                  <input type="file" accept="image/*" capture="environment" onChange={handleReportPhotoChange} className="absolute inset-0 opacity-0 cursor-pointer" />
                  <ImageIcon size={32} className="text-[var(--text-muted)]" />
                  <span className="text-[10px] font-black text-[var(--text-muted)] uppercase">Hacer Foto o Seleccionar</span>
                </div>
              ) : (
                <div className="relative aspect-video rounded-2xl overflow-hidden bg-black">
                  <img src={reportPhoto} alt="Parte seleccionado" className="w-full h-full object-contain" />
                  <button onClick={() => setReportPhoto(null)} className="absolute top-2 right-2 p-2 bg-black/80 text-white rounded-full hover:bg-rose-600 transition">
                    <X size={16} />
                  </button>
                </div>
              )}
            </div>

            {/* Período del Parte de Trabajo (OPCIONAL) */}
            <div className="space-y-2 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] p-4 rounded-2xl w-full">
              <label className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest block ml-0.5">
                Período que cubre el parte <span className="text-emerald-500 font-normal">(Opcional)</span>
              </label>
              <div className="flex flex-col sm:flex-row gap-3 w-full">
                <div className="flex-1 w-full min-w-0">
                  <span className="text-[9px] font-bold uppercase text-[var(--text-muted)] block mb-1">Desde</span>
                  <input 
                    type="date" 
                    value={reportStartDate} 
                    onChange={(e) => setReportStartDate(e.target.value)} 
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl px-3 py-3 text-xs sm:text-sm text-[var(--input-text)] focus:border-blue-500 outline-none block box-border [color-scheme:dark]"
                  />
                </div>
                <div className="flex-1 w-full min-w-0">
                  <span className="text-[9px] font-bold uppercase text-[var(--text-muted)] block mb-1">Hasta</span>
                  <input 
                    type="date" 
                    value={reportEndDate} 
                    onChange={(e) => setReportEndDate(e.target.value)} 
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl px-3 py-3 text-xs sm:text-sm text-[var(--input-text)] focus:border-blue-500 outline-none block box-border [color-scheme:dark]"
                  />
                </div>
              </div>
            </div>

            {/* Comentarios (OPCIONAL) */}
            <div className="space-y-1.5">
              <label className="text-[10px] font-black text-[var(--text-muted)] uppercase tracking-widest block ml-1">
                Comentarios / Observaciones <span className="text-emerald-500 font-normal">(Opcional)</span>
              </label>
              <textarea value={reportComments} onChange={(e) => setReportComments(e.target.value)} placeholder="Ej: He trabajado horas extras el martes..." className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3 text-xs text-[var(--input-text)] h-20 resize-none focus:border-blue-500 outline-none" />
            </div>

            <button disabled={submittingReport || !reportPhoto} onClick={handleSendWeeklyReport} className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black disabled:bg-slate-800 disabled:text-slate-500 py-4 rounded-xl font-black uppercase text-xs shadow-lg flex items-center justify-center gap-2 disabled:opacity-40 disabled:cursor-not-allowed transition-all duration-300">
              {submittingReport ? (
                <>
                  <Clock className="animate-spin text-black" size={16} /> Subiendo parte...
                </>
              ) : (
                <>
                  <Upload size={16} /> Subir Parte de Trabajo
                </>
              )}
            </button>
            {!reportPhoto && (
              <div className="text-center bg-rose-500/5 border border-rose-500/10 p-2.5 rounded-xl">
                <p className="text-[9px] text-rose-500 font-bold uppercase tracking-wider">
                  * Debes adjuntar la foto o captura del parte para poder enviarlo.
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
                            <span className="font-black text-[#15803D] text-xs">{report.extractedTotal || '-'}</span>
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
                            <Eye size={12} className="text-[#15803D]" />
                            Ver Parte
                          </button>
                          <a
                            href={report.photoUrl}
                            download={`parte-${report.id}.png`}
                            className="flex-1 bg-[#15803D]/10 border border-[#15803D]/20 hover:border-[#15803D]/40 text-[10px] text-[#15803D] py-2 px-3 rounded-xl font-bold uppercase tracking-wider flex items-center justify-center gap-1.5 active:scale-95 transition-all text-center"
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
                className="p-3 bg-zinc-900 border border-zinc-800 text-[#15803D] rounded-full hover:bg-zinc-800 transition active:scale-95"
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
                  {(ps.pdfBase64 || ps.pdfPath) && (
                    <button
                      type="button"
                      onClick={async () => {
                        const pdfData = await StorageService.getPayslipPdfBase64(ps);
                        if (!pdfData) {
                          alert("No se pudo cargar el PDF de la nómina.");
                          return;
                        }
                        downloadDataUri(pdfData, `Nomina_${selectedWorker?.name.replace(/\s+/g, '_')}_${ps.monthStr}.pdf`);
                      }}
                      className="flex-1 bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] py-3 rounded-xl text-xs font-bold uppercase flex items-center justify-center gap-1 text-[var(--text-main)]"
                    >
                      <Download size={14} /> Descargar PDF
                    </button>
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
              <AppLogo size="lg" logoUrl={appConfig.logoUrl} scale={appConfig.logoScaleLogin} theme={theme} />
            </div>
            <h2 className="text-3xl font-black text-[var(--text-main)] tracking-tighter uppercase font-sans">CARMAGNE INSTAL SL</h2>
            <p className="text-[var(--text-muted)] text-[10px] font-black uppercase tracking-[0.25em] mt-1">Acceso Operario</p>
          </div>
          
          <div className="bg-[var(--panel-bg)] backdrop-blur-2xl p-6 rounded-[2.5rem] border border-[var(--panel-border)] w-full mt-6 shadow-[var(--panel-shadow)]">
            {!isPhoneVerified ? (
              <>
                <p className="text-xs text-[var(--text-muted)] font-bold text-center mb-4 uppercase tracking-widest">Introduce tu número de teléfono</p>
                <input 
                  type="tel" 
                  value={loginPhone} 
                  onChange={(e) => setLoginPhone(e.target.value)} 
                  onKeyDown={(e) => { if (e.key === 'Enter') handlePhoneLogin(); }}
                  className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-2xl p-4 text-xl font-black focus:border-[#15803D] outline-none text-center tracking-widest" 
                  placeholder="600000000"
                />
                <button 
                  onClick={handlePhoneLogin} 
                  className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 rounded-2xl shadow-lg shadow-[#15803D]/10 mt-4 flex items-center justify-center gap-2 active:scale-95 uppercase text-xs tracking-widest transition-all"
                >
                  Continuar <ArrowRight size={14} />
                </button>
              </>
            ) : (
              <>
                <div className="text-center mb-4">
                  <span className="text-[10px] text-[#15803D] font-black uppercase tracking-[0.2em] bg-[#15803D]/10 px-3 py-1 rounded-full border border-[#15803D]/20">Verificación segura</span>
                  <p className="text-lg font-black text-[var(--text-main)] uppercase tracking-tight mt-2">Introduce tu contraseña</p>
                  <p className="text-xs text-[var(--text-muted)] font-medium mt-0.5">{processSpanishPhone(loginPhone)}</p>
                </div>
                
                <div className="relative">
                  <input 
                    type={showLoginPassword ? "text" : "password"} 
                    value={loginPassword} 
                    onChange={(e) => setLoginPassword(e.target.value)} 
                    onKeyDown={(e) => { if (e.key === 'Enter') handlePhoneLogin(); }}
                    className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-2xl p-4 pr-12 text-center text-xl font-black focus:border-[#15803D] outline-none tracking-widest" 
                    placeholder="Contraseña"
                    autoFocus
                  />
                  <button 
                    type="button"
                    onClick={() => setShowLoginPassword(!showLoginPassword)}
                    className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                  >
                    <Eye size={20} className={showLoginPassword ? "text-[#15803D]" : ""} />
                  </button>
                </div>

                <button 
                  onClick={handlePhoneLogin} 
                  className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 rounded-2xl shadow-lg shadow-[#15803D]/10 mt-4 flex items-center justify-center gap-2 active:scale-95 uppercase text-xs tracking-widest transition-all"
                >
                  Entrar <ArrowRight size={14} />
                </button>

                <button 
                  onClick={() => {
                    setIsPhoneVerified(false);
                    setMatchedWorker(null);
                    setLoginPassword('');
                    setError('');
                  }} 
                  className="w-full text-[var(--text-muted)] hover:text-rose-400 font-bold text-[10px] uppercase tracking-wider mt-4 text-center block transition-all"
                >
                  Atrás / Cambiar de número
                </button>
              </>
            )}
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
      case Step.WORKER_CERTIFICATES: return renderWorkerCertificates();
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
        <div className="flex flex-col md:h-full animate-fadeIn md:overflow-hidden pb-4 max-w-md mx-auto w-full">
           <div className="flex items-center gap-4 mb-4 shrink-0">
             <button onClick={() => setCurrentStep(Step.LOGIN_PHONE)} className="p-2.5 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-main)] hover:bg-slate-500/10">
               <ChevronLeft size={20}/>
             </button>
             <h2 className="text-2xl font-black text-[var(--text-main)] tracking-tighter uppercase">Crear Cuenta</h2>
           </div>
           
           <div className="bg-[var(--panel-bg)] p-5 rounded-[2.5rem] border border-[var(--panel-border)] space-y-3 shadow-xl md:overflow-y-auto custom-scrollbar md:flex-1">
             <div className="space-y-1">
               <label className="text-[9px] font-black tracking-widest text-[var(--text-muted)] uppercase ml-1">Datos Personales</label>
               <input type="text" placeholder="Nombre completo" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3.5 text-sm text-[var(--input-text)] focus:border-[#15803D] outline-none" value={regName} onChange={(e)=>setRegName(e.target.value)}/>
               <input type="text" placeholder="DNI / NIE" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3.5 text-sm text-[var(--input-text)] focus:border-[#15803D] outline-none" value={regDni} onChange={(e)=>setRegDni(e.target.value)}/>
               <input type="tel" placeholder="Teléfono" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3.5 text-sm text-[var(--input-text)] font-bold opacity-80" value={regPhone} readOnly />
               <input type="email" placeholder="Correo electrónico" className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3.5 text-sm text-[var(--input-text)] focus:border-[#15803D] outline-none" value={regEmail} onChange={(e)=>setRegEmail(e.target.value)}/>
             </div>

             <div className="space-y-2 pt-2 border-t border-[var(--panel-border)]">
               <label className="text-[9px] font-black tracking-widest text-[var(--text-muted)] uppercase ml-1">Seguridad (Contraseña de Acceso)</label>
               
               <div className="relative">
                 <input 
                   type={showRegPin ? "text" : "password"} 
                   placeholder="Elige contraseña" 
                   className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3.5 pr-12 text-sm text-[var(--input-text)] focus:border-[#15803D] outline-none" 
                   value={regPin} 
                   onChange={(e)=>setRegPin(e.target.value)}
                 />
                 <button 
                   type="button"
                   onClick={() => setShowRegPin(!showRegPin)}
                   className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                 >
                   <Eye size={18} className={showRegPin ? "text-[#15803D]" : ""} />
                 </button>
               </div>

               <div className="relative">
                 <input 
                   type={showRegPinConfirm ? "text" : "password"} 
                   placeholder="Confirma tu contraseña" 
                   className="w-full bg-[var(--input-bg)] border border-[var(--input-border)] rounded-xl p-3.5 pr-12 text-sm text-[var(--input-text)] focus:border-[#15803D] outline-none" 
                   value={regPinConfirm} 
                   onChange={(e)=>setRegPinConfirm(e.target.value)}
                 />
                 <button 
                   type="button"
                   onClick={() => setShowRegPinConfirm(!showRegPinConfirm)}
                   className="absolute right-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)] hover:text-[var(--text-main)]"
                 >
                   <Eye size={18} className={showRegPinConfirm ? "text-[#15803D]" : ""} />
                 </button>
               </div>
             </div>

             <button onClick={handleRegistration} className="w-full bg-[#15803D] hover:bg-[#16A34A] text-black font-black py-4 rounded-2xl uppercase tracking-widest text-xs mt-4 active:scale-95 shadow-lg shadow-[#15803D]/10 shrink-0">Registrarme</button>
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

  if (isAdmin) return <AdminPanel onBack={() => { firebaseSignOut(auth).catch(() => {}); setIsAdmin(false); setCurrentAdminUser(null); }} currentUser={currentAdminUser} theme={theme} setTheme={setTheme} />;
  return (
    <div className="min-h-[100dvh] w-full min-w-full flex items-start justify-start md:items-center md:justify-center p-0 md:p-6 relative md:overflow-hidden font-inter select-none text-[var(--text-main)]">
      {/* Background Liquid Glows */}
      <div className="liquid-bg hidden md:block">
        <div className="liquid-glow-1"></div>
        <div className="liquid-glow-2"></div>
      </div>

      {/* Main 16:9 Aspect ratio container on desktop, full-screen on mobile */}
      <div className="w-full min-h-[100dvh] md:min-h-0 md:h-auto md:max-w-6xl md:aspect-video bg-[var(--bg-color)] md:bg-[var(--panel-bg)] backdrop-blur-none md:backdrop-blur-3xl md:rounded-[2.5rem] md:border md:border-[var(--panel-border)] md:shadow-[var(--panel-shadow)] md:overflow-hidden flex flex-col relative">
        <div className="flex-1 px-4 py-4 md:p-8 pt-[calc(1.25rem+env(safe-area-inset-top,0px))] md:pt-8 pb-[calc(1.25rem+env(safe-area-inset-bottom,0px))] md:pb-8 flex flex-col md:overflow-hidden relative z-10">
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
            <div className="absolute -top-12 -left-12 w-40 h-40 bg-[#15803D]/10 rounded-full blur-3xl pointer-events-none"></div>
            <div className="absolute -bottom-12 -right-12 w-40 h-40 bg-[#15803D]/10 rounded-full blur-3xl pointer-events-none"></div>

            <div className="relative z-10 flex flex-col items-center font-inter">
              <div className="p-4 bg-[#15803D]/10 rounded-full text-[#15803D] mb-5 border border-[#15803D]/20 shadow-[0_0_15px_rgba(21,128,61,0.1)]">
                <Mail size={32} />
              </div>

              <h2 className="text-2xl font-black text-white tracking-tighter uppercase font-bebas mb-2">
                REGISTRO DE CORREO OBLIGATORIO
              </h2>
              
              <p className="text-zinc-400 text-xs font-medium mb-6 leading-relaxed max-w-xs mx-auto font-sans">
                Hola <span className="text-[#15803D] font-black">{selectedWorker.name}</span>. Para garantizar la entrega de nóminas y partes oficiales, es obligatorio registrar tu correo electrónico.
              </p>

              <div className="w-full space-y-4">
                <div className="text-left">
                  <label className="text-[9px] font-black text-zinc-500 uppercase tracking-widest block ml-1 mb-1.5 font-sans">
                    Dirección de Correo *
                  </label>
                  <input 
                    type="email" 
                    placeholder="ejemplo@carmagne.com" 
                    className="w-full bg-zinc-900/80 border border-zinc-800 text-white rounded-xl p-4 text-sm outline-none focus:border-[#15803D] transition-colors font-semibold font-sans" 
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
                  className="w-full bg-[#15803D] hover:bg-[#16A34A] disabled:opacity-50 text-black font-black py-4 rounded-xl uppercase text-xs tracking-widest transition-all duration-300 active:scale-95 shadow-lg shadow-[#15803D]/10 font-sans"
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
      <div className="fixed top-4 left-0 right-0 z-[99999] flex flex-col items-center gap-2 pointer-events-none px-4 pt-[env(safe-area-inset-top,0px)]">
        {pushNotifications.map(notif => (
          <div 
            key={notif.id}
            onClick={() => handleNotificationClick(notif)}
            role="button"
            tabIndex={0}
            onKeyDown={(e) => { if (e.key === 'Enter' || e.key === ' ') handleNotificationClick(notif); }}
            className={`push-toast push-toast--${notif.type === 'chat' ? 'chat' : notif.type === 'log' ? 'log' : 'system'} pointer-events-auto w-full max-w-sm rounded-[1.75rem] p-4 flex gap-3 cursor-pointer hover:scale-[1.015] active:scale-[0.99] transition-all duration-300 transform animate-slideDown relative overflow-hidden`}
          >
             {/* Dynamic glass accent bar */}
             <div className="push-toast__shine absolute top-0 left-8 right-8 h-[2px] rounded-full" />
             
             {/* Left Icon/Initial */}
             <div className="push-toast__icon w-11 h-11 min-w-[44px] rounded-2xl flex items-center justify-center text-lg font-black">
               {notif.icon || (notif.type === 'chat' ? '💬' : '📋')}
             </div>
             
             {/* Body */}
             <div className="flex-1 min-w-0">
               <div className="flex justify-between items-center">
                 <span className="push-toast__label text-[9px] font-black uppercase tracking-[0.18em] font-sans">
                   {notif.type === 'chat' ? 'Mensaje Recibido' : 'Registro de Actividad'}
                 </span>
                 <span className="push-toast__time text-[9px] font-bold font-mono">Ahora</span>
               </div>
               <h4 className="push-toast__title text-[13px] font-black uppercase tracking-tight mt-1 truncate font-sans">
                 {notif.title}
               </h4>
               <p className="push-toast__body text-[11px] font-semibold truncate mt-0.5 leading-snug font-sans">
                 {notif.body}
               </p>
             </div>
             
             {/* Subtle iOS indicator line */}
             <div className="push-toast__handle absolute bottom-1.5 w-12 h-[3px] left-1/2 transform -translate-x-1/2 rounded-full" />
          </div>
        ))}
      </div>
    </div>
  );
};

