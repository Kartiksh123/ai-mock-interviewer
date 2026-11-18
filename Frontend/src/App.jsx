import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ArrowDownToLine, ArrowLeft, ArrowRight, ArrowUpRight, BarChart3, BriefcaseBusiness,
  Check, CheckCircle2, ChevronDown, ChevronRight, CircleHelp, Clock3, FileText,
  History, Lightbulb, LoaderCircle, Menu, MessageSquareText, Mic2, MoreHorizontal,
  Plus, Send, Sparkles, Target, Upload, X,
} from 'lucide-react';

const API = (import.meta.env.VITE_API_URL || (import.meta.env.VITE_API_HOST ? `https://${import.meta.env.VITE_API_HOST}/api` : 'http://localhost:3000/api')).replace(/\/$/, '');
const ROLES = [
  { name: 'Machine Learning Engineer', short: 'ML Engineer', icon: '◌', color: 'lavender' },
  { name: 'Python Developer', short: 'Python Developer', icon: '⌘', color: 'blue' },
  { name: 'Data Analyst', short: 'Data Analyst', icon: '▥', color: 'mint' },
  { name: 'Full Stack Developer', short: 'Full Stack Developer', icon: '⌘', color: 'peach' },
];

async function api(path, options = {}) {
  const token = localStorage.getItem('intervue_token');
  const headers = { ...(options.headers || {}), ...(token ? { Authorization: `Bearer ${token}` } : {}) };
  const response = await fetch(`${API}${path}`, { ...options, headers });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const error = new Error(data.error || `Request failed (${response.status})`);
    error.status = response.status;
    throw error;
  }
  return data;
}

function formatDate(value) {
  if (!value) return 'Just now';
  return new Intl.DateTimeFormat('en', { month: 'short', day: 'numeric', year: 'numeric' }).format(new Date(value));
}

