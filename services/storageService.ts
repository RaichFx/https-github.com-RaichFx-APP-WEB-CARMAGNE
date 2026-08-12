
import { Worker, Site, WorkLog, AppConfig, LogType, AdminUser, ToolRecord, WeeklyReport, Payslip, ChatMessage } from '../types';
import { db, storage, auth } from './firebase';
import { collection, doc, setDoc, updateDoc, onSnapshot, deleteDoc, getDoc, getDocs, writeBatch, query, where } from 'firebase/firestore';
import { ref as storageRef, uploadString, getBytes, deleteObject } from 'firebase/storage';

const KEYS = {
  WORKERS: 'carmagne_workers',
  SITES: 'carmagne_sites',
  LOGS: 'carmagne_logs',
  CONFIG: 'carmagne_config',
  ADMINS: 'carmagne_admins',
  TOOLS: 'carmagne_tools',
  REPORTS: 'carmagne_reports',
  PAYSLIPS: 'carmagne_payslips',
  CHATS: 'carmagne_chats',
};

const CHAT_CLEANUP_LAST_RUN_KEY = 'carmagne_chats_cleanup_last_run';

export const ELECTRICAL_TOOLS_LIST = [
  "Multímetro Digital", "Pinza Amperimétrica", "Pistola de Impacto", "Taladro Percutor",
  "Pelacables Automático", "Pelacables de Precisión", "Crimpadora RJ45", "Crimpadora de Terminales",
  "Destornillador Aislado (VDE)", "Juego de Llaves de Vaso", "Guía Pasacables (Fibra)", "Guía Pasacables (Acero)",
  "Amoladora / Radial", "Sierra de Sable", "Nivel Láser Autonivelante", "Cinta Métrica Magnética",
  "Localizador de Cables", "Comprobador de Diferenciales", "Megaóhmetro", "Cámara Termográfica",
  "Linterna de Cabeza LED", "Escalera de Tijera Dieléctrica", "Martillo Electrotécnico", "Cincel / Cortafríos",
  "Prensa Hidráulica", "Cortacables de Carraca", "Doblador de Tubos", "Maletín de Herramientas Rígido"
];

export const ELECTRICAL_BRANDS_LIST = [
  "Fluke", "Milwaukee", "DeWalt", "Hilti", "Makita", "Bosch Professional", "Klein Tools",
  "Knipex", "Wiha", "Wera", "Stanley", "Bahco", "Cimco", "Megger", "Testo", "Metrel",
  "Ideal Industries", "Greenlee", "Chauvin Arnoux", "Schneider Electric", "Legrand", 
  "Facom", "Palmerá", "Irazola", "Weller", "Hikoki", "Festool"
];

const INITIAL_WORKERS: Worker[] = [];

const INITIAL_SITES: Site[] = [];

const INITIAL_CONFIG: AppConfig = { 
  adminPhone: '34631400010', 
  googleSheetUrl: '', 
  logoUrl: '/logo.png', 
  logoScaleLogin: 1.0,
  logoScaleDashboard: 1.0
};

const safeClone = (obj: any) => {
  const seen = new WeakMap();
  const clone = (item: any): any => {
    if (item === null || typeof item !== 'object') return item;
    if (typeof item.toDate === 'function') return item.toDate().getTime();
    if (item instanceof Date) return item.getTime();
    if (seen.has(item)) return undefined;
    seen.set(item, true);
    if (Array.isArray(item)) return item.map(clone).filter(v => v !== undefined);
    const result: any = {};
    for (const key of Object.keys(item)) {
      if (key.startsWith('_')) continue;
      try {
        const val = clone(item[key]);
        if (val !== undefined) result[key] = val;
      } catch (e) {}
    }
    return result;
  };
  return clone(obj);
};

const stripHeavyBase64 = (obj: any): any => {
  if (obj === null || typeof obj !== 'object') {
    if (typeof obj === 'string' && obj.startsWith('data:') && obj.length > 2048) {
      return '';
    }
    return obj;
  }
  if (Array.isArray(obj)) {
    return obj.map(stripHeavyBase64);
  }
  const result: any = {};
  for (const key of Object.keys(obj)) {
    result[key] = stripHeavyBase64(obj[key]);
  }
  return result;
};

