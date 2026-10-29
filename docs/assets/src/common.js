// Shared helpers for the README animations. Every scene is a pure function of time:
// `A.scene(duration, render)` exposes `window.seek(t)` (used by render.ts, one frame at a time)
// and plays in real time when the HTML is opened directly in a browser.
window.A = (() => {
  const clamp = (x, a = 0, b = 1) => Math.min(b, Math.max(a, x));
  const prog = (t, a, b) => clamp((t - a) / (b - a));
  const ease = (x) => 1 - (1 - x) ** 3;
  const easeIO = (x) => (x < 0.5 ? 4 * x * x * x : 1 - (-2 * x + 2) ** 3 / 2);
  const lerp = (a, b, u) => a + (b - a) * u;
  const $ = (id) => (typeof id === "string" ? document.getElementById(id) : id);

  /** Opacity of something visible from `a` (fade in over `d`) until `b` (fade out over `d`). */
  const vis = (t, a, b = Infinity, d = 0.3) =>
    Math.min(ease(prog(t, a, a + d)), b === Infinity ? 1 : 1 - prog(t, b, b + d));

  /** Fades an element in at `a` (with a small rise) and out at `b`. Returns the opacity. */
  function show(id, t, a, b = Infinity, d = 0.3, lift = 8) {
    const el = $(id);
    const o = vis(t, a, b, d);
    el.style.opacity = o;
    if (lift) el.style.translate = `0 ${(1 - ease(prog(t, a, a + d))) * lift}px`;
    return o;
  }

  /** Moves an SVG circle along an SVG path between `a` and `b` (reverse: end → start). */
  function packet(dotId, pathId, t, a, b, reverse = false) {
    const dot = $(dotId);
    const path = $(pathId);
    const on = t >= a && t <= b;
    dot.style.opacity = on ? Math.min(1, prog(t, a, a + 0.08) * 1, 1 - prog(t, b - 0.05, b)) : 0;
    if (!on) return;
    let u = easeIO(prog(t, a, b));
    if (reverse) u = 1 - u;
    const p = path.getPointAtLength(u * path.getTotalLength());
    dot.setAttribute("cx", p.x);
    dot.setAttribute("cy", p.y);
  }

  const PATHS = {
    monitor: '<rect width="20" height="14" x="2" y="3" rx="2"/><path d="M8 21h8M12 17v4"/>',
    server:
      '<rect width="20" height="8" x="2" y="2" rx="2"/><rect width="20" height="8" x="2" y="14" rx="2"/><path d="M6 6h.01M6 18h.01"/>',
    database:
      '<ellipse cx="12" cy="5" rx="9" ry="3"/><path d="M3 5v14a9 3 0 0 0 18 0V5"/><path d="M3 12a9 3 0 0 0 18 0"/>',
    cpu: '<rect width="16" height="16" x="4" y="4" rx="2"/><rect width="6" height="6" x="9" y="9" rx="1"/><path d="M15 2v2M15 20v2M2 15h2M2 9h2M20 15h2M20 9h2M9 2v2M9 20v2"/>',
    bank: '<path d="M3 22h18M6 18v-7M10 18v-7M14 18v-7M18 18v-7"/><path d="M12 2l8 5H4z"/>',
    clock: '<circle cx="12" cy="12" r="10"/><path d="M12 6v6l4 2"/>',
    bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.94 1.94 0 0 0 3.4 0"/>',
    radio:
      '<path d="M4.9 19.1C1 15.2 1 8.8 4.9 4.9M7.8 16.2c-2.3-2.3-2.3-6.1 0-8.5"/><circle cx="12" cy="12" r="2"/><path d="M16.2 7.8c2.3 2.3 2.3 6.1 0 8.5M19.1 4.9C23 8.8 23 15.1 19.1 19"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-3-6.7L21 8"/><path d="M21 3v5h-5"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    user: '<circle cx="12" cy="8" r="4"/><path d="M4 21a8 8 0 0 1 16 0"/>',
    list: '<path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/>',
    layers: '<path d="m12 2 10 5-10 5L2 7z"/><path d="m2 17 10 5 10-5M2 12l10 5 10-5"/>',
    sort: '<path d="m3 16 4 4 4-4M7 20V4M21 8l-4-4-4 4M17 4v16"/>',
    loop: '<path d="M3 12a9 9 0 0 1 15-6.7L21 8M21 3v5h-5M21 12a9 9 0 0 1-15 6.7L3 16M3 21v-5h5"/>',
    plug: '<path d="M12 22v-5M9 8V2M15 8V2M18 8v5a4 4 0 0 1-4 4h-4a4 4 0 0 1-4-4V8z"/>',
  };
  const icon = (name, cls = "ic") =>
    `<svg class="${cls}" viewBox="0 0 24 24" aria-hidden="true">${PATHS[name]}</svg>`;

  const LABEL = {
    idle: "",
    pending: "consultando",
    approved: "aprovada",
    refused: "recusada",
    unavailable: "indisponível",
  };
  /** Sets a status pill to a lender attempt state; the pending spinner turns with `t`. */
  function pill(id, state, t) {
    const el = $(id);
    const key = `${state}|${state === "pending" ? Math.floor(t * 12.5) : ""}`;
    if (el.dataset.key === key) return;
    el.dataset.key = key;
    el.className = `pill ${state}`;
    const glyph =
      state === "pending"
        ? `<svg viewBox="0 0 24 24" style="rotate:${(t * 300) % 360}deg"><circle cx="12" cy="12" r="9" fill="none" stroke="currentColor" stroke-width="3.5" stroke-dasharray="36 60" stroke-linecap="round"/></svg>`
        : state === "approved"
          ? icon("check", "")
          : state === "refused" || state === "unavailable"
            ? icon("x", "")
            : "";
    el.innerHTML = `${glyph.replace("<svg ", '<svg fill="none" stroke="currentColor" stroke-width="3" ')}${LABEL[state]}`;
  }

  /** Arrowhead markers, one per colour, for `marker-end="url(#m-<name>)"`. */
  function markers(colors) {
    return Object.entries(colors)
      .map(
        ([name, c]) =>
          `<marker id="m-${name}" viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M0 0L10 5L0 10z" fill="${c}"/></marker>`,
      )
      .join("");
  }

  function scene(duration, render) {
    for (const el of document.querySelectorAll("[data-ic]")) {
      const svg = icon(el.dataset.ic, el.className || "ic");
      el.outerHTML = el.id ? svg.replace("<svg ", `<svg id="${el.id}" `) : svg;
    }
    window.DURATION = duration;
    window.seek = (t) => render(Math.min(t, duration));
    render(0);
    if (!location.search.includes("render")) {
      const start = performance.now();
      const tick = (now) => {
        render(((now - start) / 1000) % duration);
        requestAnimationFrame(tick);
      };
      requestAnimationFrame(tick);
    }
  }

  return { clamp, prog, ease, easeIO, lerp, $, vis, show, packet, icon, pill, markers, scene };
})();
