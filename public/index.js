// ===== Firebase SDK =====
import { initializeApp } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-app.js";
import {
  getFirestore, collection, doc, getDocs, getDoc, setDoc, addDoc, updateDoc, deleteDoc,
  onSnapshot, serverTimestamp, query, where
} from "https://www.gstatic.com/firebasejs/10.12.0/firebase-firestore.js";
import { getAuth, signInAnonymously, onAuthStateChanged } from "https://www.gstatic.com/firebasejs/10.12.0/firebase-auth.js";

// ==== Config ของคุณ ====
const firebaseConfig = {
 apiKey: "AIzaSyCrcI_jyd8DcMKby8Qz_afA6ewTLCdrFo4",
  authDomain: "sorntan-bbk.firebaseapp.com",
  projectId: "sorntan-bbk",
  storageBucket: "sorntan-bbk.firebasestorage.app",
  messagingSenderId: "720649104047",
  appId: "1:720649104047:web:d00383683227796cc9825a",
  measurementId: "G-KWCCKBDZMN"
};


const app  = initializeApp(firebaseConfig);
const db   = getFirestore(app);
const auth = getAuth(app);

// ===== Constants (คาบสอน) =====
const PERIODS = [1,2,3,4,5,6];
// เวลาคาบเริ่มต้น (แก้จาก config ได้ภายหลัง)
let PERIOD_TIME = {
  1:"08:30-09:30", 2:"09:30-10:30", 3:"10:30-11:30",
  4:"12:30-13:30", 5:"13:30-14:30", 6:"14:30-15:30"
};
// พักเที่ยงเริ่มต้น
let LUNCH_BREAK = "11:30-12:30";

const DAYS = ["จันทร์","อังคาร","พุธ","พฤหัสบดี","ศุกร์"];
const DAY_ALIASES = { Monday:"จันทร์", Tuesday:"อังคาร", Wednesday:"พุธ", Thursday:"พฤหัสบดี", Friday:"ศุกร์" };

// ===== State =====
let store = { teachers: [] };
let currentDateStr = null;

// (1) กันซ้ำคาบ: key = `${absentId}_${period}` -> { docId, substituteId, substituteName, ... }
let takenSlotsMap = new Map();
// (2) กันซ้ำ "ครู × คาบ × วัน": key = `${substituteId}_${period}` -> docId
let teacherPeriodTaken = new Map();

// ===== Helpers =====
const $ = s => document.querySelector(s);
function createEmptyGrid(){
  const g={}; DAYS.forEach(d=>{ g[d]={}; PERIODS.forEach(p=>g[d][p]=""); }); return g;
}
function dayNameFromDateStr(dateStr){
  const d = new Date(dateStr+"T00:00:00");
  const names=['อาทิตย์','จันทร์','อังคาร','พุธ','พฤหัสบดี','ศุกร์','เสาร์'];
  return names[d.getDay()];
}
function parseSubjectAndClass(text){
  if(!text) return {subject:"",klass:""};
  const [subj,klass=""] = text.split("/").map(s=>s.trim());
  return {subject:subj||"", klass};
}
function slotKey(absentId, period){ return `${absentId}_${period}`; }
function teacherPeriodKey(subId, period){ return `${subId}_${period}`; }
function subjectLabel(subject, klass){ return klass ? `${subject} / ${klass}` : subject; }

// ===== Firestore refs =====
const teachersCol = collection(db, 'teachers');
const subsCol     = collection(db, 'substitutions');
const configDoc   = doc(db, 'config', 'school');

// ===== Auth =====
async function ensureSignedIn(){
  return new Promise((resolve)=>{
    onAuthStateChanged(auth, async (user)=>{
      try {
        if(!user) await signInAnonymously(auth);
        resolve();
      } catch (e) {
        console.warn('Anonymous sign-in disabled? continuing without auth.', e);
        resolve();
      }
    });
  });
}

