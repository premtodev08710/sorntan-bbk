import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, query, where, orderBy, limit, getDocs
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";

/** Firebase config — ใช้ชุดเดียวกับโปรเจกต์หลัก */
const firebaseConfig = {
  apiKey: "AIzaSyCrcI_jyd8DcMKby8Qz_afA6ewTLCdrFo4",
  authDomain: "sorntan-bbk.firebaseapp.com",
  projectId: "sorntan-bbk",
  storageBucket: "sorntan-bbk.firebasestorage.app",
  messagingSenderId: "720649104047",
  appId: "1:720649104047:web:d00383683227796cc9825a",
  measurementId: "G-KWCCKBDZMN"
};

const app = initializeApp(firebaseConfig);
const db  = getFirestore(app);

const $ = s => document.querySelector(s);

const PERIOD_LABEL = p => `คาบ ${p}`;

function thaiDayMonth(dateStr){
  const d = new Date(dateStr + "T00:00:00");
  const dayNames = ["อาทิตย์","จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์","เสาร์"];
  const months   = ["มกราคม","กุมภาพันธ์","มีนาคม","เมษายน","พฤษภาคม","มิถุนายน",
                    "กรกฎาคม","สิงหาคม","กันยายน","ตุลาคม","พฤศจิกายน","ธันวาคม"];
  return {
    day: dayNames[d.getDay()],
    month: months[d.getMonth()],
    date: d.getDate(),
    yearBE: d.getFullYear() + 543
  };
}

function setThaiBadge(dateStr){
  if(!dateStr){ $('#dayBadge').textContent = '—'; return; }
  const t = thaiDayMonth(dateStr);
  $('#dayBadge').textContent = `${t.day} ที่ ${t.date} ${t.month} พ.ศ. ${t.yearBE}`;
}

/** โหลดรายการวันที่ล่าสุด (30 วันล่าสุดที่มีข้อมูล) */
async function loadRecentDates(){
  const q = query(
    collection(db, 'substitutions'),
    orderBy('date', 'desc'),
    limit(30)
  );
  const snap = await getDocs(q);
  const dates = [...new Set(snap.docs.map(d => d.data().date))]; // unique
  const wrap = $('#recentDates');
  wrap.innerHTML = '';

  if(dates.length === 0){
    wrap.innerHTML = `<div class="text-gray-500">— ยังไม่มีข้อมูล —</div>`;
    return;
  }

  dates.forEach(dateStr => {
    const t = thaiDayMonth(dateStr);
    const btn = document.createElement('button');
    btn.className = 'w-full text-left px-3 py-2 rounded hover:bg-gray-100 flex items-center justify-between';
    btn.innerHTML = `
      <span>${dateStr}</span>
      <span class="text-xs text-gray-500">${t.day}</span>
    `;
    btn.addEventListener('click', () => loadByDate(dateStr));
    wrap.appendChild(btn);
  });
}

/** ดึงข้อมูลตามวัน */
let currentRows = []; // เก็บข้อมูลดิบของวันนั้น (ใช้กรอง + ส่งออก)
async function loadByDate(dateStr){
  $('#pickDate').value = dateStr;
  setThaiBadge(dateStr);
  $('#rowsBody').innerHTML = '<tr><td colspan="7" class="text-center text-gray-500">กำลังโหลด...</td></tr>';

  const q = query(collection(db,'substitutions'), where('date','==', dateStr));
  const snap = await getDocs(q);
  currentRows = snap.docs.map(d => d.data())
    .sort((a,b) => a.period - b.period);

  renderRows(currentRows);
  populateFilters(currentRows);
  updateSummary(currentRows, dateStr);
}

/** อัพเดตสรุป */
function updateSummary(rows, dateStr){
  const absentSet = new Set(rows.map(r => r.absentTeacherName || r.absentTeacherId));
  $('#totalPeriods').textContent = rows.length;
  $('#totalAbsent').textContent  = absentSet.size;
  $('#resultInfo').textContent   = rows.length ? `ทั้งหมด ${rows.length} รายการ` : '—';
  setThaiBadge(dateStr);
}

