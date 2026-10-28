/*
 * VSUrvey's two 3D moments, drawn with three.js (r169, MIT; see LICENSE-three.txt):
 *
 *   ring(host, tokens)  the scenes of the day as coins on a slow ring around the title, on the first screen;
 *   confetti(host)      paper confetti over the tick on the last screen, for a few seconds.
 *
 * index.html loads this file only on a computer, or on a fast connection without data saver, with motion on and a graphics
 * card that draws WebGL 2 (D-166). Everyone else keeps the drawn versions, which are complete on their own. Nothing here
 * follows the pointer, and both stop drawing, and give back the graphics memory, once they are off screen or done.
 */
import {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, InstancedMesh, Object3D, CylinderGeometry, PlaneGeometry,
  MeshStandardMaterial, CanvasTexture, HemisphereLight, DirectionalLight, Fog, Color, SRGBColorSpace, DoubleSide
} from "./three.module.min.js";

const PAPER = 0xf3f4ee;
const CONFETTI = ["#E8B23E", "#CE5A45", "#B3D7DB", "#8DB37F", "#FAF9F4", "#D97A62", "#7E68A0", "#1F5B3F"];

/* A renderer whose canvas sits under the page's text, sized by CSS to its host. */
function stageRenderer(host) {
  const renderer = new WebGLRenderer({ antialias: true, alpha: true, powerPreference: "low-power", failIfMajorPerformanceCaveat: true });
  renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
  renderer.outputColorSpace = SRGBColorSpace;
  renderer.setClearColor(0x000000, 0);
  const canvas = renderer.domElement;
  canvas.className = "three";
  canvas.setAttribute("aria-hidden", "true");
  host.insertBefore(canvas, host.firstChild);
  return renderer;
}

function fit(host, renderer, camera) {
  const w = Math.max(1, host.clientWidth), h = Math.max(1, host.clientHeight);
  renderer.setSize(w, h, false);
  camera.aspect = w / h;
  camera.updateProjectionMatrix();
  return w / h;
}

/* Frees everything a scene holds, then the drawing context itself. */
function release(renderer, scene) {
  renderer.setAnimationLoop(null);
  scene.traverse(o => {
    if (o.geometry) o.geometry.dispose();
    [].concat(o.material || []).forEach(m => { if (m.map) m.map.dispose(); m.dispose(); });
  });
  renderer.dispose();
  renderer.forceContextLoss();
  renderer.domElement.remove();
}

const hiddenBox = host => { const box = host.closest(".box"); return !host.isConnected || (box && box.hidden); };

/* A survey icon (24 by 24, paths, circles, and rects, stroked unless told otherwise) drawn onto a canvas. */
function drawIcon(g, markup, ink, scale, x, y) {
  const svg = new DOMParser().parseFromString('<svg xmlns="http://www.w3.org/2000/svg">' + markup + "</svg>", "image/svg+xml").documentElement;
  const paint = v => (!v || v === "currentColor") ? ink : v;
  g.save();
  g.translate(x, y);
  g.scale(scale, scale);
  g.lineWidth = 2;
  g.lineCap = "round";
  g.lineJoin = "round";
  svg.querySelectorAll("path, circle, rect").forEach(el => {
    const p = new Path2D(), n = k => parseFloat(el.getAttribute(k)) || 0;
    if (el.tagName === "path") p.addPath(new Path2D(el.getAttribute("d")));
    else if (el.tagName === "circle") p.arc(n("cx"), n("cy"), n("r"), 0, Math.PI * 2);
    else if (p.roundRect) p.roundRect(n("x"), n("y"), n("width"), n("height"), n("rx"));
    else p.rect(n("x"), n("y"), n("width"), n("height"));
    const fill = el.getAttribute("fill"), stroke = el.getAttribute("stroke");
    if (fill && fill !== "none") { g.fillStyle = paint(fill); g.fill(p); }
    if (stroke !== "none") { g.strokeStyle = paint(stroke); g.stroke(p); }
  });
  g.restore();
}

/* A coin's face: the scene's color, lit from the top left, a pale rim, and its icon. */
function coinFace(color, ink, icon) {
  const S = 256, c = document.createElement("canvas");
  c.width = c.height = S;
  const g = c.getContext("2d");
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2, 0, Math.PI * 2);
  g.fillStyle = color;
  g.fill();
  const light = g.createRadialGradient(S * .3, S * .24, 4, S * .3, S * .24, S * .8);
  light.addColorStop(0, "rgba(255,255,255,.42)");
  light.addColorStop(1, "rgba(255,255,255,0)");
  g.fillStyle = light;
  g.fill();
  g.beginPath();
  g.arc(S / 2, S / 2, S / 2 - 15, 0, Math.PI * 2);
  g.strokeStyle = "rgba(255,255,255,.6)";
  g.lineWidth = 7;
  g.stroke();
  drawIcon(g, icon || "", ink, 5, S / 2 - 12 * 5, S / 2 - 12 * 5);
  const t = new CanvasTexture(c);
  t.colorSpace = SRGBColorSpace;
  t.anisotropy = 4;
  return t;
}