// ===== Load config (optional) =====
async function loadConfigAndApply(){
  try {
    const snap = await getDoc(configDoc);
    if(!snap.exists()) return;
    const cfg = snap.data() || {};
    applyConfigToUI(cfg);
  } catch (e) {
    console.warn('loadConfig error', e);
  }
}
function applyConfigToUI(cfg){
  // periods: [{id:"P1", start:"08:30", end:"09:30"}, ...]
  if (Array.isArray(cfg.periods)) {
    const map = {};
    cfg.periods.forEach((p,i)=>{
      const idx = i+1;
      if(p?.start && p?.end) map[idx] = `${p.start}-${p.end}`;
    });
    if(Object.keys(map).length===6){
      PERIOD_TIME = map;
      // อัปเดต header เวลา
      $('#p1Time').textContent = PERIOD_TIME[1];
      $('#p2Time').textContent = PERIOD_TIME[2];
      $('#p3Time').textContent = PERIOD_TIME[3];
      $('#p4Time').textContent = PERIOD_TIME[4];
      $('#p5Time').textContent = PERIOD_TIME[5];
      $('#p6Time').textContent = PERIOD_TIME[6];
    }
  }
  if (cfg.lunch_break){
    LUNCH_BREAK = cfg.lunch_break;
    $('#lunchTime').textContent = LUNCH_BREAK;
  }
}

// ===== Load/subscribe teachers =====
function subscribeTeachers(){
  onSnapshot(teachersCol, (snapshot)=>{
    store.teachers = snapshot.docs.map(d => ({ id:d.id, ...d.data() }));
    populateTeacherSelect();
    const currentId = $('#teacherSelect').value;
    if(currentId){
      const t = store.teachers.find(x=>x.id===currentId);
      if(t){
        $('#teacherName').value = t.name || '';
        $('#teacherNameSection').classList.remove('hidden');
        $('#timetableSection').classList.remove('hidden');
        renderGrid(currentId);
      }
    }
  });
}

// ===== UI: Select & Grid =====
function populateTeacherSelect(){
  const tSel = $('#teacherSelect');
  const aSel = $('#absentTeacher');
  tSel.innerHTML = '<option value="">-- เลือกครู --</option>';
  aSel.innerHTML = '<option value="">-- เลือกครูที่ขาด --</option>';
  store.teachers.forEach(t=>{
    tSel.add(new Option(t.name, t.id));
    aSel.add(new Option(t.name, t.id));
  });
}

/**
 * renderGrid: เพิ่มคอลัมน์คงที่ “โฮมรูม” และ “พักกลางวัน”
 * โฮมรูมอยู่ก่อนคาบ 1, พักกลางวันอยู่ก่อนคาบ 4
 * ทั้งสองคอลัมน์เป็น static-cell (ไม่แก้ไข/ไม่เซฟ)
 */
function renderGrid(teacherId){
  const teacher = store.teachers.find(t=>t.id===teacherId);
  if(!teacher) return;
  const tbody = $('#timetableGrid');
  tbody.innerHTML = '';

  DAYS.forEach(day=>{
    const tr = document.createElement('tr');

    // ชื่อวัน
    const dayCell = document.createElement('td');
    dayCell.className = 'day-header border';
    dayCell.textContent = day;
    tr.appendChild(dayCell);

    // โฮมรูม (คงที่)
    const homeroomCell = document.createElement('td');
    homeroomCell.className = 'static-cell';
    homeroomCell.textContent = 'อ่านคิดวิเคราะห์';
    tr.appendChild(homeroomCell);

    // คาบ 1-3 (แก้ไขได้)
    [1,2,3].forEach(p=>{
      const td = document.createElement('td');
      td.className = 'timetable-cell';
      td.contentEditable = true;
      td.dataset.day = day;
      td.dataset.period = p;
      td.textContent = teacher.grid?.[day]?.[p] || '';
      tr.appendChild(td);
    });

    // พักกลางวัน (คงที่)
    const lunchCell = document.createElement('td');
    lunchCell.className = 'static-cell';
    lunchCell.textContent = `พักกลางวัน`;
    tr.appendChild(lunchCell);

    // คาบ 4-6 (แก้ไขได้)
    [4,5,6].forEach(p=>{
      const td = document.createElement('td');
      td.className = 'timetable-cell';
      td.contentEditable = true;
      td.dataset.day = day;
      td.dataset.period = p;
      td.textContent = teacher.grid?.[day]?.[p] || '';
      tr.appendChild(td);
    });

    tbody.appendChild(tr);
  });
}

