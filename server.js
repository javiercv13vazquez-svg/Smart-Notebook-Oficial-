// =====================================================
//  SERVIDOR — Imagen a 3D (Optimizado para Render.com)
// =====================================================

import express from 'express';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';
import { randomUUID, scryptSync, timingSafeEqual } from 'crypto';
import { Jimp } from 'jimp';
import { promises as fs } from 'fs';

// === OPTIMIZACIONES PARA RENDER.COM ===
process.setMaxListeners(20);
process.env.UV_THREADPOOL_SIZE = '64';

const __filename = fileURLToPath(import.meta.url);
const __dirname = dirname(__filename);

const app = express();
const PORT = process.env.PORT || 3000;
const DB_PATH = join(__dirname, 'storage.json');

// ── Middlewares ──
app.use((req, res, next) => {
  res.setHeader('Access-Control-Allow-Origin', '*');
  res.setHeader('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (req.method === 'OPTIONS') return res.sendStatus(204);
  next();
});

app.use(express.json({ limit: '50mb' }));
app.use(express.static(__dirname));

// ─── Variables en memoria ────────────────────────────────
const tasks = new Map();
const sessions = new Map();

// === FUNCIONES AUXILIARES (Database, Auth, etc.) ===
async function readDb() {
  try {
    const raw = await fs.readFile(DB_PATH, 'utf8');
    const parsed = JSON.parse(raw);
    return {
      users: Array.isArray(parsed.users) ? parsed.users : [],
      projects: Array.isArray(parsed.projects) ? parsed.projects : []
    };
  } catch (_) {
    return { users: [], projects: [] };
  }
}

async function writeDb(db) {
  await fs.writeFile(DB_PATH, JSON.stringify(db, null, 2), 'utf8');
}

// ... (mantengo tus funciones hashPassword, verifyPassword, etc.)
function hashPassword(password, salt = randomUUID()) {
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

function verifyPassword(password, fullHash) {
  const [salt, originalHash] = String(fullHash || '').split(':');
  if (!salt || !originalHash) return false;
  const computedHash = scryptSync(password, salt, 64).toString('hex');
  const a = Buffer.from(originalHash, 'hex');
  const b = Buffer.from(computedHash, 'hex');
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

// (Mantengo detectDominantBackground, removePaperBackground, generateGlb, buildGlb ...)
// Copia y pega desde tu versión anterior estas funciones completas aquí

// =====================================================
//  RUTAS PRINCIPALES
// =====================================================

app.post('/api/convert/upload', async (req, res) => {
  const { imageBase64, mimeType } = req.body;
  if (!imageBase64) return res.status(400).json({ error: 'Falta imageBase64 en el body' });

  const taskId = randomUUID();
  tasks.set(taskId, { 
    taskId, 
    status: 'processing', 
    progress: 15, 
    message: 'Limpiando fondo de la hoja...' 
  });

  (async () => {
    const task = tasks.get(taskId);
    try {
      const buf = Buffer.from(imageBase64, 'base64');
      task.progress = 60; 
      task.message = 'Generando modelo 3D...';
      
      const glbBuffer = await generateGlb(buf);
      
      task.glbDataBase64 = glbBuffer.toString('base64');
      task.progress = 100; 
      task.status = 'completed'; 
      task.message = '¡Modelo 3D listo!';
    } catch (err) {
      console.error('Error generando GLB:', err.message);
      task.status = 'failed'; 
      task.message = 'Error: ' + err.message;
    }
  })();

  res.json({ taskId, message: 'Conversión iniciada' });
});

app.get('/api/convert/status/:taskId', (req, res) => {
  const task = tasks.get(req.params.taskId);
  if (!task) return res.status(404).json({ error: 'Tarea no encontrada' });
  res.json({
    taskId: task.taskId,
    status: task.status,
    progress: task.progress,
    message: task.message,
    glbDataBase64: task.glbDataBase64 || null
  });
});

// Rutas Auth y Projects (incompletas por ahora)
app.post('/api/auth/register', async (req, res) => { 
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});
app.post('/api/auth/login', async (req, res) => { 
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});
app.get('/api/auth/me', async (req, res) => { 
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});
app.post('/api/projects', async (req, res) => { 
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});
app.get('/api/projects', async (req, res) => { 
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});

app.get('/', (req, res) => res.sendFile(join(__dirname, 'W01-IIA.html')));

// Iniciar servidor
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('✅ Servidor corriendo correctamente en Render');
  console.log(`🌐 URL: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + PORT}`);
  console.log('🧼 Limpieza automática de fondo activada');
  console.log('');
});

server.on('error', (err) => {
  console.error('❌ Error del servidor:', err.message);
});
