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
// Fallback para SPA / rutas directas
app.get('*', (req, res) => {
  res.sendFile(join(__dirname, 'index.html'));
});

// ─── Variables en memoria ────────────────────────────────
const tasks = new Map();
const sessions = new Map();
// =====================================================
//  FUNCIONES DE PROCESAMIENTO 3D
// =====================================================

function detectDominantBackground(img) {
  const w = img.width, h = img.height;
  const samples = [];

  for (let i = 0; i < 35; i++) {
    const x = Math.floor(Math.random() * w * 0.45);
    const y = Math.floor(Math.random() * h * 0.45);
    samples.push(img.getPixelColor(x, y));
  }

  for (let x = 0; x < w; x += 5) {
    samples.push(img.getPixelColor(x, 0));
    samples.push(img.getPixelColor(x, h - 1));
  }
  for (let y = 0; y < h; y += 5) {
    samples.push(img.getPixelColor(0, y));
    samples.push(img.getPixelColor(w - 1, y));
  }

  const colorMap = new Map();
  let maxCount = 0, dominant = 0;

  for (const color of samples) {
    const key = color.toString();
    colorMap.set(key, (colorMap.get(key) || 0) + 1);
    if (colorMap.get(key) > maxCount) {
      maxCount = colorMap.get(key);
      dominant = color;
    }
  }

  const r = (dominant >>> 24) & 0xff;
  const g = (dominant >>> 16) & 0xff;
  const b = (dominant >>> 8) & 0xff;
  return { r, g, b };
}

async function removePaperBackground(img) {
  const bg = detectDominantBackground(img);
  const w = img.width;
  const h = img.height;
  const data = img.bitmap.data;
  const tolerance = 55;

  console.log(`🎨 Fondo detectado: RGB(${bg.r}, ${bg.g}, ${bg.b})`);

  for (let i = 0; i < w * h; i++) {
    const idx = i * 4;
    const r = data[idx], g = data[idx + 1], b = data[idx + 2];
    const dist = Math.hypot(r - bg.r, g - bg.g, b - bg.b);
    if (dist < tolerance) {
      data[idx] = data[idx + 1] = data[idx + 2] = 255;
    }
  }

  img = img.convolute([[0,0,0],[0,1,0],[0,0,0]]);
  return img;
}
async function generateGlb(imageBuffer) {
  let img = await Jimp.fromBuffer(imageBuffer);

  console.log('🧼 Iniciando limpieza de fondo de hoja...');
  img = await removePaperBackground(img);
  console.log('✅ Fondo limpiado correctamente');

  const ow = img.width;
  const oh = img.height;
  if (ow < 2 || oh < 2) throw new Error('Imagen demasiado pequeña');

  const GRID_MAX = 144;
  const DEPTH_SCALE = 0.38;

  let GW, GH;
  if (ow >= oh) {
    GW = GRID_MAX;
    GH = Math.max(32, Math.round(GRID_MAX * (oh / ow)));
  } else {
    GH = GRID_MAX;
    GW = Math.max(32, Math.round(GRID_MAX * (ow / oh)));
  }

  const resized = img.clone().resize({ w: GW, h: GH });

  const resAlpha = new Uint8Array(GW * GH).fill(255);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const idx = j * GW + i;
      const c = resized.getPixelColor(i, j);
      const r = (c >>> 24) & 0xff;
      if (r > 245) resAlpha[idx] = 0;
    }
  }

  const depthMap = new Float32Array(GW * GH);
  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const idx = j * GW + i;
      if (resAlpha[idx] === 0) {
        depthMap[idx] = 0;
        continue;
      }
      const c = resized.getPixelColor(i, j);
      const r = (c >>> 24) & 0xff;
      const g = (c >>> 16) & 0xff;
      const b = (c >>> 8) & 0xff;
      depthMap[idx] = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
    }
  }

  for (let i = 0; i < depthMap.length; i++) {
    if (depthMap[i] < 0.08) depthMap[i] = 0;
  }

  const positions = [];
  const texcoords = [];
  const normals = [];
  const indices = [];
  const aspect = ow / oh;

  for (let j = 0; j < GH; j++) {
    for (let i = 0; i < GW; i++) {
      const u = GW > 1 ? i / (GW - 1) : 0;
      const v = GH > 1 ? j / (GH - 1) : 0;
      const z = depthMap[j * GW + i] * DEPTH_SCALE;
      positions.push((u - 0.5) * 2, (0.5 - v) * 2 * aspect, z);
      texcoords.push(u, v);
      normals.push(0, 0, 1);
    }
  }

  for (let j = 0; j < GH - 1; j++) {
    for (let i = 0; i < GW - 1; i++) {
      const a = j * GW + i;
      const b = a + 1;
      const c = (j + 1) * GW + i;
      const d = c + 1;
      if (resAlpha[a] && resAlpha[b] && resAlpha[c] && resAlpha[d]) {
        indices.push(a, c, b, b, c, d);
      }
    }
  }

  if (indices.length === 0) {
    throw new Error('No se detectó dibujo suficiente. Intenta con más contraste.');
  }

  const texImg = img.clone().resize({ w: 1024, h: Math.round(1024 * (oh / ow)) || 1024 });
  const texBuf = await texImg.getBuffer('image/png');

  return buildGlb(positions, normals, texcoords, indices, texBuf);
}

