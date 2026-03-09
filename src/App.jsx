import { useState, useRef, useCallback, useEffect } from "react";

// ─── Design Tokens ────────────────────────────────────────────────────────────
const T = {
  bg:       "#F7F4EF",
  bgCard:   "#FFFFFF",
  bgMuted:  "#F0EDE7",
  border:   "#E2DDD6",
  ink:      "#1A1714",
  inkMid:   "#4A4540",
  inkFaint: "#9A9590",
  accent:   "#C9773A",
  accentHov:"#A85E25",
  accentLt: "#F5E9DE",
  green:    "#4A8C5C",
  red:      "#B5453A",
  shadow:   "0 2px 16px rgba(60,40,20,0.10)",
  shadowLg: "0 8px 40px rgba(60,40,20,0.16)",
};

// ─── Poster Canvas Constants ───────────────────────────────────────────────────
const CANVAS_SIZE  = 1000;
const CENTER       = CANVAS_SIZE / 2;
// Full-face sketch — portrait proportions (4:5)
const SKETCH_W     = 320;
const SKETCH_H     = 400;
// Elliptical safe zone sized around the face sketch
const SAFE_CX = CENTER, SAFE_CY = CENTER - 10;
const SAFE_RX = 195, SAFE_RY = 240;
const SAFE_MARGIN = 25;

const TEXT_COLORS = [
  "#D4401A","#1A6FD4","#C8880A","#1A9E5C","#9A20C8",
  "#D43070","#1AB4D4","#6AB020","#D45C1A","#2040D4",
  "#C8A010","#10C890","#C41840","#501AC8","#10C840",
];

// ─── I/O helpers ──────────────────────────────────────────────────────────────
const readFileAsDataURL = f => new Promise((res, rej) => {
  const r = new FileReader();
  r.onload = e => res(e.target.result);
  r.onerror = () => rej(new Error("Cannot read file"));
  r.readAsDataURL(f);
});
const loadImage = src => new Promise((res, rej) => {
  const img = new Image();
  img.onload  = () => res(img);
  img.onerror = () => rej(new Error("Cannot load image"));
  img.src = src;
});
function imgToCanvas(img, maxDim = 2400) {
  let w = img.naturalWidth, h = img.naturalHeight;
  if (Math.max(w, h) > maxDim) {
    const s = maxDim / Math.max(w, h);
    w = Math.round(w * s); h = Math.round(h * s);
  }
  const c = document.createElement("canvas");
  c.width = w; c.height = h;
  c.getContext("2d").drawImage(img, 0, 0, w, h);
  return c;
}

// ─── Face Detection via face-api.js (loaded from CDN) ────────────────────────
// We lazy-load the script once and cache the promise.
let faceApiReady = null;
function loadFaceApi() {
  if (faceApiReady) return faceApiReady;
  faceApiReady = new Promise((resolve, reject) => {
    const s = document.createElement("script");
    s.src = "https://cdn.jsdelivr.net/npm/face-api.js@0.22.2/dist/face-api.min.js";
    s.onload  = () => resolve(window.faceapi);
    s.onerror = () => reject(new Error("face-api.js failed to load"));
    document.head.appendChild(s);
  });
  return faceApiReady;
}

// Load models from jsDelivr CDN
async function loadModels(faceapi) {
  const base = "https://cdn.jsdelivr.net/npm/@vladmandic/face-api@1.7.13/model";
  await Promise.all([
    faceapi.nets.tinyFaceDetector.loadFromUri(base),
    faceapi.nets.faceLandmark68TinyNet.loadFromUri(base),
  ]);
}

let modelsLoaded = false;
let faceApiInstance = null;

async function ensureFaceApi(onStatus) {
  if (modelsLoaded && faceApiInstance) return faceApiInstance;
  onStatus("Loading face detection model…");
  const faceapi = await loadFaceApi();
  faceApiInstance = faceapi;
  await loadModels(faceapi);
  modelsLoaded = true;
  return faceapi;
}

