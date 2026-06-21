import { useState, useEffect, useMemo, useCallback, useRef } from 'react';
import './PBDashboard.css';

const SHEET_ID  = '1e729W4MXvlGXGLpmIrQugkCuCIVWWm9QqJtxONxFGo8';
const GID       = '1417050744';
const API_BASE  = import.meta.env.DEV ? 'http://localhost:5165' : '';
const CSV_URL   = `${API_BASE}/api/pb/sheet`;
const LS_KEY    = 'pb_script_url';
const PAGE_SIZE = 30;

// ── CSV parser ───────────────────────────────────────────────────
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
    } else {
      cur += c;
    }
  }
  if (cur || cells.length) { cells.push(cur); lines.push([...cells]); }
  if (!lines.length) return { headers: [], rows: [] };
  const headers = lines[0].map(h => h.trim());
  const rows = lines.slice(1)
    .filter(r => r.some(c => c.trim()))
    .map((r, i) => {
      const obj = { __row: i + 2 };       // sheet row index (1=header)
      headers.forEach((h, j) => { obj[h] = (r[j] ?? '').trim(); });
      return obj;
    });
  return { headers, rows };
}

// ── Apps Script caller ───────────────────────────────────────────
async function callScript(scriptUrl, payload) {
  await fetch(scriptUrl, {
    method: 'POST',
    mode: 'no-cors',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  });
}