function freeTeachersAt(day, period, excludeId){
  // ว่าง = ไม่มีสอนคาบนั้นในตารางตัวเอง
  return store.teachers.filter(t=>{
    if(t.id===excludeId) return false; // ไม่ให้ครูที่ขาดมาแทนตัวเอง
    const s = t.grid?.[day]?.[period] || '';
    return s.trim()==='';
  });
}

// ===== Actions: CRUD (ตารางประจำ) =====
async function addTeacher(){
  const name = prompt('กรอกชื่อครูใหม่:');
  if(!name || !name.trim()) return;
  const ref = await addDoc(teachersCol, { name:name.trim(), grid:createEmptyGrid() });
  $('#teacherSelect').value = ref.id; $('#teacherSelect').dispatchEvent(new Event('change'));
}
async function saveTeacherName(){
  const id = $('#teacherSelect').value;
  const newName = $('#teacherName').value.trim();
  if(!id || !newName) return;
  await updateDoc(doc(db,'teachers',id), { name:newName });
}
async function saveGrid(){
  const id = $('#teacherSelect').value; if(!id) return;
  const t = store.teachers.find(x=>x.id===id); if(!t) return;
  const cells = document.querySelectorAll('#timetableGrid .timetable-cell');
  const newGrid = structuredClone(t.grid || createEmptyGrid());
  cells.forEach(c=>{
    const d=c.dataset.day; const p=+c.dataset.period;
    if(!newGrid[d]) newGrid[d]={};
    newGrid[d][p]=c.textContent.trim();
  });
  await updateDoc(doc(db,'teachers',id), { grid:newGrid });
  const btn=$('#saveGrid'); const o=btn.textContent; btn.textContent='✅ บันทึกแล้ว';
  btn.classList.replace('bg-blue-500','bg-green-500');
  setTimeout(()=>{btn.textContent=o;btn.classList.replace('bg-green-500','bg-blue-500');},1500);
}
async function clearGrid(){
  if(!confirm('ต้องการล้างตารางสอนของครูนี้ใช่หรือไม่?')) return;
  const id = $('#teacherSelect').value; if(!id) return;
  await updateDoc(doc(db,'teachers',id), { grid:createEmptyGrid() });
  renderGrid(id);
}
async function deleteTeacher(){
  const id = $('#teacherSelect').value; if(!id) return;
  const t = store.teachers.find(x=>x.id===id); if(!t) return;
  if(!confirm(`ต้องการลบครู "${t.name}" ใช่หรือไม่?`)) return;
  await deleteDoc(doc(db,'teachers',id));
  $('#teacherSelect').value=''; $('#teacherNameSection').classList.add('hidden'); $('#timetableSection').classList.add('hidden');
}

// ===== Substitute flow (assign / edit / cancel) =====
async function loadExistingSubsForDate(dateStr){
  takenSlotsMap.clear();
  teacherPeriodTaken.clear();
  const q = query(subsCol, where('date','==', dateStr));
  const snap = await getDocs(q);
  snap.docs.forEach(d=>{
    const r = d.data();
    const docId = d.id;
    // กันซ้ำคาบ
    takenSlotsMap.set(slotKey(r.absentTeacherId, r.period), { docId, ...r });
    // กันซ้ำ "ครู × คาบ × วัน"
    if(r.substituteId){
      teacherPeriodTaken.set(teacherPeriodKey(r.substituteId, r.period), docId);
    }
  });
}

function buildOptionsForEdit(dayName, period, absentId, currentDocId, currentSubId){
  // 1) ครูต้อง "ว่าง" ในคาบนี้
  let list = freeTeachersAt(dayName, period, absentId);
  // 2) กันซ้ำครู×คาบ×วัน — ยกเว้นถ้าเป็นครูที่อยู่ในเอกสารเดียวกัน (กำลังแก้ไข)
  list = list.filter(t=>{
    const k = teacherPeriodKey(t.id, period);
    const usedByDoc = teacherPeriodTaken.get(k);
    if(!usedByDoc) return true;
    return (t.id === currentSubId) && (usedByDoc === currentDocId);
  });
  list.sort((a,b)=>a.name.localeCompare(b.name,'th'));
  return list;
}