// ─── Face Crop — with real detection + portrait-proportion fallback ───────────
//
// Priority:
//   1. face-api.js TinyFaceDetector → precise bounding box
//   2. Landmark-guided crop         → forehead+chin padding from landmarks
//   3. Proportion fallback          → centre crop with generous head margins
//
async function cropFace(srcCanvas, onStatus) {
  const w = srcCanvas.width, h = srcCanvas.height;

  // ── Try face-api detection ──
  try {
    const faceapi = await ensureFaceApi(onStatus);
    onStatus("Detecting face…");

    // Downscale for detection speed (face-api works on <800px well)
    const detectionSize = 640;
    let dw = w, dh = h;
    if (Math.max(w, h) > detectionSize) {
      const s = detectionSize / Math.max(w, h);
      dw = Math.round(w * s); dh = Math.round(h * s);
    }
    const detCanvas = document.createElement("canvas");
    detCanvas.width = dw; detCanvas.height = dh;
    detCanvas.getContext("2d").drawImage(srcCanvas, 0, 0, dw, dh);

    const options = new faceapi.TinyFaceDetectorOptions({ inputSize: 416, scoreThreshold: 0.35 });
    const result  = await faceapi
      .detectSingleFace(detCanvas, options)
      .withFaceLandmarks(true); // tiny net

    if (result) {
      // Scale bounding box back to source resolution
      const scaleX = w / dw, scaleY = h / dh;
      const box = result.detection.box;
      const sx = box.x * scaleX;
      const sy = box.y * scaleY;
      const sw = box.width  * scaleX;
      const sh = box.height * scaleY;

      // Add generous padding: +35% top (forehead), +20% bottom (chin), +15% sides
      const padTop    = sh * 0.35;
      const padBottom = sh * 0.20;
      const padSides  = sw * 0.15;

      const cx  = Math.max(0, sx - padSides);
      const cy  = Math.max(0, sy - padTop);
      const cw  = Math.min(w - cx, sw + padSides * 2);
      const ch  = Math.min(h - cy, sh + padTop + padBottom);

      return cropRect(srcCanvas, cx, cy, cw, ch);
    }
  } catch (e) {
    console.warn("face-api detection failed, using fallback:", e.message);
  }

  // ── Proportion fallback (portrait heuristics) ──
  onStatus("Using portrait heuristics…");
  return cropPortraitFallback(srcCanvas);
}

// Crop a rect from a canvas and return a new canvas
function cropRect(src, x, y, w, h) {
  const out = document.createElement("canvas");
  out.width = Math.round(w); out.height = Math.round(h);
  out.getContext("2d").drawImage(src, x, y, w, h, 0, 0, out.width, out.height);
  return out;
}

// Fallback: for a portrait photo, head fills ~60-90% of the frame
// We assume: face starts ~5% from top, ends ~90%, centred horizontally
function cropPortraitFallback(src) {
  const w = src.width, h = src.height;
  // Crop: keep centre 70% width, top 85% height (typical portrait framing)
  const x = Math.floor(w * 0.15);
  const y = Math.floor(h * 0.02);
  const cw = Math.floor(w * 0.70);
  const ch = Math.floor(h * 0.85);
  return cropRect(src, x, y, cw, ch);
}

// ─── Enhanced Pencil Sketch Pipeline ─────────────────────────────────────────
//
// Passes:
//   1. Grayscale conversion (luminance-weighted)
//   2. Contrast + brightness normalisation (auto-levels)
//   3. Dodge-blend sketch (invert + blur / colour dodge)
//   4. Unsharp mask for crisp edges
//   5. Subtle paper texture overlay
//
function boxBlur1D(src, w, h, r, horizontal) {
  const dst = new Float32Array(w * h);
  if (horizontal) {
    for (let y = 0; y < h; y++) {
      let s = 0, cnt = 0;
      for (let x = 0; x <= r && x < w; x++) { s += src[y*w+x]; cnt++; }
      for (let x = 0; x < w; x++) {
        dst[y*w+x] = s / cnt;
        if (x+r+1 < w) { s += src[y*w + x+r+1]; cnt++; }
        if (x-r >= 0)   { s -= src[y*w + x-r];   cnt--; }
      }
    }
  } else {
    for (let x = 0; x < w; x++) {
      let s = 0, cnt = 0;
      for (let y = 0; y <= r && y < h; y++) { s += src[y*w+x]; cnt++; }
      for (let y = 0; y < h; y++) {
        dst[y*w+x] = s / cnt;
        if (y+r+1 < h) { s += src[(y+r+1)*w + x]; cnt++; }
        if (y-r >= 0)   { s -= src[(y-r)*w   + x]; cnt--; }
      }
    }
  }
  return dst;
}

function gaussianBlur(gray, w, h, sigma) {
  // Approximate Gaussian with 3 passes of box blur
  const r = Math.max(1, Math.round(sigma * 1.5));
  let buf = new Float32Array(gray); // copy
  for (let pass = 0; pass < 3; pass++) {
    const h1 = boxBlur1D(buf, w, h, r, true);
    buf = boxBlur1D(h1,  w, h, r, false);
  }
  return buf;
}

function toUint8(f32) {
  const u = new Uint8ClampedArray(f32.length);
  for (let i = 0; i < f32.length; i++) u[i] = Math.max(0, Math.min(255, f32[i]));
  return u;
}

