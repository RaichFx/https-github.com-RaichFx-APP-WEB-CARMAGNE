
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StorageService, ELECTRICAL_TOOLS_LIST, ELECTRICAL_BRANDS_LIST, compressImage } from '../services/storageService';
import { TelegramService } from '../services/telegramService';
import { PushService, type PushPermissionStatus } from '../services/pushService';
import { Worker, Site, WorkLog, AppConfig, WorkMode, LogType, AdminUser, ToolRecord, WeeklyReport, Payslip, ChatMessage } from '../types';
import { 
  Users, MapPin, Download, Settings, FileText, BellRing,
  Trash2, Plus, Save, Lock, Database, ClipboardList, Calendar, X, UserPlus, Phone, Filter, Search, Clock, Shield, Pencil, Eye, EyeOff, Zap, Wrench, ChevronDown, ArrowLeft, BarChart3, LogOut, CalendarDays, CheckCircle2, AlertCircle, AlertTriangle, Map as MapIcon, ExternalLink, Coffee, Package, KeyRound, ChevronRight, ListFilter, RotateCcw, Image as ImageIcon, Upload, Layout, Maximize2, Smartphone, Check, Timer, History, Sun, Moon, MessageSquare, Send, Mail, ZoomIn, ZoomOut, RefreshCw
} from 'lucide-react';
import { PieChart, Pie, Cell, ResponsiveContainer, Tooltip as RechartsTooltip, BarChart, Bar, XAxis, YAxis, CartesianGrid } from 'recharts';
import { jsPDF } from 'jspdf';
import autoTable from 'jspdf-autotable';
import { ConfirmationModal } from './ConfirmationModal';
import { signInWithPopup, GoogleAuthProvider, signOut as firebaseSignOut } from 'firebase/auth';
import { auth } from '../services/firebase';

interface AdminPanelProps {
  onBack: () => void;
  currentUser: AdminUser | null;
  theme?: 'light' | 'dark';
  setTheme?: (theme: 'light' | 'dark') => void;
}

type WorkerCertificate = NonNullable<Worker['certificates']>[number];

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

const normalizeSpanishPhone = (phone: string): string => {
  let cleaned = phone.trim().replace(/\s/g, '');
  if (cleaned.startsWith('0034')) cleaned = '+34' + cleaned.slice(4);
  if (cleaned.length === 9 && /^[6789]/.test(cleaned)) cleaned = '+34' + cleaned;
  if (cleaned.startsWith('34') && cleaned.length === 11) cleaned = '+' + cleaned;
  return cleaned;
};

const isSpanishPhone = (phone: string): boolean => /^\+34[6789]\d{8}$/.test(phone);

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
    const isToday = logs.length > 0 && logs[0].dateStr === new Date().toLocaleDateString('es-ES');
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

const dataUriToBlob = (dataUri: string): { blob: Blob; mimeType: string } => {
  const [header, encodedData] = dataUri.split(',');
  if (!header?.startsWith('data:') || !encodedData) {
    throw new Error('Formato de archivo no válido.');
  }

  const mimeType = header.match(/data:([^;]+)/)?.[1] || 'application/octet-stream';
  const binaryString = header.includes(';base64') ? atob(encodedData) : decodeURIComponent(encodedData);
  const bytes = new Uint8Array(binaryString.length);

  for (let i = 0; i < binaryString.length; i += 1) {
    bytes[i] = binaryString.charCodeAt(i);
  }

  return { blob: new Blob([bytes], { type: mimeType }), mimeType };
};

const downloadDataUri = (dataUri: string, fileName: string) => {
  const { blob } = dataUriToBlob(dataUri);
  const blobUrl = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = blobUrl;
  link.download = fileName;
  document.body.appendChild(link);
  link.click();
  link.remove();
  window.setTimeout(() => URL.revokeObjectURL(blobUrl), 30000);
};