function App() {
  const [page, setPage] = useState('dashboard');
  const [currentUser, setCurrentUser] = useState(null);
  const [authReady, setAuthReady] = useState(false);
  const [dashboard, setDashboard] = useState(null);
  const [history, setHistory] = useState([]);
  const [loadingDashboard, setLoadingDashboard] = useState(true);
  const [notice, setNotice] = useState('');
  const [busy, setBusy] = useState(false);
  const [mobileNav, setMobileNav] = useState(false);
  const [interview, setInterview] = useState(null);
  const [evaluation, setEvaluation] = useState(null);
  const [finalReport, setFinalReport] = useState(null);
  const [reportError, setReportError] = useState('');
  const [answer, setAnswer] = useState('');
  const [selectedRole, setSelectedRole] = useState('Machine Learning Engineer');
  const [jobDescription, setJobDescription] = useState('');
  const [resumeFile, setResumeFile] = useState(null);
  const [dragOver, setDragOver] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const fileInput = useRef(null);
  const answerInput = useRef(null);

  const refresh = useCallback(async () => {
    try {
      const identity = await api('/auth/me');
      const [dash, list] = await Promise.all([api('/dashboard'), api('/interviews')]);
      setCurrentUser(identity.user);
      setDashboard(dash);
      setHistory(list.interviews || []);
      setNotice('');
    } catch (error) {
      if (error.status === 401) {
        localStorage.removeItem('intervue_token');
        setCurrentUser(null);
      } else setNotice(error.message);
    } finally {
      setLoadingDashboard(false);
      setAuthReady(true);
    }
  }, []);

  useEffect(() => { refresh(); }, [refresh]);
  useEffect(() => {
    if (!interview || interview.status === 'completed') return undefined;
    const timer = window.setInterval(() => setElapsed((seconds) => seconds + 1), 1000);
    return () => window.clearInterval(timer);
  }, [interview]);

  const currentQuestion = interview?.questions?.[interview.currentQuestionIndex] || null;
  const answeredCount = interview?.answers?.length || 0;
  const questionCount = interview?.questions?.length || 0;
  const progress = questionCount ? Math.min(100, Math.round((answeredCount / questionCount) * 100)) : 0;
  const timerLabel = `${String(Math.floor(elapsed / 60)).padStart(2, '0')}:${String(elapsed % 60).padStart(2, '0')}`;
  const recentHistory = useMemo(() => dashboard?.recentInterviews || history.slice(0, 4), [dashboard, history]);

  const setFile = (file) => {
    if (!file) return;
    if (file.type !== 'application/pdf') {
      setNotice('Please choose a PDF resume.');
      return;
    }
    if (file.size > 8 * 1024 * 1024) {
      setNotice('Your PDF must be smaller than 8 MB.');
      return;
    }
    setResumeFile(file);
    setNotice('');
  };

  const beginInterview = async (event) => {
    event.preventDefault();
    if (!resumeFile) return setNotice('Upload your resume to create a personalized interview.');
    if (jobDescription.trim().length < 30) return setNotice('Add a job description with at least 30 characters.');
    setBusy(true);
    setNotice('');
    try {
      const form = new FormData();
      form.append('resume', resumeFile);
      const [resume, job] = await Promise.all([
        api('/resume/analyze', { method: 'POST', body: form }),
        api('/job/analyze', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ jobDescription }) }),
      ]);
      const created = await api('/interviews', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ role: selectedRole, jobDescription, resumeText: resume.resumeText, resumeAnalysis: resume.analysis, jobAnalysis: job.analysis, questionCount: 5 }),
      });
      setInterview(created);
      setEvaluation(null);
      setFinalReport(null);
      setReportError('');
      setAnswer('');
      setElapsed(0);
      setPage('interview');
      await refresh();
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const submitAnswer = async (event) => {
    event.preventDefault();
    if (!answer.trim() || !currentQuestion) return;
    setBusy(true);
    setNotice('');
    try {
      const result = await api(`/interviews/${interview.id}/answer`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ answer }),
      });
      setEvaluation({ ...result.evaluation, question: currentQuestion.question });
      setAnswer('');
      const updated = await api(`/interviews/${interview.id}`);
      setInterview(updated);
      if (result.status === 'completed') {
        setPage('results');
        if (result.report) setFinalReport(result.report);
        else setReportError(result.reportError || 'Your report is still being prepared.');
        await refresh();
      }
      window.setTimeout(() => answerInput.current?.focus(), 80);
    } catch (error) {
      setNotice(error.message);
    } finally {
      setBusy(false);
    }
  };

  const openReport = async (item) => {
    setBusy(true);
    setNotice('');
    try {
      const selected = await api(`/interviews/${item.id}`);
      setInterview(selected);
      setEvaluation(null);
      setFinalReport(null);
      setReportError('');
      setPage(selected.status === 'completed' ? 'results' : 'interview');
      if (selected.status === 'completed') {
        const result = await api(`/interviews/${item.id}/report`);
        setFinalReport(result.report);
      }
    } catch (error) {
      setNotice(error.message);
      setPage('history');
    } finally {
      setBusy(false);
    }
  };

  const retryReport = async () => {
    if (!interview) return;
    setBusy(true);
    try {
      const result = await api(`/interviews/${interview.id}/report`);
      setFinalReport(result.report);
      setReportError('');
    } catch (error) {
      setReportError(error.message);
    } finally {
      setBusy(false);
    }
  };

  const startNew = () => {
    setInterview(null);
    setEvaluation(null);
    setFinalReport(null);
    setReportError('');
    setAnswer('');
    setElapsed(0);
    setNotice('');
    setPage('prepare');
  };

  const signOut = () => {
    localStorage.removeItem('intervue_token');
    setCurrentUser(null);
    setDashboard(null);
    setHistory([]);
    setPage('dashboard');
  };

  if (!authReady) return <div className="auth-loading"><LoaderCircle className="spin" size={22}/> Loading your workspace…</div>;
  if (!currentUser) return <AuthPage onAuthenticated={async (user) => { setCurrentUser(user); await refresh(); }} />;

  return (
    <div className="app-shell">
      <aside className={`sidebar ${mobileNav ? 'sidebar-open' : ''}`}>
        <div className="brand-lockup">
          <div className="brand-mark"><MessageSquareText size={19} strokeWidth={2.2} /></div>
          <div className="brand-name">intervue<span>.</span><small>AI INTERVIEW STUDIO</small></div>
          <button className="mobile-close icon-button" onClick={() => setMobileNav(false)} aria-label="Close menu"><X size={18} /></button>
        </div>

        <div className="workspace-label">WORKSPACE</div>
        <nav className="side-nav">
          <button className={`nav-item ${page === 'dashboard' ? 'active' : ''}`} onClick={() => { setPage('dashboard'); setMobileNav(false); }}><BarChart3 size={18} /><span>Overview</span></button>
          <button className={`nav-item ${page === 'history' ? 'active' : ''}`} onClick={() => { setPage('history'); setMobileNav(false); }}><History size={18} /><span>Interview history</span><span className="nav-count">{history.length}</span></button>
        </nav>

        <div className="sidebar-divider" />
        <div className="workspace-label role-heading">YOUR FOCUS <button className="icon-button tiny" title="Add role"><Plus size={14} /></button></div>
        <div className="focus-role"><span className="role-dot purple" />Machine Learning Engineer</div>
        <div className="focus-role muted-role"><span className="role-dot blue-dot" />Python Developer</div>

        <div className="sidebar-bottom">
          <div className="upgrade-card">
            <div className="upgrade-icon"><Sparkles size={16} /></div>
            <div><strong>Practice with purpose</strong><p>Every session gets you closer.</p></div>
            <ArrowUpRight size={15} className="upgrade-arrow" />
          </div>
          <div className="profile-row">
            <div className="avatar">ME</div>
            <div className="profile-info"><strong>{currentUser.email}</strong><span>Your workspace</span></div>
            <button className="icon-button profile-more" onClick={signOut} title="Sign out" aria-label="Sign out"><MoreHorizontal size={19} /></button>
          </div>
        </div>
      </aside>

      <main className="main-area">
        <header className="topbar">
          <div className="topbar-left"><button className="mobile-menu icon-button" onClick={() => setMobileNav(true)} aria-label="Open menu"><Menu size={20} /></button><span className="breadcrumb">Workspace</span><ChevronRight size={14} /><span className="breadcrumb-current">{pageLabel(page)}</span></div>
          <div className="topbar-right"><div className="status-pill"><span className="status-dot" />AI interviewer ready</div><button className="help-button" title="Help"><CircleHelp size={18} /></button></div>
        </header>

        {notice && <div className="notice" role="alert"><span>{notice}</span><button onClick={() => setNotice('')} aria-label="Dismiss"><X size={15} /></button></div>}

        {page === 'dashboard' && <Dashboard
          dashboard={dashboard} recent={recentHistory} loading={loadingDashboard} onStart={() => setPage('prepare')}
          onOpen={openReport} onHistory={() => setPage('history')}
        />}
        {page === 'prepare' && <Prepare
          selectedRole={selectedRole} setSelectedRole={setSelectedRole} jobDescription={jobDescription} setJobDescription={setJobDescription}
          resumeFile={resumeFile} setFile={setFile} fileInput={fileInput} dragOver={dragOver} setDragOver={setDragOver}
          busy={busy} onSubmit={beginInterview} onBack={() => setPage('dashboard')}
        />}
        {page === 'interview' && interview && <Interview
          interview={interview} currentQuestion={currentQuestion} evaluation={evaluation} answer={answer} setAnswer={setAnswer}
          busy={busy} timerLabel={timerLabel} progress={progress} answeredCount={answeredCount} questionCount={questionCount}
          answerInput={answerInput} onSubmit={submitAnswer} onBack={() => setPage('dashboard')}
        />}
        {page === 'results' && interview && <Results interview={interview} report={finalReport} reportError={reportError} busy={busy} onRetry={retryReport} onNew={startNew} />}
        {page === 'history' && <HistoryPage history={history} onOpen={openReport} busy={busy} onNew={startNew} />}
      </main>
    </div>
  );
}