/** เติมตัวเลือกตัวกรอง */
function populateFilters(rows){
  const absentSel = $('#filterAbsent');
  const subSel    = $('#filterSub');

  const absents = [...new Set(rows.map(r=>r.absentTeacherName).filter(Boolean))].sort((a,b)=> a.localeCompare(b,'th-TH'));
  const subs    = [...new Set(rows.map(r=>r.substituteName).filter(Boolean))].sort((a,b)=> a.localeCompare(b,'th-TH'));

  absentSel.innerHTML = `<option value="">-- ทั้งหมด --</option>` + absents.map(n=>`<option value="${n}">${n}</option>`).join('');
  subSel.innerHTML    = `<option value="">-- ทั้งหมด --</option>` + subs.map(n=>`<option value="${n}">${n}</option>`).join('');
}

/** แสดงแถว */
function renderRows(rows){
  const body = $('#rowsBody');
  body.innerHTML = '';

  if(!rows.length){
    body.innerHTML = `<tr><td colspan="7" class="text-center text-gray-500">ไม่พบข้อมูล</td></tr>`;
    return;
  }

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td>${PERIOD_LABEL(r.period)}</td>
      <td>${r.time || ''}</td>
      <td>${r.subject || ''}</td>
      <td>${r.klass || ''}</td>
      <td>${r.substituteName || ''}</td>
      <td>${r.absentTeacherName || ''}</td>
      <td>${r.reason || ''}</td>
    `;
    body.appendChild(tr);
  });
}

/** กรองข้อมูล */
function applyFilters(){
  let rows = [...currentRows];
  const fA = $('#filterAbsent').value.trim();
  const fS = $('#filterSub').value.trim();
  if(fA) rows = rows.filter(r => (r.absentTeacherName||'') === fA);
  if(fS) rows = rows.filter(r => (r.substituteName||'')   === fS);
  renderRows(rows);
  $('#resultInfo').textContent = rows.length ? `ทั้งหมด ${rows.length} รายการ (หลังกรอง)` : '—';
}

/** ส่งออก CSV (ตามผลกรองปัจจุบันบนจอ) */
function exportCSV(){
  // เอาจาก DOM ปัจจุบัน เพื่อสะท้อนผลกรอง
  const table = document.createElement('table');
  table.innerHTML = `
    <thead><tr><th>คาบ</th><th>เวลา</th><th>รายวิชา</th><th>ชั้น</th><th>ครูที่สอนแทน</th><th>ครูที่ไม่มาปฏิบัติ</th><th>สาเหตุ</th></tr></thead>
    <tbody>${$('#rowsBody').innerHTML}</tbody>
  `;
  const rows = table.querySelectorAll('tr');
  let csv = '\uFEFF';
  rows.forEach(r=>{
    const cells = r.querySelectorAll('th,td');
    const line = Array.from(cells).map(c=>`"${c.textContent.replace(/"/g,'""').trim()}"`).join(',');
    csv += line + '\n';
  });
  const d = $('#pickDate').value || 'all';
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `substitutions_${d}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

/** เปิดหน้าปริ้น */
function openPrint(){
  const d = $('#pickDate').value;
  if(!d){ alert('กรุณาเลือกวันที่'); return; }
  window.open(`print.html?date=${encodeURIComponent(d)}`, '_blank');
}

/** Boot */
document.addEventListener('DOMContentLoaded', async ()=>{
  // ตั้ง default เป็นวันนี้
  $('#pickDate').valueAsDate = new Date();

  // โหลดวันที่ล่าสุด
  await loadRecentDates();

  // ปุ่ม/อีเวนต์
  $('#btnReloadDates').addEventListener('click', loadRecentDates);
  $('#btnView').addEventListener('click', ()=> {
    const d = $('#pickDate').value;
    if(!d) return alert('กรุณาเลือกวันที่');
    loadByDate(d);
  });
  $('#btnPrintForm').addEventListener('click', openPrint);
  $('#btnExport').addEventListener('click', exportCSV);
  $('#btnClearFilters').addEventListener('click', ()=>{
    $('#filterAbsent').value = '';
    $('#filterSub').value = '';
    applyFilters();
  });
  $('#filterAbsent').addEventListener('change', applyFilters);
  $('#filterSub').addEventListener('change', applyFilters);

  // แสดงข้อมูลของวันที่ตั้งต้น
  const d0 = $('#pickDate').value;
  if(d0) loadByDate(d0);
});
