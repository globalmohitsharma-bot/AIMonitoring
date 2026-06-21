import { useState, useEffect, useMemo, useCallback } from 'react';
import './PBDashboard.css';

const CSV_URL  = 'https://docs.google.com/spreadsheets/d/e/2PACX-1vSRHqp1TWLyAEgydJ19b6vCJcTGCCxGrLcB1Mccw95xndfc9mbC1y5y3ev5T1njzE0evlvGIHA6OGH1/pub?gid=1417050744&single=true&output=csv';
const API_BASE = import.meta.env.DEV ? 'http://localhost:5165' : '';
const LS_KEY   = 'pb_script_url';

// Fields that get a combo-dropdown (type-or-pick from existing values)
const COMBO_FIELDS = ['society', 'progress', 'type of paint', 'paint type'];
// Fields that get a date picker
const DATE_FIELDS  = ['date'];

// ── CSV parser ────────────────────────────────────────────────────
function parseCSV(text) {
  const lines = [];
  let cur = '', inQ = false;
  const cells = [];
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (c === '"') {
      if (inQ && text[i + 1] === '"') { cur += '"'; i++; }
      else inQ = !inQ;
    } else if (c === ',' && !inQ) {
      cells.push(cur); cur = '';
    } else if ((c === '\n' || c === '\r') && !inQ) {
      if (c === '\r' && text[i + 1] === '\n') i++;
      cells.push(cur); cur = '';
      lines.push([...cells]); cells.length = 0;
    } else { cur += c; }
  }
  if (cur || cells.length) { cells.push(cur); lines.push([...cells]); }
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.trim());
  const rows = lines.slice(1)
    .filter(r => r.some(c => c.trim()))
    .map((r, i) => {
      const obj = { __row: i + 2 };
      headers.forEach((h, j) => { obj[h] = (r[j] ?? '').trim(); });
      return obj;
    });
  return { headers, rows };
}

// ── Progress colour ───────────────────────────────────────────────
function progressClass(val = '') {
  const v = val.toLowerCase();
  if (v.includes('compl')) return 'badge-green';
  if (v.includes('cancel')) return 'badge-red';
  if (v.includes('not st') || v.includes('not s')) return 'badge-gray';
  if (v.includes('progress') || v.includes('ongoing')) return 'badge-blue';
  return 'badge-orange';
}

