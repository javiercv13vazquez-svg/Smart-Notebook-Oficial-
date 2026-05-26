// Servidor local: POST /api/convert/upload + GET /api/convert/status/:id
// Abre la app desde http://localhost:3000 (node server.js) o define el puerto abajo.

// === CONFIGURACIÓN DE URL DEL SERVIDOR (Render + Local) ===
function getApiBase() {
  // 1. Si estás probando en tu computadora local
  if (window.location.hostname === 'localhost' || window.location.hostname === '127.0.0.1') {
    return 'http://localhost:3000';
  }
  
  // 2. Para Netlify o cualquier entorno en producción
  // Quitamos cualquier barra diagonal al final para que los fetches se armen limpios
  return 'https://smart-notebook-oficial.onrender.com';
}

const API_BASE = getApiBase();

const scanBox = document.getElementById('scanBox');
const overlay = document.getElementById('analyzingOverlay');
const analyzingText = document.getElementById('analyzingText') || document.querySelector('.analyzing-text');
const modelViewer = document.getElementById('reveal-model');
const modelSection = document.getElementById('modelSection');
const processingSection = document.getElementById('processingSection');
const startBtn = document.getElementById('startBtn');
const captureBtn = document.getElementById('captureBtn');
const resetBtn = document.getElementById('resetBtn');
const scanAgainBtn = document.getElementById('scanAgainBtn');
const cameraPreview = document.getElementById('cameraPreview');
const scanPlaceholder = document.getElementById('scanPlaceholder');
const cameraModeBtn = document.getElementById('cameraModeBtn');
const uploadModeBtn = document.getElementById('uploadModeBtn');
const uploadBox = document.getElementById('uploadBox');
const imageUploadInput = document.getElementById('imageUploadInput');
const selectImageBtn = document.getElementById('selectImageBtn');
const uploadedPreview = document.getElementById('uploadedPreview');
const uploadPlaceholder = document.getElementById('uploadPlaceholder');
const generateUploadBtn = document.getElementById('generateUploadBtn');
const saveProjectBtn = document.getElementById('saveProjectBtn');
const authNameInput = document.getElementById('authName');
const authEmailInput = document.getElementById('authEmail');
const authPasswordInput = document.getElementById('authPassword');
const registerBtn = document.getElementById('registerBtn');
const loginBtn = document.getElementById('loginBtn');
const logoutBtn = document.getElementById('logoutBtn');
const authStatus = document.getElementById('authStatus');

let currentMode = 'camera';
let uploadedImageFile = null;
let currentStream = null;
let currentModelBlobUrl = null;
let currentModelBase64 = null;
let currentUser = null;
let authToken = localStorage.getItem('authToken') || '';
const AUTH_DRAFT_KEY = 'authDraft';

function setAuthStatus(message, isError = false) {
  if (!authStatus) return;
  authStatus.textContent = message;
  authStatus.style.color = isError ? '#b91c1c' : '';
}

function saveAuthDraft() {
  const draft = {
    name: authNameInput?.value?.trim() || '',
    email: authEmailInput?.value?.trim() || ''
  };
  localStorage.setItem(AUTH_DRAFT_KEY, JSON.stringify(draft));
}

function restoreAuthDraft() {
  const raw = localStorage.getItem(AUTH_DRAFT_KEY);
  if (!raw) return;
  try {
    const draft = JSON.parse(raw);
    if (authNameInput && draft.name) authNameInput.value = draft.name;
    if (authEmailInput && draft.email) authEmailInput.value = draft.email;
  } catch (_) {
    localStorage.removeItem(AUTH_DRAFT_KEY);
  }
}

function refreshAuthUi() {
  if (currentUser) {
    if (registerBtn) registerBtn.classList.add('hidden');
    if (loginBtn) loginBtn.classList.add('hidden');
    if (logoutBtn) logoutBtn.classList.remove('hidden');
    setAuthStatus(`Sesión activa: ${currentUser.email}`);
  } else {
    if (registerBtn) registerBtn.classList.remove('hidden');
    if (loginBtn) loginBtn.classList.remove('hidden');
    if (logoutBtn) logoutBtn.classList.add('hidden');
    setAuthStatus('No has iniciado sesión.');
  }
}