const easeOutBack = x => 1 + 2.4 * Math.pow(x - 1, 3) + 1.4 * Math.pow(x - 1, 2);
const easeInOut = x => x < 0.5 ? 4 * x * x * x : 1 - Math.pow(-2 * x + 2, 3) / 2;

/* The first screen: the day's scenes, as coins, turning slowly on a ring around the title. The ring keeps the drawn one's
   shape (44% of the stage across, 40% up and down) and leans toward the viewer, so the near coins are a little larger
   and the far ones a little hazier. A coin fades while it passes behind the title's words, and now and then one flips. */
export function ring(host, tokens) {
  const renderer = stageRenderer(host), scene = new Scene();
  const FOV = 22, D = 30, LEAN = 0.12;  // a long lens, and a near side 12% of the distance closer than the middle
  const camera = new PerspectiveCamera(FOV, 1, 1, 100);
  camera.position.set(0, 0, D);
  scene.fog = new Fog(PAPER, D - LEAN * D * 0.3, D + LEAN * D * 4);
  scene.add(new HemisphereLight(0xffffff, 0xd9ddd0, 1.7));
  const sun = new DirectionalLight(0xfff1d2, 1.7);
  sun.position.set(-5, 7, 12);
  scene.add(sun);

  const geo = new CylinderGeometry(0.5, 0.5, 0.13, 56);
  geo.rotateX(Math.PI / 2);
  const coins = tokens.map((t, i) => {
    const rim = new MeshStandardMaterial({ color: 0xece8db, roughness: 0.45, metalness: 0.15, transparent: true });
    const face = new MeshStandardMaterial({ map: coinFace(t.color, t.ink, t.icon), roughness: 0.55, metalness: 0.05, transparent: true });
    const coin = new Mesh(geo, [rim, face, face]);
    coin.userData = { a: Math.PI / 2 - (i / tokens.length) * Math.PI * 2, phase: i * 0.9, bob: 0.8 + (i % 4) * 0.17, born: 0.15 + i * 0.06, mats: [rim, face], flip: -1 };
    coin.scale.setScalar(0.001);
    scene.add(coin);
    return coin;
  });

  /* Sizes come from the stage in pixels: k is how many pixels a unit spans at the ring's middle. */
  const title = host.querySelector(".title");
  let W = 1, H = 1, k = 1, A = 1, C = 1, size = 1, words = null;
  const resize = () => {
    fit(host, renderer, camera);
    W = Math.max(1, host.clientWidth);
    H = Math.max(1, host.clientHeight);
    k = H / 2 / (D * Math.tan(FOV * Math.PI / 360));
    size = Math.min(74, Math.max(36, 0.06 * Math.min(W, H) + 22)) / k;
    A = 0.44 * W / k;
    C = 0.4 * H / k;
    const h = host.getBoundingClientRect(), r = title && title.getBoundingClientRect();
    words = r && r.width ? { l: r.left - h.left, r: r.right - h.left, t: r.top - h.top, b: r.bottom - h.top } : null;
  };
  resize();
  const ro = new ResizeObserver(resize);
  ro.observe(host);
  if (title) ro.observe(title);

  const start = performance.now();
  let shown = false, stopped = false, nextFlip = 2.4;
  const stop = () => {
    if (stopped) return;
    stopped = true;
    ro.disconnect();
    host.classList.remove("has-3d");
    release(renderer, scene);
  };
  renderer.setAnimationLoop(now => {
    if (hiddenBox(host)) { stop(); return; }
    const t = (now - start) / 1000, turn = t * 0.11, B = LEAN * D, y0 = C * LEAN;
    /* Now and then a coin on the near side flips over. */
    if (t > nextFlip) {
      const near = coins.filter(c => c.userData.flip < 0 && Math.sin(c.userData.a + turn) > 0.35);
      if (near.length) near[Math.floor(Math.random() * near.length)].userData.flip = t;
      nextFlip = t + 2.2 + Math.random() * 1.6;
    }
    coins.forEach(coin => {
      const u = coin.userData, a = u.a + turn, s = Math.sin(a);
      /* Lifting the ring by y0 sets its near and far sides equally far from the middle on screen. */
      const x = Math.cos(a) * A, y = y0 - s * C + Math.sin(t * u.bob + u.phase) * size * 0.06, z = s * B;
      coin.position.set(x, y, z);
      const grow = Math.max(0.001, easeOutBack(Math.min(1, Math.max(0, (t - u.born) / 0.7))));
      coin.scale.setScalar(grow * size);
      coin.lookAt(camera.position);
      let spin = Math.sin(t * 0.6 + u.phase) * 0.3;
      if (u.flip >= 0) {
        const f = (t - u.flip) / 1.1;
        if (f >= 1) u.flip = -1;
        else spin += easeInOut(f) * Math.PI * 2;
      }
      coin.rotateY(spin);
      /* Where the coin lands on screen, and how far it is from the title's words. */
      const near = D / (D - z), px = W / 2 + x * k * near, py = H / 2 - y * k * near, r = size * grow * k * near / 2;
      let clear = 1;
      if (words) {
        const dx = Math.max(words.l - px, 0, px - words.r), dy = Math.max(words.t - py, 0, py - words.b);
        clear = Math.min(1, Math.max(0, (Math.hypot(dx, dy) - r * 0.25) / r));
      }
      u.mats.forEach(m => { m.opacity = 0.12 + 0.88 * clear; });
    });
    renderer.render(scene, camera);
    if (!shown) { shown = true; renderer.domElement.classList.add("on"); host.classList.add("has-3d"); }
  });
  return { stop, done: () => stopped };
}