function toSketch(canvas) {
  const { width: w, height: h } = canvas;
  const raw = canvas.getContext("2d").getImageData(0, 0, w, h).data;

  // 1. Luminance grayscale
  const gray = new Float32Array(w * h);
  for (let i = 0; i < w * h; i++)
    gray[i] = 0.299*raw[i*4] + 0.587*raw[i*4+1] + 0.114*raw[i*4+2];

  // 2. Auto-levels: stretch histogram to [0,255]
  let lo = 255, hi = 0;
  for (let i = 0; i < gray.length; i++) { if (gray[i] < lo) lo = gray[i]; if (gray[i] > hi) hi = gray[i]; }
  const range = hi - lo || 1;
  const levelled = new Float32Array(gray.length);
  for (let i = 0; i < gray.length; i++) levelled[i] = ((gray[i] - lo) / range) * 255;

  // 3. Dodge-blend sketch
  const inv = new Float32Array(levelled.length);
  for (let i = 0; i < levelled.length; i++) inv[i] = 255 - levelled[i];
  const blurSigma = Math.max(8, w * 0.025);
  const blurred   = gaussianBlur(inv, w, h, blurSigma);
  const sketch    = new Float32Array(levelled.length);
  for (let i = 0; i < levelled.length; i++) {
    const b = blurred[i] >= 255 ? 254 : blurred[i];
    sketch[i] = Math.min(255, (levelled[i] * 255) / (255 - b));
  }

  // 4. Unsharp mask — sharpen edges
  const blurredSketch = gaussianBlur(sketch, w, h, 1.2);
  const sharpened     = new Float32Array(sketch.length);
  const sharpAmount   = 1.5;
  for (let i = 0; i < sketch.length; i++) {
    sharpened[i] = sketch[i] + sharpAmount * (sketch[i] - blurredSketch[i]);
  }

  // 5. Gamma / contrast curve — darken shadows, preserve highlights
  const result = new Uint8ClampedArray(w * h * 4);
  for (let i = 0; i < w * h; i++) {
    let v = Math.max(0, Math.min(255, sharpened[i]));
    // Gentle S-curve: deepen dark strokes, keep white paper white
    v = v < 180
      ? v * 0.88               // darken mid-to-dark tones
      : 180*0.88 + (v-180) * ((255 - 180*0.88) / 75); // ease to 255
    v = Math.max(0, Math.min(255, v));
    result[i*4] = result[i*4+1] = result[i*4+2] = v;
    result[i*4+3] = 255;
  }

  const out = document.createElement("canvas");
  out.width = w; out.height = h;
  out.getContext("2d").putImageData(new ImageData(result, w, h), 0, 0);
  return out;
}

// ─── Translation ──────────────────────────────────────────────────────────────
async function translateName(name) {
  const languages = [
    "hi", // Hindi
    "ta", // Tamil
    "te", // Telugu
    "kn", // Kannada
    "ml", // Malayalam
    "bn", // Bengali
    "gu", // Gujarati
    "pa", // Punjabi
    "mr", // Marathi
    "or"  // Odia
  ];

  const results = [name];

  for (const lang of languages) {
    try {
      const res = await fetch(
        `https://translate.googleapis.com/translate_a/single?client=gtx&sl=en&tl=${lang}&dt=t&q=${encodeURIComponent(name)}`
      );
      const data = await res.json();
      results.push(data[0][0][0]);
    } catch {
      results.push(name);
    }
  }

  return results;
}


// ─── Word Placement ───────────────────────────────────────────────────────────
function inSafeZone(x, y, margin = SAFE_MARGIN) {
  const dx = (x - SAFE_CX) / (SAFE_RX + margin);
  const dy = (y - SAFE_CY) / (SAFE_RY + margin);
  return dx*dx + dy*dy < 1;
}

function buildWordGrid(words) {
  const COLS = 7, ROWS = 9;
  const cellW = CANVAS_SIZE / COLS;
  const cellH = CANVAS_SIZE / ROWS;
  const positions = [];
  for (let row = 0; row < ROWS; row++) {
    for (let col = 0; col < COLS; col++) {
      const cx = (col+0.5)*cellW, cy = (row+0.5)*cellH;
      if (inSafeZone(cx, cy, SAFE_MARGIN + 20)) continue;
      if (cx < 20 || cx > CANVAS_SIZE-20 || cy < 20 || cy > CANVAS_SIZE-20) continue;
      const jx = (Math.random()-0.5)*cellW*0.68;
      const jy = (Math.random()-0.5)*cellH*0.68;
      const x  = Math.max(18, Math.min(CANVAS_SIZE-18, cx+jx));
      const y  = Math.max(18, Math.min(CANVAS_SIZE-18, cy+jy));
      if (inSafeZone(x, y, SAFE_MARGIN+8)) continue;
      positions.push({ word: words[(row*COLS+col) % words.length], x, y });
    }
  }
  return positions;
}