function getAuthPayload() {
  const name = authNameInput?.value?.trim() || '';
  const email = authEmailInput?.value?.trim() || '';
  const password = authPasswordInput?.value || '';
  if (!email || !password) {
    throw new Error('Ingresa correo y contraseña.');
  }
  return { name, email, password };
}

async function registerAccount() {
  const payload = getAuthPayload();
  const res = await fetch(`${API_BASE}/api/auth/register`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload)
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'No se pudo registrar la cuenta.');
  }
  authToken = data.token || '';
  currentUser = data.user || null;
  localStorage.setItem('authToken', authToken);
  localStorage.removeItem(AUTH_DRAFT_KEY);
  if (authPasswordInput) authPasswordInput.value = '';
  refreshAuthUi();
}

async function loginAccount() {
  const payload = getAuthPayload();
  const res = await fetch(`${API_BASE}/api/auth/login`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email: payload.email, password: payload.password })
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error(data.error || 'Credenciales inválidas.');
  }
  authToken = data.token || '';
  currentUser = data.user || null;
  localStorage.setItem('authToken', authToken);
  if (authPasswordInput) authPasswordInput.value = '';
  refreshAuthUi();
}

function logoutAccount() {
  currentUser = null;
  authToken = '';
  localStorage.removeItem('authToken');
  refreshAuthUi();
}

async function loadCurrentSession() {
  if (!authToken) {
    refreshAuthUi();
    return;
  }
  const res = await fetch(`${API_BASE}/api/auth/me`, {
    headers: { Authorization: `Bearer ${authToken}` }
  });
  if (!res.ok) {
    logoutAccount();
    return;
  }
  const data = await res.json().catch(() => ({}));
  currentUser = data.user || null;
  refreshAuthUi();
}

function setProcessingMessage(message) {
  if (analyzingText) {
    analyzingText.innerText = message;
  }
}

function readFileAsBase64(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => {
      const result = String(reader.result);
      const comma = result.indexOf(',');
      const header = result.slice(0, comma);
      const base64 = result.slice(comma + 1);
      const mimeMatch = header.match(/:(.*?);/);
      const mime = mimeMatch ? mimeMatch[1] : file.type || 'image/jpeg';
      resolve({ base64, mime });
    };
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function captureFrameAsBase64() {
  if (!cameraPreview.videoWidth || !cameraPreview.videoHeight) {
    throw new Error('La cámara aún no está lista para capturar.');
  }

  const canvas = document.createElement('canvas');
  canvas.width = cameraPreview.videoWidth;
  canvas.height = cameraPreview.videoHeight;
  const ctx = canvas.getContext('2d');
  ctx.drawImage(cameraPreview, 0, 0, canvas.width, canvas.height);

  const dataUrl = canvas.toDataURL('image/jpeg', 0.9);
  const base64 = dataUrl.split(',')[1];
  return { base64, mime: 'image/jpeg' };
}

async function convertImageToGlbBase64({ base64, mime }) {
  setProcessingMessage('Enviando imagen al servidor...');

  const uploadRes = await fetch(`${API_BASE}/api/convert/upload`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ imageBase64: base64, mimeType: mime })
  });

  if (!uploadRes.ok) {
    const text = await uploadRes.text().catch(() => '');
    throw new Error(`El servidor respondió ${uploadRes.status}. ${text || '¿Está corriendo node server.js?'}`);
  }

  const { taskId } = await uploadRes.json();
  if (!taskId) {
    throw new Error('El servidor no devolvió un ID de tarea.');
  }

  const maxAttempts = 90;
  for (let i = 0; i < maxAttempts; i++) {
    await new Promise((r) => setTimeout(r, 800));

    const statusRes = await fetch(`${API_BASE}/api/convert/status/${taskId}`);
    if (!statusRes.ok) {
      throw new Error('No se pudo consultar el estado de la conversión.');
    }

    const data = await statusRes.json();
    setProcessingMessage(data.message || 'Procesando...');

    if (data.status === 'completed' && data.glbDataBase64) {
      return data.glbDataBase64;
    }
    if (data.status === 'failed') {
      throw new Error(data.message || 'El servidor no pudo generar el modelo 3D.');
    }
  }

  throw new Error('Tiempo de espera agotado. Prueba con una imagen más pequeña o reinicia el servidor.');
}

