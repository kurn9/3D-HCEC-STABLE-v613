/* =========================
   DOM
========================= */

const $ = (id) => document.getElementById(id);

const dom = {
  viewport: $("viewport"),
  status: $("status"),
  crosshair: $("crosshair"),

  selectedTitle: $("selectedTitle"),

  btnLock: $("btnLock"),
  btnAddWall: $("btnAddWall"),
  btnDuplicate: $("btnDuplicate"),
  btnDelete: $("btnDelete"),
  btnPlace: $("btnPlace"),
  btnExport: $("btnExport"),
  btnDraft: $("btnDraft"),
  btnApply: $("btnApply"),
  btnFocus: $("btnFocus"),

  btnValidate: $("btnValidate"),
  btnImport: $("btnImport"),
  importFile: $("importFile"),
  btnPreviewPopup: $("btnPreviewPopup"),
  dirtyBadge: $("dirtyBadge"),
  validationPanel: $("validationPanel"),
  backupSelect: $("backupSelect"),
  btnRestoreBackup: $("btnRestoreBackup"),
  btnClearBackups: $("btnClearBackups"),

  previewOverlay: $("previewOverlay"),
  previewCloseBtn: $("previewCloseBtn"),
  previewImage: $("previewImage"),
  previewBadge: $("previewBadge"),
  previewTitle: $("previewTitle"),
  previewDescription: $("previewDescription"),
  previewAuthor: $("previewAuthor"),
  previewYear: $("previewYear"),
  previewMaterial: $("previewMaterial"),
  previewRealSize: $("previewRealSize"),
  previewContent: $("previewContent"),

  btnLeft: $("btnLeft"),
  btnRight: $("btnRight"),
  btnUp: $("btnUp"),
  btnDown: $("btnDown"),
  btnForward: $("btnForward"),
  btnBack: $("btnBack"),
  btnBigger: $("btnBigger"),
  btnSmaller: $("btnSmaller"),
  btnRotateLeft90: $("btnRotateLeft90"),

  search: $("search"),
  groupFilter: $("groupFilter"),
  advancedFilter: $("advancedFilter"),
  list: $("list"),

  fId: $("fId"),
  fTitle: $("fTitle"),
  fImage: $("fImage"),
  fDesc: $("fDesc"),
  fGroup: $("fGroup"),
  fAuthor: $("fAuthor"),
  fYear: $("fYear"),
  fMaterial: $("fMaterial"),
  fRealSize: $("fRealSize"),
  fContent: $("fContent"),
  fNote: $("fNote"),

  fX: $("fX"),
  fY: $("fY"),
  fZ: $("fZ"),
  fRX: $("fRX"),
  fRY: $("fRY"),
  fRZ: $("fRZ"),
  fW: $("fW"),
  fH: $("fH"),
  fFrame: $("fFrame"),
  fTransparent: $("fTransparent"),
  fClickable: $("fClickable")
};

function setStatus(html) {
  dom.status.innerHTML = html;
}

/* =========================
   THREE SETUP
========================= */

const scene = new THREE.Scene();
scene.background = new THREE.Color(0x1c1c1c);

const camera = new THREE.PerspectiveCamera(
  65,
  dom.viewport.clientWidth / dom.viewport.clientHeight,
  0.1,
  5000
);

camera.position.set(0, CONFIG.eyeHeight, 5);
camera.rotation.order = "YXZ";

const renderer = new THREE.WebGLRenderer({
  antialias: true,
  powerPreference: "high-performance"
});

renderer.setSize(dom.viewport.clientWidth, dom.viewport.clientHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.outputColorSpace = THREE.SRGBColorSpace;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.05;

dom.viewport.appendChild(renderer.domElement);

scene.add(new THREE.HemisphereLight(0xffffff, 0x444444, 1.25));

const dirLight = new THREE.DirectionalLight(0xffffff, 1.8);
dirLight.position.set(5, 10, 5);
scene.add(dirLight);

const fillLight = new THREE.DirectionalLight(0xffffff, 0.65);
fillLight.position.set(-5, 6, -5);
scene.add(fillLight);

/* =========================
   STATE
========================= */

const clock = new THREE.Clock();

const gltfLoader = new GLTFLoader();
const textureLoader = new THREE.TextureLoader();

const raycaster = new THREE.Raycaster();
const groundRaycaster = new THREE.Raycaster();
const wallRaycaster = new THREE.Raycaster();

const downVector = new THREE.Vector3(0, -1, 0);

let data = [];
let selectedId = null;
let isDirty = false;

let isLocked = false;
let yaw = 0;
let pitch = 0;
let fallbackFloorY = 0;
let roomReady = false;

const keys = {};
const roomMeshes = [];
const walkableObjects = [];
const colliderObjects = [];

const itemGroups = new Map();
const selectableMeshes = [];