// ─── Poster Compositor ────────────────────────────────────────────────────────
function buildPoster(sketchCanvas, translations, name) {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = CANVAS_SIZE;
  const ctx = canvas.getContext("2d");

  // White background
  ctx.fillStyle = "#ffffff";
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // Subtle paper grain
  for (let i = 0; i < 5000; i++) {
    ctx.fillStyle = `rgba(0,0,0,${Math.random()*0.022})`;
    ctx.fillRect(Math.random()*CANVAS_SIZE, Math.random()*CANVAS_SIZE, 1, 1);
  }

  // Build shuffled word pool
  const pool = [];
  for (let i = 0; i < 70; i++) pool.push(translations[i % translations.length]);
  for (let i = pool.length-1; i > 0; i--) {
    const j = Math.floor(Math.random()*(i+1));
    [pool[i], pool[j]] = [pool[j], pool[i]];
  }
  const placements = buildWordGrid(pool);

  const fonts = [
    "italic bold {s}px 'Georgia',serif",
    "bold {s}px 'Times New Roman',serif",
    "italic {s}px 'Palatino Linotype',serif",
    "{s}px serif",
    "bold italic {s}px serif",
  ];

  for (const { word, x, y } of placements) {
    const fs    = 15 + Math.floor(Math.random() * 28);
    const rot   = (Math.random()-0.5) * (Math.PI / 5);
    const color = TEXT_COLORS[Math.floor(Math.random() * TEXT_COLORS.length)];
    ctx.save();
    ctx.translate(x, y); ctx.rotate(rot);
    ctx.font        = fonts[Math.floor(Math.random()*fonts.length)].replace("{s}", fs);
    ctx.globalAlpha = 0.72 + Math.random()*0.28;
    ctx.fillStyle   = color;
    ctx.fillText(word, 0, 0);
    ctx.restore();
  }
  ctx.globalAlpha = 1;

  // Thin border
  ctx.strokeStyle = "rgba(150,140,130,0.18)";
  ctx.lineWidth = 1.5;
  ctx.strokeRect(18, 18, CANVAS_SIZE-36, CANVAS_SIZE-36);

  // Soft vignette to frame sketch area
  const vig = ctx.createRadialGradient(
    SAFE_CX, SAFE_CY, SAFE_RX * 0.45,
    SAFE_CX, SAFE_CY, SAFE_RX * 2.4
  );
  vig.addColorStop(0,   "rgba(255,255,255,0.88)");
  vig.addColorStop(0.45,"rgba(255,255,255,0.40)");
  vig.addColorStop(1,   "rgba(255,255,255,0)");
  ctx.fillStyle = vig;
  ctx.fillRect(0, 0, CANVAS_SIZE, CANVAS_SIZE);

  // ── Draw face sketch (high-quality downscale) ──
  ctx.imageSmoothingEnabled = true;
  ctx.imageSmoothingQuality = "high";
  const sx = CENTER - SKETCH_W/2;
  const sy = CENTER - SKETCH_H/2;
  ctx.drawImage(sketchCanvas, sx, sy, SKETCH_W, SKETCH_H);

  // Name label below face
  const labelY = sy + SKETCH_H + 36;
  ctx.font      = "bold 17px 'Georgia',serif";
  ctx.fillStyle = "rgba(55,45,35,0.52)";
  ctx.textAlign = "center";
  ctx.fillText(name.toUpperCase(), CENTER, labelY);
  ctx.strokeStyle = "rgba(80,60,40,0.18)";
  ctx.lineWidth = 0.8;
  ctx.beginPath();
  ctx.moveTo(CENTER-65, labelY+8);
  ctx.lineTo(CENTER+65, labelY+8);
  ctx.stroke();

  return canvas;
}

// ─── UI Components ────────────────────────────────────────────────────────────
function Spinner() {
  return (
    <div style={{
      width:16, height:16, flexShrink:0,
      border:`2px solid ${T.border}`, borderTopColor:T.accent,
      borderRadius:"50%", animation:"spin .8s linear infinite",
    }} />
  );
}

const STEPS = [
  "Loading face detection",
  "Detecting & cropping face",
  "Generating sketch",
  "Translating name",
  "Composing poster",
];

function StepIndicator({ stepIndex, isWorking, isDone, isError }) {
  if (!isWorking && !isDone && !isError) return null;
  return (
    <div style={{ display:"flex", flexDirection:"column", gap:7, animation:"fadeInUp .3s ease" }}>
      {STEPS.map((label, i) => {
        const done   = isDone || i < stepIndex;
        const active = isWorking && i === stepIndex;
        return (
          <div key={i} style={{ display:"flex", alignItems:"center", gap:9 }}>
            <div style={{
              width:19, height:19, borderRadius:"50%", flexShrink:0,
              display:"flex", alignItems:"center", justifyContent:"center",
              fontSize:9, fontFamily:"sans-serif", fontWeight:700,
              background: done ? T.green : active ? T.accent : T.bgMuted,
              color: (done||active) ? "#fff" : T.inkFaint,
              border:`1.5px solid ${done ? T.green : active ? T.accent : T.border}`,
              transition:"all .3s",
            }}>
              {done ? "✓" : i+1}
            </div>
            <span style={{
              fontSize:11, fontFamily:"sans-serif",
              color: done ? T.green : active ? T.accent : T.inkFaint,
              fontWeight: active ? 600 : 400, letterSpacing:".02em", transition:"color .3s",
            }}>
              {label}{active && <span style={{ animation:"pulse 1.2s infinite", display:"inline-block", marginLeft:3 }}>…</span>}
            </span>
          </div>
        );
      })}
      {isWorking && (
        <div style={{ height:2, background:T.border, borderRadius:1, marginTop:3, overflow:"hidden" }}>
          <div style={{
            height:"100%", borderRadius:1,
            background:`linear-gradient(90deg,${T.accent},${T.accentHov})`,
            animation:"progressBar 6s ease forwards",
          }}/>
        </div>
      )}
    </div>
  );
}