function glbBase64ToObjectUrl(glbBase64) {
  const bytes = atob(glbBase64);
  const arr = new Uint8Array(bytes.length);
  for (let i = 0; i < bytes.length; i++) {
    arr[i] = bytes.charCodeAt(i);
  }
  const blob = new Blob([arr], { type: 'model/gltf-binary' });
  return URL.createObjectURL(blob);
}

async function startCamera() {
  try {
    const stream = await navigator.mediaDevices.getUserMedia({
      video: true
    });

    currentStream = stream;
    cameraPreview.srcObject = stream;
    cameraPreview.style.display = 'block';
    scanPlaceholder.style.display = 'none';

    await cameraPreview.play();

    captureBtn.disabled = false;
    resetBtn.disabled = false;
  } catch (error) {
    console.error('Error al abrir la cámara:', error);
    alert('No se pudo acceder a la cámara. Revisa los permisos del navegador.');
  }
}

function stopCamera() {
  if (currentStream) {
    currentStream.getTracks().forEach((track) => track.stop());
    currentStream = null;
  }

  cameraPreview.srcObject = null;
  cameraPreview.style.display = 'none';
  scanPlaceholder.style.display = 'flex';
  captureBtn.disabled = true;
}

function resetInterface() {
  stopCamera();

  if (currentModelBlobUrl) {
    URL.revokeObjectURL(currentModelBlobUrl);
    currentModelBlobUrl = null;
  }
  modelViewer.src = '';
  uploadedImageFile = null;

  if (imageUploadInput) imageUploadInput.value = '';
  if (uploadedPreview) {
    uploadedPreview.src = '';
    uploadedPreview.classList.add('hidden');
  }
  if (uploadPlaceholder) {
    uploadPlaceholder.classList.remove('hidden');
  }

  if (modelSection) modelSection.style.display = 'none';
  if (processingSection) processingSection.style.display = 'flex';

  overlay.classList.remove('active');

  if (currentMode === 'camera') {
    captureBtn.disabled = true;
  }

  if (generateUploadBtn) {
    generateUploadBtn.disabled = true;
  }
  if (saveProjectBtn) {
    saveProjectBtn.disabled = true;
  }
  currentModelBase64 = null;

  setProcessingMessage('Procesando imagen y generando modelo 3D...');
}

function setMode(mode) {
  currentMode = mode;

  if (mode === 'camera') {
    cameraModeBtn?.classList.add('active');
    uploadModeBtn?.classList.remove('active');

    scanBox?.classList.remove('hidden');
    uploadBox?.classList.add('hidden');

    captureBtn?.classList.remove('hidden');
    generateUploadBtn?.classList.add('hidden');

    if (!currentStream) {
      captureBtn.disabled = true;
    }
  } else {
    cameraModeBtn?.classList.remove('active');
    uploadModeBtn?.classList.add('active');

    scanBox?.classList.add('hidden');
    uploadBox?.classList.remove('hidden');

    captureBtn?.classList.add('hidden');
    generateUploadBtn?.classList.remove('hidden');
    generateUploadBtn.disabled = !uploadedImageFile;

    stopCamera();
  }

  resetBtn.disabled = false;
}

function handleUploadedImage(file) {
  if (!file) return;

  uploadedImageFile = file;

  const imageUrl = URL.createObjectURL(file);
  uploadedPreview.src = imageUrl;
  uploadedPreview.classList.remove('hidden');
  uploadPlaceholder.classList.add('hidden');

  generateUploadBtn.disabled = false;
  resetBtn.disabled = false;
}