function buildGlb(positions, normals, texcoords, indices, textureBuffer) {
  const posF = new Float32Array(positions);
  const normF = new Float32Array(normals);
  const uvF = new Float32Array(texcoords);
  const idxU = new Uint32Array(indices);

  const pad = (buf, fill = 0) => {
    const r = buf.length % 4;
    return r === 0 ? buf : Buffer.concat([buf, Buffer.alloc(4 - r, fill)]);
  };

  const pB = pad(Buffer.from(posF.buffer));
  const nB = pad(Buffer.from(normF.buffer));
  const uB = pad(Buffer.from(uvF.buffer));
  const iB = pad(Buffer.from(idxU.buffer));
  const tB = pad(textureBuffer);

  let off = 0;
  const po = off; off += pB.length;
  const no = off; off += nB.length;
  const uo = off; off += uB.length;
  const io = off; off += iB.length;
  const to = off; off += tB.length;

  const bin = Buffer.concat([pB, nB, uB, iB, tB]);

  const vc = positions.length / 3;
  const ic = indices.length;

  let mn = [1e9, 1e9, 1e9], mx = [-1e9, -1e9, -1e9];
  for (let i = 0; i < positions.length; i += 3) {
    mn[0] = Math.min(mn[0], positions[i]);
    mn[1] = Math.min(mn[1], positions[i + 1]);
    mn[2] = Math.min(mn[2], positions[i + 2]);
    mx[0] = Math.max(mx[0], positions[i]);
    mx[1] = Math.max(mx[1], positions[i + 1]);
    mx[2] = Math.max(mx[2], positions[i + 2]);
  }

  const gltf = {
    asset: { version: '2.0', generator: 'LocalImage3D-Clean' },
    extensionsUsed: ['KHR_materials_unlit'],
    scene: 0,
    scenes: [{ nodes: [0] }],
    nodes: [{ mesh: 0 }],
    meshes: [{
      primitives: [{
        attributes: { POSITION: 0, NORMAL: 1, TEXCOORD_0: 2 },
        indices: 3,
        material: 0
      }]
    }],
    materials: [{
      extensions: { KHR_materials_unlit: {} },
      pbrMetallicRoughness: {
        baseColorTexture: { index: 0 },
        baseColorFactor: [1, 1, 1, 1],
        metallicFactor: 0,
        roughnessFactor: 1
      },
      alphaMode: 'MASK',
      alphaCutoff: 0.48,
      doubleSided: true
    }],
    textures: [{ source: 0, sampler: 0 }],
    samplers: [{ magFilter: 9729, minFilter: 9987, wrapS: 10497, wrapT: 10497 }],
    images: [{ mimeType: 'image/png', bufferView: 4 }],
    accessors: [
      { bufferView: 0, componentType: 5126, count: vc, type: 'VEC3', min: mn, max: mx },
      { bufferView: 1, componentType: 5126, count: vc, type: 'VEC3' },
      { bufferView: 2, componentType: 5126, count: vc, type: 'VEC2' },
      { bufferView: 3, componentType: 5125, count: ic, type: 'SCALAR' }
    ],
    bufferViews: [
      { buffer: 0, byteOffset: po, byteLength: pB.length, target: 34962 },
      { buffer: 0, byteOffset: no, byteLength: nB.length, target: 34962 },
      { buffer: 0, byteOffset: uo, byteLength: uB.length, target: 34962 },
      { buffer: 0, byteOffset: io, byteLength: iB.length, target: 34963 },
      { buffer: 0, byteOffset: to, byteLength: tB.length }
    ],
    buffers: [{ byteLength: bin.length }]
  };

  const jB = pad(Buffer.from(JSON.stringify(gltf), 'utf8'), 0x20);
  const total = 12 + 8 + jB.length + 8 + bin.length;

  const h = Buffer.alloc(12);
  h.writeUInt32LE(0x46546c67, 0);
  h.writeUInt32LE(2, 4);
  h.writeUInt32LE(total, 8);

  const jH = Buffer.alloc(8);
  jH.writeUInt32LE(jB.length, 0);
  jH.writeUInt32LE(0x4e4f534a, 4);

  const bH = Buffer.alloc(8);
  bH.writeUInt32LE(bin.length, 0);
  bH.writeUInt32LE(0x004e4942, 4);

  return Buffer.concat([h, jH, jB, bH, bin]);
}
// =====================================================
//  RUTAS API
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

// Rutas de Auth y Projects (temporalmente desactivadas)
app.post('/api/auth/register', async (req, res) => {
  res.status(501).json({ error: 'Registro en desarrollo' });
});
app.post('/api/auth/login', async (req, res) => {
  res.status(501).json({ error: 'Login en desarrollo' });
});
app.get('/api/auth/me', async (req, res) => {
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});
app.post('/api/projects', async (req, res) => {
  res.status(501).json({ error: 'Guardado en desarrollo' });
});
app.get('/api/projects', async (req, res) => {
  res.status(501).json({ error: 'Funcionalidad en desarrollo' });
});

app.get('/', (req, res) => res.sendFile(join(__dirname, 'index.html')));

// =====================================================
//  INICIAR SERVIDOR
// =====================================================
const server = app.listen(PORT, '0.0.0.0', () => {
  console.log('');
  console.log('✅ Servidor corriendo correctamente en Render.com');
  console.log(`🌐 URL: https://${process.env.RENDER_EXTERNAL_HOSTNAME || 'localhost:' + PORT}`);
  console.log('🧼 Limpieza automática de fondo activada');
  console.log('');
});

server.on('error', (err) => {
  console.error('❌ Error:', err.message);
});
