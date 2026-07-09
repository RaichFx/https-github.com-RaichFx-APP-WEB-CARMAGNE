
export enum LogType {
  ENTRADA = 'ENTRADA',
  SALIDA = 'SALIDA',
  INICIO_DESCANSO = 'INICIO_DESCANSO',
  FIN_DESCANSO = 'FIN_DESCANSO',
  REGISTRO = 'REGISTRO',
}

export type WorkMode = 'HORAS' | 'DESTAJO';

export interface Worker {
  id: string;
  name: string;
  qrCode: string;
  active: boolean;
  pin: string;
  dni?: string;
  role?: string;
  phone?: string;
  email?: string;
  defaultMode?: WorkMode;
  photoUrl?: string;
  certificates?: { id: string; name: string; fileBase64: string; uploadDate: string; size?: string }[];
  notificationPreferences?: {
    notifyCheckIn?: boolean;
    notifyCertificates?: boolean;
  };
}

export interface Site {
  id: string;
  name: string;
  address: string;
  active: boolean;
  coordinates?: {
    latitude: number;
    longitude: number;
  };
}

export interface AdminUser {
  id: string;
  username: string;
  password: string;
  active: boolean;
  createdAt: number;
}

export interface GeoLocationData {
  latitude: number;
  longitude: number;
  accuracy: number;
  address?: string;
}

export interface ToolRecord {
  id: string;
  workerId: string;
  workerName: string;
  toolName: string;
  brand: string;
  model: string;
  timestamp: number;
  dateStr: string;
  timeStr: string;
  siteId?: string;
  siteName?: string;
}

export interface WorkLog {
  id: string;
  workerId: string;
  workerName: string;
  siteId: string;
  siteName: string;
  type: LogType;
  timestamp: number;
  dateStr: string;
  timeStr: string;
  location: GeoLocationData;
  photoUrl?: string;
  sentToWhatsapp: boolean;
  syncedToSheets: boolean;
  distanceMeters?: number; 
  locationWarning?: boolean;
  workMode?: WorkMode;
  workReport?: string;
}

export interface AppConfig {
  adminPhone: string;
  googleSheetUrl: string;
  adminPassword?: string;
  logoUrl?: string;
  faviconUrl?: string;
  logoScaleLogin?: number;
  logoScaleDashboard?: number;
}

export interface WeeklyReport {
  id: string;
  workerId: string;
  workerName: string;
  timestamp: number;
  dateStr: string;
  photoUrl: string; // Base64 o URL
  startDate?: string; // Fecha de inicio seleccionada por el operario
  endDate?: string; // Fecha de fin seleccionada por el operario
  extractedDates?: string;
  extractedTasks?: string;
  extractedHours?: number;
  extractedTotal?: string;
  dailyHours?: { date: string; hours: number; tasks?: string }[]; // Desglose diario de horas extraído por la IA
  status: 'PENDING' | 'APPROVED' | 'REJECTED';
  rejectionReason?: string;
  isAiParsed: boolean;
  comments?: string;
}

export interface Payslip {
  id: string;
  workerId: string;
  workerName: string;
  monthStr: string; // Formato: "YYYY-MM"
  title: string;
  baseSalary: number;
  extraHours: number;
  extraHoursPay: number;
  deductions: number;
  totalPay: number;
  sentTimestamp: number;
  status: 'SENT' | 'RECEIVED' | 'SIGNED';
  pdfBase64?: string; // Opcional, para almacenar el PDF autogenerado o subido
}

export interface ChatMessage {
  id: string;
  senderId: string;
  senderName: string;
  receiverId: string;
  receiverName: string;
  text: string;
  timestamp: number;
  dateStr: string;
  timeStr: string;
  read: boolean;
}