const getCertificateFileName = (cert: WorkerCertificate, mimeType: string) => {
  const baseName = (cert.name || 'certificado').trim().replace(/[\\/:*?"<>|]+/g, '-');
  if (/\.[a-z0-9]{2,5}$/i.test(baseName)) return baseName;

  const extension = mimeType === 'application/pdf'
    ? 'pdf'
    : mimeType === 'image/png'
      ? 'png'
      : mimeType === 'image/webp'
        ? 'webp'
        : mimeType === 'image/heic'
          ? 'heic'
          : mimeType.startsWith('image/')
            ? 'jpg'
            : 'bin';

  return `${baseName}.${extension}`;
};

const LogIcon = ({ type, size = 18 }: { type: LogType, size?: number }) => {
  switch (type) {
    case LogType.ENTRADA:
      return <Zap size={size} className="text-emerald-400 drop-shadow-[0_0_8px_rgba(52,211,153,0.5)]" />;
    case LogType.SALIDA:
      return <LogOut size={size} className="text-rose-400 drop-shadow-[0_0_8px_rgba(251,113,133,0.5)]" />;
    case LogType.INICIO_DESCANSO:
      return <Coffee size={size} className="text-amber-400 drop-shadow-[0_0_8px_rgba(251,191,36,0.5)]" />;
    case LogType.FIN_DESCANSO:
      return <Timer size={size} className="text-blue-400 drop-shadow-[0_0_8px_rgba(96,165,250,0.5)]" />;
    default:
      return <ClipboardList size={size} className="text-[var(--text-muted)]" />;
  }
};

const AppLogo = ({ className, size = "md", logoUrl, scale = 1.0, theme = "light" }: { className?: string, size?: "sm" | "md" | "lg", logoUrl?: string, scale?: number, theme?: "light" | "dark" }) => {
  const baseSize = size === "sm" ? 28 : size === "md" ? 64 : size === "lg" ? 140 : 64;
  const iconSize = baseSize * scale;
  const configuredLogo = logoUrl || "/logo.png";
  const logoSrc = configuredLogo === "/logo.png" ? (theme === "dark" ? "/logo.png" : "/logo-black.png") : configuredLogo;
  
  if (logoSrc) {
    return (
      <div className={`relative flex items-center justify-center ${className}`}>
        <img 
          src={logoSrc} 
          alt="Company Logo" 
          style={{ width: iconSize, height: iconSize }} 
          className="object-contain rounded-2xl drop-shadow-[0_0_15px_rgba(59,130,246,0.4)]"
        />
      </div>
    );
  }

  return (
    <div className={`relative flex items-center justify-center ${className} text-blue-500`}>
      <Zap 
        size={iconSize} 
        className="drop-shadow-[0_0_20px_rgba(59,130,246,0.6)] fill-blue-500/20" 
        strokeWidth={2.5}
      />
    </div>
  );
};

export const AdminPanel: React.FC<AdminPanelProps> = ({ onBack, currentUser, theme, setTheme }) => {
  const isSuperAdmin = currentUser?.role === 'OWNER' || currentUser?.id === 'admin_super';
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const payslipFileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'approvals' | 'workers' | 'sites' | 'logs' | 'tools' | 'hours' | 'admins' | 'settings' | 'reports' | 'payslips' | 'chat'>('dashboard');
  const [isDesktopMenuOpen, setIsDesktopMenuOpen] = useState(false);
  const [isMobileMenuOpen, setIsMobileMenuOpen] = useState(false);
  const desktopMenuRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    const handlePointerDown = (event: MouseEvent) => {
      if (desktopMenuRef.current && !desktopMenuRef.current.contains(event.target as Node)) {
        setIsDesktopMenuOpen(false);
      }
    };
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') setIsDesktopMenuOpen(false);
    };
    document.addEventListener('mousedown', handlePointerDown);
    document.addEventListener('keydown', handleEscape);
    return () => {
      document.removeEventListener('mousedown', handlePointerDown);
      document.removeEventListener('keydown', handleEscape);
    };
  }, []);

  const [workers, setWorkers] = useState<Worker[]>([]);
  const [approvalLoading, setApprovalLoading] = useState<string | null>(null);
  const [sites, setSites] = useState<Site[]>([]);
  const [logs, setLogs] = useState<WorkLog[]>([]);
  const [admins, setAdmins] = useState<AdminUser[]>([]);
  const [tools, setTools] = useState<ToolRecord[]>([]);
  const [config, setConfig] = useState<AppConfig>(StorageService.getConfig());

  // Admin Chat Panel States
  const [chats, setChats] = useState<ChatMessage[]>([]);
  const [activeWorkerChatId, setActiveWorkerChatId] = useState<string | null>(null);
  const [adminChatInput, setAdminChatInput] = useState('');
  const chatEndRef = useRef<HTMLDivElement>(null);

  // iOS 26 Push Notifications state
  const [pushNotifications, setPushNotifications] = useState<any[]>([]);
  const [pushStatus, setPushStatus] = useState<PushPermissionStatus>(() => PushService.getPermissionStatus());
  const [pushLoading, setPushLoading] = useState(false);
  const [pushMessage, setPushMessage] = useState('');
  const [pushRegistered, setPushRegistered] = useState(false);
  
  const mountTimeRef = useRef<number>(Date.now());
  const notifiedIdsRef = useRef<Set<string>>(new Set());

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

  const handleEnableAdminPush = async () => {
    setPushLoading(true);
    setPushMessage('');

    try {
      const result = await PushService.requestPermissionAndRegister({
        ownerType: 'admin',
        ownerId: currentUser?.id || 'ADMIN',
        ownerName: currentUser?.username || 'Admin Principal',
      });

      setPushStatus(result.status);
      setPushMessage(result.message);

      if (result.ok) {
        setPushRegistered(true);
        triggerPushNotification(
          'Notificaciones del jefe activadas',
          'Recibirás avisos de fichajes y certificados.',
          'system',
          undefined,
          '🔔'
        );
      }
    } catch (error: any) {
      setPushStatus(PushService.getPermissionStatus());
      setPushMessage(error?.message || 'No se pudieron activar las notificaciones del jefe.');
    } finally {
      setPushLoading(false);
    }
  };

  useEffect(() => {
    setPushRegistered(PushService.isRegisteredLocally({
      ownerType: 'admin',
      ownerId: currentUser?.id || 'ADMIN',
      ownerName: currentUser?.username || 'Admin Principal',
    }));
    setPushStatus(PushService.getPermissionStatus());
  }, [currentUser]);

  const handleNotificationClick = (notif: any) => {
    if (notif.type === 'chat' && notif.senderId) {
      setActiveWorkerChatId(notif.senderId);
      setActiveTab('chat');
      // Clean selected notification
      setPushNotifications(prev => prev.filter(n => n.id !== notif.id));
    }
  };

  
  // Weekly Reports & Payslips state
  const [weeklyReports, setWeeklyReports] = useState<WeeklyReport[]>([]);
  const [payslips, setPayslips] = useState<Payslip[]>([]);
  const [selectedReport, setSelectedReport] = useState<WeeklyReport | null>(null);
  const [rejectionReasonInput, setRejectionReasonInput] = useState('');
  const [showRejectionInput, setShowRejectionInput] = useState(false);
  
  // Payslip form state
  const [payslipForm, setPayslipForm] = useState({
    workerId: '',
    monthStr: new Date().toISOString().substring(0, 7), // YYYY-MM
    baseSalary: 1200,
    extraHours: 0,
    extraHoursPay: 15,
    deductions: 0,
    title: ''
  });
  
  const [payslipMode, setPayslipMode] = useState<'auto' | 'upload'>('auto');
  const [uploadedPdfBase64, setUploadedPdfBase64] = useState<string>('');
  const [uploadedPdfName, setUploadedPdfName] = useState<string>('');
  const [uploadedTotalPay, setUploadedTotalPay] = useState<number>(1200);
  
  const [isSaving, setIsSaving] = useState(false);
  const [showSaveSuccess, setShowSaveSuccess] = useState(false);

  const [workerSearchQuery, setWorkerSearchQuery] = useState('');
  const [siteSearchQuery, setSiteSearchQuery] = useState('');
  const [toolSearchQuery, setToolSearchQuery] = useState('');
  const [toolFilterWorker, setToolFilterWorker] = useState('');
  const [toolFilterSite, setToolFilterSite] = useState('');
  const [hoursSearchQuery, setHoursSearchQuery] = useState('');
  const [hoursFilterDate, setHoursFilterDate] = useState(new Date().toISOString().split('T')[0]);
  
  const [logSearchQuery, setLogSearchQuery] = useState('');
  const [logFilterWorker, setLogFilterWorker] = useState('');
  const [logFilterSite, setLogFilterSite] = useState('');
  const [logFilterType, setLogFilterType] = useState('');
  const [logFilterDate, setLogFilterDate] = useState('');
  const [showLogFilters, setShowLogFilters] = useState(false);

  const [isLogoutConfirmOpen, setIsLogoutConfirmOpen] = useState(false);
  const [isClearLogsConfirmOpen, setIsClearLogsConfirmOpen] = useState(false);
  const [logToDelete, setLogToDelete] = useState<string | null>(null);

  const [reportModal, setReportModal] = useState<{
    isOpen: boolean;
    worker: Worker | null;
    type: 'WEEK' | 'MONTH';
    selectedDate: string;
    selectedMonth: number;
  }>({
    isOpen: false,
    worker: null,
    type: 'MONTH',
    selectedDate: new Date().toISOString().split('T')[0],
    selectedMonth: new Date().getMonth()
  });

  const [isSiteModalOpen, setIsSiteModalOpen] = useState(false);
  const [editingSite, setEditingSite] = useState<Site | null>(null);
  const [siteForm, setSiteForm] = useState({ name: '', address: '', active: true, lat: '', lng: '' });

  const [isToolModalOpen, setIsToolModalOpen] = useState(false);
  const [editingTool, setEditingTool] = useState<ToolRecord | null>(null);
  const [toolForm, setToolForm] = useState({ toolName: '', brand: '', model: '', workerId: '', siteId: '' });
  const [toolModalError, setToolModalError] = useState('');

  const [isAdminModalOpen, setIsAdminModalOpen] = useState(false);
  const [adminForm, setAdminForm] = useState({ username: '', password: '' });

  const [selectedWorkerProfile, setSelectedWorkerProfile] = useState<Worker | null>(null);
  const [isWorkerProfileModalOpen, setIsWorkerProfileModalOpen] = useState(false);
  const [selectedProfileTab, setSelectedProfileTab] = useState<'details' | 'hours' | 'certs' | 'absences'>('details');
  const [isWorkerFormModalOpen, setIsWorkerFormModalOpen] = useState(false);
  const [editingWorker, setEditingWorker] = useState<Worker | null>(null);
  const [workerForm, setWorkerForm] = useState({ name: '', dni: '', phone: '', email: '', pin: '', role: 'Electricista', active: true, photoUrl: '' });
  const [workerFormError, setWorkerFormError] = useState('');
  const [passwordResetWorker, setPasswordResetWorker] = useState<Worker | null>(null);
  const [temporaryPassword, setTemporaryPassword] = useState('');
  const [temporaryPasswordConfirm, setTemporaryPasswordConfirm] = useState('');
  const [showTemporaryPassword, setShowTemporaryPassword] = useState(false);
  const [passwordResetLoading, setPasswordResetLoading] = useState(false);
  const [passwordResetError, setPasswordResetError] = useState('');
  const [passwordResetSuccess, setPasswordResetSuccess] = useState(false);
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const workerPhotoInputRef = useRef<HTMLInputElement>(null);
  const [certNameInput, setCertNameInput] = useState('');
  const [certificateActionId, setCertificateActionId] = useState<string | null>(null);

  // Mejoas: Zoom states for weekly reports
  const [zoomLevel, setZoomLevel] = useState(1);
  const [panOffset, setPanOffset] = useState({ x: 0, y: 0 });
  const [isDragging, setIsDragging] = useState(false);
  const dragStartRef = useRef({ x: 0, y: 0 });

  // Mejoras: Google OAuth & Gmail API states
  const [googleUser, setGoogleUser] = useState<any>(null);
  const [googleToken, setGoogleToken] = useState<string | null>(null);
  const [isSyncingSheets, setIsSyncingSheets] = useState(false);
  const [syncMessage, setSyncMessage] = useState('');
  const [unauthorizedDomain, setUnauthorizedDomain] = useState<string | null>(null);
  const [operationNotAllowed, setOperationNotAllowed] = useState(false);
  const [googleApiError, setGoogleApiError] = useState<{ apiName: string; message: string; code?: number } | null>(null);
  const [isSendingEmail, setIsSendingEmail] = useState(false);
  const [emailModal, setEmailModal] = useState<{
    isOpen: boolean;
    worker: Worker | null;
    selectedCertIds: string[];
    to: string;
    subject: string;
    body: string;
  }>({
    isOpen: false,
    worker: null,
    selectedCertIds: [],
    to: '',
    subject: '',
    body: ''
  });

  // Mejoras: Reports deletion and filter states
  const [reportFilterWorker, setReportFilterWorker] = useState('');
  const [reportFilterStatus, setReportFilterStatus] = useState('');
  const [reportFilterStartDate, setReportFilterStartDate] = useState('');
  const [reportFilterEndDate, setReportFilterEndDate] = useState('');
  const [showReportFilters, setShowReportFilters] = useState(false);

  // Mejoras: Clean-up logs reference flag
  const hasRunCleanup = useRef(false);



  useEffect(() => {
    setWorkers(StorageService.getWorkers());
    setSites(StorageService.getSites());
    setLogs(StorageService.getLogs());
    setAdmins(StorageService.getAdmins());
    setTools(StorageService.getTools());
    setConfig(StorageService.getConfig());
    setWeeklyReports(StorageService.getReports());
    setPayslips(StorageService.getPayslips());
    setChats(StorageService.getChats());

    const unsubWorkers = StorageService.subscribeToWorkers(setWorkers);
    const unsubSites = StorageService.subscribeToSites(setSites);
    const unsubLogs = StorageService.subscribeToLogs((newLogs) => {
      setLogs(newLogs);
      newLogs.forEach(log => {
        if (log.timestamp > mountTimeRef.current && !notifiedIdsRef.current.has(log.id)) {
          notifiedIdsRef.current.add(log.id);
          const actionEmoji = log.type === 'ENTRADA' ? '🚀' : log.type === 'SALIDA' ? '🚪' : '⏱️';
          const cleanType = log.type.replace('_', ' ');
          triggerPushNotification(
            `${actionEmoji} ${log.workerName}`,
            `${cleanType} en ${log.siteName}`,
            'log',
            undefined,
            actionEmoji
          );
        }
      });
    });
    const unsubAdmins = StorageService.subscribeToAdmins(setAdmins);
    const unsubTools = StorageService.subscribeToTools(setTools);
    const unsubConfig = StorageService.subscribeToConfig(setConfig);
    const unsubReports = StorageService.subscribeToReports(setWeeklyReports);
    const unsubPayslips = StorageService.subscribeToPayslips(setPayslips);
    const unsubChats = StorageService.subscribeToChats((newChats) => {
      setChats(newChats);
      newChats.forEach(msg => {
        if (msg.timestamp > mountTimeRef.current && !notifiedIdsRef.current.has(msg.id)) {
          notifiedIdsRef.current.add(msg.id);
          const isForMe = msg.receiverId === 'ADMIN';
          const isFromMe = msg.senderId === 'ADMIN';
          if (isForMe && !isFromMe) {
            triggerPushNotification(
              `💬 ${msg.senderName}`,
              msg.text,
              'chat',
              msg.senderId,
              '💬'
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
      unsubWorkers(); unsubSites(); unsubLogs(); unsubAdmins(); unsubTools(); unsubConfig(); unsubReports(); unsubPayslips(); unsubChats();
    };
  }, []);

  useEffect(() => {
    if (activeTab === 'chat' && activeWorkerChatId) {
      StorageService.markMessagesAsRead(activeWorkerChatId, 'ADMIN');
    }
  }, [activeTab, activeWorkerChatId, chats]);

  useEffect(() => {
    if (chatEndRef.current) {
      chatEndRef.current.scrollIntoView({ behavior: 'smooth' });
    }
  }, [chats, activeWorkerChatId, activeTab]);

  // Mejoras: Automatic Cleanup of logs older than 1 month
  const runLogsAutoCleanup = async (showNotification = false) => {
    const oneMonthMs = 30 * 24 * 60 * 60 * 1000;
    const cutoffTimestamp = Date.now() - oneMonthMs;
    const cutoffDateStr = new Date(cutoffTimestamp).toLocaleDateString('es-ES');

    // Filter logs that are older than 1 month
    const oldLogs = logs.filter(l => l.timestamp < cutoffTimestamp);
    if (oldLogs.length === 0) {
      if (showNotification) {
        alert("No se encontraron registros de fichaje de más de 1 mes de antigüedad para eliminar.");
      }
      return;
    }

    try {
      // Group old logs by workerId to notify them
      const affectedWorkerIds = Array.from(new Set(oldLogs.map(l => l.workerId))) as string[];

      // Delete old logs
      for (const log of oldLogs) {
        await StorageService.deleteLog(log.id);
      }

      // Send chat notifications to affected workers
      for (const workerId of affectedWorkerIds) {
        const workerName = workers.find(w => w.id === workerId)?.name || 'Operario';
        
        const chatMsg: ChatMessage = {
          id: 'msg_cleanup_' + Date.now() + '_' + Math.random().toString(36).substring(2, 7),
          senderId: 'ADMIN',
          senderName: 'EL JEFE',
          receiverId: workerId,
          receiverName: workerName,
          text: `⚠️ AVISO DE CONTROL: Hola ${workerName}, tus registros de fichaje anteriores al ${cutoffDateStr} (con más de 1 mes de antigüedad) han sido depurados de forma permanente de acuerdo con la Ley de Protección de Datos y optimización de base de datos de CARMAGNE INSTAL SL.`,
          timestamp: Date.now(),
          dateStr: new Date().toLocaleDateString('es-ES'),
          timeStr: new Date().toLocaleTimeString('es-ES', { hour: '2-digit', minute: '2-digit' }),
          read: false
        };
        await StorageService.sendMessage(chatMsg);
      }

      if (showNotification || affectedWorkerIds.length > 0) {
        alert(`🧹 DEPURACIÓN AUTOMÁTICA COMPLETADA:\n\nSe han eliminado ${oldLogs.length} registros de fichaje anteriores al ${cutoffDateStr} (más de 1 mes de antigüedad).\nSe ha enviado una notificación de aviso a los ${affectedWorkerIds.length} operarios afectados mediante el chat interno.`);
      }
    } catch (error) {
      console.error("Error running logs auto cleanup:", error);
      if (showNotification) {
        alert("Ocurrió un error al depurar los registros antiguos.");
      }
    }
  };

  // Trigger auto cleanup once logs and workers are loaded
  useEffect(() => {
    if (logs.length > 0 && workers.length > 0 && !hasRunCleanup.current) {
      hasRunCleanup.current = true;
      setTimeout(() => {
        runLogsAutoCleanup(false);
      }, 3000);
    }
  }, [logs, workers]);

  // Mejoras: Download single report as PDF with full detailed sections
  const handleDownloadSingleReportPDF = (report: WeeklyReport) => {
    const doc = new jsPDF();
    
    // Neon neon style heading
    doc.setFillColor(5, 5, 5);
    doc.rect(0, 0, 210, 40, 'F');
    
    doc.setTextColor(204, 255, 0); // Neon yellow/green
    doc.setFont("Helvetica", "bold");
    doc.setFontSize(22);
    doc.text("COPA NAVARRA - INVIERNO 2026", 14, 18);
    
    doc.setTextColor(255, 255, 255);
    doc.setFontSize(10);
    doc.text("CARMAGNE INSTAL SL - REPORTE DE CONTROL DE HORAS", 14, 26);
    doc.text(`Identificador de Parte: ${report.id}`, 14, 32);

    doc.setTextColor(0, 0, 0);
    doc.setFontSize(11);
    doc.text("DATOS DE TRABAJO", 14, 48);
    
    const generalData = [
      ["Operario", report.workerName.toUpperCase()],
      ["Fecha de Envío", report.dateStr],
      ["Periodo", report.startDate && report.endDate ? `${report.startDate} - ${report.endDate}` : "Semanal"],
      ["Estado", report.status === 'APPROVED' ? 'APROBADO' : report.status === 'REJECTED' ? 'RECHAZADO' : 'PENDIENTE']
    ];
    
    autoTable(doc, {
      body: generalData,
      startY: 52,
      theme: 'grid',
      styles: { fontSize: 10, cellPadding: 4 }
    });

    let currentY = (doc as any).lastAutoTable.finalY + 10;

    if (report.comments) {
      doc.setFontSize(11);
      doc.text("Comentarios y Aclaraciones del Trabajador:", 14, currentY);
      doc.setFontSize(10);
      const commentLines = doc.splitTextToSize(report.comments, 180);
      doc.text(commentLines, 14, currentY + 6);
      currentY += 10 + commentLines.length * 4.5;
    }

    if (report.isAiParsed) {
      doc.setFontSize(11);
      doc.text("Lectura Inteligente Realizada por Gemini AI:", 14, currentY);
      currentY += 4;
      
      const aiData = [
        ["Rango de Fechas Detectado", report.extractedDates || "-"],
        ["Suma de Horas Extraídas", `${report.extractedHours || 0} horas`],
        ["Tareas Extraídas", report.extractedTasks || "-"],
        ["Total Estimado", report.extractedTotal || "-"]
      ];
      
      autoTable(doc, {
        body: aiData,
        startY: currentY,
        theme: 'striped',
        styles: { fontSize: 9 }
      });
      
      currentY = (doc as any).lastAutoTable.finalY + 10;
    }

    if (report.dailyHours && report.dailyHours.length > 0) {
      doc.setFontSize(11);
      doc.text("Desglose Diario de Fichajes Extraídos (Gemini AI):", 14, currentY);
      currentY += 4;
      
      const dailyRows = report.dailyHours.map(dh => [dh.date, `${dh.hours}h`, dh.tasks || "-"]);
      autoTable(doc, {
        head: [['Fecha', 'Horas', 'Actividades / Obras']],
        body: dailyRows,
        startY: currentY,
        styles: { fontSize: 9, cellPadding: 3 }
      });
    }

    doc.save(`parte_trabajo_${report.workerName.toLowerCase()}_${report.id}.pdf`);
  };

  // Helper to build raw MIME message for Gmail API
  const buildMimeMessage = (
    to: string,
    subject: string,
    messageText: string,
    attachments: { name: string; fileBase64: string }[]
  ): string => {
    const boundary = "boundary_carmagne_instal_" + Date.now().toString(16);
    const nl = "\r\n";
    
    let parts = [];
    parts.push(`To: ${to}`);
    parts.push(`Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`);
    parts.push(`MIME-Version: 1.0`);
    parts.push(`Content-Type: multipart/mixed; boundary="${boundary}"`);
    parts.push(nl);
    
    // Body text
    parts.push(`--${boundary}`);
    parts.push(`Content-Type: text/plain; charset="UTF-8"`);
    parts.push(`Content-Transfer-Encoding: 7bit`);
    parts.push(nl);
    parts.push(messageText);
    parts.push(nl);
    
    // Attachments
    for (const att of attachments) {
      const commaIndex = att.fileBase64.indexOf(",");
      let base64Data = commaIndex !== -1 ? att.fileBase64.substring(commaIndex + 1) : att.fileBase64;
      
      let mimeType = "application/octet-stream";
      if (att.fileBase64.startsWith("data:")) {
        const match = att.fileBase64.match(/data:([^;]+);/);
        if (match) mimeType = match[1];
      }
      
      parts.push(`--${boundary}`);
      parts.push(`Content-Type: ${mimeType}; name="${att.name}"`);
      parts.push(`Content-Disposition: attachment; filename="${att.name}"`);
      parts.push(`Content-Transfer-Encoding: base64`);
      parts.push(nl);
      parts.push(base64Data);
      parts.push(nl);
    }
    
    parts.push(`--${boundary}--`);
    
    const emailContent = parts.join(nl);
    const rawBase64 = btoa(unescape(encodeURIComponent(emailContent)))
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
      
    return rawBase64;
  };

  const handleGoogleSignInForGmail = async () => {
    const provider = new GoogleAuthProvider();
    provider.addScope('https://www.googleapis.com/auth/gmail.send');
    provider.addScope('https://www.googleapis.com/auth/spreadsheets');
    provider.addScope('https://www.googleapis.com/auth/userinfo.profile');
    provider.addScope('https://www.googleapis.com/auth/userinfo.email');
    try {
      const result = await signInWithPopup(auth, provider);
      const credential = GoogleAuthProvider.credentialFromResult(result);
      if (credential?.accessToken) {
        setGoogleUser(result.user);
        setGoogleToken(credential.accessToken);
        alert(`Sesión de Google iniciada correctamente como: ${result.user.email}`);
      } else {
        alert("No se pudo obtener el token de acceso de Google.");
      }
    } catch (err: any) {
      console.error("Error al iniciar sesión con Google:", err);
      if (err.code === "auth/popup-closed-by-user" || err.code === "auth/cancelled-popup-request") {
        console.log("Inicio de sesión de Google cancelado por el usuario.");
        return;
      }
      if (err.code === "auth/unauthorized-domain" || (err.message && err.message.includes("unauthorized-domain"))) {
        setUnauthorizedDomain(window.location.hostname);
      } else if (err.code === "auth/operation-not-allowed" || (err.message && err.message.includes("operation-not-allowed"))) {
        setOperationNotAllowed(true);
      } else {
        alert("Error al iniciar sesión con Google: " + (err.message || err));
      }
    }
  };

  const handleGoogleSignOut = async () => {
    try {
      await firebaseSignOut(auth);
      setGoogleUser(null);
      setGoogleToken(null);
      alert("Sesión de Google cerrada.");
    } catch (err) {
      console.error("Error al cerrar sesión:", err);
    }
  };

  const handleSyncGoogleSheets = async () => {
    if (!googleToken) {
      alert("Inicia sesión con Google primero.");
      return;
    }
    setIsSyncingSheets(true);
    setSyncMessage('Iniciando sincronización...');
    try {
      const spreadsheetIdMatch = config.googleSheetUrl ? config.googleSheetUrl.match(/\/d\/([a-zA-Z0-9-_]+)/) : null;
      let spreadsheetId = spreadsheetIdMatch ? spreadsheetIdMatch[1] : null;

      if (!spreadsheetId) {
        setSyncMessage('Creando nueva hoja de cálculo...');
        const createRes = await fetch('https://sheets.googleapis.com/v4/spreadsheets', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            properties: {
              title: 'CARMAGNE INSTAL 2024 - Registro de Personal y Fichajes'
            }
          })
         });
         if (!createRes.ok) {
                       const errData = await createRes.json().catch(() => ({})); setGoogleApiError({ apiName: "Google Sheets API", message: errData.error?.message || "Error al crear la hoja de cálculo", code: errData.error?.code || createRes.status }); throw new Error(errData.error?.message || 'Error al crear la hoja de cálculo');
         }
         const createData = await createRes.json();
         spreadsheetId = createData.spreadsheetId;
         const spreadsheetUrl = createData.spreadsheetUrl;
         
         const newConfig = { ...config, googleSheetUrl: spreadsheetUrl };
         await StorageService.saveConfig(newConfig);
         setConfig(newConfig);
       }

       setSyncMessage('Creando pestañas (Personal, Obras, Fichajes)...');
       try {
         await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}:batchUpdate`, {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${googleToken}`,
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({
             requests: [
               { addSheet: { properties: { title: 'Personal' } } },
               { addSheet: { properties: { title: 'Obras' } } },
               { addSheet: { properties: { title: 'Fichajes' } } }
             ]
           })
         });
       } catch (e) {
         // Las pestañas probablemente ya existen
       }

       const writeSheetData = async (sheetName: string, headers: string[], rows: any[][]) => {
         // 1. Limpiar la hoja
         await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName)}:clear`, {
           method: 'POST',
           headers: {
             'Authorization': `Bearer ${googleToken}`
           }
         });

         // 2. Escribir nuevos valores
         const values = [headers, ...rows];
         const response = await fetch(`https://sheets.googleapis.com/v4/spreadsheets/${spreadsheetId}/values/${encodeURIComponent(sheetName + '!A1')}?valueInputOption=USER_ENTERED`, {
           method: 'PUT',
           headers: {
             'Authorization': `Bearer ${googleToken}`,
             'Content-Type': 'application/json',
           },
           body: JSON.stringify({ values })
         });
         if (!response.ok) {
                       const errData = await response.json().catch(() => ({})); setGoogleApiError({ apiName: "Google Sheets API", message: errData.error?.message || `Error escribiendo en la pestaña ${sheetName}`, code: errData.error?.code || response.status }); throw new Error(errData.error?.message || `Error escribiendo en la pestaña ${sheetName}`);
         }
       };

       // Sincronizar Personal
       setSyncMessage('Actualizando pestaña Personal...');
       const personalHeaders = ['ID', 'Nombre', 'DNI/NIE', 'Teléfono', 'Email', 'Rol', 'Estado'];
       const personalRows = workers.map(w => [w.id, w.name, w.dni, w.phone, w.email || '', w.role, w.active ? 'ACTIVO' : 'INACTIVO']);
       await writeSheetData('Personal', personalHeaders, personalRows);

       // Sincronizar Obras
       setSyncMessage('Actualizando pestaña Obras...');
       const obrasHeaders = ['ID', 'Nombre de Obra', 'Dirección', 'Estado', 'Latitud', 'Longitud'];
       const obrasRows = sites.map(s => [s.id, s.name, s.address, s.active ? 'ACTIVO' : 'INACTIVO', s.lat || '', s.lng || '']);
       await writeSheetData('Obras', obrasHeaders, obrasRows);

       // Sincronizar Fichajes
       setSyncMessage('Actualizando pestaña Fichajes...');
       const fichajesHeaders = ['ID', 'Fecha', 'Hora', 'Operario', 'Obra', 'Tipo de Fichaje', 'Notas', 'Latitud', 'Longitud'];
       const fichajesRows = logs.map(l => [l.id, l.dateStr, l.timeStr, l.workerName, l.siteName, l.type === 'in' ? 'ENTRADA' : 'SALIDA', l.notes || '', l.location?.latitude || '', l.location?.longitude || '']);
       await writeSheetData('Fichajes', fichajesHeaders, fichajesRows);

       setSyncMessage('¡Sincronizado con éxito!');
       setTimeout(() => setSyncMessage(''), 4000);
     } catch (err: any) {
       console.error("Error al sincronizar con Google Sheets:", err);
       const errMsg = err.message || JSON.stringify(err);
       if (errMsg.includes("sheets.googleapis.com") || errMsg.includes("has not been used in project") || errMsg.includes("disabled")) {
         setGoogleApiError({
           apiName: "Google Sheets API",
           message: errMsg,
           code: 403
         });
       } else {
         alert("Error al sincronizar con Google Sheets: " + errMsg);
       }
       setSyncMessage('Fallo en la sincronización');
     } finally {
       setIsSyncingSheets(false);
     }
   };

   const handleSendTestGmail = async () => {
     if (!googleToken || !googleUser) {
       alert("Inicia sesión con Google primero.");
       return;
     }
     try {
       const to = googleUser.email;
       const subject = "🧪 CARMAGNE INSTAL 2024 - Prueba de Integración de Gmail";
       const body = `Hola ${googleUser.displayName},\n\nEste es un correo de prueba automático de la integración de Gmail de la aplicación "CARMAGNE INSTAL 2024".\n\nTu cuenta se ha vinculado correctamente y tienes todos los permisos necesarios para enviar las nóminas oficiales de los operarios y sus certificados.\n\n¡Un saludo!`;

       const nl = "\n";
       const parts = [
         `To: ${to}`,
         `Subject: =?utf-8?B?${btoa(unescape(encodeURIComponent(subject)))}?=`,
         "Content-Type: text/plain; charset=utf-8",
         "MIME-Version: 1.0",
         "",
         body
       ];
       const emailContent = parts.join(nl);
       const rawBase64 = btoa(unescape(encodeURIComponent(emailContent)))
         .replace(/\+/g, '-')
         .replace(/\//g, '_')
         .replace(/=+$/, '');

       const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
         method: 'POST',
         headers: {
           'Authorization': `Bearer ${googleToken}`,
           'Content-Type': 'application/json',
         },
         body: JSON.stringify({ raw: rawBase64 })
       });

       if (response.ok) {
         alert(`📧 ¡Éxito! Correo de prueba enviado correctamente a ${to}`);
       } else {
         const errData = await response.json();
         console.error("Error Gmail API: " + JSON.stringify(errData));
                   setGoogleApiError({ apiName: "Gmail API", message: errData.error?.message || JSON.stringify(errData), code: errData.error?.code || response.status });
       }
     } catch (err: any) {
       console.error("Error al enviar correo de prueba:", err);
       alert("Error al enviar correo de prueba: " + err.message);
     }
   };

  const handleSendEmailWithCerts = async () => {
    const { worker, selectedCertIds, to, subject, body } = emailModal;
    if (!worker || selectedCertIds.length === 0 || !to) {
      alert("Por favor, selecciona al menos un certificado y completa el destinatario.");
      return;
    }

    const selectedCerts = (worker.certificates || []).filter(c => selectedCertIds.includes(c.id));
    if (selectedCerts.length === 0) {
      alert("No se encontraron certificados válidos.");
      return;
    }

    setIsSendingEmail(true);

    try {
      // 1. If we have a Google access token, try to send via real Gmail API
      if (googleToken) {
        const attachments = await Promise.all(selectedCerts.map(async (cert) => ({
          name: cert.name,
          fileBase64: cert.fileBase64 && cert.fileBase64.length > 50
            ? cert.fileBase64
            : await StorageService.getCertificateBase64(cert.id),
        })));
        const missingAttachment = attachments.find(att => !att.fileBase64 || att.fileBase64.length < 50);
        if (missingAttachment) {
          alert(`No se pudo cargar el certificado "${missingAttachment.name}" desde Storage.`);
          return;
        }
        const rawMessage = buildMimeMessage(to, subject, body, attachments);
        
        const response = await fetch('https://gmail.googleapis.com/gmail/v1/users/me/messages/send', {
          method: 'POST',
          headers: {
            'Authorization': `Bearer ${googleToken}`,
            'Content-Type': 'application/json'
          },
          body: JSON.stringify({ raw: rawMessage })
        });

        if (response.ok) {
          alert(`📧 ¡ÉXITO DE GMAIL!\n\nLos certificados seleccionados de ${worker.name} se han enviado correctamente a ${to} usando tu cuenta de Google.`);
          setEmailModal(prev => ({ ...prev, isOpen: false, selectedCertIds: [] }));
        } else {
          const errData = await response.json();
          console.error("Gmail Send Error: " + JSON.stringify(errData));
                    setGoogleApiError({ apiName: "Gmail API", message: errData.error?.message || JSON.stringify(errData), code: errData.error?.code || response.status });
          throw new Error(errData.error?.message || "Error al enviar correo con Gmail API");
        }
      } else {
        // Fallback or request login:
        const useSimulated = window.confirm(
          "No has iniciado sesión con Google. ¿Deseas simular el envío de certificados de forma directa por nuestro servidor seguro?"
        );
        if (useSimulated) {
          await new Promise(resolve => setTimeout(resolve, 1500));
          alert(`📧 ¡ENVÍO SIMULADO COMPLETADO!\n\nLos certificados de ${worker.name} se han enviado por correo electrónico a ${to}.\nArchivos adjuntos: ${selectedCerts.map(c => c.name).join(', ')}`);
          setEmailModal(prev => ({ ...prev, isOpen: false, selectedCertIds: [] }));
        }
      }
    } catch (err: any) {
      console.error("Error sending email:", err);
      alert(`Error al enviar el correo electrónico: ${err.message || err}`);
    } finally {
      setIsSendingEmail(false);
    }
  };


  const adminTotalUnreadCount = useMemo(() => {
    return chats.filter(c => c.receiverId === 'ADMIN' && !c.read).length;
  }, [chats]);

  const dailyHoursStats = useMemo(() => {
    const filterDateFormatted = hoursFilterDate ? new Date(hoursFilterDate).toLocaleDateString('es-ES') : null;
    const grouped: Record<string, WorkLog[]> = {};
    logs.forEach(log => {
      if (filterDateFormatted && log.dateStr !== filterDateFormatted) return;
      if (hoursSearchQuery && !log.workerName.toLowerCase().includes(hoursSearchQuery.toLowerCase())) return;
      const key = `${log.workerId}_${log.dateStr}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(log);
    });
    return Object.entries(grouped).map(([key, workerLogs]) => {
      const { totalWork, totalBreak, isOngoing } = calculateTotalsFromLogs(workerLogs);
      return {
        key, workerName: workerLogs[0].workerName, dateStr: workerLogs[0].dateStr,
        workMs: totalWork, breakMs: totalBreak, totalMs: totalWork + totalBreak,
        isCurrentlyActive: isOngoing
      };
    });
  }, [logs, hoursFilterDate, hoursSearchQuery]);

  const handleLogoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 1000000) { alert("El logo es demasiado pesado. Máximo 1MB."); return; }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const newConfig = { ...config, logoUrl: base64String };
        setConfig(newConfig);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleFaviconUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.size > 500000) { alert("El icono es demasiado pesado. Máximo 500KB."); return; }
      const reader = new FileReader();
      reader.onloadend = () => {
        const base64String = reader.result as string;
        const newConfig = { ...config, faviconUrl: base64String };
        setConfig(newConfig);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleSendAdminMessage = async () => {
    if (!adminChatInput.trim() || !activeWorkerChatId) return;

    const targetWorkerName = workers.find(w => w.id === activeWorkerChatId)?.name || 'Operario';

    const msg: ChatMessage = {
      id: 'msg_' + Date.now() + '_' + Math.random().toString(36).substr(2, 5),
      senderId: 'ADMIN',
      senderName: 'EL JEFE',
      receiverId: activeWorkerChatId,
      receiverName: targetWorkerName,
      text: adminChatInput.trim(),
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
      }).catch((pushError) => console.warn('No se pudo enviar push de chat admin:', pushError));
      setAdminChatInput('');
    } catch (err) {
      alert(err instanceof Error ? err.message : "Error al enviar el mensaje.");
    }
  };

  const handlePdfUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        alert("Solo se admiten archivos PDF.");
        if (payslipFileInputRef.current) payslipFileInputRef.current.value = '';
        return;
      }
      if (file.size > 5000000) {
        alert("El archivo PDF es demasiado pesado. Máximo 5MB.");
        if (payslipFileInputRef.current) payslipFileInputRef.current.value = '';
        return;
      }
      try {
        const protectedPdf = await isPasswordProtectedPdf(file);
        if (protectedPdf) {
          alert("No se puede subir esta nómina porque el PDF está protegido con contraseña. Sube una versión sin contraseña.");
          if (payslipFileInputRef.current) payslipFileInputRef.current.value = '';
          return;
        }
      } catch (err) {
        console.error("Error checking payslip PDF password protection", err);
        alert("No se pudo comprobar si el PDF está protegido. Por seguridad, no se ha subido.");
        if (payslipFileInputRef.current) payslipFileInputRef.current.value = '';
        return;
      }
      const reader = new FileReader();
      reader.onloadend = () => {
        setUploadedPdfBase64(reader.result as string);
        setUploadedPdfName(file.name);
      };
      reader.readAsDataURL(file);
    }
  };

  const handleOpenWorkerProfile = (worker: Worker) => {
    setSelectedWorkerProfile(worker);
    setSelectedProfileTab('details');
    setIsWorkerProfileModalOpen(true);
  };

  const handleOpenWorkerForm = (worker: Worker | null = null, e?: React.MouseEvent) => {
    if (e) {
      e.stopPropagation();
    }
    if (worker) {
      setEditingWorker(worker);
      setWorkerForm({
        name: worker.name,
        dni: worker.dni || '',
        phone: worker.phone || '',
        email: worker.email || '',
        pin: '',
        role: worker.role || 'Electricista',
        active: worker.active !== false,
        photoUrl: worker.photoUrl || ''
      });
    } else {
      setEditingWorker(null);
      setWorkerForm({
        name: '',
        dni: '',
        phone: '',
        email: '',
        pin: '',
        role: 'Electricista',
        active: true,
        photoUrl: ''
      });
    }
    setWorkerFormError('');
    setIsWorkerFormModalOpen(true);
  };

  const generateTemporaryPassword = () => {
    const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnopqrstuvwxyz23456789';
    const values = new Uint32Array(12);
    crypto.getRandomValues(values);
    return Array.from(values, value => alphabet[value % alphabet.length]).join('');
  };

  const handleOpenPasswordReset = (worker: Worker, event?: React.MouseEvent) => {
    event?.stopPropagation();
    const generatedPassword = generateTemporaryPassword();
    setPasswordResetWorker(worker);
    setTemporaryPassword(generatedPassword);
    setTemporaryPasswordConfirm(generatedPassword);
    setShowTemporaryPassword(true);
    setPasswordResetError('');
    setPasswordResetSuccess(false);
  };

  const handleClosePasswordReset = () => {
    if (passwordResetLoading) return;
    setPasswordResetWorker(null);
    setTemporaryPassword('');
    setTemporaryPasswordConfirm('');
    setPasswordResetError('');
    setPasswordResetSuccess(false);
    setShowTemporaryPassword(false);
  };

  const handleAdminResetPassword = async () => {
    if (!passwordResetWorker) return;
    if (temporaryPassword.length < 8) {
      setPasswordResetError('La contraseña temporal debe tener al menos 8 caracteres.');
      return;
    }
    if (temporaryPassword !== temporaryPasswordConfirm) {
      setPasswordResetError('Las contraseñas no coinciden.');
      return;
    }

    setPasswordResetLoading(true);
    setPasswordResetError('');
    try {
      const user = auth.currentUser;
      if (!user) throw new Error('La sesión de administrador ha caducado.');
      const idToken = await user.getIdToken();
      const response = await fetch('/api/auth/reset-worker-password', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          Authorization: 'Bearer ' + idToken,
        },
        body: JSON.stringify({
          workerId: passwordResetWorker.id,
          newPassword: temporaryPassword,
        }),
      });
      const data = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(data?.error || 'No se pudo restablecer la contraseña.');
      setPasswordResetSuccess(true);
    } catch (error) {
      setPasswordResetError(error instanceof Error ? error.message : 'No se pudo restablecer la contraseña.');
    } finally {
      setPasswordResetLoading(false);
    }
  };

  const handleSaveWorker = async () => {
    const normalizedPhone = workerForm.phone ? normalizeSpanishPhone(workerForm.phone) : '';
    if (!workerForm.name) {
      setWorkerFormError('El nombre es un campo obligatorio.');
      return;
    }
    if (workerForm.phone) {
      if (!isSpanishPhone(normalizedPhone)) {
        setWorkerFormError('El teléfono debe ser un número español válido, por ejemplo +34600111222.');
        return;
      }
      if (!workerForm.email) {
        setWorkerFormError('El correo electrónico es obligatorio para los operarios con número de teléfono.');
        return;
      }
      if (!/\S+@\S+\.\S+/.test(workerForm.email)) {
        setWorkerFormError('El formato del correo electrónico no es válido.');
        return;
      }
    }
    if (!editingWorker && workerForm.pin.trim().length < 8) {
      setWorkerFormError('Define una contraseña temporal de al menos 8 caracteres para el nuevo operario.');
      return;
    }
    setWorkerFormError('');

    try {
      if (editingWorker) {
        const updated: Worker = {
          ...editingWorker,
          name: workerForm.name,
          dni: workerForm.dni,
          phone: normalizedPhone,
          email: workerForm.email,
          pin: editingWorker.pin || '',
          role: workerForm.role,
          active: workerForm.active,
          photoUrl: workerForm.photoUrl,
        };
        const updatedList = workers.map(w => w.id === editingWorker.id ? updated : w);
        await StorageService.saveWorkers(updatedList);
        if (selectedWorkerProfile?.id === editingWorker.id) {
          setSelectedWorkerProfile(updated);
        }
        alert('Operario actualizado con éxito.');
      } else {
        const user = auth.currentUser;
        if (!user) throw new Error('La sesión de administrador ha caducado.');
        const idToken = await user.getIdToken();
        const response = await fetch('/api/auth/register-worker', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json', Authorization: 'Bearer ' + idToken },
          body: JSON.stringify({
            name: workerForm.name,
            dni: workerForm.dni,
            phone: normalizedPhone,
            email: workerForm.email,
            password: workerForm.pin,
            role: workerForm.role,
            active: workerForm.active,
            photoUrl: workerForm.photoUrl,
          }),
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok || !data?.worker) {
          throw new Error(data?.error || 'No se pudo crear el operario.');
        }
        setWorkers(previous => [...previous, data.worker as Worker]);
        alert('Nuevo operario creado con éxito.');
      }
      setIsWorkerFormModalOpen(false);
    } catch (error) {
      setWorkerFormError(error instanceof Error ? error.message : 'No se pudo guardar el operario.');
    }
  };