async function generateSubstituteTasks(){
  currentDateStr = $('#subDate').value;
  const absentId = $('#absentTeacher').value;

  if(!currentDateStr || !absentId){ alert('กรุณาเลือกวันที่และครูที่ขาด'); return; }

  const dayName = dayNameFromDateStr(currentDateStr);
  if(!DAYS.includes(dayName)){ alert('วันที่เลือกไม่ใช่วันจันทร์-ศุกร์'); return; }

  const absentTeacher = store.teachers.find(t=>t.id===absentId);
  if(!absentTeacher){ alert('ไม่พบข้อมูลครูที่ขาด'); return; }

  await loadExistingSubsForDate(currentDateStr);

  // เฉพาะคาบ 1..6 (ไม่รวมโฮมรูม/พักกลางวัน)
  const periods = PERIODS.filter(p=>{
    const s = absentTeacher.grid?.[dayName]?.[p];
    return s && s.trim() !== '';
  });
  if(periods.length===0){ alert('ครูที่เลือกไม่มีคาบสอนในวันนี้'); return; }

  const tbody = $('#subTasksBody'); tbody.innerHTML='';

  periods.forEach(p=>{
    const subjFull = absentTeacher.grid[dayName][p];
    const k = slotKey(absentId, p);
    const existing = takenSlotsMap.get(k);

    if(existing){
      // แถวที่มอบหมายแล้ว
      const opts = buildOptionsForEdit(dayName, p, absentId, existing.docId, existing.substituteId);
      const tr = document.createElement('tr');
      tr.innerHTML = `
        <td class="border px-2 py-2 font-medium">คาบ ${p}</td>
        <td class="border px-2 py-2">${PERIOD_TIME[p]}</td>
        <td class="border px-2 py-2">${subjFull}</td>
        <td class="border px-2 py-2">
          <div class="text-green-700 font-medium">✅ มอบหมายแล้ว <span class="text-gray-700">(${existing.substituteName||''})</span></div>
          <div class="edit-area mt-2 hidden">
            <div class="flex gap-2 items-center">
              <select class="edit-select w-full border rounded px-2 py-1">
                ${opts.length ? '' : '<option value="">— ไม่มีครูว่างให้เปลี่ยน —</option>'}
                ${opts.map(t=>`<option value="${t.id}" ${t.id===existing.substituteId?'selected':''}>${t.name}</option>`).join('')}
              </select>
              <button class="btn-save-edit bg-blue-600 hover:bg-blue-700 text-white px-3 py-1 rounded text-sm">บันทึก</button>
              <button class="btn-cancel-edit bg-gray-300 hover:bg-gray-400 text-gray-800 px-3 py-1 rounded text-sm">ยกเลิกแก้ไข</button>
            </div>
          </div>
        </td>
        <td class="border px-2 py-2 text-center">
          <div class="flex gap-2 justify-center">
            <button class="btn-edit bg-amber-500 hover:bg-amber-600 text-white px-3 py-1 rounded text-sm"
              data-doc-id="${existing.docId}" data-absent-id="${absentId}" data-period="${p}" data-subject="${subjFull}">
              แก้ไข
            </button>
            <button class="btn-cancel-assignment bg-red-600 hover:bg-red-700 text-white px-3 py-1 rounded text-sm"
              data-doc-id="${existing.docId}" data-absent-id="${absentId}" data-period="${p}">
              ยกเลิก
            </button>
          </div>
        </td>`;
      tbody.appendChild(tr);
      return;
    }

    // แถวเลือกมอบหมายใหม่
    const free = freeTeachersAt(dayName, p, absentId)
      .filter(t => !teacherPeriodTaken.has(teacherPeriodKey(t.id, p)));

    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-2 font-medium">คาบ ${p}</td>
      <td class="border px-2 py-2">${PERIOD_TIME[p]}</td>
      <td class="border px-2 py-2">${subjFull}</td>
      <td class="border px-2 py-2">
        <select class="w-full border rounded px-2 py-1" data-period="${p}" data-subject="${subjFull}">
          <option value="">-- เลือกครูสอนแทน --</option>
          ${free.map(t=>`<option value="${t.id}">${t.name}</option>`).join('')}
        </select>
      </td>
      <td class="border px-2 py-2 text-center">
        <button class="btn-assign bg-green-600 hover:bg-green-700 text-white px-3 py-1 rounded text-sm"
          data-period="${p}" data-subject="${subjFull}">
          มอบหมาย
        </button>
      </td>
    `;
    tbody.appendChild(tr);

    const sel = tr.querySelector('select');
    const btn = tr.querySelector('.btn-assign');
    if(sel.options.length <= 1){
      sel.disabled = true;
      btn.disabled = true;
      btn.textContent = 'ไม่มีครูว่าง';
      btn.classList.remove('bg-green-600','hover:bg-green-700');
      btn.classList.add('bg-gray-300','text-gray-600','cursor-not-allowed');
    }
  });

  $('#subTasks').classList.remove('hidden');

  // bind events
  tbody.querySelectorAll('.btn-assign').forEach(b=> b.addEventListener('click', handleAssignClick));
  tbody.querySelectorAll('.btn-edit').forEach(b=> b.addEventListener('click', handleEnterEdit));
  tbody.querySelectorAll('.btn-cancel-assignment').forEach(b=> b.addEventListener('click', handleCancelAssignment));
  tbody.querySelectorAll('.btn-save-edit').forEach(b=> b.addEventListener('click', handleSaveEdit));
  tbody.querySelectorAll('.btn-cancel-edit').forEach(b=> b.addEventListener('click', handleCancelEdit));

  await refreshSummary(currentDateStr);
}

// --- มอบหมายใหม่ ---
async function handleAssignClick(){
  const period   = Number(this.dataset.period);
  const subjFull = this.dataset.subject;
  const select   = document.querySelector(`select[data-period="${period}"]`);
  const subId    = select?.value;
  if(!subId){ alert('กรุณาเลือกครูสอนแทน'); return; }
  const substitute = store.teachers.find(t=>t.id===subId); if(!substitute) return;

  const absentId   = $('#absentTeacher').value;
  const absentName = $('#absentTeacher').selectedOptions[0]?.textContent || '';
  const reason     = ($('#absenceReason')?.value || '').trim();
  const dateStr    = $('#subDate').value;
  const dayName    = dayNameFromDateStr(dateStr);

  const slotK   = slotKey(absentId, period);
  const teachK  = teacherPeriodKey(subId, period);

  // กันซ้ำระดับ Firestore
  const [slotClash, personPeriodClash] = await Promise.all([
    getDocs(query(subsCol, where('date','==', dateStr), where('absentTeacherId','==', absentId), where('period','==', period))),
    getDocs(query(subsCol, where('date','==', dateStr), where('substituteId','==', subId), where('period','==', period)))
  ]);
  if(!slotClash.empty || takenSlotsMap.has(slotK)){
    alert('คาบนี้ถูกมอบหมายแล้ว');
    await generateSubstituteTasks();
    return;
  }
  if(!personPeriodClash.empty || teacherPeriodTaken.has(teachK)){
    alert(`ครู "${substitute.name}" ถูกมอบหมายในคาบ ${period} ของวันนี้ไปแล้ว`);
    await generateSubstituteTasks();
    return;
  }

  const { subject, klass } = parseSubjectAndClass(subjFull);
  const ref = await addDoc(subsCol, {
    date: dateStr,
    dayName,
    absentTeacherId: absentId,
    absentTeacherName: absentName,
    reason,
    period,
    time: PERIOD_TIME[period],
    subject,
    klass,
    substituteId: subId,
    substituteName: substitute.name,
    createdAt: serverTimestamp()
  });

  takenSlotsMap.set(slotK, { docId: ref.id, absentTeacherId:absentId, period, substituteId:subId, substituteName:substitute.name });
  teacherPeriodTaken.set(teachK, ref.id);

  await generateSubstituteTasks();
}

// --- แก้ไข/ยกเลิก ---
function handleEnterEdit(){ this.closest('tr').querySelector('.edit-area')?.classList.remove('hidden'); }
function handleCancelEdit(){ this.closest('tr').querySelector('.edit-area')?.classList.add('hidden'); }

async function handleSaveEdit(){
  const row = this.closest('tr');
  const editSelect = row.querySelector('.edit-select');
  if(!editSelect || !editSelect.value){ alert('กรุณาเลือกครูสอนแทน'); return; }

  const editBtn = row.querySelector('.btn-edit');
  const docId   = editBtn.dataset.docId;
  const absentId= editBtn.dataset.absentId;
  const period  = Number(editBtn.dataset.period);

  const newSubId   = editSelect.value;
  const newTeacher = store.teachers.find(t=>t.id===newSubId);
  if(!newTeacher){ alert('ไม่พบข้อมูลครู'); return; }

  const teachK = teacherPeriodKey(newSubId, period);
  const usedByDoc = teacherPeriodTaken.get(teachK);
  if(usedByDoc && usedByDoc !== docId){
    alert(`ครู "${newTeacher.name}" ถูกมอบหมายในคาบ ${period} ของวันนี้อยู่แล้ว`);
    return;
  }

  await updateDoc(doc(db,'substitutions', docId), {
    substituteId: newSubId,
    substituteName: newTeacher.name,
    updatedAt: serverTimestamp()
  });

  const tkEntry = Array.from(takenSlotsMap.values()).find(v=>v.docId===docId);
  if(tkEntry){
    const oldTeachK = teacherPeriodKey(tkEntry.substituteId, tkEntry.period);
    if(teacherPeriodTaken.get(oldTeachK) === docId) teacherPeriodTaken.delete(oldTeachK);
    tkEntry.substituteId   = newSubId;
    tkEntry.substituteName = newTeacher.name;
    teacherPeriodTaken.set(teachK, docId);
  }

  await generateSubstituteTasks();
}

async function handleCancelAssignment(){
  if(!confirm('ต้องการยกเลิกการมอบหมายคาบนี้หรือไม่?')) return;
  const docId   = this.dataset.docId;
  const absentId= this.dataset.absentId;
  const period  = Number(this.dataset.period);

  await deleteDoc(doc(db,'substitutions', docId));

  const k = slotKey(absentId, period);
  const keep = takenSlotsMap.get(k);
  if(keep && keep.docId === docId){
    const oldTeachK = teacherPeriodKey(keep.substituteId, keep.period);
    if(teacherPeriodTaken.get(oldTeachK) === docId) teacherPeriodTaken.delete(oldTeachK);
    takenSlotsMap.delete(k);
  }

  await generateSubstituteTasks();
}

// ===== Summary =====
async function refreshSummary(dateStr){
  const tbody = $('#assignmentBody');
  tbody.innerHTML = '';
  if(!dateStr){ $('#assignmentSummary').classList.add('hidden'); return; }

  const q = query(subsCol, where('date','==', dateStr));
  const snap = await getDocs(q);
  const rows = snap.docs.map(d=>({ id:d.id, ...d.data() }))
    .sort((a,b)=> (a.period||0) - (b.period||0));

  rows.forEach(r=>{
    const tr = document.createElement('tr');
    tr.innerHTML = `
      <td class="border px-2 py-2">${r.period}</td>
      <td class="border px-2 py-2">${r.time||PERIOD_TIME[r.period]||''}</td>
      <td class="border px-2 py-2">${subjectLabel(r.subject||'', r.klass||'')}</td>
      <td class="border px-2 py-2">${r.substituteName||''}</td>
    `;
    tbody.appendChild(tr);
  });

  $('#assignmentSummary').classList.toggle('hidden', rows.length===0);
}

// ===== CSV =====
function exportCSV(){
  const table = $('#assignmentTable');
  const rows = table.querySelectorAll('tr');
  let csv = '\uFEFF';
  rows.forEach(r=>{
    const cells = r.querySelectorAll('th,td');
    const row = Array.from(cells).map(c=>`"${c.textContent.trim().replace(/"/g,'""')}"`).join(',');
    csv += row + '\n';
  });
  const blob = new Blob([csv], { type:'text/csv;charset=utf-8;' });
  const link = document.createElement('a');
  link.href = URL.createObjectURL(blob);
  link.download = `substitute_${new Date().toISOString().split('T')[0]}.csv`;
  document.body.appendChild(link); link.click(); document.body.removeChild(link);
}

