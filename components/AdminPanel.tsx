
import React, { useState, useEffect, useMemo, useRef } from 'react';
import { StorageService, ELECTRICAL_TOOLS_LIST, ELECTRICAL_BRANDS_LIST, compressImage } from '../services/storageService';
import { TelegramService } from '../services/telegramService';
import { Worker, Site, WorkLog, AppConfig, WorkMode, LogType, AdminUser, ToolRecord, WeeklyReport, Payslip, ChatMessage } from '../types';
import { 
  Users, MapPin, Download, Settings, FileText, 
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
    const isToday = logs.length > 0 && logs[0].dateStr === new Date().toLocaleDateString('es-ES');
    if (isToday) {
      if (lastWorkStart) totalWork += Math.max(0, now - lastWorkStart);
      if (lastBreakStart) totalBreak += Math.max(0, now - lastBreakStart);
    }
  }

  return { totalWork, totalBreak, isOngoing };
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

const AppLogo = ({ className, size = "md", logoUrl, scale = 1.0 }: { className?: string, size?: "sm" | "md" | "lg", logoUrl?: string, scale?: number }) => {
  const baseSize = size === "sm" ? 28 : size === "md" ? 64 : size === "lg" ? 140 : 64;
  const iconSize = baseSize * scale;
  
  if (logoUrl) {
    return (
      <div className={`relative flex items-center justify-center ${className}`}>
        <img 
          src={logoUrl} 
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
  const isSuperAdmin = currentUser === null;
  const logoInputRef = useRef<HTMLInputElement>(null);
  const faviconInputRef = useRef<HTMLInputElement>(null);
  const payslipFileInputRef = useRef<HTMLInputElement>(null);
  const [activeTab, setActiveTab] = useState<'dashboard' | 'workers' | 'sites' | 'logs' | 'tools' | 'hours' | 'admins' | 'settings' | 'reports' | 'payslips' | 'chat'>('dashboard');
  const [workers, setWorkers] = useState<Worker[]>([]);
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
  const certFileInputRef = useRef<HTMLInputElement>(null);
  const workerPhotoInputRef = useRef<HTMLInputElement>(null);
  const [certNameInput, setCertNameInput] = useState('');

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
        const rawMessage = buildMimeMessage(to, subject, body, selectedCerts.map(c => ({ name: c.name, fileBase64: c.fileBase64 })));
        
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
      setAdminChatInput('');
    } catch (err) {
      alert("Error al enviar el mensaje.");
    }
  };

  const handlePdfUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (file.type !== 'application/pdf') {
        alert("Solo se admiten archivos PDF.");
        return;
      }
      if (file.size > 5000000) {
        alert("El archivo PDF es demasiado pesado. Máximo 5MB.");
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
        pin: worker.pin || '',
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

  const handleSaveWorker = async () => {
    if (!workerForm.name) {
      setWorkerFormError('El nombre es un campo obligatorio.');
      return;
    }
    if (workerForm.phone) {
      if (!workerForm.email) {
        setWorkerFormError('El correo electrónico es obligatorio para los operarios con número de teléfono.');
        return;
      }
      if (!/\S+@\S+\.\S+/.test(workerForm.email)) {
        setWorkerFormError('El formato del correo electrónico no es válido.');
        return;
      }
    }
    setWorkerFormError('');
    
    if (editingWorker) {
      const updated: Worker = {
        ...editingWorker,
        name: workerForm.name,
        dni: workerForm.dni,
        phone: workerForm.phone,
        email: workerForm.email,
        pin: workerForm.pin || '0000',
        role: workerForm.role,
        active: workerForm.active,
        photoUrl: workerForm.photoUrl
      };
      const updatedList = workers.map(w => w.id === editingWorker.id ? updated : w);
      await StorageService.saveWorkers(updatedList);
      if (selectedWorkerProfile?.id === editingWorker.id) {
        setSelectedWorkerProfile(updated);
      }
      alert('Operario actualizado con éxito.');
    } else {
      const newWorker: Worker = {
        id: `W${Date.now()}`,
        name: workerForm.name,
        dni: workerForm.dni,
        phone: workerForm.phone,
        email: workerForm.email,
        pin: workerForm.pin || '0000',
        qrCode: `QR_${Date.now()}`,
        role: workerForm.role,
        active: workerForm.active,
        photoUrl: workerForm.photoUrl,
        certificates: []
      };
      await StorageService.registerNewWorker(newWorker);
      
      const telegramMessage = `🆕 <b>Nuevo Operario Registrado (desde Admin)</b>\n👷‍♂️ Nombre: <b>${newWorker.name}</b>\n🆔 DNI: ${newWorker.dni || 'S/DNI'}\n💼 Puesto: ${newWorker.role}\n📱 Teléfono: ${newWorker.phone || 'No registrado'}\n📧 Email: ${newWorker.email || 'No registrado'}`;
      TelegramService.enviarNotificacionTelegram(telegramMessage);
      alert('Nuevo operario creado con éxito.');
    }
    setIsWorkerFormModalOpen(false);
  };

  const handleWorkerPhotoUpload = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file) {
      if (!file.type.startsWith('image/')) {
        alert("Por favor, sube un archivo de imagen.");
        return;
      }
      const reader = new FileReader();
      reader.onloadend = async () => {
        try {
          const compressed = await compressImage(reader.result as string, 300, 300, 0.75);
          setWorkerForm(prev => ({ ...prev, photoUrl: compressed }));
          if (selectedWorkerProfile) {
            const updated = { ...selectedWorkerProfile, photoUrl: compressed };
            const updatedList = workers.map(w => w.id === selectedWorkerProfile.id ? updated : w);
            await StorageService.saveWorkers(updatedList);
            setSelectedWorkerProfile(updated);
          }
        } catch (err) {
          console.error("Error compressing image", err);
          alert("Hubo un error al procesar o guardar la imagen en Firebase.");
        }
      };
      reader.readAsDataURL(file);
    }
  };

  const handleAddCertificate = (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (file && selectedWorkerProfile) {
      const name = certNameInput.trim() || file.name.split('.')[0];
      const isImage = file.type.startsWith('image/') || /\.(jpg|jpeg|png|webp|heic)$/i.test(file.name);
      const isPdf = file.type === 'application/pdf' || /\.pdf$/i.test(file.name);

      if (isPdf && file.size > 750 * 1024) {
        alert(`El archivo PDF es demasiado grande (${(file.size / 1024).toFixed(0)} KB). El tamaño máximo para PDFs es de 750 KB para no superar el límite de almacenamiento de Firebase.\n\nSugerencia: Puedes hacer una foto o captura de pantalla al certificado y subir la imagen.`);
        if (certFileInputRef.current) certFileInputRef.current.value = '';
        return;
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
            workerId: selectedWorkerProfile.id,
            name: name,
            fileBase64: fileData,
            uploadDate: new Date().toLocaleDateString('es-ES'),
            size: `${(file.size / (1024 * 1024)).toFixed(2)} MB`
          };

          // Save full document in 'certificates' collection
          await StorageService.saveCertificateDoc(newCertDoc);

          // Store metadata (and lightweight base64 if small) on worker document
          const certForWorker = {
            id: certId,
            name: name,
            fileBase64: fileData.length < 250000 ? fileData : '',
            uploadDate: newCertDoc.uploadDate,
            size: newCertDoc.size
          };

          const currentCerts = selectedWorkerProfile.certificates || [];
          const updated = {
            ...selectedWorkerProfile,
            certificates: [...currentCerts, certForWorker]
          };
          
          const updatedList = workers.map(w => w.id === selectedWorkerProfile.id ? updated : w);
          await StorageService.saveWorkers(updatedList);
          setSelectedWorkerProfile(updated);
          setCertNameInput('');
          if (certFileInputRef.current) certFileInputRef.current.value = '';
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
    if (selectedWorkerProfile && confirm("¿Estás seguro de que deseas eliminar este certificado?")) {
      const currentCerts = selectedWorkerProfile.certificates || [];
      const updated = {
        ...selectedWorkerProfile,
        certificates: currentCerts.filter(c => c.id !== certId)
      };
      const updatedList = workers.map(w => w.id === selectedWorkerProfile.id ? updated : w);
      try {
        await StorageService.deleteCertificateDoc(certId);
        await StorageService.saveWorkers(updatedList);
        setSelectedWorkerProfile(updated);
      } catch (err) {
        console.error("Error deleting certificate:", err);
        alert("Error al eliminar el certificado en Firebase.");
      }
    }
  };

  const getAbsencesForWorker = (workerId: string) => {
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const today = now.getDate();
    
    const workedDates = new Set(
      logs
        .filter(l => l.workerId === workerId && l.type === LogType.ENTRADA)
        .map(l => l.dateStr)
    );
    
    const absences: { dateStr: string; weekday: string }[] = [];
    
    for (let day = 1; day <= today; day++) {
      const dateObj = new Date(year, month, day);
      const dayOfWeek = dateObj.getDay();
      
      if (dayOfWeek === 0) continue; // Excluir domingos
      
      const formattedDate = dateObj.toLocaleDateString('es-ES');
      
      if (!workedDates.has(formattedDate)) {
        const weekdayName = dateObj.toLocaleDateString('es-ES', { weekday: 'long' });
        absences.push({
          dateStr: formattedDate,
          weekday: weekdayName.charAt(0).toUpperCase() + weekdayName.slice(1)
        });
      }
    }
    
    return absences.reverse();
  };

  const handleRemoveLogo = () => setConfig({ ...config, logoUrl: '' });
  const handleRemoveFavicon = () => setConfig({ ...config, faviconUrl: '' });

  const handleSaveConfig = async () => {
    setIsSaving(true);
    try { 
      await StorageService.saveConfig(config); 
      setShowSaveSuccess(true); 
      setTimeout(() => setShowSaveSuccess(false), 3000); 
    }
    catch (e) { alert("Error al guardar la configuración"); }
    finally { setIsSaving(false); }
  };

  const handleExportPDF = () => {
    const doc = new jsPDF();
    doc.setFontSize(16);
    doc.text("Reporte General de Actividad - CARMAGNE INSTAL SL", 14, 15);
    const tableData = filteredLogs.map(l => [l.dateStr, l.timeStr, l.workerName, l.siteName, l.type, l.workMode || 'HORAS', l.workReport || '-']);
    autoTable(doc, { head: [['Fecha', 'Hora', 'Trabajador', 'Obra', 'Tipo', 'Modo', 'Reporte']], body: tableData, startY: 25, styles: { fontSize: 7 } });
    doc.save(`reporte_carmagne_${new Date().getTime()}.pdf`);
  };

  const handleGenerateWorkerReport = () => {
    if (!reportModal.worker) return;
    const worker = reportModal.worker;
    const doc = new jsPDF();
    doc.setFontSize(18); doc.text(`Informe: ${worker.name}`, 14, 20);
    let filteredReportLogs = logs.filter(l => l.workerId === worker.id);
    if (reportModal.type === 'WEEK') {
      const pickedDate = new Date(reportModal.selectedDate);
      const day = pickedDate.getDay(); const diffToMonday = pickedDate.getDate() - day + (day === 0 ? -6 : 1);
      const startOfWeek = new Date(pickedDate); startOfWeek.setDate(diffToMonday); startOfWeek.setHours(0, 0, 0, 0);
      const endOfWeek = new Date(startOfWeek); endOfWeek.setDate(startOfWeek.getDate() + 6); endOfWeek.setHours(23, 59, 59, 999);
      filteredReportLogs = filteredReportLogs.filter(l => l.timestamp >= startOfWeek.getTime() && l.timestamp <= endOfWeek.getTime());
    } else {
      filteredReportLogs = filteredReportLogs.filter(l => {
        const logDate = new Date(l.timestamp);
        return logDate.getMonth() === reportModal.selectedMonth && logDate.getFullYear() === new Date().getFullYear();
      });
    }
    const { totalWork, totalBreak } = calculateTotalsFromLogs(filteredReportLogs);
    doc.text(`TRABAJO NETO: ${formatMsToTime(totalWork)} | DESCANSOS: ${formatMsToTime(totalBreak)}`, 14, 30);
    const tableData = filteredReportLogs.map(l => [l.dateStr, l.timeStr, l.siteName, l.type, l.workMode || 'HORAS', l.workReport || '-']);
    autoTable(doc, { head: [['Fecha', 'Hora', 'Obra', 'Acción', 'Modo', 'Tarea']], body: tableData, startY: 40, styles: { fontSize: 8 } });
    doc.save(`Reporte_${worker.name}_Carmagne.pdf`);
    setReportModal({ ...reportModal, isOpen: false });
  };

  const handleOpenSiteModal = (site?: Site) => {
    if (site) {
      setEditingSite(site);
      setSiteForm({ name: site.name, address: site.address, active: site.active, lat: site.coordinates?.latitude.toString() || '', lng: site.coordinates?.longitude.toString() || '' });
    } else {
      setEditingSite(null);
      setSiteForm({ name: '', address: '', active: true, lat: '', lng: '' });
    }
    setIsSiteModalOpen(true);
  };

  const handleSaveSite = async () => {
    if (!siteForm.name || !siteForm.address) return;
    const siteData: Site = { id: editingSite ? editingSite.id : `S-${Date.now()}`, name: siteForm.name, address: siteForm.address, active: siteForm.active, coordinates: (siteForm.lat && siteForm.lng) ? { latitude: parseFloat(siteForm.lat), longitude: parseFloat(siteForm.lng) } : editingSite?.coordinates };
    if (editingSite) await StorageService.updateSite(siteData);
    else { const currentSites = StorageService.getSites(); await StorageService.saveSites([...currentSites, siteData]); }
    setIsSiteModalOpen(false);
  };

  const handleOpenToolModal = (tool?: ToolRecord) => {
    setToolModalError('');
    if (tool) {
      setEditingTool(tool);
      setToolForm({ toolName: tool.toolName, brand: tool.brand, model: tool.model, workerId: tool.workerId, siteId: tool.siteId || '' });
    } else {
      setEditingTool(null);
      setToolForm({ toolName: '', brand: '', model: '', workerId: '', siteId: '' });
    }
    setIsToolModalOpen(true);
  };

  const handleSaveTool = async () => {
    if (!toolForm.toolName.trim() || !toolForm.workerId) { setToolModalError('Nombre y responsable obligatorios.'); return; }
    const worker = workers.find(w => w.id === toolForm.workerId);
    const site = sites.find(s => s.id === toolForm.siteId);
    if (!worker) return;
    const toolData: ToolRecord = { 
      id: editingTool ? editingTool.id : `T-${Date.now()}`, 
      workerId: worker.id, 
      workerName: worker.name, 
      toolName: toolForm.toolName.trim(), 
      brand: toolForm.brand, 
      model: toolForm.model, 
      timestamp: Date.now(), 
      dateStr: new Date().toLocaleDateString('es-ES'), 
      timeStr: new Date().toLocaleTimeString('es-ES'),
      siteId: site?.id,
      siteName: site?.name
    };
    await StorageService.addTool(toolData); setIsToolModalOpen(false);
  };

  const handleDeleteLog = async () => {
    if (logToDelete) {
      await StorageService.deleteLog(logToDelete);
      setLogToDelete(null);
    }
  };

  const handleClearAllLogs = async () => {
    await StorageService.clearAllLogs();
    setIsClearLogsConfirmOpen(false);
  };

  const filteredWorkers = workers.filter(w => w.name.toLowerCase().includes(workerSearchQuery.toLowerCase()));
  const filteredSites = sites.filter(s => s.name.toLowerCase().includes(siteSearchQuery.toLowerCase()));
  
  const filteredTools = useMemo(() => {
    return tools.filter(t => {
      const matchesSearch = t.toolName.toLowerCase().includes(toolSearchQuery.toLowerCase()) || t.brand.toLowerCase().includes(toolSearchQuery.toLowerCase());
      const matchesWorker = !toolFilterWorker || t.workerId === toolFilterWorker;
      const matchesSite = !toolFilterSite || t.siteId === toolFilterSite;
      return matchesSearch && matchesWorker && matchesSite;
    });
  }, [tools, toolSearchQuery, toolFilterWorker, toolFilterSite]);

  const filteredLogs = useMemo(() => {
    return logs.filter(log => {
      const matchesSearch = !logSearchQuery || log.workerName.toLowerCase().includes(logSearchQuery.toLowerCase()) || log.siteName.toLowerCase().includes(logSearchQuery.toLowerCase());
      const matchesWorker = !logFilterWorker || log.workerId === logFilterWorker;
      const matchesSite = !logFilterSite || log.siteId === logFilterSite;
      const matchesType = !logFilterType || log.type === logFilterType;
      let matchesDate = true; if (logFilterDate) { const d = new Date(logFilterDate).toLocaleDateString('es-ES'); matchesDate = log.dateStr === d; }
      return matchesSearch && matchesWorker && matchesSite && matchesType && matchesDate;
    });
  }, [logs, logSearchQuery, logFilterWorker, logFilterSite, logFilterType, logFilterDate]);

  const sidebarItems = useMemo(() => {
    const baseItems = [
      { id: 'dashboard', icon: BarChart3, label: 'Panel' },
      { id: 'workers', icon: Users, label: 'Personal' },
      { id: 'hours', icon: History, label: 'Horas' },
      { id: 'reports', icon: ClipboardList, label: 'Partes' },
      { id: 'payslips', icon: FileText, label: 'Nóminas' },
      { id: 'chat', icon: MessageSquare, label: 'Chat' },
      { id: 'sites', icon: MapPin, label: 'Obras' },
      { id: 'logs', icon: ClipboardList, label: 'Registros' },
      { id: 'tools', icon: Wrench, label: 'Equipos' },
    ];
    if (isSuperAdmin) { baseItems.push({ id: 'admins', icon: Shield, label: 'Admins' }, { id: 'settings', icon: Settings, label: 'Ajustes' }); }
    return baseItems;
  }, [isSuperAdmin]);

  const renderDashboard = () => (
    <div className="space-y-6 animate-fadeIn pb-32">
      {/* Metrics Row */}
      <div className="grid grid-cols-2 md:grid-cols-3 gap-4">
        <div className="bg-[var(--panel-bg)] p-6 rounded-[2rem] border border-[var(--panel-border)] shadow-xl">
          <Users className="text-blue-500 mb-2" size={32} />
          <h4 className="text-2xl font-black text-[var(--text-main)]">{workers.length}</h4>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase">Personal</p>
        </div>
        <div className="bg-[var(--panel-bg)] p-6 rounded-[2rem] border border-[var(--panel-border)] shadow-xl">
          <MapPin className="text-emerald-500 mb-2" size={32} />
          <h4 className="text-2xl font-black text-[var(--text-main)]">{sites.length}</h4>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase">Obras</p>
        </div>
        <div className="col-span-2 md:col-span-1 bg-[var(--panel-bg)] p-6 rounded-[2rem] border border-[var(--panel-border)] shadow-xl">
          <Zap className="text-amber-500 mb-2" size={32} />
          <h4 className="text-2xl font-black text-[var(--text-main)]">{logs.filter(l => l.dateStr === new Date().toLocaleDateString('es-ES')).length}</h4>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase">Fichajes Hoy</p>
        </div>
      </div>

      {/* Google Account Linking / Workspace Card */}
      <div className="bg-[var(--panel-bg)] p-8 rounded-[2rem] border border-[var(--panel-border)] shadow-xl relative overflow-hidden">
        {/* Decorative background glow */}
        <div className="absolute -right-16 -bottom-16 w-48 h-48 bg-[#CCFF00]/5 rounded-full blur-3xl pointer-events-none"></div>
        <div className="absolute -left-16 -top-16 w-48 h-48 bg-blue-500/5 rounded-full blur-3xl pointer-events-none"></div>

        <div className="relative z-10 flex flex-col md:flex-row md:items-center justify-between gap-6">
          <div className="space-y-2 max-w-xl">
            <div className="flex items-center gap-2">
              <span className={`px-2.5 py-1 rounded-full text-[8px] font-black tracking-wider uppercase font-sans border ${theme === 'dark' ? 'bg-[#CCFF00]/10 border-[#CCFF00]/20 text-[#CCFF00]' : 'bg-emerald-50 border-emerald-200 text-emerald-800'}`}>
                Google Workspace
              </span>
              <span className="w-1.5 h-1.5 rounded-full bg-blue-500 animate-pulse"></span>
            </div>
            <h3 className="text-xl font-black text-[var(--text-main)] tracking-wider uppercase font-sans flex items-center gap-2" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
              <Shield className={theme === 'dark' ? 'text-[#CCFF00]' : 'text-emerald-600'} size={20} /> VINCULACIÓN DE CUENTA DE GOOGLE
            </h3>
            <p className="text-[11px] text-[var(--text-muted)] font-medium leading-relaxed font-sans">
              Vincula tu cuenta de Google para exportar y sincronizar automáticamente toda la base de datos de operarios, fichajes y obras en tiempo real a Google Sheets, además de habilitar el envío oficial de nóminas y certificados vía Gmail.
            </p>
          </div>

          <div className="shrink-0">
            {googleUser ? (
              <div className={`flex items-center gap-3 p-3 rounded-2xl border ${theme === 'dark' ? 'bg-zinc-950/80 border-zinc-800' : 'bg-white border-zinc-200 shadow-sm'}`}>
                {googleUser.photoURL ? (
                  <img src={googleUser.photoURL} alt={googleUser.displayName} className={`w-9 h-9 rounded-xl border ${theme === 'dark' ? 'border-[#CCFF00]/20' : 'border-zinc-200'}`} referrerPolicy="no-referrer" />
                ) : (
                  <div className={`w-9 h-9 rounded-xl flex items-center justify-center font-black border ${theme === 'dark' ? 'bg-blue-500/10 text-[#CCFF00] border-[#CCFF00]/10' : 'bg-blue-50 text-blue-600 border-blue-100'}`}>
                    {googleUser.displayName?.charAt(0) || 'G'}
                  </div>
                )}
                <div>
                  <h4 className="text-xs font-black text-[var(--text-main)] leading-tight">{googleUser.displayName}</h4>
                  <p className="text-[9px] text-[var(--text-muted)] font-medium font-mono">{googleUser.email}</p>
                </div>
                <button onClick={handleGoogleSignOut} className={`ml-2 p-2 text-[10px] font-black tracking-widest uppercase font-sans rounded-xl transition-all ${theme === 'dark' ? 'text-rose-500 hover:text-rose-400 hover:bg-rose-500/10' : 'text-rose-600 hover:text-rose-700 hover:bg-rose-50'}`}>
                  Salir
                </button>
              </div>
            ) : (
              <button
                onClick={handleGoogleSignInForGmail}
                className={`w-full md:w-auto font-black py-3.5 px-6 rounded-xl uppercase text-[10px] tracking-wider transition-all duration-300 shadow-lg active:scale-95 flex items-center justify-center gap-2.5 font-sans border ${theme === 'dark' ? 'bg-transparent border-[#CCFF00]/50 hover:bg-[#CCFF00] hover:text-black text-[#CCFF00]' : 'bg-[#CCFF00] border-[#b8e600] text-black hover:bg-[#b8e600]'}`}
              >
                <KeyRound size={14} /> VINCULAR CUENTA GOOGLE
              </button>
            )}
          </div>
        </div>

        {googleUser && (
          <div className="mt-8 pt-6 border-t border-[var(--panel-border)] grid grid-cols-1 md:grid-cols-2 gap-6 relative z-10">
            {/* Sheets Sync Box */}
            <div className={`p-5 rounded-2xl border space-y-4 ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/60' : 'bg-white border-zinc-200/80 shadow-sm'}`}>
              <div className="flex items-center justify-between">
                <h4 className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider flex items-center gap-2">
                  <FileText className={theme === 'dark' ? 'text-[#CCFF00]' : 'text-emerald-600'} size={16} /> Sincronización Google Sheets
                </h4>
                {config.googleSheetUrl ? (
                  <span className="px-2 py-0.5 bg-emerald-500/10 border border-emerald-500/20 text-emerald-400 text-[8px] font-black rounded-lg uppercase">
                    Vinculada
                  </span>
                ) : (
                  <span className="px-2 py-0.5 bg-zinc-800 text-zinc-500 text-[8px] font-black rounded-lg uppercase">
                    Sin Vincular
                  </span>
                )}
              </div>

              {config.googleSheetUrl && (
                <div className="space-y-1.5">
                  <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Enlace de la Hoja:</p>
                  <a href={config.googleSheetUrl} target="_blank" rel="noopener noreferrer" className={`text-[10px] hover:underline flex items-center gap-1 font-mono truncate max-w-full ${theme === 'dark' ? 'text-blue-400' : 'text-blue-600'}`}>
                    {config.googleSheetUrl} <ExternalLink size={10} className="shrink-0" />
                  </a>
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-2 pt-1">
                <button
                  disabled={isSyncingSheets}
                  onClick={handleSyncGoogleSheets}
                  className="flex-1 bg-[#CCFF00] hover:bg-[#b8e600] disabled:opacity-50 text-black text-[10px] font-black tracking-widest py-3 px-4 rounded-xl uppercase transition-all duration-300 flex items-center justify-center gap-2 shadow-lg shadow-[#CCFF00]/5"
                >
                  <RefreshCw size={12} className={isSyncingSheets ? 'animate-spin' : ''} />
                  {isSyncingSheets ? 'SINCRONIZANDO...' : config.googleSheetUrl ? 'SINCRONIZAR DATOS' : 'CREAR HOJA EN DRIVE'}
                </button>
              </div>

              {syncMessage && (
                <p className={`text-[9px] font-black uppercase tracking-widest py-2 px-3 rounded-lg text-center animate-fadeIn animate-pulse ${theme === 'dark' ? 'text-[#CCFF00] bg-[#CCFF00]/10 border border-[#CCFF00]/20' : 'text-emerald-800 bg-emerald-50 border border-emerald-100'}`}>
                  {syncMessage}
                </p>
              )}
            </div>

            {/* Gmail Verification Box */}
            <div className={`p-5 rounded-2xl border space-y-4 flex flex-col justify-between ${theme === 'dark' ? 'bg-zinc-950/40 border-zinc-800/60' : 'bg-white border-zinc-200/80 shadow-sm'}`}>
              <div className="space-y-3">
                <h4 className="text-xs font-black text-[var(--text-main)] uppercase tracking-wider flex items-center gap-2">
                  <Mail className={theme === 'dark' ? 'text-blue-400' : 'text-blue-600'} size={16} /> Estado del Servicio Gmail
                </h4>
                <p className="text-[10px] text-[var(--text-muted)] leading-relaxed font-sans">
                  La integración de Gmail te permite enviar notificaciones oficiales, nóminas mensuales firmadas digitalmente y certificados técnicos del personal directamente desde tu correo corporativo o personal.
                </p>
              </div>

              <div className="pt-2">
                <button
                  onClick={handleSendTestGmail}
                  className={`w-full text-[10px] font-black tracking-widest py-3 px-4 rounded-xl uppercase transition-all border flex items-center justify-center gap-2 ${theme === 'dark' ? 'bg-zinc-900 hover:bg-zinc-800 text-white border-zinc-800' : 'bg-zinc-100 hover:bg-zinc-200 text-zinc-800 border-zinc-300'}`}
                >
                  <Send size={12} /> ENVIAR CORREO DE PRUEBA
                </button>
              </div>
            </div>
          </div>
        )}
      </div>
    </div>
  );

  const renderHoursReport = () => (
    <div className="space-y-4 animate-fadeIn pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase">Reporte de Horas</h2>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Cálculo de tiempos por jornada</p>
        </div>
        <div className="flex flex-col sm:flex-row gap-2">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
            <input type="text" placeholder="Buscar operario..." className="bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-xl py-2.5 pl-9 pr-4 text-xs text-[var(--text-main)] outline-none w-full sm:w-48" value={hoursSearchQuery} onChange={(e) => setHoursSearchQuery(e.target.value)} />
          </div>
          <input type="date" className="bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-xl py-2.5 px-3 text-xs text-[var(--text-main)] [color-scheme:dark]" value={hoursFilterDate} onChange={(e) => setHoursFilterDate(e.target.value)} />
        </div>
      </div>

      <div className="grid gap-3">
        {dailyHoursStats.length > 0 ? (
          dailyHoursStats.map(stat => (
            <div key={stat.key} className="bg-[var(--panel-bg)] p-4 rounded-3xl border border-[var(--panel-border)] flex flex-col sm:flex-row sm:items-center justify-between gap-4">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-2xl bg-blue-500/10 text-blue-500 flex items-center justify-center">
                  <Users size={18} />
                </div>
                <div>
                  <p className="font-black text-[var(--text-main)] text-sm uppercase leading-tight">{stat.workerName}</p>
                  <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase tracking-widest">{stat.dateStr}</p>
                </div>
              </div>
              
              <div className="grid grid-cols-3 gap-2 sm:gap-6">
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-emerald-500 uppercase tracking-widest">Trabajo</span>
                  <span className="text-xs font-mono font-black text-emerald-600 dark:text-emerald-400">{formatMsToTime(stat.workMs)}</span>
                </div>
                <div className="flex flex-col border-x border-[var(--panel-border)] px-2 sm:px-6">
                  <span className="text-[8px] font-black text-amber-500 uppercase tracking-widest">Descanso</span>
                  <span className="text-xs font-mono font-black text-amber-600 dark:text-amber-400">{formatMsToTime(stat.breakMs)}</span>
                </div>
                <div className="flex flex-col">
                  <span className="text-[8px] font-black text-blue-400 uppercase tracking-widest">Total</span>
                  <span className="text-xs font-mono font-black text-blue-600 dark:text-blue-400">{formatMsToTime(stat.totalMs)}</span>
                </div>
              </div>

              {stat.isCurrentlyActive && (
                <div className="flex items-center gap-1.5 px-3 py-1 bg-blue-500/10 border border-blue-500/20 rounded-full shrink-0">
                  <div className="w-1.5 h-1.5 bg-blue-500 rounded-full animate-pulse" />
                  <span className="text-[8px] font-black text-blue-500 uppercase tracking-widest">Activo</span>
                </div>
              )}
            </div>
          ))
        ) : (
          <div className="text-center py-20 bg-[var(--panel-bg)]/30 rounded-[3rem] border border-dashed border-[var(--panel-border)]">
            <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-widest">No hay registros para este día</p>
          </div>
        )}
      </div>
    </div>
  );

  const renderLogs = () => (
    <div className="space-y-4 animate-fadeIn pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase">Registros de Actividad</h2>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Historial completo con verificación GPS</p>
        </div>
        <div className="flex gap-2">
          {isSuperAdmin && (
            <button onClick={() => setIsClearLogsConfirmOpen(true)} className="bg-rose-600/10 border border-rose-500/30 text-rose-500 px-4 py-2 rounded-xl text-[10px] font-black uppercase tracking-widest flex items-center gap-2 hover:bg-rose-600 hover:text-white transition-all">
              <RotateCcw size={14} /> Vaciar Historial
            </button>
          )}
          <button onClick={() => setShowLogFilters(!showLogFilters)} className={`p-3 rounded-xl transition ${showLogFilters ? 'bg-blue-600 text-white' : 'bg-[var(--panel-bg)] text-[var(--text-muted)]'}`}>
            <ListFilter size={20} />
          </button>
          <button onClick={handleExportPDF} className="bg-emerald-600 p-3 rounded-xl text-white">
            <Download size={20} />
          </button>
        </div>
      </div>

      {showLogFilters && (
        <div className="bg-[var(--panel-bg)] p-6 rounded-3xl border border-[var(--panel-border)] grid grid-cols-1 sm:grid-cols-2 md:grid-cols-4 gap-4 animate-slideDown">
          <div className="space-y-1.5">
            <label className="text-[8px] font-black text-[var(--text-muted)] uppercase ml-1">Buscar</label>
            <input type="text" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none" value={logSearchQuery} onChange={(e) => setLogSearchQuery(e.target.value)} placeholder="Operario o obra..." />
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] font-black text-[var(--text-muted)] uppercase ml-1">Operario</label>
            <select className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none" value={logFilterWorker} onChange={(e) => setLogFilterWorker(e.target.value)}>
              <option value="">Todos</option>
              {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] font-black text-[var(--text-muted)] uppercase ml-1">Obra</label>
            <select className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none" value={logFilterSite} onChange={(e) => setLogFilterSite(e.target.value)}>
              <option value="">Todas</option>
              {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
            </select>
          </div>
          <div className="space-y-1.5">
            <label className="text-[8px] font-black text-[var(--text-muted)] uppercase ml-1">Fecha</label>
            <input type="date" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] [color-scheme:dark] outline-none" value={logFilterDate} onChange={(e) => setLogFilterDate(e.target.value)} />
          </div>
        </div>
      )}

      <div className="overflow-x-auto bg-[var(--panel-bg)] rounded-3xl border border-[var(--panel-border)]">
        <table className="w-full text-left text-xs">
          <thead className="bg-[var(--input-bg)] border-b border-[var(--panel-border)]">
            <tr>
              <th className="p-4 font-black uppercase text-[var(--text-muted)]">Fecha/Hora</th>
              <th className="p-4 font-black uppercase text-[var(--text-muted)]">Operario</th>
              <th className="p-4 font-black uppercase text-[var(--text-muted)]">Obra</th>
              <th className="p-4 font-black uppercase text-[var(--text-muted)]">Tipo</th>
              <th className="p-4 font-black uppercase text-[var(--text-muted)]">Reporte</th>
              <th className="p-4 font-black uppercase text-[var(--text-muted)]">Ubicación GPS</th>
              {isSuperAdmin && <th className="p-4 font-black uppercase text-[var(--text-muted)] text-right">Acciones</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-[var(--panel-border)]">
            {filteredLogs.map(log => (
              <tr key={log.id} className="hover:bg-[var(--btn-glass-bg)]/50 transition">
                <td className="p-4">
                  <div className="font-bold text-[var(--text-main)]">{log.dateStr}</div>
                  <div className="text-[10px] text-[var(--text-muted)]">{log.timeStr}</div>
                </td>
                <td className="p-4 font-bold text-[var(--text-main)] uppercase">{log.workerName}</td>
                <td className="p-4 font-bold text-blue-400 uppercase">{log.siteName}</td>
                <td className="p-4">
                  <div className="flex items-center gap-2">
                    <LogIcon type={log.type} size={14} />
                    <span className="font-black uppercase tracking-tighter">{log.type}</span>
                  </div>
                </td>
                <td className="p-4">
                  <p className="max-w-[150px] truncate text-[var(--text-muted)]">{log.workReport || '-'}</p>
                </td>
                <td className="p-4">
                   <div className="flex flex-col gap-1.5">
                      {log.locationWarning ? (
                        <div className="text-rose-500 flex items-center gap-1">
                          <AlertTriangle size={14} />
                          <span className="font-black text-[9px] uppercase tracking-widest">Lejos ({log.distanceMeters}m)</span>
                        </div>
                      ) : (
                        <div className="text-emerald-500 flex items-center gap-1">
                          <CheckCircle2 size={14} />
                          <span className="font-black text-[9px] uppercase tracking-widest">OK (En Obra)</span>
                        </div>
                      )}
                      <a 
                        href={`https://www.google.com/maps?q=${log.location.latitude},${log.location.longitude}`} 
                        target="_blank" 
                        rel="noopener noreferrer"
                        className="flex items-center gap-1 text-blue-400 hover:text-blue-300 transition-colors group"
                      >
                         <MapIcon size={12} className="group-hover:scale-110 transition-transform" />
                         <span className="font-bold text-[8px] uppercase tracking-widest border-b border-blue-400/30">Ver en Mapa</span>
                         <ExternalLink size={10} className="opacity-50" />
                      </a>
                   </div>
                </td>
                {isSuperAdmin && (
                  <td className="p-4 text-right">
                    <button 
                      onClick={() => setLogToDelete(log.id)}
                      className="p-2 text-rose-500/50 hover:text-rose-500 transition-colors"
                    >
                      <Trash2 size={16} />
                    </button>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );

  const renderTools = () => (
    <div className="space-y-4 animate-fadeIn pb-32">
      <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
        <div>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase">Inventario de Equipos</h2>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Gestión de herramientas por operario</p>
        </div>
        <button onClick={() => handleOpenToolModal()} className="bg-amber-600 p-3 rounded-xl text-white self-end md:self-auto">
          <Plus size={20} />
        </button>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 gap-3">
        <div className="relative">
          <Search className="absolute left-3 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" size={14} />
          <input type="text" placeholder="Buscar herramienta o marca..." className="w-full bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-xl py-2.5 pl-9 pr-4 text-xs text-[var(--text-main)] outline-none" value={toolSearchQuery} onChange={(e) => setToolSearchQuery(e.target.value)} />
        </div>
        <select className="bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-xl py-2.5 px-3 text-xs text-[var(--text-main)] outline-none" value={toolFilterWorker} onChange={(e) => setToolFilterWorker(e.target.value)}>
          <option value="">Responsables...</option>
          {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
        </select>
        <select className="bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-xl py-2.5 px-3 text-xs text-[var(--text-main)] outline-none" value={toolFilterSite} onChange={(e) => setToolFilterSite(e.target.value)}>
          <option value="">Obras...</option>
          {sites.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
        </select>
      </div>

      <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
        {filteredTools.length > 0 ? (
          filteredTools.map(tool => (
            <div key={tool.id} className="bg-[var(--panel-bg)] p-5 rounded-[2rem] border border-[var(--panel-border)] flex flex-col justify-between group hover:border-amber-500/50 transition-colors shadow-xl">
              <div className="flex justify-between items-start mb-4">
                <div className="p-3 bg-amber-500/10 text-amber-500 rounded-2xl">
                  <Wrench size={24} />
                </div>
                <div className="flex gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                  <button onClick={() => handleOpenToolModal(tool)} className="p-2 text-[var(--text-muted)] hover:text-white transition"><Pencil size={18} /></button>
                  <button onClick={() => StorageService.deleteTool(tool.id)} className="p-2 text-rose-500 hover:text-rose-400 transition"><Trash2 size={18} /></button>
                </div>
              </div>
              
              <div className="space-y-1 mb-4">
                <h3 className="font-black text-[var(--text-main)] text-base uppercase leading-tight truncate">{tool.toolName}</h3>
                <p className="text-[10px] text-amber-500 font-bold uppercase tracking-widest">{tool.brand} {tool.model}</p>
              </div>

              <div className="space-y-3 pt-4 border-t border-[var(--panel-border)]">
                <div className="flex items-center gap-3">
                  <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400"><Users size={14} /></div>
                  <div>
                    <p className="text-[8px] text-[var(--text-muted)] font-black uppercase tracking-widest">Operario</p>
                    <p className="text-[11px] font-bold text-[var(--text-main)] uppercase">{tool.workerName}</p>
                  </div>
                </div>
                {tool.siteName && (
                  <div className="flex items-center gap-3">
                    <div className="w-8 h-8 rounded-lg bg-amber-500/10 flex items-center justify-center text-amber-600 dark:text-amber-400"><MapPin size={14} /></div>
                    <div>
                      <p className="text-[8px] text-[var(--text-muted)] font-black uppercase tracking-widest">Obra</p>
                      <p className="text-[11px] font-bold text-[var(--text-main)] uppercase truncate max-w-[150px]">{tool.siteName}</p>
                    </div>
                  </div>
                )}
              </div>
            </div>
          ))
        ) : (
          <div className="col-span-full text-center py-20 bg-[var(--panel-bg)]/30 rounded-[3rem] border border-dashed border-[var(--panel-border)]">
            <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-widest">No hay herramientas registradas</p>
          </div>
        )}
      </div>
    </div>
  );

  const handleApproveReport = async (report: WeeklyReport) => {
    const updated = { ...report, status: 'APPROVED' as const };
    await StorageService.updateReport(updated);
    setSelectedReport(null);
    const msg = `✅ <b>Parte Semanal Aprobado</b>\n👷‍♂️ Operario: <b>${report.workerName}</b>\n📅 Período: ${report.dateStr}\n📊 Horas: ${report.extractedHours || 0}h\n💰 Total: ${report.extractedTotal || '-'}`;
    TelegramService.enviarNotificacionTelegram(msg);
  };

  const handleRejectReport = async (report: WeeklyReport) => {
    if (!rejectionReasonInput.trim()) {
      alert("Por favor introduce un motivo de rechazo.");
      return;
    }
    const updated = { ...report, status: 'REJECTED' as const, rejectionReason: rejectionReasonInput };
    await StorageService.updateReport(updated);
    setSelectedReport(null);
    setRejectionReasonInput('');
    setShowRejectionInput(false);
    const msg = `❌ <b>Parte Semanal Rechazado</b>\n👷‍♂️ Operario: <b>${report.workerName}</b>\n📅 Período: ${report.dateStr}\n⚠️ Motivo: ${rejectionReasonInput}`;
    TelegramService.enviarNotificacionTelegram(msg);
  };

  const handleGenerateAndSendPayslip = async () => {
    if (!payslipForm.workerId) {
      alert("Por favor selecciona un operario.");
      return;
    }
    const worker = workers.find(w => w.id === payslipForm.workerId);
    if (!worker) return;

    const monthStr = payslipForm.monthStr || new Date().toISOString().substring(0, 7);
    const title = payslipForm.title || `Nómina ${monthStr}`;

    let pdfDataUri = '';
    let baseSalary = 0;
    let extraHours = 0;
    let extraHoursPay = 0;
    let deductions = 0;
    let totalPay = 0;

    if (payslipMode === 'upload') {
      if (!uploadedPdfBase64) {
        alert("Por favor selecciona o arrastra un archivo PDF de nómina.");
        return;
      }
      pdfDataUri = uploadedPdfBase64;
      totalPay = Number(uploadedTotalPay) || 0;
      baseSalary = totalPay;
    } else {
      baseSalary = Number(payslipForm.baseSalary) || 0;
      extraHours = Number(payslipForm.extraHours) || 0;
      extraHoursPay = Number(payslipForm.extraHoursPay) || 0;
      deductions = Number(payslipForm.deductions) || 0;
      totalPay = baseSalary + (extraHours * extraHoursPay) - deductions;

      const pdf = new jsPDF();
      
      pdf.setFillColor(15, 23, 42);
      pdf.rect(0, 0, 210, 40, 'F');
      
      pdf.setTextColor(204, 255, 0);
      pdf.setFontSize(22);
      pdf.setFont("helvetica", "bold");
      pdf.text("CARMAGNE INSTAL SL", 15, 25);
      
      pdf.setTextColor(255, 255, 255);
      pdf.setFontSize(10);
      pdf.text("SISTEMA DE GESTIÓN Y NÓMINAS PROFESIONAL", 15, 33);
      
      pdf.setTextColor(15, 23, 42);
      pdf.setFontSize(14);
      pdf.text("NÓMINA DE TRABAJADOR", 15, 55);
      
      pdf.setFontSize(10);
      pdf.text(`Fecha Emisión: ${new Date().toLocaleDateString('es-ES')}`, 15, 62);
      pdf.text(`Período Liquidación: ${monthStr}`, 15, 68);
      
      pdf.setFillColor(248, 250, 252);
      pdf.roundedRect(14, 75, 182, 35, 2, 2, 'F');
      pdf.setTextColor(15, 23, 42);
      pdf.setFont("helvetica", "bold");
      pdf.text("DATOS DEL OPERARIO:", 20, 83);
      pdf.setFont("helvetica", "normal");
      pdf.text(`Nombre completo: ${worker.name}`, 20, 90);
      pdf.text(`DNI / NIE: ${worker.dni || 'No registrado'}`, 20, 97);
      pdf.text(`Teléfono: ${worker.phone || 'No registrado'}`, 20, 104);
      
      const tableRows = [
        ["Concepto Salarial", "Cálculo / Unidad", "Importe Bruto", "Deducciones"],
        ["Salario Base Mensual", "Mes completo", `${baseSalary.toFixed(2)}€`, ""],
        ["Horas Extraordinarias", `${extraHours} horas a ${extraHoursPay}€/h`, `${(extraHours * extraHoursPay).toFixed(2)}€`, ""],
        ["Deducciones / IRPF / SS", "Retención general", "", `${deductions.toFixed(2)}€`],
        ["LÍQUIDO TOTAL A PERCIBIR", "", `${totalPay.toFixed(2)}€`, ""]
      ];

      autoTable(pdf, {
        startY: 120,
        head: [tableRows[0]],
        body: tableRows.slice(1),
        headStyles: { fillColor: [15, 23, 42], textColor: [204, 255, 0], fontStyle: 'bold' },
        styles: { fontSize: 9 },
        theme: 'grid'
      });
      
      pdf.setFontSize(10);
      pdf.text("Firma de la Empresa:", 20, 220);
      pdf.text("Firma del Trabajador / Conforme:", 120, 220);
      
      pdfDataUri = pdf.output('datauristring');
    }

    const newPayslip: Payslip = {
      id: `PAY-${Date.now()}`,
      workerId: worker.id,
      workerName: worker.name,
      monthStr,
      title,
      baseSalary,
      extraHours,
      extraHoursPay,
      deductions,
      totalPay,
      sentTimestamp: Date.now(),
      status: 'SENT',
      pdfBase64: pdfDataUri
    };

    await StorageService.addPayslip(newPayslip);
    
    let telegramMsg = '';
    if (payslipMode === 'upload') {
      telegramMsg = `👷‍♂️ <b>Nómina enviada (PDF Subido)</b>\n\n👤 Operario: <b>${worker.name}</b>\n📅 Período: <b>${monthStr}</b>\n💰 <b>Total Neto Recibido: ${totalPay.toFixed(2)}€</b>`;
    } else {
      telegramMsg = `👷‍♂️ <b>Nómina enviada con éxito</b>\n\n👤 Operario: <b>${worker.name}</b>\n📅 Período: <b>${monthStr}</b>\n💸 Salario Base: ${baseSalary}€\n⚡ Horas Extra: ${extraHours} (a ${extraHoursPay}€/h)\n📉 Deducciones: ${deductions}€\n💰 <b>Total Neto Recibido: ${totalPay.toFixed(2)}€</b>`;
    }
    TelegramService.enviarNotificacionTelegram(telegramMsg);

    alert(`Nómina enviada con éxito a ${worker.name}`);
    
    setPayslipForm({
      workerId: '',
      monthStr: new Date().toISOString().substring(0, 7),
      baseSalary: 1200,
      extraHours: 0,
      extraHoursPay: 15,
      deductions: 0,
      title: ''
    });
    setUploadedPdfBase64('');
    setUploadedPdfName('');
    setUploadedTotalPay(1200);
  };

  const renderReports = () => {
    const handleImageMouseDown = (e: React.MouseEvent) => {
      if (zoomLevel <= 1) return;
      setIsDragging(true);
      dragStartRef.current = { x: e.clientX - panOffset.x, y: e.clientY - panOffset.y };
    };

    const handleImageMouseMove = (e: React.MouseEvent) => {
      if (!isDragging) return;
      const newX = e.clientX - dragStartRef.current.x;
      const newY = e.clientY - dragStartRef.current.y;
      const maxPan = (zoomLevel - 1) * 200;
      setPanOffset({
        x: Math.max(-maxPan, Math.min(maxPan, newX)),
        y: Math.max(-maxPan, Math.min(maxPan, newY))
      });
    };

    const handleImageMouseUpOrLeave = () => {
      setIsDragging(false);
    };

    const handleImageTouchStart = (e: React.TouchEvent) => {
      if (zoomLevel <= 1 || e.touches.length !== 1) return;
      setIsDragging(true);
      const touch = e.touches[0];
      dragStartRef.current = { x: touch.clientX - panOffset.x, y: touch.clientY - panOffset.y };
    };

    const handleImageTouchMove = (e: React.TouchEvent) => {
      if (!isDragging || e.touches.length !== 1) return;
      const touch = e.touches[0];
      const newX = touch.clientX - dragStartRef.current.x;
      const newY = touch.clientY - dragStartRef.current.y;
      const maxPan = (zoomLevel - 1) * 200;
      setPanOffset({
        x: Math.max(-maxPan, Math.min(maxPan, newX)),
        y: Math.max(-maxPan, Math.min(maxPan, newY))
      });
    };

    // Computar la lista filtrada de partes semanalas dinámicamente
    const filteredReportsList = weeklyReports.filter(report => {
      const matchesWorker = !reportFilterWorker || report.workerId === reportFilterWorker;
      const matchesStatus = !reportFilterStatus || report.status === reportFilterStatus;
      
      let matchesDates = true;
      if (reportFilterStartDate || reportFilterEndDate) {
        const reportDate = new Date(report.timestamp);
        reportDate.setHours(0, 0, 0, 0);
        
        if (reportFilterStartDate) {
          const start = new Date(reportFilterStartDate);
          start.setHours(0, 0, 0, 0);
          if (reportDate < start) matchesDates = false;
        }
        if (reportFilterEndDate) {
          const end = new Date(reportFilterEndDate);
          end.setHours(23, 59, 59, 999);
          if (reportDate > end) matchesDates = false;
        }
      }
      
      return matchesWorker && matchesStatus && matchesDates;
    });

    const handleDeleteFiltered = async () => {
      const count = filteredReportsList.length;
      if (count === 0) {
        alert("No hay partes de trabajo que coincidan con los filtros seleccionados.");
        return;
      }

      const warningText = `⚠️ CONTROL CRÍTICO DE ELIMINACIÓN:\n\n¿Estás completamente seguro de que deseas eliminar permanentemente los ${count} partes de trabajo seleccionados de la base de datos?\n\nEsta acción eliminará tanto los archivos como los análisis de Gemini de manera irreversible.`;
      
      if (window.confirm(warningText)) {
        try {
          setIsSaving(true);
          for (const report of filteredReportsList) {
            await StorageService.deleteReport(report.id);
          }
          alert(`🗑️ Éxito: Se han eliminado ${count} partes de trabajo correctamente.`);
        } catch (e) {
          console.error("Error al eliminar partes filtrados:", e);
          alert("Ocurrió un error al intentar eliminar los partes filtrados.");
        } finally {
          setIsSaving(false);
        }
      }
    };

    return (
      <div className="space-y-6 animate-fadeIn pb-32">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4 border-b border-[var(--panel-border)] pb-4">
          <div>
            <h2 className="text-2xl font-bebas text-emerald-600 dark:text-emerald-400 uppercase">Partes Semanales</h2>
            <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Revisión y gestión de partes de trabajo subidos por los operarios</p>
          </div>
          
          <div className="flex items-center gap-2">
            <button 
              onClick={() => setShowReportFilters(!showReportFilters)}
              className={`p-2.5 rounded-xl border flex items-center gap-1.5 text-xs font-bold uppercase transition-all ${
                showReportFilters 
                  ? 'bg-emerald-600/10 border-emerald-500/30 text-emerald-400' 
                  : 'bg-[var(--btn-glass-bg)] border-[var(--btn-glass-border)] text-[var(--text-muted)]'
              }`}
            >
              <Filter size={16} /> {showReportFilters ? 'Ocultar Filtros' : 'Filtrar Partes'}
            </button>

            {filteredReportsList.length > 0 && (
              <button 
                onClick={handleDeleteFiltered}
                className="bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white border border-rose-500/20 px-4 py-2.5 rounded-xl text-xs font-bold uppercase flex items-center gap-1.5 transition-all"
              >
                <Trash2 size={16} /> Eliminar Filtrados ({filteredReportsList.length})
              </button>
            )}
          </div>
        </div>

        {/* Panel de Filtros */}
        {showReportFilters && (
          <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)] grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4 animate-fadeIn">
            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Buscar por Operario</label>
              <select 
                value={reportFilterWorker} 
                onChange={(e) => setReportFilterWorker(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none"
              >
                <option value="">Todos los operarios</option>
                {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Estado del Parte</label>
              <select 
                value={reportFilterStatus} 
                onChange={(e) => setReportFilterStatus(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none"
              >
                <option value="">Todos los estados</option>
                <option value="PENDING">Pendiente</option>
                <option value="APPROVED">Aprobado</option>
                <option value="REJECTED">Rechazado</option>
              </select>
            </div>

            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Fecha de Envío Desde</label>
              <input 
                type="date" 
                value={reportFilterStartDate}
                onChange={(e) => setReportFilterStartDate(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] [color-scheme:dark] outline-none"
              />
            </div>

            <div className="space-y-1.5">
              <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Fecha de Envío Hasta</label>
              <input 
                type="date" 
                value={reportFilterEndDate}
                onChange={(e) => setReportFilterEndDate(e.target.value)}
                className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] [color-scheme:dark] outline-none"
              />
            </div>

            <div className="sm:col-span-2 lg:col-span-4 flex justify-end">
              <button 
                onClick={() => {
                  setReportFilterWorker('');
                  setReportFilterStatus('');
                  setReportFilterStartDate('');
                  setReportFilterEndDate('');
                }}
                className="text-xs text-rose-400 font-bold uppercase tracking-wider hover:underline flex items-center gap-1.5"
              >
                <RotateCcw size={14} /> Restablecer Filtros
              </button>
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
          {filteredReportsList.length > 0 ? (
            filteredReportsList.map(report => (
              <div key={report.id} className="mirror-panel p-6 flex flex-col justify-between hover:border-emerald-500/30 transition-all">
                <div className="space-y-4">
                  <div className="flex justify-between items-start">
                    <div>
                      <h3 className="font-bebas text-lg text-[var(--text-main)] uppercase">{report.workerName}</h3>
                      <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase">{report.dateStr}</p>
                    </div>
                    <span className={`text-[9px] font-black uppercase px-2.5 py-1 rounded-full ${
                      report.status === 'APPROVED' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' :
                      report.status === 'REJECTED' ? 'bg-rose-500/10 text-rose-400 border border-rose-500/20' :
                      'bg-amber-500/10 text-amber-500 border border-amber-500/20 animate-pulse'
                    }`}>
                      {report.status === 'APPROVED' ? 'Aprobado' : report.status === 'REJECTED' ? 'Rechazado' : 'Pendiente'}
                    </span>
                  </div>

                  <div className="relative aspect-video rounded-xl bg-[var(--island-bg)] overflow-hidden group">
                    <img src={report.photoUrl} alt="Parte semanal" className="w-full h-full object-cover" />
                    <div className="absolute inset-0 bg-black/50 opacity-0 group-hover:opacity-100 flex items-center justify-center transition-all">
                      <button onClick={() => { setSelectedReport(report); setShowRejectionInput(false); }} className="bg-blue-600 text-white p-3 rounded-full font-bold text-xs flex items-center gap-1 hover:bg-blue-500 transition-colors">
                        <Eye size={16} /> Ver Parte Completo
                      </button>
                    </div>
                  </div>

                  {report.isAiParsed && (
                    <div className="space-y-2 p-3 bg-[var(--island-bg)] rounded-xl border border-[var(--panel-border)]">
                      <p className="text-[9px] text-emerald-600 dark:text-emerald-400 font-bold uppercase">Lectura de IA (Gemini):</p>
                      <div className="grid grid-cols-2 gap-2 text-[10px]">
                        <div>
                          <span className="text-[var(--text-muted)] block uppercase">Fechas:</span>
                          <span className="font-bold text-[var(--text-main)]">{report.extractedDates || '-'}</span>
                        </div>
                        <div>
                          <span className="text-[var(--text-muted)] block uppercase">Horas:</span>
                          <span className="font-bold text-[var(--text-main)]">{report.extractedHours || 0}h</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[var(--text-muted)] block uppercase">Tareas:</span>
                          <span className="font-bold text-[var(--text-main)] truncate block">{report.extractedTasks || '-'}</span>
                        </div>
                        <div className="col-span-2">
                          <span className="text-[var(--text-muted)] block uppercase">Total Calculado:</span>
                          <span className="font-bold text-emerald-600 dark:text-emerald-400">{report.extractedTotal || '-'}</span>
                        </div>
                      </div>
                    </div>
                  )}
                  
                  {report.comments && (
                    <p className="text-[10px] text-[var(--text-muted)] leading-relaxed italic">
                      " {report.comments} "
                    </p>
                  )}

                  {report.rejectionReason && (
                    <div className="p-3 bg-rose-500/5 rounded-xl border border-rose-500/10 text-rose-400 text-[10px]">
                      <span className="font-bold uppercase block">Motivo Rechazo:</span>
                      {report.rejectionReason}
                    </div>
                  )}
                </div>

                {/* Acciones de descarga y aprobación */}
                <div className="space-y-2 mt-4 pt-4 border-t border-[var(--panel-border)]">
                  <div className="flex gap-2">
                    <button 
                      onClick={() => handleDownloadSingleReportPDF(report)}
                      className="flex-1 bg-emerald-600/10 hover:bg-emerald-600 text-emerald-500 hover:text-white border border-emerald-500/20 py-2 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1 transition-all"
                      title="Descargar Ficha Detallada en PDF"
                    >
                      <FileText size={12} /> Ficha PDF
                    </button>
                    <a 
                      href={report.photoUrl} 
                      download={`parte_${report.workerName.toLowerCase()}_${report.dateStr}.jpg`}
                      className="flex-1 bg-blue-600/10 hover:bg-blue-600 text-blue-500 hover:text-white border border-blue-500/20 py-2 rounded-lg text-[10px] font-black uppercase flex items-center justify-center gap-1 transition-all"
                      title="Descargar Hoja de Parte Escaneada original"
                    >
                      <Download size={12} /> Original
                    </a>
                  </div>

                  {report.status === 'PENDING' && (
                    <div className="flex gap-2">
                      <button onClick={() => handleApproveReport(report)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-2.5 rounded-lg text-xs font-bold uppercase">
                        Aprobar
                      </button>
                      <button onClick={() => { setSelectedReport(report); setShowRejectionInput(true); }} className="flex-1 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white py-2.5 rounded-lg text-xs font-bold uppercase border border-rose-500/20">
                        Rechazar
                      </button>
                    </div>
                  )}
                </div>
              </div>
            ))
          ) : (
            <div className="col-span-full text-center py-20 bg-[var(--panel-bg)]/30 rounded-[3rem] border border-dashed border-[var(--panel-border)]">
              <p className="text-[var(--text-muted)] text-xs font-bold uppercase tracking-widest">No hay partes de trabajo registrados con los filtros actuales</p>
            </div>
          )}
        </div>


      {selectedReport && (
        <div className="fixed inset-0 z-[110] bg-black/95 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-[var(--modal-bg)] w-full max-w-lg rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-xl font-bebas text-emerald-600 dark:text-emerald-400 uppercase">Detalles del Parte Semanal</h3>
                <p className="text-[var(--modal-text-muted)] text-[10px] font-bold uppercase">Operario: {selectedReport.workerName}</p>
              </div>
              <button onClick={() => { setSelectedReport(null); setShowRejectionInput(false); setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }} className="text-[var(--modal-text-muted)] hover:text-[var(--modal-text-main)] p-2">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-6">
              {/* Controles de Zoom */}
              <div className="space-y-2">
                <div className="flex justify-between items-center bg-black/40 px-4 py-2.5 rounded-xl border border-[var(--panel-border)] text-xs">
                  <span className="text-[var(--text-muted)] uppercase font-bold text-[9px] tracking-wider flex items-center gap-1.5"><Clock size={12} /> Control de Visualización:</span>
                  <div className="flex items-center gap-2">
                    <button 
                      onClick={() => setZoomLevel(prev => Math.max(1, prev - 0.5))}
                      disabled={zoomLevel <= 1}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-50 transition-colors"
                      title="Alejar Zoom"
                    >
                      <ZoomOut size={14} />
                    </button>
                    <span className="font-mono text-[#CCFF00] font-black min-w-[42px] text-center">{Math.round(zoomLevel * 100)}%</span>
                    <button 
                      onClick={() => setZoomLevel(prev => Math.min(4, prev + 0.5))}
                      disabled={zoomLevel >= 4}
                      className="p-1 rounded bg-slate-800 hover:bg-slate-700 text-white disabled:opacity-50 transition-colors"
                      title="Acercar Zoom"
                    >
                      <ZoomIn size={14} />
                    </button>
                    <button 
                      onClick={() => { setZoomLevel(1); setPanOffset({ x: 0, y: 0 }); }}
                      className="p-1 rounded bg-rose-500/10 hover:bg-rose-500 text-rose-400 hover:text-white font-bold text-[9px] uppercase px-2.5 transition-colors"
                      title="Restaurar zoom y posición original"
                    >
                      Reset
                    </button>
                  </div>
                </div>

                <div 
                  className="rounded-2xl overflow-hidden bg-black/50 border border-[var(--panel-border)] relative cursor-grab active:cursor-grabbing max-h-[45vh] h-[40vh] flex items-center justify-center select-none"
                  onMouseDown={handleImageMouseDown}
                  onMouseMove={handleImageMouseMove}
                  onMouseUp={handleImageMouseUpOrLeave}
                  onMouseLeave={handleImageMouseUpOrLeave}
                  onTouchStart={handleImageTouchStart}
                  onTouchMove={handleImageTouchMove}
                  onTouchEnd={handleImageMouseUpOrLeave}
                >
                  <img 
                    src={selectedReport.photoUrl} 
                    alt="Parte semanal escaneado" 
                    draggable="false"
                    className="max-h-full max-w-full object-contain transition-transform duration-75 origin-center"
                    style={{ 
                      transform: `scale(${zoomLevel}) translate(${panOffset.x / zoomLevel}px, ${panOffset.y / zoomLevel}px)`,
                      pointerEvents: 'none'
                    }} 
                  />
                  {zoomLevel > 1 && (
                    <div className="absolute bottom-2 right-2 bg-black/75 text-[#CCFF00] font-bold text-[8px] tracking-wider uppercase px-2 py-1 rounded-md border border-emerald-500/20 pointer-events-none">
                      Arrastra la imagen para explorar detalles
                    </div>
                  )}
                </div>

                {/* Descargar Reporte Completo en PDF dentro del modal */}
                <div className="flex gap-2">
                  <button
                    onClick={() => handleDownloadSingleReportPDF(selectedReport)}
                    className="w-full bg-[#CCFF00] hover:bg-yellow-400 text-black py-3 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-1.5 transition-all shadow-[0_0_15px_rgba(204,255,0,0.15)]"
                  >
                    <FileText size={16} /> Descargar Ficha PDF Completa
                  </button>
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4 bg-[var(--input-bg)] p-5 rounded-2xl border border-[var(--panel-border)]">
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Operario</span>
                  <span className="text-sm font-bold text-[var(--text-main)] uppercase">{selectedReport.workerName}</span>
                </div>
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Fecha de Envío</span>
                  <span className="text-sm font-bold text-[var(--text-main)]">{selectedReport.dateStr}</span>
                </div>
                {selectedReport.extractedDates && (
                  <div className="col-span-2">
                    <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Fechas de Trabajo (IA)</span>
                    <span className="text-sm font-bold text-[var(--text-main)]">{selectedReport.extractedDates}</span>
                  </div>
                )}
                {selectedReport.extractedTasks && (
                  <div className="col-span-2">
                    <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Trabajo Realizado (IA)</span>
                    <span className="text-sm text-[var(--text-muted)] leading-relaxed">{selectedReport.extractedTasks}</span>
                  </div>
                )}
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Horas Totales (IA)</span>
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{selectedReport.extractedHours || 0} horas</span>
                </div>
                <div>
                  <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Total Calculado (IA)</span>
                  <span className="text-sm font-black text-emerald-600 dark:text-emerald-400">{selectedReport.extractedTotal || '-'}</span>
                </div>
                
                {/* Desglose de horas por día transcrito por la IA */}
                {selectedReport.dailyHours && selectedReport.dailyHours.length > 0 && (
                  <div className="col-span-2 border-t border-[var(--panel-border)] pt-3 mt-1">
                    <span className="text-[9px] text-[#CCFF00] font-bold block uppercase tracking-wider mb-2">Desglose de Horas por Día (IA)</span>
                    <div className="space-y-1.5 max-h-[180px] overflow-y-auto custom-scrollbar pr-1">
                      {selectedReport.dailyHours.map((dh, idx) => (
                        <div key={idx} className="flex justify-between items-center bg-black/40 p-2.5 rounded-xl border border-[var(--panel-border)] text-xs">
                          <span className="font-bold text-[var(--text-main)]">{dh.date}</span>
                          <div className="flex items-center gap-3">
                            {dh.tasks && <span className="text-[10px] text-[var(--text-muted)] italic max-w-[180px] truncate" title={dh.tasks}>{dh.tasks}</span>}
                            <span className="font-black text-emerald-400 bg-emerald-500/10 px-2 rounded-lg border border-emerald-500/20">{dh.hours}h</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                )}

                {selectedReport.comments && (
                  <div className="col-span-2 border-t border-[var(--panel-border)] pt-3 mt-1">
                    <span className="text-[9px] text-[var(--text-muted)] font-bold block uppercase tracking-wider">Comentarios del Operario</span>
                    <span className="text-sm text-[var(--text-muted)] italic">"{selectedReport.comments}"</span>
                  </div>
                )}
              </div>

              {selectedReport.status === 'PENDING' && (
                <div className="space-y-4 pt-4 border-t border-[var(--panel-border)]">
                  {!showRejectionInput ? (
                    <div className="flex gap-3">
                      <button onClick={() => handleApproveReport(selectedReport)} className="flex-1 bg-emerald-600 hover:bg-emerald-500 text-white py-4 rounded-xl font-bold uppercase text-xs shadow-lg transition-all">
                        Aprobar Parte Semanal
                      </button>
                      <button onClick={() => setShowRejectionInput(true)} className="flex-1 bg-rose-600/10 hover:bg-rose-600 text-rose-500 hover:text-white py-4 rounded-xl font-bold uppercase text-xs border border-rose-500/20 transition-all">
                        Rechazar Parte...
                      </button>
                    </div>
                  ) : (
                    <div className="space-y-3 animate-fadeIn">
                      <label className="text-[10px] font-black text-rose-400 uppercase tracking-widest ml-1">Escribe el Motivo de Rechazo:</label>
                      <textarea value={rejectionReasonInput} onChange={(e) => setRejectionReasonInput(e.target.value)} placeholder="Ej: No se distingue la fecha de trabajo o faltan firmas..." className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-4 text-sm text-[var(--text-main)] focus:border-rose-500 outline-none h-24 resize-none leading-relaxed" />
                      <div className="flex gap-3">
                        <button onClick={() => handleRejectReport(selectedReport)} className="flex-1 bg-rose-600 text-white py-3 rounded-lg text-xs font-bold uppercase">
                          Confirmar Rechazo
                        </button>
                        <button onClick={() => { setShowRejectionInput(false); setRejectionReasonInput(''); }} className="flex-1 bg-slate-800 hover:bg-slate-700 text-[var(--text-muted)] py-3 rounded-lg text-xs font-bold uppercase">
                          Cancelar
                        </button>
                      </div>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};

  const renderPayslips = () => {
    const calculatedTotal = Number(payslipForm.baseSalary) + (Number(payslipForm.extraHours) * Number(payslipForm.extraHoursPay)) - Number(payslipForm.deductions);
    
    return (
      <div className="space-y-8 animate-fadeIn pb-32">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <h2 className="text-2xl font-bebas text-emerald-600 dark:text-emerald-400 uppercase">Gestión de Nóminas</h2>
            <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Generador digital y envío de nóminas a operarios</p>
          </div>
        </div>

        <div className="grid grid-cols-1 lg:grid-cols-3 gap-8">
          <div className="lg:col-span-1 mirror-panel p-6 space-y-6">
            <div className="flex justify-between items-center">
              <h3 className="text-lg font-bebas text-emerald-600 dark:text-emerald-400 uppercase">Enviar Nueva Nómina</h3>
            </div>

            {/* Selector de tipo de envío de nómina */}
            <div className="grid grid-cols-2 bg-[var(--input-bg)] p-1 rounded-xl border border-[var(--panel-border)] text-center text-xs font-bold uppercase">
              <button
                type="button"
                onClick={() => setPayslipMode('auto')}
                className={`py-2 rounded-lg transition-all ${
                  payslipMode === 'auto'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Calculadora
              </button>
              <button
                type="button"
                onClick={() => setPayslipMode('upload')}
                className={`py-2 rounded-lg transition-all ${
                  payslipMode === 'upload'
                    ? 'bg-blue-600 text-white shadow-md'
                    : 'text-[var(--text-muted)] hover:text-[var(--text-main)]'
                }`}
              >
                Subir PDF
              </button>
            </div>
            
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Seleccionar Operario *</label>
                <select className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none" value={payslipForm.workerId} onChange={(e) => setPayslipForm({ ...payslipForm, workerId: e.target.value })}>
                  <option value="">Selecciona...</option>
                  {workers.map(w => <option key={w.id} value={w.id}>{w.name}</option>)}
                </select>
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Mes de Liquidación *</label>
                <input type="month" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] [color-scheme:dark]" value={payslipForm.monthStr} onChange={(e) => setPayslipForm({ ...payslipForm, monthStr: e.target.value })} />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Título / Concepto (Opcional)</label>
                <input type="text" placeholder="Ej: Nómina Junio 2026" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)]" value={payslipForm.title} onChange={(e) => setPayslipForm({ ...payslipForm, title: e.target.value })} />
              </div>

              {payslipMode === 'auto' ? (
                <>
                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Salario Base (€)</label>
                      <input type="number" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)]" value={payslipForm.baseSalary} onChange={(e) => setPayslipForm({ ...payslipForm, baseSalary: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Deducciones (€)</label>
                      <input type="number" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)]" value={payslipForm.deductions} onChange={(e) => setPayslipForm({ ...payslipForm, deductions: Number(e.target.value) })} />
                    </div>
                  </div>

                  <div className="grid grid-cols-2 gap-3">
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Horas Extra</label>
                      <input type="number" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)]" value={payslipForm.extraHours} onChange={(e) => setPayslipForm({ ...payslipForm, extraHours: Number(e.target.value) })} />
                    </div>
                    <div className="space-y-1.5">
                      <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Precio Hora Extra (€)</label>
                      <input type="number" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)]" value={payslipForm.extraHoursPay} onChange={(e) => setPayslipForm({ ...payslipForm, extraHoursPay: Number(e.target.value) })} />
                    </div>
                  </div>

                  <div className="p-4 bg-[var(--island-bg)] rounded-2xl border border-[var(--panel-border)] space-y-1">
                    <span className="text-[9px] font-black text-[var(--text-muted)] uppercase block tracking-wider">Cálculo Líquido Estimado</span>
                    <span className="text-2xl font-black text-emerald-600 dark:text-emerald-400">{calculatedTotal.toFixed(2)}€</span>
                  </div>
                </>
              ) : (
                <>
                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Sueldo Neto (€) *</label>
                    <input
                      type="number"
                      className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)]"
                      placeholder="Ej: 1450"
                      value={uploadedTotalPay}
                      onChange={(e) => setUploadedTotalPay(Number(e.target.value))}
                    />
                  </div>

                  <div className="space-y-1.5">
                    <label className="text-[9px] font-black text-[var(--text-muted)] uppercase ml-1">Archivo PDF de la Nómina *</label>
                    <input
                      type="file"
                      ref={payslipFileInputRef}
                      onChange={handlePdfUpload}
                      accept="application/pdf"
                      className="hidden"
                    />
                    
                    <div
                      onClick={() => payslipFileInputRef.current?.click()}
                      className="border-2 border-dashed border-[var(--panel-border)] hover:border-emerald-500/40 rounded-2xl p-6 flex flex-col items-center justify-center gap-2 cursor-pointer bg-[var(--island-bg)] hover:bg-[var(--btn-glass-bg)]/20 transition-all text-center"
                    >
                      <Upload className="text-[var(--text-muted)] hover:text-emerald-500 transition-colors" size={28} />
                      {uploadedPdfName ? (
                        <div className="space-y-1">
                          <p className="text-[11px] font-bold text-emerald-500 uppercase tracking-wide break-all px-2">{uploadedPdfName}</p>
                          <p className="text-[9px] text-[var(--text-muted)] font-semibold">Haz clic para cambiar de archivo</p>
                        </div>
                      ) : (
                        <div className="space-y-0.5">
                          <p className="text-xs font-bold text-[var(--text-main)]">Seleccionar PDF de nómina</p>
                          <p className="text-[10px] text-[var(--text-muted)]">Sube el documento desde tu ordenador</p>
                        </div>
                      )}
                    </div>
                  </div>
                </>
              )}

              <button onClick={handleGenerateAndSendPayslip} className="w-full bg-blue-600 text-white py-4 rounded-xl font-bold uppercase text-xs shadow-lg shadow-blue-500/15 hover:shadow-blue-500/30 active:scale-95 transition-all">
                {payslipMode === 'upload' ? 'Subir y Enviar Nómina' : 'Generar y Enviar Nómina'}
              </button>
            </div>
          </div>

          <div className="lg:col-span-2 space-y-4">
            <h3 className="text-lg font-bebas text-emerald-600 dark:text-emerald-400 uppercase">Nóminas Enviadas</h3>
            
            <div className="overflow-x-auto bg-[var(--panel-bg)] rounded-3xl border border-[var(--panel-border)]">
              <table className="w-full text-left text-xs">
                <thead className="bg-[var(--input-bg)] border-b border-[var(--panel-border)]">
                  <tr>
                    <th className="p-4 font-black uppercase text-[var(--text-muted)]">Operario</th>
                    <th className="p-4 font-black uppercase text-[var(--text-muted)]">Período</th>
                    <th className="p-4 font-black uppercase text-[var(--text-muted)]">Salario Neto</th>
                    <th className="p-4 font-black uppercase text-[var(--text-muted)]">Estado</th>
                    <th className="p-4 font-black uppercase text-[var(--text-muted)] text-right">PDF</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-[var(--panel-border)]">
                  {payslips.length > 0 ? (
                    payslips.map(ps => (
                      <tr key={ps.id} className="hover:bg-[var(--btn-glass-bg)]/50 transition">
                        <td className="p-4 font-bold text-[var(--text-main)] uppercase">{ps.workerName}</td>
                        <td className="p-4 font-medium text-[var(--text-muted)]">{ps.monthStr}</td>
                        <td className="p-4 font-black text-emerald-600 dark:text-emerald-400">{ps.totalPay.toFixed(2)}€</td>
                        <td className="p-4">
                          <span className={`text-[9px] font-bold uppercase px-2 py-0.5 rounded-full ${
                            ps.status === 'SIGNED' ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 border border-emerald-500/20' : 'bg-blue-500/10 text-blue-400 border border-blue-500/20'
                          }`}>
                            {ps.status === 'SIGNED' ? 'Firmado' : 'Enviado'}
                          </span>
                        </td>
                        <td className="p-4 text-right">
                          {ps.pdfBase64 && (
                            <a href={ps.pdfBase64} download={`Nomina_${ps.workerName.replace(/\s+/g, '_')}_${ps.monthStr}.pdf`} className="inline-flex p-2 bg-emerald-500/10 text-emerald-600 dark:text-emerald-400 rounded-lg border border-emerald-500/20 hover:bg-emerald-500 hover:text-white dark:hover:text-black transition">
                              <Download size={14} />
                            </a>
                          )}
                        </td>
                      </tr>
                    ))
                  ) : (
                    <tr>
                      <td colSpan={5} className="text-center py-12 text-[var(--text-muted)] uppercase font-bold text-[10px]">
                        No hay nóminas enviadas aún
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>
          </div>
        </div>
      </div>
    );
  };

  const renderChat = () => {
    // Filter out messages with the selected worker and sort chronologically
    const activeMessages = chats.filter(c => 
      (c.senderId === 'ADMIN' && c.receiverId === activeWorkerChatId) ||
      (c.senderId === activeWorkerChatId && c.receiverId === 'ADMIN')
    ).sort((a, b) => a.timestamp - b.timestamp);

    const partnerUnreadCount = (workerId: string) => {
      return chats.filter(c => c.senderId === workerId && c.receiverId === 'ADMIN' && !c.read).length;
    };

    const getMostRecentMessageTimestamp = (workerId: string) => {
      const msgs = chats.filter(c => 
        (c.senderId === workerId && c.receiverId === 'ADMIN') ||
        (c.senderId === 'ADMIN' && c.receiverId === workerId)
      );
      if (msgs.length === 0) return 0;
      return Math.max(...msgs.map(m => m.timestamp));
    };

    const sortedWorkers = [...workers].sort((a, b) => {
      return getMostRecentMessageTimestamp(b.id) - getMostRecentMessageTimestamp(a.id);
    });

    return (
      <div className="flex flex-col md:h-[calc(100vh-10rem)] animate-fadeIn text-[var(--text-main)] pb-24 md:pb-0">
        <div>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter">Bandeja de Mensajes</h2>
          <p className="text-[10px] text-blue-500 font-bold uppercase tracking-widest mb-4">Comunícate individualmente con todo tu personal</p>
        </div>

        {/* Two-column layout */}
        <div className="flex flex-col md:grid md:grid-cols-12 gap-6 flex-1 md:overflow-hidden min-h-[500px]">
          
          {/* CONTACTS LIST (Left Column) */}
          <div className={`md:col-span-4 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-[2rem] p-4 flex flex-col gap-3 md:h-full overflow-y-auto custom-scrollbar shadow-[var(--panel-shadow)] ${
            activeWorkerChatId ? 'hidden md:flex' : 'flex'
          }`}>
          <h3 className="text-xs font-black uppercase tracking-wider text-[var(--text-muted)] border-b border-[var(--panel-border)] pb-2">Operarios</h3>
            
            <div className="space-y-2 overflow-y-auto flex-1 custom-scrollbar">
              {sortedWorkers.length === 0 ? (
                <p className="text-xs text-[var(--text-muted)] italic text-center py-8">No hay operarios registrados.</p>
              ) : (
                sortedWorkers.map(w => {
                  const isSelected = activeWorkerChatId === w.id;
                  const unread = partnerUnreadCount(w.id);
                  const lastMsg = chats
                    .filter(c => (c.senderId === w.id && c.receiverId === 'ADMIN') || (c.senderId === 'ADMIN' && c.receiverId === w.id))
                    .sort((a, b) => b.timestamp - a.timestamp)[0];

                  return (
                    <button 
                      key={w.id}
                      onClick={() => setActiveWorkerChatId(w.id)}
                      className={`w-full flex items-center justify-between p-3.5 rounded-2xl border transition-all text-left ${
                        isSelected 
                          ? 'bg-blue-600/10 border-blue-500/40 text-blue-400' 
                          : 'bg-[var(--btn-glass-bg)] border-[var(--btn-glass-border)] hover:bg-slate-500/5'
                      }`}
                    >
                      <div className="flex items-center gap-3 overflow-hidden">
                        {w.photoUrl ? (
                          <img src={w.photoUrl} alt={w.name} className="w-10 h-10 rounded-full object-cover border border-white/10 shrink-0" />
                        ) : (
                          <div className="w-10 h-10 rounded-full bg-slate-800 flex items-center justify-center font-black text-xs text-slate-300 uppercase shrink-0">
                            {w.name.charAt(0)}
                          </div>
                        )}
                        <div className="overflow-hidden">
                          <h4 className="text-xs font-black uppercase tracking-wide truncate">{w.name}</h4>
                          <p className="text-[9px] text-[var(--text-muted)] font-medium truncate">{w.role || 'Operario'}</p>
                          {lastMsg && (
                            <p className="text-[9px] text-slate-400 truncate mt-0.5 max-w-[160px]">{lastMsg.text}</p>
                          )}
                        </div>
                      </div>

                      {unread > 0 && (
                        <span className="bg-[#CCFF00] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(204,255,0,0.5)] shrink-0 ml-2">
                          {unread}
                        </span>
                      )}
                    </button>
                  );
                })
              )}
            </div>
          </div>

          {/* MESSAGES BOX (Right Column) */}
          <div className={`md:col-span-8 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-[2rem] p-4 flex flex-col md:h-full justify-between shadow-[var(--panel-shadow)] min-h-[400px] ${
            activeWorkerChatId ? 'flex' : 'hidden md:flex'
          }`}>
            {activeWorkerChatId ? (
              <>
                {/* Header of Active Chat */}
                <div className="flex items-center justify-between border-b border-[var(--panel-border)] pb-3 shrink-0">
                  <div className="flex items-center gap-3">
                    <button 
                      onClick={() => setActiveWorkerChatId(null)} 
                      className="md:hidden p-2 bg-[var(--btn-glass-bg)] rounded-xl border border-[var(--btn-glass-border)] text-[var(--text-muted)]"
                    >
                      <ArrowLeft size={16} />
                    </button>
                    <div>
                      <h3 className="text-sm font-black uppercase tracking-wider text-[var(--text-main)] flex items-center gap-2">
                        {workers.find(w => w.id === activeWorkerChatId)?.name}
                      </h3>
                      <p className="text-[9px] text-emerald-400 font-bold uppercase tracking-widest">
                        {workers.find(w => w.id === activeWorkerChatId)?.role || 'Operario'}
                      </p>
                    </div>
                  </div>

                  <span className="text-[9px] text-[var(--text-muted)] font-bold tracking-widest uppercase font-mono">Chat Administrador</span>
                </div>

                {/* Message stream */}
                <div className="flex-1 overflow-y-auto my-3 p-2 space-y-3 custom-scrollbar min-h-[250px] max-h-[350px] md:max-h-none">
                  {activeMessages.length === 0 ? (
                    <div className="flex flex-col items-center justify-center h-full text-center py-10 opacity-60">
                      <MessageSquare size={32} className="text-[var(--text-muted)] mb-2" />
                      <p className="text-xs font-bold uppercase tracking-wider text-[var(--text-muted)]">Canal Vacío</p>
                      <p className="text-[9px] font-medium text-[var(--text-muted)] mt-1">Escribe tu primer mensaje a este operario para guiarle o resolver dudas.</p>
                    </div>
                  ) : (
                    activeMessages.map(m => {
                      const isMe = m.senderId === 'ADMIN';
                      return (
                        <div key={m.id} className={`flex ${isMe ? 'justify-end' : 'justify-start'}`}>
                          <div className={`max-w-[80%] rounded-2xl px-4 py-2.5 shadow-sm text-xs ${
                            isMe 
                              ? 'bg-blue-600 text-white font-medium rounded-tr-none' 
                              : 'bg-[var(--btn-glass-bg)] border border-[var(--btn-glass-border)] text-[var(--text-main)] rounded-tl-none'
                          }`}>
                            <p className="whitespace-pre-wrap leading-relaxed break-words">{m.text}</p>
                            <div className="flex items-center justify-end gap-1 mt-1 opacity-60 text-[8px] font-mono">
                              <span>{m.timeStr}</span>
                              {isMe && (
                                <span className={m.read ? 'text-blue-300 font-bold' : 'text-slate-300'}>
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

                {/* Input Bar */}
                <div className="border-t border-[var(--panel-border)] pt-3 flex items-center gap-2 shrink-0">
                  <input 
                    type="text" 
                    value={adminChatInput}
                    onChange={(e) => setAdminChatInput(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') handleSendAdminMessage(); }}
                    className="flex-1 bg-[var(--input-bg)] border border-[var(--input-border)] text-[var(--input-text)] rounded-xl px-4 py-3 text-base outline-none focus:border-blue-500"
                    placeholder="Escribe un mensaje de respuesta..."
                  />
                  <button 
                    onClick={handleSendAdminMessage}
                    className="p-3 bg-blue-600 text-white rounded-xl hover:bg-blue-500 active:scale-95 transition-all shadow-md flex items-center justify-center"
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
                <h3 className="text-sm font-black uppercase tracking-wider text-[var(--text-main)]">Conversaciones</h3>
                <p className="text-[10px] text-[var(--text-muted)] mt-1 max-w-[240px] mx-auto leading-relaxed">
                  Elige a un operario en el menú izquierdo para ver su historial de mensajes y mandarle aclaraciones inmediatas.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    );
  };

  const renderSettings = () => (
    <div className="max-w-2xl space-y-6 animate-fadeIn pb-32">
      <div className="flex items-center justify-between mb-4">
        <div>
          <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter">Configuración General</h2>
          <p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Personalización de CARMAGNE INSTAL SL</p>
        </div>
      </div>

      <div className="bg-[var(--panel-bg)] p-6 rounded-[2.5rem] border border-[var(--panel-border)] shadow-xl space-y-8">
        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <ImageIcon className="text-blue-500" size={24} />
            <h3 className="text-sm font-black text-[var(--text-main)] uppercase tracking-widest">Identidad Visual (Logo)</h3>
          </div>
          
          <div className="flex flex-col md:flex-row items-center gap-6 p-6 bg-[var(--input-bg)]/50 rounded-3xl border border-[var(--panel-border)]">
            <div className="w-32 h-32 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              {config.logoUrl ? (
                <img src={config.logoUrl} className="w-full h-full object-contain p-2" alt="Logo preview" />
              ) : (
                <Zap size={32} className="text-slate-800" />
              )}
            </div>
            <div className="flex-1 space-y-3">
              <p className="text-[10px] text-[var(--text-muted)] font-bold leading-relaxed">
                <span className="text-blue-500 font-black uppercase">Guía:</span> Se recomienda un logo en formato PNG o SVG con fondo transparente. Aparecerá en el login y en el panel superior.
              </p>
              <div className="flex gap-2">
                <input ref={logoInputRef} type="file" accept="image/*" onChange={handleLogoUpload} className="hidden" />
                <button onClick={() => logoInputRef.current?.click()} className="flex-1 bg-blue-600 text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 shadow-lg">
                  <Upload size={14} /> Subir Logo
                </button>
                {config.logoUrl && (
                  <button onClick={handleRemoveLogo} className="p-3 bg-rose-600/10 text-rose-500 rounded-xl border border-rose-500/20">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4">
          <div className="flex items-center gap-3">
            <Smartphone className="text-emerald-500" size={24} />
            <h3 className="text-sm font-black text-[var(--text-main)] uppercase tracking-widest">Icono PWA / Favicon</h3>
          </div>
          
          <div className="flex flex-col md:flex-row items-center gap-6 p-6 bg-[var(--input-bg)]/50 rounded-3xl border border-[var(--panel-border)]">
            <div className="w-20 h-20 bg-[var(--panel-bg)] border border-[var(--panel-border)] rounded-2xl flex items-center justify-center overflow-hidden shrink-0 shadow-inner">
              {config.faviconUrl ? (
                <img src={config.faviconUrl} className="w-full h-full object-contain p-1" alt="Favicon preview" />
              ) : (
                <Smartphone size={24} className="text-slate-800" />
              )}
            </div>
            <div className="flex-1 space-y-3">
              <p className="text-[10px] text-[var(--text-muted)] font-bold leading-relaxed">
                <span className="text-emerald-500 font-black uppercase">Guía:</span> Tamaño recomendado <span className="text-white">512x512 px</span>. Este icono se mostrará al instalar la aplicación en el móvil y en la pestaña del navegador.
              </p>
              <div className="flex gap-2">
                <input ref={faviconInputRef} type="file" accept="image/*" onChange={handleFaviconUpload} className="hidden" />
                <button onClick={() => faviconInputRef.current?.click()} className="flex-1 bg-emerald-600 text-white py-3 rounded-xl font-black uppercase text-[10px] tracking-widest flex items-center justify-center gap-2 shadow-lg">
                  <Upload size={14} /> Subir Icono PWA
                </button>
                {config.faviconUrl && (
                  <button onClick={handleRemoveFavicon} className="p-3 bg-rose-600/10 text-rose-500 rounded-xl border border-rose-500/20">
                    <Trash2 size={16} />
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <div className="space-y-4 pt-4 border-t border-[var(--panel-border)]">
          <div className="flex items-center gap-3">
            <Database className="text-indigo-500" size={24} />
            <h3 className="text-sm font-black text-[var(--text-main)] uppercase tracking-widest">Datos del Sistema</h3>
          </div>
          <div className="grid grid-cols-1 gap-4">
            <div className="space-y-2">
              <label className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest ml-1">URL de Sincronización (Google Sheets)</label>
              <input type="text" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-2xl p-4 text-xs text-blue-400 outline-none focus:border-blue-500" value={config.googleSheetUrl} onChange={(e)=>setConfig({...config, googleSheetUrl: e.target.value})} placeholder="https://script.google.com/..."/>
            </div>
            <div className="space-y-2">
              <label className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-widest ml-1">Contraseña Administrador Principal</label>
              <div className="relative">
                <input type="text" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-2xl p-4 text-xs text-indigo-400 outline-none focus:border-indigo-500" value={config.adminPassword} onChange={(e)=>setConfig({...config, adminPassword: e.target.value})} />
                <Lock className="absolute right-4 top-1/2 -translate-y-1/2 text-slate-700" size={16}/>
              </div>
            </div>
          </div>
        </div>

        <button onClick={handleSaveConfig} disabled={isSaving} className={`w-full ${isSaving ? 'bg-slate-800 cursor-wait' : 'bg-blue-600 hover:bg-blue-500 active:scale-[0.98]'} text-white py-5 rounded-2xl font-black uppercase text-xs tracking-widest shadow-2xl transition-all flex items-center justify-center gap-3`}>
          {isSaving ? <div className="w-4 h-4 border-2 border-white/20 border-t-white rounded-full animate-spin"></div> : <Save size={18} />}
          {isSaving ? 'Guardando Cambios...' : 'Guardar Toda la Configuración'}
        </button>
      </div>
    </div>
  );

  return (
    <div className="flex h-[100dvh] bg-[var(--bg-color)] text-[var(--text-main)] overflow-hidden pt-[env(safe-area-inset-top,0px)] pb-[env(safe-area-inset-bottom,0px)]">
      {showSaveSuccess && (
        <div className="fixed top-8 left-1/2 -translate-x-1/2 z-[200] animate-fadeIn">
          <div className="bg-emerald-600 text-white px-6 py-3 rounded-full flex items-center gap-3 shadow-2xl border border-emerald-500/30">
            <Check size={18} strokeWidth={3} />
            <span className="text-xs font-black uppercase tracking-widest">Configuración Guardada</span>
          </div>
        </div>
      )}

      <aside className="hidden md:flex flex-col w-64 border-r border-[var(--panel-border)] p-6 gap-8 bg-[var(--panel-bg)]">
        <div className="flex items-center gap-3">
          <AppLogo size="sm" logoUrl={config.logoUrl} scale={config.logoScaleDashboard} />
          <h1 className="text-xs font-black tracking-tighter uppercase leading-tight">CARMAGNE<br/>INSTAL SL</h1>
        </div>
        <nav className="flex flex-col gap-2">
          {sidebarItems.map(item => {
            const isChatTab = item.id === 'chat';
            const unreadCount = isChatTab ? adminTotalUnreadCount : 0;
            return (
              <button 
                key={item.id} 
                onClick={() => setActiveTab(item.id as any)} 
                className={`flex items-center justify-between px-4 py-3 rounded-2xl text-sm font-bold transition w-full ${
                  activeTab === item.id 
                    ? 'bg-blue-600 text-white shadow-lg' 
                    : 'text-[var(--text-muted)] hover:text-white hover:bg-[var(--panel-bg)]'
                }`}
              >
                <div className="flex items-center gap-3">
                  <item.icon size={20} />
                  <span>{item.label}</span>
                </div>
                {unreadCount > 0 && (
                  <span className="bg-[#CCFF00] text-black text-[9px] font-black px-2 py-0.5 rounded-full shadow-[0_0_8px_rgba(204,255,0,0.5)]">
                    {unreadCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>
        <button onClick={() => setIsLogoutConfirmOpen(true)} className="mt-auto flex items-center gap-3 px-4 py-3 text-rose-500 font-bold hover:bg-rose-500/10 rounded-2xl transition">
          <LogOut size={20} /> Salir
        </button>
      </aside>

      <main className="flex-1 flex flex-col overflow-hidden relative">
        <header className="h-14 border-b border-[var(--panel-border)] flex items-center justify-between px-6 bg-[var(--panel-bg)] backdrop-blur-md shrink-0">
          <div className="flex items-center gap-3">
            <button onClick={() => setIsLogoutConfirmOpen(true)} className="md:hidden p-2 bg-[var(--panel-bg)] rounded-xl text-[var(--text-muted)]"><ArrowLeft size={18}/></button>
            <span className="text-xs font-black text-[var(--text-main)] uppercase tracking-widest leading-none">{activeTab}</span>
          </div>
          <div className="flex items-center gap-3">
             {theme && setTheme && (
               <button 
                 onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')} 
                 className="p-2 bg-[var(--btn-glass-bg)] border border-[var(--panel-border)] rounded-xl text-[var(--text-muted)] hover:text-[var(--text-main)] active:scale-95 transition-all mr-2"
                 title={theme === 'dark' ? "Modo Claro" : "Modo Oscuro"}
               >
                 {theme === 'dark' ? <Sun size={16} className="text-amber-400" /> : <Moon size={16} className="text-blue-400" />}
               </button>
             )}
             <div className="flex items-center gap-4">
                <div className="hidden sm:flex flex-col items-end">
                   <span className="text-[8px] font-black text-[var(--text-muted)] uppercase tracking-widest leading-none">Conectado como</span>
                   <span className="text-[10px] font-black text-blue-400 uppercase tracking-tighter">
                     {isSuperAdmin ? 'Admin Principal' : `Hola, ${currentUser?.username}`}
                   </span>
                </div>
                <div className="w-8 h-8 rounded-lg bg-blue-600/10 border border-blue-500/20 flex items-center justify-center text-blue-500">
                  <Shield size={16}/>
                </div>
             </div>
          </div>
        </header>

        <div className="flex-1 overflow-y-auto p-4 md:p-8 custom-scrollbar">
          {activeTab === 'dashboard' && renderDashboard()}
          {activeTab === 'workers' && (
            <div className="space-y-6 animate-fadeIn pb-32">
              <div className="flex flex-col sm:flex-row justify-between items-start sm:items-center gap-4">
                <div>
                  <h2 className="text-xl font-black text-[var(--text-main)] uppercase tracking-wide">Personal de Carmagne</h2>
                  <p className="text-[10px] font-bold text-[var(--text-muted)] uppercase tracking-widest">Gestión de operarios, perfiles profesionales y certificados</p>
                </div>
                <button 
                  onClick={() => handleOpenWorkerForm(null)} 
                  className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase px-4 py-3 rounded-xl flex items-center gap-2 active:scale-95 transition-all shadow-lg shadow-blue-600/20"
                >
                  <UserPlus size={16}/> Nuevo Operario
                </button>
              </div>

              {/* Barra de búsqueda */}
              <div className="relative">
                <input
                  type="text"
                  placeholder="Buscar operario por nombre..."
                  value={workerSearchQuery}
                  onChange={(e) => setWorkerSearchQuery(e.target.value)}
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-2xl py-3.5 pl-11 pr-4 text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500 transition-all shadow-inner"
                />
                <Search size={16} className="absolute left-4 top-1/2 -translate-y-1/2 text-[var(--text-muted)]" />
              </div>

              {/* Lista/Grid de operarios */}
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-4">
                {filteredWorkers.map(w => {
                  const isWorkerActive = w.active !== false;
                  return (
                    <div 
                      key={w.id} 
                      onClick={() => handleOpenWorkerProfile(w)}
                      className="group bg-[var(--panel-bg)] hover:bg-[var(--btn-glass-bg)]/10 rounded-3xl border border-[var(--panel-border)] hover:border-blue-500/30 p-5 flex flex-col gap-4 cursor-pointer transition-all duration-300 shadow-md hover:shadow-xl relative overflow-hidden"
                    >
                      <div className="flex items-start gap-4">
                        {/* Avatar / Foto */}
                        <div className="relative shrink-0">
                          {w.photoUrl ? (
                            <img 
                              src={w.photoUrl} 
                              alt={w.name} 
                              className="w-14 h-14 rounded-2xl object-cover border border-[var(--panel-border)] group-hover:border-blue-500/40 transition-colors"
                            />
                          ) : (
                            <div className="w-14 h-14 rounded-2xl bg-blue-600/10 border border-blue-500/20 text-blue-500 flex items-center justify-center">
                              <Users size={24} />
                            </div>
                          )}
                          <div className={`absolute -bottom-1 -right-1 w-4 h-4 rounded-full border-2 border-[#050505] flex items-center justify-center ${isWorkerActive ? 'bg-emerald-500' : 'bg-rose-500'}`} title={isWorkerActive ? 'Activo' : 'Inactivo'} />
                        </div>

                        {/* Detalles */}
                        <div className="space-y-1 min-w-0 flex-1">
                          <h4 className="font-black text-[var(--text-main)] text-sm uppercase truncate leading-snug group-hover:text-blue-400 transition-colors">{w.name}</h4>
                          <p className="text-[10px] text-[var(--text-muted)] font-black tracking-widest leading-none">{w.dni || 'S/DNI'}</p>
                          <div className="flex flex-wrap gap-1.5 mt-2">
                            <span className="text-[8px] font-black tracking-wider uppercase px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                              {w.role || 'Electricista'}
                            </span>
                            {w.phone && (
                              <span className="text-[8px] font-black tracking-wider uppercase px-2 py-0.5 rounded-md bg-blue-500/10 text-blue-400 border border-blue-500/20">
                                {w.phone}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>

                      {/* Info de Fichajes rápidos */}
                      <div className="pt-3 border-t border-[var(--panel-border)] flex items-center justify-between text-[9px] font-bold text-[var(--text-muted)] uppercase tracking-wide">
                        <span>Fichajes Totales: {logs.filter(l => l.workerId === w.id).length}</span>
                        <span>PIN: <span className="font-mono text-[var(--text-main)]">{w.pin || '0000'}</span></span>
                      </div>

                      {/* Botonera de acciones */}
                      <div className="flex gap-2 justify-end mt-1 pt-1">
                        <button 
                          onClick={(e) => {
                            e.stopPropagation();
                            setReportModal({ ...reportModal, isOpen: true, worker: w });
                          }} 
                          title="Fichajes y reporte de horas"
                          className="p-2 rounded-xl bg-emerald-500/10 hover:bg-emerald-500 text-emerald-500 hover:text-white transition-all duration-200"
                        >
                          <FileText size={16} />
                        </button>
                        <button 
                          onClick={(e) => handleOpenWorkerForm(w, e)} 
                          title="Editar operario"
                          className="p-2 rounded-xl bg-blue-500/10 hover:bg-blue-500 text-blue-500 hover:text-white transition-all duration-200"
                        >
                          <Pencil size={16} />
                        </button>
                        <button 
                          onClick={async (e) => {
                            e.stopPropagation();
                            if (confirm(`¿Estás seguro de que deseas eliminar permanentemente a ${w.name}?`)) {
                              await StorageService.deleteWorker(w.id);
                            }
                          }} 
                          title="Eliminar operario"
                          className="p-2 rounded-xl bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white transition-all duration-200"
                        >
                          <Trash2 size={16} />
                        </button>
                      </div>
                    </div>
                  );
                })}
              </div>

              {filteredWorkers.length === 0 && (
                <div className="text-center p-12 bg-[var(--panel-bg)] rounded-3xl border border-[var(--panel-border)]">
                  <Users className="mx-auto text-[var(--text-muted)] mb-3" size={32} />
                  <p className="text-sm font-bold text-[var(--text-muted)] uppercase">No se encontraron operarios</p>
                </div>
              )}
            </div>
          )}
          {activeTab === 'hours' && renderHoursReport()}
          {activeTab === 'sites' && (
            <div className="space-y-4 animate-fadeIn pb-32">
              <div className="flex justify-between items-center"><h2 className="text-xl font-black text-[var(--text-main)] uppercase">Obras</h2><button onClick={() => handleOpenSiteModal()} className="bg-emerald-600 p-3 rounded-xl text-white"><Plus size={20}/></button></div>
              <div className="grid gap-3">{filteredSites.map(s=>(<div key={s.id} className="bg-[var(--panel-bg)] p-4 rounded-3xl border border-[var(--panel-border)] flex justify-between items-center active:bg-slate-800"><div className="flex items-center gap-3"><div className="w-10 h-10 rounded-2xl bg-emerald-500/10 text-emerald-500 flex items-center justify-center"><MapPin size={18}/></div><div className="max-w-[150px]"><p className="font-black text-[var(--text-main)] text-sm truncate uppercase leading-tight">{s.name}</p><p className="text-[9px] text-[var(--text-muted)] font-bold uppercase truncate">{s.address}</p></div></div><div className="flex gap-1"><button onClick={()=>handleOpenSiteModal(s)} className="p-2 text-[var(--text-muted)]"><Pencil size={20}/></button><button onClick={()=>StorageService.deleteSite(s.id)} className="p-2 text-rose-500"><Trash2 size={20}/></button></div></div>))}</div>
            </div>
          )}
          {activeTab === 'logs' && renderLogs()}
          {activeTab === 'tools' && renderTools()}
          {activeTab === 'reports' && renderReports()}
          {activeTab === 'payslips' && renderPayslips()}
          {activeTab === 'chat' && renderChat()}
          {activeTab === 'admins' && isSuperAdmin && (
             <div className="space-y-6 animate-fadeIn pb-32"><div className="flex justify-between items-center"><h2 className="text-xl font-black text-[var(--text-main)] uppercase">Cuentas Admin</h2><button onClick={() => setIsAdminModalOpen(true)} className="bg-indigo-600 p-3 rounded-xl text-white"><UserPlus size={20} /></button></div><div className="grid gap-3">{admins.map(admin => (<div key={admin.id} className="bg-[var(--panel-bg)] p-4 rounded-3xl border border-[var(--panel-border)] flex justify-between items-center"><div className="flex items-center gap-4"><div className="w-10 h-10 rounded-2xl bg-indigo-500/10 text-indigo-600 dark:text-indigo-400 flex items-center justify-center border border-indigo-500/20"><KeyRound size={20} /></div><div><h3 className="text-sm font-black text-[var(--text-main)]">{admin.username}</h3><p className="text-[10px] text-[var(--text-muted)] font-bold uppercase tracking-widest">Gestor</p></div></div><button onClick={() => StorageService.deleteAdmin(admin.id)} className="p-2 text-rose-500"><Trash2 size={20} /></button></div>))}</div></div>
          )}
          {activeTab === 'settings' && isSuperAdmin && renderSettings()}
        </div>

        <nav className="md:hidden fixed bottom-0 left-0 right-0 bg-[var(--panel-bg)] backdrop-blur-2xl border-t border-[var(--panel-border)] flex items-center justify-start gap-6 overflow-x-auto py-3 px-5 z-50 shadow-2xl scrollbar-none whitespace-nowrap pb-[calc(0.75rem+env(safe-area-inset-bottom,0px))]">
          {sidebarItems.map(item => {
            const isChatTab = item.id === 'chat';
            const unreadCount = isChatTab ? adminTotalUnreadCount : 0;
            return (
              <button 
                key={item.id} 
                onClick={() => setActiveTab(item.id as any)} 
                className={`flex flex-col items-center gap-1 shrink-0 transition-all relative ${
                  activeTab === item.id ? 'text-blue-500' : 'text-[var(--text-muted)]'
                }`}
              >
                <div className="relative">
                  <item.icon size={20} className={activeTab === item.id ? 'drop-shadow-[0_0_8px_rgba(59,130,246,0.5)]' : ''} />
                  {unreadCount > 0 && (
                    <span className="absolute -top-1.5 -right-1.5 bg-[#CCFF00] text-black text-[8px] font-black w-4.5 h-4.5 rounded-full flex items-center justify-center border border-black shadow-[0_0_5px_rgba(204,255,0,0.5)]">
                      {unreadCount}
                    </span>
                  )}
                </div>
                <span className="text-[7px] font-black uppercase tracking-tighter">{item.label}</span>
              </button>
            );
          })}
        </nav>
      </main>

      {isToolModalOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-[var(--modal-bg)] w-full max-w-sm rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative">
            <div className="flex justify-between items-center mb-6"><div><h3 className="text-lg font-black text-[var(--modal-text-main)] uppercase tracking-tighter">{editingTool ? 'Editar Equipo' : 'Nuevo Equipo'}</h3><p className="text-amber-500 text-[10px] font-bold uppercase">Gestión Inventario</p></div><button onClick={() => setIsToolModalOpen(false)} className="text-[var(--modal-text-muted)] p-2"><X size={20}/></button></div>
            <div className="space-y-4">
              <input type="text" placeholder="Nombre de Herramienta" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-4 text-sm text-[var(--text-main)] outline-none focus:border-amber-500" value={toolForm.toolName} onChange={(e)=>setToolForm({...toolForm, toolName: e.target.value})}/>
              <input type="text" placeholder="Marca" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-4 text-sm text-[var(--text-main)] outline-none focus:border-amber-500" value={toolForm.brand} onChange={(e)=>setToolForm({...toolForm, brand: e.target.value})}/>
              <select className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-4 text-sm text-[var(--text-main)] outline-none focus:border-amber-500" value={toolForm.workerId} onChange={(e)=>setToolForm({...toolForm, workerId: e.target.value})}><option value="">Responsable...</option>{workers.map(w=><option key={w.id} value={w.id}>{w.name}</option>)}</select>
              <select className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-4 text-sm text-[var(--text-main)] outline-none focus:border-amber-500" value={toolForm.siteId} onChange={(e)=>setToolForm({...toolForm, siteId: e.target.value})}><option value="">Obra (Opcional)...</option>{sites.map(s=><option key={s.id} value={s.id}>{s.name}</option>)}</select>
              {toolModalError && <p className="text-rose-500 text-[10px] font-bold text-center uppercase">{toolModalError}</p>}
              <button onClick={handleSaveTool} className="w-full bg-amber-600 text-white py-4 rounded-xl font-black uppercase text-xs shadow-lg active:scale-95 transition">Guardar Equipo</button>
            </div>
          </div>
        </div>
      )}

      {isSiteModalOpen && (<div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn"><div className="bg-[var(--modal-bg)] w-full max-w-sm rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative overflow-hidden"><div className="flex justify-between items-center mb-6"><div><h3 className="text-lg font-black text-[var(--modal-text-main)] uppercase tracking-tighter">{editingSite ? 'Editar Obra' : 'Nueva Obra'}</h3><p className="text-emerald-500 text-[10px] font-bold uppercase tracking-widest">Ubicación</p></div><button onClick={() => setIsSiteModalOpen(false)} className="text-[var(--modal-text-muted)] hover:text-[var(--modal-text-main)] p-2"><X size={20} /></button></div><div className="space-y-4"><input type="text" placeholder="Obra" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-2xl p-4 text-sm text-[var(--text-main)]" value={siteForm.name} onChange={(e) => setSiteForm({ ...siteForm, name: e.target.value })}/><textarea placeholder="Dirección" className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-2xl p-4 text-sm text-[var(--text-main)] h-20 resize-none" value={siteForm.address} onChange={(e) => setSiteForm({ ...siteForm, address: e.target.value })}/><button onClick={handleSaveSite} className="w-full bg-emerald-600 text-white py-4 rounded-2xl font-black uppercase text-xs mt-2">{editingSite ? 'Guardar' : 'Crear'}</button></div></div></div>)}

      {reportModal.isOpen && (
        <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-[var(--modal-bg)] w-full max-w-sm rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative">
             <h3 className="text-lg font-black text-[var(--modal-text-main)] uppercase mb-6 leading-none tracking-tighter">Generar Informe PDF</h3>
             <div className="space-y-4">
                <div className="flex gap-2"><button onClick={()=>setReportModal({...reportModal, type:'WEEK'})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition ${reportModal.type==='WEEK'?'bg-blue-600 text-white shadow-lg':'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>Semanal</button><button onClick={()=>setReportModal({...reportModal, type:'MONTH'})} className={`flex-1 py-3 rounded-xl text-xs font-black uppercase transition ${reportModal.type==='MONTH'?'bg-blue-600 text-white shadow-lg':'bg-[var(--input-bg)] text-[var(--text-muted)]'}`}>Mensual</button></div>
                {reportModal.type==='WEEK'?(<input type="date" value={reportModal.selectedDate} onChange={(e)=>setReportModal({...reportModal, selectedDate: e.target.value})} className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] [color-scheme:dark]"/>):(<select value={reportModal.selectedMonth} onChange={(e)=>setReportModal({...reportModal, selectedMonth: parseInt(e.target.value)})} className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] appearance-none">{MONTH_NAMES.map((m,i)=>(<option key={m} value={i}>{m}</option>))}</select>)}
                <button onClick={handleGenerateWorkerReport} className="w-full bg-emerald-600 text-white py-4 rounded-xl font-black uppercase text-xs flex items-center justify-center gap-2 active:scale-95 shadow-xl transition"><Download size={18}/> Descargar Informe</button>
                <button onClick={()=>setReportModal({...reportModal, isOpen: false})} className="w-full text-[var(--modal-text-muted)] text-[10px] font-black uppercase mt-2">Cancelar</button>
             </div>
          </div>
        </div>
      )}
      
      <ConfirmationModal isOpen={!!logToDelete} title="Borrar Registro" message="¿Estás seguro de que quieres eliminar este registro? Esta acción no se puede deshacer." confirmText="Borrar" isDestructive={true} onConfirm={handleDeleteLog} onCancel={() => setLogToDelete(null)} />
      
      <ConfirmationModal isOpen={isClearLogsConfirmOpen} title="Vaciar Todo el Historial" message="¡ATENCIÓN! Vas a eliminar TODOS los registros de actividad del sistema. Esta acción es definitiva." confirmText="VACIAR TODO" isDestructive={true} onConfirm={handleClearAllLogs} onCancel={() => setIsClearLogsConfirmOpen(false)} />

      <ConfirmationModal isOpen={isLogoutConfirmOpen} title="¿Cerrar Sesión?" message="Vas a salir del panel de administración." confirmText="Salir" cancelText="Permanecer" isDestructive={true} onConfirm={() => { setIsLogoutConfirmOpen(false); onBack(); }} onCancel={() => setIsLogoutConfirmOpen(false)} />

      {/* MODAL: PERFIL COMPLETO DE TRABAJADOR */}
      {isWorkerProfileModalOpen && selectedWorkerProfile && (() => {
        const pWorkerLogs = logs.filter(l => l.workerId === selectedWorkerProfile.id);
        const pUniqueSites = Array.from(new Set(pWorkerLogs.map(l => l.siteName)));
        
        // Calcular horas del mes actual
        const currentMonthLogs = pWorkerLogs.filter(l => {
          const parts = l.dateStr.split('/');
          if (parts.length < 3) return false;
          const day = parseInt(parts[0], 10);
          const month = parseInt(parts[1], 10);
          const year = parseInt(parts[2], 10);
          const logDate = new Date(year, month - 1, day);
          const now = new Date();
          return logDate.getMonth() === now.getMonth() && logDate.getFullYear() === now.getFullYear();
        });
        
        // Calcular horas del mes actual agrupado por día
        const currentMonthGrouped: Record<string, WorkLog[]> = {};
        currentMonthLogs.forEach(log => {
          if (!currentMonthGrouped[log.dateStr]) currentMonthGrouped[log.dateStr] = [];
          currentMonthGrouped[log.dateStr].push(log);
        });
        
        let totalWorkedMsThisMonth = 0;
        Object.values(currentMonthGrouped).forEach(dayLogs => {
          const { totalWork } = calculateTotalsFromLogs(dayLogs);
          totalWorkedMsThisMonth += totalWork;
        });
        const totalWorkedHoursThisMonth = (totalWorkedMsThisMonth / 3600000).toFixed(1);

        const absences = getAbsencesForWorker(selectedWorkerProfile.id);

        return (
          <div className="fixed inset-0 z-[100] bg-black/80 backdrop-blur-xl flex items-center justify-center p-4 sm:p-6 animate-fadeIn">
            <div className="bg-[var(--modal-bg)] w-full max-w-2xl rounded-[2.5rem] border border-[var(--modal-border)] flex flex-col max-h-[90vh] shadow-2xl overflow-hidden relative">
              {/* Header */}
              <div className="p-6 sm:p-8 border-b border-[var(--panel-border)] flex flex-col sm:flex-row gap-6 items-center sm:items-start justify-between relative bg-gradient-to-r from-blue-900/10 to-transparent">
                <button 
                  onClick={() => setIsWorkerProfileModalOpen(false)} 
                  className="absolute top-6 right-6 text-[var(--modal-text-muted)] hover:text-white p-2 rounded-full hover:bg-[var(--btn-glass-bg)] transition-colors"
                >
                  <X size={20}/>
                </button>

                <div className="flex flex-col sm:flex-row gap-5 items-center sm:items-start text-center sm:text-left">
                  {/* Foto con trigger de cambio rápido */}
                  <div className="relative group cursor-pointer" onClick={() => workerPhotoInputRef.current?.click()}>
                    {selectedWorkerProfile.photoUrl ? (
                      <img 
                        src={selectedWorkerProfile.photoUrl} 
                        alt={selectedWorkerProfile.name} 
                        className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl object-cover border-2 border-blue-500/30 group-hover:border-blue-500 transition-colors"
                      />
                    ) : (
                      <div className="w-24 h-24 sm:w-28 sm:h-28 rounded-3xl bg-blue-600/10 border-2 border-dashed border-blue-500/20 text-blue-500 flex flex-col items-center justify-center group-hover:border-blue-500 transition-all">
                        <Users size={36} />
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

                  <div className="space-y-1">
                    <div className="flex items-center gap-2.5 justify-center sm:justify-start">
                      <h3 className="text-xl sm:text-2xl font-black text-[var(--modal-text-main)] uppercase tracking-tight">{selectedWorkerProfile.name}</h3>
                      <span className={`w-2.5 h-2.5 rounded-full ${selectedWorkerProfile.active !== false ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                    </div>
                    <p className="text-[10px] text-[var(--modal-text-muted)] font-bold tracking-widest uppercase">
                      ID: <span className="font-mono text-[var(--modal-text-main)]">{selectedWorkerProfile.id}</span>
                    </p>
                    <div className="flex flex-wrap gap-2 justify-center sm:justify-start mt-3">
                      <span className="text-[9px] font-black tracking-wider uppercase px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20">
                        {selectedWorkerProfile.role || 'Electricista'}
                      </span>
                      {selectedWorkerProfile.phone && (
                        <span className="text-[9px] font-black tracking-wider uppercase px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                          <Phone size={10} /> {selectedWorkerProfile.phone}
                        </span>
                      )}
                      {selectedWorkerProfile.email && (
                        <span className="text-[9px] font-black tracking-wider px-2.5 py-1 rounded-lg bg-blue-500/10 text-blue-400 border border-blue-500/20 flex items-center gap-1">
                          <Mail size={10} /> {selectedWorkerProfile.email}
                        </span>
                      )}
                    </div>
                  </div>
                </div>

                <div className="flex gap-2 shrink-0 sm:self-end mt-4 sm:mt-0">
                  <button 
                    onClick={() => handleOpenWorkerForm(selectedWorkerProfile)}
                    className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl flex items-center gap-1.5 active:scale-95 transition-all shadow-lg shadow-blue-600/10"
                  >
                    <Pencil size={14}/> Editar Datos
                  </button>
                </div>
              </div>

              {/* Selector de Pestañas */}
              <div className="flex border-b border-[var(--panel-border)] bg-[var(--input-bg)] px-4">
                {(['details', 'hours', 'certs', 'absences'] as const).map(tab => {
                  const labels = {
                    details: 'Ficha Técnica',
                    hours: 'Horas y Obras',
                    certs: 'Certificados',
                    absences: 'Faltas / Inasistencias'
                  };
                  return (
                    <button
                      key={tab}
                      onClick={() => setSelectedProfileTab(tab)}
                      className={`flex-1 sm:flex-none px-4 py-4 text-xs font-bold uppercase tracking-wider border-b-2 text-center transition-all ${selectedProfileTab === tab ? 'border-blue-500 text-blue-400' : 'border-transparent text-[var(--modal-text-muted)] hover:text-white'}`}
                    >
                      {labels[tab]}
                    </button>
                  );
                })}
              </div>

              {/* Contenido / Body */}
              <div className="flex-1 overflow-y-auto p-6 sm:p-8 custom-scrollbar space-y-6">
                {selectedProfileTab === 'details' && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-4 animate-fadeIn">
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">DNI / NIE</p>
                      <p className="text-sm font-black text-[var(--modal-text-main)] uppercase mt-1">{selectedWorkerProfile.dni || 'S/DNI'}</p>
                    </div>
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Teléfono móvil</p>
                      <p className="text-sm font-black text-[var(--modal-text-main)] uppercase mt-1">{selectedWorkerProfile.phone || 'No registrado'}</p>
                    </div>
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Correo Electrónico</p>
                      <p className="text-sm font-black text-[var(--modal-text-main)] mt-1 break-all">{selectedWorkerProfile.email || 'No registrado'}</p>
                    </div>
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Código PIN de Fichaje</p>
                      <p className="text-sm font-mono font-black text-[var(--modal-text-main)] mt-1">{selectedWorkerProfile.pin || '0000'}</p>
                    </div>
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Código QR asignado</p>
                      <p className="text-sm font-mono font-black text-blue-400 mt-1 truncate">{selectedWorkerProfile.qrCode || 'S/QR'}</p>
                    </div>
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Modo de trabajo por defecto</p>
                      <p className="text-sm font-black text-[var(--modal-text-main)] uppercase mt-1">{selectedWorkerProfile.defaultMode || 'HORAS'}</p>
                    </div>
                    <div className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)]">
                      <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Estado del perfil</p>
                      <p className="text-sm font-black text-[var(--modal-text-main)] uppercase mt-1 flex items-center gap-1.5">
                        <span className={`w-2 h-2 rounded-full ${selectedWorkerProfile.active !== false ? 'bg-emerald-500' : 'bg-rose-500'}`} />
                        {selectedWorkerProfile.active !== false ? 'Activo (Autorizado)' : 'Inactivo (Suspendido)'}
                      </p>
                    </div>
                  </div>
                )}

                {selectedProfileTab === 'hours' && (
                  <div className="space-y-6 animate-fadeIn">
                    {/* Tarjeta de Resumen */}
                    <div className="grid grid-cols-2 gap-4">
                      <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)]">
                        <h5 className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Horas este mes</h5>
                        <p className="text-2xl font-black text-blue-400 mt-2">{totalWorkedHoursThisMonth} h</p>
                        <p className="text-[8px] text-[var(--modal-text-muted)] font-black uppercase mt-1">Horas totales trabajadas en {MONTH_NAMES[new Date().getMonth()]}</p>
                      </div>
                      <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)]">
                        <h5 className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-widest">Obras visitadas</h5>
                        <p className="text-2xl font-black text-emerald-400 mt-2">{pUniqueSites.length}</p>
                        <p className="text-[8px] text-[var(--modal-text-muted)] font-black uppercase mt-1">Obras con al menos un registro</p>
                      </div>
                    </div>

                    {/* Obras donde ha trabajado */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-[var(--modal-text-main)] uppercase tracking-widest">Obras donde ha trabajado</h4>
                      {pUniqueSites.length > 0 ? (
                        <div className="flex flex-wrap gap-2">
                          {pUniqueSites.map(site => (
                            <span key={site} className="text-[9px] font-bold uppercase tracking-wide px-3 py-1.5 rounded-xl bg-emerald-500/10 text-emerald-400 border border-emerald-500/20 flex items-center gap-1">
                              <MapPin size={10} /> {site}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] font-bold text-[var(--modal-text-muted)] uppercase">Ninguna obra registrada aún.</p>
                      )}
                    </div>

                    {/* Últimos fichajes */}
                    <div className="space-y-2">
                      <h4 className="text-xs font-black text-[var(--modal-text-main)] uppercase tracking-widest">Últimos 5 registros de actividad</h4>
                      {pWorkerLogs.length > 0 ? (
                        <div className="space-y-1.5">
                          {pWorkerLogs.slice(0, 5).map(log => (
                            <div key={log.id} className="bg-[var(--panel-bg)] p-3 rounded-xl border border-[var(--panel-border)] flex justify-between items-center text-xs">
                              <div className="flex items-center gap-3">
                                <LogIcon type={log.type} size={14} />
                                <div>
                                  <p className="font-bold text-[var(--modal-text-main)] uppercase tracking-tight">{log.type}</p>
                                  <p className="text-[8px] text-[var(--modal-text-muted)] font-bold uppercase">{log.siteName}</p>
                                </div>
                              </div>
                              <div className="text-right">
                                <p className="font-black text-[var(--modal-text-main)]">{log.dateStr}</p>
                                <p className="text-[8px] text-[var(--modal-text-muted)] font-bold uppercase">{log.timeStr}</p>
                              </div>
                            </div>
                          ))}
                        </div>
                      ) : (
                        <p className="text-[10px] font-bold text-[var(--modal-text-muted)] uppercase">No hay fichajes disponibles en el historial.</p>
                      )}
                    </div>
                  </div>
                )}

                {selectedProfileTab === 'certs' && (
                  <div className="space-y-6 animate-fadeIn">
                    {/* Formulario rápido para subir certificado */}
                    <div className="bg-[var(--panel-bg)] p-5 rounded-3xl border border-[var(--panel-border)] space-y-4">
                      <div>
                        <h4 className="text-xs font-black text-[var(--modal-text-main)] uppercase tracking-widest">Añadir Certificado o Documento</h4>
                        <p className="text-[8px] font-bold text-[var(--modal-text-muted)] uppercase mt-0.5">Sube sus certificados de prevención, aptitud médica, carnet de conducir, etc.</p>
                      </div>

                      <div className="flex flex-col sm:flex-row gap-3">
                        <input 
                          type="text" 
                          placeholder="Nombre descriptivo (Ej: Prevención 20h)" 
                          value={certNameInput}
                          onChange={(e) => setCertNameInput(e.target.value)}
                          className="flex-1 bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl px-4 py-2.5 text-xs text-[var(--text-main)] placeholder-[var(--text-muted)] focus:outline-none focus:border-blue-500"
                        />
                        <button 
                          onClick={() => certFileInputRef.current?.click()}
                          className="bg-blue-600 hover:bg-blue-700 text-white font-bold text-xs uppercase px-4 py-2.5 rounded-xl flex items-center justify-center gap-1 active:scale-95 transition-all shadow-md shrink-0"
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

                    {/* Lista de certificados */}
                    <div className="space-y-2">
                      <div className="flex justify-between items-center bg-black/30 p-2 rounded-xl border border-[var(--panel-border)] mb-1">
                        <h4 className="text-[10px] font-black text-[var(--modal-text-main)] uppercase tracking-widest">Acreditaciones y Certificados</h4>
                        {selectedWorkerProfile.certificates && selectedWorkerProfile.certificates.length > 0 && (
                          <button
                            onClick={() => setEmailModal({
                              isOpen: true,
                              worker: selectedWorkerProfile,
                              selectedCertIds: selectedWorkerProfile.certificates!.map(c => c.id),
                              to: '',
                              subject: `Acreditaciones Laborales - ${selectedWorkerProfile.name} - CARMAGNE INSTAL SL`,
                              body: `Estimado Cliente,\n\nAdjunto le hacemos llegar las acreditaciones, certificados y documentación médica del operario ${selectedWorkerProfile.name} correspondientes a los requisitos de acceso solicitados.\n\nAtentamente,\nControl de Administración\nCARMAGNE INSTAL SL.`
                            })}
                            className="bg-[#CCFF00] hover:bg-yellow-400 text-black font-black text-[9px] uppercase px-3 py-1.5 rounded-lg flex items-center gap-1.5 shadow-[0_0_10px_rgba(204,255,0,0.2)] hover:shadow-[0_0_15px_rgba(204,255,0,0.4)] transition-all active:scale-95"
                          >
                            <Mail size={12} /> Enviar por Email (Gmail)
                          </button>
                        )}
                      </div>
                      {selectedWorkerProfile.certificates && selectedWorkerProfile.certificates.length > 0 ? (
                        <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                          {selectedWorkerProfile.certificates.map(cert => (
                            <div key={cert.id} className="bg-[var(--panel-bg)] p-4 rounded-2xl border border-[var(--panel-border)] flex flex-col justify-between gap-3 hover:border-blue-500/20 transition-all">
                              <div>
                                <h5 className="font-black text-[var(--modal-text-main)] text-xs uppercase tracking-tight truncate" title={cert.name}>{cert.name}</h5>
                                <p className="text-[8px] text-[var(--modal-text-muted)] font-bold uppercase mt-1">Subido: {cert.uploadDate} {cert.size && `• ${cert.size}`}</p>
                              </div>
                              <div className="flex gap-2 justify-end">
                                <a 
                                  href={cert.fileBase64 || '#'} 
                                  download={cert.name}
                                  onClick={async (e) => {
                                    if (!cert.fileBase64 || cert.fileBase64.length < 50) {
                                      e.preventDefault();
                                      const base64 = await StorageService.getCertificateBase64(cert.id);
                                      if (base64) {
                                        const link = document.createElement('a');
                                        link.href = base64;
                                        link.download = cert.name;
                                        link.click();
                                      } else {
                                        alert("No se pudo cargar el archivo del certificado desde Firebase.");
                                      }
                                    }
                                  }}
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
                        <div className="text-center p-8 bg-zinc-900/10 border border-dashed border-[var(--panel-border)] rounded-2xl">
                          <FileText className="mx-auto text-[var(--modal-text-muted)] mb-2" size={24} />
                          <p className="text-[9px] font-bold text-[var(--modal-text-muted)] uppercase tracking-wider">No se han subido certificados para este operario</p>
                        </div>
                      )}
                    </div>
                  </div>
                )}

                {selectedProfileTab === 'absences' && (
                  <div className="space-y-4 animate-fadeIn">
                    <div>
                      <h4 className="text-xs font-black text-[var(--modal-text-main)] uppercase tracking-widest">Días no trabajados (Inasistencias)</h4>
                      <p className="text-[8px] font-bold text-[var(--modal-text-muted)] uppercase mt-0.5">Días laborables (Lunes a Sábado) del mes actual en los que NO se ha registrado ningún fichaje</p>
                    </div>

                    <div className="bg-rose-500/10 border border-rose-500/20 p-4 rounded-2xl flex items-center gap-3">
                      <AlertCircle size={20} className="text-rose-500 shrink-0" />
                      <div className="text-xs">
                        <p className="font-black text-rose-500 uppercase tracking-tight">Resumen mensual de ausencias</p>
                        <p className="text-[9px] text-[var(--modal-text-muted)] uppercase font-bold mt-0.5">
                          Este mes ({MONTH_NAMES[new Date().getMonth()]}) se registran <span className="text-[var(--modal-text-main)] font-black">{absences.length} días</span> laborables sin fichaje de entrada.
                        </p>
                      </div>
                    </div>

                    {absences.length > 0 ? (
                      <div className="grid grid-cols-2 sm:grid-cols-3 gap-2.5">
                        {absences.map(abs => (
                          <div key={abs.dateStr} className="bg-[var(--panel-bg)] p-3 rounded-xl border border-rose-500/10 text-center flex flex-col justify-center">
                            <p className="text-[10px] font-black text-rose-400 uppercase tracking-tight">{abs.weekday}</p>
                            <p className="text-xs font-mono font-black text-[var(--modal-text-main)] mt-1">{abs.dateStr}</p>
                            <span className="text-[7px] font-black uppercase tracking-widest text-zinc-600 mt-2">Ausente</span>
                          </div>
                        ))}
                      </div>
                    ) : (
                      <div className="text-center p-8 bg-emerald-500/5 border border-dashed border-emerald-500/20 rounded-2xl">
                        <CheckCircle2 className="mx-auto text-emerald-500 mb-2" size={24} />
                        <p className="text-[9px] font-bold text-emerald-500 uppercase tracking-wider">Asistencia Perfecta. ¡No tiene ausencias registradas este mes!</p>
                      </div>
                    )}
                  </div>
                )}
              </div>

              {/* Footer */}
              <div className="p-4 sm:p-6 border-t border-[var(--panel-border)] bg-[var(--input-bg)] flex justify-end">
                <button 
                  onClick={() => setIsWorkerProfileModalOpen(false)}
                  className="bg-zinc-800 hover:bg-zinc-700 text-white font-bold text-xs uppercase px-5 py-3 rounded-xl active:scale-95 transition-all"
                >
                  Cerrar Perfil
                </button>
              </div>
            </div>
          </div>
        );
      })()}

      {/* MODAL: FORMULARIO CREAR / EDITAR TRABAJADOR */}
      {isWorkerFormModalOpen && (
        <div className="fixed inset-0 z-[110] bg-black/90 backdrop-blur-2xl flex items-center justify-center p-6 animate-fadeIn">
          <div className="bg-[var(--modal-bg)] w-full max-w-sm rounded-[2.5rem] border border-[var(--modal-border)] p-8 shadow-2xl relative overflow-hidden">
            <div className="flex justify-between items-center mb-6">
              <div>
                <h3 className="text-lg font-black text-[var(--modal-text-main)] uppercase tracking-tighter">
                  {editingWorker ? 'Editar Operario' : 'Nuevo Operario'}
                </h3>
                <p className="text-blue-500 text-[10px] font-bold uppercase tracking-widest">
                  Ficha de Personal
                </p>
              </div>
              <button 
                onClick={() => setIsWorkerFormModalOpen(false)} 
                className="text-[var(--modal-text-muted)] hover:text-white p-2"
              >
                <X size={20}/>
              </button>
            </div>

            <div className="space-y-4">
              {/* Foto en formulario */}
              <div className="flex justify-center mb-2">
                <div 
                  onClick={() => workerPhotoInputRef.current?.click()}
                  className="relative cursor-pointer group animate-pulse"
                  title="Asignar foto de perfil"
                >
                  {workerForm.photoUrl ? (
                    <div className="relative">
                      <img 
                        src={workerForm.photoUrl} 
                        alt="Profile form" 
                        className="w-20 h-20 rounded-2xl object-cover border border-[var(--panel-border)]"
                      />
                      <button 
                        type="button"
                        onClick={(e) => {
                          e.stopPropagation();
                          setWorkerForm(prev => ({ ...prev, photoUrl: '' }));
                        }}
                        className="absolute -top-1 -right-1 bg-rose-500 text-white rounded-full p-1 shadow-lg active:scale-90"
                      >
                        <X size={10} />
                      </button>
                    </div>
                  ) : (
                    <div className="w-20 h-20 rounded-2xl bg-blue-600/10 border border-dashed border-blue-500/20 flex flex-col items-center justify-center text-blue-500 hover:border-blue-500 transition-all">
                      <ImageIcon size={20} />
                      <span className="text-[7px] font-black uppercase mt-1">Foto</span>
                    </div>
                  )}
                </div>
              </div>

              {/* Form Inputs */}
              <div>
                <label className="text-[8px] font-black text-[var(--modal-text-muted)] uppercase tracking-widest mb-1 block">Nombre Completo *</label>
                <input 
                  type="text" 
                  placeholder="Ej: Juan Pérez" 
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none focus:border-blue-500" 
                  value={workerForm.name} 
                  onChange={(e) => setWorkerForm({ ...workerForm, name: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[8px] font-black text-[var(--modal-text-muted)] uppercase tracking-widest mb-1 block">DNI / NIE / Pasaporte</label>
                <input 
                  type="text" 
                  placeholder="Ej: 12345678Z" 
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none focus:border-blue-500 uppercase" 
                  value={workerForm.dni} 
                  onChange={(e) => setWorkerForm({ ...workerForm, dni: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[8px] font-black text-[var(--modal-text-muted)] uppercase tracking-widest mb-1 block">Teléfono Móvil (+34)</label>
                <input 
                  type="tel" 
                  placeholder="Ej: 600123456" 
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none focus:border-blue-500" 
                  value={workerForm.phone} 
                  onChange={(e) => setWorkerForm({ ...workerForm, phone: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[8px] font-black text-[var(--modal-text-muted)] uppercase tracking-widest mb-1 block">Correo Electrónico *</label>
                <input 
                  type="email" 
                  placeholder="Ej: operario@carmagne.com" 
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none focus:border-blue-500" 
                  value={workerForm.email} 
                  onChange={(e) => setWorkerForm({ ...workerForm, email: e.target.value })}
                />
              </div>

              <div>
                <label className="text-[8px] font-black text-[var(--modal-text-muted)] uppercase tracking-widest mb-1 block">PIN de Acceso (4 Dígitos)</label>
                <input 
                  type="text" 
                  placeholder="Ej: 1234" 
                  maxLength={4}
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] font-mono outline-none focus:border-blue-500" 
                  value={workerForm.pin} 
                  onChange={(e) => setWorkerForm({ ...workerForm, pin: e.target.value.replace(/\D/g, '') })}
                />
              </div>

              <div>
                <label className="text-[8px] font-black text-[var(--modal-text-muted)] uppercase tracking-widest mb-1 block">Puesto / Rol Profesional</label>
                <select 
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3 text-xs text-[var(--text-main)] outline-none focus:border-blue-500" 
                  value={workerForm.role} 
                  onChange={(e) => setWorkerForm({ ...workerForm, role: e.target.value })}
                >
                  <option value="Electricista">Electricista</option>
                  <option value="Oficial de 1ª">Oficial de 1ª</option>
                  <option value="Oficial de 2ª">Oficial de 2ª</option>
                  <option value="Encargado de Obra">Encargado de Obra</option>
                  <option value="Peón">Peón</option>
                  <option value="Administración">Administración</option>
                </select>
              </div>

              <div className="flex items-center gap-2 pt-1">
                <input 
                  type="checkbox" 
                  id="workerActiveCheckbox"
                  className="rounded border-[var(--panel-border)] bg-[var(--input-bg)] accent-blue-600"
                  checked={workerForm.active}
                  onChange={(e) => setWorkerForm({ ...workerForm, active: e.target.checked })}
                />
                <label htmlFor="workerActiveCheckbox" className="text-[10px] font-bold text-[var(--modal-text-main)] uppercase tracking-wider select-none cursor-pointer">Autorizar acceso (Activo)</label>
              </div>

              {workerFormError && (
                <p className="text-rose-500 text-[9px] font-black text-center uppercase tracking-wider mt-2">
                  {workerFormError}
                </p>
              )}

              <div className="flex gap-2 pt-2">
                <button 
                  onClick={() => setIsWorkerFormModalOpen(false)}
                  className="flex-1 bg-zinc-800 text-white py-3.5 rounded-xl font-black uppercase text-[10px] active:scale-95 transition"
                >
                  Cancelar
                </button>
                <button 
                  onClick={handleSaveWorker} 
                  className="flex-1 bg-blue-600 hover:bg-blue-700 text-white py-3.5 rounded-xl font-black uppercase text-[10px] shadow-lg shadow-blue-600/10 active:scale-95 transition"
                >
                  {editingWorker ? 'Guardar' : 'Crear'}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* MEJORAS: Modal para enviar certificados por correo (Google Gmail) */}
      {emailModal.isOpen && emailModal.worker && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-xl flex items-center justify-center p-4 animate-fadeIn">
          <div className="bg-[#050505] w-full max-w-lg rounded-3xl border border-[var(--modal-border)] p-8 shadow-2xl relative max-h-[90vh] overflow-y-auto custom-scrollbar space-y-6">
            <div className="flex justify-between items-center border-b border-[var(--panel-border)] pb-4">
              <div>
                <h3 className="text-xl font-bebas text-emerald-600 dark:text-emerald-400 uppercase">Enviar Documentación</h3>
                <p className="text-[var(--text-muted)] text-[10px] font-bold uppercase text-[var(--text-muted)]">Operario: {emailModal.worker.name}</p>
              </div>
              <button 
                onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))} 
                className="text-[var(--text-muted)] hover:text-white p-2"
              >
                <X size={20} />
              </button>
            </div>

            {/* Formulario de Correo */}
            <div className="space-y-4">
              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-wider block ml-1">Destinatario (Email) *</label>
                <input 
                  type="email" 
                  placeholder="ejemplo@empresa.com"
                  value={emailModal.to}
                  onChange={(e) => setEmailModal(prev => ({ ...prev, to: e.target.value }))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3.5 text-xs text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-wider block ml-1">Asunto *</label>
                <input 
                  type="text" 
                  value={emailModal.subject}
                  onChange={(e) => setEmailModal(prev => ({ ...prev, subject: e.target.value }))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3.5 text-xs text-[var(--text-main)] outline-none focus:border-emerald-500"
                />
              </div>

              <div className="space-y-1.5">
                <label className="text-[9px] font-black text-[var(--text-muted)] uppercase tracking-wider block ml-1">Mensaje</label>
                <textarea 
                  rows={4}
                  value={emailModal.body}
                  onChange={(e) => setEmailModal(prev => ({ ...prev, body: e.target.value }))}
                  className="w-full bg-[var(--input-bg)] border border-[var(--panel-border)] rounded-xl p-3.5 text-xs text-[var(--text-main)] outline-none focus:border-emerald-500 resize-none leading-relaxed"
                />
              </div>

              {/* Lista de certificados con Checkbox para multiselección */}
              <div className="space-y-2">
                <label className="text-[9px] font-black text-[#CCFF00] uppercase tracking-wider block ml-1">Selecciona los Documentos a Adjuntar:</label>
                <div className="grid grid-cols-1 gap-2 max-h-[160px] overflow-y-auto custom-scrollbar bg-black/40 p-4 rounded-xl border border-[var(--panel-border)]">
                  {emailModal.worker.certificates && emailModal.worker.certificates.length > 0 ? (
                    emailModal.worker.certificates.map(cert => {
                      const isChecked = emailModal.selectedCertIds.includes(cert.id);
                      return (
                        <label key={cert.id} className="flex items-center gap-3 text-xs text-[var(--text-main)] cursor-pointer hover:text-[#CCFF00] transition-colors p-1.5 rounded-lg hover:bg-white/5">
                          <input 
                            type="checkbox" 
                            checked={isChecked}
                            onChange={(e) => {
                              const checked = e.target.checked;
                              setEmailModal(prev => ({
                                ...prev,
                                selectedCertIds: checked 
                                  ? [...prev.selectedCertIds, cert.id]
                                  : prev.selectedCertIds.filter(id => id !== cert.id)
                              }));
                            }}
                            className="accent-[#CCFF00] h-4 w-4 cursor-pointer"
                          />
                          <div className="flex flex-col min-w-0">
                            <span className="font-bold truncate">{cert.name}</span>
                            <span className="text-[8px] text-[var(--text-muted)] font-black uppercase">Subido: {cert.uploadDate}</span>
                          </div>
                        </label>
                      );
                    })
                  ) : (
                    <p className="text-[10px] text-rose-400 font-bold uppercase text-center py-4">Este operario no tiene documentos guardados</p>
                  )}
                </div>
              </div>

              {/* Conexión Gmail / Google */}
              <div className="bg-black/40 p-4 rounded-2xl border border-[var(--panel-border)] flex flex-col sm:flex-row sm:items-center sm:justify-between gap-3 text-xs">
                <div className="space-y-1">
                  <p className="font-bold text-[var(--text-main)] uppercase text-[10px] tracking-wider flex items-center gap-1.5 text-emerald-400">
                    <Shield size={12} /> Cuenta de Google Gmail
                  </p>
                  <p className="text-[9px] text-[var(--text-muted)] font-bold uppercase leading-relaxed">
                    {googleUser 
                      ? `Conectado: ${googleUser.email}` 
                      : 'Conéctate para enviar correos reales mediante la API oficial.'}
                  </p>
                </div>
                {googleUser ? (
                  <button 
                    onClick={handleGoogleSignOut}
                    className="bg-rose-500/10 hover:bg-rose-500 text-rose-500 hover:text-white px-3 py-1.5 rounded-lg font-bold text-[9px] uppercase border border-rose-500/20 transition-colors"
                  >
                    Cerrar Sesión
                  </button>
                ) : (
                  <button 
                    onClick={handleGoogleSignInForGmail}
                    className="bg-[#CCFF00] text-black hover:bg-yellow-400 px-3.5 py-2 rounded-xl font-black text-[9px] uppercase flex items-center gap-1.5 shadow-[0_0_10px_rgba(204,255,0,0.2)] hover:shadow-[0_0_15px_rgba(204,255,0,0.4)] transition-all"
                  >
                    <KeyRound size={12} /> Conectar Google
                  </button>
                )}
              </div>
            </div>

            {/* Footer de Modal */}
            <div className="flex gap-3 pt-2">
              <button 
                onClick={() => setEmailModal(prev => ({ ...prev, isOpen: false }))}
                className="flex-1 bg-zinc-900 text-[var(--text-muted)] py-3.5 rounded-xl font-black uppercase text-[10px] hover:text-white border border-[var(--panel-border)] active:scale-95 transition-all"
              >
                Cancelar
              </button>
              <button 
                onClick={handleSendEmailWithCerts}
                disabled={isSendingEmail || emailModal.selectedCertIds.length === 0 || !emailModal.to}
                className="flex-1 bg-emerald-600 hover:bg-emerald-500 disabled:bg-emerald-600/20 disabled:text-[var(--text-muted)] text-white py-3.5 rounded-xl font-black uppercase text-[10px] shadow-lg disabled:shadow-none active:scale-95 transition-all flex items-center justify-center gap-1.5"
              >
                {isSendingEmail ? (
                  <>
                    <RefreshCw size={14} className="animate-spin" /> Enviando...
                  </>
                ) : (
                  <>
                    <Send size={14} /> {googleUser ? 'Enviar Correo (Gmail)' : 'Probar Envío'}
                  </>
                )}
              </button>
            </div>
          </div>
        </div>
      )}

      {unauthorizedDomain && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
          <div className={`w-full max-w-lg rounded-[2.5rem] border p-8 shadow-2xl relative overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-zinc-200'}`}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <span className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-full text-[8px] font-black tracking-wider uppercase font-sans">
                  Firebase Security Alert
                </span>
                <h3 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter mt-2 font-sans" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  Dominio No Autorizado en Firebase
                </h3>
              </div>
              <button onClick={() => setUnauthorizedDomain(null)} className="text-zinc-500 hover:text-[var(--text-main)] p-2">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs font-sans text-[var(--text-muted)]">
              <p className="leading-relaxed">
                Para permitir el inicio de sesión con Google desde este entorno de vista previa, debes añadir este dominio a la lista de dominios autorizados de tu proyecto Firebase.
              </p>

              <div className={`p-4 rounded-xl border space-y-1 ${theme === 'dark' ? 'bg-zinc-950/80 border-zinc-800' : 'bg-zinc-50 border-zinc-200'}`}>
                <p className="text-[9px] font-black text-zinc-500 uppercase tracking-widest">Dominio a autorizar:</p>
                <div className="flex items-center justify-between gap-2">
                  <code className="text-emerald-500 dark:text-emerald-400 font-mono text-[11px] select-all break-all">{unauthorizedDomain}</code>
                  <button 
                    onClick={() => {
                      navigator.clipboard.writeText(unauthorizedDomain);
                      alert("¡Dominio copiado al portapapeles!");
                    }}
                    className={`shrink-0 text-[9px] font-black uppercase px-3 py-1.5 rounded-lg tracking-wider ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800'}`}
                  >
                    Copiar
                  </button>
                </div>
              </div>

              <div className="space-y-2">
                <h4 className="font-black text-[var(--text-main)] uppercase text-[10px] tracking-wider">Pasos para solucionarlo:</h4>
                <ol className="list-decimal pl-4 space-y-2.5 leading-relaxed">
                  <li>Ve a tu <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">Firebase Console <ExternalLink size={10} /></a>.</li>
                  <li>Selecciona tu proyecto <strong>CARMAGNE INSTAL 2024</strong>.</li>
                  <li>Ve a la sección <strong>Authentication</strong> en el menú izquierdo.</li>
                  <li>Entra en la pestaña <strong>Settings</strong> (Configuración) y haz clic en <strong>Authorized domains</strong> (Dominios autorizados).</li>
                  <li>Haz clic en <strong>Add domain</strong> (Añadir dominio) y pega el dominio copiado arriba.</li>
                </ol>
              </div>

              <div className="pt-4 flex justify-end">
                <button 
                  onClick={() => setUnauthorizedDomain(null)}
                  className="bg-[#CCFF00] hover:bg-[#b8e600] text-black font-black uppercase text-[10px] tracking-widest py-3 px-6 rounded-xl shadow-lg transition-all"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {operationNotAllowed && (
        <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
          <div className={`w-full max-w-lg rounded-[2.5rem] border p-8 shadow-2xl relative overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-zinc-200'}`}>
            <div className="flex justify-between items-start mb-6">
              <div>
                <span className="px-2.5 py-1 bg-amber-500/10 border border-amber-500/20 text-amber-500 rounded-full text-[8px] font-black tracking-wider uppercase font-sans">
                  Firebase Setup Alert
                </span>
                <h3 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter mt-2 font-sans" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                  Proveedor de Google No Activado
                </h3>
              </div>
              <button onClick={() => setOperationNotAllowed(false)} className="text-zinc-500 hover:text-[var(--text-main)] p-2">
                <X size={20} />
              </button>
            </div>

            <div className="space-y-4 text-xs font-sans text-[var(--text-muted)]">
              <p className="leading-relaxed">
                El método de inicio de sesión con Google (Google Sign-In) no está habilitado actualmente en la configuración de autenticación de tu proyecto Firebase.
              </p>

              <div className="space-y-2">
                <h4 className="font-black text-[var(--text-main)] uppercase text-[10px] tracking-wider">Pasos para activarlo:</h4>
                <ol className="list-decimal pl-4 space-y-2.5 leading-relaxed">
                  <li>Ve a tu <a href="https://console.firebase.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">Firebase Console <ExternalLink size={10} /></a>.</li>
                  <li>Selecciona tu proyecto <strong>CARMAGNE INSTAL 2024</strong>.</li>
                  <li>En el panel izquierdo, haz clic en la sección de <strong>Authentication</strong>.</li>
                  <li>Entra en la pestaña de <strong>Sign-in method</strong> (Método de inicio de sesión).</li>
                  <li>Haz clic en el botón <strong>Add new provider</strong> (Añadir nuevo proveedor).</li>
                  <li>Selecciona <strong>Google</strong> de la lista de proveedores adicionales.</li>
                  <li>Activa el interruptor para habilitarlo, introduce un nombre público si te lo solicita y pon tu correo de asistencia técnica.</li>
                  <li>Haz clic en <strong>Save</strong> (Guardar) para confirmar la activación.</li>
                </ol>
              </div>

              <div className="pt-4 flex justify-end">
                <button 
                  onClick={() => setOperationNotAllowed(false)}
                  className="bg-[#CCFF00] hover:bg-[#b8e600] text-black font-black uppercase text-[10px] tracking-widest py-3 px-6 rounded-xl shadow-lg transition-all"
                >
                  Entendido
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {googleApiError && (() => {
        const getDirectEnableUrl = () => {
          if (!googleApiError || !googleApiError.message) return null;
          const match = googleApiError.message.match(/(https?:\/\/[^\s"]+)/);
          if (match) {
            return match[1].replace(/[).,"]+$/, "");
          }
          return null;
        };
        const directUrl = getDirectEnableUrl();

        return (
          <div className="fixed inset-0 z-[120] bg-black/90 backdrop-blur-xl flex items-center justify-center p-6 animate-fadeIn">
            <div className={`w-full max-w-lg rounded-[2.5rem] border p-8 shadow-2xl relative overflow-hidden ${theme === 'dark' ? 'bg-slate-900 border-slate-800' : 'bg-white border-zinc-200'}`}>
              <div className="flex justify-between items-start mb-6">
                <div>
                  <span className="px-2.5 py-1 bg-rose-500/10 border border-rose-500/20 text-rose-500 rounded-full text-[8px] font-black tracking-wider uppercase font-sans">
                    Google Cloud API Alert
                  </span>
                  <h3 className="text-xl font-black text-[var(--text-main)] uppercase tracking-tighter mt-2 font-sans" style={{ fontFamily: "'Bebas Neue', sans-serif" }}>
                    Habilitar {googleApiError.apiName}
                  </h3>
                </div>
                <button onClick={() => setGoogleApiError(null)} className="text-zinc-500 hover:text-[var(--text-main)] p-2">
                  <X size={20} />
                </button>
              </div>

              <div className="space-y-4 text-xs font-sans text-[var(--text-muted)]">
                <p className="leading-relaxed">
                  Para que la integración con <strong>{googleApiError.apiName}</strong> funcione, debes habilitar este servicio de Google en el panel de desarrolladores de tu proyecto Google Cloud (asociado a tu Firebase).
                </p>

                <div className="bg-amber-500/10 border border-amber-500/20 text-amber-500 p-3 rounded-xl flex items-start gap-2">
                  <span className="text-base">⏳</span>
                  <p className="leading-normal">
                    <strong>Nota sobre propagación:</strong> Si acabas de habilitar la API hace unos instantes, Google puede tardar **de 3 a 5 minutos** en propagar el cambio en sus servidores globales. Por favor, espera un momento y vuelve a intentarlo.
                  </p>
                </div>

                <div className={`p-4 rounded-xl border space-y-1 ${theme === 'dark' ? 'bg-zinc-950/80 border-zinc-800' : 'bg-rose-50 border-rose-100'}`}>
                  <p className="text-[9px] font-black text-rose-500 uppercase tracking-widest">Detalle del Error:</p>
                  <p className="font-mono text-[10px] text-[var(--text-main)] break-all leading-relaxed">{googleApiError.message}</p>
                  {googleApiError.code && <p className="text-[9px] text-zinc-500">Código de estado HTTP: {googleApiError.code}</p>}
                </div>

                <div className="space-y-2">
                  <h4 className="font-black text-[var(--text-main)] uppercase text-[10px] tracking-wider">Pasos para habilitarlo:</h4>
                  <ol className="list-decimal pl-4 space-y-2.5 leading-relaxed">
                    <li>Inicia sesión con tu cuenta de administrador de Google en <a href="https://console.cloud.google.com/" target="_blank" rel="noopener noreferrer" className="text-blue-500 hover:underline inline-flex items-center gap-0.5">Google Cloud Console <ExternalLink size={10} /></a>.</li>
                    <li>Selecciona tu proyecto <strong>CARMAGNE INSTAL 2024</strong> en la barra superior.</li>
                    <li>En el buscador superior, escribe <strong>"{googleApiError.apiName}"</strong> y selecciónalo.</li>
                    <li>Haz clic en el botón azul de <strong>HABILITAR</strong> (Enable).</li>
                    <li><em>Nota: Si la cuenta de Google con la que inicias sesión aquí no es la propietaria del proyecto, asegúrate de invitarla como Editor/Propietario desde Firebase Console {'>'} Project Settings {'>'} Users and Permissions.</em></li>
                  </ol>
                </div>

                <div className="pt-4 flex justify-end gap-3">
                  <button 
                    onClick={() => setGoogleApiError(null)}
                    className={`font-black uppercase text-[10px] tracking-widest py-3 px-5 rounded-xl transition-all ${theme === 'dark' ? 'bg-zinc-800 hover:bg-zinc-700 text-white' : 'bg-zinc-200 hover:bg-zinc-300 text-zinc-800'}`}
                  >
                    Cerrar
                  </button>
                  <a 
                    href={directUrl || `https://console.cloud.google.com/apis/library/${googleApiError.apiName === 'Gmail API' ? 'gmail.googleapis.com' : 'sheets.googleapis.com'}`}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="bg-[#CCFF00] hover:bg-[#b8e600] text-black font-black uppercase text-[10px] tracking-widest py-3 px-5 rounded-xl shadow-lg transition-all inline-flex items-center gap-1.5 text-center justify-center"
                  >
                    {directUrl ? "Habilitar API Directamente" : "Ir a la Consola"} <ExternalLink size={12} />
                  </a>
                </div>
              </div>
            </div>
          </div>
        );
      })()}

      {/* iOS 26 Styled Push Notifications Container for Admin */}
      <div className="fixed top-4 left-0 right-0 z-[99999] flex flex-col items-center gap-2 pointer-events-none px-4 pt-[env(safe-area-inset-top,0px)]">
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

