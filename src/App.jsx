import React, { useEffect, useMemo, useRef, useState } from "react";
import { Link, useLocation, useNavigate } from "react-router-dom";
import ConfirmationModal from "./ConfirmationModal";

const API = "/api";
const clientId = localStorage.getItem("queueClientId") || crypto.randomUUID();
localStorage.setItem("queueClientId", clientId);

async function request(path, options = {}) {
  const response = await fetch(`${API}${path}`, { headers: { "Content-Type": "application/json" }, ...options });
  const contentType = response.headers.get("content-type") || "";
  if (response.status === 204) return {};
  if (!contentType.includes("application/json")) {
    throw new Error(`تعذر الاتصال بالـ API (${response.status})`);
  }
  const body = await response.json();
  if (!response.ok) throw new Error(body.error || "وقع مشكل");
  return body;
}

function Shell({ children, title = "Line & Blade" }) {
  return <main className="page"><div className="app-shell"><header className="brand"><div><span className="eyebrow">BARBERSHOP QUEUE</span><h1>{title}</h1></div><Link className="mini-link" to="/admin/login"><Icon name="box-arrow-in-left" />دخول الإدارة</Link></header>{children}</div></main>;
}
function Icon({ name, className = "" }) { return <i className={`bi bi-${name} ${className}`} aria-hidden="true" />; }
function Button({ children, className = "", ...props }) { return <button className={`button ${className}`} {...props}>{children}</button>; }
function ErrorText({ error }) { return error ? <p className="error">{error}</p> : null; }
function barberStatus(barber) {
  return barber.status || (barber.isOpen === false ? "CLOSED_FOR_DAY" : "OPEN");
}
function useStatePolling(setState, setError) {
  useEffect(() => {
    let active = true;
    const sync = () => request("/state").then((nextState) => {
      if (active) setState(nextState);
    }).catch((error) => {
      if (active && setError) setError(error.message);
    });
    sync();
    const interval = setInterval(sync, 3000);
    return () => { active = false; clearInterval(interval); };
  }, [setState, setError]);
}