// ── Apps Script write ─────────────────────────────────────────────
async function callScript(url, payload) {
  await fetch(url, {
    method: 'POST', mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Combo field (select existing OR type new) ─────────────────────
function ComboField({ fieldName, value, onChange, options }) {
  const id = `combo-${fieldName.replace(/\s+/g, '-')}`;
  return (
    <div className="pb-combo-wrap">
      <input
        className="pb-edit-input"
        list={id}
        value={value}
        onChange={e => onChange(e.target.value)}
        placeholder={`Select or type…`}
        autoComplete="off"
      />
      <datalist id={id}>
        {options.map(v => <option key={v} value={v} />)}
      </datalist>
      <span className="pb-combo-arrow">▾</span>
    </div>
  );
}

function isComboField(header) {
  return COMBO_FIELDS.some(k => header.toLowerCase().includes(k));
}
function isDateField(header) {
  return DATE_FIELDS.some(k => header.toLowerCase().includes(k));
}

// Sheet stores dates as YYYY-MM-DD; input[type=date] uses the same format
function toInputDate(val) {
  if (!val) return '';
  // Handle DD-MM-YYYY or D/M/YYYY → YYYY-MM-DD
  const dmY = val.match(/^(\d{1,2})[\/\-](\d{1,2})[\/\-](\d{4})$/);
  if (dmY) return `${dmY[3]}-${dmY[2].padStart(2,'0')}-${dmY[1].padStart(2,'0')}`;
  // Already YYYY-MM-DD
  if (/^\d{4}-\d{2}-\d{2}/.test(val)) return val.slice(0,10);
  return '';
}
function fromInputDate(val) { return val; } // keep YYYY-MM-DD as-is for sheet

// ── Shared form field renderer ────────────────────────────────────
function FormField({ header, value, onChange, rows }) {
  const uniq = (col) => [...new Set(rows.map(r => r[col]).filter(Boolean))].sort();

  if (isDateField(header)) {
    return (
      <input
        type="date"
        className="pb-edit-input pb-date-input"
        value={toInputDate(value)}
        onChange={e => onChange(fromInputDate(e.target.value))}
      />
    );
  }
  if (isComboField(header)) {
    return (
      <ComboField
        fieldName={header}
        value={value}
        onChange={onChange}
        options={uniq(header)}
      />
    );
  }
  return (
    <input
      className="pb-edit-input"
      value={value}
      onChange={e => onChange(e.target.value)}
    />
  );
}

// ── Setup sheet ───────────────────────────────────────────────────
function SetupSheet({ onSave }) {
  const [url, setUrl] = useState('');
  const SCRIPT =
`function doPost(e){
  var sheet=SpreadsheetApp
    .openById('1e729W4MXvlGXGLpmIrQugkCuCIVWWm9QqJtxONxFGo8')
    .getSheets().filter(function(s){return s.getSheetId()==1417050744;})[0];
  var d=JSON.parse(e.postData.contents);
  if(d.action==='append') sheet.appendRow(d.values);
  else if(d.action==='update')
    sheet.getRange(d.rowIndex,1,1,d.values.length).setValues([d.values]);
  else if(d.action==='delete') sheet.deleteRow(d.rowIndex);
  return ContentService.createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}`;

  return (
    <div className="pb-sheet-overlay" onClick={() => onSave(null)}>
      <div className="pb-bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="pb-sheet-handle" />
        <h2 className="pb-sheet-title">⚙️ Enable Adding / Editing</h2>
        <p className="pb-setup-sub">Paste this Apps Script into your sheet to enable writes:</p>
        <ol className="pb-steps">
          <li>Google Sheet → <b>Extensions → Apps Script</b></li>
          <li>Replace all code with the script below</li>
          <li><b>Deploy → New deployment → Web app</b></li>
          <li>Execute as: <b>Me</b> · Access: <b>Anyone</b></li>
          <li>Copy the URL and paste it here</li>
        </ol>
        <pre className="pb-script">{SCRIPT}</pre>
        <input className="pb-url-input" placeholder="Paste Web App URL…"
          value={url} onChange={e => setUrl(e.target.value)} />
        <div className="pb-sheet-actions">
          <button className="pb-btn pb-ghost" onClick={() => onSave(null)}>Skip (read-only)</button>
          <button className="pb-btn pb-primary" disabled={!url.trim()}
            onClick={() => { localStorage.setItem(LS_KEY, url.trim()); onSave(url.trim()); }}>
            Save
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Filter sheet ──────────────────────────────────────────────────
function FilterSheet({ headers, rows, filters, onApply, onClose }) {
  const [local, setLocal] = useState({ ...filters });
  const uniq = (col) => [...new Set(rows.map(r => r[col]).filter(Boolean))].sort();
  return (
    <div className="pb-sheet-overlay" onClick={onClose}>
      <div className="pb-bottom-sheet" onClick={e => e.stopPropagation()}>
        <div className="pb-sheet-handle" />
        <h2 className="pb-sheet-title">🔽 Filter</h2>
        <div className="pb-filter-list">
          {headers.filter(h => h && h !== '#').map(h => (
            <div key={h} className="pb-filter-item">
              <label className="pb-filter-label">{h}</label>
              <select className="pb-filter-select"
                value={local[h] ?? ''}
                onChange={e => setLocal(f => ({ ...f, [h]: e.target.value }))}>
                <option value="">All</option>
                {uniq(h).map(v => <option key={v} value={v}>{v}</option>)}
              </select>
            </div>
          ))}
        </div>
        <div className="pb-sheet-actions">
          <button className="pb-btn pb-ghost"
            onClick={() => { setLocal({}); onApply({}); onClose(); }}>Clear all</button>
          <button className="pb-btn pb-primary"
            onClick={() => { onApply(local); onClose(); }}>Apply</button>
        </div>
      </div>
    </div>
  );
}

// ── Detail / Edit sheet ───────────────────────────────────────────
function DetailSheet({ row, headers, rows, onClose, onSave, onDelete, saving, scriptUrl }) {
  const [editing, setEditing] = useState(false);
  const [form, setForm]       = useState(() => {
    const f = {};
    headers.forEach(h => { f[h] = row[h] ?? ''; });
    return f;
  });
  const phone = row['Phone'] || row['phone'] || '';
  const name  = row['Contact Name'] || row['Name'] || row['name'] || Object.values(row).find(v => v && v !== row.__row) || '';

  return (
    <div className="pb-sheet-overlay" onClick={onClose}>
      <div className="pb-bottom-sheet pb-detail-sheet" onClick={e => e.stopPropagation()}>
        <div className="pb-sheet-handle" />
        <div className="pb-detail-header">
          <div>
            <div className="pb-detail-name">{name}</div>
            {phone && <a className="pb-detail-phone" href={`tel:${phone}`}>📞 {phone}</a>}
          </div>
          <div className="pb-detail-header-btns">
            {scriptUrl && !editing && (
              <button className="pb-icon-action" onClick={() => setEditing(true)}>✏️</button>
            )}
            {scriptUrl && !editing && (
              <button className="pb-icon-action pb-icon-del" onClick={onDelete}>🗑️</button>
            )}
            <button className="pb-icon-action" onClick={onClose}>✕</button>
          </div>
        </div>

        {!editing ? (
          <div className="pb-detail-fields">
            {headers.filter(h => h && h !== '#').map(h => row[h] ? (
              <div key={h} className="pb-detail-row">
                <span className="pb-detail-key">{h}</span>
                <span className={`pb-detail-val ${h.toLowerCase().includes('progress') ? progressClass(row[h]) + ' badge' : ''}`}>
                  {row[h]}
                </span>
              </div>
            ) : null)}
          </div>
        ) : (
          <div className="pb-edit-fields">
            {headers.filter(h => h && h !== '#').map(h => (
              <div key={h} className="pb-edit-field">
                <label className="pb-edit-label">
                  {h}
                  {isComboField(h) && <span className="pb-combo-hint"> — select or type new</span>}
                </label>
                <FormField header={h} value={form[h]} rows={rows}
                  onChange={val => setForm(f => ({ ...f, [h]: val }))} />
              </div>
            ))}
          </div>
        )}

        {editing && (
          <div className="pb-sheet-actions">
            <button className="pb-btn pb-ghost" onClick={() => setEditing(false)}>Cancel</button>
            <button className="pb-btn pb-primary" disabled={saving}
              onClick={() => onSave(form)}>
              {saving ? 'Saving…' : 'Save Changes'}
            </button>
          </div>
        )}
      </div>
    </div>
  );
}

// ── Add sheet ─────────────────────────────────────────────────────
function AddSheet({ headers, rows, onClose, onSave, saving }) {
  const [form, setForm] = useState(() => {
    const f = {};
    headers.filter(h => h && h !== '#').forEach(h => { f[h] = ''; });
    return f;
  });

  return (
    <div className="pb-sheet-overlay" onClick={onClose}>
      <div className="pb-bottom-sheet pb-detail-sheet" onClick={e => e.stopPropagation()}>
        <div className="pb-sheet-handle" />
        <h2 className="pb-sheet-title">➕ Add New Record</h2>
        <div className="pb-edit-fields">
          {headers.filter(h => h && h !== '#').map(h => (
            <div key={h} className="pb-edit-field">
              <label className="pb-edit-label">
                {h}
                {isComboField(h) && <span className="pb-combo-hint"> — select or type new</span>}
              </label>
              <FormField header={h} value={form[h]} rows={rows}
                onChange={val => setForm(f => ({ ...f, [h]: val }))} />
            </div>
          ))}
        </div>
        <div className="pb-sheet-actions">
          <button className="pb-btn pb-ghost" onClick={onClose}>Cancel</button>
          <button className="pb-btn pb-primary" disabled={saving}
            onClick={() => onSave(form)}>
            {saving ? 'Adding…' : 'Add Record'}
          </button>
        </div>
      </div>
    </div>
  );
}



// ── Card ──────────────────────────────────────────────────────────
function RecordCard({ row, headers, onClick }) {
  const name     = row['Contact Name'] || row['Name'] || row['name'] || '—';
  const phone    = row['Phone'] || row['phone'] || '';
  const address  = row['Address'] || row['address'] || '';
  const progress = row['Progress'] || row['progress'] || '';
  const paint    = row['Type of Paint'] || row['Type of paint'] || '';
  const date     = row['Date Contacted'] || row['Date Started'] || '';
  const remarks  = row['Remarks'] || row['remarks'] || '';

  return (
    <div className="pb-card" onClick={onClick}>
      <div className="pb-card-top">
        <div className="pb-card-name">{name}</div>
        {progress && <span className={`pb-badge ${progressClass(progress)}`}>{progress}</span>}
      </div>
      {phone   && <div className="pb-card-row">📞 <span>{phone}</span></div>}
      {address && <div className="pb-card-row pb-card-addr">📍 <span>{address}</span></div>}
      {paint   && <div className="pb-card-row">🎨 <span>{paint}</span></div>}
      {date    && <div className="pb-card-row">📅 <span>{date}</span></div>}
      {remarks && <div className="pb-card-remarks">{remarks}</div>}
    </div>
  );
}

// ── Main ──────────────────────────────────────────────────────────
export default function PBDashboard() {
  const [headers,   setHeaders]   = useState([]);
  const [rows,      setRows]      = useState([]);
  const [loading,   setLoading]   = useState(true);
  const [error,     setError]     = useState(null);
  const [search,    setSearch]    = useState('');
  const [filters,   setFilters]   = useState({});
  const [sheet,     setSheet]     = useState(null); // 'setup'|'filter'|'add'|{row}
  const [scriptUrl, setScriptUrl] = useState(() => localStorage.getItem(LS_KEY) || null);
  const [saving,    setSaving]    = useState(false);
  const [toast,     setToast]     = useState(null);

  const showToast = useCallback((msg, ok = true) => {
    setToast({ msg, ok });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res  = await fetch(`${API_BASE}/api/pb/sheet`);
      const text = await res.text();
      if (!res.ok) throw new Error(text);
      const { headers: h, rows: r } = parseCSV(text);
      setHeaders(h);
      setRows(r);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = useMemo(() => {
    let r = rows;
    const q = search.toLowerCase();
    if (q) r = r.filter(row => headers.some(h => (row[h] ?? '').toLowerCase().includes(q)));
    Object.entries(filters).forEach(([col, val]) => {
      if (val) r = r.filter(row => row[col] === val);
    });
    return r;
  }, [rows, headers, search, filters]);

  const activeFilterCount = Object.values(filters).filter(Boolean).length;

  const requireScript = (fn) => {
    if (!scriptUrl) { setSheet('setup'); return; }
    fn();
  };

  const handleAdd = async (form) => {
    if (!scriptUrl) { setSheet('setup'); return; }
    setSaving(true);
    const values = headers.map(h => form[h] ?? '');
    await callScript(scriptUrl, { action: 'append', values });
    setSaving(false); setSheet(null);
    showToast('Record added — refreshing…');
    setTimeout(fetchData, 1800);
  };

  const handleEdit = async (form) => {
    if (!scriptUrl) { setSheet('setup'); return; }
    setSaving(true);
    const values = headers.map(h => form[h] ?? '');
    await callScript(scriptUrl, { action: 'update', rowIndex: sheet.row.__row, values });
    setSaving(false); setSheet(null);
    showToast('Record updated — refreshing…');
    setTimeout(fetchData, 1800);
  };

  const handleDelete = async () => {
    if (!scriptUrl) { setSheet('setup'); return; }
    if (!window.confirm('Delete this record?')) return;
    setSaving(true);
    await callScript(scriptUrl, { action: 'delete', rowIndex: sheet.row.__row });
    setSaving(false); setSheet(null);
    showToast('Deleted — refreshing…');
    setTimeout(fetchData, 1800);
  };

  return (
    <div className="pb-root">

      {/* ── Header ──────────────────────────────── */}
      <header className="pb-header">
        <div className="pb-header-top">
          <div className="pb-header-brand">
            <span className="pb-logo-icon">📊</span>
            <span className="pb-brand-name">CRM Board</span>
            {!loading && <span className="pb-count">{filtered.length}</span>}
          </div>
          <div className="pb-header-actions">
            <button className="pb-icon-btn" onClick={fetchData} title="Refresh">↻</button>
            <button className="pb-icon-btn" onClick={() => setSheet('setup')} title="Settings">⚙</button>
          </div>
        </div>
        <div className="pb-search-row">
          <div className="pb-search-wrap">
            <span className="pb-search-icon">🔍</span>
            <input className="pb-search" placeholder="Search name, phone, address…"
              value={search} onChange={e => setSearch(e.target.value)} />
            {search && <button className="pb-search-clear" onClick={() => setSearch('')}>✕</button>}
          </div>
          <button
            className={`pb-filter-btn ${activeFilterCount ? 'pb-filter-active' : ''}`}
            onClick={() => setSheet('filter')}>
            🔽 {activeFilterCount > 0 ? `Filter (${activeFilterCount})` : 'Filter'}
          </button>
        </div>
        {activeFilterCount > 0 && (
          <div className="pb-active-filters">
            {Object.entries(filters).filter(([,v]) => v).map(([k, v]) => (
              <span key={k} className="pb-chip">
                {k}: {v}
                <button onClick={() => setFilters(f => { const n = {...f}; delete n[k]; return n; })}>✕</button>
              </span>
            ))}
            <button className="pb-chip-clear" onClick={() => setFilters({})}>Clear all</button>
          </div>
        )}
      </header>

      {/* ── Content ──────────────────────────────── */}
      <main className="pb-main">
        {loading && (
          <div className="pb-loading">
            <div className="pb-spinner-ring" />
            <span>Loading…</span>
          </div>
        )}
        {error && (
          <div className="pb-err-card">
            <div className="pb-err-title">⚠️ Cannot load data</div>
            <div className="pb-err-msg">{error}</div>
          </div>
        )}
        {!loading && !error && filtered.length === 0 && (
          <div className="pb-empty">
            <div style={{fontSize:'2.5rem'}}>🔍</div>
            <div>No records match your search</div>
          </div>
        )}
        {!loading && !error && filtered.map(row => (
          <RecordCard key={row.__row} row={row} headers={headers}
            onClick={() => setSheet({ type: 'detail', row })} />
        ))}
      </main>

      {/* ── FAB ──────────────────────────────────── */}
      <button className="pb-fab" onClick={() => setSheet('add')} title="Add record">
        +
      </button>

      {/* ── Toast ────────────────────────────────── */}
      {toast && <div className={`pb-toast ${toast.ok ? 'toast-ok' : 'toast-err'}`}>{toast.msg}</div>}

      {/* ── Bottom sheets ────────────────────────── */}
      {sheet === 'setup' && (
        <SetupSheet onSave={(url) => { setScriptUrl(url); setSheet(null); }} />
      )}
      {sheet === 'filter' && (
        <FilterSheet headers={headers} rows={rows} filters={filters}
          onApply={setFilters} onClose={() => setSheet(null)} />
      )}
      {sheet === 'add' && (
        <AddSheet headers={headers} rows={rows} saving={saving}
          onClose={() => setSheet(null)} onSave={handleAdd} />
      )}
      {sheet?.type === 'detail' && (
        <DetailSheet row={sheet.row} headers={headers} rows={rows} saving={saving}
          scriptUrl={scriptUrl}
          onClose={() => setSheet(null)}
          onSave={handleEdit}
          onDelete={handleDelete} />
      )}
    </div>
  );
}
