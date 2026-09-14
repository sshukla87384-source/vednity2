/* ============================================================
   VEDNITY — main.js
   3D hero (Three.js), tilt cards, nav, filters, FAQ, form, etc.
   ============================================================ */
(function () {
  "use strict";
  const $ = (s, c = document) => c.querySelector(s);
  const $$ = (s, c = document) => Array.from(c.querySelectorAll(s));
  const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;

  /* ---------- Preloader ---------- */
  const donePreload = () => $("#preloader")?.classList.add("done");
  window.addEventListener("load", () => setTimeout(donePreload, 300));
  setTimeout(donePreload, 3000); // failsafe: never trap the user behind the loader

  /* ---------- 3D HERO (Three.js) ---------- */
  function initHero3D() {
    const canvas = $("#hero-canvas");
    if (!canvas || typeof THREE === "undefined") return;
    let renderer;
    try {
      const probe = document.createElement("canvas");
      if (!(probe.getContext("webgl2") || probe.getContext("webgl"))) throw new Error("no webgl");
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: "high-performance" });
    } catch (e) { document.documentElement.classList.add("no-webgl"); return; }
    const isMobile = window.innerWidth < 768;
    renderer.setPixelRatio(Math.min(window.devicePixelRatio, isMobile ? 1.5 : 2));
    renderer.setSize(window.innerWidth, window.innerHeight);

    const scene = new THREE.Scene();
    scene.fog = new THREE.FogExp2(0x07060f, 0.06);
    const camera = new THREE.PerspectiveCamera(55, window.innerWidth / window.innerHeight, 0.1, 100);
    camera.position.set(0, 0, 9);

    // Lights
    scene.add(new THREE.AmbientLight(0xffffff, 0.35));
    const l1 = new THREE.PointLight(0x7c5cff, 40, 40); l1.position.set(5, 4, 6); scene.add(l1);
    const l2 = new THREE.PointLight(0x21e6c1, 30, 40); l2.position.set(-6, -3, 4); scene.add(l2);
    const l3 = new THREE.PointLight(0xff5fa2, 25, 40); l3.position.set(0, 6, -4); scene.add(l3);

    // Main object: glossy torus knot
    const knotGeo = new THREE.TorusKnotGeometry(1.5, 0.45, 220, 32, 2, 3);
    const knotMat = new THREE.MeshPhysicalMaterial({
      color: 0x8b6cff, metalness: 0.75, roughness: 0.2, clearcoat: 1, clearcoatRoughness: 0.15,
      emissive: 0x2a1a6e, emissiveIntensity: 0.5,
    });
    const knot = new THREE.Mesh(knotGeo, knotMat);
    knot.position.x = isMobile ? 0 : 2.6;
    knot.position.y = isMobile ? 1.8 : 0.2;
    if (isMobile) knot.scale.setScalar(0.7);
    scene.add(knot);

    // Wireframe shell around knot
    const shell = new THREE.Mesh(
      new THREE.IcosahedronGeometry(3.2, 1),
      new THREE.MeshBasicMaterial({ color: 0x21e6c1, wireframe: true, transparent: true, opacity: 0.12 })
    );
    shell.position.copy(knot.position);
    scene.add(shell);

    // Floating geometric shapes
    const shapes = [];
    const geos = [
      new THREE.OctahedronGeometry(0.4), new THREE.TetrahedronGeometry(0.45),
      new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.TorusGeometry(0.35, 0.12, 16, 40),
      new THREE.DodecahedronGeometry(0.35),
    ];
    const colors = [0x7c5cff, 0x21e6c1, 0xff5fa2, 0xa98bff, 0xffb347];
    const count = isMobile ? 10 : 22;
    for (let i = 0; i < count; i++) {
      const mesh = new THREE.Mesh(
        geos[i % geos.length],
        new THREE.MeshStandardMaterial({ color: colors[i % colors.length], metalness: 0.6, roughness: 0.3, emissive: colors[i % colors.length], emissiveIntensity: 0.15 })
      );
      mesh.position.set((Math.random() - 0.5) * 16, (Math.random() - 0.5) * 9, (Math.random() - 0.5) * 8 - 2);
      mesh.userData = { rx: Math.random() * 0.02, ry: Math.random() * 0.02, fy: Math.random() * Math.PI * 2, speed: 0.4 + Math.random() * 0.6 };
      scene.add(mesh); shapes.push(mesh);
    }

    // Particle field
    const pCount = isMobile ? 500 : 1400;
    const pos = new Float32Array(pCount * 3);
    for (let i = 0; i < pCount * 3; i++) pos[i] = (Math.random() - 0.5) * 40;
    const pGeo = new THREE.BufferGeometry();
    pGeo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    const particles = new THREE.Points(pGeo, new THREE.PointsMaterial({ color: 0xa98bff, size: 0.05, transparent: true, opacity: 0.7 }));
    scene.add(particles);

    // Mouse parallax
    const mouse = { x: 0, y: 0, tx: 0, ty: 0 };
    window.addEventListener("pointermove", (e) => {
      mouse.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      mouse.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    }, { passive: true });

    let scrollY = 0;
    window.addEventListener("scroll", () => { scrollY = window.scrollY; }, { passive: true });

    const clock = new THREE.Clock();
    let running = !reduceMotion;
    function animate() {
      if (!running) { renderer.render(scene, camera); return; }
      requestAnimationFrame(animate);
      const t = clock.getElapsedTime();
      mouse.x += (mouse.tx - mouse.x) * 0.05;
      mouse.y += (mouse.ty - mouse.y) * 0.05;

      knot.rotation.x = t * 0.25 + mouse.y * 0.4;
      knot.rotation.y = t * 0.35 + mouse.x * 0.6;
      knot.position.y = (isMobile ? 1.8 : 0.2) + Math.sin(t * 0.8) * 0.25;
      shell.rotation.y = -t * 0.12; shell.rotation.x = t * 0.08;
      shell.position.y = knot.position.y;

      shapes.forEach((m) => {
        m.rotation.x += m.userData.rx; m.rotation.y += m.userData.ry;
        m.position.y += Math.sin(t * m.userData.speed + m.userData.fy) * 0.003;
      });
      particles.rotation.y = t * 0.02 + mouse.x * 0.05;
      particles.rotation.x = mouse.y * 0.05;

      camera.position.x += (mouse.x * 0.8 - camera.position.x) * 0.04;
      camera.position.y += (-mouse.y * 0.5 - scrollY * 0.004 - camera.position.y) * 0.04;
      camera.lookAt(0, 0, 0);
      renderer.render(scene, camera);
    }
    animate();

    // Pause when hero not visible (saves battery)
    const io = new IntersectionObserver(([e]) => {
      if (e.isIntersecting && !running && !reduceMotion) { running = true; animate(); }
      else if (!e.isIntersecting) running = false;
    });
    io.observe(canvas);

    window.addEventListener("resize", () => {
      camera.aspect = window.innerWidth / window.innerHeight;
      camera.updateProjectionMatrix();
      renderer.setSize(window.innerWidth, window.innerHeight);
    });
  }
  if (typeof THREE === "undefined") {
    // CDN fallback: load Three.js from jsDelivr, then start the scene
    const fb = document.createElement("script");
    fb.src = "https://cdn.jsdelivr.net/npm/three@0.160.0/build/three.min.js";
    fb.crossOrigin = "anonymous";
    fb.onload = initHero3D;
    fb.onerror = () => document.documentElement.classList.add("no-webgl");
    document.head.appendChild(fb);
  } else initHero3D();

  /* ---------- Cursor glow ---------- */
  const glow = $(".cursor-glow");
  if (glow && !("ontouchstart" in window)) {
    window.addEventListener("pointermove", (e) => { glow.style.left = e.clientX + "px"; glow.style.top = e.clientY + "px"; }, { passive: true });
  }

  /* ---------- Nav ---------- */
  const nav = $("#nav");
  const burger = $("#burger");
  const mobileMenu = $("#mobile-menu");
  const backTop = $("#back-top");
  const sections = $$("section[id]");
  const navLinks = $$(".nav-links a");
  function onScroll() {
    const y = window.scrollY;
    nav.classList.toggle("scrolled", y > 30);
    backTop?.classList.toggle("show", y > 600);
    let current = "";
    sections.forEach((s) => { if (y >= s.offsetTop - 140) current = s.id; });
    navLinks.forEach((a) => a.classList.toggle("active", a.getAttribute("href") === "#" + current));
  }
  window.addEventListener("scroll", onScroll, { passive: true }); onScroll();
  burger?.addEventListener("click", () => {
    const open = burger.classList.toggle("open");
    mobileMenu.classList.toggle("open", open);
    burger.setAttribute("aria-expanded", open);
  });
  $$("a", mobileMenu || document.createElement("div")).forEach((a) => a.addEventListener("click", () => { burger.classList.remove("open"); mobileMenu.classList.remove("open"); }));
  backTop?.addEventListener("click", () => window.scrollTo({ top: 0, behavior: "smooth" }));

  /* ---------- Reveal on scroll ---------- */
  const ro = new IntersectionObserver((entries) => {
    entries.forEach((e) => { if (e.isIntersecting) { e.target.classList.add("in"); ro.unobserve(e.target); } });
  }, { threshold: 0.12 });
  $$(".reveal").forEach((el) => ro.observe(el));

  /* ---------- 3D tilt cards ---------- */
  if (!reduceMotion && window.matchMedia("(hover:hover)").matches) {
    $$(".card").forEach((card) => {
      card.addEventListener("pointermove", (e) => {
        const r = card.getBoundingClientRect();
        const x = e.clientX - r.left, y = e.clientY - r.top;
        const rx = ((y / r.height) - 0.5) * -10, ry = ((x / r.width) - 0.5) * 10;
        card.style.transform = `perspective(900px) rotateX(${rx}deg) rotateY(${ry}deg) translateY(-6px)`;
        card.style.setProperty("--mx", x + "px"); card.style.setProperty("--my", y + "px");
      });
      card.addEventListener("pointerleave", () => { card.style.transform = ""; });
    });
  }

  /* ---------- Counters ---------- */
  const counters = $$("[data-count]");
  const co = new IntersectionObserver((entries) => {
    entries.forEach((e) => {
      if (!e.isIntersecting) return;
      const el = e.target, target = parseFloat(el.dataset.count), suffix = el.dataset.suffix || "";
      const dur = 1800, start = performance.now();
      (function tick(now) {
        const p = Math.min((now - start) / dur, 1), ease = 1 - Math.pow(1 - p, 3);
        el.textContent = Math.round(target * ease) + suffix;
        if (p < 1) requestAnimationFrame(tick);
      })(start);
      co.unobserve(el);
    });
  }, { threshold: 0.5 });
  counters.forEach((c) => co.observe(c));

  /* ---------- Portfolio filter ---------- */
  $$(".filters button").forEach((btn) => {
    btn.addEventListener("click", () => {
      $$(".filters button").forEach((b) => b.classList.remove("active"));
      btn.classList.add("active");
      const f = btn.dataset.filter;
      $$(".work").forEach((w) => w.classList.toggle("hidden", f !== "all" && w.dataset.cat !== f));
    });
  });

  /* ---------- Testimonials scroll ---------- */
  const track = $("#testi-track");
  $("#testi-prev")?.addEventListener("click", () => track.scrollBy({ left: -420, behavior: "smooth" }));
  $("#testi-next")?.addEventListener("click", () => track.scrollBy({ left: 420, behavior: "smooth" }));
  if (track && !reduceMotion) {
    let paused = false;
    ["pointerenter", "touchstart", "focusin"].forEach((ev) => track.addEventListener(ev, () => (paused = true), { passive: true }));
    ["pointerleave", "touchend", "focusout"].forEach((ev) => track.addEventListener(ev, () => (paused = false), { passive: true }));
    setInterval(() => {
      if (paused || document.hidden) return;
      const end = track.scrollLeft + track.clientWidth >= track.scrollWidth - 4;
      track.scrollTo({ left: end ? 0 : track.scrollLeft + 420, behavior: "smooth" });
    }, 5000);
  }

  /* ---------- Pricing toggle ---------- */
  const sw = $("#billing-switch");
  sw?.addEventListener("click", () => {
    const yearly = sw.classList.toggle("on");
    $$(".price [data-m]").forEach((p) => { p.textContent = yearly ? p.dataset.y : p.dataset.m; });
    $("#bill-label").textContent = yearly ? "/mo, billed yearly" : "/month";
  });

  /* ---------- FAQ ---------- */
  $$(".faq-q").forEach((q) => q.addEventListener("click", () => {
    const item = q.parentElement, open = item.classList.contains("open");
    $$(".faq-item").forEach((i) => i.classList.remove("open"));
    if (!open) item.classList.add("open");
    q.setAttribute("aria-expanded", !open);
  }));

  /* ---------- Toast ---------- */
  function toast(text, ms = 4000) {
    let t = $(".toast"); if (!t) { t = document.createElement("div"); t.className = "toast"; t.setAttribute("role", "status"); document.body.appendChild(t); }
    t.textContent = text; requestAnimationFrame(() => t.classList.add("show"));
    clearTimeout(t._h); t._h = setTimeout(() => t.classList.remove("show"), ms);
  }

  /* ---------- Contact form (AJAX) ---------- */
  const form = $("#contact-form");
  const msg = $("#form-msg");
  const RULES = {
    name: (v) => v.trim().length >= 2 || "Please enter your name.",
    email: (v) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(v.trim()) || "Please enter a valid email address.",
    service: (v) => !!v || "Please select a service.",
    message: (v) => v.trim().length >= 10 || "Tell us a little more (at least 10 characters).",
  };
  function validateField(el) {
    const rule = RULES[el.name]; if (!rule) return true;
    const r = rule(el.value); const err = el.parentElement.querySelector(".field-err") || el.parentElement.appendChild(Object.assign(document.createElement("div"), { className: "field-err" }));
    el.classList.toggle("invalid", r !== true); el.setAttribute("aria-invalid", r !== true);
    err.textContent = r === true ? "" : r; return r === true;
  }
  form?.querySelectorAll("input, select, textarea").forEach((el) => {
    el.addEventListener("blur", () => validateField(el));
    el.addEventListener("input", () => { if (el.classList.contains("invalid")) validateField(el); });
  });
  form?.addEventListener("submit", async (e) => {
    e.preventDefault();
    msg.className = "form-msg";
    const fields = Array.from(form.querySelectorAll("input, select, textarea")).filter((el) => RULES[el.name]);
    const bad = fields.filter((el) => !validateField(el));
    if (bad.length) { bad[0].focus(); return; }
    if (!form.consent.checked) { msg.textContent = "Please accept the privacy policy to continue."; msg.classList.add("err"); return; }
    const btn = form.querySelector("button[type=submit]");
    const original = btn.innerHTML;
    btn.disabled = true; btn.innerHTML = '<span class="spinner"></span> Sending…';
    try {
      const ctrl = new AbortController(); const to = setTimeout(() => ctrl.abort(), 20000);
      const res = await fetch(form.action, { method: "POST", body: new FormData(form), headers: { "Accept": "application/json" }, signal: ctrl.signal });
      clearTimeout(to);
      const data = await res.json().catch(() => ({ success: false, message: "Unexpected server response." }));
      msg.textContent = data.message || (data.success ? "Thanks! We'll get back to you within 24 hours." : "Something went wrong.");
      msg.classList.add(data.success ? "ok" : "err");
      if (data.success) { form.reset(); form.querySelectorAll(".invalid").forEach((el) => el.classList.remove("invalid")); toast("Message sent — we'll reply within 24 hours."); }
    } catch (err) {
      msg.textContent = "Network error — please email us directly at hello@vednity.com or use WhatsApp.";
      msg.classList.add("err");
    }
    msg.scrollIntoView({ behavior: "smooth", block: "nearest" });
    btn.disabled = false; btn.innerHTML = original;
  });

  /* ---------- Newsletter (POST /api/subscribe) ---------- */
  $("#newsletter")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const formEl = e.target, inp = formEl.querySelector("input"), btn = formEl.querySelector("button");
    btn.disabled = true;
    try {
      const r = await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inp.value }) });
      const d = await r.json();
      if (d.success) formEl.innerHTML = '<p style="color:var(--accent);margin:0">Subscribed — welcome aboard!</p>';
      else { toast(d.message || "Could not subscribe."); btn.disabled = false; }
    } catch (err) { btn.disabled = false; }
  });

  /* ---------- Cookie consent ---------- */
  const cookie = $("#cookie");
  try {
    if (cookie && !localStorage.getItem("vednity_cookie")) setTimeout(() => cookie.classList.add("show"), 1500);
  } catch (e) { cookie && setTimeout(() => cookie.classList.add("show"), 1500); }
  $$("[data-cookie]").forEach((b) => b.addEventListener("click", () => {
    try { localStorage.setItem("vednity_cookie", b.dataset.cookie); } catch (e) {}
    cookie.classList.remove("show");
  }));


  /* ============================================================
     ENGAGEMENT FEATURES
     ============================================================ */

  /* ---------- Scroll progress bar ---------- */
  const pbar = $("#progress-bar");
  if (pbar) window.addEventListener("scroll", () => {
    const h = document.documentElement.scrollHeight - window.innerHeight;
    pbar.style.width = (h > 0 ? (window.scrollY / h) * 100 : 0) + "%";
  }, { passive: true });

  /* ---------- Show all services ---------- */
  const tgl = $("#toggle-services");
  tgl?.addEventListener("click", () => {
    const open = tgl.getAttribute("aria-expanded") === "true";
    $$(".more-service").forEach((c, i) => { c.hidden = open; if (!open) setTimeout(() => c.classList.add("in"), 60 * i); });
    tgl.setAttribute("aria-expanded", !open);
    tgl.firstChild.textContent = open ? "Show all 12 services " : "Show fewer services ";
    tgl.querySelector("svg").style.transform = open ? "" : "rotate(180deg)";
    if (open) $("#services").scrollIntoView({ behavior: "smooth", block: "start" });
  });

  /* ---------- Pre-fill the contact form service from any [data-service] link ---------- */
  function prefillService(name) {
    const sel = $("#service"); if (!sel || !name) return;
    const opts = Array.from(sel.options).filter((o) => o.value);
    const opt = opts.find((o) => o.value === name) || opts.find((o) => name.startsWith(o.value) || o.value.startsWith(name.split(" ")[0]));
    if (opt) sel.value = opt.value;
  }
  document.addEventListener("click", (e) => {
    const a = e.target.closest("[data-service]");
    if (a) prefillService(a.dataset.service);
  });

  /* ---------- ROI calculator ---------- */
  const fmtINR = (n) => "₹" + Math.round(n).toLocaleString("en-IN");
  const calc = { budget: $("#c-budget"), cpc: $("#c-cpc"), cr: $("#c-cr"), aov: $("#c-aov") };
  function paintRange(el) { el.style.setProperty("--p", ((el.value - el.min) / (el.max - el.min)) * 100 + "%"); }
  function runCalc() {
    if (!calc.budget) return;
    const budget = +calc.budget.value, cpc = +calc.cpc.value, cr = +calc.cr.value / 100, aov = +calc.aov.value;
    const clicks = budget / cpc, leads = clicks * cr, revenue = leads * aov, roas = revenue / budget, profit = revenue - budget;
    $("#o-budget").textContent = fmtINR(budget); $("#o-cpc").textContent = fmtINR(cpc);
    $("#o-cr").textContent = (cr * 100).toFixed(1).replace(".0", "") + "%"; $("#o-aov").textContent = fmtINR(aov);
    $("#r-clicks").textContent = Math.round(clicks).toLocaleString("en-IN");
    $("#r-leads").textContent = Math.round(leads).toLocaleString("en-IN");
    $("#r-rev").textContent = fmtINR(revenue);
    $("#r-roas").textContent = roas.toFixed(1) + "×";
    const bar = $("#r-bar"), lbl = $("#r-bar-label");
    bar.style.width = Math.max(4, Math.min(100, (revenue / (Math.max(revenue, budget) * 1.15)) * 100)) + "%";
    lbl.textContent = (profit >= 0 ? "Profit: " : "Loss: ") + fmtINR(Math.abs(profit)) + " / month";
    bar.style.background = profit >= 0 ? "" : "linear-gradient(120deg,#ff5fa2,#ff8a5b)";
    Object.values(calc).forEach(paintRange);
    calc.budget.setAttribute("aria-valuetext", fmtINR(budget)); calc.cpc.setAttribute("aria-valuetext", fmtINR(cpc));
    calc.cr.setAttribute("aria-valuetext", (cr * 100) + "%"); calc.aov.setAttribute("aria-valuetext", fmtINR(aov));
  }
  Object.values(calc).forEach((el) => el?.addEventListener("input", runCalc));
  runCalc();

  /* ---------- Growth plan quiz ---------- */
  const QUIZ = [
    { q: "What's your main goal right now?", opts: [["🚀", "More leads & sales", "leads"], ["👀", "Brand awareness", "brand"], ["🛒", "Grow online store sales", "ecom"], ["🌐", "A better website", "web"]] },
    { q: "How do customers find you today?", opts: [["🔍", "Google search", "seo"], ["📱", "Social media", "social"], ["🤝", "Referrals / word of mouth", "none"], ["📢", "Paid ads", "ads"]] },
    { q: "What's your monthly marketing budget?", opts: [["🌱", "Under ₹25,000", "s"], ["📈", "₹25,000 – ₹1 lakh", "m"], ["💼", "₹1 – 5 lakh", "l"], ["🏆", "₹5 lakh+", "xl"]] },
    { q: "How fast do you need results?", opts: [["⚡", "This month", "fast"], ["📅", "Within 3 months", "mid"], ["🌳", "Long-term, sustainable growth", "long"], ["🤷", "Not sure yet", "any"]] },
  ];
  const PLANS = {
    ads: { name: "Paid Ads (PPC)", title: "Performance Ads Sprint", desc: "Fastest path to leads: Google & Meta campaigns with conversion-optimized landing pages, live in 2 weeks." },
    seo: { name: "SEO", title: "Organic Growth Engine", desc: "Compounding traffic from Google with technical SEO, content and authority building — the highest ROI over 6–12 months." },
    social: { name: "Social Media Marketing", title: "Brand & Community Builder", desc: "Scroll-stopping content, reels and community management that turn followers into fans and fans into customers." },
    ecom: { name: "E-commerce Marketing", title: "E-commerce Revenue Stack", desc: "Shopping ads, marketplace optimization and retention flows that lift orders, AOV and repeat purchases." },
    web: { name: "Web Design & Development", title: "Conversion-First Website", desc: "A fast, beautiful site built to convert — plus SEO foundations so it ranks from day one." },
    full: { name: "Full Growth Package", title: "Full-Funnel Growth Partnership", desc: "Ads for speed, SEO for compounding growth and content for trust — our complete system with a dedicated strategist." },
  };
  const qbody = $("#quiz-body"), qbar = $("#quiz-bar");
  let qStep = 0, qAns = [];
  function renderQuiz() {
    if (!qbody) return;
    qbar.style.width = (qStep / QUIZ.length) * 100 + "%";
    if (qStep < QUIZ.length) {
      const q = QUIZ[qStep];
      qbody.innerHTML = `<div class="quiz-step">Question ${qStep + 1} of ${QUIZ.length}</div><div class="quiz-q">${q.q}</div>
        <div class="quiz-opts">${q.opts.map((o) => `<button class="quiz-opt" data-v="${o[2]}"><em>${o[0]}</em>${o[1]}</button>`).join("")}</div>`;
      $$(".quiz-opt", qbody).forEach((b) => b.addEventListener("click", () => { qAns.push(b.dataset.v); qStep++; renderQuiz(); }));
    } else {
      const [goal, channel, budget, speed] = qAns; let key;
      if (goal === "web") key = "web";
      else if (goal === "ecom") key = "ecom";
      else if (goal === "brand") key = "social";
      else if (budget === "l" || budget === "xl") key = "full";
      else if (speed === "fast" || channel === "ads") key = "ads";
      else if (channel === "seo" || speed === "long") key = "seo";
      else key = budget === "s" ? "seo" : "ads";
      const p = PLANS[key];
      qbody.innerHTML = `<div class="quiz-result"><span class="tag">Recommended for you</span><h3 class="grad-text">${p.title}</h3><p>${p.desc}</p>
        <div class="actions"><a href="#contact" class="btn btn-primary" data-service="${p.name}">Get a free plan for this</a><button class="btn btn-ghost" id="quiz-restart">Retake quiz</button></div></div>`;
      $("#quiz-restart").addEventListener("click", () => { qStep = 0; qAns = []; renderQuiz(); });
    }
  }
  renderQuiz();

  /* ---------- Chat assistant (scripted) ---------- */
  const chat = $("#chat"), chatBody = $("#chat-body"), chatReplies = $("#chat-replies");
  const WA = "https://wa.me/919569999205?text=" + encodeURIComponent("Hi Vednity, I'd like to talk about growing my business.");
  const FLOW = {
    start: { text: "Hi there 👋 I'm the Vednity assistant. What can I help you with today?", replies: [["Our services", "services"], ["Pricing", "pricing"], ["See results", "results"], ["Book a free call", "book"]] },
    services: { text: "We handle SEO, Paid Ads, Social Media, Web Design, Content, Branding, Email/WhatsApp, Video, Influencer, E-commerce, CRM automation and CRO — everything under one roof. Which one interests you?", replies: [["SEO", "svc_seo"], ["Paid Ads", "svc_ads"], ["Social Media", "svc_social"], ["Websites", "svc_web"], ["Back", "start"]] },
    svc_seo: { text: "SEO is our compounding growth engine — most clients see meaningful ranking gains in 3–6 months, then it keeps growing without ad spend. Want a free SEO audit of your site?", replies: [["Yes, free audit", "book"], ["What does it cost?", "pricing"], ["Back", "services"]] },
    svc_ads: { text: "Our ads team manages ₹3 crore+/year in spend with an average 6.4× ROAS. Campaigns go live within 2 weeks. Try the ROI calculator to see what your budget could return!", replies: [["Open calculator", "go_calc"], ["Book a call", "book"], ["Back", "services"]] },
    svc_social: { text: "We create reels, carousels and community strategies that build real fans. FitFlow Studio went from 0 to 120K followers with us. Want to see what we'd do for your brand?", replies: [["Yes, show me", "book"], ["Pricing", "pricing"], ["Back", "services"]] },
    svc_web: { text: "We build fast, conversion-focused websites — Skyline Realty's conversion rate rose 218% after their redesign. A typical site takes 3–5 weeks.", replies: [["Get a quote", "book"], ["See our work", "go_work"], ["Back", "services"]] },
    pricing: { text: "Plans start at $499/mo (Starter), $1,299/mo (Growth — most popular), and custom Enterprise packages. All month-to-month, no lock-ins. Ad spend is separate and paid directly to the platforms.", replies: [["See plans", "go_pricing"], ["Book a call", "book"], ["Back", "start"]] },
    results: { text: "Some recent wins: +312% organic traffic for Bloomly, 6.4× ROAS for Quantix, 18K leads at ₹340 CPL for Zenpay. Want to see the case studies?", replies: [["Show case studies", "go_work"], ["Book a call", "book"], ["Back", "start"]] },
    book: { text: "Great choice! You can fill the 30-second form and we'll reply within 24 hours, or chat with a strategist right now on WhatsApp.", replies: [["Fill the form", "go_contact"], ["WhatsApp us", "go_wa"], ["Back", "start"]] },
  };
  const GOTO = { go_calc: "#calculator", go_work: "#work", go_pricing: "#pricing", go_contact: "#contact" };
  function addMsg(text, who) { const d = document.createElement("div"); d.className = "msg " + who; d.textContent = text; chatBody.appendChild(d); chatBody.scrollTop = chatBody.scrollHeight; return d; }
  function showNode(key, userLabel) {
    if (userLabel) addMsg(userLabel, "user");
    if (key === "go_wa") { window.open(WA, "_blank", "noopener"); key = "start"; }
    if (GOTO[key]) { $(GOTO[key])?.scrollIntoView({ behavior: "smooth" }); if (key === "go_contact") $("#name")?.focus({ preventScroll: true }); key = "start"; if (userLabel) { chatReplies.innerHTML = ""; setTimeout(() => showNode("start"), 1200); return; } }
    const node = FLOW[key] || FLOW.start;
    chatReplies.innerHTML = "";
    const t = addMsg("", "bot"); t.classList.add("typing"); t.innerHTML = "<span></span><span></span><span></span>";
    setTimeout(() => {
      t.classList.remove("typing"); t.textContent = node.text;
      node.replies.forEach(([label, next]) => { const b = document.createElement("button"); b.textContent = label; b.addEventListener("click", () => showNode(next, label)); chatReplies.appendChild(b); });
      chatBody.scrollTop = chatBody.scrollHeight;
    }, 600);
  }
  let chatStarted = false;
  function openChat() { chat.classList.add("open"); chat.setAttribute("aria-hidden", "false"); $("#chat-toggle").classList.add("hide"); if (!chatStarted) { chatStarted = true; showNode("start"); } setTimeout(() => $("#chat-close")?.focus({ preventScroll: true }), 350); }
  function closeChat() { chat.classList.remove("open"); chat.setAttribute("aria-hidden", "true"); $("#chat-toggle")?.classList.remove("hide"); }
  $("#chat-toggle")?.addEventListener("click", () => chat.classList.contains("open") ? closeChat() : openChat());
  $("#chat-close")?.addEventListener("click", closeChat);
  // Nudge: auto-open once after 25s if the user hasn't interacted with it
  setTimeout(() => { try { if (!sessionStorage.getItem("vednity_chat")) { openChat(); sessionStorage.setItem("vednity_chat", "1"); } } catch (e) {} }, 25000);

  /* ---------- Exit-intent popup ---------- */
  const exitModal = $("#exit-modal");
  let exitShown = false;
  function showExit() {
    if (exitShown || !exitModal) return;
    try { if (localStorage.getItem("vednity_exit")) return; } catch (e) {}
    exitShown = true; exitModal.classList.add("show"); exitModal.setAttribute("aria-hidden", "false"); setTimeout(() => $("#exit-form input")?.focus(), 350);
  }
  function hideExit() { exitModal.classList.remove("show"); exitModal.setAttribute("aria-hidden", "true"); try { localStorage.setItem("vednity_exit", "1"); } catch (e) {} }
  document.addEventListener("mouseout", (e) => { if (!e.relatedTarget && e.clientY <= 0) showExit(); });
  // Mobile: show once after 45s of engagement instead
  if ("ontouchstart" in window) setTimeout(showExit, 45000);
  $("#exit-close")?.addEventListener("click", hideExit);
  exitModal?.addEventListener("click", (e) => { if (e.target === exitModal) hideExit(); });
  document.addEventListener("keydown", (e) => { if (e.key === "Escape") { hideExit(); closeChat(); } });
  $("#exit-form")?.addEventListener("submit", async (e) => {
    e.preventDefault();
    const inp = e.target.querySelector("input"); const box = e.target.parentElement;
    try { await fetch("/api/subscribe", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ email: inp.value, source: "checklist" }) }); } catch (err) {}
    box.querySelector("h3").textContent = "Check your inbox! 🎉";
    box.querySelector("p").textContent = "Your checklist is on its way. While you wait, why not grab a free audit too?";
    e.target.outerHTML = '<a href="#contact" class="btn btn-primary" id="exit-cta">Get my free audit</a>';
    $("#exit-cta").addEventListener("click", hideExit);
    try { localStorage.setItem("vednity_exit", "1"); } catch (err) {}
  });

  /* ---------- Year ---------- */
  $$("[data-year]").forEach((el) => (el.textContent = new Date().getFullYear()));
})();