// ── Setup instructions modal ─────────────────────────────────────
function SetupModal({ onSave }) {
  const [url, setUrl] = useState('');
  const SCRIPT = `function doPost(e) {
  var ss    = SpreadsheetApp.openById('${SHEET_ID}');
  var sheet = ss.getSheets().filter(function(s){
    return s.getSheetId() == ${GID};
  })[0];
  var data  = JSON.parse(e.postData.contents);
  if (data.action === 'append') {
    sheet.appendRow(data.values);
  } else if (data.action === 'update') {
    sheet.getRange(data.rowIndex, 1, 1, data.values.length)
         .setValues([data.values]);
  } else if (data.action === 'delete') {
    sheet.deleteRow(data.rowIndex);
  }
  return ContentService
    .createTextOutput(JSON.stringify({ok:true}))
    .setMimeType(ContentService.MimeType.JSON);
}`;

  return (
    <div className="pb-modal-backdrop">
      <div className="pb-modal pb-setup">
        <h2 className="pb-modal-title">⚙️ One-time Setup for Writing</h2>
        <p className="pb-setup-sub">Reading data works automatically. To <b>add / edit / delete</b> rows, paste this script into your Google Sheet:</p>
        <ol className="pb-steps">
          <li>Open your Google Sheet → <b>Extensions → Apps Script</b></li>
          <li>Delete the default code and paste the script below</li>
          <li>Click <b>Deploy → New deployment → Web app</b></li>
          <li>Set <i>Execute as: Me</i> and <i>Who has access: Anyone</i></li>
          <li>Click <b>Deploy</b>, copy the Web App URL and paste it here</li>
        </ol>
        <pre className="pb-script">{SCRIPT}</pre>
        <input
          className="pb-url-input"
          placeholder="Paste Web App URL here…"
          value={url}
          onChange={e => setUrl(e.target.value)}
        />
        <div className="pb-setup-actions">
          <button className="pb-btn pb-btn-ghost" onClick={() => onSave(null)}>Skip (read-only)</button>
          <button className="pb-btn pb-btn-primary" disabled={!url.trim()}
            onClick={() => { localStorage.setItem(LS_KEY, url.trim()); onSave(url.trim()); }}>
            Save URL
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Add / Edit modal ─────────────────────────────────────────────
function RowModal({ headers, row, onSave, onClose, saving }) {
  const isEdit = !!row;
  const [form, setForm] = useState(() => {
    const f = {};
    headers.forEach(h => { f[h] = row ? (row[h] ?? '') : ''; });
    return f;
  });

  return (
    <div className="pb-modal-backdrop" onClick={onClose}>
      <div className="pb-modal" onClick={e => e.stopPropagation()}>
        <div className="pb-modal-header">
          <h2 className="pb-modal-title">{isEdit ? '✏️ Edit Row' : '➕ Add Row'}</h2>
          <button className="pb-modal-close" onClick={onClose}>✕</button>
        </div>
        <div className="pb-modal-body">
          {headers.map(h => (
            <div key={h} className="pb-field">
              <label className="pb-field-label">{h}</label>
              <input
                className="pb-field-input"
                value={form[h]}
                onChange={e => setForm(f => ({ ...f, [h]: e.target.value }))}
              />
            </div>
          ))}
        </div>
        <div className="pb-modal-footer">
          <button className="pb-btn pb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pb-btn pb-btn-primary" disabled={saving}
            onClick={() => onSave(form)}>
            {saving ? 'Saving…' : (isEdit ? 'Update' : 'Add Row')}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Delete confirm ───────────────────────────────────────────────
function DeleteModal({ onConfirm, onClose, saving }) {
  return (
    <div className="pb-modal-backdrop" onClick={onClose}>
      <div className="pb-modal pb-modal-sm" onClick={e => e.stopPropagation()}>
        <div className="pb-modal-header">
          <h2 className="pb-modal-title">🗑️ Delete Row</h2>
          <button className="pb-modal-close" onClick={onClose}>✕</button>
        </div>
        <p style={{ padding: '0 0 16px', color: '#94a3b8', fontSize: '0.9rem' }}>
          This will permanently delete the row from the sheet.
        </p>
        <div className="pb-modal-footer">
          <button className="pb-btn pb-btn-ghost" onClick={onClose}>Cancel</button>
          <button className="pb-btn pb-btn-danger" disabled={saving} onClick={onConfirm}>
            {saving ? 'Deleting…' : 'Delete'}
          </button>
        </div>
      </div>
    </div>
  );
}

// ── Main dashboard ───────────────────────────────────────────────
export default function PBDashboard() {
  const [headers,    setHeaders]    = useState([]);
  const [rows,       setRows]       = useState([]);
  const [loading,    setLoading]    = useState(true);
  const [error,      setError]      = useState(null);
  const [search,     setSearch]     = useState('');
  const [colFilters, setColFilters] = useState({});
  const [sortCol,    setSortCol]    = useState(null);
  const [sortDir,    setSortDir]    = useState('asc');
  const [page,       setPage]       = useState(1);
  const [scriptUrl,  setScriptUrl]  = useState(() => localStorage.getItem(LS_KEY) || null);
  const [showSetup,  setShowSetup]  = useState(false);
  const [modal,      setModal]      = useState(null); // null | {type:'add'} | {type:'edit',row} | {type:'delete',row}
  const [saving,     setSaving]     = useState(false);
  const [toast,      setToast]      = useState(null);

  const showToast = useCallback((msg, kind = 'ok') => {
    setToast({ msg, kind });
    setTimeout(() => setToast(null), 3000);
  }, []);

  const fetchData = useCallback(async () => {
    setLoading(true); setError(null);
    try {
      const res = await fetch(CSV_URL);
      const text = await res.text();
      if (!res.ok) throw new Error(text || `HTTP ${res.status}`);
      const { headers: h, rows: r } = parseCSV(text);
      setHeaders(h);
      setRows(r);
    } catch (e) {
      setError(e.message);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  // filtered + sorted rows
  const filtered = useMemo(() => {
    let r = rows;
    const q = search.toLowerCase();
    if (q) r = r.filter(row => headers.some(h => (row[h] ?? '').toLowerCase().includes(q)));
    headers.forEach(h => {
      const v = colFilters[h];
      if (v) r = r.filter(row => row[h] === v);
    });
    if (sortCol) {
      r = [...r].sort((a, b) => {
        const av = (a[sortCol] ?? '').toLowerCase();
        const bv = (b[sortCol] ?? '').toLowerCase();
        return sortDir === 'asc' ? av.localeCompare(bv) : bv.localeCompare(av);
      });
    }
    return r;
  }, [rows, headers, search, colFilters, sortCol, sortDir]);

  const totalPages = Math.max(1, Math.ceil(filtered.length / PAGE_SIZE));
  const pageRows   = filtered.slice((page - 1) * PAGE_SIZE, page * PAGE_SIZE);

  const toggleSort = (col) => {
    if (sortCol === col) setSortDir(d => d === 'asc' ? 'desc' : 'asc');
    else { setSortCol(col); setSortDir('asc'); }
    setPage(1);
  };

  const uniqueVals = useMemo(() => {
    const map = {};
    headers.forEach(h => {
      map[h] = [...new Set(rows.map(r => r[h]).filter(Boolean))].sort();
    });
    return map;
  }, [rows, headers]);

  // ── write helpers ──────────────────────────────────────────────
  const withScript = (fn) => {
    if (!scriptUrl) { setShowSetup(true); return; }
    fn();
  };

  const handleAdd = async (form) => {
    setSaving(true);
    const values = headers.map(h => form[h] ?? '');
    await callScript(scriptUrl, { action: 'append', values });
    setSaving(false);
    setModal(null);
    showToast('Row added — refreshing…');
    setTimeout(fetchData, 1500);
  };

  const handleEdit = async (form) => {
    setSaving(true);
    const values = headers.map(h => form[h] ?? '');
    await callScript(scriptUrl, { action: 'update', rowIndex: modal.row.__row, values });
    setSaving(false);
    setModal(null);
    showToast('Row updated — refreshing…');
    setTimeout(fetchData, 1500);
  };

  const handleDelete = async () => {
    setSaving(true);
    await callScript(scriptUrl, { action: 'delete', rowIndex: modal.row.__row });
    setSaving(false);
    setModal(null);
    showToast('Row deleted — refreshing…');
    setTimeout(fetchData, 1500);
  };

  const activeFilters = Object.entries(colFilters).filter(([, v]) => v);

  return (
    <div className="pb-root">

      {/* ── Topbar ──────────────────────────────────────── */}
      <header className="pb-topbar">
        <div className="pb-topbar-left">
          <span className="pb-logo">📊</span>
          <h1 className="pb-title">Personal Board</h1>
          <span className="pb-count">{filtered.length} rows</span>
        </div>
        <div className="pb-topbar-right">
          <input
            className="pb-search"
            placeholder="Search all columns…"
            value={search}
            onChange={e => { setSearch(e.target.value); setPage(1); }}
          />
          <button className="pb-icon-btn" title="Refresh" onClick={fetchData}>↻</button>
          <button className="pb-btn pb-btn-primary" onClick={() => withScript(() => setModal({ type: 'add' }))}>
            + Add Row
          </button>
          <button className="pb-icon-btn pb-icon-gear" title="Setup write access"
            onClick={() => setShowSetup(true)}>⚙</button>
        </div>
      </header>

      {/* ── Active filters chips ─────────────────────────── */}
      {activeFilters.length > 0 && (
        <div className="pb-filter-bar">
          {activeFilters.map(([col, val]) => (
            <span key={col} className="pb-filter-chip">
              {col}: <b>{val}</b>
              <button onClick={() => { setColFilters(f => { const n = {...f}; delete n[col]; return n; }); setPage(1); }}>✕</button>
            </span>
          ))}
          <button className="pb-clear-all" onClick={() => { setColFilters({}); setPage(1); }}>Clear all</button>
        </div>
      )}

      {/* ── Status line ────────────────────────────────────── */}
      {!scriptUrl && !loading && !error && (
        <div className="pb-info-bar">
          📖 Read-only mode — <button className="pb-link" onClick={() => setShowSetup(true)}>set up write access</button> to add/edit/delete rows.
        </div>
      )}

      {/* ── Table ──────────────────────────────────────────── */}
      <div className="pb-table-wrap">
        {loading && <div className="pb-spinner">Loading sheet data…</div>}
        {error   && (
          <div className="pb-error-box">
            <div className="pb-error-title">⚠ Cannot load sheet</div>
            <div className="pb-error-msg">{error}</div>
            <ol className="pb-error-steps">
              <li>In your Google Sheet → <b>File → Share → Publish to the web</b></li>
              <li>First dropdown: select the <b>PB</b> tab</li>
              <li>Second dropdown: select <b>Comma-separated values (.csv)</b></li>
              <li>Click <b>Publish</b> → confirm → then click ↻ refresh above</li>
            </ol>
          </div>
        )}
        {!loading && !error && (
          <table className="pb-table">
            <thead>
              <tr>
                {headers.map(h => (
                  <th key={h}>
                    <div className="pb-th-inner">
                      <span className="pb-th-label" onClick={() => toggleSort(h)}>
                        {h}
                        {sortCol === h ? (sortDir === 'asc' ? ' ▲' : ' ▼') : ''}
                      </span>
                      <select
                        className="pb-col-filter"
                        value={colFilters[h] ?? ''}
                        onChange={e => { setColFilters(f => ({...f, [h]: e.target.value})); setPage(1); }}
                      >
                        <option value="">All</option>
                        {uniqueVals[h]?.map(v => <option key={v} value={v}>{v}</option>)}
                      </select>
                    </div>
                  </th>
                ))}
                <th className="pb-th-actions">Actions</th>
              </tr>
            </thead>
            <tbody>
              {pageRows.length === 0 && (
                <tr><td colSpan={headers.length + 1} className="pb-empty">No rows match your search.</td></tr>
              )}
              {pageRows.map((row, i) => (
                <tr key={row.__row} className="pb-tr">
                  {headers.map(h => (
                    <td key={h} className="pb-td" title={row[h]}>{row[h]}</td>
                  ))}
                  <td className="pb-td pb-td-actions">
                    <button className="pb-row-btn pb-edit"
                      onClick={() => withScript(() => setModal({ type: 'edit', row }))}>✏</button>
                    <button className="pb-row-btn pb-delete"
                      onClick={() => withScript(() => setModal({ type: 'delete', row }))}>🗑</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {/* ── Pagination ─────────────────────────────────────── */}
      {totalPages > 1 && (
        <div className="pb-pagination">
          <button className="pb-pg-btn" disabled={page === 1} onClick={() => setPage(1)}>«</button>
          <button className="pb-pg-btn" disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</button>
          <span className="pb-pg-info">Page {page} of {totalPages}</span>
          <button className="pb-pg-btn" disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</button>
          <button className="pb-pg-btn" disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</button>
        </div>
      )}

      {/* ── Toast ──────────────────────────────────────────── */}
      {toast && <div className={`pb-toast pb-toast-${toast.kind}`}>{toast.msg}</div>}

      {/* ── Modals ─────────────────────────────────────────── */}
      {showSetup && (
        <SetupModal onSave={(url) => { setScriptUrl(url); setShowSetup(false); }} />
      )}
      {modal?.type === 'add' && (
        <RowModal headers={headers} row={null} saving={saving}
          onClose={() => setModal(null)} onSave={handleAdd} />
      )}
      {modal?.type === 'edit' && (
        <RowModal headers={headers} row={modal.row} saving={saving}
          onClose={() => setModal(null)} onSave={handleEdit} />
      )}
      {modal?.type === 'delete' && (
        <DeleteModal saving={saving}
          onClose={() => setModal(null)} onConfirm={handleDelete} />
      )}
    </div>
  );
}