function ClientView() {
  const [state, setState] = useState({ barbers: [], ads: [] });
  const [selectedId, setSelectedId] = useState(localStorage.getItem("selectedBarber") || "");
  const [name, setName] = useState(localStorage.getItem("clientName") || "");
  const [ticket, setTicket] = useState(JSON.parse(localStorage.getItem("clientTicket") || "null"));
  const [joining, setJoining] = useState(false);
  const [error, setError] = useState("");
  const [switchOpen, setSwitchOpen] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [handoff, setHandoff] = useState(null);
  const previousState = useRef(null);
  useEffect(() => {
    const storedTicket = JSON.parse(localStorage.getItem("clientTicket") || "null");
    if (storedTicket?.date && storedTicket.date !== new Date().toISOString().slice(0, 10)) {
      setTicket(null);
      localStorage.removeItem("clientTicket");
    }
  }, []);
  useStatePolling(setState, setError);
  useEffect(() => {
    const previous = previousState.current;
    if (previous) {
      for (const barber of state.barbers) {
        const oldBarber = previous.barbers.find((item) => item.id === barber.id);
        const wasQueued = oldBarber?.queue.some((client) => client.id === clientId);
        if (wasQueued && barberStatus(barber) === "CLOSED_FOR_DAY" && barberStatus(oldBarber) !== "CLOSED_FOR_DAY") {
          const affectedClient = oldBarber.queue.find((client) => client.id === clientId);
          setTicket(null);
          localStorage.removeItem("clientTicket");
          setHandoff({ currentChairId: barber.id, clientName: affectedClient.name });
          setConfirmation({
            icon: "scissors",
            title: `${barber.name} سالى خدمتو لليوم`,
            message: "الحلاق ديالك سالى خدمتو لليوم. تقدر تحول لعند حلاق آخر مزال خدام ولا ترجع نهار آخر.",
            confirmLabel: "تحول عند حلاق آخر",
            onConfirm: () => { setConfirmation(null); setSwitchOpen(true); },
          });
        }
      }
    }
    previousState.current = state;
  }, [state]);
  useEffect(() => { if (!selectedId && state.barbers[0]) setSelectedId(state.barbers[0].id); }, [state.barbers, selectedId]);
  const selected = state.barbers.find((barber) => barber.id === selectedId) || state.barbers[0];
  const activeTicket = useMemo(() => {
    for (const barber of state.barbers) {
      const client = barber.queue.find((item) => item.id === clientId);
      if (client) return { ...client, barberId: barber.id };
    }
    return null;
  }, [state.barbers]);
  const queuedBarber = activeTicket ? state.barbers.find((barber) => barber.id === activeTicket.barberId) : null;
  const currentTicket = activeTicket && selected && activeTicket.barberId === selected.id ? activeTicket.ticket : null;
  const myTurn = currentTicket === selected?.currentlyServing;
  function rememberTicket(next) { setTicket(next); localStorage.setItem("clientTicket", JSON.stringify(next)); }
  async function join() {
    if (joining || !selected) return;
    setJoining(true);
    setError("");
    try {
      localStorage.setItem("clientName", name);
      const result = await request("/queue", { method: "POST", body: JSON.stringify({ action: "join", barberId: selected.id, name, clientId }) });
      rememberTicket({ ...result.client, barberId: selected.id, date: new Date().toISOString().slice(0, 10) });
    } catch (error) {
      setError(error.message);
    } finally {
      setJoining(false);
    }
  }
  async function leave() { if (!activeTicket) return; await request("/queue", { method: "POST", body: JSON.stringify({ action: "leave", barberId: activeTicket.barberId, clientId }) }); rememberTicket(null); }
  function transferBarber(targetChairId) {
    const sourceChairId = queuedBarber?.id || handoff?.currentChairId;
    if (!sourceChairId || targetChairId === sourceChairId) return;
    const target = state.barbers.find((barber) => barber.id === targetChairId);
    if (!target || barberStatus(target) === "CLOSED_FOR_DAY") return setError("هاد الحلاق سالى خدمتو لليوم");
    request("/queue", { method: "POST", body: JSON.stringify({ action: "switch", clientId, fromBarberId: sourceChairId, toBarberId: targetChairId, name: name || handoff?.clientName }) }).then((result) => {
      setSelectedId(targetChairId);
      localStorage.setItem("selectedBarber", targetChairId);
      rememberTicket({ ...result.client, barberId: targetChairId, date: new Date().toISOString().slice(0, 10) });
      setHandoff(null);
      setSwitchOpen(false);
      setError("");
    }).catch((error) => setError(error.message));
  }
  function requestBarberSwitch(targetChairId) {
    const target = state.barbers.find((barber) => barber.id === targetChairId);
    if (!target || (!queuedBarber && !handoff)) return;
    const sourceName = queuedBarber?.name || state.barbers.find((barber) => barber.id === handoff.currentChairId)?.name || "الحلاق";
    setConfirmation({
      icon: "arrow-left-right",
      title: `تأكيد التبديل لـ ${target.name}`,
      message: `واش بغيتي تبدل من ${sourceName} لـ ${target.name}؟`,
      onConfirm: () => { setConfirmation(null); transferBarber(targetChairId); },
    });
  }
  function requestLeave() {
    setConfirmation({
      icon: "box-arrow-right",
      title: "تأكيد الانسحاب",
      message: "واش باغي تسمح فـ النوبة؟",
      danger: true,
      confirmLabel: "انسحاب",
      onConfirm: async () => { setConfirmation(null); await leave(); },
    });
  }
  // CLIENT VIEW (/): public queue and ticket interface
  return <Shell><section className="intro"><p className="kicker">خد نوبتك بلا صداع</p><h2>اختار الحلاق ديالك</h2><p className="muted">شوف شحال باقي ليك وخليك مرتاح.</p></section>
    <nav className="barber-tabs" aria-label="الحلاقين">{state.barbers.map((barber) => <button key={barber.id} className={barber.id === selected?.id ? "active" : ""} onClick={() => { setSelectedId(barber.id); localStorage.setItem("selectedBarber", barber.id); }}>{barber.name}<small className={`${barberStatus(barber).toLowerCase()}-dot`}>{barberStatus(barber) === "OPEN" ? "شغال" : barberStatus(barber) === "PAUSED" ? "استراحة" : "ساليت اليوم"}</small></button>)}</nav>
    {selected && <><div className="serving-card"><span>دابا فـ الكرسي</span><strong>#{selected.currentlyServing || "—"}</strong><small>{selected.name}</small></div>
      {barberStatus(selected) === "PAUSED" && <div className="paused-badge"><Icon name="pause-circle" />غير متاح حالياً - يمكنك شد النوبة</div>}
      {!activeTicket ? <section className="panel"><label>السميّة ديالك<input value={name} onChange={(e) => { setName(e.target.value); localStorage.setItem("clientName", e.target.value); }} placeholder="مثال: أمين" /></label><Button disabled={joining || !name.trim() || barberStatus(selected) === "CLOSED_FOR_DAY"} onClick={join}>{joining ? <><Icon name="arrow-repeat" className="loading-spinner" />جاري حجز نوبتك...</> : barberStatus(selected) === "CLOSED_FOR_DAY" ? "ساليت الخدمة اليوم" : `شد النوبة عند ${selected.name}`}</Button></section> :
        selected.id !== queuedBarber.id ? <section className="panel switch-prompt"><span>عندك نوبة مع {queuedBarber.name}</span><Button disabled={!selected.isOpen} onClick={() => requestBarberSwitch(selected.id)}><Icon name="arrow-left-right" />تحول لعند {selected.name}</Button></section> :
        <section className={myTurn ? "turn-card" : "ticket-card"}><span>{myTurn ? "وصلات نوبتك!" : "النمرة ديالك"}</span><strong>#{currentTicket}</strong>{myTurn ? <p><Icon name="scissors" /> دخل عند الحلاق، راه كيتسناك</p> : <div className="actions"><Button className="secondary" onClick={() => setSwitchOpen(true)}><Icon name="arrow-left-right" />بدل الحلاق</Button><Button className="danger" onClick={requestLeave}><Icon name="box-arrow-right" />انسحاب</Button></div>}</section>}
    </>}
    <ErrorText error={error} />
    {state.ads[0] && <aside className="ad-card">{state.ads[0].imageUrl && <img src={state.ads[0].imageUrl} alt="" />}<div><span>AD</span><p>{state.ads[0].description}</p></div></aside>}
    {switchOpen && <div className="modal-backdrop" role="presentation" onClick={() => setSwitchOpen(false)}><section className="switch-modal" role="dialog" aria-modal="true" aria-labelledby="switch-title" onClick={(event) => event.stopPropagation()}><div className="modal-heading"><div><span className="eyebrow">SWITCH BARBER</span><h3 id="switch-title">بدل الحلاق</h3></div><button className="modal-close" onClick={() => setSwitchOpen(false)} aria-label="سد"><Icon name="x-lg" /></button></div><p className="muted">اختار حلاق محلول باش تحول النوبة ديالك.</p><div className="switch-options">{state.barbers.filter((barber) => barber.id !== (queuedBarber?.id || handoff?.currentChairId) && barberStatus(barber) !== "CLOSED_FOR_DAY").map((barber) => <button key={barber.id} onClick={() => { setSwitchOpen(false); requestBarberSwitch(barber.id); }}><span>{barber.name}</span><Icon name="chevron-left" /></button>)}</div></section></div>}
    {confirmation && <ConfirmationModal {...confirmation} onCancel={() => setConfirmation(null)} />}
  </Shell>;
}

function Login() {
  const [barbers, setBarbers] = useState([]); const [barberId, setBarberId] = useState(""); const [password, setPassword] = useState(""); const [isOwner, setIsOwner] = useState(false); const [error, setError] = useState(""); const navigate = useNavigate();
  useEffect(() => { request("/state").then((s) => { setBarbers(s.barbers); setBarberId(s.barbers[0]?.id || ""); }).catch((e) => setError(e.message)); }, []);
  async function login(e) { e.preventDefault(); try { const session = await request("/login", { method: "POST", body: JSON.stringify({ barberId, password, isOwner }) }); localStorage.setItem("adminSession", JSON.stringify(session)); navigate(session.role === "owner" ? "/admin/owner" : "/admin/barber"); } catch (e) { setError(e.message); } }
  // LOGIN VIEW (/admin/login): barber and owner authentication form
  return <Shell title="دخول الإدارة"><form className="panel login-form" onSubmit={login}><div className="form-heading"><span className="stamp">ADMIN</span><h2>مرحبا بيك</h2><p className="muted">دخل باش تسير النوبة ديالك.</p></div><label>اختار الحلاق<select value={barberId} onChange={(e) => setBarberId(e.target.value)}>{barbers.map((barber) => <option key={barber.id} value={barber.id}>{barber.name}</option>)}</select></label><label>الباسوورد<input type="password" value={password} onChange={(e) => setPassword(e.target.value)} placeholder="••••" /></label><label className="check"><input type="checkbox" checked={isOwner} onChange={(e) => setIsOwner(e.target.checked)} /> أنا هو صاحب المحل</label><Button type="submit">دخل للنظام</Button><ErrorText error={error} /></form></Shell>;
}

function BarberDashboard({ session }) {
  const [state, setState] = useState({ barbers: [], ads: [] }); const barber = state.barbers.find((item) => item.id === session.barberId); const [expanded, setExpanded] = useState(false);
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState("");
  const navigate = useNavigate();
  useStatePolling(setState, setError);
  if (!barber) return null;
  const queue = expanded ? barber.queue : barber.queue.slice(0, 3);
  // BARBER DASHBOARD VIEW (/admin/barber): queue control for the selected chair
  async function nextClient() {
    if (barberStatus(barber) !== "OPEN") {
      setError("خاص الحلاق يكون محلول باش يدوز الكليان");
      return;
    }
    try {
      const nextState = await request("/barbers", { method: "POST", body: JSON.stringify({ action: "next", barberId: barber.id }) });
      setState(nextState);
      setError("");
    } catch (requestError) {
      setError(requestError.message);
    }
  }
  function requestSkip(client) {
    setConfirmation({
      icon: "person-dash",
      title: "تأكيد الحذف",
      message: `واش باغي تحيد ${client.name} من النوبة؟`,
      danger: true,
      confirmLabel: "حيد الكليان",
      onConfirm: async () => { await request("/queue", { method: "POST", body: JSON.stringify({ action: "skip", barberId: barber.id, clientId: client.id }) }); setConfirmation(null); },
    });
  }
  function requestStatus(nextStatus) {
    if (nextStatus !== "CLOSED_FOR_DAY") {
      request("/barbers", { method: "PATCH", body: JSON.stringify({ action: "status", barberId: barber.id, status: nextStatus }) })
        .then((result) => { setState(result.state || result); setError(""); })
        .catch((requestError) => setError(requestError.message));
      return;
    }
    setConfirmation({
      icon: "calendar-x",
      title: "تأكيد ساليت اليوم",
      message: `واش متأكد بلي ${barber.name} سالى خدمتو اليوم؟ غادي يتحيدو الناس من النوبة وما غاديش يقدرو يزيدو عندك.`,
      confirmLabel: "نعم، ساليت اليوم",
      danger: true,
      onConfirm: () => {
        request("/barbers", { method: "PATCH", body: JSON.stringify({ action: "status", barberId: barber.id, status: "CLOSED_FOR_DAY" }) })
          .then((result) => { setState(result.state || result); setError(""); })
          .catch((requestError) => setError(requestError.message));
        setConfirmation(null);
      },
    });
  }
  return <><header className="admin-head"><div><span className="eyebrow">BARBER MODE</span><h2>{barber.name}</h2></div><button className="mini-link" onClick={() => { localStorage.removeItem("adminSession"); navigate("/admin/login"); }}><Icon name="box-arrow-right" />خروج</button></header><section className="admin-content"><div className="barber-controls"><Button disabled={barberStatus(barber) !== "OPEN"} onClick={nextClient}><Icon name="skip-forward-fill" />دوز اللي موراه</Button><select className={`status-select ${barberStatus(barber).toLowerCase()}`} value={barberStatus(barber)} onChange={(event) => requestStatus(event.target.value)}><option value="OPEN">شغال</option><option value="PAUSED">استراحة</option><option value="CLOSED_FOR_DAY">ساليت اليوم</option></select></div><div className="now-card"><span>دابا فـ الكرسي</span><strong>#{barber.currentlyServing || "—"}</strong></div><section className="queue-section"><div className="section-title"><h3>الناس فـ النوبة</h3><span>{barber.queue.length} مسجلين</span></div>{queue.length ? queue.map((client) => <div className="queue-row" key={client.id}><div><strong>{client.name}</strong><span>#{client.ticket}</span></div><Button className="small danger" onClick={() => requestSkip(client)}><Icon name="person-dash" />سحب</Button></div>) : <p className="empty">ما كاين حتى واحد كيتسنى.</p>}{barber.queue.length > 3 && <Button className="full secondary" onClick={() => setExpanded(!expanded)}><Icon name={expanded ? "chevron-up" : "chevron-down"} />{expanded ? "شوف أقل" : "شوف كتر"}</Button>}</section><ErrorText error={error} /></section>{confirmation && <ConfirmationModal {...confirmation} onCancel={() => setConfirmation(null)} />}</>;
}

function OwnerSettings({ session }) {
  const [state, setState] = useState({ barbers: [], ads: [] }); const [name, setName] = useState(""); const [password, setPassword] = useState(""); const [ad, setAd] = useState({ imageUrl: "", description: "" }); const navigate = useNavigate();
  const [confirmation, setConfirmation] = useState(null);
  const [error, setError] = useState("");
  useStatePolling(setState, setError);
  async function addBarber(e) { e.preventDefault(); if (!name || !password) return; try { const nextState = await request("/barbers", { method: "POST", body: JSON.stringify({ name, password }) }); setState(nextState); setName(""); setPassword(""); setError(""); } catch (requestError) { setError(requestError.message); } }
  function editBarber(barber) {
    setConfirmation({
      icon: "pencil",
      title: "بدل الباسوورد",
      message: `دخل الباسوورد الجديد ديال ${barber.name}.`,
      confirmLabel: "حفظ",
      children: <input className="modal-input" type="password" placeholder="الباسوورد الجديد" id="new-barber-password" />,
      onConfirm: async () => {
        const next = document.getElementById("new-barber-password")?.value.trim();
        if (next) { const nextState = await request("/barbers", { method: "PATCH", body: JSON.stringify({ action: "edit", barberId: barber.id, password: next }) }); setState(nextState); }
        setConfirmation(null);
      },
    });
  }
  function removeBarber(barber) {
    setConfirmation({
      icon: "trash3",
      title: "تأكيد الحذف",
      message: `واش باغي تحيد ${barber.name}؟`,
      danger: true,
      confirmLabel: "حدف الحلاق",
      onConfirm: async () => { try { const nextState = await request("/barbers", { method: "DELETE", body: JSON.stringify({ barberId: barber.id }) }); setState(nextState); setError(""); } catch (requestError) { setError(requestError.message); } setConfirmation(null); },
    });
  }
  async function saveAd(e) {
    e.preventDefault();
    if (!ad.description.trim() && !ad.imageUrl.trim()) return;
    const nextAd = { ...ad, id: state.ads[0]?.id };
    const ads = state.ads.length >= 3 ? [nextAd, ...state.ads.slice(1)] : [...state.ads, nextAd];
    try {
      const nextState = await request("/ads", { method: "PUT", body: JSON.stringify({ ads }) });
      setState(nextState);
      setAd({ imageUrl: "", description: "" });
      setError("");
    } catch (error) {
      setError(error.message);
    }
  }
  // OWNER DASHBOARD VIEW (/admin/owner): barber and advertisement management
  return <><header className="admin-head"><div><span className="eyebrow">OWNER MODE</span><h2>الإعدادات</h2></div><button className="mini-link" onClick={() => { localStorage.removeItem("adminSession"); navigate("/admin/login"); }}><Icon name="box-arrow-right" />خروج</button></header><section className="admin-content settings-content"><div className="owner-tabs"><Link to="/admin/barber"><Icon name="scissors" />الخدمة</Link><span className="selected"><Icon name="gear" />الإعدادات</span></div><section className="panel"><div className="section-title"><h3>الحلاقين</h3><span>{state.barbers.length}/∞</span></div><form onSubmit={addBarber} className="stack-form"><input value={name} onChange={(e) => setName(e.target.value)} placeholder="اسم الحلاق" /><input value={password} onChange={(e) => setPassword(e.target.value)} placeholder="الباسوورد" /><Button type="submit"><Icon name="plus-lg" />زيد حلاق</Button></form>{state.barbers.map((barber) => <div className="manage-row" key={barber.id}><span>{barber.name}</span><div><Button className="small secondary" onClick={() => editBarber(barber)}><Icon name="pencil" />بدل</Button><Button className="small danger" onClick={() => removeBarber(barber)}><Icon name="trash3" />حدف</Button></div></div>)}</section><section className="panel"><div className="section-title"><h3>الإعلانات <span className="stamp">AD</span></h3><span>{state.ads.length}/3</span></div><form onSubmit={saveAd} className="stack-form"><input value={ad.imageUrl} onChange={(e) => setAd({ ...ad, imageUrl: e.target.value })} placeholder="رابط الصورة (اختياري)" /><textarea value={ad.description} onChange={(e) => setAd({ ...ad, description: e.target.value })} placeholder="النص ديال الإعلان" rows="3" /><Button type="submit" disabled={!ad.description.trim() && !ad.imageUrl.trim()}><Icon name="save" />{state.ads.length >= 3 ? "بدل الإعلان" : "حفظ الإعلان"}</Button></form></section><ErrorText error={error} /></section>{confirmation && <ConfirmationModal {...confirmation} onCancel={() => setConfirmation(null)} />}</>;
}

export function AdminView() {
  const session = JSON.parse(localStorage.getItem("adminSession") || "null"); const location = useLocation();
  if (!session) return <Login />;
  if (session.role === "barber") return <BarberDashboard session={session} />;
  return location.pathname.endsWith("/barber") ? <BarberDashboard session={session} /> : <OwnerSettings session={session} />;
}

export { ClientView, Login };