/* The last screen: a burst of paper confetti from the tick, drifting down and gone in about six seconds. */
export function confetti(host) {
  const renderer = stageRenderer(host), scene = new Scene();
  const camera = new PerspectiveCamera(40, 1, 0.1, 60);
  camera.position.set(0, 0, 8);
  scene.add(new HemisphereLight(0xffffff, 0xcfd6c8, 1.9));
  const key = new DirectionalLight(0xffffff, 1.3);
  key.position.set(-3, 4, 5);
  scene.add(key);
  const aspect = fit(host, renderer, camera);
  /* The burst is there at once, and fades by itself. */
  renderer.domElement.classList.add("on", "now");

  const N = host.clientWidth < 520 ? 90 : 170;
  const mat = new MeshStandardMaterial({ side: DoubleSide, roughness: 0.6, metalness: 0.1, transparent: true });
  const bits = new InstancedMesh(new PlaneGeometry(0.13, 0.22), mat, N);
  const color = new Color(), o = new Object3D(), P = [];
  for (let i = 0; i < N; i++) {
    const a = Math.random() * Math.PI * 2, v = 2 + Math.random() * 3.4;
    P.push({
      x: (Math.random() - 0.5) * 0.5, y: (Math.random() - 0.5) * 0.5, z: (Math.random() - 0.5) * 1.4,
      vx: Math.cos(a) * v * Math.min(1.6, aspect), vy: Math.abs(Math.sin(a)) * v * 1.2 + 1.4, vz: (Math.random() - 0.5) * 2,
      r: [Math.random() * 6, Math.random() * 6, Math.random() * 6], w: [(Math.random() - 0.5) * 10, (Math.random() - 0.5) * 10, (Math.random() - 0.5) * 6],
      sway: Math.random() * 6
    });
    bits.setColorAt(i, color.set(CONFETTI[i % CONFETTI.length]));
  }
  scene.add(bits);

  const start = performance.now();
  let last = start, stopped = false;
  const stop = () => { if (!stopped) { stopped = true; release(renderer, scene); } };
  renderer.setAnimationLoop(now => {
    const t = (now - start) / 1000, dt = Math.min(0.05, (now - last) / 1000);
    last = now;
    if (hiddenBox(host) || t > 6.2) { stop(); return; }
    P.forEach((p, i) => {
      /* Paper rises with the burst, then the air holds it back, so it flutters down slowly. */
      p.vy -= 4.2 * dt;
      p.vx *= 1 - 0.9 * dt;
      p.vy *= 1 - (p.vy < 0 ? 2.4 : 0.5) * dt;
      p.x += (p.vx + Math.sin(t * 3 + p.sway) * 0.6) * dt;
      p.y += p.vy * dt;
      p.z += p.vz * dt;
      for (let k = 0; k < 3; k++) p.r[k] += p.w[k] * dt;
      o.position.set(p.x, p.y, p.z);
      o.rotation.set(p.r[0], p.r[1], p.r[2]);
      o.updateMatrix();
      bits.setMatrixAt(i, o.matrix);
    });
    bits.instanceMatrix.needsUpdate = true;
    mat.opacity = t < 4.6 ? 1 : Math.max(0, 1 - (t - 4.6) / 1.4);
    renderer.render(scene, camera);
  });
  return { stop, done: () => stopped };
}