function UploadZone({ previewUrl, onClick, onDrop }) {
  const [hov, setHov] = useState(false);
  return (
    <div
      onClick={onClick}
      onDrop={e=>{e.preventDefault(); onDrop(e.dataTransfer.files[0]);}}
      onDragOver={e=>e.preventDefault()}
      onDragEnter={()=>setHov(true)}
      onDragLeave={()=>setHov(false)}
      style={{
        border:`1.5px dashed ${hov ? T.accent : T.border}`,
        borderRadius:12, minHeight:180,
        display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center",
        cursor:"pointer", overflow:"hidden",
        background: hov ? T.accentLt : T.bgCard,
        transition:"all .2s", position:"relative",
        boxShadow: hov ? `0 0 0 4px ${T.accentLt}` : "none",
      }}
    >
      {previewUrl ? (
        <>
          <img src={previewUrl} alt="preview" style={{ width:"100%", height:"100%", objectFit:"cover", position:"absolute", inset:0, opacity:.93 }}/>
          <div style={{ position:"absolute", inset:0, background:"linear-gradient(to top,rgba(0,0,0,.5) 0%,transparent 55%)" }}/>
          <div style={{ position:"absolute", bottom:10, left:0, right:0, textAlign:"center", color:"#fff", fontSize:10, fontFamily:"sans-serif", letterSpacing:".1em", opacity:.8 }}>
            CLICK TO CHANGE
          </div>
        </>
      ) : (
        <>
          <div style={{ fontSize:30, opacity:.22, marginBottom:9, transition:"transform .2s", transform:hov?"scale(1.2)":"scale(1)" }}>◎</div>
          <div style={{ fontSize:12, color:hov?T.accent:T.inkMid, letterSpacing:".06em", fontFamily:"sans-serif", fontWeight:500 }}>
            {hov ? "Drop to upload" : "Click or drop portrait"}
          </div>
          <div style={{ fontSize:10, color:T.inkFaint, marginTop:4, fontFamily:"sans-serif" }}>JPG · PNG · WebP · Any size</div>
        </>
      )}
    </div>
  );
}