const stripSensitiveLocalFields = (key: string, data: any): any => {
  if (key === KEYS.WORKERS && Array.isArray(data)) {
    return data.map(worker => ({
      ...worker,
      pin: '',
      pinHash: '',
    }));
  }

  if (key === KEYS.ADMINS && Array.isArray(data)) {
    return data.map(admin => ({
      ...admin,
      password: '',
    }));
  }

  if (key === KEYS.CONFIG && data && typeof data === 'object') {
    return {
      ...data,
      adminPassword: '',
    };
  }

  return data;
};

export const compressImage = (dataUrl: string, maxWidth = 400, maxHeight = 400, quality = 0.7): Promise<string> => {
  return new Promise((resolve) => {
    const img = new Image();
    img.onload = () => {
      let width = img.width;
      let height = img.height;

      if (width > height) {
        if (width > maxWidth) {
          height = Math.round((height * maxWidth) / width);
          width = maxWidth;
        }
      } else {
        if (height > maxHeight) {
          width = Math.round((width * maxHeight) / height);
          height = maxHeight;
        }
      }

      const canvas = document.createElement('canvas');
      canvas.width = width;
      canvas.height = height;

      const ctx = canvas.getContext('2d');
      if (ctx) {
        ctx.drawImage(img, 0, 0, width, height);
        const compressed = canvas.toDataURL('image/jpeg', quality);
        resolve(compressed);
      } else {
        resolve(dataUrl);
      }
    };
    img.onerror = () => resolve(dataUrl);
    img.src = dataUrl;
  });
};

const loadLocal = <T>(key: string, initial: T): T => {
  try {
    const saved = localStorage.getItem(key);
    return saved ? JSON.parse(saved) : initial;
  } catch (e) { return initial; }
};

const saveLocal = <T>(key: string, data: T): void => {
  try {
    const cloned = safeClone(data);
    const cleaned = stripSensitiveLocalFields(key, stripHeavyBase64(cloned));
    localStorage.setItem(key, JSON.stringify(cleaned));
  } catch (e) { console.error("Error saving to local", e); }
};

type StoredFileDoc = {
  id: string;
  workerId: string;
  name: string;
  fileBase64?: string;
  filePath?: string;
  mimeType?: string;
  uploadDate: string;
  size?: string;
};