// ===== Tabs =====
function switchTab(name){
  document.querySelectorAll('.tab-button').forEach(b=>{
    b.classList.remove('active'); b.classList.add('bg-gray-100','hover:bg-gray-200');
  });
  $('#regular-tab').classList.add('hidden');
  $('#substitute-tab').classList.add('hidden');
  if(name==='regular'){
    const b=$('#tab-regular'); b.classList.add('active'); b.classList.remove('bg-gray-100','hover:bg-gray-200');
    $('#regular-tab').classList.remove('hidden');
  }else{
    const b=$('#tab-substitute'); b.classList.add('active'); b.classList.remove('bg-gray-100','hover:bg-gray-200');
    $('#substitute-tab').classList.remove('hidden');
  }
}

// ===== Open pages =====
function openPrintPageByDate(){
  const d = $('#subDate').value;
  if(!d){ alert('กรุณาเลือกวันที่'); return; }
  window.open(`print.html?date=${encodeURIComponent(d)}`, '_blank');
}
function openHistoryPage(){
  window.open('history.html', '_blank');
}

// ===== JSON Import (Modal + File) =====
function showPasteModal(){ const m=$('#jsonPasteModal'); m.classList.remove('hidden'); m.classList.add('flex'); }
function hidePasteModal(){ const m=$('#jsonPasteModal'); m.classList.add('hidden'); m.classList.remove('flex'); }