function PreviewPanel({ posterDataUrl, isWorking }) {
  const sampleWords = [
    {t:"राहुल", c:"#D4401A", r:-10, s:22, lp:"12%", tp:"14%"},
    {t:"ராகுல்",c:"#1A6FD4", r:7,   s:18, lp:"65%", tp:"8%"},
    {t:"రాహుల్",c:"#C8880A", r:-5,  s:20, lp:"5%",  tp:"50%"},
    {t:"ರಾಹುಲ್",c:"#1A9E5C", r:12,  s:16, lp:"72%", tp:"55%"},
    {t:"രാഹുൽ", c:"#9A20C8", r:-8,  s:24, lp:"20%", tp:"82%"},
    {t:"রাহুল",  c:"#D43070", r:4,   s:19, lp:"62%", tp:"80%"},
    {t:"ਰਾਹੁਲ",  c:"#1AB4D4", r:-3,  s:17, lp:"40%", tp:"6%"},
    {t:"ગુ",      c:"#6AB020", r:9,   s:21, lp:"78%", tp:"33%"},
  ];

  return (
    <div style={{ display:"flex", flexDirection:"column", gap:14 }}>
      <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between" }}>
        <div style={{ fontSize:10, letterSpacing:".28em", color:T.inkFaint, textTransform:"uppercase", fontFamily:"sans-serif" }}>Poster Preview</div>
        {posterDataUrl && <div style={{ fontSize:10, color:T.green, fontFamily:"sans-serif", display:"flex", alignItems:"center", gap:4 }}>✓ Ready</div>}
      </div>

      <div style={{
        width:"100%", maxWidth:500, aspectRatio:"1",
        background: posterDataUrl ? "#fff" : T.bgMuted,
        border:`1.5px solid ${T.border}`, borderRadius:14,
        display:"flex", alignItems:"center", justifyContent:"center",
        overflow:"hidden", position:"relative",
        boxShadow: posterDataUrl ? T.shadowLg : T.shadow,
        transition:"box-shadow .4s",
      }}>
        {/* Spinner overlay while working */}
        {isWorking && (
          <div style={{
            position:"absolute", inset:0, zIndex:2,
            background:"rgba(247,244,239,0.88)",
            display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:14,
          }}>
            <div style={{ position:"relative", width:64, height:64 }}>
              <div style={{
                position:"absolute", inset:0,
                border:`3px solid ${T.border}`, borderTopColor:T.accent,
                borderRadius:"50%", animation:"spin .9s linear infinite",
              }}/>
              <div style={{ position:"absolute", inset:0, display:"flex", alignItems:"center", justifyContent:"center", fontSize:22 }}>✏️</div>
            </div>
            <div style={{ fontSize:11, color:T.accent, fontFamily:"sans-serif", letterSpacing:".12em", fontWeight:700 }}>GENERATING</div>
          </div>
        )}

        {posterDataUrl && !isWorking ? (
          <img src={posterDataUrl} alt="poster" style={{ width:"100%", height:"100%", objectFit:"contain", animation:"fadeInUp .5s ease" }}/>
        ) : !isWorking && (
          <div style={{ width:"100%", height:"100%", position:"relative", overflow:"hidden" }}>
            {sampleWords.map((w,i) => (
              <div key={i} style={{
                position:"absolute", left:w.lp, top:w.tp,
                fontSize:w.s, color:w.c,
                transform:`rotate(${w.r}deg)`,
                fontFamily:"serif", opacity:.3, whiteSpace:"nowrap",
              }}>{w.t}</div>
            ))}
            <div style={{ position:"absolute", inset:0, display:"flex", flexDirection:"column", alignItems:"center", justifyContent:"center", gap:10 }}>
              <div style={{ fontSize:38, opacity:.16 }}>👤</div>
              <div style={{ fontSize:11, color:T.inkFaint, fontFamily:"sans-serif", letterSpacing:".1em" }}>Your poster will appear here</div>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

// ─── Main App ─────────────────────────────────────────────────────────────────
export default function App() {
  const [photoFile,     setPhotoFile]     = useState(null);
  const [previewUrl,    setPreviewUrl]    = useState(null);
  const [imgInfo,       setImgInfo]       = useState(null);
  const [name,          setName]          = useState("");
  const [status,        setStatus]        = useState("idle");
  const [stepIndex,     setStepIndex]     = useState(0);
  const [errorMsg,      setErrorMsg]      = useState("");
  const [posterDataUrl, setPosterDataUrl] = useState(null);
  const fileRef = useRef();

  const handleFile = file => {
    if (!file || !file.type.startsWith("image/")) return;
    setPhotoFile(file);
    setPreviewUrl(URL.createObjectURL(file));
    setPosterDataUrl(null);
    setStatus("idle"); setErrorMsg("");
    setImgInfo(null);
    const fr = new FileReader();
    fr.onload = e => {
      const tmp = new Image();
      tmp.onload = () => setImgInfo({ w:tmp.naturalWidth, h:tmp.naturalHeight, mb:(file.size/1048576).toFixed(1) });
      tmp.src = e.target.result;
    };
    fr.readAsDataURL(file);
  };

  const generate = useCallback(async () => {
    if (!photoFile || !name.trim() || status === "working") return;
    setStatus("working"); setPosterDataUrl(null); setErrorMsg("");

    const onStatus = (msg) => console.log("[status]", msg);

    try {
      // Step 0: Read + load file
      setStepIndex(0);
      const dataURL = await readFileAsDataURL(photoFile);
      const img     = await loadImage(dataURL);
      const srcCanvas = imgToCanvas(img);

      // Step 1: Face detection + crop
      setStepIndex(1);
      const faceCanvas = await cropFace(srcCanvas, onStatus);

      // Step 2: Sketch
      setStepIndex(2);
      const sketchCanvas = toSketch(faceCanvas);

      // Step 3: Translate
      setStepIndex(3);
      const translations = await translateName(name.trim());

      // Step 4: Compose poster
      setStepIndex(4);
      const poster = buildPoster(sketchCanvas, translations, name.trim());

      // Use toDataURL so <img> renders in sandboxed preview
      setPosterDataUrl(poster.toDataURL("image/png"));
      setStatus("done");
    } catch(err) {
      console.error(err);
      setStatus("error");
      setErrorMsg(err.message);
    }
  }, [photoFile, name, status]);

  const download = useCallback(() => {
    if (!posterDataUrl) return;
    const a = document.createElement("a");
    a.href = posterDataUrl;
    a.download = `${name.trim()||"poster"}_eye_poster.png`;
    document.body.appendChild(a); a.click(); document.body.removeChild(a);
  }, [posterDataUrl, name]);

  const isWorking   = status === "working";
  const isDone      = status === "done";
  const isError     = status === "error";
  const canGenerate = !!photoFile && !!name.trim() && !isWorking;

  const qualityLabel = imgInfo
    ? imgInfo.w >= 3000 ? "Ultra HD" : imgInfo.w >= 1800 ? "High Res" : imgInfo.w >= 800 ? "Standard" : "Low Res"
    : null;
  const qualityColor = { "Ultra HD":T.green, "High Res":T.green, "Standard":"#B8922A", "Low Res":T.red }[qualityLabel];

  return (
    <div style={{ minHeight:"100vh", background:T.bg, fontFamily:"'Georgia','Times New Roman',serif", color:T.ink, paddingBottom:80 }}>
      <style>{`
        @keyframes spin        { to { transform:rotate(360deg); } }
        @keyframes fadeInUp    { from{opacity:0;transform:translateY(10px)} to{opacity:1;transform:translateY(0)} }
        @keyframes pulse       { 0%,100%{opacity:.5} 50%{opacity:1} }
        @keyframes progressBar { 0%{width:0%} 40%{width:50%} 80%{width:82%} 100%{width:100%} }
        * { box-sizing:border-box; }
        ::placeholder { color:#B0A898; }
      `}</style>

      {/* ── Header ── */}
      <div style={{ background:"#fff", borderBottom:`1px solid ${T.border}`, padding:"28px 32px 24px", textAlign:"center", position:"relative" }}>
        <div style={{ position:"absolute", top:18, left:32, display:"flex", gap:6, opacity:.4 }}>
          {["#D4401A","#1A6FD4","#C8880A","#1A9E5C","#9A20C8"].map((c,i)=>(
            <div key={i} style={{ width:7, height:7, borderRadius:"50%", background:c }}/>
          ))}
        </div>
        <div style={{ fontSize:10, letterSpacing:".45em", color:T.inkFaint, marginBottom:8, fontFamily:"sans-serif", textTransform:"uppercase" }}>
          Multilingual Eye Sketch Studio
        </div>
        <h1 style={{ fontSize:"clamp(28px,5vw,52px)", fontWeight:"normal", margin:0, letterSpacing:".06em", color:T.ink, lineHeight:1.15 }}>
          Eye &amp; <em style={{ fontStyle:"italic", color:T.accent }}>Script</em>
        </h1>
        <div style={{ width:32, height:2, background:T.accent, margin:"14px auto 10px", borderRadius:1 }}/>
        <p style={{ fontSize:13, color:T.inkFaint, margin:0, letterSpacing:".06em", fontFamily:"sans-serif" }}>
          Portrait photo → full-face pencil sketch → multilingual typographic poster
        </p>
      </div>

      {/* ── Layout ── */}
      <div style={{ maxWidth:980, margin:"0 auto", display:"flex", gap:32, padding:"36px 24px 0", flexWrap:"wrap", justifyContent:"center" }}>

        {/* Left Controls */}
        <div style={{ flex:"0 0 320px", display:"flex", flexDirection:"column", gap:20 }}>

          {/* Main card */}
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:16, padding:24, boxShadow:T.shadow, display:"flex", flexDirection:"column", gap:20 }}>

            {/* Upload */}
            <div>
              <div style={{ fontSize:10, letterSpacing:".28em", color:T.inkFaint, marginBottom:10, fontFamily:"sans-serif", textTransform:"uppercase" }}>01 · Portrait Photo</div>
              <UploadZone previewUrl={previewUrl} onClick={()=>fileRef.current.click()} onDrop={handleFile}/>
              <input ref={fileRef} type="file" accept="image/*" style={{ display:"none" }} onChange={e=>handleFile(e.target.files[0])}/>
              {imgInfo && (
                <div style={{ marginTop:8, display:"flex", gap:8, flexWrap:"wrap", alignItems:"center" }}>
                  <span style={{ fontSize:10, color:T.inkFaint, fontFamily:"sans-serif" }}>{imgInfo.w}×{imgInfo.h}px · {imgInfo.mb} MB</span>
                  {qualityLabel && (
                    <span style={{ fontSize:9, fontFamily:"sans-serif", fontWeight:700, color:qualityColor, letterSpacing:".1em", background:qualityColor+"18", padding:"2px 7px", borderRadius:10 }}>
                      {qualityLabel}
                    </span>
                  )}
                </div>
              )}
            </div>

            <div style={{ height:1, background:T.border }}/>

            {/* Name */}
            <div>
              <div style={{ fontSize:10, letterSpacing:".28em", color:T.inkFaint, marginBottom:10, fontFamily:"sans-serif", textTransform:"uppercase" }}>02 · Your Name</div>
              <input
                type="text" value={name} onChange={e=>setName(e.target.value)} placeholder="e.g. Dhoni"
                style={{ width:"100%", padding:"12px 14px", background:T.bgMuted, border:`1.5px solid ${T.border}`, borderRadius:8, color:T.ink, fontSize:16, fontFamily:"'Georgia',serif", outline:"none", transition:"border-color .2s, box-shadow .2s" }}
                onFocus={e=>{e.target.style.borderColor=T.accent; e.target.style.boxShadow=`0 0 0 3px ${T.accentLt}`;}}
                onBlur={e=>{e.target.style.borderColor=T.border; e.target.style.boxShadow="none";}}
                onKeyDown={e=>e.key==="Enter"&&canGenerate&&generate()}
              />
              <div style={{ fontSize:10, color:T.inkFaint, marginTop:6, fontFamily:"sans-serif", lineHeight:1.5 }}>
                Translated into Hindi, Tamil, Telugu, Kannada, Malayalam, Bengali, Gujarati, Punjabi, Marathi &amp; Odia
              </div>
            </div>

            <div style={{ height:1, background:T.border }}/>

            {/* Generate */}
            <div>
              <div style={{ fontSize:10, letterSpacing:".28em", color:T.inkFaint, marginBottom:10, fontFamily:"sans-serif", textTransform:"uppercase" }}>03 · Generate</div>
              <button
                onClick={generate} disabled={!canGenerate}
                style={{
                  width:"100%", padding:"14px",
                  background: canGenerate ? `linear-gradient(135deg,${T.accent},${T.accentHov})` : T.bgMuted,
                  border:"none", borderRadius:10,
                  color: canGenerate ? "#fff" : T.inkFaint,
                  fontSize:11, letterSpacing:".3em", textTransform:"uppercase",
                  fontFamily:"sans-serif", fontWeight:700,
                  cursor: canGenerate ? "pointer" : "not-allowed",
                  boxShadow: canGenerate ? `0 4px 14px ${T.accent}44` : "none",
                  transition:"all .2s",
                  display:"flex", alignItems:"center", justifyContent:"center", gap:10,
                }}
                onMouseEnter={e=>canGenerate&&(e.currentTarget.style.transform="translateY(-1px)", e.currentTarget.style.boxShadow=`0 6px 20px ${T.accent}55`)}
                onMouseLeave={e=>(e.currentTarget.style.transform="translateY(0)", e.currentTarget.style.boxShadow=canGenerate?`0 4px 14px ${T.accent}44`:"none")}
              >
                {isWorking?<><Spinner/> Generating…</>:isDone?"✓ Regenerate":"Generate Poster"}
              </button>

              <div style={{ marginTop:(isWorking||isDone||isError)?16:0 }}>
                <StepIndicator stepIndex={stepIndex} isWorking={isWorking} isDone={isDone} isError={isError}/>
              </div>

              {isError && (
                <div style={{ marginTop:12, padding:"10px 12px", background:"#FFF0EE", border:`1px solid #F5C2BB`, borderRadius:8, fontSize:11, color:T.red, fontFamily:"sans-serif", lineHeight:1.5, animation:"fadeInUp .3s ease" }}>
                  ⚠ {errorMsg}
                </div>
              )}

              {isDone && posterDataUrl && (
                <div style={{ animation:"fadeInUp .4s ease" }}>
                  <div style={{ marginTop:12, padding:"10px 12px", background:"#EFF7F2", border:`1px solid #B8DFC6`, borderRadius:8, fontSize:11, color:T.green, fontFamily:"sans-serif", lineHeight:1.5 }}>
                    ✓ Poster generated — preview shown on the right.
                  </div>
                  <button
                    onClick={download}
                    style={{ width:"100%", marginTop:10, padding:"12px", background:"#fff", border:`1.5px solid ${T.border}`, borderRadius:10, color:T.inkMid, fontSize:11, letterSpacing:".2em", textTransform:"uppercase", fontFamily:"sans-serif", fontWeight:600, cursor:"pointer", transition:"all .2s", display:"flex", alignItems:"center", justifyContent:"center", gap:8 }}
                    onMouseEnter={e=>{e.currentTarget.style.borderColor=T.accent; e.currentTarget.style.color=T.accent; e.currentTarget.style.background=T.accentLt;}}
                    onMouseLeave={e=>{e.currentTarget.style.borderColor=T.border; e.currentTarget.style.color=T.inkMid; e.currentTarget.style.background="#fff";}}
                  >
                    ↓ Download PNG (1000×1000)
                  </button>
                </div>
              )}
            </div>
          </div>

          {/* How it works */}
          <div style={{ background:T.bgCard, border:`1px solid ${T.border}`, borderRadius:12, padding:"16px 20px", boxShadow:T.shadow }}>
            <div style={{ fontSize:10, letterSpacing:".2em", color:T.inkFaint, marginBottom:10, fontFamily:"sans-serif", textTransform:"uppercase" }}>How it works</div>
            {[
              ["◎", "Portrait uploaded at full native resolution"],
              ["🔍", "AI face detector finds & crops full face with forehead-to-chin margins"],
              ["✏", "Multi-pass pencil sketch: auto-levels → dodge-blend → unsharp mask"],
              ["अ", "Name translated into 10 Indian scripts via AI"],
              ["⊞", "Grid-distributed colorful typography surrounds the sketch"],
            ].map(([icon, text], i) => (
              <div key={i} style={{ display:"flex", gap:10, marginBottom:8, alignItems:"flex-start" }}>
                <span style={{ fontSize:13, color:T.accent, width:20, flexShrink:0 }}>{icon}</span>
                <span style={{ fontSize:11, color:T.inkFaint, fontFamily:"sans-serif", lineHeight:1.5 }}>{text}</span>
              </div>
            ))}
          </div>
        </div>

        {/* Right: Preview */}
        <div style={{ flex:"1 1 420px", minWidth:280 }}>
          <PreviewPanel posterDataUrl={posterDataUrl} isWorking={isWorking} name={name}/>
        </div>
      </div>

      <div style={{ textAlign:"center", marginTop:56, fontSize:10, color:T.border, fontFamily:"sans-serif", letterSpacing:".2em", textTransform:"uppercase" }}>
        Eye &amp; Script · Multilingual Portrait Studio
      </div>
    </div>
  );
}