function AuthPage({ onAuthenticated }) {
  const [mode, setMode] = useState('login');
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const isRegister = mode === 'register';
  const submit = async (event) => {
    event.preventDefault();
    setBusy(true);
    setError('');
    try {
      const result = await api(`/auth/${mode}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email, password }),
      });
      localStorage.setItem('intervue_token', result.token);
      await onAuthenticated(result.user);
    } catch (requestError) {
      setError(requestError.message);
    } finally {
      setBusy(false);
    }
  };
  return <main className="auth-screen"><div className="auth-brand"><div className="brand-mark"><MessageSquareText size={19}/></div><div className="brand-name">intervue<span>.</span><small>AI INTERVIEW STUDIO</small></div></div><section className="auth-card"><div className="auth-art"><div className="auth-art-spark">✳</div><div className="auth-art-center"><Mic2 size={25}/></div><span>YOUR NEXT BIG MOMENT STARTS HERE</span></div><div className="auth-copy"><div className="eyebrow"><span className="eyebrow-line"/>A LITTLE PRACTICE GOES A LONG WAY</div><h1>{isRegister ? 'Make room to grow.' : 'Welcome to your next practice.'}</h1><p>{isRegister ? 'Create a private workspace for your interview practice and feedback.' : 'Sign in to pick up your interview practice right where you left it.'}</p><form onSubmit={submit} className="auth-form"><label htmlFor="auth-email">EMAIL ADDRESS</label><input id="auth-email" type="email" autoComplete="email" value={email} onChange={(event) => setEmail(event.target.value)} placeholder="you@example.com" required/><label htmlFor="auth-password">PASSWORD</label><input id="auth-password" type="password" autoComplete={isRegister ? 'new-password' : 'current-password'} value={password} onChange={(event) => setPassword(event.target.value)} placeholder={isRegister ? 'At least 10 characters' : 'Your password'} minLength={isRegister ? 10 : undefined} maxLength="128" required/>{error && <div className="auth-error" role="alert">{error}</div>}<button className="button-primary full-width" type="submit" disabled={busy}>{busy ? <><LoaderCircle size={16} className="spin"/> One moment…</> : <>{isRegister ? 'Create my workspace' : 'Sign in'} <ArrowRight size={15}/></>}</button></form><div className="auth-switch">{isRegister ? 'Already have an account?' : 'New to Intervue?'} <button onClick={() => { setMode(isRegister ? 'login' : 'register'); setError(''); }}>{isRegister ? 'Sign in' : 'Create an account'}</button></div><div className="auth-privacy"><CheckCircle2 size={14}/> Your interview history is private to your account.</div></div></section><div className="auth-footer">A little better every time <span>✳</span></div></main>;
}

function pageLabel(page) {
  return ({ dashboard: 'Overview', prepare: 'New interview', interview: 'Live interview', results: 'Interview report', history: 'Interview history' })[page] || 'Overview';
}

function Dashboard({ dashboard, recent, loading, onStart, onOpen, onHistory }) {
  return <div className="content-wrap dashboard-view">
    <div className="page-heading-row">
      <div><div className="eyebrow"><span className="eyebrow-line" />{new Intl.DateTimeFormat('en', { weekday: 'long', month: 'long', day: 'numeric' }).format(new Date()).toUpperCase()}</div><h1>Welcome back <span className="wave">✳</span></h1><p className="page-subtitle">Your next opportunity is one great interview away.</p></div>
      <button className="button-primary" onClick={onStart}><Plus size={17} />Start a new interview</button>
    </div>

    <div className="welcome-banner">
      <div className="banner-copy"><div className="banner-kicker"><Sparkles size={14} /> YOUR PERSONAL INTERVIEW COACH</div><h2>Show them what<br />you’re made of.</h2><p>Practice real conversations. Get feedback that actually helps.</p><button className="banner-button" onClick={onStart}>Prepare for an interview <ArrowRight size={15} /></button></div>
      <div className="banner-art" aria-hidden="true"><div className="art-orbit orbit-one" /><div className="art-orbit orbit-two" /><div className="art-spark spark-a">✳</div><div className="art-spark spark-b">✦</div><div className="art-card card-back"><span className="mini-pill">AI INSIGHT</span><div className="mini-bars"><i /><i /><i /></div><span className="mini-score">+24%</span></div><div className="art-card card-front"><div className="art-avatar"><Mic2 size={21} /></div><span className="art-sound"><i /><i /><i /><i /><i /><i /><i /></span><span className="art-live">LIVE SESSION</span></div></div>
      <div className="banner-index">01 <span>/</span> 03</div>
    </div>

    <div className="section-row stat-section-heading"><div><h2 className="section-title">Your progress</h2><p className="section-caption">A little better every time.</p></div><button className="text-button" onClick={onHistory}>View insights <ArrowRight size={14} /></button></div>
    <div className="stat-grid">
      <StatCard icon={<MessageSquareText size={17} />} iconClass="stat-blue" label="Interviews completed" value={loading ? '—' : dashboard?.completedInterviews ?? 0} foot={`${dashboard?.totalInterviews ?? 0} total sessions`} trend="up" />
      <StatCard icon={<Target size={17} />} iconClass="stat-violet" label="Average overall score" value={loading ? '—' : `${dashboard?.averageOverall ?? 0}%`} foot="Across completed interviews" trend="up" />
      <StatCard icon={<Sparkles size={17} />} iconClass="stat-mint" label="Technical confidence" value={loading ? '—' : `${dashboard?.averageTechnical ?? 0}%`} foot="Your strongest signal" trend="flat" />
      <StatCard icon={<Clock3 size={17} />} iconClass="stat-peach" label="Skills assessed" value={dashboard?.skillPerformance?.length ?? 0} foot="Across completed sessions" trend="flat" />
    </div>

    <div className="lower-grid">
      <section className="panel recent-panel"><div className="panel-heading"><div><h2 className="section-title">Recent interviews</h2><p className="section-caption">Pick up where you left off.</p></div><button className="icon-button more-button" aria-label="More options"><MoreHorizontal size={19} /></button></div>
        {!recent?.length ? <EmptyState title="Your story starts here" text="Complete your first practice session to see your progress." action="Start an interview" onAction={onStart} /> : <div className="recent-list">{recent.slice(0, 4).map((item) => <InterviewRow key={item.id} item={item} onOpen={onOpen} />)}</div>}
      </section>
      <section className="panel skills-panel"><div className="panel-heading"><div><h2 className="section-title">Skill snapshot</h2><p className="section-caption">What you’re building.</p></div><button className="icon-button more-button" aria-label="Skill details"><MoreHorizontal size={19} /></button></div>
        {dashboard?.skillPerformance?.length ? <div className="skill-list">{dashboard.skillPerformance.slice(0, 5).map((skill) => <div className="skill-line" key={skill.skill}><div className="skill-meta"><span>{skill.skill}</span><strong>{skill.score}%</strong></div><div className="skill-track"><i style={{ width: `${skill.score}%` }} /></div></div>)}</div> : <div className="skills-empty"><div className="skill-empty-icon"><Lightbulb size={20} /></div><strong>Your skills, at a glance</strong><span>Finish an interview to see where you shine.</span><button className="text-button" onClick={onStart}>Build your first snapshot <ArrowRight size={14} /></button></div>}
        <div className="coach-tip"><div className="tip-icon"><Lightbulb size={16} /></div><p><strong>A note from your coach</strong><span>Specific examples make your answers memorable. Try the STAR method in your next session.</span></p></div>
      </section>
    </div>
    <div className="dashboard-foot"><span>Small steps, serious progress.</span><span>Made for your next big moment <span className="foot-star">✳</span></span></div>
  </div>;
}

function StatCard({ icon, iconClass, label, value, foot, trend }) {
  return <div className="stat-card"><div className={`stat-icon ${iconClass}`}>{icon}</div><span className="stat-label">{label}</span><div className="stat-value">{value}{trend === 'up' && <span className="trend-badge"><ArrowUpRight size={12} /></span>}</div><span className="stat-foot">{foot}</span></div>;
}

function InterviewRow({ item, onOpen }) {
  const done = item.status === 'completed';
  return <button className="interview-row" onClick={() => onOpen(item)}><div className={`interview-role-icon ${roleColor(item.role)}`}><BriefcaseBusiness size={16} /></div><div className="interview-row-main"><strong>{item.role}</strong><span>{formatDate(item.completedAt || item.createdAt)} <i /> {done ? `${item.answers?.length || 0} questions` : 'In progress'}</span></div><div className="row-score">{done ? <><strong>{item.scores?.overall ?? '—'}%</strong><span>OVERALL</span></> : <span className="in-progress-label">Continue</span>}</div><ChevronRight size={16} className="row-chevron" /></button>;
}

function EmptyState({ title, text, action, onAction }) {
  return <div className="empty-state"><div className="empty-icon"><FileText size={20} /></div><strong>{title}</strong><span>{text}</span><button className="text-button" onClick={onAction}>{action} <ArrowRight size={14} /></button></div>;
}

function Prepare({ selectedRole, setSelectedRole, jobDescription, setJobDescription, resumeFile, setFile, fileInput, dragOver, setDragOver, busy, onSubmit, onBack }) {
  const jobLength = jobDescription.length;
  return <div className="content-wrap prepare-view">
    <button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Back to overview</button>
    <div className="prepare-heading"><div><div className="eyebrow"><span className="eyebrow-line" />LET’S GET YOU READY</div><h1>Set yourself up<br />for a <em>great</em> conversation.</h1><p>We’ll tailor every question to the role and experience you bring.</p></div><div className="prepare-step"><span>01</span><i /> <span>02</span><i /> <span>03</span></div></div>
    <form onSubmit={onSubmit} className="prepare-grid">
      <div className="prepare-main">
        <section className="form-section"><div className="form-section-head"><div className="step-number">01</div><div><h2>Choose your target role</h2><p>We’ll focus your interview on what matters most.</p></div></div>
          <div className="role-grid">{ROLES.map((role) => <button type="button" key={role.name} className={`role-option ${selectedRole === role.name ? 'selected' : ''}`} onClick={() => setSelectedRole(role.name)}><span className={`role-symbol ${role.color}`}>{role.icon}</span><span className="role-name">{role.name}</span>{selectedRole === role.name && <span className="role-check"><Check size={12} /></span>}</button>)}</div>
        </section>
        <section className="form-section"><div className="form-section-head"><div className="step-number">02</div><div><h2>Bring your experience</h2><p>Your resume helps us ask the right questions.</p></div><span className="optional-tag">PRIVATE & SECURE</span></div>
          <input ref={fileInput} className="hidden-input" type="file" accept="application/pdf,.pdf" onChange={(event) => setFile(event.target.files?.[0])} />
          <div role="button" tabIndex={0} className={`upload-zone ${dragOver ? 'drag-over' : ''} ${resumeFile ? 'file-added' : ''}`} onClick={() => fileInput.current?.click()} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); fileInput.current?.click(); } }} onDragOver={(event) => { event.preventDefault(); setDragOver(true); }} onDragLeave={() => setDragOver(false)} onDrop={(event) => { event.preventDefault(); setDragOver(false); setFile(event.dataTransfer.files?.[0]); }}>
            <span className="upload-icon">{resumeFile ? <CheckCircle2 size={21} /> : <Upload size={21} />}</span><span className="upload-copy"><strong>{resumeFile ? resumeFile.name : 'Drop your resume here, or browse'}</strong><small>{resumeFile ? `${(resumeFile.size / 1024 / 1024).toFixed(2)} MB · PDF ready to analyze` : 'PDF format · up to 8 MB'}</small></span>{resumeFile ? <button type="button" className="remove-file" aria-label="Remove resume" onClick={(event) => { event.stopPropagation(); setFile(null); if (fileInput.current) fileInput.current.value = ''; }}><X size={16} /></button> : <span className="browse-button">Browse files</span>}
          </div>
        </section>
        <section className="form-section no-border"><div className="form-section-head"><div className="step-number">03</div><div><h2>Paste the job description</h2><p>Give your interviewer a little context on the role.</p></div></div>
          <div className="textarea-wrap"><textarea value={jobDescription} onChange={(event) => setJobDescription(event.target.value)} placeholder="Paste the job description here. Include responsibilities, qualifications, or anything else you’d like to be asked about…" rows="6" maxLength="12000" /><span className="char-count">{jobLength} / 12,000</span></div>
        </section>
      </div>
      <aside className="prepare-aside"><div className="aside-sticky"><div className="aside-heading"><span className="aside-spark"><Sparkles size={16} /></span><span>YOUR SESSION</span></div><h3>A conversation<br />made for you.</h3><p>Five thoughtful questions. Real-time follow-ups. A clear picture of where you stand.</p><div className="session-detail"><span><MessageSquareText size={16} /> Question count</span><strong>5 questions</strong></div><div className="session-detail"><span><Clock3 size={16} /> Approx. time</span><strong>15–20 min</strong></div><div className="session-detail"><span><Target size={16} /> Your focus</span><strong>{selectedRole}</strong></div><div className="aside-divider"/><div className="privacy-note"><span><CheckCircle2 size={15} /></span><p>Your resume is only used to personalize this session. It stays private in your workspace.</p></div><button className="button-primary full-width" disabled={busy} type="submit">{busy ? <><LoaderCircle className="spin" size={17} /> Building your interview…</> : <>Build my interview <ArrowRight size={16} /></>}</button><span className="aside-footnote">Takes about 30 seconds <span>·</span> No pressure, just practice</span></div></aside>
    </form>
  </div>;
}

function Interview({ interview, currentQuestion, evaluation, answer, setAnswer, busy, timerLabel, progress, answeredCount, questionCount, answerInput, onSubmit, onBack }) {
  if (!currentQuestion) return <Results interview={interview} report={null} reportError="Your report is still being prepared." busy={busy} onRetry={() => {}} onNew={onBack} />;
  return <div className="content-wrap live-view">
    <div className="live-top"><button className="back-link" onClick={onBack}><ArrowLeft size={15} /> Leave session</button><div className="live-session-label"><span className="live-pulse"/> LIVE SESSION</div><div className="timer"><Clock3 size={15} /> {timerLabel}</div></div>
    <div className="live-progress"><div><span>QUESTION <strong>{answeredCount + 1}</strong> <i>OF</i> {questionCount}</span><span>{progress}% complete</span></div><div className="progress-track"><i style={{ width: `${progress}%` }}/></div></div>
    <div className="interview-layout"><section className="question-column"><div className="question-overline"><span className={`question-type ${currentQuestion.type === 'follow_up' ? 'follow-type' : ''}`}>{currentQuestion.type === 'follow_up' ? 'FOLLOW-UP' : currentQuestion.type || 'TECHNICAL'}</span><span className="question-skill">{currentQuestion.skill || interview.role}</span></div><h1 className="question-title">{currentQuestion.question}</h1><p className="question-hint">Take a moment to think it through. There’s no rush.</p>
        {evaluation && <div className="evaluation-card"><div className="evaluation-head"><span className="evaluation-check"><Check size={14}/></span><div><strong>Nice work. Here’s what we heard.</strong><span>Feedback on your last answer</span></div><div className="evaluation-scores"><span><b>{evaluation.technicalScore}</b><small>TECH</small></span><i/><span><b>{evaluation.communicationScore}</b><small>CLARITY</small></span></div></div><p className="evaluation-correctness">{evaluation.correctness}</p>{evaluation.strengths?.length > 0 && <div className="feedback-list"><strong>What landed</strong>{evaluation.strengths.slice(0, 2).map((item, index) => <span key={index}><CheckCircle2 size={14}/>{item}</span>)}</div>}{evaluation.missingConcepts?.length > 0 && <div className="feedback-list missing-list"><strong>One thing to explore</strong>{evaluation.missingConcepts.slice(0, 2).map((item, index) => <span key={index}><Lightbulb size={14}/>{item}</span>)}</div>}</div>}
        <form onSubmit={onSubmit} className="answer-form"><label htmlFor="answer">YOUR RESPONSE</label><textarea id="answer" ref={answerInput} value={answer} onChange={(event) => setAnswer(event.target.value)} onKeyDown={(event) => { if ((event.metaKey || event.ctrlKey) && event.key === 'Enter') { event.preventDefault(); event.currentTarget.form?.requestSubmit(); } }} placeholder="Talk us through your thinking…" rows="7" maxLength="12000" disabled={busy}/><div className="answer-controls"><span><span className="key-hint">⌘ ↵</span> to submit</span><button type="submit" disabled={busy || !answer.trim()} className="button-primary">{busy ? <><LoaderCircle className="spin" size={16}/> Evaluating…</> : <>Submit answer <Send size={15}/></>}</button></div></form>
        <div className="reassurance"><Sparkles size={14}/> Your interviewer adapts to your answers, just like a real conversation.</div>
      </section><aside className="interviewer-card"><div className="interviewer-top"><span className="ai-orb"><Sparkles size={18}/></span><div><strong>Your interviewer</strong><span>Here to help you shine</span></div><span className="online-dot"/></div><div className="interviewer-visual"><div className="visual-ring ring-large"/><div className="visual-ring ring-small"/><div className="visual-core"><MessageSquareText size={25}/></div><div className="visual-twinkle twinkle-one">✦</div><div className="visual-twinkle twinkle-two">✧</div></div><p>“Think out loud. I’m interested in how you get to the answer, not just the answer itself.”</p><div className="interviewer-signoff"><span>INTERVUE AI</span><span>·</span><span>Technical interviewer</span></div><div className="interviewer-note"><Lightbulb size={15}/><span>There are no trick questions here. This is your space to practice.</span></div></aside></div>
  </div>;
}

function Results({ interview, report, reportError, busy, onRetry, onNew }) {
  const scores = interview.scores || {};
  const evaluations = interview.answers || [];
  return <div className="content-wrap results-view"><div className="results-top"><div className="eyebrow"><span className="eyebrow-line"/>SESSION COMPLETE</div><button className="button-secondary" onClick={() => window.print()}><ArrowDownToLine size={15}/> Save report</button></div><div className="results-hero"><div className="results-copy"><div className="results-confetti">✳</div><h1>You showed up.<br/><em>That’s a big deal.</em></h1><p>Here’s a thoughtful look at how your {interview.role} interview went.</p><span className="results-date"><Clock3 size={14}/> Completed {formatDate(interview.completedAt)}</span></div><div className="score-orb"><div className="score-orb-inner"><span>OVERALL</span><strong>{scores.overall ?? '—'}<small>%</small></strong><i>Interview score</i></div><svg viewBox="0 0 180 180" className="score-ring"><circle cx="90" cy="90" r="78"/><circle cx="90" cy="90" r="78" style={{ strokeDasharray: `${(Number(scores.overall) || 0) * 4.9} 490` }}/></svg></div></div>
    <div className="results-score-grid"><ScoreTile label="Technical accuracy" value={scores.technical} color="violet"/><ScoreTile label="Communication" value={scores.communication} color="mint"/><ScoreTile label="Questions answered" value={evaluations.length} suffix={`/ ${interview.questions?.length || evaluations.length}`} color="peach"/></div>
    {reportError && !report && <div className="report-pending"><div><strong>Your answers are saved.</strong><span>{reportError} You can retry when the AI service is available.</span></div><button className="button-secondary" onClick={onRetry} disabled={busy}>{busy ? <LoaderCircle className="spin" size={15}/> : 'Try again'}</button></div>}
    {report && <div className="report-grid"><section className="panel report-main"><div className="panel-heading"><div><div className="eyebrow"><span className="eyebrow-line"/>YOUR INTERVIEW DEBRIEF</div><h2 className="report-title">The highlights</h2></div><span className="report-spark"><Sparkles size={17}/></span></div><p className="report-summary">{report.summary}</p><div className="report-columns"><div><h3><span className="positive-dot"/>What went well</h3>{(report.strengths || []).map((item, index) => <p className="report-bullet" key={index}><CheckCircle2 size={15}/>{item}</p>)}</div><div><h3><span className="growth-dot"/>Room to grow</h3>{(report.improvementAreas || []).map((item, index) => <p className="report-bullet growth-bullet" key={index}><Lightbulb size={15}/>{item}</p>)}</div></div>{report.skillGaps?.length > 0 && <div className="skill-gap-block"><h3>Skills to strengthen</h3>{report.skillGaps.map((item,index)=><div className="gap-row" key={index}><strong>{item.skill}</strong><span>{item.evidence}</span></div>)}</div>}</section><section className="panel recommendations-panel"><div className="recommendation-icon"><Target size={18}/></div><span className="eyebrow">YOUR NEXT STEPS</span><h2>Keep the momentum.</h2><div className="recommendations-list">{(report.recommendations || []).map((item,index)=><div key={index}><span>{String(index+1).padStart(2,'0')}</span><p>{item}</p></div>)}</div>{report.practiceQuestions?.length > 0 && <div className="practice-block"><h3>Questions to practice next</h3>{report.practiceQuestions.slice(0,3).map((item,index)=><p key={index}><MessageSquareText size={14}/>{item}</p>)}</div>}</section></div>}
    <section className="panel answer-review"><div className="panel-heading"><div><h2 className="section-title">Answer-by-answer</h2><p className="section-caption">Evidence behind your score.</p></div></div>{evaluations.map((item,index)=><details className="answer-review-row" key={`${item.questionId}-${index}`}><summary><span className="answer-index">{String(index+1).padStart(2,'0')}</span><span className="answer-question">{item.question}</span><span className="answer-score">{item.evaluation?.technicalScore ?? '—'}<small>/100</small></span><ChevronDown size={16}/></summary><div className="answer-detail"><p><strong>Your answer</strong>{item.answer}</p><p><strong>What to include</strong>{item.evaluation?.idealAnswer}</p></div></details>)}</section>
    <div className="results-bottom"><span>Every interview is a step forward.</span><button className="button-primary" onClick={onNew}><Plus size={16}/> Practice again</button></div>
  </div>;
}

function ScoreTile({ label, value, suffix = '%', color }) {
  return <div className={`score-tile ${color}`}><div className="score-tile-icon"><Target size={16}/></div><span>{label}</span><strong>{value ?? '—'}<small>{value === undefined ? '' : suffix}</small></strong><div className="score-tile-track"><i style={{ width: `${Math.min(100, Number(value) || 0)}%` }}/></div></div>;
}

function HistoryPage({ history, onOpen, busy, onNew }) {
  return <div className="content-wrap history-view"><div className="page-heading-row"><div><div className="eyebrow"><span className="eyebrow-line"/>YOUR PRACTICE JOURNEY</div><h1>Interview history</h1><p className="page-subtitle">Every conversation is progress worth keeping.</p></div><button className="button-primary" onClick={onNew}><Plus size={16}/>New interview</button></div><section className="panel history-panel"><div className="history-table-head"><span>ROLE & SESSION</span><span>DATE</span><span>STATUS</span><span>SCORE</span><span/></div>{!history.length ? <EmptyState title="No sessions yet" text="Your completed interviews and reports will live here." action="Start your first interview" onAction={onNew}/> : history.map((item)=><button className="history-table-row" key={item.id} onClick={() => onOpen(item)} disabled={busy}><div className="history-role-cell"><span className={`interview-role-icon ${roleColor(item.role)}`}><BriefcaseBusiness size={16}/></span><span><strong>{item.role}</strong><small>{item.answers?.length || 0} answers · {item.questions?.length || 0} questions</small></span></div><span className="history-date">{formatDate(item.completedAt || item.createdAt)}</span><span><i className={`status-tag ${item.status === 'completed' ? 'completed-tag' : 'progress-tag'}`}>{item.status === 'completed' ? 'Completed' : 'In progress'}</i></span><strong className="history-score">{item.status === 'completed' ? `${item.scores?.overall ?? '—'}%` : '—'}</strong><ChevronRight size={16} className="row-chevron"/></button>)}</section><p className="history-note"><CheckCircle2 size={14}/> Your sessions are stored privately in this workspace.</p></div>;
}

function roleColor(role = '') {
  if (/machine|data/i.test(role)) return 'role-lavender';
  if (/python/i.test(role)) return 'role-blue';
  if (/full/i.test(role)) return 'role-peach';
  return 'role-mint';
}

export default App;