const sanitizeStorageFileName = (name: string) =>
  (name || 'archivo')
    .trim()
    .replace(/[\\/:*?"<>|#%{}[\]^~`]+/g, '-')
    .replace(/\s+/g, '_')
    .slice(0, 120);

const getMimeTypeFromDataUri = (dataUri?: string, fallback = 'application/octet-stream') => {
  const match = dataUri?.match(/^data:([^;]+);/);
  return match?.[1] || fallback;
};

const bytesToDataUri = (bytes: ArrayBuffer, mimeType: string) => {
  const chunkSize = 0x8000;
  const view = new Uint8Array(bytes);
  let binary = '';
  for (let i = 0; i < view.length; i += chunkSize) {
    binary += String.fromCharCode(...view.subarray(i, i + chunkSize));
  }
  return `data:${mimeType};base64,${btoa(binary)}`;
};

const uploadDataUriToStorage = async (path: string, dataUri: string, contentType?: string) => {
  const ref = storageRef(storage, path);
  await uploadString(ref, dataUri, 'data_url', {
    contentType: contentType || getMimeTypeFromDataUri(dataUri),
    customMetadata: {
      sensitive: 'true',
    },
  });
  return path;
};

const readStorageFileAsDataUri = async (path: string, mimeType: string) => {
  const ref = storageRef(storage, path);
  const bytes = await getBytes(ref);
  return bytesToDataUri(bytes, mimeType);
};

export const StorageService = {
  getTools: (): ToolRecord[] => loadLocal(KEYS.TOOLS, []),
  addTool: async (tool: ToolRecord) => {
    const tools = loadLocal<ToolRecord[]>(KEYS.TOOLS, []);
    saveLocal(KEYS.TOOLS, [tool, ...tools]);
    try { 
      await setDoc(doc(db, "tools", tool.id), safeClone(tool)); 
    } catch (e) {
      console.error("Firestore error in addTool:", e);
      throw e;
    }
  },
  deleteTool: async (id: string) => {
    const tools = loadLocal<ToolRecord[]>(KEYS.TOOLS, []);
    saveLocal(KEYS.TOOLS, tools.filter(t => t.id !== id));
    try { 
      await deleteDoc(doc(db, "tools", id)); 
    } catch (e) {
      console.error("Firestore error in deleteTool:", e);
      throw e;
    }
  },
  subscribeToTools: (callback: (tools: ToolRecord[]) => void) => {
    callback(loadLocal(KEYS.TOOLS, []));
    return onSnapshot(collection(db, "tools"), (snapshot) => {
      const tools = snapshot.docs.map(doc => doc.data() as ToolRecord);
      const sorted = [...tools].sort((a, b) => b.timestamp - a.timestamp);
      saveLocal(KEYS.TOOLS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToTools:", err);
    });
  },
  subscribeToWorkerTools: (workerId: string, callback: (tools: ToolRecord[]) => void) => {
    callback(loadLocal<ToolRecord[]>(KEYS.TOOLS, []).filter(t => t.workerId === workerId));
    return onSnapshot(query(collection(db, "tools"), where("workerId", "==", workerId)), (snapshot) => {
      const tools = snapshot.docs.map(doc => doc.data() as ToolRecord);
      const sorted = [...tools].sort((a, b) => b.timestamp - a.timestamp);
      saveLocal(KEYS.TOOLS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkerTools:", err);
    });
  },

  getWorkers: (): Worker[] => loadLocal(KEYS.WORKERS, INITIAL_WORKERS),
  registerNewWorker: async (worker: Worker) => {
    const current = loadLocal<Worker[]>(KEYS.WORKERS, INITIAL_WORKERS);
    saveLocal(KEYS.WORKERS, [...current, worker]);
    try { 
      await setDoc(doc(db, "workers", worker.id), safeClone(worker), { merge: true }); 
    } catch (e) {
      console.error("Firestore error in registerNewWorker:", e);
      throw e;
    }
  },
  saveWorkers: async (newWorkers: Worker[]) => {
    const oldWorkers = loadLocal<Worker[]>(KEYS.WORKERS, INITIAL_WORKERS);
    saveLocal(KEYS.WORKERS, newWorkers);
    try {
      // Find which workers actually changed compared to oldWorkers to avoid useless writes
      const changedWorkers = newWorkers.filter(newW => {
        const oldW = oldWorkers.find(o => o.id === newW.id);
        if (!oldW) return true; // New worker
        return JSON.stringify(safeClone(newW)) !== JSON.stringify(safeClone(oldW));
      });

      if (changedWorkers.length > 0) {
        await Promise.all(changedWorkers.map(async w => {
          try {
            await setDoc(doc(db, "workers", w.id), safeClone(w), { merge: true });
          } catch (err) {
            console.error(`Error saving worker ${w.id} / ${w.name}:`, err);
            throw err;
          }
        }));
        console.log(`[Firebase Sync] Updated ${changedWorkers.length} worker documents successfully.`);
      }
    } catch (e) {
      console.error("Firestore error in saveWorkers:", e);
      throw e;
    }
  },
  deleteWorker: async (id: string) => {
    const workers = loadLocal<Worker[]>(KEYS.WORKERS, INITIAL_WORKERS);
    saveLocal(KEYS.WORKERS, workers.filter(w => w.id !== id));
    try { 
      await deleteDoc(doc(db, "workers", id)); 
    } catch (e) {
      console.error("Firestore error in deleteWorker:", e);
      throw e;
    }
  },
  subscribeToWorkers: (callback: (workers: Worker[]) => void) => {
    callback(loadLocal(KEYS.WORKERS, INITIAL_WORKERS));
    const loadWorkersDirectoryFromApi = async () => {
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
        const workers = data.workers as Worker[];
        saveLocal(KEYS.WORKERS, workers);
        callback(workers);
      }
    };

    loadWorkersDirectoryFromApi().catch((err) => {
      console.error("API error in subscribeToWorkers:", err);
    });

    return onSnapshot(collection(db, "workers"), (snapshot) => {
      const workers = snapshot.docs.map(doc => doc.data() as Worker);
      saveLocal(KEYS.WORKERS, workers);
      callback(workers);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkers:", err);
    });
  },
  subscribeToWorker: (workerId: string, callback: (worker: Worker | null) => void) => {
    const cached = loadLocal<Worker[]>(KEYS.WORKERS, INITIAL_WORKERS).find(w => w.id === workerId) || null;
    callback(cached);
    return onSnapshot(doc(db, "workers", workerId), (snapshot) => {
      if (!snapshot.exists()) {
        callback(null);
        return;
      }
      const worker = snapshot.data() as Worker;
      const workers = loadLocal<Worker[]>(KEYS.WORKERS, INITIAL_WORKERS);
      const byId = new Map(workers.map(w => [w.id, w]));
      byId.set(worker.id, worker);
      saveLocal(KEYS.WORKERS, Array.from(byId.values()));
      callback(worker);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorker:", err);
    });
  },

  getSites: (): Site[] => loadLocal(KEYS.SITES, INITIAL_SITES),
  saveSites: async (newSites: Site[]) => {
    const oldSites = loadLocal<Site[]>(KEYS.SITES, INITIAL_SITES);
    saveLocal(KEYS.SITES, newSites);
    try {
      // Find which sites actually changed to optimize database writes
      const changedSites = newSites.filter(newS => {
        const oldS = oldSites.find(o => o.id === newS.id);
        if (!oldS) return true;
        return JSON.stringify(safeClone(newS)) !== JSON.stringify(safeClone(oldS));
      });

      if (changedSites.length > 0) {
        await Promise.all(changedSites.map(s => setDoc(doc(db, "sites", s.id), safeClone(s))));
        console.log(`[Firebase Sync] Updated ${changedSites.length} site documents successfully.`);
      }
    } catch (e) {
      console.error("Firestore error in saveSites:", e);
      throw e;
    }
  },
  updateSite: async (updatedSite: Site) => {
    const sites = loadLocal<Site[]>(KEYS.SITES, INITIAL_SITES);
    saveLocal(KEYS.SITES, sites.map(s => s.id === updatedSite.id ? updatedSite : s));
    try { 
      await setDoc(doc(db, "sites", updatedSite.id), safeClone(updatedSite)); 
    } catch (e) {
      console.error("Firestore error in updateSite:", e);
      throw e;
    }
  },
  deleteSite: async (id: string) => {
    const sites = loadLocal<Site[]>(KEYS.SITES, INITIAL_SITES);
    saveLocal(KEYS.SITES, sites.filter(s => s.id !== id));
    try { 
      await deleteDoc(doc(db, "sites", id)); 
    } catch (e) {
      console.error("Firestore error in deleteSite:", e);
      throw e;
    }
  },
  subscribeToSites: (callback: (sites: Site[]) => void) => {
    callback(loadLocal(KEYS.SITES, INITIAL_SITES));
    return onSnapshot(collection(db, "sites"), (snapshot) => {
      const sites = snapshot.docs.map(doc => doc.data() as Site);
      saveLocal(KEYS.SITES, sites);
      callback(sites);
    }, (err) => {
      console.error("onSnapshot error in subscribeToSites:", err);
    });
  },

  getAdmins: (): AdminUser[] => loadLocal(KEYS.ADMINS, []),
  addAdmin: async (admin: AdminUser) => {
    const admins = loadLocal<AdminUser[]>(KEYS.ADMINS, []);
    saveLocal(KEYS.ADMINS, [...admins, admin]);
    try { 
      await setDoc(doc(db, "admins", admin.id), safeClone(admin)); 
    } catch (e) {
      console.error("Firestore error in addAdmin:", e);
      throw e;
    }
  },
  deleteAdmin: async (id: string) => {
    const admins = loadLocal<AdminUser[]>(KEYS.ADMINS, []);
    saveLocal(KEYS.ADMINS, admins.filter(a => a.id !== id));
    try { 
      await deleteDoc(doc(db, "admins", id)); 
    } catch (e) {
      console.error("Firestore error in deleteAdmin:", e);
      throw e;
    }
  },
  subscribeToAdmins: (callback: (admins: AdminUser[]) => void) => {
    callback(loadLocal(KEYS.ADMINS, []));
    return onSnapshot(collection(db, "admins"), (snapshot) => {
      const admins = snapshot.docs.map(doc => doc.data() as AdminUser);
      saveLocal(KEYS.ADMINS, admins);
      callback(admins);
    }, (err) => {
      console.error("onSnapshot error in subscribeToAdmins:", err);
    });
  },

  getLogs: (): WorkLog[] => loadLocal(KEYS.LOGS, []),
  addLog: async (log: WorkLog) => {
    const logs = loadLocal<WorkLog[]>(KEYS.LOGS, []);
    saveLocal(KEYS.LOGS, [log, ...logs]);
    try { 
      await setDoc(doc(db, "logs", log.id), safeClone(log)); 
    } catch (e) {
      console.error("Firestore error in addLog:", e);
      throw e;
    }
  },
  updateLog: async (updatedLog: WorkLog) => {
    const logs = loadLocal<WorkLog[]>(KEYS.LOGS, []);
    saveLocal(KEYS.LOGS, logs.map(l => l.id === updatedLog.id ? updatedLog : l));
    try { 
      await updateDoc(doc(db, "logs", updatedLog.id), safeClone(updatedLog)); 
    } catch (e) {
      console.error("Firestore error in updateLog:", e);
      throw e;
    }
  },
  deleteLog: async (id: string) => {
    const logs = loadLocal<WorkLog[]>(KEYS.LOGS, []);
    saveLocal(KEYS.LOGS, logs.filter(l => l.id !== id));
    try { 
      await deleteDoc(doc(db, "logs", id)); 
    } catch (e) {
      console.error("Firestore error in deleteLog:", e);
      throw e;
    }
  },
  clearAllLogs: async () => {
    saveLocal(KEYS.LOGS, []);
    try {
      const snapshot = await getDocs(collection(db, "logs"));
      const batch = writeBatch(db);
      snapshot.docs.forEach(d => batch.delete(d.ref));
      await batch.commit();
    } catch (e) { 
      console.error("Error clearing logs:", e); 
      throw e;
    }
  },
  subscribeToLogs: (callback: (logs: WorkLog[]) => void) => {
    callback(loadLocal(KEYS.LOGS, []));
    return onSnapshot(collection(db, "logs"), (snapshot) => {
      const logs = snapshot.docs.map(doc => doc.data() as WorkLog);
      const sorted = [...logs].sort((a, b) => b.timestamp - a.timestamp);
      saveLocal(KEYS.LOGS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToLogs:", err);
    });
  },
  subscribeToWorkerLogs: (workerId: string, callback: (logs: WorkLog[]) => void) => {
    callback(loadLocal<WorkLog[]>(KEYS.LOGS, []).filter(l => l.workerId === workerId));
    return onSnapshot(query(collection(db, "logs"), where("workerId", "==", workerId)), (snapshot) => {
      const logs = snapshot.docs.map(doc => doc.data() as WorkLog);
      const sorted = [...logs].sort((a, b) => b.timestamp - a.timestamp);
      saveLocal(KEYS.LOGS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkerLogs:", err);
    });
  },

  getConfig: (): AppConfig => loadLocal(KEYS.CONFIG, INITIAL_CONFIG),
  saveConfig: async (config: AppConfig) => {
    saveLocal(KEYS.CONFIG, config);
    try { 
      await setDoc(doc(db, "config", "global"), safeClone(config)); 
    } catch (e) {
      console.error("Firestore error in saveConfig:", e);
      throw e;
    }
  },
  subscribeToConfig: (callback: (config: AppConfig) => void) => {
    callback(loadLocal(KEYS.CONFIG, INITIAL_CONFIG));
    return onSnapshot(doc(db, "config", "global"), (snapshot) => {
      if (snapshot.exists()) {
        const config = snapshot.data() as AppConfig;
        saveLocal(KEYS.CONFIG, config);
        callback(config);
      }
    }, (err) => {
      console.error("onSnapshot error in subscribeToConfig:", err);
    });
  },
  
  syncLog: async (log: WorkLog): Promise<boolean> => {
    const config = loadLocal<AppConfig>(KEYS.CONFIG, INITIAL_CONFIG);
    if (!config.googleSheetUrl) return false;
    try {
      await fetch(config.googleSheetUrl, { method: 'POST', mode: 'no-cors', body: JSON.stringify({ action: 'LOG', ...safeClone(log) }) });
      return true;
    } catch (error) { return false; }
  },

  getReports: (): WeeklyReport[] => loadLocal(KEYS.REPORTS, []),
  addReport: async (report: WeeklyReport) => {
    const reports = loadLocal<WeeklyReport[]>(KEYS.REPORTS, []);
    saveLocal(KEYS.REPORTS, [report, ...reports]);
    try { 
      await setDoc(doc(db, "weekly_reports", report.id), safeClone(report)); 
    } catch (e) {
      console.error("Firestore error in addReport:", e);
      throw e;
    }
  },
  deleteReport: async (id: string) => {
    const reports = loadLocal<WeeklyReport[]>(KEYS.REPORTS, []);
    saveLocal(KEYS.REPORTS, reports.filter(r => r.id !== id));
    try { 
      await deleteDoc(doc(db, "weekly_reports", id)); 
    } catch (e) {
      console.error("Firestore error in deleteReport:", e);
      throw e;
    }
  },
  updateReport: async (report: WeeklyReport) => {
    const reports = loadLocal<WeeklyReport[]>(KEYS.REPORTS, []);
    saveLocal(KEYS.REPORTS, reports.map(r => r.id === report.id ? report : r));
    try { 
      await setDoc(doc(db, "weekly_reports", report.id), safeClone(report)); 
    } catch (e) {
      console.error("Firestore error in updateReport:", e);
      throw e;
    }
  },
  subscribeToReports: (callback: (reports: WeeklyReport[]) => void) => {
    callback(loadLocal(KEYS.REPORTS, []));
    return onSnapshot(collection(db, "weekly_reports"), (snapshot) => {
      const reports = snapshot.docs.map(doc => doc.data() as WeeklyReport);
      const sorted = [...reports].sort((a, b) => b.timestamp - a.timestamp);
      saveLocal(KEYS.REPORTS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToReports:", err);
    });
  },
  subscribeToWorkerReports: (workerId: string, callback: (reports: WeeklyReport[]) => void) => {
    callback(loadLocal<WeeklyReport[]>(KEYS.REPORTS, []).filter(r => r.workerId === workerId));
    return onSnapshot(query(collection(db, "weekly_reports"), where("workerId", "==", workerId)), (snapshot) => {
      const reports = snapshot.docs.map(doc => doc.data() as WeeklyReport);
      const sorted = [...reports].sort((a, b) => b.timestamp - a.timestamp);
      saveLocal(KEYS.REPORTS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkerReports:", err);
    });
  },

  getPayslips: (): Payslip[] => loadLocal(KEYS.PAYSLIPS, []),
  addPayslip: async (payslip: Payslip) => {
    const storageBackedPayslip = { ...payslip };
    if (payslip.pdfBase64 && !payslip.pdfPath) {
      const filePath = `payslips/${payslip.workerId}/${payslip.id}/${sanitizeStorageFileName(payslip.title || payslip.id)}.pdf`;
      await uploadDataUriToStorage(filePath, payslip.pdfBase64, 'application/pdf');
      storageBackedPayslip.pdfPath = filePath;
      storageBackedPayslip.pdfMimeType = 'application/pdf';
      storageBackedPayslip.pdfBase64 = '';
    }

    const payslips = loadLocal<Payslip[]>(KEYS.PAYSLIPS, []);
    saveLocal(KEYS.PAYSLIPS, [storageBackedPayslip, ...payslips]);
    try { 
      await setDoc(doc(db, "payslips", storageBackedPayslip.id), safeClone(storageBackedPayslip)); 
    } catch (e) {
      console.error("Firestore error in addPayslip:", e);
      throw e;
    }
  },
  deletePayslip: async (id: string) => {
    const payslips = loadLocal<Payslip[]>(KEYS.PAYSLIPS, []);
    const existing = payslips.find(p => p.id === id);
    saveLocal(KEYS.PAYSLIPS, payslips.filter(p => p.id !== id));
    try { 
      if (existing?.pdfPath) {
        await deleteObject(storageRef(storage, existing.pdfPath)).catch(() => {});
      }
      await deleteDoc(doc(db, "payslips", id)); 
    } catch (e) {
      console.error("Firestore error in deletePayslip:", e);
      throw e;
    }
  },
  updatePayslip: async (payslip: Payslip) => {
    const payslips = loadLocal<Payslip[]>(KEYS.PAYSLIPS, []);
    saveLocal(KEYS.PAYSLIPS, payslips.map(p => p.id === payslip.id ? payslip : p));
    try { 
      await setDoc(doc(db, "payslips", payslip.id), safeClone(payslip)); 
    } catch (e) {
      console.error("Firestore error in updatePayslip:", e);
      throw e;
    }
  },
  subscribeToPayslips: (callback: (payslips: Payslip[]) => void) => {
    callback(loadLocal(KEYS.PAYSLIPS, []));
    return onSnapshot(collection(db, "payslips"), (snapshot) => {
      const payslips = snapshot.docs.map(doc => doc.data() as Payslip);
      const sorted = [...payslips].sort((a, b) => b.sentTimestamp - a.sentTimestamp);
      saveLocal(KEYS.PAYSLIPS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToPayslips:", err);
    });
  },
  subscribeToWorkerPayslips: (workerId: string, callback: (payslips: Payslip[]) => void) => {
    callback(loadLocal<Payslip[]>(KEYS.PAYSLIPS, []).filter(p => p.workerId === workerId));
    return onSnapshot(query(collection(db, "payslips"), where("workerId", "==", workerId)), (snapshot) => {
      const payslips = snapshot.docs.map(doc => doc.data() as Payslip);
      const sorted = [...payslips].sort((a, b) => b.sentTimestamp - a.sentTimestamp);
      saveLocal(KEYS.PAYSLIPS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkerPayslips:", err);
    });
  },
  getPayslipPdfBase64: async (payslip: Payslip): Promise<string> => {
    if (payslip.pdfBase64 && payslip.pdfBase64.length > 50) return payslip.pdfBase64;
    if (!payslip.pdfPath) return '';
    try {
      return await readStorageFileAsDataUri(payslip.pdfPath, payslip.pdfMimeType || 'application/pdf');
    } catch (e) {
      console.error("Error fetching payslip PDF:", e);
      return '';
    }
  },

  getChats: (): ChatMessage[] => loadLocal(KEYS.CHATS, []),
  sendMessage: async (msg: ChatMessage) => {
    const chats = loadLocal<ChatMessage[]>(KEYS.CHATS, []);
    saveLocal(KEYS.CHATS, [...chats, msg]);
    try {
      const user = auth.currentUser;
      if (!user) {
        throw new Error('Sesion Firebase no disponible para enviar el mensaje.');
      }

      const idToken = await user.getIdToken();
      const response = await fetch('/api/chats/send', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${idToken}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({ message: msg }),
      });

      const data = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(data?.error || 'No se pudo enviar el mensaje.');
      }

      if (data?.message) {
        const currentChats = loadLocal<ChatMessage[]>(KEYS.CHATS, []);
        const nextChats = currentChats.map(chat => chat.id === msg.id ? data.message as ChatMessage : chat);
        saveLocal(KEYS.CHATS, nextChats);
      }
    } catch (e) {
      const currentChats = loadLocal<ChatMessage[]>(KEYS.CHATS, []);
      saveLocal(KEYS.CHATS, currentChats.filter(chat => chat.id !== msg.id));
      console.error("Error in sendMessage:", e);
      throw e;
    }
  },
  subscribeToChats: (callback: (messages: ChatMessage[]) => void) => {
    callback(loadLocal(KEYS.CHATS, []));
    return onSnapshot(collection(db, "chats"), (snapshot) => {
      const msgs = snapshot.docs.map(doc => doc.data() as ChatMessage);
      const sorted = [...msgs].sort((a, b) => a.timestamp - b.timestamp);
      saveLocal(KEYS.CHATS, sorted);
      callback(sorted);
    }, (err) => {
      console.error("onSnapshot error in subscribeToChats:", err);
    });
  },
  subscribeToWorkerChats: (workerId: string, callback: (messages: ChatMessage[]) => void) => {
    const emit = (sent: ChatMessage[], received: ChatMessage[]) => {
      const byId = new Map<string, ChatMessage>();
      [...sent, ...received].forEach(msg => byId.set(msg.id, msg));
      const sorted = [...byId.values()].sort((a, b) => a.timestamp - b.timestamp);
      saveLocal(KEYS.CHATS, sorted);
      callback(sorted);
    };

    let sentMessages = loadLocal<ChatMessage[]>(KEYS.CHATS, []).filter(c => c.senderId === workerId);
    let receivedMessages = loadLocal<ChatMessage[]>(KEYS.CHATS, []).filter(c => c.receiverId === workerId);
    emit(sentMessages, receivedMessages);

    const unsubSent = onSnapshot(query(collection(db, "chats"), where("senderId", "==", workerId)), (snapshot) => {
      sentMessages = snapshot.docs.map(doc => doc.data() as ChatMessage);
      emit(sentMessages, receivedMessages);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkerChats sent:", err);
    });

    const unsubReceived = onSnapshot(query(collection(db, "chats"), where("receiverId", "==", workerId)), (snapshot) => {
      receivedMessages = snapshot.docs.map(doc => doc.data() as ChatMessage);
      emit(sentMessages, receivedMessages);
    }, (err) => {
      console.error("onSnapshot error in subscribeToWorkerChats received:", err);
    });

    return () => {
      unsubSent();
      unsubReceived();
    };
  },
  markMessagesAsRead: async (senderId: string, receiverId: string) => {
    try {
      const snapshot = await getDocs(query(collection(db, "chats"), where("receiverId", "==", receiverId)));
      const batch = writeBatch(db);
      let updated = false;
      snapshot.docs.forEach(d => {
        const data = d.data() as ChatMessage;
        if (data.senderId === senderId && data.receiverId === receiverId && !data.read) {
          batch.update(d.ref, { read: true });
          updated = true;
        }
      });
      if (updated) {
        await batch.commit();
      }
    } catch (e) {
      console.error("Error marking messages as read:", e);
    }
  },

  runMonthlyChatCleanup: async (): Promise<{ ok: boolean; deleted?: number; skipped?: string; cutoffTimestamp?: number }> => {
    const now = new Date();
    if (now.getDate() < 5) {
      return { ok: true, deleted: 0, skipped: 'La limpieza mensual se activa a partir del día 5.' };
    }

    const localRunKey = `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
    try {
      if (localStorage.getItem(CHAT_CLEANUP_LAST_RUN_KEY) === localRunKey) {
        return { ok: true, deleted: 0, skipped: 'Limpieza mensual ya comprobada hoy.' };
      }
    } catch (e) {}

    const user = auth.currentUser;
    if (!user) {
      return { ok: false, deleted: 0, skipped: 'Sesión Firebase no disponible para limpieza mensual.' };
    }

    const idToken = await user.getIdToken();
    const response = await fetch('/api/chats/cleanup', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${idToken}`,
      },
    });

    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(data?.error || 'No se pudo ejecutar la limpieza mensual de mensajes.');
    }

    try {
      localStorage.setItem(CHAT_CLEANUP_LAST_RUN_KEY, localRunKey);
      if (data?.cutoffTimestamp) {
        const currentChats = loadLocal<ChatMessage[]>(KEYS.CHATS, []);
        saveLocal(KEYS.CHATS, currentChats.filter(chat => Number(chat.timestamp || 0) >= Number(data.cutoffTimestamp)));
      }
    } catch (e) {}

    return data;
  },

  saveCertificateDoc: async (cert: StoredFileDoc) => {
    const storageBackedCert: StoredFileDoc = { ...cert };
    if (cert.fileBase64 && !cert.filePath) {
      const mimeType = cert.mimeType || getMimeTypeFromDataUri(cert.fileBase64, 'application/octet-stream');
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
      const filePath = `certificates/${cert.workerId}/${cert.id}/${sanitizeStorageFileName(cert.name)}.${extension}`;
      await uploadDataUriToStorage(filePath, cert.fileBase64, mimeType);
      storageBackedCert.filePath = filePath;
      storageBackedCert.mimeType = mimeType;
      storageBackedCert.fileBase64 = '';
    }

    try {
      await setDoc(doc(db, "certificates", storageBackedCert.id), safeClone(storageBackedCert));
      console.log(`[Firebase Sync] Certificate ${storageBackedCert.id} saved in certificates collection.`);
      return storageBackedCert;
    } catch (e) {
      console.error("Firestore error in saveCertificateDoc:", e);
      throw e;
    }
  },

  getCertificateBase64: async (certId: string): Promise<string> => {
    try {
      const cache = loadLocal<any[]>('carmagne_certs_cache', []);
      const match = cache.find(c => c.id === certId);
      if (match && match.fileBase64 && match.fileBase64.length > 50) return match.fileBase64;
    } catch (e) {}

    try {
      const docRef = doc(db, "certificates", certId);
      const snap = await getDoc(docRef);
      if (snap.exists()) {
        const data = snap.data() as StoredFileDoc;
        if (data && data.fileBase64) return data.fileBase64;
        if (data?.filePath) {
          return await readStorageFileAsDataUri(data.filePath, data.mimeType || 'application/octet-stream');
        }
      }
    } catch (e) {
      console.error("Error fetching certificate base64:", e);
    }
    return '';
  },

  deleteCertificateDoc: async (certId: string) => {
    try {
      const cache = loadLocal<any[]>('carmagne_certs_cache', []);
      localStorage.setItem('carmagne_certs_cache', JSON.stringify(cache.filter(c => c.id !== certId)));
    } catch (e) {}

    try {
      const docRef = doc(db, "certificates", certId);
      const snap = await getDoc(docRef).catch(() => null);
      const existing = snap?.exists() ? snap.data() as StoredFileDoc : null;
      if (existing?.filePath) {
        await deleteObject(storageRef(storage, existing.filePath)).catch(() => {});
      }
      await deleteDoc(doc(db, "certificates", certId));
    } catch (e) {
      console.error("Error deleting certificate doc:", e);
    }
  }
};
