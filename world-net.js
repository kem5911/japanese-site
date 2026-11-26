"use strict";
// ───────── 한일역 월드 · 같이 걷기(멀티플레이) + 보이스챗 ─────────
// world.html 의 전역(me, camX, PPT, showMsg, hint, drawPerson, bubble, kata, tr, JA …)을 그대로 씀.
// 위치·이름은 Firebase 실시간 데이터베이스(hanil-app), 목소리는 WebRTC 로 기기끼리 바로 연결.
// 안전: 자유 입력 글자 없음(이름·말풍선은 정해진 목록에서만), 보이스는 기본 꺼짐 + 누르는 동안만 말하기,
//       가까운 사람(최대 6명)만 연결, 음소거·차단(이 기기)·신고(reports/) 지원.
// 데이터베이스 규칙: community/database.rules.json
const NET = (() => {
  const CFG = {
    apiKey: "AIzaSyD-vBMjGNhHYSZsZyxRlTlXZaazSoqJzRo", authDomain: "hanil-app.firebaseapp.com", projectId: "hanil-app",
    appId: "1:839137693619:web:e715796592e066f551c5c6",
    databaseURL: "https://hanil-app-default-rtdb.asia-southeast1.firebasedatabase.app",
  };
  const SDK = "11.10.0", MAXCH = 8, CAP = 12, NEAR = 7, FAR = 9, MAXPEERS = 6, STALE = 70000;
  const qs = new URLSearchParams(location.search);
  // 테스트용 에뮬레이터 (?emu=127.0.0.1) — 이 기기 안에서 열었을 때만
  const EMU = location.protocol === "file:" || /^(localhost|127\.)/.test(location.hostname) ? qs.get("emu") : null;
  const ls = (k, v) => { try { if (v === undefined) return localStorage.getItem(k); localStorage.setItem(k, v); } catch {} return null; };

  const ADJ = [["빠른","はやい"],["졸린","ねむい"],["배고픈","はらぺこ"],["신난","ごきげん"],["조용한","しずかな"],["용감한","ゆうかんな"],["느긋한","のんびり"],["반짝이는","きらきら"],["수줍은","てれやの"],["씩씩한","げんきな"],["푸른","あおい"],["작은","ちいさな"],["행복한","しあわせな"],["멋진","かっこいい"],["귀여운","かわいい"],["똑똑한","かしこい"]];
  const ANI = [["토끼","うさぎ"],["고양이","ねこ"],["강아지","いぬ"],["판다","パンダ"],["여우","きつね"],["펭귄","ペンギン"],["다람쥐","リス"],["너구리","たぬき"],["햄스터","ハムスター"],["코알라","コアラ"],["오리","アヒル"],["거북이","カメ"],["부엉이","フクロウ"],["고래","クジラ"],["사슴","シカ"],["곰","クマ"]];
  const COL = ["#00a3a8","#e5532d","#9b5bd1","#2fa84f","#ef8a00","#d6457a","#1e78d2","#6d5f52"];
  const PH = [["안녕하세요!","こんにちは！"],["반가워요","よろしく！"],["같이 해요!","一緒にやろう！"],["고마워요","ありがとう"],["대단해요!","すごい！"],["천천히 말해 주세요","ゆっくり話して"],["잘 모르겠어요","よくわからない"],["ㅋㅋㅋ","www"],["미안해요","ごめんね"],["잘 가요!","またね！"],["👍","👍"],["❤️","❤️"]];
  const WHY = [["bad", "욕설·괴롭힘", "暴言・いやがらせ"], ["sex", "성적인 말", "性的な発言"], ["info", "개인정보 요구", "個人情報をきく"], ["spam", "도배·소음", "スパム・騒音"], ["etc", "기타", "その他"]];
  const flag = l => l === "ja" ? "🇯🇵" : "🇰🇷";
  const nameOf = p => `${(ADJ[p.a] || ADJ[0])[JA ? 1 : 0]} ${(ANI[p.b] || ANI[0])[JA ? 1 : 0]} ${p.k ?? ""}`.trim();
  const rnd = n => Math.floor(Math.random() * n);
  const r2 = v => Math.round(v * 100) / 100;

  // 내 캐릭터 (이 기기에 저장)
  let prof; try { prof = JSON.parse(ls("kj-world-me")); } catch {}
  if (!prof || !(prof.a >= 0)) prof = { a: rnd(ADJ.length), b: rnd(ANI.length), k: rnd(100), c: rnd(COL.length) };
  const saveProf = () => ls("kj-world-me", JSON.stringify(prof));
  saveProf(); me.col = COL[prof.c];

  let blocked; try { blocked = new Set(JSON.parse(ls("kj-world-block")) || []); } catch { blocked = new Set(); }
  const saveBlock = () => ls("kj-world-block", JSON.stringify([...blocked].slice(-200)));
  const muted = new Set();

  let D, A, db, uid = null, ch = null, myRef = null, off = 0, state = "idle";
  const others = new Map();
  const now = () => Date.now() + off;

  // ── 화면 (위 칩, 오른쪽 버튼, 말하기 버튼) ──
  const css = document.createElement("style");
  css.textContent = `
  #netChip { position:fixed; left:12px; top:calc(max(10px, env(safe-area-inset-top)) + 66px); min-height:40px; padding:6px 10px; border:0; border-radius:8px; background:#0f1a33; color:#fff; font-weight:900; font-size:.85rem; cursor:pointer; box-shadow:0 2px 0 rgba(0,0,0,.25); white-space:nowrap; }
  .side { position:fixed; right:max(12px, env(safe-area-inset-right)); top:calc(max(10px, env(safe-area-inset-top)) + 62px); display:flex; flex-direction:column; gap:8px; }
  .side button { width:52px; height:52px; border-radius:50%; border:3px solid #fff; background:#0f1a33; color:#fff; font-size:1.4rem; cursor:pointer; box-shadow:0 3px 0 rgba(0,0,0,.3); }
  .side button[aria-pressed="true"] { background:#2fa84f; }
  #ptt { position:fixed; right:calc(max(18px, env(safe-area-inset-right)) + 96px); bottom:calc(36px + env(safe-area-inset-bottom)); width:72px; height:72px; border-radius:50%; border:4px solid #fff; background:#1e78d2; color:#fff; font-weight:900; font-size:.68rem; letter-spacing:-.02em; line-height:1.1; cursor:pointer; box-shadow:0 4px 0 rgba(0,0,0,.35); touch-action:none; user-select:none; -webkit-user-select:none; }
  #ptt.on { background:#c8102e; transform:scale(1.08); }
  #ptt b { display:block; font-size:1.5rem; }
  .phs { display:grid; grid-template-columns:1fr 1fr; gap:8px; }
  .phs button, .who button, .pick button { padding:10px; min-height:48px; border:2px solid var(--line); background:var(--card); border-radius:10px; cursor:pointer; text-align:left; line-height:1.25; }
  .phs button small, .who small { display:block; color:var(--muted); font-size:.8rem; }
  .who { display:flex; flex-direction:column; gap:6px; }
  .who > div { display:flex; gap:6px; align-items:center; background:var(--card); border:1px solid var(--line); border-radius:10px; padding:6px 8px; }
  .who > div > span { flex:1; min-width:0; }
  .who button { min-height:40px; padding:6px 10px; }
  .pick { display:flex; flex-wrap:wrap; gap:8px; }
  .sw { width:40px; height:40px; border-radius:50%; border:3px solid transparent; cursor:pointer; }
  .sw[aria-pressed="true"] { border-color:var(--text); }
  .rules { margin:0; padding-left:1.2em; line-height:1.6; }
  `;
  document.head.append(css);
  const chip = document.createElement("button"); chip.id = "netChip"; chip.textContent = tr("연결 중…", "接続中…");
  document.body.append(chip);
  const side = document.createElement("div"); side.className = "side";
  side.innerHTML = `<button id="phB" aria-label="${tr("인사 말풍선", "あいさつ")}">💬</button><button id="vB" aria-pressed="false" aria-label="${tr("보이스챗", "ボイスチャット")}">🎙️</button>`;
  document.body.append(side);
  const ptt = document.createElement("button"); ptt.id = "ptt"; ptt.hidden = true;
  ptt.innerHTML = `<b>🎙️</b>${tr("누르고 말하기", "押して話す")}`;
  document.body.append(ptt);

  function chipText() {
    if (state === "on") { const n = [...others.values()].filter(o => live(o)).length + 1; chip.textContent = `👥 ${n} · ${ch.slice(1)}${tr("호차", "号車")}`; }
    else if (state === "solo") chip.textContent = tr("👤 혼자 모드", "👤 ひとりモード");
    else chip.textContent = tr("연결 중…", "接続中…");
  }
  const live = o => o && o.t && now() - o.t < STALE && !blocked.has(o.id);

  // ── 연결 ──
  async function connect() {
    state = "connecting"; chipText();
    try {
      const base = `https://www.gstatic.com/firebasejs/${SDK}/`;
      const [{ initializeApp }, AA, DD] = await Promise.all(["firebase-app", "firebase-auth", "firebase-database"].map(m => import(base + m + ".js")));
      A = AA; D = DD;
      const app = initializeApp(EMU ? { ...CFG, databaseURL: `http://${EMU}:9000?ns=demo-hanil-default-rtdb` } : CFG, "world");
      const auth = A.getAuth(app); db = D.getDatabase(app);
      if (EMU) { A.connectAuthEmulator(auth, `http://${EMU}:9099`, { disableWarnings: true }); D.connectDatabaseEmulator(db, EMU, 9000); }
      const u = auth.currentUser || (await new Promise(r => { const un = A.onAuthStateChanged(auth, x => { un(); r(x); }); })) || (await A.signInAnonymously(auth)).user;
      uid = u.uid;
      D.onValue(D.ref(db, ".info/serverTimeOffset"), s => { off = s.val() || 0; });
      // 자리가 남은 칸(호차)을 고름
      const want = +qs.get("car");
      const list = want >= 1 && want <= MAXCH ? [want] : [...Array(MAXCH)].map((_, i) => i + 1);
      for (const i of list) {
        const s = await withTimeout(D.get(D.ref(db, `world/c${i}/p`)), 8000);
        let n = 0; s.forEach(c => { const v = c.val(); if (c.key !== uid && v && now() - v.t < STALE) n++; });
        if (n < CAP || i === list.at(-1)) { ch = "c" + i; break; }
      }
      myRef = D.ref(db, `world/${ch}/p/${uid}`);
      await join();
      // 다시 연결되면 내 자리를 다시 만듦 (끊길 때 지워지므로)
      let first = true;
      D.onValue(D.ref(db, ".info/connected"), s => { if (s.val() && !first) join().catch(() => {}); first = false; });
      const P = D.ref(db, `world/${ch}/p`);
      D.onChildAdded(P, upsert); D.onChildChanged(P, upsert);
      D.onChildRemoved(P, s => { drop(s.key); others.delete(s.key); chipText(); });
      const S = D.ref(db, `world/${ch}/sig/${uid}`);
      await D.remove(S).catch(() => {});
      D.onChildAdded(S, onSig);
      state = "on"; chipText();
      setInterval(() => { if (state === "on") D.update(myRef, { t: D.serverTimestamp() }).catch(() => {}); chipText(); }, 25000);
    } catch (e) {
      console.warn("world net", e);
      state = "solo"; chipText();
    }
  }
  const withTimeout = (p, ms) => Promise.race([p, new Promise((_, j) => setTimeout(() => j(new Error("timeout")), ms))]);
  async function join() {
    await D.onDisconnect(myRef).remove();
    await D.set(myRef, { a: prof.a, b: prof.b, k: prof.k, c: prof.c, l: LANG, x: r2(me.x), y: r2(me.y), v: V.on, t: D.serverTimestamp() });
    sent = { x: me.x, y: me.y, at: performance.now() };
  }
  function upsert(s) {
    if (s.key === uid) return;
    const v = s.val(); if (!v) return;
    let o = others.get(s.key);
    if (!o) { o = { id: s.key, x: v.x, y: v.y, walk: 0, dx: 0, dy: 1, lvl: 0, say: null, et: v.et || 0 }; others.set(s.key, o); }
    Object.assign(o, { tx: v.x, ty: v.y, a: v.a, b: v.b, k: v.k, l: v.l, v: !!v.v, t: v.t, col: COL[v.c] || COL[0] });
    if (v.e !== undefined && v.et && v.et !== o.et) { o.et = v.et; if (now() - v.et < 8000) o.say = { i: v.e, until: performance.now() + 4500 }; }
    chipText();
  }

  // ── 내 위치 보내기 ──
  let sent = { x: 0, y: 0, at: 0 }, mySay = null, peerT = 0;
  function tick(dt) {
    const t = performance.now();
    if (state === "on" && myRef && (Math.abs(me.x - sent.x) > 0.04 || Math.abs(me.y - sent.y) > 0.04) && t - sent.at > 160) {
      sent = { x: me.x, y: me.y, at: t };
      D.update(myRef, { x: r2(me.x), y: r2(me.y), t: D.serverTimestamp() }).catch(() => {});
    }
    for (const o of others.values()) {
      const dx = o.tx - o.x, dy = o.ty - o.y, d = Math.hypot(dx, dy);
      if (d > 6) { o.x = o.tx; o.y = o.ty; }
      else { const k = Math.min(1, dt * 10); o.x += dx * k; o.y += dy * k; }
      o.moving = d > 0.03; if (o.moving) { o.walk += dt; o.dx = dx / d; o.dy = dy / d; }
      const p = V.peers.get(o.id);
      if (p) {
        if (p.an) { p.an.getByteTimeDomainData(p.buf); let m = 0; for (const b of p.buf) m = Math.max(m, Math.abs(b - 128)); o.lvl = m; }
        if (p.audio) p.audio.volume = muted.has(o.id) ? 0 : Math.max(0.15, Math.min(1, 1 - (Math.hypot(o.x - me.x, o.y - me.y) - 2) / 6));
      } else o.lvl = 0;
    }
    if (t - peerT > 1000) { peerT = t; managePeers(); }
  }

  // ── 그리기 (world.html 의 깊이 정렬 목록에 들어감) ──
  function drawList() {
    const out = [];
    for (const o of others.values()) if (live(o)) out.push({ y: o.y, f: () => drawPerson(o, `${flag(o.l)} ${nameOf(o)}${o.lvl > 10 && !muted.has(o.id) ? " 🔊" : muted.has(o.id) ? " 🔇" : ""}`) });
    return out;
  }
  function drawOver() {
    const t = performance.now();
    for (const o of others.values()) if (live(o) && o.say && o.say.until > t) { const [ko, ja] = PH[o.say.i] || PH[0]; JA ? bubble(o.x, o.y - 0.35, ko, `${kata(ko)} ・ ${ja}`) : bubble(o.x, o.y - 0.35, ja, ko); }
    if (mySay && mySay.until > t) { const [ko, ja] = PH[mySay.i]; JA ? bubble(me.x, me.y - 0.35, ko, `${kata(ko)} ・ ${ja}`) : bubble(me.x, me.y - 0.35, ja, ko); }
    if (V.talking) { ctx.font = font(0.4); ctx.textAlign = "center"; ctx.textBaseline = "middle"; ctx.fillText("🎙️", me.x + 0.5, me.y - 0.25); }
  }
  const myLabel = () => `${flag(LANG)} ${nameOf(prof)}`;

  // 화면을 누른 곳에 다른 사람이 있으면 그 사람 메뉴
  function tap(cx, cy) {
    if (state !== "on") return false;
    const wx = camX + (cx - VW / 2) / PPT, wy = camY + (cy - VH / 2) / PPT;
    let best = null, bd = 0.6;
    for (const o of others.values()) { if (!live(o)) continue; const d = Math.hypot(o.x - wx, o.y - 0.3 - wy); if (d < bd) { bd = d; best = o; } }
    if (!best) return false;
    personSheet(best); return true;
  }

  // ── 말풍선 ──
  $("phB").onclick = () => {
    if (modal) return;
    showMsg(tr("💬 말풍선 보내기", "💬 ふきだしを送る"),
      `<p class="ex">${tr("고르면 주변 사람에게 일본어·한국어로 같이 보여요.", "選ぶと、まわりの人に韓国語・日本語で表示されるよ。")}</p><div class="phs">${PH.map(([ko, ja], i) => `<button data-ph="${i}"><b>${esc(JA ? ko : ja)}</b><small>${esc(JA ? ja : ko)}</small></button>`).join("")}</div>`,
      [[tr("닫기", "閉じる"), closeAll, true]]);
    document.querySelectorAll("[data-ph]").forEach(b => b.onclick = () => {
      const i = +b.dataset.ph; closeAll();
      mySay = { i, until: performance.now() + 4500 };
      if (state === "on") D.update(myRef, { e: i, et: D.serverTimestamp(), t: D.serverTimestamp() }).catch(() => {});
    });
  };

  // ── 사람 목록 / 내 캐릭터 ──
  chip.onclick = () => {
    if (modal) return;
    if (state === "solo") { connect(); return; }
    if (state !== "on") return;
    const list = [...others.values()].filter(o => o.t && now() - o.t < STALE).sort((a, b) => Math.hypot(a.x - me.x, a.y - me.y) - Math.hypot(b.x - me.x, b.y - me.y));
    showMsg(tr(`👥 ${ch.slice(1)}호차에 있는 사람`, `👥 ${ch.slice(1)}号車にいる人`),
      `<div class="who"><div><span><b>${esc(myLabel())}</b><small>${tr("나", "わたし")}</small></span><button id="reroll">🎲 ${tr("이름", "名前")}</button></div></div>
       <div class="pick" style="margin-top:8px">${COL.map((c, i) => `<button class="sw" data-c="${i}" style="background:${c}" aria-pressed="${i === prof.c}" aria-label="${tr("색", "色")} ${i + 1}"></button>`).join("")}</div>
       <div class="who" style="margin-top:10px">${list.length ? list.map(o => `<div><span><b>${esc(flag(o.l) + " " + nameOf(o))}</b><small>${blocked.has(o.id) ? tr("차단함", "ブロック中") : o.v ? tr("🎙️ 보이스 켬", "🎙️ ボイスON") : ""}</small></span><button data-who="${esc(o.id)}">${tr("메뉴", "メニュー")}</button></div>`).join("") : `<p class="ex">${tr("아직 아무도 없어요. 친구에게 이 페이지를 보내 보세요!", "まだだれもいないよ。友達にこのページを送ってみよう！")}</p>`}</div>`,
      [[tr("닫기", "閉じる"), closeAll, true]]);
    $("reroll").onclick = () => { prof.a = rnd(ADJ.length); prof.b = rnd(ANI.length); prof.k = rnd(100); saveProf(); pushProf(); closeAll(); chip.onclick(); };
    document.querySelectorAll("[data-c]").forEach(b => b.onclick = () => { prof.c = +b.dataset.c; me.col = COL[prof.c]; saveProf(); pushProf(); closeAll(); chip.onclick(); });
    document.querySelectorAll("[data-who]").forEach(b => b.onclick = () => { const o = others.get(b.dataset.who); closeAll(); if (o) personSheet(o); });
  };
  const pushProf = () => { if (state === "on") D.update(myRef, { a: prof.a, b: prof.b, k: prof.k, c: prof.c, t: D.serverTimestamp() }).catch(() => {}); };

  function personSheet(o) {
    const isB = blocked.has(o.id), isM = muted.has(o.id);
    showMsg(`${flag(o.l)} ${nameOf(o)}`,
      `<p class="ex">${o.l === "ja" ? tr("일본어를 쓰는 사람이에요. 💬 말풍선으로 인사해 보세요!", "日本語を話す人です。💬で あいさつしてみよう！") : tr("한국어를 쓰는 사람이에요. 💬 말풍선으로 인사해 보세요!", "韓国語を話す人です。💬で あいさつしてみよう！")}</p>
       <div class="who"><div><span>🔇 ${tr("이 사람 목소리 끄기", "この人の声を消す")}</span><button id="pMute">${isM ? tr("다시 켜기", "戻す") : tr("끄기", "消す")}</button></div>
       <div><span>🚫 ${tr("차단 (서로 안 보이고 안 들려요)", "ブロック（見えない・聞こえない）")}</span><button id="pBlock">${isB ? tr("풀기", "解除") : tr("차단", "ブロック")}</button></div>
       <div><span>🚩 ${tr("신고하고 차단", "通報してブロック")}</span><button id="pRep">${tr("신고", "通報")}</button></div></div>`,
      [[tr("닫기", "閉じる"), closeAll, true]]);
    $("pMute").onclick = () => { isM ? muted.delete(o.id) : muted.add(o.id); closeAll(); hint(isM ? tr("목소리를 다시 켰어요", "声を戻したよ") : tr("이 사람 목소리를 껐어요", "この人の声を消したよ")); };
    $("pBlock").onclick = () => { setBlock(o.id, !isB); closeAll(); hint(isB ? tr("차단을 풀었어요", "ブロックを解除したよ") : tr("차단했어요. 이 기기에서 다시 안 보여요", "ブロックしたよ")); };
    $("pRep").onclick = () => {
      closeAll();
      showMsg(tr("🚩 무엇 때문에 신고하나요?", "🚩 通報の理由は？"),
        `<div class="who">${WHY.map(([k, ko, ja]) => `<button data-why="${k}">${JA ? ja : ko}</button>`).join("")}</div><p class="ex" style="margin-top:8px">${tr("신고하면 바로 차단되고, 운영자가 확인해요.", "通報するとすぐブロックされ、運営が確認します。")}</p>`,
        [[tr("취소", "キャンセル"), closeAll, true]]);
      document.querySelectorAll("[data-why]").forEach(b => b.onclick = () => {
        closeAll(); setBlock(o.id, true);
        D.push(D.ref(db, "reports"), { by: uid, who: o.id, why: b.dataset.why, ch, t: D.serverTimestamp() })
          .then(() => hint(tr("신고했어요. 고마워요", "通報しました。ありがとう")), () => hint(tr("신고를 못 보냈어요. 차단은 됐어요", "通報を送れませんでした。ブロックはしたよ")));
      });
    };
  }
  function setBlock(id, on) { on ? blocked.add(id) : blocked.delete(id); saveBlock(); if (on) { drop(id, true); } chipText(); }

  // ── 보이스챗 (WebRTC) ──
  const V = { on: false, stream: null, track: null, talking: false, peers: new Map(), ac: null };
  const ICE = { iceServers: [{ urls: ["stun:stun.l.google.com:19302", "stun:stun1.l.google.com:19302"] }] };
  $("vB").onclick = () => { if (modal) return; V.on ? voiceOff() : voiceAsk(); };
  function voiceAsk() {
    if (state !== "on") { hint(tr("인터넷에 연결돼야 보이스챗을 쓸 수 있어요", "ネットにつながるとボイスチャットが使えるよ")); return; }
    if (ls("kj-world-voice-ok") === "1") return voiceOn();
    showMsg(tr("🎙️ 보이스챗 약속", "🎙️ ボイスチャットのやくそく"),
      `<ol class="rules">
        <li>${tr("가까이 있는 모르는 사람과 목소리로 연결돼요.", "近くにいる知らない人と声でつながります。")}</li>
        <li>${tr("버튼을 <b>누르고 있는 동안만</b> 내 목소리가 나가요.", "ボタンを<b>押している間だけ</b>声が届きます。")}</li>
        <li>${tr("이름·학교·연락처·SNS 같은 개인정보는 말하지 마세요.", "名前・学校・連絡先・SNSなどの個人情報は話さないで。")}</li>
        <li>${tr("불편하면 그 사람을 눌러 바로 끄기·차단·신고하세요.", "いやな時はその人を押して、消す・ブロック・通報。")}</li>
        <li>${tr("만 14세 미만은 보호자와 함께 써 주세요.", "14歳未満は保護者と一緒に使ってね。")}</li>
      </ol>`,
      [[tr("약속할게요", "やくそくする"), () => { ls("kj-world-voice-ok", "1"); closeAll(); voiceOn(); }], [tr("나중에", "あとで"), closeAll, true]]);
  }
  async function voiceOn() {
    try {
      V.stream = await navigator.mediaDevices.getUserMedia({ audio: { echoCancellation: true, noiseSuppression: true, autoGainControl: true } });
    } catch (e) { hint(tr("마이크를 허용해야 보이스챗을 쓸 수 있어요", "マイクを許可するとボイスチャットが使えるよ"), 3000); return; }
    V.track = V.stream.getAudioTracks()[0]; V.track.enabled = false;
    try { V.ac = V.ac || new (window.AudioContext || window.webkitAudioContext)(); V.ac.resume(); } catch {}
    V.on = true; $("vB").setAttribute("aria-pressed", "true"); ptt.hidden = false;
    D.update(myRef, { v: true, t: D.serverTimestamp() }).catch(() => {});
    hint(tr("보이스 켬! 가까이 가면 들려요. 말할 땐 🎙️ 버튼을 누르고 있어요" + (touchUI ? "" : " (V키)"), "ボイスON！近づくと聞こえるよ。話す時は🎙️を押したまま" + (touchUI ? "" : "（Vキー）")), 3500);
    peerT = 0;
  }
  function voiceOff() {
    for (const id of [...V.peers.keys()]) drop(id, true);
    V.stream?.getTracks().forEach(t => t.stop()); V.stream = V.track = null;
    V.on = false; talk(false); $("vB").setAttribute("aria-pressed", "false"); ptt.hidden = true;
    if (state === "on") D.update(myRef, { v: false, t: D.serverTimestamp() }).catch(() => {});
    hint(tr("보이스 껐어요", "ボイスOFF"));
  }
  function talk(on) {
    if (on && !V.track) return;
    V.talking = on; if (V.track) V.track.enabled = on; ptt.classList.toggle("on", on);
  }
  ptt.addEventListener("pointerdown", e => { e.preventDefault(); try { ptt.setPointerCapture(e.pointerId); } catch {} talk(true); });
  for (const ev of ["pointerup", "pointercancel", "lostpointercapture"]) ptt.addEventListener(ev, () => talk(false));
  ptt.addEventListener("contextmenu", e => e.preventDefault());
  addEventListener("keydown", e => { if (!modal && e.key.toLowerCase() === "v" && !e.repeat && V.on) talk(true); });
  addEventListener("keyup", e => { if (e.key.toLowerCase() === "v") talk(false); });
  addEventListener("blur", () => talk(false));
  document.addEventListener("visibilitychange", () => { if (document.hidden) talk(false); });

  function managePeers() {
    if (!V.on) return;
    const near = [...others.values()].filter(o => live(o) && o.v).map(o => ({ o, d: Math.hypot(o.x - me.x, o.y - me.y) })).sort((a, b) => a.d - b.d);
    const keep = new Set(near.filter((n, i) => i < MAXPEERS && n.d < (V.peers.has(n.o.id) ? FAR : NEAR)).map(n => n.o.id));
    for (const id of [...V.peers.keys()]) if (!keep.has(id)) drop(id, true);
    for (const id of keep) if (!V.peers.has(id) && uid < id) call(id);
  }
  function newPC(id) {
    const pc = new RTCPeerConnection(ICE), p = { pc, audio: null, an: null, buf: null };
    V.peers.set(id, p);
    pc.addTrack(V.track, V.stream);
    pc.ontrack = e => {
      const st = e.streams[0] || new MediaStream([e.track]);
      p.audio = new Audio(); p.audio.autoplay = true; p.audio.playsInline = true; p.audio.srcObject = st; p.audio.play().catch(() => {});
      try { const src = V.ac.createMediaStreamSource(st); p.an = V.ac.createAnalyser(); p.an.fftSize = 256; p.buf = new Uint8Array(p.an.fftSize); src.connect(p.an); } catch {}
    };
    pc.onconnectionstatechange = () => { if (["failed", "closed"].includes(pc.connectionState) && V.peers.get(id) === p) drop(id, false); };
    return p;
  }
  const gathered = pc => new Promise(r => {
    if (pc.iceGatheringState === "complete") return r();
    const t = setTimeout(r, 2500);
    pc.addEventListener("icegatheringstatechange", () => { if (pc.iceGatheringState === "complete") { clearTimeout(t); r(); } });
  });
  const send = (to, k, d) => D.push(D.ref(db, `world/${ch}/sig/${to}`), d ? { f: uid, k, d: JSON.stringify(d) } : { f: uid, k }).catch(() => {});
  async function call(id) {
    const p = newPC(id), pc = p.pc;
    try { await pc.setLocalDescription(await pc.createOffer()); await gathered(pc); if (V.peers.get(id) === p) send(id, "offer", pc.localDescription); }
    catch (e) { console.warn("call", e); drop(id, false); }
  }
  async function onSig(s) {
    D.remove(s.ref).catch(() => {});
    const m = s.val(); if (!m || !m.f || blocked.has(m.f)) return;
    try {
      if (m.k === "offer") {
        const o = others.get(m.f);
        if (!V.on || !o || Math.hypot(o.x - me.x, o.y - me.y) > FAR + 2) { send(m.f, "bye"); return; }
        drop(m.f, false);
        const p = newPC(m.f), pc = p.pc;
        await pc.setRemoteDescription(JSON.parse(m.d));
        await pc.setLocalDescription(await pc.createAnswer());
        await gathered(pc);
        if (V.peers.get(m.f) === p) send(m.f, "answer", pc.localDescription);
      } else if (m.k === "answer") {
        const p = V.peers.get(m.f);
        if (p && p.pc.signalingState === "have-local-offer") await p.pc.setRemoteDescription(JSON.parse(m.d));
      } else if (m.k === "bye") drop(m.f, false);
    } catch (e) { console.warn("sig", e); drop(m.f, false); }
  }
  function drop(id, tell) {
    const p = V.peers.get(id); if (!p) return;
    V.peers.delete(id);
    try { p.pc.close(); } catch {}
    if (p.audio) { p.audio.pause(); p.audio.srcObject = null; }
    if (tell && state === "on") send(id, "bye");
  }

  connect();
  return { tick, drawList, drawOver, tap, myLabel, get state() { return state; }, _others: others, _V: V };
})();