const exampleJSON = {
  "school": "โรงเรียนของคุณ",
  "district": "หน่วยงาน/สังกัด",
  "academic_year_be": 2568,
  "lunch_break": "11:30-12:30",
  "periods": [
    { "id": "P1", "start": "08:30", "end": "09:30" },
    { "id": "P2", "start": "09:30", "end": "10:30" },
    { "id": "P3", "start": "10:30", "end": "11:30" },
    { "id": "P4", "start": "12:30", "end": "13:30" },
    { "id": "P5", "start": "13:30", "end": "14:30" },
    { "id": "P6", "start": "14:30", "end": "15:30" }
  ],
  "timetables": [
    {
      "teacher": "ตัวอย่างครู ก",
      "role": "คณิตศาสตร์",
      "schedule": {
        "จันทร์":   { "P1": "คณิต ป.4", "P2": "", "P3": "", "P4": "", "P5": "", "P6": "" },
        "อังคาร":   { "P1": "", "P2": "", "P3": "", "P4": "", "P5": "", "P6": "" },
        "พุธ":      { "P1": "", "P2": "", "P3": "", "P4": "", "P5": "", "P6": "" },
        "พฤหัสบดี": { "P1": "", "P2": "", "P3": "", "P4": "", "P5": "", "P6": "" },
        "ศุกร์":    { "P1": "", "P2": "", "P3": "", "P4": "", "P5": "", "P6": "" }
      }
    }
  ]
};