async function processDrawing() {
  try {
    overlay.classList.add('active');

    if (processingSection) processingSection.style.display = 'flex';
    if (modelSection) modelSection.style.display = 'none';

    let imagePayload;

    if (currentMode === 'camera') {
      setProcessingMessage('Capturando imagen...');
      imagePayload = captureFrameAsBase64();
      stopCamera();
    } else {
      if (!uploadedImageFile) {
        throw new Error('Primero selecciona una imagen.');
      }
      setProcessingMessage('Leyendo imagen...');
      imagePayload = await readFileAsBase64(uploadedImageFile);
    }

    const glbBase64 = await convertImageToGlbBase64(imagePayload);
    currentModelBase64 = glbBase64;

    setProcessingMessage('Cargando modelo 3D...');
    if (currentModelBlobUrl) {
      URL.revokeObjectURL(currentModelBlobUrl);
    }
    currentModelBlobUrl = glbBase64ToObjectUrl(glbBase64);
    modelViewer.src = currentModelBlobUrl;

    if (processingSection) processingSection.style.display = 'none';
    if (modelSection) modelSection.style.display = 'block';
    if (saveProjectBtn) saveProjectBtn.disabled = false;

    setProcessingMessage('¡Modelo listo! (generación local sin API externa)');
  } catch (error) {
    console.error('Fallo de sistema:', error);
    const msg = error?.message || 'Error desconocido';
    setProcessingMessage(`Error: ${msg}`);
    alert(
      'No se pudo generar el modelo 3D.\n\n' +
        msg +
        '\n\nComprueba que el servidor local está en marcha (node server.js o iniciar.bat) y que abres la página en el mismo puerto, por ejemplo http://localhost:3000'
    );
    overlay.classList.remove('active');
    resetBtn.disabled = false;
  }
}

async function saveCurrentProject() {
  try {
    if (!currentUser || !authToken) {
      throw new Error('Inicia sesión para guardar el proyecto.');
    }
    if (!currentModelBase64) {
      throw new Error('Primero genera un modelo 3D.');
    }
    const res = await fetch(`${API_BASE}/api/projects`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${authToken}`
      },
      body: JSON.stringify({
        name: `Proyecto ${new Date().toLocaleString('es-MX')}`,
        glbDataBase64: currentModelBase64
      })
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) {
      throw new Error(data.error || 'No se pudo guardar el proyecto.');
    }
    alert('Proyecto guardado correctamente.');
  } catch (error) {
    alert(error?.message || 'No se pudo guardar el proyecto.');
  }
}

scanBox?.addEventListener('click', () => {
  if (!currentStream) startCamera();
});

scanBox?.addEventListener('keydown', (e) => {
  if (e.key === 'Enter' || e.key === ' ') {
    e.preventDefault();
    if (!currentStream) startCamera();
  }
});

startBtn?.addEventListener('click', () => {
  if (currentMode === 'camera') {
    if (!currentStream) startCamera();
  } else {
    imageUploadInput?.click();
  }
});

captureBtn?.addEventListener('click', processDrawing);
resetBtn?.addEventListener('click', resetInterface);
scanAgainBtn?.addEventListener('click', resetInterface);

cameraModeBtn?.addEventListener('click', () => setMode('camera'));
uploadModeBtn?.addEventListener('click', () => setMode('upload'));

selectImageBtn?.addEventListener('click', () => {
  imageUploadInput?.click();
});

imageUploadInput?.addEventListener('change', (e) => {
  const file = e.target.files?.[0];
  if (file) {
    handleUploadedImage(file);
  }
});

generateUploadBtn?.addEventListener('click', processDrawing);
saveProjectBtn?.addEventListener('click', saveCurrentProject);

authNameInput?.addEventListener('input', saveAuthDraft);
authEmailInput?.addEventListener('input', saveAuthDraft);

registerBtn?.addEventListener('click', async () => {
  try {
    await registerAccount();
  } catch (error) {
    setAuthStatus(error?.message || 'No se pudo registrar.', true);
  }
});

loginBtn?.addEventListener('click', async () => {
  try {
    await loginAccount();
  } catch (error) {
    setAuthStatus(error?.message || 'No se pudo iniciar sesión.', true);
  }
});

logoutBtn?.addEventListener('click', logoutAccount);

restoreAuthDraft();
refreshAuthUi();
loadCurrentSession();