function validateJSONShape(obj){
  if (typeof obj !== 'object' || !obj) throw new Error('รูปแบบ JSON ไม่ถูกต้อง');
  if (!Array.isArray(obj.timetables)) throw new Error('ต้องมีฟิลด์ timetables เป็น array');
  return true;
}

async function importJSONData(obj){
  validateJSONShape(obj);

  // บันทึก config (ถ้ามี)
  const cfg = {};
  if (obj.school) cfg.school = obj.school;
  if (obj.district) cfg.district = obj.district;
  if (obj.academic_year_be) cfg.academic_year_be = obj.academic_year_be;
  if (obj.lunch_break) cfg.lunch_break = obj.lunch_break;
  if (Array.isArray(obj.periods)) cfg.periods = obj.periods;

  if (Object.keys(cfg).length) {
    await setDoc(configDoc, cfg, { merge:true });
    applyConfigToUI(cfg);
  }

  // แปลงตารางครู -> teachers collection
  for (const t of obj.timetables){
    const name = t.teacher || 'ไม่ระบุชื่อ';
    const role = t.role || '';
    const schedule = t.schedule || {};

    // grid: dayTH -> {1..6: text}
    const grid = {};
    // รองรับทั้งไทย/อังกฤษ
    const dayKeys = Object.keys(schedule);
    dayKeys.forEach(dk=>{
      const thDay = DAY_ALIASES[dk] || dk; // map EN -> TH ถ้ามี
      if(!DAYS.includes(thDay)) return;
      grid[thDay] = {};
      const pmap = schedule[dk] || {};
      for (let i=1; i<=6; i++){
        const key = 'P'+i;
        grid[thDay][i] = (pmap[key] || '').trim();
      }
    });

    await addDoc(teachersCol, { name, role, grid });
  }
  alert('นำเข้าข้อมูลสำเร็จ');
}

// Events: Modal + File
$('#openPasteModal').addEventListener('click', showPasteModal);
$('#closePasteModal').addEventListener('click', hidePasteModal);
$('#pasteJSONExample').addEventListener('click', ()=> {
  $('#jsonPasteInput').value = JSON.stringify(exampleJSON, null, 2);
  $('#jsonPasteFeedback').textContent = 'ใส่โครงตัวอย่างแล้ว สามารถแก้ไขก่อนกดนำเข้า';
  $('#jsonPasteFeedback').className = 'mt-2 text-sm text-blue-600';
});
$('#validateJSONBtn').addEventListener('click', ()=>{
  try{
    const raw = $('#jsonPasteInput').value.trim();
    const obj = JSON.parse(raw);
    validateJSONShape(obj);
    $('#jsonPasteFeedback').textContent = '✅ JSON ถูกต้อง พร้อมนำเข้า';
    $('#jsonPasteFeedback').className = 'mt-2 text-sm text-green-600';
  }catch(e){
    $('#jsonPasteFeedback').textContent = '❌ ' + (e?.message || e);
    $('#jsonPasteFeedback').className = 'mt-2 text-sm text-red-600';
  }
});
$('#importJSONFromTextarea').addEventListener('click', async ()=>{
  try{
    const raw = $('#jsonPasteInput').value.trim();
    const obj = JSON.parse(raw);
    await importJSONData(obj);
    hidePasteModal();
  }catch(e){
    alert('เกิดข้อผิดพลาด: ' + (e?.message || e));
  }
});

// นำเข้าจากไฟล์
$('#importJSON').addEventListener('click', ()=> $('#jsonFileInput').click());
$('#jsonFileInput').addEventListener('change', async (e)=>{
  const f = e.target.files?.[0];
  if(!f) return;
  try{
    const text = await f.text();
    const obj = JSON.parse(text);
    await importJSONData(obj);
  }catch(err){
    alert('อ่านไฟล์ไม่สำเร็จ: ' + (err?.message || err));
  }finally{
    e.target.value = '';
  }
});

// ===== Boot =====
document.addEventListener('DOMContentLoaded', async ()=>{
  try{
    await ensureSignedIn();
    await loadConfigAndApply();
    subscribeTeachers();
  }catch(e){
    alert("Auth/Firestore error: " + (e?.message || e));
    console.error(e);
  }

  $('#subDate').valueAsDate = new Date();

  // Tabs
  $('#tab-regular').addEventListener('click', ()=>switchTab('regular'));
  $('#tab-substitute').addEventListener('click', ()=>switchTab('substitute'));

  // Teacher select
  $('#teacherSelect').addEventListener('change', function(){
    const id = this.value;
    if(id){
      const t = store.teachers.find(x=>x.id===id);
      $('#teacherName').value = t?.name || '';
      $('#teacherNameSection').classList.remove('hidden');
      $('#timetableSection').classList.remove('hidden');
      renderGrid(id);
    }else{
      $('#teacherNameSection').classList.add('hidden');
      $('#timetableSection').classList.add('hidden');
    }
  });

  // Buttons
  $('#addTeacher').addEventListener('click', addTeacher);
  $('#saveTeacherName').addEventListener('click', saveTeacherName);
  $('#saveGrid').addEventListener('click', saveGrid);
  $('#clearGrid').addEventListener('click', clearGrid);
  $('#deleteTeacher').addEventListener('click', deleteTeacher);

  $('#genSub').addEventListener('click', generateSubstituteTasks);
  $('#exportCSV').addEventListener('click', exportCSV);
  $('#openPrintPage').addEventListener('click', openPrintPageByDate);
  $('#openHistoryPage').addEventListener('click', openHistoryPage);
});
